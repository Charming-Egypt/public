-- Affiliate programme: a customer with a normal account applies to work with us as a seller.
--  * seller_applications: one open ("new") application per user; the admin approves (the account becomes a seller with a code
--    and an optional personal commission) or rejects with a note.
--  * The applicant only ever sees his own latest application; the admin sees all of them.

create table if not exists public.seller_applications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  full_name    text not null check (char_length(full_name) between 2 and 120),
  phone        text not null check (char_length(phone) between 6 and 30),
  whatsapp     text check (whatsapp is null or char_length(whatsapp) <= 30),
  city         text check (city is null or char_length(city) <= 80),
  experience   text check (experience is null or experience in ('none', 'some', 'pro')),
  channels     text[] not null default '{}' check (cardinality(channels) <= 10),
  link         text check (link is null or char_length(link) <= 300),
  message      text check (message is null or char_length(message) <= 2000),
  status       text not null default 'new' check (status in ('new', 'approved', 'rejected')),
  admin_note   text check (admin_note is null or char_length(admin_note) <= 1000),
  reviewed_by  uuid references public.profiles (id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists seller_applications_one_open on public.seller_applications (user_id) where status = 'new';
create index if not exists seller_applications_status_idx on public.seller_applications (status, created_at desc);

alter table public.seller_applications enable row level security;
-- no direct table access for clients: everything goes through the functions below
revoke all on public.seller_applications from anon, authenticated;

create or replace function public.submit_seller_application(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_prof public.profiles;
  v_ch   text[];
  v_row  public.seller_applications;
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

  select coalesce(array_agg(c), '{}') into v_ch
    from (select left(btrim(x), 30) c from jsonb_array_elements_text(coalesce(p->'channels', '[]'::jsonb)) x limit 10) q;

  insert into public.seller_applications (user_id, full_name, phone, whatsapp, city, experience, channels, link, message)
  values (v_uid, left(btrim(coalesce(p->>'fullName', '')), 120), left(btrim(coalesce(p->>'phone', '')), 30),
          nullif(left(btrim(coalesce(p->>'whatsapp', '')), 30), ''), nullif(left(btrim(coalesce(p->>'city', '')), 80), ''),
          nullif(p->>'experience', ''), v_ch, nullif(left(btrim(coalesce(p->>'link', '')), 300), ''),
          nullif(left(btrim(coalesce(p->>'message', '')), 2000), ''))
  returning * into v_row;
  perform public.audit('seller_application', 'seller_application', v_row.id::text, '{}'::jsonb);
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'createdAt', v_row.created_at);
end $$;
grant execute on function public.submit_seller_application(jsonb) to authenticated;

-- the applicant's own latest application (null when he never applied)
create or replace function public.my_seller_application()
returns jsonb language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('id', a.id, 'status', a.status, 'createdAt', a.created_at, 'reviewedAt', a.reviewed_at,
                  'note', case when a.status = 'rejected' then a.admin_note end)
            from public.seller_applications a where a.user_id = (select auth.uid()) order by a.created_at desc limit 1)
$$;
grant execute on function public.my_seller_application() to authenticated;

create or replace function public.admin_list_seller_applications(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'userId', a.user_id, 'fullName', a.full_name, 'phone', a.phone, 'whatsapp', a.whatsapp,
             'city', a.city, 'experience', a.experience, 'channels', a.channels, 'link', a.link, 'message', a.message,
             'email', pr.email, 'accountName', pr.display_name, 'completedBookings', pr.completed_bookings,
             'status', a.status, 'adminNote', a.admin_note, 'createdAt', a.created_at, 'reviewedAt', a.reviewed_at) order by a.created_at desc)
      from public.seller_applications a join public.profiles pr on pr.id = a.user_id
     where p_status is null or a.status = p_status
  ), '[]'::jsonb);
end $$;
grant execute on function public.admin_list_seller_applications(text) to authenticated;

-- approve (the account becomes a seller: code + optional personal commission in percent) or reject (with a note)
create or replace function public.admin_decide_seller_application(p_id uuid, p_approve boolean, p_note text default null, p_commission numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_a public.seller_applications;
begin
  if not (select public.is_super_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_commission is not null and (p_commission < 0 or p_commission > 100) then raise exception 'Invalid commission' using errcode = '22023'; end if;
  select * into v_a from public.seller_applications where id = p_id for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  if p_approve then
    update public.profiles
       set is_seller = true,
           seller_code = coalesce(seller_code, public.gen_seller_code()),
           commission_rate = case when p_commission is not null then p_commission / 100 else commission_rate end
     where id = v_a.user_id and role <> 'super_admin';
    if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
    insert into public.notifications (user_id, icon, title, msg)
    values (v_a.user_id, 'fa-handshake', 'Welcome to the affiliate programme',
            'Your seller application was approved. Open the seller dashboard to get your code and start earning commission.');
  else
    insert into public.notifications (user_id, icon, title, msg)
    values (v_a.user_id, 'fa-circle-info', 'Seller application update',
            left('Your seller application was not approved this time.' || coalesce(' ' || nullif(btrim(p_note), ''), ''), 1000));
  end if;
  update public.seller_applications
     set status = case when p_approve then 'approved' else 'rejected' end, admin_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
         reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_id;
  perform public.audit('seller_application_decided', 'seller_application', p_id::text, jsonb_build_object('approved', p_approve, 'commission', p_commission));
end $$;
grant execute on function public.admin_decide_seller_application(uuid, boolean, text, numeric) to authenticated;

notify pgrst, 'reload schema';
