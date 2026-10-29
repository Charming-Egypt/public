import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildStockIndex } from '../stock-index.mjs';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-'));
const put = (rel, size = 10) => { const p = path.join(T, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(size, 1)); };
put('hotels/pool-sunset.jpg'); put('hotels/rooms/sea-view-room.webp'); put('excursions/diving/ras-mohamed-reef.jpg'); put('general/red-sea-sunrise.png');
put('hotels/Bad Name.jpg'); put('hotels/notes.txt'); put('weird/x.jpg'); put('hotels/huge.jpg', 600 * 1024); put('hotels/.gitkeep');
fs.writeFileSync(path.join(T, 'hotels/meta.json'), JSON.stringify({ 'pool-sunset.jpg': { ar: 'حمام سباحة وقت الغروب', en: 'Pool at sunset', tags: ['غروب', 'pool'] } }));

const { index, files, warnings } = buildStockIndex(T);
const ids = index.items.map(i => i.id).sort();
assert.deepEqual(ids, ['excursions/diving/ras-mohamed-reef.jpg', 'general/red-sea-sunrise.png', 'hotels/huge.jpg', 'hotels/pool-sunset.jpg', 'hotels/rooms/sea-view-room.webp']);
const pool = index.items.find(i => i.id === 'hotels/pool-sunset.jpg');
assert.equal(pool.ar, 'حمام سباحة وقت الغروب'); assert.equal(pool.en, 'Pool at sunset'); assert.ok(pool.tags.includes('غروب') && pool.tags.includes('sunset'), 'tags = meta + words of the file name');
const room = index.items.find(i => i.album === 'rooms'); assert.equal(room.en, 'Sea View Room'); assert.ok(room.tags.includes('rooms'), 'album name is searchable');
assert.deepEqual(index.albums, { excursions: ['diving'], hotels: ['rooms'] }); assert.deepEqual(index.sections.sort(), ['excursions', 'general', 'hotels']);
assert.equal(files.length, 5);
assert.ok(warnings.some(w => /Bad Name\.jpg/.test(w)), 'unsafe names are skipped with a warning');
assert.ok(warnings.some(w => /weird/.test(w)), 'unknown section warned');
assert.ok(warnings.some(w => /huge\.jpg.*compress/.test(w)), 'oversized photo warned');
assert.equal(buildStockIndex(path.join(T, 'missing')).index.items.length, 0, 'no stock folder → empty library, no crash');
console.log('stock index: all checks passed');
