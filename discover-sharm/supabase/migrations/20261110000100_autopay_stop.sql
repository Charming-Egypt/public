-- Autopay: an unconfirmed charge (gateway timeout / PENDING / UNKNOWN) must never be retried automatically (risk of a double charge).
-- autopay_upsert now accepts {"stop": true} which uses up the remaining attempts; the webhook / reconciliation settles the booking.
create or replace function public.autopay_upsert(p_id text, p_uid uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.booking_autopay (booking_id, user_id, consented_at, card_token, agreement_id, masked_card, last_error, attempts)
  values (p_id, p_uid, case when coalesce((p_patch->>'consent')::boolean, false) then now() end,
          p_patch->>'card_token', p_patch->>'agreement_id', p_patch->>'masked_card', p_patch->>'last_error',
          case when coalesce((p_patch->>'stop')::boolean, false) then 9 else 0 end)
  on conflict (booking_id) do update set
    consented_at = coalesce(public.booking_autopay.consented_at, excluded.consented_at),
    card_token   = coalesce(excluded.card_token, public.booking_autopay.card_token),
    agreement_id = coalesce(excluded.agreement_id, public.booking_autopay.agreement_id),
    masked_card  = coalesce(excluded.masked_card, public.booking_autopay.masked_card),
    last_error   = coalesce(excluded.last_error, public.booking_autopay.last_error),
    attempts     = case when coalesce((p_patch->>'stop')::boolean, false) then 9 else public.booking_autopay.attempts end,
    updated_at   = now();
end $$;
