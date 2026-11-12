-- OPTIONAL — deletes ALL accounts (customers, owners, super admins) with their identities, sessions and tokens.
-- Run it only if you really want a completely empty project. Afterwards sign up again and run 03_first_super_admin.sql.
-- (Run it BEFORE 01_install_schema.sql so the new signup triggers don't fire for rows being deleted.)
delete from auth.users;
select count(*) as remaining_users from auth.users;
