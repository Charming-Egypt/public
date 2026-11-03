/**
 * Discover Sharm — translation Worker (Cloudflare Workers AI, no API key to manage)
 *
 * Owners / admins type their listing in ENGLISH; the console calls this Worker on save and gets the text back in every other
 * site language (ar, ru, de, it, tr, + any language added in Settings). Other source languages still work (old items written in Arabic).
 *
 *   POST /translate   Authorization: Bearer <Supabase access token of a signed-in owner or super admin>
 *   body  { source: "en", target: "ru", texts: ["…", "…"] }            (≤ 60 texts, ≤ 24 000 characters per request)
 *   200   { translations: ["…", "…"], failed: [index, …], engine: {…} }   same order and length as `texts`;
 *         a text that could not be translated reliably is "" and its index is listed in `failed` (the console cancels the save —
 *         it never stores source-language text in a target-language field any more).
 *
 * Why the old version came out wrong, and what this one does about it
 *   · It used a small machine-translation model (m2m100) one sentence at a time with no context: place names and trade terms
 *     were translated literally, short titles/tags were hallucinated, Egyptian-dialect Arabic input confused it, and when the model
 *     returned nothing the Worker silently handed back the SOURCE text as if it were translated.
 *   · Now an instruction-following LLM does the work with the whole batch in view, a tourism-specific brief and a glossary of fixed
 *     renderings (lib/glossary.js). Every answer is checked (right script, numbers/URLs/e-mails kept, sensible length, no chatter);
 *     bad ones are retried one by one on a second LLM, then on m2m100, and only then reported as failed.
 *
 * Variables (all optional): TRANSLATE_MODEL, TRANSLATE_FALLBACK_MODEL  — Workers AI model ids, see wrangler.translate.toml.
 * Only staff can use it (profiles.role = super_admin, or a profile that may list properties): it is not a public translator.
 */
import { glossaryFor } from './lib/glossary.js';

const LANG_RE = /^[a-z]{2,3}$/;
const MT_MODEL = '@cf/meta/m2m100-1.2b';                              // last resort (classic MT, supports ~100 languages)
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';                // strong multilingual, cheap; a "reasoning" model, so thinking is switched off below
const DEFAULT_FALLBACK = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_TEXTS = 60, MAX_CHARS = 24000, CHUNK = 420, GROUP_ITEMS = 20, GROUP_CHARS = 5000;

const LANG_NAMES = { ar: 'Arabic', en: 'English', ru: 'Russian', de: 'German', it: 'Italian', tr: 'Turkish', fr: 'French', es: 'Spanish', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', cs: 'Czech', uk: 'Ukrainian', ro: 'Romanian', bg: 'Bulgarian', el: 'Greek', he: 'Hebrew', fa: 'Persian', hi: 'Hindi', ja: 'Japanese', ko: 'Korean', zh: 'Chinese (Simplified)', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', hu: 'Hungarian', sr: 'Serbian', hr: 'Croatian', sk: 'Slovak', id: 'Indonesian', th: 'Thai', vi: 'Vietnamese' };
const STYLE = {
  ar: 'Modern Standard Arabic, warm and simple, the way a good Arabic travel site writes. Not colloquial dialect. Keep Western digits (0-9) exactly as in the source.',
  ru: 'Natural, polite Russian ("вы"). Standard Russian forms of well-known place names.',
  de: 'Natural German, polite "Sie". Compound nouns where idiomatic.',
  it: 'Natural Italian, polite "Lei"/impersonal tone.',
  tr: 'Natural Turkish, polite "siz". Correct vowel harmony and suffixes.',
};
const SCRIPT = { ar: /[\u0600-\u06FF]/, fa: /[\u0600-\u06FF]/, ru: /[\u0400-\u04FF]/, uk: /[\u0400-\u04FF]/, bg: /[\u0400-\u04FF]/, sr: /[\u0400-\u04FF]/, he: /[\u0590-\u05FF]/, el: /[\u0370-\u03FF]/, hi: /[\u0900-\u097F]/, th: /[\u0E00-\u0E7F]/, ko: /[\uAC00-\uD7AF]/, ja: /[\u3040-\u30FF\u4E00-\u9FFF]/, zh: /[\u4E00-\u9FFF]/ };
const FOREIGN_FOR_LATIN = /[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g;

// ---------- helpers ----------
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
const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
const westernDigits = s => String(s).replace(/[٠-٩۰-۹]/g, d => AR_DIGITS[d]);
const letters = s => (String(s).match(/\p{L}/gu) || []).length;
const words = s => String(s).trim().split(/\s+/).filter(Boolean).length;

/** Is `out` a believable translation of `src`? (cheap checks that catch the usual model failures) */
export function sane(src, out, source, target) {
  if (typeof out !== 'string' || !out.trim()) return false;
  if (!letters(src)) return true;                                                     // numbers / symbols / emoji only: nothing to translate
  if (/^\s*(here('s| is)|sure[,!:]|translation\s*:|translated\s*:|of course)/i.test(out) || /<\/?think>/i.test(out)) return false;   // chatter / leaked reasoning
  if (src.length >= 24 && (out.length < src.length * 0.25 || out.length > src.length * 4)) return false;                            // truncated or runaway
  const sc = SCRIPT[target];
  if (sc) { if (!sc.test(out) && words(src) > 3) return false; }                      // e.g. Russian output with no Cyrillic at all
  else if (SCRIPT[source] || /[\u0400-\u04FF\u0600-\u06FF]/.test(src)) { const bad = (out.match(FOREIGN_FOR_LATIN) || []).length; if (bad > letters(out) * 0.2) return false; }
  if (source !== target && out.trim() === src.trim() && words(src) >= 4) return false;   // came back untranslated
  const keep = (src.match(/\d+(?:[.,:]\d+)*|https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+/g) || []);   // numbers, prices, times, URLs, e-mails must survive
  const o = westernDigits(out);
  return keep.every(k => o.includes(k));
}

function extractText(r) {                                                            // Workers AI returns different shapes per model
  if (!r) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const m = r.choices && r.choices[0] && r.choices[0].message;
  if (m) return typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(x => (x && x.text) || '').join('') : '';
  return typeof r.result === 'string' ? r.result : '';
}
async function llm(env, model, system, user, maxTokens) {
  const body = { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0 };
  if (/gemma-4/.test(model)) { body.max_completion_tokens = maxTokens; body.chat_template_kwargs = { enable_thinking: false }; }   // reasoning model: otherwise it "thinks" until the token budget is gone
  else body.max_tokens = maxTokens;
  return extractText(await env.AI.run(model, body)).trim();
}
function systemPrompt(source, target, texts, single) {
  const S = LANG_NAMES[source] || source, T = LANG_NAMES[target] || target, gl = glossaryFor(texts, target);
  return [
    `You are a professional translator for a travel and hospitality website about Sharm El-Sheikh, Egypt: hotels, boat trips, diving and snorkeling, desert safaris, airport transfers, restaurants and cafés. Translate from ${S} into ${T} for tourists booking holidays.`,
    `Rules:`,
    `1. Translate meaning, not word by word. Write the way a native ${T} travel copywriter would: natural, fluent, warm, accurate. No additions, omissions, notes or explanations.`,
    `2. Items can be a one-word tag, a dish name, a title, a bullet or a long description — judge each on its own. Titles stay short; keep the original capitalization style of the target language.`,
    `3. Keep proper names (hotels, restaurants, brands, streets, people) as they are or in their standard ${T} form. Never translate a name literally.`,
    `4. Keep exactly: numbers, prices, currency codes (EGP, USD…), times, dates, units, URLs, e-mails, emoji, line breaks, list markers, HTML tags and {placeholders}.`,
    STYLE[target] ? `5. Style for ${T}: ${STYLE[target]}` : `5. Use standard, polite ${T}.`,
    gl.length ? `Use these exact renderings when the term appears:\n${gl.join('\n')}` : '',
    single ? `Output ONLY the translated text — nothing else.`
           : `Input: a JSON object {"items": [...]}. Output: ONLY a JSON object {"translations": [...]} with exactly the same number of strings in the same order. No markdown fences, no commentary.`,
  ].filter(Boolean).join('\n');
}
function parseBatch(raw, n) {
  let s = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  for (const [a, b] of [['{', '}'], ['[', ']']]) {
    const i = s.indexOf(a), j = s.lastIndexOf(b); if (i < 0 || j <= i) continue;
    try { const v = JSON.parse(s.slice(i, j + 1)), arr = Array.isArray(v) ? v : v && v.translations; if (Array.isArray(arr) && arr.length === n && arr.every(x => typeof x === 'string')) return arr; } catch { /* try the next shape */ }
  }
  return null;
}

// ---------- engines ----------
async function llmBatch(env, model, source, target, texts) {
  const payload = JSON.stringify({ items: texts }), maxTokens = Math.min(8192, 600 + Math.ceil(payload.length * 1.6));
  return parseBatch(await llm(env, model, systemPrompt(source, target, texts, false), payload, maxTokens), texts.length);
}
async function llmSingle(env, model, source, target, text) {
  return llm(env, model, systemPrompt(source, target, [text], true), text, Math.min(4096, 400 + text.length * 3));
}
async function mtSingle(env, source, target, text) {                               // classic MT; throws instead of echoing the source when it fails
  const done = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) { done.push(line); continue; }
    const parts = [];
    for (const c of chunkParagraph(line.trim())) {
      const r = await env.AI.run(MT_MODEL, { text: c, source_lang: source, target_lang: target });
      if (!r || !r.translated_text) throw new Error('empty MT result');
      parts.push(r.translated_text);
    }
    done.push(parts.join(' '));
  }
  return done.join('\n');
}

export async function translateTexts(env, texts, source, target) {
  const out = new Array(texts.length).fill(null), engine = { primary: 0, fallback: 0, mt: 0 };
  const primary = env.TRANSLATE_MODEL || DEFAULT_MODEL, fallback = env.TRANSLATE_FALLBACK_MODEL || DEFAULT_FALLBACK;
  texts.forEach((t, i) => { if (!t || !t.trim() || source === target || !letters(t)) out[i] = t; });
  let todo = out.map((v, i) => v === null ? i : -1).filter(i => i >= 0);

  // 1) whole groups in one request, so the model sees context (a tag next to its neighbours, a title next to its description)
  const groups = []; let cur = [], chars = 0;
  for (const i of todo) { if (cur.length && (cur.length >= GROUP_ITEMS || chars + texts[i].length > GROUP_CHARS)) { groups.push(cur); cur = []; chars = 0; } cur.push(i); chars += texts[i].length; }
  if (cur.length) groups.push(cur);
  for (const g of groups) {
    let res = null; try { res = await llmBatch(env, primary, source, target, g.map(i => texts[i])); } catch { /* handled below */ }
    g.forEach((i, k) => { if (res && sane(texts[i], res[k], source, target)) { out[i] = res[k].trim(); engine.primary++; } });
  }
  // 2) whatever failed: one by one, second LLM
  todo = out.map((v, i) => v === null ? i : -1).filter(i => i >= 0);
  for (const i of todo) {
    try { const r = await llmSingle(env, fallback, source, target, texts[i]); if (sane(texts[i], r, source, target)) { out[i] = r.trim(); engine.fallback++; } } catch { /* next engine */ }
  }
  // 3) still failing: classic MT, same checks
  todo = out.map((v, i) => v === null ? i : -1).filter(i => i >= 0);
  for (const i of todo) {
    try { const r = await mtSingle(env, source, target, texts[i]); if (sane(texts[i], r, source, target)) { out[i] = r.trim(); engine.mt++; } } catch { /* give up on this one */ }
  }
  const failed = out.map((v, i) => v === null ? i : -1).filter(i => i >= 0);
  return { translations: out.map(v => v == null ? '' : v), failed, engine };
}

// ---------- HTTP ----------
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
    if (url.pathname === '/health') return json({ ok: true, model: env.TRANSLATE_MODEL || DEFAULT_MODEL }, 200, cors);
    if (url.pathname !== '/translate' || req.method !== 'POST') return json({ error: 'Not found' }, 404, cors);
    if (!ok) return json({ error: 'Origin not allowed' }, 403, cors);

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Not allowed', reason: 'no_token' }, 401, cors);
    const who = await staffCheck(env, token);
    if (!who.ok) return json({ error: 'Not allowed', reason: who.reason }, 401, cors);

    let b; try { b = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400, cors); }
    const { source, target, texts } = b || {};
    if (!LANG_RE.test(source) || !LANG_RE.test(target)) return json({ error: 'Unsupported language' }, 400, cors);
    if (!Array.isArray(texts) || !texts.length || texts.length > MAX_TEXTS || texts.some(t => typeof t !== 'string')) return json({ error: 'texts must be 1-60 strings' }, 400, cors);
    if (texts.reduce((n, t) => n + t.length, 0) > MAX_CHARS) return json({ error: 'Too much text' }, 413, cors);

    try { return json(await translateTexts(env, texts, source, target), 200, cors); }
    catch (e) { return json({ error: 'Translation failed' }, 502, cors); }
  },
};
