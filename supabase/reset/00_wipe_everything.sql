-- =====================================================================================================================
-- ⚠️  DESTRUCTIVE — wipes EVERYTHING the project created in Supabase. There is no undo (take a backup first:
--     Dashboard → Database → Backups, or `supabase db dump`).
--
-- Removes : every table / type / function / policy / trigger in the `public` schema (profiles, properties, bookings, payouts,
--           site_settings, ui_languages, restaurant_branches, push_subscriptions, …), the storage policies of the two
--           buckets, and the nightly pg_cron job.
-- Keeps   : auth.users (use 00b_wipe_auth_users.sql if you also want to delete the accounts), the Storage buckets and files
--           (Supabase forbids deleting storage rows from SQL — empty a bucket from Dashboard → Storage if you want to),
--           Edge Functions, secrets and everything outside the project's own objects.
--
-- Run in : SQL Editor, as the default `postgres` role.   Then run 01_install_schema.sql → 02_seed_minimal.sql.
-- =====================================================================================================================

begin;

-- 1) nightly cleanup job -------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ds-housekeeping';
  end if;
exception when others then
  raise notice 'pg_cron job not removed (%): ignore if pg_cron was never enabled', sqlerrm;
end $$;

-- 2) triggers we attached to Supabase-owned tables (they would otherwise block the schema drop order) ----------------
drop trigger if exists on_auth_user_created   on auth.users;
drop trigger if exists on_auth_user_confirmed on auth.users;

-- 3) storage policies (the buckets themselves stay; 01_install_schema.sql re-creates the policies) ------------------
drop policy if exists avatars_insert        on storage.objects;
drop policy if exists avatars_update        on storage.objects;
drop policy if exists avatars_delete        on storage.objects;
drop policy if exists listing_media_insert  on storage.objects;
drop policy if exists listing_media_update  on storage.objects;
drop policy if exists listing_media_delete  on storage.objects;

-- 4) the whole public schema ---------------------------------------------------------------------------------------
drop schema if exists public cascade;
create schema public;
comment on schema public is 'standard public schema';

-- Supabase's standard grants for a fresh public schema (the install script then tightens them table by table).
grant usage  on schema public to postgres, anon, authenticated, service_role;
grant create on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

commit;

-- sanity check: should return 0 rows
select table_name from information_schema.tables where table_schema = 'public';
