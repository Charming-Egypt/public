/* Discover Sharm — Super Admin console (uses /console/console.js). Talks only to /api/admin/* */
(function () {
const { esc, tr, money, dt, badge, PAY, table, modal, form, collect, api, toast, thumb } = DS;
const ROLE_L = { super_admin: 'سوبر أدمن', trips_owner: 'مكتب رحلات', hotels_owner: 'مالك فنادق', transfers_owner: 'ترانسفير' };
const ROLE_OPTS = Object.entries(ROLE_L).filter(([k]) => k !== 'super_admin');
const TYPES = { hotel: 'الفنادق', excursion: 'الرحلات', transfer: 'الترانسفير', destination: 'الوجهات', restaurant: 'المطاعم', article: 'المقالات', review: 'تقييمات الموقع' };
const OWNER_ROLE = { hotel: 'hotels_owner', excursion: 'trips_owner', transfer: 'transfers_owner' };
const TEMPLATE = { hotel: { name: { ar: '', en: '' }, category: 'budget', price: 0, rating: 0, reviews: 0, location: { ar: '', en: '' }, image: '', images: [], description: { ar: '', en: '' }, amenities: { ar: [], en: [] }, rooms: [], unavailableDates: [] },
  excursion: { title: { ar: '', en: '' }, category: '', price: 0, rating: 0, reviews: 0, duration: { ar: '', en: '' }, image: '', images: [], description: { ar: '', en: '' }, itinerary: [] },
  transfer: { vehicleType: { ar: '', en: '' }, capacity: 4, price: 0, image: '', description: { ar: '', en: '' }, features: { ar: [], en: [] } } };
const nameOf = i => tr(i.name || i.title || i.vehicleType || i.itemName) || i.id;
const rname = (roles, id) => { const r = roles.find(x => x.uid === id); return r ? esc(r.name || r.email) : (id ? '<span class="muted">' + esc(id.slice(0, 8)) + '…</span>' : '<span class="muted">—</span>'); };
const roles = async () => (await api('/roles')).roles;

// ---- create / promote account ----
const ACC = [{ k: 'role', l: 'نوع الحساب', t: 'select', opts: ROLE_OPTS }, { k: 'name', l: 'الاسم' }, { k: 'email', l: 'الإيميل', h: 'لحساب جديد' }, { k: 'pw', l: 'كلمة مرور مبدئية (6+ حروف)', t: 'pass', h: 'لحساب جديد' }, { k: 'phone', l: 'التليفون' }, { k: 'uid', l: 'أو: uid لحساب موجود', h: 'لو العميل مسجّل قبل كده (من تبويب العملاء) سيب الإيميل والباسورد فاضيين' }];
function accountModal(pre) {
  const f = form(ACC, pre || {});
  modal({ title: 'إنشاء / ترقية حساب أونر', body: f, actions: [{ t: 'حفظ', fn: async () => { const v = collect(f, ACC); await api('/roles', { method: 'POST', body: { role: v.role, name: v.name, email: v.email, password: v.pw, phone: v.phone, uid: v.uid || undefined } }); toast('تم'); setTimeout(DS.reload, 100); } }] });
}

DS.start({ key: 'admin', title: 'لوحة السوبر أدمن', api: '/api/admin', views: [
  // ================= dashboard =================
  { label: 'الرئيسية', render: async m => {
    const s = await api('/stats'), owners = Object.entries(s.roleCounts).filter(([k]) => k !== 'super_admin').reduce((a, [, v]) => a + v, 0);
    const c = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
    m.innerHTML = `<h2 class="pt">نظرة عامة</h2><div class="stats">${c(s.bookings, 'إجمالي الحجوزات')}${c(s.last30, 'حجوزات آخر 30 يوم')}${c(Object.entries(s.revenue).map(([k, v]) => money(v) + ' ' + k).join(' + ') || 0, 'إيراد مدفوع')}${c(s.needsRefund, 'استرداد مطلوب')}
      ${c(s.items.hotel ?? '؟', 'فنادق')}${c(s.items.excursion ?? '؟', 'رحلات')}${c(s.items.transfer ?? '؟', 'ترانسفير')}${c(owners, 'حسابات أونرز')}${c(s.applications, 'طلبات شركاء')}${c(s.messages, 'رسائل تواصل')}</div>
      <div class="card"><b>الحجوزات حسب الحالة</b><div class="row" style="margin-top:8px">${Object.entries(s.byStatus).map(([k, v]) => badge(PAY, k) + ' ' + v).join(' &nbsp; ') || '—'}</div></div>`;
  } },
  // ================= owner accounts =================
  { label: 'الأونرز', render: async m => {
    const list = (await roles());
    m.innerHTML = `<h2 class="pt">حسابات الأونرز <button class="btn" id="add">+ حساب جديد</button></h2>` + table([
      { h: 'الاسم', f: r => `<b>${esc(r.name || '—')}</b><div class="muted">${esc(r.email || '')}</div>` }, { h: 'النوع', f: r => ROLE_L[r.role] || r.role },
      { h: 'الحالة', f: r => r.status === 'suspended' ? '<span class="badge b-red">موقوف</span>' : '<span class="badge b-green">نشط</span>' },
      { h: 'العناصر', f: r => Object.entries(r.itemCounts || {}).map(([t, n]) => (TYPES[t] || t) + ': ' + n).join('<br>') || '—' },
      { h: '', f: r => `<button class="btn ghost sm" data-a="edit" data-u="${r.uid}">تعديل</button> <button class="btn ghost sm" data-a="tog" data-u="${r.uid}">${r.status === 'suspended' ? 'تفعيل' : 'إيقاف'}</button> <button class="btn ghost sm" data-a="pw" data-u="${r.uid}">باسورد</button> <button class="btn ghost sm" data-a="del" data-u="${r.uid}">حذف</button>` }],
      list.filter(r => r.role !== 'super_admin'), { empty: 'مفيش حسابات أونرز لسه' });
    m.querySelector('#add').onclick = () => accountModal();
    m.onclick = async e => {
      const b = e.target.closest('[data-a]'); if (!b) return; const r = list.find(x => x.uid === b.dataset.u), a = b.dataset.a;
      try {
        if (a === 'tog') { await api('/roles/' + r.uid, { method: 'PUT', body: { status: r.status === 'suspended' ? 'active' : 'suspended' } }); DS.reload(); }
        if (a === 'pw') { if (confirm('نبعت إيميل إعادة تعيين الباسورد لـ ' + r.email + '؟')) { await api('/roles/' + r.uid + '/reset-password', { method: 'POST', body: {} }); toast('اتبعت'); } }
        if (a === 'del') { if (confirm('إزالة صلاحيات الحساب؟ (الحساب نفسه هيفضل كعميل عادي، وعناصره هتفضل مسجلة باسمه)')) { await api('/roles/' + r.uid, { method: 'DELETE' }); DS.reload(); } }
        if (a === 'edit') { const S = [{ k: 'name', l: 'الاسم' }, { k: 'phone', l: 'التليفون' }, { k: 'role', l: 'النوع', t: 'select', opts: ROLE_OPTS }], f = form(S, r);
          modal({ title: 'تعديل ' + (r.name || ''), body: f, actions: [{ t: 'حفظ', fn: async () => { await api('/roles/' + r.uid, { method: 'PUT', body: collect(f, S) }); DS.reload(); } }] }); }
      } catch (er) { toast(er.message, true); }
    };
  } },
  // ================= customers =================
  { label: 'العملاء', render: async m => {
    let off = 0;
    const load = async () => {
      const d = await api('/customers?offset=' + off + '&limit=50');
      m.innerHTML = `<h2 class="pt">العملاء <span class="muted">${d.total}</span></h2>` + table([
        { h: 'الاسم', f: u => `<b>${esc(u.profile.name || '—')}</b><div class="muted">${esc(u.profile.email || '')}</div>` }, { h: 'التليفون', f: u => esc(u.profile.fullPhone || u.profile.phone || '') },
        { h: 'حجوزات مدفوعة', f: u => u.stats.completedBookings || 0 }, { h: 'صرف', f: u => money(u.stats.totalSpent) }, { h: 'uid', f: u => `<code style="font-size:11px" dir="ltr">${esc(u.uid)}</code>` },
        { h: '', f: u => u.role ? `<span class="badge b-blue">${ROLE_L[u.role] || u.role}</span>` : `<button class="btn ghost sm" data-u="${esc(u.uid)}">اجعله أونر</button>` }], d.users) +
        `<div class="row" style="margin-top:12px"><button class="btn ghost sm" id="pv" ${off ? '' : 'disabled'}>السابق</button><button class="btn ghost sm" id="nx" ${off + 50 < d.total ? '' : 'disabled'}>التالي</button></div>`;
      m.querySelector('#pv').onclick = () => { off -= 50; load(); }; m.querySelector('#nx').onclick = () => { off += 50; load(); };
      m.onclick = e => { const b = e.target.closest('[data-u]'); if (b) { const u = d.users.find(x => x.uid === b.dataset.u); accountModal({ uid: u.uid, name: u.profile.name, phone: u.profile.phone }); } };
    };
    await load();
  } },
  // ================= content =================
  { label: 'المحتوى', render: async m => {
    let type = 'hotel', rs = await roles();
    const draw = async () => {
      const d = await api('/items/' + type), owned = !!OWNER_ROLE[type], items = d.items;
      m.innerHTML = `<h2 class="pt">المحتوى <button class="btn" id="add">+ إضافة</button></h2><div class="chips">${Object.entries(TYPES).map(([k, v]) => `<span class="chip ${k === type ? 'on' : ''}" data-t="${k}">${v}</span>`).join('')}</div>` +
        table([{ h: '', f: i => thumb(i.image) }, { h: 'الاسم', f: i => `<b>${esc(nameOf(i))}</b><div class="muted">${esc(i.id)}</div>` }, ...(owned ? [{ h: 'المالك', f: i => rname(rs, i.owner) }] : []), { h: 'السعر', f: i => i.price != null ? money(i.price) : '' },
          { h: '', f: i => `<button class="btn ghost sm" data-e="${esc(i.id)}">تعديل</button> <button class="btn ghost sm" data-d="${esc(i.id)}">حذف</button>` }], items);
      const edit = (it) => {
        const b = document.createElement('div');
        const owners = rs.filter(r => r.role === OWNER_ROLE[type]);
        b.innerHTML = (owned ? `<div class="fld"><label>المالك</label><select id="ow"><option value="">— بدون —</option>${owners.map(r => `<option value="${r.uid}" ${it && it.owner === r.uid ? 'selected' : ''}>${esc(r.name || r.email)}</option>`).join('')}</select></div>` + (type === 'hotel' ? '<div class="fld"><label><input type="checkbox" id="fc" style="width:auto"> تجاوز حد الفندقين للأونر ده</label></div>' : '') : '') +
          `<div class="fld"><label>البيانات (JSON)</label><textarea id="js" dir="ltr" style="min-height:300px;font-family:monospace;font-size:12px"></textarea></div>`;
        b.querySelector('#js').value = JSON.stringify(it || TEMPLATE[type] || { id: '' }, null, 2);
        modal({ title: it ? 'تعديل ' + nameOf(it) : 'إضافة', body: b, actions: [{ t: 'حفظ', fn: async () => {
          let o; try { o = JSON.parse(b.querySelector('#js').value); } catch (e) { throw new Error('JSON غلط: ' + e.message); }
          if (owned) { const ow = b.querySelector('#ow').value; if (ow) o.owner = ow; else delete o.owner; }
          const force = b.querySelector('#fc') && b.querySelector('#fc').checked ? '?force=1' : '';
          await api('/items/' + type + (it ? '/' + encodeURIComponent(it.id) : '') + force, { method: it ? 'PUT' : 'POST', body: o }); toast('اتحفظ'); setTimeout(draw, 100);
        } }] });
      };
      m.querySelector('#add').onclick = () => edit(null);
      m.onclick = async e => {
        const c = e.target.closest('[data-t]'); if (c) { type = c.dataset.t; return draw(); }
        const ed = e.target.closest('[data-e]'), de = e.target.closest('[data-d]');
        if (ed) edit(items.find(i => i.id === ed.dataset.e));
        if (de && confirm('حذف نهائي؟')) { try { await api('/items/' + type + '/' + encodeURIComponent(de.dataset.d), { method: 'DELETE' }); draw(); } catch (er) { toast(er.message, true); } }
      };
    };
    await draw();
  } },
  // ================= bookings =================
  { label: 'الحجوزات', render: async m => DS.bookingsView({ admin: true, roles: await roles() })(m) },
  // ================= partner applications =================
  { label: 'طلبات الشركاء', render: async m => {
    const list = (await api('/applications')).applications, R = { Hotel: 'hotels_owner', 'Trip Supplier': 'trips_owner', Transfer: 'transfers_owner' };
    const ST = { new: ['جديد', 'blue'], contacted: ['اتواصلنا', 'amber'], approved: ['مقبول', 'green'], rejected: ['مرفوض', 'red'] };
    m.innerHTML = '<h2 class="pt">طلبات الانضمام كشريك</h2>' + table([{ h: 'النشاط', f: a => `<b>${esc(a.businessName)}</b><div class="muted">${esc(a.partnerType)}</div>` }, { h: 'التواصل', f: a => `${esc(a.contactName)}<div class="muted">${esc(a.phone)} · ${esc(a.email)}</div>` }, { h: 'الحالة', f: a => DS.badge(ST, a.status) }, { h: 'التاريخ', f: a => dt(a.createdAt) }], list, { click: true, empty: 'مفيش طلبات' });
    m.onclick = e => {
      const r = e.target.closest('tr[data-i]'); if (!r) return; const a = list[+r.dataset.i], b = document.createElement('div');
      b.innerHTML = `<div class="kv"><b>النشاط</b><span>${esc(a.businessName)} (${esc(a.partnerType)})</span><b>المسؤول</b><span>${esc(a.contactName)}</span><b>تليفون</b><span dir="ltr">${esc(a.phone)}</span><b>إيميل</b><span>${esc(a.email)}</span><b>رسالة</b><span>${esc(a.message || '—')}</span><b>مستندات</b><span>${(a.documents || []).map((d, i) => `<a href="#" data-doc="${i}">${esc(d.name)}</a>`).join(' · ') || '—'}</span></div>
        <div class="fld"><label>الحالة</label><select id="st">${DS.opts(ST, a.status)}</select></div><div class="fld"><label>ملاحظة داخلية</label><textarea id="nt">${esc(a.adminNote || '')}</textarea></div>`;
      b.onclick = async ev => { const l = ev.target.closest('[data-doc]'); if (!l) return; ev.preventDefault(); try { const full = (await api('/applications/' + a.id)).application, d = full.documents[+l.dataset.doc]; const x = document.createElement('a'); x.href = d.data.startsWith('data:') ? d.data : 'data:application/octet-stream;base64,' + d.data; x.download = d.name; x.click(); } catch (er) { toast(er.message, true); } };
      modal({ title: a.businessName, body: b, actions: [
        { t: 'حفظ', fn: async () => { await api('/applications/' + a.id, { method: 'PUT', body: { status: b.querySelector('#st').value, adminNote: b.querySelector('#nt').value } }); DS.reload(); } },
        { t: 'إنشاء حساب أونر', cls: 'ghost', fn: async (mb, close) => { close(); accountModal({ role: R[a.partnerType], name: a.contactName, email: a.email, phone: a.phone }); return false; } },
        { t: 'مسح', cls: 'red', fn: async () => { if (!confirm('مسح الطلب؟')) return false; await api('/applications/' + a.id, { method: 'DELETE' }); DS.reload(); } }] });
    };
  } },
  // ================= contact messages =================
  { label: 'الرسائل', render: async m => {
    const list = (await api('/messages')).messages, ST = { new: ['جديدة', 'blue'], read: ['اتقرت', 'gray'], replied: ['اتردّ عليها', 'green'] };
    m.innerHTML = '<h2 class="pt">رسائل التواصل</h2>' + table([{ h: 'من', f: x => `<b>${esc(x.name)}</b><div class="muted">${esc(x.email)}</div>` }, { h: 'الرسالة', f: x => esc(String(x.message).slice(0, 90)) }, { h: 'الحالة', f: x => DS.badge(ST, x.status) }, { h: 'التاريخ', f: x => dt(x.createdAt) }], list, { click: true, empty: 'مفيش رسائل' });
    m.onclick = e => {
      const r = e.target.closest('tr[data-i]'); if (!r) return; const x = list[+r.dataset.i], set = async s => { await api('/messages/' + x.id, { method: 'PUT', body: { status: s } }); DS.reload(); };
      modal({ title: x.name, body: `<div class="kv"><b>الإيميل</b><span>${esc(x.email)}</span><b>التاريخ</b><span>${dt(x.createdAt)}</span></div><p style="white-space:pre-wrap">${esc(x.message)}</p>`, actions: [
        { t: 'رد بالإيميل', fn: async () => { location.href = 'mailto:' + x.email; await set('replied'); } }, { t: 'تمت القراءة', cls: 'ghost', fn: () => set('read') },
        { t: 'مسح', cls: 'red', fn: async () => { await api('/messages/' + x.id, { method: 'DELETE' }); DS.reload(); } }] });
    };
  } },
  // ================= reviews moderation =================
  { label: 'التقييمات', render: async m => {
    const list = (await api('/reviews')).reviews;
    m.innerHTML = '<h2 class="pt">مراجعة التقييمات</h2>' + table([{ h: 'على', f: r => `${esc(r.type)}<div class="muted">${esc(r.itemId)}</div>` }, { h: 'العميل', f: r => esc(r.name) }, { h: '★', f: r => r.rating }, { h: 'التعليق', f: r => esc(String(r.comment).slice(0, 120)) }, { h: '', f: r => `<button class="btn ghost sm" data-i="${esc(r.type + '/' + r.itemId + '/' + r.id)}">مسح</button>` }], list, { empty: 'مفيش تقييمات' });
    m.onclick = async e => { const b = e.target.closest('[data-i]'); if (b && confirm('مسح التقييم؟')) { await api('/reviews/' + b.dataset.i, { method: 'DELETE' }); DS.reload(); } };
  } },
  // ================= raw files =================
  { label: 'الملفات', render: async m => {
    const files = (await api('/files')).files; let cur = files[0];
    const load = async () => {
      const d = await api('/file?file=' + encodeURIComponent(cur));
      m.innerHTML = `<h2 class="pt">محرر الملفات (JSON)</h2><div class="card"><div class="fld"><label>الملف</label><select id="fs">${files.map(f => `<option ${f === cur ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
        <textarea id="ft" dir="ltr" style="min-height:420px;font-family:monospace;font-size:12px"></textarea><div class="row" style="margin-top:10px"><button class="btn" id="sv">حفظ الملف</button><span class="muted">ملفات lang/ هي نصوص واجهة الموقع بكل اللغات.</span></div></div>`;
      m.querySelector('#ft').value = JSON.stringify(JSON.parse(d.content), null, 2);
      m.querySelector('#fs').onchange = e => { cur = e.target.value; load(); };
      m.querySelector('#sv').onclick = async () => { try { await api('/file', { method: 'PUT', body: { file: cur, content: m.querySelector('#ft').value, sha: d.sha } }); toast('اتحفظ'); load(); } catch (e) { toast(e.message, true); } };
    };
    await load();
  } },
  // ================= audit + maintenance =================
  { label: 'السجل', render: async m => {
    const l = (await api('/audit?limit=150')).log;
    m.innerHTML = `<h2 class="pt">سجل العمليات <button class="btn ghost" id="ri">مزامنة ملكية الحجوزات</button></h2>` + table([{ h: 'الوقت', f: x => dt(x.ts) }, { h: 'العملية', f: x => esc(x.action) }, { h: 'الهدف', f: x => esc(x.target || '') }, { h: 'المنفّذ', f: x => `<span class="muted">${esc((x.role || '') + ' ' + String(x.uid).slice(0, 8))}</span>` }], l);
    m.querySelector('#ri').onclick = async () => { if (!confirm('هيعيد ربط كل الحجوزات بأونر العنصر الحالي. متأكد؟')) return; try { const r = await api('/maintenance/reindex', { method: 'POST', body: {} }); toast('اتحدّث ' + r.bookingsUpdated + ' حجز'); } catch (e) { toast(e.message, true); } };
  } },
] });
})();
