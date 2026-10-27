// No network, no accounts: GitHub (contents + graphql) and Supabase (auth, profiles, properties) are faked in memory.
import assert from 'node:assert/strict';
import worker from '../content-worker.js';

// ---------------- fake GitHub ----------------
const files = new Map();          // path -> { text(b64), sha }
let shaN = 0, ghCalls = 0, failNextPut = 0, conflictNextPut = 0, conflictOn = '';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const text = (b) => Buffer.from(b, 'base64').toString('utf8');
const readJSON = (p) => (files.has(p) ? JSON.parse(text(files.get(p).b64)) : undefined);

// ---------------- fake Supabase ----------------
const users = {  // token -> profile
  'tok-admin': { id: 'u-admin', role: 'super_admin', is_active: true, owner_kinds: [], max_items: null },
  'tok-own-h': { id: 'u-own-h', role: 'owner', is_active: true, owner_kinds: ['hotel'], max_items: 2 },
  'tok-own-h2': { id: 'u-own-h2', role: 'owner', is_active: true, owner_kinds: ['hotel'], max_items: 2 },
  'tok-own-e': { id: 'u-own-e', role: 'owner', is_active: true, owner_kinds: ['excursion', 'journal'], max_items: null },
  'tok-cust': { id: 'u-cust', role: 'user', is_active: true, owner_kinds: [], max_items: null },
  'tok-off': { id: 'u-off', role: 'owner', is_active: false, owner_kinds: ['hotel'], max_items: null },
};
let rows = [];  // properties
let rowN = 0;
const match = (r, qs) => {
  for (const [k, v] of qs) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const [op, ...rest] = v.split('.'), val = rest.join('.');
    const cell = String(r[k]);
    if (op === 'eq' && cell !== val) return false;
    if (op === 'neq' && cell === val) return false;
  }
  return true;
};
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (u, init = {}) => {
  u = String(u); const method = (init.method || 'GET').toUpperCase();
  const bodyJ = init.body ? JSON.parse(init.body) : undefined;
  if (u.startsWith('https://api.github.com/')) {
    ghCalls++;
    if (u.endsWith('/graphql')) {
      const q = bodyJ.query, out = {};
      [...q.matchAll(/o(\d+):object\(expression:"main:([^"]+)"\)/g)].forEach(m => { out['o' + m[1]] = files.has(m[2]) ? { text: text(files.get(m[2]).b64), isTruncated: false } : null; });
      return jres({ data: { repository: out } });
    }
    const m = /\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)/.exec(u), path = decodeURIComponent(m[1]);
    if (method === 'GET') {
      if (!files.has(path)) {   // a folder listing
        const kids = [...files.keys()].filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
        return kids.length ? jres(kids.map(k => ({ type: 'file', name: k.split('/').pop(), sha: files.get(k).sha }))) : jres({ message: 'Not Found' }, 404);
      }
      const f = files.get(path);
      if ((init.headers.Accept || '').includes('raw')) return new Response(Buffer.from(f.b64, 'base64'), { status: 200 });
      return jres({ sha: f.sha, encoding: 'base64', content: f.b64 });
    }
    if (method === 'PUT') {
      if (failNextPut > 0) { failNextPut--; return jres({ message: 'boom' }, 500); }
      if (conflictNextPut > 0 && path.endsWith(conflictOn)) { conflictNextPut--; return jres({ message: 'conflict' }, 409); }
      const ex = files.get(path);
      if (ex && bodyJ.sha !== ex.sha) return jres({ message: 'sha mismatch' }, 409);
      if (!ex && bodyJ.sha) return jres({ message: 'bad sha' }, 422);
      if (ex && !bodyJ.sha) return jres({ message: "\"sha\" wasn't supplied" }, 422);
      const sha = 's' + (++shaN); files.set(path, { b64: bodyJ.content, sha, msg: bodyJ.message });
      return jres({ content: { sha } }, ex ? 200 : 201);
    }
    if (method === 'DELETE') {
      const ex = files.get(path); if (!ex) return jres({ message: 'Not Found' }, 404);
      if (bodyJ.sha !== ex.sha) return jres({ message: 'sha mismatch' }, 409);
      files.delete(path); return jres({ commit: {} });
    }
  }
  if (u.startsWith('https://x.supabase.co/auth/v1/user')) {
    const t = (init.headers.Authorization || '').replace('Bearer ', ''); const p = users[t];
    return p ? jres({ id: p.id }) : jres({ message: 'bad jwt' }, 401);
  }
  if (u.startsWith('https://x.supabase.co/rest/v1/')) {
    const url = new URL(u), table = url.pathname.split('/').pop(), qs = [...url.searchParams.entries()];
    if (table === 'profiles') { const id = (qs.find(([k]) => k === 'id') || [])[1].replace('eq.', ''); const p = Object.values(users).find(x => x.id === id); return jres(p ? [p] : []); }
    if (table === 'properties') {
      if (method === 'GET') { const r = rows.filter(x => match(x, qs)); return jres(r.map(x => ({ rating_avg: 0, rating_count: 0, ...x }))); }
      if (method === 'POST') {
        if (bodyJ.owner_id) {   // properties_enforce_limit trigger
          const lim = Object.values(users).find(x => x.id === bodyJ.owner_id).max_items;
          if (lim != null && rows.filter(r => r.owner_id === bodyJ.owner_id && r.kind === bodyJ.kind && r.status !== 'archived').length >= lim)
            return jres({ code: 'P0001', message: `Listing limit reached (${lim})`, details: 'limit_reached' }, 400);
        }
        const r = { id: 'it' + (++rowN).toString().padStart(4, '0'), sort_order: 1000, featured: false, has_draft: false, created_at: '2026-10-22T10:00:00Z', ...bodyJ };
        r.data = { ...r.data, id: r.id }; rows.push(r); return jres([r], 201);
      }
      if (method === 'PATCH') { const r = rows.filter(x => match(x, qs)); r.forEach(x => Object.assign(x, bodyJ, bodyJ.data ? { data: { ...bodyJ.data, id: x.id } } : {})); return jres(r); }
      if (method === 'DELETE') { const keep = rows.filter(x => !match(x, qs)); rows = keep; return new Response(null, { status: 204 }); }
    }
  }
  return jres({ message: 'unmocked ' + method + ' ' + u }, 599);
};

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', GITHUB_TOKEN: 'ghp_x', GITHUB_REPO: 'acme/data', GITHUB_BRANCH: 'main',
  ALLOWED_ORIGINS: 'https://admin.discover-sharm.com,https://www.discover-sharm.com' };
const ORIGIN = 'https://admin.discover-sharm.com';
const call = async (method, path, { tok, body, origin = ORIGIN } = {}) => {
  const r = await worker.fetch(new Request('https://api.test' + path, { method, headers: { Origin: origin, ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, {});
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, j, raw: t, headers: r.headers };
};

const hotel = { name: { en: 'Sea View', ar: 'سي فيو' }, category: 'luxury', price: 1500, description: { en: 'nice' },
  rooms: [{ type: { en: 'Double' }, price: 1500, baseOccupancy: 2, image: 'x.jpg' }], unavailableDates: ['2026-12-25'], image: 'h.jpg' };

// ===== 1. permissions ======================================================================================================
assert.equal((await call('POST', '/items/hotels', { body: hotel })).status, 401, 'no token');
assert.equal((await call('POST', '/items/hotels', { tok: 'bad', body: hotel })).status, 401, 'bad token');
assert.equal((await call('POST', '/items/hotels', { tok: 'tok-cust', body: hotel })).status, 403, 'customer');
assert.equal((await call('POST', '/items/hotels', { tok: 'tok-off', body: hotel })).status, 403, 'suspended owner');
assert.equal((await call('POST', '/items/excursions', { tok: 'tok-own-h', body: hotel })).status, 403, 'hotel owner cannot add excursions');
assert.equal((await call('POST', '/items/hotels', { tok: 'tok-own-h', body: hotel, origin: 'https://evil.example' })).status, 403, 'unknown origin');

// ===== 2. owner creates a hotel: file written, published=false, DB row has id + owner + pricing =============================
let r = await call('POST', '/items/hotels', { tok: 'tok-own-h', body: { ...hotel, published: true, status: 'published', ownerId: 'hacker', rating: 5 } });
assert.equal(r.status, 200, r.raw);
const hid = r.j.item.id;
let f = readJSON(`api/hotels/${hid}.json`);
assert.equal(f.published, false, 'new items are NOT published');
assert.equal(f.ownerId, 'u-own-h', 'owner id comes from the token, not the body');
assert.equal(f.rating, undefined, 'owner cannot set rating');
assert.equal(f.status, undefined);
assert.equal(files.has('api/hotels/hotels.json'), false, 'not in the public index');
const row = rows.find(x => x.id === hid);
assert.equal(row.owner_id, 'u-own-h'); assert.equal(row.status, 'pending_review'); assert.equal(row.kind, 'hotel');
assert.equal(row.data.price, 1500); assert.equal(row.data.description, undefined, 'DB keeps only pricing fields');
assert.ok(files.get(`api/hotels/${hid}.json`).msg.includes('u-own-h'), 'commit message records who');

// public catalog is empty/ fallback while nothing is published
r = await call('GET', '/catalog/hotels.json', { origin: 'https://random.site' });
assert.equal(r.status, 200); assert.equal(r.j.items.length, 0); assert.equal(r.j.fallback, true);
assert.equal((await call('GET', '/catalog/nothing.json')).status, 404);

// listing cap (DB trigger) is reported
await call('POST', '/items/hotels', { tok: 'tok-own-h', body: hotel });
r = await call('POST', '/items/hotels', { tok: 'tok-own-h', body: hotel });
assert.equal(r.status, 409); assert.equal(r.j.code, 'limit_reached');

// owners see only their own
r = await call('GET', '/items/hotels', { tok: 'tok-own-h2' }); assert.equal(r.j.items.length, 0);
r = await call('GET', '/items/hotels', { tok: 'tok-own-h' }); assert.equal(r.j.items.length, 2);
assert.equal((await call('PUT', `/items/hotels/${hid}`, { tok: 'tok-own-h2', body: hotel })).status, 403, "another owner can't edit it");
assert.equal((await call('POST', `/items/hotels/${hid}/publish`, { tok: 'tok-own-h' })).status, 403, 'owners cannot publish');

// ===== 3. super admin publishes: true in file, DB, public index ==========================================================
r = await call('POST', `/items/hotels/${hid}/publish`, { tok: 'tok-admin' });
assert.equal(r.status, 200, r.raw);
f = readJSON(`api/hotels/${hid}.json`); assert.equal(f.published, true); assert.ok(f.publishedAt);
assert.equal(rows.find(x => x.id === hid).status, 'published');
let idx = readJSON('api/hotels/hotels.json');
assert.equal(idx.items.length, 1); assert.equal(idx.items[0].id, hid);
assert.equal(idx.items[0].ownerId, undefined, 'owner uid is not exposed in the public index');
assert.equal(idx.items[0].published, undefined);
assert.equal(idx.items[0].name.en, 'Sea View');
r = await call('GET', '/catalog/hotels.json');
assert.equal(r.status, 200); assert.equal(r.j.items[0].id, hid); assert.equal(r.j.fallback, undefined);
assert.equal(r.headers.get('access-control-allow-origin'), '*');

// ===== 4. owner edits a PUBLISHED item → draft only; live copy + DB price unchanged =======================================
r = await call('PUT', `/items/hotels/${hid}`, { tok: 'tok-own-h', body: { ...hotel, price: 1, description: { en: 'EDITED' } } });
assert.equal(r.status, 200); assert.equal(r.j.pendingReview, true);
assert.equal(readJSON('api/hotels/hotels.json').items[0].price, 1500, 'live index unchanged');
assert.equal(readJSON(`api/hotels/${hid}.json`).description.en, 'nice', 'live file unchanged');
assert.equal(readJSON(`api/hotels/${hid}.draft.json`).description.en, 'EDITED');
assert.equal(rows.find(x => x.id === hid).data.price, 1500, 'booking price check still sees the approved price');
assert.equal(rows.find(x => x.id === hid).has_draft, true);
r = await call('GET', `/items/hotels/${hid}`, { tok: 'tok-own-h' }); assert.equal(r.j.item.description.en, 'EDITED'); assert.equal(r.j.item.pendingEdit, true);
r = await call('GET', '/items/hotels', { tok: 'tok-admin' }); assert.equal(r.j.items.find(i => i.id === hid).pendingEdit, true, 'admin sees the pending edit');
// admin approves (publish) → draft is merged and removed
r = await call('POST', `/items/hotels/${hid}/publish`, { tok: 'tok-admin' });
assert.equal(r.j.mergedDraft, true);
assert.equal(readJSON('api/hotels/hotels.json').items[0].description.en, 'EDITED');
assert.equal(rows.find(x => x.id === hid).data.price, 1, 'DB price follows the approved version');
assert.equal(files.has(`api/hotels/${hid}.draft.json`), false); assert.equal(rows.find(x => x.id === hid).has_draft, false);
assert.equal(readJSON(`api/hotels/${hid}.json`).ownerId, 'u-own-h');

// ===== 5. admin creates + publishes in one go; order/featured; owner assignment ============================================
r = await call('POST', '/items/hotels', { tok: 'tok-admin', body: { ...hotel, name: { en: 'Admin Hotel' }, status: 'published', owner: 'u-own-h2', featured: true, sortOrder: 1 } });
assert.equal(r.status, 200, r.raw); const aid = r.j.item.id;
idx = readJSON('api/hotels/hotels.json'); assert.deepEqual(idx.items.map(i => i.id), [aid, hid], 'sorted by sortOrder');
assert.equal(idx.items[0].featured, true);
assert.equal(readJSON(`api/hotels/${aid}.json`).ownerId, 'u-own-h2'); assert.equal(rows.find(x => x.id === aid).owner_id, 'u-own-h2');
// admin edits a live item directly → live immediately
r = await call('PUT', `/items/hotels/${aid}`, { tok: 'tok-admin', body: { ...hotel, name: { en: 'Admin Hotel v2' }, status: 'published', owner: 'u-own-h2' } });
assert.equal(r.j.published, true); assert.equal(readJSON('api/hotels/hotels.json').items.find(i => i.id === aid).name.en, 'Admin Hotel v2');
// unpublish → false everywhere
r = await call('POST', `/items/hotels/${aid}/unpublish`, { tok: 'tok-admin' }); assert.equal(r.status, 200);
assert.equal(readJSON(`api/hotels/${aid}.json`).published, false); assert.equal(rows.find(x => x.id === aid).status, 'draft');
assert.deepEqual(readJSON('api/hotels/hotels.json').items.map(i => i.id), [hid]);
// the admin console's status select: PUT with status 'draft' on a live item hides it
r = await call('PUT', `/items/hotels/${hid}`, { tok: 'tok-admin', body: { ...hotel, status: 'draft', owner: 'u-own-h' } });
assert.deepEqual(readJSON('api/hotels/hotels.json').items, []); assert.equal(rows.find(x => x.id === hid).status, 'draft');
r = await call('PUT', `/items/hotels/${hid}`, { tok: 'tok-admin', body: { ...hotel, status: 'published', owner: 'u-own-h' } });
assert.equal(readJSON('api/hotels/hotels.json').items.length, 1);

// ===== 6. rollback when GitHub fails mid-publish: DB is put back =========================================================
const before = JSON.stringify(rows.find(x => x.id === aid));
failNextPut = 1;
r = await call('POST', `/items/hotels/${aid}/publish`, { tok: 'tok-admin' });
assert.equal(r.status, 502);
assert.equal(JSON.stringify(rows.find(x => x.id === aid)), before, 'DB row restored — never "published" without a file');
// creating with a GitHub failure leaves nothing behind
const rowsBefore = rows.length; failNextPut = 1;
r = await call('POST', '/items/excursions', { tok: 'tok-admin', body: { title: { en: 'X' }, price: 10 } });
assert.equal(r.status, 502); assert.equal(rows.length, rowsBefore, 'no half-created DB row');

// ===== 7. two people saving the index at once: sha conflict is retried ===================================================
conflictNextPut = 1; conflictOn = 'hotels/hotels.json';
r = await call('POST', `/items/hotels/${aid}/publish`, { tok: 'tok-admin' });
assert.equal(r.status, 200, 'a conflicting index write is retried: ' + r.raw); assert.equal(conflictNextPut, 0, 'the conflict really happened');
assert.ok(readJSON('api/hotels/hotels.json').items.some(i => i.id === aid));
conflictNextPut = 9; conflictOn = 'hotels/hotels.json';
r = await call('POST', `/items/hotels/${aid}/publish`, { tok: 'tok-admin' });
assert.equal(r.status, 409, 'gives up after 5 tries'); conflictNextPut = 0;
assert.equal(rows.find(x => x.id === aid).status, 'published', 'DB rolled back to the previous state');

// ===== 8. owner archive vs admin delete ==========================================================================================
r = await call('POST', '/items/excursions', { tok: 'tok-own-e', body: { title: { en: 'Snorkel' }, price: 500 } }); const eid = r.j.item.id;
await call('POST', `/items/excursions/${eid}/publish`, { tok: 'tok-admin' });
assert.equal(readJSON('api/excursions/excursions.json').items.length, 1);
r = await call('DELETE', `/items/excursions/${eid}`, { tok: 'tok-own-e' }); assert.equal(r.status, 200);
assert.equal(rows.find(x => x.id === eid).status, 'archived'); assert.equal(readJSON('api/excursions/excursions.json').items.length, 0);
assert.ok(files.has(`api/excursions/${eid}.json`), 'owner archive keeps the file (history, bookings)');
r = await call('GET', '/items/excursions', { tok: 'tok-own-e' }); assert.equal(r.j.items.length, 0, 'archived items are hidden from the owner');
r = await call('DELETE', `/items/excursions/${eid}`, { tok: 'tok-admin' });
assert.equal(files.has(`api/excursions/${eid}.json`), false); assert.equal(rows.some(x => x.id === eid), false);

// ===== 9. journal + destinations: GitHub only, super admin only, NO database rows =====================================================
const rowsBeforeJ = rows.length;
r = await call('POST', '/items/journal', { tok: 'tok-own-e', body: { title: { en: 'x' } } }); assert.equal(r.status, 403, 'owners cannot write journal posts, even with the journal permission');
assert.equal((await call('GET', '/items/journal', { tok: 'tok-own-e' })).status, 403);
assert.equal((await call('POST', '/items/destinations', { tok: 'tok-own-h', body: { name: { en: 'x' } } })).status, 403);
r = await call('POST', '/items/journal', { tok: 'tok-admin', body: { title: { en: 'Top 5 dives', ar: 'أفضل ٥' }, content: { en: '<h2 style="color:red">Hi</h2><p>…</p>' }, images: ['a.jpg', 'b.jpg'], image: 'a.jpg', ownerId: 'x', published: true } });
assert.equal(r.status, 200, r.raw); const jid = r.j.item.id; assert.match(jid, /^[a-z0-9]{12}$/);
assert.equal(readJSON(`api/journal/${jid}.json`).published, false); assert.equal(readJSON(`api/journal/${jid}.json`).ownerId, undefined);
assert.equal(readJSON(`api/journal/${jid}.json`).content.en, '<h2 style="color:red">Hi</h2><p>…</p>', 'html is stored as written');
assert.equal(rows.length, rowsBeforeJ, 'nothing in the database');
r = await call('GET', '/items/journal', { tok: 'tok-admin' }); assert.equal(r.j.items.length, 1); assert.equal(r.j.items[0].status, 'draft');
assert.equal((await call('GET', '/catalog/journal.json')).j.items.length, 0, 'drafts are not public');
assert.equal((await call('GET', '/catalog/journal.json')).j.fallback, true, 'no index yet → fallback flag (site uses its bundled file)');
await call('POST', `/items/journal/${jid}/publish`, { tok: 'tok-admin' });
r = await call('GET', '/catalog/journal.json'); assert.equal(r.j.items[0].title.en, 'Top 5 dives'); assert.equal(r.j.items[0].published, undefined); assert.equal(r.j.fallback, undefined);
// editing a published post updates the live index right away; status select can hide it again
r = await call('PUT', `/items/journal/${jid}`, { tok: 'tok-admin', body: { title: { en: 'Top 6 dives' }, status: 'published', images: ['a.jpg'] } });
assert.equal(r.status, 200); assert.equal(readJSON('api/journal/journal.json').items[0].title.en, 'Top 6 dives');
r = await call('PUT', `/items/journal/${jid}`, { tok: 'tok-admin', body: { title: { en: 'Top 6 dives' }, status: 'draft' } });
assert.deepEqual(readJSON('api/journal/journal.json').items, []); assert.equal(readJSON(`api/journal/${jid}.json`).published, false);
assert.equal((await call('POST', '/items/journal', { tok: 'tok-admin', body: { title: { en: 'y' }, status: 'archived' } })).status, 400, 'github-only kinds have draft/published only');
r = await call('POST', '/items/destinations', { tok: 'tok-admin', body: { name: { en: 'Naama Bay' }, location: { en: 'Sharm' }, status: 'published' } });
assert.equal(r.status, 200, r.raw); const did = r.j.item.id;
assert.equal(readJSON('api/destinations/destinations.json').items[0].name.en, 'Naama Bay'); assert.equal(rows.length, rowsBeforeJ);
r = await call('DELETE', `/items/destinations/${did}`, { tok: 'tok-admin' }); assert.equal(r.status, 200);
assert.equal(files.has(`api/destinations/${did}.json`), false); assert.deepEqual(readJSON('api/destinations/destinations.json').items, []);
assert.equal((await call('GET', `/items/journal/..%2Fx`, { tok: 'tok-admin' })).status, 400);
assert.equal((await call('GET', `/items/journal/journal`, { tok: 'tok-admin' })).status, 400, 'index file name is not an item id');
r = await call('GET', '/items/journal', { tok: 'tok-admin' }); assert.equal(r.j.items.length, 1, 'the index file is not listed as an item');

// ===== 10. legacy rows (in the DB, no file yet) still show up in the console and the public fallback ===============================
rows.push({ id: 'legacy1', kind: 'transfer', owner_id: null, status: 'published', featured: false, sort_order: 5, has_draft: false, created_at: '2026-01-01T00:00:00Z', data: { id: 'legacy1', vehicleType: { en: 'Van' }, price: 40 } });
r = await call('GET', '/items/transfers', { tok: 'tok-admin' }); assert.equal(r.j.items[0].vehicleType.en, 'Van');
r = await call('GET', '/catalog/transfers.json'); assert.equal(r.j.items[0].id, 'legacy1'); assert.equal(r.j.fallback, true);

// ===== 11. images ======================================================================================================================
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const data = (buf, mime = 'image/jpeg') => `data:${mime};base64,${buf.toString('base64')}`;
r = await call('POST', '/upload', { tok: 'tok-own-h', body: { image: data(jpeg), cat: 'hotels' } });
assert.equal(r.status, 200, r.raw); assert.match(r.j.url, /^https:\/\/api\.test\/img\/hotels\/[a-f0-9]{16}\.jpg$/);
const imgName = r.j.url.split('/').pop(); assert.ok(files.has(`api/hotels/img/${imgName}`));
r = await call('POST', '/upload', { tok: 'tok-own-h', body: { image: data(jpeg), cat: 'hotels' } }); assert.equal(r.status, 200, 'same image twice is fine');
assert.equal((await call('POST', '/upload', { tok: 'tok-own-h', body: { image: data(Buffer.from('<script>alert(1)</script>'), 'image/jpeg'), cat: 'hotels' } })).status, 400, 'content must match type');
assert.equal((await call('POST', '/upload', { tok: 'tok-own-h', body: { image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', cat: 'hotels' } })).status, 400, 'no svg');
assert.equal((await call('POST', '/upload', { tok: 'tok-own-h', body: { image: data(jpeg), cat: 'excursions' } })).status, 403, "hotel owner can't upload into excursions");
assert.equal((await call('POST', '/upload', { tok: 'tok-cust', body: { image: data(jpeg), cat: 'hotels' } })).status, 403);
assert.equal((await call('POST', '/upload', { tok: 'tok-admin', body: { image: data(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(950_000)])), cat: 'hotels' } })).status, 413);
r = await call('GET', `/img/hotels/${imgName}`, { origin: 'https://random.site' });
assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg'); assert.match(r.headers.get('cache-control'), /immutable/);
assert.equal((await call('GET', '/img/hotels/..%2F..%2Fsecret.json')).status, 404, 'only hash-named images are served');

// ===== 12. misc ========================================================================================================================
assert.equal((await call('GET', '/items/castles', { tok: 'tok-admin' })).status, 404);
assert.equal((await call('PUT', '/items/hotels/..%2Fx', { tok: 'tok-admin', body: hotel })).status, 400, 'ids are validated');
assert.equal((await call('POST', '/items/hotels', { tok: 'tok-admin', body: { ...hotel, status: 'weird' } })).status, 400);
assert.equal((await call('OPTIONS', '/items/hotels')).status, 204);
r = await call('GET', '/items/hotels', { tok: 'tok-admin' }); const calls0 = ghCalls; await call('GET', '/items/hotels', { tok: 'tok-admin' });
assert.ok(ghCalls - calls0 <= 2, 'listing N items costs one GraphQL request, not N');

console.log('content worker: all checks passed');
