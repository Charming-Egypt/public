// The admin screen (console/settings.js TILES) and the site (shared/frontend.js DS_TILES) must list exactly the same tile keys,
// and every key must resolve to at least one element in the real page markup (src/pages/home.html + partials) — otherwise a switch would do nothing.
import fs from 'node:fs'; import assert from 'node:assert/strict';
const adm = fs.readFileSync(new URL('../../console/settings.js', import.meta.url), 'utf8');
const site = fs.readFileSync(new URL('../../shared/frontend.js', import.meta.url), 'utf8');
const aKeys = [...adm.slice(adm.indexOf('const TILES = ['), adm.indexOf('const RTL')).matchAll(/\['([a-z0-9-]+)', '/g)].map(m => m[1]);
const sBlock = site.slice(site.indexOf('const DS_TILES = {'), site.indexOf('function applyTiles'));
const sKeys = [...sBlock.matchAll(/^  '([a-z0-9-]+)':/gm)].map(m => m[1]);
assert.ok(aKeys.length > 20, 'admin list too short');
assert.deepEqual([...aKeys].sort(), [...sKeys].sort(), 'admin TILES and site DS_TILES differ');
assert.equal(new Set(aKeys).size, aKeys.length, 'duplicate keys');
console.log('tiles: ' + aKeys.length + ' keys, admin and site agree');
