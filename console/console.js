/* Discover Sharm — shared console framework (login, api, forms, tables, owner panels). No dependencies. */
(function () {
'use strict';
const DS = window.DS = {};
const LANGS = ['ar', 'en', 'ru', 'de', 'it', 'tr'];
const LN = { ar: 'العربية', en: 'English', ru: 'Русский', de: 'Deutsch', it: 'Italiano', tr: 'Türkçe' };
const $ = (s, r) => (r || document).querySelector(s);
const esc = DS.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tr = DS.tr = o => (o && typeof o === 'object') ? (o[window.DS_ALANG || 'ar'] || o.ar || o.en || Object.values(o).find(Boolean) || '') : (o == null ? '' : o);
DS.money = n => Number(n || 0).toLocaleString('en-US');
DS.dt = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

// ---------- icons ----------
const LOGO = 'https://blogger.googleusercontent.com/img/a/AVvXsEjJnB5c7R2uZzCNpzUtsow1OaJSWKAuybM2Wxux8wLk0EYV4TMA-xe1gIRXyrQ8Hw1dDVhgL94mMfLdMmB1HmsQXlI0vYYoJ83Z2o6Iu3r1UTxZxm7KbtD6jDQnZyVyInzRPr2dKnCqEdUuOW6QaVKtqC0fyVi7vJ65sWVJZSgiSRle3UXA3il3Qk6kdJwN=s150';   // Discover Sharm logo (falls back to the 'DS' mark if it cannot load)
const logoMark = () => `<span class="lg">DS<img src="${LOGO}" alt="Discover Sharm" onerror="this.remove()"></span>`;
const IC = { qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v3M14 20h3M20 20v1', cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3', refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', chevl: 'M15 18l-6-6 6-6', chevr: 'M9 18l6-6-6-6', home: 'M3 10.5 12 3l9 7.5V21H3zM9 21v-6h6v6', cal: 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8', star: 'M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5', code: 'M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16', mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6',
  brief: 'M3 8h18v12H3zM8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', menu: 'M4 6h16M4 12h16M4 18h16', sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9', trend: 'M3 17l6-6 4 4 8-8M15 7h6v6', alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  coins: 'M12 8c-4 0-7-1.3-7-3s3-3 7-3 7 1.3 7 3-3 3-7 3zM5 5v14c0 1.7 3 3 7 3s7-1.3 7-3V5M5 12c0 1.7 3 3 7 3s7-1.3 7-3', pct: 'M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', plus: 'M12 5v14M5 12h14', check: 'M20 6 9 17l-5-5' };
DS.ic = n => `<svg class="i" viewBox="0 0 24 24"><path d="${IC[n] || ''}"/></svg>`;
DS.stat = (n, l, o = {}) => `<div class="stat">${o.icon ? `<div class="ico ${o.tone || ''}">${DS.ic(o.icon)}</div>` : ''}<div><b>${n}</b><span>${l}</span>${o.sub ? `<small>${o.sub}</small>` : ''}</div></div>`;
// ---------- inline SVG charts (no libraries) ----------
const nice = m => { const p = Math.pow(10, Math.floor(Math.log10(m || 1))), f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
const short = v => v >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? +(v / 1e3).toFixed(1) + 'K' : Math.round(v * 10) / 10;
function frame(labels, max, W, H, L, R, T, B, x, y) {
  let g = ''; for (let k = 0; k <= 4; k++) { const yy = y(max * k / 4); g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" style="stroke:var(--line)"/><text x="${L - 7}" y="${yy + 4}" text-anchor="end">${short(max * k / 4)}</text>`; }
  const step = Math.ceil(labels.length / 7); labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - 7}" text-anchor="middle">${l}</text>`; });
  return g;
}
DS.area = (labels, values, color = 'var(--gold)', id = 'a') => {
  const W = 640, H = 220, L = 46, R = 12, T = 14, B = 28, n = labels.length; if (!n) return '<div class="empty">مفيش بيانات</div>';
  const max = nice(Math.max(1, ...values)), x = i => L + (n === 1 ? 0 : i * (W - L - R) / (n - 1)), y = v => T + (H - T - B) * (1 - v / max);
  const pts = values.map((v, i) => [x(i), y(v)]), line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${frame(labels, max, W, H, L, R, T, B, x, y)}<defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.38"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs><path d="${line} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)}Z" style="fill:url(#g${id})"/><path d="${line}" style="fill:none;stroke:${color};stroke-width:2.6;stroke-linejoin:round;stroke-linecap:round"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.2" style="fill:${color}"><title>${labels[i]}: ${DS.money(values[i])}</title></circle>`).join('')}</svg>`;
};
DS.bars = (labels, values, color = 'var(--blue)') => {
  const W = 640, H = 220, L = 46, R = 12, T = 14, B = 28, n = labels.length; if (!n) return '<div class="empty">مفيش بيانات</div>';
  const max = nice(Math.max(1, ...values)), bw = (W - L - R) / n, x = i => L + bw * i + bw / 2, y = v => T + (H - T - B) * (1 - v / max);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${frame(labels, max, W, H, L, R, T, B, x, y)}${values.map((v, i) => `<rect x="${x(i) - Math.min(bw * .6, 26) / 2}" y="${y(v)}" width="${Math.min(bw * .6, 26)}" height="${Math.max(0, y(0) - y(v))}" rx="5" style="fill:${color}"><title>${labels[i]}: ${DS.money(v)}</title></rect>`).join('')}</svg>`;
};
DS.donut = (items) => {
  const tot = items.reduce((a, i) => a + i.v, 0), r = 54, C = 2 * Math.PI * r; let off = 0;
  const seg = tot ? items.filter(i => i.v).map(i => { const d = i.v / tot * C, s = `<circle cx="70" cy="70" r="${r}" fill="none" stroke-width="18" style="stroke:${i.c}" stroke-dasharray="${d} ${C - d}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${i.l}: ${i.v}</title></circle>`; off += d; return s; }).join('') : `<circle cx="70" cy="70" r="${r}" fill="none" stroke-width="18" style="stroke:var(--line)"/>`;
  return `<div class="donutbox"><svg viewBox="0 0 140 140" width="150" height="150">${seg}<text x="70" y="68" text-anchor="middle" style="font-size:24px;font-weight:800;fill:var(--ink)">${tot}</text><text x="70" y="86" text-anchor="middle" style="font-size:10px;fill:var(--muted)">إجمالي</text></svg><div class="legend">${items.map(i => `<div><i style="background:${i.c}"></i>${i.l} <b style="color:var(--ink)">${i.v}</b></div>`).join('')}</div></div>`;
};
DS.hbars = (items) => { const mx = Math.max(1, ...items.map(i => i.v)); return items.map(i => `<div class="bar"><div><span>${i.l}</span><b>${i.v}</b></div><div class="tr"><i style="width:${Math.round(i.v / mx * 100)}%;background:${i.c}"></i></div></div>`).join('') || '<div class="empty">—</div>'; };
DS.daysBack = (n) => Array.from({ length: n }, (_, k) => new Date(Date.now() - (n - 1 - k) * 864e5).toISOString().slice(0, 10));
DS.hero = (title, sub, actions) => `<div class="hero"><div><h2>${title}</h2><p>${sub}</p></div><div class="row">${actions || ''}</div></div>`;
DS.STC = { pending_payment: 'var(--amber)', completed: 'var(--green)', failed: 'var(--red)', cancelled: '#8b93b8', refunded: 'var(--purple)' };

// ---------- badges ----------
const PAY = { pending_payment: ['بانتظار الدفع', 'amber'], completed: ['مدفوع', 'green'], failed: ['فشل', 'red'], cancelled: ['ملغي', 'gray'], refunded: ['مسترد', 'purple'] };
const OWN = { new: ['جديد', 'blue'], confirmed: ['مؤكد', 'green'], done: ['تم', 'green'], no_show: ['لم يحضر', 'red'] };
DS.PAY = PAY; DS.OWN = OWN;
DS.badge = (map, k) => { const v = map[k]; return v ? `<span class="badge b-${v[1]}">${v[0]}</span>` : `<span class="badge b-gray">${esc(k || '—')}</span>`; };
DS.opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v[0]}</option>`).join('');

// ---------- toast / modal ----------
DS.toast = (msg, bad) => { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(t._t); t._t = setTimeout(() => t.className = '', 3400); };
DS.modal = ({ title, body, actions, onOpen, wide }) => {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="md ${wide ? 'wide' : ''}"><div class="mh"><span>${esc(title)}</span><button class="x" type="button">×</button></div><div class="mb"></div><div class="mf"></div></div>`;
  const mb = $('.mb', ov), mf = $('.mf', ov);
  if (typeof body === 'string') mb.innerHTML = body; else mb.appendChild(body);
  const close = () => ov.remove();
  $('.x', ov).onclick = close; ov.onmousedown = e => { if (e.target === ov) ov.dataset.d = '1'; }; ov.onclick = e => { if (e.target === ov && ov.dataset.d) close(); };
  (actions || []).concat([{ t: 'إغلاق', cls: 'ghost', fn: null }]).forEach(a => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (a.cls || ''); b.textContent = a.t;
    b.onclick = async () => { if (!a.fn) return close(); b.disabled = true; try { const r = await a.fn(mb, close); if (r !== false) close(); } catch (e) { DS.toast(e.message, true); } finally { b.disabled = false; } };
    mf.appendChild(b);
  });
  document.body.appendChild(ov); if (onOpen) onOpen(mb);
  return { close, el: mb };
};

// ---------- tables ----------
DS.table = (cols, rows, o = {}) => !rows.length ? `<div class="empty">${o.empty || 'مفيش بيانات'}</div>` :
  `<div class="tw"><table><thead><tr>${cols.map(c => `<th>${c.h}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) =>
    `<tr ${o.click ? `class="click" data-i="${i}"` : ''}>${cols.map(c => `<td data-label="${esc(String(c.h).replace(/<[^>]*>/g, ''))}">${c.f(r, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
DS.thumb = u => u ? `<img class="thumb" src="${esc(u)}" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="thumb" style="display:inline-block"></span>';

// CSV export (UTF-8 BOM so Excel shows Arabic; leading = + - @ neutralised against formula injection)
DS.csv = (name, head, rows) => {
  const q = v => { let x = v == null ? '' : v; if (typeof x === 'string' && /^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + String(x).replace(/"/g, '""') + '"'; };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
};
DS.METHOD = { instapay: 'إنستا باي', bank: 'تحويل بنكي' };
DS.acctText = a => !a ? '—' : a.method === 'instapay' ? `${a.instapay.handle} · ${a.instapay.name || ''} ${a.instapay.phone || ''}` : `${a.bank.bankName} · ${a.bank.accountName} · ${a.bank.accountNumber || ''} ${a.bank.iban || ''}`;

// ---------- form engine (schema-driven) ----------
// field: { k, l, t: text|num|url|select|textarea|urls|dates|i18n|i18nlist|list, opts, long, sub, h }
let dl = 0, ll = 0, vv = 0; const LISTS = {}, IMGV = {};
function fld(f, v) {
  const t = f.t || 'text', hint = f.h ? `<small>${esc(f.h)}</small>` : '';
  let inner = '', lid = '', vid = '';
  if (t === 'i18n' || t === 'i18nlist') {
    const area = f.long || t === 'i18nlist';
    const one = lg => { let x = v && v[lg]; if (t === 'i18nlist') x = Array.isArray(x) ? x.join('\n') : ''; 
      return `<div class="lg"><b>${LN[lg]}</b>${area ? `<textarea data-lg="${lg}" rows="3">${esc(x || '')}</textarea>` : `<input data-lg="${lg}" value="${esc(x || '')}">`}</div>`; };
    inner = LANGS.slice(0, 2).map(one).join('') + `<details><summary>لغات تانية (ru / de / it / tr)</summary>${LANGS.slice(2).map(one).join('')}</details>`;
    if (t === 'i18nlist') hint || (inner += '<small>كل سطر = عنصر</small>');
  } else if (t === 'list') {
    lid = 'L' + (++ll); LISTS[lid] = f;
    inner = `<div class="items">${(Array.isArray(v) ? v : []).map(it => li(f, it)).join('')}</div><button type="button" class="btn ghost sm" data-add>+ ${esc(f.add || 'إضافة')}</button>`;
  } else if (t === 'img' || t === 'imgs') {
    vid = 'V' + (++vv); IMGV[vid] = t === 'img' ? (v ? [v] : []) : (Array.isArray(v) ? v.slice() : []);
    inner = `<div class="imgw"><div class="thumbs"></div><div class="row"><button type="button" class="btn ghost sm" data-up>${DS.ic('plus')} رفع ${t === 'imgs' ? 'صور' : 'صورة'} من الجهاز</button><input type="file" accept="image/*" hidden ${t === 'imgs' ? 'multiple' : ''}><input class="ur" dir="ltr" placeholder="أو الصق رابط صورة" style="flex:1;min-width:150px"><button type="button" class="btn ghost sm" data-ad>إضافة الرابط</button></div></div>`;
  } else if (t === 'bool') {
    inner = `<label class="sw"><input type="checkbox" ${v ? 'checked' : ''}><span>${esc(f.h || 'مفعّل')}</span></label>`;
  } else if (t === 'obj') {
    inner = `<div class="grid2">${f.sub.map(x => fld(x, v && v[x.k])).join('')}</div>`;
  } else if (t === 'select') {
    inner = `<select>${f.opts.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${ov === v ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
  } else if (t === 'textarea' || t === 'urls' || t === 'dates') {
    const x = Array.isArray(v) ? v.join('\n') : (v || '');
    inner = `<textarea rows="${t === 'textarea' ? 3 : 4}" placeholder="${t === 'urls' ? 'رابط في كل سطر' : t === 'dates' ? 'تاريخ في كل سطر: 2026-10-25' : ''}">${esc(x)}</textarea>`;
  } else {
    const id = f.opts ? 'dl' + (++dl) : '';
    inner = `<input type="${t === 'num' ? 'number' : t === 'url' ? 'url' : t === 'pass' ? 'password' : 'text'}" ${t === 'num' ? 'min="0" step="any"' : ''} value="${esc(v == null ? '' : v)}" ${id ? `list="${id}"` : ''}>` + (id ? `<datalist id="${id}">${f.opts.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '');
  }
  return `<div class="fld" data-k="${f.k}" data-t="${t}" ${lid ? `data-lid="${lid}"` : ''} ${vid ? `data-vid="${vid}"` : ''}><label>${esc(f.l || f.k)}</label>${inner}${hint}</div>`;
}
const li = (f, it) => `<div class="li"><button type="button" class="rm" data-rm>×</button><div class="grid2">${f.sub.map(s => fld(s, it && it[s.k])).join('')}</div></div>`;
// client-side compression (max 1600px, ~450KB JPEG) then upload: the worker commits the file into the GitHub repo and returns its direct URL
const IMG_MAX_CHARS = 600000;
async function compressImage(file) {
  if (!/^image\//.test(file.type)) throw new Error('الملف ده مش صورة');
  const url = URL.createObjectURL(file), img = new Image();
  try { img.src = url; await img.decode(); } catch { URL.revokeObjectURL(url); throw new Error('مش قادر أقرا الصورة'); }
  let max = 1600, q = 0.82, out = '';
  for (let i = 0; i < 8; i++) {
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q); if (out.length <= IMG_MAX_CHARS) break;
    if (q > 0.55) q -= 0.1; else { max = Math.round(max * 0.8); q = 0.75; }
  }
  URL.revokeObjectURL(url);
  if (out.length > IMG_MAX_CHARS * 1.3) throw new Error('الصورة كبيرة جدًا حتى بعد الضغط');
  return out;
}
DS.LANGS = LANGS; DS.LN = LN; DS.compressImage = compressImage;   // shared with editor.js
// Auto-translation (translate-worker.js). texts: string[] in `source` -> string[] in `target`, same order.
DS.translate = async (source, target, texts) => {
  let base = ((window.DS_SUPABASE && window.DS_SUPABASE.translateBase) || '').trim().replace(/\/+$/, '');
  if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
  if (!base) throw new Error('الترجمة التلقائية غير مفعّلة (translateBase مش متضبط)');
  const token = window.DS_ACCESS_TOKEN ? await window.DS_ACCESS_TOKEN() : TOKEN;
  const out = [];
  for (let i = 0; i < texts.length;) {
    let e = i, chars = 0; while (e < texts.length && e - i < 40 && (e === i || chars + String(texts[e]).length <= 20000)) chars += String(texts[e++]).length;   // worker limit: 60 texts / 24000 chars per call
    const body = JSON.stringify({ source, target, texts: texts.slice(i, e) }); let r;
    for (let tryN = 0; ; tryN++) {   // one retry on a network hiccup / 5xx (the AI model occasionally times out)
      try { r = await fetch(base + '/translate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body }); }
      catch { if (tryN < 2) { await new Promise(x => setTimeout(x, 800)); continue; } throw new Error('تعذّر الوصول لخدمة الترجمة (CORS أو الشبكة) — راجع DS_TRANSLATE_BASE و ALLOWED_ORIGINS'); }
      if (r.status >= 500 && tryN < 2) { await new Promise(x => setTimeout(x, 800)); continue; }
      break;
    }
    i = e;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error || 'فشلت الترجمة (' + r.status + ')') + (j.reason ? ' [' + j.reason + ']' : ''));
    out.push(...j.translations);
  }
  return out;
};
DS.safeSrc = u => /^(https?:\/\/|\/|data:image\/)/i.test(u || '') ? u : '';
const drawThumbs = w => { $('.thumbs', w).innerHTML = w._v.map((u, i) => `<div class="th"><img src="${esc(DS.safeSrc(u))}" alt=""><button type="button" data-rmimg="${i}" title="حذف">×</button>${w.dataset.t === 'imgs' && i ? `<button type="button" class="st" data-first="${i}" title="اجعلها الرئيسية">★</button>` : ''}</div>`).join('') || '<span class="muted">مفيش صور</span>'; };
const initImgs = root => root.querySelectorAll('.fld[data-vid]').forEach(w => { if (!w._v) { w._v = IMGV[w.dataset.vid] || []; drawThumbs(w); } });
DS.form = (schema, values) => {
  const root = document.createElement('div'); root.className = 'form';
  root.innerHTML = schema.map(f => fld(f, values && values[f.k])).join(''); initImgs(root);
  root.onclick = e => {
    if (e.target.closest('[data-rm]')) { e.target.closest('.li').remove(); return; }
    const add = e.target.closest('[data-add]');
    if (add) { const w = add.closest('.fld'), f = LISTS[w.dataset.lid]; $('.items', w).insertAdjacentHTML('beforeend', li(f, {})); initImgs(root); return; }
    const w = e.target.closest('.fld[data-vid]'); if (!w) return;
    if (e.target.closest('[data-up]')) $('input[type=file]', w).click();
    const rm = e.target.closest('[data-rmimg]'); if (rm) { w._v.splice(+rm.dataset.rmimg, 1); drawThumbs(w); }
    const fs = e.target.closest('[data-first]'); if (fs) { w._v.unshift(w._v.splice(+fs.dataset.first, 1)[0]); drawThumbs(w); }
    if (e.target.closest('[data-ad]')) { const i = $('.ur', w), u = i.value.trim(); if (!/^https?:\/\//i.test(u)) return DS.toast('الصق رابط صورة صحيح (يبدأ بـ https://)', true); w._v = w.dataset.t === 'img' ? [u] : w._v.concat(u); i.value = ''; drawThumbs(w); }
  };
  root.onchange = async e => {
    if (e.target.type !== 'file') return; const w = e.target.closest('.fld[data-vid]'), files = [...e.target.files].slice(0, 12); e.target.value = ''; if (!w) return;
    w.style.opacity = '.6'; w.style.pointerEvents = 'none';
    let n = 0;
    for (const f of files) {
      try {
        DS.toast(`جاري رفع الصورة ${++n} من ${files.length}…`);
        const { url } = await DS.api('/upload', { method: 'POST', body: { image: await compressImage(f) } }); // sequential: one commit at a time
        w._v = w.dataset.t === 'img' ? [url] : w._v.concat(url); drawThumbs(w);
      } catch (er) { DS.toast(er.message, true); }
    }
    w.style.opacity = ''; w.style.pointerEvents = ''; if (n) DS.toast('تم رفع الصور ✔ (اتحفظت على GitHub)');
  };
  return root;
};
const lines = s => s.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
DS.collect = (root, schema) => {
  const out = {};
  for (const f of schema) {
    const w = root.querySelector(':scope > .fld[data-k="' + f.k + '"]');
    if (!w) continue;
    const t = f.t || 'text';
    if (t === 'i18n' || t === 'i18nlist') { const o = {}; w.querySelectorAll('[data-lg]').forEach(i => { if (t === 'i18n') { const x = i.value.trim(); if (x) o[i.dataset.lg] = x; } else { const arr = i.value.split('\n').map(z => z.trim()).filter(Boolean); if (arr.length) o[i.dataset.lg] = arr; } }); out[f.k] = o; }
    else if (t === 'img') out[f.k] = (w._v || [])[0] || '';
    else if (t === 'imgs') out[f.k] = (w._v || []).slice();
    else if (t === 'bool') out[f.k] = $('input', w).checked;
    else if (t === 'obj') out[f.k] = DS.collect(w.querySelector('.grid2'), f.sub);
    else if (t === 'list') out[f.k] = [...w.querySelectorAll(':scope > .items > .li')].map(l => DS.collect(l.querySelector('.grid2'), f.sub));
    else if (t === 'urls' || t === 'dates') out[f.k] = lines($('textarea', w).value);
    else if (t === 'textarea') out[f.k] = $('textarea', w).value.trim();
    else { const v = $('input,select', w).value.trim(); if (t === 'num') { if (v !== '') out[f.k] = Number(v); } else out[f.k] = v; }
  }
  return out;
};

// ---------- app shell ----------
let CFG, TOKEN = '', VIEWS = [], ME = null;
const sk = () => 'ds_sess_' + CFG.key;
function tokenExp(t) { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch { return 0; } }
DS.api = async (path, o = {}) => {
  if (window.DSX) {                                   // Supabase mode (see supabase-console.js)
    try { return await DSX.api(CFG, path, o); }
    catch (e) { if (e.status === 401) logout('الجلسة انتهت — سجّل دخول تاني'); throw e; }
  }
  const res = await fetch(CFG.api + path, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: o.body ? JSON.stringify(o.body) : undefined }).catch(() => { throw new Error('مفيش اتصال بالسيرفر'); });
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) { logout('الجلسة انتهت — سجّل دخول تاني'); throw new Error(d.error || 'الجلسة انتهت'); }
  if (!res.ok) throw new Error(d.error || 'فشل الطلب (' + res.status + ')');
  return d;
};
function logout(msg) {
  if (window.DSX) DSX.logout();
  try { localStorage.removeItem(sk()); } catch {} TOKEN = ''; ME = null;
  $('#app').classList.add('hide'); $('#login').classList.remove('hide');
  const e = $('#lerr'); e.textContent = msg || ''; e.classList.toggle('hide', !msg);
}
async function enter() {
  try { ME = await DS.api('/me'); } catch (e) { if (TOKEN) logout(e.message); return; }
  $('#login').classList.add('hide'); $('#app').classList.remove('hide');
  const nm = ME.name || ME.email || '؟', first = String(nm).trim().split(/\s+/)[0];
  document.querySelectorAll('.who').forEach(e => e.textContent = nm); document.querySelectorAll('.av').forEach(e => e.textContent = nm.trim()[0].toUpperCase()); document.querySelectorAll('.rl').forEach(e => e.textContent = CFG.roleLabel || '');
  const em = $('#pem'); if (em) em.textContent = ME.email || '';
  $('#greet').textContent = (new Date().getHours() < 12 ? 'صباح الخير، ' : 'مساء الخير، ') + first + ' 👋';
  try { const x = (await DS.api('/langs')).languages || []; x.forEach(l => { if (!DS.LANGS.includes(l.code)) DS.LANGS.push(l.code); DS.LN[l.code] = l.nativeName; }); } catch { /* built-in languages only */ }
  VIEWS = typeof CFG.views === 'function' ? CFG.views(ME) : CFG.views;
  $('#nav').innerHTML = VIEWS.map((v, i) => `<button data-i="${i}" data-tip="${esc(v.label)}" aria-label="${esc(v.label)}">${DS.ic(v.icon || 'home')}<span>${v.label}</span></button>`).join('');
  if (CFG.noSide) { $('#app').classList.add('noright'); const rp = $('#rightp'); if (rp) rp.remove(); } else DS.side();
  show(0);
}
// rail tooltips are one fixed element (a per-button tooltip would be clipped by the scrolling rail)
(() => { let tip; const T = () => tip || (tip = Object.assign(document.body.appendChild(document.createElement('div')), { id: 'tip' }));
  document.addEventListener('mouseover', e => { const b = e.target.closest('#nav button'); const t = T(); if (!b) { t.classList.remove('on'); return; } t.textContent = b.dataset.tip; const r = b.getBoundingClientRect(), rtl = getComputedStyle(document.body).direction === 'rtl'; t.style.top = (r.top + r.height / 2 - t.offsetHeight / 2) + 'px'; t.style.left = (rtl ? r.left - 12 - t.offsetWidth : r.right + 12) + 'px'; t.classList.add('on'); });
  document.addEventListener('mouseleave', () => tip && tip.classList.remove('on')); document.addEventListener('scroll', () => tip && tip.classList.remove('on'), true); })();
async function show(i) {
  $('#app').classList.remove('app-ed'); window.onbeforeunload = null;
  [...$('#nav').children].forEach((b, j) => b.classList.toggle('on', i === j));
  $('#ptitle').textContent = VIEWS[i].label; document.body.classList.remove('nav-open'); window.scrollTo(0, 0);
  const gs = $('#gs'); if (gs) gs.value = '';
  const m = $('#main'); m.onclick = null; m.innerHTML = '<div class="stats"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div><div class="skel" style="height:260px"></div>';
  try { await VIEWS[i].render(m); } catch (e) { m.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
// ---- right panel: profile, month calendar (days with bookings are dotted), next bookings ----
DS.side = async () => {
  const box = $('#rightp'); if (!box) return;
  let list = []; try { list = (await DS.api('/bookings')).bookings || []; } catch (e) { /* the panel just stays empty */ }
  const DEAD = ['cancelled', 'canceled', 'failed', 'refunded', 'rejected', 'expired'];
  const when = b => String(b.checkin || b.date || '').slice(0, 10);
  const live = list.filter(b => when(b) && !DEAD.includes(String(b.status || '').toLowerCase()));
  const byDay = new Set(live.map(when)), today = new Date(), iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), t0 = iso(today);
  let y = today.getFullYear(), mo = today.getMonth();
  const MN = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'], DN = (window.DS_ALANG === 'ar' ? ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'] : ['S', 'S', 'M', 'T', 'W', 'T', 'F']);   // week starts Saturday
  const upcoming = live.filter(b => when(b) >= t0).sort((a, b) => when(a).localeCompare(when(b))).slice(0, 4);
  const bk = VIEWS.findIndex(v => v.icon === 'cal');
  const cal = () => {
    const first = new Date(y, mo, 1), lead = (first.getDay() + 1) % 7, days = new Date(y, mo + 1, 0).getDate(); let c = '';
    for (let k = 0; k < lead; k++) c += '<span class="o"></span>';
    for (let d = 1; d <= days; d++) { const k = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); c += `<span class="${k === t0 ? 't ' : ''}${byDay.has(k) ? 'b' : ''}">${d}</span>`; }
    return `<div class="ch"><button data-m="1" aria-label="الشهر اللي بعده">${DS.ic('chevr')}</button><b>${MN[mo]} ${y}</b><button data-m="-1" aria-label="الشهر اللي قبله">${DS.ic('chevl')}</button></div><div class="cg">${DN.map(x => `<i>${x}</i>`).join('')}${c}</div>`;
  };
  box.innerHTML = `<div class="pc"><span class="av">${esc((ME.name || ME.email || '؟').trim()[0].toUpperCase())}</span><div><b>${esc(ME.name || ME.email || '')}</b><small>${esc(CFG.roleLabel || '')}${ME.email ? ' · ' + esc(ME.email) : ''}</small></div></div>
    <div class="pmini"><div><b>${live.length}</b><span>حجوزات نشطة</span></div><div><b>${upcoming.length ? upcoming.length : 0}</b><span>قادمة</span></div><div><b>${list.length}</b><span>الإجمالي</span></div></div>
    <div class="cal" id="cal">${cal()}</div>
    <div class="upt"><span>أقرب الحجوزات</span>${bk >= 0 ? '<a data-all="1">عرض الكل</a>' : ''}</div>
    <div class="upl">${upcoming.length ? upcoming.map(b => `<div class="upr" data-all="1"><span class="ic2">${DS.ic('cal')}</span><div><b>${esc(bItem(b))}</b><small>${esc(b.name || b.email || '')}</small></div><em>${esc(when(b).slice(5).replace('-', '/'))}</em></div>`).join('') : '<div class="upe">مفيش حجوزات قادمة</div>'}</div>`;
  box.onclick = e => {
    const m = e.target.closest('[data-m]'); if (m) { mo += +m.dataset.m; if (mo > 11) { mo = 0; y++; } if (mo < 0) { mo = 11; y--; } $('#cal').innerHTML = cal(); return; }
    if (e.target.closest('[data-all]') && bk >= 0) show(bk);
  };
};
DS.reload = () => { const i = [...$('#nav').children].findIndex(b => b.classList.contains('on')); show(Math.max(0, i)); };
DS.go = label => { const i = VIEWS.findIndex(v => v.label === label); if (i >= 0) show(i); };
document.documentElement.dataset.theme = 'dark';   // consoles are dark-only
DS.start = (cfg) => {
  CFG = cfg; document.title = cfg.title;
  document.body.innerHTML = `
  <div id="login"><div class="lbrand"><div><div class="brand">${logoMark()}<b>Discover<span>Sharm</span></b></div><h1 style="margin-top:38px">${esc(cfg.title)}</h1><p>لوحة تحكم متكاملة لإدارة الحجوزات والأرباح والمحتوى — بشكل آمن وسريع من أي جهاز.</p></div>
    <div class="lpts"><div>${DS.ic('shield')} صلاحيات محمية من السيرفر</div><div>${DS.ic('wallet')} محاسبة وأرباح شفافة</div><div>${DS.ic('trend')} تقارير وإحصائيات لحظية</div></div></div>
    <div class="lform"><form class="lcard" id="lf"><h2>تسجيل الدخول</h2><p>ادخل بحسابك للمتابعة</p><div id="lerr" class="err hide"></div>
    <div class="fld"><label>البريد الإلكتروني</label><input id="em" type="email" autocomplete="username" required></div>
    <div class="fld"><label>كلمة المرور</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <button class="btn" style="width:100%;padding:13px" id="lb">دخول</button></form></div></div>
  <div id="app" class="hide"><aside class="side"><div class="brand">${logoMark()}</div><nav id="nav" aria-label="القائمة"></nav>
    <div class="sfoot"><button id="out" title="خروج">${DS.ic('out')}</button></div></aside>
    <div class="content"><header class="top"><div class="greet"><h1 id="greet"></h1><p id="ptitle"></p></div>
      <label class="sbox">${DS.ic('search')}<input id="gs" type="search" placeholder="ابحث في الصفحة..." autocomplete="off"></label>
      <button class="ib" id="rf" title="تحديث">${DS.ic('refresh')}</button><button class="ib mob" id="out2" title="خروج">${DS.ic('out')}</button></header><main id="main"></main></div>
    <aside class="rightp" id="rightp"></aside></div><div id="scrim"></div><div id="toast"></div>`;
  $('#rf').onclick = () => { DS.reload(); DS.side(); };
  $('#gs').oninput = e => {   // live filter of whatever the current page lists (table rows, content cards, review cards)
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#main tbody tr, #main .igrid .ic, #main .rvgrid .rv-card, #main .upl .upr').forEach(el => { el.style.display = !q || el.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  };
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const b = $('#lb'); b.disabled = true; $('#lerr').classList.add('hide');
    try {
      if (window.DSX) { await DSX.login($('#em').value.trim(), $('#pw').value); TOKEN = 'sb'; $('#pw').value = ''; await enter(); b.disabled = false; return; }
      const r = await fetch('/api/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#em').value.trim(), password: $('#pw').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.idToken) throw new Error(r.status === 429 ? 'محاولات كتير — استنى شوية' : 'الإيميل أو الباسورد غلط');
      TOKEN = d.idToken; localStorage.setItem(sk(), JSON.stringify({ t: TOKEN })); $('#pw').value = ''; await enter();
    } catch (er) { $('#lerr').textContent = er.message; $('#lerr').classList.remove('hide'); }
    b.disabled = false;
  };
  $('#out').onclick = () => logout(); $('#out2').onclick = () => logout();
  $('#nav').onclick = e => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); };
  if (window.DSX) { DSX.session().then(ok => { if (ok) { TOKEN = 'sb'; enter(); } }); return; }
  try { const s = JSON.parse(localStorage.getItem(sk()) || 'null'); if (s && tokenExp(s.t) > Date.now() + 60000) { TOKEN = s.t; enter(); } } catch {}
};

// ---------- bookings view (owner + admin) ----------
const FL = { id: 'رقم الحجز', name: 'الاسم', email: 'الإيميل', phone: 'التليفون', requests: 'طلبات خاصة', checkin: 'الوصول', checkout: 'المغادرة', nights: 'الليالي', rooms: 'عدد الغرف', roomType: 'نوع الغرفة', adults: 'بالغين', children: 'أطفال', childAges: 'أعمار الأطفال', infants: 'رُضّع', guests: 'الضيوف', date: 'التاريخ', time: 'الوقت', participants: 'عدد الأفراد', passengers: 'عدد الركاب', direction: 'الاتجاه', flightNo: 'رقم الرحلة', address: 'العنوان', payment: 'طريقة الدفع', total: 'الإجمالي', currency: 'العملة', createdAt: 'وقت الحجز', paidAt: 'وقت الدفع', cancelReason: 'سبب الإلغاء' };
const bItem = b => tr(b.hotelName || b.title || b.vehicleType) || '—';
const bWhen = b => b.checkin ? `${b.checkin} ← ${b.checkout || ''}` : `${b.date || ''} ${b.time || ''}`;
const bQty = b => b.type === 'hotel' ? `${b.adults || 0} + ${b.children || 0}` : (b.participants || b.passengers || '');
const TYPE_L = { hotel: 'فندق', excursion: 'رحلة', transfer: 'ترانسفير' };
const DONE_L = { hotel: 'النزيل وصل وسكن ✔', excursion: 'الرحلة تمت ✔', transfer: 'التوصيل تم ✔' };
const ownOpts = b => Object.entries(OWN).map(([k, v]) => `<option value="${k}" ${k === (b.ownerStatus || 'new') ? 'selected' : ''}>${k === 'done' ? DONE_L[b.type] : v[0]}</option>`).join('');
DS.bookingsView = (o = {}) => async (m) => {
  const admin = !!o.admin, pre = admin ? '/bookings' : '/bookings';
  let f = { s: '', q: '', t: '', own: '' }, list = [];
  const load = async () => { const qs = admin ? '?' + ['status=' + f.s, 'type=' + f.t, 'owner=' + f.own].join('&') : ''; list = (await DS.api(pre + qs)).bookings; };
  const view = () => {
    const q = f.q.toLowerCase();
    const rows = list.filter(b => (admin || !f.s || b.status === f.s) && (!q || JSON.stringify([b.id, b.name, b.phone, b.email, bItem(b)]).toLowerCase().includes(q)));
    const chips = ['', ...Object.keys(PAY)].map(k => `<span class="chip ${f.s === k ? 'on' : ''}" data-s="${k}">${k ? PAY[k][0] : 'الكل'}</span>`).join('');
    const own = admin ? `<select id="fo" style="max-width:200px"><option value="">كل الأونرز</option>${o.roles.filter(r => r.role !== 'super_admin').map(r => `<option value="${r.uid}" ${f.own === r.uid ? 'selected' : ''}>${esc(r.name || r.email)}</option>`).join('')}</select><select id="ft" style="max-width:130px"><option value="">كل الأنواع</option>${Object.entries(TYPE_L).map(([k, v]) => `<option value="${k}" ${f.t === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : '';
    const cols = [{ h: 'الحجز', f: b => `<b>${esc(b.id)}</b><div class="muted">${DS.dt(b.createdAt)}</div>` }, ...(admin ? [{ h: 'النوع', f: b => TYPE_L[b.type] || b.type }] : []),
      { h: 'العميل', f: b => `${esc(b.name || '')}<div class="muted">${esc(b.phone || '')}</div>` }, { h: 'الحجز على', f: b => `${esc(bItem(b))}<div class="muted">${esc(bWhen(b))}</div>` }, { h: 'العدد', f: bQty },
      { h: 'الإجمالي', f: b => DS.money(b.total) + ' ' + esc(b.currency || '') }, { h: 'الدفع', f: b => DS.badge(PAY, b.status) + (b.needsRefund && b.status !== 'refunded' ? ' <span class="badge b-red">استرداد مطلوب</span>' : '') }, { h: 'التنفيذ', f: b => DS.badge(OWN, b.ownerStatus || 'new') }, { h: admin ? 'العمولة' : 'صافي ربحك', f: b => !b.earning || b.earning.void ? '<span class="muted">—</span>' : DS.money(admin ? b.earning.commission : b.earning.net) }];
    m.innerHTML = `<h2 class="pt">الحجوزات <span class="muted">${rows.length}</span></h2><div class="chips">${chips}</div><div class="row" style="margin-bottom:12px"><input id="fq" placeholder="ابحث بالاسم / التليفون / رقم الحجز" value="${esc(f.q)}" style="max-width:320px">${own}</div>` + DS.table(cols, rows, { click: true, empty: 'مفيش حجوزات' });
    m.onclick = async e => {
      const c = e.target.closest('.chip'); if (c) { f.s = c.dataset.s; if (admin) await load(); view(); return; }
      const r = e.target.closest('tr[data-i]'); if (r) detail(rows[+r.dataset.i]);
    };
    $('#fq').oninput = e => { f.q = e.target.value; const p = e.target.selectionStart; view(); const i = $('#fq'); i.focus(); i.setSelectionRange(p, p); };
    if (admin) { $('#fo').onchange = async e => { f.own = e.target.value; await load(); view(); }; $('#ft').onchange = async e => { f.t = e.target.value; await load(); view(); }; }
  };
  const detail = (b) => {
    const kv = Object.keys(FL).filter(k => b[k] !== undefined && b[k] !== '' && !(Array.isArray(b[k]) && !b[k].length)).map(k => `<b>${FL[k]}</b><span>${esc(Array.isArray(b[k]) ? b[k].join(', ') : k === 'createdAt' ? DS.dt(b[k]) : k === 'roomType' ? tr(b[k]) : b[k])}</span>`).join('');
    const body = document.createElement('div');
    const vch = admin && b.voucher ? `<b>الفاوتشر</b><span>${b.voucher.status === 'sent' ? 'اتبعت على ' + esc(b.voucher.to) : 'فشل الإرسال: ' + esc(b.voucher.error || '')}</span>` : '';
    body.innerHTML = `<div class="kv"><b>الحجز على</b><span>${esc(bItem(b))}</span>${kv}${vch}</div>
      ${admin ? `<div class="fld"><label>حالة الدفع</label><select id="bs">${DS.opts(PAY, b.status)}</select></div><div class="fld"><label>ملاحظة الإدارة</label><textarea id="ba">${esc(b.adminNote || '')}</textarea></div>` : ''}
      <div class="fld"><label>حالة التنفيذ</label><select id="bo" ${b.earning && !admin ? 'disabled' : ''}>${ownOpts(b)}</select>
        <small>${b.earning ? (b.earning.void ? 'الأرباح اتلغت (استرداد/تعديل).' : `الأرباح اتسجّلت: صافي ${DS.money(b.earning.net)} جنيه بعد عمولة ${b.earning.rate}%` + (admin ? ` (${DS.money(b.earning.commission)})` : '') + ' — مينفعش تتغيّر.') : 'اختيار "' + DONE_L[b.type] + '" بيسجّل أرباحك (بعد عمولة المنصة) ومينفعش يتراجع. بيتفتح بعد ميعاد الخدمة وبعد الدفع.'}</small></div>
      <div class="fld"><label>ملاحظة (بتظهر لك${admin ? ' وللأونر' : ' بس'})</label><textarea id="bn">${esc(b.ownerNote || '')}</textarea></div>`;
    const actions = [{ t: 'حفظ', fn: async () => {
      const body2 = { ownerNote: $('#bn', body).value }; if (!$('#bo', body).disabled) body2.ownerStatus = $('#bo', body).value;
      if (admin) { body2.status = $('#bs', body).value; body2.adminNote = $('#ba', body).value; }
      await DS.api(pre + '/' + encodeURIComponent(b.id), { method: 'PUT', body: body2 }); DS.toast('اتحفظ'); await load(); view();
    } }];
    if (!admin && !['cancelled', 'refunded', 'failed'].includes(b.status)) actions.push({ t: 'إلغاء الحجز', cls: 'red', fn: async () => {
      const why = prompt('سبب الإلغاء (هيوصل للإدارة):'); if (why === null) return false;
      await DS.api(pre + '/' + encodeURIComponent(b.id) + '/cancel', { method: 'POST', body: { reason: why } }); DS.toast('اتلغى'); await load(); view();
    } });
    if (admin && ['pending_payment', 'failed', 'cancelled'].includes(b.status)) actions.push({ t: 'مسح', cls: 'red', fn: async () => {
      if (!confirm('مسح الحجز نهائيًا؟')) return false; await DS.api(pre + '/' + encodeURIComponent(b.id), { method: 'DELETE' }); await load(); view();
    } });
    DS.modal({ title: 'حجز ' + b.id, body, actions });
  };
  await load(); view();
};



// ---------- reviews (same look as the public site: avatar, Verified badge, stars, photos, rating bars) + replies ----------
DS.lightbox = (imgs, i = 0) => { const b = document.createElement('div'); b.innerHTML = imgs.map(u => `<img src="${esc(DS.safeSrc(u))}" style="width:100%;border-radius:12px;margin-bottom:10px">`).join(''); DS.modal({ title: `الصور (${imgs.length})`, body: b, wide: true, onOpen: mb => { const t = mb.children[i]; if (t) t.scrollIntoView(); } }); };
DS.reviewsView = (o = {}) => async (m) => {
  let list = (await DS.api('/reviews')).reviews, f = { item: '', star: 0, open: false };
  const stars = n => `<span class="stars">${'★'.repeat(Math.round(n))}<i>${'★'.repeat(5 - Math.round(n))}</i></span>`;
  const rp = r => o.admin ? `/reviews/${encodeURIComponent(r.type)}/${encodeURIComponent(r.itemId)}/${encodeURIComponent(r.id)}` : `/reviews/${encodeURIComponent(r.itemId)}/${encodeURIComponent(r.id)}`;
  const items = [...new Map(list.map(r => [r.type + '/' + r.itemId, r.itemName || r.itemId])).entries()];
  const draw = () => {
    const rows = list.filter(r => (!f.item || r.type + '/' + r.itemId === f.item) && (!f.star || Math.round(r.rating) === f.star) && (!f.open || !r.reply));
    const base = list.filter(r => !f.item || r.type + '/' + r.itemId === f.item), avg = base.length ? base.reduce((a, r) => a + Number(r.rating || 0), 0) / base.length : 0;
    const cnt = [5, 4, 3, 2, 1].map(s => base.filter(r => Math.round(r.rating) === s).length), mx = Math.max(1, ...cnt);
    m.innerHTML = `<h2 class="pt">التقييمات والتعليقات <span class="muted">${rows.length}</span></h2>
      <div class="card rv-sum"><div class="rv-avg"><b>${avg ? avg.toFixed(1) : '–'}</b>${stars(avg)}<span class="muted">${base.length} تقييم موثّق</span></div><div class="rv-bars">${[5, 4, 3, 2, 1].map((s, i) => `<div class="rating-bar-row"><span>${s} ★</span><div class="tr"><i style="width:${cnt[i] / mx * 100}%"></i></div><span>${cnt[i]}</span></div>`).join('')}</div></div>
      <div class="row" style="margin-bottom:12px"><select id="ri" style="max-width:260px"><option value="">كل العناصر</option>${items.map(([k, n]) => `<option value="${esc(k)}" ${f.item === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <div class="chips" style="margin:0">${[0, 5, 4, 3, 2, 1].map(s => `<span class="chip ${f.star === s ? 'on' : ''}" data-st="${s}">${s ? s + ' ★' : 'الكل'}</span>`).join('')}<span class="chip ${f.open ? 'on' : ''}" data-open="1">بدون رد</span></div></div>` +
      (rows.length ? `<div class="rvgrid">${rows.map((r, i) => { const ph = r.images && r.images.length ? r.images : (r.image ? [r.image] : []), ini = (r.name || 'G').trim().charAt(0).toUpperCase();
        return `<div class="rv-card"><div class="rv-head"><div class="rv-av">${r.photoURL && DS.safeSrc(r.photoURL) ? `<img src="${esc(DS.safeSrc(r.photoURL))}" alt="">` : esc(ini)}</div><div class="fl"><b>${esc(r.name || 'Guest')}</b><div class="muted"><span class="badge b-green">✔ Verified</span> · ${r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB') : ''}</div></div><span class="badge b-gray">${esc(r.itemName || '')}</span></div>
          <div class="rv-stars">${stars(r.rating)}</div><p class="rv-c">${esc(r.comment || '')}</p>
          ${ph.length ? `<div class="rv-ph">${ph.slice(0, 3).map((u, k) => `<div data-ph="${i}:${k}"><img src="${esc(DS.safeSrc(u))}" alt="">${k === 2 && ph.length > 3 ? `<span>+${ph.length - 3}</span>` : ''}</div>`).join('')}</div>` : ''}
          ${r.reply && r.reply.text ? `<div class="rv-reply"><div class="rv-rh">${DS.ic('mail')} رد ${esc(r.reply.byName || '')} <span class="muted">· ${DS.dt(r.reply.at)}</span></div><p>${esc(r.reply.text)}</p></div>` : ''}
          <div class="row" style="margin-top:12px"><button class="btn sm" data-re="${i}">${r.reply ? 'تعديل الرد' : 'رد على التعليق'}</button>${r.reply ? `<button class="btn ghost sm" data-rd="${i}">حذف الرد</button>` : ''}${o.admin ? `<button class="btn ghost sm" data-dr="${i}">حذف التعليق</button>` : ''}</div></div>`; }).join('')}</div>` : '<div class="empty">مفيش تعليقات</div>');
    $('#ri', m).onchange = e => { f.item = e.target.value; draw(); };
    m.onclick = async e => {
      const st = e.target.closest('[data-st]'); if (st) { f.star = +st.dataset.st; return draw(); }
      if (e.target.closest('[data-open]')) { f.open = !f.open; return draw(); }
      const ph = e.target.closest('[data-ph]'); if (ph) { const [i, k] = ph.dataset.ph.split(':'), r = rows[+i]; return DS.lightbox(r.images && r.images.length ? r.images : [r.image], +k); }
      const re = e.target.closest('[data-re]'), rd = e.target.closest('[data-rd]'), dr = e.target.closest('[data-dr]');
      try {
        if (re) { const r = rows[+re.dataset.re], b = document.createElement('div'); b.innerHTML = `<div class="rv-card" style="margin-bottom:12px"><b>${esc(r.name)}</b> ${stars(r.rating)}<p class="rv-c">${esc(r.comment || '')}</p></div><div class="fld"><label>ردك (بيظهر تحت التعليق في الموقع)</label><textarea id="rt" maxlength="1000" rows="4">${esc(r.reply ? r.reply.text : '')}</textarea></div>`;
          DS.modal({ title: 'الرد على التعليق', body: b, actions: [{ t: 'نشر الرد', fn: async () => { const rep = (await DS.api(rp(r) + '/reply', { method: 'PUT', body: { text: $('#rt', b).value } })).reply; r.reply = rep; DS.toast('اتنشر'); draw(); } }] }); }
        if (rd && confirm('حذف الرد؟')) { const r = rows[+rd.dataset.rd]; await DS.api(rp(r) + '/reply', { method: 'DELETE' }); delete r.reply; draw(); }
        if (dr && confirm('حذف التعليق نهائيًا؟')) { const r = rows[+dr.dataset.dr]; await DS.api(rp(r), { method: 'DELETE' }); list = list.filter(x => x !== r); draw(); }
      } catch (er) { DS.toast(er.message, true); }
    };
  };
  draw();
};
// ---------- owner finance view ----------
DS.financeView = () => async (m) => {
  const d = await DS.api('/finance'), S = d.summary, open = d.payouts.find(p => p.status === 'requested');
  const PS = { requested: ['قيد المراجعة', 'amber'], paid: ['اتحوّل', 'green'], rejected: ['مرفوض', 'red'], cancelled: ['ملغي', 'gray'] };
  const a = d.account || {}, ip = a.instapay || {}, bk = a.bank || {};
  const byMonth = {}; d.earnings.forEach(e => { const k = String(e.serviceDate || e.at).slice(0, 7); const x = byMonth[k] = byMonth[k] || { n: 0, g: 0, c: 0, net: 0 }; x.n++; x.g += e.gross; x.c += e.commission; x.net += e.net; });
  m.innerHTML = `<h2 class="pt">المحاسبة</h2><div class="stats">${DS.stat(DS.money(S.available), 'متاح للصرف (جنيه)')}${DS.stat(DS.money(S.earned), 'إجمالي أرباحك المسجّلة')}${DS.stat(DS.money(S.paid), 'اتحوّل لك')}${DS.stat(DS.money(S.pending), 'طلب صرف قيد المراجعة')}</div>
    <div class="card muted" style="line-height:1.9">• الأرباح بتظهر بعد ما تسجّل الحجز "تم" (وصول النزيل / الرحلة / التوصيل) بعد ميعاد الخدمة.<br>• عمولة المنصة عليك: <b>${d.rate}%</b> بتتخصم وقت تسجيل التنفيذ. • أقل مبلغ للصرف: <b>${DS.money(d.minPayout)}</b> جنيه.</div>
    <div class="card"><b>حساب استلام الأرباح</b><div class="muted" style="margin:6px 0 12px">${d.account ? 'الحالي: ' + DS.METHOD[a.method] + ' — ' + esc(DS.acctText(a)) : 'لسه مضفتش حساب'}</div>
      ${d.accountLockMs ? `<div class="err" style="background:var(--abg);color:var(--amber)">اتغيّر الحساب حديثًا — طلب الصرف يتفتح بعد ${Math.ceil(d.accountLockMs / 3600000)} ساعة (حماية لحسابك).</div>` : ''}
      <div class="fld"><label>طريقة الاستلام</label><select id="pm"><option value="instapay" ${a.method !== 'bank' ? 'selected' : ''}>إنستا باي</option><option value="bank" ${a.method === 'bank' ? 'selected' : ''}>تحويل بنكي</option></select></div>
      <div id="pi" class="grid2"><div class="fld"><label>عنوان إنستا باي (handle) أو رقم المحفظة</label><input id="i1" dir="ltr" value="${esc(ip.handle || '')}"></div><div class="fld"><label>الاسم</label><input id="i2" value="${esc(ip.name || '')}"></div><div class="fld"><label>رقم الموبايل</label><input id="i3" dir="ltr" value="${esc(ip.phone || '')}"></div></div>
      <div id="pb" class="grid2 hide"><div class="fld"><label>اسم البنك</label><input id="b1" value="${esc(bk.bankName || '')}"></div><div class="fld"><label>اسم صاحب الحساب</label><input id="b2" value="${esc(bk.accountName || '')}"></div><div class="fld"><label>رقم الحساب</label><input id="b3" dir="ltr" value="${esc(bk.accountNumber || '')}"></div><div class="fld"><label>IBAN</label><input id="b4" dir="ltr" value="${esc(bk.iban || '')}"></div><div class="fld"><label>الفرع</label><input id="b5" value="${esc(bk.branch || '')}"></div></div>
      <button class="btn" id="sa">حفظ حساب الاستلام</button></div>
    <div class="card"><b>طلب صرف</b>${open ? `<div class="row" style="margin-top:10px">${DS.money(open.amount)} جنيه — ${DS.badge(PS, 'requested')} <button class="btn ghost sm" id="cx">إلغاء الطلب</button></div>` :
      `<div class="row" style="margin-top:10px"><input id="am" type="number" min="0" placeholder="المبلغ" style="max-width:180px"><button class="btn" id="rq" ${S.available >= d.minPayout ? '' : 'disabled'}>اطلب الصرف</button><span class="muted">المتاح ${DS.money(S.available)}</span></div>`}</div>
    <h2 class="pt" style="margin-top:18px">الأرباح المسجّلة <button class="btn ghost sm" id="ce">تصدير CSV</button></h2>` +
    DS.table([{ h: 'الحجز', f: e => esc(e.id) }, { h: 'العنصر', f: e => `${esc(e.item)}<div class="muted">${esc(e.customer)}</div>` }, { h: 'تاريخ الخدمة', f: e => esc(e.serviceDate) }, { h: 'المبلغ', f: e => DS.money(e.gross) }, { h: 'العمولة', f: e => `${DS.money(e.commission)} <span class="muted">(${e.rate}%)</span>` }, { h: 'صافي ربحك', f: e => `<b>${DS.money(e.net)}</b>` }], d.earnings, { empty: 'مفيش أرباح لسه — هتظهر بعد تسجيل تنفيذ الخدمات' }) +
    `<h2 class="pt" style="margin-top:18px">ملخص شهري</h2>` + DS.table([{ h: 'الشهر', f: r => r[0] }, { h: 'خدمات', f: r => r[1].n }, { h: 'المبلغ', f: r => DS.money(r[1].g) }, { h: 'العمولة', f: r => DS.money(r[1].c) }, { h: 'صافي', f: r => DS.money(r[1].net) }], Object.entries(byMonth).sort().reverse(), { empty: '—' }) +
    `<h2 class="pt" style="margin-top:18px">عمليات الصرف</h2>` + DS.table([{ h: 'الرقم', f: p => esc(p.id) }, { h: 'المبلغ', f: p => DS.money(p.amount) }, { h: 'الطريقة', f: p => DS.METHOD[p.method] || '' }, { h: 'التاريخ', f: p => DS.dt(p.paidAt || p.requestedAt) }, { h: 'الحالة', f: p => DS.badge(PS, p.status) }, { h: 'مرجع / ملاحظة', f: p => esc(p.reference || p.note || '') }], d.payouts, { empty: 'مفيش عمليات صرف' }) +
    (d.adjustments.length ? `<h2 class="pt" style="margin-top:18px">تسويات من الإدارة</h2>` + DS.table([{ h: 'التاريخ', f: x => DS.dt(x.createdAt) }, { h: 'المبلغ', f: x => (x.amount > 0 ? '+' : '') + DS.money(x.amount) }, { h: 'السبب', f: x => esc(x.reason) }], d.adjustments) : '');
  const sync = () => { const b = $('#pm').value === 'bank'; $('#pi').classList.toggle('hide', b); $('#pb').classList.toggle('hide', !b); }; sync(); $('#pm').onchange = sync;
  const act = (id, fn) => { const el = $(id); if (el) el.onclick = async () => { try { await fn(); } catch (e) { DS.toast(e.message, true); } }; };
  act('#sa', async () => { const bank = $('#pm').value === 'bank'; await DS.api('/payout-account', { method: 'PUT', body: bank ? { method: 'bank', bank: { bankName: $('#b1').value, accountName: $('#b2').value, accountNumber: $('#b3').value, iban: $('#b4').value, branch: $('#b5').value } } : { method: 'instapay', instapay: { handle: $('#i1').value, name: $('#i2').value, phone: $('#i3').value } } }); DS.toast('اتحفظ'); DS.reload(); });
  act('#rq', async () => { if (!confirm('تأكيد طلب الصرف على الحساب المسجّل؟')) return; await DS.api('/payouts', { method: 'POST', body: { amount: Number($('#am').value) } }); DS.toast('اتبعت للإدارة'); DS.reload(); });
  act('#cx', async () => { await DS.api('/payouts/' + encodeURIComponent(open.id), { method: 'DELETE' }); DS.reload(); });
  act('#ce', async () => DS.csv('earnings.csv', ['الحجز', 'العنصر', 'العميل', 'تاريخ الخدمة', 'المبلغ', 'نسبة العمولة %', 'العمولة', 'الصافي'], d.earnings.map(e => [e.id, e.item, e.customer, e.serviceDate, e.gross, e.rate, e.commission, e.net])));
};
// ---------- owner panel factory (trips / hotels / transfers) ----------
DS.ownerPanel = (c) => {
  const items = async () => (await DS.api('/items')).items;
  DS.start({ key: c.key, title: c.title, roleLabel: c.roleLabel, api: c.api, views: (me) => [
    { label: 'الرئيسية', icon: 'home', render: async m => {
      const [it, bk, fn] = await Promise.all([items(), DS.api('/bookings'), DS.api('/finance')]); const b = bk.bookings, S = fn.summary;
      const days = DS.daysBack(14), cnt = Object.fromEntries(days.map(d => [d, 0])); b.forEach(x => { const d = String(x.createdAt).slice(0, 10); if (d in cnt) cnt[d]++; });
      const mon = {}; fn.earnings.forEach(e => { const k = String(e.serviceDate || e.at).slice(0, 7); mon[k] = (mon[k] || 0) + e.net; }); const mk = Object.keys(mon).sort().slice(-6);
      const st = {}; b.forEach(x => st[x.status] = (st[x.status] || 0) + 1);
      const wait = b.filter(x => !x.earning && x.status === 'completed').length;
      m.innerHTML = DS.hero('أهلاً ' + esc(me.name || ''), new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), `<button class="btn" data-go="${c.itemsLabel}">${DS.ic('plus')} ${c.addLabel}</button><button class="btn ghost" data-go="المحاسبة">${DS.ic('wallet')} المحاسبة</button>`) +
        `<div class="stats">${DS.stat(it.length + (me.maxItems ? ' / ' + me.maxItems : ''), c.itemsLabel, { icon: 'box', tone: 'gold' })}${DS.stat(b.length, 'كل الحجوزات', { icon: 'cal' })}${DS.stat(wait, 'مدفوعة وبانتظار تسجيل التنفيذ', { icon: 'alert', tone: wait ? 'red' : 'green' })}${DS.stat(DS.money(S.available), 'أرباح متاحة للصرف (جنيه)', { icon: 'wallet', tone: 'green' })}${DS.stat(DS.money(S.earned), 'إجمالي أرباحك المسجّلة', { icon: 'trend', tone: 'purple' })}</div>
        <div class="g2"><div class="card"><span class="ct">الحجوزات — آخر 14 يوم</span>${DS.area(days.map(d => d.slice(5).replace('-', '/')), days.map(d => cnt[d]), 'var(--blue)', 'o1')}</div>
          <div class="card"><span class="ct">حالة الحجوزات</span>${DS.donut(Object.entries(st).map(([k, v]) => ({ l: DS.PAY[k] ? DS.PAY[k][0] : k, v, c: DS.STC[k] || '#999' })))}</div></div>
        <div class="g2"><div class="card"><span class="ct">صافي أرباحك بالشهر (جنيه)</span>${mk.length ? DS.bars(mk, mk.map(k => Math.round(mon[k])), 'var(--green)') : '<div class="empty">الأرباح بتظهر بعد تسجيل تنفيذ الخدمات</div>'}</div>
          <div class="card"><span class="ct">تنبيهات</span>${wait ? `<p>عندك <b>${wait}</b> حجز مدفوع بانتظار تسجيل التنفيذ — سجّله بعد ميعاد الخدمة عشان أرباحك تظهر.</p><button class="btn sm" style="margin-top:10px" data-go="الحجوزات">فتح الحجوزات</button>` : '<p class="muted">كل حاجة تمام ✔ مفيش حاجة معلّقة.</p>'}<p class="muted" style="margin-top:12px">نسبة عمولة المنصة عليك: <b>${fn.rate}%</b> (على السعر قبل الضرائب).</p></div></div>
        <h2 class="pt">آخر الحجوزات</h2>` + DS.table([{ h: 'الحجز', f: x => `<b>${esc(x.id)}</b><div class="muted">${DS.dt(x.createdAt)}</div>` }, { h: 'العميل', f: x => esc(x.name || '') }, { h: 'على', f: x => esc(bItem(x)) }, { h: 'الإجمالي', f: x => DS.money(x.total) }, { h: 'الدفع', f: x => DS.badge(PAY, x.status) }], b.slice(0, 6), { empty: 'مفيش حجوزات لسه' });
      m.onclick = e => { const g = e.target.closest('[data-go]'); if (g) DS.go(g.dataset.go); };
    } },
    { label: c.itemsLabel, icon: 'box', render: async m => {
      const list = await items(), full = me.maxItems && list.length >= me.maxItems;
      m.innerHTML = `<h2 class="pt">${c.itemsLabel} <span class="row"><span class="muted">${me.maxItems ? `الحد الأقصى ${me.maxItems}` : ''}</span><button class="btn" id="add" ${full ? 'disabled' : ''}>+ ${c.addLabel}</button></span></h2>` +
        DS.table([{ h: '', f: i => DS.thumb(i.image || (i.images || [])[0]) }, { h: 'الاسم', f: i => `<b>${esc(tr(c.title_of(i)))}</b><div class="muted">${esc(i.id)}${i.status && i.status !== 'published' ? ` <span class="badge b-amber">${({ draft: 'مسودة', pending_review: 'بانتظار مراجعة الإدارة' })[i.status] || esc(i.status)}</span>` : ''}</div>` }, { h: 'السعر', f: i => DS.money(i.price) + ' EGP' },
          { h: 'التقييم', f: i => i.rating ? '★ ' + Number(i.rating).toFixed(1) : '—' },
          { h: '', f: i => `<button class="btn ghost sm" data-e="${esc(i.id)}">تعديل</button> <button class="btn ghost sm" data-d="${esc(i.id)}">حذف</button>` }], list, { empty: `لسه مضفتش ${c.itemsLabel}` });
      const TYPE = { trips: 'excursion', hotels: 'hotel', transfers: 'transfer' }[c.key];
      const edit = (it) => {   // full-page editor (editor.js) — replaces the old pop-up form
        DS.itemEditor(m, { type: TYPE, item: it || {}, onBack: () => DS.reload(),
          save: async body => { await DS.api(it ? '/items/' + encodeURIComponent(it.id) : '/items', { method: it ? 'PUT' : 'POST', body }); if (!it) me.itemCount++; } });
      };
      $('#add').onclick = () => edit(null);
      m.onclick = async e => {
        const ed = e.target.closest('[data-e]'), de = e.target.closest('[data-d]');
        if (ed) edit(list.find(i => i.id === ed.dataset.e));
        if (de && confirm('تأكيد الحذف؟ الحجوزات القديمة هتفضل محفوظة.')) { await DS.api('/items/' + encodeURIComponent(de.dataset.d), { method: 'DELETE' }); DS.toast('اتحذف'); DS.reload(); }
      };
    } },
    { label: 'الحجوزات', icon: 'cal', render: DS.bookingsView({}) },
    { label: 'المحاسبة', icon: 'wallet', render: DS.financeView() },
    ...(me.hasReviews ? [{ label: 'التقييمات', icon: 'star', render: DS.reviewsView({}) }] : []),
  ] });
};
})();
