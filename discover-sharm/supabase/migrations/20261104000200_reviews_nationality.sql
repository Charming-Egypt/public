-- 2026-11-04 — reviewer nationality (ISO 3166-1 alpha-2) shown as flag + country on review cards.
-- Safe to re-run. Run in the SQL Editor after 20261104000100_reviews_voucher.sql.
alter table public.reviews add column if not exists nationality text;
do $$ begin
  alter table public.reviews add constraint reviews_nationality_chk check (nationality is null or nationality ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

create or replace function public.submit_review(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := (select auth.uid());
  v_b       public.bookings;
  v_rating  integer;
  v_comment text := btrim(coalesce(p->>'comment', ''));
  v_nat     text := upper(btrim(coalesce(p->>'nationality', '')));
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
  if v_nat !~ '^[A-Z]{2}$' then v_nat := null; end if;

  select * into v_b from public.bookings
   where id in (btrim(coalesce(p->>'bookingId', '')), upper(btrim(coalesce(p->>'bookingId', '')))) for update;
  if not found or v_b.user_id <> v_uid then raise exception 'Booking not found' using errcode = 'P0002'; end if;
  if v_b.status <> 'completed' then raise exception 'Only paid bookings can be reviewed' using errcode = 'P0001'; end if;
  if v_b.reviewed then raise exception 'Already reviewed' using errcode = '23505'; end if;
  if v_b.property_id is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  v_day := coalesce(v_b.service_date, v_b.check_out, v_b.check_in);
  if v_day is not null and v_day > v_today then raise exception 'Service has not taken place yet' using errcode = 'P0001'; end if;

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

  insert into public.reviews (property_id, user_id, booking_id, rating, name, nationality, comment, photo_url, images)
  values (
    v_b.property_id, v_uid, v_b.id, v_rating,
    left(coalesce(nullif(btrim(v_prof.display_name), ''), 'Guest'), 120),
    v_nat,
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
grant execute on function public.submit_review(jsonb) to authenticated;
