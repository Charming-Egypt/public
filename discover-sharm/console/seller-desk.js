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

// ---- date formatting + calendar (same rules as the app: from tomorrow on, blocked dates, one connected range for hotels) ----------------
const LANG = () => (window.DS_ALANG === 'ar' ? 'ar' : 'en');
const fmtDay = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(LANG() === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MONTHS = { en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'] };
const WEEK = { en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], ar: ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] };
const T = (en, ar) => LANG() === 'ar' ? ar : en;           // strings of the calendar follow the interface language directly

// opts: range (bool) · start/end/value · stage ('in'|'out') · min · blocked[] · title · done(a, b)
function calendar(o) {
  const blocked = new Set(o.blocked || []), min = o.min;
  let a = o.range ? o.start : o.value, b = o.range ? o.end : null, stage = o.range && o.stage === 'out' && a ? 'out' : 'in';
  let view = new Date((a || min) + 'T00:00:00'); view.setDate(1);
  const nextBlocked = from => { let best = ''; blocked.forEach(d => { if (d >= from && (!best || d < best)) best = d; }); return best; };
  const off = iso => {
    if (iso < min) return true;
    if (!(o.range && stage === 'out' && a)) return blocked.has(iso);
    if (iso <= a || iso > addDays(a, 60)) return true;
    const nb = nextBlocked(a); return !!nb && iso > nb;              // the check-out day itself may be a blocked day; a night may not
  };
  const body = document.createElement('div'); body.className = 'sd-cal';
  const dlg = DS.modal({ title: o.title, body });
  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth(), first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
    const prevOff = new Date(y, m, 1) <= new Date(min.slice(0, 7) + '-01T00:00:00');
    let cells = '<i></i>'.repeat(first);
    for (let d = 1; d <= n; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const end = iso === a || iso === b, rng = o.range && a && b && iso > a && iso < b, dis = off(iso);
      cells += `<button type="button" data-iso="${iso}" class="${end ? 'on' : rng ? 'rng' : ''}" ${dis ? 'disabled' : ''}>${d}</button>`;
    }
    const nights = a && b ? Math.round((new Date(b) - new Date(a)) / 864e5) : 0;
    const st = !o.range ? '' : (a && b) ? `${nights} ${T(nights === 1 ? 'night' : 'nights', 'ليلة')} — ${fmtDay(a)} → ${fmtDay(b)}` : stage === 'out' ? T('Select the check-out date', 'اختر تاريخ المغادرة') : T('Select the check-in date', 'اختر تاريخ الوصول');
    body.innerHTML = `<div class="hd"><button type="button" data-mv="-1" ${prevOff ? 'disabled' : ''}>‹</button><b>${MONTHS[LANG()][m]} ${y}</b><button type="button" data-mv="1">›</button></div>
      <div class="st">${st}</div><div class="wd">${WEEK[LANG()].map(w => `<span>${w}</span>`).join('')}</div><div class="gr">${cells}</div>`;
  };
  body.onclick = e => {
    const mv = e.target.closest('[data-mv]'); if (mv) { view.setMonth(view.getMonth() + Number(mv.dataset.mv)); draw(); return; }
    const x = e.target.closest('[data-iso]'); if (!x || x.disabled) return; const iso = x.dataset.iso;
    if (!o.range) { o.done(iso); dlg.close(); return; }
    if (stage === 'in' || !a || iso <= a) { a = iso; b = null; stage = 'out'; draw(); return; }
    b = iso; draw(); setTimeout(() => { o.done(a, b); dlg.close(); }, 300);
  };
  draw();
}

// ---- the new-booking wizard -------------------------------------------------------------------------------------------------
const img = (me, u) => { u = String(u || ''); return !u ? '' : /^(https?:|data:|\/\/)/.test(u) ? u : ((me.sites || {}).app || '').replace(/\/$/, '') + '/' + u.replace(/^\//, ''); };
const MAX = { adults: 10, children: 6, infants: 4, rooms: 5 }, CHILD_AGE_MAX = 11;

DS.sellerDesk = (me) => ({ label: 'حجز جديد', icon: 'plus', render: async m => {
  m.innerHTML = '<div class="empty">جاري التحميل…</div>';
  let items; try { items = (await DS.api('/desk/catalog')).items; } catch (e) { m.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!items.length) { m.innerHTML = '<h2 class="pt">حجز جديد</h2><div class="card"><div class="empty">مفيش خدمات منشورة لسه</div></div>'; return; }
  const kinds = Object.keys(KINDS).filter(k => items.some(i => i.kind === k));
  const fresh = () => ({ adults: 2, children: 0, infants: 0, rooms: 1, participants: 2, passengers: 1, childAges: [], plan: 'full', direction: 'Airport to Hotel', time: '14:00', room: 0, requests: '', name: '', email: '', phone: '', checkin: '', checkout: '', date: '', flightNo: '', address: '', paid: false, wallet: S0.wallet });
  const S0 = { wallet: '' }; try { S0.wallet = localStorage.getItem('ds_seller_wallet') || ''; } catch {}
  let st0 = {}; try { st0 = (await DS.api('/desk/status')).status || {}; } catch {}      // what the admin allows for this seller (verified, deposit, limits)
  const S = { st: st0, step: 1, kind: kinds[0], id: '', f: fresh(), q: {}, perr: '', quoting: false, booking: null, tried: false };
  const list = () => items.filter(i => i.kind === S.kind);
  const cur = () => items.find(i => i.id === S.id);
  const D = () => (cur() || {}).data || {};
  const rooms = () => Array.isArray(D().rooms) ? D().rooms : [];
  const room = () => rooms()[Number(S.f.room) || 0] || null;
  const isPkgPrice = () => D().priceMode === 'package';
  const pkgPeople = () => Math.max(1, Math.min(50, Number(D().groupSize) || 2));
  const cap = () => Math.max(1, Number(D().capacity) || 4);
  const blocked = () => Array.isArray(D().unavailableDates) ? D().unavailableDates : [];
  const minDay = () => cairoDay(1);                                              // the app never books today
  S.id = (list()[0] || {}).id || '';
  const fix = () => { const f = S.f;
    if (S.kind === 'hotel') { const occ = Math.max(1, Number((room() || {}).guests) || 2), need = Math.min(MAX.rooms, Math.ceil((f.adults + f.children) / occ)); if (f.rooms < need) f.rooms = need; }
    if (isPkgPrice()) f.participants = pkgPeople(); if (S.kind === 'transfer') f.passengers = Math.min(f.passengers, cap());
    while (f.childAges.length < f.children) f.childAges.push(null); f.childAges.length = f.children; };
  const reset = () => { S.booking = null; S.f.__id = null; S.f.paid = false; };

  // ---- pieces ---------------------------------------------------------------------------------------------------------------
  const fld = (label, inner, hint) => `<div class="fld"><label>${label}</label>${inner}${hint ? `<small>${hint}</small>` : ''}</div>`;
  const inp = (k, type = 'text', extra = '') => `<input data-k="${k}" type="${type}" value="${esc(S.f[k] == null ? '' : S.f[k])}" ${extra}>`;
  const dateBtn = (id, label, val, icon) => `<button type="button" class="sd-date ${S.tried && !val ? 'err' : ''}" data-pick="${id}">${DS.ic(icon || 'cal')}<span><small>${label}</small><b>${val ? esc(fmtDay(val)) : 'اختر التاريخ'}</b></span></button>`;
  const stepper = (k, label, sub, min, max) => `<div class="sd-row"><div><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div><div class="sd-st"><button type="button" data-st="${k}" data-d="-1" ${S.f[k] <= min ? 'disabled' : ''}>−</button><span>${S.f[k]}</span><button type="button" data-st="${k}" data-d="1" ${S.f[k] >= max ? 'disabled' : ''}>+</button></div></div>`;
  const dayOf = () => S.kind === 'hotel' ? S.f.checkin : S.f.date;
  const depositOk = () => depositAllowed(dayOf()) && !!(S.st || {}).depositOk;
  const nights = () => S.f.checkin && S.f.checkout ? nightsBetween(S.f.checkin, S.f.checkout) : 0;

  const guestsLine = () => { const f = S.f, p = (n, one, many, ar) => `${n} ${T(n === 1 ? one : many, ar)}`;
    if (S.kind === 'hotel') return [p(f.adults, 'adult', 'adults', 'بالغ'), f.children ? p(f.children, 'child', 'children', 'طفل') : '', f.infants ? p(f.infants, 'infant', 'infants', 'رضيع') : '', p(f.rooms, 'room', 'rooms', 'غرفة')].filter(Boolean).join(' · ');
    if (S.kind === 'transfer') return p(f.passengers, 'passenger', 'passengers', 'راكب'); return p(f.participants, 'person', 'people', 'فرد'); };
  const nightsTxt = n => `${n} ${T(n === 1 ? 'night' : 'nights', 'ليلة')}`;
  const factsHtml = () => { const f = S.f;
    if (S.kind === 'hotel') return `${f.checkin && f.checkout ? `${esc(fmtDay(f.checkin))} → ${esc(fmtDay(f.checkout))} · ${nightsTxt(nights())}` : ''}${room() ? `<br>${esc(nm(room().type))}` : ''}<br>${guestsLine()}`;
    if (S.kind === 'transfer') return `${f.date ? esc(fmtDay(f.date)) + ' · ' + esc(f.time) : ''}<br>${f.direction === 'Airport to Hotel' ? 'من المطار للفندق' : 'من الفندق للمطار'} · ${guestsLine()}`;
    return `${f.date ? esc(fmtDay(f.date)) : ''}<br>${guestsLine()}`; };
  const sumHtml = (full) => { const it = cur(), q = S.q[S.f.plan], d = D(), pic = img(me, (S.kind === 'hotel' && room() && room().image) || d.image);
    const r = (k, v, c) => `<div class="sd-ln ${c || ''}"><span>${k}</span><span dir="ltr">${v}</span></div>`;
    let price = S.quoting ? '<div class="muted">جاري حساب السعر…</div>' : S.perr ? `<div class="sd-err">${esc(S.perr)}</div>` : !q ? '<div class="muted">كمّل البيانات علشان يظهر السعر</div>' :
      r('سعر الخدمة', money(q.subtotal)) + r('الضرائب', money(q.taxes)) + r('رسوم الدفع الإلكتروني', money(q.fee)) + r('الإجمالي', money(q.total), 't') +
      (full ? r(S.f.plan === 'deposit' ? 'العربون — بتاخده من العميل كاش دلوقتي' : 'بتاخده من العميل كاش دلوقتي', money(q.due), 'hi') + (Number(q.remaining) > 0 ? r('المتبقي بيدفعه العميل لمقدّم الخدمة في مكان الخدمة', money(q.remaining)) : '') +
        `<div class="muted" style="margin-top:8px">عمولتك المتوقعة: حتى ${money(Math.round(Number(q.subtotal) * Number(me.rate || 0)) / 100)} (${me.rate}%) — بتتسجّل بعد تنفيذ الخدمة.</div>` : '');
    return `<div class="sd-sum"><div class="hd">${pic ? `<img src="${esc(pic)}" alt="" onerror="this.remove()">` : ''}<div><b>${esc(it ? it.name : '')}</b><small>${KINDS[S.kind]}</small></div></div><div class="muted" style="line-height:1.9;margin-bottom:8px">${factsHtml()}</div>${price}</div>`; };
  const barHtml = (label, id, dis) => { const q = S.q[S.f.plan]; return `<div class="sd-bar"><div class="tt"><small>${S.step === 3 ? 'المطلوب دفعه الآن' : 'الإجمالي'}</small><b dir="ltr">${q ? money(S.step === 3 ? q.due : q.total) : '—'}</b></div><div class="row">${S.step > 1 ? '<button type="button" class="btn ghost" data-back>رجوع</button>' : ''}<button type="button" class="btn" id="${id}" ${dis ? 'disabled' : ''}>${label}</button></div></div>`; };

  // ---- steps ----------------------------------------------------------------------------------------------------------------
  const step1 = () => { const f = S.f, hotel = S.kind === 'hotel', xfer = S.kind === 'transfer', occ = Math.max(1, Number((room() || {}).guests) || 2);
    const svc = `<div class="card"><span class="ct">الخدمة</span>
      <div class="sd-seg" style="margin-bottom:12px">${kinds.map(k => `<button type="button" class="sd-chip ${k === S.kind ? 'on' : ''}" data-kind="${k}">${KINDS[k]}</button>`).join('')}</div>
      ${fld('اختر الخدمة', `<select data-k="id">${list().map(i => `<option value="${esc(i.id)}" ${i.id === S.id ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>`)}</div>`;
    if (hotel) return svc + `<div class="card"><span class="ct">الغرفة</span><div class="sd-rooms">${rooms().map((r, i) => `<button type="button" class="sd-room ${i === Number(f.room) ? 'on' : ''}" data-room="${i}">${r.image ? `<img src="${esc(img(me, r.image))}" alt="" onerror="this.remove()">` : ''}<span><b>${esc(nm(r.type))}</b><small>${[r.size, nm(r.beds), `حتى ${r.guests || 2} ضيوف`].filter(Boolean).map(esc).join(' · ')}</small><span class="pr">${money(r.price)} / ليلة</span></span></button>`).join('') || '<div class="empty">مفيش غرف</div>'}</div></div>
      <div class="card"><span class="ct">تواريخ الإقامة</span><div class="grid2">${dateBtn('checkin', 'تاريخ الوصول', f.checkin, 'cal')}${dateBtn('checkout', 'تاريخ المغادرة', f.checkout, 'cal')}</div>${nights() ? `<p class="muted" style="margin-top:8px">${nightsTxt(nights())}</p>` : ''}</div>
      <div class="card"><span class="ct">الضيوف</span>${stepper('adults', 'البالغين', '', 1, MAX.adults)}${stepper('children', 'الأطفال', `من سن 0 لـ ${CHILD_AGE_MAX} سنة`, 0, MAX.children)}
        ${f.children ? `<div class="sd-ages">${f.childAges.map((a, i) => `<div><label>عمر الطفل ${i + 1}</label><select data-age="${i}"><option value="">اختر السن</option>${Array.from({ length: CHILD_AGE_MAX + 1 }, (_, y) => `<option value="${y}" ${a === y ? 'selected' : ''}>${y}</option>`).join('')}</select>${S.tried && a == null ? '<div class="sd-err">مطلوب</div>' : ''}</div>`).join('')}</div>` : ''}
        ${stepper('infants', 'الرضّع', 'أقل من سنتين — مجاني', 0, MAX.infants)}${stepper('rooms', 'عدد الغرف', `الغرفة بتستوعب حتى ${occ} ضيف`, 1, MAX.rooms)}</div>`;
    return svc + `<div class="card"><span class="ct">${xfer ? 'تفاصيل الانتقال' : 'التاريخ والأفراد'}</span>
      ${xfer ? `<div class="sd-seg" style="margin-bottom:12px">${[['Airport to Hotel', 'من المطار للفندق'], ['Hotel to Airport', 'من الفندق للمطار']].map(([v, l]) => `<button type="button" class="sd-chip ${f.direction === v ? 'on' : ''}" data-dir="${v}">${l}</button>`).join('')}</div>` : ''}
      <div class="grid2">${dateBtn('date', 'تاريخ الخدمة', f.date, 'cal')}${xfer ? fld('الساعة', inp('time', 'time')) : ''}</div>
      ${xfer ? stepper('passengers', 'الركاب', `السيارة بتاخد حتى ${cap()}`, 1, cap()) + `<div class="grid2" style="margin-top:10px">${fld('رقم الرحلة (اختياري)', inp('flightNo'))}${fld('اسم الفندق / العنوان', inp('address'), S.tried && !f.address.trim() ? '<span class="sd-err">مطلوب</span>' : '')}</div>`
        : isPkgPrice() ? `<div class="sd-row"><div><b>عدد الأفراد</b><small>السعر ثابت للباكدج كله</small></div><b>${pkgPeople()}</b></div>` : stepper('participants', 'عدد الأفراد', '', 1, 15)}</div>`; };
  const step2 = () => `<div class="card"><span class="ct">بيانات العميل</span><div class="grid2">
      ${fld('الاسم', inp('name'), S.tried && S.f.name.trim().length < 2 ? '<span class="sd-err">اكتب اسم العميل</span>' : '')}
      ${fld('رقم واتساب العميل', inp('phone', 'tel', 'dir="ltr" placeholder="01XXXXXXXXX"'), S.tried && !/^\+?[0-9 ]{8,16}$/.test(S.f.phone) ? '<span class="sd-err">رقم غير صحيح</span>' : 'الفاوتشر بيتبعت عليه لو اخترت واتساب')}
      ${fld('إيميل العميل', inp('email', 'email', 'dir="ltr"'), S.tried && !emailOk(S.f.email) ? '<span class="sd-err">إيميل غير صحيح</span>' : 'الفاوتشر بيوصل عليه. لازم يكون إيميل العميل مش إيميلك.')}</div>
      ${fld('طلبات خاصة (اختياري)', `<textarea data-k="requests" rows="3">${esc(S.f.requests)}</textarea>`)}</div>`;
  const step3 = () => { const f = S.f, q = S.q, dep = depositOk(), plan = (id, title, sub, qq, ok) => `<label class="sd-plan ${f.plan === id ? 'on' : ''} ${ok ? '' : 'off'}"><input type="radio" name="plan" value="${id}" ${ok ? '' : 'disabled'} ${f.plan === id ? 'checked' : ''}><span><b>${title}</b><small>${sub}</small></span><span class="am" dir="ltr">${qq ? money(qq.due) : '—'}</span></label>`;
    return `<div class="card"><span class="ct">اختار طريقة الدفع</span>${plan('full', 'دفع كامل', 'العميل بيدفع كل المبلغ دلوقتي', q.full, true)}
      ${plan('deposit', 'عربون (50%)', dep ? (q.deposit && Number(q.deposit.remaining) > 0 ? `والمتبقي ${money(q.deposit.remaining)} في مكان الخدمة` : 'والباقي في مكان الخدمة') : !(S.st || {}).depositOk ? 'العربون مش مفعّل لحسابك — الدفع كامل بس.' : 'مش متاح لحجز بكرة أو أقرب — لازم دفع كامل', q.deposit, dep)}</div>
      <div class="card"><span class="ct">الدفع من محفظتك</span>${fld('رقم محفظتك الإلكترونية (اللي هتدفع منها)', inp('wallet', 'tel', 'dir="ltr" placeholder="01XXXXXXXXX"'), 'هيجيلك طلب دفع على الموبايل — وافق عليه.')}
      ${S.tried && !walletOk(String(f.wallet || '').replace(/\s/g, '')) ? '<div class="sd-err">اكتب رقم محفظتك</div>' : ''}
      <label class="sd-chk" style="margin-top:12px"><input type="checkbox" data-paid ${f.paid ? 'checked' : ''}><span>استلمت <b dir="ltr">${S.q[f.plan] ? money(S.q[f.plan].due) : ''}</b> كاش من العميل، وهتتسحب نفس القيمة من محفظتي دلوقتي.</span></label>
      <p class="muted" style="margin-top:8px;line-height:1.8">قبل الدفع العميل بيأكّد إيميله بكود بيوصله من المنصة. خد من العميل المبلغ ده بس${S.q[f.plan] && Number(S.q[f.plan].remaining) > 0 ? ` — المتبقي ${money(S.q[f.plan].remaining)} بيدفعه لمقدّم الخدمة في المكان، ولو خدت منه أكتر هتتعرّض للإيقاف` : ''}.</p></div>`; };

  const draw = () => {
    fix(); const t = ['الخدمة والتفاصيل', 'بيانات العميل', 'الدفع والتأكيد'];
    const st = S.st || {}, warn = st.flagged ? 'الحجز من حسابك موقوف مؤقتًا — تواصل مع الإدارة.' : (st.verified === false ? 'حسابك لسه ما اتوثّقش من الإدارة — مش هتقدر تحجز لعملاء لحد ما يتوثّق.' : '');
    const left = st.dailyLimit != null ? Math.max(0, Number(st.dailyLimit) - Number(st.usedToday || 0)) : null;
    m.innerHTML = (warn ? `<div class="card" style="border-color:#b45309"><b>⚠️ ${warn}</b></div>` : '') + `<h2 class="pt">حجز جديد لعميل</h2>${left != null ? `<p class="muted" style="margin:-6px 0 10px">المتاح لك النهارده: ${money(left)}</p>` : ''}<div class="sd-steps">${[1, 2, 3].map(n => `<i class="${n <= S.step ? 'on' : ''}"></i>`).join('')}<b>${S.step}/3 · ${t[S.step - 1]}</b></div>
      ${S.step === 1 ? step1() : S.step === 2 ? step2() : step3()}${sumHtml(S.step === 3)}${barHtml(S.step === 3 ? 'ادفع من المحفظة وأكّد الحجز' : 'متابعة', 'nx', S.step === 3 && !S.f.paid)}`;
  };
  const redrawSum = () => { const o = $('.sd-sum', m), b = $('.sd-bar', m); if (!o || !b) return draw(); o.outerHTML = sumHtml(S.step === 3);
    const q = S.q[S.f.plan]; $('.tt small', b).textContent = S.step === 3 ? 'المطلوب دفعه الآن' : 'الإجمالي'; $('.tt b', b).textContent = q ? money(S.step === 3 ? q.due : q.total) : '—';
    const nx = $('#nx', b); if (nx) nx.disabled = S.step === 3 && !S.f.paid; };   // update in place: replacing the button between mousedown and mouseup would swallow the tap
  // ---- payload + live quote (both plans, so the customer sees what each costs) -----------------------------------------------
  const payload = (plan, withCustomer) => {
    const it = cur(), f = S.f, d = D(), raw = d.hotelName || d.title || d.name || d.vehicleType || it.name;
    const base = { id: f.__id || (f.__id = rid()), type: S.kind, currency: 'EGP', status: 'pending_payment', reviewed: false, createdAt: new Date().toISOString(), [ID_KEY[S.kind]]: it.id, image: img(me, d.image), paymentPlan: plan, total: 0, requests: f.requests || '' };
    if (withCustomer) Object.assign(base, { name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() });
    if (S.kind === 'hotel') {
      const r = room(); if (!r || !f.checkin || !f.checkout || f.childAges.some(a => a == null)) return null;
      return Object.assign(base, { hotelName: raw, location: d.location, rating: d.rating, checkin: f.checkin, checkout: f.checkout, adults: f.adults, children: f.children, childAges: f.childAges, infants: f.infants,
        guests: f.adults + f.children, rooms: f.rooms, roomType: r.type, roomIndex: Number(f.room) || 0, nights: nightsBetween(f.checkin, f.checkout) });
    }
    if (!f.date) return null;
    if (S.kind === 'transfer') return Object.assign(base, { vehicleType: raw, date: f.date, time: f.time || '', passengers: f.passengers, direction: f.direction, flightNo: f.flightNo || '', address: f.address || '' });
    return Object.assign(base, { title: raw, category: d.category, date: f.date, participants: isPkgPrice() ? pkgPeople() : f.participants });
  };
  let qt = 0; const seq = { n: 0 };
  const requote = () => {
    clearTimeout(qt); S.q = {}; S.perr = ''; const full = cur() && payload('full', false);
    if (!full) { S.quoting = false; redrawSum(); return; }
    S.quoting = true; const my = ++seq.n; redrawSum();
    qt = setTimeout(async () => {
      const ask = async plan => { try { return (await DS.api('/desk/quote', { method: 'POST', body: payload(plan, false) })).price; } catch (e) { if (plan === 'full') throw e; return null; } };
      try { const [a, b] = await Promise.all([ask('full'), depositOk() ? ask('deposit') : Promise.resolve(null)]); if (my !== seq.n) return; S.q = { full: a, deposit: b }; if (S.f.plan === 'deposit' && !b) S.f.plan = 'full'; }
      catch (e) { if (my !== seq.n) return; S.perr = e.message; }
      S.quoting = false; if (S.step === 3) draw(); else redrawSum();
    }, 350);
  };
  const changed = () => { reset(); requote(); };

  // ---- events ---------------------------------------------------------------------------------------------------------------
  const sync = () => { if (S.kind === 'hotel' && S.f.checkin && S.f.checkout && S.f.checkout <= S.f.checkin) S.f.checkout = ''; };
  m.onclick = e => { const f = S.f, g = s => e.target.closest(s);
    let x;
    if ((x = g('[data-kind]'))) { S.kind = x.dataset.kind; S.id = (list()[0] || {}).id; Object.assign(f, { room: 0, checkin: '', checkout: '', date: '' }); changed(); draw(); return; }
    if ((x = g('[data-room]'))) { f.room = Number(x.dataset.room); changed(); draw(); return; }
    if ((x = g('[data-dir]'))) { f.direction = x.dataset.dir; changed(); draw(); return; }
    if ((x = g('[data-st]'))) { const k = x.dataset.st, d = Number(x.dataset.d), lim = { adults: [1, MAX.adults], children: [0, MAX.children], infants: [0, MAX.infants], rooms: [1, MAX.rooms], participants: [1, 15], passengers: [1, cap()] }[k], v = f[k] + d;
      if (v < lim[0] || v > lim[1]) return;
      if (k === 'rooms' && d < 0) { const occ = Math.max(1, Number((room() || {}).guests) || 2); if (v < Math.ceil((f.adults + f.children) / occ)) return DS.toast('قلّل عدد الضيوف الأول', true); }
      f[k] = v; const before = f.rooms; fix(); if (f.rooms > before) DS.toast('عدد الغرف زاد علشان يناسب عدد الضيوف'); changed(); draw(); return; }
    if ((x = g('[data-pick]'))) { const id = x.dataset.pick;
      if (S.kind === 'hotel') calendar({ title: 'تواريخ الإقامة', range: true, start: f.checkin, end: f.checkout, stage: id === 'checkout' && f.checkin ? 'out' : 'in', min: minDay(), blocked: blocked(), done: (a, b) => { f.checkin = a; f.checkout = b; changed(); draw(); } });
      else calendar({ title: 'تاريخ الخدمة', value: f.date, min: minDay(), blocked: blocked(), done: a => { f.date = a; changed(); draw(); } });
      return; }
    if (g('[data-back]')) { S.step--; S.tried = false; draw(); return; }
    if (g('#nx')) next();
  };
  m.onchange = e => { const t = e.target, f = S.f;
    if (t.name === 'plan') { f.plan = t.value; draw(); return; }
    if (t.dataset.paid != null) { f.paid = t.checked; redrawSum(); return; }
    if (t.dataset.age != null) { f.childAges[Number(t.dataset.age)] = t.value === '' ? null : Number(t.value); changed(); draw(); return; }
    const k = t.dataset.k; if (!k) return;
    if (k === 'id') { S.id = t.value; f.room = 0; f.checkin = f.checkout = f.date = ''; changed(); draw(); return; }
    f[k] = t.value; if (['time', 'flightNo', 'address', 'requests', 'name', 'email', 'phone', 'wallet'].includes(k)) { if (k !== 'wallet') { S.booking = null; f.__id = null; f.paid = false; } return; } changed(); };
  m.oninput = e => { const k = e.target.dataset && e.target.dataset.k; if (k && e.target.type !== 'select-one') { S.f[k] = e.target.value; if (k !== 'wallet') { S.booking = null; S.f.__id = null; } } };

  const next = () => { const f = S.f; S.tried = true;
    if (S.step === 1) {
      const ok = S.kind === 'hotel' ? (room() && f.checkin && f.checkout && !f.childAges.some(a => a == null)) : (f.date && (S.kind !== 'transfer' || (f.time && f.address.trim())));
      if (!ok) { draw(); return DS.toast('كمّل بيانات الخدمة', true); }
      if (S.perr) return DS.toast(S.perr, true); if (!S.q.full) return DS.toast('السعر لسه ما ظهرش — استنى لحظة', true);
      S.step = 2; S.tried = false; draw(); window.scrollTo(0, 0); return; }
    if (S.step === 2) {
      if (f.name.trim().length < 2 || !emailOk(f.email) || !/^\+?[0-9 ]{8,16}$/.test(f.phone)) { draw(); return DS.toast('راجع بيانات العميل', true); }
      if (f.email.trim().toLowerCase() === String(me.email || '').toLowerCase()) return DS.toast('إيميل العميل لازم يكون غير إيميلك (الحجز على إيميلك مفيهوش عمولة)', true);
      S.step = 3; S.tried = false; draw(); window.scrollTo(0, 0); return; }
    run();
  };

  // ---- pay ------------------------------------------------------------------------------------------------------------------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function run() {
    const f = S.f, q = S.q[f.plan]; f.wallet = String(f.wallet || '').replace(/\s/g, '');
    if (!walletOk(f.wallet)) { S.tried = true; draw(); return DS.toast('اكتب رقم محفظتك الإلكترونية', true); }
    if (!q) return DS.toast(S.perr || 'السعر لسه ما ظهرش — استنى لحظة', true);
    if (!f.paid) return DS.toast('أكّد إنك استلمت المبلغ كاش من العميل', true);
    try { localStorage.setItem('ds_seller_wallet', f.wallet); } catch {}
    const btn = $('#nx', m); btn.disabled = true;
    try {
      let bk = S.booking;
      if (!bk) { const body = payload(f.plan, true); body.total = Number(q.total); bk = (await DS.api('/desk/book', { method: 'POST', body })).booking; S.booking = bk; }
      if (S.verifiedId !== bk.id) { await contactFlow(bk); S.verifiedId = bk.id; }
      await walletFlow(bk, f.wallet);
    } catch (e) { DS.toast(e.message, true); const b = $('#nx', m); if (b) b.disabled = false; }
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
      let status = st.status; say('وافق على طلب الدفع على موبايلك (' + wallet + ')… بننتظر التأكيد');
      for (let i = 0; i < 45 && status !== 'captured' && status !== 'completed'; i++) { await sleep(4000); status = (await pay('/api/kashier/wallet/reconcile', { orderId: bk.id })).status; if (status === 'failed') throw new Error('الدفع ما تمش (اترفض أو انتهت مدته). جرّب تاني.'); }
      if (status !== 'captured' && status !== 'completed') throw new Error('لسه ما وصلش تأكيد الدفع. لو اتسحب المبلغ من محفظتك هيظهر الحجز في "الحجوزات" لما يتأكد.');
      dlg.close(); success(bk);
    } catch (e) { dlg.close(); throw e; }
  }
  function success(bk) {
    const f = S.f, b = { id: bk.id, name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim() };
    m.innerHTML = `<div class="card"><div class="sd-ok">${DS.ic('check')}</div><h2 class="pt" style="margin:0">الحجز اتأكد ✅</h2>
      <p class="muted" style="margin-top:6px">المنصة بعتت للعميل تأكيد الحجز والفاوتشر على إيميله مع المبلغ المدفوع${Number(bk.remainingAmount) > 0 ? ' والمتبقي' : ''}.</p>
      <p class="muted" style="margin-top:6px;line-height:1.9">رقم الحجز: <b dir="ltr">${esc(bk.id)}</b> · ${esc(b.name)}<br>تم دفع ${money(bk.amountDueNow != null ? bk.amountDueNow : bk.total)} من محفظتك.${Number(bk.remainingAmount) > 0 ? ` المتبقي ${money(bk.remainingAmount)} بيدفعه العميل لمقدّم الخدمة في مكان الخدمة.` : ''}</p>
      ${shareHtml(me, b)}<div class="row" style="margin-top:16px"><button class="btn ghost" id="again">${DS.ic('plus')} حجز جديد</button></div></div>`;
    wireShare(m, me, b); $('#again', m).onclick = () => DS.reload();
  }

  draw(); requote();
} });

})();
