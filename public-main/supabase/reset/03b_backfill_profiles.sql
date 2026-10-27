-- Only needed if you wiped `public` but did NOT run 00b_wipe_auth_users.sql: the old accounts still exist in auth.users but their
-- profile rows are gone (profiles are normally created by a trigger at sign-up), so those users cannot use the site properly.
insert into public.profiles (id, email, display_name)
select u.id, u.email, nullif(left(coalesce(u.raw_user_meta_data->>'name', u.raw_user_meta_data->>'full_name', split_part(coalesce(u.email, ''), '@', 1)), 120), '')
from auth.users u
on conflict (id) do nothing;
-- then make yourself admin again with 03_first_super_admin.sql
