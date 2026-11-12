/* Discover Sharm — seller desk: the seller books for a walk-in customer from his own dashboard.
 *
 *   1. He picks the service, dates and guests and types the customer's details (e-mail + WhatsApp number).
 *   2. The price is the server's own (seller_quote → compute_booking_price) — the same number create_booking checks.
 *   3. He takes the amount from the customer in cash (the full price, or only the deposit — exactly like the site).
 *   4. He pays the platform from his own mobile wallet through the Kashier wallet endpoints of the payments Worker
 *      (/api/kashier/wallet/initiate → he approves on his phone → /api/kashier/wallet/reconcile until captured).
 *   5. The booking is confirmed straight away; the voucher goes to the customer by e-mail (Worker) or WhatsApp (link).
 *
 * Protection of the customer (see supabase/migrations/20261112000200_seller_customer_protection.sql):
 *   - before any charge the CUSTOMER confirms his e-mail with a 6-digit code the platform mails him (the seller types in what he reads out);
 *   - the confirmation + voucher e-mail is sent by the platform itself, with the amount paid online and what is left for the service location;
 *   - the account must be verified by the admin; deposits, the cap on the amount left on site and the daily limit are controlled per seller.
 *
 * The booking is made from the seller's own account, so create_booking records his commission by itself (no commission when the
 * customer e-mail is the seller's own). The customer has no account: the voucher opens through the public_voucher() RPC, and the
 * booking id — 22+ random characters generated here — is the secret that protects it.
 */
(function () {
'use strict';
if (!window.DS) return;
const DS = window.DS, esc = DS.esc, $ = (s, r) => (r || document).querySelector(s);

const KINDS = { hotel: 'فندق', excursion: 'رحلة', package: 'باكدج', transfer: 'انتقال' };
const ID_KEY = { hotel: 'hotelId', excursion: 'excursionId', package: 'packageId', transfer: 'transferId' };
const nm = v => (v && typeof v === 'object') ? (v.en || v.ar || Object.values(v).find(Boolean) || '') : (v || '');

// ---- small helpers ---------------------------------------------------------------------------------------------------------
const cairoDay = (offset = 0) => { const d = new Date(Date.now() + offset * 864e5); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); };
const depositAllowed = day => !!day && day >= cairoDay(2);                           // same rule as the guard_deposit_date trigger
const nightsBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 864e5));
const rid = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(22)); return 'SL' + [...r].map(x => A[x % A.length]).join(''); };
const money = n => DS.money(n) + ' EGP';
const waNumber = p => { let d = String(p || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) return d.slice(1); d = d.replace(/^00/, ''); if (d.startsWith('0')) return '20' + d.slice(1); if (/^1\d{9}$/.test(d)) return '20' + d; return d; };
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e || '');
const walletOk = p => /^\+?[0-9]{6,15}$/.test(p || '');
const cfg = () => window.DS_SUPABASE || {};

// ---- payments Worker -------------------------------------------------------------------------------------------------------
async function pay(path, body) {
  const base = String(cfg().paymentsBase || '').replace(/\/+$/, '');
  if (!base) throw new Error('الدفع غير مفعّل على الموقع ده (DS_PAYMENTS_BASE)');
  const tok = window.DS_ACCESS_TOKEN ? await window.DS_ACCESS_TOKEN() : '';
  if (!tok) throw new Error('الجلسة انتهت — سجّل دخول تاني');
  let r; try { r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) }); }
  catch { throw new Error('تعذّر الوصول لخدمة الدفع — جرّب تاني'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.message || 'فشل الطلب');
  return j;
}

// ---- voucher sharing (shared by the new-booking screen and the bookings list) ------------------------------------------------
const voucherUrl = (me, id) => ((me.sites || {}).app || (me.sites || {}).www || location.origin).replace(/\/$/, '') + '/voucher/?id=' + encodeURIComponent(id);
const verifyUrl = (me, id) => voucherUrl(me, id).replace('/voucher/', '/verify/');
const waText = (b, url, vurl) => `أهلاً ${b.name || ''}، تم تأكيد حجزك مع Discover Sharm ✅\nرقم الحجز: ${b.id}\nالفاوتشر: ${url}\n\nتأكد من حجزك ومن المبلغ المدفوع والمتبقي من هنا: ${vurl}\nالمتبقي (لو فيه) بتدفعه لمقدّم الخدمة في مكان الخدمة فقط — مش لأي حد تاني.\n\nHello ${b.name || ''}, your Discover Sharm booking is confirmed.\nVoucher: ${url}\nCheck what was paid online and what is left to pay on site: ${vurl}`;
function shareHtml(me, b) {
  const url = voucherUrl(me, b.id);
  return `<div class="row" style="margin-top:12px">
    <button class="btn" data-sv="mail" ${emailOk(b.email) ? '' : 'disabled'}>${DS.ic('mail')} ابعت الفاوتشر على الإيميل</button>
    <button class="btn" data-sv="wa" ${b.phone ? '' : 'disabled'}>${DS.ic('users')} ابعت على واتساب</button>
    <button class="btn ghost" data-sv="copy">نسخ لينك الفاوتشر</button>
    <a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">فتح الفاوتشر</a></div>
    <p class="muted" style="margin-top:8px;word-break:break-all" dir="ltr">${esc(url)}</p>`;
}
function wireShare(root, me, b) {
  const url = voucherUrl(me, b.id);
  root.addEventListener('click', async e => {
    const x = e.target.closest('[data-sv]'); if (!x) return;
    if (x.dataset.sv === 'wa') window.open('https://wa.me/' + waNumber(b.phone) + '?text=' + encodeURIComponent(waText(b, url, verifyUrl(me, b.id))), '_blank', 'noopener');
    else if (x.dataset.sv === 'copy') { try { await navigator.clipboard.writeText(url); DS.toast('اتنسخ'); } catch { prompt('انسخ الرابط:', url); } }
    else if (x.dataset.sv === 'mail') {
      x.disabled = true;
      try { await pay('/api/notify/resend', { orderId: b.id }); DS.toast('الفاوتشر اتبعت على إيميل العميل'); }
      catch (er) { DS.toast(er.message, true); } finally { x.disabled = false; }
    }
  });
}
// the list of the seller's bookings opens this for a booking he made himself
DS.sellerVoucher = (me, x) => {
  const b = { id: x.id, name: x.customer, email: x.email, phone: x.phone };
  const box = document.createElement('div'); box.innerHTML = `<p><b>${esc(x.customer || '')}</b> · <span dir="ltr">${esc(x.phone || '')}</span> · <span dir="ltr">${esc(x.email || '')}</span></p>` + shareHtml(me, b);
  wireShare(box, me, b);
  DS.modal({ title: 'فاوتشر الحجز ' + x.id, body: box });
};

// ---- the new-booking screen -------------------------------------------------------------------------------------------------
DS.sellerDesk = (me) => ({ label: 'حجز جديد', icon: 'plus', render: async m => {
  m.innerHTML = '<div class="empty">جاري التحميل…</div>';
  let items; try { items = (await DS.api('/desk/catalog')).items; } catch (e) { m.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!items.length) { m.innerHTML = '<h2 class="pt">حجز جديد</h2><div class="card"><div class="empty">مفيش خدمات منشورة لسه</div></div>'; return; }
  const kinds = Object.keys(KINDS).filter(k => items.some(i => i.kind === k));
  const S = { kind: kinds[0], id: '', f: { adults: 2, children: 0, rooms: 1, participants: 2, passengers: 1, childAges: [], plan: 'full', direction: 'Airport to Hotel' }, price: null, perr: '', booking: null };
  try { S.f.wallet = localStorage.getItem('ds_seller_wallet') || ''; } catch {}
  try { S.st = (await DS.api('/desk/status')).status || {}; } catch { S.st = {}; }        // what the admin allows for this seller (verified, deposit, limits)
  const list = () => items.filter(i => i.kind === S.kind);
  const cur = () => items.find(i => i.id === S.id);
  const rooms = () => (cur() && Array.isArray(cur().data.rooms)) ? cur().data.rooms : [];
  S.id = (list()[0] || {}).id || '';

  const fld = (label, inner, hint) => `<div class="fld"><label>${label}</label>${inner}${hint ? `<small>${hint}</small>` : ''}</div>`;
  const inp = (k, type = 'text', extra = '') => `<input data-k="${k}" type="${type}" value="${esc(S.f[k] == null ? '' : S.f[k])}" ${extra}>`;

  const draw = () => {
    const it = cur(), f = S.f, hotel = S.kind === 'hotel', xfer = S.kind === 'transfer';
    const st = S.st || {}, day = hotel ? f.checkin : f.date, dep = depositAllowed(day) && !!st.depositOk;
    if (f.plan === 'deposit' && !dep) f.plan = 'full';
    const left = st.dailyLimit != null ? Math.max(0, Number(st.dailyLimit) - Number(st.usedToday || 0)) : null;
    const warn = st.flagged ? 'الحجز من حسابك موقوف مؤقتًا — تواصل مع الإدارة.' : (st.verified === false ? 'حسابك لسه ما اتوثّقش من الإدارة — مش هتقدر تحجز لعملاء لحد ما يتوثّق.' : '');
    m.innerHTML = (warn ? `<div class="card" style="border-color:#b45309"><b>⚠️ ${warn}</b></div>` : '') + `<h2 class="pt">حجز جديد لعميل</h2>
      <p class="muted" style="margin:-6px 0 14px;line-height:1.9">استلم المبلغ كاش من العميل، وادفعه للمنصة من محفظتك الإلكترونية هنا. قبل الدفع العميل بيأكّد إيميله بكود بيوصله من المنصة، والمنصة هي اللي بتبعتله الفاوتشر والمبلغ المدفوع. عمولتك بتتسجّل بعد تنفيذ الخدمة.${left != null ? `<br>الحد اليومي المتبقي لك: <b>${money(left)}</b>` : ''}</p>
      <div class="card"><span class="ct">1 · الخدمة</span><div class="grid2" style="margin-top:10px">
        ${fld('النوع', `<select data-k="kind">${kinds.map(k => `<option value="${k}" ${k === S.kind ? 'selected' : ''}>${KINDS[k]}</option>`).join('')}</select>`)}
        ${fld('الخدمة', `<select data-k="id">${list().map(i => `<option value="${esc(i.id)}" ${i.id === S.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>`)}
        ${hotel ? `${fld('الغرفة', `<select data-k="room">${rooms().map((r, i) => `<option value="${i}" ${String(f.room ?? 0) === String(i) ? 'selected' : ''}>${esc(nm(r.type))} — ${DS.money(r.price)} EGP</option>`).join('')}</select>`)}
          ${fld('تاريخ الوصول', inp('checkin', 'date', `min="${cairoDay()}"`))}${fld('تاريخ المغادرة', inp('checkout', 'date', `min="${f.checkin || cairoDay()}"`))}
          ${fld('عدد الغرف', inp('rooms', 'number', 'min="1" max="5"'))}${fld('البالغين', inp('adults', 'number', 'min="1" max="10"'))}${fld('الأطفال', inp('children', 'number', 'min="0" max="6"'))}
          ${Number(f.children) > 0 ? fld('أعمار الأطفال', Array.from({ length: Math.min(6, Number(f.children)) }, (_, i) => `<input data-age="${i}" type="number" min="0" max="17" value="${esc((f.childAges || [])[i] ?? '')}" style="width:70px;margin-inline-end:6px">`).join('')) : ''}`
        : `${fld('تاريخ الخدمة', inp('date', 'date', `min="${cairoDay()}"`))}
          ${xfer ? `${fld('الركاب', inp('passengers', 'number', 'min="1" max="50"'))}${fld('الاتجاه', `<select data-k="direction"><option value="Airport to Hotel" ${f.direction === 'Airport to Hotel' ? 'selected' : ''}>من المطار للفندق</option><option value="Hotel to Airport" ${f.direction === 'Hotel to Airport' ? 'selected' : ''}>من الفندق للمطار</option></select>`)}
            ${fld('الساعة', inp('time', 'time'))}${fld('رقم الرحلة (اختياري)', inp('flightNo'))}${fld('اسم الفندق / العنوان', inp('address'))}`
          : fld('عدد الأفراد', inp('participants', 'number', 'min="1" max="50"'))}`}
      </div></div>
      <div class="card"><span class="ct">2 · بيانات العميل</span><div class="grid2" style="margin-top:10px">
        ${fld('الاسم', inp('name'))}${fld('رقم واتساب العميل', inp('phone', 'tel', 'dir="ltr" placeholder="01XXXXXXXXX"'), 'الفاوتشر بيتبعت عليه لو اخترت واتساب')}
        ${fld('إيميل العميل', inp('email', 'email', 'dir="ltr"'), 'الفاوتشر بيوصل عليه. لازم يكون إيميل العميل مش إيميلك.')}</div></div>
      <div class="card"><span class="ct">3 · الدفع</span>
        <div class="row" style="margin:10px 0 4px">
          <label class="btn ${f.plan === 'full' ? '' : 'ghost'}"><input type="radio" name="plan" value="full" ${f.plan === 'full' ? 'checked' : ''} style="display:none"> دفع كامل</label>
          <label class="btn ${f.plan === 'deposit' ? '' : 'ghost'}" ${dep ? '' : 'style="opacity:.45;pointer-events:none"'}><input type="radio" name="plan" value="deposit" ${f.plan === 'deposit' ? 'checked' : ''} style="display:none"> عربون (50%)</label></div>
        ${!st.depositOk ? '<p class="muted">العربون مش مفعّل لحسابك — الدفع كامل بس.</p>' : (dep || !day ? `<p class="muted">لو اخترت عربون: المتبقي على العميل لازم ما يزيدش عن ${money(st.depositMaxRemaining || 0)}.</p>` : '<p class="muted">العربون مش متاح لحجز بكرة أو أقرب — لازم دفع كامل.</p>')}
        <div id="pq" class="card" style="margin-top:10px"></div>
        <div class="grid2" style="margin-top:12px">${fld('رقم محفظتك الإلكترونية (اللي هتدفع منها)', inp('wallet', 'tel', 'dir="ltr" placeholder="01XXXXXXXXX"'), 'هيجيلك طلب دفع على الموبايل — وافق عليه.')}</div>
        <button class="btn" id="go" style="margin-top:6px">${DS.ic('wallet')} ادفع من المحفظة وأكّد الحجز</button></div>`;
    drawPrice();
  };

  const drawPrice = () => {
    const box = $('#pq', m); if (!box) return; const p = S.price;
    if (S.perr) { box.innerHTML = `<div class="muted">${esc(S.perr)}</div>`; return; }
    if (!p) { box.innerHTML = '<div class="muted">كمّل البيانات علشان يظهر السعر</div>'; return; }
    const r = (k, v, b) => `<div class="row" style="justify-content:space-between;padding:4px 0">${b ? '<b>' : ''}<span>${k}</span><span dir="ltr">${v}</span>${b ? '</b>' : ''}</div>`;
    const est = Math.round(Number(p.subtotal) * Number(me.rate || 0)) / 100;
    box.innerHTML = r('سعر الخدمة', money(p.subtotal)) + r('الضرائب', money(p.taxes)) + r('رسوم الدفع الإلكتروني', money(p.fee)) +
      r('المبلغ اللي تاخده من العميل كاش وتدفعه من محفظتك', money(p.due), true) +
      (Number(p.remaining) > 0 ? r('المتبقي بيدفعه العميل لمقدّم الخدمة في مكان الخدمة', money(p.remaining)) : '') +
      `<div class="muted" style="margin-top:6px">عمولتك المتوقعة: حتى ${money(est)} (${me.rate}%) — بتتسجّل بعد تنفيذ الخدمة.</div>`;
  };

  // ---- payload + live quote -------------------------------------------------------------------------------------------------
  const payload = (withCustomer) => {
    const it = cur(), f = S.f, d = it.data || {}, raw = d.hotelName || d.title || d.name || d.vehicleType || it.name;
    const base = { id: f.__id || (f.__id = rid()), type: S.kind, currency: 'EGP', status: 'pending_payment', reviewed: false, createdAt: new Date().toISOString(),
      [ID_KEY[S.kind]]: it.id, image: d.image || '', paymentPlan: f.plan, total: 0 };
    if (withCustomer) Object.assign(base, { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() });
    if (S.kind === 'hotel') {
      const r = rooms()[Number(f.room || 0)]; if (!r || !f.checkin || !f.checkout) return null;
      const ages = Array.from({ length: Number(f.children) || 0 }, (_, i) => Number((f.childAges || [])[i])).map(x => isNaN(x) ? 0 : x);
      return Object.assign(base, { hotelName: raw, location: d.location, rating: d.rating, checkin: f.checkin, checkout: f.checkout, adults: Number(f.adults), children: Number(f.children) || 0, childAges: ages,
        guests: Number(f.adults) + (Number(f.children) || 0), infants: 0, rooms: Number(f.rooms), roomType: r.type, roomIndex: Number(f.room || 0), nights: nightsBetween(f.checkin, f.checkout) });
    }
    if (!f.date) return null;
    if (S.kind === 'transfer') return Object.assign(base, { vehicleType: raw, date: f.date, time: f.time || '', passengers: Number(f.passengers), direction: f.direction, flightNo: f.flightNo || '', address: f.address || '' });
    return Object.assign(base, { title: raw, category: d.category, date: f.date, participants: Number(f.participants) });
  };
  let qt = 0;
  const requote = () => {
    clearTimeout(qt); S.price = null; S.perr = '';
    const p = cur() && payload(false); if (!p) { drawPrice(); return; }
    const my = ++requote.n;
    qt = setTimeout(async () => {
      try { const r = await DS.api('/desk/quote', { method: 'POST', body: p }); if (my === requote.n) { S.price = r.price; S.perr = ''; } }
      catch (e) { if (my === requote.n) { S.price = null; S.perr = e.message; } }
      drawPrice();
    }, 350);
    drawPrice();
  }; requote.n = 0;

  m.onchange = m.oninput = e => {
    const t = e.target, f = S.f;
    if (t.name === 'plan') { f.plan = t.value; S.booking = null; f.__id = null; draw(); requote(); return; }
    if (t.dataset.age != null) { f.childAges[Number(t.dataset.age)] = t.value; S.booking = null; f.__id = null; requote(); return; }
    const k = t.dataset.k; if (!k) return;
    if (k !== 'wallet') { S.booking = null; f.__id = null; }           // any change of the booking = a new booking id (an unpaid old one just expires)
    if (k === 'kind') { S.kind = t.value; S.id = (list()[0] || {}).id; f.room = 0; f.__id = null; draw(); requote(); return; }
    if (k === 'id') { S.id = t.value; f.room = 0; f.__id = null; draw(); requote(); return; }
    f[k] = t.value;
    if (e.type === 'change' && ['checkin', 'checkout', 'date', 'children', 'room', 'rooms', 'adults', 'participants', 'passengers'].includes(k)) { if (k === 'checkin' || k === 'date' || k === 'children') draw(); requote(); }
  };

  // ---- pay ------------------------------------------------------------------------------------------------------------------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function run() {
    const f = S.f;
    if (!f.name.trim() || f.name.trim().length < 2) return DS.toast('اكتب اسم العميل', true);
    if (!emailOk(f.email)) return DS.toast('إيميل العميل غير صحيح', true);
    if (!/^\+?[0-9 ]{8,16}$/.test(f.phone || '')) return DS.toast('رقم واتساب العميل غير صحيح', true);
    if (String(f.email).trim().toLowerCase() === String(me.email || '').toLowerCase()) return DS.toast('إيميل العميل لازم يكون غير إيميلك (الحجز على إيميلك مفيهوش عمولة)', true);
    if (!walletOk(String(f.wallet || '').replace(/\s/g, ''))) return DS.toast('اكتب رقم محفظتك الإلكترونية', true);
    if (!S.price) return DS.toast(S.perr || 'السعر لسه ما ظهرش — كمّل البيانات', true);
    f.wallet = String(f.wallet).replace(/\s/g, ''); try { localStorage.setItem('ds_seller_wallet', f.wallet); } catch {}
    const dueTxt = Number(S.price.remaining) > 0 ? `\n\nمهم: خد من العميل ${money(S.price.due)} بس. المتبقي ${money(S.price.remaining)} بيدفعه لمقدّم الخدمة في المكان — لو خدت منه أكتر هتتعرّض للإيقاف.` : `\n\nخد من العميل ${money(S.price.due)} بالظبط.`;
    if (!confirm(`هتدفع ${money(S.price.due)} من محفظتك (${f.wallet}).\nاتأكد إنك استلمت المبلغ ده كاش من العميل.${dueTxt}\n\nنكمّل؟`)) return;
    const btn = $('#go', m); btn.disabled = true;
    try {
      let bk = S.booking;
      if (!bk) {
        const body = payload(true); body.total = Number(S.price.total);
        bk = (await DS.api('/desk/book', { method: 'POST', body })).booking; S.booking = bk;
      }
      if (S.verifiedId !== bk.id) { await contactFlow(bk); S.verifiedId = bk.id; }
      await walletFlow(bk, f.wallet);
    } catch (e) { DS.toast(e.message, true); btn.disabled = false; }
  }

  // the customer confirms his own e-mail: the platform mails him a code, the seller types in what the customer reads out
  function contactFlow(bk) {
    return new Promise((resolve, reject) => {
      const masked = String(bk.email || S.f.email || '').replace(/^(.).*(@.*)$/, '$1***$2');
      let done = false;
      const dlg = DS.modal({ title: 'تأكيد إيميل العميل', body: `<p class="muted" style="line-height:1.9">بعتنا كود من 6 أرقام على إيميل العميل <b dir="ltr">${esc(masked)}</b> — من المنصة مش منك. اطلب من العميل يفتح إيميله ويقرأ لك الكود.<br>الكود بيوصله مع تفاصيل الحجز والمبلغ، فلو المبلغ مش مظبوط يرفض.</p>
        <div class="fld"><label>الكود</label><input id="otp" inputmode="numeric" maxlength="6" dir="ltr" style="letter-spacing:6px;font-size:20px" autocomplete="one-time-code"></div>
        <div class="row"><button class="btn" id="otpgo" type="button">تأكيد</button><button class="btn ghost" id="otpre" type="button">ابعت الكود تاني</button></div><div class="muted" id="otpmsg" style="margin-top:8px"></div>`, actions: [] });
      const say = t => { const e = $('#otpmsg', dlg.el); if (e) e.textContent = t; };
      const send = async () => { try { say('بنبعت الكود…'); await pay('/api/seller/otp/send', { orderId: bk.id }); say('اتبعت — ممكن يتأخر دقيقة. بص في الـ Spam لو ما وصلش.'); } catch (e) { say(e.message); } };
      $('#otpre', dlg.el).onclick = send;
      $('#otpgo', dlg.el).onclick = async () => {
        const code = ($('#otp', dlg.el).value || '').trim(); if (!/^\d{6}$/.test(code)) return say('اكتب الكود (6 أرقام)');
        try { await pay('/api/seller/otp/verify', { orderId: bk.id, code }); done = true; dlg.close(); resolve(); } catch (e) { say(e.message); }
      };
      const ov = dlg.el.closest('.ov'), obs = new MutationObserver(() => { if (!document.body.contains(ov)) { obs.disconnect(); if (!done) reject(new Error('لازم العميل يأكّد إيميله قبل الدفع')); } });
      obs.observe(document.body, { childList: true });
      send();
    });
  }

  async function walletFlow(bk, wallet) {
    const due = bk.amountDueNow != null ? bk.amountDueNow : bk.total;
    const dlg = DS.modal({ title: 'الدفع من المحفظة', body: '<div class="empty" id="ws">بنبعت طلب الدفع لمحفظتك…</div>', actions: [] });
    const say = t => { const e = $('#ws', dlg.el); if (e) e.textContent = t; };
    try {
      const st = await pay('/api/kashier/wallet/initiate', { orderId: bk.id, amount: due, currency: bk.currency || 'EGP', mobilePhone: wallet });
      if (st.status === 'failed') throw new Error(st.message || 'تعذّر بدء الدفع من المحفظة');
      let status = st.status;
      say('وافق على طلب الدفع على موبايلك (' + wallet + ')… بننتظر التأكيد');
      for (let i = 0; i < 45 && status !== 'captured' && status !== 'completed'; i++) {
        await sleep(4000);
        status = (await pay('/api/kashier/wallet/reconcile', { orderId: bk.id })).status;
        if (status === 'failed') throw new Error('الدفع ما تمش (اترفض أو انتهت مدته). جرّب تاني.');
      }
      if (status !== 'captured' && status !== 'completed') throw new Error('لسه ما وصلش تأكيد الدفع. لو اتسحب المبلغ من محفظتك هيظهر الحجز في "الحجوزات" لما يتأكد.');
      dlg.close(); success(bk);
    } catch (e) { dlg.close(); const b = $('#go', m); if (b) b.disabled = false; throw e; }
  }

  function success(bk) {
    const f = S.f, b = { id: bk.id, name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() };
    m.innerHTML = `<div class="card"><div class="ico green" style="width:46px;height:46px;margin-bottom:8px">${DS.ic('check')}</div><h2 class="pt" style="margin:0">الحجز اتأكد ✅</h2>
      <p class="muted" style="margin-top:6px">المنصة بعتت للعميل تأكيد الحجز والفاوتشر على إيميله مع المبلغ المدفوع${Number(bk.remainingAmount) > 0 ? ' والمتبقي' : ''}.</p>
      <p class="muted" style="margin-top:6px">رقم الحجز: <b dir="ltr">${esc(bk.id)}</b> · ${esc(b.name)} · تم دفع ${money(bk.amountDueNow != null ? bk.amountDueNow : bk.total)} من محفظتك.${Number(bk.remainingAmount) > 0 ? ` المتبقي ${money(bk.remainingAmount)} بيدفعه العميل لمقدّم الخدمة في مكان الخدمة.` : ''}</p>
      ${shareHtml(me, b)}<div class="row" style="margin-top:16px"><button class="btn ghost" id="again">${DS.ic('plus')} حجز جديد</button></div></div>`;
    wireShare(m, me, b); $('#again', m).onclick = () => DS.reload();
  }

  m.addEventListener('click', e => { if (e.target.closest('#go')) run(); });
  draw(); requote();
} });

})();
