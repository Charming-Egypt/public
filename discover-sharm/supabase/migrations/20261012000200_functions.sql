-- =====================================================================
-- Part 2/5: helper functions, triggers, and the RPCs the site calls.
--
-- Rules used everywhere below:
--  * SECURITY DEFINER functions pin `search_path = ''` and schema-qualify every name.
--  * Anything that changes money, roles, ownership or publication state goes through
--    an RPC that re-checks who is calling. The browser can not write those columns.
-- =====================================================================

-- ---------- who is calling? (cheap primary-key lookups) --------------------
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'super_admin' and p.is_active
                     from public.profiles p where p.id = (select auth.uid())), false)
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'owner' and p.is_active
                     from public.profiles p where p.id = (select auth.uid())), false)
$$;

create or replace function public.owner_can_manage(k public.property_kind)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = 'owner' and p.is_active and k = any (p.owner_kinds)
                     from public.profiles p where p.id = (select auth.uid())), false)
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.partner_type_kinds(t text)
returns public.property_kind[] language sql immutable set search_path = '' as $$
  select case lower(coalesce(t, ''))
    when 'hotel'       then array['hotel']::public.property_kind[]
    when 'hotels'      then array['hotel']::public.property_kind[]
    when 'trips'       then array['excursion']::public.property_kind[]
    when 'trip'        then array['excursion']::public.property_kind[]
    when 'excursion'   then array['excursion']::public.property_kind[]
    when 'excursions'  then array['excursion']::public.property_kind[]
    when 'tour'        then array['excursion']::public.property_kind[]
    when 'transfer'    then array['transfer']::public.property_kind[]
    when 'transfers'   then array['transfer']::public.property_kind[]
    when 'restaurant'  then array['restaurant']::public.property_kind[]
    when 'restaurants' then array['restaurant']::public.property_kind[]
    else '{}'::public.property_kind[]
  end
$$;

create or replace function public.loyalty_tier_for(completed integer)
returns smallint language sql immutable set search_path = '' as $$
  select (case when completed >= 10 then 3 when completed >= 5 then 2 when completed >= 3 then 1 else 0 end)::smallint
$$;

create or replace function public.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values ((select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

-- ---------- accounts: profile creation + owner activation -------------------
-- An approved partner application grants the owner role — but only once the
-- e-mail address is CONFIRMED, so nobody can claim an owner e-mail by signing
-- up with it first.
create or replace function public.apply_approved_application(p_user uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
begin
  if p_email is null then return; end if;
  select a.partner_type into v_type
    from public.partner_applications a
   where a.status = 'approved' and lower(a.email) = lower(p_email)
   order by a.reviewed_at desc nulls last
   limit 1;
  if v_type is null then return; end if;
  update public.profiles
     set role = 'owner',
         owner_kinds = public.partner_type_kinds(v_type)
   where id = p_user and role = 'user';
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, email, display_name, phone, country_code, avatar_url)
  values (
    new.id,
    new.email,
    nullif(left(coalesce(m->>'name', m->>'full_name', m->>'display_name', split_part(coalesce(new.email, ''), '@', 1)), 120), ''),
    nullif(left(coalesce(m->>'phone', ''), 30), ''),
    nullif(left(coalesce(m->>'countryCode', m->>'country_code', ''), 8), ''),
    case when coalesce(m->>'avatar_url', m->>'picture', '') ~ '^https://' then left(coalesce(m->>'avatar_url', m->>'picture'), 2048) end
  )
  on conflict (id) do nothing;

  if new.email_confirmed_at is not null then
    perform public.apply_approved_application(new.id, new.email);
  end if;
  return new;
end $$;

create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform public.apply_approved_application(new.id, new.email);
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_confirmed();

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- properties: keep the filter columns in sync with `data` ----------
create or replace function public.properties_before_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_name text;
  v_price text;
begin
  -- the id lives in the row; make sure the JSON agrees
  new.data := jsonb_set(new.data, '{id}', to_jsonb(new.id), true);

  v_name := coalesce(
    nullif(new.data #>> '{name,en}', ''), nullif(new.data #>> '{title,en}', ''),
    case when jsonb_typeof(new.data->'name')  = 'string' then new.data->>'name'  end,
    case when jsonb_typeof(new.data->'title') = 'string' then new.data->>'title' end,
    new.data->>'vehicleType'
  );
  new.name     := left(v_name, 200);
  new.category := left(case when jsonb_typeof(new.data->'category') = 'string' then new.data->>'category' end, 80);

  v_price := case when jsonb_typeof(new.data->'price') = 'number' then new.data->>'price' end;
  new.price := case when v_price ~ '^[0-9]+(\.[0-9]+)?$' then v_price::numeric end;

  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
  elsif new.status = 'published' and old.status <> 'published' then
    new.published_at := now();
  end if;
  return new;
end $$;

create trigger properties_before_write
  before insert or update on public.properties
  for each row execute function public.properties_before_write();

create trigger site_content_touch before update on public.site_content
  for each row execute function public.touch_updated_at();
create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

-- ---------- pricing (port of the old bookings worker, same rules) ------------
create or replace function public._req_int(v text, lo integer, hi integer, label text)
returns integer language plpgsql immutable set search_path = '' as $$
begin
  if v is null or v !~ '^[0-9]+$' or v::numeric < lo or v::numeric > hi then
    raise exception 'Invalid %', label using errcode = '22023';
  end if;
  return v::integer;
end $$;

create or replace function public._child_fee(room jsonb, age numeric)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  t jsonb;
begin
  if jsonb_typeof(room->'childPricingTiers') = 'array' and jsonb_array_length(room->'childPricingTiers') > 0 then
    for t in select value from jsonb_array_elements(room->'childPricingTiers') loop
      if age >= coalesce((t->>'minAge')::numeric, 0) and age <= coalesce((t->>'maxAge')::numeric, 99) then
        return coalesce(nullif(t->>'fee', '')::numeric, 0);
      end if;
    end loop;
  end if;
  return coalesce(nullif(room->>'extraChildFee', '')::numeric, 0);
end $$;

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
  if v_type not in ('hotel', 'excursion', 'transfer') then
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
    if v_type = 'excursion' then
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

-- ---------- bookings: create / read shape / cancel ----------------------------
create or replace function public.booking_to_json(b public.bookings)
returns jsonb language sql stable set search_path = '' as $$
  select b.data || jsonb_strip_nulls(jsonb_build_object(
    'id', b.id, 'type', b.kind, 'status', b.status, 'uid', b.user_id, 'ownerUid', b.owner_id,
    'total', b.total, 'subtotal', b.subtotal, 'taxes', b.taxes,
    'depositAmount', b.deposit_amount, 'remainingAmount', b.remaining_amount, 'amountDueNow', b.amount_due_now,
    'paymentPlan', b.payment_plan, 'currency', b.currency, 'nights', b.nights,
    'checkin', b.check_in, 'checkout', b.check_out,
    'date', b.service_date,
    'reviewed', b.reviewed, 'ownerStatus', b.owner_status, 'ownerNote', b.owner_note,
    'needsRefund', case when b.needs_refund then true end,
    'cancelledAt', b.cancelled_at, 'cancelReason', b.cancel_reason,
    'createdAt', b.created_at, 'expiresAt', b.expires_at
  ))
$$;

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
  if v_type not in ('hotel', 'excursion', 'transfer') then raise exception 'Unknown booking type' using errcode = '22023'; end if;
  if coalesce(p->>'currency', '') <> 'EGP' then raise exception 'Only EGP is supported' using errcode = '22023'; end if;

  v_item_id := p->>(case v_type when 'hotel' then 'hotelId' when 'excursion' then 'excursionId' else 'transferId' end);
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

-- Cancel: the customer, the owner of the property, or a super admin.
create or replace function public.cancel_booking(p_id text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_b   public.bookings;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into v_b from public.bookings where id = p_id for update;
  if not found or not (v_b.user_id = v_uid or v_b.owner_id = v_uid or (select public.is_super_admin())) then
    raise exception 'Booking not found' using errcode = 'P0002';      -- same answer for "not yours" and "does not exist"
  end if;
  if v_b.status in ('cancelled', 'refunded', 'failed') then
    raise exception 'Booking can not be cancelled' using errcode = 'P0001';
  end if;
  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
         cancel_reason = left(p_reason, 1000),
         needs_refund = (v_b.status = 'completed')
   where id = p_id
   returning * into v_b;
  if v_b.user_id is not null and v_b.user_id <> v_uid then
    insert into public.notifications (user_id, icon, title, msg)
    values (v_b.user_id, 'fa-circle-xmark', 'Booking cancelled', 'Your booking ' || v_b.id || ' was cancelled.');
  end if;
  return jsonb_build_object('success', true, 'booking', public.booking_to_json(v_b));
end $$;

-- Owner (or admin) answers a booking on their property.
create or replace function public.owner_update_booking(p_id text, p_owner_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_b   public.bookings;
begin
  if p_owner_status not in ('accepted', 'declined', 'no_show') then raise exception 'Invalid status' using errcode = '22023'; end if;
  select * into v_b from public.bookings where id = p_id for update;
  if not found or not (v_b.owner_id = v_uid or (select public.is_super_admin())) then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  update public.bookings set owner_status = p_owner_status, owner_note = left(p_note, 1000) where id = p_id returning * into v_b;
  return public.booking_to_json(v_b);
end $$;

-- ---------- favorites, reviews, contact, partner applications ------------------
create or replace function public.toggle_favorite(p_property text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  delete from public.favorites where user_id = v_uid and property_id = p_property;
  if found then return false; end if;
  insert into public.favorites (user_id, property_id) values (v_uid, p_property);
  return true;
end $$;

create or replace function public.submit_review(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_b      public.bookings;
  v_rating integer;
  v_row    public.reviews;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  v_rating := public._req_int(p->>'rating', 1, 5, 'rating');
  select * into v_b from public.bookings where id = p->>'bookingId' for update;
  if not found or v_b.user_id <> v_uid then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if v_b.status <> 'completed' then raise exception 'Only paid bookings can be reviewed' using errcode = 'P0001'; end if;
  if v_b.reviewed then raise exception 'Already reviewed' using errcode = '23505'; end if;
  if v_b.property_id is null then raise exception 'Item not found' using errcode = 'P0002'; end if;

  insert into public.reviews (property_id, user_id, booking_id, rating, name, comment, photo_url, images)
  values (
    v_b.property_id, v_uid, v_b.id, v_rating,
    left(coalesce(nullif(p->>'name', ''), (select display_name from public.profiles where id = v_uid)), 120),
    left(p->>'comment', 4000),
    case when coalesce(p->>'photoURL', '') ~ '^https://' then left(p->>'photoURL', 2048) end,
    case when jsonb_typeof(p->'images') = 'array' then p->'images' else '[]'::jsonb end
  ) returning * into v_row;

  update public.bookings set reviewed = true where id = v_b.id;
  -- running average: no aggregate query on the read path
  update public.properties
     set rating_count = rating_count + 1,
         rating_avg = round(((rating_avg * rating_count) + v_rating) / (rating_count + 1), 2)
   where id = v_b.property_id;
  return jsonb_build_object('success', true, 'id', v_row.id);
end $$;

create or replace function public.admin_set_review_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_prop text;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_status not in ('published', 'hidden') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update public.reviews set status = p_status where id = p_id returning property_id into v_prop;
  if v_prop is null then raise exception 'Review not found' using errcode = 'P0002'; end if;
  update public.properties pr
     set rating_count = s.c, rating_avg = coalesce(s.a, 0)
    from (select count(*)::integer as c, round(avg(rating), 2) as a
            from public.reviews where property_id = v_prop and status = 'published') s
   where pr.id = v_prop;
  perform public.audit('review_status', 'review', p_id::text, jsonb_build_object('status', p_status));
end $$;

create or replace function public.submit_contact(p_name text, p_email text, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_email) > 254 then raise exception 'Invalid email' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then raise exception 'Invalid name' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 1 and 5000 then raise exception 'Invalid message' using errcode = '22023'; end if;
  if (select count(*) from public.contact_messages
       where lower(email) = lower(p_email) and created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'Too many requests' using errcode = 'P0001', detail = 'rate_limited';
  end if;
  insert into public.contact_messages (name, email, message) values (btrim(p_name), lower(btrim(p_email)), btrim(p_message));
end $$;

create or replace function public.submit_partner_application(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p->>'email', '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then raise exception 'Invalid email' using errcode = '22023'; end if;
  if exists (select 1 from public.partner_applications where lower(email) = v_email and created_at > now() - interval '1 hour') then
    raise exception 'Too many requests' using errcode = 'P0001', detail = 'rate_limited';
  end if;
  insert into public.partner_applications (user_id, partner_type, business_name, contact_name, phone, email, message, documents)
  values (
    (select auth.uid()),
    left(btrim(coalesce(p->>'partnerType', '')), 40),
    left(btrim(coalesce(p->>'businessName', '')), 200),
    left(btrim(coalesce(p->>'contactName', '')), 120),
    left(btrim(coalesce(p->>'phone', '')), 30),
    v_email,
    left(p->>'message', 4000),
    case when jsonb_typeof(p->'documents') = 'array' then p->'documents' else '[]'::jsonb end
  );
end $$;

-- ---------- super-admin tools --------------------------------------------------
create or replace function public.admin_decide_application(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_app public.partner_applications;
  v_target uuid;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.partner_applications
     set status = case when p_approve then 'approved'::public.application_status else 'rejected'::public.application_status end,
         admin_note = left(p_note, 1000), reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_id and status = 'pending'
   returning * into v_app;
  if not found then raise exception 'Application not found or already decided' using errcode = 'P0002'; end if;

  if p_approve then
    -- existing account with a confirmed e-mail becomes an owner now; otherwise it happens at confirmation
    select u.id into v_target from auth.users u
     where lower(u.email) = lower(v_app.email) and u.email_confirmed_at is not null limit 1;
    if v_target is not null then
      update public.profiles set role = 'owner', owner_kinds = public.partner_type_kinds(v_app.partner_type)
       where id = v_target and role = 'user';
      insert into public.notifications (user_id, icon, title, msg)
      values (v_target, 'fa-handshake', 'Partner account approved', 'Your partner application was approved. Open your owner panel to add listings.');
    end if;
  end if;
  perform public.audit(case when p_approve then 'application_approved' else 'application_rejected' end, 'partner_application', p_id::text, '{}'::jsonb);
end $$;

create or replace function public.admin_set_user_role(p_user uuid, p_role public.user_role, p_owner_kinds public.property_kind[] default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) and p_role <> 'super_admin' then
    raise exception 'You can not remove your own super admin role' using errcode = 'P0001';
  end if;
  update public.profiles
     set role = p_role,
         owner_kinds = case when p_role = 'owner' then coalesce(p_owner_kinds, owner_kinds) else '{}'::public.property_kind[] end
   where id = p_user;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  perform public.audit('set_role', 'profile', p_user::text, jsonb_build_object('role', p_role, 'owner_kinds', p_owner_kinds));
end $$;

create or replace function public.admin_set_user_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'You can not deactivate yourself' using errcode = 'P0001'; end if;
  update public.profiles set is_active = p_active where id = p_user;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  perform public.audit('set_active', 'profile', p_user::text, jsonb_build_object('active', p_active));
end $$;

-- Publication state. Owners can only send a draft for review; only a super admin publishes / archives.
create or replace function public.submit_property_for_review(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.properties set status = 'pending_review'
   where id = p_id and owner_id = (select auth.uid()) and status = 'draft' and public.owner_can_manage(kind);
  if not found then raise exception 'Listing not found or not a draft' using errcode = 'P0002'; end if;
end $$;

create or replace function public.admin_set_property_status(p_id text, p_status public.listing_status)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.properties set status = p_status where id = p_id;
  if not found then raise exception 'Listing not found' using errcode = 'P0002'; end if;
  perform public.audit('property_status', 'property', p_id, jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_set_property_meta(
  p_id text, p_owner uuid default null, p_clear_owner boolean default false,
  p_featured boolean default null, p_sort_order integer default null, p_commission numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.properties
     set owner_id        = case when p_clear_owner then null else coalesce(p_owner, owner_id) end,
         featured        = coalesce(p_featured, featured),
         sort_order      = coalesce(p_sort_order, sort_order),
         commission_rate = coalesce(p_commission, commission_rate)
   where id = p_id;
  if not found then raise exception 'Listing not found' using errcode = 'P0002'; end if;
  perform public.audit('property_meta', 'property', p_id,
    jsonb_build_object('owner', p_owner, 'featured', p_featured, 'sort_order', p_sort_order, 'commission', p_commission));
end $$;

-- ---------- owner money ----------------------------------------------------------
create or replace function public.owner_balance(p_owner uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner  uuid := coalesce(p_owner, (select auth.uid()));
  v_earned numeric;
  v_paid   numeric;
  v_held   numeric;
begin
  if v_owner is distinct from (select auth.uid()) and not (select public.is_super_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(sum(owner_amount), 0) into v_earned from public.bookings
   where owner_id = v_owner and status = 'completed';
  select coalesce(sum(amount) filter (where status = 'paid'), 0),
         coalesce(sum(amount) filter (where status = 'requested'), 0)
    into v_paid, v_held from public.payouts where owner_id = v_owner;
  return jsonb_build_object('earned', v_earned, 'paid', v_paid, 'requested', v_held, 'available', v_earned - v_paid - v_held);
end $$;

create or replace function public.request_payout(p_amount numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_bal jsonb;
  v_id  uuid;
begin
  if not (select public.is_owner()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.payout_accounts where owner_id = v_uid) then
    raise exception 'Add a payout account first' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = v_uid for update;       -- serialise concurrent requests
  v_bal := public.owner_balance(v_uid);
  if p_amount is null or p_amount <= 0 or p_amount > (v_bal->>'available')::numeric then
    raise exception 'Amount exceeds available balance' using errcode = '22023';
  end if;
  insert into public.payouts (owner_id, amount) values (v_uid, p_amount) returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_set_payout_status(p_id uuid, p_status public.payout_status, p_reference text default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.payouts
     set status = p_status, reference = left(p_reference, 200), note = left(p_note, 1000),
         paid_at = case when p_status = 'paid' then now() end
   where id = p_id and status = 'requested';
  if not found then raise exception 'Payout not found or already settled' using errcode = 'P0002'; end if;
  perform public.audit('payout_' || p_status::text, 'payout', p_id::text, '{}'::jsonb);
end $$;

-- ---------- dashboards -----------------------------------------------------------
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users',      (select count(*) from public.profiles),
    'owners',     (select count(*) from public.profiles where role = 'owner'),
    'properties', (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb) from (select status, count(*) c from public.properties group by status) s),
    'pending_applications', (select count(*) from public.partner_applications where status = 'pending'),
    'bookings_30d', (select count(*) from public.bookings where created_at >= now() - interval '30 days' and status = 'completed'),
    'revenue_30d',  (select coalesce(sum(total), 0) from public.bookings where created_at >= now() - interval '30 days' and status = 'completed')
  );
end $$;

-- ---------- housekeeping: keeps tables (and the bill) small ----------------------
-- Unpaid checkout sessions were never real bookings: drop them a day after they expire.
create or replace function public.housekeeping()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a integer; b integer; c integer; d integer;
begin
  delete from public.bookings where id in (
    select id from public.bookings where status = 'pending_payment' and expires_at < now() - interval '1 day' limit 2000);
  get diagnostics a = row_count;
  delete from public.notifications where id in (
    select id from public.notifications where created_at < now() - interval '90 days' limit 5000);
  get diagnostics b = row_count;
  delete from public.bookings where id in (
    select id from public.bookings where status = 'failed' and created_at < now() - interval '90 days' limit 2000);
  get diagnostics c = row_count;
  delete from public.audit_log where id in (
    select id from public.audit_log where created_at < now() - interval '400 days' limit 5000);
  get diagnostics d = row_count;
  return jsonb_build_object('pending_dropped', a, 'notifications_dropped', b, 'failed_dropped', c, 'audit_dropped', d);
end $$;

-- Mark a cancelled / failed-after-payment booking as refunded once the money went back.
create or replace function public.admin_mark_refunded(p_id text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.bookings
     set status = 'refunded', needs_refund = false, owner_note = coalesce(left(p_note, 1000), owner_note)
   where id = p_id and status = 'cancelled' and needs_refund;
  if not found then raise exception 'Booking not found or no refund pending' using errcode = 'P0002'; end if;
  perform public.audit('refunded', 'booking', p_id, '{}'::jsonb);
end $$;

-- ---------- read helpers used by the site (SECURITY INVOKER: RLS still decides what you see) ----------
-- Same shape the pages always rendered. Unpaid checkout sessions are not "bookings" yet.
create or replace function public.list_my_bookings(p_limit integer default 200)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(public.booking_to_json(x.b) order by (x.b).created_at desc), '[]'::jsonb)
    from (
      select b from public.bookings b
       where b.user_id = (select auth.uid()) and b.status <> 'pending_payment'
       order by b.created_at desc
       limit least(greatest(p_limit, 1), 500)
    ) x
$$;

-- Owner inbox (their properties) — a super admin sees everything. Keyset pagination via p_before.
create or replace function public.list_incoming_bookings(p_limit integer default 50, p_before timestamptz default null)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(public.booking_to_json(x.b) order by (x.b).created_at desc), '[]'::jsonb)
    from (
      select b from public.bookings b
       where b.status <> 'pending_payment'
         and ((select public.is_super_admin()) or b.owner_id = (select auth.uid()))
         and (p_before is null or b.created_at < p_before)
       order by b.created_at desc
       limit least(greatest(p_limit, 1), 200)
    ) x
$$;

create or replace function public.owner_reply_review(p_id uuid, p_reply text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
begin
  select pr.owner_id into v_owner
    from public.reviews r join public.properties pr on pr.id = r.property_id
   where r.id = p_id;
  if not found or not (v_owner = v_uid or (select public.is_super_admin())) then
    raise exception 'Review not found' using errcode = 'P0002';
  end if;
  update public.reviews set owner_reply = nullif(left(btrim(p_reply), 2000), ''), replied_at = now() where id = p_id;
end $$;
