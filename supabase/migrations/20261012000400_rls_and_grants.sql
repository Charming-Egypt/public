-- =====================================================================
-- Part 4/5: privileges + Row Level Security.
--
-- Layer 1  GRANTs      what each database role may touch at all (column-level for writes).
-- Layer 2  RLS         which ROWS, based on auth.uid() and the caller's app role.
-- Layer 3  RPCs        money / role / publication changes only through functions that re-check the caller.
--
-- Policy expressions use (select auth.uid()) and (select public.is_super_admin()):
-- the sub-select makes Postgres evaluate them ONCE per query instead of once per row.
-- =====================================================================

-- ---- 1. start from nothing ---------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---- 2. table privileges (writes are column-restricted) -----------------------
grant select on public.profiles to authenticated;
grant update (display_name, phone, country_code, avatar_url, locale) on public.profiles to authenticated;   -- NOT role / is_active / stats

grant select on public.properties to anon, authenticated;
grant insert (id, kind, owner_id, status, data) on public.properties to authenticated;                       -- status/owner checked by RLS
grant update (data) on public.properties to authenticated;                                                   -- status/owner/commission: RPC only
grant delete on public.properties to authenticated;                                                          -- super admin only (RLS)

grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;                                        -- super admin only (RLS)

grant select on public.platform_settings to authenticated;

grant select on public.bookings to authenticated;                                                            -- all writes via RPC
grant select on public.favorites to authenticated;                                                           -- writes via toggle_favorite()
grant select on public.reviews to anon, authenticated;                                                       -- writes via submit_review()

grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant select, delete on public.contact_messages to authenticated;                                            -- super admin only (RLS)
grant update (handled_at, handled_by) on public.contact_messages to authenticated;
grant select on public.partner_applications to authenticated;                                                -- writes via RPC

grant select, insert, update on public.payout_accounts to authenticated;
grant select on public.payouts to authenticated;                                                             -- writes via RPC
grant select on public.audit_log to authenticated;                                                           -- super admin only (RLS)

-- ---- 3. function privileges ----------------------------------------------------
-- used inside policies, so the querying role needs EXECUTE
grant execute on function public.is_super_admin()                    to anon, authenticated;
grant execute on function public.is_owner()                          to anon, authenticated;
grant execute on function public.owner_can_manage(public.property_kind) to anon, authenticated;
-- public forms (guests allowed; throttled inside the function)
grant execute on function public.submit_contact(text, text, text)    to anon, authenticated;
grant execute on function public.submit_partner_application(jsonb)   to anon, authenticated;
-- signed-in users
grant execute on function public.create_booking(jsonb)               to authenticated;
grant execute on function public.cancel_booking(text, text)          to authenticated;
grant execute on function public.owner_update_booking(text, text, text) to authenticated;
grant execute on function public.toggle_favorite(text)               to authenticated;
grant execute on function public.submit_review(jsonb)                to authenticated;
grant execute on function public.submit_property_for_review(text)    to authenticated;
grant execute on function public.owner_balance(uuid)                 to authenticated;
grant execute on function public.request_payout(numeric)            to authenticated;
grant execute on function public.booking_to_json(public.bookings)    to authenticated;   -- called by the SECURITY INVOKER list functions
grant execute on function public.list_my_bookings(integer)           to authenticated;
grant execute on function public.list_incoming_bookings(integer, timestamptz) to authenticated;
grant execute on function public.owner_reply_review(uuid, text)      to authenticated;
-- super admin (each function re-checks is_super_admin())
grant execute on function public.admin_decide_application(uuid, boolean, text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.user_role, public.property_kind[]) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;
grant execute on function public.admin_set_property_status(text, public.listing_status) to authenticated;
grant execute on function public.admin_set_property_meta(text, uuid, boolean, boolean, integer, numeric) to authenticated;
grant execute on function public.admin_set_review_status(uuid, text) to authenticated;
grant execute on function public.admin_set_payout_status(uuid, public.payout_status, text, text) to authenticated;
grant execute on function public.admin_mark_refunded(text, text)     to authenticated;
grant execute on function public.admin_stats()                       to authenticated;
-- housekeeping is also callable by the service role (the nightly job itself runs as postgres)
grant execute on function public.housekeeping()                      to service_role;
-- payment RPCs (finalize_booking_payment & co.) are created and granted in 20261012000600_payments.sql

-- ---- 4. Row Level Security ------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.platform_settings   enable row level security;
alter table public.properties          enable row level security;
alter table public.site_content        enable row level security;
alter table public.bookings            enable row level security;
alter table public.favorites           enable row level security;
alter table public.reviews             enable row level security;
alter table public.notifications       enable row level security;
alter table public.contact_messages    enable row level security;
alter table public.partner_applications enable row level security;
alter table public.payout_accounts     enable row level security;
alter table public.payouts             enable row level security;
alter table public.audit_log           enable row level security;

-- profiles: you see and edit yourself; super admin sees everyone (role changes: admin_set_user_role)
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_super_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- platform settings: super admin only
create policy settings_admin on public.platform_settings for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- properties: the public sees published rows; owners their own; super admin everything
create policy properties_select_public on public.properties for select to anon, authenticated
  using (status = 'published');
create policy properties_select_own on public.properties for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_super_admin()));
create policy properties_insert on public.properties for insert to authenticated
  with check (
    (select public.is_super_admin())
    or (owner_id = (select auth.uid()) and status in ('draft', 'pending_review') and public.owner_can_manage(kind))
  );
create policy properties_update on public.properties for update to authenticated
  using ((select public.is_super_admin()) or (owner_id = (select auth.uid()) and public.owner_can_manage(kind)))
  with check ((select public.is_super_admin()) or (owner_id = (select auth.uid()) and public.owner_can_manage(kind)));
create policy properties_delete on public.properties for delete to authenticated
  using ((select public.is_super_admin()));

-- site content: public reads published; super admin manages
create policy site_content_public on public.site_content for select to anon, authenticated
  using (published);
create policy site_content_admin on public.site_content for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- bookings: the customer, the property's owner (never unpaid sessions), the super admin
create policy bookings_select on public.bookings for select to authenticated
  using (
    user_id = (select auth.uid())
    or (owner_id = (select auth.uid()) and status <> 'pending_payment')
    or (select public.is_super_admin())
  );

create policy favorites_select on public.favorites for select to authenticated
  using (user_id = (select auth.uid()));

create policy reviews_select_public on public.reviews for select to anon, authenticated
  using (status = 'published');
create policy reviews_select_own on public.reviews for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_super_admin()));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy contact_admin on public.contact_messages for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

create policy applications_select on public.partner_applications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_super_admin()));

create policy payout_accounts_select on public.payout_accounts for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_super_admin()));
create policy payout_accounts_insert on public.payout_accounts for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_owner()));
create policy payout_accounts_update on public.payout_accounts for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner()));

create policy payouts_select on public.payouts for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_super_admin()));

create policy audit_select on public.audit_log for select to authenticated
  using ((select public.is_super_admin()));
