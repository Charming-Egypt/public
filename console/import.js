/* Discover Sharm — import helpers for the item editor (no UI, no network):
 *   DS.importTools.parseCsv(text)                     → rows of cells (quotes, "" escapes, CRLF, BOM; , ; or tab separated)
 *   DS.importTools.menuFromCsv(text)                  → { sections, items, skipped[], warnings[] }   sections = [{ category:{en|ar}, items:[{ name, price, description }] }]
 *   DS.importTools.mergeMenu(current, sections, mode) → the new menu ('replace' | 'append': same section = merged, same item name = price/description updated)
 *   DS.importTools.menuTemplate()                     → CSV text of a ready-to-fill example
 *   DS.importTools.decodeCsvBytes(arrayBuffer)        → text (UTF-8, falls back to Windows-1256 = Excel's Arabic CSV)
 *   DS.importTools.mergeGoogle(D, res, { overwrite }) → copies an /import/google answer into the editor's working copy
 * Texts are stored in the language they are written in (Arabic letters → ar, everything else → en); saving the item then translates them into every site language.
 */
(function (root) {
const T = {};

// ---------------------------------------------------------------- CSV
function detectDelimiter(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  let best = ',', n = -1;
  for (const d of [',', ';', '\t']) { let c = 0, q = false; for (const ch of first) { if (ch === '"') q = !q; else if (ch === d && !q) c++; } if (c > n) { n = c; best = d; } }
  return best;
}
T.parseCsv = function (text) {
  text = String(text || '').replace(/^﻿/, '');
  const d = detectDelimiter(text), rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"' && !cell) q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim())) rows.push(row.map(c => c.trim())); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some(c => c.trim())) rows.push(row.map(c => c.trim()));
  return rows;
};
T.decodeCsvBytes = function (buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { try { return new TextDecoder('windows-1256').decode(buf); } catch { return new TextDecoder().decode(buf); } }
};

// ---------------------------------------------------------------- menu
const HEAD = {
  category: ['category', 'section', 'cat', 'group', 'القسم', 'الفئة', 'التصنيف', 'قسم', 'فئة', 'تصنيف'],
  name: ['name', 'item', 'item name', 'product', 'dish', 'الصنف', 'الاسم', 'اسم الصنف', 'صنف', 'اسم', 'المنتج', 'الطبق'],
  price: ['price', 'cost', 'السعر', 'سعر'],
  description: ['description', 'desc', 'details', 'الوصف', 'وصف', 'التفاصيل', 'المكونات'],
};
const norm = s => String(s || '').trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
function headerMap(row) {
  const map = {};   // column index → { f: field, l: 'ar'|'en'|undefined }
  row.forEach((raw, i) => {
    let h = norm(raw), l;
    const m = /^(.*?)\s*(ar|en|عربي|انجليزي|إنجليزي)$/.exec(h);
    if (m && m[1] && Object.values(HEAD).some(a => a.includes(m[1]))) { h = m[1]; l = /^(ar|عربي)$/.test(m[2]) ? 'ar' : 'en'; }
    for (const [f, aliases] of Object.entries(HEAD)) if (aliases.includes(h)) { if (!Object.values(map).some(x => x.f === f && x.l === l)) map[i] = { f, l }; break; }
  });
  return map;
}
const AR_RE = /[؀-ۿ]/;
const lang = s => (AR_RE.test(s) ? 'ar' : 'en');
const DIGITS = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9 };
function parsePrice(v) {
  let s = String(v == null ? '' : v).replace(/[٠-٩۰-۹]/g, c => DIGITS[c]).replace(/[٫]/g, '.').replace(/[٬]/g, ',');
  s = s.replace(/[^\d.,]/g, '');                      // EGP, ج.م, £ … are dropped
  if (!s) return '';
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');   // 1,250.50
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');           // 45,50
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : '';
}
const LIM = { category: 50, name: 70, description: 140 };
T.menuFromCsv = function (text) {
  const rows = T.parseCsv(text), warnings = [], skipped = [];
  if (!rows.length) return { sections: [], items: 0, skipped, warnings: ['الملف فاضي'] };
  let map = headerMap(rows[0]), body = rows.slice(1), headerRow = true;
  if (!Object.values(map).some(x => x.f === 'name')) {   // no header row: category, name, price, description in that order
    headerRow = false; body = rows; map = {};
    const order = rows[0].length >= 4 ? ['category', 'name', 'price', 'description'] : rows[0].length === 3 ? ['name', 'price', 'description'] : ['name', 'price'];
    order.forEach((f, i) => { map[i] = { f }; });
    warnings.push('ماكانش فيه صف عناوين — اتفترض الترتيب: ' + order.join('، '));
  }
  const sections = [], byKey = new Map(); let cur = null, items = 0, line = headerRow ? 1 : 0;
  const setCat = c => { const key = norm(c.en || c.ar); if (!byKey.has(key)) { const sec = { category: c, items: [] }; byKey.set(key, sec); sections.push(sec); } cur = byKey.get(key); };
  const put = (o, f, val, l) => { if (!val) return; const k = l || lang(val); o[f] = o[f] || {}; if (!o[f][k]) o[f][k] = val; };
  const priceCol = Object.keys(map).find(i => map[i].f === 'price');
  for (const r of body) {
    line++;
    const rec = { category: {}, name: {}, description: {} }; let price = '';
    for (const [i, { f, l }] of Object.entries(map)) {
      const val = String(r[i] == null ? '' : r[i]).trim(); if (!val) continue;
      if (f === 'price') price = parsePrice(val); else put(rec, f, val.length > LIM[f] ? val.slice(0, LIM[f]) : val, l);
      if (f !== 'price' && val.length > LIM[f]) warnings.push(`سطر ${line}: ${f === 'name' ? 'اسم الصنف' : f === 'category' ? 'اسم القسم' : 'الوصف'} اتقصّ لـ ${LIM[f]} حرف`);
    }
    const hasCat = Object.keys(rec.category).length > 0;
    if (!Object.keys(rec.name).length) {
      if (hasCat && price === '' && !Object.keys(rec.description).length) setCat(rec.category);   // a lone section title: the items below belong to it
      else skipped.push(line);
      continue;
    }
    if (hasCat) setCat(rec.category); else if (!cur) setCat({ en: 'Menu', ar: 'المنيو' });
    if (price === '' && priceCol != null && String(r[priceCol] || '').trim()) warnings.push(`سطر ${line}: السعر "${r[priceCol]}" مش مفهوم — اتساب فاضي`);
    cur.items.push({ name: rec.name, price, description: rec.description }); items++;
  }
  if (items > 2000) warnings.push('الملف كبير — اتقبل أول 2000 صنف بس'), sections.forEach(s => { s.items = s.items.slice(0, 2000); });
  if (skipped.length) warnings.push(`اتخطّى ${skipped.length} سطر من غير اسم صنف (سطر ${skipped.slice(0, 8).join('، ')}${skipped.length > 8 ? '…' : ''})`);
  return { sections: sections.filter(s => s.items.length), items, skipped, warnings };
};
const sameText = (a, b) => { const k = o => norm((o && (o.en || o.ar)) || ''); return k(a) && k(a) === k(b) || (a && b && ((a.ar && a.ar === b.ar) || (a.en && a.en === b.en))); };
T.mergeMenu = function (current, sections, mode) {
  const out = mode === 'replace' ? [] : JSON.parse(JSON.stringify(current || []));
  for (const s of sections) {
    let tgt = out.find(c => sameText(c.category, s.category));
    if (!tgt) { tgt = { category: JSON.parse(JSON.stringify(s.category)), items: [] }; out.push(tgt); }
    for (const it of s.items) {
      const ex = (tgt.items || []).find(x => sameText(x.name, it.name));
      if (ex) { if (it.price !== '') ex.price = it.price; if (Object.keys(it.description).length) ex.description = { ...(ex.description || {}), ...it.description }; ex.name = { ...ex.name, ...it.name }; }
      else (tgt.items = tgt.items || []).push(JSON.parse(JSON.stringify(it)));
    }
  }
  return out;
};
T.menuTemplate = function () {
  return '﻿category,name,price,description\r\n' + [
    ['Starters', 'Hummus', 45, 'Chickpea dip with tahini and olive oil'],
    ['Starters', 'Baba Ghanoush', 50, ''],
    ['Main courses', 'Grilled Sea Bass', 320, ''],
    ['Drinks', 'Fresh Orange Juice', '60 EGP', ''],
    ['المشروبات', 'قهوة تركي', '٤٥', 'سادة أو مظبوط'],
  ].map(r => r.map(c => /[",\r\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\r\n') + '\r\n';
};

// ---------------------------------------------------------------- Google answer → editor state
const empty = v => v == null || v === '' || (typeof v === 'object' && !Object.values(v).some(x => !empty(x)));
T.mergeGoogle = function (D, res, o = {}) {
  const ow = !!o.overwrite, changed = [];
  for (const [k, v] of Object.entries(res.fields || {})) {
    if (k === 'coordinates') { const c = D.coordinates || (D.coordinates = {}); for (const a of ['lat', 'lng']) if (ow || empty(c[a])) { c[a] = v[a]; } changed.push(k); continue; }
    if (v && typeof v === 'object') {
      const t = D[k] && typeof D[k] === 'object' ? D[k] : (D[k] = {});
      for (const [l, s] of Object.entries(v)) if (ow || empty(t[l])) { t[l] = s; if (!changed.includes(k)) changed.push(k); }
    } else if (ow || empty(D[k])) { D[k] = v; changed.push(k); }
  }
  if (res.google && res.google.placeId) {
    D.google = res.google;
    if (res.google.rating != null) D.rating = res.google.rating;
    if (res.google.userRatingCount != null) D.reviews = res.google.userRatingCount;
  }
  return changed;
};

if (typeof module !== 'undefined' && module.exports) module.exports = T;
else { root.DS = root.DS || {}; root.DS.importTools = T; }
})(typeof window !== 'undefined' ? window : globalThis);
