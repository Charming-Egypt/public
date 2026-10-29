// Ready-made photo library ("stock") that owners and admins pick from before uploading anything new.
//
//   shared/stock/<section>/[<album>/]<photo>.<jpg|png|webp>
//   sections: general (usable everywhere) · hotels · excursions · transfers · restaurants · destinations · journal
//   albums:   optional ONE level of sub-folders inside a section, e.g. excursions/diving/ , hotels/pools/
//   optional  shared/stock/<section>/meta.json  →  { "<file or album/file>": { "ar": "…", "en": "…", "tags": ["…"] } }   (Arabic/English title + search words)
//
// The build copies the photos to <site>/stock/ and writes <site>/stock/index.json — what the console's "Photo library" window reads.
import fs from 'node:fs';
import path from 'node:path';

export const STOCK_SECTIONS = ['general', 'hotels', 'excursions', 'transfers', 'restaurants', 'destinations', 'journal'];
const PHOTO = /\.(?:jpe?g|png|webp)$/i;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;          // file and folder names: no spaces / Arabic / odd characters (they end up in URLs)
export const MAX_STOCK_BYTES = 450 * 1024;              // bigger than this slows the pages; the build warns

const words = (name) => name.replace(PHOTO, '').split(/[-_.]+/).filter(Boolean);
const title = (name) => words(name).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

/** Scan `dir` → { index: { v, updatedAt, sections, albums, items }, files: [{ rel, abs }], warnings: [] } */
export function buildStockIndex(dir) {
  const items = [], files = [], warnings = [], albums = {};
  if (!fs.existsSync(dir)) return { index: { v: 1, updatedAt: new Date().toISOString(), sections: [], albums: {}, items }, files, warnings };
  for (const section of fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
    if (!STOCK_SECTIONS.includes(section)) { warnings.push(`stock/${section}: not a known section (${STOCK_SECTIONS.join(', ')}) — skipped`); continue; }
    const base = path.join(dir, section);
    let meta = {}; const mp = path.join(base, 'meta.json');
    if (fs.existsSync(mp)) { try { meta = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) { warnings.push(`stock/${section}/meta.json: ${e.message}`); } }
    const take = (rel, abs, album) => {
      const name = path.basename(rel);
      if (!PHOTO.test(name)) return;
      if (!SAFE.test(name) || (album && !SAFE.test(album))) { warnings.push(`stock/${section}/${rel}: use letters, digits, - _ . only (no spaces or Arabic) — skipped`); return; }
      const size = fs.statSync(abs).size;
      if (size > MAX_STOCK_BYTES) warnings.push(`stock/${section}/${rel}: ${Math.round(size / 1024)} KB — compress it (≤ ${Math.round(MAX_STOCK_BYTES / 1024)} KB) so the pages stay fast`);
      const m = meta[rel] || {};
      const tags = [...new Set([...(Array.isArray(m.tags) ? m.tags : []), ...words(name), ...(album ? words(album) : [])].map(x => String(x).toLowerCase()))];
      items.push({ id: `${section}/${rel}`, section, album: album || '', file: `${section}/${rel}`, en: m.en || title(name), ar: m.ar || '', tags, kb: Math.round(size / 1024) });
      files.push({ rel: `${section}/${rel}`, abs });
      if (album) (albums[section] = albums[section] || new Set()).add(album);
    };
    for (const e of fs.readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isFile()) take(e.name, path.join(base, e.name), '');
      else if (e.isDirectory()) for (const f of fs.readdirSync(path.join(base, e.name), { withFileTypes: true }).filter(x => x.isFile()).sort((a, b) => a.name.localeCompare(b.name))) take(`${e.name}/${f.name}`, path.join(base, e.name, f.name), e.name);
    }
  }
  const sections = [...new Set(items.map(i => i.section))];
  return { index: { v: 1, updatedAt: new Date().toISOString(), sections, albums: Object.fromEntries(Object.entries(albums).map(([k, v]) => [k, [...v].sort()])), items }, files, warnings };
}
