-- After a wipe nobody is an admin. 1) sign up on the site (or Dashboard → Authentication → Add user) and confirm the e-mail,
-- 2) put that e-mail below, 3) run. There is deliberately no way to do this from the website.
update public.profiles set role = 'super_admin' where email = 'you@example.com';
select id, email, role from public.profiles where role = 'super_admin';
