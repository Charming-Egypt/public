-- =====================================================================
-- Part 5/5: image storage + nightly housekeeping
-- =====================================================================

-- Images live in Storage, not in table rows (a base64 avatar in a row is read on every query).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',       'avatars',       true,  524288, array['image/jpeg', 'image/png', 'image/webp']),
  ('listing-media', 'listing-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets are readable through their public URL. Writes: only inside your own folder  <uid>/…
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy listing_media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing-media'
    and ((select public.is_super_admin())
         or ((storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner())))
  );
create policy listing_media_update on storage.objects for update to authenticated
  using (
    bucket_id = 'listing-media'
    and ((select public.is_super_admin())
         or ((storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner())))
  );
create policy listing_media_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing-media'
    and ((select public.is_super_admin())
         or ((storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner())))
  );

-- Nightly cleanup (03:17 UTC). pg_cron must be enabled: Dashboard → Database → Extensions → pg_cron.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('ds-housekeeping', '17 3 * * *', 'select public.housekeeping()');
exception when others then
  raise notice 'pg_cron is not enabled yet. Enable it, then run:  select cron.schedule(''ds-housekeeping'', ''17 3 * * *'', ''select public.housekeeping()'');';
end $$;
