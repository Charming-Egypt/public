import assert from 'node:assert/strict';
import worker, { chunkParagraph } from '../translate-worker.js';

// chunking keeps every piece under the limit and loses nothing
const long = ('هذه جملة طويلة نسبياً للاختبار. ').repeat(40) + 'x'.repeat(900);
const parts = chunkParagraph(long, 420);
assert.ok(parts.every(p => p.length <= 420), 'chunks fit');
assert.equal(parts.join(' ').replace(/\s+/g, ''), long.replace(/\s+/g, ''), 'nothing lost');
assert.deepEqual(chunkParagraph('short', 420), ['short']);

// request handling with stubbed Supabase + AI
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a', ALLOWED_ORIGINS: 'https://admin.discover-sharm.com',
  AI: { run: async (_m, { text, source_lang, target_lang }) => ({ translated_text: `[${source_lang}>${target_lang}] ${text}` }) } };
let who = 'admin';   // admin | owner | customer | rejected
globalThis.fetch = async (u) => {
  u = String(u);
  if (who === 'rejected') return new Response('{}', { status: 401 });
  if (u.endsWith('/rpc/is_super_admin')) return new Response(JSON.stringify(who === 'admin'));
  if (u.endsWith('/rpc/is_owner')) return new Response(JSON.stringify(who === 'owner'));
  return new Response('{}', { status: 404 });
};
const call = (body, o = {}) => worker.fetch(new Request('https://t/translate', { method: 'POST', headers: { Origin: o.origin || 'https://admin.discover-sharm.com', Authorization: o.auth ?? 'Bearer tok', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);

let r = await call({ source: 'ar', target: 'en', texts: ['مرحبا', 'سطر1\nسطر2'] });
assert.equal(r.status, 200); const j = await r.json();
assert.deepEqual(j.translations, ['[ar>en] مرحبا', '[ar>en] سطر1\n[ar>en] سطر2']);
assert.equal((await call({ source: 'ar', target: 'x-y', texts: ['a'] })).status, 400);
assert.equal((await call({ source: 'en', target: 'fr', texts: ['a'] })).status, 200, 'any ISO code is passed to the model');
assert.equal((await call({ source: 'ar', target: 'en', texts: [] })).status, 400);
assert.equal((await call({ source: 'ar', target: 'en', texts: ['a'] }, { auth: '' })).status, 401);
assert.equal((await call({ source: 'ar', target: 'en', texts: ['a'] }, { origin: 'https://evil.com' })).status, 403);
who = 'customer';
r = await call({ source: 'ar', target: 'en', texts: ['a'] }); assert.equal(r.status, 401, 'customers cannot use it'); assert.equal((await r.json()).reason, 'account_is_not_staff_or_inactive');
who = 'rejected';
r = await call({ source: 'ar', target: 'en', texts: ['a'] }); assert.equal(r.status, 401); assert.match((await r.json()).reason, /token_rejected/);
const envBad = { ...env, SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co' };
r = await worker.fetch(new Request('https://t/translate', { method: 'POST', headers: { Origin: 'https://admin.discover-sharm.com', Authorization: 'Bearer t' }, body: '{}' }), envBad);
assert.equal((await r.json()).reason, 'worker_supabase_vars_missing');
who = 'owner';
assert.equal((await call({ source: 'en', target: 'ru', texts: ['a'] })).status, 200, 'owners can');
// preflight: must carry the CORS headers (this was the browser error), also when ALLOWED_ORIGINS is empty or has a trailing slash
for (const v of [undefined, '', 'https://admin.discover-sharm.com/', ' https://x.com , https://admin.discover-sharm.com ']) {
  const e2 = { ...env, ALLOWED_ORIGINS: v };
  const pre = await worker.fetch(new Request('https://t/translate', { method: 'OPTIONS', headers: { Origin: 'https://admin.discover-sharm.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } }), e2);
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://admin.discover-sharm.com', 'ACAO for ' + JSON.stringify(v));
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/i);
}
const bad = await worker.fetch(new Request('https://t/translate', { method: 'OPTIONS', headers: { Origin: 'https://evil.com' } }), env);
assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
console.log('translate worker: all checks passed');
