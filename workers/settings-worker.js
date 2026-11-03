/**
 * Discover Sharm — settings Worker
 *
 * ALL site settings live in ONE file in the private GitHub data repo:  api/settings/settings.json
 *   { updatedAt, settings: { sections, languages:{enabled,default}, announcement, maintenance, site, … }, languages: [ { code, name, nativeName, dir, enabled, sortOrder, strings } ] }
 * (`languages` = the extra interface languages the super admin added; the six built-in ones ship with the site.)
 * This Worker is the only way in or out of that file: it holds GITHUB_TOKEN as a secret; the browser never sees it.
 *
 *   PUBLIC  GET    /settings                 what the websites read on every load: { value, langs:[enabled languages with their strings] }  (edge-cached 30 s)
 *   ADMIN   (Authorization: Bearer <Supabase access token of the super admin>)
 *           GET    /admin/settings           { settings, updatedAt, languages:[{ code, name, nativeName, dir, enabled, order, keys }] }
 *           PUT    /admin/settings           body { value: {…} }                       replaces `settings`
 *           POST   /admin/languages          body { code, name, nativeName, dir, strings, enabled }   add / update an interface language
 *           DELETE /admin/languages/{code}
 *
 * STATIC COPY (optional, recommended): bind the same R2 bucket as the content Worker (binding MEDIA) and set MEDIA_BASE. Every save then writes the public view to
 * MEDIA_BASE/settings/settings.json + a version pointer settings/version.json (browsers revalidate the pointer every few seconds, the file itself is cached by ?v=<hash>), so settings changes reach visitors in seconds and the sites stop calling this Worker.
 *
 * The super-admin check is the database's own is_super_admin() called with the caller's token (no service key needed here).
 */
import { github, textToB64, unutf8, fail } from './lib/github.js';

const FILE = 'api/settings/settings.json';
const BUILTIN = ['ar', 'en', 'ru', 'de', 'it', 'tr'];
const CODE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const MAX_SETTINGS = 60_000, MAX_STRINGS = 400_000, MAX_LANGS = 12;
const now = () => new Date().toISOString();

const empty = () => ({ updatedAt: null, settings: {}, languages: [] });
const publicView = (f) => ({
  value: f.settings || {}, updatedAt: f.updatedAt,
  langs: (f.languages || []).filter(l => l.enabled !== false).sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100))
    .map(l => ({ code: l.code, name: l.name, native_name: l.nativeName, dir: l.dir, strings: l.strings || {}, sort_order: l.sortOrder ?? 100 })),
});
const adminView = (f) => ({
  settings: f.settings || {}, updatedAt: f.updatedAt,
  languages: (f.languages || []).slice().sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100))
    .map(l => ({ code: l.code, name: l.name, nativeName: l.nativeName, dir: l.dir, enabled: l.enabled !== false, order: l.sortOrder ?? 100, keys: Object.keys(l.strings || {}).length })),
});
const norm = (f) => ({ ...empty(), ...(f || {}), languages: Array.isArray(f && f.languages) ? f.languages : [] });

async function requireSuperAdmin(env, req) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, ''), key = String(env.SUPABASE_ANON_KEY || '');
  if (!url || !key || /YOUR-PROJECT|YOUR-ANON/i.test(url + key)) throw fail(500, 'supabase_not_configured');
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw fail(401, 'Authentication failed');
  let r; try { r = await fetch(`${url}/rest/v1/rpc/is_super_admin`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }); }
  catch { throw fail(502, 'supabase_unreachable'); }
  if (r.status === 401 || r.status === 403) throw fail(401, 'Authentication failed');
  if (!r.ok) throw fail(502, `supabase_${r.status}`);
  if ((await r.json()) !== true) throw fail(403, 'Not allowed');
}

const mediaBase = (env) => String(env.MEDIA_BASE || '').trim().replace(/\/+$/, '');
const hasMedia = (env) => !!(env.MEDIA && mediaBase(env));
const sha16 = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
// settings/settings.json + settings/version.json = { v: <content hash> }. The sites read the pointer, then ask for settings.json?v=<hash>; a Cloudflare Cache Rule
// keeps each ?v= URL at the edge for a year and a changed file is a new URL, so the CDN refreshes itself. The file is written BEFORE its pointer.
const publishSettings = async (env, file) => {
  const body = JSON.stringify(publicView(norm(file))), v = await sha16(body), meta = { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=5' };
  await env.MEDIA.put('settings/settings.json', body, { httpMetadata: meta });
  await env.MEDIA.put('settings/version.json', JSON.stringify({ v }), { httpMetadata: meta });
};

const edge = () => (typeof caches !== 'undefined' && caches.default) || null;

export default {
  async fetch(req, env, ctx) {
    const normO = (o) => String(o || '').trim().replace(/\/+$/, '').toLowerCase();
    const originHdr = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(normO).filter(Boolean);
    if (!allowed.length) allowed.push('https://admin.discover-sharm.com');
    const cors = allowed.includes(normO(originHdr))
      ? { 'Access-Control-Allow-Origin': originHdr.trim().replace(/\/+$/, ''), Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' }
      : { Vary: 'Origin' };
    const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...h } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url), seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (seg[0] === 'health') return json({ ok: true });

      // ---------- public ----------
      if (req.method === 'GET' && seg[0] === 'settings' && seg.length === 1) {
        const cache = edge(), key = new Request(url.origin + url.pathname);
        const hit = cache && await cache.match(key); if (hit) return hit;
        const cur = await github(env).getJSON(FILE);
        const res = new Response(JSON.stringify({ ...publicView(norm(cur && cur.json)), ...(cur ? {} : { fallback: true }) }), { status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=120', 'Access-Control-Allow-Origin': '*' } });
        if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, res.clone()));
        if (cur && hasMedia(env) && ctx && ctx.waitUntil) ctx.waitUntil(publishSettings(env, cur.json).catch(() => {}));   // first request after a deploy fills the static copy
        return res;
      }

      // ---------- super admin ----------
      if (seg[0] !== 'admin') throw fail(404, 'Not found');
      if (!cors['Access-Control-Allow-Origin']) throw fail(403, 'Origin not allowed');
      await requireSuperAdmin(env, req);
      const gh = github(env);
      let body = {}; if (req.method === 'POST' || req.method === 'PUT') { const t = await req.text(); if (t.length > MAX_STRINGS + 20_000) throw fail(413, 'Too large'); try { body = t ? JSON.parse(t) : {}; } catch { throw fail(400, 'Invalid JSON'); } }
      const save = async (fn, msg) => {
        const saved = await gh.mutateJSON(FILE, (cur) => { const f = norm(cur); const next = fn(f); return next === undefined ? undefined : { ...next, updatedAt: now() }; }, msg);
        const c = edge(); if (c && ctx && ctx.waitUntil) ctx.waitUntil(c.delete(new Request(url.origin + '/settings')).catch(() => {}));   // this location stops serving the old copy
        if (saved && hasMedia(env)) { try { await publishSettings(env, saved); } catch (e) { console.error('settings publish', e.message); } }   // visitors get it within seconds
        return saved;
      };

      if (seg[1] === 'settings' && req.method === 'GET') { const cur = await gh.getJSON(FILE); return json(adminView(norm(cur && cur.json))); }
      if (seg[1] === 'settings' && req.method === 'PUT') {
        const v = body.value;
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'value must be an object');
        if (JSON.stringify(v).length > MAX_SETTINGS) throw fail(413, 'Settings too large');
        await save((f) => ({ ...f, settings: v }), 'settings updated');
        return json({ success: true });
      }
      if (seg[1] === 'languages' && req.method === 'POST') {
        const code = String(body.code || '').trim();
        if (!CODE_RE.test(code) || BUILTIN.includes(code.toLowerCase())) throw fail(400, 'Invalid or built-in language code');
        const name = String(body.name || '').trim().slice(0, 80), nativeName = String(body.nativeName || '').trim().slice(0, 80);
        if (!name || !nativeName) throw fail(400, 'name and nativeName are required');
        const st = body.strings === undefined ? undefined : body.strings;
        if (st !== undefined && (!st || typeof st !== 'object' || Array.isArray(st) || Object.values(st).some(x => typeof x !== 'string'))) throw fail(400, 'strings must be an object of texts');
        if (st && JSON.stringify(st).length > MAX_STRINGS) throw fail(413, 'Strings too large');
        await save((f) => {
          const i = f.languages.findIndex(l => l.code === code), prev = i >= 0 ? f.languages[i] : null;
          if (!prev && f.languages.length >= MAX_LANGS) throw fail(409, 'Too many extra languages');
          const lang = { code, name, nativeName, dir: body.dir === 'rtl' ? 'rtl' : 'ltr', enabled: body.enabled !== false, sortOrder: prev ? prev.sortOrder : 100 + f.languages.length, strings: st !== undefined ? st : (prev ? prev.strings : {}) };
          const languages = f.languages.slice(); if (i >= 0) languages[i] = lang; else languages.push(lang);
          return { ...f, languages };
        }, `language ${code} saved`);
        return json({ success: true });
      }
      if (seg[1] === 'languages' && seg[2] && req.method === 'DELETE') {
        const code = seg[2];
        await save((f) => (f.languages.some(l => l.code === code) ? { ...f, languages: f.languages.filter(l => l.code !== code) } : undefined), `language ${code} deleted`);
        return json({ success: true });
      }
      throw fail(404, 'Not found');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('settings-worker', e.message, e.detail || '');
      return json({ error: e.message || 'Server error' }, status);
    }
  },
};
export { publicView, adminView, norm };
