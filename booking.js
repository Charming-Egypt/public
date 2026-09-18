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
      ${(i === shown.length - 1 && remaining > 0) ? `<div class="photo-grid-more"><i class="fa-solid fa-images"></i> +${remaining} Photos</div>` : ''}
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
    toast('Message sent — we\'ll get back to you soon!', 'success');
    e.target.reset();
  } catch (err) {
    toast(err.message || 'Could not send your message', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Message'; }
  }
}

const partnerDocSlots = [
  { key: 'commercialRegistration', label: 'Commercial Registration' },
  { key: 'taxCard', label: 'Tax Card' },
  { key: 'ownerId', label: 'Owner / Manager ID' },
  { key: 'license', label: 'Tourism License (if applicable)' }
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
          : `<button type="button" class="partner-doc-empty" onclick="document.getElementById('partnerDoc_${slot.key}').click()"><i class="fa-solid fa-cloud-arrow-up"></i> Upload</button>`}
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
    toast(err.message || 'Could not submit your application', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Application'; }
  }
}

function renderJournalPage() {
  const grid = document.getElementById('journalGrid');
  if (!grid) return;
  grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-28';
  const countEl = document.getElementById('journalCount'); if (countEl) countEl.textContent = (CATALOG.articles || []).length;
  if (!CATALOG.articles || !CATALOG.articles.length) { grid.innerHTML = '<p class="text-center py-16" style="color:var(--text-secondary)">No stories yet — check back soon</p>'; return; }
  grid.innerHTML = CATALOG.articles.map(a => `
    <div onclick="showArticlePage('${a.id}')" class="article-card cursor-pointer">
      <img src="${getImageUrl(a.image)}" class="article-card-img" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
      <div class="article-card-body">
        <p class="font-display font-bold text-base mb-1 leading-snug line-clamp-2" style="color:var(--text-primary)">${a.title}</p>
        <p class="text-xs mb-2 line-clamp-2" style="color:var(--text-secondary)">${a.excerpt}</p>
        <p class="text-[10px]" style="color:var(--text-secondary)"><i class="fa-regular fa-clock"></i> ${a.readTimeMinutes} min read</p>
      </div>
    </div>`).join('');
}

function paymentMethodsBlock(currentMethod, onchangeFn) {
  const methods = [
    { id: 'card', label: 'Credit/Debit Card', icon: 'fa-credit-card' },
    { id: 'instapay', label: 'InstaPay / Wallet', icon: 'fa-wallet' },
  ];
  return methods.map(m => `
    <label class="card rounded-2xl p-3.5 flex items-center gap-3 cursor-pointer ${currentMethod === m.id ? 'ring-1 ring-violet-400' : ''}">
      <input type="radio" name="paymethod" value="${m.id}" ${currentMethod === m.id ? 'checked' : ''} onchange="${onchangeFn}('${m.id}')" class="w-4 h-4 accent-violet-600">
      <i class="fa-solid ${m.icon} text-violet-500 text-lg w-6 text-center"></i>
      <span class="flex-1 text-sm font-semibold">${m.label}</span>
    </label>`).join('');
}

function redirectToKashier(kashierUrl, orderId, bookingType) {
  // Full-page redirect instead of an embedded iframe modal — payment
  // gateways routinely block being framed, and a real page is also just a
  // more trustworthy checkout experience. Kashier sends the browser back to
  // merchantRedirect afterward; we stash enough here to pick up where we
  // left off and show the right confirmation once that happens.
  localStorage.setItem('ds_pending_payment', JSON.stringify({ orderId, bookingType, startedAt: Date.now() }));
  window.location.href = kashierUrl;
}

// Called once on startup (see the DOMContentLoaded handler in frontend.js).
// If we're returning from Kashier's hosted checkout, look up what actually
// happened to that order server-side (the webhook is the source of truth,
// not anything in the redirect URL) and show the right screen.
async function handleKashierReturn() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('kashier_callback')) return;
  history.replaceState({}, '', window.location.pathname);

  const pendingRaw = localStorage.getItem('ds_pending_payment');
  localStorage.removeItem('ds_pending_payment');
  if (!pendingRaw) return;
  const pending = JSON.parse(pendingRaw);

  const overlay = document.createElement('div');
  overlay.id = 'paymentReturnOverlay';
  overlay.className = 'fixed inset-0 z-[999] flex items-center justify-center dark-scene';
  overlay.innerHTML = `<div class="text-center text-white"><i class="fa-solid fa-circle-notch fa-spin text-3xl mb-3"></i><p class="text-sm">Confirming your payment…</p></div>`;
  document.body.appendChild(overlay);

  // The webhook can land a beat after the browser redirect does, so poll
  // briefly rather than trusting the very first check.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await apiFetch('/api/user/bookings');
      const booking = (res.bookings || []).find(b => b.id === pending.orderId);
      if (booking && booking.status === 'completed') {
        overlay.remove();
        state.bookings.unshift(booking);
        renderBookingConfirmation(booking);
        return;
      }
      if (booking && booking.status === 'failed') {
        overlay.remove();
        toast('Payment was not completed', 'error');
        nav.go('bookings');
        return;
      }
    } catch (e) { /* try again */ }
    await new Promise(r => setTimeout(r, 1500));
  }
  overlay.remove();
  toast('Still confirming your payment — check My Bookings shortly', 'info');
  nav.go('bookings');
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
          <h2 class="font-display text-2xl font-bold text-white mb-1">Booking Confirmed!</h2>
          <p class="text-white/60 text-sm">Payment received.</p>
        </div>
      </div>
      <div class="relative z-10 rounded-t-[28px] mt-4 p-5" style="background:var(--bg-card)">
        <div class="card rounded-2xl p-3 flex gap-3 mb-4">
          <img src="${b.image}" class="w-16 h-16 rounded-xl object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
          <div><h3 class="font-display font-bold">${b.hotelName || b.title || b.vehicleType}</h3><p class="text-[10px]">${b.roomType || b.category || ''}</p></div>
        </div>
        <div class="flex justify-between mb-2"><span>Booking ID</span><span class="font-bold">${b.id}</span></div>
        <div class="flex justify-between mb-2"><span>Check-in</span><span>${utils.formatDate(b.checkin || b.date)}</span></div>
        <div class="flex justify-between mb-4"><span>Total</span><span class="font-bold text-violet-500">${b.priceFormatted}</span></div>
        <button onclick="finishBooking('bookings')" class="btn-violet w-full py-4 rounded-2xl font-bold mb-3">View My Bookings</button>
        <button onclick="finishBooking('home')" class="btn-outline-violet w-full py-4 rounded-2xl font-bold">Back to Home</button>
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
  if (!h) return toast('Hotel not found', 'error');
  state.currentHotel = h;
  const old = document.getElementById('hotelDetailPage'); if (old) old.remove();
  const page = document.createElement('div');
  page.id = 'hotelDetailPage';
  page.className = 'page';
  const startPrice = (h.rooms && h.rooms[0] ? h.rooms[0].price : h.price);
  const bookingCard = `
    <div class="detail-price-row">
      <div><p class="text-[9px] tracking-wider mb-0.5 font-semibold">SELECTED ROOM</p><p class="text-xl font-bold text-violet-500 font-display detail-sidebar-price">${utils.formatPrice(startPrice)}<span class="text-xs"> / Night</span></p></div>
      <div class="detail-sidebar-rating"><i class="fa-solid fa-star text-gold-400"></i> ${Number(h.rating).toFixed(1)} <span>(${h.reviews})</span></div>
    </div>
    <button onclick="startBooking('${h.id}', 0)" class="btn-gold w-full py-3.5 rounded-2xl font-bold text-ink-900 detail-book-btn">Book Now</button>
    <p class="detail-sidebar-note"><i class="fa-solid fa-location-dot"></i> ${h.location}</p>`;
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-80 detail-gallery">
        <div id="hotelGallery" class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onGalleryScroll(this)">
          ${(h.images || [h.image]).map((img, i) => `<img src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%" onclick="openLightbox(${i})">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none"></div>
        <button onclick="closeHotelPage()" class="absolute top-4 right-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900 z-10"><i class="fa-solid fa-arrow-right"></i></button>
        <button onclick="favorites.toggle('${h.id}')" class="absolute top-4 left-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg z-10"><i class="fa-${state.favorites.includes(h.id) ? 'solid text-red-500' : 'regular text-ink-900'} fa-heart"></i></button>
        ${h.bestseller ? '<div class="absolute top-4 left-1/2 -translate-x-1/2 badge-bestseller px-3 py-1 rounded-full text-[10px] font-black">BEST SELLER</div>' : ''}
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="galleryDots">${(h.images || [h.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      ${renderPhotoGrid(h.images || [h.image])}
      <div class="detail-layout">
        <div class="detail-main relative -mt-6 rounded-t-[28px] p-5 space-y-6 pb-32" style="background:var(--bg-card)">
        <div>
          <p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">— ${(h.category || '').toUpperCase()} HOTEL</p>
          <h2 class="font-display text-2xl font-bold mb-1 leading-tight">${h.name}</h2>
          <div class="flex items-center gap-2 text-sm mb-1">${utils.renderStars(h.rating)}<span class="text-xs">${Number(h.rating).toFixed(1)} (${h.reviews} reviews)</span></div>
          <p class="text-xs flex items-center gap-1"><i class="fa-solid fa-location-dot text-violet-500"></i>${h.location}</p>
        </div>
        <div class="grid grid-cols-3 lg:grid-cols-6 gap-2">
          ${(h.amenities || []).slice(0, 6).map(a => `<div class="field-box rounded-xl p-2.5 flex flex-col items-center gap-1.5 text-center"><i class="fa-solid ${amenityIcon(a)} text-violet-500"></i><span class="text-[9px] leading-tight">${a}</span></div>`).join('')}
        </div>
        <div>
          <p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">— ABOUT</p>
          <h3 class="font-display text-lg font-bold mb-2">About this hotel</h3>
          <p class="text-sm leading-relaxed">${h.fullDescription || h.description || ''}</p>
        </div>
        <div>
          <p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">— ROOMS</p>
          <h3 class="font-display text-lg font-bold mb-3">Room Options</h3>
          <div class="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0" id="hotelRoomsList">
            ${(h.rooms || []).map((r, i) => `
              <div class="card room-option-card rounded-2xl p-3 flex gap-3 cursor-pointer ${i === 0 ? 'room-selected' : ''}" onclick="selectRoomOnDetail('${h.id}', ${i})">
                <img src="${getImageUrl(r.image)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-24 h-24 rounded-xl object-cover flex-shrink-0">
                <div class="flex-1 flex flex-col justify-between">
                  <div>
                    <h4 class="font-display font-bold text-sm mb-1">${r.type}</h4>
                    <div class="flex items-center gap-2 text-[10px] mb-1"><span><i class="fa-solid fa-user-group"></i>${r.guests || 2}</span><span><i class="fa-solid fa-ruler-combined"></i>${r.size || '25m²'}</span></div>
                    <p class="text-[10px]"><i class="fa-solid fa-bed"></i>${r.beds || '1 Queen Bed'}</p>
                  </div>
                  <div class="flex items-center justify-between">
                    <p class="font-display font-bold text-violet-500 text-lg">${utils.formatPrice(r.price)}<span class="text-[10px]"> /Night</span></p>
                    <span class="text-[10px] font-bold text-violet-500"><i class="fa-solid fa-circle-check"></i> Selected</span>
                  </div>
                </div>
              </div>`).join('')}
          </div>
        </div>
        <div class="card rounded-2xl p-4">
          <h3 class="font-display text-lg font-bold mb-4">Real Stories From Our Guests</h3>
          <div class="rating-summary-block">
            <div class="rating-summary-score">
              <p class="rating-summary-number" id="hotelRatingSummary">–</p>
              <div class="text-gold-500 text-sm" id="hotelRatingStars"></div>
              <p class="rating-summary-count" id="hotelRatingCount"></p>
            </div>
            <div class="rating-bar-chart" id="hotelRatingBars"></div>
          </div>
          <button onclick="reviews.openModal('hotel','${h.id}')" class="w-full py-2.5 rounded-xl text-xs font-bold border border-violet-400/40 text-violet-500 mb-3 mt-4"><i class="fa-solid fa-pen"></i> Write a Review</button>
          <div class="space-y-3" id="hotelReviewsList"></div>
        </div>
        </div>
        <aside class="detail-sidebar">
          <div class="detail-sidebar-card">${bookingCard}</div>
        </aside>
      </div>
      <div class="fixed bottom-0 left-0 right-0 max-w-md mx-auto backdrop-blur-xl border-t p-4 flex items-center justify-between z-10 detail-mobile-bar" style="background:var(--bg-card); border-color:var(--border-card)">
        <div><p class="text-[9px] tracking-wider mb-0.5 font-semibold">SELECTED ROOM</p><p class="text-xl font-bold text-violet-500 font-display detail-sidebar-price" id="hotelBottomPriceAmount">${utils.formatPrice(startPrice)}<span class="text-xs"> / Night</span></p></div>
        <button onclick="startBooking('${h.id}', 0)" class="btn-gold px-7 py-3 rounded-2xl font-bold text-ink-900 detail-book-btn">Book Now</button>
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
  document.querySelectorAll('#hotelDetailPage .detail-sidebar-price').forEach(el => { el.innerHTML = `${utils.formatPrice(r.price)}<span class="text-xs"> / Night</span>`; });
  document.querySelectorAll('#hotelDetailPage .detail-book-btn').forEach(btn => btn.setAttribute('onclick', `startBooking('${hotelId}', ${roomIndex})`));
  document.querySelectorAll('#hotelRoomsList .room-option-card').forEach((card, i) => card.classList.toggle('room-selected', i === roomIndex));
}

function startBooking(hotelId, roomIndex) {
  if (!authToken) { toast('Please login to book', 'error'); return; }
  const h = CATALOG.hotels.find(x => x.id === hotelId);
  const r = h?.rooms?.[roomIndex];
  if (!h || !r) return;
  state.currentHotel = h;
  state.currentRoom = r;
  state.bookingDraft = {
    name: currentUser?.displayName || currentUser?.name || '',
    email: currentUser?.email || '',
    phone: (currentUser?.countryCode || '') + (currentUser?.phone || ''),
    requests: '',
    payment: 'card',
    checkin: document.getElementById('checkinDate')?.dataset.value || utils.addDays(utils.todayIso(),1),
    checkout: document.getElementById('checkoutDate')?.dataset.value || utils.addDays(utils.todayIso(),3),
  };
  renderBookingStep(2);
}

function renderBookingStep(step) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  ['bookingFlowPage','hotelDetailPage'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  const h = state.currentHotel, r = state.currentRoom;
  const nights = Math.max(1, Math.round((new Date(state.bookingDraft.checkout) - new Date(state.bookingDraft.checkin)) / 86400000));
  const pricing = computeRoomPricing(r, state.guests, state.guests.rooms, nights);
  const total = pricing.roomTotal + Math.round(pricing.roomTotal * 0.1);
  const page = document.createElement('div'); page.id = 'bookingFlowPage'; page.className = 'page';
  const orderSummaryCard = `
    <div class="booking-summary-card">
      <div class="flex gap-3 pb-4 mb-4" style="border-bottom:1px solid var(--border-card)">
        <img src="${getImageUrl(h.image)}" class="w-16 h-16 rounded-xl object-cover flex-shrink-0" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <div><h3 class="font-display font-bold text-sm">${h.name}</h3><p class="text-[11px]" style="color:var(--text-secondary)">${r.type}</p></div>
      </div>
      <div class="booking-summary-row"><span>Check-in</span><span>${utils.formatDate(state.bookingDraft.checkin)}</span></div>
      <div class="booking-summary-row"><span>Check-out</span><span>${utils.formatDate(state.bookingDraft.checkout)}</span></div>
      <div class="booking-summary-row"><span>${r.type} × ${state.guests.rooms} room(s)</span><span>${utils.formatPrice(pricing.baseRoomTotal)}</span></div>
      <div class="booking-summary-row"><span>Taxes & Fees</span><span>${utils.formatPrice(Math.round(pricing.roomTotal * 0.1))}</span></div>
      <div class="booking-summary-total"><span>Total</span><span>${utils.formatPrice(total)}</span></div>
    </div>`;
  let bodyHtml = '';
  if (step === 2) {
    bodyHtml = `
      <div class="p-5 booking-step-main">
        <div class="booking-guest-card">
          <p class="booking-guest-label"><i class="fa-solid fa-circle-user"></i> Booking For</p>
          <p class="booking-guest-name">${esc(state.bookingDraft.name || 'Guest')}</p>
          <p class="booking-guest-line">${esc(state.bookingDraft.email || '')}${state.bookingDraft.phone ? ' · ' + esc(state.bookingDraft.phone) : ''}</p>
        </div>
        <h3 class="font-display text-lg font-bold mb-3">Stay Dates</h3>
        <form onsubmit="submitGuestDetails(event)" class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div id="bkCheckin" class="date-field p-3" data-date-field="bkCheckin" data-value="${state.bookingDraft.checkin}">
              <label class="text-[10px]">Check-in</label>
              <span class="date-field-value text-sm">${utils.formatDate(state.bookingDraft.checkin)}</span>
            </div>
            <div id="bkCheckout" class="date-field p-3" data-date-field="bkCheckout" data-value="${state.bookingDraft.checkout}">
              <label class="text-[10px]">Check-out</label>
              <span class="date-field-value text-sm">${utils.formatDate(state.bookingDraft.checkout)}</span>
            </div>
          </div>
          <textarea id="bkRequests" rows="2" placeholder="Special requests (optional)" class="input-field w-full px-3 py-2.5 text-sm">${state.bookingDraft.requests || ''}</textarea>
          <button type="submit" class="btn-violet w-full py-4 rounded-2xl font-bold">Continue</button>
        </form>
      </div>
      <div class="booking-step-side">${orderSummaryCard}</div>`;
  } else if (step === 3) {
    bodyHtml = `
      <div class="p-5 booking-step-main">
        <h3 class="font-display text-lg font-bold mb-3">Payment Method</h3>
        <div class="space-y-3 mb-5">${paymentMethodsBlock(state.bookingDraft.payment, 'setHotelPaymentMethod')}</div>
        <button onclick="payAndConfirmHotelBooking(${pricing.roomTotal}, ${Math.round(pricing.roomTotal * 0.1)}, ${total}, ${nights})" id="hotelPayBtn" class="btn-violet w-full py-4 rounded-2xl font-bold">Pay Now</button>
      </div>
      <div class="booking-step-side">${orderSummaryCard}</div>`;
  }
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-body)">
      <div class="dark-scene px-5 pt-6 pb-6 relative overflow-hidden">
        <div class="stars-container"></div>
        <div class="relative z-10 booking-header-inner">
          <div class="flex items-center gap-3 mb-5">
            <button onclick="${step === 2 ? 'closeBookingFlow()' : 'renderBookingStep(2)'}" class="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white"><i class="fa-solid fa-arrow-right"></i></button>
            <h1 class="text-lg font-bold font-display text-white">${step === 2 ? 'Booking Details' : 'Payment'}</h1>
          </div>
          ${utils.stepIndicator(step, ['Select Room', 'Guest Details', 'Payment'])}
        </div>
      </div>
      <div class="booking-step-layout">${bodyHtml}</div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  page.classList.add('active'); window.scrollTo(0,0);
}

function setHotelPaymentMethod(m) { state.bookingDraft.payment = m; renderBookingStep(3); }
function closeBookingFlow() { const p = document.getElementById('bookingFlowPage'); if (p) p.remove(); showHotelPage(state.currentHotel.id); }
function submitGuestDetails(e) { e.preventDefault(); state.bookingDraft.checkin = document.getElementById('bkCheckin').dataset.value; state.bookingDraft.checkout = document.getElementById('bkCheckout').dataset.value; state.bookingDraft.requests = document.getElementById('bkRequests').value; renderBookingStep(3); }
function computeRoomPricing(room, guests, roomsCount, nights) { const baseOcc = room.baseOccupancy || 2; const freeChildren = room.freeChildrenPerRoom ?? 2; const extraAdultFee = room.extraAdultFee || 0; const extraChildFee = room.extraChildFee || 0; const adultsPerRoom = Math.ceil(guests.adults / roomsCount); const childrenPerRoom = Math.ceil(guests.children / roomsCount); const extraAdults = Math.max(0, adultsPerRoom - baseOcc); const extraChildren = Math.max(0, childrenPerRoom - freeChildren); const perRoomPerNight = room.price + (extraAdults * extraAdultFee) + (extraChildren * extraChildFee); return { roomTotal: perRoomPerNight * roomsCount * nights, extraFeesTotal: (extraAdults * extraAdultFee + extraChildren * extraChildFee) * roomsCount * nights, baseRoomTotal: room.price * roomsCount * nights }; }

async function payAndConfirmHotelBooking(roomTotal, taxes, total, nights) {
  if (!authToken) { toast('Please login to book', 'error'); return; }
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
      rooms: state.guests.rooms,
      roomType: state.currentRoom.type,
      nights,
      payment: state.bookingDraft.payment,
      total,
      currency: 'EGP',
      priceFormatted: utils.formatPrice(total),
      status: 'pending_payment',
      reviewed: false,
      createdAt: new Date().toISOString(),
    };

    const saveRes = await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });
    const hashData = await apiFetch('/api/kashier/hash', { method: 'POST', body: JSON.stringify({ orderId, amount: total, currency: 'EGP' }) });
    const kashierUrl = new URL('https://checkout.kashier.io/');
    kashierUrl.searchParams.append('merchantId', hashData.merchantId);
    kashierUrl.searchParams.append('orderId', orderId);
    kashierUrl.searchParams.append('amount', total);
    kashierUrl.searchParams.append('currency', hashData.currency || 'EGP');
    kashierUrl.searchParams.append('hash', hashData.hash);
    kashierUrl.searchParams.append('mode', KASHIER_MODE);
    kashierUrl.searchParams.append('paymentMethods', state.bookingDraft.payment === 'instapay' ? 'wallet' : 'card');
    kashierUrl.searchParams.append('merchantRedirect', window.location.href.split('?')[0] + '?kashier_callback=1');

    redirectToKashier(kashierUrl.toString(), orderId, 'hotel');
    btn.disabled = false; btn.innerHTML = 'Pay Now';
  } catch (e) {
    toast('Payment error: ' + e.message, 'error');
    btn.disabled = false; btn.innerHTML = 'Pay Now';
  }
}

// ==================== EXCURSION DETAILS & BOOKING ====================
function showExcursionPage(excursionId, opts = {}) {
  const x = CATALOG.excursions.find(i => i.id === excursionId);
  if (!x) return toast('Excursion not found', 'error');
  state.currentExcursion = x;
  const old = document.getElementById('excursionDetailPage'); if (old) old.remove();
  const page = document.createElement('div'); page.id = 'excursionDetailPage'; page.className = 'page';
  const bookingCard = `
    <div class="detail-price-row">
      <div><p class="text-[9px]">FROM</p><p class="text-xl font-bold text-violet-500 font-display">${utils.formatPrice(x.price)}<span class="text-xs">/person</span></p></div>
      <div class="detail-sidebar-rating"><i class="fa-solid fa-star text-gold-400"></i> ${Number(x.rating).toFixed(1)} <span>(${x.reviews})</span></div>
    </div>
    <button onclick="startExcursionBooking('${x.id}')" class="btn-gold w-full py-3.5 rounded-2xl font-bold text-ink-900">Book Now</button>
    <p class="detail-sidebar-note"><i class="fa-regular fa-clock"></i> ${x.duration} · <i class="fa-solid fa-location-dot"></i> ${x.meetingPoint || ''}</p>`;
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-72 detail-gallery">
        <div id="excursionGallery" class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onExcursionGalleryScroll(this)">
          ${(x.images || [x.image]).map((img, i) => `<img src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%" onclick="openLightbox(${i})">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none"></div>
        <button onclick="closeExcursionPage()" class="absolute top-4 right-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900 z-10"><i class="fa-solid fa-arrow-right"></i></button>
        <div class="absolute top-4 left-4 bg-violet-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full z-10">${x.category}</div>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="excursionGalleryDots">${(x.images || [x.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      ${renderPhotoGrid(x.images || [x.image])}
      <div class="detail-layout">
        <div class="detail-main relative -mt-6 rounded-t-[28px] p-5 space-y-6 pb-32" style="background:var(--bg-card)">
        <div>
          <h2 class="font-display text-2xl font-bold mb-1 leading-tight">${x.title}</h2>
          <div class="flex items-center gap-2 text-sm mb-1">${utils.renderStars(x.rating)}<span class="text-xs">${Number(x.rating).toFixed(1)} (${x.reviews} reviews)</span></div>
          <p class="text-xs"><i class="fa-regular fa-clock text-violet-500"></i>${x.duration} · <i class="fa-solid fa-location-dot text-violet-500"></i>${x.meetingPoint || ''}</p>
        </div>

        <!-- Trust badges -->
        <div class="trust-badge-row">
          <div class="trust-badge"><i class="fa-solid fa-star"></i><span>${Number(x.rating).toFixed(1)} Rating</span></div>
          <div class="trust-badge"><i class="fa-solid fa-rotate-left"></i><span>Free Cancellation</span></div>
          <div class="trust-badge"><i class="fa-solid fa-bolt"></i><span>Instant Confirmation</span></div>
          <div class="trust-badge"><i class="fa-solid fa-shield-heart"></i><span>Secure Booking</span></div>
        </div>

        <div>
          <h3 class="font-display text-lg font-bold mb-2">Overview</h3>
          <p class="text-sm leading-relaxed">${x.fullDescription || x.description}</p>
        </div>

        ${(x.includes || []).length ? `
        <div>
          <h3 class="font-display text-lg font-bold mb-3">What This Trip Offers</h3>
          <div class="highlight-grid">
            ${x.includes.map((i, n) => `
              <div class="highlight-item">
                <span class="highlight-num">${String(n + 1).padStart(2, '0')}</span>
                <span>${i}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

        <div>
          <h3 class="font-display text-lg font-bold mb-3">Prices &amp; Inclusions</h3>
          <div class="inclusion-cards">
            <div class="inclusion-card inclusion-card-in">
              <p class="inclusion-card-title"><i class="fa-solid fa-circle-check"></i> Included</p>
              ${(x.includes || []).map(i => `<div class="inclusion-row"><i class="fa-solid fa-check"></i>${i}</div>`).join('')}
            </div>
            ${(x.excludes || []).length ? `
            <div class="inclusion-card inclusion-card-out">
              <p class="inclusion-card-title"><i class="fa-solid fa-circle-xmark"></i> Not Included</p>
              ${x.excludes.map(i => `<div class="inclusion-row"><i class="fa-solid fa-xmark"></i>${i}</div>`).join('')}
            </div>` : ''}
          </div>
        </div>

        ${(x.whatToBring || []).length ? `
          <div>
            <h3 class="font-display text-lg font-bold mb-3">What to Bring</h3>
            <div class="bring-chip-row">${x.whatToBring.map(i => `<div class="bring-chip"><i class="fa-solid fa-suitcase-rolling"></i>${i}</div>`).join('')}</div>
          </div>` : ''}

        <!-- Meeting point & schedule -->
        <div class="meeting-card">
          <div class="meeting-card-row">
            <div class="meeting-card-icon"><i class="fa-solid fa-location-dot"></i></div>
            <div><p class="meeting-card-label">Meeting Point</p><p class="meeting-card-value">${x.meetingPoint || 'Hotel lobby pickup'}</p></div>
          </div>
          <div class="meeting-card-divider"></div>
          <div class="meeting-card-row">
            <div class="meeting-card-icon"><i class="fa-regular fa-clock"></i></div>
            <div><p class="meeting-card-label">Schedule</p><p class="meeting-card-value">${x.duration || ''} · Daily</p></div>
          </div>
        </div>

        ${(x.itinerary || []).length ? `
          <div>
            <h3 class="font-display text-lg font-bold mb-3">Trip Itinerary</h3>
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
          <h3 class="font-display text-lg font-bold mb-4">Real Stories From Our Travelers</h3>
          <div class="rating-summary-block">
            <div class="rating-summary-score">
              <p class="rating-summary-number" id="excursionRatingSummary">–</p>
              <div class="text-gold-500 text-sm" id="excursionRatingStars"></div>
              <p class="rating-summary-count" id="excursionRatingCount"></p>
            </div>
            <div class="rating-bar-chart" id="excursionRatingBars"></div>
          </div>
          <button onclick="reviews.openModal('excursion','${x.id}')" class="w-full py-2.5 rounded-xl text-xs font-bold border border-violet-400/40 text-violet-500 mb-3 mt-4">Write a Review</button>
          <div class="space-y-3" id="excursionReviewsList"></div>
        </div>
        </div>
        <aside class="detail-sidebar">
          <div class="detail-sidebar-card">${bookingCard}</div>
        </aside>
      </div>
      <div class="fixed bottom-0 left-0 right-0 max-w-md mx-auto backdrop-blur-xl border-t p-4 flex items-center justify-between z-10 detail-mobile-bar" style="background:var(--bg-card); border-color:var(--border-card)">
        <div><p class="text-[9px]">FROM</p><p class="text-xl font-bold text-violet-500 font-display">${utils.formatPrice(x.price)}<span class="text-xs">/person</span></p></div>
        <button onclick="startExcursionBooking('${x.id}')" class="btn-gold px-7 py-3 rounded-2xl font-bold text-ink-900">Book Now</button>
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
function onExcursionGalleryScroll(el) { const idx = Math.round(el.scrollLeft / el.clientWidth); document.querySelectorAll('#excursionGalleryDots .gallery-dot').forEach((d, i) => d.classList.toggle('active', i === idx)); }
function startExcursionBooking(id) {
  if (!authToken) { toast('Please login to book', 'error'); return; }
  const x = CATALOG.excursions.find(i => i.id === id);
  if (!x) return;
  state.currentExcursion = x;
  state.bookingDraft = { name: currentUser?.displayName || currentUser?.name || '', email: currentUser?.email || '', phone: (currentUser?.countryCode || '') + (currentUser?.phone || ''), participants: 2, payment: 'card', date: utils.addDays(utils.todayIso(), 1) };
  renderExcursionBookingStep(2);
}

function renderExcursionBookingStep(step) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const existing = document.getElementById('excursionBookingFlowPage'); if (existing) existing.remove();
  const x = state.currentExcursion; const subtotal = x.price * state.bookingDraft.participants; const taxes = Math.round(subtotal * 0.05); const total = subtotal + taxes;
  const page = document.createElement('div'); page.id = 'excursionBookingFlowPage'; page.className = 'page';
  const orderSummaryCard = `
    <div class="booking-summary-card">
      <div class="flex gap-3 pb-4 mb-4" style="border-bottom:1px solid var(--border-card)">
        <img src="${getImageUrl(x.image)}" class="w-16 h-16 rounded-xl object-cover flex-shrink-0" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <div><h3 class="font-display font-bold text-sm">${x.title}</h3><p class="text-[11px]" style="color:var(--text-secondary)">${x.category} · ${x.duration}</p></div>
      </div>
      <div class="booking-summary-row"><span>Date</span><span>${utils.formatDate(state.bookingDraft.date)}</span></div>
      <div class="booking-summary-row"><span>${x.title} × ${state.bookingDraft.participants}</span><span>${utils.formatPrice(subtotal)}</span></div>
      <div class="booking-summary-row"><span>Taxes & Fees</span><span>${utils.formatPrice(taxes)}</span></div>
      <div class="booking-summary-total"><span>Total</span><span>${utils.formatPrice(total)}</span></div>
    </div>`;
  let bodyHtml = '';
  if (step === 2) {
    bodyHtml = `
      <div class="p-5 booking-step-main">
        <div class="booking-guest-card">
          <p class="booking-guest-label"><i class="fa-solid fa-circle-user"></i> Booking For</p>
          <p class="booking-guest-name">${esc(state.bookingDraft.name || 'Guest')}</p>
          <p class="booking-guest-line">${esc(state.bookingDraft.email || '')}${state.bookingDraft.phone ? ' · ' + esc(state.bookingDraft.phone) : ''}</p>
        </div>
        <h3 class="font-display text-lg font-bold mb-3">Trip Details</h3>
        <form onsubmit="submitExcursionDetails(event)" class="space-y-4">
          <div id="ekDate" class="date-field p-3" data-date-field="ekDate" data-value="${state.bookingDraft.date}">
            <label class="text-[10px]">Date</label>
            <span class="date-field-value text-sm">${utils.formatDate(state.bookingDraft.date)}</span>
          </div>
          <div class="field-box rounded-2xl p-3 flex items-center justify-between">
            <div><p class="text-[10px]">Participants</p><p class="text-sm font-semibold" id="ekParticipantsLabel">${state.bookingDraft.participants} People</p></div>
            <div class="flex items-center gap-3">
              <button type="button" class="counter-btn" onclick="adjustParticipants(-1)">-</button>
              <button type="button" class="counter-btn" onclick="adjustParticipants(1)">+</button>
            </div>
          </div>
          <button type="submit" class="btn-violet w-full py-4 rounded-2xl font-bold">Continue</button>
        </form>
      </div>
      <div class="booking-step-side">${orderSummaryCard}</div>`;
  } else if (step === 3) {
    bodyHtml = `
      <div class="p-5 booking-step-main">
        <h3 class="font-display text-lg font-bold mb-3">Payment Method</h3>
        <div class="space-y-3 mb-5">${paymentMethodsBlock(state.bookingDraft.payment, 'setExcursionPaymentMethod')}</div>
        <button onclick="payAndConfirmExcursionBooking(${subtotal}, ${taxes}, ${total})" id="excursionPayBtn" class="btn-violet w-full py-4 rounded-2xl font-bold">Pay Now</button>
        <button onclick="renderExcursionBookingStep(2)" class="w-full text-center text-violet-500 text-sm font-semibold mt-4">Back</button>
      </div>
      <div class="booking-step-side">${orderSummaryCard}</div>`;
  }
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-body)">
      <div class="dark-scene px-5 pt-6 pb-6 relative overflow-hidden">
        <div class="stars-container"></div>
        <div class="relative z-10 booking-header-inner">
          <div class="flex items-center gap-3 mb-5">
            <button onclick="${step === 2 ? 'closeExcursionBookingFlow()' : 'renderExcursionBookingStep(2)'}" class="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white"><i class="fa-solid fa-arrow-right"></i></button>
            <h1 class="text-lg font-bold font-display text-white">${step === 2 ? 'Booking Details' : 'Payment'}</h1>
          </div>
          ${utils.stepIndicator(step, ['Select', 'Details', 'Payment'])}
        </div>
      </div>
      <div class="booking-step-layout">${bodyHtml}</div>
    </div>`;
  document.getElementById('mainApp').appendChild(page); page.classList.add('active'); window.scrollTo(0,0);
}

function setExcursionPaymentMethod(m) { state.bookingDraft.payment = m; renderExcursionBookingStep(3); }
function closeExcursionBookingFlow() { const p = document.getElementById('excursionBookingFlowPage'); if (p) p.remove(); showExcursionPage(state.currentExcursion.id); }
function adjustParticipants(delta) { const newVal = state.bookingDraft.participants + delta; if (newVal >= 1 && newVal <= 15) { state.bookingDraft.participants = newVal; document.getElementById('ekParticipantsLabel').textContent = `${newVal} People`; } }
function submitExcursionDetails(e) { e.preventDefault(); state.bookingDraft.date = document.getElementById('ekDate').dataset.value; renderExcursionBookingStep(3); }

async function payAndConfirmExcursionBooking(subtotal, taxes, total) {
  if (!authToken) { toast('Please login to book', 'error'); return; }
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
      currency: 'EGP',
      priceFormatted: utils.formatPrice(total),
      status: 'pending_payment',
      reviewed: false,
      createdAt: new Date().toISOString(),
    };

    const saveRes = await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });
    const hashData = await apiFetch('/api/kashier/hash', { method: 'POST', body: JSON.stringify({ orderId, amount: total, currency: 'EGP' }) });
    const kashierUrl = new URL('https://checkout.kashier.io/');
    kashierUrl.searchParams.append('merchantId', hashData.merchantId);
    kashierUrl.searchParams.append('orderId', orderId);
    kashierUrl.searchParams.append('amount', total);
    kashierUrl.searchParams.append('currency', hashData.currency || 'EGP');
    kashierUrl.searchParams.append('hash', hashData.hash);
    kashierUrl.searchParams.append('mode', KASHIER_MODE);
    kashierUrl.searchParams.append('paymentMethods', state.bookingDraft.payment === 'instapay' ? 'wallet' : 'card');
    kashierUrl.searchParams.append('merchantRedirect', window.location.href.split('?')[0] + '?kashier_callback=1');

    redirectToKashier(kashierUrl.toString(), orderId, 'excursion');
    btn.disabled = false; btn.innerHTML = 'Pay Now';
  } catch (e) {
    toast('Payment error: ' + e.message, 'error');
    btn.disabled = false; btn.innerHTML = 'Pay Now';
  }
}

// ==================== TRANSFER BOOKING ====================
function startTransferBooking(id) {
  if (!authToken) { toast('Please login to book', 'error'); return; }
  const v = CATALOG.transfers.find(i => i.id === id);
  if (!v) return toast('Transfer not found', 'error');
  state.currentTransfer = v;
  state.bookingDraft = {
    name: currentUser?.displayName || currentUser?.name || '',
    email: currentUser?.email || '',
    phone: (currentUser?.countryCode || '') + (currentUser?.phone || ''),
    direction: 'Airport to Hotel',
    flightNo: '',
    address: '',
    passengers: 2,
    time: '14:00',
    payment: 'card',
    date: utils.addDays(utils.todayIso(), 1),
  };
  renderTransferBookingStep(2);
}

function renderTransferBookingStep(step) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const existing = document.getElementById('transferBookingFlowPage'); if (existing) existing.remove();
  const v = state.currentTransfer;
  const subtotal = v.price;
  const taxes = Math.round(subtotal * 0.05);
  const total = subtotal + taxes;
  const page = document.createElement('div');
  page.id = 'transferBookingFlowPage';
  page.className = 'page';
  const orderSummaryCard = `
    <div class="booking-summary-card">
      <div class="flex gap-3 pb-4 mb-4" style="border-bottom:1px solid var(--border-card)">
        <img src="${getImageUrl(v.image)}" class="w-16 h-16 rounded-xl object-cover flex-shrink-0" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <div><h3 class="font-display font-bold text-sm">${v.vehicleType} Transfer</h3><p class="text-[11px]" style="color:var(--text-secondary)">Up to ${v.capacity} passengers</p></div>
      </div>
      <div class="booking-summary-row"><span>Date</span><span>${utils.formatDate(state.bookingDraft.date)}</span></div>
      <div class="booking-summary-row"><span>Time</span><span>${state.bookingDraft.time}</span></div>
      <div class="booking-summary-row"><span>${v.vehicleType} Transfer</span><span>${utils.formatPrice(subtotal)}</span></div>
      <div class="booking-summary-row"><span>Taxes & Fees</span><span>${utils.formatPrice(taxes)}</span></div>
      <div class="booking-summary-total"><span>Total</span><span>${utils.formatPrice(total)}</span></div>
    </div>`;
  let bodyHtml = '';
  if (step === 2) {
    bodyHtml = `
      <div class="p-5 booking-step-main">
        <div class="booking-guest-card">
          <p class="booking-guest-label"><i class="fa-solid fa-circle-user"></i> Booking For</p>
          <p class="booking-guest-name">${esc(state.bookingDraft.name || 'Guest')}</p>
          <p class="booking-guest-line">${esc(state.bookingDraft.email || '')}${state.bookingDraft.phone ? ' · ' + esc(state.bookingDraft.phone) : ''}</p>
        </div>
        <h3 class="font-display text-lg font-bold mb-3">Transfer Details</h3>
        <form onsubmit="submitTransferDetails(event)" class="space-y-4">
          <div class="field-box p-1 rounded-2xl flex gap-1">
            <button type="button" onclick="setTransferDirection('Airport to Hotel')" id="dirBtnArrival" class="flex-1 py-2.5 rounded-xl text-xs font-bold">Airport Pickup</button>
            <button type="button" onclick="setTransferDirection('Hotel to Airport')" id="dirBtnDeparture" class="flex-1 py-2.5 rounded-xl text-xs font-bold">Airport Drop-off</button>
          </div>
          <input type="text" id="tkFlightNo" value="${state.bookingDraft.flightNo}" placeholder="Flight number (optional)" class="input-field w-full px-3 py-2.5 text-sm">
          <div id="hotelField" class="field-box p-3">
            <label class="text-[10px]">Hotel Name &amp; Address</label>
            <input type="text" id="tkAddress" required value="${state.bookingDraft.address}" placeholder="Hotel name & address" class="input-field w-full px-3 py-2.5 text-sm">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div id="tkDate" class="date-field p-3" data-date-field="tkDate" data-value="${state.bookingDraft.date}">
              <label class="text-[10px]">Date</label>
              <span class="date-field-value text-sm">${utils.formatDate(state.bookingDraft.date)}</span>
            </div>
            <div class="date-field p-3">
              <label class="text-[10px]">Time</label>
              <input type="time" id="tkTime" value="${state.bookingDraft.time}" class="w-full bg-transparent text-sm font-semibold outline-none border-0 p-0">
            </div>
          </div>
          <div class="field-box rounded-2xl p-3 flex items-center justify-between">
            <div><p class="text-[10px]">Passengers</p><p class="text-sm font-semibold" id="tkPassengersLabel">${state.bookingDraft.passengers} People</p></div>
            <div class="flex items-center gap-3">
              <button type="button" class="counter-btn" onclick="adjustTransferPassengers(-1)">-</button>
              <button type="button" class="counter-btn" onclick="adjustTransferPassengers(1)">+</button>
            </div>
          </div>
          <button type="submit" class="btn-violet w-full py-4 rounded-2xl font-bold">Continue</button>
        </form>
      </div>
      <div class="booking-step-side">${orderSummaryCard}</div>`;
  } else if (step === 3) {
    bodyHtml = `
      <div class="p-5 booking-step-main">
        <h3 class="font-display text-lg font-bold mb-3">Payment Method</h3>
        <div class="space-y-3 mb-5">${paymentMethodsBlock(state.bookingDraft.payment, 'setTransferPaymentMethod')}</div>
        <button onclick="payAndConfirmTransferBooking(${subtotal}, ${taxes}, ${total})" id="transferPayBtn" class="btn-violet w-full py-4 rounded-2xl font-bold">Pay Now</button>
        <button onclick="renderTransferBookingStep(2)" class="w-full text-center text-violet-500 text-sm font-semibold mt-4">Back</button>
      </div>
      <div class="booking-step-side">${orderSummaryCard}</div>`;
  }
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-body)">
      <div class="dark-scene px-5 pt-6 pb-6 relative overflow-hidden">
        <div class="stars-container"></div>
        <div class="relative z-10 booking-header-inner">
          <div class="flex items-center gap-3 mb-5">
            <button onclick="${step === 2 ? 'closeTransferBookingFlow()' : 'renderTransferBookingStep(2)'}" class="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white"><i class="fa-solid fa-arrow-right"></i></button>
            <h1 class="text-lg font-bold font-display text-white">${step === 2 ? 'Transfer Details' : 'Payment'}</h1>
          </div>
          ${utils.stepIndicator(step, ['Select', 'Details', 'Payment'])}
        </div>
      </div>
      <div class="booking-step-layout">${bodyHtml}</div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  page.classList.add('active'); window.scrollTo(0,0);
  if (step === 2) setTransferDirection(state.bookingDraft.direction);
}

function setTransferDirection(dir) {
  state.bookingDraft.direction = dir;
  const a = document.getElementById('dirBtnArrival'), d = document.getElementById('dirBtnDeparture');
  if (!a || !d) return;
  a.style.background = dir === 'Airport to Hotel' ? 'linear-gradient(135deg,#fb923c,#c2410c)' : 'transparent';
  a.style.color = dir === 'Airport to Hotel' ? '#fff' : 'var(--text-secondary)';
  d.style.background = dir === 'Hotel to Airport' ? 'linear-gradient(135deg,#fb923c,#c2410c)' : 'transparent';
  d.style.color = dir === 'Hotel to Airport' ? '#fff' : 'var(--text-secondary)';
}

function setTransferPaymentMethod(m) { state.bookingDraft.payment = m; renderTransferBookingStep(3); }
function closeTransferBookingFlow() { const p = document.getElementById('transferBookingFlowPage'); if (p) p.remove(); nav.go('transfers'); }
function adjustTransferPassengers(delta) { const v = state.currentTransfer; const newVal = state.bookingDraft.passengers + delta; if (newVal >= 1 && newVal <= v.capacity) { state.bookingDraft.passengers = newVal; document.getElementById('tkPassengersLabel').textContent = `${newVal} People`; } }
function submitTransferDetails(e) { e.preventDefault(); state.bookingDraft.flightNo = document.getElementById('tkFlightNo').value; state.bookingDraft.address = document.getElementById('tkAddress').value; state.bookingDraft.date = document.getElementById('tkDate').dataset.value; state.bookingDraft.time = document.getElementById('tkTime').value; renderTransferBookingStep(3); }

async function payAndConfirmTransferBooking(subtotal, taxes, total) {
  if (!authToken) { toast('Please login to book', 'error'); return; }
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
      currency: 'EGP',
      priceFormatted: utils.formatPrice(total),
      status: 'pending_payment',
      reviewed: false,
      createdAt: new Date().toISOString(),
    };

    const saveRes = await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });
    const hashData = await apiFetch('/api/kashier/hash', { method: 'POST', body: JSON.stringify({ orderId, amount: total, currency: 'EGP' }) });
    const kashierUrl = new URL('https://checkout.kashier.io/');
    kashierUrl.searchParams.append('merchantId', hashData.merchantId);
    kashierUrl.searchParams.append('orderId', orderId);
    kashierUrl.searchParams.append('amount', total);
    kashierUrl.searchParams.append('currency', hashData.currency || 'EGP');
    kashierUrl.searchParams.append('hash', hashData.hash);
    kashierUrl.searchParams.append('mode', KASHIER_MODE);
    kashierUrl.searchParams.append('paymentMethods', state.bookingDraft.payment === 'instapay' ? 'wallet' : 'card');
    kashierUrl.searchParams.append('merchantRedirect', window.location.href.split('?')[0] + '?kashier_callback=1');

    redirectToKashier(kashierUrl.toString(), orderId, 'transfer');
    btn.disabled = false; btn.innerHTML = 'Pay Now';
  } catch (e) {
    toast('Payment error: ' + e.message, 'error');
    btn.disabled = false; btn.innerHTML = 'Pay Now';
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
    <div class="flex items-center gap-2 mb-4"><span class="lux-cuisine-badge">${r.cuisine}</span><span class="text-gold-500 text-xs font-semibold">${'$'.repeat(r.priceLevel || 2)}</span></div>
    <div class="detail-sidebar-rating mb-4"><i class="fa-solid fa-star text-gold-400"></i> ${Number(r.rating).toFixed(1)} <span>(${r.reviews || 0} reviews)</span></div>
    <div class="detail-sidebar-info-row"><i class="fa-solid fa-location-dot"></i> ${r.location}</div>
    <div class="detail-sidebar-info-row"><i class="fa-regular fa-clock"></i> ${r.openHours || ''}</div>`;
  page.innerHTML = `
    <div class="min-h-screen pb-28 restaurant-lux" style="background:var(--bg-card)">
      <div class="relative h-80 detail-gallery">
        <div class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onRestGalleryScroll(this)" id="restGallery">
          ${(r.images || [r.image]).map((img, i) => `<img src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%" onclick="openLightbox(${i})">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/25 pointer-events-none"></div>
        <button onclick="closeRestaurantPage()" class="absolute top-4 right-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900 z-10"><i class="fa-solid fa-arrow-right"></i></button>
        <div class="absolute bottom-5 left-5 right-5 z-10 text-white">
          <div class="flex items-center gap-2 mb-2">
            <span class="lux-cuisine-badge">${r.cuisine}</span>
            <span class="text-gold-400 text-xs font-semibold">${'$'.repeat(r.priceLevel || 2)}</span>
          </div>
          <h1 class="font-display text-3xl font-bold leading-tight mb-2" style="text-shadow:0 2px 12px rgba(0,0,0,.5)">${r.name}</h1>
          <div class="flex items-center gap-2 text-sm">${utils.renderStars(r.rating)}<span class="text-white/80 text-xs">${Number(r.rating).toFixed(1)} (${r.reviews || 0})</span></div>
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
        <p class="text-center text-sm leading-relaxed italic font-display" style="color:var(--text-secondary)">"${r.fullDescription || r.description}"</p>
        <div class="lux-divider"><span class="lux-dot"></span></div>
        <div>
          <p class="text-center font-display italic text-2xl mb-6" style="color:var(--text-primary)">The Menu</p>
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
          ${(d.images || [d.image]).map(img => `<img src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none"></div>
        <button onclick="closeDestinationPage()" class="absolute top-4 right-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900 z-10"><i class="fa-solid fa-arrow-right"></i></button>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="destGalleryDots">${(d.images || [d.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      <div class="relative -mt-6 rounded-t-[28px] p-5 space-y-5" style="background:var(--bg-card)">
        <div>
          <div class="flex items-center gap-2 text-sm mb-1">${utils.renderStars(d.rating)}<span class="text-xs" style="color:var(--text-secondary)">${Number(d.rating).toFixed(1)}</span></div>
          <h2 class="font-display text-2xl font-bold mb-1 leading-tight" style="color:var(--text-primary)">${d.name}</h2>
          <p class="text-xs flex items-center gap-1" style="color:var(--text-secondary)"><i class="fa-solid fa-location-dot text-violet-500"></i>${d.location || ''}</p>
        </div>
        <div>
          <p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">— ABOUT</p>
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
        <img src="${a.image}" class="w-full h-full object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
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
  if (!b) return toast('Booking not found', 'error');
  const isUpcoming = new Date(b.checkin || b.date) >= new Date();
  const page = document.createElement('div'); page.id = 'bookingDetailsPage'; page.className = 'page';
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-body)">
      <div class="dark-scene px-5 pt-6 pb-8 relative overflow-hidden">
        <div class="stars-container"></div>
        <div class="relative z-10">
          <div class="flex items-center justify-between mb-5">
            <button onclick="closeBookingDetails()" class="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white"><i class="fa-solid fa-arrow-right"></i></button>
            <h1 class="text-lg font-bold font-display text-white">Booking Details</h1>
            <div class="w-10"></div>
          </div>
          <div class="text-center">
            <span class="inline-block px-3 py-1 rounded-full text-[10px] font-bold tracking-wider ${isUpcoming ? 'bg-green-500/20 text-green-400 border border-green-400/30' : 'bg-white/10 text-white/50 border border-white/20'}">${isUpcoming ? 'UPCOMING' : 'COMPLETED'}</span>
          </div>
        </div>
      </div>
      <div class="relative -mt-4 rounded-t-[28px] p-5" style="background:var(--bg-card)">
        ${bookingDetailBody(b)}
        ${b.type !== 'transfer' ? (b.reviewed ? `<div class="text-center text-xs py-2 mb-2"><i class="fa-solid fa-circle-check text-green-500"></i> You've reviewed this booking</div>` : (!isUpcoming ? `<button onclick="reviews.openModal('${b.type}','${b.hotelId || b.excursionId}', '${b.id}')" class="w-full py-3.5 rounded-2xl font-bold border border-violet-400/40 text-violet-500 mb-2"><i class="fa-solid fa-pen"></i> Write a Review</button>` : '')) : ''}
        ${isUpcoming ? `<button onclick="cancelBooking('${b.id}')" class="w-full py-4 rounded-2xl font-bold text-red-500 border border-red-400/30 mt-2">Cancel Booking</button>` : ''}
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0,0);
}

function bookingDetailBody(b) {
  const paymentLabel = b.payment === 'instapay' ? 'InstaPay / Wallet' : 'Credit/Debit Card';
  const paymentRow = `<div class="flex justify-between"><span>Payment</span><span>${paymentLabel}</span></div>`;
  if (b.type === 'excursion') return `<div class="card rounded-2xl p-3 flex gap-3 mb-4"><img src="${b.image}" class="w-16 h-16 rounded-xl object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'"><div><h3 class="font-display font-bold text-sm">${b.title}</h3><p class="text-[11px]">${b.category}</p></div></div><div class="space-y-3 text-sm mb-4"><div class="flex justify-between"><span>Date</span><span>${utils.formatDate(b.date)}</span></div><div class="flex justify-between"><span>Participants</span><span>${b.participants}</span></div>${paymentRow}</div><div class="border-t pt-3 flex justify-between mb-4"><span class="font-bold">Total</span><span class="font-bold text-violet-500">${b.priceFormatted}</span></div><div class="field-box rounded-xl p-3 flex items-center justify-between mb-2"><span>Booking ID</span><span class="font-bold">${b.id}</span></div>`;
  if (b.type === 'transfer') return `<div class="card rounded-2xl p-3 flex gap-3 mb-4"><div class="w-16 h-16 rounded-xl bg-violet-50 flex items-center justify-center"><i class="fa-solid fa-shuttle-van text-violet-600 text-xl"></i></div><div><h3 class="font-display font-bold text-sm">${b.vehicleType} Transfer</h3><p class="text-[11px]">${b.direction}</p></div></div><div class="space-y-3 text-sm mb-4"><div class="flex justify-between"><span>Date</span><span>${utils.formatDate(b.date)}</span></div><div class="flex justify-between"><span>Time</span><span>${b.time}</span></div><div class="flex justify-between"><span>Flight No.</span><span>${b.flightNo || '—'}</span></div><div class="flex justify-between"><span>Pickup/Drop-off</span><span class="text-right max-w-[60%]">${b.address}</span></div><div class="flex justify-between"><span>Passengers</span><span>${b.passengers}</span></div>${paymentRow}</div><div class="border-t pt-3 flex justify-between mb-4"><span class="font-bold">Total</span><span class="font-bold text-violet-500">${b.priceFormatted}</span></div><div class="field-box rounded-xl p-3 flex items-center justify-between mb-2"><span>Booking ID</span><span class="font-bold">${b.id}</span></div>`;
  return `<div class="card rounded-2xl p-3 flex gap-3 mb-4"><img src="${b.image}" class="w-16 h-16 rounded-xl object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'"><div><h3 class="font-display font-bold text-sm">${b.hotelName}</h3><div class="flex items-center gap-1 mb-1">${utils.renderStars(b.rating)}</div><p class="text-[10px]">${b.location}</p></div></div><div class="space-y-3 text-sm mb-4"><div class="flex justify-between"><span>Check-in</span><span>${utils.formatDate(b.checkin)}</span></div><div class="flex justify-between"><span>Check-out</span><span>${utils.formatDate(b.checkout)}</span></div><div class="flex justify-between"><span>Guests</span><span>${b.guests} Guests, ${b.rooms} Room(s)</span></div><div class="flex justify-between"><span>Room Type</span><span>${b.roomType}</span></div>${b.requests ? `<div class="flex justify-between"><span>Requests</span><span class="text-right max-w-[60%]">${b.requests}</span></div>` : ''}${paymentRow}</div><div class="border-t pt-3 flex justify-between mb-4"><span class="font-bold">Total</span><span class="font-bold text-violet-500">${b.priceFormatted}</span></div><div class="field-box rounded-xl p-3 flex items-center justify-between mb-2"><span>Booking ID</span><span class="font-bold">${b.id}</span></div>`;
}
function closeBookingDetails() { const p = document.getElementById('bookingDetailsPage'); if (p) p.remove(); nav.go('bookings'); }
async function cancelBooking(bookingId) { if (!confirm('Cancel this booking?')) return; try { await apiFetch(`/api/hotels/booking/${bookingId}`, { method: 'DELETE' }); toast('Booking cancelled', 'info'); bookings.load(); closeBookingDetails(); } catch (e) { toast('Cancellation failed: ' + e.message, 'error'); } }

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
