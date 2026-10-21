# Payments Worker (`payments-worker.js`)

The only server code the site still needs: it holds the **Kashier secret** and the **Supabase service-role key**,
so neither ever reaches a browser. Everything else (accounts, catalog, bookings, finance) is Supabase.

| Route | What it does |
|---|---|
| `POST /api/kashier/hash` · `charge` · `charge-token` · `charge-status` | pay a booking (card / saved card / 3-D Secure) — the amount is read from the booking in the database, never from the browser |
| `POST /api/kashier/charge-balance*` | collect the remaining balance after a 50% deposit |
| `POST /api/kashier/wallet/*` | wallet payments + reconcile |
| `GET/DELETE /api/kashier/cards` | saved cards (stored by Kashier, not by us) |
| `POST /api/kashier/webhook` | Kashier → us. Signature checked, amount checked, idempotent |
| `POST /api/notify/voucher-link` · `resend` | printable voucher link / e-mail it again |

Every payment confirmation runs inside the database (`finalize_booking_payment`, row-locked), so a webhook and a
browser poll arriving together can never confirm the same booking twice or send two e-mails.

**Setup**: see `wrangler.payments.toml`. In the Kashier dashboard set the webhook URL to
`https://<your worker domain>/api/kashier/webhook`.

**Tests** (no network, no accounts needed): `node workers/tests/payments.test.mjs`
