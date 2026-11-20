-- =====================================================================
-- Security tests. Run in the Supabase SQL editor on a STAGING project, AFTER the 5 migrations
-- and seed.sql. Everything happens in one transaction that is rolled back at the end, so it leaves
-- no data behind. Every check prints PASS, or raises an exception that names the failing rule.
-- =====================================================================
begin;

-- helpers (created inside the transaction, so the rollback removes them) ------------------------------------------------------------
create function public.t_as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;
create function public.t_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
end $$;
create function public.t_expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  % (%)', p_label, sqlstate;
    return;
  end;
  raise exception 'FAIL  %  — the statement was allowed', p_label;
end $$;
create function public.t_expect_true(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond then raise notice 'PASS  %', p_label; else raise exception 'FAIL  %', p_label; end if;
end $$;

-- fixtures (as the table owner) ----------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local', now(), '{}', '{"name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local', now(), '{}', '{"name":"Owner"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guest1@test.local', now(), '{}', '{"name":"Guest One"}', now(), now()),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guest2@test.local', now(), '{}', '{"name":"Guest Two"}', now(), now());
update public.profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'owner', owner_kinds = '{excursion}' where id = '00000000-0000-0000-0000-0000000000b1';

select public.t_expect_true((select count(*) = 4 from public.profiles where email like '%@test.local'), 'signup trigger created a profile for each auth user');

-- anonymous visitor -----------------------------------------------------------------------------
select public.t_as_anon();
select public.t_expect_true((select count(*) > 0 from public.properties), 'anon can read the published catalog');
select public.t_expect_true((select count(*) = 0 from public.properties where status <> 'published'), 'anon sees no drafts');
select public.t_expect_error($q$select * from public.profiles$q$, 'anon can not read profiles');
select public.t_expect_error($q$select * from public.bookings$q$, 'anon can not read bookings');
select public.t_expect_error($q$select public.create_booking('{}'::jsonb)$q$, 'anon can not create bookings');
select public.t_expect_error($q$select public.finalize_booking_payment('x', 'SUCCESS')$q$, 'anon can not finalize payments');
select public.t_expect_error($q$select public.admin_set_user_role('00000000-0000-0000-0000-0000000000c1', 'super_admin')$q$, 'anon can not change roles');

-- a normal customer -------------------------------------------------------------------------------
select public.t_as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_expect_error($q$update public.profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-0000000000c1'$q$, 'customer can not promote themselves (column grant)');
select public.t_expect_error($q$update public.profiles set loyalty_tier = 3 where id = '00000000-0000-0000-0000-0000000000c1'$q$, 'customer can not edit loyalty tier');
select public.t_expect_true((select count(*) = 1 from public.profiles), 'customer sees only their own profile');
update public.profiles set display_name = 'Renamed' where id = '00000000-0000-0000-0000-0000000000c1';
select public.t_expect_true((select display_name = 'Renamed' from public.profiles), 'customer can edit their own name');
select public.t_expect_error($q$insert into public.properties (kind, status, data) values ('excursion', 'published', '{"name":{"en":"x"}}')$q$, 'customer can not create listings');
select public.t_expect_error($q$select public.admin_stats()$q$, 'customer can not read admin stats');
select public.t_expect_error($q$select public.finalize_booking_payment('x', 'SUCCESS')$q$, 'customer can not finalize payments');
select public.t_expect_error($q$select public.service_get_order('T-OK-1')$q$, 'customer can not call the payment RPCs');

-- booking: price is decided by the database --------------------------------------------------------
reset role;
create table public.t_item as select id, price from public.properties where kind = 'excursion' and status = 'published' and price is not null limit 1;
grant select on public.t_item to authenticated;
update public.properties set owner_id = '00000000-0000-0000-0000-0000000000b1' where id = (select id from public.t_item);
update public.platform_settings set min_payout = 1;
select public.t_as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_expect_error(
  format($q$select public.create_booking(jsonb_build_object('id','T-TAMPER-1','type','excursion','excursionId',%L,'date',(current_date+5)::text,'participants',2,'currency','EGP','total',1))$q$, (select id from public.t_item)),
  'a tampered total is rejected (price_changed)');
select public.t_expect_true(
  (select (public.create_booking(jsonb_build_object(
      'id','T-OK-1','type','excursion','excursionId',(select id from public.t_item),'date',(current_date+5)::text,'participants',2,'currency','EGP',
      'total', (select price*2 + round(price*2*0.05) from public.t_item), 'name','Guest One')) ->> 'success')::boolean),
  'a correct booking is accepted');
select public.t_expect_true((select count(*) = 0 from jsonb_array_elements(public.list_my_bookings())), 'an unpaid checkout session is not listed as a booking yet');

-- payment webhook (service role) ---------------------------------------------------------------------
reset role; set local role service_role;
select public.t_expect_true((public.finalize_booking_payment('T-OK-1', 'SUCCESS', '{}') ->> 'created')::boolean, 'service role confirms the paid booking (created = true)');
select public.t_expect_true(not (public.finalize_booking_payment('T-OK-1', 'SUCCESS', '{}') ->> 'created')::boolean, 'finalizing twice is a no-op (idempotent)');
select public.t_expect_true(public.finalize_booking_payment('T-OK-1', 'FAILED', '{}') ->> 'status' = 'completed', 'a late FAILED webhook can not undo a paid booking');
reset role;

select public.t_as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_expect_true((select jsonb_array_length(public.list_my_bookings()) = 1), 'customer now sees the confirmed booking');
select public.t_as_user('00000000-0000-0000-0000-0000000000c2');
select public.t_expect_true((select count(*) = 0 from public.bookings), 'another customer can not see it');
select public.t_expect_error($q$select public.cancel_booking('T-OK-1')$q$, 'another customer can not cancel it');
select public.t_expect_error($q$update public.bookings set total = 1 where id = 'T-OK-1'$q$, 'nobody can edit booking money directly');

-- owner ------------------------------------------------------------------------------------------------
select public.t_as_user('00000000-0000-0000-0000-0000000000b1');
-- Items are written by the content Worker (service role) only: the browser role has no insert/update/delete on properties any more.
select public.t_expect_error($q$insert into public.properties (id, kind, owner_id, status, data) values ('t_own_x', 'excursion', '00000000-0000-0000-0000-0000000000b1', 'draft', '{"name":{"en":"x"}}')$q$, 'owner can not insert a listing from the browser (the Worker does it)');
reset role;
insert into public.properties (id, kind, owner_id, status, data) values ('t_own_1', 'excursion', '00000000-0000-0000-0000-0000000000b1', 'draft', '{"name":{"en":"Owner trip"},"price":500}');   -- what the Worker does
select public.t_as_user('00000000-0000-0000-0000-0000000000b1');
select public.t_expect_true(exists (select 1 from public.properties where id = 't_own_1'), 'owner sees their own draft listing');
select public.t_expect_error($q$update public.properties set status = 'published' where id = 't_own_1'$q$, 'owner can not change status directly');
select public.t_expect_error($q$update public.properties set data = '{"price":1}' where id = 't_own_1'$q$, 'owner can not edit the price the booking code checks');
select public.t_expect_error($q$update public.properties set owner_id = null where id = 't_own_1'$q$, 'owner can not change ownership');
select public.t_expect_true((select count(*) = 1 from public.bookings), 'owner sees the paid booking on their own listing (and nothing else)');
select public.t_expect_error($q$select public.owner_update_booking('T-OK-1', 'done')$q$, 'owner can not book earnings before the service date');
reset role;
update public.bookings set service_date = current_date - 1 where id = 'T-OK-1';      -- pretend the trip happened yesterday
select public.t_as_user('00000000-0000-0000-0000-0000000000b1');
select public.owner_update_booking('T-OK-1', 'done', 'all good');
select public.t_expect_true((select earned_at is not null and owner_amount > 0 and commission_amount > 0 and commission_rate > 0 from public.bookings where id = 'T-OK-1'), 'marking the booking done books the earning with the commission frozen');
select public.t_expect_error($q$select public.owner_update_booking('T-OK-1', 'no_show')$q$, 'owner can not change a booked earning');
select public.t_expect_true((public.owner_balance() ->> 'available')::numeric > 0, 'the earning is in the owner balance');
select public.t_expect_error($q$select public.request_payout(1)$q$, 'a payout needs a payout account first');
insert into public.payout_accounts (owner_id, method, details) values ('00000000-0000-0000-0000-0000000000b1', 'instapay', '{"instapay":{"handle":"owner@instapay"}}');
select public.t_expect_error($q$update public.payout_accounts set locked_until = null$q$, 'owner can not edit the payout lock timer (column grant)');
select public.t_expect_true(public.request_payout((public.owner_balance() ->> 'available')::numeric) is not null, 'owner requests a payout of the available balance');
select public.t_expect_error($q$select public.request_payout(1)$q$, 'only one open payout request at a time');
select public.t_expect_true((public.owner_balance() ->> 'available')::numeric = 0, 'the requested amount is reserved');
select public.t_expect_true((select count(*) = 0 from public.properties where owner_id is distinct from '00000000-0000-0000-0000-0000000000b1' and status <> 'published'), 'owner sees no one else''s drafts');
select public.t_expect_error($q$select public.submit_property_for_review('t_own_1')$q$, 'review submission goes through the Worker now');
select public.t_expect_error($q$select public.admin_set_property_status('t_own_1', 'published')$q$, 'owner can not call admin functions');

-- super admin ------------------------------------------------------------------------------------------------
select public.t_as_user('00000000-0000-0000-0000-0000000000a1');
select public.t_expect_true((select count(*) >= 4 from public.profiles), 'super admin sees all profiles');
select public.t_expect_true((select count(*) >= 1 from public.bookings where id = 'T-OK-1'), 'super admin sees all bookings');
select public.t_expect_error($q$select public.admin_set_property_status('t_own_1', 'published')$q$, 'even the super admin changes status through the Worker (GitHub file + DB together)');
reset role;
update public.properties set status = 'published' where id = 't_own_1';   -- what the Worker does on publish
select public.t_as_user('00000000-0000-0000-0000-0000000000a1');
select public.t_expect_true((select status = 'published' from public.properties where id = 't_own_1'), 'a published listing is visible to the super admin');
select public.t_expect_error($q$select public.admin_set_user_role('00000000-0000-0000-0000-0000000000a1', 'user')$q$, 'super admin can not demote themselves');
select public.admin_set_user_role('00000000-0000-0000-0000-0000000000c2', 'owner', '{transfer}');
select public.t_expect_true((select jsonb_typeof(public.admin_stats()) = 'object'), 'super admin reads stats');
select public.t_expect_true((select jsonb_array_length(public.console_stats() -> 'series') = 30), 'console dashboard returns a 30-day series');
select public.t_expect_true((select jsonb_array_length(public.admin_owner_balances()) >= 1), 'per-owner balances for the accounting report');
select public.t_expect_true((select count(*) >= 1 from public.payouts where status = 'requested'), 'super admin sees the owner''s payout request');

-- the unauthenticated forms are throttled ------------------------------------------------------------------------
select public.t_as_anon();
select public.submit_contact('A', 'spam@test.local', 'hello');
select public.submit_contact('A', 'spam@test.local', 'hello');
select public.submit_contact('A', 'spam@test.local', 'hello');
select public.t_expect_error($q$select public.submit_contact('A', 'spam@test.local', 'hello')$q$, 'a 4th contact message in 10 minutes is throttled');

reset role;
rollback;   -- nothing above is kept
