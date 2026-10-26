-- =====================================================================
-- v18 — restaurants & cafés with approved branches, site settings + extra UI languages,
--        and the operations log (audit_log) removed.
-- Run after 20261012000700_backoffice.sql (SQL editor, or `supabase db push`).
-- =====================================================================

-- ---------- 1. the operations log is gone -------------------------------------------------------------------------
-- Nothing is stored any more. audit() stays as a harmless no-op so the existing functions that call it keep working
-- (they are not rewritten here, which keeps this migration small and safe).
drop table if exists public.audit_log cascade;

create or replace function public.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  null;   -- intentionally empty: no operations log
end $$;

create or replace function public.housekeeping()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a integer; b integer; c integer;
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
  return jsonb_build_object('pending_dropped', a, 'notifications_dropped', b, 'failed_dropped', c);
end $$;

-- ---------- 2. restaurant / café branches (every branch needs the super admin's approval) ----------------------------
create type public.branch_status as enum ('pending', 'approved', 'rejected');

create table public.restaurant_branches (
  id          uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id) on delete cascade,     -- the restaurant / café
  owner_id    uuid not null references public.profiles (id) on delete cascade,       -- = the restaurant's owner (set by trigger)
  status      public.branch_status not null default 'pending',
  data        jsonb not null default '{}'::jsonb,       -- name{}, address{}, area{}, openHours{}, phone, lat, lng, google_maps_url, images[]
  admin_note  text,                                      -- why a branch was rejected
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint branches_data_obj check (jsonb_typeof(data) = 'object')
);
create index restaurant_branches_property_idx on public.restaurant_branches (property_id, status);
create index restaurant_branches_owner_idx    on public.restaurant_branches (owner_id);
create index restaurant_branches_pending_idx  on public.restaurant_branches (created_at) where status = 'pending';

create trigger restaurant_branches_touch before update on public.restaurant_branches
  for each row execute function public.touch_updated_at();

-- Owners can never approve themselves: any insert/update by a non-admin goes back to "pending".
create or replace function public.restaurant_branches_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_kind public.property_kind; v_count integer;
begin
  select p.owner_id, p.kind into v_owner, v_kind from public.properties p where p.id = new.property_id;
  if v_kind is distinct from 'restaurant' then raise exception 'branches belong to restaurants only' using errcode = '23514'; end if;
  if (select public.is_super_admin()) then
    if tg_op = 'INSERT' and v_owner is not null then new.owner_id := v_owner; end if;
    return new;
  end if;
  if v_owner is distinct from (select auth.uid()) then raise exception 'not your restaurant' using errcode = '42501'; end if;
  new.owner_id   := v_owner;
  new.status     := 'pending';
  new.admin_note := null; new.decided_by := null; new.decided_at := null;
  if tg_op = 'INSERT' then
    select count(*) into v_count from public.restaurant_branches b where b.property_id = new.property_id;
    if v_count >= 30 then raise exception 'too many branches' using errcode = '23514', detail = 'branches_limit'; end if;
  end if;
  return new;
end $$;
create trigger restaurant_branches_guard_trg before insert or update on public.restaurant_branches
  for each row execute function public.restaurant_branches_guard();

alter table public.restaurant_branches enable row level security;
grant select on public.restaurant_branches to anon, authenticated;
grant insert (property_id, data, sort_order), update (data, sort_order), delete on public.restaurant_branches to authenticated;

create policy branches_public_read on public.restaurant_branches for select to anon, authenticated
  using (status = 'approved' and exists (select 1 from public.properties p where p.id = property_id and p.status = 'published'));
create policy branches_own_read on public.restaurant_branches for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_super_admin()));
create policy branches_insert on public.restaurant_branches for insert to authenticated
  with check ((select public.is_super_admin()) or (owner_id = (select auth.uid()) and public.owner_can_manage('restaurant')));
create policy branches_update on public.restaurant_branches for update to authenticated
  using ((select public.is_super_admin()) or (owner_id = (select auth.uid()) and public.owner_can_manage('restaurant')))
  with check ((select public.is_super_admin()) or (owner_id = (select auth.uid()) and public.owner_can_manage('restaurant')));
create policy branches_delete on public.restaurant_branches for delete to authenticated
  using ((select public.is_super_admin()) or (owner_id = (select auth.uid()) and public.owner_can_manage('restaurant')));

create or replace function public.admin_set_branch_status(p_id uuid, p_status public.branch_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.restaurant_branches
     set status = p_status, admin_note = case when p_status = 'rejected' then nullif(trim(coalesce(p_note, '')), '') else null end,
         decided_by = (select auth.uid()), decided_at = now()
   where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.admin_set_branch_status(uuid, public.branch_status, text) from public, anon;
grant execute on function public.admin_set_branch_status(uuid, public.branch_status, text) to authenticated;

-- ---------- 3. site settings (sections on/off, languages, announcement, maintenance, contact…) ------------------------
create table public.site_settings (
  id         smallint primary key default 1 check (id = 1),
  value      jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object' and pg_column_size(value) < 60000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.site_settings (id) values (1);

alter table public.site_settings enable row level security;
grant select on public.site_settings to anon, authenticated;                       -- public values only: never put a secret in here
create policy site_settings_read on public.site_settings for select to anon, authenticated using (true);

create or replace function public.admin_set_site_settings(p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.site_settings set value = coalesce(p_value, '{}'::jsonb), updated_at = now(), updated_by = (select auth.uid()) where id = 1;
end $$;
revoke all on function public.admin_set_site_settings(jsonb) from public, anon;
grant execute on function public.admin_set_site_settings(jsonb) to authenticated;

-- extra interface languages (the 6 built-in ones ship as files; anything the admin adds lives here)
create table public.ui_languages (
  code        text primary key check (code ~ '^[a-z]{2,3}(-[A-Za-z]{2,4})?$'),
  name        text not null,                                  -- English name
  native_name text not null,                                  -- shown in the language picker
  dir         text not null default 'ltr' check (dir in ('ltr', 'rtl')),
  strings     jsonb not null default '{}'::jsonb check (jsonb_typeof(strings) = 'object' and pg_column_size(strings) < 400000),
  enabled     boolean not null default true,
  sort_order  integer not null default 100,
  updated_at  timestamptz not null default now()
);
alter table public.ui_languages enable row level security;
grant select on public.ui_languages to anon, authenticated;
create policy ui_languages_read on public.ui_languages for select to anon, authenticated using (enabled or (select public.is_super_admin()));

create or replace function public.admin_save_language(p_code text, p_name text, p_native text, p_dir text, p_strings jsonb, p_enabled boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.ui_languages (code, name, native_name, dir, strings, enabled)
  values (lower(p_code), p_name, p_native, coalesce(p_dir, 'ltr'), coalesce(p_strings, '{}'::jsonb), coalesce(p_enabled, true))
  on conflict (code) do update set name = excluded.name, native_name = excluded.native_name, dir = excluded.dir,
    strings = case when excluded.strings = '{}'::jsonb then public.ui_languages.strings else excluded.strings end,
    enabled = excluded.enabled, updated_at = now();
end $$;
create or replace function public.admin_delete_language(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.ui_languages where code = lower(p_code);
end $$;
revoke all on function public.admin_save_language(text, text, text, text, jsonb, boolean) from public, anon;
revoke all on function public.admin_delete_language(text) from public, anon;
grant execute on function public.admin_save_language(text, text, text, text, jsonb, boolean) to authenticated;
grant execute on function public.admin_delete_language(text) to authenticated;
