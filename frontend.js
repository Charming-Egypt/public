// ==================== FRONTEND UI & NAVIGATION ====================
window.DS_CONFIG = window.DS_CONFIG || {
  SHOW_HOTELS: false,
  SHOW_EXCURSIONS: true,
  SHOW_TRANSFERS: true,
  SHOW_RESTAURANTS: true,
  SHOW_DESTINATIONS: true
};

const SHOW_HOTELS = window.DS_CONFIG.SHOW_HOTELS;
const SHOW_EXCURSIONS = window.DS_CONFIG.SHOW_EXCURSIONS;
const SHOW_TRANSFERS = window.DS_CONFIG.SHOW_TRANSFERS;
const SHOW_RESTAURANTS = window.DS_CONFIG.SHOW_RESTAURANTS;
const SHOW_DESTINATIONS = window.DS_CONFIG.SHOW_DESTINATIONS;

// ==================== URL ROUTER ====================
// Maps in-app "pages" to real, bookmarkable, shareable URLs.
// This does NOT reload the page on navigation — it keeps the SPA's instant
// transitions while giving every screen its own address (back/forward
// buttons, refresh, and direct links all land on the right screen).

// The site is served from /h/* on this deployment (not the domain root), so
// every route needs that prefix. Change this one line if the deployment
// path ever changes — set to '' if the site moves back to the root.
const BASE_PATH = '/h';

const ROUTES = {
  home: '/',
  excursions: '/excursions',
  transfers: '/transfers',
  restaurants: '/restaurants',
  bookings: '/bookings',
  profile: '/profile',
  settings: '/settings',
  notifications: '/notifications'
};

const PAGE_TITLES = {
  home: 'Discover Sharm — Luxury Travel',
  excursions: 'Excursions in Sharm El-Sheikh — Discover Sharm',
  transfers: 'Airport Transfers — Discover Sharm',
  restaurants: 'Restaurants — Discover Sharm',
  bookings: 'My Bookings — Discover Sharm',
  profile: 'My Profile — Discover Sharm',
  settings: 'Settings — Discover Sharm',
  notifications: 'Notifications — Discover Sharm'
};

// Detail ("single item") routes: /h/excursions/dolphin-house, /h/restaurants/fares-seafood ...
// `open` is called with (id, opts) to render the detail screen for that item.
// `catalogKey` is the CATALOG array to look the item up in, so a direct link
// waits for that data to finish loading before it tries to render.
const DETAIL_ROUTES = {
  excursions: { open: (id, opts) => showExcursionPage(id, opts), catalogKey: 'excursions', enabled: () => SHOW_EXCURSIONS },
  restaurants: { open: (id, opts) => showRestaurantPage(id, opts), catalogKey: 'restaurants', enabled: () => SHOW_RESTAURANTS },
  transfers: { open: (id, opts) => showTransferPage(id, opts), catalogKey: 'transfers', enabled: () => SHOW_TRANSFERS },
  destinations: { open: (id, opts) => showDestinationPage(id, opts), catalogKey: 'destinations', enabled: () => SHOW_DESTINATIONS },
  articles: { open: (id, opts) => showArticlePage(id, opts), catalogKey: 'articles' },
  hotels: { open: (id, opts) => showHotelPage(id, opts), catalogKey: 'hotels', enabled: () => SHOW_HOTELS }
};

function pathForPage(page) { return BASE_PATH + (ROUTES[page] || '/'); }
function pathForDetail(section, id) { return `${BASE_PATH}/${section}/${encodeURIComponent(id)}`; }

// Parses a URL path into either a top-level page or a detail route.
// Returns null when nothing matches (caller falls back to home) — this
// includes any path outside BASE_PATH, since the app only lives there.
function parseRoute(path) {
  let clean = (path || '/').replace(/\/+$/, '') || '/';
  if (BASE_PATH) {
    if (clean === BASE_PATH) clean = '/';
    else if (clean.startsWith(BASE_PATH + '/')) clean = clean.slice(BASE_PATH.length);
    else return null; // not under /h — not one of our routes
  }
  for (const page in ROUTES) {
    if (ROUTES[page] === clean) return { type: 'page', page };
  }
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 2 && DETAIL_ROUTES[parts[0]]) {
    return { type: 'detail', section: parts[0], id: decodeURIComponent(parts[1]) };
  }
  return null;
}

function pageForPath(path) {
  const r = parseRoute(path);
  return r && r.type === 'page' ? r.page : null;
}

// Records the URL + tab title for a detail screen. Call this from inside
// showXPage() once you know the item (and its id/title) exist.
function routeToDetail(section, id, title, opts = {}) {
  document.title = title ? `${title} — Discover Sharm` : PAGE_TITLES.home;
  if (opts.skipHistory) return;
  const url = pathForDetail(section, id);
  if (opts.replace) history.replaceState({ detail: { section, id } }, '', url);
  else history.pushState({ detail: { section, id } }, '', url);
}

// Captured once at script load so a direct visit to e.g. /excursions/dolphin-house
// is honored as soon as the user is past the splash/auth screens and the
// catalog has finished loading.
let __pendingRoute = parseRoute(location.pathname);

// Resolves once loadCatalogFromWorker() (kicked off in enterApp) has finished,
// so a direct link to a detail page can look the item up reliably.
let __catalogLoadPromise = null;
function ensureCatalogLoaded() {
  return __catalogLoadPromise || Promise.resolve();
}

async function openDetailFromRoute(section, id, opts = {}) {
  const def = DETAIL_ROUTES[section];
  if (!def || (def.enabled && !def.enabled())) return;
  await ensureCatalogLoaded();
  def.open(id, opts);
}

window.addEventListener('popstate', (e) => {
  const mainApp = document.getElementById('mainApp');
  if (!mainApp || mainApp.classList.contains('hidden')) return; // still on splash/auth

  if (e.state && e.state.detail) {
    openDetailFromRoute(e.state.detail.section, e.state.detail.id, { skipHistory: true });
    return;
  }

  const route = parseRoute(location.pathname);
  if (route && route.type === 'detail') {
    openDetailFromRoute(route.section, route.id, { skipHistory: true });
    return;
  }

  const page = (e.state && e.state.page) || (route && route.page) || 'home';
  nav.go(page, { skipHistory: true });
});

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

function enterApp() {
  hideSplash();
  document.getElementById('authPage').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
  __catalogLoadPromise = loadCatalogFromWorker();
  ui.setDefaultDates();
  search.init();

  if (currentUser) {
    updateDrawerUser(currentUser.displayName || currentUser.email, currentUser.email, currentUser.photoURL);
  } else {
    updateDrawerUser('Guest', '', localStorage.getItem('ds_avatar'));
  }

  if (SHOW_HOTELS && auth.isLoggedIn()) {
    favorites.load();
  }
  if (auth.isLoggedIn()) {
    bookings.load();
    notifications.load();
    loadUserProfile();
  } else {
    bookings.render();
    notifications.render();
  }

  applyDesktopLayout();
  applyCategoryVisibility();
  updateStickyHeaderState();

  // Honor a direct link (e.g. someone opened /excursions or
  // /excursions/dolphin-house) now that the app shell is visible;
  // otherwise make sure the URL matches "home".
  if (__pendingRoute && __pendingRoute.type === 'page' && __pendingRoute.page !== 'home' && ROUTES[__pendingRoute.page]) {
    const target = __pendingRoute.page;
    __pendingRoute = null;
    nav.go(target, { replace: true });
  } else if (__pendingRoute && __pendingRoute.type === 'detail') {
    const { section, id } = __pendingRoute;
    __pendingRoute = null;
    openDetailFromRoute(section, id, { replace: true });
  } else {
    __pendingRoute = null;
    history.replaceState({ page: 'home' }, '', pathForPage('home'));
  }
}

const nav = {
  go(page, opts = {}) {
    if (page === 'hotels' && !SHOW_HOTELS) return;
    if (page === 'excursions' && !SHOW_EXCURSIONS) return;
    if (page === 'transfers' && !SHOW_TRANSFERS) return;
    if (page === 'restaurants' && !SHOW_RESTAURANTS) return;
    if (page === 'destinations' && !SHOW_DESTINATIONS) return;

    const target = document.getElementById(page + 'Page');
    if (!target) return;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    target.classList.add('active');
    state.pageHistory.push(page);
    window.scrollTo(0, 0);
    updateStickyHeaderState();

    if (!opts.skipHistory && ROUTES[page]) {
      const url = pathForPage(page);
      const currentPath = location.pathname.replace(/\/+$/, '') || '/';
      if (opts.replace) {
        history.replaceState({ page }, '', url);
      } else if (currentPath !== url) {
        history.pushState({ page }, '', url);
      }
    }
    document.title = PAGE_TITLES[page] || PAGE_TITLES.home;

    document.querySelectorAll('[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    if (page === 'hotels' && SHOW_HOTELS) hotels.render();
    if (page === 'excursions' && SHOW_EXCURSIONS) excursionsUi.render();
    if (page === 'transfers' && SHOW_TRANSFERS) transfersUi.render();
    if (page === 'restaurants' && SHOW_RESTAURANTS) restaurantsUi.renderFull();
    if (page === 'bookings') bookings.render();
    if (page === 'favorites' && SHOW_HOTELS) favorites.render();
    if (page === 'notifications') notifications.render();
    if (page === 'profile') updateProfileStats();

    applyDesktopLayout();
  },
  goBack() { state.pageHistory.pop(); this.go(state.pageHistory[state.pageHistory.length - 1] || 'home'); },
  showAuth() {
    hideSplash();
    document.getElementById('authPage').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    switchAuthMode('login');
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
    console.warn('Failed to load user profile', e);
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
    2: ['15% discount on selected excursions', 'Free room upgrade (subject to availability)'],
    3: ['20% discount on selected excursions', 'Free room upgrade', 'Priority support', 'Welcome drink']
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
function openGuestsModal() {
  document.getElementById('guestsModal').classList.remove('hidden');
  document.getElementById('adultsCount').textContent = state.guests.adults;
  document.getElementById('childrenCount').textContent = state.guests.children;
  document.getElementById('infantsCount').textContent = state.guests.infants;
  document.getElementById('roomsCount').textContent = state.guests.rooms;
}
function closeGuestsModal() { document.getElementById('guestsModal').classList.add('hidden'); }
function adjustGuestCount(type, delta) {
  const limits = { adults: { min: 1, max: 10 }, children: { min: 0, max: 6 }, infants: { min: 0, max: 4 }, rooms: { min: 1, max: 5 } };
  const newValue = state.guests[type] + delta;
  if (type === 'rooms' && delta < 0) {
    const maxOcc = (state.currentRoom && state.currentRoom.guests) || 2;
    const required = Math.ceil((state.guests.adults + state.guests.children) / maxOcc);
    if (newValue < required) { toast('Reduce guests first', 'error'); return; }
  }
  if (newValue >= limits[type].min && newValue <= limits[type].max) state.guests[type] = newValue;
  if (type === 'adults' || type === 'children') {
    const maxOcc = (state.currentRoom && state.currentRoom.guests) || 2;
    const required = Math.ceil((state.guests.adults + state.guests.children) / maxOcc);
    if (required > state.guests.rooms && required <= limits.rooms.max) {
      state.guests.rooms = required;
      toast('Room count increased to fit your party', 'info');
    }
  }
  document.getElementById('adultsCount').textContent = state.guests.adults;
  document.getElementById('childrenCount').textContent = state.guests.children;
  document.getElementById('infantsCount').textContent = state.guests.infants;
  document.getElementById('roomsCount').textContent = state.guests.rooms;
  search.updateGuestDisplay();
}
function applyGuests() {
  closeGuestsModal();
  search.updateGuestDisplay();
  toast('Guests updated', 'info');
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
}

const datepicker = {
  target: null,
  viewDate: new Date(),
  minIso: null,
  unavailable: [],
  open(fieldId, opts = {}) {
    this.target = fieldId;
    this.minIso = utils.addDays(utils.todayIso(), 1);
    this.unavailable = opts.unavailableIso || [];
    const field = document.getElementById(fieldId);
    const cur = field ? field.dataset.value : '';
    this.viewDate = new Date((cur || this.minIso) + 'T00:00:00');
    this.render();
    document.getElementById('datepickerModal').classList.remove('hidden');
  },
  close() { document.getElementById('datepickerModal').classList.add('hidden'); },
  changeMonth(delta) { this.viewDate.setMonth(this.viewDate.getMonth() + delta); this.render(); },
  render() {
    const lang = I18N.get();
    const monthNamesEn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthNamesAr = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    const weekdaysEn = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const weekdaysAr = ['ح','ن','ث','ر','خ','ج','س'];
    const y = this.viewDate.getFullYear(), m = this.viewDate.getMonth();
    document.getElementById('dpMonthLabel').textContent = (lang === 'ar' ? monthNamesAr[m] : monthNamesEn[m]) + ' ' + y;
    document.getElementById('dpWeekdays').innerHTML = (lang === 'ar' ? weekdaysAr : weekdaysEn).map(w => `<span class="text-[10px] font-semibold" style="color:var(--text-secondary)">${w}</span>`).join('');
    const first = new Date(y, m, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const field = document.getElementById(this.target);
    const cur = field ? field.dataset.value : '';
    const today = new Date(); today.setHours(0,0,0,0);
    let html = '';
    for (let i = 0; i < startDay; i++) html += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(y, m, d);
      const isBeforeMin = iso < this.minIso;
      const isToday = dateObj.getTime() === today.getTime();
      const isUnavailable = this.unavailable.includes(iso);
      const isDisabled = isBeforeMin || isUnavailable || isToday; // ✅ اليوم مقفول
      const isSelected = cur === iso;
      html += `<button type="button" ${isDisabled ? 'disabled' : ''} onclick="datepicker.select('${iso}')" class="w-9 h-9 rounded-xl text-xs font-semibold ${isSelected ? 'bg-gradient-to-br from-violet-500 to-violet-700 text-white' : isDisabled ? 'text-gray-400 opacity-40 line-through' : ''}" style="${isSelected ? '' : 'color:var(--text-primary)'}">${d}</button>`;
    }
    document.getElementById('dpGrid').innerHTML = html;
  },
  select(iso) {
    // البحث
    if (this.target === 'searchCheckIn') {
      search.selectedCheckIn = iso;
      search.selectedCheckOut = null;
      search.updateDateDisplays();
      this.close();
      return;
    }
    if (this.target === 'searchCheckOut') {
      search.selectedCheckOut = iso;
      search.updateDateDisplays();
      this.close();
      return;
    }
    if (this.target === 'excursionDate') {
      search.selectedCheckIn = iso;
      search.selectedCheckOut = null;
      search.updateDateDisplays();
      this.close();
      return;
    }
    // الحجز
    setDateFieldValue(this.target, iso);
    if (typeof onDateFieldChange === 'function') onDateFieldChange(this.target, iso);
    this.close();
  }
};

// ==================== SEARCH ====================
const search = {
  activeTab: 'hotels',
  selectedCheckIn: null,
  selectedCheckOut: null,
  selectedCategory: 'all',

  switchTab(tab) {
    if (tab === 'hotels' && !SHOW_HOTELS) tab = 'excursions';
    if (tab === 'excursions' && !SHOW_EXCURSIONS) tab = 'hotels';
    if (!SHOW_HOTELS && !SHOW_EXCURSIONS) {
      document.getElementById('searchTabsContainer').style.display = 'none';
      document.getElementById('hotelSearchForm').style.display = 'none';
      document.getElementById('excursionSearchForm').style.display = 'none';
      return;
    }
    this.activeTab = tab;

    const tabsContainer = document.getElementById('searchTabsContainer');
    tabsContainer.style.display = (SHOW_HOTELS && SHOW_EXCURSIONS) ? 'flex' : 'none';

    document.getElementById('hotelSearchForm').style.display = (tab === 'hotels' && SHOW_HOTELS) ? 'block' : 'none';
    document.getElementById('excursionSearchForm').style.display = (tab === 'excursions' && SHOW_EXCURSIONS) ? 'block' : 'none';

    const hotelBtn = document.getElementById('searchTabHotels');
    const excursionBtn = document.getElementById('searchTabExcursions');
    if (hotelBtn) hotelBtn.classList.toggle('active', tab === 'hotels');
    if (excursionBtn) excursionBtn.classList.toggle('active', tab === 'excursions');

    this.updateHeroContent(tab);
    this.updateDateDisplays();
  },

  updateHeroContent(tab) {
    const heroData = {
      hotels: {
        eyebrow: '',
        title: '',
        subtitle: ''
      },
      excursions: {
        eyebrow: '',
        title: '',
        subtitle: ''
      }
    };
    const data = heroData[tab] || heroData.hotels;
    document.getElementById('heroEyebrowText').innerHTML = data.eyebrow;
    document.getElementById('heroTitleText').innerHTML = data.title;
    document.getElementById('heroSubtitleText').textContent = data.subtitle;
    startHeroBackgroundRotation(tab);
  },

  openGuestDropdown() {
    document.getElementById('searchGuestDropdown').style.display = 'flex';
  },
  closeGuestDropdown() {
    document.getElementById('searchGuestDropdown').style.display = 'none';
    this.updateGuestDisplay();
  },
  openCategoryDropdown() {
    document.getElementById('searchCategoryDropdown').style.display = 'flex';
  },
  closeCategoryDropdown() {
    document.getElementById('searchCategoryDropdown').style.display = 'none';
  },
  setCategory(category) {
    this.selectedCategory = category;
    const displayEl = document.getElementById('excursionCategoryDisplay');
    if (displayEl) {
      const labels = {
        'all': 'All Categories',
        'Diving': 'Diving & Snorkeling',
        'Desert Safari': 'Desert Safari',
        'Boat Trip': 'Boat Trip',
        'City Tour': 'City Tour'
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
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${d.getDate()} ${months[d.getMonth()]}`;
    };
    const checkinDisplay = document.getElementById('checkinDisplay');
    const checkoutDisplay = document.getElementById('checkoutDisplay');
    const excursionDateDisplay = document.getElementById('excursionDateDisplay');
    if (checkinDisplay) checkinDisplay.textContent = ci ? fmt(ci) : 'Select date';
    if (checkoutDisplay) checkoutDisplay.textContent = co ? fmt(co) : 'Select date';
    if (excursionDateDisplay) excursionDateDisplay.textContent = ci ? fmt(ci) : 'Select date';
  },
  adjustGuest(type, delta) {
    const limits = { adults: { min:1, max:10 }, children: { min:0, max:6 }, rooms: { min:1, max:5 } };
    const newVal = (state.guests[type] || 0) + delta;
    if (newVal >= limits[type].min && newVal <= limits[type].max) {
      state.guests[type] = newVal;
    }
    document.getElementById('searchAdultCount').textContent = state.guests.adults;
    document.getElementById('searchChildCount').textContent = state.guests.children;
    document.getElementById('searchRoomCount').textContent = state.guests.rooms;
    this.updateGuestDisplay();
  },
  updateGuestDisplay() {
    const text = `${state.guests.adults} Adults, ${state.guests.children} Children, ${state.guests.rooms} Room(s)`;
    const el = document.getElementById('guestsDisplay');
    if (el) el.textContent = text;
  },
  performSearch() {
    if (this.activeTab === 'hotels') {
      if (!this.selectedCheckIn || !this.selectedCheckOut) {
        toast('Please select dates first', 'error');
        return;
      }
      nav.go('hotels');
    } else {
      this.applyExcursionSearch();
    }
  },
  applyExcursionSearch() {
    state.currentExcursionFilter = this.selectedCategory;
    nav.go('excursions');
  },
  handle(q) { state.searchQuery = q.toLowerCase(); },
  filterCategory(cat) { state.currentFilter = cat; },
  filterExcursionCategory(cat) { state.currentExcursionFilter = cat; },
  init() {
    const tomorrow = new Date();
    tomorrow.setHours(0,0,0,0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    this.selectedCheckIn = tomorrow.toISOString().slice(0,10);
    this.selectedCheckOut = dayAfter.toISOString().slice(0,10);
    this.selectedCategory = 'all';
    this.updateDateDisplays();
    this.updateGuestDisplay();
    this.setCategory('all');
    this.switchTab(SHOW_HOTELS ? 'hotels' : 'excursions');
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
    '/m/images/home/trips/33.jpg',
    '/m/images/home/trips/Cpho.jpeg'
    ]
  }
};

let heroBgIndex = 0;
let heroBgInterval = null;
let heroCurrentTab = 'hotels';
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
  toast('Currency updated', 'info');
}

// ==================== ROOM PREVIEW ====================
function showRoomPreview(hotelId, roomIndex) {
  if (!SHOW_HOTELS) return;
  const h = CATALOG.hotels.find(x => x.id === hotelId);
  const r = h?.rooms?.[roomIndex];
  if (!r) return;
  document.getElementById('roomPreviewContent').innerHTML = `
    <div class="relative h-52">
      <img src="${getImageUrl(r.image)}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover">
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
      <button onclick="selectRoomOnDetail('${hotelId}', ${roomIndex}, { closeModal: true })" class="btn-gold w-full py-3 rounded-2xl font-bold text-ink-900">Select This Room</button>
    </div>`;
  document.getElementById('roomPreviewModal').classList.remove('hidden');
}
function closeRoomPreview() { if (!SHOW_HOTELS) return; document.getElementById('roomPreviewModal').classList.add('hidden'); }

// ==================== UI RENDERERS ====================
const ui = {
  renderHotelCard(h) {
    if (!SHOW_HOTELS) return '';
    const img = getImageUrl(h.image);
    const isFav = state.favorites.includes(h.id);
    return `
      <div onclick="showHotelPage('${h.id}')" class="hotel-card rounded-[20px] overflow-hidden cursor-pointer flex flex-col lg:flex-col">
        <div class="relative w-full h-48 md:h-56 lg:h-64 flex-shrink-0 overflow-hidden">
          <img src="${img}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500">
          ${h.bestseller ? '<div class="absolute top-2 right-2 badge-bestseller text-[8px] font-black px-2 py-0.5 rounded-md">BEST SELLER</div>' : ''}
          <div class="absolute bottom-2 right-2 rating-pill px-1.5 py-0.5 rounded-md flex items-center gap-1"><i class="fa-solid fa-star text-gold-400 text-[8px]"></i><span class="text-[9px] font-bold text-gold-400">${h.rating}</span></div>
        </div>
        <div class="flex-1 p-4 lg:p-6 flex flex-col justify-between">
          <div>
            <div class="flex items-start justify-between mb-1">
              <h3 class="font-display font-bold text-sm md:text-base line-clamp-1">${h.name}</h3>
              <button onclick="event.stopPropagation(); favorites.toggle('${h.id}')" class="text-base ${isFav ? 'text-red-500' : 'text-gray-300'}"><i class="fa-${isFav ? 'solid' : 'regular'} fa-heart"></i></button>
            </div>
            <div class="flex items-center gap-1 mb-1">${utils.renderStars(h.rating)}<span class="text-[9px] mr-1">(${h.reviews})</span></div>
            <p class="text-[10px] mb-1.5"><i class="fa-solid fa-location-dot text-violet-500 text-[8px]"></i>${(h.location || '').split(',')[0]}</p>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1 text-[8px]">${(h.amenities || []).slice(0, 2).map(a => `<span class="px-1.5 py-0.5 rounded" style="background:var(--bg-field)">${a}</span>`).join('')}</div>
            <div class="text-left"><p class="text-base md:text-lg font-bold text-violet-500 font-display">${utils.formatPrice(h.price)}</p><p class="text-[8px]">/ Night</p></div>
          </div>
        </div>
      </div>`;
  },
  renderFeaturedHotels() {
    if (!SHOW_HOTELS) return;
    const el = document.getElementById('featuredHotels');
    if (el) {
      el.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6';
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
  render() {
    if (!SHOW_HOTELS) return;
    const list = document.getElementById('hotelsList');
    if (!list) return;
    let filtered = CATALOG.hotels;
    if (state.currentFilter !== 'all') filtered = filtered.filter(h => h.category === state.currentFilter);
    if (state.searchQuery) filtered = filtered.filter(h => h.name.toLowerCase().includes(state.searchQuery));
    list.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-28';
    if (filtered.length === 0) {
      list.innerHTML = `<div class="text-center py-16">No hotels found</div>`;
      return;
    }
    list.innerHTML = filtered.map(h => ui.renderHotelCard(h)).join('');
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
    const duration = x.duration || 'Full day';
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
                <span class="price-from">From</span>
                <div class="price-value" data-price-egp="${x.price}">${price}</div>
                <span class="price-per-person">/ person</span>
              </div>
              <button class="book-btn action-btn" onclick="event.stopPropagation(); showExcursionPage('${x.id}')">
                <i class="fas fa-bolt"></i> Book Now
              </button>
            </div>
          </div>
        </div>
      </div>`;
  },
  render() {
    if (!SHOW_EXCURSIONS) return;
    const list = document.getElementById('excursionsList');
    if (!list) return;
    let filtered = CATALOG.excursions;
    if (state.currentExcursionFilter !== 'all') filtered = filtered.filter(x => x.category === state.currentExcursionFilter);
    list.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-28';
    if (filtered.length === 0) { list.innerHTML = `<div class="text-center py-16">No excursions found</div>`; return; }
    list.innerHTML = filtered.map(x => this.renderCard(x)).join('');
  },
  renderCard(x) {
    const img = getImageUrl(x.image);
    return `
      <div onclick="showExcursionPage('${x.id}')" class="excursion-card bg-card rounded-[20px] overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl transition-all duration-300 flex flex-col">
        <div class="relative h-52 overflow-hidden">
          <img src="${img}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500">
          <div class="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>
          <span class="absolute top-3 left-3 bg-violet-600/90 text-white text-xs font-bold px-3 py-1 rounded-full">${x.category}</span>
          <span class="absolute top-3 right-3 rating-pill px-2 py-1 rounded-full flex items-center gap-1"><i class="fa-solid fa-star text-gold-400 text-[10px]"></i><span class="text-[10px] font-bold text-gold-400">${Number(x.rating).toFixed(1)}</span></span>
          <div class="absolute bottom-3 left-3 right-3 text-white">
            <h3 class="font-display font-bold text-lg leading-tight line-clamp-1">${x.title}</h3>
          </div>
        </div>
        <div class="p-4 flex flex-col justify-between flex-1">
          <div class="flex items-center gap-4 text-xs text-gray-500 mb-3">
            <span><i class="fa-regular fa-clock text-violet-500"></i> ${x.duration}</span>
            <span><i class="fa-solid fa-location-dot text-violet-500"></i> ${x.meetingPoint || 'Sharm'}</span>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-[10px] text-gray-500">From</p>
              <p class="font-display font-bold text-violet-500 text-xl">${utils.formatPrice(x.price)}<span class="text-xs font-normal"> /person</span></p>
            </div>
            <button class="btn-gold px-5 py-2.5 rounded-xl text-sm font-bold text-ink-900">Book Now</button>
          </div>
        </div>
      </div>`;
  }
};

// ==================== TRANSFERS RENDERER ====================
const transfersUi = {
  render() {
    if (!SHOW_TRANSFERS) return;
    const list = document.getElementById('transfersList');
    if (list) {
      list.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-28';
      list.innerHTML = CATALOG.transfers.map(v => this.renderCard(v)).join('');
    }
  },
  renderCard(v) {
    const img = getImageUrl(v.image);
    return `
      <div onclick="showTransferPage('${v.id}')" class="transfer-card bg-card rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer">
        <div class="relative h-40 overflow-hidden">
          <img src="${img}" class="w-full h-full object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
          <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
          <span class="absolute top-3 left-3 bg-gold-400 text-ink-900 text-xs font-bold px-3 py-1 rounded-full"><i class="fa-solid fa-star mr-1"></i> ${v.rating || 4.5}</span>
        </div>
        <div class="p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-display font-bold text-lg">${v.vehicleType}</h3>
            <span class="text-xs font-bold px-3 py-1 rounded-full bg-violet-50 text-violet-600"><i class="fa-solid fa-user-group mr-1"></i> Up to ${v.capacity}</span>
          </div>
          <p class="text-sm text-gray-500 mb-4 line-clamp-2">${v.description}</p>
          <div class="flex flex-wrap gap-2 mb-4">
            ${(v.features || []).slice(0,3).map(f => `<span class="text-xs px-3 py-1 rounded-lg" style="background:var(--bg-field);border:1px solid var(--border-field);color:var(--text-secondary)">${f}</span>`).join('')}
          </div>
          <div class="flex items-center justify-between border-t pt-3" style="border-color:var(--border-card)">
            <div>
              <p class="text-[10px] text-gray-500">One-way trip</p>
              <p class="font-display font-bold text-violet-500 text-xl">${utils.formatPrice(v.price)}</p>
            </div>
            <button class="btn-gold px-6 py-2.5 rounded-xl font-bold text-ink-900 text-sm">View Details</button>
          </div>
        </div>
      </div>`;
  }
};

// ==================== SHOW TRANSFER PAGE ====================
function showTransferPage(id, opts = {}) {
  const v = CATALOG.transfers.find(t => t.id === id);
  if (!v) return toast('Transfer not found', 'error');

  const page = document.createElement('div');
  page.id = 'transferDetailPage';
  page.className = 'page';
  page.innerHTML = `
    <div class="min-h-screen pb-28" style="background:var(--bg-card)">
      <div class="relative h-80">
        <img src="${getImageUrl(v.image)}" class="w-full h-full object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
        <button onclick="closeTransferPage()" class="absolute top-4 right-4 w-11 h-11 bg-white rounded-full flex items-center justify-center shadow-lg text-ink-900 z-10"><i class="fa-solid fa-arrow-right"></i></button>
        <div class="absolute bottom-5 left-5 right-5 text-white">
          <div class="flex items-center gap-2 mb-2">
            <span class="bg-gold-400 text-ink-900 text-xs font-bold px-3 py-1 rounded-full"><i class="fa-solid fa-shuttle-van mr-1"></i> ${v.vehicleType}</span>
            <span class="rating-pill px-2 py-1 rounded-full flex items-center gap-1"><i class="fa-solid fa-star text-gold-400 text-[10px]"></i><span class="text-[10px] font-bold text-gold-400">${v.rating || 4.5}</span></span>
          </div>
          <h1 class="font-display text-3xl font-bold leading-tight mb-2">${v.vehicleType} Transfer</h1>
          <p class="text-sm text-white/80"><i class="fa-solid fa-users"></i> Up to ${v.capacity} passengers</p>
        </div>
      </div>
      <div class="relative -mt-6 rounded-t-[28px] p-6 space-y-6" style="background:var(--bg-card)">
        <div>
          <p class="text-violet-500 text-sm font-semibold mb-2">— ABOUT THIS TRANSFER</p>
          <p class="text-sm leading-relaxed" style="color:var(--text-secondary)">${v.fullDescription || v.description}</p>
        </div>
        <div>
          <p class="text-violet-500 text-sm font-semibold mb-3">— FEATURES</p>
          <div class="grid grid-cols-2 gap-3">
            ${(v.features || []).map(f => `<div class="field-box rounded-xl p-3 flex items-center gap-2 text-sm"><i class="fa-solid fa-check text-green-500"></i> ${f}</div>`).join('')}
          </div>
        </div>
        <div class="card rounded-2xl p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-xs text-gray-500">One-way trip</p>
              <p class="font-display font-bold text-violet-500 text-2xl">${utils.formatPrice(v.price)}</p>
            </div>
            <button onclick="startTransferBooking('${v.id}')" class="btn-gold px-8 py-3 rounded-xl font-bold text-ink-900">Book Now</button>
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById('mainApp').appendChild(page);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  page.classList.add('active');
  window.scrollTo(0,0);
  routeToDetail('transfers', v.id, `${v.vehicleType} Transfer`, opts);
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
  renderFull() {
    if (!SHOW_RESTAURANTS) return;
    const list = document.getElementById('restaurantsFullList');
    if (list) {
      list.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-28';
      list.innerHTML = CATALOG.restaurants.map(r => this.renderCard(r)).join('');
    }
  },
  renderCard(r) {
    const img = getImageUrl(r.image);
    return `
      <div onclick="showRestaurantPage('${r.id}')" class="restaurant-card w-full bg-card rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer">
        <div class="relative h-36 overflow-hidden">
          <img src="${img}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover hover:scale-105 transition-transform duration-500">
          <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
          <span class="absolute top-3 left-3 bg-ink-950/70 text-white text-xs font-bold px-3 py-1 rounded-full capitalize">${r.category}</span>
          <span class="absolute top-3 right-3 rating-pill px-2 py-1 rounded-full flex items-center gap-1"><i class="fa-solid fa-star text-gold-400 text-[10px]"></i><span class="text-[10px] font-bold text-gold-400">${r.rating}</span></span>
        </div>
        <div class="p-4">
          <h3 class="font-display font-bold text-lg mb-1 truncate">${r.name}</h3>
          <p class="text-sm text-gray-500 mb-2">${r.cuisine} · ${'$'.repeat(r.priceLevel || 2)}</p>
          <p class="text-xs text-gray-400 flex items-center gap-1"><i class="fa-solid fa-location-dot text-violet-500"></i>${r.location}</p>
        </div>
      </div>`;
  }
};

// ==================== DESTINATIONS RENDERER ====================
const destinationsUi = {
  render() {
    if (!SHOW_DESTINATIONS) return;
    const row = document.getElementById('destinationsRow');
    if (!row) return;
    row.innerHTML = CATALOG.destinations.map(d => {
      const imgSrc = getImageUrl(d.image);
      return `
        <div onclick="showDestinationPage('${d.id}')" class="destination-card cursor-pointer rounded-[18px] overflow-hidden shadow-lg">
          <img src="${imgSrc}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'" class="w-full h-full object-cover absolute inset-0">
          <div class="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent"></div>
          <div class="absolute top-3 right-3 rating-pill px-2 py-1 rounded-full"><span class="text-[9px] font-bold text-gold-400">★ ${d.rating}</span></div>
          <div class="absolute bottom-3 right-3 left-3 text-white">
            <p class="font-display font-bold text-base leading-tight">${d.name}</p>
            <p class="text-[10px] text-white/70 leading-snug">${d.tagline || ''}</p>
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
    row.innerHTML = CATALOG.articles.map(a => `
      <div onclick="showArticlePage('${a.id}')" class="article-card cursor-pointer flex gap-4 p-4 rounded-2xl bg-card shadow-sm hover:shadow-lg transition-all duration-300">
        <img src="${a.image}" class="w-28 h-28 object-cover rounded-xl flex-shrink-0" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <div class="flex-1 min-w-0">
          <p class="font-display font-bold text-base mb-1 leading-snug line-clamp-2">${a.title}</p>
          <p class="text-xs text-gray-500 mb-2 line-clamp-2">${a.excerpt}</p>
          <p class="text-[10px] text-gray-400"><i class="fa-regular fa-clock"></i> ${a.readTimeMinutes} min read</p>
        </div>
      </div>`).join('');
  }
};

// ==================== DESKTOP LAYOUT HELPER ====================
function applyDesktopLayout() {
  const isDesktop = window.innerWidth >= 1024;
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

  document.getElementById('drawerHotelsLink')?.classList.toggle('hidden', !SHOW_HOTELS);
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
  I18N.init();
  THEME.init();
  initCurrency();
  populateCountryCodeSelect();
  populateNationalitySelect();

  if (auth.isLoggedIn() && !currentUser) {
    try {
      const stored = localStorage.getItem('ds_current_user');
      if (stored) currentUser = JSON.parse(stored);
    } catch {}
  }

  search.switchTab(SHOW_HOTELS ? 'hotels' : 'excursions');
  search.init();

  applyDesktopLayout();
  applyCategoryVisibility();
  window.addEventListener('resize', applyDesktopLayout);

  if (auth.isLoggedIn()) { enterApp(); } else { nav.showAuth(); }
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
