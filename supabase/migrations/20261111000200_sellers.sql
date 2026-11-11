-- Sellers (2026-11-11)
--  * A seller is a normal login with is_seller = true and a referral code. He gets his own dashboard (owner site -> /seller.html).
--  * When a booking is made from the seller's own account, or through his referral link (?ref=CODE), the seller earns a slice of the PLATFORM's
--    commission on that booking (default 2% of the pre-tax price, per-seller override in profiles.commission_rate, always capped at the
--    whole commission). Example: commission 5% -> platform 3% + seller 2%;  commission 10% -> platform 8% + seller 2%.
--    Nothing changes for the owner or the guest. The seller's earning is recognised (and voided on cancel / refund) together with the owner's.
--  * Sellers use the existing payout account / payout request / admin payout screens.
-- Run after 20261111000100_owner_collects_balance.sql.

alter table public.platform_settings
  add column if not exists seller_commission_rate numeric(5,4) not null default 0.02 check (seller_commission_rate >= 0 and seller_commission_rate <= 1);
alter table public.profiles
  add column if not exists is_seller   boolean not null default false,
  add column if not exists seller_code text check (seller_code is null or seller_code ~ '^[A-Z0-9]{4,12}$');
create unique index if not exists profiles_seller_code_key on public.profiles (seller_code) where seller_code is not null;
alter table public.bookings
  add column if not exists seller_id     uuid references public.profiles (id) on delete set null,
  add column if not exists seller_rate   numeric(5,4),
  add column if not exists seller_amount numeric(12,2) not null default 0 check (seller_amount >= 0);
create index if not exists bookings_seller_idx on public.bookings (seller_id) where seller_id is not null;

create or replace function public.is_seller()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_seller and p.is_active from public.profiles p where p.id = (select auth.uid())), false)
$$;

create or replace function public.gen_seller_code() returns text language plpgsql volatile set search_path = '' as $$
declare c text;
begin
  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 7));
    exit when not exists (select 1 from public.profiles where seller_code = c);
  end loop;
  return c;
end $$;

-- sellers may keep a payout account like owners do
drop policy if exists payout_accounts_insert on public.payout_accounts;
drop policy if exists payout_accounts_update on public.payout_accounts;
create policy payout_accounts_insert on public.payout_accounts for insert to authenticated
  with check (owner_id = (select auth.uid()) and ((select public.is_owner()) or (select public.is_seller())));
create policy payout_accounts_update on public.payout_accounts for update to authenticated
  using (owner_id = (select auth.uid()) and ((select public.is_owner()) or (select public.is_seller())))
  with check (owner_id = (select auth.uid()) and ((select public.is_owner()) or (select public.is_seller())));

-- the seller's own bookings: only what he needs (no guest contact details, no owner / commission figures)
create or replace function public.seller_bookings(p_seller uuid default null, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_s uuid := coalesce(p_seller, (select auth.uid()));
begin
  if v_s is distinct from (select auth.uid()) and not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'type', b.kind, 'status', b.status, 'createdAt', b.created_at, 'serviceDate', coalesce(b.check_in, b.service_date),
      'customer', split_part(coalesce(b.guest_name, ''), ' ', 1),
      'item', coalesce(b.data->'hotelName'->>'en', b.data->'hotelName'->>'ar', b.data->>'hotelName', b.data->'title'->>'en', b.data->'title'->>'ar', b.data->>'title', b.data->>'vehicleType', ''),
      'subtotal', b.subtotal, 'rate', round(coalesce(b.seller_rate, 0) * 100, 2), 'amount', b.seller_amount, 'currency', b.currency,
      'earnedAt', b.earned_at, 'void', b.earning_void, 'viaOwnAccount', b.user_id = v_s) order by b.created_at desc)
    from (select * from public.bookings where seller_id = v_s and status <> 'pending_payment' and status <> 'failed'
           order by created_at desc limit least(greatest(p_limit, 1), 2000)) b
  ), '[]'::jsonb);
end $$;
grant execute on function public.seller_bookings(uuid, integer) to authenticated;

-- the platform-wide default seller share (percent), set by the super admin
create or replace function public.admin_set_seller_rate(p_percent numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_percent is null or p_percent < 0 or p_percent > 100 then raise exception 'Invalid values' using errcode = '22023'; end if;
  update public.platform_settings set seller_commission_rate = round(p_percent / 100, 4), updated_at = now() where id = 1;
  perform public.audit('settings', 'platform', '1', jsonb_build_object('seller_percent', p_percent));
end $$;
grant execute on function public.admin_set_seller_rate(numeric) to authenticated;

create or replace function public.admin_remove_seller(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.profiles set is_seller = false where id = p_user;      -- the code and old earnings stay on record
  perform public.audit('seller_removed', 'profile', p_user::text, '{}'::jsonb);
end $$;
grant execute on function public.admin_remove_seller(uuid) to authenticated;

create or replace function public.create_booking(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_type    text := p->>'type';
  v_item_id text;
  v_prop    public.properties;
  v_price   jsonb;
  v_prof    public.profiles;
  v_plan    text;
  v_data    jsonb;
  v_row     public.bookings;
  v_rate    numeric;
  v_comm    numeric;
  v_seller  uuid;
  v_srate   numeric;
  v_samt    numeric := 0;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'booking object required' using errcode = '22023'; end if;
  if coalesce(p->>'id', '') !~ '^[A-Za-z0-9_-]{3,64}$' then raise exception 'Invalid booking id' using errcode = '22023'; end if;
  if v_type not in ('hotel', 'excursion', 'transfer', 'package') then raise exception 'Unknown booking type' using errcode = '22023'; end if;
  if coalesce(p->>'currency', '') <> 'EGP' then raise exception 'Only EGP is supported' using errcode = '22023'; end if;

  v_item_id := p->>(case v_type when 'hotel' then 'hotelId' when 'excursion' then 'excursionId' when 'package' then 'packageId' else 'transferId' end);
  if v_item_id is null or v_item_id = '' then raise exception 'Missing item id' using errcode = '22023'; end if;

  select * into v_prop from public.properties
   where id = v_item_id and kind = v_type::public.property_kind and status = 'published';
  if not found then raise exception 'Item not found' using errcode = 'P0002'; end if;

  v_price := public.compute_booking_price(p, v_prop.data);
  if coalesce(p->>'total', '') !~ '^[0-9]+(\.[0-9]+)?$' or (p->>'total')::numeric <> (v_price->>'total')::numeric then
    raise exception 'price_changed' using errcode = 'P0001', detail = 'price_changed', hint = v_price->>'total';
  end if;

  if exists (select 1 from public.bookings where id = p->>'id') then
    raise exception 'Booking id already exists' using errcode = '23505';
  end if;

  v_plan := case when p->>'paymentPlan' = 'deposit' then 'deposit' else 'full' end;
  select * into v_prof from public.profiles where id = v_uid;

  -- the platform's commission is fixed NOW on the full pre-tax price; it comes out of what we collect, never off the on-site part
  select commission_rate into v_rate from public.profiles where id = v_prop.owner_id;
  if v_rate is null then
    select case v_type when 'hotel' then commission_hotel when 'excursion' then commission_excursion
                       when 'transfer' then commission_transfer when 'package' then commission_package else default_commission_rate end
      into v_rate from public.platform_settings where id = 1;
  end if;
  v_comm := round((v_price->>'subtotal')::numeric * coalesce(v_rate, 0), 2);

  -- Seller share: if the booking is made from a seller's own account, or through a seller's referral code, the seller gets a slice of the
  -- platform's commission (never more than the whole commission). It does not change what the owner or the guest pay or receive.
  select id into v_seller from public.profiles where id = v_uid and is_seller and is_active;
  if v_seller is null and nullif(btrim(coalesce(p->>'ref', '')), '') is not null then
    select id into v_seller from public.profiles where is_seller and is_active and id <> v_uid and upper(seller_code) = upper(btrim(p->>'ref'));
  end if;
  if v_seller is not null and lower(btrim(coalesce(p->>'email', ''))) = (select lower(coalesce(email, '')) from public.profiles where id = v_seller) then
    v_seller := null;                                   -- no commission on a seller's own booking
  end if;
  if v_seller is not null then
    select coalesce(pr.commission_rate, st.seller_commission_rate) into v_srate from public.profiles pr, public.platform_settings st where pr.id = v_seller and st.id = 1;
    v_srate := least(coalesce(v_srate, 0), coalesce(v_rate, 0));
    v_samt  := round((v_price->>'subtotal')::numeric * v_srate, 2);
  end if;

  -- everything the client sent, minus server-owned fields and anything that looks like card data
  v_data := (p - array['ownerUid','ownerStatus','ownerNote','adminNote','needsRefund','cancelledBy','cancelReason','ref','cancelledAt',
                       'uid','status','createdAt','expiresAt','card','cardNumber','cvv','cvc','expiry'])
            || jsonb_build_object('paymentPlan', v_plan);
  if jsonb_typeof(v_data->'payment') = 'object' then v_data := v_data - 'payment'; end if;

  insert into public.bookings (
    id, user_id, property_id, owner_id, kind, status, payment_plan, currency,
    subtotal, taxes, gateway_fee, total, deposit_amount, remaining_amount, amount_due_now,
    pricing_model, commission_rate, commission_amount, owner_amount, seller_id, seller_rate, seller_amount,
    check_in, check_out, service_date, nights,
    guest_name, guest_email, guest_phone, data, expires_at
  ) values (
    p->>'id', v_uid, v_prop.id, v_prop.owner_id, v_type::public.property_kind, 'pending_payment', v_plan, 'EGP',
    (v_price->>'subtotal')::numeric, (v_price->>'taxes')::numeric, (v_price->>'fee')::numeric, (v_price->>'total')::numeric,
    (v_price->>'deposit')::numeric, (v_price->>'remaining')::numeric, (v_price->>'due')::numeric,
    'v2', v_rate, v_comm, (v_price->>'collected')::numeric - v_comm, v_seller, case when v_seller is not null then v_srate end, v_samt,
    case when v_type = 'hotel' then (p->>'checkin')::date end,
    case when v_type = 'hotel' then (p->>'checkout')::date end,
    case when v_type <> 'hotel' then (p->>'date')::date end,
    nullif(v_price->>'nights', '')::integer,
    left(coalesce(nullif(p->>'name', ''), v_prof.display_name), 120),
    left(coalesce(nullif(p->>'email', ''), v_prof.email), 254),
    left(coalesce(nullif(p->>'phone', ''), v_prof.phone), 30),
    v_data,
    now() + interval '2 hours'
  ) returning * into v_row;

  return jsonb_build_object('success', true, 'booking', public.booking_to_json(v_row));
end $$;

create or replace function public.booking_to_json(b public.bookings)
returns jsonb language sql stable set search_path = '' as $$
  select b.data || jsonb_strip_nulls(jsonb_build_object(
    'id', b.id, 'type', b.kind, 'status', b.status, 'uid', b.user_id, 'ownerUid', b.owner_id,
    'total', b.total, 'subtotal', b.subtotal, 'taxes', b.taxes, 'gatewayFee', case when b.gateway_fee > 0 then b.gateway_fee end,
    'depositAmount', b.deposit_amount, 'remainingAmount', b.remaining_amount, 'amountDueNow', b.amount_due_now,
    'paymentPlan', b.payment_plan, 'currency', b.currency, 'nights', b.nights, 'pricingModel', b.pricing_model,
    'checkin', b.check_in, 'checkout', b.check_out, 'date', b.service_date,
    'reviewed', b.reviewed, 'ownerStatus', b.owner_status, 'ownerNote', b.owner_note, 'adminNote', b.admin_note,
    'needsRefund', case when b.needs_refund then true end,
    'cancelledAt', b.cancelled_at, 'cancelReason', b.cancel_reason, 'balanceDueAt', b.balance_due_at,
    'createdAt', b.created_at, 'expiresAt', b.expires_at,
    'ownerShare', case when b.pricing_model = 'v2' and b.commission_amount is not null and (b.owner_id = (select auth.uid()) or (select public.is_super_admin()))
        then jsonb_build_object('total', b.subtotal - b.commission_amount, 'onSite', b.remaining_amount, 'fromPlatform', b.owner_amount) end,
    'commission', case when (select public.is_super_admin()) and b.commission_amount is not null then b.commission_amount end,
    'sellerAmount', case when (select public.is_super_admin()) and b.seller_id is not null then b.seller_amount end,
    'sellerName', case when (select public.is_super_admin()) and b.seller_id is not null then (select coalesce(display_name, email) from public.profiles where id = b.seller_id) end,
    'platformNet', case when (select public.is_super_admin()) and b.commission_amount is not null then b.commission_amount - b.seller_amount end,
    'commissionRate', case when (select public.is_super_admin()) and b.commission_rate is not null then round(b.commission_rate * 100, 2) end,
    'earning', case when b.earned_at is not null then
        case when (select public.is_super_admin()) then jsonb_build_object('gross', b.subtotal, 'rate', round(coalesce(b.commission_rate, 0) * 100, 2),
               'commission', b.commission_amount, 'net', b.owner_amount, 'void', b.earning_void, 'at', b.earned_at)
             else jsonb_build_object('net', b.owner_amount, 'void', b.earning_void, 'at', b.earned_at) end end
  ))
$$;

create or replace function public.owner_balance(p_owner uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid := coalesce(p_owner, (select auth.uid()));
  v_earned numeric; v_sell numeric; v_comm numeric; v_adj numeric; v_paid numeric; v_open numeric;
begin
  if v_owner is distinct from (select auth.uid()) and not (select public.is_super_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(sum(owner_amount), 0), coalesce(sum(commission_amount), 0) into v_earned, v_comm
    from public.bookings where owner_id = v_owner and earned_at is not null and not earning_void;
  select coalesce(sum(seller_amount), 0) into v_sell                      -- a seller's share of the commission, recognised together with the owner's earning
    from public.bookings where seller_id = v_owner and earned_at is not null and not earning_void;
  v_earned := v_earned + v_sell;
  select coalesce(sum(amount), 0) into v_adj from public.adjustments where owner_id = v_owner;
  select coalesce(sum(amount) filter (where status = 'paid'), 0), coalesce(sum(amount) filter (where status = 'requested'), 0)
    into v_paid, v_open from public.payouts where owner_id = v_owner;
  return jsonb_build_object('earned', v_earned, 'commission', case when (select public.is_super_admin()) then v_comm end, 'sellerEarned', v_sell, 'adjustments', v_adj,
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
  if not ((select public.is_owner()) or (select public.is_seller())) then raise exception 'forbidden' using errcode = '42501'; end if;
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
    left join (select u.uid, sum(u.earned) earned, sum(u.comm) comm from (
                 select owner_id uid, owner_amount earned, commission_amount comm from public.bookings where earned_at is not null and not earning_void and owner_id is not null
                 union all
                 select seller_id, seller_amount, 0 from public.bookings where earned_at is not null and not earning_void and seller_id is not null) u
               group by u.uid) e on e.uid = p.id
    left join (select owner_id, sum(amount) adj from public.adjustments group by owner_id) a on a.owner_id = p.id
    left join (select owner_id, sum(amount) filter (where status = 'paid') paid, sum(amount) filter (where status = 'requested') open
                 from public.payouts group by owner_id) y on y.owner_id = p.id
    where p.role = 'owner' or p.is_seller
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_update_owner(
  p_user uuid, p_name text default null, p_phone text default null, p_role text default null,
  p_commission numeric default null, p_set_commission boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_seller boolean := (p_role = 'seller');
  v_kinds public.property_kind[] := case when p_role = 'seller' then '{}'::public.property_kind[] else public.console_role_kinds(p_role) end;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role is not null and p_role <> '' and v_kinds is null then raise exception 'Unknown role' using errcode = '22023'; end if;
  if p_set_commission and p_commission is not null and (p_commission < 0 or p_commission > 100) then
    raise exception 'Invalid commission' using errcode = '22023';
  end if;
  update public.profiles
     set display_name = coalesce(nullif(left(btrim(p_name), 120), ''), display_name),
         phone = coalesce(nullif(left(btrim(p_phone), 30), ''), phone),
         role = case when v_seller then 'user'::public.user_role when v_kinds is not null then 'owner'::public.user_role else role end,
         owner_kinds = coalesce(v_kinds, owner_kinds),
         is_seller = case when p_role is null or p_role = '' then is_seller else v_seller end,
         seller_code = case when v_seller and seller_code is null then public.gen_seller_code() else seller_code end,
         commission_rate = case when p_set_commission then p_commission / 100 else commission_rate end
   where id = p_user and role <> 'super_admin';
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  perform public.audit('owner_updated', 'profile', p_user::text, jsonb_build_object('role', p_role, 'commission', p_commission));
end $$;
