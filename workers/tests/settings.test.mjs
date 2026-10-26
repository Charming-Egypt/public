// No network: GitHub contents API and Supabase's is_super_admin() are faked in memory.
import assert from 'node:assert/strict';
import worker from '../settings-worker.js';

const files = new Map(); let shaN = 0, conflictOnce = false;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64'), unb64 = (b) => Buffer.from(b, 'base64').toString('utf8');
const jres = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const tokens = { 'tok-admin': true, 'tok-owner': false };
let ghGets = 0;
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const method = (init.method || 'GET').toUpperCase(), body = init.body ? JSON.parse(init.body) : undefined;
  if (u.includes('/rest/v1/rpc/is_super_admin')) {
    const t = (init.headers.Authorization || '').replace('Bearer ', ''); if (!(t in tokens)) return jres({ message: 'bad jwt' }, 401);
    return jres(tokens[t]);
  }
  const m = /api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)/.exec(u);
  if (m) {
    const path = decodeURIComponent(m[1]);
    if (method === 'GET') { ghGets++; const f = files.get(path); return f ? jres({ sha: f.sha, encoding: 'base64', content: f.b64 }) : jres({}, 404); }
    if (method === 'PUT') {
      const ex = files.get(path);
      if (conflictOnce) { conflictOnce = false; return jres({}, 409); }
      if ((ex && body.sha !== ex.sha) || (!ex && body.sha)) return jres({}, 409);
      const sha = 's' + (++shaN); files.set(path, { b64: body.content, sha, msg: body.message }); return jres({ content: { sha } });
    }
  }
  return jres({ message: 'unmocked ' + u }, 599);
};
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'a', GITHUB_TOKEN: 'ghp', GITHUB_REPO: 'acme/data', ALLOWED_ORIGINS: 'https://admin.discover-sharm.com' };
const ORIGIN = 'https://admin.discover-sharm.com';
const call = async (method, path, { tok, body, origin = ORIGIN } = {}) => {
  const r = await worker.fetch(new Request('https://s.test' + path, { method, headers: { Origin: origin, ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, {});
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, headers: r.headers };
};
const file = () => files.has('api/settings/settings.json') ? JSON.parse(unb64(files.get('api/settings/settings.json').b64)) : undefined;

// public read before anything exists → empty but valid (the sites keep working with their defaults)
let r = await call('GET', '/settings', { origin: 'https://www.discover-sharm.com' });
assert.equal(r.status, 200); assert.deepEqual(r.j.value, {}); assert.deepEqual(r.j.langs, []); assert.equal(r.j.fallback, true);
assert.equal(r.headers.get('access-control-allow-origin'), '*');

// permissions
assert.equal((await call('GET', '/admin/settings')).status, 401, 'no token');
assert.equal((await call('GET', '/admin/settings', { tok: 'nope' })).status, 401, 'bad token');
assert.equal((await call('GET', '/admin/settings', { tok: 'tok-owner' })).status, 403, 'an owner is not the super admin');
assert.equal((await call('PUT', '/admin/settings', { tok: 'tok-owner', body: { value: {} } })).status, 403);
assert.equal((await call('PUT', '/admin/settings', { tok: 'tok-admin', body: { value: {} }, origin: 'https://evil.example' })).status, 403, 'unknown origin');

// save settings → settings.json in the data repo
const value = { sections: { hotels: true, journal: false }, languages: { enabled: ['ar', 'en'], default: 'en' }, announcement: { enabled: true, text: { en: 'Hi' } } };
r = await call('PUT', '/admin/settings', { tok: 'tok-admin', body: { value } }); assert.equal(r.status, 200);
assert.deepEqual(file().settings, value); assert.ok(file().updatedAt); assert.ok(files.get('api/settings/settings.json').msg);
assert.equal((await call('PUT', '/admin/settings', { tok: 'tok-admin', body: { value: [1] } })).status, 400);
assert.equal((await call('PUT', '/admin/settings', { tok: 'tok-admin', body: { value: { x: 'y'.repeat(61000) } } })).status, 413);
r = await call('GET', '/settings'); assert.deepEqual(r.j.value, value); assert.equal(r.j.fallback, undefined);

// languages
const strings = { hello: 'Bonjour', bye: 'Au revoir' };
r = await call('POST', '/admin/languages', { tok: 'tok-admin', body: { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr', strings } }); assert.equal(r.status, 200);
assert.deepEqual(file().settings, value, 'adding a language leaves the settings alone');
r = await call('GET', '/admin/settings', { tok: 'tok-admin' }); assert.deepEqual(r.j.languages, [{ code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr', enabled: true, order: 100, keys: 2 }]);
r = await call('GET', '/settings'); assert.equal(r.j.langs[0].native_name, 'Français'); assert.deepEqual(r.j.langs[0].strings, strings, 'public view carries the strings');
// saving settings leaves the languages alone
await call('PUT', '/admin/settings', { tok: 'tok-admin', body: { value: { ...value, site: { name: 'DS' } } } });
assert.equal(file().languages.length, 1); assert.equal(file().settings.site.name, 'DS');
// disable keeps the strings (toggle from the console re-posts without strings)
await call('POST', '/admin/languages', { tok: 'tok-admin', body: { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr', enabled: false } });
assert.deepEqual(file().languages[0].strings, strings, 'strings kept when only enabled changes'); assert.equal((await call('GET', '/settings')).j.langs.length, 0, 'disabled languages are not public');
assert.equal((await call('POST', '/admin/languages', { tok: 'tok-admin', body: { code: 'en', name: 'English', nativeName: 'English' } })).status, 400, 'built-in codes are not editable');
assert.equal((await call('POST', '/admin/languages', { tok: 'tok-admin', body: { code: 'FR!', name: 'x', nativeName: 'x' } })).status, 400);
assert.equal((await call('POST', '/admin/languages', { tok: 'tok-admin', body: { code: 'es', name: 'Spanish', nativeName: 'Español', strings: { a: { b: 1 } } } })).status, 400, 'strings must be texts');
r = await call('DELETE', '/admin/languages/fr', { tok: 'tok-admin' }); assert.equal(r.status, 200); assert.equal(file().languages.length, 0);
assert.equal((await call('DELETE', '/admin/languages/fr', { tok: 'tok-admin' })).status, 200, 'deleting twice is fine');

// two admins saving at once: the sha conflict is retried
conflictOnce = true;
r = await call('PUT', '/admin/settings', { tok: 'tok-admin', body: { value: { retry: true } } }); assert.equal(r.status, 200); assert.deepEqual(file().settings, { retry: true });

assert.equal((await call('GET', '/nothing')).status, 404);
assert.equal((await call('OPTIONS', '/admin/settings')).status, 204);
console.log('settings worker: all checks passed');
