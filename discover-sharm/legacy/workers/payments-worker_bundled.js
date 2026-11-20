/**
 * Discover Sharm — payments worker (bundled, single-file, no imports)
 * Paste this whole file as-is into the Cloudflare dashboard editor.
 */

// ==================== shared helpers ====================
/**
 * Discover Sharm — shared helpers used by every split worker.
 * Each worker below imports only what it needs from this file.
 * Wrangler bundles this in at deploy time — it does NOT become a shared
 * runtime dependency, so each worker stays fully independent in production.
 */

const GOOGLE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';
const GITHUB_API = 'https://api.github.com';

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
// base64 / JWT plumbing
// ---------------------------------------------------------------------
function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}
function utf8ToBase64(str) { return bytesToBase64(new TextEncoder().encode(str)); }
function base64ToUtf8(base64) { return new TextDecoder().decode(base64ToBytes(base64)); }
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return base64ToBytes(b64).buffer;
}

// ---------------------------------------------------------------------
// Firebase ID token verification (unchanged logic from the monolith)
// ---------------------------------------------------------------------
let _jwkCache = null;
let _jwkCacheAt = 0;

async function getGoogleJwks() {
  if (_jwkCache && Date.now() - _jwkCacheAt < 3600 * 1000) return _jwkCache;
  const res = await fetch(GOOGLE_JWK_URL);
  if (!res.ok) throw new Error('Could not fetch Google public keys');
  _jwkCache = await res.json();
  _jwkCacheAt = Date.now();
  return _jwkCache;
}

async function verifyFirebaseIdToken(idToken, projectId) {
  const parts = (idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64));
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch { throw new Error('Invalid token encoding'); }
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

  const jwks = await getGoogleJwks();
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');

  const publicKey = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const signatureBytes = base64UrlDecode(sigB64);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', publicKey, base64ToBytes(btoa(signatureBytes)), signedData
  );
  if (!valid) throw new Error('Invalid token signature');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error('Token expired');
  if (payload.iat && payload.iat > now + 60) throw new Error('Token issued in the future');
  if (payload.aud !== projectId) throw new Error('Token audience does not match');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Token issuer does not match');
  if (!payload.sub) throw new Error('Token missing subject');
  return payload.sub;
}

// Reads the Bearer token from the request and returns the verified uid,
// or null if there is no token at all. Throws if a token IS present but
// invalid/expired, so callers can tell "not logged in" apart from
// "logged in with a bad token" (the latter should 401, not be treated as
// anonymous).
async function getUidOrNull(request, env) {
  const idToken = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!idToken) return null;
  return await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
}

async function requireUid(request, env) {
  const idToken = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!idToken) { const e = new Error('Unauthorized'); e.status = 401; throw e; }
  return await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
}

// ---------------------------------------------------------------------
// Firebase Realtime Database
// ---------------------------------------------------------------------
async function firebaseAuthRequest(action, payload, apiKey) {
  const res = await fetch(`${FIREBASE_AUTH_URL}:${action}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return await res.json();
}

let serviceAccountCache = null;
let serviceAccountToken = null;
let serviceAccountTokenExp = 0;

async function getServiceAccountToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (serviceAccountToken && now < serviceAccountTokenExp - 60) return serviceAccountToken;

  if (!serviceAccountCache) {
    if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');
    serviceAccountCache = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  }
  const sa = serviceAccountCache;
  const jwtHeader = { alg: 'RS256', typ: 'JWT' };
  const jwtClaim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const headerStr = base64UrlEncode(JSON.stringify(jwtHeader));
  const claimStr = base64UrlEncode(JSON.stringify(jwtClaim));
  const unsigned = `${headerStr}.${claimStr}`;
  const privateKey = sa.private_key.replace(/\\n/g, '\n');
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const signedJwt = `${unsigned}.${base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)))}`;

  const tokenRes = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Failed to get service account token');
  serviceAccountToken = tokenData.access_token;
  serviceAccountTokenExp = now + 3500;
  return serviceAccountToken;
}

async function fbGet(path, dbUrl, env) {
  const token = await getServiceAccountToken(env);
  const res = await fetch(`${dbUrl}${path}.json?access_token=${token}`);
  if (!res.ok) return null;
  return await res.json();
}
async function fbSet(path, value, dbUrl, env) {
  const token = await getServiceAccountToken(env);
  const res = await fetch(`${dbUrl}${path}.json?access_token=${token}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  return res.ok;
}
async function fbPatch(path, value, dbUrl, env) {
  const token = await getServiceAccountToken(env);
  const res = await fetch(`${dbUrl}${path}.json?access_token=${token}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  return res.ok;
}
function dbUrlOf(env) { return env.FIREBASE_DB_URL.replace(/\/$/, ''); }

// The one place that decides "is this uid an admin/owner". Reused by every
// worker instead of each one re-implementing its own notion of admin.
async function isAdminUid(uid, env) {
  if (!uid) return false;
  return (await fbGet(`/admins/${uid}`, dbUrlOf(env), env)) === true;
}

// ---------------------------------------------------------------------
// GitHub content API (used by the content worker for hotels.json etc.)
// ---------------------------------------------------------------------
async function ghGetFile(owner, repo, branch, path, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'discover-sharm' },
  });
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const data = await res.json();
  const content = base64ToUtf8(data.content.replace(/\n/g, ''));
  return { content, sha: data.sha };
}
async function ghPutFile(owner, repo, branch, path, contentStr, sha, message, token) {
  const encoded = utf8ToBase64(contentStr);
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'discover-sharm', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: encoded, sha, branch }),
  });
  const result = await res.json();
  if (!res.ok) {
    if (res.status === 409) throw new Error('Conflict: file changed on server, please retry');
    throw new Error(`GitHub write failed: ${res.status}`);
  }
  return result;
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
// A booking is NOT written to /allBookings (or the customer's bookings) until the payment is confirmed.
// While the customer is paying, the details wait in /pendingBookings/{orderId} — a private checkout session that
// owners/admin/customers never see and that is discarded if payment never succeeds. On a confirmed payment
// (card response, wallet reconcile or Kashier webhook) commitPaidBooking() moves it into the real bookings
// atomically (exactly once), updates stats, and triggers the confirmation e-mail + voucher (notifications worker).
// ---------------------------------------------------------------------
async function fbCreateIfAbsent(path, value, dbUrl, env) {
  const token = await getServiceAccountToken(env);
  const res = await fetch(`${dbUrl}${path}.json?access_token=${token}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'if-match': 'null_etag' }, body: JSON.stringify(value) });
  return res.ok; // 412 => somebody else created it first
}
async function getOrder(orderId, dbUrl, env) {
  const pending = await fbGet(`/pendingBookings/${orderId}`, dbUrl, env);
  if (pending) return { booking: pending, pending: true };
  return { booking: await fbGet(`/allBookings/${orderId}`, dbUrl, env), pending: false };
}
// What the guest owes RIGHT NOW: amountDueNow if bookings-worker computed one
// (either the full total or the 50% deposit, per their chosen plan), or the
// full total for any booking made before this feature existed.
function payableNow(booking) { return booking.amountDueNow != null ? booking.amountDueNow : booking.total; }
// The later balance-collection charge uses "{orderId}-BAL" as its own Kashier
// order reference (Kashier rejects a reused one) — these map it back.
function isBalanceRef(reference) { return typeof reference === 'string' && reference.endsWith('-BAL'); }
function baseOrderId(reference) { return isBalanceRef(reference) ? reference.slice(0, -4) : reference; }
function notifyBookingConfirmed(orderId, env, ctx) {
  const job = (async () => {
    if (!env.INTERNAL_SECRET) { console.log('INTERNAL_SECRET missing: confirmation e-mail skipped'); return; }
    try {
      const call = env.NOTIFY ? (u, i) => env.NOTIFY.fetch(u, i) : fetch; // service binding NOTIFY (preferred) or NOTIFY_URL
      await call(env.NOTIFY_URL || 'https://notify.internal/api/notify/booking-confirmed', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': env.INTERNAL_SECRET }, body: JSON.stringify({ orderId }) });
    } catch (e) { console.log('notify failed', e && e.message); }
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(job);
  return job;
}
async function commitPaidBooking(orderId, extra, dbUrl, env, ctx) {
  const now = new Date().toISOString();
  let booking, created = false;
  // The confirming payment only ever covers payableNow(booking) (the deposit,
  // or the full total on 'full'-plan / legacy bookings) — never the balance.
  const depositFields = (b) => (b.paymentPlan === 'deposit' && b.remainingAmount > 0
    ? { paidAmount: payableNow(b), balanceAmount: b.remainingAmount, balanceStatus: 'due' }
    : { paidAmount: payableNow(b), balanceStatus: 'paid' });
  const legacy = await fbGet(`/allBookings/${orderId}`, dbUrl, env); // bookings created by the old flow (saved before payment)
  if (legacy) {
    if (legacy.status !== 'pending_payment') return { booking: legacy, created: false };
    const patch = { status: 'completed', paidAt: now, ...depositFields(legacy), ...extra };
    booking = { ...legacy, ...patch };
    await fbPatch(`/allBookings/${orderId}`, patch, dbUrl, env);
    created = true;
  } else {
    const pending = await fbGet(`/pendingBookings/${orderId}`, dbUrl, env);
    if (!pending) return null;
    const { expiresAt, lastPaymentStatus, paymentFlag, ...rest } = pending;
    booking = { ...rest, status: 'completed', paidAt: now, checkoutAt: pending.createdAt || null, createdAt: now, ...depositFields(pending), ...extra };
    created = await fbCreateIfAbsent(`/allBookings/${orderId}`, booking, dbUrl, env); // atomic claim: only ONE caller wins
    if (!created) return { booking: await fbGet(`/allBookings/${orderId}`, dbUrl, env), created: false };
  }
  if (booking.uid) {
    const { ownerUid, ...publicCopy } = booking; // the customer's copy never carries owner/finance internals
    await fbSet(`/users/${booking.uid}/bookings/${orderId}`, publicCopy, dbUrl, env);
    const stats = await fbGet(`/users/${booking.uid}/stats`, dbUrl, env) || { completedBookings: 0, totalSpent: 0 };
    await fbPatch(`/users/${booking.uid}/stats`, { completedBookings: (stats.completedBookings || 0) + 1, totalSpent: (stats.totalSpent || 0) + (booking.total || 0) }, dbUrl, env);
  }
  await fbSet(`/pendingBookings/${orderId}`, null, dbUrl, env);
  notifyBookingConfirmed(orderId, env, ctx);
  return { booking, created: true };
}
async function finalizeBalancePayment(orderId, kashierStatus, dbUrl, env, extra) {
  const status = (kashierStatus || '').toUpperCase();
  const booking = await fbGet(`/allBookings/${orderId}`, dbUrl, env);
  if (!booking) return null;
  if (booking.balanceStatus !== 'due') return booking.balanceStatus || 'paid'; // already settled or nothing was due — never double-charge
  if (status === 'SUCCESS' || status === 'PAID' || status === 'CAPTURED') {
    const now = new Date().toISOString();
    await fbPatch(`/allBookings/${orderId}`, { balanceStatus: 'paid', balancePaidAt: now, ...extra }, dbUrl, env);
    if (booking.uid) await fbPatch(`/users/${booking.uid}/bookings/${orderId}`, { balanceStatus: 'paid', balancePaidAt: now }, dbUrl, env);
    return 'paid';
  }
  if (status === 'FAILED' || status === 'FAILURE' || status === 'DECLINED') {
    await fbPatch(`/allBookings/${orderId}`, { lastBalancePaymentStatus: 'failed' }, dbUrl, env);
    return 'due';
  }
  return 'due';
}
async function finalizeBookingPayment(orderId, kashierStatus, dbUrl, env, ctx) {
  const status = (kashierStatus || '').toUpperCase();
  if (status === 'SUCCESS' || status === 'PAID' || status === 'CAPTURED') {
    const r = await commitPaidBooking(orderId, {}, dbUrl, env, ctx);
    return r ? (r.booking.status === 'completed' ? 'completed' : r.booking.status) : null;
  }
  const { booking, pending } = await getOrder(orderId, dbUrl, env);
  if (!booking) return null;
  if (status === 'FAILED' || status === 'FAILURE' || status === 'DECLINED') {
    if (pending) { await fbPatch(`/pendingBookings/${orderId}`, { lastPaymentStatus: 'failed' }, dbUrl, env); return 'failed'; } // nothing is saved as a booking
    if (booking.status === 'pending_payment') { await fbSet(`/allBookings/${orderId}/status`, 'failed', dbUrl, env); if (booking.uid) await fbSet(`/users/${booking.uid}/bookings/${orderId}/status`, 'failed', dbUrl, env); return 'failed'; }
  }
  return pending ? 'pending_payment' : booking.status;
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
 * /allBookings entry rather than creating a new booking.
 */

const LIMITS = {
  charge: { limit: 10, window: 60 },   // card charge attempts
  poll: { limit: 30, window: 60 },     // status polling
  webhook: { limit: 120, window: 60 }, // Kashier's own servers call this
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { headers: corsHeadersForRequest(request) });

    const dbUrl = dbUrlOf(env);

    // SECURITY: orderId becomes a database path (/allBookings/{orderId}) — reject traversal characters up front.
    if (method === 'POST' && path.startsWith('/api/kashier/') && path !== '/api/kashier/webhook') {
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
      const order = await getOrder(orderId, dbUrl, env);
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
      const { orderId, amount, currency, card, save, customer } = body || {};
      if (!orderId || !amount || !currency) return json({ error: 'orderId, amount and currency required' }, 400, request);
      if (!card || !card.number || !card.month || !card.year || !card.cvv) return json({ error: 'Card details required' }, 400, request);

      const { booking, pending } = await getOrder(orderId, dbUrl, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.status === 'completed') return json({ status: 'captured', message: 'Already paid' }, 200, request); // never charge twice
      if (!pending && booking.status !== 'pending_payment') return json({ error: 'Booking is not payable' }, 409, request);
      const orderPath = pending ? `/pendingBookings/${orderId}` : `/allBookings/${orderId}`;
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
        await fbSet(`${orderPath}/kashierOrderId`, r.orderId || null, dbUrl, env);
        return json({ status: '3ds_required', ...sanitizeKashierResponse(kashierData) }, 200, request);
      }
      const finalStatus = await finalizeBookingPayment(orderId, r.status || r.result, dbUrl, env, ctx);
      if (!kashierRes.ok || (r.result && r.result !== 'SUCCESS')) return json({ ...sanitizeKashierResponse(kashierData), status: 'failed' }, 200, request);
      return json({ ...sanitizeKashierResponse(kashierData), status: finalStatus === 'completed' ? 'captured' : 'pending' }, 200, request); // our status must win over the gateway's raw one
    }

    if (path === '/api/kashier/charge-status' && method === 'POST') {
      if (await isRateLimited(request, env, 'kashier-poll', LIMITS.poll.limit, LIMITS.poll.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { orderId } = body || {};
      if (!orderId) return json({ error: 'orderId required' }, 400, request);
      let cur = await getOrder(orderId, dbUrl, env);
      if (!cur.booking || cur.booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      // right after 3-D Secure the webhook may still be on its way: give it a few seconds to commit the booking
      for (let i = 0; cur.pending && cur.booking.lastPaymentStatus !== 'failed' && i < 4; i++) { await new Promise(r => setTimeout(r, 1500)); cur = await getOrder(orderId, dbUrl, env); if (!cur.booking) break; }
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
      const { booking, pending } = await getOrder(orderId, dbUrl, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.status === 'completed') return json({ status: 'captured', message: 'Already paid' }, 200, request); // never charge twice
      if (!pending && booking.status !== 'pending_payment') return json({ error: 'Booking is not payable' }, 409, request);
      const orderPath = pending ? `/pendingBookings/${orderId}` : `/allBookings/${orderId}`;
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
      if (r.authentication?.redirectUrl) return json({ status: '3ds_required', ...sanitizeKashierResponse(kashierData) }, 200, request);
      const finalStatus = await finalizeBookingPayment(orderId, r.status || r.result, dbUrl, env, ctx);
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
      const { booking, pending } = await getOrder(orderId, dbUrl, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.status === 'completed') return json({ status: 'captured', message: 'Already paid' }, 200, request); // never charge twice
      if (!pending && booking.status !== 'pending_payment') return json({ error: 'Booking is not payable' }, 409, request);
      const orderPath = pending ? `/pendingBookings/${orderId}` : `/allBookings/${orderId}`;
      if (String(payableNow(booking)) !== String(amount) || booking.currency !== currency) return json({ error: 'Amount/currency does not match the booking' }, 400, request);
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
      if (!merchantId || !apiKey) return json({ error: 'Kashier not configured' }, 500, request);
      const hash = await kashierPaymentHash(merchantId, orderId, amount, currency, apiKey);
      const payload = { apiOperation: 'INITIATE_R2P', paymentMethod: { type: 'wallet' }, order: { reference: orderId, amount, currency }, customer: { mobilePhone }, interactionSource: 'ECOMMERCE', reconciliation: { webhookUrl: `${url.origin}/api/kashier/webhook` }, merchantId };
      const res = await fetch(`${kashierFepBase(env)}/v3/orders/`, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json', 'Kashier-Hash': hash }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.response?.result !== 'SUCCESS') return json({ status: 'failed', message: data?.response?.transactionResponseMessage?.en || 'Could not start the wallet request' }, 200, request);
      await fbSet(`${orderPath}/kashierOrderId`, data.response.order?.systemOrderId || null, dbUrl, env);
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
      const { booking } = await getOrder(orderId, dbUrl, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      if (booking.status === 'completed' || booking.status === 'failed') return json({ status: booking.status }, 200, request);
      const merchantId = env.KASHIER_MERCHANT_ID, apiKey = env.KASHIER_API_KEY;
      if (!merchantId || !apiKey) return json({ error: 'Kashier not configured' }, 500, request);
      const hash = await kashierPaymentHash(merchantId, orderId, booking.total, booking.currency, apiKey);
      const target = booking.kashierOrderId || orderId;
      const res = await fetch(`${kashierFepBase(env)}/v3/orders/${encodeURIComponent(target)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', accept: 'application/json', 'Kashier-Hash': hash }, body: JSON.stringify({ apiOperation: 'RECONCILE_WALLET', paymentMethod: { type: 'wallet' }, merchantId }) });
      const data = await res.json().catch(() => ({}));
      const kStatus = data?.response?.status || (res.status === 400 ? 'FAILURE' : '');
      const finalStatus = await finalizeBookingPayment(orderId, kStatus, dbUrl, env, ctx);
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

      const booking = await fbGet(`/allBookings/${orderId}`, dbUrl, env);
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
      if (r.authentication?.redirectUrl) return json({ status: '3ds_required', ...sanitizeKashierResponse(kashierData) }, 200, request);
      const finalStatus = await finalizeBalancePayment(orderId, r.status || r.result, dbUrl, env);
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

      const booking = await fbGet(`/allBookings/${orderId}`, dbUrl, env);
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
      if (r.authentication?.redirectUrl) return json({ status: '3ds_required', ...sanitizeKashierResponse(kashierData) }, 200, request);
      const finalStatus = await finalizeBalancePayment(orderId, r.status || r.result, dbUrl, env);
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
      let booking = await fbGet(`/allBookings/${orderId}`, dbUrl, env);
      if (!booking || booking.uid !== uid) return json({ error: 'Booking not found' }, 404, request);
      for (let i = 0; booking.balanceStatus === 'due' && booking.lastBalancePaymentStatus !== 'failed' && i < 4; i++) { await new Promise(r => setTimeout(r, 1500)); booking = await fbGet(`/allBookings/${orderId}`, dbUrl, env); }
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
        const bal = await fbGet(`/allBookings/${bId}`, dbUrl, env);
        if (!bal) return json({ status: 'received', warning: 'Booking not found' }, 200, request);
        if (status === 'SUCCESS' || status === 'PAID') {
          const paid = Number(payload.data?.amount);
          if (isFinite(paid) && paid > 0 && Math.abs(paid - Number(bal.remainingAmount)) > 0.01) {
            await fbPatch(`/allBookings/${bId}`, { balancePaymentFlag: 'amount_mismatch' }, dbUrl, env);
            return json({ status: 'received', warning: 'Amount mismatch — balance not marked paid' }, 200, request);
          }
          await finalizeBalancePayment(bId, 'SUCCESS', dbUrl, env, { kashierOrderId: payload.data?.kashierOrderId || bal.kashierOrderId || null });
        } else if (status === 'FAILED') {
          await finalizeBalancePayment(bId, 'FAILED', dbUrl, env);
        }
        return json({ status: 'received' }, 200, request);
      }

      const merchantOrderId = reference;
      const { booking, pending } = await getOrder(merchantOrderId, dbUrl, env);
      if (!booking) return json({ status: 'received', warning: 'Booking not found' }, 200, request);
      if (status === 'SUCCESS' || status === 'PAID') {
        if (!pending && booking.status !== 'pending_payment') return json({ status: 'received', note: 'Booking already finalized' }, 200, request);
        // the gateway must have collected exactly the deposit (or full total) — never more, never less
        const paid = Number(payload.data?.amount);
        if (isFinite(paid) && paid > 0 && Math.abs(paid - Number(payableNow(booking))) > 0.01) {
          if (pending) await fbPatch(`/pendingBookings/${merchantOrderId}`, { paymentFlag: 'amount_mismatch', paidAmount: paid }, dbUrl, env);
          return json({ status: 'received', warning: 'Amount mismatch — booking not created' }, 200, request);
        }
        await commitPaidBooking(merchantOrderId, { kashierOrderId: payload.data?.kashierOrderId || booking.kashierOrderId || null }, dbUrl, env, ctx);
      } else if (status === 'FAILED') {
        if (pending) await fbPatch(`/pendingBookings/${merchantOrderId}`, { lastPaymentStatus: 'failed' }, dbUrl, env);
        else if (booking.status === 'pending_payment') { await fbSet(`/allBookings/${merchantOrderId}/status`, 'failed', dbUrl, env); if (booking.uid) await fbSet(`/users/${booking.uid}/bookings/${merchantOrderId}/status`, 'failed', dbUrl, env); }
      } else if (status === 'REFUNDED' && !pending) {
        const f = { status: 'refunded', needsRefund: false };
        if (booking.earning && !booking.earning.void) f.earning = { ...booking.earning, void: true, voidedAt: new Date().toISOString() };
        await fbPatch(`/allBookings/${merchantOrderId}`, f, dbUrl, env);
        if (booking.uid) await fbSet(`/users/${booking.uid}/bookings/${merchantOrderId}/status`, 'refunded', dbUrl, env);
      }
      return json({ status: 'received' }, 200, request);
    }

    return json({ error: 'Not found' }, 404, request);
  },
};
