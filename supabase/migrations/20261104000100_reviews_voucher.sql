-- =====================================================================
-- Reviews page: voucher-only, account-bound review submission
--
--   * lookup_review_voucher(p_voucher)  – the page asks "can I review this voucher?" (owner-only, no data leak)
--   * submit_review(p)                  – REPLACED: the reviewer's name / avatar come from the signed-in account,
--                                         never from the browser. Only rating + comment + photos are accepted.
--   * review_stats()                    – one aggregate for the summary card (avg, count, 1-5 star split)
--   * storage bucket `review-media`     – review photos, written only inside the uploader's own folder
-- Safe to re-run.
-- =====================================================================

-- ---------- photos ----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('review-media', 'review-media', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists review_media_insert on storage.objects;
create policy review_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'review-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists review_media_delete on storage.objects;
create policy review_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'review-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- can this account review this voucher? -----------------------------
-- The voucher number is the booking id. A voucher that belongs to someone else answers exactly like one that
-- does not exist ("not_found"), so the endpoint cannot be used to probe other people's bookings.
create or replace function public.lookup_review_voucher(p_voucher text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_raw   text := btrim(coalesce(p_voucher, ''));
  v_b     public.bookings;
  v_p     public.properties;
  v_name  text;
  v_day   date;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if v_raw !~ '^[A-Za-z0-9_-]{3,64}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;

  select * into v_b from public.bookings
   where id in (v_raw, upper(v_raw)) and user_id = v_uid and status <> 'pending_payment'
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_b.status <> 'completed' then return jsonb_build_object('ok', false, 'reason', 'not_paid'); end if;
  if v_b.reviewed then return jsonb_build_object('ok', false, 'reason', 'already_reviewed'); end if;

  v_day := coalesce(v_b.service_date, v_b.check_out, v_b.check_in);
  if v_day is not null and v_day > v_today then
    return jsonb_build_object('ok', false, 'reason', 'not_yet', 'date', v_day);
  end if;

  select * into v_p from public.properties where id = v_b.property_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_item'); end if;
  select display_name into v_name from public.profiles where id = v_uid;

  return jsonb_build_object(
    'ok', true, 'id', v_b.id, 'kind', v_b.kind, 'propertyId', v_p.id, 'title', coalesce(v_p.name, ''),
    'image', case when jsonb_typeof(v_p.data->'image') = 'string' then v_p.data->>'image' end,
    'date', v_day, 'reviewer', nullif(btrim(coalesce(v_name, '')), '')
  );
end $$;

-- ---------- submit: account decides WHO, the browser only says WHAT ----------
create or replace function public.submit_review(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_b       public.bookings;
  v_rating  integer;
  v_comment text := btrim(coalesce(p->>'comment', ''));
  v_images  jsonb := '[]'::jsonb;
  v_img     text;
  v_prefix  text;
  v_prof    public.profiles;
  v_row     public.reviews;
  v_day     date;
  v_today   date := (now() at time zone 'Africa/Cairo')::date;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  v_rating := public._req_int(p->>'rating', 1, 5, 'rating');
  if char_length(v_comment) < 10 or char_length(v_comment) > 1000 then
    raise exception 'Review must be 10 to 1000 characters' using errcode = '22023';
  end if;

  select * into v_b from public.bookings
   where id in (btrim(coalesce(p->>'bookingId', '')), upper(btrim(coalesce(p->>'bookingId', '')))) for update;
  if not found or v_b.user_id <> v_uid then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if v_b.status <> 'completed' then raise exception 'Only paid bookings can be reviewed' using errcode = 'P0001'; end if;
  if v_b.reviewed then raise exception 'Already reviewed' using errcode = '23505'; end if;
  if v_b.property_id is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  v_day := coalesce(v_b.service_date, v_b.check_out, v_b.check_in);
  if v_day is not null and v_day > v_today then raise exception 'Service has not taken place yet' using errcode = 'P0001'; end if;

  -- photos: only files this user uploaded to the review-media bucket (max 4)
  if jsonb_typeof(p->'images') = 'array' then
    if jsonb_array_length(p->'images') > 4 then raise exception 'Too many photos' using errcode = '22023'; end if;
    v_prefix := '/storage/v1/object/public/review-media/' || v_uid::text || '/';
    for v_img in select jsonb_array_elements_text(p->'images') loop
      if v_img ~ '^https://[^/ ]+' and position(v_prefix in v_img) > 0 and char_length(v_img) <= 600 then
        v_images := v_images || to_jsonb(v_img);
      end if;
    end loop;
  end if;

  select * into v_prof from public.profiles where id = v_uid;

  insert into public.reviews (property_id, user_id, booking_id, rating, name, comment, photo_url, images)
  values (
    v_b.property_id, v_uid, v_b.id, v_rating,
    left(coalesce(nullif(btrim(v_prof.display_name), ''), 'Guest'), 120),
    v_comment,
    case when coalesce(v_prof.avatar_url, '') ~ '^https://' then left(v_prof.avatar_url, 2048) end,
    v_images
  ) returning * into v_row;

  update public.bookings set reviewed = true where id = v_b.id;
  update public.properties
     set rating_count = rating_count + 1,
         rating_avg = round(((rating_avg * rating_count) + v_rating) / (rating_count + 1), 2)
   where id = v_b.property_id;
  return jsonb_build_object('success', true, 'id', v_row.id);
end $$;

-- ---------- summary numbers (RLS still applies: only published reviews of published items) ------
create or replace function public.review_stats()
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'count', count(*),
    'avg', coalesce(round(avg(r.rating)::numeric, 2), 0),
    'stars', jsonb_build_object(
      '5', count(*) filter (where r.rating = 5), '4', count(*) filter (where r.rating = 4),
      '3', count(*) filter (where r.rating = 3), '2', count(*) filter (where r.rating = 2),
      '1', count(*) filter (where r.rating = 1)),
    'photos', count(*) filter (where jsonb_array_length(r.images) > 0)
  )
  from public.reviews r join public.properties p on p.id = r.property_id
  where r.status = 'published' and p.status = 'published'
$$;

grant execute on function public.lookup_review_voucher(text) to authenticated;
grant execute on function public.submit_review(jsonb)        to authenticated;
grant execute on function public.review_stats()              to anon, authenticated;
