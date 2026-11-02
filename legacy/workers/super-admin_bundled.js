/**
 * Discover Sharm — Super Admin worker (bundled, single-file, no imports).
 * Paste this whole file as-is into the Cloudflare dashboard editor.
 */

// ==================== shared helpers ====================
/**
 * Shared by the admin/owner workers. Wrangler/dashboard-paste friendly: this file is
 * inlined into every worker, so each worker stays fully independent at runtime.
 */
const GOOGLE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FIREBASE_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts';
const GITHUB_API = 'https://api.github.com';
const ALLOWED_ORIGINS = new Set([
  'https://www.discover-sharm.com',
  'https://discover-sharm.com',
  'https://app.discover-sharm.com',
]);
const MAX_DATA_FILE_CHARS = 3500000; // data files carry base64 images; keep them well under GitHub's limits
const LANGS = ['ar', 'en', 'ru', 'de', 'it', 'tr'];
const ROLES = ['super_admin', 'trips_owner', 'hotels_owner', 'transfers_owner'];
// booking.type -> which role owns that kind of item, and which id field the booking carries
const ITEM_TYPES = {
  hotel:     { role: 'hotels_owner',    idField: 'hotelId',      file: 'hotels.json' },
  excursion: { role: 'trips_owner',     idField: 'excursionId',  file: 'excursions.json' },
  transfer:  { role: 'transfers_owner', idField: 'transferId',   file: 'transfers.json' },
};

function corsHeadersForRequest(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  if (ALLOWED_ORIGINS.has(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers['Vary'] = 'Origin'; }
  else headers['Access-Control-Allow-Origin'] = 'null';
  return headers;
}
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (request) Object.assign(headers, corsHeadersForRequest(request));
  return new Response(JSON.stringify(data), { status, headers });
}
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
async function readBody(request) {
  try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; }
  catch { throw httpError(400, 'Invalid JSON'); }
}
// Firebase keys may not contain . # $ [ ] /
function safeKey(s) {
  if (typeof s !== 'string' || !/^[^.#$\[\]\/\s]{1,128}$/.test(s)) throw httpError(400, 'معرّف غير صالح');
  return s;
}

// ---- rate limit (per worker; bind RATE_LIMIT_KV for a real distributed limit) ----
const _memoryRateLimit = new Map();
async function isRateLimited(request, env, bucket, limit, windowSeconds) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `rl:${bucket}:${ip}`;
  if (env.RATE_LIMIT_KV) {
    try {
      const count = parseInt((await env.RATE_LIMIT_KV.get(key)) || '0', 10);
      if (count >= limit) return true;
      await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: Math.max(60, windowSeconds) });
      return false;
    } catch (e) { return false; } // fail OPEN — a rate limiter must never be able to take the admin panel down
  }
  const now = Date.now();
  const entry = _memoryRateLimit.get(key);
  if (!entry || now > entry.resetTime) { _memoryRateLimit.set(key, { count: 1, resetTime: now + windowSeconds * 1000 }); return false; }
  if (entry.count >= limit) return true;
  entry.count++;
  return false;
}

// ---- base64 / JWT ----
function bytesToBase64(bytes) { let s = ''; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s); }
function base64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function base64UrlEncode(str) { return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function base64UrlDecode(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return atob(str); }
function utf8ToBase64(str) { return bytesToBase64(new TextEncoder().encode(str)); }
function base64ToUtf8(b64) { return new TextDecoder().decode(base64ToBytes(b64)); }
function pemToArrayBuffer(pem) { return base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')).buffer; }

let _jwkCache = null, _jwkCacheAt = 0;
async function getGoogleJwks() {
  if (_jwkCache && Date.now() - _jwkCacheAt < 3600 * 1000) return _jwkCache;
  const res = await fetch(GOOGLE_JWK_URL);
  if (!res.ok) throw new Error('Could not fetch Google public keys');
  _jwkCache = await res.json(); _jwkCacheAt = Date.now();
  return _jwkCache;
}
async function verifyFirebaseIdToken(idToken, projectId) {
  const parts = (idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try { header = JSON.parse(base64UrlDecode(headerB64)); payload = JSON.parse(base64UrlDecode(payloadB64)); }
  catch { throw new Error('Invalid token encoding'); }
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');
  const jwk = ((await getGoogleJwks()).keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');
  const publicKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, base64ToBytes(btoa(base64UrlDecode(sigB64))), new TextEncoder().encode(`${headerB64}.${payloadB64}`));
  if (!valid) throw new Error('Invalid token signature');
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error('Token expired');
  if (payload.iat && payload.iat > now + 60) throw new Error('Token issued in the future');
  if (payload.aud !== projectId) throw new Error('Token audience does not match');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Token issuer does not match');
  if (!payload.sub) throw new Error('Token missing subject');
  return payload.sub;
}
async function requireUid(request, env) {
  const idToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!idToken) throw httpError(401, 'لازم تسجّل دخول');
  try { return await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID); }
  catch (e) { throw httpError(401, 'الجلسة انتهت — سجّل دخول تاني'); }
}

// ---- Firebase Realtime Database (service account) ----
async function firebaseAuthRequest(action, payload, apiKey) {
  const res = await fetch(`${FIREBASE_AUTH_URL}:${action}?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return await res.json();
}
let _saCache = null, _saToken = null, _saExp = 0;
async function getServiceAccountToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_saToken && now < _saExp - 60) return _saToken;
  if (!_saCache) { if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured'); _saCache = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }
  const sa = _saCache;
  const unsigned = `${base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64UrlEncode(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: sa.token_uri, iat: now, exp: now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(sa.private_key.replace(/\\n/g, '\n')), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const tokenRes = await fetch(sa.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${base64UrlEncode(String.fromCharCode(...new Uint8Array(sig)))}` });
  const data = await tokenRes.json();
  if (!data.access_token) throw new Error('Failed to get service account token');
  _saToken = data.access_token; _saExp = now + 3500;
  return _saToken;
}
function dbUrlOf(env) { return env.FIREBASE_DB_URL.replace(/\/$/, ''); }
async function fbGet(path, dbUrl, env) {
  const token = await getServiceAccountToken(env);
  const res = await fetch(`${dbUrl}${path}.json?access_token=${token}`);
  return res.ok ? await res.json() : null;
}
async function fbSet(path, value, dbUrl, env) {
  const token = await getServiceAccountToken(env);
  const res = await fetch(`${dbUrl}${path}.json?access_token=${token}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  return res.ok;
}
async function fbPatch(path, value, dbUrl, env) {
  const token = await getServiceAccountToken(env);
  const res = await fetch(`${dbUrl}${path}.json?access_token=${token}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  return res.ok;
}
// params like { orderBy: 'ownerUid', equalTo: uid, limitToLast: 500, shallow: true }.
// Add ".indexOn": ["ownerUid","createdAt"] under /allBookings in your RTDB rules for speed.
async function fbQuery(path, params, dbUrl, env) {
  const token = await getServiceAccountToken(env);
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' ? JSON.stringify(v) : String(v))}`).join('&');
  const res = await fetch(`${dbUrl}${path}.json?access_token=${token}&${qs}`);
  if (!res.ok) throw httpError(502, 'Database query failed');
  return await res.json();
}
async function audit(env, uid, role, action, target, detail) {
  try {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await fbSet(`/auditLog/${id}`, { ts: new Date().toISOString(), uid, role, action, target: target || null, detail: detail || null }, dbUrlOf(env), env);
  } catch {}
}

// ---- roles: /roles/{uid} = { role, status, name, email, phone } ; legacy /admins/{uid}===true = super_admin ----
async function getRoleRecord(uid, env) {
  const dbUrl = dbUrlOf(env);
  const rec = await fbGet(`/roles/${uid}`, dbUrl, env);
  if (rec && typeof rec === 'object' && ROLES.includes(rec.role)) return rec;
  if ((await fbGet(`/admins/${uid}`, dbUrl, env)) === true) return { role: 'super_admin', status: 'active', legacy: true };
  return null;
}
async function requireRole(request, env, role) {
  const uid = await requireUid(request, env);
  const rec = await getRoleRecord(uid, env);
  if (!rec || rec.role !== role) throw httpError(403, 'الحساب ده مش مصرّح له بالدخول للوحة دي');
  if (rec.status === 'suspended') throw httpError(403, 'الحساب موقوف — كلّم الإدارة');
  return { uid, rec };
}

// ---- GitHub JSON content (hotels.json, excursions.json, ...) ----
async function ghGetFile(owner, repo, branch, path, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'discover-sharm' };
  const res = await fetch(url, { headers });
  if (!res.ok) throw httpError(502, `GitHub read failed: ${res.status}`);
  const data = await res.json();
  if (data.content) return { content: base64ToUtf8(data.content.replace(/\n/g, '')), sha: data.sha };
  // files over 1MB (e.g. lots of base64 images): the JSON API returns no content, so fetch the raw body
  const raw = await fetch(url, { headers: { ...headers, Accept: 'application/vnd.github.raw+json' } });
  if (!raw.ok) throw httpError(502, `GitHub raw read failed: ${raw.status}`);
  return { content: await raw.text(), sha: data.sha };
}
async function ghPutFile(owner, repo, branch, path, contentStr, sha, message, token) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'discover-sharm', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: utf8ToBase64(contentStr), sha, branch }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = httpError(res.status === 409 || res.status === 422 ? 409 : 502, res.status === 409 || res.status === 422 ? 'الملف اتغيّر من حد تاني — جرّب تاني' : `GitHub write failed: ${res.status}`);
    e.conflict = res.status === 409 || res.status === 422;
    throw e;
  }
  return result;
}
function dataPath(env, file) { return `${env.GITHUB_WRITE_PATH || env.GITHUB_READ_PATH || 'bucket/m/data'}/${file}`; }
async function readJsonFile(env, file) {
  const { content, sha } = await ghGetFile(env.GITHUB_OWNER, env.GITHUB_REPO, env.GITHUB_BRANCH || 'main', dataPath(env, file), env.GITHUB_TOKEN);
  let data; try { data = JSON.parse(content); } catch { throw httpError(500, `${file} مش JSON صحيح`); }
  return { data, sha, content };
}
// Read-modify-write with automatic retry when someone else committed in between.
// mutate(data) must return { data: newData, result } (or { result } for "no change").
async function mutateJsonFile(env, file, mutate, message) {
  const branch = env.GITHUB_BRANCH || 'main';
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, sha } = await readJsonFile(env, file);
    const out = mutate(data) || {};
    if (out.data === undefined) return out.result;
    const text = JSON.stringify(out.data, null, 2);
    if (text.length > MAX_DATA_FILE_CHARS) throw httpError(413, 'حجم ملف البيانات وصل للحد الأقصى (حوالي 3.5MB) — قلّل عدد الصور أو حجمها');
    try {
      await ghPutFile(env.GITHUB_OWNER, env.GITHUB_REPO, branch, dataPath(env, file), text, sha, message || `Update ${file}`, env.GITHUB_TOKEN);
      return out.result;
    } catch (e) { if (e.conflict && attempt < 3) continue; throw e; }
  }
}
function newId(prefix, existing) {
  let id;
  do { id = prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4); } while (existing && existing.has(id));
  return id;
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

// ==================== finance / accounting ====================
// Money flow: customers pay the platform online (Kashier). A booking earns money for its owner ONLY after the
// service really happened (owner/admin marks ownerStatus = "done": trip done / transfer done / guest checked in).
// At that moment the commission is frozen on the booking as booking.earning = { gross, rate, commission, net, at }.
// Owner balance = sum(net of earnings) + sum(adjustments) - payouts (requested + paid).   Everything is in EGP.
const FIN_DEFAULTS = { rates: { hotel: 10, excursion: 10, transfer: 10 }, minPayout: 100 };
const PAYOUT_ACCOUNT_COOLDOWN_MS = 24 * 3600 * 1000; // after changing the payout account, no payout request for 24h
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const okPct = v => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100;
async function getFinSettings(env) {
  const s = (await fbGet('/settings/finance', dbUrlOf(env), env)) || {};
  const rates = { ...FIN_DEFAULTS.rates };
  for (const t of Object.keys(rates)) if (s.rates && okPct(s.rates[t])) rates[t] = s.rates[t];
  return { rates, minPayout: typeof s.minPayout === 'number' && s.minPayout >= 0 ? s.minPayout : FIN_DEFAULTS.minPayout };
}
function rateFor(type, rec, fin) { return rec && okPct(rec.commissionRate) ? rec.commissionRate : (fin.rates[type] ?? 10); }
// Commission is charged on the PRE-TAX amount (booking.subtotal). The taxes/fees the customer pays on top
// (10% hotels, 5% trips/transfers) stay with the platform and are not owner revenue.
function pretax(b) {
  const sub = Number(b.subtotal);
  if (isFinite(sub) && sub > 0) return sub;
  return Number(b.total) / (b.type === 'hotel' ? 1.1 : 1.05); // legacy bookings created before subtotal was stored
}
function makeEarning(b, rec, fin) {
  const gross = round2(pretax(b));
  if (!isFinite(gross) || gross <= 0) throw httpError(400, 'إجمالي الحجز غير صالح');
  if (b.currency && b.currency !== 'EGP') throw httpError(400, 'المحاسبة بالجنيه المصري فقط');
  const rate = rateFor(b.type, rec, fin), commission = round2(gross * rate / 100);
  return { gross, taxes: round2(Number(b.total) - gross), rate, commission, net: round2(gross - commission), currency: 'EGP', at: new Date().toISOString() };
}
const egyptToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const serviceDate = b => (b.type === 'hotel' ? b.checkin : b.date) || '';
function assertServiceHappened(b) {
  const sd = serviceDate(b);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sd) || sd > egyptToday()) throw httpError(400, 'لسه ماوصلش ميعاد الخدمة — مينفعش تتسجّل كمنفّذة قبل ميعادها');
}
const itemNameOf = b => { const v = b.hotelName || b.title || b.vehicleType; return v && typeof v === 'object' ? (v.ar || v.en || '') : (v || ''); };
async function loadLedger(uid, env) {
  const dbUrl = dbUrlOf(env);
  const q = (p) => fbQuery(p, { orderBy: 'ownerUid', equalTo: uid }, dbUrl, env).then(x => x || {});
  const [bk, po, ad] = await Promise.all([q('/allBookings'), q('/payouts'), q('/adjustments')]);
  const earn = Object.values(bk).filter(b => b && b.ownerUid === uid && b.earning && !b.earning.void).sort((x, y) => String(y.earning.at).localeCompare(String(x.earning.at)));
  const payouts = Object.values(po).filter(p => p && p.ownerUid === uid).sort((x, y) => String(y.requestedAt).localeCompare(String(x.requestedAt)));
  const adjustments = Object.values(ad).filter(a => a && a.ownerUid === uid).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
  return { earn, payouts, adjustments };
}
function summarize(l) {
  const sum = (arr, f) => round2(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0));
  const earned = sum(l.earn, b => b.earning.net), adj = sum(l.adjustments, a => a.amount);
  const paid = sum(l.payouts.filter(p => p.status === 'paid'), p => p.amount), pending = sum(l.payouts.filter(p => p.status === 'requested'), p => p.amount);
  return { gross: sum(l.earn, b => b.earning.gross), commission: sum(l.earn, b => b.earning.commission), earned, adjustments: adj, paid, pending, available: round2(earned + adj - paid - pending), services: l.earn.length };
}
const earnRow = b => ({ id: b.id, type: b.type, item: itemNameOf(b), customer: b.name || '', serviceDate: serviceDate(b), ...b.earning });
// what the customer's own copy of a booking may receive (never money/commission/notes)
const PUBLIC_BOOKING_FIELDS = ['status', 'ownerStatus', 'cancelledBy', 'cancelledAt'];
function publicPatch(fields) { const o = {}; for (const k of PUBLIC_BOOKING_FIELDS) if (fields[k] !== undefined) o[k] = fields[k]; return o; }
const s300 = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n || 300) : '');

// ==================== image uploads -> committed into the GitHub repo, direct URL saved in the data ====================
const UPLOAD_MAX_BYTES = 600 * 1024;
const UPLOAD_DAILY_CAP = 150; // per owner account
function parseImageDataUri(s) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof s === 'string' ? s : '');
  if (!m) throw httpError(400, 'صيغة الصورة غير مدعومة (JPEG / PNG / WEBP فقط)');
  const b64 = m[2], bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (bytes > UPLOAD_MAX_BYTES) throw httpError(413, 'الصورة كبيرة — الحد الأقصى 600KB بعد الضغط');
  if (bytes < 100) throw httpError(400, 'الصورة فاضية');
  const h = base64ToBytes(b64.slice(0, 16)), ascii = (i, n) => String.fromCharCode(...h.slice(i, i + n));
  const ext = h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF ? 'jpg' : h[0] === 0x89 && ascii(1, 3) === 'PNG' ? 'png' : ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' ? 'webp' : null;
  if (!ext) throw httpError(400, 'الملف مش صورة حقيقية'); // never trust the declared mime — check the file signature
  return { b64, ext };
}
async function ghCreateBinary(owner, repo, branch, path, b64, message, token) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'discover-sharm', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64, branch }),
    });
    if (res.ok) return true;
    if ((res.status === 409 || res.status === 422) && attempt < 3) { await new Promise(r => setTimeout(r, 300 * (attempt + 1))); continue; } // branch moved under us -> retry
    throw httpError(502, `GitHub upload failed: ${res.status}`);
  }
}
// scope: "o/<uid>" for owners, "admin" for the super admin. Returns the permanent direct URL.
async function saveUploadedImage(env, scope, dataUri, uid, capped) {
  const { b64, ext } = parseImageDataUri(dataUri);
  if (capped) {
    const key = `/uploadCount/${uid}/${new Date().toISOString().slice(0, 10)}`, n = Number(await fbGet(key, dbUrlOf(env), env)) || 0;
    if (n >= UPLOAD_DAILY_CAP) throw httpError(429, 'وصلت للحد اليومي لرفع الصور — جرّب بكرة');
    await fbSet(key, n + 1, dbUrlOf(env), env);
  }
  const base = (env.GITHUB_WRITE_PATH || env.GITHUB_READ_PATH || 'bucket/m/data').replace(/\/data$/, '');
  const media = (env.GITHUB_MEDIA_PATH || base + '/uploads').replace(/\/$/, '');
  const branch = env.GITHUB_BRANCH || 'main', name = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const path = `${media}/${scope}/${new Date().toISOString().slice(0, 7)}/${name}.${ext}`;
  await ghCreateBinary(env.GITHUB_OWNER, env.GITHUB_REPO, branch, path, b64, `Upload image (${scope})`, env.GITHUB_TOKEN);
  // MEDIA_BASE_URL can point to a CDN (e.g. https://cdn.jsdelivr.net/gh/<owner>/<repo>@<branch>) or your Pages domain
  return `${(env.MEDIA_BASE_URL || `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${branch}`).replace(/\/$/, '')}/${path}`;
}

// ==================== superadmin worker ====================
/**
 * Discover Sharm — Super Admin Worker
 * Everything under /api/admin/* — requires role super_admin (or legacy /admins/{uid}===true).
 *   me, stats, roles(+reset-password), customers, items/:type, file (raw JSON incl. lang files),
 *   bookings, applications, messages, reviews, audit, maintenance/reindex
 */
const FILES = { hotel: 'hotels.json', excursion: 'excursions.json', transfer: 'transfers.json', destination: 'destinations.json', restaurant: 'restaurants.json', article: 'articles.json', review: 'reviews.json', promoSlide: 'promoSlides.json' };
const RAW_FILES = new Set([...Object.values(FILES), ...LANGS.map(l => `lang/${l}.json`)]);
const PAY_STATUSES = ['pending_payment', 'completed', 'failed', 'cancelled', 'refunded'];
const OWNER_STATUSES = ['new', 'confirmed', 'done', 'no_show'];
const MAX_HOTELS_PER_OWNER = 2;
const ITEM_ROLE_TYPE = { hotels_owner: 'hotel', trips_owner: 'excursion', transfers_owner: 'transfer' };
const r2n = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Math.round(Number(v) * 100) / 100 : NaN);
const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n || 300) : '');
const byDateDesc = (x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || ''));

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;
  if (!path.startsWith('/api/admin')) return json({ error: 'Not found' }, 404, request);
  const read = m === 'GET';
  if (await isRateLimited(request, env, read ? 'admin-read' : 'admin-write', read ? 200 : 100, 60)) return json({ error: 'Too many requests' }, 429, request);

  const { uid, rec } = await requireRole(request, env, 'super_admin');
  const dbUrl = dbUrlOf(env);
  const [r0, r1, r2, r3, r4] = path.slice('/api/admin'.length).split('/').filter(Boolean);
  const ok = (extra) => json({ success: true, ...extra }, 200, request);
  const log = (action, target, detail) => audit(env, uid, 'super_admin', action, target, detail);

  // owner of a given item type must hold the matching role
  const assertOwnerRole = async (type, owner) => {
    if (!owner) return;
    const rr = await fbGet(`/roles/${safeKey(owner)}`, dbUrl, env);
    if (!rr || rr.role !== ITEM_TYPES[type].role) throw httpError(400, 'الـ owner لازم يكون حساب من نوع مناسب للعنصر ده');
  };

  if (r0 === 'me' && read) return ok({ uid, role: 'super_admin', name: rec.name || '', legacy: !!rec.legacy });

  if (r0 === 'upload' && m === 'POST' && !r1) {
    const url = await saveUploadedImage(env, 'admin', (await readBody(request)).image, uid, false);
    await log('image.upload', url.split('/').slice(-1)[0]);
    return ok({ url });
  }

  // ---------------- stats ----------------
  if (r0 === 'stats' && read) {
    const [bk, roles, appsKeys, msgKeys, payouts] = await Promise.all([
      fbQuery('/allBookings', { orderBy: 'createdAt', limitToLast: 3000 }, dbUrl, env),
      fbGet('/roles', dbUrl, env),
      fbQuery('/partnerApplications', { shallow: true }, dbUrl, env),
      fbQuery('/contactMessages', { shallow: true }, dbUrl, env),
      fbGet('/payouts', dbUrl, env),
    ]);
    const list = Object.values(bk || {});
    const byStatus = {}, byType = {}, revenue = {}, revenueByType = {}, days = {};
    for (let i = 29; i >= 0; i--) days[new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)] = { n: 0, rev: 0 };
    const since = Date.now() - 30 * 864e5;
    let last30 = 0, needsRefund = 0;
    for (const b of list) {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      byType[b.type] = (byType[b.type] || 0) + 1;
      if (b.status === 'completed') { revenue[b.currency || 'EGP'] = (revenue[b.currency || 'EGP'] || 0) + (Number(b.total) || 0); revenueByType[b.type] = (revenueByType[b.type] || 0) + (Number(b.total) || 0); }
      const dk = String(b.createdAt).slice(0, 10); if (days[dk]) { days[dk].n++; if (b.status === 'completed') days[dk].rev += Number(b.total) || 0; }
      if (Date.parse(b.createdAt) >= since) last30++;
      if (b.needsRefund && b.status !== 'refunded') needsRefund++;
    }
    const roleCounts = {};
    Object.values(roles || {}).forEach(r => { if (r && r.role) roleCounts[r.role] = (roleCounts[r.role] || 0) + 1; });
    const items = {};
    await Promise.all(Object.entries(ITEM_TYPES).map(async ([t, c]) => { try { const { data } = await readJsonFile(env, c.file); items[t] = Array.isArray(data) ? data.length : 0; } catch { items[t] = null; } }));
    const openPo = Object.values(payouts || {}).filter(p => p && p.status === 'requested');
    return ok({ series: Object.entries(days).map(([d, v]) => ({ d, ...v })), revenueByType, payoutsOpen: { count: openPo.length, amount: round2(openPo.reduce((x, p) => x + (Number(p.amount) || 0), 0)) }, bookings: list.length, byStatus, byType, revenue, last30, needsRefund, roleCounts, items, applications: Object.keys(appsKeys || {}).length, messages: Object.keys(msgKeys || {}).length });
  }

  // ---------------- roles (owner accounts) ----------------
  if (r0 === 'roles') {
    if (read && !r1) {
      const roles = (await fbGet('/roles', dbUrl, env)) || {};
      const owned = (await fbGet('/itemOwners', dbUrl, env)) || {};
      const counts = {};
      for (const [t, map] of Object.entries(owned)) Object.values(map || {}).forEach(o => { counts[o] = counts[o] || {}; counts[o][t] = (counts[o][t] || 0) + 1; });
      return ok({ roles: Object.entries(roles).map(([id, r]) => { const { payout, ...rest } = r || {}; return { uid: id, ...rest, hasPayout: !!payout, payoutMethod: payout ? payout.method : null, itemCounts: counts[id] || {} }; }), maxHotels: MAX_HOTELS_PER_OWNER });
    }
    if (m === 'POST' && !r1) {
      const b = await readBody(request);
      if (!ROLES.includes(b.role)) throw httpError(400, 'نوع الحساب غير صالح');
      let target = b.uid ? safeKey(b.uid) : null;
      let email = s(b.email, 200);
      if (!target) {
        if (!isValidEmail(email) || typeof b.password !== 'string' || b.password.length < 6) throw httpError(400, 'إيميل صحيح وباسورد 6 حروف على الأقل مطلوبين');
        const d = await firebaseAuthRequest('signUp', { email, password: b.password, returnSecureToken: false }, env.FIREBASE_API_KEY);
        if (d.error) throw httpError(400, d.error.message === 'EMAIL_EXISTS' ? 'الإيميل ده مسجّل قبل كده — ارفع الحساب من قائمة العملاء بالـ uid' : d.error.message);
        target = d.localId;
      }
      const profile = (await fbGet(`/users/${target}/profile`, dbUrl, env)) || null;
      if (!profile) {
        await fbSet(`/users/${target}/profile`, { name: s(b.name, 100), email, phone: s(b.phone, 20), countryCode: '', fullPhone: s(b.phone, 20), photoURL: '', loyaltyTier: 0 }, dbUrl, env);
        await fbSet(`/users/${target}/stats`, { completedBookings: 0, totalSpent: 0 }, dbUrl, env);
      }
      const record = { role: b.role, status: 'active', name: s(b.name, 100) || profile?.name || '', email: email || profile?.email || '', phone: s(b.phone, 20) || profile?.phone || '', createdAt: new Date().toISOString(), createdBy: uid };
      if (okPct(b.commissionRate)) record.commissionRate = b.commissionRate;
      await fbSet(`/roles/${target}`, record, dbUrl, env);
      await log('role.create', target, { role: b.role });
      return ok({ uid: target, role: record });
    }
    if (m === 'PUT' && r1 && !r2) {
      const target = safeKey(r1);
      if (target === uid) throw httpError(400, 'مينفعش تعدّل حسابك إنت من هنا');
      const cur = await fbGet(`/roles/${target}`, dbUrl, env);
      if (!cur) throw httpError(404, 'الحساب مش موجود');
      const b = await readBody(request), patch = {};
      if (b.role !== undefined) { if (!ROLES.includes(b.role)) throw httpError(400, 'نوع غير صالح'); patch.role = b.role; }
      if (b.status !== undefined) { if (!['active', 'suspended'].includes(b.status)) throw httpError(400, 'حالة غير صالحة'); patch.status = b.status; }
      for (const k of ['name', 'phone']) if (b[k] !== undefined) patch[k] = s(b[k], 100);
      if (b.commissionRate !== undefined) { if (b.commissionRate !== null && !okPct(b.commissionRate)) throw httpError(400, 'نسبة العمولة لازم بين 0 و 100'); patch.commissionRate = b.commissionRate; } // null = back to default
      await fbPatch(`/roles/${target}`, patch, dbUrl, env);
      await log('role.update', target, patch);
      return ok({ role: { ...cur, ...patch } });
    }
    if (m === 'DELETE' && r1 && !r2) {
      const target = safeKey(r1);
      if (target === uid) throw httpError(400, 'مينفعش تمسح حسابك إنت');
      await fbSet(`/roles/${target}`, null, dbUrl, env);
      await log('role.delete', target);
      return ok({});
    }
    if (m === 'POST' && r1 && r2 === 'reset-password') {
      const rr = await fbGet(`/roles/${safeKey(r1)}`, dbUrl, env);
      if (!rr || !rr.email) throw httpError(404, 'مفيش إيميل للحساب ده');
      const d = await firebaseAuthRequest('sendOobCode', { requestType: 'PASSWORD_RESET', email: rr.email }, env.FIREBASE_API_KEY);
      if (d.error) throw httpError(400, d.error.message);
      await log('role.reset-password', r1);
      return ok({});
    }
  }

  // ---------------- customers ----------------
  if (r0 === 'customers' && read) {
    const keys = Object.keys((await fbQuery('/users', { shallow: true }, dbUrl, env)) || {});
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
    const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10) || 50);
    const page = keys.slice(offset, offset + limit);
    const roles = (await fbGet('/roles', dbUrl, env)) || {};
    const users = await Promise.all(page.map(async (id) => ({ uid: id, profile: (await fbGet(`/users/${id}/profile`, dbUrl, env)) || {}, stats: (await fbGet(`/users/${id}/stats`, dbUrl, env)) || {}, role: roles[id]?.role || null })));
    return ok({ total: keys.length, offset, users });
  }

  // ---------------- content items (all JSON lists) ----------------
  if (r0 === 'items' && FILES[r1]) {
    const type = r1, file = FILES[type], owned = !!ITEM_TYPES[type];
    const force = url.searchParams.get('force') === '1';
    const hotelCap = (list, itemId, owner) => {
      if (type !== 'hotel' || !owner || force) return;
      if (list.filter(i => i && i.owner === owner && i.id !== itemId).length >= MAX_HOTELS_PER_OWNER)
        throw httpError(409, `الحساب ده وصل لحد ${MAX_HOTELS_PER_OWNER} فنادق — لو عايز تتخطاه فعّل "تجاوز الحد"`);
    };
    const validItem = async (b) => {
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw httpError(400, 'لازم يكون object');
      if (owned) await assertOwnerRole(type, b.owner);
      return b;
    };
    if (read && !r2) { const { data, sha } = await readJsonFile(env, file); return ok({ items: Array.isArray(data) ? data : [], sha }); }
    if (m === 'POST' && !r2) {
      const b = await validItem(await readBody(request));
      const item = await mutateJsonFile(env, file, (list) => {
        if (!Array.isArray(list)) throw httpError(500, file + ' مش list');
        const ids = new Set(list.map(i => i && i.id));
        if (!b.id) b.id = newId(type[0], ids); else if (ids.has(b.id)) throw httpError(409, 'الـ id ده موجود');
        hotelCap(list, b.id, b.owner);
        list.push(b);
        return { data: list, result: b };
      }, `Admin: add ${type}`);
      if (owned && item.owner) await fbSet(`/itemOwners/${type}/${safeKey(item.id)}`, item.owner, dbUrl, env);
      await log('item.create', `${type}:${item.id}`);
      return ok({ item });
    }
    if (m === 'PUT' && r2) {
      const b = await validItem(await readBody(request)); b.id = r2;
      const item = await mutateJsonFile(env, file, (list) => {
        const idx = (Array.isArray(list) ? list : []).findIndex(i => i && i.id === r2);
        if (idx < 0) throw httpError(404, 'العنصر مش موجود');
        hotelCap(list, r2, b.owner);
        list[idx] = b;
        return { data: list, result: b };
      }, `Admin: update ${type} ${r2}`);
      if (owned) await fbSet(`/itemOwners/${type}/${safeKey(r2)}`, item.owner || null, dbUrl, env);
      await log('item.update', `${type}:${r2}`);
      return ok({ item });
    }
    if (m === 'DELETE' && r2) {
      await mutateJsonFile(env, file, (list) => {
        const idx = (Array.isArray(list) ? list : []).findIndex(i => i && i.id === r2);
        if (idx < 0) throw httpError(404, 'العنصر مش موجود');
        list.splice(idx, 1);
        return { data: list, result: true };
      }, `Admin: delete ${type} ${r2}`);
      if (owned) await fbSet(`/itemOwners/${type}/${safeKey(r2)}`, null, dbUrl, env);
      await log('item.delete', `${type}:${r2}`);
      return ok({});
    }
  }

  // ---------------- raw JSON file editor (incl. lang/xx.json) ----------------
  if (r0 === 'files' && read) return ok({ files: [...RAW_FILES] });
  if (r0 === 'file') {
    if (read) {
      const f = url.searchParams.get('file');
      if (!RAW_FILES.has(f)) throw httpError(400, 'ملف غير مسموح');
      const { content, sha } = await readJsonFile(env, f);
      return ok({ content, sha });
    }
    if (m === 'PUT') {
      const b = await readBody(request);
      if (!RAW_FILES.has(b.file)) throw httpError(400, 'ملف غير مسموح');
      if (typeof b.content !== 'string' || b.content.length > MAX_DATA_FILE_CHARS) throw httpError(400, 'المحتوى كبير أو غلط');
      let parsed; try { parsed = JSON.parse(b.content); } catch (e) { throw httpError(400, 'JSON غير صالح: ' + e.message); }
      await ghPutFile(env.GITHUB_OWNER, env.GITHUB_REPO, env.GITHUB_BRANCH || 'main', dataPath(env, b.file), JSON.stringify(parsed, null, 2), b.sha, `Admin: edit ${b.file}`, env.GITHUB_TOKEN);
      await log('file.write', b.file);
      return ok({});
    }
  }

  // ---------------- bookings ----------------
  if (r0 === 'bookings') {
    if (read && !r1) {
      const raw = (await fbQuery('/allBookings', { orderBy: 'createdAt', limitToLast: 1500 }, dbUrl, env)) || {};
      let list = Object.values(raw).sort(byDateDesc);
      for (const k of ['status', 'type']) { const v = url.searchParams.get(k); if (v) list = list.filter(b => b[k] === v); }
      const owner = url.searchParams.get('owner'); if (owner) list = list.filter(b => b.ownerUid === owner);
      return ok({ bookings: list.slice(0, 500) });
    }
    if (m === 'PUT' && r1) {
      const id = safeKey(r1), b = await fbGet(`/allBookings/${id}`, dbUrl, env);
      if (!b) throw httpError(404, 'الحجز مش موجود');
      const body = await readBody(request), f = {};
      if (body.status !== undefined) { if (!PAY_STATUSES.includes(body.status)) throw httpError(400, 'حالة غير صالحة'); f.status = body.status; if (body.status === 'refunded') f.needsRefund = false; }
      if (body.ownerStatus !== undefined) { if (!OWNER_STATUSES.includes(body.ownerStatus)) throw httpError(400, 'حالة غير صالحة'); f.ownerStatus = body.ownerStatus; }
      // ---- accounting: 'done' freezes the commission; leaving 'done' / refunding / un-paying voids it ----
      const newStatus = f.status || b.status, live = b.earning && !b.earning.void;
      if (f.ownerStatus === 'done' && !live) {
        if (newStatus !== 'completed') throw httpError(400, 'الحجز لسه مش مدفوع');
        const ownerId = body.ownerUid !== undefined ? body.ownerUid : b.ownerUid;
        if (!ownerId) throw httpError(400, 'الحجز ده مالوش أونر — حدّد الأونر الأول');
        f.earning = makeEarning(b, await fbGet(`/roles/${safeKey(ownerId)}`, dbUrl, env), await getFinSettings(env));
      } else if (live && ((f.ownerStatus && f.ownerStatus !== 'done') || newStatus !== 'completed')) {
        f.earning = { ...b.earning, void: true, voidedAt: new Date().toISOString() };
        if (newStatus !== 'completed' && b.ownerStatus === 'done' && !f.ownerStatus) f.ownerStatus = 'new';
      }
      if (body.ownerNote !== undefined) f.ownerNote = s(body.ownerNote, 1000);
      if (body.adminNote !== undefined) f.adminNote = s(body.adminNote, 1000);
      if (body.needsRefund !== undefined) f.needsRefund = !!body.needsRefund;
      if (body.ownerUid !== undefined) { if (body.ownerUid) await assertOwnerRole(b.type, body.ownerUid); f.ownerUid = body.ownerUid || null; }
      if (!Object.keys(f).length) throw httpError(400, 'مفيش حاجة تتعدّل');
      await fbPatch(`/allBookings/${id}`, f, dbUrl, env);
      const pub = publicPatch(f);
      if (b.uid && Object.keys(pub).length) await fbPatch(`/users/${b.uid}/bookings/${id}`, pub, dbUrl, env);
      await log('booking.update', id, f.earning ? { ...f, earning: f.earning.void ? 'void' : f.earning.net } : f);
      return ok({ booking: { ...b, ...f } });
    }
    if (m === 'DELETE' && r1) {
      const id = safeKey(r1), b = await fbGet(`/allBookings/${id}`, dbUrl, env);
      if (!b) throw httpError(404, 'الحجز مش موجود');
      if (!['pending_payment', 'failed', 'cancelled'].includes(b.status)) throw httpError(400, 'مينفعش تمسح حجز مدفوع/مسترد — غيّر حالته بس');
      await fbSet(`/allBookings/${id}`, null, dbUrl, env);
      if (b.uid) await fbSet(`/users/${b.uid}/bookings/${id}`, null, dbUrl, env);
      await log('booking.delete', id);
      return ok({});
    }
  }

  // ---------------- accounting (commission, payouts, statements, reports) ----------------
  if (r0 === 'finance') {
    const fin = await getFinSettings(env);
    const ownerRoles = async () => Object.entries((await fbGet('/roles', dbUrl, env)) || {}).filter(([, r]) => r && r.role !== 'super_admin').map(([id, r]) => ({ uid: id, ...r }));
    const all = async (p) => Object.values((await fbGet(p, dbUrl, env)) || {});

    if (r1 === 'settings') {
      if (read) return ok({ settings: fin, defaults: FIN_DEFAULTS });
      if (m === 'PUT') {
        const b = await readBody(request), rates = {};
        for (const t of Object.keys(FIN_DEFAULTS.rates)) { const v = Number(b.rates && b.rates[t]); if (!okPct(v)) throw httpError(400, 'نسب العمولة لازم بين 0 و 100'); rates[t] = v; }
        const minPayout = Number(b.minPayout); if (!isFinite(minPayout) || minPayout < 0) throw httpError(400, 'الحد الأدنى للصرف غير صالح');
        await fbSet('/settings/finance', { rates, minPayout }, dbUrl, env);
        await log('finance.settings', null, { rates, minPayout });
        return ok({ settings: { rates, minPayout } });
      }
    }

    // full statement of one owner (earnings, payouts, adjustments, payout account)
    if (r1 === 'owner' && r2 && read) {
      const target = safeKey(r2), rr = await fbGet(`/roles/${target}`, dbUrl, env);
      if (!rr) throw httpError(404, 'الحساب مش موجود');
      const led = await loadLedger(target, env);
      const { payout, ...role } = rr;
      return ok({ owner: { uid: target, ...role }, account: payout || null, rate: rateFor(ITEM_ROLE_TYPE[rr.role] || 'hotel', rr, fin), summary: summarize(led), earnings: led.earn.map(earnRow), payouts: led.payouts, adjustments: led.adjustments });
    }

    if (r1 === 'payouts') {
      if (read && !r2) {
        const st = url.searchParams.get('status');
        let l = (await all('/payouts')).sort((x, y) => String(y.requestedAt).localeCompare(String(x.requestedAt)));
        if (st) l = l.filter(p => p.status === st);
        return ok({ payouts: l.slice(0, 500) });
      }
      if (m === 'PUT' && r2) {
        const p = await fbGet(`/payouts/${safeKey(r2)}`, dbUrl, env), b = await readBody(request);
        if (!p) throw httpError(404, 'الطلب مش موجود');
        if (p.status !== 'requested') throw httpError(400, 'الطلب ده اتقفل قبل كده');
        if (b.status === 'paid') {
          const ref = s(b.reference, 100); if (ref.length < 3) throw httpError(400, 'اكتب رقم العملية / مرجع التحويل');
          await fbPatch(`/payouts/${r2}`, { status: 'paid', reference: ref, note: s(b.note, 500), paidAt: new Date().toISOString(), paidBy: uid }, dbUrl, env);
        } else if (b.status === 'rejected') {
          if (!s(b.note, 500)) throw httpError(400, 'اكتب سبب الرفض');
          await fbPatch(`/payouts/${r2}`, { status: 'rejected', note: s(b.note, 500), closedAt: new Date().toISOString(), paidBy: uid }, dbUrl, env);
        } else throw httpError(400, 'حالة غير صالحة');
        await log('payout.' + b.status, r2, { amount: p.amount, owner: p.ownerUid });
        return ok({});
      }
      if (m === 'POST' && !r2) { // record a payout you already made manually
        const b = await readBody(request), target = safeKey(b.ownerUid || ''), rr = await fbGet(`/roles/${target}`, dbUrl, env);
        if (!rr || rr.role === 'super_admin') throw httpError(404, 'الأونر مش موجود');
        const amount = r2n(b.amount), ref = s(b.reference, 100);
        if (!isFinite(amount) || amount <= 0) throw httpError(400, 'مبلغ غير صالح');
        if (ref.length < 3) throw httpError(400, 'اكتب رقم العملية / مرجع التحويل');
        const method = ['instapay', 'bank'].includes(b.method) ? b.method : (rr.payout && rr.payout.method) || 'bank';
        const pid = 'PO-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase(), now = new Date().toISOString();
        await fbSet(`/payouts/${pid}`, { id: pid, ownerUid: target, amount, currency: 'EGP', method, account: rr.payout || null, status: 'paid', reference: ref, note: s(b.note, 500), requestedAt: now, paidAt: now, requestedBy: 'admin', paidBy: uid }, dbUrl, env);
        await log('payout.manual', pid, { amount, owner: target });
        return ok({ id: pid });
      }
    }

    // adjustments are append-only (fix a mistake with an opposite entry)
    if (r1 === 'adjustments' && m === 'POST') {
      const b = await readBody(request), target = safeKey(b.ownerUid || ''), rr = await fbGet(`/roles/${target}`, dbUrl, env);
      if (!rr || rr.role === 'super_admin') throw httpError(404, 'الأونر مش موجود');
      const amount = r2n(b.amount), reason = s(b.reason, 300);
      if (!isFinite(amount) || amount === 0 || Math.abs(amount) > 1e7) throw httpError(400, 'مبلغ غير صالح');
      if (reason.length < 3) throw httpError(400, 'اكتب سبب التسوية');
      const aid = 'AD-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
      await fbSet(`/adjustments/${aid}`, { id: aid, ownerUid: target, amount, reason, createdAt: new Date().toISOString(), by: uid }, dbUrl, env);
      await log('adjustment.create', aid, { amount, owner: target });
      return ok({ id: aid });
    }

    // report: sales, realized vs pending commission, per-owner balances
    if (r1 === 'report' && read) {
      const from = url.searchParams.get('from') || '0000-00-00', to = url.searchParams.get('to') || '9999-99-99';
      const basis = url.searchParams.get('basis') === 'realized' ? 'realized' : 'booked';
      const typeF = url.searchParams.get('type') || '', ownF = url.searchParams.get('owner') || '';
      const owners = await ownerRoles(), rmap = Object.fromEntries(owners.map(o => [o.uid, o]));
      const bk = Object.values((await fbQuery('/allBookings', { orderBy: 'createdAt', limitToLast: 3000 }, dbUrl, env)) || {});
      const rows = [];
      for (const b of bk) {
        if (!ITEM_TYPES[b.type] || (typeF && b.type !== typeF) || (ownF && b.ownerUid !== ownF)) continue;
        const live = b.earning && !b.earning.void;
        if (basis === 'realized' ? !live : b.status !== 'completed') continue;
        const day = String(basis === 'realized' ? b.earning.at : b.createdAt).slice(0, 10);
        if (day < from || day > to) continue;
        const gross = round2(pretax(b)), taxes = round2((Number(b.total) || 0) - gross);
        let e = live ? b.earning : null, est = false;
        if (!e && b.ownerUid) { const rate = rateFor(b.type, rmap[b.ownerUid], fin), c = round2(gross * rate / 100); e = { gross, rate, commission: c, net: round2(gross - c) }; est = true; }
        rows.push({ id: b.id, type: b.type, ownerUid: b.ownerUid || null, item: itemNameOf(b), customer: b.name || '', createdAt: b.createdAt, serviceDate: serviceDate(b), gross, taxes, ownerStatus: b.ownerStatus || 'new', realized: !!live, estimated: est, rate: e ? e.rate : null, commission: e ? e.commission : null, net: e ? e.net : null });
      }
      rows.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
      const per = {};
      for (const o of owners) per[o.uid] = { uid: o.uid, name: o.name || o.email, role: o.role, bookings: 0, gross: 0, commissionRealized: 0, commissionPending: 0, netRealized: 0, netPending: 0 };
      const t = { bookings: rows.length, taxes: 0, gross: 0, commissionRealized: 0, commissionPending: 0, netRealized: 0, netPending: 0, unowned: 0 };
      for (const r of rows) {
        t.gross += r.gross; t.taxes += r.taxes;
        if (!r.ownerUid || !per[r.ownerUid]) { t.unowned += r.gross; continue; }
        const p = per[r.ownerUid]; p.bookings++; p.gross += r.gross;
        if (r.realized) { p.commissionRealized += r.commission; p.netRealized += r.net; t.commissionRealized += r.commission; t.netRealized += r.net; }
        else { p.commissionPending += r.commission; p.netPending += r.net; t.commissionPending += r.commission; t.netPending += r.net; }
      }
      // all-time balances straight from each owner's ledger
      const bal = await Promise.all(owners.map(async o => summarize(await loadLedger(o.uid, env))));
      owners.forEach((o, i) => Object.assign(per[o.uid], { balance: bal[i], hasPayout: !!o.payout }));
      t.owed = round2(bal.reduce((x, y) => x + Math.max(0, y.available), 0)); t.paidOut = round2(bal.reduce((x, y) => x + y.paid, 0)); t.pendingPayouts = round2(bal.reduce((x, y) => x + y.pending, 0));
      for (const k of ['gross', 'taxes', 'commissionRealized', 'commissionPending', 'netRealized', 'netPending', 'unowned']) t[k] = round2(t[k]);
      const owned = Object.values(per).map(p => { for (const k of ['gross', 'commissionRealized', 'commissionPending', 'netRealized', 'netPending']) p[k] = round2(p[k]); return p; });
      return ok({ totals: t, owners: owned, rows: rows.slice(0, 1500), truncated: rows.length > 1500, basis });
    }
  }

  // ---------------- partner applications & contact messages ----------------
  if (r0 === 'applications') {
    if (read && !r1) {
      const raw = (await fbQuery('/partnerApplications', { orderBy: 'createdAt', limitToLast: 60 }, dbUrl, env)) || {};
      const list = Object.values(raw).sort(byDateDesc).map(a => ({ ...a, documents: (a.documents || []).map(d => ({ name: d.name, size: (d.data || '').length })) }));
      return ok({ applications: list });
    }
    if (read && r1) { const a = await fbGet(`/partnerApplications/${safeKey(r1)}`, dbUrl, env); if (!a) throw httpError(404, 'مش موجود'); return ok({ application: a }); }
    if (m === 'PUT' && r1) {
      const b = await readBody(request);
      if (!['new', 'contacted', 'approved', 'rejected'].includes(b.status)) throw httpError(400, 'حالة غير صالحة');
      await fbPatch(`/partnerApplications/${safeKey(r1)}`, { status: b.status, adminNote: s(b.adminNote, 1000) }, dbUrl, env);
      await log('application.update', r1, { status: b.status });
      return ok({});
    }
    if (m === 'DELETE' && r1) { await fbSet(`/partnerApplications/${safeKey(r1)}`, null, dbUrl, env); await log('application.delete', r1); return ok({}); }
  }
  if (r0 === 'messages') {
    if (read) { const raw = (await fbQuery('/contactMessages', { orderBy: 'createdAt', limitToLast: 200 }, dbUrl, env)) || {}; return ok({ messages: Object.values(raw).sort(byDateDesc) }); }
    if (m === 'PUT' && r1) {
      const b = await readBody(request);
      if (!['new', 'read', 'replied'].includes(b.status)) throw httpError(400, 'حالة غير صالحة');
      await fbPatch(`/contactMessages/${safeKey(r1)}`, { status: b.status }, dbUrl, env); return ok({});
    }
    if (m === 'DELETE' && r1) { await fbSet(`/contactMessages/${safeKey(r1)}`, null, dbUrl, env); await log('message.delete', r1); return ok({}); }
  }

  // ---------------- reviews moderation (RTDB reviews) ----------------
  if (r0 === 'reviews') {
    if (read) {
      const all = (await fbGet('/reviews', dbUrl, env)) || {}, out = [], names = {};
      await Promise.all([['hotel', 'hotels.json'], ['excursion', 'excursions.json'], ['restaurant', 'restaurants.json']].map(async ([t, f]) => {
        try { const { data } = await readJsonFile(env, f); (Array.isArray(data) ? data : []).forEach(i => { const n = i.name || i.title; names[t + '/' + i.id] = n && typeof n === 'object' ? (n.ar || n.en || '') : (n || ''); }); } catch {}
      }));
      for (const [type, items] of Object.entries(all)) for (const [itemId, revs] of Object.entries(items || {})) for (const rv of Object.values(revs || {})) out.push({ ...rv, type, itemId, itemName: names[type + '/' + itemId] || itemId });
      return ok({ reviews: out.sort(byDateDesc).slice(0, 500) });
    }
    if (r1 && r2 && r3 && r4 === 'reply' && (m === 'PUT' || m === 'DELETE')) {
      const path2 = `/reviews/${safeKey(r1)}/${safeKey(r2)}/${safeKey(r3)}`;
      if (!(await fbGet(path2, dbUrl, env))) throw httpError(404, 'التعليق مش موجود');
      if (m === 'DELETE') { await fbSet(path2 + '/reply', null, dbUrl, env); await log('review.reply.delete', `${r1}/${r2}/${r3}`); return ok({}); }
      const text = s((await readBody(request)).text, 1000); if (text.length < 2) throw httpError(400, 'اكتب الرد');
      const reply = { text, byName: 'Discover Sharm', role: 'super_admin', at: new Date().toISOString() };
      await fbSet(path2 + '/reply', reply, dbUrl, env); await log('review.reply', `${r1}/${r2}/${r3}`);
      return ok({ reply });
    }
    if (m === 'DELETE' && r1 && r2 && r3 && !r4) { await fbSet(`/reviews/${safeKey(r1)}/${safeKey(r2)}/${safeKey(r3)}`, null, dbUrl, env); await log('review.delete', `${r1}/${r2}/${r3}`); return ok({}); }
  }

  if (r0 === 'audit' && read) {
    const limit = Math.min(300, parseInt(url.searchParams.get('limit') || '100', 10) || 100);
    const raw = (await fbQuery('/auditLog', { orderBy: '$key', limitToLast: limit }, dbUrl, env)) || {};
    return ok({ log: Object.values(raw).sort((x, y) => String(y.ts).localeCompare(String(x.ts))) });
  }

  // ---------------- maintenance: drop abandoned checkout sessions (unpaid bookings are never stored as bookings) ----------------
  if (r0 === 'maintenance' && r1 === 'purge-pending' && m === 'POST') {
    const all = (await fbGet('/pendingBookings', dbUrl, env)) || {}, cutoff = Date.now() - 24 * 3600e3;
    let removed = 0;
    for (const [id, p] of Object.entries(all)) if (p && Number(p.expiresAt) < cutoff && !p.paymentFlag) { await fbSet(`/pendingBookings/${safeKey(id)}`, null, dbUrl, env); removed++; }
    await log('maintenance.purge-pending', null, { removed });
    return ok({ removed, kept: Object.keys(all).length - removed });
  }

  // ---------------- maintenance: rebuild /itemOwners and stamp ownerUid on every booking ----------------
  if (r0 === 'maintenance' && r1 === 'reindex' && m === 'POST') {
    const maps = {};
    for (const [type, c] of Object.entries(ITEM_TYPES)) {
      const { data } = await readJsonFile(env, c.file);
      maps[type] = {};
      (Array.isArray(data) ? data : []).forEach(i => { if (i && i.id && i.owner) maps[type][i.id] = i.owner; });
      await fbSet(`/itemOwners/${type}`, Object.keys(maps[type]).length ? maps[type] : null, dbUrl, env);
    }
    const all = (await fbGet('/allBookings', dbUrl, env)) || {};
    const updates = {};
    for (const [id, b] of Object.entries(all)) {
      const c = ITEM_TYPES[b && b.type];
      if (!c) continue;
      const owner = maps[b.type][b[c.idField]] || null;
      if ((b.ownerUid || null) !== owner) { updates[`allBookings/${id}/ownerUid`] = owner; if (b.uid) updates[`users/${b.uid}/bookings/${id}/ownerUid`] = owner; }
    }
    const keys = Object.keys(updates);
    for (let i = 0; i < keys.length; i += 400) await fbPatch('/', Object.fromEntries(keys.slice(i, i + 400).map(k => [k, updates[k]])), dbUrl, env);
    await log('maintenance.reindex', null, { bookingsUpdated: keys.length });
    return ok({ items: Object.fromEntries(Object.entries(maps).map(([t, mm]) => [t, Object.keys(mm).length])), bookingsUpdated: keys.length });
  }

  return json({ error: 'Not found' }, 404, request);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeadersForRequest(request) });
    try { return await handle(request, env); }
    catch (e) { return json({ error: e.message || 'Server error' }, e.status || 500, request); }
  },
};
