-- =====================================================================
-- Discover Sharm — Supabase schema (part 1/5): types + tables
--
-- Accounts      : auth.users (Supabase Auth)  ->  public.profiles (role: user | owner | super_admin)
-- Properties    : public.properties (hotel | excursion | transfer | restaurant), owned by an owner
-- Bookings      : public.bookings (price is computed IN the database, never trusted from the browser)
-- Everything the browser may do is decided by Row Level Security (part 4) — the
-- anon key in the page is safe to publish.
-- =====================================================================

create type public.user_role          as enum ('user', 'owner', 'super_admin');
create type public.property_kind      as enum ('hotel', 'excursion', 'transfer', 'restaurant');
create type public.listing_status     as enum ('draft', 'pending_review', 'published', 'archived');
create type public.booking_status     as enum ('pending_payment', 'completed', 'failed', 'cancelled', 'refunded');
create type public.application_status as enum ('pending', 'contacted', 'approved', 'rejected');
create type public.payout_status      as enum ('requested', 'paid', 'rejected', 'cancelled');

-- ---------------------------------------------------------------------
-- profiles: one row per auth user. `role` is NOT writable by the user
-- (column grants in part 4); only admin_set_user_role() changes it.
-- ---------------------------------------------------------------------
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  role               public.user_role not null default 'user',
  owner_kinds        public.property_kind[] not null default '{}',   -- what an owner may list
  email              text,
  display_name       text,
  phone              text,
  country_code       text,
  avatar_url         text,
  locale             text not null default 'en',
  commission_rate    numeric(5,4) check (commission_rate is null or commission_rate between 0 and 1),   -- owner-specific override
  max_items          integer check (max_items is null or max_items >= 0),                              -- listing cap for this owner (null = default)
  loyalty_tier       smallint not null default 0,                     -- 0..3 (same thresholds as before)
  completed_bookings integer  not null default 0,
  total_spent        numeric(12,2) not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint profiles_name_len   check (display_name is null or char_length(display_name) <= 120),
  constraint profiles_phone_len  check (phone is null or char_length(phone) <= 30),
  constraint profiles_cc_len     check (country_code is null or char_length(country_code) <= 8),
  constraint profiles_avatar_len check (avatar_url is null or char_length(avatar_url) <= 2048),
  constraint profiles_locale     check (locale in ('en', 'ar', 'ru', 'de', 'it', 'tr')),
  constraint profiles_tier       check (loyalty_tier between 0 and 3)
);

-- ---------------------------------------------------------------------
-- platform_settings: single row (id = 1)
-- ---------------------------------------------------------------------
create table public.platform_settings (
  id                      smallint primary key default 1 check (id = 1),
  default_commission_rate numeric(5,4) not null default 0.1000 check (default_commission_rate between 0 and 1),
  commission_hotel        numeric(5,4) not null default 0.1000 check (commission_hotel between 0 and 1),
  commission_excursion    numeric(5,4) not null default 0.1000 check (commission_excursion between 0 and 1),
  commission_transfer     numeric(5,4) not null default 0.1000 check (commission_transfer between 0 and 1),
  min_payout              numeric(12,2) not null default 500 check (min_payout >= 0),
  updated_at              timestamptz not null default now()
);
insert into public.platform_settings (id) values (1);

-- ---------------------------------------------------------------------
-- properties: the catalog. `data` is the full item the pages render
-- (i18n names, rooms, images, ...). A trigger copies the few fields we
-- filter/sort on into real columns, so list queries never open the JSON.
-- ---------------------------------------------------------------------
create table public.properties (
  id              text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  kind            public.property_kind not null,
  owner_id        uuid references public.profiles (id) on delete set null,   -- null = platform-owned
  status          public.listing_status not null default 'draft',
  name            text,            -- filled by trigger from data
  category        text,            -- filled by trigger from data
  price           numeric(12,2),   -- filled by trigger from data ("from" price)
  sort_order      integer not null default 1000,
  featured        boolean not null default false,
  commission_rate numeric(5,4) check (commission_rate is null or commission_rate between 0 and 1),
  rating_avg      numeric(3,2) not null default 0,
  rating_count    integer not null default 0,
  data            jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_at    timestamptz,
  constraint properties_id_fmt  check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint properties_data_obj check (jsonb_typeof(data) = 'object'),
  constraint properties_data_size check (pg_column_size(data) <= 400000)
);

-- Site content managed by the super admin: destinations, articles, promo slides.
create table public.site_content (
  kind       text not null check (kind in ('destination', 'article', 'promo_slide', 'testimonial')),
  id         text not null check (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  sort_order integer not null default 1000,
  published  boolean not null default true,
  data       jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);

-- ---------------------------------------------------------------------
-- bookings. `id` is the reference the customer sees (created in the browser).
-- Typed columns drive listing / filtering / money / RLS; `data` keeps the
-- full booking object exactly as the pages render it.
-- ---------------------------------------------------------------------
create table public.bookings (
  id               text primary key check (id ~ '^[A-Za-z0-9_-]{3,64}$'),
  user_id          uuid references public.profiles (id) on delete set null,
  property_id      text references public.properties (id) on delete set null,
  owner_id         uuid references public.profiles (id) on delete set null,   -- copied from the property at booking time
  kind             public.property_kind not null check (kind in ('hotel', 'excursion', 'transfer')),
  status           public.booking_status not null default 'pending_payment',
  payment_plan     text not null default 'full' check (payment_plan in ('full', 'deposit')),
  currency         char(3) not null default 'EGP' check (currency = 'EGP'),
  subtotal         numeric(12,2) not null check (subtotal >= 0),
  taxes            numeric(12,2) not null check (taxes >= 0),
  total            numeric(12,2) not null check (total > 0),
  deposit_amount   numeric(12,2) not null check (deposit_amount >= 0),
  remaining_amount numeric(12,2) not null check (remaining_amount >= 0),
  amount_due_now   numeric(12,2) not null check (amount_due_now >= 0),
  commission_rate  numeric(5,4),
  commission_amount numeric(12,2),
  owner_amount     numeric(12,2),
  check_in         date,
  check_out        date,
  service_date     date,                       -- excursion / transfer date
  nights           integer,
  guest_name       text,
  guest_email      text,
  guest_phone      text,
  data             jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 100000),
  reviewed         boolean not null default false,
  owner_status     text check (owner_status is null or owner_status in ('confirmed', 'done', 'no_show')),   -- null = new
  earned_at        timestamptz,                -- set when the owner marks the service done: earnings are recognised then
  earning_void     boolean not null default false,
  admin_note       text check (admin_note is null or char_length(admin_note) <= 1000),
  owner_note       text check (owner_note is null or char_length(owner_note) <= 1000),
  needs_refund     boolean not null default false,
  cancelled_at     timestamptz,
  cancelled_by     uuid,
  cancel_reason    text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  expires_at       timestamptz,                -- only while pending_payment (unpaid checkout session)
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.favorites (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  property_id text not null references public.properties (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, property_id)
);

create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  booking_id  text unique references public.bookings (id) on delete set null,   -- one review per booking
  rating      smallint not null check (rating between 1 and 5),
  name        text check (name is null or char_length(name) <= 120),
  comment     text check (comment is null or char_length(comment) <= 4000),
  photo_url   text check (photo_url is null or char_length(photo_url) <= 2048),
  images      jsonb not null default '[]'::jsonb check (pg_column_size(images) <= 20000),
  status      text not null default 'published' check (status in ('published', 'hidden')),
  owner_reply text check (owner_reply is null or char_length(owner_reply) <= 2000),
  replied_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  icon       text not null default 'fa-bell',
  title      text not null check (char_length(title) <= 200),
  msg        text not null check (char_length(msg) <= 1000),
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create table public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  email      text not null check (char_length(email) between 3 and 254),
  message    text not null check (char_length(message) between 1 and 5000),
  status     text not null default 'new' check (status in ('new', 'read', 'replied')),
  handled_at timestamptz,
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.partner_applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete set null,   -- null when a guest applies
  partner_type  text not null check (char_length(partner_type) between 1 and 40),
  business_name text not null check (char_length(business_name) between 1 and 200),
  contact_name  text not null check (char_length(contact_name) between 1 and 120),
  phone         text not null check (char_length(phone) between 3 and 30),
  email         text not null check (char_length(email) between 3 and 254),
  message       text check (message is null or char_length(message) <= 4000),
  documents     jsonb not null default '[]'::jsonb check (pg_column_size(documents) <= 3000000),   -- [{name, data}] ; listings never select it
  status        public.application_status not null default 'pending',
  admin_note    text check (admin_note is null or char_length(admin_note) <= 1000),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- Owner payouts -------------------------------------------------------
create table public.payout_accounts (
  owner_id   uuid primary key references public.profiles (id) on delete cascade,
  method     text not null check (method in ('bank', 'instapay')),
  details    jsonb not null check (pg_column_size(details) <= 4000),   -- {bank:{…}} or {instapay:{…}}
  locked_until timestamptz,                                           -- payouts pause for 24 h after the account changes
  updated_at timestamptz not null default now()
);

create table public.payouts (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  status       public.payout_status not null default 'requested',
  method       text,
  account      jsonb,                         -- snapshot of the payout account at request time
  manual       boolean not null default false, -- recorded by the admin after paying outside the site
  reference    text check (reference is null or char_length(reference) <= 200),
  note         text check (note is null or char_length(note) <= 1000),
  requested_at timestamptz not null default now(),
  paid_at      timestamptz
);

-- Manual corrections by the super admin: positive = owed to the owner, negative = owed by the owner.
create table public.adjustments (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete restrict,
  amount     numeric(12,2) not null check (amount <> 0),
  reason     text not null check (char_length(reason) between 1 and 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Who did what (privileged actions only — not every row change) ---------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
