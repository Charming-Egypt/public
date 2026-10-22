/**
 * Discover Sharm — content Worker (the only thing that talks to the private GitHub data repo)
 *
 * Hotels, excursions, transfers, restaurants and journal posts live as JSON files in a PRIVATE GitHub repo:
 *
 *   api/hotels/{id}.json        one file per item            { id, ownerId, published, ...the item }
 *   api/hotels/{id}.draft.json  an owner's pending edit of an item that is already published (until the super admin approves it)
 *   api/hotels/hotels.json      the PUBLIC index: { updatedAt, items: [ every PUBLISHED item ] }  — what the website reads
 *   api/hotels/img/{hash}.jpg   uploaded photos
 *   (same for excursions / transfers / restaurants / journal)
 *
 * The database keeps one row per item (id, owner, status, and the few price fields the booking RPC verifies). The browser never
 * sees the GitHub token: it only talks to this Worker, which holds GITHUB_TOKEN + SUPABASE_SERVICE_ROLE_KEY as secrets.
 *
 *   PUBLIC   GET  /catalog/hotels.json                       published items (edge-cached 60 s)
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

const CATS = {
  hotel:      { dir: 'hotels' },
  excursion:  { dir: 'excursions' },
  transfer:   { dir: 'transfers' },
  restaurant: { dir: 'restaurants' },
  journal:    { dir: 'journal' },
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
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...(extra || {}) });
const now = () => new Date().toISOString();

const utf8 = new TextEncoder(), unutf8 = new TextDecoder();
function toB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(b64) { const s = atob(b64.replace(/\s+/g, '')), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
const textToB64 = (t) => toB64(utf8.encode(t));

const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
const strip = (o, keys) => { const r = { ...o }; for (const k of keys) delete r[k]; return r; };

// ---- GitHub ---------------------------------------------------------------------------------------------------------------
function github(env) {
  const repo = String(env.GITHUB_REPO || '').trim(), branch = String(env.GITHUB_BRANCH || 'main').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !env.GITHUB_TOKEN) throw fail(500, 'github_not_configured');
  if (!/^[\w./-]+$/.test(branch)) throw fail(500, 'github_branch_invalid');
  const api = 'https://api.github.com';
  const H = (accept) => ({ Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: accept || 'application/vnd.github+json', 'User-Agent': 'discover-sharm-content-worker', 'X-GitHub-Api-Version': '2022-11-28' });
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const url = (p) => `${api}/repos/${repo}/contents/${enc(p)}`;
  const upstream = async (res, what) => { if (res.ok) return; const t = await res.text().catch(() => ''); throw fail(res.status === 401 || res.status === 403 ? 502 : res.status === 404 ? 404 : 502, `github_${what}_${res.status}`, { detail: t.slice(0, 200), upstream: res.status }); };

  return {
    /** → { sha, bytes } | null */
    async getFile(path) {
      const res = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}`, { headers: H() });
      if (res.status === 404) return null;
      await upstream(res, 'get');
      const j = await res.json();
      if (j.encoding === 'base64' && j.content) return { sha: j.sha, bytes: fromB64(j.content) };
      const raw = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}`, { headers: H('application/vnd.github.raw+json') });   // > 1 MB: the JSON form has no content
      await upstream(raw, 'raw');
      return { sha: j.sha, bytes: new Uint8Array(await raw.arrayBuffer()) };
    },
    async getJSON(path) { const f = await this.getFile(path); return f ? { sha: f.sha, json: JSON.parse(unutf8.decode(f.bytes)) } : null; },
    /** create or update; `sha` required when the file exists. Returns the new sha. 409/422 = somebody else changed it first. */
    async putFile(path, b64, sha, message) {
      const res = await fetch(url(path), { method: 'PUT', headers: { ...H(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: b64, branch, ...(sha ? { sha } : {}) }) });
      if (res.status === 409 || res.status === 422) throw fail(409, 'github_conflict');
      await upstream(res, 'put');
      return (await res.json()).content.sha;
    },
    async delFile(path, sha, message) {
      const res = await fetch(url(path), { method: 'DELETE', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sha, branch }) });
      if (res.status === 404) return;
      if (res.status === 409 || res.status === 422) throw fail(409, 'github_conflict');
      await upstream(res, 'del');
    },
    /** many text files in ONE request (GraphQL) → { path: text | null }. Paths come from validated ids only. */
    async readMany(paths) {
      const out = {};
      for (let i = 0; i < paths.length; i += 80) {
        const chunk = paths.slice(i, i + 80);
        const q = `query{repository(owner:${JSON.stringify(repo.split('/')[0])},name:${JSON.stringify(repo.split('/')[1])}){${chunk.map((p, n) => `o${n}:object(expression:${JSON.stringify(branch + ':' + p)}){...on Blob{text isTruncated}}`).join('')}}}`;
        const res = await fetch(`${api}/graphql`, { method: 'POST', headers: { ...H(), 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
        await upstream(res, 'graphql');
        const j = await res.json();
        const repoData = j.data && j.data.repository;
        if (!repoData) throw fail(502, 'github_graphql_failed', { detail: JSON.stringify(j.errors || j).slice(0, 200) });
        chunk.forEach((p, n) => { const o = repoData['o' + n]; out[p] = o && !o.isTruncated ? o.text : null; });
      }
      return out;
    },
    /** read-modify-write with retry when two staff members save at the same moment. fn(json|null) → json | undefined (= nothing to do) */
    async mutateJSON(path, fn, message) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const cur = await this.getJSON(path);
        const next = fn(cur ? cur.json : null);
        if (next === undefined) return cur ? cur.json : null;
        try { await this.putFile(path, textToB64(JSON.stringify(next, null, 1)), cur && cur.sha, message); return next; }
        catch (e) { if (e.message !== 'github_conflict' || attempt === 4) throw e; }
      }
    },
    async raw(path) {
      const res = await fetch(`${url(path)}?ref=${encodeURIComponent(branch)}`, { headers: H('application/vnd.github.raw+json') });
      return res;
    },
  };
}

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

async function uploadImage(gh, who, body, origin) {
  if (!who.isAdmin && !(who.isOwner && who.kinds.length)) throw fail(403, 'Not allowed');
  const kind = KIND_OF[String(body.cat || '')] || (who.kinds[0] || 'excursion');
  if (!who.isAdmin && !who.kinds.includes(kind)) throw fail(403, 'Not allowed');
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
  return { url: `${origin}/img/${CATS[kind].dir}/${name}` };
}

// ---- HTTP -----------------------------------------------------------------------------------------------------------------
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const edge = () => (typeof caches !== 'undefined' && caches.default) || null;

export default {
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
      if (req.method === 'GET' && seg[0] === 'catalog' && seg.length === 2) {
        const m = /^([a-z]+)\.json$/.exec(seg[1]), kind = m && KIND_OF[m[1]];
        if (!kind) throw fail(404, 'Unknown catalog');
        const cache = edge(), key = new Request(url.origin + url.pathname);
        const hit = cache && await cache.match(key); if (hit) return hit;
        const gh = github(env);
        let body;
        const f = await gh.getFile(indexPath(kind));
        if (f) body = unutf8.decode(f.bytes);
        else {   // no index file yet (first deploy / before the export): serve what the database has, so the site never goes blank
          const db = supabase(env);
          const rows = await db.rest('GET', `properties?kind=eq.${kind}&status=eq.published&select=id,data,created_at,sort_order,featured&order=sort_order.asc,created_at.asc&limit=1000`);
          body = JSON.stringify({ updatedAt: now(), fallback: true, items: rows.map(r => ({ ...r.data, id: r.id, featured: !!r.featured, sortOrder: r.sort_order, createdAt: r.created_at })) });
        }
        const res = new Response(body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', 'Access-Control-Allow-Origin': '*' } });
        if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }
      if (req.method === 'GET' && seg[0] === 'img' && seg.length === 3) {
        const kind = KIND_OF[seg[1]]; if (!kind || !/^[a-f0-9]{16}\.(jpg|png|webp)$/.test(seg[2])) throw fail(404, 'Not found');
        const cache = edge(), key = new Request(url.origin + url.pathname);
        const hit = cache && await cache.match(key); if (hit) return hit;
        const up = await github(env).raw(imgPath(kind, seg[2]));
        if (!up.ok) throw fail(404, 'Not found');
        const res = new Response(up.body, { status: 200, headers: { 'Content-Type': MIME[seg[2].split('.')[1]], 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' } });
        if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
        return res;
      }

      // ---------- staff ----------
      if (seg[0] !== 'items' && seg[0] !== 'upload') throw fail(404, 'Not found');
      if (!cors['Access-Control-Allow-Origin']) throw fail(403, 'Origin not allowed');
      const db = supabase(env), who = await db.whoami(req), gh = github(env);
      let body = {}; if (req.method === 'POST' || req.method === 'PUT') { const t = await req.text(); if (t.length > MAX_BODY * 4) throw fail(413, 'Too large'); try { body = t ? JSON.parse(t) : {}; } catch { throw fail(400, 'Invalid JSON'); } }

      if (seg[0] === 'upload' && req.method === 'POST') return json(await uploadImage(gh, who, body, url.origin));

      const kind = KIND_OF[seg[1] || ''];
      if (!kind) throw fail(404, 'Unknown category');
      const id = seg[2], action = seg[3];

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

export { CATS, RESERVED, PRICING_KEYS, assemble, sortItems, publicItem };
