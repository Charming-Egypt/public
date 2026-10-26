// ==================== FRONTEND UI & NAVIGATION ====================
window.DS_CONFIG = window.DS_CONFIG || {
  SHOW_HOTELS: false,
  SHOW_EXCURSIONS: true,
  SHOW_TRANSFERS: true,
  SHOW_RESTAURANTS: false,
  SHOW_DESTINATIONS: true,
};

// Section switches: the build gives the defaults (site.config.json "show"); the admin's "إعدادات الموقع" overrides them live.
// The last settings are cached in localStorage so the very first paint already matches; fresh ones are applied in DOMContentLoaded.
let SITE_SET = {};
try { SITE_SET = (JSON.parse(localStorage.getItem('ds_site_settings') || 'null') || {}).value || {}; } catch {}
const secFlag = (k, def) => (SITE_SET.sections && SITE_SET.sections[k] !== undefined ? !!SITE_SET.sections[k] : def);
let SHOW_HOTELS = secFlag('hotels', window.DS_CONFIG.SHOW_HOTELS);
let SHOW_EXCURSIONS = secFlag('excursions', window.DS_CONFIG.SHOW_EXCURSIONS);
let SHOW_TRANSFERS = secFlag('transfers', window.DS_CONFIG.SHOW_TRANSFERS);
let SHOW_RESTAURANTS = secFlag('restaurants', window.DS_CONFIG.SHOW_RESTAURANTS);
let SHOW_DESTINATIONS = secFlag('destinations', window.DS_CONFIG.SHOW_DESTINATIONS);
let SHOW_JOURNAL = secFlag('journal', window.DS_CONFIG.SHOW_JOURNAL !== false);

// ==================== MULTI-PAGE ROUTING ====================
// Every screen is a real HTML file with its own URL (see tools/build.mjs):
//   /excursions/            list page          (static HTML)
//   /excursions/view/?id=x  detail page        (shell + catalog lookup)
// Navigating = a normal page load / link click. No pushState, no 404 trick.

const BASE_PATH = '';

const ROUTES = {
  home: '/',
  excursions: '/excursions/',
  transfers: '/transfers/',
  restaurants: '/restaurants/',
  hotels: '/hotels/',
  bookings: '/bookings/',
  profile: '/profile/',
  settings: '/settings/',
  notifications: '/notifications/',
  about: '/about/',
  journal: '/journal/',
  contact: '/contact/',
  cancellationPolicy: '/cancellation-policy/',
  refundPolicy: '/refund-policy/',
  terms: '/terms/',
  privacy: '/privacy/',
  partner: '/partner/'
};

const PAGE_TITLES = {
  home: 'Discover Sharm — Luxury Travel',
  excursions: 'Excursions in Sharm El-Sheikh — Discover Sharm',
  transfers: 'Airport Transfers — Discover Sharm',
  restaurants: 'Restaurants — Discover Sharm',
  hotels: 'Hotels — Discover Sharm',
  bookings: 'My Bookings — Discover Sharm',
  profile: 'My Profile — Discover Sharm',
  settings: 'Settings — Discover Sharm',
  notifications: 'Notifications — Discover Sharm',
  about: 'About Us — Discover Sharm',
  journal: 'Travel Journal — Discover Sharm',
  contact: 'Contact Us — Discover Sharm',
  cancellationPolicy: 'Cancellation Policy — Discover Sharm',
  refundPolicy: 'Refund Policy — Discover Sharm',
  terms: 'Terms of Service — Discover Sharm',
  privacy: 'Privacy Policy — Discover Sharm',
  partner: 'Become a Partner — Discover Sharm'
};

// Detail ("single item") pages. `open` renders the item into #mainApp;
// `list` is the page to fall back to when the id is missing or unknown.
const DETAIL_ROUTES = {
  excursions:   { path: '/excursions/view/',   list: 'excursions',  open: (id, o) => __renderers.showExcursionPage(id, o),   enabled: () => SHOW_EXCURSIONS },
  restaurants:  { path: '/restaurants/view/',  list: 'restaurants', open: (id, o) => __renderers.showRestaurantPage(id, o),   enabled: () => SHOW_RESTAURANTS },
  transfers:    { path: '/transfers/view/',    list: 'transfers',   open: (id, o) => __renderers.showTransferPage(id, o),     enabled: () => SHOW_TRANSFERS },
  destinations: { path: '/destinations/view/', list: 'home',        open: (id, o) => __renderers.showDestinationPage(id, o), enabled: () => SHOW_DESTINATIONS },
  articles:     { path: '/journal/view/',      list: 'journal',     open: (id, o) => __renderers.showArticlePage(id, o) },
  hotels:       { path: '/hotels/view/',       list: 'hotels',      open: (id, o) => __renderers.showHotelPage(id, o),        enabled: () => SHOW_HOTELS }
};

// The original render functions (router.js swaps the public names for
// navigating wrappers; the detail shell calls these directly).
const __renderers = {};

function pathForPage(page) { return BASE_PATH + (ROUTES[page] || '/'); }
function pathForDetail(section, id) {
  const def = DETAIL_ROUTES[section];
  return `${BASE_PATH}${def ? def.path : '/'}?id=${encodeURIComponent(id)}`;
}

// Detail screens only need their tab title set now (the URL is already right).
function routeToDetail(section, id, title) {
  document.title = title ? `${title} — Discover Sharm` : PAGE_TITLES.home;
}

let __catalogLoadPromise = null;
function ensureCatalogLoaded() { return __catalogLoadPromise || Promise.resolve(); }

// Renders the item named by ?id= on a /<section>/view/ page.
async function openDetailFromRoute(section, id) {
  const def = DETAIL_ROUTES[section];
  const leave = () => location.replace(def ? pathForPage(def.list) : '/');
  if (!def || (def.enabled && !def.enabled()) || !id) return leave();
  try {
    await ensureCatalogLoaded();
    def.open(id, { render: true });
    if (!document.querySelector('#mainApp .page.active')) setTimeout(leave, 1200); // unknown id: toast, then back to the list
  } catch (e) {
    console.error('openDetailFromRoute failed:', e);
    toast(t('errCouldNotLoadPage'), 'error');
    setTimeout(leave, 1200);
  }
}

// Toggles the transparent-over-hero -> solid "scrolled" state for both the
// mobile floating pill (.sticky-home-header) and the desktop bar
// (#desktopNav). This used to be dead code — the CSS for both states
// existed, but nothing ever called it, so neither header ever appeared.
function updateStickyHeaderState() {
  const homePage = document.getElementById('homePage');
  const isHome = !!(homePage && homePage.classList.contains('active'));
  const scrolled = !isHome || window.scrollY > 40;
  const stickyMobile = document.getElementById('stickyHomeHeader');
  const navDesktop = document.getElementById('desktopNav');
  if (stickyMobile) stickyMobile.classList.toggle('visible', isHome && scrolled);
  if (navDesktop) navDesktop.classList.toggle('scrolled', scrolled);
}
window.addEventListener('scroll', updateStickyHeaderState, { passive: true });

let __entered = false;
function enterApp() {
  document.getElementById('authPage')?.classList.add('hidden');
  document.documentElement.removeAttribute('data-gate');
  document.getElementById('mainApp')?.classList.remove('hidden');
  hideSplash();
  if (__entered) { updateStickyHeaderState(); return; }   // signed in from the auth overlay: don't boot twice
  __entered = true;

  __catalogLoadPromise = loadCatalogFromWorker();
  ui.setDefaultDates();

  if (currentUser) {
    updateDrawerUser(currentUser.displayName || currentUser.email, currentUser.email, currentUser.photoURL);
  } else {
    updateDrawerUser(t('guest'), '', localStorage.getItem('ds_avatar'));
  }

  if (SHOW_HOTELS && auth.isLoggedIn()) favorites.load();
  if (auth.isLoggedIn()) {
    bookings.load();
    notifications.load();
    loadUserProfile();
  } else {
    bookings.render();
    notifications.render();
  }

  // Each HTML file knows which screen it is (<body data-route / data-detail>).
  const route = document.body.dataset.route || 'home';
  const detail = document.body.dataset.detail;
  if (detail) {
    openDetailFromRoute(detail, new URLSearchParams(location.search).get('id'));
  } else {
    nav.activate(route, { initial: true });
  }
  updateStickyHeaderState();
}

const nav = {
  // Programmatic navigation (cards, buttons built in JS). Static menu items are
  // plain <a href> links and never reach this.
  go(page, opts = {}) {
    if (page === 'hotels' && !SHOW_HOTELS) return;
    if (page === 'excursions' && !SHOW_EXCURSIONS) return;
    if (page === 'transfers' && !SHOW_TRANSFERS) return;
    if (page === 'restaurants' && !SHOW_RESTAURANTS) return;
    if (page === 'destinations' && !SHOW_DESTINATIONS) return;
    if (page === 'journal' && !SHOW_JOURNAL) return;
    if (!ROUTES[page]) return;

    const here = document.body.dataset.route;
    if (here === page && !document.body.dataset.detail) { this.activate(page, opts); return; }
    if (typeof persistUiState === 'function') persistUiState();
    location.assign(pathForPage(page));
  },

  // Shows the static page of this HTML file and runs its renderers. Also used
  // to return from an in-page overlay (e.g. booking details) to the page itself.
  activate(page, opts = {}) {
    const target = document.getElementById(page + 'Page');
    if (!target) { if (!opts.initial) location.assign(pathForPage(page)); return; }

    document.querySelectorAll('#mainApp .page').forEach(p => { if (p !== target) p.remove(); });
    target.classList.add('active');
    window.scrollTo(0, 0);
    updateStickyHeaderState();
    document.body.classList.toggle('account-section', ['bookings', 'profile', 'settings', 'notifications'].includes(page));
    document.title = PAGE_TITLES[page] || PAGE_TITLES.home;

    document.querySelectorAll('[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    if (page === 'hotels' && SHOW_HOTELS) hotels.render();
    if (page === 'journal') renderJournalPage();
    if (page === 'partner') renderPartnerDocSlots();
    if (page === 'excursions' && SHOW_EXCURSIONS) excursionsUi.render();
    if (page === 'transfers' && SHOW_TRANSFERS) transfersUi.render();
    if (page === 'restaurants' && SHOW_RESTAURANTS) restaurantsUi.renderFull();
    if (page === 'bookings') bookings.render();
    if (page === 'notifications') notifications.render();
    if (page === 'profile') updateProfileStats();

    applyDesktopLayout();
  },

  // Back = the browser's own history when we came from this site, else home.
  goBack() {
    let internal = false;
    try { internal = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch {}
    if (internal && history.length > 1) history.back(); else location.assign(pathForPage('home'));
  },

  showAuth() {
    hideSplash();
    document.getElementById('authPage').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    switchAuthMode('login');
    initGoogleSignInButton();
  }
};

const sidebar = {
  open() {
    document.getElementById('sideDrawer').classList.add('open');
    document.getElementById('sideDrawerOverlay').classList.add('open');
  },
  close() {
    document.getElementById('sideDrawer').classList.remove('open');
    document.getElementById('sideDrawerOverlay').classList.remove('open');
  }
};

// ==================== USER PROFILE ====================
async function loadUserProfile() {
  if (!authToken || !currentUser) return;
  try {
    const data = await apiFetch('/api/profile', {}, true);
    if (data.profile) {
      if (currentUser) {
        currentUser = { ...currentUser, ...data.profile, uid: currentUser.uid };
      } else {
        currentUser = { ...data.profile, uid: data.profile.uid };
      }
      state.userTier = data.profile.loyaltyTier || 0;
      state.userStats = data.profile.stats || { completedBookings: 0, totalSpent: 0 };
      localStorage.setItem('ds_current_user', JSON.stringify(currentUser));
      updateDrawerUser(currentUser.displayName || currentUser.email, currentUser.email, currentUser.photoURL);
    }
  } catch (e) {
    console.warn(t('errFailedLoadProfile'), e);
    if (currentUser) {
      updateDrawerUser(currentUser.displayName || currentUser.email, currentUser.email, currentUser.photoURL);
    }
  }
}

function updateProfileStats() {
  const sb = document.getElementById('statBookings');
  if (sb) sb.textContent = state.userStats.completedBookings || state.bookings.length;
  const sf = document.getElementById('statFavorites');
  if (sf) sf.textContent = state.favorites.length;
  const sr = document.getElementById('statReviews');
  if (sr) sr.textContent = state.bookings.filter(b => b.reviewed).length;

  const level = (currentUser && currentUser.geniusLevel) || 0;
  const badge = document.getElementById('profileTierBadge');
  if (badge) {
    if (level > 0) {
      const badges = {1:'🥉', 2:'🥈', 3:'🥇'};
      badge.classList.remove('hidden');
      const textEl = document.getElementById('profileTierText');
      if (textEl) textEl.textContent = `Sharmawy Level ${level}`;
    } else {
      badge.classList.add('hidden');
    }
  }

  const benefitsCard = document.getElementById('sharmawyBenefitsCard');
  if (benefitsCard) {
    if (level > 0) {
      benefitsCard.classList.remove('hidden');
      benefitsCard.innerHTML = getSharmawyBenefitsHtml(level);
    } else {
      benefitsCard.classList.add('hidden');
    }
  }
}

function getSharmawyBenefitsHtml(level) {
  const benefits = {
    1: ['10% discount on selected excursions', 'Free late check-out (subject to availability)'],
    2: [t('perkDiscount15'), t('perkFreeUpgrade')],
    3: [t('perkDiscount20'), t('perkFreeUpgradeShort'), t('perkPrioritySupport'), t('perkWelcomeDrink')]
  };
  const list = benefits[level] || [];
  return `
    <div class="flex items-center gap-2 mb-3">
      <i class="fa-solid fa-crown text-gold-400"></i>
      <span class="font-bold text-sm">Sharmawy Level ${level} Benefits</span>
    </div>
    <ul class="space-y-2 text-xs" style="color:var(--text-secondary)">
      ${list.map(item => `<li><i class="fa-solid fa-check text-green-500"></i> ${item}</li>`).join('')}
    </ul>
  `;
}

// ==================== GUESTS MODAL ====================
// Child age tiers shown in the picker. Kept in sync with a room's own
// childPricingTiers when one is open (showHotelPage sets state.currentRoom),
// otherwise falls back to this generic 0-17 range for the search-page picker
// where no specific room/price is known yet.
const DEFAULT_CHILD_AGE_MAX = 11; // matches the site's existing "Children = age 2-12" convention (Infants under 2 are a separate free counter)

function renderChildAgeInputs() {
  const containers = ['childAgesList', 'searchChildAgesList'].map(id => document.getElementById(id)).filter(Boolean);
  if (!containers.length) return;
  const count = state.guests.children;
  const ages = state.guests.childAges || (state.guests.childAges = []);
  // keep the ages array the same length as the children count: preserve
  // ages already chosen, add empty slots for new children, drop extras
  // when the count goes down.
  while (ages.length < count) ages.push(null);
  while (ages.length > count) ages.pop();

  const html = count === 0 ? '' : ages.map((age, i) => `
    <div class="flex items-center justify-between" style="padding-inline-start:8px;">
      <label for="childAge_${i}" class="text-xs" style="color:var(--text-secondary)" data-i18n="childAgeLabel">Child ${i + 1} age</label>
      <select id="childAge_${i}" class="field-box px-3 py-2 text-sm" style="min-width:110px" onchange="setChildAge(${i}, this.value)">
        <option value="" ${age === null ? 'selected' : ''}>${t('selectAge')}</option>
        ${Array.from({ length: DEFAULT_CHILD_AGE_MAX + 1 }, (_, y) => `<option value="${y}" ${age === y ? 'selected' : ''}>${y}</option>`).join('')}
      </select>
    </div>
  `).join('');
  containers.forEach(c => c.innerHTML = html);
}
function setChildAge(index, value) {
  state.guests.childAges[index] = value === '' ? null : parseInt(value, 10);
  search.updateGuestDisplay();
}
// True once every child in the party has an age selected — callers block
// proceeding (Apply / next booking step) until this passes, since pricing
// can't be computed for a child with no age.
function allChildAgesSelected() {
  return (state.guests.childAges || []).length === state.guests.children
    && (state.guests.childAges || []).every(a => a !== null && a !== undefined && !isNaN(a));
}
function openGuestsModal() {
  document.getElementById('guestsModal').classList.remove('hidden');
  document.getElementById('adultsCount').textContent = state.guests.adults;
  document.getElementById('childrenCount').textContent = state.guests.children;
  document.getElementById('infantsCount').textContent = state.guests.infants;
  document.getElementById('roomsCount').textContent = state.guests.rooms;
  renderChildAgeInputs();
}
function closeGuestsModal() { document.getElementById('guestsModal').classList.add('hidden'); }
function adjustGuestCount(type, delta) {
  const limits = { adults: { min: 1, max: 10 }, children: { min: 0, max: 6 }, infants: { min: 0, max: 4 }, rooms: { min: 1, max: 5 } };
  const newValue = state.guests[type] + delta;
  if (type === 'rooms' && delta < 0) {
    const maxOcc = (state.currentRoom && state.currentRoom.guests) || 2;
    const required = Math.ceil((state.guests.adults + state.guests.children) / maxOcc);
    if (newValue < required) { toast(t('errReduceGuestsFirst'), 'error'); return; }
  }
  if (newValue >= limits[type].min && newValue <= limits[type].max) state.guests[type] = newValue;
  if (type === 'adults' || type === 'children') {
    const maxOcc = (state.currentRoom && state.currentRoom.guests) || 2;
    const required = Math.ceil((state.guests.adults + state.guests.children) / maxOcc);
    if (required > state.guests.rooms && required <= limits.rooms.max) {
      state.guests.rooms = required;
      toast(t('roomCountIncreasedMsg'), 'info');
    }
  }
  document.getElementById('adultsCount').textContent = state.guests.adults;
  document.getElementById('childrenCount').textContent = state.guests.children;
  document.getElementById('infantsCount').textContent = state.guests.infants;
  document.getElementById('roomsCount').textContent = state.guests.rooms;
  if (type === 'children') renderChildAgeInputs();
  search.updateGuestDisplay();
}
function applyGuests() {
  if (!allChildAgesSelected()) { toast(t('errSelectChildAges'), 'error'); return; }
  closeGuestsModal();
  search.updateGuestDisplay();
  bkRefresh();
  toast(t('guestsUpdatedMsg'), 'info');
}

// ==================== DATEPICKER (موحد) ====================
function setDateFieldValue(fieldId, iso) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.dataset.value = iso;
  const valueEl = field.querySelector('.date-field-value');
  if (valueEl) valueEl.textContent = utils.formatDate(iso);
}
function onDateFieldChange(fieldId, iso) {
  if (fieldId === 'checkinDate') {
    const co = document.getElementById('checkoutDate');
    if (co && (!co.dataset.value || co.dataset.value <= iso)) setDateFieldValue('checkoutDate', utils.addDays(iso, 1));
  }
  if (fieldId === 'bkCheckin') {
    state.bookingDraft.checkin = iso;
    const coField = document.getElementById('bkCheckout');
    if (coField && (!coField.dataset.value || coField.dataset.value <= iso)) { const newCo = utils.addDays(iso, 1); setDateFieldValue('bkCheckout', newCo); state.bookingDraft.checkout = newCo; }
  }
  if (fieldId === 'bkCheckout') state.bookingDraft.checkout = iso;
  if (fieldId === 'ekDate') state.bookingDraft.date = iso;
  if (fieldId === 'tkDate') state.bookingDraft.date = iso;
  if (/^(bkCheckin|bkCheckout|ekDate|tkDate)$/.test(fieldId)) bkRefresh();   // summary + totals follow the new date
}

// A field id belongs to a check-in/check-out pair here means: tapping
// EITHER one opens a single connected calendar that stays open across both
// picks, highlights the whole range, and shows a live night count —
// instead of the old flow of two separate single-date pickers that closed
// after every tap.
const DATE_PAIRS = {
  searchCheckIn: { checkin: 'searchCheckIn', checkout: 'searchCheckOut' },
  searchCheckOut: { checkin: 'searchCheckIn', checkout: 'searchCheckOut' },
  bkCheckin: { checkin: 'bkCheckin', checkout: 'bkCheckout' },
  bkCheckout: { checkin: 'bkCheckin', checkout: 'bkCheckout' },
};

const datepicker = {
  target: null,
  viewDate: new Date(),
  minIso: null,
  unavailable: [],
  pair: null,        // {checkin, checkout} field ids, or null for a single-date field
  stage: null,        // 'checkin' | 'checkout' — which end of the range we're picking
  rangeStart: null,
  rangeEnd: null,

  fieldValue(fieldId) {
    if (fieldId === 'searchCheckIn' || fieldId === 'excursionDate') return search.selectedCheckIn;
    if (fieldId === 'searchCheckOut') return search.selectedCheckOut;
    const field = document.getElementById(fieldId);
    return field ? field.dataset.value : '';
  },

  open(fieldId, opts = {}) {
    this.target = fieldId;
    this.minIso = utils.addDays(utils.todayIso(), 1);
    this.unavailable = opts.unavailableIso || [];
    this.pair = DATE_PAIRS[fieldId] || null;

    if (this.pair) {
      this.rangeStart = this.fieldValue(this.pair.checkin) || null;
      this.rangeEnd = this.fieldValue(this.pair.checkout) || null;
      // Tapping the check-out field directly still means "I want to change
      // the check-out date", not restart the whole range.
      this.stage = (fieldId === this.pair.checkout && this.rangeStart) ? 'checkout' : 'checkin';
    } else {
      this.rangeStart = this.fieldValue(fieldId) || null;
      this.rangeEnd = null;
      this.stage = 'checkin';
    }

    const anchor = this.stage === 'checkout' && this.rangeStart ? this.rangeStart : (this.rangeStart || this.minIso);
    this.viewDate = new Date(anchor + 'T00:00:00');
    this.render();
    document.getElementById('datepickerModal').classList.remove('hidden');
  },
  close() { document.getElementById('datepickerModal').classList.add('hidden'); },
  changeMonth(delta) { this.viewDate.setMonth(this.viewDate.getMonth() + delta); this.render(); },

  // Quick presets for the check-in/check-out flow — only shown before a
  // check-in date is picked. Each jumps straight to a finished range.
  applyPreset(nights) {
    const start = this.minIso;
    const end = utils.addDays(start, nights);
    this.commitRange(start, end);
  },

  render() {
    const lang = I18N.get();
    const monthNamesEn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthNamesAr = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    const weekdaysEn = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const weekdaysAr = ['ح','ن','ث','ر','خ','ج','س'];
    const y = this.viewDate.getFullYear(), m = this.viewDate.getMonth();
    document.getElementById('dpMonthLabel').textContent = (lang === 'ar' ? monthNamesAr[m] : monthNamesEn[m]) + ' ' + y;
    document.getElementById('dpWeekdays').innerHTML = (lang === 'ar' ? weekdaysAr : weekdaysEn).map(w => `<span class="text-[10px] font-semibold" style="color:var(--text-secondary)">${w}</span>`).join('');

    // Status line: tells the user which end of the range they're picking,
    // and shows the night count live once both ends are set.
    const statusEl = document.getElementById('dpStatus');
    if (statusEl) {
      if (!this.pair) {
        statusEl.textContent = '';
      } else if (this.rangeStart && this.rangeEnd) {
        const nights = Math.round((new Date(this.rangeEnd) - new Date(this.rangeStart)) / 86400000);
        statusEl.textContent = (lang === 'ar' ? `${nights} ليلة — ` : `${nights} night${nights !== 1 ? 's' : ''} — `) +
          utils.formatDate(this.rangeStart) + ' → ' + utils.formatDate(this.rangeEnd);
      } else if (this.stage === 'checkout') {
        statusEl.textContent = t('selectCheckoutDate');
      } else {
        statusEl.textContent = t('selectCheckinDate');
      }
    }
    const presetsEl = document.getElementById('dpPresets');
    if (presetsEl) presetsEl.style.display = (this.pair && this.stage === 'checkin' && !this.rangeEnd) ? 'flex' : 'none';

    const first = new Date(y, m, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = new Date(); today.setHours(0,0,0,0);
    const effectiveMin = (this.stage === 'checkout' && this.rangeStart) ? utils.addDays(this.rangeStart, 1) : this.minIso;

    let html = '';
    for (let i = 0; i < startDay; i++) html += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(y, m, d);
      const isBeforeMin = iso < effectiveMin;
      const isToday = dateObj.getTime() === today.getTime();
      const isUnavailable = this.unavailable.includes(iso);
      const isDisabled = isBeforeMin || isUnavailable || isToday;

      let cls = 'dp-day';
      if (this.pair) {
        const isStart = iso === this.rangeStart;
        const isEnd = iso === this.rangeEnd;
        const inRange = this.rangeStart && this.rangeEnd && iso > this.rangeStart && iso < this.rangeEnd;
        if (isStart || isEnd) cls += ' dp-day-endpoint';
        else if (inRange) cls += ' dp-day-inrange';
      } else if (iso === this.rangeStart) {
        cls += ' dp-day-endpoint';
      }
      if (isDisabled) cls += ' dp-day-disabled';

      html += `<button type="button" ${isDisabled ? 'disabled' : ''} onclick="datepicker.select('${iso}')" class="${cls}">${d}</button>`;
    }
    document.getElementById('dpGrid').innerHTML = html;
  },

  commitRange(startIso, endIso) {
    this.rangeStart = startIso; this.rangeEnd = endIso;
    if (this.pair.checkin === 'searchCheckIn') {
      search.selectedCheckIn = startIso; search.selectedCheckOut = endIso;
      search.updateDateDisplays();
    } else {
      setDateFieldValue(this.pair.checkin, startIso);
      setDateFieldValue(this.pair.checkout, endIso);
      state.bookingDraft.checkin = startIso;
      state.bookingDraft.checkout = endIso;
      bkRefresh();
    }
    this.render();
    setTimeout(() => this.close(), 350); // brief pause so the user sees the confirmed range/night count before it closes
  },

  select(iso) {
    if (this.target === 'excursionDate') {
      search.selectedCheckIn = iso;
      search.selectedCheckOut = null;
      search.updateDateDisplays();
      this.rangeStart = iso;
      this.render();                   // show the orange highlight before closing
      setTimeout(() => this.close(), 300);
      return;
    }
    if (!this.pair) {
      // Any other single-date field (excursion/transfer booking dates —
      // ekDate, tkDate). Same as above: highlight first, then close, so
      // the picked date visibly turns orange like check-in/check-out do.
      setDateFieldValue(this.target, iso);
      if (typeof onDateFieldChange === 'function') onDateFieldChange(this.target, iso);
      this.rangeStart = iso;
      this.render();
      setTimeout(() => this.close(), 300);
      return;
    }

    // Range flow: first tap sets check-in and switches straight to picking
    // check-out in the same open modal; second tap commits the range.
    if (this.stage === 'checkin' || !this.rangeStart) {
      this.rangeStart = iso;
      this.rangeEnd = null;
      this.stage = 'checkout';
      this.render();
      return;
    }
    // Tapping a date before (or equal to) the check-in again just restarts.
    if (iso <= this.rangeStart) {
      this.rangeStart = iso;
      this.rangeEnd = null;
      this.render();
      return;
    }
    this.commitRange(this.rangeStart, iso);
  }
};

// ==================== SEARCH ====================
const search = {
  activeTab: 'hotels',
  selectedCheckIn: null,
  selectedCheckOut: null,
  selectedCategory: 'all',

  // Tabs follow the enabled sections: hotels / excursions / transfers.
  _tabs() {
    return {
      hotels:     { btn: 'searchTabHotels',     form: 'hotelSearchForm',     on: SHOW_HOTELS },
      excursions: { btn: 'searchTabExcursions', form: 'excursionSearchForm', on: SHOW_EXCURSIONS },
      transfers:  { btn: 'searchTabTransfers',  form: 'transferSearchForm',  on: SHOW_TRANSFERS },
    };
  },
  switchTab(tab) {
    const card = document.getElementById('searchCard');
    if (!card) return;                                   // only the home page has the card
    const defs = this._tabs();
    const enabled = Object.keys(defs).filter(k => defs[k].on);
    if (!enabled.length) { card.style.display = 'none'; return; }
    card.style.display = '';
    if (!enabled.includes(tab)) tab = enabled[0];
    const changed = this.activeTab !== tab;
    this.activeTab = tab;

    const tabsContainer = document.getElementById('searchTabsContainer');
    if (tabsContainer) tabsContainer.style.display = enabled.length > 1 ? 'flex' : 'none';
    for (const [k, d] of Object.entries(defs)) {
      const btn = document.getElementById(d.btn), form = document.getElementById(d.form);
      if (btn) { btn.style.display = d.on ? '' : 'none'; btn.classList.toggle('active', k === tab); btn.setAttribute('aria-selected', k === tab ? 'true' : 'false'); }
      if (form) form.style.display = (d.on && k === tab) ? 'block' : 'none';
    }
    this.closeCategoryDropdown();
    this.refreshLabels();
    if (changed || !heroBgInterval) startHeroBackgroundRotation(tab === 'transfers' ? 'excursions' : tab);   // the hero headline stays translated; only the photos follow the tab
  },
  // Re-paint every dynamic label (called after language / data changes).
  refreshLabels() {
    this.updateDateDisplays();
    this.updateGuestDisplay();
    this.setCategory(this.selectedCategory || 'all');
  },

  openGuestDropdown() {
    const dropdown = document.getElementById('searchGuestDropdown');
    if (!dropdown) return;
    dropdown.style.display = 'flex';
  },
  closeGuestDropdown() {
    const dropdown = document.getElementById('searchGuestDropdown');
    if (dropdown) dropdown.style.display = 'none';
    if (!allChildAgesSelected()) { toast(t('errSelectChildAges'), 'error'); return; }
    this.updateGuestDisplay();
  },
  openCategoryDropdown() {
    const dropdown = document.getElementById('searchCategoryDropdown');
    if (!dropdown) return;
    if (dropdown.parentNode !== document.body) document.body.appendChild(dropdown);   // a popup must escape the hero's stacking context
    dropdown.style.display = 'flex'; document.body.classList.add('ds-sheet-open');
    dropdown.querySelector('.ds-category-btn.active')?.focus({ preventScroll: true });
  },
  closeCategoryDropdown() {
    const dropdown = document.getElementById('searchCategoryDropdown');
    if (dropdown) dropdown.style.display = 'none';
    document.body.classList.remove('ds-sheet-open');
  },
  setCategory(category) {
    this.selectedCategory = category;
    const displayEl = document.getElementById('excursionCategoryDisplay');
    if (displayEl) {
      const labels = {
        'all': t('allCategories'),
        'Diving': t('divingSnorkeling'),
        'Desert Safari': t('desertSafari'),
        'City Tour': t('cityTour')
      };
      displayEl.textContent = labels[category] || category;
    }
    document.querySelectorAll('.ds-category-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === category);
    });
  },
  updateDateDisplays() {
    const toDate = (d) => {
      if (!d) return null;
      if (d instanceof Date) return d;
      if (typeof d === 'string' && d.includes('-')) return new Date(d + 'T00:00:00');
      return new Date(d);
    };
    const ci = toDate(this.selectedCheckIn);
    const co = toDate(this.selectedCheckOut);
    const fmt = (d) => {
      if (!d) return '';
      try { return d.toLocaleDateString(I18N.get() || 'en', { day: 'numeric', month: 'short' }); }
      catch (e) { return `${d.getDate()}/${d.getMonth() + 1}`; }
    };
    const checkinDisplay = document.getElementById('checkinDisplay');
    const checkoutDisplay = document.getElementById('checkoutDisplay');
    const excursionDateDisplay = document.getElementById('excursionDateDisplay');
    if (checkinDisplay) checkinDisplay.textContent = ci ? fmt(ci) : t('selectDatePlaceholder');
    if (checkoutDisplay) checkoutDisplay.textContent = co ? fmt(co) : t('selectDatePlaceholder');
    if (excursionDateDisplay) excursionDateDisplay.textContent = ci ? fmt(ci) : t('selectDatePlaceholder');
    const trd = document.getElementById('transferDateDisplay'); if (trd) trd.textContent = ci ? fmt(ci) : t('selectDatePlaceholder');
    this.updatePaxDisplays();
    try { lf.ctxChanged(); } catch (e) {}
  },
  // The stay / trip the person searched for (dates normalised: check-out is always after check-in)
  stay() {
    const ci = this.selectedCheckIn || utils.addDays(utils.todayIso(), 1);
    let co = this.selectedCheckOut; if (!co || co <= ci) co = utils.addDays(ci, 1);
    return { ci, co, nights: Math.max(1, Math.round((new Date(co) - new Date(ci)) / 86400000)) };
  },
  adjustPax(d) {
    const v = (state.tripPax || 2) + d;
    if (v < 1 || v > 15) return;
    state.tripPax = v; this.updatePaxDisplays(); try { lf.ctxChanged(); } catch (e) {}
  },
  updatePaxDisplays() { ['excPaxDisplay', 'trPaxDisplay'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = state.tripPax || 2; }); },
  adjustGuest(type, delta) {
    const limits = { adults: { min:1, max:10 }, children: { min:0, max:6 }, rooms: { min:1, max:5 } };
    const newVal = (state.guests[type] || 0) + delta;
    if (newVal >= limits[type].min && newVal <= limits[type].max) {
      state.guests[type] = newVal;
    }
    document.getElementById('searchAdultCount').textContent = state.guests.adults;
    document.getElementById('searchChildCount').textContent = state.guests.children;
    document.getElementById('searchRoomCount').textContent = state.guests.rooms;
    if (type === 'children') renderChildAgeInputs();
    this.updateGuestDisplay();
  },
  updateGuestDisplay() {
    const childPart = state.guests.children > 0
      ? `${state.guests.children} ${t('children')} (${(state.guests.childAges || []).map(a => a === null || a === undefined ? '?' : a).join(', ')})`
      : `0 ${t('children')}`;
    const text = `${state.guests.adults} ${t('adults')}, ${childPart}, ${state.guests.rooms} ${t('roomsCountSuffix')}`;
    const el = document.getElementById('guestsDisplay');
    if (el) el.textContent = text;
    try { lf.ctxChanged(); } catch (e) {}
  },
  performSearch() {
    if (this.activeTab === 'hotels') {
      if (!this.selectedCheckIn || !this.selectedCheckOut) {
        toast(t('errSelectDatesFirst'), 'error');
        return;
      }
      nav.go('hotels');
    } else if (this.activeTab === 'transfers') {
      const q = (document.getElementById('homeTransferQuery')?.value || '').trim();
      state.transferSearchQuery = q.toLowerCase();
      nav.go('transfers');
    } else {
      this.applyExcursionSearch();
    }
  },
  applyExcursionSearch() {
    state.currentExcursionFilter = this.selectedCategory;
    nav.go('excursions');
  },
  handle(q) { state.searchQuery = q.toLowerCase(); },
  filterCategory(cat) {
    state.currentFilter = cat;
    if (typeof hotels !== 'undefined') hotels.render();
  },
  filterExcursionCategory(cat) {
    state.currentExcursionFilter = cat;
    if (typeof excursionsUi !== 'undefined') excursionsUi.render();
  },
  init() {
    const tomorrow = new Date();
    tomorrow.setHours(0,0,0,0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    this.selectedCheckIn = utils.isoLocal(tomorrow);
    this.selectedCheckOut = utils.isoLocal(dayAfter);
    this.selectedCategory = 'all';
    this.activeTab = this.activeTab && this._tabs()[this.activeTab]?.on ? this.activeTab : (SHOW_HOTELS ? 'hotels' : SHOW_EXCURSIONS ? 'excursions' : 'transfers');
    this.switchTab(this.activeTab);
  }
};

// ==================== HERO BACKGROUND ROTATION (Mobile & Desktop) ====================
const HERO_BACKGROUNDS = {
  hotels: {
    desktop: [
      'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1920&q=90', // فندق فاخر واسع
      'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1920&q=90', // مسبح بانورامي
      'https://images.unsplash.com/photo-1548625149-fc4a29cf7092?auto=format&fit=crop&w=1920&q=90', // غرفة فاخرة
      'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1920&q=90'  // إطلالة بحرية
    ],
    mobile: [
      'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&w=800&q=90', // صورة عمودية 1
      'https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?auto=format&fit=crop&w=800&q=90', // صورة عمودية 2
      'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=800&q=90', // صورة عمودية 3
      'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=800&q=90'  // صورة عمودية 4
    ]
  },
  excursions: {
    desktop: [
    'https://images.unsplash.com/photo-1682687982049-b3d433368cd1?q=80&w=1171&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    'https://res.klook.com/image/upload/fl_lossy.progressive,q_65/activities/qfewhof69v7wd1y8gas4.webp',
    'https://res.klook.com/image/upload/fl_lossy.progressive,q_65/activities/bz6bnv9riohbxx9u0rag.webp'
    ],
    mobile: [
    'https://images.unsplash.com/photo-1682687982141-0143020ed57a?q=80&w=1287&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    'https://res.klook.com/image/upload/fl_lossy.progressive,q_65/activities/qfewhof69v7wd1y8gas4.webp',
    'https://res.klook.com/image/upload/fl_lossy.progressive,q_65/activities/bz6bnv9riohbxx9u0rag.webp'
    ]
  }
};

let heroBgIndex = 0;
let heroBgInterval = null;
let heroCurrentTab = SHOW_HOTELS ? 'hotels' : 'excursions';
let heroIsMobile = false;

// كشف إذا كانت الشاشة جوال (أقل من 768px)
function detectMobile() {
  return window.innerWidth < 768;
}

// الحصول على قائمة الخلفيات المناسبة حسب نوع الجهاز والتبويب
function getHeroBackgrounds(tab) {
  const data = HERO_BACKGROUNDS[tab] || HERO_BACKGROUNDS.hotels;
  const isMobile = detectMobile();
  if (isMobile && data.mobile && data.mobile.length > 0) {
    return data.mobile;
  }
  return data.desktop;
}

function startHeroBackgroundRotation(tab) {
  heroCurrentTab = tab;
  heroIsMobile = detectMobile();
  stopHeroBackgroundRotation();
  if (!document.getElementById('heroBgImage')) return;   // only the home page has a hero
  
  const backgrounds = getHeroBackgrounds(tab);
  heroBgIndex = 0;
  setHeroImage(backgrounds[0]);
  heroBgInterval = setInterval(() => {
    heroBgIndex = (heroBgIndex + 1) % backgrounds.length;
    setHeroImage(backgrounds[heroBgIndex]);
  }, 5000);
}

function stopHeroBackgroundRotation() {
  if (heroBgInterval) { clearInterval(heroBgInterval); heroBgInterval = null; }
}

function setHeroImage(src) {
  const bgImg = document.getElementById('heroBgImage');
  if (!bgImg) return;
  bgImg.style.opacity = '0';
  setTimeout(() => {
    bgImg.src = src;
    bgImg.style.opacity = '1';
  }, 500);
}

// إعادة تشغيل التدوير عند تغيير حجم الشاشة (إذا تغير نوع الجهاز)
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const newIsMobile = detectMobile();
    if (newIsMobile !== heroIsMobile) {
      heroIsMobile = newIsMobile;
      startHeroBackgroundRotation(heroCurrentTab);
    }
  }, 400);
});

// إعادة تشغيل عند تغيير الاتجاه (Portrait/Landscape)
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    const newIsMobile = detectMobile();
    if (newIsMobile !== heroIsMobile) {
      heroIsMobile = newIsMobile;
      startHeroBackgroundRotation(heroCurrentTab);
    }
  }, 300);
});

// ==================== CURRENCY CHANGE ====================
function changeCurrency(c) {
  if (!currencyAvailable) c = 'EGP';
  state.currency = c;
  localStorage.setItem('ds_display_currency', c);
  applyCurrencyAvailability();
  refreshCatalogUI();
  bookings.render();
  if (SHOW_HOTELS) favorites.render();
  toast(t('currencyUpdatedMsg'), 'info');
}

// ==================== ROOM PREVIEW ====================
function showRoomPreview(hotelId, roomIndex) {
  if (!SHOW_HOTELS) return;
  const h = CATALOG.hotels.find(x => x.id === hotelId);
  const r = h?.rooms?.[roomIndex];
  if (!r) return;
  document.getElementById('roomPreviewContent').innerHTML = `
    <div class="relative h-52">
      <img alt="" src="${getImageUrl(r.image)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover">
      <button onclick="closeRoomPreview()" class="absolute top-3 right-3 w-9 h-9 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900"><i class="fa-solid fa-xmark"></i></button>
      <div class="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"></div>
      <p class="absolute bottom-3 right-3 left-3 text-white font-display font-bold text-lg">${r.type}</p>
    </div>
    <div class="p-5" style="background:var(--bg-card)">
      <div class="flex items-center gap-3 text-xs mb-3" style="color:var(--text-secondary)">
        <span><i class="fa-solid fa-user-group text-violet-500"></i> ${r.guests || 2} Guests</span>
        <span><i class="fa-solid fa-ruler-combined text-violet-500"></i> ${r.size || '25m²'}</span>
        <span><i class="fa-solid fa-bed text-violet-500"></i> ${r.beds || '1 Queen Bed'}</span>
      </div>
      <p class="text-sm leading-relaxed mb-4" style="color:var(--text-secondary)">${r.description || ''}</p>
      <button onclick="selectRoomOnDetail('${hotelId}', ${roomIndex}, { closeModal: true })" class="btn-gold w-full py-3 rounded-2xl font-bold text-ink-900">${t('selectThisRoomBtn')}</button>
    </div>`;
  document.getElementById('roomPreviewModal').classList.remove('hidden');
}
function closeRoomPreview() { if (!SHOW_HOTELS) return; document.getElementById('roomPreviewModal').classList.add('hidden'); }

// ==================== UI RENDERERS ====================
// Picks the hotel's cheapest room and prices it for whatever the person
// has actually chosen in the search bar (adults/children ages/rooms, and
// check-in/check-out if both are set) using the same computeRoomPricing()
// the real booking flow uses — instead of always showing the hotel's raw
// base rate no matter what was searched.
function estimatedHotelPricePerNight(h) {
  const cheapestRoom = (h.rooms && h.rooms.length)
    ? h.rooms.reduce((min, r) => (r.price < min.price ? r : min), h.rooms[0])
    : { price: h.price };
  const roomsCount = state.guests.rooms || 1;
  const { nights } = search.stay();
  const pricing = computeRoomPricing(cheapestRoom, state.guests, roomsCount, nights);
  const perNight = Math.round(pricing.roomTotal / (roomsCount * nights));
  return { perNight, total: pricing.roomTotal, nights, isEstimate: false };
}
// true when at least one night of the searched stay is blocked for this hotel
function hotelUnavailable(h) {
  const un = h.unavailableDates; if (!Array.isArray(un) || !un.length) return false;
  const { ci, co } = search.stay();
  for (let d = ci; d < co; d = utils.addDays(d, 1)) if (un.includes(d)) return true;
  return false;
}

const ui = {
  renderHotelCard(h) {
    if (!SHOW_HOTELS) return '';
    const img = getImageUrl(h.image);
    const isFav = state.favorites.includes(h.id);
    const { perNight, isEstimate } = estimatedHotelPricePerNight(h);
    return `
      <div onclick="showHotelPage('${h.id}')" class="hotel-card cursor-pointer">
        <div class="hotel-card-img-wrap">
          <img alt="" src="${img}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="hotel-card-img hover:scale-105 transition-transform duration-500">
          ${h.category ? `<span class="absolute top-2 left-2 bg-violet-600/90 text-white text-[9px] font-bold px-2 py-0.5 rounded-md">${hotels.categoryLabel(h.category)}</span>` : ''}
          <div class="absolute bottom-2 right-2 rating-pill px-1.5 py-0.5 rounded-md flex items-center gap-1"><i class="fa-solid fa-star text-gold-400 text-[8px]"></i><span class="text-[9px] font-bold text-gold-400">${h.rating}</span></div>
        </div>
        <div class="hotel-card-body">
          <div>
            <div class="flex items-start justify-between mb-1">
              <h3 class="font-display font-bold text-sm md:text-base line-clamp-2">${h.name}</h3>
              ${h.bestseller ? `<div class=" top-2 right-2 badge-bestseller text-[8px] font-black px-2 py-0.5 rounded-md"><i class="fa-solid fa-crown"></i></div>` : ''}
             </div>
            <p class="text-[10px] mb-1.5"><i class="fa-solid fa-location-dot text-violet-500 text-[8px]"></i> ${(h.location || '').split(',')[0]}</p>
          </div>
          <div class="flex items-center justify-between">
            <div class="hotel-card-amenities">${(h.amenities || []).slice(0, 2).map(a => `<span class="px-1.5 py-0.5 rounded" style="background:var(--bg-field)">${a}</span>`).join('')}</div>
            <div class="text-left flex-shrink-0"><p class="text-base md:text-lg font-bold text-violet-500 tabular-nums">${utils.formatPrice(perNight)}</p><p class="text-[8px]">${isEstimate ? t('estimatedPerNight') : '/ ' + t('nightLabel')}</p></div>
          </div>
        </div>
      </div>`;
  },
  renderFeaturedHotels() {
    if (!SHOW_HOTELS) return;
    const el = document.getElementById('featuredHotels');
    if (el) {
      el.className = 'space-y-3 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-6';
      el.innerHTML = CATALOG.hotels.slice(0, 3).map(h => this.renderHotelCard(h)).join('');
    }
  },
  setDefaultDates() {
    const tomorrow = utils.addDays(utils.todayIso(), 1);
    const dayAfter = utils.addDays(utils.todayIso(), 2);
    const checkin = document.getElementById('checkinDate');
    const checkout = document.getElementById('checkoutDate');
    const excursionDate = document.getElementById('excursionDate');
    const tsDate = document.getElementById('tsDate');

    if (checkin) checkin.dataset.value = tomorrow;
    if (checkout) checkout.dataset.value = dayAfter;
    if (excursionDate) excursionDate.dataset.value = tomorrow;
    if (tsDate) tsDate.dataset.value = tomorrow;

    if (checkin) checkin.querySelector('.date-field-value').textContent = utils.formatDate(tomorrow);
    if (checkout) checkout.querySelector('.date-field-value').textContent = utils.formatDate(dayAfter);
    if (excursionDate) excursionDate.querySelector('.date-field-value').textContent = utils.formatDate(tomorrow);
    if (tsDate) tsDate.querySelector('.date-field-value').textContent = utils.formatDate(tomorrow);
  }
};

// ==================== HOTELS RENDERER ====================
const hotels = {
  // Known slugs already have their own translation key of the same name
  // (budget/luxury/family/resort/beachfront); anything else falls back to
  // catOther instead of printing raw, untranslated data on the card.
  categoryLabel(raw) {
    const known = ['budget', 'luxury', 'family', 'resort', 'beachfront'];
    const slug = (raw || '').toLowerCase();
    return known.includes(slug) ? t(slug) : t('catOther');
  },
  filteredSorted() {
    const q = (state.searchQuery || '').trim().toLowerCase();
    let list = CATALOG.hotels.filter(h => {
      if (state.currentFilter !== 'all' && (h.category || '').toLowerCase() !== state.currentFilter) return false;
      if (q && !(`${h.name} ${h.location || ''}`.toLowerCase().includes(q))) return false;
      if (hotelUnavailable(h)) return false;
      const pn = estimatedHotelPricePerNight(h).perNight;
      if (state.hotelMinPrice != null && pn < state.hotelMinPrice) return false;
      if (state.hotelMaxPrice != null && pn > state.hotelMaxPrice) return false;
      if (state.hotelMinRating && Number(h.rating || 0) < state.hotelMinRating) return false;
      return true;
    });
    const sorted = list.slice();
    const pn = (h) => estimatedHotelPricePerNight(h).perNight;
    if (state.hotelSortBy === 'priceLow') sorted.sort((a, b) => pn(a) - pn(b));
    else if (state.hotelSortBy === 'priceHigh') sorted.sort((a, b) => pn(b) - pn(a));
    else if (state.hotelSortBy === 'rating') sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else sorted.sort((a, b) => (b.reviews || 0) - (a.reviews || 0)); // 'popular' default
    return sorted;
  },
  render() {
    if (!SHOW_HOTELS) return;
    const list = document.getElementById('hotelsList');
    if (!list) return;
    document.querySelectorAll('.hotel-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === state.currentFilter);
    });
    const searchInput = document.getElementById('hotelSearchInput');
    if (searchInput && searchInput.value !== state.searchQuery) searchInput.value = state.searchQuery;
    const sortSelect = document.getElementById('hotelSortSelect');
    if (sortSelect) sortSelect.value = state.hotelSortBy;

    const filtered = this.filteredSorted();
    const countEl = document.getElementById('hotelsCount'); if (countEl) countEl.textContent = filtered.length;
    list.className = 'lc-grid pb-28';
    if (filtered.length === 0) {
      list.innerHTML = `<div class="text-center py-16 col-span-full"><p class="mb-2">${t('noHotelsFoundMsg')}</p><p class="text-xs" style="color:var(--text-secondary)">${t('noResultsFilterHint')}</p></div>`;
      return;
    }
    list.innerHTML = filtered.map(h => this.listCard(h)).join('');
  },
  listCard(h) {
    const { perNight, total, nights } = estimatedHotelPricePerNight(h);
    return lcCard({ click: `showHotelPage('${h.id}')`, img: getImageUrl(h.image), badge: h.category ? this.categoryLabel(h.category) : '', rating: h.rating, reviews: h.reviews,
      title: lf.esc(h.name), loc: lf.esc((h.location || '').split(',')[0]), tags: (h.amenities || []).map(lf.esc),
      from: `${utils.formatPrice(perNight)} / ${t('nightLabel')}`, price: utils.formatPrice(total), per: t(nights === 1 ? 'nightsTotal1' : 'nightsTotal').replace('{n}', nights), cta: t('viewDetailsBtn') });
  },
  onSearchInput(q) {
    state.searchQuery = q.toLowerCase();
    clearTimeout(this._searchDebounceTimer);
    this._searchDebounceTimer = setTimeout(() => this.render(), 250);
  },
  onSortChange(v) { state.hotelSortBy = v; this.render(); },
  onPriceChange(min, max) {
    state.hotelMinPrice = min === '' || min == null ? null : Number(min);
    state.hotelMaxPrice = max === '' || max == null ? null : Number(max);
    this.render();
  },
  onMinRatingChange(v) { state.hotelMinRating = Number(v) || 0; this.render(); },
  clearFilters() {
    state.currentFilter = 'all';
    state.searchQuery = '';
    state.hotelSortBy = 'popular';
    state.hotelMinPrice = null;
    state.hotelMaxPrice = null;
    state.hotelMinRating = 0;
    const priceMin = document.getElementById('hotelMinPriceInput'); if (priceMin) priceMin.value = '';
    const priceMax = document.getElementById('hotelMaxPriceInput'); if (priceMax) priceMax.value = '';
    const ratingSel = document.getElementById('hotelMinRatingSelect'); if (ratingSel) ratingSel.value = '0';
    this.render();
  }
};

// ==================== EXCURSIONS RENDERER (NEW CREATIVE CARD) ====================
const excursionsUi = {
  renderFeatured() {
    if (!SHOW_EXCURSIONS) return;
    const el = document.getElementById('featuredExcursions');
    if (el) {
      el.className = 'results-scroll-snap';
      el.innerHTML = CATALOG.excursions.slice(0, 4).map(x => this.renderSliderCard(x)).join('');
      el.querySelectorAll('.creative-card').forEach(card => {
        card.style.scrollSnapAlign = 'center';
      });
    }
  },
  renderSliderCard(x) {
    const img = getImageUrl(x.image);
    const rating = Number(x.rating || 0).toFixed(1);
    const stars = utils.renderStars(x.rating || 0);
    const price = utils.formatPrice(x.price);
    const duration = x.duration || t('fullDayLabel');
    const category = x.category || 'Activity';
    const reviewCount = x.reviews || 0;

    return `
      <div class="creative-card" onclick="showExcursionPage('${x.id}')">
        <div class="card-image-container">
          <img src="${img}" alt="${esc(x.title)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
          <div class="image-overlay-top"></div>
          <div class="image-overlay"></div>
          <div class="duration-badge"><i class="far fa-clock"></i> ${esc(duration)}</div>
          <button class="share-btn-top" data-share="https://www.discover-sharm.com/p/tour.html?trip-id=${x.id}" onclick="event.stopPropagation();"><i class="fas fa-share-alt"></i></button>
          <div class="card-content">
            <h3 class="card-title">${esc(x.title)}</h3>
            <div class="rating-review-badge">
              <div class="stars-small">${stars}</div>
              <span class="rating-number">${rating}</span>
              <span class="review-count">${reviewCount} reviews</span>
            </div>
            <div class="card-action-row">
              <div class="price-block">
                <span class="price-from">${t('fromLabel')}</span>
                <div class="price-value" data-price-egp="${x.price}">${price}</div>
                <span class="price-per-person">/ ${t('perPersonLabel')}</span>
              </div>
              <button class="book-btn action-btn" onclick="event.stopPropagation(); showExcursionPage('${x.id}')">
                <i class="fas fa-bolt"></i> ${t('bookNowBtn')}
              </button>
            </div>
          </div>
        </div>
      </div>`;
  },
  // Excursion category values in the catalog are raw, inconsistently-cased
  // strings ("Boat trip", "Desert Safari", ...) — never translated, and only
  // matched against filter chips by exact string equality (so "Boat Trip" on
  // a chip would silently fail to match "Boat trip" in the data). This maps
  // any raw category text onto one of the canonical slugs the filter chips
  // and the catXxx translation keys already use, so both the chip matching
  // and the on-card label work regardless of exactly how the source data
  // capitalized or phrased it. Unrecognized categories fall back to catOther
  // instead of ever printing raw, untranslated English on the card.
  categorySlug(raw) {
    const s = (raw || '').toLowerCase();
    if (s.includes('div') || s.includes('snork')) return 'diving';
    if (s.includes('desert') || s.includes('safari')) return 'desert';
    if (s.includes('boat') || s.includes('sail') || s.includes('cruise')) return 'boat';
    if (s.includes('city') || s.includes('tour')) return 'city';
    return 'other';
  },
  categoryLabel(raw) {
    const slug = this.categorySlug(raw);
    const key = { diving: 'catDiving', desert: 'catDesert', boat: 'catBoat', city: 'catCity', other: 'catOther' }[slug];
    return t(key);
  },
  // Applies every active filter (category, free-text search, price range,
  // minimum rating) together, then the chosen sort — this is what makes the
  // filters combine instead of only the last one clicked taking effect.
  filteredSorted() {
    const q = (state.excursionSearchQuery || '').trim().toLowerCase();
    let list = CATALOG.excursions.filter(x => {
      if (state.currentExcursionFilter !== 'all' && this.categorySlug(x.category) !== state.currentExcursionFilter) return false;
      if (q && !(`${x.title} ${x.description || ''}`.toLowerCase().includes(q))) return false;
      if (state.excursionMinPrice != null && x.price < state.excursionMinPrice) return false;
      if (state.excursionMaxPrice != null && x.price > state.excursionMaxPrice) return false;
      if (state.excursionMinRating && Number(x.rating || 0) < state.excursionMinRating) return false;
      return true;
    });
    const sorted = list.slice();
    if (state.excursionSortBy === 'priceLow') sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
    else if (state.excursionSortBy === 'priceHigh') sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
    else if (state.excursionSortBy === 'rating') sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else sorted.sort((a, b) => (b.reviews || 0) - (a.reviews || 0)); // 'popular' default
    return sorted;
  },
  render() {
    if (!SHOW_EXCURSIONS) return;
    const list = document.getElementById('excursionsList');
    if (!list) return;
    // Keep the chip row, search box, and sort/price controls in sync with state
    // every render — covers both a fresh page load and a filter changing while
    // the person is already on this page (previously this list never
    // re-rendered on a chip click at all, so filtering silently did nothing).
    document.querySelectorAll('.excursion-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === state.currentExcursionFilter);
    });
    const searchInput = document.getElementById('excursionSearchInput');
    if (searchInput && searchInput.value !== state.excursionSearchQuery) searchInput.value = state.excursionSearchQuery;
    const sortSelect = document.getElementById('excursionSortSelect');
    if (sortSelect) sortSelect.value = state.excursionSortBy;

    const filtered = this.filteredSorted();
    const countEl = document.getElementById('excursionsCount'); if (countEl) countEl.textContent = filtered.length;
    list.className = 'lc-grid pb-28';
    if (filtered.length === 0) {
      list.innerHTML = `<div class="text-center py-16 col-span-full"><p class="mb-2">${t('noExcursionsFoundMsg')}</p><p class="text-xs" style="color:var(--text-secondary)">${t('noResultsFilterHint')}</p></div>`;
      return;
    }
    list.innerHTML = filtered.map(x => this.renderCard(x)).join('');
  },
  onSearchInput(q) {
    state.excursionSearchQuery = q;
    clearTimeout(this._searchDebounceTimer);
    this._searchDebounceTimer = setTimeout(() => this.render(), 250);
  },
  onSortChange(v) { state.excursionSortBy = v; this.render(); },
  onPriceChange(min, max) {
    state.excursionMinPrice = min === '' || min == null ? null : Number(min);
    state.excursionMaxPrice = max === '' || max == null ? null : Number(max);
    this.render();
  },
  onMinRatingChange(v) { state.excursionMinRating = Number(v) || 0; this.render(); },
  clearFilters() {
    state.currentExcursionFilter = 'all';
    state.excursionSearchQuery = '';
    state.excursionSortBy = 'popular';
    state.excursionMinPrice = null;
    state.excursionMaxPrice = null;
    state.excursionMinRating = 0;
    const priceMin = document.getElementById('excursionMinPriceInput'); if (priceMin) priceMin.value = '';
    const priceMax = document.getElementById('excursionMaxPriceInput'); if (priceMax) priceMax.value = '';
    const ratingSel = document.getElementById('excursionMinRatingSelect'); if (ratingSel) ratingSel.value = '0';
    this.render();
  },
  renderCard(x) {
    return lcCard({ click: `showExcursionPage('${x.id}')`, img: getImageUrl(x.image), badge: this.categoryLabel(x.category), rating: x.rating ? Number(x.rating).toFixed(1) : '', reviews: x.reviews,
      title: lf.esc(x.title), loc: lf.esc(x.meetingPoint || t('sharmElSheikhShort')), meta: [['fa-regular fa-clock', lf.esc(x.duration || t('fullDayLabel'))]],
      from: `${utils.formatPrice(x.price)} / ${t('perPersonLabel')}`, price: utils.formatPrice(x.price * (state.tripPax || 2)), per: t((state.tripPax || 2) === 1 ? 'forPeopleN1' : 'forPeopleN').replace('{n}', state.tripPax || 2), cta: t('bookNowBtn') });
  }
};

// ==================== TRANSFERS RENDERER ====================
const transfersUi = {
  filteredSorted() {
    const q = (state.transferSearchQuery || '').trim().toLowerCase();
    let list = CATALOG.transfers.filter(v => {
      if (q && !(`${v.vehicleType} ${v.description || ''}`.toLowerCase().includes(q))) return false;
      if (state.transferMinPrice != null && v.price < state.transferMinPrice) return false;
      if (state.transferMaxPrice != null && v.price > state.transferMaxPrice) return false;
      if (state.transferMinCapacity && Number(v.capacity || 0) < state.transferMinCapacity) return false;
      if (Number(v.capacity || 0) < (state.tripPax || 2)) return false;   // the vehicle must fit the party
      return true;
    });
    const sorted = list.slice();
    if (state.transferSortBy === 'priceLow') sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
    else if (state.transferSortBy === 'priceHigh') sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
    else if (state.transferSortBy === 'capacity') sorted.sort((a, b) => (b.capacity || 0) - (a.capacity || 0));
    else sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0)); // 'popular' default
    return sorted;
  },
  render() {
    if (!SHOW_TRANSFERS) return;
    const list = document.getElementById('transfersList');
    if (!list) return;
    const searchInput = document.getElementById('transferSearchInput');
    if (searchInput && searchInput.value !== state.transferSearchQuery) searchInput.value = state.transferSearchQuery;
    const sortSelect = document.getElementById('transferSortSelect');
    if (sortSelect) sortSelect.value = state.transferSortBy;

    const filtered = this.filteredSorted();
    const countEl = document.getElementById('transfersCount'); if (countEl) countEl.textContent = filtered.length;
    list.className = 'lc-grid pb-28';
    if (filtered.length === 0) {
      list.innerHTML = `<div class="text-center py-16 col-span-full"><p class="mb-2">${t('noTransfersFoundMsg')}</p><p class="text-xs" style="color:var(--text-secondary)">${t('noResultsFilterHint')}</p></div>`;
      return;
    }
    list.innerHTML = filtered.map(v => this.renderCard(v)).join('');
  },
  onSearchInput(q) {
    state.transferSearchQuery = q;
    clearTimeout(this._searchDebounceTimer);
    this._searchDebounceTimer = setTimeout(() => this.render(), 250);
  },
  onSortChange(v) { state.transferSortBy = v; this.render(); },
  onPriceChange(min, max) {
    state.transferMinPrice = min === '' || min == null ? null : Number(min);
    state.transferMaxPrice = max === '' || max == null ? null : Number(max);
    this.render();
  },
  onMinCapacityChange(v) { state.transferMinCapacity = Number(v) || 0; this.render(); },
  clearFilters() {
    state.transferSearchQuery = '';
    state.transferSortBy = 'popular';
    state.transferMinPrice = null;
    state.transferMaxPrice = null;
    state.transferMinCapacity = 0;
    const priceMin = document.getElementById('transferMinPriceInput'); if (priceMin) priceMin.value = '';
    const priceMax = document.getElementById('transferMaxPriceInput'); if (priceMax) priceMax.value = '';
    const capSel = document.getElementById('transferMinCapacitySelect'); if (capSel) capSel.value = '0';
    this.render();
  },
  renderCard(v) {
    return lcCard({ click: `showTransferPage('${v.id}')`, img: getImageUrl(v.image), rating: v.rating || 4.5,
      title: lf.esc(v.vehicleType), meta: [['fa-solid fa-user-group', `${lf.esc(v.capacity)} ${t('passengersLower')}`], ['fa-regular fa-calendar', utils.formatDate(search.stay().ci)]], tags: (v.features || []).map(lf.esc),
      from: t('oneWayTripLabel'), price: utils.formatPrice(v.price), cta: t('viewDetailsBtn') });
  }
};

// ==================== SHOW TRANSFER PAGE ====================
function showTransferPage(id, opts = {}) {
  const v = CATALOG.transfers.find(t => t.id === id);
  if (!v) return toast(t('errTransferNotFound'), 'error');
  state.currentTransfer = v;
  const old = document.getElementById('transferDetailPage'); if (old) old.remove();
  const page = document.createElement('div'); page.id = 'transferDetailPage'; page.className = 'page';
  const capacityLine = t('upToCapacityLabel').replace('{n}', v.capacity);
  const bookingCard = `
    <div class="detail-price-row">
      <div><p class="text-[9px]">${t('oneWayTripLabel')}</p><p class="text-xl font-bold text-violet-500 tabular-nums">${utils.formatPrice(v.price)}</p></div>
      <div class="detail-sidebar-rating"><i class="fa-solid fa-star text-gold-400"></i> ${Number(v.rating || 4.5).toFixed(1)}${v.reviews ? ` <span>(${v.reviews})</span>` : ''}</div>
    </div>
    <button onclick="startTransferBooking('${v.id}')" class="btn-gold w-full py-3.5 rounded-2xl font-bold text-ink-900">${t('bookNowBtn')}</button>
    <p class="detail-sidebar-note"><i class="fa-solid fa-users"></i> ${capacityLine}</p>`;
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-72 detail-gallery">
        <div id="transferGallery" class="gallery-track w-full h-full flex overflow-x-auto snap-x snap-mandatory scroll-smooth" style="scrollbar-width:none" onscroll="onGalleryScroll(this, 'transferGalleryDots')">
          ${(v.images || [v.image]).map((img, i) => `<img alt="" src="${getImageUrl(img)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover flex-shrink-0 snap-center" style="min-width:100%" onclick="openLightbox(${i})">`).join('')}
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/10 pointer-events-none"></div>
        <button type="button" onclick="closeTransferPage()" aria-label="Back" data-back class="ds-detail-back absolute top-4 start-4 w-11 h-11 rounded-full flex items-center justify-center z-10"><i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
        <div class="absolute top-4 left-4 bg-violet-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full z-10"><i class="fa-solid fa-shuttle-van"></i> ${v.vehicleType}</div>
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10" id="transferGalleryDots">${(v.images || [v.image]).map((_, i) => `<div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
      </div>
      ${renderPhotoGrid(v.images || [v.image])}
      <div class="detail-layout">
        <div class="detail-main relative -mt-6 rounded-t-[28px] p-5 space-y-6 pb-32" style="background:var(--bg-card)">
        <div>
          <h2 class="font-display text-2xl font-bold mb-1 leading-tight">${v.vehicleType} ${t('transferWord')}</h2>
          <div class="flex items-center gap-2 text-sm mb-1">${utils.renderStars(v.rating || 4.5)}<span class="text-xs">${Number(v.rating || 4.5).toFixed(1)}${v.reviews ? ` (${v.reviews})` : ''}</span></div>
          <p class="text-xs"><i class="fa-solid fa-users text-violet-500"></i> ${capacityLine}</p>
        </div>

        <div class="trust-badge-row">
          <div class="trust-badge"><i class="fa-solid fa-star"></i><span>${Number(v.rating || 4.5).toFixed(1)} ${t('ratingLabel')}</span></div>
          <div class="trust-badge"><i class="fa-solid fa-rotate-left"></i><span>${t('freeCancellationBadge')}</span></div>
          <div class="trust-badge"><i class="fa-solid fa-bolt"></i><span>${t('instantConfirmationBadge')}</span></div>
          <div class="trust-badge"><i class="fa-solid fa-shield-heart"></i><span>${t('secureBookingBadge')}</span></div>
        </div>

        <div>
          <h3 class="font-display text-lg font-bold mb-2">${t('aboutTransferLabel')}</h3>
          <p class="text-sm leading-relaxed">${v.fullDescription || v.description}</p>
        </div>

        ${(v.features || []).length ? `
        <div>
          <h3 class="font-display text-lg font-bold mb-3">${t('featuresLabel')}</h3>
          <div class="grid grid-cols-2 gap-3">
            ${v.features.map(f => `<div class="field-box rounded-xl p-3 flex items-center gap-2 text-sm"><i class="fa-solid fa-check text-green-500"></i> ${f}</div>`).join('')}
          </div>
        </div>` : ''}

        <div class="card rounded-2xl p-4">
          <h3 class="font-display text-lg font-bold mb-4">${t('realStoriesTravelersHeader')}</h3>
          <div class="rating-summary-block">
            <div class="rating-summary-score">
              <p class="rating-summary-number" id="transferRatingSummary">–</p>
              <div class="text-gold-500 text-sm" id="transferRatingStars"></div>
              <p class="rating-summary-count" id="transferRatingCount"></p>
            </div>
            <div class="rating-bar-chart" id="transferRatingBars"></div>
          </div>
          <button onclick="reviews.openModal('transfer','${v.id}')" class="w-full py-2.5 rounded-xl text-xs font-bold border border-violet-400/40 text-violet-500 mb-3 mt-4">${t('writeReviewBtn')}</button>
          <div class="space-y-3" id="transferReviewsList"></div>
        </div>
        </div>
        <aside class="detail-sidebar">
          <div class="detail-sidebar-card">${bookingCard}</div>
        </aside>
      </div>
      <div class="fixed bottom-0 left-0 right-0 max-w-md mx-auto backdrop-blur-xl border-t p-4 flex items-center justify-between z-10 detail-mobile-bar" style="background:var(--bg-card); border-color:var(--border-card)">
        <div><p class="text-[9px]">${t('oneWayTripLabel')}</p><p class="text-xl font-bold text-violet-500 tabular-nums">${utils.formatPrice(v.price)}</p></div>
        <button onclick="startTransferBooking('${v.id}')" class="btn-gold px-7 py-3 rounded-2xl font-bold text-ink-900">${t('bookNowBtn')}</button>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0,0);
  routeToDetail('transfers', v.id, `${v.vehicleType} ${t('transferWord')}`, opts);
  loadReviews('transfer', v.id, 'transferReviewsList', 'transferRatingSummary', 'transferRatingBars');
}

function closeTransferPage() {
  const p = document.getElementById('transferDetailPage');
  if (p) p.remove();
  nav.go('transfers');
}

// ==================== RESTAURANTS RENDERER ====================
const restaurantsUi = {
  renderRow() {
    if (!SHOW_RESTAURANTS) return;
    const row = document.getElementById('restaurantsRow');
    if (row) row.innerHTML = CATALOG.restaurants.map(r => this.renderCard(r)).join('');
  },
  cuisines() { return [...new Set(CATALOG.restaurants.map(r => r.cuisine).filter(Boolean))].sort(); },
  filteredSorted() {
    const q = (state.restaurantSearchQuery || '').trim().toLowerCase();
    const list = CATALOG.restaurants.filter(r => {
      if (q && !(`${r.name} ${r.cuisine || ''} ${r.location || ''}`.toLowerCase().includes(q))) return false;
      if (state.restaurantType !== 'all' && (r.category === 'cafe' ? 'cafe' : 'restaurant') !== state.restaurantType) return false;
      if (state.restaurantPriceLevel && Number(r.priceLevel || 2) !== state.restaurantPriceLevel) return false;
      if (state.restaurantCuisine !== 'all' && r.cuisine !== state.restaurantCuisine) return false;
      if (state.restaurantMinRating && Number(r.rating || 0) < state.restaurantMinRating) return false;
      return true;
    });
    const by = state.restaurantSortBy;
    if (by === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (by === 'priceLow') list.sort((a, b) => (a.priceLevel || 2) - (b.priceLevel || 2));
    else if (by === 'priceHigh') list.sort((a, b) => (b.priceLevel || 2) - (a.priceLevel || 2));
    else list.sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
    return list;
  },
  renderFull() {
    if (!SHOW_RESTAURANTS) return;
    const list = document.getElementById('restaurantsFullList');
    if (!list) return;
    const filtered = this.filteredSorted();
    const countEl = document.getElementById('restaurantsCount'); if (countEl) countEl.textContent = filtered.length;
    const inp = document.getElementById('restaurantSearchInput');
    if (inp && inp.value.trim().toLowerCase() !== (state.restaurantSearchQuery || '').trim().toLowerCase()) inp.value = state.restaurantSearchQuery;
    list.className = 'lc-grid pb-28';
    list.innerHTML = filtered.length ? filtered.map(r => this.listCard(r)).join('')
      : `<div class="text-center py-16 col-span-full"><p class="mb-2">${t('noRestaurantsFoundMsg')}</p><p class="text-xs" style="color:var(--text-secondary)">${t('noResultsFilterHint')}</p></div>`;
  },
  onSearchInput(q) {
    state.restaurantSearchQuery = q;
    clearTimeout(this._searchDebounceTimer);
    this._searchDebounceTimer = setTimeout(() => this.renderFull(), 250);
  },
  onSortChange(v) { state.restaurantSortBy = v; this.renderFull(); },
  onTypeChange(v) { state.restaurantType = v; this.renderFull(); },
  onPriceLevelChange(v) { state.restaurantPriceLevel = Number(v) || 0; this.renderFull(); },
  onCuisineChange(v) { state.restaurantCuisine = v; this.renderFull(); },
  onMinRatingChange(v) { state.restaurantMinRating = Number(v) || 0; this.renderFull(); },
  clearFilters() {
    Object.assign(state, { restaurantSearchQuery: '', restaurantSortBy: 'popular', restaurantType: 'all', restaurantPriceLevel: 0, restaurantCuisine: 'all', restaurantMinRating: 0 });
    this.renderFull();
  },
  listCard(r) {
    return lcCard({ click: `showRestaurantPage('${r.id}')`, img: getImageUrl(r.image), badge: t(r.category === 'cafe' ? 'cafeCategoryLabel' : 'restaurantCategoryLabel'), rating: r.rating || '', reviews: r.reviews,
      title: lf.esc(r.name), loc: lf.esc(r.location), meta: [['fa-solid fa-utensils', lf.esc(r.cuisine)]],
      from: t('priceLevelLabel'), price: '$'.repeat(r.priceLevel || 2), cta: t('viewDetailsBtn') });
  },
  renderCard(r) {
    const img = getImageUrl(r.image);
    return `
      <div onclick="showRestaurantPage('${r.id}')" class="restaurant-card cursor-pointer">
        <div class="relative h-36 overflow-hidden">
          <img alt="" src="${img}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500">
          <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
          <span class="absolute top-3 left-3 bg-ink-950/70 text-white text-xs font-bold px-3 py-1 rounded-full capitalize">${t(r.category === 'cafe' ? 'cafeCategoryLabel' : 'restaurantCategoryLabel')}</span>
          <span class="absolute top-3 right-3 rating-pill px-2 py-1 rounded-full flex items-center gap-1"><i class="fa-solid fa-star text-gold-400 text-[10px]"></i><span class="text-[10px] font-bold text-gold-400">${r.rating}</span></span>
        </div>
        <div class="p-4">
          <h3 class="font-display font-bold text-lg mb-1 truncate" style="color:var(--text-primary)">${r.name}</h3>
          <p class="text-sm mb-2" style="color:var(--text-secondary)">${r.cuisine} · ${'$'.repeat(r.priceLevel || 2)}</p>
          <p class="text-xs flex items-center gap-1" style="color:var(--text-secondary)"><i class="fa-solid fa-location-dot text-violet-500"></i>${r.location}</p>
        </div>
      </div>`;
  }
};


// ==================== LISTING PAGES: search + filter sheet + cards ====================
// One component drives the four listing pages (hotels / excursions / transfers / restaurants):
//   [ search field ............ ] [ ⚙ Filters (2) ]
//   active-filter chips · "12 results" · Clear all
// The button opens a sheet (bottom sheet on phones, side drawer on desktop) with sort, category, price, rating…
// Every control calls the page's existing handler (hotels.onSortChange, excursionsUi.onPriceChange, …), so the list
// updates live behind the sheet and the footer button always says how many results the current filters give.
const lfRate = () => (typeof currencyAvailable !== 'undefined' && currencyAvailable && state.currency !== 'EGP' && currencyRates && currencyRates[state.currency]) || 1;
const lfCur = () => lfRate() !== 1 ? (CURRENCY_SYMBOLS[state.currency] || state.currency) : t('egpShort');
const lfToEgp = (v) => (v === '' || v == null || isNaN(Number(v))) ? null : Math.max(0, Math.round(Number(v) / lfRate()));
const lfFromEgp = (e) => e == null ? '' : Math.round(e * lfRate());

const lfSort = (opts, get, set) => ({ key: 'sort', kind: 'pills', title: 'sortByLabel', options: opts.map(([v, k]) => ({ v, label: t(k) })), get, set, isFilter: false });
const lfChips = (key, title, items, get, set, def = 'all') => ({ key, kind: 'chips', title, options: items, get, set, def });
const lfRating = (get, set) => ({ key: 'rating', kind: 'chips', title: 'minRatingLabel', def: 0, get, set,
  options: [{ v: 0, label: t('anyRatingLabel') }, { v: 4, label: '4.0+', icon: 'fa-star' }, { v: 4.5, label: '4.5+', icon: 'fa-star' }] });
const lfPrice = (get, set, values) => ({ key: 'price', kind: 'price', title: 'priceRangeLabel', get, set, values });

const LF = {
  hotels: {
    page: 'hotelsToolbar', input: 'hotelSearchInput', ph: 'searchHotels', ui: () => hotels,
    q: () => state.searchQuery, setQ: (v) => hotels.onSearchInput(v),
    sections: () => [
      lfSort([['popular', 'sortPopular'], ['priceLow', 'sortPriceLowHigh'], ['priceHigh', 'sortPriceHighLow'], ['rating', 'sortTopRated']], () => state.hotelSortBy, (v) => hotels.onSortChange(v)),
      lfChips('cat', 'categoryLabel', [{ v: 'all', label: t('all') }, ...['budget', 'luxury', 'family', 'resort', 'beachfront'].map(c => ({ v: c, label: t(c), icon: { budget: 'fa-coins', luxury: 'fa-gem', family: 'fa-people-roof', resort: 'fa-umbrella-beach', beachfront: 'fa-water' }[c] }))], () => state.currentFilter, (v) => search.filterCategory(v)),
      lfPrice(() => [state.hotelMinPrice, state.hotelMaxPrice], (a, b) => hotels.onPriceChange(a, b), () => CATALOG.hotels.map(h => h.price)),
      lfRating(() => state.hotelMinRating, (v) => hotels.onMinRatingChange(v)),
    ],
  },
  excursions: {
    page: 'excursionsToolbar', input: 'excursionSearchInput', ph: 'searchExcursions', ui: () => excursionsUi,
    q: () => state.excursionSearchQuery, setQ: (v) => excursionsUi.onSearchInput(v),
    sections: () => [
      lfSort([['popular', 'sortPopular'], ['priceLow', 'sortPriceLowHigh'], ['priceHigh', 'sortPriceHighLow'], ['rating', 'sortTopRated']], () => state.excursionSortBy, (v) => excursionsUi.onSortChange(v)),
      lfChips('cat', 'categoryLabel', [{ v: 'all', label: t('all'), icon: 'fa-layer-group' }, { v: 'diving', label: t('catDiving'), icon: 'fa-person-swimming' }, { v: 'desert', label: t('catDesert'), icon: 'fa-person-hiking' }, { v: 'boat', label: t('catBoat'), icon: 'fa-sailboat' }, { v: 'city', label: t('catCity'), icon: 'fa-city' }], () => state.currentExcursionFilter, (v) => search.filterExcursionCategory(v)),
      lfPrice(() => [state.excursionMinPrice, state.excursionMaxPrice], (a, b) => excursionsUi.onPriceChange(a, b), () => CATALOG.excursions.map(x => x.price)),
      lfRating(() => state.excursionMinRating, (v) => excursionsUi.onMinRatingChange(v)),
    ],
  },
  transfers: {
    page: 'transfersToolbar', input: 'transferSearchInput', ph: 'searchTransfersPlaceholder', ui: () => transfersUi,
    q: () => state.transferSearchQuery, setQ: (v) => transfersUi.onSearchInput(v),
    sections: () => [
      lfSort([['popular', 'sortPopular'], ['priceLow', 'sortPriceLowHigh'], ['priceHigh', 'sortPriceHighLow'], ['capacity', 'sortCapacity']], () => state.transferSortBy, (v) => transfersUi.onSortChange(v)),
      lfPrice(() => [state.transferMinPrice, state.transferMaxPrice], (a, b) => transfersUi.onPriceChange(a, b), () => CATALOG.transfers.map(x => x.price)),
      { key: 'cap', kind: 'chips', title: 'passengersLabel', def: 0, get: () => state.transferMinCapacity, set: (v) => transfersUi.onMinCapacityChange(v),
        options: [{ v: 0, label: t('anyRatingLabel') }, ...[2, 4, 7, 10].map(n => ({ v: n, label: n + '+', icon: 'fa-user-group' }))] },
    ],
  },
  restaurants: {
    page: 'restaurantsToolbar', input: 'restaurantSearchInput', ph: 'searchRestaurants', ui: () => restaurantsUi,
    q: () => state.restaurantSearchQuery, setQ: (v) => restaurantsUi.onSearchInput(v),
    sections: () => [
      lfSort([['popular', 'sortPopular'], ['rating', 'sortTopRated'], ['priceLow', 'sortPriceLevelLow'], ['priceHigh', 'sortPriceLevelHigh']], () => state.restaurantSortBy, (v) => restaurantsUi.onSortChange(v)),
      lfChips('type', 'typeLabel', [{ v: 'all', label: t('all'), icon: 'fa-layer-group' }, { v: 'restaurant', label: t('restaurantCategoryLabel'), icon: 'fa-utensils' }, { v: 'cafe', label: t('cafeCategoryLabel'), icon: 'fa-mug-hot' }], () => state.restaurantType, (v) => restaurantsUi.onTypeChange(v)),
      lfChips('plevel', 'priceLevelLabel', [{ v: 0, label: t('all') }, ...[1, 2, 3, 4].map(n => ({ v: n, label: '$'.repeat(n) }))], () => state.restaurantPriceLevel, (v) => restaurantsUi.onPriceLevelChange(v), 0),
      lfChips('cuisine', 'cuisineLabel', [{ v: 'all', label: t('all') }, ...restaurantsUi.cuisines().map(c => ({ v: c, label: c }))], () => state.restaurantCuisine, (v) => restaurantsUi.onCuisineChange(v)),
      lfRating(() => state.restaurantMinRating, (v) => restaurantsUi.onMinRatingChange(v)),
    ],
  },
};

const lf = {
  cur: null,
  esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  // the search field + Filters button, built once per page (texts follow the language through data-i18n)
  mountAll() {
    Object.keys(LF).forEach(kind => {
      const c = LF[kind], host = document.getElementById(c.page);
      if (!host || host.dataset.ready) return;
      host.dataset.ready = '1';
      host.innerHTML = `
        <div class="lf-bar">
          <label class="lf-search">
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input id="${c.input}" type="search" autocomplete="off" enterkeyhint="search" data-i18n-placeholder="${c.ph}" placeholder="${t(c.ph)}" oninput="lf.onInput('${kind}', this.value)">
          </label>
          <button type="button" class="lf-btn" onclick="lf.open('${kind}')" aria-haspopup="dialog">
            <i class="fa-solid fa-sliders" aria-hidden="true"></i><span data-i18n="filtersBtn">Filters</span><b class="lf-badge" hidden></b>
          </button>
        </div>
        <div class="lf-ctx" data-lf-ctx></div>
        <div class="lf-active" data-lf-active></div>`;
      this.drawCtx(kind);
      this.sync(kind);
    });
  },
  onInput(kind, v) { LF[kind].setQ(v); },

  // "what you searched for" strip: dates / guests (hotels) or date / people (excursions, transfers). Everything priced on the page follows it.
  drawCtx(kind) {
    const host = document.getElementById(LF[kind].page), box = host && host.querySelector('[data-lf-ctx]'); if (!box) return;
    if (kind === 'restaurants') { box.innerHTML = ''; return; }
    const st = search.stay(), fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(I18N.get() || 'en', { day: 'numeric', month: 'short' });
    const btn = (icon, text, click, aria) => `<button type="button" class="lf-ctx-btn" onclick="${click}" aria-label="${aria}"><i class="${icon}" aria-hidden="true"></i><span>${text}</span></button>`;
    if (kind === 'hotels') {
      const g = state.guests, kids = g.children > 0 ? `${g.children} ${t('children')}` : '';
      box.innerHTML = btn('fa-regular fa-calendar', `${fmt(st.ci)} → ${fmt(st.co)} · ${t(st.nights === 1 ? 'nightsN1' : 'nightsN').replace('{n}', st.nights)}`, "datepicker.open('searchCheckIn')", t('checkinLabel'))
        + btn('fa-solid fa-user-group', `${g.adults} ${t('adults')}${kids ? ', ' + kids : ''}, ${g.rooms} ${t('roomsCountSuffix')}`, 'openGuestsModal()', t('guestsLabel'));
    } else {
      box.innerHTML = btn('fa-regular fa-calendar', fmt(st.ci), "datepicker.open('excursionDate')", t('dateLabel'))
        + `<div class="lf-ctx-pax"><i class="fa-solid fa-user-group" aria-hidden="true"></i><button type="button" onclick="search.adjustPax(-1)" aria-label="−">−</button><b id="ctxPax">${state.tripPax || 2}</b><span>${t('peopleLabel')}</span><button type="button" onclick="search.adjustPax(1)" aria-label="+">+</button></div>`;
    }
  },
  // dates / guests / people changed: redraw the strip and re-price + re-filter every list on the page
  ctxChanged() {
    Object.keys(LF).forEach(kind => {
      if (kind === 'restaurants' || !document.getElementById(LF[kind].page)) return;
      this.drawCtx(kind);
      const o = LF[kind].ui(); if (o && o.render) o.render();
    });
  },

  isActive(sec) {
    if (sec.kind === 'price') { const [a, b] = sec.get(); return a != null || b != null; }
    if (sec.isFilter === false) return false;
    return sec.get() !== sec.def;
  },
  activeChips(kind) {
    const out = [];
    LF[kind].sections().forEach(sec => {
      if (!this.isActive(sec)) return;
      if (sec.kind === 'price') {
        const [a, b] = sec.get(), f = (e) => `${lfFromEgp(e).toLocaleString()}`;
        const label = a != null && b != null ? `${f(a)} – ${f(b)}` : a != null ? `≥ ${f(a)}` : `≤ ${f(b)}`;
        out.push({ key: sec.key, label: `${label} ${lfCur()}` });
      } else {
        const o = sec.options.find(o => o.v === sec.get());
        out.push({ key: sec.key, label: sec.key === 'rating' ? `★ ${o ? o.label : sec.get()}` : sec.key === 'cap' ? `${o ? o.label : sec.get()} ${t('passengersLower')}` : (o ? o.label : String(sec.get())) });
      }
    });
    return out;
  },

  // keeps the badge, the chips row and (if open) the sheet footer in step with the filters
  sync(kind) {
    const c = LF[kind]; if (!c) return;
    const host = document.getElementById(c.page); if (!host) return;
    const chips = this.activeChips(kind), n = chips.length;
    const badge = host.querySelector('.lf-badge'); if (badge) { badge.textContent = n; badge.hidden = !n; }
    host.querySelector('.lf-btn')?.classList.toggle('is-on', n > 0);
    const total = c.ui().filteredSorted().length;
    const row = host.querySelector('[data-lf-active]');
    if (row) {
      const q = (c.q() || '').trim();
      const show = n > 0 || q;
      row.classList.toggle('has', !!show);
      row.innerHTML = show ? `
        <span class="lf-count">${t('resultsCountLabel').replace('{n}', total)}</span>
        ${chips.map(ch => `<button type="button" class="lf-chip" onclick="lf.remove('${kind}','${ch.key}')">${this.esc(ch.label)}<i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`).join('')}
        <button type="button" class="lf-clear-all" onclick="lf.clearAll('${kind}')">${t('clearAll')}</button>` : '';
    }
    if (this.cur === kind) this.refreshSheetFooter();
  },
  remove(kind, key) {
    const sec = LF[kind].sections().find(s => s.key === key); if (!sec) return;
    if (sec.kind === 'price') sec.set(null, null); else sec.set(sec.def);
    if (this.cur === kind) this.drawSheet(); 
  },
  clearAll(kind) {
    const c = LF[kind]; c.ui().clearFilters();
    const inp = document.getElementById(c.input); if (inp) inp.value = '';
    if (this.cur === kind) this.drawSheet();
  },

  // ---- the sheet ----
  open(kind) {
    this.cur = kind;
    let ov = document.getElementById('lfSheet');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'lfSheet'; ov.className = 'lf-overlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'lfTitle');
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) lf.close(); });
      ov.addEventListener('click', (e) => lf.onClick(e));
      ov.addEventListener('input', (e) => lf.onInputPrice(e));
      document.body.appendChild(ov);
    }
    this.drawSheet();
    requestAnimationFrame(() => ov.classList.add('open'));
    document.body.classList.add('lf-lock');
    this._prevFocus = document.activeElement;
    setTimeout(() => ov.querySelector('.lf-close')?.focus(), 50);
  },
  close() {
    const ov = document.getElementById('lfSheet'); if (!ov) return;
    ov.classList.remove('open'); document.body.classList.remove('lf-lock');
    const kind = this.cur; this.cur = null;
    setTimeout(() => { if (!ov.classList.contains('open')) ov.remove(); }, 260);
    if (kind) this.sync(kind);
    try { this._prevFocus && this._prevFocus.focus(); } catch (e) {}
  },
  drawSheet() {
    const kind = this.cur, ov = document.getElementById('lfSheet'); if (!kind || !ov) return;
    const secs = LF[kind].sections();
    const body = secs.map(sec => {
      const title = `<h3 class="lf-sec-title">${t(sec.title)}</h3>`;
      if (sec.kind === 'price') {
        const [a, b] = sec.get(), vals = sec.values().filter(v => v > 0).sort((x, y) => x - y);
        let presets = '';
        if (vals.length >= 4) {
          const nice = (n) => { const step = n >= 2000 ? 500 : n >= 500 ? 100 : 50; return Math.max(step, Math.round(n / step) * step); };
          const q1 = nice(vals[Math.floor(vals.length / 3)]), q2 = nice(vals[Math.floor(vals.length * 2 / 3)]);
          if (q2 > q1) {
            const P = (la, lb, label) => `<button type="button" class="lf-pill ${a === la && b === lb ? 'on' : ''}" data-lf="preset" data-a="${la ?? ''}" data-b="${lb ?? ''}">${label}</button>`;
            const f = (e) => `${lfFromEgp(e).toLocaleString()}`;
            presets = `<div class="lf-presets">${P(null, q1, t('priceUnder').replace('{p}', f(q1)))}${P(q1, q2, `${f(q1)} – ${f(q2)}`)}${P(q2, null, t('priceOver').replace('{p}', f(q2)))}</div>`;
          }
        }
        return `<section class="lf-sec" data-sec="price">${title}
          <div class="lf-price">
            <label><span>${t('minPriceLabel')}</span><div class="lf-money"><input type="number" inputmode="numeric" min="0" data-lf="min" value="${lfFromEgp(a)}" placeholder="0"><em>${this.esc(lfCur())}</em></div></label>
            <i class="lf-dash" aria-hidden="true">–</i>
            <label><span>${t('maxPriceLabel')}</span><div class="lf-money"><input type="number" inputmode="numeric" min="0" data-lf="max" value="${lfFromEgp(b)}" placeholder="∞"><em>${this.esc(lfCur())}</em></div></label>
          </div>${presets}</section>`;
      }
      const cur = sec.get();
      return `<section class="lf-sec">${title}<div class="lf-pills" role="radiogroup">${sec.options.map(o => `
        <button type="button" role="radio" aria-checked="${o.v === cur}" class="lf-pill ${o.v === cur ? 'on' : ''}" data-lf="opt" data-sec="${sec.key}" data-v="${this.esc(o.v)}">${o.icon ? `<i class="fa-solid ${o.icon}" aria-hidden="true"></i>` : ''}${this.esc(o.label)}</button>`).join('')}</div></section>`;
    }).join('');
    ov.innerHTML = `
      <div class="lf-sheet" role="document">
        <div class="lf-grab" aria-hidden="true"></div>
        <header class="lf-head"><h2 id="lfTitle">${t('filtersTitle')}</h2><button type="button" class="lf-close" aria-label="${t('ariaClose')}" onclick="lf.close()"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></header>
        <div class="lf-body">${body}</div>
        <footer class="lf-foot">
          <button type="button" class="lf-reset" onclick="lf.clearAll('${kind}')">${t('clearAll')}</button>
          <button type="button" class="lf-apply" onclick="lf.close()" id="lfApply"></button>
        </footer>
      </div>`;
    this.refreshSheetFooter();
  },
  refreshSheetFooter() {
    const kind = this.cur, b = document.getElementById('lfApply'); if (!kind || !b) return;
    const n = LF[kind].ui().filteredSorted().length;
    b.textContent = n ? t('showResultsBtn').replace('{n}', n) : t('noResultsShort');
    b.classList.toggle('is-empty', !n);
  },
  onClick(e) {
    const el = e.target.closest('[data-lf]'); if (!el || !this.cur) return;
    const kind = this.cur, secs = LF[kind].sections();
    if (el.dataset.lf === 'opt') {
      const sec = secs.find(s => s.key === el.dataset.sec); if (!sec) return;
      const raw = el.dataset.v, opt = sec.options.find(o => String(o.v) === raw);
      sec.set(opt ? opt.v : raw);
      this.drawSheet();
    } else if (el.dataset.lf === 'preset') {
      const sec = secs.find(s => s.kind === 'price');
      const a = el.dataset.a === '' ? null : Number(el.dataset.a), b = el.dataset.b === '' ? null : Number(el.dataset.b);
      const [ca, cb] = sec.get();
      if (ca === a && cb === b) sec.set(null, null); else sec.set(a, b);
      this.drawSheet();
    }
  },
  onInputPrice(e) {
    const el = e.target; if (!el.dataset || !el.dataset.lf || !/^(min|max)$/.test(el.dataset.lf) || !this.cur) return;
    clearTimeout(this._pt);
    this._pt = setTimeout(() => {
      const sec = LF[this.cur].sections().find(s => s.kind === 'price'); if (!sec) return;
      const ov = document.getElementById('lfSheet');
      const a = lfToEgp(ov.querySelector('[data-lf="min"]').value), b = lfToEgp(ov.querySelector('[data-lf="max"]').value);
      sec.set(a, b);
      ov.querySelectorAll('.lf-presets .lf-pill').forEach(p => p.classList.remove('on'));
    }, 220);
  },
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lf.cur) lf.close(); });

// refresh the toolbar (badge / chips / count) every time a list re-renders
(function () {
  const pairs = [['hotels', () => hotels], ['excursions', () => excursionsUi], ['transfers', () => transfersUi], ['restaurants', () => restaurantsUi]];
  const wrapAll = () => pairs.forEach(([kind, get]) => {
    const o = get(); const name = kind === 'restaurants' ? 'renderFull' : 'render';
    if (!o || o['__lf_' + name]) return;
    const orig = o[name].bind(o); o['__lf_' + name] = true;
    o[name] = function () { const r = orig(); try { lf.sync(kind); } catch (e) {} return r; };
  });
  window.DS_wrapListings = wrapAll;
})();

// ---- listing card (all four pages share it) ----
// o: { click, img, badge, rating, title, loc, meta:[[icon,text]], tags:[], from, price, per, cta }
function lcCard(o) {
  const e = lf.esc;
  return `
    <article class="lc" onclick="${o.click}" tabindex="0" onkeydown="if(event.key==='Enter'){${o.click}}">
      <div class="lc-media">
        <img alt="" loading="lazy" src="${o.img}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <span class="lc-shade"></span>
        ${o.badge ? `<span class="lc-badge">${o.badge}</span>` : ''}
        ${o.rating ? `<span class="lc-rating"><i class="fa-solid fa-star" aria-hidden="true"></i>${e(o.rating)}${o.reviews ? `<small>(${e(o.reviews)})</small>` : ''}</span>` : ''}
      </div>
      <div class="lc-body">
        <h3 class="lc-title">${o.title}</h3>
        ${o.loc ? `<p class="lc-loc"><i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>${o.loc}</span></p>` : ''}
        ${o.meta && o.meta.length ? `<ul class="lc-meta">${o.meta.filter(m => m && m[1]).map(m => `<li><i class="${m[0]}" aria-hidden="true"></i>${m[1]}</li>`).join('')}</ul>` : ''}
        ${o.tags && o.tags.length ? `<div class="lc-tags">${o.tags.slice(0, 3).map(x => `<span>${x}</span>`).join('')}</div>` : ''}
        <div class="lc-foot">
          <div class="lc-price"><small>${o.from || ''}</small><b>${o.price}</b>${o.per ? `<em>${o.per}</em>` : ''}</div>
          <span class="lc-cta">${o.cta}<i class="fa-solid fa-arrow-right rtl-flip" aria-hidden="true"></i></span>
        </div>
      </div>
    </article>`;
}


// ==================== DESKTOP HERO CARDS (www only; hidden by CSS on phones/tablets) ====================
function dhRender() {
  const feat = document.getElementById('dhFeat');
  if (!feat) return;
  const img = u => getImageUrl(u);
  const d = (CATALOG.destinations || [])[0];
  if (d) {
    feat.onclick = () => showDestinationPage(d.id);
    feat.innerHTML = `<img alt="" src="${img(d.image)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
      <span class="dh-feat-shade"></span>
      <span class="dh-feat-body"><small>${esc(t('dhFeatured'))}</small><b>${esc(d.name)}</b><em>★ ${Number(d.rating || 0).toFixed(1)}</em></span>
      <span class="dh-arrow"><i class="fa-solid fa-arrow-right rtl-flip" aria-hidden="true"></i></span>`;
  }
  const stats = document.getElementById('dhStats');
  if (stats) {
    const revs = CATALOG.reviews || [];
    const avg = revs.length ? (revs.reduce((a, r) => a + (Number(r.rating) || 0), 0) / revs.length).toFixed(1) : '4.9';
    const n = (x) => (x && x > 0 ? x : '—');
    const rv = revs[0];
    stats.innerHTML = `<div class="dh-nums">
        <div><b>${n((CATALOG.excursions || []).length)}</b><span>${esc(t('dhStatExc'))}</span></div>
        <div><b>${n((CATALOG.destinations || []).length)}</b><span>${esc(t('dhStatDest'))}</span></div>
        <div><b>${avg}</b><span>${esc(t('dhStatRating'))}</span></div>
      </div>
      ${rv ? `<p class="dh-quote">“${esc(String(rv.text || '')).slice(0, 110)}”</p><p class="dh-by"><span>${esc((rv.name || 'G').charAt(0))}</span>${esc(rv.name || '')}</p>` : ''}`;
  }
  const story = document.getElementById('dhStory');
  const a = (CATALOG.articles || [])[0];
  if (story && a) {
    story.innerHTML = `<img alt="" src="${img(a.image)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
      <span class="dh-feat-shade"></span>
      <span class="dh-play dh-play-lg"><i class="fa-solid fa-play" aria-hidden="true"></i></span>
      <span class="dh-feat-body"><small>${esc(t('dhStories'))}</small><b>${esc(a.title || '')}</b></span>`;
  }
}

// ==================== DESTINATIONS RENDERER ====================
const destinationsUi = {
  render() {
    dhRender();
    if (!SHOW_DESTINATIONS) return;
    const row = document.getElementById('destinationsRow');
    if (!row) return;
    row.innerHTML = CATALOG.destinations.map(d => {
      const imgSrc = getImageUrl(d.image);
      return `
        <div onclick="showDestinationPage('${d.id}')" class="destination-card cursor-pointer rounded-[18px] overflow-hidden shadow-lg">
          <img alt="" src="${imgSrc}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover absolute inset-0">
          <div class="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent"></div>
          <div class="absolute top-3 right-3 rating-pill px-2 py-1 rounded-full"><span class="text-[9px] font-bold text-gold-400">★ ${d.rating}</span></div>
          <div class="absolute bottom-3 right-3 left-3 text-white">
            <p class="font-display font-bold text-base leading-tight">${d.name}</p>
          </div>
        </div>`;
    }).join('');
  }
};

// ==================== REVIEWS RENDERER ====================
const reviewsHomeUi = {
  render() {
    const row = document.getElementById('reviewsRow');
    if (!row) return;
    row.innerHTML = CATALOG.reviews.map(rv => `
      <div class="review-slide-card">
        <div class="flex items-center gap-3 mb-3">
          <div class="review-avatar-badge">${(rv.name || 'G').charAt(0)}</div>
          <div class="flex-1 min-w-0"><p class="text-sm font-semibold truncate">${rv.name}</p><div class="flex">${utils.renderStars(rv.rating)}</div></div>
        </div>
        <p class="text-xs leading-relaxed mb-3">"${rv.text}"</p>
        <p class="text-[10px] font-semibold text-violet-500 truncate">${rv.itemName || ''}</p>
      </div>`).join('');
  }
};

// ==================== ARTICLES RENDERER ====================
const articlesUi = {
  render() {
    const row = document.getElementById('articlesRow');
    if (!row) return;
    // Mobile: compact horizontal list card. Desktop: switches to a proper
    // magazine-style grid (image on top, larger) via the CSS media query
    // on .article-card, with the row itself becoming a real grid at lg.
    row.className = 'space-y-4 lg:space-y-0 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-6';
    row.innerHTML = CATALOG.articles.map(a => `
      <div onclick="showArticlePage('${a.id}')" class="article-card cursor-pointer">
        <img alt="" src="${a.image}" class="article-card-img" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <div class="article-card-body">
          <p class="font-display font-bold text-base mb-1 leading-snug line-clamp-2" style="color:var(--text-primary)">${a.title}</p>
          <p class="text-xs mb-2 line-clamp-2" style="color:var(--text-secondary)">${a.excerpt}</p>
          ${a.readTimeMinutes ? `<p class="text-[10px]" style="color:var(--text-secondary)"><i class="fa-regular fa-clock"></i> ${a.readTimeMinutes} min read</p>` : ''}
        </div>
      </div>`).join('');
  }
};

// ==================== DESKTOP LAYOUT HELPER ====================
function applyDesktopLayout() {
  const isDesktop = window.DS_SITE !== 'app' && window.innerWidth >= 1024;   // the app site keeps its app layout on tablets too
  document.querySelectorAll('.bottom-nav, .sticky-home-header').forEach(el => {
    el.style.display = isDesktop ? 'none' : '';
  });
  document.querySelectorAll('.section-title').forEach(el => {
    el.className = 'section-title ' + (isDesktop ? 'text-4xl font-bold' : 'text-2xl font-bold');
  });
  if (isDesktop) {
    document.querySelector('.search-card')?.classList.add('max-w-4xl', 'mx-auto', 'p-8');
  } else {
    document.querySelector('.search-card')?.classList.remove('max-w-4xl', 'mx-auto', 'p-8');
  }
}

// ==================== CATEGORY VISIBILITY ====================
function applyCategoryVisibility() {
  const homeSections = {
    hotels: document.getElementById('featuredHotels'),
    excursions: document.getElementById('featuredExcursions'),
    restaurants: document.getElementById('restaurantsRow'),
    destinations: document.getElementById('destinationsRow'),
  };

  if (!SHOW_HOTELS && homeSections.hotels) homeSections.hotels.closest('.mb-8')?.style.setProperty('display', 'none', 'important');
  if (!SHOW_EXCURSIONS && homeSections.excursions) homeSections.excursions.closest('.mb-8')?.style.setProperty('display', 'none', 'important');
  if (!SHOW_RESTAURANTS && homeSections.restaurants) homeSections.restaurants.closest('.mb-8')?.style.setProperty('display', 'none', 'important');
  if (!SHOW_DESTINATIONS && homeSections.destinations) homeSections.destinations.closest('.mb-8')?.style.setProperty('display', 'none', 'important');
  if (!SHOW_TRANSFERS) {
    document.querySelectorAll('.banner-creative').forEach(el => {
      if (el.getAttribute('onclick')?.includes('transfers')) el.closest('.mb-8')?.style.setProperty('display', 'none', 'important');
    });
  }

  if (!SHOW_HOTELS) {   // favourites only exist for hotels
    document.getElementById('statFavoritesCard')?.remove();
    document.getElementById('profileStatsGrid')?.classList.replace('grid-cols-3', 'grid-cols-2');
  }
  document.getElementById('drawerHotelsLink')?.classList.toggle('hidden', !SHOW_HOTELS);
  document.getElementById('desktopHotelsLink')?.classList.toggle('hidden', !SHOW_HOTELS);
  document.getElementById('footerHotelsLink')?.classList.toggle('hidden', !SHOW_HOTELS);
  document.getElementById('categoryTileHotels')?.classList.toggle('hidden', !SHOW_HOTELS);
  document.getElementById('categoryTileRestaurants')?.classList.toggle('hidden', !SHOW_HOTELS);
  document.querySelectorAll('.drawer-link').forEach(link => {
    const onclick = link.getAttribute('onclick') || '';
    if (onclick.includes("nav.go('excursions')") && !SHOW_EXCURSIONS) link.style.display = 'none';
    if (onclick.includes("nav.go('transfers')") && !SHOW_TRANSFERS) link.style.display = 'none';
    if (onclick.includes("nav.go('restaurants')") && !SHOW_RESTAURANTS) link.style.display = 'none';
  });

  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
    const page = item.getAttribute('data-page');
    if (page === 'excursions' && !SHOW_EXCURSIONS) item.style.display = 'none';
    if (page === 'transfers' && !SHOW_TRANSFERS) item.style.display = 'none';
  });

  if (!SHOW_HOTELS) document.getElementById('hotelsPage')?.remove();
  if (!SHOW_EXCURSIONS) document.getElementById('excursionsPage')?.remove();
  if (!SHOW_TRANSFERS) document.getElementById('transfersPage')?.remove();
  if (!SHOW_RESTAURANTS) document.getElementById('restaurantsPage')?.remove();
  if (!SHOW_DESTINATIONS) document.getElementById('destinationsPage')?.remove();
}

// ==================== INIT ====================
// Single startup sequence (previously duplicated across two files, which
// caused the catalog, bookings and profile to each load twice over the
// network on every page load).
document.addEventListener('DOMContentLoaded', async () => {
  await loadI18nDict();
  if (window.DS_SETTINGS_READY) { const st = await window.DS_SETTINGS_READY; if (st && st.value) applySiteSettings(st.value); }   // live site settings (sections, announcement, maintenance, contact)
  I18N.init();
  lf.mountAll(); DS_wrapListings();
  applyContactSettings(window.DS_CONFIG.CONTACT);
  THEME.init();
  initCurrency();
  populateCountryCodeSelect();
  populateNationalitySelect();

  if (window.SB) await SB.ready;   // restore / refresh the Supabase session before deciding what to show
  if (window.SB && SB.authLink) { const link = await SB.authLink; if (link) showAuthLinkScreen(link); }   // opened from an e-mail link: confirm / choose new password / expired

  if (auth.isLoggedIn() && !currentUser) {
    try {
      const stored = localStorage.getItem('ds_current_user');
      if (stored) currentUser = JSON.parse(stored);
    } catch {}
  }

  search.init();

  applyDesktopLayout();
  applyCategoryVisibility();
  window.addEventListener('resize', applyDesktopLayout);

  if (typeof restoreUiState === 'function') restoreUiState();
  try { search.updatePaxDisplays(); lf.ctxChanged(); } catch (e) {}   // listing pages: strip + prices follow the searched dates / people
  search.switchTab(search.activeTab);   // card follows what restoreUiState brought back (dates, category, tab)
  if (auth.isLoggedIn() || sessionStorage.getItem('ds_guest')) { enterApp(); } else { nav.showAuth(); }
  setTimeout(hideSplash, 3000);
});

document.addEventListener('submit', (e) => {
  if (e.target.closest('#authPage form')) { e.preventDefault(); handleAuthSubmit(e); }
  if (e.target.closest('#reviewModal form')) { e.preventDefault(); reviews.submit(e); }
});

// ==================== EXPOSE GLOBALLY ====================
window.showTransferPage = showTransferPage;
window.closeTransferPage = closeTransferPage;
window.showExcursionPage = showExcursionPage;
window.closeExcursionPage = closeExcursionPage;
window.showHotelPage = showHotelPage;
window.closeHotelPage = closeHotelPage;
window.showRestaurantPage = showRestaurantPage;
window.closeRestaurantPage = closeRestaurantPage;
window.showDestinationPage = showDestinationPage;
window.closeDestinationPage = closeDestinationPage;
window.showArticlePage = showArticlePage;
window.closeArticlePage = closeArticlePage;
window.startTransferBooking = startTransferBooking;
window.startExcursionBooking = startExcursionBooking;
window.startBooking = startBooking;


// close the home search category list when tapping elsewhere
document.addEventListener('click', (e) => {
  if (!e.target.closest('#searchCategoryDropdown') && !e.target.closest('[onclick*="openCategoryDropdown"]')) search.closeCategoryDropdown();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') search.closeCategoryDropdown(); });


// ==================== SITE SETTINGS (from the admin console) ====================
function applySiteSettings(v) {
  SITE_SET = v || {};
  SHOW_HOTELS = secFlag('hotels', window.DS_CONFIG.SHOW_HOTELS); SHOW_EXCURSIONS = secFlag('excursions', window.DS_CONFIG.SHOW_EXCURSIONS);
  SHOW_TRANSFERS = secFlag('transfers', window.DS_CONFIG.SHOW_TRANSFERS); SHOW_RESTAURANTS = secFlag('restaurants', window.DS_CONFIG.SHOW_RESTAURANTS);
  SHOW_DESTINATIONS = secFlag('destinations', window.DS_CONFIG.SHOW_DESTINATIONS); SHOW_JOURNAL = secFlag('journal', window.DS_CONFIG.SHOW_JOURNAL !== false);
  applyContactSettings(window.DS_CONFIG.CONTACT);   // phone / e-mail / social links: Cloudflare variables (DS_CONTACT_*, DS_SOCIAL_*)
  renderSiteBits();
}
const pick = (o) => (o && (o[I18N.get()] || o.en || o.ar || Object.values(o)[0])) || '';

function applyContactSettings(c) {
  if (!c || !Object.values(c).some(Boolean)) return;   // nothing configured: keep the page's built-in links
  const by = (label) => document.querySelectorAll(`.footer-social-btn[aria-label="${label}"]`);
  const set = (label, url) => by(label).forEach(a => { if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.style.display = ''; } else a.style.display = 'none'; });
  set('Instagram', c.instagram); set('Facebook', c.facebook); set('TikTok', c.tiktok);
  const wa = String(c.whatsapp || '').replace(/\D/g, ''); set('WhatsApp', wa ? 'https://wa.me/' + wa : '');
  document.querySelectorAll('.footer-social').forEach(box => { if (c.youtube && !box.querySelector('[aria-label="YouTube"]')) box.insertAdjacentHTML('beforeend', `<a href="${c.youtube}" target="_blank" rel="noopener" class="footer-social-btn" aria-label="YouTube"><i class="fa-brands fa-youtube" aria-hidden="true"></i></a>`); });
  const setText = (a, icon, text) => { a.removeAttribute('data-i18n'); a.innerHTML = `${icon} `; a.appendChild(document.createTextNode(text)); };
  if (c.email) document.querySelectorAll('a[href^="mailto:"]').forEach(a => { a.href = 'mailto:' + c.email; const i = a.querySelector('i'); if (a.classList.contains('footer-contact-line')) setText(a, i ? i.outerHTML : '', c.email); else { a.removeAttribute('data-i18n'); const val = a.querySelector('.contact-info-value'); if (val) val.textContent = c.email; } });
  if (wa) document.querySelectorAll('a.contact-info-card').forEach(a => { if (a.querySelector('.fa-whatsapp')) { a.href = 'https://wa.me/' + wa; a.target = '_blank'; a.rel = 'noopener'; a.removeAttribute('data-i18n'); } });
  if (c.phone) document.querySelectorAll('.footer-contact-line').forEach(line => { if (line.tagName === 'P' && line.querySelector('.fa-location-dot') && !line.parentNode.querySelector('[data-site-phone]')) line.insertAdjacentHTML('beforebegin', `<a href="tel:${String(c.phone).replace(/[^\d+]/g, '')}" data-site-phone class="footer-contact-line"><i class="fa-solid fa-phone" aria-hidden="true"></i> ${c.phone}</a>`); });
}

// announcement bar + maintenance screen (re-rendered on language change by refreshCatalogUI)
function renderSiteBits() {
  const an = SITE_SET.announcement, host = document.body;
  let bar = document.getElementById('dsAnnounce');
  const txt = an && an.enabled ? pick(an.text) : '';
  if (txt && !sessionStorage.getItem('ds_ann_closed_' + txt.length)) {
    if (!bar) { bar = document.createElement('div'); bar.id = 'dsAnnounce'; host.prepend(bar); }
    bar.className = 'ds-announce ' + (an.tone || 'info');
    const msg = an.link ? `<a href="${an.link}" target="_blank" rel="noopener">${txt}</a>` : `<span>${txt}</span>`;
    bar.innerHTML = `${msg}<button type="button" aria-label="Close" onclick="this.parentNode.remove();try{sessionStorage.setItem('ds_ann_closed_${txt.length}','1')}catch(e){}">&times;</button>`;
  } else if (bar) bar.remove();

  const mt = SITE_SET.maintenance, preview = new URLSearchParams(location.search).get('preview') === '1';
  if (preview) { try { sessionStorage.setItem('ds_preview', '1'); } catch {} }
  const on = mt && mt.enabled && !sessionStorage.getItem('ds_preview');
  let ov = document.getElementById('dsMaintenance');
  if (on) {
    if (!ov) { ov = document.createElement('div'); ov.id = 'dsMaintenance'; host.appendChild(ov); }
    ov.innerHTML = `<div><div class="mt-ic">🛠️</div><h1>${t('maintenanceTitle')}</h1><p>${pick(mt.message) || ''}</p></div>`;
    document.documentElement.style.overflow = 'hidden';
  } else if (ov) { ov.remove(); document.documentElement.style.overflow = ''; }
}
window.DS_renderSiteBits = renderSiteBits;
