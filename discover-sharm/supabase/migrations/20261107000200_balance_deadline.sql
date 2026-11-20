-- Remaining-balance deadline for deposit bookings.
--  * the customer must pay the rest `balance_due_hours` before the service date (never less than 24h after the booking is confirmed)
--  * public.balance_job() (called hourly by the payments Worker's cron) hands out 72h / 24h reminders and auto-cancels unpaid bookings
--    when platform_settings.balance_auto_cancel is true. The deposit is kept (needs_refund stays false) — the admin can refund manually.
-- Change the rules with:  update public.platform_settings set balance_due_hours = 72, balance_auto_cancel = false where id = 1;

alter table public.platform_settings
  add column if not exists balance_due_hours   int     not null default 48 check (balance_due_hours between 0 and 720),
  add column if not exists balance_auto_cancel boolean not null default true;

alter table public.bookings
  add column if not exists balance_due_at     timestamptz,
  add column if not exists balance_reminders  smallint not null default 0;

create or replace function public.set_balance_due_at() returns trigger language plpgsql set search_path = '' as $$
declare v_day date := coalesce(new.check_in, new.service_date); v_h int;
begin
  if new.payment_plan = 'deposit' and new.status = 'completed' and new.remaining_amount > 0 and new.balance_due_at is null and v_day is not null then
    select balance_due_hours into v_h from public.platform_settings where id = 1;
    new.balance_due_at := greatest(((v_day::timestamp) at time zone 'Africa/Cairo') - make_interval(hours => coalesce(v_h, 48)), now() + interval '24 hours');
  end if;
  return new;
end $$;
drop trigger if exists bookings_balance_due on public.bookings;
create trigger bookings_balance_due before insert or update of status, payment_plan on public.bookings
  for each row execute function public.set_balance_due_at();

-- existing unpaid deposit bookings whose service is still ahead get a deadline too (past services are left alone)
update public.bookings
   set balance_due_at = greatest(((coalesce(check_in, service_date))::timestamp at time zone 'Africa/Cairo') - interval '48 hours', now() + interval '24 hours')
 where payment_plan = 'deposit' and status = 'completed' and remaining_amount > 0 and balance_due_at is null
   and coalesce(data->>'balanceStatus', '') <> 'paid'
   and coalesce(check_in, service_date) > (now() at time zone 'Africa/Cairo')::date;

-- the booking JSON now carries balanceDueAt (shown to the customer next to "pay the rest")
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
    'cancelledAt', b.cancelled_at, 'cancelReason', b.cancel_reason, 'balanceDueAt', b.balance_due_at,
    'createdAt', b.created_at, 'expiresAt', b.expires_at,
    'earning', case when b.earned_at is not null then jsonb_build_object(
        'gross', b.subtotal, 'rate', round(coalesce(b.commission_rate, 0) * 100, 2), 'commission', b.commission_amount,
        'net', b.owner_amount, 'void', b.earning_void, 'at', b.earned_at) end
  ))
$$;

create or replace function public.balance_job() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_auto boolean; v_cancel jsonb; v_rem jsonb;
begin
  select balance_auto_cancel into v_auto from public.platform_settings where id = 1;
  with c as (
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'balance_unpaid', needs_refund = false
     where coalesce(v_auto, false) and status = 'completed' and payment_plan = 'deposit' and remaining_amount > 0
       and coalesce(data->>'balanceStatus', '') <> 'paid' and balance_due_at is not null and balance_due_at <= now()
       and owner_status is distinct from 'done'
    returning id, data->>'email' as email, data->>'name' as name, kind, remaining_amount, currency
  ) select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cancel from c;

  with r as (
    select id, case when balance_due_at - now() <= interval '24 hours' then 2 else 1 end as n
      from public.bookings
     where status = 'completed' and payment_plan = 'deposit' and remaining_amount > 0 and coalesce(data->>'balanceStatus', '') <> 'paid'
       and balance_due_at is not null and balance_due_at > now() and balance_due_at - now() <= interval '72 hours'
       and balance_reminders < case when balance_due_at - now() <= interval '24 hours' then 2 else 1 end
       for update skip locked
  ), u as (
    update public.bookings b set balance_reminders = r.n from r where b.id = r.id
    returning b.id, b.data->>'email' as email, b.data->>'name' as name, b.kind, b.remaining_amount, b.currency, b.balance_due_at as due_at, r.n
  ) select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_rem from u;

  return jsonb_build_object('cancelled', v_cancel, 'reminders', v_rem);
end $$;
revoke all on function public.balance_job() from public, anon, authenticated;
grant execute on function public.balance_job() to service_role;
