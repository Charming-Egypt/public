-- Web Push: one row per browser/device subscription.
-- The browser calls save_push_subscription() / delete_push_subscription() (security definer, so the table itself stays closed).
-- The Edge Function `send-push` (service role) reads the table and delivers a push for every new row in public.notifications.

create table if not exists public.push_subscriptions (
  endpoint   text primary key check (char_length(endpoint) between 10 and 2000),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  lang       text check (lang in ('en','ar','ru','de','it','tr')),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;   -- no policies: only the functions below / the service role can touch it
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.save_push_subscription(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_ep  text := p #>> '{subscription,endpoint}';
  v_k1  text := p #>> '{subscription,keys,p256dh}';
  v_k2  text := p #>> '{subscription,keys,auth}';
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_ep is null or v_ep !~ '^https://' or v_k1 is null or v_k2 is null then raise exception 'Invalid subscription' using errcode = '22023'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, lang, user_agent)
  values (v_ep, v_uid, v_k1, v_k2, nullif(p->>'lang', ''), left(p->>'ua', 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        lang = excluded.lang, user_agent = excluded.user_agent, last_seen = now();
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke all on function public.save_push_subscription(jsonb)  from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(jsonb)  to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
