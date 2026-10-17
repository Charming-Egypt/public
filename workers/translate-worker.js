/**
 * Discover Sharm — translation Worker (Cloudflare Workers AI, no API key to manage)
 *
 * Owners / admins type their listing in ONE language (Arabic or English); the console calls this Worker on save and
 * gets the text back in every other site language (ar, en, ru, de, it, tr).
 *
 *   POST /translate   Authorization: Bearer <Supabase access token of a signed-in owner or super admin>
 *   body  { source: "ar", target: "ru", texts: ["…", "…"] }            (≤ 60 texts, ≤ 24 000 characters per request)
 *   200   { translations: ["…", "…"] }                                (same order and length as `texts`)
 *
 * Only staff can use it (profiles.role = super_admin, or a profile that may list properties): it is not a public translator.
 * Long texts are split into paragraphs / sentences (the model works best under ~450 characters) and re-joined.
 */
const LANGS = ['ar', 'en', 'ru', 'de', 'it', 'tr'];
const MODEL = '@cf/meta/m2m100-1.2b';
const MAX_TEXTS = 60, MAX_CHARS = 24000, CHUNK = 420;

export function chunkParagraph(p, max = CHUNK) {
  if (p.length <= max) return [p];
  const sentences = p.split(/(?<=[.!?؟…。])\s+/), out = []; let cur = '';
  const push = s => { if (s) out.push(s); };
  for (const s of sentences) {
    if (s.length > max) {                      // a single huge "sentence": cut on words
      push(cur); cur = '';
      let w = ''; for (let word of s.split(/\s+/)) {
        while (word.length > max) { push(w); w = ''; push(word.slice(0, max)); word = word.slice(max); }   // an unbroken run (URL, long token)
        if ((w + ' ' + word).length > max) { push(w); w = word; } else w = w ? w + ' ' + word : word;
      }
      push(w); continue;
    }
    if ((cur + ' ' + s).trim().length > max) { push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
  }
  push(cur); return out;
}

async function translateText(env, text, source, target) {
  if (!text || !text.trim() || source === target) return text;
  const lines = text.split('\n');
  const done = [];
  for (const line of lines) {
    if (!line.trim()) { done.push(line); continue; }
    const parts = [];
    for (const c of chunkParagraph(line.trim())) {
      const r = await env.AI.run(MODEL, { text: c, source_lang: source, target_lang: target });
      parts.push((r && r.translated_text) || c);
    }
    done.push(parts.join(' '));
  }
  return done.join('\n');
}

const json = (o, status, cors) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...cors } });

// Is the caller a signed-in staff member? Uses the database's own is_super_admin() / is_owner() (security definer, honours is_active).
// Returns { ok: true } or { ok: false, reason } — the reason code is returned to the console so a mis-configuration is diagnosable.
async function staffCheck(env, token) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, ''), key = String(env.SUPABASE_ANON_KEY || '');
  if (!url || !key || /YOUR-PROJECT|YOUR-ANON/i.test(url + key)) return { ok: false, reason: 'worker_supabase_vars_missing' };
  const h = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const rpc = (fn) => fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: '{}' });
  let a, b;
  try { [a, b] = await Promise.all([rpc('is_super_admin'), rpc('is_owner')]); } catch { return { ok: false, reason: 'supabase_unreachable' }; }
  if (a.status === 401 || b.status === 401 || a.status === 403) return { ok: false, reason: 'token_rejected_check_anon_key_and_project' };
  if (!a.ok && !b.ok) return { ok: false, reason: `rpc_failed_${a.status}` };
  const isAdmin = a.ok && (await a.json()) === true, isOwner = b.ok && (await b.json()) === true;
  return isAdmin || isOwner ? { ok: true } : { ok: false, reason: 'account_is_not_staff_or_inactive' };
}

export default {
  async fetch(req, env) {
    const norm = (o) => String(o || '').trim().replace(/\/+$/, '').toLowerCase();
    const origin = norm(req.headers.get('Origin'));
    // Staff console origin(s). ALLOWED_ORIGINS may be a comma list; empty/missing falls back to the admin site (never "allow nobody": that breaks the browser preflight).
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(norm).filter(Boolean);
    if (!allowed.length) allowed.push('https://admin.discover-sharm.com');
    const ok = allowed.includes(origin);
    const cors = ok ? { 'Access-Control-Allow-Origin': req.headers.get('Origin').trim().replace(/\/+$/, ''), Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '86400' } : { Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);
    if (url.pathname !== '/translate' || req.method !== 'POST') return json({ error: 'Not found' }, 404, cors);
    if (!ok) return json({ error: 'Origin not allowed' }, 403, cors);

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Not allowed', reason: 'no_token' }, 401, cors);
    const who = await staffCheck(env, token);
    if (!who.ok) return json({ error: 'Not allowed', reason: who.reason }, 401, cors);

    let b; try { b = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400, cors); }
    const { source, target, texts } = b || {};
    if (!LANGS.includes(source) || !LANGS.includes(target)) return json({ error: 'Unsupported language' }, 400, cors);
    if (!Array.isArray(texts) || !texts.length || texts.length > MAX_TEXTS || texts.some(t => typeof t !== 'string')) return json({ error: 'texts must be 1-60 strings' }, 400, cors);
    if (texts.reduce((n, t) => n + t.length, 0) > MAX_CHARS) return json({ error: 'Too much text' }, 413, cors);

    try {
      const out = [], pool = 4;                                                        // a few texts in parallel, order preserved
      for (let i = 0; i < texts.length; i += pool)
        out.push(...await Promise.all(texts.slice(i, i + pool).map(t => translateText(env, t, source, target))));
      return json({ translations: out }, 200, cors);
    } catch (e) { return json({ error: 'Translation failed' }, 502, cors); }
  },
};
