-- Packages as their own kind — STEP 2 of 2 (run after 20261106000100_package_kind_enum.sql).
-- Adds: commission rate for packages, the packages_owner role, the 'package' booking type, and a per-package price mode.
--
-- Package item JSON (data):  price (EGP), priceMode = 'person' (default: price x participants) | 'package' (one price for the whole package),
--                            groupSize (people the package covers; shown to guests, used as the head count when priceMode = 'package'),
--                            packageType = honeymoon | friends | family | adventure, days.

alter table public.platform_settings
  add column if not exists commission_package numeric(5,4) not null default 0.1000 check (commission_package between 0 and 1);

alter table public.bookings drop constraint if exists bookings_kind_check;
alter table public.bookings add constraint bookings_kind_check check (kind in ('hotel', 'excursion', 'transfer', 'package'));

-- roles <-> kinds
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
    when 'package'       then array['package']::public.property_kind[]
    when 'packages'      then array['package']::public.property_kind[]
    when 'honeymoon'     then array['package']::public.property_kind[]
    when 'restaurant'    then array['restaurant']::public.property_kind[]
    when 'restaurants'   then array['restaurant']::public.property_kind[]
    else '{}'::public.property_kind[]
  end
$$;

create or replace function public.console_role_kinds(p_role text)
returns public.property_kind[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'hotels_owner'      then array['hotel']::public.property_kind[]
    when 'trips_owner'       then array['excursion']::public.property_kind[]
    when 'packages_owner'    then array['package']::public.property_kind[]
    when 'transfers_owner'   then array['transfer']::public.property_kind[]
    when 'restaurants_owner' then array['restaurant']::public.property_kind[]
    else null
  end
$$;

-- price check + booking creation (adds the 'package' type; excursions behave exactly as before)
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

  v_taxes   := round(v_subtotal * v_rate);
  v_total   := v_subtotal + v_taxes;
  v_deposit := round(v_total * 0.5);
  return jsonb_build_object(
    'subtotal', v_subtotal, 'taxes', v_taxes, 'total', v_total,
    'deposit', v_deposit, 'remaining', v_total - v_deposit, 'nights', v_nights
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

  -- everything the client sent, minus server-owned fields and anything that looks like card data
  v_data := (p - array['ownerUid','ownerStatus','ownerNote','adminNote','needsRefund','cancelledBy','cancelReason','cancelledAt',
                       'uid','status','createdAt','expiresAt','card','cardNumber','cvv','cvc','expiry'])
            || jsonb_build_object('paymentPlan', v_plan);
  if jsonb_typeof(v_data->'payment') = 'object' then v_data := v_data - 'payment'; end if;

  insert into public.bookings (
    id, user_id, property_id, owner_id, kind, status, payment_plan, currency,
    subtotal, taxes, total, deposit_amount, remaining_amount, amount_due_now,
    check_in, check_out, service_date, nights,
    guest_name, guest_email, guest_phone, data, expires_at
  ) values (
    p->>'id', v_uid, v_prop.id, v_prop.owner_id, v_type::public.property_kind, 'pending_payment', v_plan, 'EGP',
    (v_price->>'subtotal')::numeric, (v_price->>'taxes')::numeric, (v_price->>'total')::numeric,
    (v_price->>'deposit')::numeric, (v_price->>'remaining')::numeric,
    case when v_plan = 'deposit' then (v_price->>'deposit')::numeric else (v_price->>'total')::numeric end,
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

-- commission is read (and frozen on the booking) when the owner marks the service done
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

-- dashboard role counts
create or replace function public.console_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'roleCounts', (select coalesce(jsonb_object_agg(k, c), '{}'::jsonb) from (
        select case when role = 'super_admin' then 'super_admin'
                    else case owner_kinds[1] when 'hotel' then 'hotels_owner' when 'excursion' then 'trips_owner'
                                             when 'package' then 'packages_owner' when 'transfer' then 'transfers_owner' else 'restaurants_owner' end end as k, count(*) c
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

-- commission settings: a fifth value for packages (old 4-argument version dropped so the RPC name stays unambiguous)
drop function if exists public.admin_update_settings(numeric, numeric, numeric, numeric);
create or replace function public.admin_update_settings(p_hotel numeric, p_excursion numeric, p_transfer numeric, p_min_payout numeric, p_package numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pkg numeric;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select coalesce(p_package, commission_package * 100) into v_pkg from public.platform_settings where id = 1;
  if least(p_hotel, p_excursion, p_transfer, v_pkg) < 0 or greatest(p_hotel, p_excursion, p_transfer, v_pkg) > 100 or p_min_payout < 0 then
    raise exception 'Invalid values' using errcode = '22023';
  end if;
  update public.platform_settings
     set commission_hotel = p_hotel / 100, commission_excursion = p_excursion / 100, commission_transfer = p_transfer / 100,
         commission_package = v_pkg / 100, min_payout = p_min_payout, updated_at = now()
   where id = 1;
  perform public.audit('settings', 'platform', '1', jsonb_build_object('hotel', p_hotel, 'excursion', p_excursion, 'transfer', p_transfer, 'package', v_pkg, 'min_payout', p_min_payout));
end $$;
grant execute on function public.admin_update_settings(numeric, numeric, numeric, numeric, numeric) to authenticated;
