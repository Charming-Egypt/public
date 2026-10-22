-- Journal posts get a database row like every other item (id + owner + status), so they can have owners and be approved the same way.
-- (Own file: a new enum value can't be used in the same transaction that adds it.)
alter type public.property_kind add value if not exists 'journal';
