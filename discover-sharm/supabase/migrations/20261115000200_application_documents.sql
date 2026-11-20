-- Seller applications now carry the identity document and the signed agreement; partner applications must carry the signed agreement.
alter table public.seller_applications
  add column if not exists documents jsonb not null default '[]'::jsonb check (pg_column_size(documents) <= 3000000);   -- [{name, data}] ; listings never select it

create or replace function public.submit_seller_application(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_prof public.profiles;
  v_ch   text[];
  v_row  public.seller_applications;
  v_docs jsonb := case when jsonb_typeof(p->'documents') = 'array' then p->'documents' else '[]'::jsonb end;
begin
  if v_uid is null then raise exception 'Login required' using errcode = '28000'; end if;
  select * into v_prof from public.profiles where id = v_uid;
  if not found or not v_prof.is_active then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_prof.is_seller then raise exception 'You are already a seller' using errcode = '22023'; end if;
  if v_prof.role <> 'user' then raise exception 'This account type cannot apply as a seller' using errcode = '22023'; end if;
  if exists (select 1 from public.seller_applications where user_id = v_uid and status = 'new') then
    raise exception 'You already have an application under review' using errcode = '23505';
  end if;
  if exists (select 1 from public.seller_applications where user_id = v_uid and status = 'rejected' and reviewed_at > now() - interval '7 days') then
    raise exception 'Please wait a few days before applying again' using errcode = '22023';
  end if;
  if coalesce((p->>'terms')::boolean, false) is not true then raise exception 'Please accept the programme terms' using errcode = '22023'; end if;

  -- an ID / passport photo and the signed agreement are mandatory
  if not exists (select 1 from jsonb_array_elements(v_docs) d where d->>'name' like 'idFront\_%' and length(coalesce(d->>'data', '')) > 100)
     or not exists (select 1 from jsonb_array_elements(v_docs) d where d->>'name' like 'signedContract\_%' and length(coalesce(d->>'data', '')) > 100) then
    raise exception 'Please upload your ID / passport photo and the signed agreement' using errcode = '22023';
  end if;

  select coalesce(array_agg(c), '{}') into v_ch
    from (select left(btrim(x), 30) c from jsonb_array_elements_text(coalesce(p->'channels', '[]'::jsonb)) x limit 10) q;

  insert into public.seller_applications (user_id, full_name, phone, whatsapp, city, experience, channels, link, message, documents)
  values (v_uid, left(btrim(coalesce(p->>'fullName', '')), 120), left(btrim(coalesce(p->>'phone', '')), 30),
          nullif(left(btrim(coalesce(p->>'whatsapp', '')), 30), ''), nullif(left(btrim(coalesce(p->>'city', '')), 80), ''),
          nullif(p->>'experience', ''), v_ch, nullif(left(btrim(coalesce(p->>'link', '')), 300), ''),
          nullif(left(btrim(coalesce(p->>'message', '')), 2000), ''), v_docs)
  returning * into v_row;
  perform public.audit('seller_application', 'seller_application', v_row.id::text, '{}'::jsonb);
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'createdAt', v_row.created_at);
end $$;
grant execute on function public.submit_seller_application(jsonb) to authenticated;

create or replace function public.admin_get_seller_application(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.seller_applications;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from public.seller_applications where id = p_id;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', v.id, 'fullName', v.full_name, 'documents', v.documents);
end $$;
grant execute on function public.admin_get_seller_application(uuid) to authenticated;

-- the list shows which documents came with each application (names only)
create or replace function public.admin_list_seller_applications(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'userId', a.user_id, 'fullName', a.full_name, 'phone', a.phone, 'whatsapp', a.whatsapp,
             'city', a.city, 'experience', a.experience, 'channels', a.channels, 'link', a.link, 'message', a.message,
             'email', pr.email, 'accountName', pr.display_name, 'completedBookings', pr.completed_bookings,
             'documents', (select coalesce(jsonb_agg(jsonb_build_object('name', d->>'name')), '[]'::jsonb) from jsonb_array_elements(a.documents) d),
             'status', a.status, 'adminNote', a.admin_note, 'createdAt', a.created_at, 'reviewedAt', a.reviewed_at) order by a.created_at desc)
      from public.seller_applications a join public.profiles pr on pr.id = a.user_id
     where p_status is null or a.status = p_status
  ), '[]'::jsonb);
end $$;
grant execute on function public.admin_list_seller_applications(text) to authenticated;

-- partner applications: the signed agreement and the owner / manager ID are required
create or replace function public.submit_partner_application(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_docs  jsonb := case when jsonb_typeof(p->'documents') = 'array' then p->'documents' else '[]'::jsonb end;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then raise exception 'Invalid email' using errcode = '22023'; end if;
  if not exists (select 1 from jsonb_array_elements(v_docs) d where d->>'name' like 'signedContract\_%' and length(coalesce(d->>'data', '')) > 100)
     or not exists (select 1 from jsonb_array_elements(v_docs) d where d->>'name' like 'ownerId\_%' and length(coalesce(d->>'data', '')) > 100) then
    raise exception 'Please upload the owner / manager ID and the signed agreement' using errcode = '22023';
  end if;
  if exists (select 1 from public.partner_applications where lower(email) = v_email and created_at > now() - interval '1 hour') then
    raise exception 'Too many requests' using errcode = 'P0001', detail = 'rate_limited';
  end if;
  insert into public.partner_applications (user_id, partner_type, business_name, contact_name, phone, email, message, documents)
  values (
    (select auth.uid()),
    left(btrim(coalesce(p->>'partnerType', '')), 40),
    left(btrim(coalesce(p->>'businessName', '')), 200),
    left(btrim(coalesce(p->>'contactName', '')), 120),
    left(btrim(coalesce(p->>'phone', '')), 30),
    v_email,
    left(p->>'message', 4000),
    v_docs
  );
end $$;
grant execute on function public.submit_partner_application(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
