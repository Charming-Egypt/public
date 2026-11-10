/**
 * Discover Sharm — payments worker, Supabase edition (single file, no imports)
 * Paste this whole file into the Cloudflare dashboard editor, or deploy with wrangler (see wrangler.payments.toml).
 */

// ==================== shared helpers ====================
/**
 * Discover Sharm — shared helpers used by every split worker.
 * Each worker below imports only what it needs from this file.
 * Wrangler bundles this in at deploy time — it does NOT become a shared
 * runtime dependency, so each worker stays fully independent in production.
 */


import { sendSmtp } from './lib/smtp.js';
const ALLOWED_ORIGINS = new Set([
  'https://www.discover-sharm.com',
  'https://discover-sharm.com',
  'https://app.discover-sharm.com',
]);

function corsHeadersForRequest(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  } else {
    headers['Access-Control-Allow-Origin'] = 'null';
  }
  return headers;
}

function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (request) Object.assign(headers, corsHeadersForRequest(request));
  return new Response(JSON.stringify(data), { status, headers });
}

// ---------------------------------------------------------------------
// Rate limiting.
// Every split worker gets ITS OWN limiter call, so a burst against one
// group (e.g. payments) can never eat into another group's quota (e.g.
// public content reads) the way one shared counter used to.
//
// Falls back to an in-memory Map (fine for a quick smoke test, but it
// resets whenever Cloudflare spins a fresh isolate and is NOT shared
// across edge locations, so it under-counts in production). Bind a KV
// namespace called RATE_LIMIT_KV to each worker for a real distributed
// limit — the function uses it automatically when present.
// ---------------------------------------------------------------------
const _memoryRateLimit = new Map();

async function isRateLimited(request, env, bucket, limit, windowSeconds, memoryOnly) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `rl:${bucket}:${ip}`;

  if (env.RATE_LIMIT_KV && !memoryOnly) {
    // A rate limiter is a soft protection, not a security boundary — it must
    // never be able to take the whole site down. The free plan caps KV writes
    // at 1,000/day account-wide, and this is called on every request, so that
    // cap can be reached fast. If KV throws for any reason (quota, outage,
    // ...), fail OPEN — serve the request normally — rather than letting an
    // uncaught error crash every request once the quota is hit.
    try {
      const current = await env.RATE_LIMIT_KV.get(key);
      const count = current ? parseInt(current, 10) : 0;
      if (count >= limit) return true;
      // expirationTtl resets the window on the first hit; a small race
      // between concurrent requests can under-count by one or two, which
      // is an acceptable trade-off for a rate limit (not a security check).
      await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: windowSeconds });
      return false;
    } catch (e) {
      return false;
    }
  }

  const now = Date.now();
  const entry = _memoryRateLimit.get(key);
  if (!entry || now > entry.resetTime) {
    _memoryRateLimit.set(key, { count: 1, resetTime: now + windowSeconds * 1000 });
    return false;
  }
  if (entry.count >= limit) return true;
  entry.count++;
  return false;
}

// ---------------------------------------------------------------------
// Supabase: who is calling, and the booking store.
//   SUPABASE_URL                 https://<project>.supabase.co
//   SUPABASE_ANON_KEY            public key (used only to ask Supabase "whose token is this?")
//   SUPABASE_SERVICE_ROLE_KEY    SECRET — lets this Worker call the payment RPCs. Set it as a Worker secret.
// ---------------------------------------------------------------------
const _tokenCache = new Map();   // token -> { uid, until }  (60 s: one /auth/v1/user call per burst of requests)

function supabaseBase(env) {
  if (!env.SUPABASE_URL) throw Object.assign(new Error('SUPABASE_URL not configured'), { status: 500 });
  return env.SUPABASE_URL.replace(/\/$/, '');
}

// Verified by Supabase itself (works for HS256 and the newer asymmetric signing keys alike).
async function requireUid(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer /i, '').trim();
  if (!token) { const e = new Error('Unauthorized'); e.status = 401; throw e; }
  const hit = _tokenCache.get(token);
  if (hit && hit.until > Date.now()) return hit.uid;
  const res = await fetch(`${supabaseBase(env)}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { const e = new Error('Unauthorized'); e.status = 401; throw e; }
  const user = await res.json().catch(() => null);
  if (!user || !user.id) { const e = new Error('Unauthorized'); e.status = 401; throw e; }
  if (_tokenCache.size > 500) _tokenCache.clear();
  _tokenCache.set(token, { uid: user.id, until: Date.now() + 60 * 1000 });
  return user.id;
}

// Calls a SERVICE-ROLE-only Postgres function (see supabase/migrations/20261012000600_payments.sql).
async function sbRpc(env, fn, args) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  const res = await fetch(`${supabaseBase(env)}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${fn} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------
// Kashier crypto helpers
// ---------------------------------------------------------------------
async function hmacSha256Hex(message, key) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function generateKashierHash(orderId, amount, currency, merchantId, apiKey) {
  return hmacSha256Hex(`/?payment=${merchantId}.${orderId}.${amount}.${currency}`, apiKey);
}
async function kashierPaymentHash(mid, reference, amount, currency, apiKey, customerReference) {
  const path = `/?payment=${mid}.${reference}.${amount}.${currency}${customerReference ? '.' + customerReference : ''}`;
  return hmacSha256Hex(path, apiKey);
}
async function kashierTokenizationHash(mid, customerReference, apiKey) {
  return hmacSha256Hex(`/?tokenization=${mid}.${customerReference}`, apiKey);
}
function kashierFepBase(env) {
  return (env.KASHIER_MODE || 'live') === 'test' ? 'https://test-fep.kashier.io' : 'https://fep.kashier.io';
}
// Automatic collection of the remaining balance (Kashier agreement + saved token, merchant-initiated charge). OFF unless AUTO_BALANCE=on.
const autoBalanceOn = (env) => String(env.AUTO_BALANCE || '').toLowerCase() === 'on';
async function autopaySave(env, orderId, uid, patch) {
  try { await sbRpc(env, 'autopay_upsert', { p_id: orderId, p_uid: uid || null, p_patch: patch }); } catch (e) { console.log('autopay save failed', e && e.message); }
}
// Saving the card — Kashier's documented flow (confirmed by Kashier support): the DEPOSIT is paid through a hosted Payment Session created with
// saveCard=forced, interactionSource=RECURRING, enable3DS=true and an `agreement`. The saved token + agreement id then arrive on the webhook.
// (No raw card data ever touches this Worker on this path.)
const kashierApiBase = (env) => (env.KASHIER_MODE || 'live') === 'test' ? 'https://test-api.kashier.io' : 'https://api.kashier.io';
const _ymd = (d) => d.toISOString().slice(0, 10);
// The agreement terms are set per account with the Kashier account manager: override the whole object with the AUTOPAY_AGREEMENT env var (JSON).
function autopayAgreement(env, booking) {
  if (env.AUTOPAY_AGREEMENT) { try { return JSON.parse(env.AUTOPAY_AGREEMENT); } catch (e) { console.log('AUTOPAY_AGREEMENT is not valid JSON'); } }
  const day = String(booking.checkin || booking.date || '').slice(0, 10);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(day + 'T00:00:00Z') : new Date();
  end.setUTCDate(end.getUTCDate() + 1);
  return { type: 'UNSCHEDULED', amountVariability: 'VARIABLE', maximumAmountPerPayment: String(booking.remainingAmount), numberOfPayments: 1, expiryDate: _ymd(end) };   // defaults until the account manager confirms the values
}
async function createAutopaySession(env, { booking, orderId, uid, email, amount, currency, lang, origin }) {
  const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY, secret = env.KASHIER_SECRET_KEY;
  if (!merchantId || !apiKey || !secret) throw new Error('Kashier not configured');
  const body = {
    merchantId, order: orderId, amount: String(amount), currency, mode: (env.KASHIER_MODE || 'live') === 'test' ? 'test' : 'live',
    type: 'one-time', display: lang === 'ar' ? 'ar' : 'en', maxFailureAttempts: 3, allowedMethods: 'card',
    description: booking.type ? `${booking.type} booking - deposit` : 'deposit',
    merchantRedirect: `${_appUrl(env)}/?ds_pay=${encodeURIComponent(orderId)}`,
    serverWebhook: `${origin}/api/kashier/webhook`,
    customer: { reference: uid, email: email || undefined },
    saveCard: 'forced', interactionSource: 'RECURRING', enable3DS: true,
    agreement: autopayAgreement(env, booking),
    expireAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  const res = await fetch(`${kashierApiBase(env)}/v3/payment/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: secret, 'api-key': apiKey }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.sessionUrl) { console.log('autopay session failed', res.status, JSON.stringify(data).slice(0, 300)); throw new Error('Could not start the secure payment page'); }
  return data.sessionUrl;
}
// The webhook that follows a saveCard=forced payment carries the token and the agreement id. Kashier's docs name them cardToken / cardDataToken and
// agreement(.id|Id), so look for any of those anywhere in `data` instead of relying on one exact path.
function extractTokenInfo(data) {
  let token = null, agreement = null, masked = null;
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 5) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && v) {
        if (/^(cardToken|cardDataToken)$/i.test(k)) token = token || v;
        else if (/^agreementId$/i.test(k)) agreement = agreement || v;
        else if (/^maskedCard$/i.test(k)) masked = masked || v;
      } else if (v && typeof v === 'object') {
        if (/^agreement$/i.test(k) && typeof v.id === 'string') agreement = agreement || v.id;
        walk(v, depth + 1);
      }
    }
  };
  walk(data, 0);
  return token && agreement ? { card_token: token, agreement_id: agreement, masked_card: masked } : null;
}
// Merchant-initiated charge of the remaining balance (no CVV, no 3DS). Same "{orderId}-BAL" reference as the manual flow, so the webhook handles it too.
async function chargeAutopay(env, x) {
  const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
  if (!merchantId || !apiKey) return 'failed';
  const ref = `${x.id}-BAL${Date.now()}`, amount = String(x.remaining_amount), currency = x.currency || 'EGP';
  const hash = await kashierPaymentHash(merchantId, ref, amount, currency, apiKey, x.uid);
  const payload = {
    apiOperation: 'PAY',
    paymentMethod: { type: 'CARD', card: { agreement: { id: x.agreement_id }, enable3DS: false, cardToken: x.card_token } },
    order: { reference: ref, amount, currency, description: 'remaining balance (automatic)' },
    interactionSource: env.AUTOPAY_INTERACTION || 'CONTAUTH',   // confirmed by Kashier support: RECURRING when saving the card, CONTAUTH for the later token charge
    reconciliation: { webhookUrl: `${(env.PAYMENTS_URL || 'https://pay.discover-sharm.com').replace(/\/$/, '')}/api/kashier/webhook`, merchantRedirect: '' },
    merchantId, customer: { reference: x.uid },
    timestamp: new Date().toISOString(),   // listed as required in the Pay-with-token request schema
  };
  let res, data;
  try {
    res = await fetch(`${kashierFepBase(env)}/v3/orders/`, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json', 'Kashier-Hash': hash }, body: JSON.stringify(payload) });
    data = await res.json();
  } catch (e) { await autopaySave(env, x.id, x.uid, { last_error: 'gateway unreachable - unconfirmed, not retried', stop: true }); return 'failed'; }
  const r = data?.response || {};
  if (r.authentication?.redirectUrl) { await autopaySave(env, x.id, x.uid, { last_error: '3ds requested' }); return 'failed'; }   // a customer-absent charge cannot complete 3DS
  const final = await finalizeBalancePayment(x.id, r.status || r.result, env);
  if (res.ok && final === 'paid') return 'paid';
  const st = String(r.status || r.result || '').toUpperCase();
  if (st === 'PENDING' || st === 'INITIATED' || st === 'UNKNOWN') { await autopaySave(env, x.id, x.uid, { last_error: 'unconfirmed (' + st + ') - not retried', stop: true }); return 'failed'; }   // never retry an unknown outcome
  await autopaySave(env, x.id, x.uid, { last_error: String(r.transactionResponseMessage?.en || r.status || r.result || res.status).slice(0, 200) });
  return 'failed';
}
function sanitizeKashierResponse(resp) {
  const r = resp?.response || {};
  const card = r.paymentMethod?.card;
  return {
    result: r.result, status: r.status, transactionId: r.transactionId,
    orderId: r.orderId, merchantOrderId: r.merchantOrderId,
    maskedCard: card?.number, cardBrand: card?.cardBrand, cardToken: card?.cardToken,
    authentication: r.authentication?.redirectUrl ? { redirectUrl: r.authentication.redirectUrl } : undefined,
    message: r.transactionResponseMessage?.en || resp?.messages?.en,
  };
}
// ---------------------------------------------------------------------
// PAY FIRST, SAVE AFTER.
// create_booking() (in the database) stores the booking as status 'pending_payment': a private checkout
// session that owners never see and that housekeeping() discards if it is not paid. On a confirmed payment
// (card response, wallet reconcile or Kashier webhook) finalize_booking_payment() turns it into a real
// booking atomically and exactly once, updates the customer's stats and notifies the owner. Only the call
// that actually made the transition (created = true) sends the confirmation e-mail.
// ---------------------------------------------------------------------
async function getOrder(orderId, env) {
  const r = await sbRpc(env, 'service_get_order', { p_id: orderId });
  return { booking: r?.booking || null, pending: !!r?.pending };
}
async function patchBooking(orderId, patch, env) {
  await sbRpc(env, 'service_patch_booking', { p_id: orderId, p_patch: patch });
}
// A booking that is already paid (not a checkout session) — the only kind the balance flow may touch.
async function getPaidBooking(orderId, env) { const o = await getOrder(orderId, env); return o.pending ? null : o.booking; }
// What the guest owes RIGHT NOW: the full total, or the 50% deposit (booking.amountDueNow).
function payableNow(booking) { return booking.amountDueNow != null ? booking.amountDueNow : booking.total; }
// The later balance-collection charge uses "{orderId}-BAL" as its own Kashier order reference
// (Kashier rejects a reused one) — these map it back.
function isBalanceRef(reference) { return typeof reference === 'string' && /-BAL\d*$/.test(reference); }   // '-BAL' (manual) or '-BAL<timestamp>' (automatic attempts)
function baseOrderId(reference) { return isBalanceRef(reference) ? reference.replace(/-BAL\d*$/, '') : reference; }
// ---------------------------------------------------------------------
// E-mail + voucher. The confirmation e-mail goes out through Resend (RESEND_API_KEY, MAIL_FROM); the "voucher"
// is a printable page on the site (/voucher/?id=…) that the signed-in customer opens and saves as PDF.
// ---------------------------------------------------------------------
const _esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _nameOf = (v) => (v && typeof v === 'object') ? (v.en || v.ar || Object.values(v)[0] || '') : (v || '');
function voucherUrl(orderId, env) { return `${(env.SITE_URL || 'https://app.discover-sharm.com').replace(/\/$/, '')}/voucher/?id=${encodeURIComponent(orderId)}`; }

const mailConfigured = (env) => !!((env.RESEND_API_KEY && env.MAIL_FROM) || (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && (env.MAIL_FROM || env.SMTP_USER)));
// Resend first; if it is not set up or fails (quota used up, outage) → SMTP straight from this Worker. Returns true when one of them accepted the message.
async function deliverMail(env, { to, subject, html }) {
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }),
      });
      if (res.ok) return true;
      console.log('Resend failed', res.status, (await res.text()).slice(0, 200));
    } catch (e) { console.log('Resend error', e && e.message); }
  }
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && (env.MAIL_FROM || env.SMTP_USER)) {
    try { await sendSmtp(env, { to, subject, html }); return true; }
    catch (e) { console.log('SMTP failed', e && e.message); }
  }
  return false;
}

async function sendBookingEmail(orderId, env) {
  if (!mailConfigured(env)) { console.log('No e-mail provider configured (RESEND_API_KEY + MAIL_FROM, or SMTP_HOST/SMTP_USER/SMTP_PASS): e-mail skipped'); return false; }
  const o = await getOrder(orderId, env);
  const b = o.booking;
  if (!b || o.pending || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) return false;
  const title = _esc(_nameOf(b.hotelName || b.title || b.vehicleType) || 'Discover Sharm');
  const when = _esc(b.checkin ? `${b.checkin} → ${b.checkout || ''}` : (b.date || ''));
  const due = b.paymentPlan === 'deposit' && Number(b.remainingAmount) > 0;
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#666">${k}</td><td style="padding:6px 0;text-align:end"><b>${v}</b></td></tr>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">
    <h2 style="color:#c2410c;margin-bottom:4px">Booking confirmed · تأكيد الحجز</h2>
    <p style="margin-top:0">Hi ${_esc(b.name || '')}, thank you for booking with Discover Sharm. · شكراً لحجزك مع ديسكفر شرم.</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;border-bottom:1px solid #eee">
      ${row('Reference · رقم الحجز', _esc(b.id))}${row('Service · الخدمة', title)}${row('Date · التاريخ', when)}
      ${row('Total · الإجمالي', `${_esc(b.total)} ${_esc(b.currency || 'EGP')}`)}
      ${due ? row('Due later · المتبقي', `${_esc(b.remainingAmount)} ${_esc(b.currency || 'EGP')}`) : ''}
    </table>
    <p><a href="${_esc(voucherUrl(orderId, env))}" style="display:inline-block;background:#c2410c;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Open your voucher · افتح الفاوتشر</a></p>
    <p style="color:#888;font-size:12px">Show the voucher (printed or on your phone) at the start of the service.</p></div>`;
  return deliverMail(env, { to: b.email, subject: `Booking confirmed · تأكيد الحجز ${b.id}`, html });
}
function notifyBookingConfirmed(orderId, env, ctx) {
  const job = sendBookingEmail(orderId, env).catch((e) => console.log('e-mail failed', e && e.message));
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  return job;
}
async function commitPaidBooking(orderId, extra, env, ctx) {
  const r = await sbRpc(env, 'finalize_booking_payment', { p_id: orderId, p_gateway_status: 'SUCCESS', p_extra: extra || {} });
  if (!r) return null;                                           // unknown order
  if (r.created) notifyBookingConfirmed(orderId, env, ctx);
  return { status: r.status, created: !!r.created };
}
async function finalizeBalancePayment(orderId, kashierStatus, env, extra) {
  return await sbRpc(env, 'finalize_balance_payment', { p_id: orderId, p_gateway_status: kashierStatus || '', p_extra: extra || {} });
}
async function finalizeBookingPayment(orderId, kashierStatus, env, ctx) {
  const status = (kashierStatus || '').toUpperCase();
  if (status === 'SUCCESS' || status === 'PAID' || status === 'CAPTURED') {
    const r = await commitPaidBooking(orderId, {}, env, ctx);
    return r ? r.status : null;
  }
  const r = await sbRpc(env, 'finalize_booking_payment', { p_id: orderId, p_gateway_status: status, p_extra: {} });
  if (!r) return null;
  return r.status === 'pending_payment' ? 'pending_payment' : r.status;
}
async function verifyKashierSignature(rawBody, secret, headerSignature, payloadData) {
  if (headerSignature) {
    const calculated = await hmacSha256Hex(rawBody, secret);
    return headerSignature.toLowerCase() === calculated.toLowerCase();
  }
  if (payloadData?.signature) {
    const { merchantId, merchantOrderId, amount, currency, signature } = payloadData;
    if (!merchantId || !merchantOrderId || !amount || !currency) return false;
    const queryString = `?mid=${merchantId}&orderId=${merchantOrderId}&amount=${amount}&currency=${currency}`;
    const calculatedHex = await hmacSha256Hex(queryString, secret);
    return signature.toLowerCase() === calculatedHex.toLowerCase();
  }
  return false;
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function isValidPhone(phone) { return /^\+?[0-9]{6,15}$/.test(phone); }
function isNonEmptyString(str) { return typeof str === 'string' && str.trim().length > 0; }
function isValidRating(rating) { return Number.isInteger(rating) && rating >= 1 && rating <= 5; }
function isValidAmount(amount) { return typeof amount === 'number' && amount > 0; }
function calculateGeniusLevel(stats) {
  const completed = stats?.completedBookings || 0;
  if (completed >= 10) return 3;
  if (completed >= 5) return 2;
  if (completed >= 3) return 1;
  return 0;
}

// ==================== payments worker ====================
/**
 * Discover Sharm — Payments Worker (Kashier)
 * Routes: /api/kashier/hash, /charge, /charge-status, /charge-token,
 *         /charge-balance, /charge-balance-token,
 *         /cards (GET/DELETE), /wallet/initiate, /wallet/reconcile, /webhook
 * Tight rate limits: this is the most abuse-sensitive surface (card charges).
 *
 * PAYMENT PLAN: the guest picks 'full' or 'deposit' at checkout (booking.js).
 * bookings-worker's enforcePrice stamps booking.amountDueNow accordingly
 * (full total, or the 50% deposit) — every charge endpoint here validates the
 * card amount against payableNow(booking), never booking.total directly, so a
 * deposit booking can only ever be charged its deposit at this stage. If
 * remainingAmount > 0 after the deposit is paid, balanceStatus is 'due' and
 * /charge-balance(-token) collects it later, patching the existing
 * booking row rather than creating a new booking.
 */

const LIMITS = {
  charge: { limit: 10, window: 60 },   // card charge attempts
  poll: { limit: 30, window: 60 },     // status polling
  webhook: { limit: 120, window: 60 }, // Kashier's own servers call this
};

// ---- Remaining-balance deadline (hourly cron) -------------------------------------------------------------
// The database decides who gets a reminder (72h / 24h before the deadline) and who is cancelled because the deadline passed
// (public.balance_job); this only sends the e-mails. The deposit of a cancelled booking is kept — the admin can still refund it by hand.
const _validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || '');
const _appUrl = (env) => (env.APP_URL || 'https://app.discover-sharm.com').replace(/\/$/, '');
function balanceMail(kind, x, env) {
  const amt = `${_esc(x.remaining_amount)} ${_esc(x.currency || 'EGP')}`;
  const due = x.due_at ? new Date(x.due_at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }) : '';
  const btn = `<p><a href="${_esc(_appUrl(env))}" style="display:inline-block;background:#c2410c;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Open My Bookings · افتح حجوزاتي</a></p>`;
  const wrap = (h, body) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111"><h2 style="color:#c2410c;margin-bottom:4px">${h}</h2><p style="margin-top:0">Hi ${_esc(x.name || '')} · أهلاً ${_esc(x.name || '')}</p>${body}</div>`;
  const card = x.autopay_card || x.masked_card ? ` (${_esc(x.autopay_card || x.masked_card)})` : '';
  if (kind === 'charged') return {
    subject: `Remaining balance paid · تم سداد المتبقي ${x.id}`,
    html: wrap('Remaining balance paid · تم سداد المتبقي', `<p>We charged the remaining <b>${amt}</b> to your card${card} for booking <b>${_esc(x.id)}</b>. You're all set.</p><p>تم سحب المتبقي <b>${amt}</b> من كارتك${card} للحجز <b>${_esc(x.id)}</b>. حجزك مكتمل.</p>`) };
  if (kind === 'chargefailed') return {
    subject: `We could not charge your card · تعذّر سحب المتبقي ${x.id}`,
    html: wrap('Payment failed · تعذّر السحب', `<p>We tried to charge the remaining <b>${amt}</b> to your card${card} but it did not go through. Please pay it manually before <b>${_esc(due)}</b> (Cairo time) or the booking will be cancelled.</p>
      <p>حاولنا سحب المتبقي <b>${amt}</b> من كارتك${card} لكن العملية لم تنجح. من فضلك سدّده يدوياً قبل <b>${_esc(due)}</b> (بتوقيت القاهرة) وإلا سيتم إلغاء الحجز.</p>${btn}`) };
  if (kind === 'reminder' && x.autopay_card) return {
    subject: `Heads-up: we will charge the remaining balance · تنبيه: سيتم سحب المتبقي ${x.id}`,
    html: wrap('Automatic payment scheduled · سحب تلقائي قادم', `<p>As you agreed at checkout, we will charge the remaining <b>${amt}</b> to your card${card} for booking <b>${_esc(x.id)}</b> around <b>${_esc(due)}</b> (Cairo time). Nothing to do — just keep enough balance on the card, or pay now from My Bookings.</p>
      <p>زي ما وافقت وقت الحجز، هنسحب المتبقي <b>${amt}</b> من كارتك${card} للحجز <b>${_esc(x.id)}</b> حوالي <b>${_esc(due)}</b> (بتوقيت القاهرة). مش مطلوب منك حاجة — تأكد بس إن الرصيد كافي، أو ادفع دلوقتي من حجوزاتي.</p>${btn}`) };
  if (kind === 'cancelled') return {
    subject: `Booking cancelled · تم إلغاء الحجز ${x.id}`,
    html: wrap('Booking cancelled · تم إلغاء الحجز', `<p>Your booking <b>${_esc(x.id)}</b> was cancelled because the remaining balance (${amt}) was not paid before the deadline. Your deposit is not refunded automatically — contact us if you need help.</p>
      <p>تم إلغاء حجزك <b>${_esc(x.id)}</b> لأن المتبقي (${amt}) لم يُسدَّد قبل الموعد النهائي. العربون لا يُسترد تلقائياً — تواصل معنا لو محتاج مساعدة.</p>`) };
  return {
    subject: `${x.n >= 2 ? 'Last reminder' : 'Reminder'}: pay the remaining balance · ${x.n >= 2 ? 'تذكير أخير' : 'تذكير'}: سدّد المتبقي ${x.id}`,
    html: wrap('Remaining balance due · المتبقي مطلوب', `<p>Please pay the remaining <b>${amt}</b> for booking <b>${_esc(x.id)}</b> before <b>${_esc(due)}</b> (Cairo time), otherwise the booking will be cancelled automatically.</p>
      <p>من فضلك سدّد المتبقي <b>${amt}</b> للحجز <b>${_esc(x.id)}</b> قبل <b>${_esc(due)}</b> (بتوقيت القاهرة)، وإلا سيتم إلغاء الحجز تلقائياً.</p>${btn}`) };
}
async function runBalanceJob(env) {
  const r = await sbRpc(env, 'balance_job', {});
  const out = { reminders: 0, cancelled: 0, emailed: 0 };
  if (!r) return out;
  const batches = [['reminder', r.reminders || []], ['cancelled', r.cancelled || []]];
  if (autoBalanceOn(env)) for (const x of r.autopay || []) {
    const res = await chargeAutopay(env, x);
    out[res === 'paid' ? 'charged' : 'chargeFailed'] = (out[res === 'paid' ? 'charged' : 'chargeFailed'] || 0) + 1;
    if (_validEmail(x.email) && mailConfigured(env)) { const m = balanceMail(res === 'paid' ? 'charged' : 'chargefailed', x, env); await deliverMail(env, { to: x.email, subject: m.subject, html: m.html }); }
  }
  for (const [kind, list] of batches) {
    for (const x of list) {
      out[kind === 'reminder' ? 'reminders' : 'cancelled']++;
      if (!_validEmail(x.email) || !mailConfigured(env)) continue;
      const m = balanceMail(kind, x, env);
      if (await deliverMail(env, { to: x.email, subject: m.subject, html: m.html })) out.emailed++;
    }
  }
  console.log('balance job', JSON.stringify(out));
  return out;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runBalanceJob(env).catch((e) => console.log('balance job failed', e && e.message))); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { headers: corsHeadersForRequest(request) });

    // SECURITY: orderId is used as a booking key — reject traversal characters up front.
    if (method === 'POST' && (path.startsWith('/api/kashier/') || path.startsWith('/api/notify/')) && path !== '/api/kashier/webhook') {
      let peek = null; try { peek = await request.clone().json(); } catch {}
      if (peek && peek.orderId !== undefined && !/^[A-Za-z0-9_-]{3,64}$/.test(String(peek.orderId))) return json({ error: 'Invalid orderId' }, 400, request);
    }

    if (path === '/api/kashier/hash' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-hash', LIMITS.charge.limit, LIMITS.charge.window)) return json({ error: 'Too many requests' }, 429, request);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId, amount, currency } = body;
      if (!orderId || !amount) return json({ error: 'orderId and amount required' }, 400, request);
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(String(orderId))) return json({ error: 'Invalid orderId' }, 400, request);
      const order = await getOrder(orderId, env);
      if (!order.booking || String(payableNow(order.booking)) !== String(amount) || (currency && order.booking.currency !== currency)) return json({ error: 'Order not found or amount mismatch' }, 400, request);
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
      const cur = currency || env.KASHIER_CURRENCY || 'EGP';
      if (!merchantId || !apiKey) return json({ error: 'Kashier not configured' }, 500, request);
      const hash = await generateKashierHash(orderId, amount, cur, merchantId, apiKey);
      return json({ success: true, hash, merchantId, currency: cur }, 200, request);
    }

    if (path === '/api/kashier/charge' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-charge', LIMITS.charge.limit, LIMITS.charge.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId, amount, currency, card, save, customer, autopay } = body || {};
      if (!orderId || !amount || !currency) return json({ error: 'orderId, amount and currency required' }, 400, request);
      if (!card || !card.number || !card.month || !card.year || !card.cvv) return json({ error: 'Card details required' }, 400, request);

      const { booking, pending } = await getOrder(orderId, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.status === 'completed') return json({ status: 'captured', message: 'Already paid' }, 200, request); // never charge twice
      if (!pending && booking.status !== 'pending_payment') return json({ error: 'Booking is not payable' }, 409, request);
      if (String(payableNow(booking)) !== String(amount) || booking.currency !== currency) {
        return json({ error: 'Amount/currency does not match the booking' }, 400, request);
      }
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
      if (!merchantId || !apiKey) return json({ error: 'Kashier not configured' }, 500, request);

      const hash = await kashierPaymentHash(merchantId, orderId, amount, currency, apiKey, save ? uid : undefined);
      const payload = {
        apiOperation: 'PAY',
        paymentMethod: { type: 'CARD', card: { number: card.number, expiry: { month: card.month, year: card.year }, nameOnCard: card.name || '', securityCode: card.cvv, save: !!save } },
        order: { reference: orderId, amount: String(amount), currency, description: booking.type ? `${booking.type} booking` : '' },
        interactionSource: 'ECOMMERCE',
        reconciliation: { webhookUrl: `${url.origin}/api/kashier/webhook`, merchantRedirect: '', redirect: false },
        customer: { reference: uid, firstName: customer?.firstName || '', lastName: customer?.lastName || '', email: customer?.email || '' },
        merchantId,
      };
      let kashierRes, kashierData;
      try {
        kashierRes = await fetch(`${kashierFepBase(env)}/v3/orders/`, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json', 'Kashier-Hash': hash }, body: JSON.stringify(payload) });
        kashierData = await kashierRes.json();
      } catch { return json({ error: 'Could not reach payment gateway' }, 502, request); }

      const r = kashierData?.response || {};
      if (r.authentication?.redirectUrl) {
        await patchBooking(orderId, { kashierOrderId: r.orderId || null }, env);
        return json({ ...sanitizeKashierResponse(kashierData), status: '3ds_required' }, 200, request);
      }
      const finalStatus = await finalizeBookingPayment(orderId, r.status || r.result, env, ctx);
      if (!kashierRes.ok || (r.result && r.result !== 'SUCCESS')) return json({ ...sanitizeKashierResponse(kashierData), status: 'failed' }, 200, request);
      return json({ ...sanitizeKashierResponse(kashierData), status: finalStatus === 'completed' ? 'captured' : 'pending' }, 200, request); // our status must win over the gateway's raw one
    }

    if (path === '/api/kashier/autopay-session' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-charge', LIMITS.charge.limit, LIMITS.charge.window)) return json({ error: 'Too many requests' }, 429, request);
      if (!autoBalanceOn(env)) return json({ error: 'Automatic balance collection is not enabled' }, 403, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId, amount, currency, email, lang } = body || {};
      if (!orderId || !amount || !currency) return json({ error: 'orderId, amount and currency required' }, 400, request);
      const { booking, pending } = await getOrder(orderId, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.status === 'completed') return json({ status: 'captured', message: 'Already paid' }, 200, request);
      if (!pending && booking.status !== 'pending_payment') return json({ error: 'Booking is not payable' }, 409, request);
      if (booking.paymentPlan !== 'deposit' || !(Number(booking.remainingAmount) > 0)) return json({ error: 'Not a deposit booking' }, 400, request);
      if (String(payableNow(booking)) !== String(amount) || booking.currency !== currency) return json({ error: 'Amount/currency does not match the booking' }, 400, request);
      await autopaySave(env, orderId, uid, { consent: true });
      try {
        const sessionUrl = await createAutopaySession(env, { booking, orderId, uid, email, amount, currency, lang, origin: url.origin });
        return json({ status: 'redirect', sessionUrl }, 200, request);
      } catch (e) { return json({ error: e.message || 'Could not start the secure payment page' }, 502, request); }
    }

    if (path === '/api/kashier/charge-status' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-poll', LIMITS.poll.limit, LIMITS.poll.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId } = body || {};
      if (!orderId) return json({ error: 'orderId required' }, 400, request);
      let cur = await getOrder(orderId, env);
      if (!cur.booking || cur.booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      // right after 3-D Secure the webhook may still be on its way: give it a few seconds to commit the booking
      for (let i = 0; cur.pending && cur.booking.lastPaymentStatus !== 'failed' && i < 4; i++) { await new Promise(r => setTimeout(r, 1500)); cur = await getOrder(orderId, env); if (!cur.booking) break; }
      if (cur.pending) return json({ status: cur.booking.lastPaymentStatus === 'failed' ? 'failed' : 'pending_payment' }, 200, request);
      return json({ status: cur.booking ? cur.booking.status : 'failed' }, 200, request);
    }

    if (path === '/api/kashier/charge-token' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-charge', LIMITS.charge.limit, LIMITS.charge.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId, amount, currency, cardToken, cvv } = body || {};
      if (!orderId || !amount || !currency || !cardToken || !cvv) return json({ error: 'orderId, amount, currency, cardToken and cvv required' }, 400, request);
      const { booking, pending } = await getOrder(orderId, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.status === 'completed') return json({ status: 'captured', message: 'Already paid' }, 200, request); // never charge twice
      if (!pending && booking.status !== 'pending_payment') return json({ error: 'Booking is not payable' }, 409, request);
      if (String(payableNow(booking)) !== String(amount) || booking.currency !== currency) return json({ error: 'Amount/currency does not match the booking' }, 400, request);
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
      if (!merchantId || !apiKey) return json({ error: 'Kashier not configured' }, 500, request);
      const hash = await kashierPaymentHash(merchantId, orderId, amount, currency, apiKey, uid);
      const payload = {
        apiOperation: 'PAY',
        paymentMethod: { type: 'CARD', card: { cardToken, securityCode: cvv, enable3DS: true } },
        order: { reference: orderId, amount: String(amount), currency, description: booking.type ? `${booking.type} booking` : '' },
        customer: { reference: uid },
        interactionSource: 'ECOMMERCE',
        reconciliation: { webhookUrl: `${url.origin}/api/kashier/webhook`, merchantRedirect: '', redirect: false },
        merchantId,
      };
      let kashierRes, kashierData;
      try {
        kashierRes = await fetch(`${kashierFepBase(env)}/v3/orders/`, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json', 'Kashier-Hash': hash }, body: JSON.stringify(payload) });
        kashierData = await kashierRes.json();
      } catch { return json({ error: 'Could not reach payment gateway' }, 502, request); }
      const r = kashierData?.response || {};
      if (r.authentication?.redirectUrl) return json({ ...sanitizeKashierResponse(kashierData), status: '3ds_required' }, 200, request);
      const finalStatus = await finalizeBookingPayment(orderId, r.status || r.result, env, ctx);
      if (!kashierRes.ok || (r.result && r.result !== 'SUCCESS')) return json({ ...sanitizeKashierResponse(kashierData), status: 'failed' }, 200, request);
      return json({ ...sanitizeKashierResponse(kashierData), status: finalStatus === 'completed' ? 'captured' : 'pending' }, 200, request); // our status must win over the gateway's raw one
    }

    if (path === '/api/kashier/cards' && method === 'GET') {
      if (await isRateLimited(request, env, 'kashier-poll', LIMITS.poll.limit, LIMITS.poll.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY, secretKey = env.KASHIER_SECRET_KEY;
      if (!merchantId || !apiKey || !secretKey) return json({ error: 'Kashier not configured' }, 500, request);
      const hash = await kashierTokenizationHash(merchantId, uid, apiKey);
      const res = await fetch(`${kashierFepBase(env)}/v3/cards/customer?customerReference=${encodeURIComponent(uid)}&merchantId=${encodeURIComponent(merchantId)}`, { headers: { Authorization: secretKey, 'Kashier-Hash': hash, accept: 'application/json' } });
      if (res.status === 400) return json({ success: true, cards: [] }, 200, request);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: data.message || 'Could not retrieve saved cards' }, res.status, request);
      return json({ success: true, cards: data.response || data.cards || data }, 200, request);
    }

    if (path.startsWith('/api/kashier/cards/') && method === 'DELETE') {
      if (await isRateLimited(request, env, 'kashier-write', LIMITS.charge.limit, LIMITS.charge.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      const token = decodeURIComponent(path.slice('/api/kashier/cards/'.length));
      if (!token) return json({ error: 'Token required' }, 400, request);
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY, secretKey = env.KASHIER_SECRET_KEY;
      if (!merchantId || !apiKey || !secretKey) return json({ error: 'Kashier not configured' }, 500, request);
      const hash = await kashierTokenizationHash(merchantId, uid, apiKey);
      const res = await fetch(`${kashierFepBase(env)}/v3/cards/tokens/${encodeURIComponent(token)}?customerReference=${encodeURIComponent(uid)}&merchantId=${encodeURIComponent(merchantId)}`, { method: 'DELETE', headers: { Authorization: secretKey, 'Kashier-Hash': hash, accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: data.message || 'Could not delete card' }, res.status, request);
      return json({ success: true }, 200, request);
    }

    if (path === '/api/kashier/wallet/initiate' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-charge', LIMITS.charge.limit, LIMITS.charge.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId, amount, currency, mobilePhone } = body || {};
      if (!orderId || !amount || !currency || !isValidPhone(mobilePhone)) return json({ error: 'orderId, amount, currency and a valid mobilePhone are required' }, 400, request);
      const { booking, pending } = await getOrder(orderId, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.status === 'completed') return json({ status: 'captured', message: 'Already paid' }, 200, request); // never charge twice
      if (!pending && booking.status !== 'pending_payment') return json({ error: 'Booking is not payable' }, 409, request);
      if (String(payableNow(booking)) !== String(amount) || booking.currency !== currency) return json({ error: 'Amount/currency does not match the booking' }, 400, request);
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
      if (!merchantId || !apiKey) return json({ error: 'Kashier not configured' }, 500, request);
      const hash = await kashierPaymentHash(merchantId, orderId, amount, currency, apiKey);
      const payload = { apiOperation: 'INITIATE_R2P', paymentMethod: { type: 'wallet' }, order: { reference: orderId, amount, currency }, customer: { mobilePhone }, interactionSource: 'ECOMMERCE', reconciliation: { webhookUrl: `${url.origin}/api/kashier/webhook` }, merchantId };
      const res = await fetch(`${kashierFepBase(env)}/v3/orders/`, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json', 'Kashier-Hash': hash }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.response?.result !== 'SUCCESS') return json({ status: 'failed', message: data?.response?.transactionResponseMessage?.en || 'Could not start the wallet request' }, 200, request);
      await patchBooking(orderId, { kashierOrderId: data.response.order?.systemOrderId || null }, env);
      return json({ status: 'pending', systemOrderId: data.response.order?.systemOrderId, message: data.response.transactionResponseMessage?.en }, 200, request);
    }

    if (path === '/api/kashier/wallet/reconcile' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-poll', LIMITS.poll.limit, LIMITS.poll.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId } = body || {};
      if (!orderId) return json({ error: 'orderId required' }, 400, request);
      const { booking } = await getOrder(orderId, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.status === 'completed' || booking.status === 'failed') return json({ status: booking.status }, 200, request);
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
      if (!merchantId || !apiKey) return json({ error: 'Kashier not configured' }, 500, request);
      const hash = await kashierPaymentHash(merchantId, orderId, booking.total, booking.currency, apiKey);
      const target = booking.kashierOrderId || orderId;
      const res = await fetch(`${kashierFepBase(env)}/v3/orders/${encodeURIComponent(target)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', accept: 'application/json', 'Kashier-Hash': hash }, body: JSON.stringify({ apiOperation: 'RECONCILE_WALLET', paymentMethod: { type: 'wallet' }, merchantId }) });
      const data = await res.json().catch(() => ({}));
      const kStatus = data?.response?.status || (res.status === 400 ? 'FAILURE' : '');
      const finalStatus = await finalizeBookingPayment(orderId, kStatus, env, ctx);
      return json({ status: kStatus === 'PENDING' ? 'pending' : (finalStatus === 'completed' ? 'captured' : finalStatus) }, 200, request);
    }

    // Collect the remaining balance with a fresh card (guest re-enters details).
    if (path === '/api/kashier/charge-balance' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-charge', LIMITS.charge.limit, LIMITS.charge.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId, amount, currency, card, save } = body || {};
      if (!orderId || !amount || !currency) return json({ error: 'orderId, amount and currency required' }, 400, request);
      if (!card || !card.number || !card.month || !card.year || !card.cvv) return json({ error: 'Card details required' }, 400, request);
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(String(orderId))) return json({ error: 'Invalid orderId' }, 400, request);

      const booking = await getPaidBooking(orderId, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.balanceStatus !== 'due') return json({ status: booking.balanceStatus === 'paid' ? 'captured' : 'not_due', message: 'Nothing is due on this booking' }, 200, request);
      if (String(booking.remainingAmount) !== String(amount) || booking.currency !== currency) return json({ error: 'Amount/currency does not match the balance due' }, 400, request);
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
      if (!merchantId || !apiKey) return json({ error: 'Kashier not configured' }, 500, request);

      const balanceRef = `${orderId}-BAL`;
      const hash = await kashierPaymentHash(merchantId, balanceRef, amount, currency, apiKey, save ? uid : undefined);
      const payload = {
        apiOperation: 'PAY',
        paymentMethod: { type: 'CARD', card: { number: card.number, expiry: { month: card.month, year: card.year }, nameOnCard: card.name || '', securityCode: card.cvv, save: !!save } },
        order: { reference: balanceRef, amount: String(amount), currency, description: booking.type ? `${booking.type} booking — remaining balance` : '' },
        interactionSource: 'ECOMMERCE',
        reconciliation: { webhookUrl: `${url.origin}/api/kashier/webhook`, merchantRedirect: '', redirect: false },
        customer: { reference: uid, firstName: booking.name?.split(' ')[0] || '', lastName: booking.name?.split(' ').slice(1).join(' ') || '', email: booking.email || '' },
        merchantId,
      };
      let kashierRes, kashierData;
      try {
        kashierRes = await fetch(`${kashierFepBase(env)}/v3/orders/`, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json', 'Kashier-Hash': hash }, body: JSON.stringify(payload) });
        kashierData = await kashierRes.json();
      } catch { return json({ error: 'Could not reach payment gateway' }, 502, request); }
      const r = kashierData?.response || {};
      if (r.authentication?.redirectUrl) return json({ ...sanitizeKashierResponse(kashierData), status: '3ds_required' }, 200, request);
      const finalStatus = await finalizeBalancePayment(orderId, r.status || r.result, env);
      if (!kashierRes.ok || (r.result && r.result !== 'SUCCESS')) return json({ ...sanitizeKashierResponse(kashierData), status: 'failed' }, 200, request);
      return json({ ...sanitizeKashierResponse(kashierData), status: finalStatus === 'paid' ? 'captured' : 'pending' }, 200, request);
    }

    // Collect the remaining balance with a saved card token — no re-entry needed.
    if (path === '/api/kashier/charge-balance-token' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-charge', LIMITS.charge.limit, LIMITS.charge.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId, cardToken, cvv } = body || {};
      if (!orderId || !cardToken || !cvv) return json({ error: 'orderId, cardToken and cvv required' }, 400, request);
      if (!/^[A-Za-z0-9_-]{3,64}$/.test(String(orderId))) return json({ error: 'Invalid orderId' }, 400, request);

      const booking = await getPaidBooking(orderId, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.balanceStatus !== 'due') return json({ status: booking.balanceStatus === 'paid' ? 'captured' : 'not_due', message: 'Nothing is due on this booking' }, 200, request);
      const { remainingAmount: amount, currency } = booking;
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
      if (!merchantId || !apiKey) return json({ error: 'Kashier not configured' }, 500, request);

      const balanceRef = `${orderId}-BAL`;
      const hash = await kashierPaymentHash(merchantId, balanceRef, amount, currency, apiKey, uid);
      const payload = {
        apiOperation: 'PAY',
        paymentMethod: { type: 'CARD', card: { cardToken, securityCode: cvv, enable3DS: true } },
        order: { reference: balanceRef, amount: String(amount), currency, description: booking.type ? `${booking.type} booking — remaining balance` : '' },
        customer: { reference: uid },
        interactionSource: 'ECOMMERCE',
        reconciliation: { webhookUrl: `${url.origin}/api/kashier/webhook`, merchantRedirect: '', redirect: false },
        merchantId,
      };
      let kashierRes, kashierData;
      try {
        kashierRes = await fetch(`${kashierFepBase(env)}/v3/orders/`, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json', 'Kashier-Hash': hash }, body: JSON.stringify(payload) });
        kashierData = await kashierRes.json();
      } catch { return json({ error: 'Could not reach payment gateway' }, 502, request); }
      const r = kashierData?.response || {};
      if (r.authentication?.redirectUrl) return json({ ...sanitizeKashierResponse(kashierData), status: '3ds_required' }, 200, request);
      const finalStatus = await finalizeBalancePayment(orderId, r.status || r.result, env);
      if (!kashierRes.ok || (r.result && r.result !== 'SUCCESS')) return json({ ...sanitizeKashierResponse(kashierData), status: 'failed' }, 200, request);
      return json({ ...sanitizeKashierResponse(kashierData), status: finalStatus === 'paid' ? 'captured' : 'pending' }, 200, request);
    }

    // Polls the balance charge through to a final state after a 3DS redirect — same shape as /charge-status.
    if (path === '/api/kashier/charge-balance-status' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-poll', LIMITS.poll.limit, LIMITS.poll.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId } = body || {};
      if (!orderId) return json({ error: 'orderId required' }, 400, request);
      let booking = await getPaidBooking(orderId, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      for (let i = 0; booking.balanceStatus === 'due' && booking.lastBalancePaymentStatus !== 'failed' && i < 4; i++) { await new Promise(r => setTimeout(r, 1500)); booking = await getPaidBooking(orderId, env); if (!booking) break; }
      return json({ status: booking.balanceStatus === 'paid' ? 'captured' : (booking.lastBalancePaymentStatus === 'failed' ? 'failed' : 'due') }, 200, request);
    }

    if (path === '/api/kashier/webhook' && method === 'POST') {
      // No per-IP limit worth enforcing tightly here — Kashier's own
      // servers call this — but still cap it so it can't be hammered.
      if (await isRateLimited(request, env, 'kashier-webhook', LIMITS.webhook.limit, LIMITS.webhook.window)) return json({ error: 'Too many requests' }, 429, request);
      const rawBody = await request.text();
      let payload;
      try { payload = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const headerSignature = request.headers.get('x-kashier-signature') || '';
      const secret = env.KASHIER_SECRET_KEY || env.KASHIER_API_KEY;
      if (!secret) return json({ error: 'Webhook secret not configured' }, 500, request);
      const isValid = await verifyKashierSignature(rawBody, secret, headerSignature, payload.data);
      if (!isValid) return json({ error: 'Invalid signature' }, 401, request);
      const reference = payload.data?.merchantOrderId;
      const status = (payload.data?.status || payload.data?.paymentStatus || '').toUpperCase();
      if (!reference) return json({ error: 'merchantOrderId missing' }, 400, request);

      // The remaining-balance charge uses "{orderId}-BAL" as its own Kashier order
      // reference (see /api/kashier/charge-balance*) — route it away from the
      // booking-creation path entirely; it only ever patches balanceStatus.
      if (isBalanceRef(reference)) {
        const bId = baseOrderId(reference);
        const bal = await getPaidBooking(bId, env);
        if (!bal) return json({ status: 'received', warning: 'Booking not found' }, 200, request);
        if (status === 'SUCCESS' || status === 'PAID') {
          const paid = Number(payload.data?.amount);
          if (isFinite(paid) && paid > 0 && Math.abs(paid - Number(bal.remainingAmount)) > 0.01) {
            await patchBooking(bId, { balancePaymentFlag: 'amount_mismatch' }, env);
            return json({ status: 'received', warning: 'Amount mismatch — balance not marked paid' }, 200, request);
          }
          await finalizeBalancePayment(bId, 'SUCCESS', env, { kashierOrderId: payload.data?.kashierOrderId || bal.kashierOrderId || null });
        } else if (status === 'FAILED') {
          await finalizeBalancePayment(bId, 'FAILED', env);
        }
        return json({ status: 'received' }, 200, request);
      }

      const merchantOrderId = reference;
      if (autoBalanceOn(env) && (status === 'SUCCESS' || status === 'PAID')) {
        const tk = extractTokenInfo(payload.data);
        if (tk) { const o = await getOrder(merchantOrderId, env); await autopaySave(env, merchantOrderId, o.booking?.uid || null, tk); }
      }
      const { booking, pending } = await getOrder(merchantOrderId, env);
      if (!booking) return json({ status: 'received', warning: 'Booking not found' }, 200, request);
      if (status === 'SUCCESS' || status === 'PAID') {
        if (!pending && booking.status !== 'pending_payment') return json({ status: 'received', note: 'Booking already finalized' }, 200, request);
        // the gateway must have collected exactly the deposit (or full total) — never more, never less
        const paid = Number(payload.data?.amount);
        if (isFinite(paid) && paid > 0 && Math.abs(paid - Number(payableNow(booking))) > 0.01) {
          if (pending) await patchBooking(merchantOrderId, { paymentFlag: 'amount_mismatch', paidAmount: paid }, env);
          return json({ status: 'received', warning: 'Amount mismatch — booking not created' }, 200, request);
        }
        await commitPaidBooking(merchantOrderId, { kashierOrderId: payload.data?.kashierOrderId || booking.kashierOrderId || null }, env, ctx);
      } else if (status === 'FAILED') {
        if (pending) await patchBooking(merchantOrderId, { lastPaymentStatus: 'failed' }, env);
      } else if (status === 'REFUNDED' && !pending) {
        await sbRpc(env, 'service_mark_refunded', { p_id: merchantOrderId });
      }
      return json({ status: 'received' }, 200, request);
    }

    if ((path === '/api/notify/voucher-link' || path === '/api/notify/resend') && method === 'POST') {
      if (await isRateLimited(request, env, 'notify', LIMITS.charge.limit, LIMITS.charge.window)) return json({ error: 'Too many requests' }, 429, request);
      try {
        const uid = await requireUid(request, env);
        const { orderId } = await request.json().catch(() => ({}));
        const booking = orderId ? await getPaidBooking(orderId, env) : null;
        if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
        if (booking.status !== 'completed') return json({ error: 'Booking is not confirmed' }, 409, request);
        if (path === '/api/notify/voucher-link') return json({ pdf: voucherUrl(orderId, env) }, 200, request);
        const sent = await sendBookingEmail(orderId, env);
        return sent ? json({ success: true }, 200, request) : json({ error: 'E-mail is not available right now' }, 503, request);
      } catch (e) { return json({ error: e.status === 401 ? 'Unauthorized' : 'Request failed' }, e.status || 500, request); }
    }

    return json({ error: 'Not found' }, 404, request);
  },
};
