// Google Maps link → place data (Places API "New"). Pure helpers shared by the content Worker and its tests.
//
//   resolveMapsUrl(input, fetchFn)        any Google Maps link (long, maps.app.goo.gl short link, or a bare Place ID) → { placeId?, name?, lat?, lng? }
//   findPlaceId(ref, key, fetchFn)        name + coordinates → Place ID (Text Search, ids only = free SKU)
//   fetchPlace(placeId, key, fetchFn)     Place Details in English + Arabic
//   mapPlace(kind, en, ar)                → { fields, google, photos }  (fields = the item's own keys, google = the signed block)
//   signGoogle / verifyGoogle             HMAC over the normalised block, so an owner cannot forge "Google reviews" in a save request
//
// Nothing here talks to GitHub or the database.

import { fail } from './github.js';

const MAPS_HOST = /^(?:(?:www|maps)\.)?google\.(?:com|com?\.[a-z]{2}|[a-z]{2,3})$/i;
const SHORT_HOST = /^(?:maps\.app\.goo\.gl|goo\.gl|g\.co)$/i;
const PLACE_ID = /\bChIJ[\w-]{15,}\b/;
const UA = 'Mozilla/5.0 (compatible; DiscoverSharmImporter/1.0)';

const clean = (s) => String(s == null ? '' : s).replace(/[   ‎‏]/g, ' ').replace(/\s+/g, ' ').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const cut = (s, n) => { s = clean(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
const httpsUrl = (u, max = 600) => { try { const x = new URL(String(u || '')); return x.protocol === 'https:' && String(u).length <= max ? x.href : ''; } catch { return ''; } };

// ---------------------------------------------------------------------------------------------------------------------------
// 1) the link
export function parseMapsUrl(href) {
  let s = String(href || ''), dec = s;
  try { dec = decodeURIComponent(s); } catch { /* keep raw */ }
  const out = {};
  const id = PLACE_ID.exec(dec); if (id) out.placeId = id[0];
  const m = /\/maps\/place\/([^/@?#]+)/.exec(s);
  if (m) { try { out.name = clean(decodeURIComponent(m[1].replace(/\+/g, ' '))); } catch { out.name = clean(m[1].replace(/\+/g, ' ')); } }
  if (!out.name) { try { const u = new URL(s), q = u.searchParams.get('q') || u.searchParams.get('query'); if (q && !/^-?\d+(\.\d+)?\s*,\s*-?\d+/.test(q)) out.name = clean(q); } catch { /* not a URL */ } }
  const pin = /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(dec) || /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(dec);
  if (pin) { out.lat = Number(pin[1]); out.lng = Number(pin[2]); }
  return out;
}

const isFullMapsUrl = (u) => MAPS_HOST.test(u.hostname) && /^\/maps/i.test(u.pathname);

/** Follows a short link by reading the Location header only (never downloads a Google page). Only Google hosts are ever contacted. */
export async function resolveMapsUrl(input, fetchFn = fetch) {
  const raw = clean(input);
  if (!raw) throw fail(400, 'Paste a Google Maps link');
  if (PLACE_ID.test(raw) && !/[/:.]/.test(raw.replace(PLACE_ID, ''))) return { placeId: PLACE_ID.exec(raw)[0] };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { throw fail(400, 'That is not a link'); }
  for (let hop = 0; hop < 6; hop++) {
    if (u.protocol !== 'https:' || !(MAPS_HOST.test(u.hostname) || SHORT_HOST.test(u.hostname))) throw fail(400, 'Only Google Maps links are accepted');
    if (isFullMapsUrl(u)) return parseMapsUrl(u.href);
    if (MAPS_HOST.test(u.hostname) && !SHORT_HOST.test(u.hostname)) {   // google.com/<something else>: maybe ?q= / a place id, but nothing we can follow
      const p = parseMapsUrl(u.href); if (p.placeId || p.name) return p;
      throw fail(400, 'Open the place in Google Maps, press Share, and paste that link');
    }
    const res = await fetchFn(u.href, { redirect: 'manual', headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
    const loc = res.headers.get('Location');
    if (res.status >= 300 && res.status < 400 && loc) { u = new URL(loc, u); continue; }
    const body = res.ok ? await res.text() : '';
    const m = /https:\/\/(?:www\.)?google\.[a-z.]+\/maps\/place\/[^"'\s<>\\]+/i.exec(body.replace(/\\u0026/g, '&').replace(/&amp;/g, '&'));
    if (m) return parseMapsUrl(m[0]);
    throw fail(400, 'Could not read that link — open the place in Google Maps, press Share → Copy link');
  }
  throw fail(400, 'Too many redirects');
}

// ---------------------------------------------------------------------------------------------------------------------------
// 2) Places API (New)
const API = 'https://places.googleapis.com/v1';
const hdrs = (key, mask) => ({ 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask, 'Content-Type': 'application/json' });
async function call(fetchFn, url, init, what) {
  const res = await fetchFn(url, init);
  const text = await res.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const msg = (j && j.error && j.error.message) || text.slice(0, 160);
    if (res.status === 404) throw fail(404, 'Google could not find that place');
    if (res.status === 403 || res.status === 400 && /API key|not valid|disabled|billing/i.test(msg)) throw fail(502, 'google_key_rejected', { detail: msg });
    if (res.status === 429) throw fail(429, 'Google quota reached — try again later');
    throw fail(502, `google_${what}_${res.status}`, { detail: msg });
  }
  return j || {};
}

const km = (a, b) => { const R = 6371, d = (x) => x * Math.PI / 180, dl = d(b.lat - a.lat), dg = d(b.lng - a.lng), h = Math.sin(dl / 2) ** 2 + Math.cos(d(a.lat)) * Math.cos(d(b.lat)) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

export async function findPlaceId(ref, key, fetchFn = fetch) {
  if (ref.placeId) return ref.placeId;
  if (!ref.name) throw fail(400, 'Could not read the place name from that link');
  const body = { textQuery: ref.name, maxResultCount: 5, languageCode: 'en' };
  if (ref.lat != null && ref.lng != null) body.locationBias = { circle: { center: { latitude: ref.lat, longitude: ref.lng }, radius: 300 } };
  const j = await call(fetchFn, `${API}/places:searchText`, { method: 'POST', headers: hdrs(key, 'places.id,places.location'), body: JSON.stringify(body) }, 'search');
  const list = (j.places || []).filter(p => p.id);
  if (!list.length) throw fail(404, 'No place matches that link');
  if (ref.lat != null && list.length > 1) list.sort((a, b) => (a.location ? km({ lat: ref.lat, lng: ref.lng }, { lat: a.location.latitude, lng: a.location.longitude }) : 1e9) - (b.location ? km({ lat: ref.lat, lng: ref.lng }, { lat: b.location.latitude, lng: b.location.longitude }) : 1e9));
  return list[0].id;
}

const MASK_EN = ['id', 'displayName', 'formattedAddress', 'addressComponents', 'location', 'internationalPhoneNumber', 'regularOpeningHours.weekdayDescriptions', 'rating', 'userRatingCount',
  'reviews', 'photos', 'editorialSummary', 'primaryType', 'primaryTypeDisplayName', 'types', 'priceLevel', 'googleMapsUri', 'businessStatus'].join(',');
const MASK_AR = ['displayName', 'formattedAddress', 'addressComponents', 'regularOpeningHours.weekdayDescriptions', 'editorialSummary', 'primaryTypeDisplayName'].join(',');

export async function fetchPlace(placeId, key, fetchFn = fetch) {
  if (!PLACE_ID.test(placeId)) throw fail(400, 'Invalid place id');
  const get = (lang, mask) => call(fetchFn, `${API}/places/${encodeURIComponent(placeId)}?languageCode=${lang}`, { headers: hdrs(key, mask) }, 'details');
  const [en, ar] = await Promise.all([get('en', MASK_EN), get('ar', MASK_AR).catch(() => ({}))]);   // Arabic is a bonus: a failure there never blocks the import
  return { en, ar };
}

// ---------------------------------------------------------------------------------------------------------------------------
// 3) Google's shape → the item's shape
const AREA_TYPES = ['sublocality_level_1', 'sublocality', 'neighborhood', 'locality'];
function area(p) {
  const comps = p.addressComponents || [], got = [];
  for (const t of AREA_TYPES) { const c = comps.find(x => (x.types || []).includes(t)); if (c && c.longText && !got.includes(c.longText)) got.push(c.longText); if (got.length === 2) break; }
  return clean(got.join(', ')) || cut(p.formattedAddress || '', 80);
}
function hours(p, ar) {
  const rows = ((p.regularOpeningHours || {}).weekdayDescriptions || []).map(clean).filter(Boolean);
  if (!rows.length) return '';
  const parts = rows.map(r => { const i = r.indexOf(': '); return i > 0 ? [r.slice(0, i), r.slice(i + 2)] : ['', r]; });
  if (parts.every(x => x[1] === parts[0][1])) return `${ar ? 'يوميًا' : 'Daily'} ${parts[0][1]}`;
  return cut(parts.map(x => (x[0] ? `${x[0].slice(0, ar ? 20 : 3)}: ${x[1]}` : x[1])).join(' · '), 300);
}
const PRICE = { PRICE_LEVEL_FREE: 1, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
const CAFE_TYPES = new Set(['cafe', 'coffee_shop', 'tea_house', 'bakery', 'dessert_shop', 'ice_cream_shop', 'juice_shop']);
const name = (p) => clean((p.displayName || {}).text);
const summary = (p) => clean((p.editorialSummary || {}).text);
const set = (o, k, en, ar) => { const v = {}; if (en) v.en = en; if (ar) v.ar = ar; if (Object.keys(v).length) o[k] = v; };

/** photo refs (not downloaded yet): the console fetches them one by one through /import/google/photo */
export const photoRefs = (en, max = 10) => (en.photos || []).map(p => p.name).filter(n => /^places\/[\w-]+\/photos\/[\w-]+$/.test(n || '')).slice(0, max);

export function normGoogle(g) {
  g = g && typeof g === 'object' ? g : {};
  const out = {};
  if (PLACE_ID.test(g.placeId || '')) out.placeId = g.placeId;
  const r = num(g.rating); if (r != null && r >= 0 && r <= 5) out.rating = Math.round(r * 10) / 10;
  const c = num(g.userRatingCount); if (c != null && c >= 0) out.userRatingCount = Math.trunc(c);
  const m = httpsUrl(g.mapsUri); if (m) out.mapsUri = m;
  if (typeof g.importedAt === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(g.importedAt)) out.importedAt = g.importedAt;
  const reviews = (Array.isArray(g.reviews) ? g.reviews : []).slice(0, 10).map(v => {
    const x = {}, rt = num(v && v.rating), text = cut(v && v.text, 2000);
    if (rt == null || rt < 1 || rt > 5 || !text) return null;
    x.rating = Math.round(rt); x.text = text;
    const a = cut(v.author, 80); if (a) x.author = a;
    const au = httpsUrl(v.authorUrl); if (au) x.authorUrl = au;
    const ap = httpsUrl(v.authorPhoto); if (ap) x.authorPhoto = ap;
    if (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(v.lang || '')) x.lang = v.lang;
    if (typeof v.time === 'string' && /^\d{4}-\d\d-\d\dT/.test(v.time)) x.time = v.time.slice(0, 20);
    const rel = cut(v.when, 40); if (rel) x.when = rel;
    return x;
  }).filter(Boolean);
  if (reviews.length) out.reviews = reviews;
  return out;
}

export function mapPlace(kind, en, ar = {}, now = new Date().toISOString()) {
  const f = {};
  set(f, 'name', name(en), name(ar));
  const types = new Set([en.primaryType, ...(en.types || [])].filter(Boolean));
  const isCafe = [...types].some(t => CAFE_TYPES.has(t));
  if (kind === 'restaurant') {
    f.venueType = isCafe ? 'cafe' : 'restaurant';
    set(f, 'cuisine', clean((en.primaryTypeDisplayName || {}).text), clean((ar.primaryTypeDisplayName || {}).text));
    if (PRICE[en.priceLevel]) f.priceLevel = PRICE[en.priceLevel];
    set(f, 'openHours', hours(en, false), hours(ar, true));
    if (en.formattedAddress) f.address_full = clean(en.formattedAddress);
    if (en.internationalPhoneNumber) f.phone = clean(en.internationalPhoneNumber);
    if (en.googleMapsUri) f.google_maps_url = en.googleMapsUri;
    if (en.location) f.coordinates = { lat: en.location.latitude, lng: en.location.longitude };
    if (en.id) f.google_place_id = en.id;
  } else if (kind === 'hotel') {
    if (en.googleMapsUri) f.google_maps_url = en.googleMapsUri;
    if (en.location) f.coordinates = { lat: en.location.latitude, lng: en.location.longitude };
    if (en.internationalPhoneNumber) f.phone = clean(en.internationalPhoneNumber);
    if (en.formattedAddress) f.address_full = clean(en.formattedAddress);
    if (en.id) f.google_place_id = en.id;
  }
  set(f, 'location', area(en), area(ar));
  const sEn = summary(en), sAr = summary(ar);
  set(f, 'description', cut(sEn, 180), cut(sAr, 180));
  set(f, 'fullDescription', cut(sEn, 2500), cut(sAr, 2500));
  const google = normGoogle({
    placeId: en.id, rating: en.rating, userRatingCount: en.userRatingCount, mapsUri: en.googleMapsUri, importedAt: now,
    reviews: (en.reviews || []).map(v => {
      const o = v.originalText && v.originalText.text ? v.originalText : v.text || {};
      return { rating: v.rating, text: o.text, lang: o.languageCode, author: (v.authorAttribution || {}).displayName, authorUrl: (v.authorAttribution || {}).uri,
        authorPhoto: (v.authorAttribution || {}).photoUri, time: v.publishTime, when: v.relativePublishTimeDescription };
    }),
  });
  return { fields: f, google, closed: en.businessStatus && en.businessStatus !== 'OPERATIONAL' ? en.businessStatus : '' };
}

// ---------------------------------------------------------------------------------------------------------------------------
// 4) signature: the Worker signs what it fetched from Google; saves from owners must carry a valid signature or the block is dropped
const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',')}}` : JSON.stringify(v);
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hmac(secret, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)));
}
export async function signGoogle(block, secret) { const n = normGoogle(block); return { ...n, sig: await hmac(secret, stable(n)) }; }
/** → the cleaned block (with its signature) or null when it is not genuine */
export async function verifyGoogle(block, secret) {
  if (!block || typeof block !== 'object' || typeof block.sig !== 'string' || !secret) return null;
  const n = normGoogle(block), want = await hmac(secret, stable(n));
  if (want.length !== block.sig.length) return null;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ block.sig.charCodeAt(i);
  return d === 0 && n.placeId ? { ...n, sig: block.sig } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// 5) one photo → bytes (Places Photo (New): first ask for the temporary URL, then download it)
export async function fetchPhoto(photoName, key, fetchFn = fetch, maxBytes = 880_000) {
  if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(photoName || '')) throw fail(400, 'Invalid photo reference');
  for (const w of [1600, 1280, 1024, 800, 640]) {
    const meta = await call(fetchFn, `${API}/${photoName}/media?maxWidthPx=${w}&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': key } }, 'photo');
    let u; try { u = new URL(meta.photoUri); } catch { throw fail(502, 'google_photo_uri'); }
    if (u.protocol !== 'https:' || !/(^|\.)(googleusercontent\.com|ggpht\.com|google\.com)$/i.test(u.hostname)) throw fail(502, 'google_photo_host');
    const res = await fetchFn(u.href);
    if (!res.ok) throw fail(502, `google_photo_${res.status}`);
    const mime = (res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw fail(502, 'google_photo_type');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length <= maxBytes) return { bytes, mime };
  }
  throw fail(413, 'Photo too large');
}
