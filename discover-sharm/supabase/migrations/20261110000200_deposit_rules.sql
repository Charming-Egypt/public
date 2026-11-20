-- Deposit rules:
--  * the balance deadline is 24h before the service date (was 48h)
--  * a deposit is only accepted when the service is at least 2 days away (a booking for tomorrow or sooner must be paid in full)
alter table public.platform_settings alter column balance_due_hours set default 24;
update public.platform_settings set balance_due_hours = 24 where id = 1 and balance_due_hours = 48;
-- unpaid deposit bookings that still have the old 48h-based deadline get the 24h one (never earlier than 24h from now)
update public.bookings
   set balance_due_at = greatest(((coalesce(check_in, service_date))::timestamp at time zone 'Africa/Cairo') - interval '24 hours', now() + interval '24 hours')
 where payment_plan = 'deposit' and status = 'completed' and remaining_amount > 0 and balance_due_at is not null and balance_due_at > now()
   and coalesce(data->>'balanceStatus', '') <> 'paid';

create or replace function public.guard_deposit_date() returns trigger language plpgsql set search_path = '' as $$
declare v_day date := coalesce(new.check_in, new.service_date);
begin
  if new.payment_plan = 'deposit' and tg_op = 'INSERT' and v_day is not null
     and v_day >= (now() at time zone 'Africa/Cairo')::date and v_day < ((now() at time zone 'Africa/Cairo')::date + 2) then
    raise exception 'deposit_not_allowed' using errcode = 'P0001', detail = 'deposit_not_allowed',
      hint = 'A booking for tomorrow or sooner must be paid in full';
  end if;
  return new;
end $$;
drop trigger if exists bookings_deposit_date on public.bookings;
create trigger bookings_deposit_date before insert on public.bookings
  for each row execute function public.guard_deposit_date();
