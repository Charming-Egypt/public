-- Owner-collects-balance model (2026-11-11)
--  * The platform collects ONLY the deposit (50% of the pre-tax price) or the full price online. Taxes and the Kashier gateway fee are charged
--    on top of that collected amount only. The remainder of a deposit booking is paid by the guest directly to the hotel / trip / transfer provider.
--  * Commission = rate x the full pre-tax price, fixed when the booking is created and deducted from what the platform holds:
--        platform pays the owner   owner_amount = collected_base - commission
--        owner collects on site    remaining_amount
--    (so the owner's total = pre-tax price - commission). The owner never sees the commission itself, only these two figures.
--  * No online balance payment any more: reminders / auto-cancel / auto-charge only apply to old ('legacy') bookings.
-- Run after 20261110000200_deposit_rules.sql.

alter table public.platform_settings
  add column if not exists gateway_fee_rate  numeric(5,4) not null default 0.0275 check (gateway_fee_rate >= 0 and gateway_fee_rate < 0.2),   -- Kashier cards: 2.75%
  add column if not exists gateway_fixed_fee numeric(8,2) not null default 3 check (gateway_fixed_fee >= 0),                                      -- + EGP 3 per transaction
  add column if not exists gateway_fee_vat   numeric(5,4) not null default 0.14 check (gateway_fee_vat >= 0 and gateway_fee_vat < 1);               -- + 14% VAT on the fee only
alter table public.bookings
  add column if not exists gateway_fee   numeric(12,2) not null default 0 check (gateway_fee >= 0),
  add column if not exists pricing_model text not null default 'legacy' check (pricing_model in ('legacy', 'v2'));

-- a deposit is fine for any date now (nothing has to be collected online later)
drop trigger if exists bookings_deposit_date on public.bookings;

-- the old balance deadline / reminders / auto-cancel only ever touch legacy bookings
create or replace function public.set_balance_due_at() returns trigger language plpgsql set search_path = '' as $$
declare v_day date := coalesce(new.check_in, new.service_date); v_h int;
begin
  if new.pricing_model = 'legacy' and new.payment_plan = 'deposit' and new.status = 'completed' and new.remaining_amount > 0 and new.balance_due_at is null and v_day is not null then
    select balance_due_hours into v_h from public.platform_settings where id = 1;
    new.balance_due_at := greatest(((v_day::timestamp) at time zone 'Africa/Cairo') - make_interval(hours => coalesce(v_h, 24)), now() + interval '24 hours');
  end if;
  return new;
end $$;

-- public prices the app needs to show the guest the exact amount (same numbers the server checks)
create or replace function public.public_pricing() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('gatewayFeeRate', gateway_fee_rate, 'gatewayFixedFee', gateway_fixed_fee, 'gatewayFeeVat', gateway_fee_vat, 'taxHotel', 0.10, 'taxOther', 0.05, 'depositRatio', 0.5)
    from public.platform_settings where id = 1
$$;
grant execute on function public.public_pricing() to anon, authenticated;

create or replace function public.compute_booking_price(p jsonb, item jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_type       text := p->>'type';
  v_today      date := (now() at time zone 'Africa/Cairo')::date;
  v_rate       numeric;
  v_subtotal   numeric;
  v_taxes      numeric;
  v_total      numeric;
  v_deposit    numeric;
  v_plan       text := case when p->>'paymentPlan' = 'deposit' then 'deposit' else 'full' end;
  v_f          numeric;
  v_fx         numeric;
  v_vat        numeric;
  v_coll       numeric;
  v_pay        numeric;
  v_fee        numeric;
  v_onsite     numeric;
  v_nights     integer;
  v_in         date;
  v_out        date;
  v_day        date;
  v_adults     integer;
  v_children   integer;
  v_rooms      integer;
  v_list       jsonb;
  v_room       jsonb;
  v_idx        integer := -1;
  v_want       text[];
  v_base       numeric;
  v_extra_ad   numeric;
  v_extra_n    numeric;
  v_free       integer;
  v_child_pn   numeric := 0;
  v_blocked    jsonb;
begin
  if v_type not in ('hotel', 'excursion', 'transfer', 'package') then
    raise exception 'Unknown booking type' using errcode = '22023';
  end if;
  v_rate := case v_type when 'hotel' then 0.10 else 0.05 end;

  if v_type = 'hotel' then
    if coalesce(p->>'checkin', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p->>'checkout', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Invalid dates' using errcode = '22023';
    end if;
    begin
      v_in := (p->>'checkin')::date;
      v_out := (p->>'checkout')::date;
    exception when others then
      raise exception 'Invalid dates' using errcode = '22023';
    end;
    if v_in < v_today then raise exception 'Check-in date is in the past' using errcode = '22023'; end if;
    if v_out <= v_in then raise exception 'Check-out must be after check-in' using errcode = '22023'; end if;
    v_nights := greatest(1, v_out - v_in);
    if v_nights > 60 then raise exception 'Stay too long' using errcode = '22023'; end if;

    v_adults   := public._req_int(p->>'adults', 1, 10, 'adults');
    v_children := public._req_int(coalesce(p->>'children', '0'), 0, 6, 'children');
    v_rooms    := public._req_int(p->>'rooms', 1, 5, 'rooms');

    v_list := case when jsonb_typeof(item->'rooms') = 'array' then item->'rooms' else '[]'::jsonb end;
    if jsonb_typeof(p->'roomIndex') = 'number' and (p->>'roomIndex') ~ '^[0-9]+$' then
      v_idx := (p->>'roomIndex')::integer;
    else
      v_want := case when jsonb_typeof(p->'roomType') = 'object'
                     then array(select value from jsonb_each_text(p->'roomType'))
                     else array[p->>'roomType'] end;
      select (t.ord - 1)::integer into v_idx
        from jsonb_array_elements(v_list) with ordinality as t(r, ord)
       where exists (
               select 1 from jsonb_each_text(case when jsonb_typeof(t.r->'type') = 'object' then t.r->'type' else '{}'::jsonb end) e
                where e.value = any (v_want)
             )
          or (jsonb_typeof(t.r->'type') = 'string' and (t.r->>'type') = any (v_want))
       order by t.ord
       limit 1;
      v_idx := coalesce(v_idx, -1);
    end if;
    v_room := case when v_idx >= 0 then v_list->v_idx end;
    if v_room is null or jsonb_typeof(v_room->'price') <> 'number' then
      raise exception 'Room not found' using errcode = '22023';
    end if;

    v_blocked := case when jsonb_typeof(item->'unavailableDates') = 'array' then item->'unavailableDates' else '[]'::jsonb end;
    for i in 0 .. v_nights - 1 loop
      v_day := v_in + i;
      if v_blocked ? to_char(v_day, 'YYYY-MM-DD') then
        raise exception 'Selected dates are not available' using errcode = 'P0001', detail = 'unavailable';
      end if;
    end loop;

    v_base     := coalesce(nullif(v_room->>'baseOccupancy', '')::numeric, 0);
    if v_base = 0 then v_base := 2; end if;
    v_extra_ad := coalesce(nullif(v_room->>'extraAdultFee', '')::numeric, 0);
    v_extra_n  := greatest(0, ceil(v_adults::numeric / v_rooms) - v_base);
    v_free     := greatest(0, coalesce(nullif(v_room->>'freeChildrenPerRoom', '')::integer, 2) * v_rooms);

    -- children beyond the free slots pay, cheapest fees are the free ones
    select coalesce(sum(f.fee), 0) into v_child_pn
      from (
        select public._child_fee(v_room, a.age) as fee
          from (
            select (x.value)::numeric as age
              from jsonb_array_elements_text(case when jsonb_typeof(p->'childAges') = 'array' then p->'childAges' else '[]'::jsonb end) with ordinality as x(value, ord)
             where x.value ~ '^[0-9]+(\.[0-9]+)?$' and x.ord <= 6
          ) a
         order by 1
         offset v_free
      ) f;

    v_subtotal := ((v_room->>'price')::numeric + v_extra_n * v_extra_ad) * v_rooms * v_nights + v_child_pn * v_nights;
  else
    if jsonb_typeof(item->'price') <> 'number' then raise exception 'Item has no price' using errcode = 'P0001'; end if;
    if coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid or past date' using errcode = '22023'; end if;
    begin
      v_in := (p->>'date')::date;
    exception when others then
      raise exception 'Invalid or past date' using errcode = '22023';
    end;
    if v_in < v_today then raise exception 'Invalid or past date' using errcode = '22023'; end if;
    if v_type = 'package' and coalesce(item->>'priceMode', 'person') = 'package' then
      -- one price for the whole package (e.g. the honeymoon suite for the couple): head count is validated but does not change the price
      perform public._req_int(p->>'participants', 1, 50, 'participants');
      v_subtotal := (item->>'price')::numeric;
    elsif v_type in ('excursion', 'package') then
      v_subtotal := (item->>'price')::numeric * public._req_int(p->>'participants', 1, 50, 'participants');
    else
      perform public._req_int(p->>'passengers', 1, 50, 'passengers');
      v_subtotal := (item->>'price')::numeric;
    end if;
  end if;

  -- Owner-collects-balance model: the platform only collects the deposit (or everything) online. Taxes and the gateway fee are
  -- charged on top of THAT amount only; the rest (v_onsite) is paid to the service provider at the venue.
  select gateway_fee_rate, gateway_fixed_fee, gateway_fee_vat into v_f, v_fx, v_vat from public.platform_settings where id = 1;
  v_f := coalesce(v_f, 0); v_fx := coalesce(v_fx, 0); v_vat := coalesce(v_vat, 0);
  v_coll    := case when v_plan = 'deposit' then round(v_subtotal * 0.5) else v_subtotal end;
  v_onsite  := v_subtotal - v_coll;
  v_taxes   := round(v_coll * v_rate);
  -- Kashier takes (rate x charged + fixed) plus VAT on that fee; gross the charge up so we net base + tax exactly
  v_pay     := round((v_coll + v_taxes + v_fx * (1 + v_vat)) / (1 - v_f * (1 + v_vat)));
  v_fee     := v_pay - v_coll - v_taxes;
  return jsonb_build_object(
    'subtotal', v_subtotal, 'taxes', v_taxes, 'fee', v_fee, 'collected', v_coll, 'due', v_pay,
    'remaining', v_onsite, 'total', v_pay + v_onsite,
    'deposit', case when v_plan = 'deposit' then v_pay else 0 end, 'nights', v_nights
  );
end $$;

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

  -- everything the client sent, minus server-owned fields and anything that looks like card data
  v_data := (p - array['ownerUid','ownerStatus','ownerNote','adminNote','needsRefund','cancelledBy','cancelReason','cancelledAt',
                       'uid','status','createdAt','expiresAt','card','cardNumber','cvv','cvc','expiry'])
            || jsonb_build_object('paymentPlan', v_plan);
  if jsonb_typeof(v_data->'payment') = 'object' then v_data := v_data - 'payment'; end if;

  insert into public.bookings (
    id, user_id, property_id, owner_id, kind, status, payment_plan, currency,
    subtotal, taxes, gateway_fee, total, deposit_amount, remaining_amount, amount_due_now,
    pricing_model, commission_rate, commission_amount, owner_amount,
    check_in, check_out, service_date, nights,
    guest_name, guest_email, guest_phone, data, expires_at
  ) values (
    p->>'id', v_uid, v_prop.id, v_prop.owner_id, v_type::public.property_kind, 'pending_payment', v_plan, 'EGP',
    (v_price->>'subtotal')::numeric, (v_price->>'taxes')::numeric, (v_price->>'fee')::numeric, (v_price->>'total')::numeric,
    (v_price->>'deposit')::numeric, (v_price->>'remaining')::numeric, (v_price->>'due')::numeric,
    'v2', v_rate, v_comm, (v_price->>'collected')::numeric - v_comm,
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

create or replace function public.finalize_booking_payment(p_id text, p_gateway_status text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_b     public.bookings;
  v_s     text := upper(coalesce(p_gateway_status, ''));
  v_extra jsonb := coalesce(p_extra, '{}'::jsonb) - array['status', 'uid', 'ownerUid', 'total', 'subtotal', 'currency'];
  v_data  jsonb;
begin
  select * into v_b from public.bookings where id = p_id for update;
  if not found then return null; end if;

  if v_s in ('SUCCESS', 'PAID', 'CAPTURED') then
    if v_b.status <> 'pending_payment' then
      return jsonb_build_object('status', v_b.status, 'created', false);       -- already finalized: never twice
    end if;

    -- the confirming charge only ever covers amount_due_now (deposit, or the full total)
    v_data := (v_b.data - array['lastPaymentStatus', 'paymentFlag'])
              || jsonb_build_object('paidAmount', v_b.amount_due_now, 'paidAt', now(), 'checkoutAt', v_b.created_at)
              || case when v_b.payment_plan = 'deposit' and v_b.remaining_amount > 0
                      then jsonb_build_object('balanceAmount', v_b.remaining_amount,
                                              'balanceStatus', case when v_b.pricing_model = 'v2' then 'onsite' else 'due' end)   -- v2: paid to the provider at the venue
                      else jsonb_build_object('balanceStatus', 'paid') end
              || v_extra;

    update public.bookings
       set status = 'completed', confirmed_at = now(), created_at = now(), expires_at = null,
           data = v_data
     where id = p_id;

    if v_b.user_id is not null then
      update public.profiles
         set completed_bookings = completed_bookings + 1,
             total_spent = total_spent + case when v_b.pricing_model = 'v2' then v_b.amount_due_now else v_b.total end,
             loyalty_tier = public.loyalty_tier_for(completed_bookings + 1)
       where id = v_b.user_id;
      insert into public.notifications (user_id, icon, title, msg)
      values (v_b.user_id, 'fa-circle-check', 'Booking confirmed', 'Your booking ' || v_b.id || ' is confirmed.');
    end if;
    if v_b.owner_id is not null then
      insert into public.notifications (user_id, icon, title, msg)
      values (v_b.owner_id, 'fa-calendar-plus', 'New booking', 'New booking ' || v_b.id || ' on one of your listings.');
    end if;
    return jsonb_build_object('status', 'completed', 'created', true);
  end if;

  if v_s in ('FAILED', 'FAILURE', 'DECLINED') then
    if v_b.status = 'pending_payment' then
      -- the checkout session stays open so the guest can retry with another card
      update public.bookings set data = data || '{"lastPaymentStatus":"failed"}'::jsonb where id = p_id;
      return jsonb_build_object('status', 'failed', 'created', false);
    end if;
    return jsonb_build_object('status', v_b.status, 'created', false);
  end if;

  return jsonb_build_object('status', v_b.status, 'created', false);          -- still pending at the gateway
end $$;

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
    -- the remaining balance of a deposit booking is collected ONLINE by the platform before the service: no execution / earnings until it is paid
    if v_b.pricing_model = 'legacy' and v_b.payment_plan = 'deposit' and v_b.remaining_amount > 0 and coalesce(v_b.data->>'balanceStatus', '') <> 'paid' and not v_admin then
      raise exception 'The remaining balance has not been paid yet' using errcode = 'P0001', detail = 'balance_due';
    end if;
    if v_b.pricing_model = 'v2' then
      -- commission and the owner's share were fixed when the booking was made: just recognise the earning
      update public.bookings
         set owner_status = 'done', owner_note = left(coalesce(p_note, owner_note), 1000), earned_at = now()
       where id = p_id returning * into v_b;
      return public.booking_to_json(v_b);
    end if;
    select commission_rate into v_rate from public.profiles where id = v_b.owner_id;
    if v_rate is null then
      select case v_b.kind when 'hotel' then commission_hotel when 'excursion' then commission_excursion
                           when 'transfer' then commission_transfer when 'package' then commission_package else default_commission_rate end
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

-- booking JSON: commission and the platform's cut are visible to the super admin ONLY. The booking's owner sees ownerShare
-- (what is theirs in total, what they collect on site, what the platform pays them); the guest sees neither.
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
    'commissionRate', case when (select public.is_super_admin()) and b.commission_rate is not null then round(b.commission_rate * 100, 2) end,
    'earning', case when b.earned_at is not null then
        case when (select public.is_super_admin()) then jsonb_build_object('gross', b.subtotal, 'rate', round(coalesce(b.commission_rate, 0) * 100, 2),
               'commission', b.commission_amount, 'net', b.owner_amount, 'void', b.earning_void, 'at', b.earned_at)
             else jsonb_build_object('net', b.owner_amount, 'void', b.earning_void, 'at', b.earned_at) end end
  ))
$$;

-- the platform's commission total is for the super admin only
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
  return jsonb_build_object('earned', v_earned, 'commission', case when (select public.is_super_admin()) then v_comm end, 'adjustments', v_adj,
                            'paid', v_paid, 'pending', v_open, 'available', v_earned + v_adj - v_paid - v_open);
end $$;

-- Kashier's fee: percent (e.g. 2.75), fixed EGP per transaction (3) and the VAT % charged on the fee only (14). Charged to the guest on top of
-- what is collected online. Changing it only affects NEW bookings.
create or replace function public.admin_set_gateway_fee(p_percent numeric, p_fixed numeric default 3, p_vat numeric default 14)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_percent is null or p_percent < 0 or p_percent > 15 or coalesce(p_fixed, 0) < 0 or coalesce(p_fixed, 0) > 100 or coalesce(p_vat, 0) < 0 or coalesce(p_vat, 0) > 50 then
    raise exception 'Invalid values' using errcode = '22023';
  end if;
  update public.platform_settings set gateway_fee_rate = round(p_percent / 100, 4), gateway_fixed_fee = coalesce(p_fixed, 0),
         gateway_fee_vat = round(coalesce(p_vat, 0) / 100, 4), updated_at = now() where id = 1;
  perform public.audit('settings', 'platform', '1', jsonb_build_object('gateway_fee_percent', p_percent, 'fixed', p_fixed, 'vat_percent', p_vat));
end $$;
grant execute on function public.admin_set_gateway_fee(numeric, numeric, numeric) to authenticated;
