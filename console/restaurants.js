/* Discover Sharm — restaurant / café owner console: restaurants, branches (approval queue), QR codes.
 *   DS.restaurantPanel(cfg)        owner console (key 'restaurants')
 *   DS.branchesView({ admin })     branches list + editor (owner)  /  approval queue (super admin)
 *   DS.qrView({ admin })           QR code generator + printable posters
 */
(function () {
const { esc, tr } = DS;
const BST = { pending: ['بانتظار الموافقة', 'amber'], approved: ['معتمد', 'green'], rejected: ['مرفوض', 'red'] };
const LST = { draft: ['مسودة', 'gray'], pending_review: ['بانتظار المراجعة', 'amber'], published: ['منشور', 'green'], archived: ['مؤرشف', 'gray'] };
const VT = { restaurant: 'مطعم', cafe: 'كافيه' };
const DEFAULT_QR_BASE = 'https://app.discover-sharm.com';
const dt = (v) => (DS.dt ? DS.dt(v) : String(v || '').slice(0, 10));

// ---------------------------------------------------------------- branches
DS.branchesView = (o = {}) => async (m) => {
  const admin = !!o.admin;
  const load = async () => {
    const [bs, rs] = await Promise.all([DS.api('/branches'), admin ? DS.api('/items/restaurant') : DS.api('/items')]);
    return { list: bs.branches, rest: (admin ? rs.items : rs.items).filter(r => r.status !== 'archived') };
  };
  let { list, rest } = await load(), filter = admin ? 'pending' : 'all';

  const editor = (it) => {
    const isNew = !it;
    let sideEl;
    DS.itemEditor(m, { type: 'branch', item: it || {}, onBack: () => DS.reload(),
      side: (el) => {
        sideEl = el;
        el.insertAdjacentHTML('beforeend', `<div class="edc side-c"><h4>المطعم / الكافيه</h4>
          ${isNew ? `<div class="edf-in"><div class="wrapi"><select class="edi" id="bp">${rest.map(r => `<option value="${esc(r.id)}">${esc(tr(r.name))}</option>`).join('')}</select></div><div class="edh">الفرع بيتبع المطعم ده.</div></div>`
                  : `<b>${esc(it.restaurant || '')}</b>`}
          <div class="edh" style="margin-top:12px">${admin ? 'اعتماد الفرع بيتم من قايمة الفروع.' : '⚠ الفرع بعد الحفظ بيروح للسوبر أدمن للموافقة، وما بيظهرش للعملاء إلا بعد اعتماده. أي تعديل بعد كده بيرجّعه للمراجعة.'}</div></div>`);
      },
      save: async (out) => {
        if (isNew) { out.propertyId = sideEl.querySelector('#bp').value; await DS.api('/branches', { method: 'POST', body: out }); }
        else await DS.api('/branches/' + encodeURIComponent(it.id), { method: 'PUT', body: { ...out, status: undefined } });
      } });
  };

  const draw = () => {
    const shown = list.filter(b => filter === 'all' || b.status === filter);
    const pend = list.filter(b => b.status === 'pending').length;
    const cols = [
      { h: 'الفرع', f: b => `<b>${esc(tr(b.name) || '—')}</b><div class="muted">${esc(b.restaurant || '')}${b.area ? ' · ' + esc(tr(b.area)) : ''}</div>` },
      ...(admin ? [{ h: 'المالك', f: b => esc(b.ownerName || '') }] : []),
      { h: 'العنوان', f: b => `<span class="muted">${esc(tr(b.address) || '—')}</span>` },
      { h: 'التاريخ', f: b => `<span class="muted">${dt(b.createdAt)}</span>` },
      { h: 'الحالة', f: b => DS.badge(BST, b.status) + (b.status === 'rejected' && b.adminNote ? `<div class="muted" style="margin-top:4px;max-width:220px">${esc(b.adminNote)}</div>` : '') },
      { h: '', f: b => (admin && b.status !== 'approved' ? `<button class="btn sm" data-ok="${b.id}">اعتماد</button> ` : '') + (admin && b.status !== 'rejected' ? `<button class="btn red sm" data-no="${b.id}">رفض</button> ` : '') + `<button class="btn ghost sm" data-e="${b.id}">تعديل</button> <button class="btn ghost sm" data-d="${b.id}">حذف</button>` },
    ];
    m.innerHTML = `<h2 class="pt">${admin ? 'فروع المطاعم' : 'فروعي'} <span class="row">${admin ? '' : `<button class="btn" id="add" ${rest.length ? '' : 'disabled'}>+ إضافة فرع</button>`}</span></h2>
      ${admin ? '' : `<div class="card" style="padding:14px 18px"><span class="muted">كل فرع جديد أو معدّل بيحتاج موافقة السوبر أدمن قبل ما يظهر للعملاء في صفحة مطعمك.${rest.length ? '' : ' <b>أضيفي مطعم/كافيه الأول من "مطاعمي".</b>'}</span></div>`}
      <div class="chips">${[['pending', `بانتظار الموافقة${pend ? ' (' + pend + ')' : ''}`], ['approved', 'معتمد'], ['rejected', 'مرفوض'], ['all', 'الكل']].map(([k, l]) => `<span class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</span>`).join('')}</div>`
      + DS.table(cols, shown, { empty: filter === 'pending' ? 'مفيش فروع بانتظار الموافقة 🎉' : 'مفيش فروع' });
    const add = m.querySelector('#add'); if (add) add.onclick = () => editor(null);
  };
  draw();
  m.onclick = async (e) => {
    const f = e.target.closest('[data-f]'), ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]'), ed = e.target.closest('[data-e]'), de = e.target.closest('[data-d]');
    try {
      if (f) { filter = f.dataset.f; draw(); }
      if (ok) { await DS.api('/branches/' + ok.dataset.ok, { method: 'PUT', body: { status: 'approved' } }); DS.toast('تم اعتماد الفرع ✓'); DS.reload(); }
      if (no) { const note = prompt('سبب الرفض (هيظهر للأونر):', ''); if (note === null) return; await DS.api('/branches/' + no.dataset.no, { method: 'PUT', body: { status: 'rejected', note } }); DS.toast('تم رفض الفرع'); DS.reload(); }
      if (ed) editor(list.find(b => b.id === ed.dataset.e));
      if (de && confirm('حذف الفرع نهائيًا؟')) { await DS.api('/branches/' + de.dataset.d, { method: 'DELETE' }); DS.toast('تم الحذف'); DS.reload(); }
    } catch (er) { DS.toast(er.message, true); }
  };
};

// ---------------------------------------------------------------- QR codes
const posterHtml = (o) => `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>QR — ${esc(o.name)}</title>
<style>
  @page{size:${o.card ? 'A6 portrait' : 'A4 portrait'};margin:0}*{box-sizing:border-box}
  body{margin:0;font-family:Cairo,Tahoma,system-ui,sans-serif;background:#fff;color:#1b1410;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .p{width:${o.card ? '105mm' : '210mm'};height:${o.card ? '148mm' : '297mm'};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${o.card ? '4mm' : '9mm'};padding:${o.card ? '8mm' : '18mm'};text-align:center;border:${o.card ? '0' : '0'};background:linear-gradient(180deg,#fff7ef,#fff)}
  .bar{width:${o.card ? '40mm' : '70mm'};height:2mm;border-radius:2mm;background:linear-gradient(90deg,#ff6a2b,#ffa24d)}
  h1{margin:0;font-size:${o.card ? '7mm' : '15mm'};line-height:1.25}h2{margin:0;font-weight:600;font-size:${o.card ? '3.6mm' : '6mm'};color:#6b5a4d}
  .qr{padding:${o.card ? '3mm' : '6mm'};background:#fff;border-radius:${o.card ? '4mm' : '8mm'};box-shadow:0 0 0 .6mm #ffd9bf}.qr svg{display:block;width:${o.card ? '56mm' : '112mm'};height:${o.card ? '56mm' : '112mm'}}
  .scan{font-size:${o.card ? '5mm' : '9mm'};font-weight:800}.scan small{display:block;font-weight:600;font-size:.62em;color:#6b5a4d;margin-top:1mm;direction:ltr}
  .ft{font-size:${o.card ? '3mm' : '4.6mm'};color:#9a8777;direction:ltr}
</style></head><body><div class="p"><div class="bar"></div><h1>${esc(o.name)}</h1>${o.sub ? `<h2>${esc(o.sub)}</h2>` : ''}<div class="qr">${o.svg}</div>
<div class="scan">امسح الكود لمشاهدة المنيو والتقييمات<small>Scan to view our menu &amp; reviews</small></div><div class="ft">discover-sharm.com</div></div>
<script>addEventListener('load',()=>setTimeout(()=>print(),350))<\/script></body></html>`;

DS.qrView = (o = {}) => async (m) => {
  const admin = !!o.admin;
  const [rs, bs] = await Promise.all([admin ? DS.api('/items/restaurant') : DS.api('/items'), DS.api('/branches').catch(() => ({ branches: [] }))]);
  const rest = rs.items.filter(r => r.status !== 'archived');
  if (!rest.length) { m.innerHTML = '<h2 class="pt">QR Code</h2><div class="card"><div class="empty">أضيفي مطعم أو كافيه الأول، وبعدها هتقدري تطلعي الـ QR بتاعه.</div></div>'; return; }
  const approved = bs.branches.filter(b => b.status === 'approved');
  const targets = rest.flatMap(r => [{ key: 'r:' + r.id, label: tr(r.name) || r.id, sub: 'المطعم الرئيسي', name: tr(r.name) || r.id, id: r.id, published: r.status === 'published' },
    ...approved.filter(b => b.propertyId === r.id).map(b => ({ key: 'b:' + b.id, label: tr(b.name) || 'فرع', sub: tr(r.name), name: (tr(r.name) || '') + ' — ' + (tr(b.name) || ''), id: r.id, branch: b.id, published: r.status === 'published' }))]);
  const pendingN = bs.branches.filter(b => b.status !== 'approved').length;
  let cur = targets[0], base = (localStorage.getItem('ds_qr_base') || DEFAULT_QR_BASE).replace(/\/$/, ''), fg = '#1b1410', ecc = 'M';
  const urlOf = (t) => `${base}/restaurants/view/?id=${encodeURIComponent(t.id)}${t.branch ? '&branch=' + encodeURIComponent(t.branch) : ''}&src=qr`;
  const draw = () => {
    const url = urlOf(cur), svg = DS.qrSvg(url, { ecc, fg, border: 2, scale: 6 });
    m.innerHTML = `<h2 class="pt">QR Code</h2>
      <div class="g2"><div class="card"><span class="ct">اختاري المطعم أو الفرع</span>
        <div class="chips" style="flex-direction:column;align-items:stretch">${targets.map(t => `<span class="chip ${t.key === cur.key ? 'on' : ''}" data-k="${esc(t.key)}" style="border-radius:16px;text-align:start"><b>${esc(t.label)}</b><br><small style="opacity:.75">${esc(t.sub)}</small></span>`).join('')}</div>
        ${pendingN ? `<div class="muted" style="margin-top:8px">${pendingN} فرع لسه بانتظار الموافقة — الـ QR بتاعه هيظهر هنا أول ما يتعتمد.</div>` : ''}
        <div class="fld" style="margin-top:16px"><label>رابط الموقع (للـ QR)</label><input id="qb" dir="ltr" value="${esc(base)}"><small>الـ QR بيفتح صفحة المطعم على موقع التطبيق. غيّريه فقط لو الدومين اتغيّر.</small></div></div>
      <div class="card" style="text-align:center"><span class="ct" style="text-align:start">${esc(cur.name)}</span>
        <div id="qpv" style="background:#fff;border-radius:22px;padding:14px;display:inline-block;max-width:100%;margin:6px 0">${svg.replace(/width="\\d+" height="\\d+"/, 'width="260" height="260"')}</div>
        <div class="muted" dir="ltr" style="word-break:break-all;margin-bottom:6px">${esc(url)}</div>
        ${cur.published ? '' : '<div class="err" style="margin-top:8px">المطعم لسه مش منشور — الرابط هيشتغل بعد ما الإدارة تنشره.</div>'}
        <div class="row" style="justify-content:center;margin:12px 0"><label class="muted">اللون</label><input type="color" id="qc" value="${fg}" style="width:46px;height:36px;padding:2px;border-radius:10px"><label class="muted">تصحيح الأخطاء</label>
          <select id="qe" style="width:auto"><option value="M" ${ecc === 'M' ? 'selected' : ''}>متوسط (موصى)</option><option value="Q" ${ecc === 'Q' ? 'selected' : ''}>عالي</option><option value="H" ${ecc === 'H' ? 'selected' : ''}>أعلى (للطباعة الصغيرة)</option></select></div>
        <div class="row" style="justify-content:center"><button class="btn" id="pp">🖨 طباعة بوستر A4</button><button class="btn ghost" id="pc">كارت ترابيزة (A6)</button><button class="btn ghost" id="dp">تحميل PNG</button><button class="btn ghost" id="ds">تحميل SVG</button></div></div></div>`;
  };
  const file = (name) => name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) || 'qr';
  const download = (href, name) => { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  const poster = (card) => { const w = window.open('', '_blank'); if (!w) return DS.toast('اسمحي للنوافذ المنبثقة عشان تتفتح الطباعة', true); w.document.write(posterHtml({ name: cur.name, sub: cur.branch ? '' : (tr(rest.find(r => r.id === cur.id).cuisine) || ''), svg: DS.qrSvg(urlOf(cur), { ecc, fg, border: 0 }), card })); w.document.close(); };
  draw();
  m.onclick = (e) => {
    const k = e.target.closest('[data-k]'); if (k) { cur = targets.find(t => t.key === k.dataset.k); draw(); return; }
    if (e.target.closest('#pp')) return poster(false);
    if (e.target.closest('#pc')) return poster(true);
    if (e.target.closest('#dp')) return download(DS.qrPng(urlOf(cur), { ecc, fg, scale: 14, border: 4 }), 'qr-' + file(cur.name) + '.png');
    if (e.target.closest('#ds')) return download('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(DS.qrSvg(urlOf(cur), { ecc, fg, border: 4, scale: 14 })), 'qr-' + file(cur.name) + '.svg');
  };
  m.onchange = (e) => {
    if (e.target.id === 'qc') { fg = e.target.value; draw(); }
    if (e.target.id === 'qe') { ecc = e.target.value; draw(); }
    if (e.target.id === 'qb') { base = e.target.value.trim().replace(/\/$/, '') || DEFAULT_QR_BASE; if (!/^https?:\/\//i.test(base)) base = 'https://' + base; localStorage.setItem('ds_qr_base', base); draw(); }
  };
};

// ---------------------------------------------------------------- the owner console
DS.restaurantPanel = (c) => {
  const items = async () => (await DS.api('/items')).items;
  DS.start({ key: c.key, title: c.title, roleLabel: c.roleLabel, api: c.api, noSide: true, views: (me) => [
    { label: 'الرئيسية', icon: 'home', render: async m => {
      const [it, bs] = await Promise.all([items(), DS.api('/branches')]); const b = bs.branches, n = (s) => b.filter(x => x.status === s).length;
      m.innerHTML = DS.hero('أهلًا ' + esc(me.name || ''), new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        `<button class="btn" data-go="مطاعمي">${DS.ic('plus')} إضافة مطعم / كافيه</button><button class="btn ghost" data-go="QR Code">QR Code</button>`) +
        `<div class="stats">${DS.stat(it.length + (me.maxItems ? ' / ' + me.maxItems : ''), 'مطاعمي وكافيهاتي', { icon: 'box', tone: 'gold' })}${DS.stat(n('approved'), 'فروع معتمدة', { icon: 'check', tone: 'green' })}${DS.stat(n('pending'), 'فروع بانتظار الموافقة', { icon: 'alert' })}${DS.stat(n('rejected'), 'فروع مرفوضة', { icon: 'alert', tone: 'red' })}</div>
         <div class="card"><span class="ct">ابدئي من هنا</span><ol style="padding-inline-start:20px;line-height:2.1"><li>أضيفي مطعمك أو الكافيه بالصور والمنيو — الإدارة بتراجعه وتنشره.</li><li>أضيفي فروعك من <b>الفروع</b> (كل فرع بيتعتمد من الإدارة).</li><li>اطبعي الـ <b>QR Code</b> وحطيه على الترابيزات والكاشير.</li></ol></div>`;
      m.onclick = e => { const g = e.target.closest('[data-go]'); if (g) DS.go(g.dataset.go); };
    } },
    { label: 'مطاعمي', icon: 'box', render: async m => {
      const list = await items(), full = me.maxItems && list.length >= me.maxItems;
      m.innerHTML = `<h2 class="pt">مطاعمي وكافيهاتي <span class="row"><span class="muted">${me.maxItems ? `الحد الأقصى ${me.maxItems}` : ''}</span><button class="btn" id="add" ${full ? 'disabled' : ''}>+ إضافة مطعم / كافيه</button></span></h2>` +
        DS.table([{ h: '', f: i => DS.thumb(i.image || (i.images || [])[0]) }, { h: 'الاسم', f: i => `<b>${esc(tr(i.name))}</b><div class="muted">${esc(VT[i.venueType] || '')}${i.cuisine ? ' · ' + esc(tr(i.cuisine)) : ''}</div>` },
          { h: 'الحالة', f: i => DS.badge(LST, i.status || 'published') }, { h: 'التقييم', f: i => i.rating ? '★ ' + Number(i.rating).toFixed(1) : '—' },
          { h: '', f: i => `<button class="btn ghost sm" data-e="${esc(i.id)}">تعديل</button> <button class="btn ghost sm" data-d="${esc(i.id)}">حذف</button>` }], list, { empty: 'لسه ما أضفتيش مطعم أو كافيه' });
      const edit = (it) => DS.itemEditor(m, { type: 'restaurant', item: it || {}, onBack: () => DS.reload(),
        save: async body => { await DS.api(it ? '/items/' + encodeURIComponent(it.id) : '/items', { method: it ? 'PUT' : 'POST', body }); if (!it) me.itemCount++; } });
      const add = m.querySelector('#add'); if (add) add.onclick = () => edit(null);
      m.onclick = async e => {
        const ed = e.target.closest('[data-e]'), de = e.target.closest('[data-d]');
        if (ed) edit(list.find(i => i.id === ed.dataset.e));
        if (de && confirm('هيتم إخفاء المطعم/الكافيه من الموقع. تكمّلي؟')) { await DS.api('/items/' + encodeURIComponent(de.dataset.d), { method: 'DELETE' }); DS.toast('تم'); DS.reload(); }
      };
    } },
    { label: 'الفروع', icon: 'layers', render: DS.branchesView({}) },
    { label: 'QR Code', icon: 'qr', render: DS.qrView({}) },
    { label: 'التقييمات', icon: 'star', render: DS.reviewsView({}) },
  ] });
};
})();
