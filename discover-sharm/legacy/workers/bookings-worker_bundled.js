/**
 * Discover Sharm — bookings worker (bundled, single-file, no imports)
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
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'discover-sharm' };
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const data = await res.json();
  if (data.content) return { content: base64ToUtf8(data.content.replace(/\n/g, '')), sha: data.sha };
  // Files over 1MB (e.g. lots of base64 images) come back without content from the JSON API -> fetch the raw body.
  const raw = await fetch(url, { headers: { ...headers, 'Accept': 'application/vnd.github.raw+json' } });
  if (!raw.ok) throw new Error(`GitHub raw read failed: ${raw.status}`);
  return { content: await raw.text(), sha: data.sha };
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


// ---------------------------------------------------------------------
// Owner stamping: every booking carries ownerUid = the owner of the booked
// hotel / trip / transfer, looked up server-side from /itemOwners (kept up to
// date by the owner + super-admin workers). Never trusted from the client.
// ---------------------------------------------------------------------
const PENDING_TTL_MS = 2 * 60 * 60 * 1000; // an unpaid checkout session is valid for 2 hours
const OWNER_ID_FIELD = { hotel: 'hotelId', excursion: 'excursionId', transfer: 'transferId' };
async function ownerOfItem(booking, dbUrl, env) {
  const idField = OWNER_ID_FIELD[booking.type];
  const itemId = idField && booking[idField];
  if (!itemId || typeof itemId !== 'string' || /[.#$\[\]\/]/.test(itemId)) return null;
  const owner = await fbGet(`/itemOwners/${booking.type}/${itemId}`, dbUrl, env);
  return typeof owner === 'string' ? owner : null;
}
// SECURITY: booking ids become database paths. Without this, an id like "../roles/<uid>" could
// overwrite other parts of the database (e.g. grant itself a role).
function isSafeBookingId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(id); }
function stripServerFields(b) {
  delete b.ownerUid; delete b.ownerStatus; delete b.ownerNote; delete b.adminNote;
  delete b.needsRefund; delete b.cancelledBy; delete b.cancelReason; delete b.cancelledAt;
}


// ---------------------------------------------------------------------
// SERVER-SIDE PRICING — mirrors booking.js exactly. The total sent by the browser is NEVER trusted:
// it is recomputed from the catalog (hotels.json / excursions.json / transfers.json) and must match.
// Needs GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, GITHUB_TOKEN (+ GITHUB_READ_PATH) on THIS worker too.
// ---------------------------------------------------------------------
const PRICE_TAX = { hotel: 0.1, excursion: 0.05, transfer: 0.05 };
const PRICE_SRC = { hotel: ['hotels.json', 'hotelId'], excursion: ['excursions.json', 'excursionId'], transfer: ['transfers.json', 'transferId'] };
const _catCache = {};
const priceErr = (status, message) => Object.assign(new Error(message), { status });
async function readCatalogFile(env, file, fresh) {
  const c = _catCache[file];
  if (!fresh && c && Date.now() - c.at < 10000) return c.data;
  const base = env.GITHUB_READ_PATH || env.GITHUB_WRITE_PATH || 'bucket/m/data';
  const { content } = await ghGetFile(env.GITHUB_OWNER, env.GITHUB_REPO, env.GITHUB_BRANCH || 'main', `${base}/${file}`, env.GITHUB_TOKEN);
  const data = JSON.parse(content);
  _catCache[file] = { at: Date.now(), data };
  return data;
}
const pIsoDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const pTodayEg = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
function pInt(v, min, max, label) { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw priceErr(400, 'Invalid ' + label); return n; }
function pChildFee(room, age) {
  const tiers = room.childPricingTiers;
  if (Array.isArray(tiers) && tiers.length) { const tier = tiers.find(t => age >= t.minAge && age <= t.maxAge); if (tier) return tier.fee || 0; }
  return room.extraChildFee || 0;
}
function pRoomTotal(room, adults, childAges, roomsCount, nights) {
  const baseOcc = room.baseOccupancy || 2, extraAdultFee = room.extraAdultFee || 0;
  const extraAdults = Math.max(0, Math.ceil(adults / roomsCount) - baseOcc);
  const ages = childAges.filter(a => a !== null && a !== undefined && !isNaN(a));
  const fees = ages.map(age => pChildFee(room, age)).sort((a, b) => a - b);
  const freeSlots = Math.max(0, (room.freeChildrenPerRoom ?? 2) * roomsCount);
  const childPerNight = fees.slice(freeSlots).reduce((sum, f) => sum + f, 0);
  return (room.price + (extraAdults * extraAdultFee)) * roomsCount * nights + childPerNight * nights;
}
function computePrice(b, item) {
  const today = pTodayEg();
  let subtotal;
  if (b.type === 'hotel') {
    if (!pIsoDay(b.checkin) || !pIsoDay(b.checkout)) throw priceErr(400, 'Invalid dates');
    if (b.checkin < today) throw priceErr(400, 'Check-in date is in the past');
    const ms = new Date(b.checkout) - new Date(b.checkin);
    if (!(ms > 0)) throw priceErr(400, 'Check-out must be after check-in');
    const nights = Math.max(1, Math.round(ms / 86400000));
    if (nights > 60) throw priceErr(400, 'Stay too long');
    const adults = pInt(b.adults, 1, 10, 'adults'), children = pInt(b.children == null ? 0 : b.children, 0, 6, 'children'), rooms = pInt(b.rooms, 1, 5, 'rooms');
    const rl = Array.isArray(item.rooms) ? item.rooms : [];
    let idx = Number.isInteger(b.roomIndex) ? b.roomIndex : -1;
    if (idx < 0) { const want = b.roomType && typeof b.roomType === 'object' ? Object.values(b.roomType) : [b.roomType]; idx = rl.findIndex(r => Object.values(r.type && typeof r.type === 'object' ? r.type : { x: r.type }).some(v => want.includes(v))); }
    const room = rl[idx];
    if (!room || typeof room.price !== 'number') throw priceErr(400, 'Room not found');
    const ages = (Array.isArray(b.childAges) ? b.childAges : []).slice(0, 6);
    const blocked = new Set(Array.isArray(item.unavailableDates) ? item.unavailableDates : []);
    for (let i = 0; i < nights; i++) { const d = new Date(new Date(b.checkin + 'T00:00:00Z').getTime() + i * 86400000).toISOString().slice(0, 10); if (blocked.has(d)) throw priceErr(409, 'Selected dates are not available'); }
    subtotal = pRoomTotal(room, adults, ages, rooms, nights);
    var nightsOut = nights;
  } else {
    if (typeof item.price !== 'number') throw priceErr(500, 'Item has no price');
    if (!pIsoDay(b.date) || b.date < today) throw priceErr(400, 'Invalid or past date');
    subtotal = b.type === 'excursion' ? item.price * pInt(b.participants, 1, 50, 'participants') : (pInt(b.passengers, 1, 50, 'passengers'), item.price);
  }
  const taxes = Math.round(subtotal * PRICE_TAX[b.type]);
  const total = subtotal + taxes;
  const deposit = Math.round(total * 0.5); // DEPOSIT_RATIO — must match booking.js exactly
  return { subtotal, taxes, total, deposit, remaining: total - deposit, nights: nightsOut };
}
async function enforcePrice(booking, env) {
  const src = PRICE_SRC[booking.type];
  if (!src) throw priceErr(400, 'Unknown booking type');
  if (booking.currency !== 'EGP') throw priceErr(400, 'Only EGP is supported');
  const id = booking[src[1]];
  if (typeof id !== 'string' || !id) throw priceErr(400, 'Missing item id');
  const attempt = async (fresh) => {
    const item = (await readCatalogFile(env, src[0], fresh)).find(i => i && i.id === id);
    if (!item) throw priceErr(404, 'Item not found');
    return computePrice(booking, item);
  };
  let p = await attempt(false);
  if (p.total !== Number(booking.total)) p = await attempt(true); // catalog may have just changed
  if (p.total !== Number(booking.total)) { const e = priceErr(409, 'السعر اتغيّر — حدّث الصفحة وحاول تاني (Price changed, please refresh)'); e.total = p.total; throw e; }
  if (p.nights) booking.nights = p.nights;
  booking.subtotal = p.subtotal; booking.taxes = p.taxes; booking.total = p.total;
  booking.depositAmount = p.deposit; booking.remainingAmount = p.remaining;
  // The guest's choice ('full' vs '50% deposit') — never trust anything else
  // the client sent here; this is the one place that decides it.
  booking.paymentPlan = booking.paymentPlan === 'deposit' ? 'deposit' : 'full';
  booking.amountDueNow = booking.paymentPlan === 'deposit' ? p.deposit : p.total;
  booking.balanceStatus = booking.paymentPlan === 'deposit' ? 'due' : 'paid';
}

// ==================== bookings worker ====================
/**
 * Discover Sharm — Bookings Worker
 * Routes: /api/hotels/search, /api/hotels/checkrates, /api/hotels/book,
 *         /api/hotels/booking/:ref (GET/DELETE), /api/user/bookings (GET/POST),
 *         /api/user/favorites (GET/POST)
 *
 * SECURITY FIX (this pass): GET and DELETE /api/hotels/booking/:ref used to
 * return/cancel ANY booking by id with no auth check at all — a guessed or
 * leaked reference number was enough to read a stranger's name/phone/email
 * or cancel their trip. Both now require a valid Firebase ID token and only
 * allow the request through when the booking belongs to that uid, OR the
 * uid is listed under /admins in the database (same admin flag the content
 * worker already uses for /api/file). The owner panel keeps working by
 * sending its admin token — see the owner/ex.html patch notes below.
 */

// Requests per IP per minute, tuned per action. Booking-by-reference and
// cancellation are tighter since they're the ones an attacker would script
// to enumerate reference numbers.
const LIMITS = {
  search: { limit: 60, window: 60 },
  lookup: { limit: 20, window: 60 },
  write: { limit: 30, window: 60 },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeadersForRequest(request) });
    }

    const dbUrl = dbUrlOf(env);

    // ---- Hotel search / checkrates (public, generous limit) ----
    if (path === '/api/hotels/search' && method === 'POST') {
      if (await isRateLimited(request, env, 'hotels-search', LIMITS.search.limit, LIMITS.search.window)) {
        return json({ error: 'Too many requests' }, 429, request);
      }
      return json({ success: true, data: { hotels: [] } }, 200, request);
    }
    if (path === '/api/hotels/checkrates' && method === 'POST') {
      if (await isRateLimited(request, env, 'hotels-search', LIMITS.search.limit, LIMITS.search.window)) {
        return json({ error: 'Too many requests' }, 429, request);
      }
      return json({ success: true, data: { available: true } }, 200, request);
    }

    // ---- Create booking (optional auth) ----
    if (path === '/api/hotels/book' && method === 'POST') {
      if (await isRateLimited(request, env, 'hotels-write', LIMITS.write.limit, LIMITS.write.window)) {
        return json({ error: 'Too many requests' }, 429, request);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { idToken, ...bookingData } = body;
      if (!bookingData.id || !bookingData.type || !bookingData.total || !bookingData.currency) {
        return json({ error: 'Missing required booking fields: id, type, total, currency' }, 400, request);
      }
      if (!isValidAmount(bookingData.total)) return json({ error: 'Invalid total amount' }, 400, request);
      if (!isSafeBookingId(bookingData.id)) return json({ error: 'Invalid booking id' }, 400, request);
      let uid = null;
      if (idToken) {
        try { uid = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID); } catch (e) { return json({ error: e.message }, 401, request); }
      }
      const bookingId = bookingData.id;
      stripServerFields(bookingData);
      if (await fbGet(`/allBookings/${bookingData.id}`, dbUrl, env)) return json({ error: 'Booking id already exists' }, 409, request);
      try { await enforcePrice(bookingData, env); } catch (e) { return json({ error: e.message, ...(e.total !== undefined ? { total: e.total } : {}) }, e.status || 500, request); }
      const prev = await fbGet(`/pendingBookings/${bookingId}`, dbUrl, env);
      if (prev && prev.uid !== (uid || null)) return json({ error: 'Booking id already exists' }, 409, request);
      // PAY FIRST, SAVE AFTER: this is only a checkout session. The real booking is created by the payments worker once the payment is confirmed.
      const booking = { ...bookingData, status: 'pending_payment', reviewed: false, createdAt: new Date().toISOString(), expiresAt: Date.now() + PENDING_TTL_MS, uid: uid || null, ownerUid: await ownerOfItem(bookingData, dbUrl, env) };
      if (!(await fbSet(`/pendingBookings/${bookingId}`, booking, dbUrl, env))) return json({ error: 'Database write failed' }, 500, request);
      return json({ success: true, booking }, 200, request);
    }

    // ---- Get one booking by reference (owner or admin only) ----
    if (path.startsWith('/api/hotels/booking/') && method === 'GET') {
      if (await isRateLimited(request, env, 'booking-lookup', LIMITS.lookup.limit, LIMITS.lookup.window)) {
        return json({ error: 'Too many requests' }, 429, request);
      }
      const ref = decodeURIComponent(path.split('/').pop());
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      const booking = await fbGet(`/allBookings/${ref}`, dbUrl, env);
      if (!booking) return json({ error: 'Booking not found' }, 404, request);
      const owns = booking.uid === uid;
      if (!owns && !(await isAdminUid(uid, env))) return json({ error: 'Booking not found' }, 404, request);
      return json({ success: true, booking }, 200, request);
    }

    // ---- Cancel booking (owner or admin only) ----
    if (path.startsWith('/api/hotels/booking/') && method === 'DELETE') {
      if (await isRateLimited(request, env, 'booking-lookup', LIMITS.lookup.limit, LIMITS.lookup.window)) {
        return json({ error: 'Too many requests' }, 429, request);
      }
      const ref = decodeURIComponent(path.split('/').pop());
      let uid;
      try { uid = await requireUid(request, env); } catch (e) { return json({ error: e.message }, e.status || 401, request); }
      const booking = await fbGet(`/allBookings/${ref}`, dbUrl, env);
      if (!booking) return json({ error: 'Booking not found' }, 404, request);
      const owns = booking.uid === uid;
      if (!owns && !(await isAdminUid(uid, env))) return json({ error: 'Booking not found' }, 404, request);
      await fbSet(`/allBookings/${ref}/status`, 'cancelled', dbUrl, env);
      if (booking.uid) await fbSet(`/users/${booking.uid}/bookings/${ref}/status`, 'cancelled', dbUrl, env);
      return json({ success: true, cancellation: { reference: ref, status: 'cancelled' } }, 200, request);
    }

    // ---- Logged-in customer's own booking list (already scoped by uid) ----
    if (path === '/api/user/bookings' && method === 'GET') {
      if (await isRateLimited(request, env, 'user-bookings', LIMITS.lookup.limit, LIMITS.lookup.window)) {
        return json({ error: 'Too many requests' }, 429, request);
      }
      try {
        const uid = await requireUid(request, env);
        const bookings = await fbGet(`/users/${uid}/bookings`, dbUrl, env);
        return json({ success: true, bookings: bookings ? Object.values(bookings) : [] }, 200, request);
      } catch (e) { return json({ error: e.message }, e.status || 401, request); }
    }

    if (path === '/api/user/bookings' && method === 'POST') {
      if (await isRateLimited(request, env, 'user-bookings-write', LIMITS.write.limit, LIMITS.write.window)) {
        return json({ error: 'Too many requests' }, 429, request);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { booking } = body;
      if (!booking || typeof booking !== 'object') return json({ error: 'booking object required' }, 400, request);
      if (!booking.id || !booking.type || !booking.total || !booking.currency) {
        return json({ error: 'Missing required booking fields: id, type, total, currency' }, 400, request);
      }
      if (!isValidAmount(booking.total)) return json({ error: 'Invalid total amount' }, 400, request);
      if (!isSafeBookingId(booking.id)) return json({ error: 'Invalid booking id' }, 400, request);
      try {
        const uid = await requireUid(request, env);
        const bookingId = booking.id;
        // Never trust status/owner fields from the client: a booking always starts unpaid,
        // and only the payments worker / admin workers move it forward.
        if (await fbGet(`/allBookings/${bookingId}`, dbUrl, env)) return json({ error: 'Booking id already exists' }, 409, request);
        const prev = await fbGet(`/pendingBookings/${bookingId}`, dbUrl, env);
        if (prev && prev.uid !== uid) return json({ error: 'Booking id already exists' }, 409, request);
        stripServerFields(booking);
        await enforcePrice(booking, env); // recompute price from the catalog; throws 409 if the client total is wrong
        booking.uid = uid;
        booking.status = 'pending_payment';
        booking.reviewed = false;
        booking.createdAt = new Date().toISOString();
        booking.ownerUid = await ownerOfItem(booking, dbUrl, env);
        booking.expiresAt = Date.now() + PENDING_TTL_MS;
        // PAY FIRST, SAVE AFTER: only a checkout session is stored here. /allBookings and the customer's
        // bookings are written by the payments worker AFTER the payment is confirmed.
        if (!(await fbSet(`/pendingBookings/${bookingId}`, booking, dbUrl, env))) return json({ error: 'Database write failed' }, 500, request);
        return json({ success: true, booking }, 200, request);
      } catch (e) { return json({ error: e.message, ...(e.total !== undefined ? { total: e.total } : {}) }, e.status || 500, request); }
    }

    // ---- Favorites ----
    if (path === '/api/user/favorites' && method === 'GET') {
      if (await isRateLimited(request, env, 'favorites', LIMITS.lookup.limit, LIMITS.lookup.window)) {
        return json({ error: 'Too many requests' }, 429, request);
      }
      try {
        const uid = await requireUid(request, env);
        const favs = await fbGet(`/users/${uid}/favorites`, dbUrl, env);
        return json({ success: true, favorites: favs ? Object.keys(favs).filter(k => favs[k]) : [] }, 200, request);
      } catch (e) { return json({ error: e.message }, e.status || 401, request); }
    }
    if (path === '/api/user/favorites' && method === 'POST') {
      if (await isRateLimited(request, env, 'favorites-write', LIMITS.write.limit, LIMITS.write.window)) {
        return json({ error: 'Too many requests' }, 429, request);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400, request); }
      const { itemId } = body;
      if (!itemId || !isNonEmptyString(itemId)) return json({ error: 'itemId required' }, 400, request);
      try {
        const uid = await requireUid(request, env);
        const current = await fbGet(`/users/${uid}/favorites/${itemId}`, dbUrl, env);
        await fbSet(`/users/${uid}/favorites/${itemId}`, current ? null : true, dbUrl, env);
        return json({ success: true, isFavorite: !current }, 200, request);
      } catch (e) { return json({ error: e.message }, e.status || 500, request); }
    }

    return json({ error: 'Not found' }, 404, request);
  },
};
