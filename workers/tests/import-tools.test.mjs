// CSV menu parsing + Google-answer merge (console/import.js is plain browser code with a CommonJS tail, so it runs here too).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const T = createRequire(import.meta.url)('../../console/import.js');

// quotes, commas inside quotes, doubled quotes, CRLF, BOM, semicolons, tabs
assert.deepEqual(T.parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
assert.deepEqual(T.parseCsv('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]);
assert.deepEqual(T.parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
assert.deepEqual(T.parseCsv('a,b\n"multi\nline",2'), [['a', 'b'], ['multi\nline', '2']]);

// the shipped template imports cleanly
let r = T.menuFromCsv(T.menuTemplate());
assert.equal(r.items, 5); assert.equal(r.sections.length, 4); assert.deepEqual(r.warnings, []);
assert.deepEqual(r.sections[3].category, { ar: 'المشروبات' }); assert.equal(r.sections[3].items[0].price, 45);   // Arabic-Indic digits
assert.equal(r.sections[2].items[0].price, 60);                                                                  // "60 EGP"

// Arabic headers, and blank category = same section as the row above
r = T.menuFromCsv('القسم,الصنف,السعر,الوصف\nمقبلات,حمص,٤٥,بالطحينة\n,فول,30,\nمشروبات,شاي,15,');
assert.equal(r.sections.length, 2); assert.equal(r.sections[0].items.length, 2); assert.deepEqual(r.sections[0].items[1].name, { ar: 'فول' });

// explicit language columns put both languages on the same dish
r = T.menuFromCsv('category_en,category_ar,name_en,name_ar,price\nStarters,مقبلات,Hummus,حمص,45');
assert.deepEqual(r.sections[0].category, { en: 'Starters', ar: 'مقبلات' }); assert.deepEqual(r.sections[0].items[0].name, { en: 'Hummus', ar: 'حمص' });

// no header row: category, name, price, description
r = T.menuFromCsv('Starters,Hummus,45,Dip\nStarters,Salad,30,');
assert.equal(r.items, 2); assert.ok(r.warnings.length); assert.equal(r.sections[0].items[0].price, 45);

// prices: thousands separator, decimal comma, junk
const p = (v) => T.menuFromCsv(`name,price\nx,${v}`).sections[0].items[0].price;
assert.equal(p('"1,250.50"'), 1250.5); assert.equal(p('"45,50"'), 45.5); assert.equal(p('£120'), 120); assert.equal(p(''), '');
r = T.menuFromCsv('name,price\nx,free'); assert.equal(r.sections[0].items[0].price, ''); assert.ok(r.warnings.some(w => /مش مفهوم/.test(w)));

// rows without a name are skipped and reported; a lone category line starts a section
r = T.menuFromCsv('category,name,price\nDrinks,,\nDrinks,Tea,10\n,,\nFood,,5');
assert.equal(r.items, 1); assert.equal(r.skipped.length, 1);   // only "Food,,5" (a price without a dish); empty lines never reach the parser
r = T.menuFromCsv('category,name,price\nDrinks,,\n,Tea,10');
assert.equal(r.sections[0].items[0].name.en, 'Tea');

// merge: append updates prices of known items, replace starts clean
const cur = [{ category: { en: 'Starters', ar: 'مقبلات' }, items: [{ name: { en: 'Hummus', ar: 'حمص' }, price: 40, description: {} }] }];
const add = T.menuFromCsv('category,name,price\nStarters,Hummus,45\nStarters,Salad,30\nDrinks,Tea,10').sections;
let m = T.mergeMenu(cur, add, 'append');
assert.equal(m.length, 2); assert.equal(m[0].items.length, 2); assert.equal(m[0].items[0].price, 45); assert.deepEqual(m[0].items[0].name, { en: 'Hummus', ar: 'حمص' }); assert.equal(cur[0].items[0].price, 40);   // input untouched
assert.equal(T.mergeMenu(cur, add, 'replace').length, 2); assert.equal(T.mergeMenu(cur, add, 'replace')[0].items[0].name.ar, undefined);
const arOnly = T.menuFromCsv('category,name,price\nمقبلات,حمص,50').sections;
assert.equal(T.mergeMenu(cur, arOnly, 'append')[0].items[0].price, 50);   // matched through the Arabic name

// Windows-1256 (Excel's Arabic CSV) is decoded
const w1256 = Buffer.from([0xc7, 0xe1, 0xd5, 0xcd, 0xe4]);   // الصحن
assert.equal(T.decodeCsvBytes(w1256.buffer.slice(w1256.byteOffset, w1256.byteOffset + w1256.length)), 'الصحن');

// Google merge: fills blanks, keeps what the person typed, overwrite replaces
const res = { fields: { name: { en: 'Mahony', ar: 'ماهوني' }, phone: '+20 1', coordinates: { lat: 1, lng: 2 }, priceLevel: 2 }, google: { placeId: 'ChIJxxxxxxxxxxxxxxxxxxxx', rating: 4.6, userRatingCount: 50, sig: 's' } };
const D = { name: { en: 'My name' }, phone: '' };
T.mergeGoogle(D, res);
assert.deepEqual(D.name, { en: 'My name', ar: 'ماهوني' }); assert.equal(D.phone, '+20 1'); assert.deepEqual(D.coordinates, { lat: 1, lng: 2 }); assert.equal(D.rating, 4.6); assert.equal(D.reviews, 50); assert.equal(D.google.sig, 's');
T.mergeGoogle(D, res, { overwrite: true }); assert.equal(D.name.en, 'Mahony');

console.log('import tools: all checks passed');
