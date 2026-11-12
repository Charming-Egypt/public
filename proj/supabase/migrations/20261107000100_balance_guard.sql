-- Deposit bookings: the owner cannot mark the service "done" (which records the earnings) until the customer has paid the remaining balance online.
-- Super admin can still override. Nothing else changes.
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
    if v_b.payment_plan = 'deposit' and v_b.remaining_amount > 0 and coalesce(v_b.data->>'balanceStatus', '') <> 'paid' and not v_admin then
      raise exception 'The remaining balance has not been paid yet' using errcode = 'P0001', detail = 'balance_due';
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
