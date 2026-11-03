/**
 * Discover Sharm — content Worker (the only thing that talks to the private GitHub data repo)
 *
 * Hotels, excursions, transfers, restaurants and journal posts live as JSON files in a PRIVATE GitHub repo:
 *
 *   api/hotels/{id}.json        one file per item            { id, ownerId, published, ...the item }
 *   api/hotels/{id}.draft.json  an owner's pending edit of an item that is already published (until the super admin approves it)
 *   api/hotels/hotels.json      the PUBLIC index: { updatedAt, items: [ every PUBLISHED item ] }  — what the website reads
 *   api/hotels/img/{hash}.jpg   uploaded photos
 *   (same for excursions / transfers / restaurants)
 *   journal + destinations: the same files, but GitHub ONLY (no database row, super admin only, no drafts: the admin edits them directly)
 *
 * The database keeps one row per item (id, owner, status, and the few price fields the booking RPC verifies). The browser never
 * sees the GitHub token: it only talks to this Worker, which holds GITHUB_TOKEN + SUPABASE_SERVICE_ROLE_KEY as secrets.
 *
 *   PUBLIC   GET  /catalog/hotels.json                       published items (edge-cached 60 s)
 *            GET  /catalog/bundle.json                       EVERYTHING the pages read on load in one response (all catalogs + live ratings + restaurant branches
 *                                                            + home testimonials). Edge-cached: served instantly, rebuilt in the background every ~2 min
 *                                                            (with the MEDIA bucket below, visitors read a static copy instead and never reach this Worker)
 *            GET  /reviews/{propertyId}.json                 published reviews of one item (edge-cached 2 min)
 *            GET  /img/hotels/{file}                         a photo from the repo
 *   STAFF    (Authorization: Bearer <Supabase access token>)
 *            GET  /items/{cat}            owner: my items · super admin: all
 *            GET  /items/{cat}/{id}
 *            POST /items/{cat}            create (published = false)       body: the item (+ admin only: owner, status, featured, sortOrder)
 *            PUT  /items/{cat}/{id}       edit  (owner + published item → saved as a draft; super admin → live)
 *            POST /items/{cat}/{id}/publish | /unpublish                   super admin only
 *            DELETE /items/{cat}/{id}     owner: hide (archive) · super admin: delete for good
 *            POST /upload                 body { image: "data:image/jpeg;base64,…", cat }
 *
 * {cat} is hotel|excursion|transfer|restaurant|journal (singular or plural, e.g. "hotels").
 * Order of writes matters (see publishItem): the database is changed FIRST on publish, so an item is never listed on the website
 * unless the booking code in the database already knows its price; on failure the database change is rolled back.
 */

// STATIC HOSTING (optional but recommended): bind an R2 bucket as MEDIA and set MEDIA_BASE to its public address (e.g. https://media.discover-sharm.com).
//   · photos are still committed to the private GitHub repo with GITHUB_TOKEN (the source of truth) AND copied to the bucket; the site loads them from MEDIA_BASE
//     (img/<category>/<hash>.jpg — immutable, a year in the browser), so photo views never touch this Worker
//   · the public catalog is published to MEDIA_BASE/catalog/bundle.json the moment staff change anything (and every 5 min for live ratings, see the cron
//     trigger), so an admin edit reaches visitors in seconds instead of minutes
//   · POST /media/sync (super admin) / the cron copy any photo that is in GitHub but not in the bucket yet (one-time backfill, automatic after that)
import { github, toB64, fromB64, textToB64, unutf8, fail } from './lib/github.js';

const CATS = {
  hotel:      { dir: 'hotels' },
  excursion:  { dir: 'excursions' },
  transfer:   { dir: 'transfers' },
  restaurant: { dir: 'restaurants' },
  // Site content that lives ONLY in the GitHub data repo: no database row at all, super admin only, saved as api/<dir>/{id}.json (+ the published index)
  journal:     { dir: 'journal', githubOnly: true },
  destination: { dir: 'destinations', githubOnly: true },
};
const KIND_OF = {};
for (const [k, v] of Object.entries(CATS)) { KIND_OF[k] = k; KIND_OF[v.dir] = k; }

// keys the Worker owns: never taken from a request body
const RESERVED = ['id', 'kind', 'ownerId', 'owner', 'published', 'status', 'createdAt', 'updatedAt', 'publishedAt', 'pendingEdit', 'sortOrder', 'featured', 'commissionRate'];
// the part of an item the booking RPC (compute_booking_price) and the review/admin queries read from the database
const PRICING_KEYS = ['name', 'title', 'vehicleType', 'category', 'price', 'rooms', 'unavailableDates'];
const MAX_BODY = 350_000, MAX_IMAGE = 900_000, ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ROOT = 'api';

// ---------------------------------------------------------------------------------------------------------------------------
const now = () => new Date().toISOString();

const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
const strip = (o, keys) => { const r = { ...o }; for (const k of keys) delete r[k]; return r; };

// ---- Supabase (service role: this Worker is trusted; the browser is not) --------------------------------------------------
function supabase(env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, ''), anon = String(env.SUPABASE_ANON_KEY || ''), svc = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!base || !anon || !svc || /YOUR-PROJECT|YOUR-ANON/i.test(base + anon)) throw fail(500, 'supabase_not_configured');
  const hs = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };
  const rest = async (method, path, body, prefer) => {
    const res = await fetch(`${base}/rest/v1/${path}`, { method, headers: { ...hs, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (!res.ok) {
      if (j && (j.details === 'limit_reached' || /limit reached/i.test(j.message || ''))) throw fail(409, j.message || 'Listing limit reached', { code: 'limit_reached' });
      throw fail(res.status === 404 ? 404 : 502, `db_${res.status}`, { detail: (j && (j.message || j.hint)) || text.slice(0, 200) });
    }
    return j;
  };
  return {
    rest,
    /** the signed-in caller: verified by Supabase Auth, role read from profiles */
    async whoami(req) {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (!token) throw fail(401, 'Authentication failed');
      const u = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      if (!u.ok) throw fail(401, 'Authentication failed');
      const user = await u.json();
      if (!user || !user.id) throw fail(401, 'Authentication failed');
      const rows = await rest('GET', `profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,is_active,owner_kinds,max_items`);
      const p = rows && rows[0];
      if (!p || !p.is_active) throw fail(403, 'Not allowed');
      return { id: p.id, isAdmin: p.role === 'super_admin', isOwner: p.role === 'owner', kinds: p.owner_kinds || [] };
    },
  };
}

// ---- helpers --------------------------------------------------------------------------------------------------------------
const filePath = (kind, id) => `${ROOT}/${CATS[kind].dir}/${id}.json`;
const draftPath = (kind, id) => `${ROOT}/${CATS[kind].dir}/${id}.draft.json`;
const indexPath = (kind) => `${ROOT}/${CATS[kind].dir}/${CATS[kind].dir}.json`;
const imgPath = (kind, name) => `${ROOT}/${CATS[kind].dir}/img/${name}`;

const publicItem = (f) => strip(f, ['ownerId', 'published', 'kind', 'pendingEdit']);
const sortItems = (items) => items.slice().sort((a, b) => (a.sortOrder ?? 1000) - (b.sortOrder ?? 1000) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
const pricingData = (c) => ({ ...pick(c, PRICING_KEYS) });

function cleanBody(body, isAdmin) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Invalid body');
  if (JSON.stringify(body).length > MAX_BODY) throw fail(413, 'Item too large');
  const c = strip(body, RESERVED);
  if (!isAdmin) delete c.rating;   // live ratings come from customer reviews, owners can't set them
  return c;
}
const adminMeta = (body) => ({
  owner: body.owner === undefined ? undefined : (body.owner || null),
  status: body.status,
  featured: typeof body.featured === 'boolean' ? body.featured : undefined,
  sortOrder: Number.isFinite(Number(body.sortOrder)) && body.sortOrder !== '' && body.sortOrder !== null ? Math.trunc(Number(body.sortOrder)) : undefined,
});
const STATUSES = ['draft', 'pending_review', 'published', 'archived'];

// ---- item operations ------------------------------------------------------------------------------------------------------
async function loadRow(db, kind, id) {
  if (!ID_RE.test(id || '')) throw fail(400, 'Invalid id');
  const rows = await db.rest('GET', `properties?id=eq.${encodeURIComponent(id)}&kind=eq.${kind}&select=id,kind,owner_id,status,featured,sort_order,has_draft,data,created_at,rating_avg,rating_count`);
  if (!rows || !rows[0]) throw fail(404, 'Not found');
  return rows[0];
}
function canEdit(who, row, kind) {
  if (who.isAdmin) return true;
  return who.isOwner && row.owner_id === who.id && who.kinds.includes(kind);
}
const requireAdmin = (who) => { if (!who.isAdmin) throw fail(403, 'Not allowed'); };

/** the item as stored (file) — legacy rows without a file fall back to the database copy so nothing disappears during the move */
async function readItem(gh, kind, row, wantDraft) {
  const paths = [filePath(kind, row.id)]; if (wantDraft && row.has_draft) paths.push(draftPath(kind, row.id));
  const got = await gh.readMany(paths);
  return assemble(kind, row, got[paths[0]], paths[1] ? got[paths[1]] : null);
}
function assemble(kind, row, mainText, draftText) {
  let file = null; try { file = mainText ? JSON.parse(mainText) : null; } catch { file = null; }
  let draft = null; try { draft = draftText ? JSON.parse(draftText) : null; } catch { draft = null; }
  const base = file || { ...(row.data || {}), id: row.id, ownerId: row.owner_id, published: row.status === 'published', createdAt: row.created_at };
  const content = draft ? { ...strip(draft, RESERVED) } : strip(base, RESERVED);
  return { file: base, hasDraft: !!draft, view: { ...content, id: row.id, status: row.status, ...(row.owner_id ? { owner: row.owner_id } : {}),
    ...(row.rating_count > 0 ? { rating: Number(row.rating_avg) } : {}), featured: !!row.featured, sortOrder: row.sort_order, ...(draft ? { pendingEdit: true } : {}) } };
}

async function listItems(gh, db, who, kind) {
  let q = `properties?kind=eq.${kind}&select=id,kind,owner_id,status,featured,sort_order,has_draft,data,created_at,rating_avg,rating_count&order=sort_order.asc,created_at.asc&limit=1000`;
  if (!who.isAdmin) {
    if (!who.isOwner || !who.kinds.includes(kind)) throw fail(403, 'Not allowed');
    q += `&owner_id=eq.${who.id}&status=neq.archived`;
  }
  const rows = await db.rest('GET', q);
  const paths = []; for (const r of rows) { paths.push(filePath(kind, r.id)); if (r.has_draft) paths.push(draftPath(kind, r.id)); }
  const got = paths.length ? await gh.readMany(paths) : {};
  return rows.map(r => assemble(kind, r, got[filePath(kind, r.id)], r.has_draft ? got[draftPath(kind, r.id)] : null).view);
}

/** write the live version: DB first (so booking knows the price), then the item file + index; roll the DB back if GitHub fails */
async function publishItem(gh, db, who, kind, row, content, extra = {}) {
  const t = now();
  const prev = { status: row.status, data: row.data, has_draft: row.has_draft };
  const meta = { featured: extra.featured ?? row.featured, sortOrder: extra.sortOrder ?? row.sort_order };
  await db.rest('PATCH', `properties?id=eq.${row.id}`, { status: 'published', data: pricingData(content), has_draft: false, featured: meta.featured, sort_order: meta.sortOrder, ...(extra.ownerId !== undefined ? { owner_id: extra.ownerId } : {}) });
  try {
    const ownerId = extra.ownerId !== undefined ? extra.ownerId : row.owner_id;
    const existing = await gh.getJSON(filePath(kind, row.id));
    const file = { ...strip(content, RESERVED), id: row.id, kind, ownerId: ownerId || null, published: true,
      createdAt: (existing && existing.json.createdAt) || row.created_at || t, updatedAt: t, publishedAt: t, sortOrder: meta.sortOrder, featured: !!meta.featured };
    await gh.putFile(filePath(kind, row.id), textToB64(JSON.stringify(file, null, 1)), existing && existing.sha, `${kind} ${row.id} published by ${who.id}`);
    await gh.mutateJSON(indexPath(kind), (idx) => {
      const items = ((idx && idx.items) || []).filter(i => i.id !== row.id); items.push(publicItem(file));
      return { updatedAt: t, items: sortItems(items) };
    }, `${kind} ${row.id}: index (publish)`);
    if (row.has_draft) { const d = await gh.getFile(draftPath(kind, row.id)); if (d) await gh.delFile(draftPath(kind, row.id), d.sha, `${kind} ${row.id}: draft merged`); }
    return file;
  } catch (e) {
    await db.rest('PATCH', `properties?id=eq.${row.id}`, prev).catch(() => {});   // the item stays exactly as it was
    throw e;
  }
}

async function unpublishItem(gh, db, who, kind, row, status) {
  const t = now();
  await db.rest('PATCH', `properties?id=eq.${row.id}`, { status });   // DB first: stop selling it, then remove it from the site
  const f = await gh.getJSON(filePath(kind, row.id));
  if (f) await gh.putFile(filePath(kind, row.id), textToB64(JSON.stringify({ ...f.json, published: false, updatedAt: t }, null, 1)), f.sha, `${kind} ${row.id} → ${status} by ${who.id}`);
  await gh.mutateJSON(indexPath(kind), (idx) => {
    if (!idx || !(idx.items || []).some(i => i.id === row.id)) return undefined;
    return { updatedAt: t, items: idx.items.filter(i => i.id !== row.id) };
  }, `${kind} ${row.id}: index (unpublish)`);
}

async function createItem(gh, db, who, kind, body) {
  if (!who.isAdmin && !(who.isOwner && who.kinds.includes(kind))) throw fail(403, 'Not allowed');
  const content = cleanBody(body, who.isAdmin), meta = who.isAdmin ? adminMeta(body) : {};
  if (meta.status !== undefined && !STATUSES.includes(meta.status)) throw fail(400, 'Invalid status');
  const t = now();
  // admin-created rows are inserted without an owner first: the per-owner listing cap is for owners, not for the super admin
  const ownerId = who.isAdmin ? null : who.id;
  const [row] = await db.rest('POST', 'properties', { kind, owner_id: ownerId, status: who.isAdmin ? 'draft' : 'pending_review', data: pricingData(content) }, 'return=representation');
  try {
    const owner = who.isAdmin ? (meta.owner || null) : who.id;
    if (who.isAdmin && owner) await db.rest('PATCH', `properties?id=eq.${row.id}`, { owner_id: owner });
    const file = { ...content, id: row.id, kind, ownerId: owner, published: false, createdAt: t, updatedAt: t, sortOrder: meta.sortOrder ?? row.sort_order, featured: !!meta.featured };
    await gh.putFile(filePath(kind, row.id), textToB64(JSON.stringify(file, null, 1)), null, `${kind} ${row.id} created by ${who.id}`);
    if (meta.featured !== undefined || meta.sortOrder !== undefined) await db.rest('PATCH', `properties?id=eq.${row.id}`, { ...(meta.featured !== undefined ? { featured: meta.featured } : {}), ...(meta.sortOrder !== undefined ? { sort_order: meta.sortOrder } : {}) });
    const fresh = { ...row, owner_id: owner, status: 'draft', has_draft: false, featured: !!meta.featured, sort_order: meta.sortOrder ?? row.sort_order };
    if (who.isAdmin && meta.status === 'published') await publishItem(gh, db, who, kind, fresh, content);
    else if (who.isAdmin && meta.status && meta.status !== 'draft') await db.rest('PATCH', `properties?id=eq.${row.id}`, { status: meta.status });
  } catch (e) {
    await db.rest('DELETE', `properties?id=eq.${row.id}`).catch(() => {});   // no half-created item
    const f = await gh.getFile(filePath(kind, row.id)).catch(() => null);
    if (f) await gh.delFile(filePath(kind, row.id), f.sha, `${kind} ${row.id}: rolled back`).catch(() => {});
    throw e;
  }
  return row.id;
}

async function updateItem(gh, db, who, kind, id, body) {
  const row = await loadRow(db, kind, id);
  if (!canEdit(who, row, kind)) throw fail(403, 'Not allowed');
  const content = cleanBody(body, who.isAdmin), meta = who.isAdmin ? adminMeta(body) : {};
  if (meta.status !== undefined && !STATUSES.includes(meta.status)) throw fail(400, 'Invalid status');
  const t = now();

  // owner editing something already on the website → a draft; the live copy (and the price the DB checks) stay as they are
  if (!who.isAdmin && row.status === 'published') {
    const draft = { ...content, id, kind, ownerId: row.owner_id, published: false, updatedAt: t };
    const ex = await gh.getFile(draftPath(kind, id));
    await gh.putFile(draftPath(kind, id), textToB64(JSON.stringify(draft, null, 1)), ex && ex.sha, `${kind} ${id} edit proposed by ${who.id}`);
    await db.rest('PATCH', `properties?id=eq.${id}`, { has_draft: true });
    return { pendingReview: true };
  }

  const ownerChange = who.isAdmin && meta.owner !== undefined ? meta.owner : undefined;
  const target = meta.status || row.status;
  if (target === 'published') {
    await publishItem(gh, db, who, kind, row, content, { featured: meta.featured, sortOrder: meta.sortOrder, ownerId: ownerChange });
    return { published: true };
  }
  // not (going to be) live: just save the file + keep the DB copy of name/price in step
  const existing = await gh.getJSON(filePath(kind, id));
  const ownerId = ownerChange !== undefined ? ownerChange : row.owner_id;
  const file = { ...content, id, kind, ownerId: ownerId || null, published: false, createdAt: (existing && existing.json.createdAt) || row.created_at || t, updatedAt: t,
    sortOrder: meta.sortOrder ?? row.sort_order, featured: meta.featured ?? !!row.featured };
  await gh.putFile(filePath(kind, id), textToB64(JSON.stringify(file, null, 1)), existing && existing.sha, `${kind} ${id} edited by ${who.id}`);
  const patch = { data: pricingData(content) };
  if (ownerChange !== undefined) patch.owner_id = ownerChange;
  if (meta.featured !== undefined) patch.featured = meta.featured;
  if (meta.sortOrder !== undefined) patch.sort_order = meta.sortOrder;
  if (meta.status && meta.status !== row.status) patch.status = meta.status;
  if (row.has_draft) { patch.has_draft = false; const d = await gh.getFile(draftPath(kind, id)); if (d) await gh.delFile(draftPath(kind, id), d.sha, `${kind} ${id}: draft superseded`); }
  if (row.status === 'published') await unpublishItem(gh, db, who, kind, row, meta.status || 'draft');   // admin moved a live item back to draft/review/archived
  await db.rest('PATCH', `properties?id=eq.${id}`, patch);
  return { saved: true };
}

async function deleteItem(gh, db, who, kind, id) {
  const row = await loadRow(db, kind, id);
  if (!canEdit(who, row, kind)) throw fail(403, 'Not allowed');
  if (!who.isAdmin) {   // owners hide (archive) — bookings and history stay
    if (row.status === 'published') await unpublishItem(gh, db, who, kind, row, 'archived'); else await db.rest('PATCH', `properties?id=eq.${id}`, { status: 'archived' });
    const d = row.has_draft && await gh.getFile(draftPath(kind, id)); if (d) await gh.delFile(draftPath(kind, id), d.sha, `${kind} ${id}: draft removed`);
    await db.rest('PATCH', `properties?id=eq.${id}`, { has_draft: false });
    return;
  }
  if (row.status === 'published') await unpublishItem(gh, db, who, kind, row, 'archived');
  for (const p of [filePath(kind, id), draftPath(kind, id)]) { const f = await gh.getFile(p); if (f) await gh.delFile(p, f.sha, `${kind} ${id} deleted by ${who.id}`); }
  await db.rest('DELETE', `properties?id=eq.${id}`);
}

// ---- GitHub-only content (journal, destinations): super admin only, nothing in the database -------------------------------
const newId = () => { const b = crypto.getRandomValues(new Uint8Array(9)); return [...b].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 12); };
const GH_STATUS = ['draft', 'published'];
const staticView = (f) => ({ ...strip(f, RESERVED), id: f.id, status: f.published ? 'published' : 'draft', sortOrder: f.sortOrder ?? 1000 });

async function staticList(gh, kind) {
  const dir = CATS[kind].dir;
  const names = (await gh.listDir(`${ROOT}/${dir}`)).map(f => f.name)
    .filter(n => /^[A-Za-z0-9_-]{1,64}\.json$/.test(n) && !n.endsWith('.draft.json') && n !== `${dir}.json`).map(n => n.slice(0, -5));
  const paths = names.map(id => filePath(kind, id)), got = paths.length ? await gh.readMany(paths) : {};
  const items = [];
  for (const id of names) { try { const f = JSON.parse(got[filePath(kind, id)]); if (f && f.id === id) items.push(f); } catch { /* unreadable file: skipped */ } }
  return sortItems(items).map(staticView);
}
async function staticPublish(gh, who, kind, id, published) {
  const t = now(), cur = await gh.getJSON(filePath(kind, id));
  if (!cur) throw fail(404, 'Not found');
  const file = { ...cur.json, published, updatedAt: t, ...(published ? { publishedAt: t } : {}) };
  await gh.putFile(filePath(kind, id), textToB64(JSON.stringify(file, null, 1)), cur.sha, `${kind} ${id} ${published ? 'published' : 'unpublished'} by ${who.id}`);
  await gh.mutateJSON(indexPath(kind), (idx) => {
    const items = ((idx && idx.items) || []).filter(i => i.id !== id);
    if (!published && items.length === ((idx && idx.items) || []).length) return undefined;   // wasn't listed: nothing to do
    if (published) items.push(publicItem(file));
    return { updatedAt: t, items: sortItems(items) };
  }, `${kind} ${id}: index (${published ? 'publish' : 'unpublish'})`);
  return file;
}
async function staticHandle(gh, who, kind, method, id, action, body) {
  if (!who.isAdmin) throw fail(403, 'Not allowed');   // journal + destinations belong to the super admin only
  if (!id) {
    if (method === 'GET') return { items: await staticList(gh, kind) };
    if (method === 'POST') {
      const content = cleanBody(body, true), meta = adminMeta(body);
      if (meta.status !== undefined && !GH_STATUS.includes(meta.status)) throw fail(400, 'Invalid status');
      const nid = newId(), t = now();
      const file = { ...content, id: nid, kind, published: false, createdAt: t, updatedAt: t, sortOrder: meta.sortOrder ?? 1000 };
      await gh.putFile(filePath(kind, nid), textToB64(JSON.stringify(file, null, 1)), null, `${kind} ${nid} created by ${who.id}`);
      const done = meta.status === 'published' ? await staticPublish(gh, who, kind, nid, true) : file;
      return { success: true, item: staticView(done) };
    }
    throw fail(404, 'Not found');
  }
  if (!ID_RE.test(id) || id === CATS[kind].dir) throw fail(400, 'Invalid id');
  if (!action && method === 'GET') { const f = await gh.getJSON(filePath(kind, id)); if (!f) throw fail(404, 'Not found'); return { item: staticView(f.json) }; }
  if (!action && method === 'PUT') {
    const content = cleanBody(body, true), meta = adminMeta(body);
    if (meta.status !== undefined && !GH_STATUS.includes(meta.status)) throw fail(400, 'Invalid status');
    const cur = await gh.getJSON(filePath(kind, id)); if (!cur) throw fail(404, 'Not found');
    const t = now(), want = meta.status ? meta.status === 'published' : !!cur.json.published;
    const file = { ...content, id, kind, published: !!cur.json.published, createdAt: cur.json.createdAt || t, updatedAt: t, ...(cur.json.publishedAt ? { publishedAt: cur.json.publishedAt } : {}), sortOrder: meta.sortOrder ?? cur.json.sortOrder ?? 1000 };
    await gh.putFile(filePath(kind, id), textToB64(JSON.stringify(file, null, 1)), cur.sha, `${kind} ${id} edited by ${who.id}`);
    if (want) await staticPublish(gh, who, kind, id, true);        // live copy follows every save of a published item (re-publish refreshes the index entry)
    else if (cur.json.published) await staticPublish(gh, who, kind, id, false);
    return { success: true, ...(want ? { published: true } : { saved: true }) };
  }
  if (!action && method === 'DELETE') {
    await staticPublish(gh, who, kind, id, false).catch(e => { if (e.status !== 404) throw e; });
    const f = await gh.getFile(filePath(kind, id)); if (f) await gh.delFile(filePath(kind, id), f.sha, `${kind} ${id} deleted by ${who.id}`);
    return { success: true };
  }
  if ((action === 'publish' || action === 'unpublish') && method === 'POST') { await staticPublish(gh, who, kind, id, action === 'publish'); return { success: true }; }
  throw fail(404, 'Not found');
}

async function uploadImage(gh, who, body, origin, env) {
  if (!who.isAdmin && !(who.isOwner && who.kinds.length)) throw fail(403, 'Not allowed');
  const kind = KIND_OF[String(body.cat || '')] || (who.kinds[0] || 'excursion');
  if (!who.isAdmin && (CATS[kind].githubOnly || !who.kinds.includes(kind))) throw fail(403, 'Not allowed');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(body.image || ''));
  if (!m) throw fail(400, 'Only JPEG, PNG or WebP images');
  const bytes = fromB64(m[2]);
  if (bytes.length > MAX_IMAGE) throw fail(413, 'Image too large (max 900 KB — the console compresses before upload)');
  const sig = (...b) => b.every((x, i) => bytes[i] === x);
  const ok = m[1] === 'image/jpeg' ? sig(0xFF, 0xD8, 0xFF) : m[1] === 'image/png' ? sig(0x89, 0x50, 0x4E, 0x47) : (sig(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45);
  if (!ok) throw fail(400, 'File content does not match its type');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  const name = `${hash}.${m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg'}`;
  try { await gh.putFile(imgPath(kind, name), toB64(bytes), null, `image ${name} uploaded by ${who.id}`); }
  catch (e) { if (e.message !== 'github_conflict') throw e; }   // same bytes uploaded before: the file is already there
  if (env && hasMedia(env)) {   // static copy: the site reads the photo from there, no Worker involved
    try {
      await env.MEDIA.put(`img/${CATS[kind].dir}/${name}`, bytes, { httpMetadata: { contentType: m[1], cacheControl: IMG_CACHE } });
      return { url: `${mediaBase(env)}/img/${CATS[kind].dir}/${name}` };
    } catch (e) { console.error('media_put_failed', e.message); }   // GitHub has it; the Worker address keeps working
  }
  return { url: `${origin}/img/${CATS[kind].dir}/${name}` };
}

// ---- HTTP -----------------------------------------------------------------------------------------------------------------
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const edge = () => (typeof caches !== 'undefined' && caches.default) || null;

// ---- static media hosting (R2) ----------------------------------------------------------------------------------------------
const MIME_BY_EXT = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const IMG_CACHE = 'public, max-age=31536000, immutable';
const IMG_DIRS = ['hotels', 'excursions', 'transfers', 'restaurants', 'journal', 'destinations'];
const IMG_NAME_RE = /^[a-f0-9]{16}\.(?:jpg|png|webp)$/;
const MEDIA_URL_RE = /https?:\/\/[^"\\\s]*?\/img\/((?:hotels|excursions|transfers|restaurants|journal|destinations)\/[a-f0-9]{16}\.(?:jpg|png|webp))/g;
const mediaBase = (env) => String(env.MEDIA_BASE || '').trim().replace(/\/+$/, '');
const hasMedia = (env) => !!(env.MEDIA && mediaBase(env));
// photos saved by the console carry this Worker's address; the published catalog points at the static host instead
// …but only for photos that really are in the bucket (`present`), so a photo that has not been copied yet never shows as broken
const toStaticUrls = (text, env, present) => (hasMedia(env) ? text.replace(MEDIA_URL_RE, (m, p) => (present && present.has(p) ? `${mediaBase(env)}/img/${p}` : m)) : text);
async function mediaPresent(env) {
  const have = new Set(); let cursor;
  do { const l = await env.MEDIA.list({ prefix: 'img/', cursor }); l.objects.forEach(o => have.add(o.key.slice(4))); cursor = l.truncated ? l.cursor : undefined; } while (cursor);
  return have;
}
const sha16 = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');

// the bundle as text + a fingerprint of its content (not of the build time): unchanged content is never re-published
async function bundleBody(env) {
  const obj = await buildBundle(env), present = hasMedia(env) ? await mediaPresent(env) : null;
  return { body: toStaticUrls(JSON.stringify(obj), env, present), h: await sha16(toStaticUrls(JSON.stringify({ ...obj, builtAt: '' }), env, present)) };
}
// Version pointer: catalog/version.json = { v: <content hash> }. The sites read it (a few bytes, rechecked every few seconds) and then ask for
// catalog/bundle.json?v=<hash>. A Cloudflare Cache Rule keeps every ?v= URL at the edge for a year, and a changed catalog is a NEW url, so the CDN
// never serves old data and never needs a purge. The bundle is always written BEFORE the pointer, so a pointer never names content that is not there yet.
async function putVersion(env, h) {
  const head = await env.MEDIA.head('catalog/version.json');
  if (head && head.customMetadata && head.customMetadata.v === h) return false;
  await env.MEDIA.put('catalog/version.json', JSON.stringify({ v: h }), { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=5' }, customMetadata: { v: h } });
  return true;
}
async function putBundle(env, body, h, force) {
  const head = await env.MEDIA.head('catalog/bundle.json');
  if (!force && head && head.customMetadata && head.customMetadata.h === h) { await putVersion(env, h); return { changed: false }; }   // (also heals a missing pointer)
  await env.MEDIA.put('catalog/bundle.json', body, { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=5' }, customMetadata: { h } });
  await putVersion(env, h);
  return { changed: true };
}
async function publishBundle(env, force) {
  if (!hasMedia(env)) return { skipped: 'no_media' };
  const { body, h } = await bundleBody(env);
  return putBundle(env, body, h, force);
}

// copy photos that are in the private GitHub repo but not in the bucket yet (at most `limit` per call; { copied, remaining })
async function syncMedia(env, limit = 40) {
  if (!hasMedia(env)) return { copied: 0, remaining: 0, skipped: 'no_media' };
  const gh = github(env); let copied = 0, remaining = 0;
  for (const dir of IMG_DIRS) {
    const names = (await gh.listDir(`${ROOT}/${dir}/img`)).map(f => f.name).filter(n => IMG_NAME_RE.test(n));
    if (!names.length) continue;
    const have = new Set(), prefix = `img/${dir}/`; let cursor;
    do { const l = await env.MEDIA.list({ prefix, cursor }); l.objects.forEach(o => have.add(o.key.slice(prefix.length))); cursor = l.truncated ? l.cursor : undefined; } while (cursor);
    for (const n of names) {
      if (have.has(n)) continue;
      if (copied >= limit) { remaining++; continue; }
      const up = await gh.raw(`${ROOT}/${dir}/img/${n}`);
      if (!up.ok) continue;
      await env.MEDIA.put(prefix + n, await up.arrayBuffer(), { httpMetadata: { contentType: MIME_BY_EXT[n.split('.')[1]], cacheControl: IMG_CACHE } });
      copied++;
    }
  }
  return { copied, remaining };
}

// ---- public catalog (read side) -----------------------------------------------------------------------------------------------
// published items of one category, as the website lists them
async function loadCatalog(env, kind) {
  const f = await github(env).getFile(indexPath(kind));
  if (f) return JSON.parse(unutf8.decode(f.bytes));
  if (CATS[kind].githubOnly) return { updatedAt: now(), fallback: true, items: [] };   // nothing exported yet: the site falls back to its bundled static file
  // no index file yet (first deploy / before the export): serve what the database has, so the site never goes blank
  const rows = await supabase(env).rest('GET', `properties?kind=eq.${kind}&status=eq.published&select=id,data,created_at,sort_order,featured&order=sort_order.asc,created_at.asc&limit=1000`);
  return { updatedAt: now(), fallback: true, items: rows.map(r => ({ ...r.data, id: r.id, featured: !!r.featured, sortOrder: r.sort_order, createdAt: r.created_at })) };
}

// How long a built bundle is served without anyone rebuilding it / how long an old one may still be served while a new one is built.
const BUNDLE_FRESH_S = 120, BUNDLE_KEEP_S = 6 * 3600, BUNDLE_BROWSER_S = 60, REVIEWS_TTL = 120;

// everything the pages read on load, in the exact shapes the front end keeps in CATALOG_RAW (null = "use the bundled static file")
async function buildBundle(env) {
  const db = supabase(env);
  const [hotels, excursions, transfers, restaurants, destinations, journal, meta, branchRows, reviewRows] = await Promise.all([
    loadCatalog(env, 'hotel'), loadCatalog(env, 'excursion'), loadCatalog(env, 'transfer'), loadCatalog(env, 'restaurant'),
    loadCatalog(env, 'destination'), loadCatalog(env, 'journal'),
    // live star averages (only items that have reviews)
    db.rest('GET', 'properties?status=eq.published&rating_count=gt.0&select=id,rating_avg,rating_count&limit=5000').catch(() => []),
    // only branches the super admin approved are public
    db.rest('GET', 'restaurant_branches?status=eq.approved&select=id,property_id,data&order=sort_order.asc,created_at.asc&limit=3000').catch(() => []),
    // home-page testimonials: real customer reviews, 4 stars and up, with a written comment
    db.rest('GET', 'reviews?status=eq.published&rating=gte.4&comment=not.is.null&properties.status=eq.published&select=id,name,rating,comment,created_at,properties!inner(name,kind,status)&order=created_at.desc&limit=40').catch(() => []),
  ]);
  const rated = new Map((meta || []).map(x => [x.id, x]));
  const branches = {};
  (branchRows || []).forEach(b => { (branches[b.property_id] = branches[b.property_id] || []).push({ ...b.data, id: b.id }); });
  const withLive = (cat, isRest) => (cat.items || []).map(item => {
    const it = { ...item }, m = rated.get(it.id);
    if (m && m.rating_count > 0) { it.rating = Number(m.rating_avg); it.reviews = m.rating_count; }   // live numbers beat the seeded ones
    if (isRest) it.branches = branches[it.id] || [];
    return it;
  });
  const real = (reviewRows || []).filter(r => String(r.comment || '').trim().length >= 25).slice(0, 20)
    .map(r => ({ id: r.id, name: String(r.name || '').trim() || 'Guest', rating: r.rating, text: String(r.comment).trim(), itemName: (r.properties && r.properties.name) || '', section: r.properties && r.properties.kind }));
  const own = (cat) => (cat.fallback && !(cat.items || []).length) ? null : (cat.items || []);
  return {
    v: 1, builtAt: now(),
    hotels: withLive(hotels), excursions: withLive(excursions), transfers: withLive(transfers), restaurants: withLive(restaurants, true),
    destinations: own(destinations), articles: own(journal), reviews: real.length ? real : null,
  };
}

let bundleRefreshing = false;   // one background rebuild at a time in this isolate (no pile-up of rebuilds while the first is running)
async function serveBundle(req, env, ctx) {
  const cache = edge(), key = new Request(new URL(req.url).origin + '/catalog/bundle.json');
  const toClient = (res, stale) => {   // what the browser may keep: short, so edits show up quickly; the long copy stays at the edge
    const h = new Headers(res.headers);
    h.set('Cache-Control', `public, max-age=${BUNDLE_BROWSER_S}, stale-while-revalidate=${BUNDLE_FRESH_S * 2}`);
    h.set('Access-Control-Allow-Origin', '*'); h.set('X-Bundle', stale ? 'stale' : 'fresh');
    return new Response(res.body, { status: res.status, headers: h });
  };
  const build = async () => {
    const { body, h } = await bundleBody(env);
    if (hasMedia(env) && ctx && ctx.waitUntil) ctx.waitUntil(putBundle(env, body, h).catch(e => console.error('publish', e.message)));   // first request after a deploy also fills the static copy
    const stored = new Response(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${BUNDLE_KEEP_S}, s-maxage=${BUNDLE_KEEP_S}`, 'X-Built-At': String(Date.now()) } });
    if (cache) await cache.put(key, stored.clone());
    return stored;
  };
  const hit = cache && await cache.match(key);
  if (hit) {
    const age = (Date.now() - Number(hit.headers.get('X-Built-At') || 0)) / 1000;
    const stale = age > BUNDLE_FRESH_S;
    if (stale && !bundleRefreshing && ctx && ctx.waitUntil) {   // serve the copy we have right now, rebuild behind the scenes
      bundleRefreshing = true;
      ctx.waitUntil(build().catch(() => {}).finally(() => { bundleRefreshing = false; }));
    }
    return toClient(hit, stale);
  }
  return toClient(await build(), false);   // very first request at this location (or the copy expired): build once
}

const core = {
  async fetch(req, env, ctx) {
    const norm = (o) => String(o || '').trim().replace(/\/+$/, '').toLowerCase();
    const originHdr = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(norm).filter(Boolean);
    if (!allowed.length) allowed.push('https://www.discover-sharm.com', 'https://app.discover-sharm.com', 'https://admin.discover-sharm.com');
    const cors = allowed.includes(norm(originHdr))
      ? { 'Access-Control-Allow-Origin': originHdr.trim().replace(/\/+$/, ''), Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' }
      : { Vary: 'Origin' };
    const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...h } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url), seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (seg[0] === 'health') return json({ ok: true });

      // ---------- public: catalog + photos (any origin may read; they are public by nature) ----------
      // ONE request for the whole public catalog (what every page needs on load): items from GitHub + live ratings, restaurant branches and
      // home-page testimonials from the database, merged here, kept at the edge. Visitors never touch GitHub or the database.
      if (req.method === 'GET' && seg[0] === 'catalog' && seg.length === 2 && seg[1] === 'bundle.json') return await serveBundle(req, env, ctx);

      // reviews of one item: edge-cached, so a visitor comparing items does not hit the database for each one
      if (req.method === 'GET' && seg[0] === 'reviews' && seg.length === 2) {
        const m = /^([A-Za-z0-9_-]{1,64})\.json$/.exec(seg[1]); if (!m) throw fail(404, 'Not found');
        const cache = edge(), key = new Request(url.origin + url.pathname);
        const hit = cache && await cache.match(key); if (hit) return hit;
        const rows = await supabase(env).rest('GET', `reviews?property_id=eq.${m[1]}&status=eq.published&select=id,name,rating,comment,photo_url,images,owner_reply,created_at&order=created_at.desc&limit=50`);
        const res = new Response(JSON.stringify({ reviews: rows || [] }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${REVIEWS_TTL}, s-maxage=${REVIEWS_TTL}`, 'Access-Control-Allow-Origin': '*' } });
        if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }

      if (req.method === 'GET' && seg[0] === 'catalog' && seg.length === 2) {
        const m = /^([a-z]+)\.json$/.exec(seg[1]), kind = m && KIND_OF[m[1]];
        if (!kind) throw fail(404, 'Unknown catalog');
        const cache = edge(), key = new Request(url.origin + url.pathname);
        const hit = cache && await cache.match(key); if (hit) return hit;
        const body = JSON.stringify(await loadCatalog(env, kind));
        const res = new Response(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', 'Access-Control-Allow-Origin': '*' } });
        if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }
      if (req.method === 'GET' && seg[0] === 'img' && seg.length === 3) {
        const kind = KIND_OF[seg[1]]; if (!kind || !/^[a-f0-9]{16}\.(jpg|png|webp)$/.test(seg[2])) throw fail(404, 'Not found');
        const cache = edge(), key = new Request(url.origin + url.pathname);
        const hit = cache && await cache.match(key); if (hit) return hit;
        const imgHeaders = { 'Content-Type': MIME[seg[2].split('.')[1]], 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' };
        const rkey = `img/${CATS[kind].dir}/${seg[2]}`;
        let res;
        const stored = hasMedia(env) ? await env.MEDIA.get(rkey) : null;
        if (stored) res = new Response(stored.body, { status: 200, headers: imgHeaders });
        else {
          const up = await github(env).raw(imgPath(kind, seg[2]));
          if (!up.ok) throw fail(404, 'Not found');
          if (hasMedia(env)) {   // first time this photo is asked for through the Worker: keep a static copy for next time
            const buf = await up.arrayBuffer();
            if (ctx && ctx.waitUntil) ctx.waitUntil(env.MEDIA.put(rkey, buf, { httpMetadata: { contentType: imgHeaders['Content-Type'], cacheControl: IMG_CACHE } }).catch(() => {}));
            res = new Response(buf, { status: 200, headers: imgHeaders });
          } else res = new Response(up.body, { status: 200, headers: imgHeaders });
        }
        if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }

      // ---------- staff ----------
      if (seg[0] !== 'items' && seg[0] !== 'upload' && seg[0] !== 'media') throw fail(404, 'Not found');
      if (!cors['Access-Control-Allow-Origin']) throw fail(403, 'Origin not allowed');
      const db = supabase(env), who = await db.whoami(req), gh = github(env);
      let body = {}; if (req.method === 'POST' || req.method === 'PUT') { const t = await req.text(); if (t.length > MAX_BODY * 4) throw fail(413, 'Too large'); try { body = t ? JSON.parse(t) : {}; } catch { throw fail(400, 'Invalid JSON'); } }

      if (seg[0] === 'media' && seg[1] === 'sync' && req.method === 'POST') { requireAdmin(who); return json(await syncMedia(env, 100)); }
      if (seg[0] === 'upload' && req.method === 'POST') return json(await uploadImage(gh, who, body, url.origin, env));

      const kind = KIND_OF[seg[1] || ''];
      if (!kind) throw fail(404, 'Unknown category');
      const id = seg[2], action = seg[3];
      if (CATS[kind].githubOnly) return json(await staticHandle(gh, who, kind, req.method, id, action, body));

      if (!id && req.method === 'GET') return json({ items: await listItems(gh, db, who, kind) });
      if (!id && req.method === 'POST') { const nid = await createItem(gh, db, who, kind, body); const row = await loadRow(db, kind, nid); return json({ success: true, item: (await readItem(gh, kind, row, true)).view }); }
      if (id && !action && req.method === 'GET') { const row = await loadRow(db, kind, id); if (!canEdit(who, row, kind)) throw fail(403, 'Not allowed'); return json({ item: (await readItem(gh, kind, row, true)).view }); }
      if (id && !action && req.method === 'PUT') return json({ success: true, ...(await updateItem(gh, db, who, kind, id, body)) });
      if (id && !action && req.method === 'DELETE') { await deleteItem(gh, db, who, kind, id); return json({ success: true }); }
      if (id && action === 'publish' && req.method === 'POST') {
        requireAdmin(who); const row = await loadRow(db, kind, id);
        const { file, hasDraft } = await readItem(gh, kind, row, true).then(r => ({ file: r.view, hasDraft: r.hasDraft }));
        await publishItem(gh, db, who, kind, row, strip(file, ['status', 'owner', 'rating', 'pendingEdit', 'featured']));
        return json({ success: true, mergedDraft: hasDraft });
      }
      if (id && action === 'unpublish' && req.method === 'POST') { requireAdmin(who); const row = await loadRow(db, kind, id); await unpublishItem(gh, db, who, kind, row, STATUSES.includes(body.status) && body.status !== 'published' ? body.status : 'draft'); return json({ success: true }); }
      throw fail(404, 'Not found');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('content-worker', e.message, e.detail || '');
      return json({ error: e.message || 'Server error', ...(e.code ? { code: e.code } : {}) }, status);
    }
  },
};

export default {
  async fetch(req, env, ctx) {
    const res = await core.fetch(req, env, ctx);
    // staff changed something: make visitors see it now (static copy rebuilt at once; this location's cached copy dropped)
    if (req.method !== 'GET' && req.method !== 'OPTIONS' && res.status < 300 && ctx && ctx.waitUntil) {
      const u = new URL(req.url);
      if (u.pathname.startsWith('/items/')) {
        const c = edge(); if (c) ctx.waitUntil(c.delete(new Request(u.origin + '/catalog/bundle.json')).catch(() => {}));
        if (hasMedia(env)) ctx.waitUntil(publishBundle(env).catch(e => console.error('publish', e.message)));
      }
    }
    return res;
  },
  // cron (wrangler.content.toml): refresh the static catalog (live ratings change without any staff edit) and copy photos not in the bucket yet
  async scheduled(_event, env, ctx) {
    if (!hasMedia(env)) return;
    ctx.waitUntil((async () => {
      try { await publishBundle(env); } catch (e) { console.error('cron publish', e.message); }
      try { await syncMedia(env, 40); } catch (e) { console.error('cron sync', e.message); }
    })());
  },
};

export { CATS, RESERVED, PRICING_KEYS, assemble, sortItems, publicItem };
