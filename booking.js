// ==================== PAYMENT & BOOKING ====================
function paymentMethodsBlock(currentMethod, onchangeFn) {
  const methods = [
    { id: 'card', label: 'Credit/Debit Card', icon: 'fa-credit-card' },
    { id: 'instapay', label: 'InstaPay / Wallet', icon: 'fa-wallet' },
    { id: 'cash', label: 'Cash on Arrival', icon: 'fa-money-bill-wave' },
  ];
  return methods.map(m => `
    <label class="card rounded-2xl p-3.5 flex items-center gap-3 cursor-pointer ${currentMethod === m.id ? 'ring-1 ring-violet-400' : ''}">
      <input type="radio" name="paymethod" value="${m.id}" ${currentMethod === m.id ? 'checked' : ''} onchange="${onchangeFn}('${m.id}')" class="w-4 h-4 accent-violet-600">
      <i class="fa-solid ${m.icon} text-violet-500 text-lg w-6 text-center"></i>
      <span class="flex-1 text-sm font-semibold">${m.label}</span>
    </label>`).join('');
}

function showKashierModal(kashierUrl, orderId, bookingData) {
  const modal = document.createElement('div');
  modal.id = 'kashierModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-content" style="max-width:600px; padding:0; overflow:hidden;">
    <iframe src="${kashierUrl}" style="width:100%; height:600px; border:0;"></iframe>
  </div>`;
  document.body.appendChild(modal);
  window.addEventListener('message', async (ev) => {
    if (ev.origin !== 'https://checkout.kashier.io') return;
    if (ev.data?.event === 'kashier.paymentSuccess') {
      modal.remove();
      toast('Payment successful! Your booking is confirmed.', 'success');
      renderBookingConfirmation(bookingData);
    }
    if (ev.data?.event === 'kashier.paymentFailure') {
      modal.remove();
      toast('Payment failed', 'error');
    }
  });
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
          <p class="text-white/60 text-sm">${b.paymentStatus === 'pending_cash' ? 'Pay cash on arrival.' : 'Payment received.'}</p>
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
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-80">
        <div id="hotelGallery" class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onGalleryScroll(this)">
          ${(h.images || [h.image]).map(img => `<img src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none"></div>
        <button onclick="closeHotelPage()" class="absolute top-4 right-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900 z-10"><i class="fa-solid fa-arrow-right"></i></button>
        <button onclick="favorites.toggle('${h.id}')" class="absolute top-4 left-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg z-10"><i class="fa-${state.favorites.includes(h.id) ? 'solid text-red-500' : 'regular text-ink-900'} fa-heart"></i></button>
        ${h.bestseller ? '<div class="absolute top-4 left-1/2 -translate-x-1/2 badge-bestseller px-3 py-1 rounded-full text-[10px] font-black">BEST SELLER</div>' : ''}
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="galleryDots">${(h.images || [h.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      <div class="relative -mt-6 rounded-t-[28px] p-5 space-y-6 pb-32" style="background:var(--bg-card)">
        <div>
          <p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">— ${(h.category || '').toUpperCase()} HOTEL</p>
          <h2 class="font-display text-2xl font-bold mb-1 leading-tight">${h.name}</h2>
          <div class="flex items-center gap-2 text-sm mb-1">${utils.renderStars(h.rating)}<span class="text-xs">${Number(h.rating).toFixed(1)} (${h.reviews} reviews)</span></div>
          <p class="text-xs flex items-center gap-1"><i class="fa-solid fa-location-dot text-violet-500"></i>${h.location}</p>
        </div>
        <div class="grid grid-cols-3 gap-2">
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
          <div class="space-y-3" id="hotelRoomsList">
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
          <div class="flex items-center justify-between mb-3">
            <div><p class="text-violet-400 text-[10px] tracking-widest mb-1 font-semibold">— REVIEWS</p><h3 class="font-display text-lg font-bold">Guest Reviews</h3></div>
            <div class="text-center"><p class="text-3xl font-bold text-violet-500 font-display" id="hotelReviewsSummary">${Number(h.rating).toFixed(1)}</p><p class="text-[10px]"><span id="hotelReviewsSummaryCount">${h.reviews || 0}</span> reviews</p></div>
          </div>
          <button onclick="openReviewModal('hotel','${h.id}')" class="w-full py-2.5 rounded-xl text-xs font-bold border border-violet-400/40 text-violet-500 mb-3"><i class="fa-solid fa-pen"></i> Write a Review</button>
          <div class="space-y-3" id="hotelReviewsList"></div>
        </div>
      </div>
      <div class="fixed bottom-0 left-0 right-0 max-w-md mx-auto backdrop-blur-xl border-t p-4 flex items-center justify-between z-10" style="background:var(--bg-card); border-color:var(--border-card)">
        <div><p class="text-[9px] tracking-wider mb-0.5 font-semibold">SELECTED ROOM</p><p class="text-xl font-bold text-violet-500 font-display" id="hotelBottomPriceAmount">${utils.formatPrice((h.rooms && h.rooms[0] ? h.rooms[0].price : h.price))}<span class="text-xs"> / Night</span></p></div>
        <button onclick="startBooking('${h.id}', 0)" class="btn-gold px-7 py-3 rounded-2xl font-bold text-ink-900">Book Now</button>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0, 0);
  routeToDetail('hotels', h.id, h.name, opts);
  loadReviews('hotel', h.id, 'hotelReviewsList', 'hotelReviewsSummary');
}

function closeHotelPage() { const p = document.getElementById('hotelDetailPage'); if (p) p.remove(); nav.go('hotels'); }
function onGalleryScroll(el) { const idx = Math.round(el.scrollLeft / el.clientWidth); document.querySelectorAll('#galleryDots .gallery-dot').forEach((d, i) => d.classList.toggle('active', i === idx)); }
function amenityIcon(a) { const map = { 'Free WiFi':'fa-wifi','Breakfast':'fa-mug-saucer','Pool':'fa-water-ladder','Spa':'fa-spa','Gym':'fa-dumbbell','Beach Access':'fa-umbrella-beach','Parking':'fa-square-parking','Business Center':'fa-briefcase','Meeting Rooms':'fa-users-rectangle','Concierge':'fa-bell-concierge','24/7 Reception':'fa-clock' }; return map[a] || 'fa-check'; }
function selectRoomOnDetail(hotelId, roomIndex) { const h = CATALOG.hotels.find(x => x.id === hotelId); const r = h?.rooms?.[roomIndex]; if (!r) return; const priceEl = document.getElementById('hotelBottomPriceAmount'); if (priceEl) priceEl.innerHTML = `${utils.formatPrice(r.price)}<span class="text-xs"> / Night</span>`; const btn = document.querySelector('#hotelDetailPage [onclick^="startBooking"]'); if (btn) btn.setAttribute('onclick', `startBooking('${hotelId}', ${roomIndex})`); document.querySelectorAll('#hotelRoomsList .room-option-card').forEach((card, i) => card.classList.toggle('room-selected', i === roomIndex)); }

function startBooking(hotelId, roomIndex) {
  if (!authToken) { toast('Please login to book', 'error'); return; }
  const h = CATALOG.hotels.find(x => x.id === hotelId);
  const r = h?.rooms?.[roomIndex];
  if (!h || !r) return;
  state.currentHotel = h;
  state.currentRoom = r;
  state.bookingDraft = {
    name: currentUser?.displayName || '',
    email: currentUser?.email || '',
    phone: '',
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
  let bodyHtml = '';
  if (step === 2) {
    bodyHtml = `
      <div class="p-5">
        <div class="card rounded-2xl p-3 flex gap-3 mb-5">
          <img src="${getImageUrl(h.image)}" class="w-16 h-16 rounded-xl object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
          <div><h3 class="font-display font-bold text-sm">${h.name}</h3><p class="text-[10px]">${r.type}</p></div>
        </div>
        <h3 class="font-display text-lg font-bold mb-3">Guest Information</h3>
        <form onsubmit="submitGuestDetails(event)" class="space-y-4">
          <input type="text" id="bkName" required value="${state.bookingDraft.name}" placeholder="Full Name" class="input-field w-full px-3 py-2.5 text-sm">
          <input type="email" id="bkEmail" required value="${state.bookingDraft.email}" placeholder="Email" class="input-field w-full px-3 py-2.5 text-sm">
          <input type="tel" id="bkPhone" required value="${state.bookingDraft.phone}" placeholder="Phone" class="input-field w-full px-3 py-2.5 text-sm">
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
          <textarea id="bkRequests" rows="2" placeholder="Special requests" class="input-field w-full px-3 py-2.5 text-sm"></textarea>
          <button type="submit" class="btn-violet w-full py-4 rounded-2xl font-bold">Continue</button>
        </form>
      </div>`;
  } else if (step === 3) {
    bodyHtml = `
      <div class="p-5">
        <h3 class="font-display text-lg font-bold mb-3">Payment Method</h3>
        <div class="space-y-3 mb-5">${paymentMethodsBlock(state.bookingDraft.payment, 'setHotelPaymentMethod')}</div>
        <div class="card rounded-2xl p-4 space-y-2 mb-6">
          <div class="flex justify-between"><span>${r.type} × ${state.guests.rooms} room(s)</span><span>${utils.formatPrice(pricing.baseRoomTotal)}</span></div>
          <div class="flex justify-between"><span>Taxes & Fees</span><span>${utils.formatPrice(Math.round(pricing.roomTotal * 0.1))}</span></div>
          <div class="border-t pt-2 flex justify-between"><span class="font-bold">Total</span><span class="font-bold text-violet-500">${utils.formatPrice(total)}</span></div>
        </div>
        <button onclick="payAndConfirmHotelBooking(${pricing.roomTotal}, ${Math.round(pricing.roomTotal * 0.1)}, ${total}, ${nights})" id="hotelPayBtn" class="btn-violet w-full py-4 rounded-2xl font-bold">Pay Now</button>
      </div>`;
  }
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-body)">
      <div class="dark-scene px-5 pt-6 pb-6 relative overflow-hidden">
        <div class="stars-container"></div>
        <div class="relative z-10">
          <div class="flex items-center gap-3 mb-5">
            <button onclick="${step === 2 ? 'closeBookingFlow()' : 'renderBookingStep(2)'}" class="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white"><i class="fa-solid fa-arrow-right"></i></button>
            <h1 class="text-lg font-bold font-display text-white">${step === 2 ? 'Booking Details' : 'Payment'}</h1>
          </div>
          ${utils.stepIndicator(step, ['Select Room', 'Guest Details', 'Payment'])}
        </div>
      </div>
      ${bodyHtml}
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  page.classList.add('active'); window.scrollTo(0,0);
}

function setHotelPaymentMethod(m) { state.bookingDraft.payment = m; renderBookingStep(3); }
function closeBookingFlow() { const p = document.getElementById('bookingFlowPage'); if (p) p.remove(); showHotelPage(state.currentHotel.id); }
function submitGuestDetails(e) { e.preventDefault(); state.bookingDraft.name = document.getElementById('bkName').value; state.bookingDraft.email = document.getElementById('bkEmail').value; state.bookingDraft.phone = document.getElementById('bkPhone').value; state.bookingDraft.checkin = document.getElementById('bkCheckin').dataset.value; state.bookingDraft.checkout = document.getElementById('bkCheckout').dataset.value; state.bookingDraft.requests = document.getElementById('bkRequests').value; renderBookingStep(3); }
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

    if (state.bookingDraft.payment === 'cash') {
      bookingData.paymentStatus = 'pending_cash';
      bookingData.status = 'pending_cash';
      const res = await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });
      state.bookings.unshift(res.booking);
      bookings.render();
      renderBookingConfirmation(res.booking);
      btn.disabled = false; btn.innerHTML = 'Pay Now';
      return;
    }

    const saveRes = await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });
    const hashData = await apiFetch('/api/kashier/hash', { method: 'POST', body: JSON.stringify({ orderId, amount: total, currency: 'EGP' }) });
    const kashierUrl = new URL('https://checkout.kashier.io/');
    kashierUrl.searchParams.append('merchantId', hashData.merchantId);
    kashierUrl.searchParams.append('orderId', orderId);
    kashierUrl.searchParams.append('amount', total);
    kashierUrl.searchParams.append('currency', hashData.currency || 'EGP');
    kashierUrl.searchParams.append('hash', hashData.hash);
    kashierUrl.searchParams.append('mode', 'test');
    kashierUrl.searchParams.append('paymentMethods', state.bookingDraft.payment === 'instapay' ? 'wallet' : 'card');
    kashierUrl.searchParams.append('merchantRedirect', window.location.href.split('?')[0] + '?kashier_callback=1');

    showKashierModal(kashierUrl.toString(), orderId, bookingData);
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
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-72">
        <div id="excursionGallery" class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onExcursionGalleryScroll(this)">
          ${(x.images || [x.image]).map(img => `<img src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none"></div>
        <button onclick="closeExcursionPage()" class="absolute top-4 right-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900 z-10"><i class="fa-solid fa-arrow-right"></i></button>
        <div class="absolute top-4 left-4 bg-violet-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full z-10">${x.category}</div>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="excursionGalleryDots">${(x.images || [x.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      <div class="relative -mt-6 rounded-t-[28px] p-5 space-y-6 pb-32" style="background:var(--bg-card)">
        <div>
          <h2 class="font-display text-2xl font-bold mb-1 leading-tight">${x.title}</h2>
          <div class="flex items-center gap-2 text-sm mb-1">${utils.renderStars(x.rating)}<span class="text-xs">${Number(x.rating).toFixed(1)} (${x.reviews} reviews)</span></div>
          <p class="text-xs"><i class="fa-regular fa-clock text-violet-500"></i>${x.duration} · <i class="fa-solid fa-location-dot text-violet-500"></i>${x.meetingPoint || ''}</p>
        </div>
        <div>
          <h3 class="font-display text-lg font-bold mb-2">Overview</h3>
          <p class="text-sm leading-relaxed">${x.fullDescription || x.description}</p>
        </div>
        <div>
          <h3 class="font-display text-lg font-bold mb-3">What's Included</h3>
          <div class="grid grid-cols-1 gap-2">${(x.includes || []).map(i => `<div class="flex items-center gap-2 text-sm"><i class="fa-solid fa-circle-check text-green-500"></i>${i}</div>`).join('')}</div>
        </div>
        ${(x.excludes || []).length ? `
          <div>
            <h3 class="font-display text-lg font-bold mb-3">What's Not Included</h3>
            <div class="grid grid-cols-1 gap-2">${x.excludes.map(i => `<div class="flex items-center gap-2 text-sm"><i class="fa-solid fa-circle-xmark text-red-400"></i>${i}</div>`).join('')}</div>
          </div>` : ''}
        ${(x.whatToBring || []).length ? `
          <div>
            <h3 class="font-display text-lg font-bold mb-3">What to Bring</h3>
            <div class="grid grid-cols-1 gap-2">${x.whatToBring.map(i => `<div class="flex items-center gap-2 text-sm"><i class="fa-solid fa-suitcase-rolling text-violet-500"></i>${i}</div>`).join('')}</div>
          </div>` : ''}
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
          <h3 class="font-display text-lg font-bold mb-3">Reviews</h3>
          <button onclick="openReviewModal('excursion','${x.id}')" class="w-full py-2.5 rounded-xl text-xs font-bold border border-violet-400/40 text-violet-500 mb-3">Write a Review</button>
          <div class="space-y-3" id="excursionReviewsList"></div>
        </div>
      </div>
      <div class="fixed bottom-0 left-0 right-0 max-w-md mx-auto backdrop-blur-xl border-t p-4 flex items-center justify-between z-10" style="background:var(--bg-card); border-color:var(--border-card)">
        <div><p class="text-[9px]">FROM</p><p class="text-xl font-bold text-violet-500 font-display">${utils.formatPrice(x.price)}<span class="text-xs">/person</span></p></div>
        <button onclick="startExcursionBooking('${x.id}')" class="btn-gold px-7 py-3 rounded-2xl font-bold text-ink-900">Book Now</button>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0,0);
  routeToDetail('excursions', x.id, x.title, opts);
  loadReviews('excursion', x.id, 'excursionReviewsList', null);
}

function closeExcursionPage() { const p = document.getElementById('excursionDetailPage'); if (p) p.remove(); nav.go('excursions'); }
function onExcursionGalleryScroll(el) { const idx = Math.round(el.scrollLeft / el.clientWidth); document.querySelectorAll('#excursionGalleryDots .gallery-dot').forEach((d, i) => d.classList.toggle('active', i === idx)); }
function startExcursionBooking(id) {
  if (!authToken) { toast('Please login to book', 'error'); return; }
  const x = CATALOG.excursions.find(i => i.id === id);
  if (!x) return;
  state.currentExcursion = x;
  state.bookingDraft = { name: currentUser?.displayName || '', email: currentUser?.email || '', phone: '', participants: 2, payment: 'card', date: utils.addDays(utils.todayIso(), 1) };
  renderExcursionBookingStep(2);
}

function renderExcursionBookingStep(step) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const existing = document.getElementById('excursionBookingFlowPage'); if (existing) existing.remove();
  const x = state.currentExcursion; const subtotal = x.price * state.bookingDraft.participants; const taxes = Math.round(subtotal * 0.05); const total = subtotal + taxes;
  const page = document.createElement('div'); page.id = 'excursionBookingFlowPage'; page.className = 'page';
  let bodyHtml = '';
  if (step === 2) {
    bodyHtml = `
      <div class="p-5">
        <div class="card rounded-2xl p-3 flex gap-3 mb-5">
          <img src="${getImageUrl(x.image)}" class="w-16 h-16 rounded-xl object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
          <div><h3 class="font-display font-bold text-sm">${x.title}</h3><p class="text-[10px]">${x.category} · ${x.duration}</p></div>
        </div>
        <h3 class="font-display text-lg font-bold mb-3">Booking Information</h3>
        <form onsubmit="submitExcursionDetails(event)" class="space-y-4">
          <input type="text" id="ekName" required value="${state.bookingDraft.name}" placeholder="Full Name" class="input-field w-full px-3 py-2.5 text-sm">
          <input type="email" id="ekEmail" required value="${state.bookingDraft.email}" placeholder="Email" class="input-field w-full px-3 py-2.5 text-sm">
          <input type="tel" id="ekPhone" required value="${state.bookingDraft.phone}" placeholder="Phone" class="input-field w-full px-3 py-2.5 text-sm">
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
      </div>`;
  } else if (step === 3) {
    bodyHtml = `
      <div class="p-5">
        <h3 class="font-display text-lg font-bold mb-3">Payment Method</h3>
        <div class="space-y-3 mb-5">${paymentMethodsBlock(state.bookingDraft.payment, 'setExcursionPaymentMethod')}</div>
        <div class="card rounded-2xl p-4 space-y-2 mb-6">
          <div class="flex justify-between"><span>${x.title} × ${state.bookingDraft.participants}</span><span>${utils.formatPrice(subtotal)}</span></div>
          <div class="flex justify-between"><span>Taxes & Fees</span><span>${utils.formatPrice(taxes)}</span></div>
          <div class="border-t pt-2 flex justify-between"><span class="font-bold">Total</span><span class="font-bold text-violet-500">${utils.formatPrice(total)}</span></div>
        </div>
        <button onclick="payAndConfirmExcursionBooking(${subtotal}, ${taxes}, ${total})" id="excursionPayBtn" class="btn-violet w-full py-4 rounded-2xl font-bold">Pay Now</button>
        <button onclick="renderExcursionBookingStep(2)" class="w-full text-center text-violet-500 text-sm font-semibold mt-4">Back</button>
      </div>`;
  }
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-body)">
      <div class="dark-scene px-5 pt-6 pb-6 relative overflow-hidden">
        <div class="stars-container"></div>
        <div class="relative z-10">
          <div class="flex items-center gap-3 mb-5">
            <button onclick="${step === 2 ? 'closeExcursionBookingFlow()' : 'renderExcursionBookingStep(2)'}" class="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white"><i class="fa-solid fa-arrow-right"></i></button>
            <h1 class="text-lg font-bold font-display text-white">${step === 2 ? 'Booking Details' : 'Payment'}</h1>
          </div>
          ${utils.stepIndicator(step, ['Select', 'Details', 'Payment'])}
        </div>
      </div>
      ${bodyHtml}
    </div>`;
  document.getElementById('mainApp').appendChild(page); page.classList.add('active'); window.scrollTo(0,0);
}

function setExcursionPaymentMethod(m) { state.bookingDraft.payment = m; renderExcursionBookingStep(3); }
function closeExcursionBookingFlow() { const p = document.getElementById('excursionBookingFlowPage'); if (p) p.remove(); showExcursionPage(state.currentExcursion.id); }
function adjustParticipants(delta) { const newVal = state.bookingDraft.participants + delta; if (newVal >= 1 && newVal <= 15) { state.bookingDraft.participants = newVal; document.getElementById('ekParticipantsLabel').textContent = `${newVal} People`; } }
function submitExcursionDetails(e) { e.preventDefault(); state.bookingDraft.name = document.getElementById('ekName').value; state.bookingDraft.email = document.getElementById('ekEmail').value; state.bookingDraft.phone = document.getElementById('ekPhone').value; state.bookingDraft.date = document.getElementById('ekDate').dataset.value; renderExcursionBookingStep(3); }

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

    if (state.bookingDraft.payment === 'cash') {
      bookingData.paymentStatus = 'pending_cash';
      bookingData.status = 'pending_cash';
      const res = await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });
      state.bookings.unshift(res.booking);
      bookings.render();
      renderBookingConfirmation(res.booking);
      btn.disabled = false; btn.innerHTML = 'Pay Now';
      return;
    }

    const saveRes = await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });
    const hashData = await apiFetch('/api/kashier/hash', { method: 'POST', body: JSON.stringify({ orderId, amount: total, currency: 'EGP' }) });
    const kashierUrl = new URL('https://checkout.kashier.io/');
    kashierUrl.searchParams.append('merchantId', hashData.merchantId);
    kashierUrl.searchParams.append('orderId', orderId);
    kashierUrl.searchParams.append('amount', total);
    kashierUrl.searchParams.append('currency', hashData.currency || 'EGP');
    kashierUrl.searchParams.append('hash', hashData.hash);
    kashierUrl.searchParams.append('mode', 'test');
    kashierUrl.searchParams.append('paymentMethods', state.bookingDraft.payment === 'instapay' ? 'wallet' : 'card');
    kashierUrl.searchParams.append('merchantRedirect', window.location.href.split('?')[0] + '?kashier_callback=1');

    showKashierModal(kashierUrl.toString(), orderId, bookingData);
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
    name: currentUser?.displayName || '',
    email: currentUser?.email || '',
    phone: '',
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
  let bodyHtml = '';
  if (step === 2) {
    bodyHtml = `
      <div class="p-5">
        <div class="card rounded-2xl p-3 flex gap-3 mb-5">
          <img src="${getImageUrl(v.image)}" class="w-16 h-16 rounded-xl object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
          <div><h3 class="font-display font-bold text-sm">${v.vehicleType} Transfer</h3><p class="text-[10px]">Up to ${v.capacity} passengers</p></div>
        </div>
        <h3 class="font-display text-lg font-bold mb-3">Transfer Details</h3>
        <form onsubmit="submitTransferDetails(event)" class="space-y-4">
          <div class="field-box p-1 rounded-2xl flex gap-1">
            <button type="button" onclick="setTransferDirection('Airport to Hotel')" id="dirBtnArrival" class="flex-1 py-2.5 rounded-xl text-xs font-bold">Airport Pickup</button>
            <button type="button" onclick="setTransferDirection('Hotel to Airport')" id="dirBtnDeparture" class="flex-1 py-2.5 rounded-xl text-xs font-bold">Airport Drop-off</button>
          </div>
          <input type="text" id="tkName" required value="${state.bookingDraft.name}" placeholder="Full Name" class="input-field w-full px-3 py-2.5 text-sm">
          <input type="email" id="tkEmail" required value="${state.bookingDraft.email}" placeholder="Email" class="input-field w-full px-3 py-2.5 text-sm">
          <input type="tel" id="tkPhone" required value="${state.bookingDraft.phone}" placeholder="Phone" class="input-field w-full px-3 py-2.5 text-sm">
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
      </div>`;
  } else if (step === 3) {
    bodyHtml = `
      <div class="p-5">
        <h3 class="font-display text-lg font-bold mb-3">Payment Method</h3>
        <div class="space-y-3 mb-5">${paymentMethodsBlock(state.bookingDraft.payment, 'setTransferPaymentMethod')}</div>
        <div class="card rounded-2xl p-4 space-y-2 mb-6">
          <div class="flex justify-between"><span>${v.vehicleType} Transfer</span><span>${utils.formatPrice(subtotal)}</span></div>
          <div class="flex justify-between"><span>Taxes & Fees</span><span>${utils.formatPrice(taxes)}</span></div>
          <div class="border-t pt-2 flex justify-between"><span class="font-bold">Total</span><span class="font-bold text-violet-500">${utils.formatPrice(total)}</span></div>
        </div>
        <button onclick="payAndConfirmTransferBooking(${subtotal}, ${taxes}, ${total})" id="transferPayBtn" class="btn-violet w-full py-4 rounded-2xl font-bold">Pay Now</button>
        <button onclick="renderTransferBookingStep(2)" class="w-full text-center text-violet-500 text-sm font-semibold mt-4">Back</button>
      </div>`;
  }
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-body)">
      <div class="dark-scene px-5 pt-6 pb-6 relative overflow-hidden">
        <div class="stars-container"></div>
        <div class="relative z-10">
          <div class="flex items-center gap-3 mb-5">
            <button onclick="${step === 2 ? 'closeTransferBookingFlow()' : 'renderTransferBookingStep(2)'}" class="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white"><i class="fa-solid fa-arrow-right"></i></button>
            <h1 class="text-lg font-bold font-display text-white">${step === 2 ? 'Transfer Details' : 'Payment'}</h1>
          </div>
          ${utils.stepIndicator(step, ['Select', 'Details', 'Payment'])}
        </div>
      </div>
      ${bodyHtml}
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
function submitTransferDetails(e) { e.preventDefault(); state.bookingDraft.name = document.getElementById('tkName').value; state.bookingDraft.email = document.getElementById('tkEmail').value; state.bookingDraft.phone = document.getElementById('tkPhone').value; state.bookingDraft.flightNo = document.getElementById('tkFlightNo').value; state.bookingDraft.address = document.getElementById('tkAddress').value; state.bookingDraft.date = document.getElementById('tkDate').dataset.value; state.bookingDraft.time = document.getElementById('tkTime').value; renderTransferBookingStep(3); }

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

    if (state.bookingDraft.payment === 'cash') {
      bookingData.paymentStatus = 'pending_cash';
      bookingData.status = 'pending_cash';
      const res = await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });
      state.bookings.unshift(res.booking);
      bookings.render();
      renderBookingConfirmation(res.booking);
      btn.disabled = false; btn.innerHTML = 'Pay Now';
      return;
    }

    const saveRes = await apiFetch('/api/user/bookings', { method: 'POST', body: JSON.stringify({ booking: bookingData }) });
    const hashData = await apiFetch('/api/kashier/hash', { method: 'POST', body: JSON.stringify({ orderId, amount: total, currency: 'EGP' }) });
    const kashierUrl = new URL('https://checkout.kashier.io/');
    kashierUrl.searchParams.append('merchantId', hashData.merchantId);
    kashierUrl.searchParams.append('orderId', orderId);
    kashierUrl.searchParams.append('amount', total);
    kashierUrl.searchParams.append('currency', hashData.currency || 'EGP');
    kashierUrl.searchParams.append('hash', hashData.hash);
    kashierUrl.searchParams.append('mode', 'test');
    kashierUrl.searchParams.append('paymentMethods', state.bookingDraft.payment === 'instapay' ? 'wallet' : 'card');
    kashierUrl.searchParams.append('merchantRedirect', window.location.href.split('?')[0] + '?kashier_callback=1');

    showKashierModal(kashierUrl.toString(), orderId, bookingData);
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
  page.innerHTML = `
    <div class="min-h-screen pb-28 restaurant-lux" style="background:var(--bg-card)">
      <div class="relative h-80">
        <div class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onRestGalleryScroll(this)" id="restGallery">
          ${(r.images || [r.image]).map(img => `<img src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%">`).join('')}
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
      <div class="relative -mt-6 rounded-t-[28px] p-6 space-y-2" style="background:var(--bg-card)">
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
        ${b.type !== 'transfer' ? (b.reviewed ? `<div class="text-center text-xs py-2 mb-2"><i class="fa-solid fa-circle-check text-green-500"></i> You've reviewed this booking</div>` : (!isUpcoming ? `<button onclick="openReviewModal('${b.type}','${b.hotelId || b.excursionId}', '${b.id}')" class="w-full py-3.5 rounded-2xl font-bold border border-violet-400/40 text-violet-500 mb-2"><i class="fa-solid fa-pen"></i> Write a Review</button>` : '')) : ''}
        ${isUpcoming ? `<button onclick="cancelBooking('${b.id}')" class="w-full py-4 rounded-2xl font-bold text-red-500 border border-red-400/30 mt-2">Cancel Booking</button>` : ''}
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0,0);
}

function bookingDetailBody(b) {
  const paymentLabel = b.payment === 'cash' ? 'Cash on Arrival' : b.payment === 'instapay' ? 'InstaPay / Wallet' : 'Credit/Debit Card';
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
