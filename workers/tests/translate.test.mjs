import assert from 'node:assert/strict';
import worker, { chunkParagraph, sane, translateTexts } from '../translate-worker.js';

// chunking keeps every piece under the limit and loses nothing
const long = ('هذه جملة طويلة نسبياً للاختبار. ').repeat(40) + 'x'.repeat(900);
const parts = chunkParagraph(long, 420);
assert.ok(parts.every(p => p.length <= 420), 'chunks fit');
assert.equal(parts.join(' ').replace(/\s+/g, ''), long.replace(/\s+/g, ''), 'nothing lost');
assert.deepEqual(chunkParagraph('short', 420), ['short']);

// ---- output checks (sane) ----
assert.ok(sane('Snorkeling trip to Ras Mohammed, 8 hours, 1,800 EGP', 'Поездка на снорклинг в Рас-Мохаммед, 8 часов, 1,800 EGP', 'en', 'ru'));
assert.ok(!sane('Snorkeling trip to Ras Mohammed, 8 hours, 1,800 EGP', 'Snorkeling trip to Ras Mohammed, 8 hours, 1,800 EGP', 'en', 'ru'), 'untranslated English is not Russian');
assert.ok(!sane('Snorkeling trip, 8 hours, 1,800 EGP', 'Поездка на снорклинг, часов, EGP', 'en', 'ru'), 'dropped numbers');
assert.ok(sane('Snorkeling trip, 8 hours, 1,800 EGP', 'رحلة سنوركل، ٨ ساعات، ١٬٨٠٠ EGP'.replace('١٬٨٠٠', '1,800').replace('٨', '8'), 'en', 'ar'), 'Arabic-Indic digits are normalised');
assert.ok(!sane('A fairly long description of a boat trip along the reef.', 'Sure, here is the translation: Eine ziemlich lange Beschreibung einer Bootsfahrt am Riff.', 'en', 'de'), 'chatter');
assert.ok(!sane('A fairly long description of a boat trip along the reef.', 'Boot', 'en', 'de'), 'truncated');
assert.ok(sane('Naama Bay', 'Naama Bay', 'en', 'de'), 'a short place name may stay identical');
assert.ok(!sane('Welcome to our beautiful resort by the sea', 'Welcome to our beautiful resort by the sea', 'en', 'de'), 'long identical text = failure');
assert.ok(sane('12:30', '12:30', 'en', 'ru'), 'no letters: nothing to translate');

// ---- mock Workers AI: routes by model id ----
const MT = '@cf/meta/m2m100-1.2b', G4 = '@cf/google/gemma-4-26b-a4b-it', LL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
let mode = 'good', calls = [], lastSystem = '', lastBody = null;
const tr = (T, x) => T === 'Russian' ? 'Перевод: ' + x : T === 'Arabic' ? 'ترجمة: ' + x : `[${T}] ${x}`;
const AI = { run: async (model, p) => {
  calls.push(model); lastBody = p;
  if (model === MT) { if (mode === 'all-bad') throw new Error('mt down'); return { translated_text: tr(p.target_lang === 'ru' ? 'Russian' : p.target_lang, p.text) }; }
  const sys = p.messages[0].content, user = p.messages[1].content, T = /into ([A-Za-z ()]+?) for tourists/.exec(sys)[1], single = sys.includes('Output ONLY the translated text');
  lastSystem = sys;
  if (mode === 'all-bad') throw new Error('llm down');
  if (mode === 'primary-down' && model === G4) throw new Error('boom');
  if (mode === 'garbage' && !single) return { response: 'Sorry, I cannot do that' };
  if (mode === 'choices' && !single) return { choices: [{ message: { content: '```json\n' + JSON.stringify({ translations: JSON.parse(user).items.map(x => tr(T, x)) }) + '\n```' } }] };
  if (mode === 'latin-for-ru') return single ? { response: user } : { response: JSON.stringify({ translations: JSON.parse(user).items }) };
  return single ? { response: tr(T, user) } : { response: JSON.stringify({ translations: JSON.parse(user).items.map(x => tr(T, x)) }) };
} };
const E = { AI };
const run = async (m, texts, target = 'ru', source = 'en') => { mode = m; calls = []; return translateTexts(E, texts, source, target); };

let r = await run('good', ['Snorkeling trip', 'Naama Bay hotel with 3 pools']);
assert.deepEqual(r.translations, ['Перевод: Snorkeling trip', 'Перевод: Naama Bay hotel with 3 pools']); assert.deepEqual(r.failed, []);
assert.deepEqual(calls, [G4], 'one batched call for the whole group');
assert.equal(lastBody.chat_template_kwargs.enable_thinking, false, 'Gemma 4 reasoning is switched off'); assert.ok(lastBody.max_completion_tokens > 0);
assert.match(lastSystem, /Naama Bay => Наама Бэй/, 'glossary entry injected'); assert.match(lastSystem, /snorkeling => снорклинг/i);
r = await run('good', ['Hello world greeting', '', '  ', '123'], 'de'); assert.deepEqual(r.translations.slice(1), ['', '  ', '123'], 'blank / number-only texts pass through'); assert.equal(calls.length, 1);
r = await run('good', ['same'], 'en'); assert.deepEqual(r.translations, ['same']); assert.equal(calls.length, 0, 'source == target: no model call');
r = await run('choices', ['A boat trip along the reef']); assert.deepEqual(r.translations, ['Перевод: A boat trip along the reef'], 'OpenAI-style response shape with ```json fences'); assert.equal(calls.filter(c => c === LL).length, 0);
r = await run('garbage', ['Dinner by the sea', 'Lunch on the beach']); assert.deepEqual(r.failed, []); assert.equal(r.engine.fallback, 2, 'unparseable batch → second LLM item by item'); assert.ok(calls.includes(LL));
r = await run('primary-down', ['Dinner by the sea']); assert.equal(r.translations[0], 'Перевод: Dinner by the sea'); assert.equal(r.engine.fallback, 1);
r = await run('latin-for-ru', ['Dinner by the sea tonight please']); assert.deepEqual(r.failed, [], 'script check rejects Latin for ru on both LLMs, MT rescues it'); assert.equal(r.engine.mt, 1);
r = await run('all-bad', ['Dinner by the sea', '5']); assert.deepEqual(r.failed, [0]); assert.equal(r.translations[0], '', 'a failure is empty — never the source text'); assert.equal(r.translations[1], '5');
r = await run('good', ['Hello again my friend', 'x'], 'ar', 'ar'); assert.equal(calls.length, 0);

// request handling with stubbed Supabase + AI
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a', ALLOWED_ORIGINS: 'https://admin.discover-sharm.com', AI };
let who = 'admin';   // admin | owner | customer | rejected
globalThis.fetch = async (u) => {
  u = String(u);
  if (who === 'rejected') return new Response('{}', { status: 401 });
  if (u.endsWith('/rpc/is_super_admin')) return new Response(JSON.stringify(who === 'admin'));
  if (u.endsWith('/rpc/is_owner')) return new Response(JSON.stringify(who === 'owner'));
  return new Response('{}', { status: 404 });
};
const call = (body, o = {}) => worker.fetch(new Request('https://t/translate', { method: 'POST', headers: { Origin: o.origin || 'https://admin.discover-sharm.com', Authorization: o.auth ?? 'Bearer tok', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);

mode = 'good'; r = await call({ source: 'en', target: 'ru', texts: ['Welcome to the resort', 'Two nights'] });
assert.equal(r.status, 200); const j = await r.json();
assert.deepEqual(j.translations, ['Перевод: Welcome to the resort', 'Перевод: Two nights']); assert.deepEqual(j.failed, []);
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
