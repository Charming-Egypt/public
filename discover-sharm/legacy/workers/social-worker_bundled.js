/**
 * Discover Sharm — social worker (bundled, single-file, no imports)
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
async function finalizeBookingPayment(merchantOrderId, kashierStatus, dbUrl, env) {
  const booking = await fbGet(`/allBookings/${merchantOrderId}`, dbUrl, env);
  if (!booking) return null;
  if (booking.status === 'completed' || booking.status === 'failed') return booking.status;
  const status = (kashierStatus || '').toUpperCase();
  if (status === 'SUCCESS' || status === 'PAID' || status === 'CAPTURED') {
    await fbSet(`/allBookings/${merchantOrderId}/status`, 'completed', dbUrl, env);
    if (booking.uid) {
      await fbSet(`/users/${booking.uid}/bookings/${merchantOrderId}/status`, 'completed', dbUrl, env);
      const stats = await fbGet(`/users/${booking.uid}/stats`, dbUrl, env) || { completedBookings: 0, totalSpent: 0 };
      await fbPatch(`/users/${booking.uid}/stats`, {
        completedBookings: (stats.completedBookings || 0) + 1,
        totalSpent: (stats.totalSpent || 0) + (booking.total || 0),
      }, dbUrl, env);
    }
    return 'completed';
  }
  if (status === 'FAILED' || status === 'FAILURE' || status === 'DECLINED') {
    await fbSet(`/allBookings/${merchantOrderId}/status`, 'failed', dbUrl, env);
    if (booking.uid) await fbSet(`/users/${booking.uid}/bookings/${merchantOrderId}/status`, 'failed', dbUrl, env);
    return 'failed';
  }
  return booking.status;
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

// ==================== social worker ====================
/**
 * Discover Sharm — Social Worker
 * Routes: /api/reviews (GET/POST), /api/contact, /api/partner-application,
 *         /api/notifications (GET/POST), /api/profile (GET/POST)
 */

const LIMITS = { read: { limit: 60, window: 60 }, write: { limit: 20, window: 60 }, contact: { limit: 5, window: 300 } };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { headers: corsHeadersForRequest(request) });

    const dbUrl = dbUrlOf(env);

    if (path === '/api/reviews' && method === 'POST') {
      if (await isRateLimited(request, env, 'reviews-write', LIMITS.write.limit, LIMITS.write.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { type, id, rating, comment, name, bookingId, photoURL, image, images } = body;
      if (!type || !id || !rating || !comment || !name || !bookingId) return json({ error: 'Missing fields' }, 400, request);
      if (!['hotel', 'excursion', 'restaurant'].includes(type)) return json({ error: 'Invalid review type' }, 400, request);
      // SECURITY: type/id/bookingId become database paths — reject anything with . / # $ [ ] (path traversal).
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id)) || !/^[A-Za-z0-9_-]{1,64}$/.test(String(bookingId))) return json({ error: 'Invalid id' }, 400, request);
      if (!isValidRating(rating)) return json({ error: 'Rating must be integer 1-5' }, 400, request);
      if (!isNonEmptyString(comment) || !isNonEmptyString(name)) return json({ error: 'Name and comment required' }, 400, request);
      try {
        const booking = await fbGet(`/allBookings/${bookingId}`, dbUrl, env);
        if (!booking || booking.uid !== uid) return json({ error: 'Booking not found or does not belong to user' }, 400, request);
        if (booking.reviewed) return json({ error: 'Booking already reviewed' }, 400, request);
        const reviewId = 'rev_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const photos = Array.isArray(images) ? images.slice(0, 6) : (image ? [image] : []);
        const review = { id: reviewId, bookingId, name: name.trim(), rating, comment: comment.trim(), photoURL: photoURL || null, images: photos, createdAt: new Date().toISOString(), uid };
        await fbSet(`/reviews/${type}/${id}/${reviewId}`, review, dbUrl, env);
        await fbSet(`/allBookings/${bookingId}/reviewed`, true, dbUrl, env);
        await fbSet(`/users/${uid}/bookings/${bookingId}/reviewed`, true, dbUrl, env);
        return json({ success: true, review }, 200, request);
      } catch (e) { return json({ error: e.message }, 500, request); }
    }

    if (path === '/api/reviews' && method === 'GET') {
      if (await isRateLimited(request, env, 'reviews-read', LIMITS.read.limit, LIMITS.read.window)) return json({ error: 'Too many requests' }, 429, request);
      const type = url.searchParams.get('type'), id = url.searchParams.get('id');
      if (!type || !id) return json({ error: 'type and id required' }, 400, request);
      if (!['hotel', 'excursion', 'restaurant'].includes(type) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: 'Invalid type or id' }, 400, request);
      const reviews = await fbGet(`/reviews/${type}/${id}`, dbUrl, env);
      return json({ success: true, reviews: reviews ? Object.values(reviews) : [] }, 200, request);
    }

    if (path === '/api/contact' && method === 'POST') {
      if (await isRateLimited(request, env, 'contact', LIMITS.contact.limit, LIMITS.contact.window)) return json({ error: 'Too many requests' }, 429, request);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { name, email, message } = body;
      if (!isNonEmptyString(name) || !isValidEmail(email) || !isNonEmptyString(message)) return json({ error: 'Name, valid email, and message required' }, 400, request);
      try {
        const msgId = 'msg_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        await fbSet(`/contactMessages/${msgId}`, { id: msgId, name: name.trim(), email: email.trim(), message: message.trim(), status: 'new', createdAt: new Date().toISOString() }, dbUrl, env);
        return json({ success: true }, 200, request);
      } catch (e) { return json({ error: 'Failed to send message: ' + e.message }, 500, request); }
    }

    if (path === '/api/partner-application' && method === 'POST') {
      if (await isRateLimited(request, env, 'partner-app', LIMITS.contact.limit, LIMITS.contact.window)) return json({ error: 'Too many requests' }, 429, request);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { partnerType, businessName, contactName, phone, email, message, documents } = body;
      if (!['Hotel', 'Trip Supplier', 'Transfer'].includes(partnerType)) return json({ error: 'Invalid partner type' }, 400, request);
      if (!isNonEmptyString(businessName) || !isNonEmptyString(contactName) || !isValidPhone(phone) || !isValidEmail(email)) return json({ error: 'Business name, contact name, valid phone, and valid email required' }, 400, request);
      const docs = Array.isArray(documents) ? documents.slice(0, 4) : [];
      const totalSize = docs.reduce((sum, d) => sum + (d.data ? d.data.length : 0), 0);
      if (totalSize > 3 * 1024 * 1024 * 1.4) return json({ error: 'Uploaded documents are too large — please keep each file under a few MB' }, 400, request);
      try {
        const appId = 'partner_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        await fbSet(`/partnerApplications/${appId}`, { id: appId, partnerType, businessName: businessName.trim(), contactName: contactName.trim(), phone: phone.trim(), email: email.trim(), message: (message || '').trim(), documents: docs.map(d => ({ name: d.name || 'document', data: d.data })), status: 'new', createdAt: new Date().toISOString() }, dbUrl, env);
        return json({ success: true }, 200, request);
      } catch (e) { return json({ error: 'Failed to submit application: ' + e.message }, 500, request); }
    }

    if (path === '/api/notifications' && method === 'GET') {
      if (await isRateLimited(request, env, 'notif-read', LIMITS.read.limit, LIMITS.read.window)) return json({ error: 'Too many requests' }, 429, request);
      try {
        const uid = await requireUid(request, env);
        const notifications = await fbGet(`/users/${uid}/notifications`, dbUrl, env);
        return json({ success: true, notifications: notifications ? Object.values(notifications) : [] }, 200, request);
      } catch (e) { return json({ error: e.message }, e.status || 401, request); }
    }

    if (path === '/api/notifications' && method === 'POST') {
      if (await isRateLimited(request, env, 'notif-write', LIMITS.write.limit, LIMITS.write.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { notification } = body;
      if (!notification || typeof notification !== 'object') return json({ error: 'notification object required' }, 400, request);
      try {
        const notifId = 'notif_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const fullNotif = { id: notifId, read: false, createdAt: new Date().toISOString(), ...notification };
        await fbSet(`/users/${uid}/notifications/${notifId}`, fullNotif, dbUrl, env);
        return json({ success: true, notification: fullNotif }, 200, request);
      } catch (e) { return json({ error: e.message }, 500, request); }
    }

    if (path === '/api/profile' && method === 'GET') {
      if (await isRateLimited(request, env, 'profile-read', LIMITS.read.limit, LIMITS.read.window)) return json({ error: 'Too many requests' }, 429, request);
      try {
        const uid = await requireUid(request, env);
        const profile = await fbGet(`/users/${uid}/profile`, dbUrl, env) || {};
        const stats = await fbGet(`/users/${uid}/stats`, dbUrl, env) || {};
        const geniusLevel = calculateGeniusLevel(stats);
        if (profile.loyaltyTier !== geniusLevel) await fbSet(`/users/${uid}/profile/loyaltyTier`, geniusLevel, dbUrl, env);
        return json({ success: true, profile: { ...profile, loyaltyTier: geniusLevel, stats } }, 200, request);
      } catch (e) { return json({ error: e.message }, e.status || 401, request); }
    }

    if (path === '/api/profile' && method === 'POST') {
      if (await isRateLimited(request, env, 'profile-write', LIMITS.write.limit, LIMITS.write.window)) return json({ error: 'Too many requests' }, 429, request);
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { profile } = body;
      if (!profile || typeof profile !== 'object') return json({ error: 'profile object required' }, 400, request);
      const allowedFields = ['name', 'phone', 'countryCode', 'photoURL'];
      const cleanedProfile = {};
      for (const f of allowedFields) if (profile[f] !== undefined) cleanedProfile[f] = profile[f];
      if (cleanedProfile.phone && !isValidPhone(cleanedProfile.phone)) return json({ error: 'Invalid phone number' }, 400, request);
      try {
        const existing = await fbGet(`/users/${uid}/profile`, dbUrl, env) || {};
        const updatedProfile = { ...existing, ...cleanedProfile };
        await fbSet(`/users/${uid}/profile`, updatedProfile, dbUrl, env);
        return json({ success: true, uid }, 200, request);
      } catch (e) { return json({ error: e.message }, 500, request); }
    }

    return json({ error: 'Not found' }, 404, request);
  },
};
