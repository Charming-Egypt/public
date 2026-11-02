-- =====================================================================================================================
-- Item content moves to a private GitHub repo (api/<category>/{id}.json), written ONLY by the content Worker (service role).
-- The database keeps: id, owner, status, ratings, sort/featured/commission, and in `data` just the fields the booking code checks
-- (name, category, price, rooms, unavailableDates). Old rows keep their full `data` — harmless, and the Worker serves them until the export is done.
-- =====================================================================================================================

-- 1. an owner's edit of an already-published item waits in api/<cat>/{id}.draft.json; this flag tells the admin queue
alter table public.properties add column if not exists has_draft boolean not null default false;
create index if not exists properties_has_draft_idx on public.properties (updated_at) where has_draft;

-- 2. browsers can no longer write items directly (that would bypass GitHub, the publish step and the price check)
drop policy if exists properties_insert on public.properties;
drop policy if exists properties_update on public.properties;
drop policy if exists properties_delete on public.properties;
revoke insert, update, delete on public.properties from anon, authenticated;

-- 3. ...nor flip status/owner through the old RPCs: the Worker does it together with the GitHub file
revoke execute on function public.submit_property_for_review(text) from authenticated;
revoke execute on function public.admin_set_property_status(text, public.listing_status) from authenticated;
revoke execute on function public.admin_set_property_meta(text, uuid, boolean, boolean, integer, numeric) from authenticated;
revoke execute on function public.owner_archive_property(text) from authenticated;

-- Commission is money, not content: the super admin still sets it from the console through this narrow RPC.
create or replace function public.admin_set_property_commission(p_id text, p_commission numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_commission is not null and (p_commission < 0 or p_commission > 1) then raise exception 'commission must be between 0 and 1' using errcode = '22023'; end if;
  update public.properties set commission_rate = p_commission where id = p_id;
  if not found then raise exception 'Listing not found' using errcode = 'P0002'; end if;
  perform public.audit('property_commission', 'property', p_id, jsonb_build_object('commission', p_commission));
end $$;
grant execute on function public.admin_set_property_commission(text, numeric) to authenticated;

-- The public (anon) read policy stays: the website still reads rating_avg / rating_count from here, and create_booking reads price + rooms.
