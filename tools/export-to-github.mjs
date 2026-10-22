#!/usr/bin/env node
// One-time move of the existing catalog into the layout the content Worker uses (see workers/content-worker.js):
//
//   <out>/api/hotels/{id}.json  …/hotels.json (index of published)   — same for excursions, transfers, restaurants, journal
//   <out>/journal-seed.sql      one database row per existing journal post (id + owner + status only)
//
// Usage
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node tools/export-to-github.mjs [out-dir]
//   node tools/export-to-github.mjs [out-dir] --rows rows.json       (offline: rows = JSON array of `properties` rows, e.g. exported from the Supabase dashboard)
// Then copy <out>/api into the PRIVATE data repo, commit + push, and run journal-seed.sql in the Supabase SQL editor.
// Nothing is written to Supabase or GitHub by this script. Safe to re-run (it overwrites <out>).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = { hotel: 'hotels', excursion: 'excursions', transfer: 'transfers', restaurant: 'restaurants', journal: 'journal' };
const RESERVED = ['id', 'kind', 'ownerId', 'owner', 'published', 'status', 'createdAt', 'updatedAt', 'publishedAt', 'pendingEdit', 'sortOrder', 'featured', 'commissionRate'];
const args = process.argv.slice(2);
const rowsIdx = args.indexOf('--rows');
const rowsFile = rowsIdx >= 0 ? args.splice(rowsIdx, 2)[1] : '';
const out = path.resolve(args[0] || 'api-export');

const strip = (o, keys) => { const r = { ...o }; for (const k of keys) delete r[k]; return r; };
const sortItems = (items) => items.slice().sort((a, b) => (a.sortOrder ?? 1000) - (b.sortOrder ?? 1000) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
const sql = (v) => v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`;

async function loadRows() {
  if (rowsFile) return JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --rows rows.json).'); process.exit(1); }
  const all = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/properties?select=id,kind,owner_id,status,featured,sort_order,data,created_at,updated_at,published_at&order=created_at.asc`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` } });
    if (!r.ok) { console.error('Supabase said', r.status, await r.text()); process.exit(1); }
    const page = await r.json(); all.push(...page); if (page.length < 1000) break;
  }
  return all;
}

const rows = (await loadRows()).filter(r => DIRS[r.kind] && r.kind !== 'journal' && /^[A-Za-z0-9_-]{1,64}$/.test(r.id));
fs.rmSync(out, { recursive: true, force: true });
const put = (rel, obj) => { const f = path.join(out, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 1) + '\n'); };
const counts = {};

for (const kind of Object.keys(DIRS)) {
  const dir = `api/${DIRS[kind]}`;
  let items = [];
  if (kind === 'journal') {   // the static journal posts shipped with the site
    const arts = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/articles.json'), 'utf8'));
    items = arts.filter(a => /^[A-Za-z0-9_-]{1,64}$/.test(a.id)).map((a, i) => ({ ...strip(a, RESERVED), id: a.id, kind, ownerId: null, published: true, createdAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, updatedAt: new Date().toISOString(), publishedAt: new Date().toISOString(), sortOrder: (i + 1) * 10, featured: false }));
  } else {
    items = rows.filter(r => r.kind === kind).map(r => ({ ...strip(r.data || {}, RESERVED), id: r.id, kind, ownerId: r.owner_id || null, published: r.status === 'published',
      createdAt: r.created_at, updatedAt: r.updated_at || r.created_at, ...(r.published_at ? { publishedAt: r.published_at } : {}), sortOrder: r.sort_order ?? 1000, featured: !!r.featured }));
  }
  items.forEach(it => put(`${dir}/${it.id}.json`, it));
  const pub = items.filter(i => i.published).map(i => strip(i, ['ownerId', 'published', 'kind']));
  put(`${dir}/${DIRS[kind]}.json`, { updatedAt: new Date().toISOString(), items: sortItems(pub) });
  counts[kind] = `${items.length} items, ${pub.length} published`;
  if (kind === 'journal') {
    const lines = items.map(i => `insert into public.properties (id, kind, owner_id, status, sort_order, data) values (${sql(i.id)}, 'journal', null, 'published', ${i.sortOrder}, ${sql(JSON.stringify({ title: i.title }))}::jsonb) on conflict (id) do nothing;`);
    fs.writeFileSync(path.join(out, 'journal-seed.sql'), `-- one database row per journal post (the content lives in api/journal/{id}.json). Run AFTER migration 20261022001000_journal_kind.sql.\n${lines.join('\n')}\n`);
  }
}
console.log(`Exported to ${out}`); for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(10)} ${v}`);
console.log('Next: copy the api/ folder into the private data repo, commit + push, then run journal-seed.sql in Supabase.');
