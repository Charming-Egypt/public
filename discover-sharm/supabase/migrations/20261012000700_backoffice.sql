-- =====================================================================
-- Part 7: back-office — the super-admin and owner consoles (/admin, /owner/*).
--
-- Earnings are recognised when the OWNER marks a paid booking "done" after the service date (same rule
-- the consoles always had): that is when the commission rate is read and frozen on the booking.
-- Money in → bookings.subtotal; owner net → bookings.owner_amount; payouts and adjustments settle it.
-- =====================================================================

-- ---------- small redefinitions ------------------------------------------------------------
create or replace function public.partner_type_kinds(t text)
returns public.property_kind[] language sql immutable set search_path = '' as $$
  select case lower(coalesce(t, ''))
    when 'hotel'         then array['hotel']::public.property_kind[]
    when 'hotels'        then array['hotel']::public.property_kind[]
    when 'trips'         then array['excursion']::public.property_kind[]
    when 'trip'          then array['excursion']::public.property_kind[]
    when 'trip supplier' then array['excursion']::public.property_kind[]
    when 'excursion'     then array['excursion']::public.property_kind[]
    when 'excursions'    then array['excursion']::public.property_kind[]
    when 'tour'          then array['excursion']::public.property_kind[]
    when 'transfer'      then array['transfer']::public.property_kind[]
    when 'transfers'     then array['transfer']::public.property_kind[]
    when 'restaurant'    then array['restaurant']::public.property_kind[]
    when 'restaurants'   then array['restaurant']::public.property_kind[]
    else '{}'::public.property_kind[]
  end
$$;

-- console role names <-> (role, owner_kinds)
create or replace function public.console_role_kinds(p_role text)
returns public.property_kind[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'hotels_owner'      then array['hotel']::public.property_kind[]
    when 'trips_owner'       then array['excursion']::public.property_kind[]
    when 'transfers_owner'   then array['transfer']::public.property_kind[]
    when 'restaurants_owner' then array['restaurant']::public.property_kind[]
    else null
  end
$$;

create or replace function public.booking_to_json(b public.bookings)
returns jsonb language sql stable set search_path = '' as $$
  select b.data || jsonb_strip_nulls(jsonb_build_object(
    'id', b.id, 'type', b.kind, 'status', b.status, 'uid', b.user_id, 'ownerUid', b.owner_id,
    'total', b.total, 'subtotal', b.subtotal, 'taxes', b.taxes,
    'depositAmount', b.deposit_amount, 'remainingAmount', b.remaining_amount, 'amountDueNow', b.amount_due_now,
    'paymentPlan', b.payment_plan, 'currency', b.currency, 'nights', b.nights,
    'checkin', b.check_in, 'checkout', b.check_out, 'date', b.service_date,
    'reviewed', b.reviewed, 'ownerStatus', b.owner_status, 'ownerNote', b.owner_note, 'adminNote', b.admin_note,
    'needsRefund', case when b.needs_refund then true end,
    'cancelledAt', b.cancelled_at, 'cancelReason', b.cancel_reason,
    'createdAt', b.created_at, 'expiresAt', b.expires_at,
    'earning', case when b.earned_at is not null then jsonb_build_object(
        'gross', b.subtotal, 'rate', round(coalesce(b.commission_rate, 0) * 100, 2), 'commission', b.commission_amount,
        'net', b.owner_amount, 'void', b.earning_void, 'at', b.earned_at) end
  ))
$$;

-- ---------- bookings: owner / admin actions ---------------------------------------------------------
create or replace function public.cancel_booking(p_id text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_b   public.bookings;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into v_b from public.bookings where id = p_id for update;
  if not found or not (v_b.user_id = v_uid or v_b.owner_id = v_uid or (select public.is_super_admin())) then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_b.status in ('cancelled', 'refunded', 'failed') then
    raise exception 'Booking can not be cancelled' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = left(p_reason, 1000),
         needs_refund = (v_b.status = 'completed'), earning_void = (v_b.earned_at is not null)
   where id = p_id
   returning * into v_b;
  if v_b.user_id is not null and v_b.user_id <> v_uid then
    insert into public.notifications (user_id, icon, title, msg)
    values (v_b.user_id, 'fa-circle-xmark', 'Booking cancelled', 'Your booking ' || v_b.id || ' was cancelled.');
  end if;
  return jsonb_build_object('success', true, 'booking', public.booking_to_json(v_b));
end $$;

-- Owner answers a paid booking: confirmed / done / no_show. "done" books the earning (once, after the service date).
create or replace function public.owner_update_booking(p_id text, p_owner_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_admin boolean := (select public.is_super_admin());
  v_b     public.bookings;
  v_rate  numeric;
  v_comm  numeric;
  v_new   text := nullif(p_owner_status, 'new');
  v_change boolean := p_owner_status is not null;     -- a note-only save leaves the status alone
begin
  if p_owner_status is not null and p_owner_status not in ('new', 'confirmed', 'done', 'no_show') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  select * into v_b from public.bookings where id = p_id for update;
  if not found or not (v_b.owner_id = v_uid or v_admin) then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if not v_admin and v_b.status <> 'completed' then
    raise exception 'Only paid bookings can be updated' using errcode = 'P0001';
  end if;
  if v_change and v_b.earned_at is not null and v_new is distinct from v_b.owner_status and not v_admin then
    raise exception 'Earnings were already recorded for this booking' using errcode = 'P0001';
  end if;

  if v_change and v_new = 'done' and v_b.earned_at is null and v_b.owner_id is not null and v_b.status = 'completed' then
    if coalesce(v_b.check_in, v_b.service_date) is null or coalesce(v_b.check_in, v_b.service_date) > (now() at time zone 'Africa/Cairo')::date then
      raise exception 'The service date has not passed yet' using errcode = 'P0001', detail = 'too_early';
    end if;
    select commission_rate into v_rate from public.profiles where id = v_b.owner_id;
    if v_rate is null then
      select case v_b.kind when 'hotel' then commission_hotel when 'excursion' then commission_excursion
                           when 'transfer' then commission_transfer else default_commission_rate end
        into v_rate from public.platform_settings where id = 1;
    end if;
    v_comm := round(v_b.subtotal * v_rate, 2);
    update public.bookings
       set owner_status = 'done', owner_note = left(coalesce(p_note, owner_note), 1000), earned_at = now(),
           commission_rate = v_rate, commission_amount = v_comm, owner_amount = v_b.subtotal - v_comm
     where id = p_id returning * into v_b;
  else
    update public.bookings
       set owner_status = case when v_change then v_new else owner_status end, owner_note = left(coalesce(p_note, owner_note), 1000)
     where id = p_id returning * into v_b;
  end if;
  return public.booking_to_json(v_b);
end $$;

create or replace function public.admin_set_booking_status(p_id text, p_status public.booking_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_b public.bookings;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_b from public.bookings where id = p_id for update;
  if not found then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if p_status = v_b.status then                       -- same status: just the note, never reset refund/earning flags
    update public.bookings set admin_note = coalesce(left(p_note, 1000), admin_note) where id = p_id;
    return;
  end if;
  update public.bookings
     set status = p_status,
         admin_note = coalesce(left(p_note, 1000), admin_note),
         needs_refund = case when p_status = 'cancelled' then (v_b.status = 'completed')
                             when p_status in ('refunded', 'completed', 'failed', 'pending_payment') then false
                             else needs_refund end,
         earning_void = case when p_status in ('cancelled', 'refunded') then (v_b.earned_at is not null)
                             when p_status = 'completed' then false else earning_void end,
         confirmed_at = case when p_status = 'completed' and v_b.confirmed_at is null then now() else confirmed_at end,
         expires_at = case when p_status = 'pending_payment' then expires_at else null end
   where id = p_id;
  perform public.audit('booking_status', 'booking', p_id, jsonb_build_object('from', v_b.status, 'to', p_status));
end $$;

create or replace function public.admin_delete_booking(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.bookings where id = p_id and status in ('pending_payment', 'failed', 'cancelled');
  if not found then raise exception 'Only unpaid, failed or cancelled bookings can be deleted' using errcode = 'P0001'; end if;
  perform public.audit('booking_deleted', 'booking', p_id, '{}'::jsonb);
end $$;

create or replace function public.admin_list_bookings(
  p_status text default null, p_kind text default null, p_owner uuid default null,
  p_limit integer default 300, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(public.booking_to_json(x.b) order by (x.b).created_at desc), '[]'::jsonb)
      from (
        select b from public.bookings b
         where (case when p_status is null or p_status = '' then b.status <> 'pending_payment' else b.status::text = p_status end)
           and (p_kind  is null or p_kind  = '' or b.kind::text = p_kind)
           and (p_owner is null or b.owner_id = p_owner)
           and (p_before is null or b.created_at < p_before)
         order by b.created_at desc
         limit least(greatest(p_limit, 1), 1500)
      ) x
  );
end $$;

-- ---------- owner money -------------------------------------------------------------------------------------
create or replace function public.owner_balance(p_owner uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid := coalesce(p_owner, (select auth.uid()));
  v_earned numeric; v_comm numeric; v_adj numeric; v_paid numeric; v_open numeric;
begin
  if v_owner is distinct from (select auth.uid()) and not (select public.is_super_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(sum(owner_amount), 0), coalesce(sum(commission_amount), 0) into v_earned, v_comm
    from public.bookings where owner_id = v_owner and earned_at is not null and not earning_void;
  select coalesce(sum(amount), 0) into v_adj from public.adjustments where owner_id = v_owner;
  select coalesce(sum(amount) filter (where status = 'paid'), 0), coalesce(sum(amount) filter (where status = 'requested'), 0)
    into v_paid, v_open from public.payouts where owner_id = v_owner;
  return jsonb_build_object('earned', v_earned, 'commission', v_comm, 'adjustments', v_adj,
                            'paid', v_paid, 'pending', v_open, 'available', v_earned + v_adj - v_paid - v_open);
end $$;

create or replace function public.request_payout(p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_acc public.payout_accounts;
  v_min numeric;
  v_bal jsonb;
  v_id  uuid;
begin
  if not (select public.is_owner()) then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from public.profiles where id = v_uid for update;             -- serialise concurrent requests
  select * into v_acc from public.payout_accounts where owner_id = v_uid;
  if not found then raise exception 'Add a payout account first' using errcode = 'P0001'; end if;
  if v_acc.locked_until is not null and v_acc.locked_until > now() then
    raise exception 'Payouts are paused after a payout account change' using errcode = 'P0001', detail = 'account_locked';
  end if;
  if exists (select 1 from public.payouts where owner_id = v_uid and status = 'requested') then
    raise exception 'You already have an open payout request' using errcode = 'P0001';
  end if;
  select min_payout into v_min from public.platform_settings where id = 1;
  if p_amount is null or p_amount < v_min then raise exception 'Minimum payout is %', v_min using errcode = '22023'; end if;
  v_bal := public.owner_balance(v_uid);
  if p_amount > (v_bal->>'available')::numeric then raise exception 'Amount exceeds available balance' using errcode = '22023'; end if;
  insert into public.payouts (owner_id, amount, method, account)
  values (v_uid, p_amount, v_acc.method, v_acc.details) returning id into v_id;
  return v_id;
end $$;

create or replace function public.cancel_payout(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.payouts set status = 'cancelled'
   where id = p_id and owner_id = (select auth.uid()) and status = 'requested';
  if not found then raise exception 'Payout not found or already settled' using errcode = 'P0002'; end if;
end $$;

create or replace function public.admin_record_payout(p_owner uuid, p_amount numeric, p_method text, p_reference text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Invalid amount' using errcode = '22023'; end if;
  insert into public.payouts (owner_id, amount, status, method, manual, reference, note, paid_at)
  values (p_owner, p_amount, 'paid', p_method, true, left(p_reference, 200), left(p_note, 1000), now()) returning id into v_id;
  perform public.audit('payout_recorded', 'payout', v_id::text, jsonb_build_object('owner', p_owner, 'amount', p_amount));
  return v_id;
end $$;

create or replace function public.admin_add_adjustment(p_owner uuid, p_amount numeric, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.adjustments (owner_id, amount, reason, created_by) values (p_owner, p_amount, left(btrim(p_reason), 500), (select auth.uid()));
  perform public.audit('adjustment', 'profile', p_owner::text, jsonb_build_object('amount', p_amount, 'reason', p_reason));
end $$;

create or replace function public.admin_update_settings(p_hotel numeric, p_excursion numeric, p_transfer numeric, p_min_payout numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if least(p_hotel, p_excursion, p_transfer) < 0 or greatest(p_hotel, p_excursion, p_transfer) > 100 or p_min_payout < 0 then
    raise exception 'Invalid values' using errcode = '22023';
  end if;
  update public.platform_settings
     set commission_hotel = p_hotel / 100, commission_excursion = p_excursion / 100, commission_transfer = p_transfer / 100,
         min_payout = p_min_payout, updated_at = now()
   where id = 1;
  perform public.audit('settings', 'platform', '1', jsonb_build_object('hotel', p_hotel, 'excursion', p_excursion, 'transfer', p_transfer, 'min_payout', p_min_payout));
end $$;

-- pause payouts for 24 h after the payout account changes (protects against a hijacked session)
create or replace function public.payout_accounts_lock()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if old.method is distinct from new.method or old.details is distinct from new.details then
      new.locked_until := now() + interval '24 hours';
    end if;
  end if;
  return new;
end $$;
create trigger payout_accounts_lock before insert or update on public.payout_accounts
  for each row execute function public.payout_accounts_lock();

-- ---------- listing cap per owner (hotels default to 2; a super admin is never capped) ------------------------
create or replace function public.properties_enforce_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.owner_id is null or (select public.is_super_admin()) then return new; end if;
  select max_items into v_limit from public.profiles where id = new.owner_id;
  v_limit := coalesce(v_limit, case when new.kind = 'hotel' then 2 end);
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.properties where owner_id = new.owner_id and kind = new.kind and status <> 'archived';
  if v_count >= v_limit then
    raise exception 'Listing limit reached (%)', v_limit using errcode = 'P0001', detail = 'limit_reached';
  end if;
  return new;
end $$;
create trigger properties_enforce_limit before insert on public.properties
  for each row execute function public.properties_enforce_limit();

create or replace function public.owner_archive_property(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.properties set status = 'archived'
   where id = p_id and status <> 'archived'
     and ((select public.is_super_admin()) or (owner_id = (select auth.uid()) and public.owner_can_manage(kind)));
  if not found then raise exception 'Listing not found' using errcode = 'P0002'; end if;
end $$;

-- ---------- accounts (super admin) ----------------------------------------------------------------------------
create or replace function public.admin_update_owner(
  p_user uuid, p_name text default null, p_phone text default null, p_role text default null,
  p_commission numeric default null, p_set_commission boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_kinds public.property_kind[] := public.console_role_kinds(p_role);
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role is not null and p_role <> '' and v_kinds is null then raise exception 'Unknown role' using errcode = '22023'; end if;
  if p_set_commission and p_commission is not null and (p_commission < 0 or p_commission > 100) then
    raise exception 'Invalid commission' using errcode = '22023';
  end if;
  update public.profiles
     set display_name = coalesce(nullif(left(btrim(p_name), 120), ''), display_name),
         phone = coalesce(nullif(left(btrim(p_phone), 30), ''), phone),
         role = case when v_kinds is not null then 'owner'::public.user_role else role end,
         owner_kinds = coalesce(v_kinds, owner_kinds),
         commission_rate = case when p_set_commission then p_commission / 100 else commission_rate end
   where id = p_user and role <> 'super_admin';
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  perform public.audit('owner_updated', 'profile', p_user::text, jsonb_build_object('role', p_role, 'commission', p_commission));
end $$;

-- ---------- partner applications + messages ---------------------------------------------------------------------
create or replace function public.admin_list_applications()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'businessName', a.business_name, 'partnerType', a.partner_type, 'contactName', a.contact_name,
      'phone', a.phone, 'email', a.email, 'message', a.message, 'status', a.status, 'adminNote', a.admin_note,
      'createdAt', a.created_at,
      'documents', (select coalesce(jsonb_agg(jsonb_build_object('name', d->>'name')), '[]'::jsonb) from jsonb_array_elements(a.documents) d)
    ) order by a.created_at desc)
    from (select * from public.partner_applications order by created_at desc limit 300) a
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_get_application(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.partner_applications;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from public.partner_applications where id = p_id;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', v.id, 'businessName', v.business_name, 'documents', v.documents);
end $$;

create or replace function public.admin_set_application_status(p_id uuid, p_status public.application_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_app    public.partner_applications;
  v_target uuid;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.partner_applications
     set status = p_status, admin_note = left(p_note, 1000), reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_id returning * into v_app;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if p_status = 'approved' then
    select u.id into v_target from auth.users u
     where lower(u.email) = lower(v_app.email) and u.email_confirmed_at is not null limit 1;
    if v_target is not null then
      update public.profiles set role = 'owner', owner_kinds = public.partner_type_kinds(v_app.partner_type)
       where id = v_target and role = 'user';
    end if;
  end if;
  perform public.audit('application_' || p_status::text, 'partner_application', p_id::text, '{}'::jsonb);
end $$;

-- ---------- dashboard numbers (one round trip, index-friendly ranges) ---------------------------------------------
create or replace function public.console_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'roleCounts', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select case when role = 'super_admin' then 'super_admin'
                    else case owner_kinds[1] when 'hotel' then 'hotels_owner' when 'excursion' then 'trips_owner'
                                             when 'transfer' then 'transfers_owner' else 'restaurants_owner' end end as k, count(*) c
          from public.profiles where role <> 'user' group by 1) r),
    'revenue', (select coalesce(jsonb_object_agg(kind, s), '{}'::jsonb) from (
        select kind, sum(total) s from public.bookings
         where status = 'completed' and created_at >= now() - interval '365 days' group by kind) x),
    'revenueByType', (select coalesce(jsonb_object_agg(kind, s), '{}'::jsonb) from (
        select kind, sum(total) s from public.bookings
         where status = 'completed' and created_at >= now() - interval '30 days' group by kind) x),
    'bookings', (select count(*) from public.bookings where status <> 'pending_payment'),
    'last30',   (select count(*) from public.bookings where status <> 'pending_payment' and created_at >= now() - interval '30 days'),
    'series', (select jsonb_agg(jsonb_build_object('d', to_char(d.day, 'YYYY-MM-DD'), 'rev', coalesce(b.rev, 0), 'n', coalesce(b.n, 0)) order by d.day)
                 from generate_series(((now() at time zone 'Africa/Cairo')::date - 29), (now() at time zone 'Africa/Cairo')::date, interval '1 day') as d(day)
                 left join (select (created_at at time zone 'Africa/Cairo')::date as day,
                                   sum(total) filter (where status = 'completed') as rev, count(*) filter (where status = 'completed') as n
                              from public.bookings
                             where created_at >= now() - interval '31 days' and status <> 'pending_payment' group by 1) b
                   on b.day = d.day::date),
    'byStatus', (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb) from (
        select status, count(*) c from public.bookings
         where status <> 'pending_payment' and created_at >= now() - interval '90 days' group by status) x),
    'needsRefund', (select count(*) from public.bookings where needs_refund),
    'payoutsOpen', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from public.payouts where status = 'requested'),
    'applications', (select count(*) from public.partner_applications where status = 'pending'),
    'messages', (select count(*) from public.contact_messages where status = 'new'),
    'items', (select coalesce(jsonb_object_agg(kind, c), '{}'::jsonb) from (
        select kind, count(*) c from public.properties where status <> 'archived' group by kind) x)
  );
end $$;

-- ---------- maintenance ------------------------------------------------------------------------------------------------
create or replace function public.admin_purge_pending()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.bookings where status = 'pending_payment' and created_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  perform public.audit('purge_pending', 'booking', null, jsonb_build_object('removed', n));
  return n;
end $$;

create or replace function public.admin_reindex_booking_owners()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.bookings b set owner_id = p.owner_id
    from public.properties p where p.id = b.property_id and b.owner_id is distinct from p.owner_id;
  get diagnostics n = row_count;
  perform public.audit('reindex_owners', 'booking', null, jsonb_build_object('updated', n));
  return n;
end $$;

-- per-owner balances in one pass (the accounting report)
create or replace function public.admin_owner_balances()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'uid', p.id, 'earned', coalesce(e.earned, 0), 'commission', coalesce(e.comm, 0), 'adjustments', coalesce(a.adj, 0),
      'paid', coalesce(y.paid, 0), 'pending', coalesce(y.open, 0),
      'available', coalesce(e.earned, 0) + coalesce(a.adj, 0) - coalesce(y.paid, 0) - coalesce(y.open, 0)))
    from public.profiles p
    left join (select owner_id, sum(owner_amount) earned, sum(commission_amount) comm from public.bookings
                where earned_at is not null and not earning_void group by owner_id) e on e.owner_id = p.id
    left join (select owner_id, sum(amount) adj from public.adjustments group by owner_id) a on a.owner_id = p.id
    left join (select owner_id, sum(amount) filter (where status = 'paid') paid, sum(amount) filter (where status = 'requested') open
                 from public.payouts group by owner_id) y on y.owner_id = p.id
    where p.role = 'owner'
  ), '[]'::jsonb);
end $$;

-- ---------- privileges for everything new in this part ------------------------------------------------------------
alter table public.adjustments enable row level security;
create policy adjustments_select on public.adjustments for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_super_admin()));
grant select on public.adjustments to authenticated;

-- every signed-in user may read the (non-secret) commission rates; writes only through admin_update_settings()
create policy settings_read on public.platform_settings for select to authenticated using (true);

-- an owner edits their payout account, but never the lock timer
revoke insert, update on public.payout_accounts from authenticated;
grant insert (owner_id, method, details) on public.payout_accounts to authenticated;
grant update (method, details) on public.payout_accounts to authenticated;

grant update (status) on public.contact_messages to authenticated;
create policy applications_delete on public.partner_applications for delete to authenticated using ((select public.is_super_admin()));
grant delete on public.partner_applications to authenticated;

grant execute on function public.admin_set_booking_status(text, public.booking_status, text)  to authenticated;
grant execute on function public.admin_delete_booking(text)                                   to authenticated;
grant execute on function public.admin_list_bookings(text, text, uuid, integer, timestamptz)  to authenticated;
grant execute on function public.cancel_payout(uuid)                                          to authenticated;
grant execute on function public.admin_record_payout(uuid, numeric, text, text, text)         to authenticated;
grant execute on function public.admin_add_adjustment(uuid, numeric, text)                    to authenticated;
grant execute on function public.admin_update_settings(numeric, numeric, numeric, numeric)    to authenticated;
grant execute on function public.owner_archive_property(text)                                 to authenticated;
grant execute on function public.admin_update_owner(uuid, text, text, text, numeric, boolean) to authenticated;
grant execute on function public.admin_list_applications()                                    to authenticated;
grant execute on function public.admin_get_application(uuid)                                  to authenticated;
grant execute on function public.admin_set_application_status(uuid, public.application_status, text) to authenticated;
grant execute on function public.console_stats()                                              to authenticated;
grant execute on function public.admin_purge_pending()                                        to authenticated;
grant execute on function public.admin_reindex_booking_owners()                               to authenticated;
grant execute on function public.admin_owner_balances()                                   to authenticated;
