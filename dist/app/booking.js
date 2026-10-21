// rating helpers: items without a rating yet (new listings) show nothing instead of "NaN" / "undefined"
const hasRating = (o) => Number(o && o.rating) > 0;
const ratingNum = (o) => Number(o.rating).toFixed(1);
const reviewsN = (o) => Number(o && o.reviews) || 0;
const ratingChip = (o) => hasRating(o) ? `<div class="detail-sidebar-rating"><i class="fa-solid fa-star text-gold-400"></i> ${ratingNum(o)}${reviewsN(o) ? ` <span>(${reviewsN(o)})</span>` : ''}</div>` : '';
const ratingRow = (o, cls = '') => hasRating(o) ? `<div class="flex items-center gap-2 text-sm mb-1 ${cls}">${utils.renderStars(o.rating)}<span class="text-xs">${ratingNum(o)}${reviewsN(o) ? ` (${reviewsN(o)} ${t('reviewsCountSuffix')})` : ''}</span></div>` : '';
// ==================== PAYMENT & BOOKING ====================
// Desktop-only Booking.com/GetYourGuide-style photo mosaic: one big photo
// plus smaller ones, with a "+N Photos" overlay if there are more than fit.
// Adapts to how many photos actually exist so there's never an empty cell.
// Clicking any cell opens the full lightbox gallery (see openLightbox below).
function renderPhotoGrid(images) {
  const list = (images && images.length ? images : [images]).filter(Boolean);
  window.__lightboxImages = list;
  const cell = (img, i, extra = '') => `
    <div class="photo-grid-cell ${extra}" onclick="openLightbox(${i})">
      <img src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" alt="">
    </div>`;
  if (list.length <= 1) {
    return `<div class="photo-grid photo-grid-1">${cell(list[0], 0, 'photo-grid-main')}</div>`;
  }
  if (list.length === 2) {
    return `<div class="photo-grid photo-grid-2">${list.map((img, i) => cell(img, i)).join('')}</div>`;
  }
  if (list.length === 3) {
    return `<div class="photo-grid photo-grid-3">${cell(list[0], 0, 'photo-grid-main')}${list.slice(1).map((img, i) => cell(img, i + 1)).join('')}</div>`;
  }
  const shown = list.slice(0, 5);
  const remaining = list.length - shown.length;
  const cells = shown.map((img, i) => `
    <div class="photo-grid-cell ${i === 0 ? 'photo-grid-main' : ''}" onclick="openLightbox(${i})">
      <img src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" alt="">
      ${(i === shown.length - 1 && remaining > 0) ? `<div class="photo-grid-more"><i class="fa-solid fa-images"></i> ${t('morePhotosLabel').replace('{n}', remaining)}</div>` : ''}
    </div>`).join('');
  return `<div class="photo-grid photo-grid-5">${cells}</div>`;
}

let __lightboxIndex = 0;
function openLightbox(index) {
  const imgs = window.__lightboxImages || [];
  if (!imgs.length) return;
  __lightboxIndex = index;
  renderLightbox();
  document.getElementById('photoLightbox').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
// Opens a lightbox for a photo set stored by loadReviews() under a safe key
// (avoids inlining large base64 image data into an onclick="" attribute,
// which used to break the HTML — quotes inside the data corrupted the markup).
function openLightboxSet(key, index) {
  const set = (window.__reviewPhotoSets || {})[key];
  if (!set || !set.length) return;
  window.__lightboxImages = set;
  openLightbox(index);
}
function closeLightbox() {
  document.getElementById('photoLightbox').classList.add('hidden');
  document.body.style.overflow = '';
}
function lightboxStep(dir) {
  const imgs = window.__lightboxImages || [];
  if (!imgs.length) return;
  __lightboxIndex = (__lightboxIndex + dir + imgs.length) % imgs.length;
  renderLightbox();
}
function renderLightbox() {
  const imgs = window.__lightboxImages || [];
  const img = document.getElementById('lightboxImage');
  if (img) img.src = getImageUrl(imgs[__lightboxIndex]);
  const counter = document.getElementById('lightboxCounter');
  if (counter) counter.textContent = `${__lightboxIndex + 1} / ${imgs.length}`;
}
document.addEventListener('keydown', (e) => {
  const box = document.getElementById('photoLightbox');
  if (!box || box.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightboxStep(-1);
  if (e.key === 'ArrowRight') lightboxStep(1);
});

async function submitContactForm(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('contactName').value;
  const email = document.getElementById('contactEmail').value;
  const message = document.getElementById('contactMessage').value;
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    await apiFetch('/api/contact', { method: 'POST', body: JSON.stringify({ name, email, message }) }, true);
    toast(t('messageSentSuccess'), 'success');
    e.target.reset();
  } catch (err) {
    toast(err.message || t('errCouldNotSendMessage'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Message'; }
  }
}

const partnerDocSlots = [
  { key: 'commercialRegistration', get label() { return t('docCommercialRegistration'); } },
  { key: 'taxCard', get label() { return t('docTaxCard'); } },
  { key: 'ownerId', get label() { return t('docOwnerId'); } },
  { key: 'license', get label() { return t('docLicense'); } }
];
const partnerDocs = {};

function renderPartnerDocSlots() {
  const el = document.getElementById('partnerDocSlots');
  if (!el) return;
  el.innerHTML = partnerDocSlots.map(slot => {
    const doc = partnerDocs[slot.key];
    return `
      <div class="partner-doc-slot">
        <input type="file" id="partnerDoc_${slot.key}" accept="image/*,.pdf" class="hidden" onchange="handlePartnerDocSelect('${slot.key}', this.files[0])">
        <label class="partner-doc-label">${slot.label}</label>
        ${doc
          ? `<div class="partner-doc-filled" onclick="document.getElementById('partnerDoc_${slot.key}').click()">
               <i class="fa-solid ${doc.isImage ? 'fa-image' : 'fa-file-pdf'}"></i>
               <span>${esc(doc.name)}</span>
               <button type="button" onclick="event.stopPropagation(); removePartnerDoc('${slot.key}')"><i class="fa-solid fa-xmark"></i></button>
             </div>`
          : `<button type="button" class="partner-doc-empty" onclick="document.getElementById('partnerDoc_${slot.key}').click()"><i class="fa-solid fa-cloud-arrow-up"></i> ${t('uploadLabel')}</button>`}
      </div>`;
  }).join('');
}

function handlePartnerDocSelect(key, file) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) { toast('Please keep each file under 4MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    partnerDocs[key] = { name: file.name, data: reader.result, isImage: file.type.startsWith('image/') };
    renderPartnerDocSlots();
  };
  reader.readAsDataURL(file);
}

function removePartnerDoc(key) {
  delete partnerDocs[key];
  renderPartnerDocSlots();
}

async function submitPartnerForm(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const partnerType = document.querySelector('input[name="partnerType"]:checked').value;
  const businessName = document.getElementById('partnerBusinessName').value;
  const contactName = document.getElementById('partnerContactName').value;
  const phone = document.getElementById('partnerPhone').value;
  const email = document.getElementById('partnerEmail').value;
  const message = document.getElementById('partnerMessage').value;
  const documents = Object.entries(partnerDocs).map(([key, d]) => ({ name: `${key}_${d.name}`, data: d.data }));

  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  try {
    await apiFetch('/api/partner-application', {
      method: 'POST',
      body: JSON.stringify({ partnerType, businessName, contactName, phone, email, message, documents })
    }, true);
    toast('Application submitted — our partnerships team will be in touch!', 'success');
    e.target.reset();
    Object.keys(partnerDocs).forEach(k => delete partnerDocs[k]);
    renderPartnerDocSlots();
  } catch (err) {
    toast(err.message || t('errCouldNotSubmitApplication'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Application'; }
  }
}

function renderJournalPage() {
  const grid = document.getElementById('journalGrid');
  if (!grid) return;
  grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-28';
  const countEl = document.getElementById('journalCount'); if (countEl) countEl.textContent = (CATALOG.articles || []).length;
  if (!CATALOG.articles || !CATALOG.articles.length) { grid.innerHTML = `<p class="text-center py-16" style="color:var(--text-secondary)">${t('noStoriesYetMsg')}</p>`; return; }
  grid.innerHTML = CATALOG.articles.map(a => `
    <div onclick="showArticlePage('${a.id}')" class="article-card cursor-pointer">
      <img alt="" src="${getImageUrl(a.image)}" class="article-card-img" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
      <div class="article-card-body">
        <p class="font-display font-bold text-base mb-1 leading-snug line-clamp-2" style="color:var(--text-primary)">${a.title}</p>
        <p class="text-xs mb-2 line-clamp-2" style="color:var(--text-secondary)">${a.excerpt}</p>
        <p class="text-[10px]" style="color:var(--text-secondary)"><i class="fa-regular fa-clock"></i> ${a.readTimeMinutes} min read</p>
      </div>
    </div>`).join('');
}

// ==================== SHARED BOOKING-FLOW UI ====================
// Every booking flow (hotel / excursion / transfer) is built from the same
// pieces so they look and behave identically on the app and on www:
//   header + stepper  →  main column (cards)  +  order summary (side)  +  action bar
// Phones: summary is a collapsible card on top, the action bar is fixed at the bottom.
// Desktop (www): two columns, sticky summary, the action bar sits inline under the form.
// Live refresh of the booking form: capture what was typed, re-render the step (summary + totals) and keep the scroll position
function bkCapture() {
  const g = (id) => document.getElementById(id), d = state.bookingDraft; if (!d) return;
  if (g('bkRequests')) d.requests = g('bkRequests').value;
  if (g('tkFlightNo')) d.flightNo = g('tkFlightNo').value;
  if (g('tkAddress')) d.address = g('tkAddress').value;
  if (g('tkTime')) d.time = g('tkTime').value;
}
function bkRefresh() {
  const flows = [['bookingFlowPage', () => renderBookingStep(2)], ['excursionBookingFlowPage', () => renderExcursionBookingStep(2)], ['transferBookingFlowPage', () => renderTransferBookingStep(2)]];
  const hit = flows.find(([id]) => document.getElementById(id)); if (!hit || state.bookingStep !== 2) return;
  const y = window.scrollY; bkCapture(); window.__bkKeep = true;
  try { hit[1](); } finally { window.__bkKeep = false; }
  window.scrollTo(0, y);
}
function bkInitial(name) { return ((name || '').trim().charAt(0) || '?').toUpperCase(); }

function bkGuestCard() {
  const d = state.bookingDraft;
  return `
    <div class="bk-guest">
      <span class="bk-avatar" aria-hidden="true">${esc(bkInitial(d.name))}</span>
      <div class="bk-guest-info">
        <p class="bk-guest-label">${t('bookingForLabel')}</p>
        <p class="bk-guest-name">${esc(d.name || t('guest'))}</p>
        ${d.email ? `<p class="bk-guest-line"><i class="fa-regular fa-envelope" aria-hidden="true"></i><span dir="ltr">${esc(d.email)}</span></p>` : ''}
        ${d.phone ? `<p class="bk-guest-line"><i class="fa-solid fa-phone" aria-hidden="true"></i><span dir="ltr">${esc(d.phone)}</span></p>` : ''}
      </div>
    </div>`;
}

function bkCard(icon, title, inner) {
  return `<section class="bk-card"><h3 class="bk-card-title"><span class="bk-card-ico"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>${title}</h3>${inner}</section>`;
}

// rows: [[label, value], ...]; extra: raw html placed between the rows and the total
function bkSummary(o) {
  return `
    <aside class="booking-summary-card bk-summary">
      <button type="button" class="bk-sum-head" onclick="toggleBkSummary(this)" aria-expanded="false">
        <img alt="" src="${getImageUrl(o.img)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <span class="bk-sum-title"><b>${o.title}</b><small>${o.sub || ''}</small></span>
        <span class="bk-sum-mini"><small>${t('totalLabel')}</small><b>${utils.formatPrice(o.total)}</b></span>
        <i class="fa-solid fa-chevron-down bk-sum-chev" aria-hidden="true"></i>
      </button>
      <div class="bk-sum-body">
        ${o.rows.map(r => `<div class="booking-summary-row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}
        ${o.extra || ''}
        <div class="booking-summary-total"><span>${t('totalLabel')}</span><span>${utils.formatPrice(o.total)}</span></div>
      </div>
    </aside>`;
}
function toggleBkSummary(btn) {
  const card = btn.closest('.bk-summary'); if (!card) return;
  const open = card.classList.toggle('is-open');
  btn.setAttribute('aria-expanded', String(open));
}

function bkStepper(step) {
  const labels = [t('bkStepSelect'), t('bkStepDetails'), t('bkStepPayment')];
  return `<ol class="bk-stepper">${labels.map((l, i) => {
    const n = i + 1, cls = n < step ? 'is-done' : n === step ? 'is-active' : '';
    return `<li class="${cls}"><span>${n < step ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : n}</span><em>${l}</em></li>`;
  }).join('')}</ol>`;
}

function bkShell(o) {
  return `
    <div class="bk-page">
      <header class="bk-head dark-scene">
        <div class="stars-container"></div>
        <div class="bk-head-inner">
          <div class="bk-head-row">
            <button type="button" class="bk-back" onclick="${o.backAction}" aria-label="${t('backBtn')}"><i class="fa-solid fa-arrow-left rtl-flip" aria-hidden="true"></i></button>
            <h1>${o.title}</h1>
          </div>
          ${bkStepper(o.step)}
        </div>
      </header>
      <div class="booking-step-layout">
        <div class="booking-step-main">${o.main}</div>
        <div class="booking-step-side">${o.side}</div>
      </div>
    </div>`;
}

function bkCounter(icon, label, labelId, valueText, minusFn, plusFn) {
  return `
    <div class="bk-counter">
      <span class="bk-card-ico"><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
      <div class="bk-counter-text"><small>${label}</small><b id="${labelId}">${valueText}</b></div>
      <div class="bk-counter-btns">
        <button type="button" class="counter-btn" aria-label="−" onclick="${minusFn}">−</button>
        <button type="button" class="counter-btn" aria-label="+" onclick="${plusFn}">+</button>
      </div>
    </div>`;
}
function bkDateField(id, label, value, icon = 'fa-calendar-days') {
  return `
    <div id="${id}" class="date-field bk-date" data-date-field="${id}" data-value="${value}" onclick="datepicker.open('${id}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
      <i class="fa-solid ${icon} bk-date-ico" aria-hidden="true"></i>
      <span class="bk-date-text"><label>${label}</label><span class="date-field-value">${utils.formatDate(value)}</span></span>
    </div>`;
}

function paymentMethodsBlock(currentMethod, onchangeFn) {
  const methods = [
    { id: 'card', label: t('payMethodCard'), icon: '<i class="fa-brands fa-cc-visa"></i><i class="fa-brands fa-cc-mastercard"></i>' },
    { id: 'instapay', label: t('payMethodWallet'), icon: '<i class="fa-solid fa-wallet"></i>' },
  ];
  const radios = methods.map(m => `
    <label class="pay-option ${currentMethod === m.id ? 'is-selected' : ''}">
      <input type="radio" name="paymethod" value="${m.id}" ${currentMethod === m.id ? 'checked' : ''} onchange="${onchangeFn}('${m.id}')">
      <span class="pay-radio" aria-hidden="true"></span>
      <span class="pay-option-label">${m.label}</span>
      <span class="pay-option-icons" aria-hidden="true">${m.icon}</span>
    </label>`).join('');

  let detailFields = '';
  if (currentMethod === 'card') {
    detailFields = `
      <div class="bk-fields">
        <div class="bk-field">
          <label for="payCardNumber">${t('cardNumberLabel')}</label>
          <input type="text" id="payCardNumber" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="1234 5678 9012 3456" class="bk-input" dir="ltr" oninput="formatCardNumberInput(this)">
        </div>
        <div class="bk-field-row">
          <div class="bk-field">
            <label for="payCardMonth">MM</label>
            <input type="text" id="payCardMonth" inputmode="numeric" maxlength="2" placeholder="MM" autocomplete="cc-exp-month" class="bk-input text-center" dir="ltr">
          </div>
          <div class="bk-field">
            <label for="payCardYear">YY</label>
            <input type="text" id="payCardYear" inputmode="numeric" maxlength="2" placeholder="YY" autocomplete="cc-exp-year" class="bk-input text-center" dir="ltr">
          </div>
          <div class="bk-field">
            <label for="payCardCvv">${t('cvvLabel')}</label>
            <input type="password" id="payCardCvv" inputmode="numeric" maxlength="4" placeholder="•••" autocomplete="cc-csc" class="bk-input text-center" dir="ltr">
          </div>
        </div>
        <div class="bk-field">
          <label for="payCardName">${t('nameOnCardLabel')}</label>
          <input type="text" id="payCardName" autocomplete="cc-name" placeholder="${t('phNameOnCard')}" class="bk-input">
        </div>
        <label class="bk-check"><input type="checkbox" id="payCardSave"><span class="bk-check-box" aria-hidden="true"><i class="fa-solid fa-check"></i></span><span>${t('saveCardLabel')}</span></label>
      </div>`;
  } else if (currentMethod === 'instapay') {
    detailFields = `
      <div class="bk-fields">
        <div class="bk-field">
          <label for="payWalletPhone">${t('walletMobileLabel')}</label>
          <input type="tel" id="payWalletPhone" inputmode="numeric" maxlength="11" placeholder="01xxxxxxxxx" autocomplete="tel" class="bk-input" dir="ltr">
        </div>
        <p class="bk-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>${t('payWalletNote')}</p>
      </div>`;
  }
  return `<div class="pay-options">${radios}</div>${detailFields}
    <p class="bk-secure"><i class="fa-solid fa-lock" aria-hidden="true"></i>${t('securePaymentNote')}</p>`;
}

// ==================== KASHIER DIRECT PAYMENT (in-page, no redirect) ====================
// Card/wallet fields live inside paymentMethodsBlock() below and are read
// here at charge time. Only one booking flow is ever on screen at once, so
// plain getElementById on the shared field ids is safe.

function formatCardNumberInput(el) {
  el.value = el.value.replace(/[^\d]/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 23);
}

// Must match bookings-worker's DEPOSIT_RATIO/rounding exactly (Math.round, whole EGP) —
// the server recomputes and rejects the charge if this ever drifts from its own figure.
const DEPOSIT_RATIO = 0.5;
function depositOf(total) { return Math.round(total * DEPOSIT_RATIO); }
// amountDueNow() is the single source of truth both the summary UI and the
// actual charge call read from — keeps them impossible to drift apart.
function amountDueNow(type, total) {
  const plan = (state.bookingDraft.paymentPlan && state.bookingDraft.paymentPlan[type]) || 'full';
  return plan === 'deposit' ? depositOf(total) : total;
}
function payBtnLabel(type, total) {
  const plan = (state.bookingDraft.paymentPlan && state.bookingDraft.paymentPlan[type]) || 'full';
  return `${t('bookNowBtn')} — ${utils.formatPrice(amountDueNow(type, total))}`;
}
// Two radio options the guest actively picks between — full amount (nothing
// owed later) or a 50% non-refundable deposit (rest due on arrival). Neither
// is charged until they choose; 'full' is the default.
function paymentPlanSelector(total, type) {
  if (!state.bookingDraft.paymentPlan) state.bookingDraft.paymentPlan = {};
  const cur = state.bookingDraft.paymentPlan[type] || 'full';     // keep the guest's choice when the step re-renders
  state.bookingDraft.paymentPlan[type] = cur;
  const deposit = depositOf(total);
  const opt = (val, label, amount) => `
    <label class="pay-option ${cur === val ? 'is-selected' : ''}">
      <input type="radio" name="paymentPlan_${type}" value="${val}" ${cur === val ? 'checked' : ''} onchange="updatePaymentPlan('${type}', ${total}, this.value)">
      <span class="pay-radio" aria-hidden="true"></span>
      <span class="pay-option-label">${label}</span>
      <span class="pay-option-price">${utils.formatPrice(amount)}</span>
    </label>`;
  return `
    <div class="payment-plan-selector">
      <div class="pay-options">
        ${opt('full', t('payFullAmountLabel'), total)}
        ${opt('deposit', t('payDepositOptionLabel'), deposit)}
      </div>
      <p class="bk-note" id="paymentPlanNote_${type}"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>${cur === 'deposit' ? t('payDepositNoteLabel').replace('{n}', utils.formatPrice(total - deposit)) : t('payFullNoteLabel')}</span></p>
    </div>`;
}
function updatePaymentPlan(type, total, plan) {
  if (!state.bookingDraft.paymentPlan) state.bookingDraft.paymentPlan = {};
  state.bookingDraft.paymentPlan[type] = plan;
  document.querySelectorAll(`input[name="paymentPlan_${type}"]`).forEach(i => i.closest('.pay-option')?.classList.toggle('is-selected', i.value === plan));
  const btn = document.getElementById(type + 'PayBtn');
  if (btn) btn.innerHTML = `<i class="fa-solid fa-lock" aria-hidden="true"></i>${payBtnLabel(type, total)}`;
  const note = document.querySelector('#paymentPlanNote_' + type + ' span');
  if (note) note.textContent = plan === 'deposit' ? t('payDepositNoteLabel').replace('{n}', utils.formatPrice(total - depositOf(total))) : t('payFullNoteLabel');
}

// Dispatches to the card or wallet flow based on the selected payment
// method. Resolves true on a confirmed payment, false otherwise — callers
// just re-enable their Pay button on false, no navigation either way.
async function processKashierPayment(orderId, amount, currency, btn) {
  if (state.bookingDraft.payment === 'instapay') return processKashierWallet(orderId, amount, currency, btn);
  return processKashierCard(orderId, amount, currency, btn);
}

async function processKashierCard(orderId, amount, currency, btn) {
  const number = (document.getElementById('payCardNumber')?.value || '').replace(/\s+/g, '');
  const month = (document.getElementById('payCardMonth')?.value || '').trim().padStart(2, '0');
  const year = (document.getElementById('payCardYear')?.value || '').trim().padStart(2, '0');
  const cvv = (document.getElementById('payCardCvv')?.value || '').trim();
  const name = (document.getElementById('payCardName')?.value || '').trim();
  const save = document.getElementById('payCardSave')?.checked || false;

  if (!/^\d{12,19}$/.test(number)) { toast(t('errCardNumber'), 'error'); return false; }
  if (!/^\d{2}$/.test(month) || !/^\d{2}$/.test(year)) { toast(t('errExpiryDate'), 'error'); return false; }
  if (!/^\d{3,4}$/.test(cvv)) { toast(t('errCvv'), 'error'); return false; }
  if (!name) { toast(t('errCardName'), 'error'); return false; }

  const [firstName, ...rest] = (state.bookingDraft.name || '').split(' ');
  let res;
  try {
    res = await apiFetch('/api/kashier/charge', {
      method: 'POST',
      body: JSON.stringify({
        orderId, amount, currency,
        card: { number, month, year, cvv, name },
        save,
        customer: { firstName: firstName || '', lastName: rest.join(' '), email: state.bookingDraft.email },
      }),
    });
  } finally {
    // Clear sensitive fields from the DOM the instant the request is sent,
    // whatever the outcome — they've already left the browser by then.
    ['payCardNumber', 'payCardMonth', 'payCardYear', 'payCardCvv', 'payCardName'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  }

  if (res.status === '3ds_required') return await handleKashier3ds(res.authentication.redirectUrl, orderId);
  if (res.status === 'captured') return true;
  toast(res.message || 'Payment was declined — please check your card details', 'error');
  return false;
}

async function processKashierWallet(orderId, amount, currency, btn) {
  const phone = (document.getElementById('payWalletPhone')?.value || '').trim();
  if (!/^01\d{9}$/.test(phone)) { toast(t('errEgyptPhone'), 'error'); return false; }

  const initRes = await apiFetch('/api/kashier/wallet/initiate', { method: 'POST', body: JSON.stringify({ orderId, amount, currency, mobilePhone: phone }) });
  if (initRes.status !== 'pending') { toast(initRes.message || 'Could not start the wallet payment', 'error'); return false; }

  toast('Approval request sent — check your wallet app', 'success');
  for (let i = 0; i < 40; i++) { // poll every 3s, ~2 minutes total
    if (btn) btn.innerHTML = `Waiting for approval… <span class="opacity-60">${i + 1}</span>`;
    await new Promise(r => setTimeout(r, 3000));
    let poll;
    try { poll = await apiFetch('/api/kashier/wallet/reconcile', { method: 'POST', body: JSON.stringify({ orderId }) }); }
    catch { continue; }
    if (poll.status === 'captured' || poll.status === 'completed') return true;
    if (poll.status === 'failed') { toast(t('errWalletDeclined'), 'error'); return false; }
  }
  toast('Approval timed out — please try again', 'error');
  return false;
}

// 3D Secure — shown as a small modal on this same page (see #kashier3dsModal
// in index.html), never a redirect. Resolves once Kashier posts the result
// back via postMessage, per Kashier's own 3D Secure handling docs.
let _kashier3dsResolve = null;
let _kashier3dsOrderId = null;
let _kashier3dsMode = 'booking';

function handleKashier3ds(redirectUrl, orderId, mode) {
  return new Promise((resolve) => {
    _kashier3dsResolve = resolve;
    _kashier3dsOrderId = orderId;
    _kashier3dsMode = mode || 'booking';
    const modal = document.getElementById('kashier3dsModal');
    const frame = document.getElementById('kashier3dsFrame');
    if (!modal || !frame) { resolve(false); return; }
    frame.src = redirectUrl;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    window.addEventListener('message', kashier3dsMessageListener);
  });
}

function closeKashier3ds(result) {
  const modal = document.getElementById('kashier3dsModal');
  const frame = document.getElementById('kashier3dsFrame');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
  if (frame) frame.src = 'about:blank';
  window.removeEventListener('message', kashier3dsMessageListener);
  if (_kashier3dsResolve) { _kashier3dsResolve(!!result); _kashier3dsResolve = null; }
}

async function kashier3dsMessageListener(e) {
  const msg = e.data;
  if (!msg || msg.message !== 'merchantStoreRedirect' || !msg.params) return;
  if (msg.params.status !== 'SUCCESS') { closeKashier3ds(false); return; }
  // Confirm against our own backend rather than trusting the postMessage
  // alone — it's the same source the webhook writes to.
  try {
    const endpoint = _kashier3dsMode === 'balance' ? '/api/kashier/charge-balance-status' : '/api/kashier/charge-status';
    const check = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ orderId: _kashier3dsOrderId }) });
    closeKashier3ds(check.status === 'completed' || check.status === 'captured');
  } catch { closeKashier3ds(false); }
}

// ==================== PAY THE REMAINING BALANCE ====================
let _balancePayOrderId = null;
let _balancePayAmount = null;

function openPayBalanceModal(orderId, amount) {
  _balancePayOrderId = orderId;
  _balancePayAmount = amount;
  const old = document.getElementById('payBalanceModal'); if (old) old.remove();
  const modal = document.createElement('div');
  modal.id = 'payBalanceModal';
  modal.className = 'fixed inset-0 z-[300] flex items-end sm:items-center justify-center';
  modal.innerHTML = `
    <div class="absolute inset-0" style="background:rgba(0,0,0,.6)" onclick="closePayBalanceModal()"></div>
    <div class="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5" style="background:var(--bg-card); max-height:90vh; overflow-y:auto;">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-display text-lg font-bold">${t('payRemainingBtn')}</h3>
        <button onclick="closePayBalanceModal()" class="w-9 h-9 rounded-full field-box flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <p class="text-sm mb-3" style="color:var(--text-secondary)">${t('balanceDueLabel').replace('{n}', utils.formatPrice(amount))}</p>
      <div id="payBalanceCardFields">${balanceCardFieldsBlock()}</div>
      <button id="payBalanceSubmitBtn" onclick="submitBalancePayment()" class="btn-gold w-full py-3.5 rounded-2xl font-bold text-ink-900 mt-3">${t('payRemainingBtn')} — ${utils.formatPrice(amount)}</button>
    </div>`;
  document.body.appendChild(modal);
}
function balanceCardFieldsBlock() {
  return `
    <div class="card rounded-2xl p-4 space-y-3">
      <div>
        <label class="block text-[10px] tracking-widest text-violet-400 font-semibold mb-1.5">${t('cardNumberLabel')}</label>
        <input type="text" id="payCardNumber" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="1234 5678 9012 3456" class="input-field w-full px-3 py-2.5 text-sm" oninput="formatCardNumberInput(this)">
      </div>
      <div class="grid grid-cols-3 gap-2">
        <div>
          <label class="block text-[10px] tracking-widest text-violet-400 font-semibold mb-1.5">MM</label>
          <input type="text" id="payCardMonth" inputmode="numeric" maxlength="2" placeholder="MM" autocomplete="cc-exp-month" class="input-field w-full px-3 py-2.5 text-sm text-center">
        </div>
        <div>
          <label class="block text-[10px] tracking-widest text-violet-400 font-semibold mb-1.5">YY</label>
          <input type="text" id="payCardYear" inputmode="numeric" maxlength="2" placeholder="YY" autocomplete="cc-exp-year" class="input-field w-full px-3 py-2.5 text-sm text-center">
        </div>
        <div>
          <label class="block text-[10px] tracking-widest text-violet-400 font-semibold mb-1.5">${t('cvvLabel')}</label>
          <input type="password" id="payCardCvv" inputmode="numeric" maxlength="4" placeholder="${t('cvvLabel')}" autocomplete="cc-csc" class="input-field w-full px-3 py-2.5 text-sm text-center">
        </div>
      </div>
      <div>
        <label class="block text-[10px] tracking-widest text-violet-400 font-semibold mb-1.5">${t('nameOnCardLabel')}</label>
        <input type="text" id="payCardName" autocomplete="cc-name" placeholder="${t('phNameOnCard')}" class="input-field w-full px-3 py-2.5 text-sm">
      </div>
      <label class="flex items-center gap-2 text-xs text-white/60 pt-1 cursor-pointer">
        <input type="checkbox" id="payCardSave" class="w-4 h-4 accent-violet-600"> ${t('saveCardLabel')}
      </label>
      <p class="text-[10px] text-white/30 flex items-center gap-1.5"><i class="fa-solid fa-lock"></i> ${t('securePaymentNote')}</p>
    </div>`;
}
function closePayBalanceModal() {
  const m = document.getElementById('payBalanceModal');
  if (m) m.remove();
  _balancePayOrderId = null; _balancePayAmount = null;
}

async function submitBalancePayment() {
  const orderId = _balancePayOrderId, amount = _balancePayAmount;
  if (!orderId) return;
  const btn = document.getElementById('payBalanceSubmitBtn');
  const number = (document.getElementById('payCardNumber')?.value || '').replace(/\s+/g, '');
  const month = (document.getElementById('payCardMonth')?.value || '').trim().padStart(2, '0');
  const year = (document.getElementById('payCardYear')?.value || '').trim().padStart(2, '0');
  const cvv = (document.getElementById('payCardCvv')?.value || '').trim();
  const name = (document.getElementById('payCardName')?.value || '').trim();
  const save = document.getElementById('payCardSave')?.checked || false;
  if (!/^\d{12,19}$/.test(number)) { toast(t('errCardNumber'), 'error'); return; }
  if (!/^\d{2}$/.test(month) || !/^\d{2}$/.test(year)) { toast(t('errExpiryDate'), 'error'); return; }
  if (!/^\d{3,4}$/.test(cvv)) { toast(t('errCvv'), 'error'); return; }
  if (!name) { toast(t('errCardName'), 'error'); return; }

  btn.disabled = true; btn.innerHTML = t('processingLabel');
  let res;
  try {
    res = await apiFetch('/api/kashier/charge-balance', {
      method: 'POST',
      body: JSON.stringify({ orderId, amount, currency: 'EGP', card: { number, month, year, cvv, name }, save }),
    });
  } catch (e) {
    toast(e.message || 'Payment failed', 'error');
    btn.disabled = false; btn.innerHTML = `${t('payRemainingBtn')} — ${utils.formatPrice(amount)}`;
    return;
  } finally {
    ['payCardNumber', 'payCardMonth', 'payCardYear', 'payCardCvv', 'payCardName'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  }

  let ok = false;
  if (res.status === '3ds_required') ok = await handleKashier3ds(res.authentication.redirectUrl, orderId, 'balance');
  else if (res.status === 'captured') ok = true;

  if (ok) {
    toast(t('balancePaidLabel'), 'success');
    closePayBalanceModal();
    bookings.load(); // refresh the list so the badge flips to "paid in full"
  } else {
    toast(res.message || 'Payment was declined — please check your card details', 'error');
    btn.disabled = false; btn.innerHTML = `${t('payRemainingBtn')} — ${utils.formatPrice(amount)}`;
  }
}

function renderBookingConfirmation(b) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  ['bookingFlowPage','hotelDetailPage','excursionDetailPage','transferBookingFlowPage'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  const page = document.createElement('div');
  page.id = 'bookingConfirmPage';
  page.className = 'page';
  page.innerHTML = `
    <div class="min-h-screen dark-scene relative overflow-hidden pb-10">
      <div class="stars-container" id="confirmStars"></div>
      <div class="relative z-10 px-5 pt-6">
        <div class="text-center mb-8">
          <div class="w-24 h-24 mx-auto mb-5 relative">
            <div class="absolute inset-0 bg-gold-400/20 rounded-full animate-ping"></div>
            <div class="relative w-full h-full rounded-full bg-gradient-to-br from-violet-400 to-violet-700 flex items-center justify-center shadow-2xl"><i class="fa-solid fa-check text-4xl text-white"></i></div>
          </div>
          <h2 class="font-display text-2xl font-bold text-white mb-1">${t('bookingConfirmedTitle')}</h2>
          <p class="text-white/60 text-sm">${t('paymentReceivedMsg')}</p>
        </div>
      </div>
      <div class="relative z-10 rounded-t-[28px] mt-4 p-5" style="background:var(--bg-card)">
        <div class="card rounded-2xl p-3 flex gap-3 mb-4">
          <img alt="" src="${b.image}" class="w-16 h-16 rounded-xl object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
          <div><h3 class="font-display font-bold">${b.hotelName || b.title || b.vehicleType}</h3><p class="text-[10px]">${b.roomType || b.category || ''}</p></div>
        </div>
        <div class="flex justify-between mb-2"><span>${t('bookingIdLabel2')}</span><span class="font-bold">${b.id}</span></div>
        <div class="flex justify-between mb-2"><span>${t('checkinLabel')}</span><span>${utils.formatDate(b.checkin || b.date)}</span></div>
        <div class="flex justify-between mb-4"><span>${t('totalLabel')}</span><span class="font-bold text-violet-500">${b.priceFormatted}</span></div>
        <button onclick="downloadVoucher('${b.id}', this)" class="btn-gold w-full py-4 rounded-2xl font-bold mb-2"><i class="fa-solid fa-file-pdf"></i> ${voucherLabels().dl}</button>
        <p class="text-center text-[11px] mb-3 opacity-70">${voucherLabels().sent}</p>
        <button onclick="finishBooking('bookings')" class="btn-violet w-full py-4 rounded-2xl font-bold mb-3">${t('viewMyBookingsBtn')}</button>
        <button onclick="finishBooking('home')" class="btn-outline-violet w-full py-4 rounded-2xl font-bold">${t('backToHomeBtn')}</button>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  page.classList.add('active');
  window.scrollTo(0,0);
  utils.createStars('confirmStars');
  utils.confetti();
}

function finishBooking(target) { const p = document.getElementById('bookingConfirmPage'); if (p) p.remove(); nav.go(target || 'home'); }

// ==================== HOTEL DETAILS & BOOKING ====================
function showHotelPage(hotelId, opts = {}) {
  const h = CATALOG.hotels.find(x => x.id === hotelId);
  if (!h) return toast(t('errHotelNotFound'), 'error');
  state.currentHotel = h;
  const old = document.getElementById('hotelDetailPage'); if (old) old.remove();
  const page = document.createElement('div');
  page.id = 'hotelDetailPage';
  page.className = 'page';
  // Reflects whatever was chosen in the search bar (guests, child ages,
  // rooms, and nights if dates were set) rather than always the hotel's
  // flat listed rate — same helper the hotel list cards use.
  const { perNight: startPrice, isEstimate: startPriceIsEstimate } = estimatedHotelPricePerNight(h);
  const bookingCard = `
    <div class="detail-price-row">
      <div><p class="text-[9px] tracking-wider mb-0.5 font-semibold">${t('selectedRoomLabel')}</p><p class="text-xl font-bold text-violet-500 font-display detail-sidebar-price">${utils.formatPrice(startPrice)}<span class="text-xs"> / ${t('nightLabel')}</span></p>${startPriceIsEstimate ? `<p class="text-[9px]" style="color:var(--text-secondary)">${t('estimatedPerNight')}</p>` : ''}</div>
      ${ratingChip(h)}
    </div>
    <button onclick="startBooking('${h.id}', 0)" class="btn-gold w-full py-3.5 rounded-2xl font-bold text-ink-900 detail-book-btn">${t('bookNowBtn')}</button>
    <p class="detail-sidebar-note"><i class="fa-solid fa-location-dot"></i> ${h.location}</p>`;
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-80 detail-gallery">
        <div id="hotelGallery" class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onGalleryScroll(this)">
          ${(h.images || [h.image]).map((img, i) => `<img alt="" src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%" onclick="openLightbox(${i})">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none"></div>
        <button type="button" onclick="closeHotelPage()" aria-label="Back" data-back class="ds-detail-back absolute top-4 start-4 w-11 h-11 rounded-full flex items-center justify-center z-10"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
        <button onclick="favorites.toggle('${h.id}')" class="absolute top-4 left-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg z-10"><i class="fa-${state.favorites.includes(h.id) ? 'solid text-red-500' : 'regular text-ink-900'} fa-heart"></i></button>
        ${h.bestseller ? `<div class="absolute top-4 left-1/2 -translate-x-1/2 badge-bestseller px-3 py-1 rounded-full text-[10px] font-black">${t('bestSellerBadge')}</div>` : ''}
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="galleryDots">${(h.images || [h.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      ${renderPhotoGrid(h.images || [h.image])}
      <div class="detail-layout">
        <div class="detail-main relative -mt-6 rounded-t-[28px] p-5 space-y-6 pb-32" style="background:var(--bg-card)">
        <div>
          <p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">— ${(h.category || '').toUpperCase()} HOTEL</p>
          <h2 class="font-display text-2xl font-bold mb-1 leading-tight">${h.name}</h2>
          ${ratingRow(h)}
          <p class="text-xs flex items-center gap-1"><i class="fa-solid fa-location-dot text-violet-500"></i>${h.location}</p>
        </div>
        <div class="grid grid-cols-3 lg:grid-cols-6 gap-2">
          ${(h.amenities || []).slice(0, 6).map(a => `<div class="field-box rounded-xl p-2.5 flex flex-col items-center gap-1.5 text-center"><i class="fa-solid ${amenityIcon(a)} text-violet-500"></i><span class="text-[9px] leading-tight">${a}</span></div>`).join('')}
        </div>
        <div>
          <p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">${t('aboutPlace')}</p>
          <h3 class="font-display text-lg font-bold mb-2">${t('aboutThisHotelHeader')}</h3>
          <p class="text-sm leading-relaxed">${h.fullDescription || h.description || ''}</p>
        </div>
        <div>
          <p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">${t('roomsSectionLabel')}</p>
          <h3 class="font-display text-lg font-bold mb-3">${t('roomOptionsHeader')}</h3>
          <div class="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0" id="hotelRoomsList">
            ${(h.rooms || []).map((r, i) => `
              <div class="card room-option-card rounded-2xl p-3 flex gap-3 cursor-pointer ${i === 0 ? 'room-selected' : ''}" onclick="selectRoomOnDetail('${h.id}', ${i})">
                <img alt="" src="${getImageUrl(r.image)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-24 h-24 rounded-xl object-cover flex-shrink-0">
                <div class="flex-1 flex flex-col justify-between">
                  <div>
                    <h4 class="font-display font-bold text-sm mb-1">${r.type}</h4>
                    <div class="flex items-center gap-2 text-[10px] mb-1"><span><i class="fa-solid fa-user-group"></i>${r.guests || 2}</span><span><i class="fa-solid fa-ruler-combined"></i>${r.size || '25m²'}</span></div>
                    <p class="text-[10px]"><i class="fa-solid fa-bed"></i>${r.beds || '1 Queen Bed'}</p>
                  </div>
                  <div class="flex items-center justify-between">
                    <p class="font-display font-bold text-violet-500 text-lg">${utils.formatPrice(r.price)}<span class="text-[10px]"> /${t('nightLabel')}</span></p>
                    <span class="text-[10px] font-bold text-violet-500"><i class="fa-solid fa-circle-check text-amber-500"></i> Selected</span>
                  </div>
                </div>
              </div>`).join('')}
          </div>
        </div>
        <div class="card rounded-2xl p-4">
          <h3 class="font-display text-lg font-bold mb-4">${t('realStoriesGuestsHeader')}</h3>
          <div class="rating-summary-block">
            <div class="rating-summary-score">
              <p class="rating-summary-number" id="hotelRatingSummary">–</p>
              <div class="text-gold-500 text-sm" id="hotelRatingStars"></div>
              <p class="rating-summary-count" id="hotelRatingCount"></p>
            </div>
            <div class="rating-bar-chart" id="hotelRatingBars"></div>
          </div>
          <button onclick="reviews.openModal('hotel','${h.id}')" class="w-full py-2.5 rounded-xl text-xs font-bold border border-violet-400/40 text-violet-500 mb-3 mt-4"><i class="fa-solid fa-pen"></i> ${t('writeReviewBtn')}</button>
          <div class="space-y-3" id="hotelReviewsList"></div>
        </div>
        </div>
        <aside class="detail-sidebar">
          <div class="detail-sidebar-card">${bookingCard}</div>
        </aside>
      </div>
      <div class="fixed bottom-0 left-0 right-0 max-w-md mx-auto backdrop-blur-xl border-t p-4 flex items-center justify-between z-10 detail-mobile-bar" style="background:var(--bg-card); border-color:var(--border-card)">
        <div><p class="text-[9px] tracking-wider mb-0.5 font-semibold">${t('selectedRoomLabel')}</p><p class="text-xl font-bold text-violet-500 font-display detail-sidebar-price" id="hotelBottomPriceAmount">${utils.formatPrice(startPrice)}<span class="text-xs"> / ${t('nightLabel')}</span></p>${startPriceIsEstimate ? `<p class="text-[9px]" style="color:var(--text-secondary)">${t('estimatedPerNight')}</p>` : ''}</div>
        <button onclick="startBooking('${h.id}', 0)" class="btn-gold px-7 py-3 rounded-2xl font-bold text-ink-900 detail-book-btn">${t('bookNowBtn')}</button>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0, 0);
  routeToDetail('hotels', h.id, h.name, opts);
  loadReviews('hotel', h.id, 'hotelReviewsList', 'hotelRatingSummary', 'hotelRatingBars');
}

function closeHotelPage() { const p = document.getElementById('hotelDetailPage'); if (p) p.remove(); nav.go('hotels'); }
function onGalleryScroll(el) { const idx = Math.round(el.scrollLeft / el.clientWidth); document.querySelectorAll('#galleryDots .gallery-dot').forEach((d, i) => d.classList.toggle('active', i === idx)); }
function amenityIcon(a) { const map = { 'Free WiFi':'fa-wifi','Breakfast':'fa-mug-saucer','Pool':'fa-water-ladder','Spa':'fa-spa','Gym':'fa-dumbbell','Beach Access':'fa-umbrella-beach','Parking':'fa-square-parking','Business Center':'fa-briefcase','Meeting Rooms':'fa-users-rectangle','Concierge':'fa-bell-concierge','24/7 Reception':'fa-clock' }; return map[a] || 'fa-check'; }
function selectRoomOnDetail(hotelId, roomIndex) {
  const h = CATALOG.hotels.find(x => x.id === hotelId); const r = h?.rooms?.[roomIndex]; if (!r) return;
  // Updates BOTH the mobile fixed bar and the desktop sticky sidebar card,
  // since a room pick needs to stay in sync wherever the price/button show.
  document.querySelectorAll('#hotelDetailPage .detail-sidebar-price').forEach(el => { el.innerHTML = `${utils.formatPrice(r.price)}<span class="text-xs"> / ${t('nightLabel')}</span>`; });
  document.querySelectorAll('#hotelDetailPage .detail-book-btn').forEach(btn => btn.setAttribute('onclick', `startBooking('${hotelId}', ${roomIndex})`));
  document.querySelectorAll('#hotelRoomsList .room-option-card').forEach((card, i) => card.classList.toggle('room-selected', i === roomIndex));
}

function startBooking(hotelId, roomIndex) {
  if (!authToken) { toast(t('errLoginToBook'), 'error'); return; }
  if (!allChildAgesSelected()) { toast(t('errSelectChildAgesBooking'), 'error'); openGuestsModal(); return; }
  const h = CATALOG.hotels.find(x => x.id === hotelId);
  const r = h?.rooms?.[roomIndex];
  if (!h || !r) return;
  state.currentHotel = h;
  state.currentRoom = r;
  state.currentRoomIndex = roomIndex; // lets the server recompute the price for exactly this room
  state.bookingDraft = {
    name: currentUser?.displayName || currentUser?.name || '',
    email: currentUser?.email || '',
    phone: (currentUser?.countryCode || '') + (currentUser?.phone || ''),
    requests: '',
    payment: 'card',
    checkin: search.stay().ci,
    checkout: search.stay().co,
  };
  renderBookingStep(2);
}

function renderBookingStep(step) {
  state.bookingStep = step;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  ['bookingFlowPage','hotelDetailPage'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  const h = state.currentHotel, r = state.currentRoom;
  const nights = Math.max(1, Math.round((new Date(state.bookingDraft.checkout) - new Date(state.bookingDraft.checkin)) / 86400000));
  const pricing = computeRoomPricing(r, state.guests, state.guests.rooms, nights);
  const taxes = Math.round(pricing.roomTotal * 0.1);
  const total = pricing.roomTotal + taxes;
  const page = document.createElement('div'); page.id = 'bookingFlowPage'; page.className = 'page bk-flow';
  const summary = bkSummary({
    img: h.image, title: h.name, sub: r.type, total,
    rows: [
      [t('checkinLabel'), utils.formatDate(state.bookingDraft.checkin)],
      [t('checkoutLabel'), utils.formatDate(state.bookingDraft.checkout)],
      [t('nightsLabel'), String(nights)],
      [t('guestsLabel'), `${state.guests.adults} ${t('adults')}${state.guests.children ? `, ${state.guests.children} ${t('children')}` : ''}`],
      [`${r.type} × ${state.guests.rooms} ${t('roomsCountSuffix')}`, utils.formatPrice(pricing.baseRoomTotal)],
    ],
    extra: (pricing.childrenBreakdown.length ? `
      <div class="booking-summary-row" style="flex-direction:column; align-items:flex-start; gap:4px;">
        <span style="font-size:11px;">${t('children')} (${pricing.freeChildrenCount} ${t('freeLabel')})</span>
        ${pricing.childrenBreakdown.map(c => `<div class="flex justify-between w-full text-[11px]"><span>${t('ageLabel')} ${c.age}</span><span>${c.fee > 0 ? utils.formatPrice(c.fee) + ' / ' + t('nightLabel') : t('freeLabel')}</span></div>`).join('')}
      </div>` : '') + `<div class="booking-summary-row"><span>${t('taxesFeesLabel')}</span><span>${utils.formatPrice(taxes)}</span></div>`,
  });
  let main = '';
  if (step === 2) {
    main = `
      ${bkGuestCard()}
      <form id="bkForm" onsubmit="submitGuestDetails(event)">
        ${bkCard('fa-calendar-days', t('stayDatesHeader'), `
          <div class="bk-grid-2">
            ${bkDateField('bkCheckin', t('checkinLabel'), state.bookingDraft.checkin, 'fa-right-to-bracket')}
            ${bkDateField('bkCheckout', t('checkoutLabel'), state.bookingDraft.checkout, 'fa-right-from-bracket')}
          </div>`)}
        ${bkCard('fa-user-group', t('guestsLabel'), `
          <button type="button" class="bk-edit-row" onclick="openGuestsModal()">
            <span>${state.guests.adults} ${t('adults')}${state.guests.children ? `, ${state.guests.children} ${t('children')}` : ''}, ${state.guests.rooms} ${t('roomsCountSuffix')}</span><em>${t('editBtn')}<i class="fa-solid fa-pen" aria-hidden="true"></i></em>
          </button>`)}
        ${bkCard('fa-comment-dots', t('phSpecialRequests'), `<textarea id="bkRequests" rows="3" placeholder="${t('phSpecialRequests')}" class="bk-input bk-textarea">${esc(state.bookingDraft.requests || '')}</textarea>`)}
      </form>
      <div class="bk-bar">
        <div class="bk-bar-total"><small>${t('totalLabel')}</small><b>${utils.formatPrice(total)}</b></div>
        <button type="submit" form="bkForm" class="btn-violet bk-cta">${t('continueBtn')}<i class="fa-solid fa-arrow-right rtl-flip" aria-hidden="true"></i></button>
      </div>`;
  } else if (step === 3) {
    main = `
      ${bkCard('fa-coins', t('choosePaymentOptionLabel'), paymentPlanSelector(total, 'hotel'))}
      ${bkCard('fa-credit-card', t('paymentMethodHeader'), paymentMethodsBlock(state.bookingDraft.payment, 'setHotelPaymentMethod'))}
      <div class="bk-bar">
        <button onclick="payAndConfirmHotelBooking(${pricing.roomTotal}, ${taxes}, ${total}, ${nights})" id="hotelPayBtn" class="btn-violet bk-cta bk-cta-wide"><i class="fa-solid fa-lock" aria-hidden="true"></i>${payBtnLabel('hotel', total)}</button>
      </div>`;
  }
  page.innerHTML = bkShell({
    step, main, side: summary,
    backAction: step === 2 ? 'closeBookingFlow()' : 'renderBookingStep(2)',
    title: step === 2 ? t('bookingDetailsHeader') : t('paymentStepLabel'),
  });
  document.getElementById('mainApp').appendChild(page);
  page.classList.add('active'); if (!window.__bkKeep) window.scrollTo(0,0);
}

function setHotelPaymentMethod(m) { state.bookingDraft.payment = m; renderBookingStep(3); }
function closeBookingFlow() { const p = document.getElementById('bookingFlowPage'); if (p) p.remove(); showHotelPage(state.currentHotel.id); }
function submitGuestDetails(e) { e.preventDefault(); state.bookingDraft.checkin = document.getElementById('bkCheckin').dataset.value; state.bookingDraft.checkout = document.getElementById('bkCheckout').dataset.value; state.bookingDraft.requests = document.getElementById('bkRequests').value; renderBookingStep(3); }
// Looks up the per-night fee for one child's age against the room's own
// childPricingTiers (e.g. [{minAge:0,maxAge:2,fee:0}, {minAge:3,maxAge:6,fee:150}, ...]).
// Rooms that don't define tiers yet fall back to the old flat extraChildFee,
// so existing hotels.json entries keep working without migration.
function computeChildFee(room, age) {
  const tiers = room.childPricingTiers;
  if (Array.isArray(tiers) && tiers.length) {
    const tier = tiers.find(t => age >= t.minAge && age <= t.maxAge);
    if (tier) return tier.fee || 0;
  }
  return room.extraChildFee || 0;
}

function computeRoomPricing(room, guests, roomsCount, nights) {
  const baseOcc = room.baseOccupancy || 2;
  const extraAdultFee = room.extraAdultFee || 0;
  const adultsPerRoom = Math.ceil(guests.adults / roomsCount);
  const extraAdults = Math.max(0, adultsPerRoom - baseOcc);

  // Children are priced individually by age rather than as a flat
  // "extra child" count. "freeChildrenPerRoom" slots are given to the
  // children with the lowest fee first (most favorable to the guest —
  // e.g. an infant tier at 0 EGP is always free before an older child's
  // fee is ever charged).
  const ages = (guests.childAges || []).filter(a => a !== null && a !== undefined && !isNaN(a));
  const perChildFees = ages.map(age => computeChildFee(room, age)).sort((a, b) => a - b);
  const freeSlots = Math.max(0, (room.freeChildrenPerRoom ?? 2) * roomsCount);
  const payableChildFees = perChildFees.slice(freeSlots);
  const childFeeTotalPerNight = payableChildFees.reduce((sum, f) => sum + f, 0);

  const roomAndAdultsPerNight = (room.price + (extraAdults * extraAdultFee)) * roomsCount;
  const roomAndAdultsTotal = roomAndAdultsPerNight * nights;
  const childrenTotal = childFeeTotalPerNight * nights;

  return {
    roomTotal: roomAndAdultsTotal + childrenTotal,
    extraFeesTotal: (extraAdults * extraAdultFee * roomsCount * nights) + childrenTotal,
    baseRoomTotal: room.price * roomsCount * nights,
    childrenBreakdown: ages.map(age => ({ age, fee: computeChildFee(room, age) })),
    freeChildrenCount: Math.min(ages.length, freeSlots),
  };
}

async function payAndConfirmHotelBooking(roomTotal, taxes, total, nights) {
  if (!authToken) { toast(t('errLoginToBook'), 'error'); return; }
  const btn = document.getElementById('hotelPayBtn'); btn.disabled = true; btn.innerHTML = 'Processing…';
  const orderId = utils.generateId();
  try {
    const bookingData = {
      id: orderId,
      type: 'hotel',
      hotelId: state.currentHotel.id,
      hotelName: state.currentHotel.name,
      image: getImageUrl(state.currentHotel.image),
      location: state.currentHotel.location,
      rating: state.currentHotel.rating,
      name: state.bookingDraft.name,
      email: state.bookingDraft.email,
      phone: state.bookingDraft.phone,
      requests: state.bookingDraft.requests,
      checkin: state.bookingDraft.checkin,
      checkout: state.bookingDraft.checkout,
      guests: state.guests.adults + state.guests.children,
      adults: state.guests.adults,
      children: state.guests.children,
      childAges: state.guests.childAges || [],
      infants: state.guests.infants || 0,
      rooms: state.guests.rooms,
      roomType: state.currentRoom.type,
      roomIndex: state.currentRoomIndex,
      nights,
      payment: state.bookingDraft.payment,
      total,
      paymentPlan: (state.bookingDraft.paymentPlan && state.bookingDraft.paymentPlan.hotel) || 'full',
      currency: 'EGP',
      priceFormatted: utils.formatPrice(total),
      status: 'pending_payment',
      reviewed: false,
      createdAt: new Date().toISOString(),
    };

    await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });

    // Direct API charge — customer never leaves this page. Card fields are
    // collected by our own form (see paymentMethodsBlock) and 3D Secure, if
    // triggered, opens as an in-page modal rather than a redirect.
    // Charges exactly what the chosen plan owes now — bookings-worker computes
    // and stores the same deposit/full split server-side and rejects any other amount.
    const success = await processKashierPayment(orderId, amountDueNow('hotel', total), 'EGP', btn);
    if (!success) { btn.disabled = false; btn.innerHTML = payBtnLabel('hotel', total); return; }
    bookingData.status = 'completed';
    state.bookings.unshift(bookingData);
    bookings.render();
    renderBookingConfirmation(bookingData);
    btn.disabled = false; btn.innerHTML = t('payNowBtn');
  } catch (e) {
    toast('Payment error: ' + e.message, 'error');
    btn.disabled = false; btn.innerHTML = t('payNowBtn');
  }
}

// ==================== EXCURSION DETAILS & BOOKING ====================
function showExcursionPage(excursionId, opts = {}) {
  const x = CATALOG.excursions.find(i => i.id === excursionId);
  if (!x) return toast(t('errExcursionNotFound'), 'error');
  state.currentExcursion = x;
  const old = document.getElementById('excursionDetailPage'); if (old) old.remove();
  const page = document.createElement('div'); page.id = 'excursionDetailPage'; page.className = 'page';
  const bookingCard = `
    <div class="detail-price-row">
      <div><p class="text-[9px]">${t('fromLabel')}</p><p class="text-xl font-bold text-violet-500 tabular-nums">${utils.formatPrice(x.price)}<span class="text-xs">/${t('perPersonLabel')}</span></p></div>
      ${ratingChip(x)}
    </div>
    <button onclick="startExcursionBooking('${x.id}')" class="btn-gold w-full py-3.5 rounded-2xl font-bold text-ink-900">${t('bookNowBtn')}</button>
    <p class="detail-sidebar-note"><i class="fa-regular fa-clock"></i> ${x.duration} · <i class="fa-solid fa-location-dot"></i> ${x.meetingPoint || ''}</p>`;
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-72 detail-gallery">
        <div id="excursionGallery" class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onExcursionGalleryScroll(this)">
          ${(x.images || [x.image]).map((img, i) => `<img alt="" src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%" onclick="openLightbox(${i})">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none"></div>
        <button type="button" onclick="closeExcursionPage()" aria-label="Back" data-back class="ds-detail-back absolute top-4 start-4 w-11 h-11 rounded-full flex items-center justify-center z-10"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
        <div class="absolute top-4 start-4 bg-violet-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full z-10">${excursionsUi.categoryLabel(x.category)}</div>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="excursionGalleryDots">${(x.images || [x.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      ${renderPhotoGrid(x.images || [x.image])}
      <div class="detail-layout">
        <div class="detail-main relative -mt-6 rounded-t-[28px] p-5 space-y-6 pb-32" style="background:var(--bg-card)">
        <div>
          <h2 class="font-display text-2xl font-bold mb-1 leading-tight">${x.title}</h2>
          ${ratingRow(x)}
          <p class="text-xs"><i class="fa-regular fa-clock text-violet-500"></i>${x.duration} · <i class="fa-solid fa-location-dot text-violet-500"></i>${x.meetingPoint || ''}</p>
        </div>

        <!-- Trust badges -->
        <div class="trust-badge-row">
          ${hasRating(x) ? `<div class="trust-badge"><i class="fa-solid fa-star"></i><span>${ratingNum(x)} ${t('ratingLabel')}</span></div>` : ''}
          <div class="trust-badge"><i class="fa-solid fa-rotate-left"></i><span>${t('freeCancellationBadge')}</span></div>
          <div class="trust-badge"><i class="fa-solid fa-bolt"></i><span>${t('instantConfirmationBadge')}</span></div>
          <div class="trust-badge"><i class="fa-solid fa-shield-heart"></i><span>${t('secureBookingBadge')}</span></div>
        </div>

        <div>
          <h3 class="font-display text-lg font-bold mb-2">${t('overviewHeader')}</h3>
          <p class="text-sm leading-relaxed">${x.fullDescription || x.description}</p>
        </div>

        ${(x.includes || []).length ? `
        <div>
          <h3 class="font-display text-lg font-bold mb-3">${t('whatTripOffersHeader')}</h3>
          <div class="highlight-grid">
            ${x.includes.map((i, n) => `
              <div class="highlight-item">
                <span class="highlight-num">${String(n + 1).padStart(2, '0')}</span>
                <span>${i}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

        <div>
          <h3 class="font-display text-lg font-bold mb-3">${t('pricesInclusionsLabel')}</h3>
          <div class="inclusion-cards">
            <div class="inclusion-card inclusion-card-in">
              <p class="inclusion-card-title"><i class="fa-solid fa-circle-check"></i> ${t('excSectionIncluded')}</p>
              ${(x.includes || []).map(i => `<div class="inclusion-row"><i class="fa-solid fa-check"></i>${i}</div>`).join('')}
            </div>
            ${(x.excludes || []).length ? `
            <div class="inclusion-card inclusion-card-out">
              <p class="inclusion-card-title"><i class="fa-solid fa-circle-xmark"></i> ${t('notIncludedLabel')}</p>
              ${x.excludes.map(i => `<div class="inclusion-row"><i class="fa-solid fa-xmark"></i>${i}</div>`).join('')}
            </div>` : ''}
          </div>
        </div>

        ${(x.whatToBring || []).length ? `
          <div>
            <h3 class="font-display text-lg font-bold mb-3">${t('whatToBringHeader')}</h3>
            <div class="bring-chip-row">${x.whatToBring.map(i => `<div class="bring-chip"><i class="fa-solid fa-suitcase-rolling"></i>${i}</div>`).join('')}</div>
          </div>` : ''}

        <!-- Meeting point & schedule -->
        <div class="meeting-card">
          <div class="meeting-card-row">
            <div class="meeting-card-icon"><i class="fa-solid fa-location-dot"></i></div>
            <div><p class="meeting-card-label">${t('meetingPointLabel')}</p><p class="meeting-card-value">${x.meetingPoint || t('defaultMeetingPoint')}</p></div>
          </div>
          <div class="meeting-card-divider"></div>
          <div class="meeting-card-row">
            <div class="meeting-card-icon"><i class="fa-regular fa-clock"></i></div>
            <div><p class="meeting-card-label">${t('scheduleLabel')}</p><p class="meeting-card-value">${x.duration || ''} · ${t('dailyLabel')}</p></div>
          </div>
        </div>

        ${(x.itinerary || []).length ? `
          <div>
            <h3 class="font-display text-lg font-bold mb-3">${t('tripItineraryHeader')}</h3>
            <div class="space-y-0">
              ${x.itinerary.map((step, i) => `
                <div class="flex gap-3">
                  <div class="flex flex-col items-center flex-shrink-0">
                    <div class="w-8 h-8 rounded-full bg-violet-500/15 text-violet-500 text-[11px] font-bold flex items-center justify-center">${i+1}</div>
                    ${i < x.itinerary.length - 1 ? '<div class="w-px flex-1 bg-violet-400/20 my-1"></div>' : ''}
                  </div>
                  <div class="pb-4 flex-1">
                    <p class="text-[10px] font-bold text-violet-500 mb-0.5">${step.time || ''}</p>
                    <p class="text-sm font-semibold mb-0.5">${step.title || ''}</p>
                    <p class="text-xs leading-relaxed">${step.description || ''}</p>
                  </div>
                </div>`).join('')}
            </div>
          </div>` : ''}
        <div class="card rounded-2xl p-4">
          <h3 class="font-display text-lg font-bold mb-4">${t('realStoriesTravelersHeader')}</h3>
          <div class="rating-summary-block">
            <div class="rating-summary-score">
              <p class="rating-summary-number" id="excursionRatingSummary">–</p>
              <div class="text-gold-500 text-sm" id="excursionRatingStars"></div>
              <p class="rating-summary-count" id="excursionRatingCount"></p>
            </div>
            <div class="rating-bar-chart" id="excursionRatingBars"></div>
          </div>
          <button onclick="reviews.openModal('excursion','${x.id}')" class="w-full py-2.5 rounded-xl text-xs font-bold border border-violet-400/40 text-violet-500 mb-3 mt-4">${t('writeReviewBtn')}</button>
          <div class="space-y-3" id="excursionReviewsList"></div>
        </div>
        </div>
        <aside class="detail-sidebar">
          <div class="detail-sidebar-card">${bookingCard}</div>
        </aside>
      </div>
      <div class="fixed bottom-0 left-0 right-0 max-w-md mx-auto backdrop-blur-xl border-t p-4 flex items-center justify-between z-10 detail-mobile-bar" style="background:var(--bg-card); border-color:var(--border-card)">
        <div><p class="text-[9px]">${t('fromLabel')}</p><p class="text-xl font-bold text-violet-500 tabular-nums">${utils.formatPrice(x.price)}<span class="text-xs">/${t('perPersonLabel')}</span></p></div>
        <button onclick="startExcursionBooking('${x.id}')" class="btn-gold px-7 py-3 rounded-2xl font-bold text-ink-900">${t('bookNowBtn')}</button>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0,0);
  routeToDetail('excursions', x.id, x.title, opts);
  loadReviews('excursion', x.id, 'excursionReviewsList', 'excursionRatingSummary', 'excursionRatingBars');
}

function closeExcursionPage() { const p = document.getElementById('excursionDetailPage'); if (p) p.remove(); nav.go('excursions'); }
function onGalleryScroll(el, dotsId) { const idx = Math.round(el.scrollLeft / el.clientWidth); document.querySelectorAll(`#${dotsId} .gallery-dot`).forEach((d, i) => d.classList.toggle('active', i === idx)); }
// Back-compat alias — existing excursion markup calls this by name directly.
function onExcursionGalleryScroll(el) { onGalleryScroll(el, 'excursionGalleryDots'); }
function startExcursionBooking(id) {
  if (!authToken) { toast(t('errLoginToBook'), 'error'); return; }
  const x = CATALOG.excursions.find(i => i.id === id);
  if (!x) return;
  state.currentExcursion = x;
  state.bookingDraft = { name: currentUser?.displayName || currentUser?.name || '', email: currentUser?.email || '', phone: (currentUser?.countryCode || '') + (currentUser?.phone || ''), participants: Math.min(15, state.tripPax || 2), payment: 'card', date: search.selectedCheckIn || utils.addDays(utils.todayIso(), 1) };
  renderExcursionBookingStep(2);
}

function renderExcursionBookingStep(step) {
  state.bookingStep = step;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const existing = document.getElementById('excursionBookingFlowPage'); if (existing) existing.remove();
  const x = state.currentExcursion; const subtotal = x.price * state.bookingDraft.participants; const taxes = Math.round(subtotal * 0.05); const total = subtotal + taxes;
  const page = document.createElement('div'); page.id = 'excursionBookingFlowPage'; page.className = 'page bk-flow';
  const summary = bkSummary({
    img: x.image, title: x.title, sub: `${excursionsUi.categoryLabel(x.category)} · ${x.duration}`, total,
    rows: [
      [t('dateLabel'), utils.formatDate(state.bookingDraft.date)],
      [`${x.title} × ${state.bookingDraft.participants}`, utils.formatPrice(subtotal)],
      [t('taxesFeesLabel'), utils.formatPrice(taxes)],
    ],
  });
  let main = '';
  if (step === 2) {
    main = `
      ${bkGuestCard()}
      <form id="bkForm" onsubmit="submitExcursionDetails(event)">
        ${bkCard('fa-compass', t('tripDetailsHeader'), `
          ${bkDateField('ekDate', t('dateLabel'), state.bookingDraft.date)}
          ${bkCounter('fa-users', t('participantsLabel'), 'ekParticipantsLabel', `${state.bookingDraft.participants} ${t('peopleLabel')}`, 'adjustParticipants(-1)', 'adjustParticipants(1)')}`)}
      </form>
      <div class="bk-bar">
        <div class="bk-bar-total"><small>${t('totalLabel')}</small><b id="ekBarTotal">${utils.formatPrice(total)}</b></div>
        <button type="submit" form="bkForm" class="btn-violet bk-cta">${t('continueBtn')}<i class="fa-solid fa-arrow-right rtl-flip" aria-hidden="true"></i></button>
      </div>`;
  } else if (step === 3) {
    main = `
      ${bkCard('fa-coins', t('choosePaymentOptionLabel'), paymentPlanSelector(total, 'excursion'))}
      ${bkCard('fa-credit-card', t('paymentMethodHeader'), paymentMethodsBlock(state.bookingDraft.payment, 'setExcursionPaymentMethod'))}
      <div class="bk-bar">
        <button onclick="payAndConfirmExcursionBooking(${subtotal}, ${taxes}, ${total})" id="excursionPayBtn" class="btn-violet bk-cta bk-cta-wide"><i class="fa-solid fa-lock" aria-hidden="true"></i>${payBtnLabel('excursion', total)}</button>
      </div>`;
  }
  page.innerHTML = bkShell({
    step, main, side: summary,
    backAction: step === 2 ? 'closeExcursionBookingFlow()' : 'renderExcursionBookingStep(2)',
    title: step === 2 ? t('bookingDetailsHeader') : t('paymentStepLabel'),
  });
  document.getElementById('mainApp').appendChild(page); page.classList.add('active'); if (!window.__bkKeep) window.scrollTo(0,0);
}

function setExcursionPaymentMethod(m) { state.bookingDraft.payment = m; renderExcursionBookingStep(3); }
function closeExcursionBookingFlow() { const p = document.getElementById('excursionBookingFlowPage'); if (p) p.remove(); showExcursionPage(state.currentExcursion.id); }
function adjustParticipants(delta) { const v = state.bookingDraft.participants + delta; if (v >= 1 && v <= 15) { state.bookingDraft.participants = v; bkRefresh(); } }
function submitExcursionDetails(e) { e.preventDefault(); state.bookingDraft.date = document.getElementById('ekDate').dataset.value; renderExcursionBookingStep(3); }

async function payAndConfirmExcursionBooking(subtotal, taxes, total) {
  if (!authToken) { toast(t('errLoginToBook'), 'error'); return; }
  const btn = document.getElementById('excursionPayBtn'); btn.disabled = true; btn.innerHTML = 'Processing…';
  const orderId = utils.generateId();
  try {
    const bookingData = {
      id: orderId,
      type: 'excursion',
      excursionId: state.currentExcursion.id,
      title: state.currentExcursion.title,
      image: getImageUrl(state.currentExcursion.image),
      category: state.currentExcursion.category,
      name: state.bookingDraft.name,
      email: state.bookingDraft.email,
      phone: state.bookingDraft.phone,
      date: state.bookingDraft.date,
      participants: state.bookingDraft.participants,
      payment: state.bookingDraft.payment,
      total,
      paymentPlan: (state.bookingDraft.paymentPlan && state.bookingDraft.paymentPlan.excursion) || 'full',
      currency: 'EGP',
      priceFormatted: utils.formatPrice(total),
      status: 'pending_payment',
      reviewed: false,
      createdAt: new Date().toISOString(),
    };

    await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });

    // Direct API charge — customer never leaves this page. Card fields are
    // collected by our own form (see paymentMethodsBlock) and 3D Secure, if
    // triggered, opens as an in-page modal rather than a redirect.
    // Charges exactly what the chosen plan owes now — bookings-worker computes
    // and stores the same deposit/full split server-side and rejects any other amount.
    const success = await processKashierPayment(orderId, amountDueNow('excursion', total), 'EGP', btn);
    if (!success) { btn.disabled = false; btn.innerHTML = payBtnLabel('excursion', total); return; }
    bookingData.status = 'completed';
    state.bookings.unshift(bookingData);
    bookings.render();
    renderBookingConfirmation(bookingData);
    btn.disabled = false; btn.innerHTML = t('payNowBtn');
  } catch (e) {
    toast('Payment error: ' + e.message, 'error');
    btn.disabled = false; btn.innerHTML = t('payNowBtn');
  }
}

// ==================== TRANSFER BOOKING ====================
function startTransferBooking(id) {
  if (!authToken) { toast(t('errLoginToBook'), 'error'); return; }
  const v = CATALOG.transfers.find(i => i.id === id);
  if (!v) return toast(t('errTransferNotFound'), 'error');
  state.currentTransfer = v;
  state.bookingDraft = {
    name: currentUser?.displayName || currentUser?.name || '',
    email: currentUser?.email || '',
    phone: (currentUser?.countryCode || '') + (currentUser?.phone || ''),
    direction: 'Airport to Hotel',
    flightNo: '',
    address: '',
    passengers: Math.min(v.capacity || 2, state.tripPax || 2),
    time: '14:00',
    payment: 'card',
    date: search.selectedCheckIn || utils.addDays(utils.todayIso(), 1),
  };
  renderTransferBookingStep(2);
}

function renderTransferBookingStep(step) {
  state.bookingStep = step;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const existing = document.getElementById('transferBookingFlowPage'); if (existing) existing.remove();
  const v = state.currentTransfer;
  const subtotal = v.price;
  const taxes = Math.round(subtotal * 0.05);
  const total = subtotal + taxes;
  const page = document.createElement('div');
  page.id = 'transferBookingFlowPage';
  page.className = 'page bk-flow';
  const summary = bkSummary({
    img: v.image, title: `${v.vehicleType} ${t('transferSuffix')}`, sub: `${t('upToPassengersPrefix')} ${v.capacity} ${t('passengersLower')}`, total,
    rows: [
      [t('dateLabel'), utils.formatDate(state.bookingDraft.date)],
      [t('timeLabel'), state.bookingDraft.time],
      [t('passengersLabel'), `${state.bookingDraft.passengers} ${t('peopleLabel')}`],
      [`${v.vehicleType} ${t('transferSuffix')}`, utils.formatPrice(subtotal)],
      [t('taxesFeesLabel'), utils.formatPrice(taxes)],
    ],
  });
  let main = '';
  if (step === 2) {
    main = `
      ${bkGuestCard()}
      <form id="bkForm" onsubmit="submitTransferDetails(event)">
        ${bkCard('fa-route', t('transferDetailsHeader'), `
          <div class="bk-seg" role="group">
            <button type="button" onclick="setTransferDirection('Airport to Hotel')" id="dirBtnArrival" class="bk-seg-btn"><i class="fa-solid fa-plane-arrival" aria-hidden="true"></i>${t('airportPickupBtn')}</button>
            <button type="button" onclick="setTransferDirection('Hotel to Airport')" id="dirBtnDeparture" class="bk-seg-btn"><i class="fa-solid fa-plane-departure" aria-hidden="true"></i>${t('airportDropoffBtn')}</button>
          </div>
          <div class="bk-field">
            <label for="tkFlightNo">${t('phFlightNumber')}</label>
            <input type="text" id="tkFlightNo" value="${esc(state.bookingDraft.flightNo)}" placeholder="${t('phFlightNumber')}" class="bk-input" dir="ltr">
          </div>
          <div class="bk-field" id="hotelField">
            <label for="tkAddress">${t('hotelNameAddressLabel')}</label>
            <input type="text" id="tkAddress" required value="${esc(state.bookingDraft.address)}" placeholder="${t('hotelNameAddressLabel')}" class="bk-input">
          </div>
          <div class="bk-grid-2">
            ${bkDateField('tkDate', t('dateLabel'), state.bookingDraft.date)}
            <div class="date-field bk-date">
              <i class="fa-regular fa-clock bk-date-ico" aria-hidden="true"></i>
              <span class="bk-date-text"><label for="tkTime">${t('timeLabel')}</label><input type="time" id="tkTime" value="${state.bookingDraft.time}" class="bk-time" onchange="bkRefresh()"></span>
            </div>
          </div>
          ${bkCounter('fa-users', t('passengersLabel'), 'tkPassengersLabel', `${state.bookingDraft.passengers} ${t('peopleLabel')}`, 'adjustTransferPassengers(-1)', 'adjustTransferPassengers(1)')}`)}
      </form>
      <div class="bk-bar">
        <div class="bk-bar-total"><small>${t('totalLabel')}</small><b>${utils.formatPrice(total)}</b></div>
        <button type="submit" form="bkForm" class="btn-violet bk-cta">${t('continueBtn')}<i class="fa-solid fa-arrow-right rtl-flip" aria-hidden="true"></i></button>
      </div>`;
  } else if (step === 3) {
    main = `
      ${bkCard('fa-coins', t('choosePaymentOptionLabel'), paymentPlanSelector(total, 'transfer'))}
      ${bkCard('fa-credit-card', t('paymentMethodHeader'), paymentMethodsBlock(state.bookingDraft.payment, 'setTransferPaymentMethod'))}
      <div class="bk-bar">
        <button onclick="payAndConfirmTransferBooking(${subtotal}, ${taxes}, ${total})" id="transferPayBtn" class="btn-violet bk-cta bk-cta-wide"><i class="fa-solid fa-lock" aria-hidden="true"></i>${payBtnLabel('transfer', total)}</button>
      </div>`;
  }
  page.innerHTML = bkShell({
    step, main, side: summary,
    backAction: step === 2 ? 'closeTransferBookingFlow()' : 'renderTransferBookingStep(2)',
    title: step === 2 ? t('transferDetailsHeader') : t('paymentStepLabel'),
  });
  document.getElementById('mainApp').appendChild(page);
  page.classList.add('active'); if (!window.__bkKeep) window.scrollTo(0,0);
  if (step === 2) setTransferDirection(state.bookingDraft.direction);
}

function setTransferDirection(dir) {
  state.bookingDraft.direction = dir;
  const a = document.getElementById('dirBtnArrival'), d = document.getElementById('dirBtnDeparture');
  if (!a || !d) return;
  a.classList.toggle('is-active', dir === 'Airport to Hotel');
  d.classList.toggle('is-active', dir === 'Hotel to Airport');
  a.setAttribute('aria-pressed', String(dir === 'Airport to Hotel'));
  d.setAttribute('aria-pressed', String(dir === 'Hotel to Airport'));
}

function setTransferPaymentMethod(m) { state.bookingDraft.payment = m; renderTransferBookingStep(3); }
function closeTransferBookingFlow() { const p = document.getElementById('transferBookingFlowPage'); if (p) p.remove(); nav.go('transfers'); }
function adjustTransferPassengers(delta) { const v = state.currentTransfer, n = state.bookingDraft.passengers + delta; if (n >= 1 && n <= v.capacity) { state.bookingDraft.passengers = n; bkRefresh(); } else if (n > v.capacity) toast(t('errPassengersMax').replace('{n}', v.capacity), 'error'); }
function submitTransferDetails(e) { e.preventDefault(); state.bookingDraft.flightNo = document.getElementById('tkFlightNo').value; state.bookingDraft.address = document.getElementById('tkAddress').value; state.bookingDraft.date = document.getElementById('tkDate').dataset.value; state.bookingDraft.time = document.getElementById('tkTime').value; renderTransferBookingStep(3); }

async function payAndConfirmTransferBooking(subtotal, taxes, total) {
  if (!authToken) { toast(t('errLoginToBook'), 'error'); return; }
  const btn = document.getElementById('transferPayBtn'); btn.disabled = true; btn.innerHTML = 'Processing…';
  const orderId = utils.generateId();
  try {
    const bookingData = {
      id: orderId,
      type: 'transfer',
      transferId: state.currentTransfer.id,
      vehicleType: state.currentTransfer.vehicleType,
      image: getImageUrl(state.currentTransfer.image),
      direction: state.bookingDraft.direction,
      name: state.bookingDraft.name,
      email: state.bookingDraft.email,
      phone: state.bookingDraft.phone,
      flightNo: state.bookingDraft.flightNo,
      address: state.bookingDraft.address,
      date: state.bookingDraft.date,
      time: state.bookingDraft.time,
      passengers: state.bookingDraft.passengers,
      payment: state.bookingDraft.payment,
      total,
      paymentPlan: (state.bookingDraft.paymentPlan && state.bookingDraft.paymentPlan.transfer) || 'full',
      currency: 'EGP',
      priceFormatted: utils.formatPrice(total),
      status: 'pending_payment',
      reviewed: false,
      createdAt: new Date().toISOString(),
    };

    await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });

    // Direct API charge — customer never leaves this page. Card fields are
    // collected by our own form (see paymentMethodsBlock) and 3D Secure, if
    // triggered, opens as an in-page modal rather than a redirect.
    // Charges exactly what the chosen plan owes now — bookings-worker computes
    // and stores the same deposit/full split server-side and rejects any other amount.
    const success = await processKashierPayment(orderId, amountDueNow('transfer', total), 'EGP', btn);
    if (!success) { btn.disabled = false; btn.innerHTML = payBtnLabel('transfer', total); return; }
    bookingData.status = 'completed';
    state.bookings.unshift(bookingData);
    bookings.render();
    renderBookingConfirmation(bookingData);
    btn.disabled = false; btn.innerHTML = t('payNowBtn');
  } catch (e) {
    toast('Payment error: ' + e.message, 'error');
    btn.disabled = false; btn.innerHTML = t('payNowBtn');
  }
}

// ==================== RESTAURANT DETAILS ====================
function showRestaurantPage(id, opts = {}) {
  const r = CATALOG.restaurants.find(x => x.id === id);
  if (!r) return;
  const old = document.getElementById('restaurantDetailPage'); if (old) old.remove();
  const page = document.createElement('div');
  page.id = 'restaurantDetailPage';
  page.className = 'page';
  const infoCard = `
    <p class="detail-sidebar-title">${r.name}</p>
    <div class="flex items-center gap-2 mb-4"><span class="lux-cuisine-badge">${r.venueType === 'cafe' ? '☕ ' : ''}${r.cuisine}</span><span class="text-gold-500 text-xs font-semibold">${'$'.repeat(r.priceLevel || 2)}</span></div>
    ${hasRating(r) ? ratingChip(r).replace('detail-sidebar-rating','detail-sidebar-rating mb-4') : ''}
    <div class="detail-sidebar-info-row"><i class="fa-solid fa-location-dot"></i> ${r.location}</div>
    <div class="detail-sidebar-info-row"><i class="fa-regular fa-clock"></i> ${r.openHours || ''}</div>`;
  page.innerHTML = `
    <div class="min-h-screen pb-28 restaurant-lux" style="background:var(--bg-card)">
      <div class="relative h-80 detail-gallery">
        <div class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onRestGalleryScroll(this)" id="restGallery">
          ${(r.images || [r.image]).map((img, i) => `<img alt="" src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%" onclick="openLightbox(${i})">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/25 pointer-events-none"></div>
        <button type="button" onclick="closeRestaurantPage()" aria-label="Back" data-back class="ds-detail-back absolute top-4 start-4 w-11 h-11 rounded-full flex items-center justify-center z-10"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
        <div class="absolute bottom-5 left-5 right-5 z-10 text-white">
          <div class="flex items-center gap-2 mb-2">
            <span class="lux-cuisine-badge">${r.cuisine}</span>
            <span class="text-gold-400 text-xs font-semibold">${'$'.repeat(r.priceLevel || 2)}</span>
          </div>
          <h1 class="font-display text-3xl font-bold leading-tight mb-2" style="text-shadow:0 2px 12px rgba(0,0,0,.5)">${r.name}</h1>
          ${hasRating(r) ? `<div class="flex items-center gap-2 text-sm">${utils.renderStars(r.rating)}<span class="text-white/80 text-xs">${ratingNum(r)}${reviewsN(r) ? ` (${reviewsN(r)})` : ''}</span></div>` : ''}
        </div>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="restGalleryDots">${(r.images || [r.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      ${renderPhotoGrid(r.images || [r.image])}
      <div class="detail-layout">
        <div class="detail-main relative -mt-6 rounded-t-[28px] p-6 space-y-2" style="background:var(--bg-card)">
        <div class="flex items-center justify-center gap-5 pb-5 mb-1">
          <p class="text-xs flex items-center gap-1.5" style="color:var(--text-secondary)"><i class="fa-solid fa-location-dot text-gold-500"></i>${r.location}</p>
          <span class="w-1 h-1 rounded-full" style="background:var(--border-field)"></span>
          <p class="text-xs flex items-center gap-1.5" style="color:var(--text-secondary)"><i class="fa-regular fa-clock text-gold-500"></i>${r.openHours || ''}</p>
        </div>
        ${(r.fullDescription || r.description) ? `<p class="text-center text-sm leading-relaxed italic font-display" style="color:var(--text-secondary)">“${r.fullDescription || r.description}”</p>` : ''}
        <div class="lux-divider"><span class="lux-dot"></span></div>
        <div>
          <p class="text-center font-display italic text-2xl mb-6" style="color:var(--text-primary)">${t('theMenuHeader')}</p>
          ${(r.menu || []).map(section => `
            <div class="mb-8">
              <h4 class="menu-category-title">${section.category}</h4>
              <div>
                ${section.items.map(it => `
                  <div class="menu-item-row">
                    <span class="menu-item-name">${it.name}</span>
                    <span class="menu-item-leader"></span>
                    <span class="menu-item-price">${utils.formatPrice(it.price)}</span>
                  </div>
                  ${it.description ? `<p class="menu-item-desc">${it.description}</p>` : '<div class="mb-3"></div>'}`).join('')}
              </div>
            </div>`).join('')}
        </div>
        ${(r.branches && r.branches.length) ? `<div class="lux-divider"><span class="lux-dot"></span></div>
        <div id="restBranches"><p class="text-center font-display italic text-2xl mb-5" style="color:var(--text-primary)">${t('branchesHeader')}</p>
          <div class="space-y-3">${r.branches.map(b => { const L = (v) => (v && typeof v === 'object') ? (v[I18N.get()] || v.en || v.ar || '') : (v || ''); const map = b.google_maps_url || (b.lat && b.lng ? `https://www.google.com/maps?q=${b.lat},${b.lng}` : '');
            return `<div id="branch-${b.id}" class="detail-sidebar-card" style="padding:16px 18px"><div class="flex items-start justify-between gap-3"><div><p class="font-bold" style="color:var(--text-primary)">${L(b.name)}</p>${L(b.area) ? `<p class="text-xs mt-0.5" style="color:var(--text-secondary)">${L(b.area)}</p>` : ''}</div><div class="flex gap-2 flex-shrink-0">${b.phone ? `<a href="tel:${String(b.phone).replace(/[^\d+]/g, '')}" class="footer-social-btn" aria-label="${t('branchCall')}"><i class="fa-solid fa-phone"></i></a>` : ''}${map ? `<a href="${map}" target="_blank" rel="noopener" class="footer-social-btn" aria-label="${t('branchDirections')}"><i class="fa-solid fa-location-arrow"></i></a>` : ''}</div></div>
            ${L(b.address) ? `<div class="detail-sidebar-info-row"><i class="fa-solid fa-location-dot"></i> ${L(b.address)}</div>` : ''}${L(b.openHours) ? `<div class="detail-sidebar-info-row"><i class="fa-regular fa-clock"></i> ${L(b.openHours)}</div>` : ''}</div>`; }).join('')}</div></div>` : ''}
        </div>
        <aside class="detail-sidebar">
          <div class="detail-sidebar-card">${infoCard}</div>
        </aside>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0, 0);
  routeToDetail('restaurants', r.id, r.name, opts);
  I18N.set(I18N.get());
  const wanted = new URLSearchParams(location.search).get('branch');   // QR codes of a branch open the page scrolled to that branch
  if (wanted) setTimeout(() => { const el = document.getElementById('branch-' + wanted); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.boxShadow = '0 0 0 2px #ff6b35'; } }, 400);
}

function onRestGalleryScroll(el) { const idx = Math.round(el.scrollLeft / el.clientWidth); document.querySelectorAll('#restGalleryDots .gallery-dot').forEach((d, i) => d.classList.toggle('active', i === idx)); }
function closeRestaurantPage() { const p = document.getElementById('restaurantDetailPage'); if (p) p.remove(); nav.go('restaurants'); }

// ==================== DESTINATION DETAILS ====================
function showDestinationPage(id, opts = {}) {
  const d = CATALOG.destinations.find(x => x.id === id);
  if (!d) return;
  const old = document.getElementById('destinationDetailPage'); if (old) old.remove();
  const page = document.createElement('div');
  page.id = 'destinationDetailPage';
  page.className = 'page';
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-72">
        <div class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onDestGalleryScroll(this)" id="destGallery">
          ${(d.images || [d.image]).map(img => `<img alt="" src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none"></div>
        <button onclick="closeDestinationPage()" class="absolute top-4 right-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900 z-10"><i class="fa-solid fa-arrow-right"></i></button>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="destGalleryDots">${(d.images || [d.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      <div class="relative -mt-6 rounded-t-[28px] p-5 space-y-5" style="background:var(--bg-card)">
        <div>
          ${hasRating(d) ? `<div class="flex items-center gap-2 text-sm mb-1">${utils.renderStars(d.rating)}<span class="text-xs" style="color:var(--text-secondary)">${ratingNum(d)}</span></div>` : ''}
          <h2 class="font-display text-2xl font-bold mb-1 leading-tight" style="color:var(--text-primary)">${d.name}</h2>
          <p class="text-xs flex items-center gap-1" style="color:var(--text-secondary)"><i class="fa-solid fa-location-dot text-violet-500"></i>${d.location || ''}</p>
        </div>
        <div>
          <p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">${t('aboutPlace')}</p>
          <p class="text-sm leading-relaxed" style="color:var(--text-secondary)">${d.fullDescription || d.description}</p>
        </div>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0, 0);
  routeToDetail('destinations', d.id, d.name, opts);
  I18N.set(I18N.get());
}

function onDestGalleryScroll(el) { const idx = Math.round(el.scrollLeft / el.clientWidth); document.querySelectorAll('#destGalleryDots .gallery-dot').forEach((dd, i) => dd.classList.toggle('active', i === idx)); }
function closeDestinationPage() { const p = document.getElementById('destinationDetailPage'); if (p) p.remove(); nav.go('home'); }

// ==================== ARTICLE DETAILS ====================
function showArticlePage(id, opts = {}) {
  const a = CATALOG.articles.find(x => x.id === id);
  if (!a) return;
  const page = document.createElement('div');
  page.id = 'articleDetailPage';
  page.className = 'page';
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-56">
        <img alt="" src="${a.image}" class="w-full h-full object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <button onclick="closeArticlePage()" class="absolute top-4 right-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900 z-10"><i class="fa-solid fa-arrow-right"></i></button>
      </div>
      <div class="p-5 space-y-4">
        <h1 class="font-display text-2xl font-bold">${a.title}</h1>
        <p class="text-xs"><i class="fa-regular fa-clock"></i> ${a.readTimeMinutes} min ${a.author ? '· ' + a.author : ''}</p>
        <p class="text-sm leading-relaxed" style="white-space:pre-line">${a.content}</p>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0,0);
  routeToDetail('articles', a.id, a.title, opts);
}
function closeArticlePage() { const p = document.getElementById('articleDetailPage'); if (p) p.remove(); nav.go('home'); }

// ==================== BOOKING DETAILS & CANCEL ====================
function showBookingDetails(bookingId) {
  const b = state.bookings.find(x => x.id === bookingId);
  if (!b) return toast(t('errBookingNotFound'), 'error');
  const isUpcoming = new Date(b.checkin || b.date) >= new Date();
  const page = document.createElement('div'); page.id = 'bookingDetailsPage'; page.className = 'page';
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-body)">
      <div class="dark-scene px-5 pt-6 pb-8 relative overflow-hidden">
        <div class="stars-container"></div>
        <div class="relative z-10">
          <div class="flex items-center justify-between mb-5">
            <button onclick="closeBookingDetails()" class="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white"><i class="fa-solid fa-arrow-right"></i></button>
            <h1 class="text-lg font-bold font-display text-white">${t('bookingDetailsHeader')}</h1>
            <div class="w-10"></div>
          </div>
          <div class="text-center">
            <span class="inline-block px-3 py-1 rounded-full text-[10px] font-bold tracking-wider ${isUpcoming ? 'bg-green-500/20 text-green-400 border border-green-400/30' : 'bg-white/10 text-white/50 border border-white/20'}">${isUpcoming ? 'UPCOMING' : 'COMPLETED'}</span>
          </div>
        </div>
      </div>
      <div class="relative -mt-4 rounded-t-[28px] p-5" style="background:var(--bg-card)">
        ${bookingDetailBody(b)}
        ${b.type !== 'transfer' ? (b.reviewed ? `<div class="text-center text-xs py-2 mb-2"><i class="fa-solid fa-circle-check text-green-500"></i> ${t('alreadyReviewedMsg')}</div>` : (!isUpcoming ? `<button onclick="reviews.openModal('${b.type}','${b.hotelId || b.excursionId}', '${b.id}')" class="w-full py-3.5 rounded-2xl font-bold border border-violet-400/40 text-violet-500 mb-2"><i class="fa-solid fa-pen"></i> ${t('writeReviewBtn')}</button>` : '')) : ''}
        ${b.status === 'completed' ? `<button onclick="downloadVoucher('${b.id}', this)" class="btn-outline-violet w-full py-4 rounded-2xl font-bold mt-2"><i class="fa-solid fa-file-pdf"></i> ${voucherLabels().dl}</button><button onclick="resendVoucher('${b.id}')" class="w-full py-3 text-xs font-bold opacity-70">${voucherLabels().em}</button>` : ''}
        ${isUpcoming ? `<button onclick="cancelBooking('${b.id}')" class="w-full py-4 rounded-2xl font-bold text-red-500 border border-red-400/30 mt-2">${t('cancelBookingBtn')}</button>` : ''}
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0,0);
}

// Raw direction/type values are stored in English in the booking record
// (backend/admin consistency); this maps them to a display string only,
// at render time, so the stored value itself never changes.
function directionLabel(dir) { return dir === 'Airport to Hotel' ? t('directionAirportToHotel') : t('directionHotelToAirport'); }

function bookingDetailBody(b) {
  const paymentLabel = b.payment === 'instapay' ? t('paymentInstapayWallet') : t('paymentCreditDebitCard');
  const paymentRow = `<div class="flex justify-between"><span>${t('paymentLabel')}</span><span>${paymentLabel}</span></div>`;
  if (b.type === 'excursion') return `<div class="card rounded-2xl p-3 flex gap-3 mb-4"><img alt="" src="${b.image}" class="w-16 h-16 rounded-xl object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'"><div><h3 class="font-display font-bold text-sm">${b.title}</h3><p class="text-[11px]">${b.category}</p></div></div><div class="space-y-3 text-sm mb-4"><div class="flex justify-between"><span>${t('dateLabel')}</span><span>${utils.formatDate(b.date)}</span></div><div class="flex justify-between"><span>${t('participantsLabel')}</span><span>${b.participants}</span></div>${paymentRow}</div><div class="border-t pt-3 flex justify-between mb-4"><span class="font-bold">${t('totalLabel')}</span><span class="font-bold text-violet-500">${b.priceFormatted}</span></div><div class="field-box rounded-xl p-3 flex items-center justify-between mb-2"><span>${t('bookingIdLabel2')}</span><span class="font-bold">${b.id}</span></div>`;
  if (b.type === 'transfer') return `<div class="card rounded-2xl p-3 flex gap-3 mb-4"><div class="w-16 h-16 rounded-xl bg-violet-50 flex items-center justify-center"><i class="fa-solid fa-shuttle-van text-violet-600 text-xl"></i></div><div><h3 class="font-display font-bold text-sm">${b.vehicleType} ${t('transferSuffix')}</h3><p class="text-[11px]">${directionLabel(b.direction)}</p></div></div><div class="space-y-3 text-sm mb-4"><div class="flex justify-between"><span>${t('dateLabel')}</span><span>${utils.formatDate(b.date)}</span></div><div class="flex justify-between"><span>${t('timeLabel')}</span><span>${b.time}</span></div><div class="flex justify-between"><span>${t('flightNoLabel')}</span><span>${b.flightNo || '—'}</span></div><div class="flex justify-between"><span>${t('pickupDropoffLabel')}</span><span class="text-right max-w-[60%]">${b.address}</span></div><div class="flex justify-between"><span>${t('passengersLabel')}</span><span>${b.passengers}</span></div>${paymentRow}</div><div class="border-t pt-3 flex justify-between mb-4"><span class="font-bold">${t('totalLabel')}</span><span class="font-bold text-violet-500">${b.priceFormatted}</span></div><div class="field-box rounded-xl p-3 flex items-center justify-between mb-2"><span>${t('bookingIdLabel2')}</span><span class="font-bold">${b.id}</span></div>`;
  return `<div class="card rounded-2xl p-3 flex gap-3 mb-4"><img alt="" src="${b.image}" class="w-16 h-16 rounded-xl object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'"><div><h3 class="font-display font-bold text-sm">${b.hotelName}</h3><div class="flex items-center gap-1 mb-1">${utils.renderStars(b.rating)}</div><p class="text-[10px]">${b.location}</p></div></div><div class="space-y-3 text-sm mb-4"><div class="flex justify-between"><span>${t('checkinLabel')}</span><span>${utils.formatDate(b.checkin)}</span></div><div class="flex justify-between"><span>${t('checkoutLabel')}</span><span>${utils.formatDate(b.checkout)}</span></div><div class="flex justify-between"><span>${t('guests')}</span><span>${b.guests} ${t('guestsCountSuffix')}, ${b.rooms} ${t('roomsCountSuffix')}</span></div><div class="flex justify-between"><span>${t('roomTypeLabel')}</span><span>${b.roomType}</span></div>${b.requests ? `<div class="flex justify-between"><span>${t('requestsLabel')}</span><span class="text-right max-w-[60%]">${b.requests}</span></div>` : ''}${paymentRow}</div><div class="border-t pt-3 flex justify-between mb-4"><span class="font-bold">${t('totalLabel')}</span><span class="font-bold text-violet-500">${b.priceFormatted}</span></div><div class="field-box rounded-xl p-3 flex items-center justify-between mb-2"><span>${t('bookingIdLabel2')}</span><span class="font-bold">${b.id}</span></div>`;
}
function closeBookingDetails() { const p = document.getElementById('bookingDetailsPage'); if (p) p.remove(); nav.go('bookings'); }
async function cancelBooking(bookingId) { const ok = await confirmDialog({ title: t('cancelBookingTitle'), body: t('cancelBookingBody'), confirmLabel: t('cancelBookingConfirm'), cancelLabel: t('cancelBookingKeep'), danger: true }); if (!ok) return; try { await apiFetch(`/api/hotels/booking/${bookingId}`, { method: 'DELETE' }); toast(t('bookingCancelledMsg'), 'info'); bookings.load(); closeBookingDetails(); } catch (e) { console.error(e); toast(t('cancellationFailedMsg'), 'error'); } }

// ==================== VOUCHER (PDF) ====================
// The confirmation e-mail + PDF voucher are sent by the notifications worker as soon as the payment is confirmed.
function voucherLabels() {
  return (typeof I18N !== 'undefined' && I18N.get && I18N.get() === 'ar')
    ? { dl: 'تحميل الفاوتشر (PDF)', em: 'ابعتلي الفاوتشر على الإيميل تاني', ok: 'اتبعت على إيميلك ✔', sent: 'بعتنالك تأكيد الحجز والفاوتشر على الإيميل' }
    : { dl: 'Download voucher (PDF)', em: 'Email me the voucher again', ok: 'Voucher sent to your e-mail ✔', sent: 'A confirmation e-mail with your voucher is on its way' };
}
async function downloadVoucher(id, btn) {
  try { if (btn) btn.disabled = true; const r = await apiFetch('/api/notify/voucher-link', { method: 'POST', body: JSON.stringify({ orderId: id }) }); window.open(r.pdf, '_blank'); }
  catch (e) { toast(e.message, 'error'); } finally { if (btn) btn.disabled = false; }
}
async function resendVoucher(id) {
  try { await apiFetch('/api/notify/resend', { method: 'POST', body: JSON.stringify({ orderId: id }) }); toast(voucherLabels().ok, 'success'); }
  catch (e) { toast(e.message, 'error'); }
}
window.downloadVoucher = downloadVoucher; window.resendVoucher = resendVoucher;

// ==================== EXPOSE GLOBALLY ====================
window.showDestinationPage = showDestinationPage;
window.showRestaurantPage = showRestaurantPage;
window.showArticlePage = showArticlePage;
window.showHotelPage = showHotelPage;
window.showExcursionPage = showExcursionPage;
window.showBookingDetails = showBookingDetails;
window.closeDestinationPage = closeDestinationPage;
window.closeRestaurantPage = closeRestaurantPage;
window.closeArticlePage = closeArticlePage;
window.closeHotelPage = closeHotelPage;
window.closeExcursionPage = closeExcursionPage;
window.startTransferBooking = startTransferBooking;
window.startExcursionBooking = startExcursionBooking;
window.startBooking = startBooking;
