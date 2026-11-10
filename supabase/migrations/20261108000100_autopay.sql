-- Automatic collection of the remaining balance from the card the customer agreed to (Kashier agreement + token, merchant-initiated "CONTAUTH" charge).
-- Nothing happens unless the payments Worker has AUTO_BALANCE=on and the customer ticked the consent box at checkout.
-- Tokens live in a table nobody but the service role can read.

create table if not exists public.booking_autopay (
  booking_id      text primary key,
  user_id         uuid,
  consented_at    timestamptz,
  card_token      text,
  agreement_id    text,
  masked_card     text,
  attempts        smallint not null default 0,
  last_attempt_at timestamptz,
  last_error      text,
  updated_at      timestamptz not null default now()
);
alter table public.booking_autopay enable row level security;      -- no policies: not readable or writable through the API
revoke all on public.booking_autopay from public, anon, authenticated;

create or replace function public.autopay_upsert(p_id text, p_uid uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_autopay (booking_id, user_id, consented_at, card_token, agreement_id, masked_card, last_error)
  values (p_id, p_uid, case when coalesce((p_patch->>'consent')::boolean, false) then now() end,
          p_patch->>'card_token', p_patch->>'agreement_id', p_patch->>'masked_card', p_patch->>'last_error')
  on conflict (booking_id) do update set
    consented_at = coalesce(public.booking_autopay.consented_at, excluded.consented_at),
    card_token   = coalesce(excluded.card_token, public.booking_autopay.card_token),
    agreement_id = coalesce(excluded.agreement_id, public.booking_autopay.agreement_id),
    masked_card  = coalesce(excluded.masked_card, public.booking_autopay.masked_card),
    last_error   = coalesce(excluded.last_error, public.booking_autopay.last_error),
    updated_at   = now();
end $$;
create or replace function public.autopay_get(p_id text) returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(a) from public.booking_autopay a where a.booking_id = p_id
$$;
revoke all on function public.autopay_upsert(text, uuid, jsonb), public.autopay_get(text) from public, anon, authenticated;
grant execute on function public.autopay_upsert(text, uuid, jsonb), public.autopay_get(text) to service_role;

create or replace function public.balance_job() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_auto boolean; v_cancel jsonb; v_rem jsonb; v_pay jsonb;
begin
  select balance_auto_cancel into v_auto from public.platform_settings where id = 1;
  with c as (
    update public.bookings
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'balance_unpaid', needs_refund = false
     where coalesce(v_auto, false) and status = 'completed' and payment_plan = 'deposit' and remaining_amount > 0
       and coalesce(data->>'balanceStatus', '') <> 'paid' and balance_due_at is not null and balance_due_at <= now()
       and owner_status is distinct from 'done'
    returning id, data->>'email' as email, data->>'name' as name, kind, remaining_amount, currency
  ) select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cancel from c;

  with r as (
    select id, case when balance_due_at - now() <= interval '24 hours' then 2 else 1 end as n
      from public.bookings
     where status = 'completed' and payment_plan = 'deposit' and remaining_amount > 0 and coalesce(data->>'balanceStatus', '') <> 'paid'
       and balance_due_at is not null and balance_due_at > now() and balance_due_at - now() <= interval '72 hours'
       and balance_reminders < case when balance_due_at - now() <= interval '24 hours' then 2 else 1 end
       and not (balance_due_at - now() <= interval '24 hours' and exists (select 1 from public.booking_autopay ap where ap.booking_id = bookings.id and ap.card_token is not null and ap.agreement_id is not null))
       for update skip locked
  ), u as (
    update public.bookings b set balance_reminders = r.n from r where b.id = r.id
    returning b.id, b.data->>'email' as email, b.data->>'name' as name, b.kind, b.remaining_amount, b.currency, b.balance_due_at as due_at, r.n,
      (select ap.masked_card from public.booking_autopay ap where ap.booking_id = b.id and ap.card_token is not null and ap.agreement_id is not null) as autopay_card
  ) select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) into v_rem from u;

  -- automatic charges: within 24h of the deadline (and at least 12h after the customer agreed), a second try inside the last 6h
  with a as (
    select b.id, ap.user_id, ap.card_token, ap.agreement_id
      from public.bookings b join public.booking_autopay ap on ap.booking_id = b.id
     where b.status = 'completed' and b.payment_plan = 'deposit' and b.remaining_amount > 0 and coalesce(b.data->>'balanceStatus', '') <> 'paid'
       and ap.card_token is not null and ap.agreement_id is not null and ap.consented_at <= now() - interval '12 hours'
       and b.balance_due_at is not null and b.balance_due_at > now() and b.balance_due_at - now() <= interval '24 hours'
       and ap.attempts < case when b.balance_due_at - now() <= interval '6 hours' then 2 else 1 end
       and (ap.last_attempt_at is null or ap.last_attempt_at < now() - interval '3 hours')
       for update of ap skip locked
  ), u as (
    update public.booking_autopay ap set attempts = ap.attempts + 1, last_attempt_at = now(), updated_at = now() from a where ap.booking_id = a.id
    returning ap.booking_id as id, a.user_id as uid, a.card_token, a.agreement_id, ap.masked_card
  ) select coalesce(jsonb_agg(to_jsonb(u) || jsonb_build_object('remaining_amount', b.remaining_amount, 'currency', b.currency, 'email', b.data->>'email', 'name', b.data->>'name', 'due_at', b.balance_due_at)), '[]'::jsonb)
      into v_pay from u join public.bookings b on b.id = u.id;

  return jsonb_build_object('cancelled', v_cancel, 'reminders', v_rem, 'autopay', v_pay);
end $$;
revoke all on function public.balance_job() from public, anon, authenticated;
grant execute on function public.balance_job() to service_role;
