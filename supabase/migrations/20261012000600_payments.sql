-- =====================================================================
-- Part 6: payment gateway RPCs. SERVICE ROLE ONLY.
-- The payments Worker (workers/payments-worker.js) calls these with the service-role key, which never
-- reaches a browser. Every function locks the booking row (select ... for update), so a webhook and a
-- browser poll arriving together can not both confirm the same booking: exactly one wins, the other is a no-op.
-- =====================================================================

-- What the Worker reads: the booking in the shape it always used, and whether it is still a checkout session.
create or replace function public.service_get_order(p_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_id;
  if not found then return jsonb_build_object('booking', null, 'pending', false); end if;
  return jsonb_build_object('booking', public.booking_to_json(v_b), 'pending', v_b.status = 'pending_payment');
end $$;

-- Gateway bookkeeping only (ids / flags). Nothing that changes money or ownership can be written here.
create or replace function public.service_patch_booking(p_id text, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ok constant text[] := array['kashierOrderId', 'lastPaymentStatus', 'paymentFlag', 'paidAmount',
                                'balancePaymentFlag', 'lastBalancePaymentStatus'];
begin
  update public.bookings
     set data = data || coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(p_patch, '{}'::jsonb)) as e(k, v) where k = any (v_ok)), '{}'::jsonb)
   where id = p_id;
end $$;

-- A confirmed payment turns the checkout session into a real booking — exactly once.
-- Returns {status, created}; created is true only for the call that actually made the transition
-- (that call, and only that call, should trigger the confirmation e-mail).
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
                      then jsonb_build_object('balanceAmount', v_b.remaining_amount, 'balanceStatus', 'due')
                      else jsonb_build_object('balanceStatus', 'paid') end
              || v_extra;

    update public.bookings
       set status = 'completed', confirmed_at = now(), created_at = now(), expires_at = null,
           data = v_data
     where id = p_id;

    if v_b.user_id is not null then
      update public.profiles
         set completed_bookings = completed_bookings + 1,
             total_spent = total_spent + v_b.total,
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

-- The remaining balance (after a 50% deposit) paid later. Idempotent.
create or replace function public.finalize_balance_payment(p_id text, p_gateway_status text, p_extra jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_b     public.bookings;
  v_s     text := upper(coalesce(p_gateway_status, ''));
  v_state text;
  v_extra jsonb := coalesce(p_extra, '{}'::jsonb) - array['status', 'uid', 'ownerUid', 'total', 'subtotal', 'currency'];
begin
  select * into v_b from public.bookings where id = p_id for update;
  if not found then return null; end if;
  v_state := v_b.data->>'balanceStatus';
  if v_state is distinct from 'due' then return coalesce(v_state, 'paid'); end if;    -- settled already / nothing due

  if v_s in ('SUCCESS', 'PAID', 'CAPTURED') then
    update public.bookings
       set data = data || jsonb_build_object('balanceStatus', 'paid', 'balancePaidAt', now()) || v_extra
     where id = p_id;
    return 'paid';
  elsif v_s in ('FAILED', 'FAILURE', 'DECLINED') then
    update public.bookings set data = data || '{"lastBalancePaymentStatus":"failed"}'::jsonb where id = p_id;
  end if;
  return 'due';
end $$;

-- Gateway told us the money went back.
create or replace function public.service_mark_refunded(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set status = 'refunded', needs_refund = false, earning_void = (earned_at is not null)
   where id = p_id and status in ('completed', 'cancelled');
end $$;

revoke all on function public.service_get_order(text)                      from public, anon, authenticated;
revoke all on function public.service_patch_booking(text, jsonb)           from public, anon, authenticated;
revoke all on function public.finalize_booking_payment(text, text, jsonb)  from public, anon, authenticated;
revoke all on function public.finalize_balance_payment(text, text, jsonb)  from public, anon, authenticated;
revoke all on function public.service_mark_refunded(text)                  from public, anon, authenticated;
grant execute on function public.service_get_order(text)                      to service_role;
grant execute on function public.service_patch_booking(text, jsonb)           to service_role;
grant execute on function public.finalize_booking_payment(text, text, jsonb)  to service_role;
grant execute on function public.finalize_balance_payment(text, text, jsonb)  to service_role;
grant execute on function public.service_mark_refunded(text)                  to service_role;
