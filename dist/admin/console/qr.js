/* Discover Sharm — QR code encoder (byte mode, error-correction L/M/Q/H, versions 1-40).
 * Written from the QR Code Model 2 specification (ISO/IEC 18004); no network, no dependency.
 *   DS.qr(text, 'M')                      -> { size, get(x, y) }   (true = dark module)
 *   DS.qrSvg(text, { ecc, border, fg, bg, scale })  -> "<svg …>" string
 *   DS.qrPng(text, { ecc, border, fg, bg, scale })  -> data:image/png URL (needs a browser canvas)
 */
(function (root) {
'use strict';
const ECC_CW = [[-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]];
const N_BLOCKS = [[-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]];
const ECC_IDX = { L: 0, M: 1, Q: 2, H: 3 }, ECC_BITS = [1, 0, 3, 2];

const rawModules = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
const dataCodewords = (v, e) => Math.floor(rawModules(v) / 8) - ECC_CW[e][v] * N_BLOCKS[e][v];
const gfMul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
function rsDivisor(deg) { const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1; for (let i = 0; i < deg; i++) { for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gfMul(root, 2); } return r; }
function rsRemainder(data, div) { const r = new Array(div.length).fill(0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); } return r; }
const utf8 = (s) => Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));

function encode(text, eccName) {
  const e = ECC_IDX[eccName || 'M'], bytes = utf8(text);
  let ver = 1, bits;
  for (; ; ver++) {
    if (ver > 40) throw new Error('QR: text too long');
    const cap = dataCodewords(ver, e) * 8, ccBits = ver <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= cap) { bits = []; break; }
  }
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach(b => put(b, 8));
  const cap = dataCodewords(ver, e) * 8;
  put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // error correction + interleave
  const nb = N_BLOCKS[e][ver], eccLen = ECC_CW[e][ver], raw = Math.floor(rawModules(ver) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen), blocks = []; let k = 0;
  for (let i = 0; i < nb; i++) { const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1)); k += dat.length; const ecc = rsRemainder(dat, div); if (i < nShort) dat.push(0); blocks.push(dat.concat(ecc)); }
  const all = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) all.push(b[i]); });

  // matrix
  const size = ver * 4 + 17, mod = Array.from({ length: size }, () => new Array(size).fill(false)), fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = []; if (ver > 1) { const n = Math.floor(ver / 7) + 2, step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2; align.push(6); for (let p = size - 7; align.length < n; p -= step) align.splice(1, 0, p); }
  align.forEach((cy, i) => align.forEach((cx, j) => { if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) return; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
  const bit = (x, i) => ((x >>> i) & 1) !== 0;
  const formatBits = (mask) => {
    const d = (ECC_BITS[e] << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(b, i)); setFn(8, 7, bit(b, 6)); setFn(8, 8, bit(b, 7)); setFn(7, 8, bit(b, 8)); for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(b, i)); for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(b, i)); setFn(8, size - 8, true);
  };
  formatBits(0);
  if (ver >= 7) { let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); const b = (ver << 12) | r; for (let i = 0; i < 18; i++) { const v = bit(b, i), a = size - 11 + i % 3, c = Math.floor(i / 3); setFn(a, c, v); setFn(c, a, v); } }
  // codewords, zig-zag
  let i = 0; for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert; if (!fn[y][x] && i < all.length * 8) { mod[y][x] = bit(all[i >>> 3], 7 - (i & 7)); i++; } } }
  const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const apply = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASK[m](x, y)) mod[y][x] = !mod[y][x]; };
  const penalty = () => {
    let p = 0; const rows = mod.map(r => r.map(v => v ? '1' : '0').join('')), cols = []; for (let x = 0; x < size; x++) { let s = ''; for (let y = 0; y < size; y++) s += mod[y][x] ? '1' : '0'; cols.push(s); }
    for (const line of rows.concat(cols)) { const runs = line.match(/0+|1+/g); runs.forEach(r => { if (r.length >= 5) p += 3 + r.length - 5; }); p += 40 * ((line.match(/(?=00001011101)/g) || []).length + (line.match(/(?=10111010000)/g) || []).length); }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
    const dark = rows.join('').split('1').length - 1, total = size * size; p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10; return p;
  };
  let best = 0, bestP = Infinity; for (let m = 0; m < 8; m++) { apply(m); formatBits(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } apply(m); }
  apply(best); formatBits(best);
  return { size, version: ver, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mod[y][x] };
}

function svg(text, o) {
  o = o || {}; const q = encode(text, o.ecc), b = o.border == null ? 2 : o.border, n = q.size + b * 2, fg = o.fg || '#000', bg = o.bg === undefined ? '#fff' : o.bg; let d = '';
  for (let y = 0; y < q.size; y++) { let x = 0; while (x < q.size) { if (!q.get(x, y)) { x++; continue; } let w = 1; while (q.get(x + w, y)) w++; d += `M${x + b} ${y + b}h${w}v1h-${w}z`; x += w; } }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${(o.scale || 8) * n}" height="${(o.scale || 8) * n}" shape-rendering="crispEdges">${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}<path d="${d}" fill="${fg}"/></svg>`;
}
function png(text, o) {
  o = o || {}; const q = encode(text, o.ecc), b = o.border == null ? 2 : o.border, s = o.scale || 10, n = (q.size + b * 2) * s, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'); g.fillStyle = o.bg || '#fff'; g.fillRect(0, 0, n, n); g.fillStyle = o.fg || '#000';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) g.fillRect((x + b) * s, (y + b) * s, s, s);
  return c.toDataURL('image/png');
}
const api = { encode, svg, png };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root && root.DS) { root.DS.qr = encode; root.DS.qrSvg = svg; root.DS.qrPng = png; }
})(typeof window !== 'undefined' ? window : null);
