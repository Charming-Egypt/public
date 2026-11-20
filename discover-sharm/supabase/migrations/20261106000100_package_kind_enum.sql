-- Packages (honeymoon / friends / family / adventure) become their own kind, like hotels / excursions / transfers.
-- STEP 1 of 2 — run this file ALONE first on an existing database, then run 20261106000200_packages.sql in a second run:
-- Postgres refuses to use a brand-new enum value in the same transaction that adds it.
-- (A fresh install already creates the enum with 'package' in it, so this is a no-op there.)
alter type public.property_kind add value if not exists 'package';
