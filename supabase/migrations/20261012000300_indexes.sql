-- =====================================================================
-- Part 3/5: indexes — only the ones a real query uses.
--
-- Principles (to keep storage, write cost and memory low):
--  * PARTIAL indexes: published catalog rows, non-pending bookings, open
--    queues. They are a fraction of the table and cost nothing on the rows
--    that do not match.
--  * Every index leads with the column the query filters on, followed by the
--    sort column, so `where owner_id = $1 order by created_at desc limit 20`
--    is a single index range scan with no sort step.
--  * BRIN (a few KB) for append-only "delete old rows" housekeeping.
--  * Deliberately NOT indexed: foreign keys of parents that are never
--    deleted (properties are archived, not removed), JSON `data` columns
--    (a GIN index would cost more than the whole catalog), low-cardinality
--    booleans/enums on their own.
-- Primary keys / unique constraints already provide: favorites(user_id, property_id),
-- reviews(booking_id), site_content(kind, id), bookings(id), properties(id).
-- =====================================================================

-- catalog lists: where kind = $1 and status = 'published' order by sort_order
create index properties_public_list_idx   on public.properties (kind, sort_order, created_at) where status = 'published';
-- owner dashboard + the RLS check "owner_id = auth.uid()"
create index properties_owner_idx         on public.properties (owner_id, kind) where owner_id is not null;
-- super-admin review queue (a handful of rows)
create index properties_review_queue_idx  on public.properties (created_at) where status = 'pending_review';

-- "my bookings"
create index bookings_user_idx            on public.bookings (user_id, created_at desc) where user_id is not null;
-- owner inbox + owner_balance(); matches the owner RLS predicate exactly
create index bookings_owner_idx           on public.bookings (owner_id, created_at desc) where owner_id is not null and status <> 'pending_payment';
-- admin lists / 30-day stats, without the unpaid checkout sessions
create index bookings_recent_idx          on public.bookings (created_at desc) where status <> 'pending_payment';
-- housekeeping() drops stale unpaid sessions: tiny, only holds pending rows
create index bookings_pending_expiry_idx  on public.bookings (expires_at) where status = 'pending_payment';

-- property page: latest published reviews
create index reviews_property_idx         on public.reviews (property_id, created_at desc) where status = 'published';

-- notification bell: latest 50 for one user
create index notifications_user_idx       on public.notifications (user_id, created_at desc);
create index notifications_created_brin   on public.notifications using brin (created_at);

-- throttling + owner activation by e-mail
create index contact_messages_email_idx   on public.contact_messages (lower(email), created_at desc);
create index contact_messages_created_brin on public.contact_messages using brin (created_at);
create index partner_applications_email_idx on public.partner_applications (lower(email), created_at desc);
create index partner_applications_pending_idx on public.partner_applications (created_at) where status = 'pending';

-- admin: customers / owners
create index profiles_email_idx           on public.profiles (lower(email));
create index profiles_created_idx         on public.profiles (created_at desc);
create index profiles_staff_idx           on public.profiles (role) where role <> 'user';

-- payouts
create index payouts_owner_idx            on public.payouts (owner_id, requested_at desc);
create index payouts_open_idx             on public.payouts (requested_at) where status = 'requested';

-- audit_log is read newest-first through its primary key (order by id desc);
-- the BRIN only serves the retention delete
create index audit_log_created_brin       on public.audit_log using brin (created_at);
