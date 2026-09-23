/* Discover Sharm — shared console framework (login, api, forms, tables, owner panels). No dependencies. */
(function () {
'use strict';
const DS = window.DS = {};
const LANGS = ['ar', 'en', 'ru', 'de', 'it', 'tr'];
const LN = { ar: 'العربية', en: 'English', ru: 'Русский', de: 'Deutsch', it: 'Italiano', tr: 'Türkçe' };
const $ = (s, r) => (r || document).querySelector(s);
const esc = DS.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tr = DS.tr = o => (o && typeof o === 'object') ? (o.ar || o.en || Object.values(o).find(Boolean) || '') : (o == null ? '' : o);
DS.money = n => Number(n || 0).toLocaleString('en-US');
DS.dt = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

// ---------- badges ----------
const PAY = { pending_payment: ['بانتظار الدفع', 'amber'], completed: ['مدفوع', 'green'], failed: ['فشل', 'red'], cancelled: ['ملغي', 'gray'], refunded: ['مسترد', 'purple'] };
const OWN = { new: ['جديد', 'blue'], confirmed: ['مؤكد', 'green'], done: ['تم', 'green'], no_show: ['لم يحضر', 'red'] };
DS.PAY = PAY; DS.OWN = OWN;
DS.badge = (map, k) => { const v = map[k]; return v ? `<span class="badge b-${v[1]}">${v[0]}</span>` : `<span class="badge b-gray">${esc(k || '—')}</span>`; };
DS.opts = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v[0]}</option>`).join('');

// ---------- toast / modal ----------
DS.toast = (msg, bad) => { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(t._t); t._t = setTimeout(() => t.className = '', 3400); };
DS.modal = ({ title, body, actions, onOpen }) => {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="md"><div class="mh"><span>${esc(title)}</span><button class="x" type="button">×</button></div><div class="mb"></div><div class="mf"></div></div>`;
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
    `<tr ${o.click ? `class="click" data-i="${i}"` : ''}>${cols.map(c => `<td>${c.f(r, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
DS.thumb = u => u ? `<img class="thumb" src="${esc(u)}" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="thumb" style="display:inline-block"></span>';

// ---------- form engine (schema-driven) ----------
// field: { k, l, t: text|num|url|select|textarea|urls|dates|i18n|i18nlist|list, opts, long, sub, h }
let dl = 0;
function fld(f, v) {
  const t = f.t || 'text', hint = f.h ? `<small>${esc(f.h)}</small>` : '';
  let inner = '';
  if (t === 'i18n' || t === 'i18nlist') {
    const area = f.long || t === 'i18nlist';
    const one = lg => { let x = v && v[lg]; if (t === 'i18nlist') x = Array.isArray(x) ? x.join('\n') : ''; 
      return `<div class="lg"><b>${LN[lg]}</b>${area ? `<textarea data-lg="${lg}" rows="3">${esc(x || '')}</textarea>` : `<input data-lg="${lg}" value="${esc(x || '')}">`}</div>`; };
    inner = LANGS.slice(0, 2).map(one).join('') + `<details><summary>لغات تانية (ru / de / it / tr)</summary>${LANGS.slice(2).map(one).join('')}</details>`;
    if (t === 'i18nlist') hint || (inner += '<small>كل سطر = عنصر</small>');
  } else if (t === 'list') {
    inner = `<div class="items">${(Array.isArray(v) ? v : []).map(it => li(f, it)).join('')}</div><button type="button" class="btn ghost sm" data-add>+ ${esc(f.add || 'إضافة')}</button>`;
  } else if (t === 'select') {
    inner = `<select>${f.opts.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${ov === v ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
  } else if (t === 'textarea' || t === 'urls' || t === 'dates') {
    const x = Array.isArray(v) ? v.join('\n') : (v || '');
    inner = `<textarea rows="${t === 'textarea' ? 3 : 4}" placeholder="${t === 'urls' ? 'رابط في كل سطر' : t === 'dates' ? 'تاريخ في كل سطر: 2026-10-25' : ''}">${esc(x)}</textarea>`;
  } else {
    const id = f.opts ? 'dl' + (++dl) : '';
    inner = `<input type="${t === 'num' ? 'number' : t === 'url' ? 'url' : t === 'pass' ? 'password' : 'text'}" ${t === 'num' ? 'min="0" step="any"' : ''} value="${esc(v == null ? '' : v)}" ${id ? `list="${id}"` : ''}>` + (id ? `<datalist id="${id}">${f.opts.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '');
  }
  return `<div class="fld" data-k="${f.k}" data-t="${t}"><label>${esc(f.l || f.k)}</label>${inner}${hint}</div>`;
}
const li = (f, it) => `<div class="li"><button type="button" class="rm" data-rm>×</button><div class="grid2">${f.sub.map(s => fld(s, it && it[s.k])).join('')}</div></div>`;
DS.form = (schema, values) => {
  const root = document.createElement('div'); root.className = 'form';
  root.innerHTML = schema.map(f => fld(f, values && values[f.k])).join('');
  root.onclick = e => {
    if (e.target.closest('[data-rm]')) e.target.closest('.li').remove();
    const add = e.target.closest('[data-add]');
    if (add) { const w = add.closest('.fld'), f = schema.find(x => x.k === w.dataset.k); $('.items', w).insertAdjacentHTML('beforeend', li(f, {})); }
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
  const res = await fetch(CFG.api + path, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: o.body ? JSON.stringify(o.body) : undefined }).catch(() => { throw new Error('مفيش اتصال بالسيرفر'); });
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) { logout('الجلسة انتهت — سجّل دخول تاني'); throw new Error(d.error || 'الجلسة انتهت'); }
  if (!res.ok) throw new Error(d.error || 'فشل الطلب (' + res.status + ')');
  return d;
};
function logout(msg) {
  try { localStorage.removeItem(sk()); } catch {} TOKEN = ''; ME = null;
  $('#app').classList.add('hide'); $('#login').classList.remove('hide');
  const e = $('#lerr'); e.textContent = msg || ''; e.classList.toggle('hide', !msg);
}
async function enter() {
  try { ME = await DS.api('/me'); } catch (e) { if (TOKEN) logout(e.message); return; }
  $('#login').classList.add('hide'); $('#app').classList.remove('hide');
  $('#who').textContent = ME.email || ME.name || '';
  VIEWS = typeof CFG.views === 'function' ? CFG.views(ME) : CFG.views;
  $('#tabs').innerHTML = VIEWS.map((v, i) => `<button data-i="${i}">${v.label}</button>`).join('');
  show(0);
}
async function show(i) {
  [...$('#tabs').children].forEach((b, j) => b.classList.toggle('on', i === j));
  const m = $('#main'); m.innerHTML = '<div class="empty">جاري التحميل…</div>';
  try { await VIEWS[i].render(m); } catch (e) { m.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
DS.reload = () => { const i = [...$('#tabs').children].findIndex(b => b.classList.contains('on')); show(Math.max(0, i)); };
DS.start = (cfg) => {
  CFG = cfg; document.title = cfg.title;
  document.body.innerHTML = `
  <div id="login"><form class="lcard" id="lf"><h1>Discover<span>Sharm</span></h1><p>${esc(cfg.title)}</p><div id="lerr" class="err hide"></div>
    <div class="fld"><label>البريد الإلكتروني</label><input id="em" type="email" autocomplete="username" required></div>
    <div class="fld"><label>كلمة المرور</label><input id="pw" type="password" autocomplete="current-password" required></div>
    <button class="btn" style="width:100%" id="lb">تسجيل الدخول</button></form></div>
  <div id="app" class="hide"><header class="top"><div><b>Discover<span>Sharm</span></b><small>${esc(cfg.title)}</small></div><div class="row"><small id="who"></small><button class="btn ghost sm" id="out">خروج</button></div></header>
    <nav class="tabs" id="tabs"></nav><main id="main"></main></div><div id="toast"></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const b = $('#lb'); b.disabled = true; $('#lerr').classList.add('hide');
    try {
      const r = await fetch('/api/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#em').value.trim(), password: $('#pw').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.idToken) throw new Error(r.status === 429 ? 'محاولات كتير — استنى شوية' : 'الإيميل أو الباسورد غلط');
      TOKEN = d.idToken; localStorage.setItem(sk(), JSON.stringify({ t: TOKEN })); $('#pw').value = ''; await enter();
    } catch (er) { $('#lerr').textContent = er.message; $('#lerr').classList.remove('hide'); }
    b.disabled = false;
  };
  $('#out').onclick = () => logout();
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); };
  try { const s = JSON.parse(localStorage.getItem(sk()) || 'null'); if (s && tokenExp(s.t) > Date.now() + 60000) { TOKEN = s.t; enter(); } } catch {}
};

// ---------- bookings view (owner + admin) ----------
const FL = { id: 'رقم الحجز', name: 'الاسم', email: 'الإيميل', phone: 'التليفون', requests: 'طلبات خاصة', checkin: 'الوصول', checkout: 'المغادرة', nights: 'الليالي', rooms: 'عدد الغرف', roomType: 'نوع الغرفة', adults: 'بالغين', children: 'أطفال', childAges: 'أعمار الأطفال', infants: 'رُضّع', guests: 'الضيوف', date: 'التاريخ', time: 'الوقت', participants: 'عدد الأفراد', passengers: 'عدد الركاب', direction: 'الاتجاه', flightNo: 'رقم الرحلة', address: 'العنوان', payment: 'طريقة الدفع', total: 'الإجمالي', currency: 'العملة', createdAt: 'وقت الحجز', cancelReason: 'سبب الإلغاء' };
const bItem = b => tr(b.hotelName || b.title || b.vehicleType) || '—';
const bWhen = b => b.checkin ? `${b.checkin} ← ${b.checkout || ''}` : `${b.date || ''} ${b.time || ''}`;
const bQty = b => b.type === 'hotel' ? `${b.adults || 0} + ${b.children || 0}` : (b.participants || b.passengers || '');
const TYPE_L = { hotel: 'فندق', excursion: 'رحلة', transfer: 'ترانسفير' };
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
      { h: 'الإجمالي', f: b => DS.money(b.total) + ' ' + esc(b.currency || '') }, { h: 'الدفع', f: b => DS.badge(PAY, b.status) + (b.needsRefund && b.status !== 'refunded' ? ' <span class="badge b-red">استرداد مطلوب</span>' : '') }, { h: 'الأونر', f: b => DS.badge(OWN, b.ownerStatus || 'new') }];
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
    body.innerHTML = `<div class="kv"><b>الحجز على</b><span>${esc(bItem(b))}</span>${kv}</div>
      ${admin ? `<div class="fld"><label>حالة الدفع</label><select id="bs">${DS.opts(PAY, b.status)}</select></div><div class="fld"><label>ملاحظة الإدارة</label><textarea id="ba">${esc(b.adminNote || '')}</textarea></div>` : ''}
      <div class="fld"><label>حالة التنفيذ</label><select id="bo">${DS.opts(OWN, b.ownerStatus || 'new')}</select></div>
      <div class="fld"><label>ملاحظة (بتظهر لك${admin ? ' وللأونر' : ' بس'})</label><textarea id="bn">${esc(b.ownerNote || '')}</textarea></div>`;
    const actions = [{ t: 'حفظ', fn: async () => {
      const body2 = { ownerStatus: $('#bo', body).value, ownerNote: $('#bn', body).value };
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

// ---------- owner panel factory (trips / hotels / transfers) ----------
DS.ownerPanel = (c) => {
  const items = async () => (await DS.api('/items')).items;
  DS.start({ key: c.key, title: c.title, api: c.api, views: (me) => [
    { label: 'الرئيسية', render: async m => {
      const [it, bk] = await Promise.all([items(), DS.api('/bookings')]); const b = bk.bookings;
      const paid = b.filter(x => x.status === 'completed'), rev = paid.reduce((s, x) => s + (Number(x.total) || 0), 0);
      m.innerHTML = `<h2 class="pt">أهلاً ${esc(me.name || '')}</h2><div class="stats">
        <div class="stat"><b>${it.length}${me.maxItems ? ' / ' + me.maxItems : ''}</b><span>${c.itemsLabel}</span></div>
        <div class="stat"><b>${b.length}</b><span>كل الحجوزات</span></div>
        <div class="stat"><b>${b.filter(x => (x.ownerStatus || 'new') === 'new' && x.status === 'completed').length}</b><span>مدفوعة ومحتاجة تأكيد</span></div>
        <div class="stat"><b>${DS.money(rev)}</b><span>إيراد الحجوزات المدفوعة (EGP)</span></div></div>
        <div class="card"><b>آخر الحجوزات</b>${DS.table([{ h: 'الحجز', f: x => esc(x.id) }, { h: 'العميل', f: x => esc(x.name || '') }, { h: 'على', f: x => esc(bItem(x)) }, { h: 'الإجمالي', f: x => DS.money(x.total) }, { h: 'الدفع', f: x => DS.badge(PAY, x.status) }], b.slice(0, 5))}</div>`;
    } },
    { label: c.itemsLabel, render: async m => {
      const list = await items(), full = me.maxItems && list.length >= me.maxItems;
      m.innerHTML = `<h2 class="pt">${c.itemsLabel} <span class="row"><span class="muted">${me.maxItems ? `الحد الأقصى ${me.maxItems}` : ''}</span><button class="btn" id="add" ${full ? 'disabled' : ''}>+ ${c.addLabel}</button></span></h2>` +
        DS.table([{ h: '', f: i => DS.thumb(i.image || (i.images || [])[0]) }, { h: 'الاسم', f: i => `<b>${esc(tr(c.title_of(i)))}</b><div class="muted">${esc(i.id)}</div>` }, { h: 'السعر', f: i => DS.money(i.price) + ' EGP' },
          { h: 'التقييم', f: i => i.rating ? '★ ' + Number(i.rating).toFixed(1) : '—' },
          { h: '', f: i => `<button class="btn ghost sm" data-e="${esc(i.id)}">تعديل</button> <button class="btn ghost sm" data-d="${esc(i.id)}">حذف</button>` }], list, { empty: `لسه مضفتش ${c.itemsLabel}` });
      const edit = (it) => {
        const form = DS.form(c.schema, it || {});
        DS.modal({ title: it ? 'تعديل' : c.addLabel, body: form, actions: [{ t: 'حفظ', fn: async (mb) => {
          const body = DS.collect(form, c.schema);
          await DS.api(it ? '/items/' + encodeURIComponent(it.id) : '/items', { method: it ? 'PUT' : 'POST', body });
          DS.toast('اتحفظ'); me.itemCount++; setTimeout(DS.reload, 100);
        } }] });
      };
      $('#add').onclick = () => edit(null);
      m.onclick = async e => {
        const ed = e.target.closest('[data-e]'), de = e.target.closest('[data-d]');
        if (ed) edit(list.find(i => i.id === ed.dataset.e));
        if (de && confirm('تأكيد الحذف؟ الحجوزات القديمة هتفضل محفوظة.')) { await DS.api('/items/' + encodeURIComponent(de.dataset.d), { method: 'DELETE' }); DS.toast('اتحذف'); DS.reload(); }
      };
    } },
    { label: 'الحجوزات', render: DS.bookingsView({}) },
    ...(me.hasReviews ? [{ label: 'التقييمات', render: async m => {
      const r = (await DS.api('/reviews')).reviews;
      m.innerHTML = '<h2 class="pt">التقييمات</h2>' + DS.table([{ h: 'العميل', f: x => esc(x.name) }, { h: 'التقييم', f: x => '★'.repeat(x.rating || 0) }, { h: 'التعليق', f: x => esc(x.comment) }, { h: 'التاريخ', f: x => DS.dt(x.createdAt) }], r, { empty: 'مفيش تقييمات لسه' });
    } }] : []),
  ] });
};
})();
