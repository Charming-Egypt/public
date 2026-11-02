// Google Maps import: link parsing, field mapping, signatures, and the Worker routes (Google, GitHub and Supabase faked in memory — no network).
import assert from 'node:assert/strict';
import { parseMapsUrl, resolveMapsUrl, mapPlace, signGoogle, verifyGoogle, normGoogle, photoRefs } from '../lib/google-places.js';
import worker from '../content-worker.js';

const PID = 'ChIJaYihni04UxQRj03fFSZgnXI';

// ---------------- link parsing ----------------
{
  const long = 'https://www.google.com/maps/place/Mahony+Restaurant/@27.9113979,34.3212432,17z/data=!3m1!4b1!4m6!3m5!1s0x145b:0x7572!8m2!3d27.9113979!4d34.3212432';
  const p = parseMapsUrl(long);
  assert.equal(p.name, 'Mahony Restaurant'); assert.equal(p.lat, 27.9113979); assert.equal(p.lng, 34.3212432);
  assert.equal(parseMapsUrl(`https://www.google.com/maps/place/?q=place_id:${PID}`).placeId, PID);
  assert.equal(parseMapsUrl('https://www.google.com/maps/place/%D9%85%D8%B7%D8%B9%D9%85/@1.5,2.5,15z').name, 'مطعم');
  assert.equal(parseMapsUrl('https://www.google.com/maps?q=Cafe+Roma').name, 'Cafe Roma');
}

// ---------------- link resolving: only Google hosts, short links followed by Location header only ----------------
{
  const calls = [];
  const f = async (u, init) => { calls.push(String(u)); return new Response('', { status: 302, headers: { Location: 'https://www.google.com/maps/place/Blue+Hole/@28.57,34.54,15z' } }); };
  const r = await resolveMapsUrl('https://maps.app.goo.gl/abc123', f);
  assert.equal(r.name, 'Blue Hole'); assert.deepEqual(calls, ['https://maps.app.goo.gl/abc123']);   // google.com/maps itself was never fetched
  assert.deepEqual(await resolveMapsUrl(PID), { placeId: PID });
  for (const bad of ['https://evil.example/maps/place/x', 'http://maps.app.goo.gl/x', 'https://google.com.evil.io/maps/place/x', 'javascript:alert(1)', '']) {
    await assert.rejects(() => resolveMapsUrl(bad, async () => { throw new Error('must not fetch'); }), (e) => e.status === 400, bad);
  }
  const hop = async () => new Response('', { status: 302, headers: { Location: 'https://169.254.169.254/latest' } });   // a short link redirecting somewhere else is refused
  await assert.rejects(() => resolveMapsUrl('https://goo.gl/xyz', hop), (e) => e.status === 400);
}

// ---------------- field mapping ----------------
const EN = {
  id: PID, displayName: { text: 'Mahony Restaurant' }, formattedAddress: 'Naama Bay mall number 6, Sharm El Sheikh, Egypt', location: { latitude: 27.91, longitude: 34.32 },
  addressComponents: [{ longText: 'Naama Bay', types: ['sublocality_level_1'] }, { longText: 'Sharm El-Sheikh', types: ['locality'] }],
  internationalPhoneNumber: '+20 11 00100031', rating: 4.6, userRatingCount: 4053, priceLevel: 'PRICE_LEVEL_MODERATE', primaryType: 'seafood_restaurant', types: ['seafood_restaurant', 'restaurant'],
  primaryTypeDisplayName: { text: 'Seafood restaurant' }, editorialSummary: { text: 'Fresh fish by the sea.' }, googleMapsUri: 'https://maps.google.com/?cid=123',
  regularOpeningHours: { weekdayDescriptions: ['Monday: 12:00 PM – 12:00 AM', 'Tuesday: 12:00 PM – 12:00 AM', 'Wednesday: 12:00 PM – 12:00 AM', 'Thursday: 12:00 PM – 12:00 AM', 'Friday: 12:00 PM – 12:00 AM', 'Saturday: 12:00 PM – 12:00 AM', 'Sunday: 12:00 PM – 12:00 AM'] },
  photos: [{ name: 'places/' + PID + '/photos/AbC_1' }, { name: 'places/' + PID + '/photos/AbC_2' }, { name: 'bad/name' }],
  reviews: [
    { rating: 5, text: { text: 'Great food', languageCode: 'en' }, originalText: { text: 'أكل رائع', languageCode: 'ar' }, authorAttribution: { displayName: 'Ali', uri: 'https://www.google.com/maps/contrib/1', photoUri: 'https://lh3.googleusercontent.com/a' }, publishTime: '2026-09-01T10:00:00Z', relativePublishTimeDescription: 'a month ago' },
    { rating: 4, text: { text: '' } },                                  // empty text → dropped
    { rating: 3, text: { text: 'ok' }, authorAttribution: { displayName: 'X', uri: 'javascript:alert(1)' } },   // bad url → dropped from the field, review kept
  ],
};
const AR = { displayName: { text: 'مطعم ماهوني' }, formattedAddress: 'خليج نعمة', addressComponents: [{ longText: 'خليج نعمة', types: ['sublocality_level_1'] }, { longText: 'شرم الشيخ', types: ['locality'] }],
  primaryTypeDisplayName: { text: 'مطعم مأكولات بحرية' }, regularOpeningHours: { weekdayDescriptions: Array(7).fill('الاثنين: 12:00 م – 12:00 ص') } };
const m = mapPlace('restaurant', EN, AR, '2026-10-31T00:00:00.000Z');
assert.deepEqual(m.fields.name, { en: 'Mahony Restaurant', ar: 'مطعم ماهوني' });
assert.equal(m.fields.venueType, 'restaurant'); assert.equal(m.fields.priceLevel, 2); assert.equal(m.fields.phone, '+20 11 00100031');
assert.deepEqual(m.fields.location, { en: 'Naama Bay, Sharm El-Sheikh', ar: 'خليج نعمة, شرم الشيخ' });
assert.equal(m.fields.openHours.en, 'Daily 12:00 PM – 12:00 AM'); assert.match(m.fields.openHours.ar, /^يوميًا /);
assert.deepEqual(m.fields.coordinates, { lat: 27.91, lng: 34.32 }); assert.equal(m.fields.google_place_id, PID);
assert.equal(m.fields.description.en, 'Fresh fish by the sea.');
assert.equal(m.google.rating, 4.6); assert.equal(m.google.userRatingCount, 4053);
assert.equal(m.google.reviews.length, 2); assert.equal(m.google.reviews[0].text, 'أكل رائع'); assert.equal(m.google.reviews[0].lang, 'ar'); assert.equal(m.google.reviews[1].authorUrl, undefined);
assert.deepEqual(photoRefs(EN), [`places/${PID}/photos/AbC_1`, `places/${PID}/photos/AbC_2`]);   // malformed refs never reach the photo route
assert.equal(mapPlace('restaurant', { ...EN, primaryType: 'coffee_shop', types: ['coffee_shop'] }).fields.venueType, 'cafe');
assert.equal(mapPlace('hotel', EN, AR).fields.venueType, undefined);

// ---------------- signature ----------------
{
  const s = await signGoogle(m.google, 'secret');
  assert.ok(await verifyGoogle(s, 'secret'));
  assert.equal(await verifyGoogle(s, 'other'), null);
  assert.equal(await verifyGoogle({ ...s, rating: 5 }, 'secret'), null);                                                   // edited rating
  assert.equal(await verifyGoogle({ ...s, reviews: [...s.reviews, { rating: 5, text: 'fake' }] }, 'secret'), null);       // injected review
  assert.equal(await verifyGoogle({ ...s, sig: undefined }, 'secret'), null);
  // the editor drops empty keys on save: that must not break the signature
  assert.ok(await verifyGoogle({ ...s, junk: '', extra: [] }, 'secret'));
  assert.equal(normGoogle({ placeId: 'nope', rating: 9 }).placeId, undefined);
}

// ---------------- the Worker routes ----------------
const files = new Map(); let googleCalls = [];
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const method = (init.method || 'GET').toUpperCase();
  if (u.includes('/auth/v1/user')) { const t = (init.headers.Authorization || '').slice(7); return t === 'tok-admin' ? jres({ id: 'u-admin' }) : t === 'tok-own-r' ? jres({ id: 'u-own-r' }) : t === 'tok-own-h' ? jres({ id: 'u-own-h' }) : jres({}, 401); }
  if (u.includes('/rest/v1/profiles')) { const id = /id=eq\.([^&]+)/.exec(u)[1]; return jres([{ 'u-admin': { id, role: 'super_admin', is_active: true, owner_kinds: [] }, 'u-own-r': { id, role: 'owner', is_active: true, owner_kinds: ['restaurant'] }, 'u-own-h': { id, role: 'owner', is_active: true, owner_kinds: ['hotel'] } }[id]]); }
  if (u.startsWith('https://places.googleapis.com/')) {
    googleCalls.push(method + ' ' + u.replace('https://places.googleapis.com/v1', '') + ' ' + (init.headers['X-Goog-Api-Key'] || ''));
    if (u.endsWith('/places:searchText')) return jres({ places: [{ id: 'ChIJfar0000000000000000', location: { latitude: 10, longitude: 10 } }, { id: PID, location: { latitude: 27.9114, longitude: 34.3212 } }] });
    if (u.includes('languageCode=ar')) return jres(AR);
    if (u.includes('/media?')) return jres({ photoUri: 'https://lh3.googleusercontent.com/p/xyz' });
    return jres(EN);
  }
  if (u.startsWith('https://lh3.googleusercontent.com/')) return new Response(JPEG, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  if (u.startsWith('https://maps.app.goo.gl/')) return new Response('', { status: 302, headers: { Location: 'https://www.google.com/maps/place/Mahony+Restaurant/@27.9113979,34.3212432,17z' } });
  if (u.startsWith('https://api.github.com/') && method === 'PUT') { const p = decodeURIComponent(/contents\/([^?]+)/.exec(u)[1]); if (files.has(p)) return jres({}, 422); files.set(p, 1); return jres({ content: { sha: 'x' } }); }
  throw new Error('unexpected fetch ' + method + ' ' + u);
};
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', GITHUB_REPO: 'o/r', GITHUB_TOKEN: 't', GOOGLE_PLACES_API_KEY: 'KEY', ALLOWED_ORIGINS: 'https://admin.discover-sharm.com' };
const call = async (tok, path, body, e = env) => {
  const res = await worker.fetch(new Request('https://content.example' + path, { method: 'POST', headers: { Origin: 'https://admin.discover-sharm.com', Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), e, { waitUntil() {} });
  return { status: res.status, j: await res.json() };
};

{
  const r = await call('tok-own-r', '/import/google', { url: 'https://maps.app.goo.gl/abc', cat: 'restaurant' });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.placeId, PID);                                                  // nearest result to the pin, not the first one
  assert.equal(r.j.fields.name.ar, 'مطعم ماهوني'); assert.equal(r.j.photos.length, 2); assert.equal(r.j.summary.reviewsFetched, 2);
  assert.ok(googleCalls.every(c => c.endsWith(' KEY')));
  assert.ok(await verifyGoogle(r.j.google, env.SUPABASE_SERVICE_ROLE_KEY));       // signed with the server secret

  // wrong kind / not allowed / not signed in / no key configured
  assert.equal((await call('tok-own-h', '/import/google', { url: PID, cat: 'restaurant' })).status, 403);   // a hotel owner cannot import a restaurant
  assert.equal((await call('tok-own-r', '/import/google', { url: PID, cat: 'excursion' })).status, 400);
  assert.equal((await call('nobody', '/import/google', { url: PID, cat: 'restaurant' })).status, 401);
  const nokey = await call('tok-admin', '/import/google', { url: PID, cat: 'restaurant' }, { ...env, GOOGLE_PLACES_API_KEY: '' });
  assert.equal(nokey.status, 500); assert.equal(nokey.j.error, 'google_places_not_configured');

  // photo: only valid references, stored in the repo, returns a URL
  const ph = await call('tok-own-r', '/import/google/photo', { name: r.j.photos[0], cat: 'restaurant' });
  assert.equal(ph.status, 200, JSON.stringify(ph.j)); assert.match(ph.j.url, /\/img\/restaurants\/[a-f0-9]{16}\.jpg$/);
  assert.equal((await call('tok-own-r', '/import/google/photo', { name: '../../etc', cat: 'restaurant' })).status, 400);
}

console.log('google import: all checks passed');
