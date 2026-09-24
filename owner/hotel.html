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
const ACC = [{ k: 'role', l: 'نوع الحساب', t: 'select', opts: ROLE_OPTS }, { k: 'name', l: 'الاسم' }, { k: 'email', l: 'الإيميل', h: 'لحساب جديد' }, { k: 'pw', l: 'كلمة مرور مبدئية (6+ حروف)', t: 'pass', h: 'لحساب جديد' }, { k: 'phone', l: 'التليفون' }, { k: 'commissionRate', l: 'نسبة عمولة خاصة % (فاضي = الافتراضي)', t: 'num' }, { k: 'uid', l: 'أو: uid لحساب موجود', h: 'لو العميل مسجّل قبل كده (من تبويب العملاء) سيب الإيميل والباسورد فاضيين' }];
function accountModal(pre) {
  const f = form(ACC, pre || {});
  modal({ title: 'إنشاء / ترقية حساب أونر', body: f, actions: [{ t: 'حفظ', fn: async () => { const v = collect(f, ACC); await api('/roles', { method: 'POST', body: { role: v.role, name: v.name, email: v.email, password: v.pw, phone: v.phone, commissionRate: v.commissionRate, uid: v.uid || undefined } }); toast('تم'); setTimeout(DS.reload, 100); } }] });
}

DS.start({ key: 'admin', title: 'لوحة السوبر أدمن', roleLabel: 'سوبر أدمن', api: '/api/admin', views: [
  // ================= dashboard =================
  { label: 'الرئيسية', icon: 'home', render: async m => {
    const [s, bk] = await Promise.all([api('/stats'), api('/bookings')]), rs = await roles();
    const owners = Object.entries(s.roleCounts).filter(([k]) => k !== 'super_admin').reduce((a, [, v]) => a + v, 0), rev = Object.values(s.revenue).reduce((a, v) => a + v, 0);
    const TL = { hotel: 'فنادق', excursion: 'رحلات', transfer: 'ترانسفير' }, TC = { hotel: 'var(--blue)', excursion: 'var(--gold)', transfer: 'var(--green)' };
    const lab = s.series.map(x => x.d.slice(5).replace('-', '/')), todo = s.needsRefund + s.payoutsOpen.count + s.applications;
    m.innerHTML = DS.hero('لوحة التحكم', new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), `<button class="btn" data-go="المحاسبة">${DS.ic('wallet')} المحاسبة</button><button class="btn ghost" data-go="الأونرز">${DS.ic('plus')} حساب أونر</button>`) +
      `<div class="stats">${DS.stat(money(rev), 'إجمالي المبيعات المدفوعة (جنيه)', { icon: 'coins', tone: 'gold' })}${DS.stat(s.bookings, 'إجمالي الحجوزات', { icon: 'cal', sub: s.last30 + ' آخر 30 يوم' })}${DS.stat(s.payoutsOpen.count, 'طلبات صرف مفتوحة', { icon: 'wallet', tone: s.payoutsOpen.count ? 'red' : 'green', sub: money(s.payoutsOpen.amount) + ' جنيه' })}${DS.stat(s.needsRefund, 'استرداد مطلوب', { icon: 'alert', tone: s.needsRefund ? 'red' : 'green' })}
      ${DS.stat(owners, 'حسابات الأونرز', { icon: 'shield', tone: 'purple' })}${DS.stat((s.items.hotel ?? 0) + (s.items.excursion ?? 0) + (s.items.transfer ?? 0), 'عناصر على الموقع', { icon: 'layers', sub: `${s.items.hotel ?? '؟'} فندق · ${s.items.excursion ?? '؟'} رحلة · ${s.items.transfer ?? '؟'} ترانسفير` })}${DS.stat(s.applications, 'طلبات شركاء', { icon: 'brief', tone: 'gold' })}${DS.stat(s.messages, 'رسائل تواصل', { icon: 'mail' })}</div>
      <div class="g2"><div class="card"><span class="ct">الإيراد اليومي — آخر 30 يوم (جنيه)</span>${DS.area(lab, s.series.map(x => x.rev), 'var(--gold)', 'r1')}</div>
        <div class="card"><span class="ct">المبيعات حسب النوع</span>${DS.donut(Object.entries(s.revenueByType).map(([k, v]) => ({ l: TL[k] || k, v: Math.round(v), c: TC[k] || '#999' })))}</div></div>
      <div class="g2"><div class="card"><span class="ct">عدد الحجوزات اليومي</span>${DS.bars(lab, s.series.map(x => x.n), 'var(--blue)')}</div>
        <div class="card"><span class="ct">حالة الحجوزات</span>${DS.hbars(Object.entries(s.byStatus).map(([k, v]) => ({ l: DS.PAY[k] ? DS.PAY[k][0] : k, v, c: DS.STC[k] || '#999' })))}<span class="ct" style="margin-top:18px">إجراءات سريعة</span><div class="qa"><button data-go="الحجوزات">${DS.ic('cal')}الحجوزات</button><button data-go="المحتوى">${DS.ic('layers')}المحتوى</button><button data-go="طلبات الشركاء">${DS.ic('brief')}الطلبات${s.applications ? ' (' + s.applications + ')' : ''}</button><button data-go="الأونرز">${DS.ic('shield')}الأونرز</button></div></div></div>
      <h2 class="pt">آخر الحجوزات ${todo ? `<span class="badge b-amber">${todo} حاجة محتاجة متابعة</span>` : ''}</h2>` + table([{ h: 'الحجز', f: b => `<b>${esc(b.id)}</b><div class="muted">${dt(b.createdAt)}</div>` }, { h: 'النوع', f: b => TL[b.type] || b.type }, { h: 'العميل', f: b => esc(b.name || '') }, { h: 'الأونر', f: b => rname(rs, b.ownerUid) }, { h: 'الإجمالي', f: b => money(b.total) }, { h: 'الدفع', f: b => badge(PAY, b.status) }], bk.bookings.slice(0, 7), { empty: 'مفيش حجوزات لسه' });
    m.onclick = e => { const g = e.target.closest('[data-go]'); if (g) DS.go(g.dataset.go); };
  } },
  // ================= owner accounts =================
  { label: 'الأونرز', icon: 'shield', render: async m => {
    const list = (await roles());
    m.innerHTML = `<h2 class="pt">حسابات الأونرز <button class="btn" id="add">+ حساب جديد</button></h2>` + table([
      { h: 'الاسم', f: r => `<b>${esc(r.name || '—')}</b><div class="muted">${esc(r.email || '')}</div>` }, { h: 'النوع', f: r => ROLE_L[r.role] || r.role },
      { h: 'العمولة', f: r => r.commissionRate != null ? r.commissionRate + '%' : '<span class="muted">افتراضي</span>' }, { h: 'حساب الاستلام', f: r => r.hasPayout ? DS.METHOD[r.payoutMethod] : '<span class="muted">—</span>' },
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
        if (a === 'edit') { const S = [{ k: 'name', l: 'الاسم' }, { k: 'phone', l: 'التليفون' }, { k: 'role', l: 'النوع', t: 'select', opts: ROLE_OPTS }, { k: 'commissionRate', l: 'نسبة عمولة خاصة % (فاضي = الافتراضي)', t: 'num' }], f = form(S, r);
          modal({ title: 'تعديل ' + (r.name || ''), body: f, actions: [{ t: 'حفظ', fn: async () => { const v = collect(f, S); if (!('commissionRate' in v)) v.commissionRate = null; await api('/roles/' + r.uid, { method: 'PUT', body: v }); DS.reload(); } }] }); }
      } catch (er) { toast(er.message, true); }
    };
  } },
  // ================= customers =================
  { label: 'العملاء', icon: 'users', render: async m => {
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
  { label: 'المحتوى', icon: 'layers', render: async m => {
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
  { label: 'الحجوزات', icon: 'cal', render: async m => DS.bookingsView({ admin: true, roles: await roles() })(m) },
  // ================= accounting =================
  { label: 'المحاسبة', icon: 'wallet', render: async m => {
    let tab = 'report', rs = (await roles()).filter(r => r.role !== 'super_admin'), q = { from: '', to: '', basis: 'booked', type: '', owner: '' }, sel = '';
    const PS = { requested: ['قيد المراجعة', 'amber'], paid: ['اتحوّل', 'green'], rejected: ['مرفوض', 'red'], cancelled: ['ملغي', 'gray'] };
    const rawName = id => { const r = rs.find(x => x.uid === id); return r ? (r.name || r.email) : ''; };
    const oname = id => { const r = rs.find(x => x.uid === id); return r ? esc(r.name || r.email) : '—'; };
    const ownerSel = (id, cur, all) => `<select id="${id}">${all ? '<option value="">كل الأونرز</option>' : '<option value="">— اختار أونر —</option>'}${rs.map(r => `<option value="${r.uid}" ${r.uid === cur ? 'selected' : ''}>${esc(r.name || r.email)} (${ROLE_L[r.role]})</option>`).join('')}</select>`;
    const V = {
      // ---- reports ----
      report: async box => {
        const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&'), d = await api('/finance/report?' + qs), t = d.totals;
        box.innerHTML = `<div class="card"><div class="row"><label class="muted">من</label><input type="date" id="qf" value="${q.from}" style="max-width:150px"><label class="muted">إلى</label><input type="date" id="qt" value="${q.to}" style="max-width:150px">
          <select id="qb" style="max-width:190px"><option value="booked" ${q.basis === 'booked' ? 'selected' : ''}>بتاريخ الحجز (المبيعات)</option><option value="realized" ${q.basis === 'realized' ? 'selected' : ''}>بتاريخ التنفيذ (المحقق)</option></select>
          <select id="qy" style="max-width:130px"><option value="">كل الأنواع</option><option value="hotel" ${q.type === 'hotel' ? 'selected' : ''}>فنادق</option><option value="excursion" ${q.type === 'excursion' ? 'selected' : ''}>رحلات</option><option value="transfer" ${q.type === 'transfer' ? 'selected' : ''}>ترانسفير</option></select>${ownerSel('qo', q.owner, true)}<button class="btn" id="qg">تحديث</button></div></div>
          <div class="stats">${DS.stat(money(t.gross), 'مبيعات مدفوعة (قبل الضرائب)')}${DS.stat(money(t.taxes), 'ضرائب/رسوم محصّلة (للمنصة)')}${DS.stat(money(t.commissionRealized), 'عمولتك المحققة (خدمات اتنفّذت)')}${DS.stat(money(t.commissionPending), 'عمولة معلّقة (لسه الخدمة ماتمتش)')}${DS.stat(money(t.netRealized), 'صافي الأونرز المحقق')}${DS.stat(money(t.owed), 'مستحق للأونرز دلوقتي')}${DS.stat(money(t.paidOut), 'اتحوّل للأونرز')}${DS.stat(money(t.pendingPayouts), 'طلبات صرف مفتوحة')}${t.unowned ? DS.stat(money(t.unowned), 'مبيعات بدون أونر') : ''}</div>
          <h2 class="pt">حسب الأونر <button class="btn ghost sm" id="c1">CSV</button></h2>` + table([{ h: 'الأونر', f: o => `<b>${esc(o.name)}</b><div class="muted">${ROLE_L[o.role]}</div>` }, { h: 'حجوزات', f: o => o.bookings }, { h: 'مبيعات', f: o => money(o.gross) }, { h: 'عمولة محققة', f: o => money(o.commissionRealized) }, { h: 'عمولة معلّقة', f: o => money(o.commissionPending) }, { h: 'صافي محقق', f: o => money(o.netRealized) }, { h: 'رصيده المتاح', f: o => `<b>${money(o.balance.available)}</b>` }, { h: 'اتحوّل له', f: o => money(o.balance.paid) }], d.owners) +
          `<h2 class="pt" style="margin-top:16px">تفاصيل الحجوزات ${d.truncated ? '<span class="muted">(أول 1500)</span>' : ''} <button class="btn ghost sm" id="c2">CSV</button></h2>` + table([{ h: 'الحجز', f: r => esc(r.id) }, { h: 'الأونر', f: r => oname(r.ownerUid) }, { h: 'العنصر', f: r => esc(r.item) }, { h: 'الحجز', f: r => dt(r.createdAt) }, { h: 'الخدمة', f: r => esc(r.serviceDate) }, { h: 'المبلغ', f: r => money(r.gross) }, { h: '%', f: r => r.rate ?? '' }, { h: 'العمولة', f: r => r.commission == null ? '' : money(r.commission) }, { h: 'الحالة', f: r => r.realized ? '<span class="badge b-green">محقق</span>' : '<span class="badge b-amber">معلّق</span>' }], d.rows.slice(0, 200));
        box.querySelector('#qg').onclick = () => { q = { from: box.querySelector('#qf').value, to: box.querySelector('#qt').value, basis: box.querySelector('#qb').value, type: box.querySelector('#qy').value, owner: box.querySelector('#qo').value }; draw(); };
        box.querySelector('#c1').onclick = () => DS.csv('owners-report.csv', ['الأونر', 'النوع', 'حجوزات', 'مبيعات', 'عمولة محققة', 'عمولة معلقة', 'صافي محقق', 'رصيد متاح', 'اتحوّل'], d.owners.map(o => [o.name, ROLE_L[o.role], o.bookings, o.gross, o.commissionRealized, o.commissionPending, o.netRealized, o.balance.available, o.balance.paid]));
        box.querySelector('#c2').onclick = () => DS.csv('bookings-report.csv', ['الحجز', 'النوع', 'الأونر', 'العنصر', 'العميل', 'تاريخ الحجز', 'تاريخ الخدمة', 'المبلغ', 'نسبة العمولة', 'العمولة', 'صافي الأونر', 'الحالة'], d.rows.map(r => [r.id, r.type, rawName(r.ownerUid), r.item, r.customer, r.createdAt, r.serviceDate, r.gross, r.rate, r.commission, r.net, r.realized ? 'محقق' : 'معلّق']));
      },
      // ---- payout requests ----
      payouts: async box => {
        const st = V._st ?? 'requested', d = (await api('/finance/payouts' + (st ? '?status=' + st : ''))).payouts;
        box.innerHTML = `<div class="row" style="justify-content:space-between"><div class="chips">${['requested', 'paid', 'rejected', ''].map(k => `<span class="chip ${k === st ? 'on' : ''}" data-s="${k}">${k ? PS[k][0] : 'الكل'}</span>`).join('')}</div><button class="btn" id="mp">+ تسجيل صرف يدوي</button></div>` +
          table([{ h: 'الرقم', f: p => `<b>${esc(p.id)}</b><div class="muted">${dt(p.requestedAt)}</div>` }, { h: 'الأونر', f: p => oname(p.ownerUid) }, { h: 'المبلغ', f: p => `<b>${money(p.amount)}</b>` }, { h: 'التحويل على', f: p => `${DS.METHOD[p.method] || ''}<div class="muted" dir="auto">${esc(DS.acctText(p.account))}</div>` }, { h: 'الحالة', f: p => DS.badge(PS, p.status) + (p.reference ? `<div class="muted">${esc(p.reference)}</div>` : '') },
            { h: '', f: p => p.status === 'requested' ? `<button class="btn sm" data-a="paid" data-i="${p.id}">تم التحويل</button> <button class="btn ghost sm" data-a="rej" data-i="${p.id}">رفض</button>` : '' }], d, { empty: 'مفيش طلبات' });
        box.onclick = async e => {
          const c = e.target.closest('[data-s]'); if (c) { V._st = c.dataset.s; return draw(); }
          const b = e.target.closest('[data-a]'); if (!b) return;
          try {
            if (b.dataset.a === 'paid') { const ref = prompt('رقم العملية / مرجع التحويل (إنستا باي أو بنك):'); if (!ref) return; await api('/finance/payouts/' + b.dataset.i, { method: 'PUT', body: { status: 'paid', reference: ref } }); }
            if (b.dataset.a === 'rej') { const why = prompt('سبب الرفض (هيظهر للأونر):'); if (!why) return; await api('/finance/payouts/' + b.dataset.i, { method: 'PUT', body: { status: 'rejected', note: why } }); }
            draw();
          } catch (er) { toast(er.message, true); }
        };
        box.querySelector('#mp').onclick = () => { const S = [{ k: 'ownerUid', l: 'الأونر', t: 'select', opts: rs.map(r => [r.uid, r.name || r.email]) }, { k: 'amount', l: 'المبلغ', t: 'num' }, { k: 'method', l: 'الطريقة', t: 'select', opts: [['instapay', 'إنستا باي'], ['bank', 'تحويل بنكي']] }, { k: 'reference', l: 'رقم العملية / المرجع' }, { k: 'note', l: 'ملاحظة' }], f = form(S, {});
          modal({ title: 'تسجيل صرف اتعمل بالفعل', body: f, actions: [{ t: 'حفظ', fn: async () => { await api('/finance/payouts', { method: 'POST', body: collect(f, S) }); toast('اتسجّل'); draw(); } }] }); };
      },
      // ---- owner statement ----
      owner: async box => {
        box.innerHTML = `<div class="card">${ownerSel('so', sel, false)}</div><div id="st"></div>`;
        box.querySelector('#so').onchange = e => { sel = e.target.value; draw(); };
        if (!sel) return;
        const d = await api('/finance/owner/' + sel), S = d.summary, st = box.querySelector('#st');
        st.innerHTML = `<div class="stats">${DS.stat(money(S.available), 'رصيد متاح')}${DS.stat(money(S.earned), 'أرباح مسجّلة')}${DS.stat(money(S.commission), 'عمولتك من الأونر ده')}${DS.stat(money(S.paid), 'اتحوّل')}${DS.stat(money(S.pending), 'قيد الصرف')}${DS.stat(money(S.adjustments), 'تسويات')}</div>
          <div class="card"><b>حساب الاستلام:</b> <span class="muted">${d.account ? DS.METHOD[d.account.method] + ' — ' + esc(DS.acctText(d.account)) : 'لسه ماضافش حساب'}</span> &nbsp; <span class="muted">عمولته: ${d.rate}%</span> <button class="btn ghost sm" id="ad" style="float:left">+ تسوية</button></div>
          <h2 class="pt">الأرباح المسجّلة</h2>` + table([{ h: 'الحجز', f: e => esc(e.id) }, { h: 'العنصر', f: e => esc(e.item) }, { h: 'الخدمة', f: e => esc(e.serviceDate) }, { h: 'المبلغ', f: e => money(e.gross) }, { h: 'العمولة', f: e => `${money(e.commission)} (${e.rate}%)` }, { h: 'الصافي', f: e => money(e.net) }], d.earnings) +
          `<h2 class="pt" style="margin-top:14px">الصرف والتسويات</h2>` + table([{ h: 'التاريخ', f: p => dt(p.paidAt || p.requestedAt) }, { h: 'المبلغ', f: p => money(p.amount) }, { h: 'الحالة', f: p => DS.badge(PS, p.status) }, { h: 'مرجع', f: p => esc(p.reference || p.note || '') }], d.payouts) +
          (d.adjustments.length ? table([{ h: 'التسوية', f: x => dt(x.createdAt) }, { h: 'المبلغ', f: x => money(x.amount) }, { h: 'السبب', f: x => esc(x.reason) }], d.adjustments) : '');
        st.querySelector('#ad').onclick = () => { const S2 = [{ k: 'amount', l: 'المبلغ (موجب = ليه، سالب = عليه)', t: 'num' }, { k: 'reason', l: 'السبب' }], f = form(S2, {});
          f.querySelector('input').removeAttribute('min');
          modal({ title: 'تسوية يدوية', body: f, actions: [{ t: 'حفظ', fn: async () => { const v = collect(f, S2); await api('/finance/adjustments', { method: 'POST', body: { ownerUid: sel, amount: v.amount, reason: v.reason } }); toast('اتسجّلت'); draw(); } }] }); };
      },
      // ---- settings ----
      settings: async box => {
        const d = await api('/finance/settings'), S = [{ k: 'hotel', l: 'عمولة الفنادق %', t: 'num' }, { k: 'excursion', l: 'عمولة الرحلات %', t: 'num' }, { k: 'transfer', l: 'عمولة الترانسفير %', t: 'num' }, { k: 'minPayout', l: 'أقل مبلغ للصرف (جنيه)', t: 'num' }], f = form(S, { ...d.settings.rates, minPayout: d.settings.minPayout });
        box.innerHTML = '<div class="card"><b>النسب الافتراضية</b><p class="muted" style="margin:6px 0 12px">بتتطبق وقت تسجيل تنفيذ الخدمة. تغييرها مبيأثرش على أرباح اتسجّلت قبل كده. لأونر معيّن: من تبويب الأونرز ← تعديل ← نسبة عمولة خاصة.</p></div>';
        box.firstChild.appendChild(f); const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'حفظ'; box.firstChild.appendChild(b);
        b.onclick = async () => { const v = collect(f, S); try { await api('/finance/settings', { method: 'PUT', body: { rates: { hotel: v.hotel, excursion: v.excursion, transfer: v.transfer }, minPayout: v.minPayout } }); toast('اتحفظ'); } catch (e) { toast(e.message, true); } };
      },
    };
    const draw = async () => {
      m.innerHTML = `<h2 class="pt">المحاسبة</h2><div class="chips" id="tb">${[['report', 'التقارير'], ['payouts', 'طلبات الصرف'], ['owner', 'كشف حساب أونر'], ['settings', 'العمولات']].map(([k, l]) => `<span class="chip ${k === tab ? 'on' : ''}" data-t="${k}">${l}</span>`).join('')}</div><div id="fb"><div class="empty">جاري التحميل…</div></div>`;
      m.querySelector('#tb').onclick = e => { const c = e.target.closest('[data-t]'); if (c) { tab = c.dataset.t; draw(); } };
      try { await V[tab](m.querySelector('#fb')); } catch (e) { m.querySelector('#fb').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
    await draw();
  } },
  // ================= partner applications =================
  { label: 'طلبات الشركاء', icon: 'brief', render: async m => {
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
  { label: 'الرسائل', icon: 'mail', render: async m => {
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
  { label: 'التقييمات', icon: 'star', render: async m => {
    const list = (await api('/reviews')).reviews;
    m.innerHTML = '<h2 class="pt">مراجعة التقييمات</h2>' + table([{ h: 'على', f: r => `${esc(r.type)}<div class="muted">${esc(r.itemId)}</div>` }, { h: 'العميل', f: r => esc(r.name) }, { h: '★', f: r => r.rating }, { h: 'التعليق', f: r => esc(String(r.comment).slice(0, 120)) }, { h: '', f: r => `<button class="btn ghost sm" data-i="${esc(r.type + '/' + r.itemId + '/' + r.id)}">مسح</button>` }], list, { empty: 'مفيش تقييمات' });
    m.onclick = async e => { const b = e.target.closest('[data-i]'); if (b && confirm('مسح التقييم؟')) { await api('/reviews/' + b.dataset.i, { method: 'DELETE' }); DS.reload(); } };
  } },
  // ================= raw files =================
  { label: 'الملفات', icon: 'code', render: async m => {
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
  { label: 'السجل', icon: 'list', render: async m => {
    const l = (await api('/audit?limit=150')).log;
    m.innerHTML = `<h2 class="pt">سجل العمليات <button class="btn ghost" id="ri">مزامنة ملكية الحجوزات</button></h2>` + table([{ h: 'الوقت', f: x => dt(x.ts) }, { h: 'العملية', f: x => esc(x.action) }, { h: 'الهدف', f: x => esc(x.target || '') }, { h: 'المنفّذ', f: x => `<span class="muted">${esc((x.role || '') + ' ' + String(x.uid).slice(0, 8))}</span>` }], l);
    m.querySelector('#ri').onclick = async () => { if (!confirm('هيعيد ربط كل الحجوزات بأونر العنصر الحالي. متأكد؟')) return; try { const r = await api('/maintenance/reindex', { method: 'POST', body: {} }); toast('اتحدّث ' + r.bookingsUpdated + ' حجز'); } catch (e) { toast(e.message, true); } };
  } },
] });
})();
