-- 2026-11-12 — Protecting the customer from a dishonest seller.
--
-- The platform can prove that the SELLER paid the PLATFORM (the wallet charge is confirmed by Kashier). It cannot see what the customer paid
-- the seller in cash. This migration closes the gaps around that:
--   1. customer contact is locked once a seller booking is confirmed (the seller cannot redirect the voucher / confirmation e-mail)
--   2. public_booking_check(id) – a public "verify this booking" answer (status, what was paid online, what is left for the service location)
--   3. deposits for sellers only when the admin allows it, with a cap on the amount left to pay on site
--   4. only verified sellers can book from the desk; per-seller daily limit; flagged sellers are blocked
--   5. customer reports: report_seller() holds the seller's commission on that booking; 2 reported bookings flag the seller
--   6. admin_seller_risk() – signals for the super admin to review (repeated e-mails, many bookings a day, reports)
--   7. service_is_desk_booking / service_mark_contact_verified – used by the payments Worker (e-mail code of the customer, see workers/payments-worker.js)

-- ---------------------------------------------------------------- seller controls (per seller, set by the super admin)
alter table public.profiles
  add column if not exists seller_verified boolean not null default false,
  add column if not exists seller_flagged  boolean not null default false,
  add column if not exists seller_deposit_ok boolean not null default false,
  add column if not exists seller_deposit_max_remaining numeric(12,2) not null default 5000 check (seller_deposit_max_remaining >= 0),
  add column if not exists seller_daily_limit numeric(12,2) not null default 30000 check (seller_daily_limit >= 0);
-- sellers that exist today keep working (grandfathered); every NEW seller starts unverified
update public.profiles set seller_verified = true where is_seller and not seller_verified;

alter table public.bookings add column if not exists seller_held_amount numeric(12,2) not null default 0 check (seller_held_amount >= 0);

create or replace function public.admin_set_seller_controls(p_user uuid, p_verified boolean default null, p_deposit_ok boolean default null,
                                                            p_deposit_max numeric default null, p_daily_limit numeric default null, p_flagged boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.profiles set
      seller_verified = coalesce(p_verified, seller_verified), seller_deposit_ok = coalesce(p_deposit_ok, seller_deposit_ok),
      seller_deposit_max_remaining = coalesce(p_deposit_max, seller_deposit_max_remaining), seller_daily_limit = coalesce(p_daily_limit, seller_daily_limit),
      seller_flagged = coalesce(p_flagged, seller_flagged)
    where id = p_user and is_seller;
  if not found then raise exception 'Seller not found' using errcode = 'P0002'; end if;
  perform public.audit('seller_controls', 'profile', p_user::text, jsonb_build_object('verified', p_verified, 'deposit_ok', p_deposit_ok, 'deposit_max', p_deposit_max, 'daily_limit', p_daily_limit, 'flagged', p_flagged));
end $$;
revoke all on function public.admin_set_seller_controls(uuid, boolean, boolean, numeric, numeric, boolean) from public, anon;
grant execute on function public.admin_set_seller_controls(uuid, boolean, boolean, numeric, numeric, boolean) to authenticated;

-- the seller sees his own status (what is allowed for him) on the desk
create or replace function public.seller_desk_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('verified', p.seller_verified, 'flagged', p.seller_flagged, 'depositOk', p.seller_deposit_ok,
                            'depositMaxRemaining', p.seller_deposit_max_remaining, 'dailyLimit', p.seller_daily_limit,
                            'usedToday', coalesce((select sum(b.total) from public.bookings b where b.seller_id = p.id and b.user_id = p.id and b.status not in ('failed', 'cancelled', 'refunded')
                                                   and b.created_at >= (date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo')), 0))
    from public.profiles p where p.id = (select auth.uid()) and p.is_seller
$$;
revoke all on function public.seller_desk_status() from public, anon;
grant execute on function public.seller_desk_status() to authenticated;

-- ---------------------------------------------------------------- rules for bookings a seller makes from his OWN account (the desk)
-- Bookings that come through a seller's referral link (customer pays himself) are not touched.
create or replace function public.guard_seller_desk() returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.profiles; v_used numeric;
begin
  if new.seller_id is null or new.seller_id is distinct from new.user_id then return new; end if;
  select * into p from public.profiles where id = new.seller_id;
  if not found or not p.is_seller or not p.is_active then return new; end if;
  if p.seller_flagged then raise exception 'الحجز من حسابك موقوف مؤقتًا — تواصل مع الإدارة' using errcode = 'P0001'; end if;
  if not p.seller_verified then raise exception 'حسابك لسه ما اتوثّقش — تواصل مع الإدارة علشان تقدر تحجز لعملاء' using errcode = 'P0001'; end if;
  if new.payment_plan = 'deposit' then
    if not p.seller_deposit_ok then raise exception 'الحجز بعربون مش متاح لحسابك — الدفع كامل بس' using errcode = 'P0001'; end if;
    if new.remaining_amount > p.seller_deposit_max_remaining then
      raise exception 'المتبقي على العميل أكبر من الحد المسموح لحسابك (% جنيه) — استخدم الدفع الكامل', p.seller_deposit_max_remaining using errcode = 'P0001';
    end if;
  end if;
  select coalesce(sum(b.total), 0) into v_used from public.bookings b
   where b.seller_id = new.seller_id and b.user_id = new.seller_id and b.id <> new.id and b.status not in ('failed', 'cancelled', 'refunded')
     and b.created_at >= (date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo');
  if v_used + new.total > p.seller_daily_limit then
    raise exception 'وصلت للحد اليومي لحسابك (% جنيه) — كلّم الإدارة لو محتاج تزوّده', p.seller_daily_limit using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists bookings_guard_seller_desk on public.bookings;
create trigger bookings_guard_seller_desk before insert on public.bookings for each row execute function public.guard_seller_desk();

-- once a seller booking is confirmed, only the platform (service role / super admin) can change who the customer is
create or replace function public.lock_seller_booking_contact() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.seller_id is not null and old.seller_id = old.user_id and old.status <> 'pending_payment'
     and (new.guest_email is distinct from old.guest_email or new.guest_phone is distinct from old.guest_phone or new.guest_name is distinct from old.guest_name)
     and (select auth.uid()) is not null and not (select public.is_super_admin()) then
    raise exception 'بيانات العميل بتتقفل بعد تأكيد الحجز' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists bookings_lock_seller_contact on public.bookings;
create trigger bookings_lock_seller_contact before update on public.bookings for each row execute function public.lock_seller_booking_contact();

-- ---------------------------------------------------------------- public verification (customer side)
create or replace function public.public_booking_check(p_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; v_mail text;
begin
  if coalesce(p_id, '') !~ '^[A-Za-z0-9_-]{20,64}$' then return null; end if;
  select * into b from public.bookings where id = p_id and seller_id is not null;
  if not found then return null; end if;
  v_mail := coalesce(b.guest_email, '');
  return jsonb_build_object(
    'id', b.id, 'viaSeller', true,
    'status', case b.status when 'completed' then 'confirmed' when 'pending_payment' then 'unpaid' else b.status::text end,
    'item', coalesce(b.data->'hotelName'->>'en', b.data->'hotelName'->>'ar', b.data->>'hotelName', b.data->'title'->>'en', b.data->'title'->>'ar', b.data->>'title', b.data->>'vehicleType', ''),
    'date', coalesce(b.check_in, b.service_date), 'checkout', b.check_out, 'plan', b.payment_plan, 'currency', b.currency,
    'total', b.total,
    'paidOnline', case when b.status = 'completed' then b.amount_due_now else 0 end,
    'payOnSite', case when b.status = 'completed' then b.remaining_amount else b.total end,
    'customer', split_part(coalesce(b.guest_name, ''), ' ', 1),
    'email', case when v_mail like '%@%' then left(split_part(v_mail, '@', 1), 1) || '***@' || split_part(v_mail, '@', 2) else '' end,
    'createdAt', b.created_at);
end $$;
revoke all on function public.public_booking_check(text) from public;
grant execute on function public.public_booking_check(text) to anon, authenticated;

-- the customer's voucher says plainly that it came through a seller (so the voucher page can show the "do not pay more than…" notice)
create or replace function public.public_voucher(p_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.bookings;
begin
  if coalesce(p_id, '') !~ '^[A-Za-z0-9_-]{20,64}$' then return null; end if;
  select * into v_row from public.bookings where id = p_id and seller_id is not null and status = 'completed';
  if not found then return null; end if;
  return (public.booking_to_json(v_row) - array['uid', 'ownerUid', 'ownerStatus', 'ownerNote', 'adminNote', 'ownerShare', 'earning', 'commission',
                                               'sellerAmount', 'sellerName', 'platformNet', 'commissionRate', 'payment', 'contactVerified'])
         || jsonb_build_object('viaSeller', true);
end $$;
revoke all on function public.public_voucher(text) from public;
grant execute on function public.public_voucher(text) to anon, authenticated;

-- ---------------------------------------------------------------- customer reports
create table if not exists public.seller_reports (
  id         bigint generated always as identity primary key,
  booking_id text not null references public.bookings (id) on delete cascade,
  seller_id  uuid not null references public.profiles (id) on delete cascade,
  contact    text not null check (length(contact) between 5 and 120),
  reason     text not null check (length(reason) between 5 and 1500),
  status     text not null default 'open' check (status in ('open', 'upheld', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.seller_reports enable row level security;      -- no policies: only the functions below touch it
create index if not exists seller_reports_seller_idx on public.seller_reports (seller_id, status);

create or replace function public.report_seller(p_booking text, p_contact text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; v_n integer;
begin
  if coalesce(p_booking, '') !~ '^[A-Za-z0-9_-]{20,64}$' then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if length(btrim(coalesce(p_contact, ''))) < 5 or length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Contact and reason are required' using errcode = '22023'; end if;
  select * into b from public.bookings where id = p_booking and seller_id is not null;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if (select count(*) from public.seller_reports where booking_id = b.id) >= 3 then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  insert into public.seller_reports (booking_id, seller_id, contact, reason) values (b.id, b.seller_id, left(btrim(p_contact), 120), left(btrim(p_reason), 1500));
  -- hold the seller's commission on this booking until the admin decides (restored by admin_resolve_seller_report when dismissed)
  if b.seller_amount > 0 then update public.bookings set seller_held_amount = seller_held_amount + seller_amount, seller_amount = 0 where id = b.id; end if;
  select count(distinct booking_id) into v_n from public.seller_reports where seller_id = b.seller_id and status <> 'dismissed';
  if v_n >= 2 then update public.profiles set seller_flagged = true where id = b.seller_id; end if;
  perform public.audit('seller_report', 'booking', b.id, jsonb_build_object('seller', b.seller_id));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.report_seller(text, text, text) from public;
grant execute on function public.report_seller(text, text, text) to anon, authenticated;

create or replace function public.admin_list_seller_reports(p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'bookingId', r.booking_id, 'sellerId', r.seller_id, 'seller', coalesce(p.display_name, p.email), 'contact', r.contact,
           'reason', r.reason, 'status', r.status, 'createdAt', r.created_at, 'held', b.seller_held_amount, 'total', b.total, 'paidOnline', b.amount_due_now) order by r.created_at desc)
    from public.seller_reports r join public.profiles p on p.id = r.seller_id join public.bookings b on b.id = r.booking_id
    where p_status is null or p_status = '' or r.status = p_status), '[]'::jsonb);
end $$;
revoke all on function public.admin_list_seller_reports(text) from public, anon;
grant execute on function public.admin_list_seller_reports(text) to authenticated;

-- upheld: the held commission stays cancelled and the seller is flagged;  dismissed: the commission comes back
create or replace function public.admin_resolve_seller_report(p_id bigint, p_upheld boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.seller_reports;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into r from public.seller_reports where id = p_id and status = 'open' for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  update public.seller_reports set status = case when p_upheld then 'upheld' else 'dismissed' end, resolved_at = now() where id = p_id;
  if p_upheld then
    update public.profiles set seller_flagged = true where id = r.seller_id;
  else
    update public.bookings set seller_amount = seller_amount + seller_held_amount, seller_held_amount = 0
     where id = r.booking_id and not exists (select 1 from public.seller_reports x where x.booking_id = r.booking_id and x.status = 'open' and x.id <> p_id);
  end if;
  perform public.audit('seller_report_resolved', 'booking', r.booking_id, jsonb_build_object('upheld', p_upheld));
end $$;
revoke all on function public.admin_resolve_seller_report(bigint, boolean) from public, anon;
grant execute on function public.admin_resolve_seller_report(bigint, boolean) to authenticated;

-- ---------------------------------------------------------------- risk signals for the super admin
create or replace function public.admin_seller_risk()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    with d as (select b.seller_id, b.guest_email, b.guest_phone, b.total, b.payment_plan, (b.created_at at time zone 'Africa/Cairo')::date as day
                 from public.bookings b where b.seller_id is not null and b.user_id = b.seller_id and b.status = 'completed' and b.created_at > now() - interval '30 days'),
         per_mail as (select seller_id, max(c) as same_mail from (select seller_id, count(*) c from d group by seller_id, lower(guest_email)) x group by seller_id),
         per_phone as (select seller_id, max(c) as same_phone from (select seller_id, count(*) c from d group by seller_id, guest_phone) x group by seller_id),
         per_day as (select seller_id, max(c) as max_day from (select seller_id, count(*) c from d group by seller_id, day) x group by seller_id),
         agg as (select seller_id, count(*) n, coalesce(sum(total), 0) amount, count(*) filter (where payment_plan = 'deposit') deposits from d group by seller_id)
    select jsonb_agg(jsonb_build_object(
        'sellerId', p.id, 'seller', coalesce(p.display_name, p.email), 'verified', p.seller_verified, 'flagged', p.seller_flagged, 'depositOk', p.seller_deposit_ok,
        'depositMaxRemaining', p.seller_deposit_max_remaining, 'dailyLimit', p.seller_daily_limit,
        'bookings30d', coalesce(a.n, 0), 'amount30d', coalesce(a.amount, 0), 'deposits30d', coalesce(a.deposits, 0),
        'sameEmailMax', coalesce(m.same_mail, 0), 'samePhoneMax', coalesce(ph.same_phone, 0), 'maxPerDay', coalesce(dy.max_day, 0),
        'openReports', (select count(*) from public.seller_reports r where r.seller_id = p.id and r.status = 'open'),
        'signals', to_jsonb(array_remove(array[
            case when coalesce(m.same_mail, 0) >= 3 then 'repeat_email' end,
            case when coalesce(ph.same_phone, 0) >= 3 then 'repeat_phone' end,
            case when coalesce(dy.max_day, 0) >= 10 then 'many_per_day' end,
            case when coalesce(a.deposits, 0) >= 5 then 'many_deposits' end,
            case when exists (select 1 from public.seller_reports r where r.seller_id = p.id and r.status = 'open') then 'open_report' end,
            case when p.seller_flagged then 'flagged' end], null))) order by p.created_at desc)
      from public.profiles p left join agg a on a.seller_id = p.id left join per_mail m on m.seller_id = p.id left join per_phone ph on ph.seller_id = p.id left join per_day dy on dy.seller_id = p.id
     where p.is_seller), '[]'::jsonb);
end $$;
revoke all on function public.admin_seller_risk() from public, anon;
grant execute on function public.admin_seller_risk() to authenticated;

-- ---------------------------------------------------------------- payments Worker helpers (service role only)
-- A desk booking = a seller booking for a customer from the seller's own account. Before the wallet charge the customer proves the e-mail
-- is really his (6-digit code mailed to him), and only then does the Worker mark the checkout session contactVerified.
create or replace function public.service_is_desk_booking(p_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select seller_id is not null and seller_id = user_id from public.bookings where id = p_id), false)
$$;
create or replace function public.service_mark_contact_verified(p_id text)
returns void language sql security definer set search_path = '' as $$
  update public.bookings set data = data || '{"contactVerified": true}'::jsonb where id = p_id and status = 'pending_payment' and seller_id is not null and seller_id = user_id
$$;
revoke all on function public.service_is_desk_booking(text), public.service_mark_contact_verified(text) from public, anon, authenticated;
grant execute on function public.service_is_desk_booking(text), public.service_mark_contact_verified(text) to service_role;

-- make PostgREST see the new functions right away
notify pgrst, 'reload schema';
