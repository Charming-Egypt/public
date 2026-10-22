// ==================== CONFIG ====================
// إذا كان الـ Worker مرفوعاً على نفس الدومين، اترك API_BASE فارغاً ''
// أو ضع رابط الـ Worker الكامل (مثلاً: 'https://your-worker.your-subdomain.workers.dev')
const API_BASE = window.DS_API_BASE || '';   // set per site by the build (site.config.json -> apiBase); '' = same origin
let authToken = localStorage.getItem('ds_auth_token') || null;
let currentUser = null;
try {
  const storedUser = localStorage.getItem('ds_current_user');
  if (storedUser && storedUser !== 'null') {
    currentUser = JSON.parse(storedUser);
  }
} catch (e) {
  currentUser = null;
}
let authMode = 'login';

const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27%3E%3Crect fill=%27%23262626%27 width=%27400%27 height=%27300%27/%3E%3Ctext x=%27200%27 y=%27150%27 text-anchor=%27middle%27 dy=%27.3em%27 fill=%27%23a3a3a3%27 font-size=%2720%27 font-family=%27sans-serif%27%3ENo Image%3C/text%3E%3C/svg%3E";

// ==================== STATE ====================
const state = {
  bookings: [],
  favorites: [],
  currency: localStorage.getItem('ds_display_currency') || 'EGP',
  currentFilter: 'all',
  hotelSortBy: 'popular',
  hotelMinPrice: null,
  hotelMaxPrice: null,
  hotelMinRating: 0,
  currentExcursionFilter: 'all',
  excursionSearchQuery: '',
  excursionSortBy: 'popular',
  excursionMinPrice: null,
  excursionMaxPrice: null,
  excursionMinRating: 0,
  transferSearchQuery: '',
  transferSortBy: 'popular',
  transferMinPrice: null,
  transferMaxPrice: null,
  transferMinCapacity: 0,
  restaurantSearchQuery: '',
  restaurantSortBy: 'popular',
  restaurantType: 'all',
  restaurantPriceLevel: 0,
  restaurantCuisine: 'all',
  restaurantMinRating: 0,
  tripPax: 2,
  searchQuery: '',
  currentHotel: null,
  currentRoom: null,
  currentExcursion: null,
  currentTransfer: null,
  currentBookingTab: 'upcoming',
  activeSearchTab: 'hotels',
  guests: { adults: 2, children: 0, infants: 0, rooms: 1, childAges: [] },
  pageHistory: ['home'],
  bookingDraft: {},
  transferPax: 2,
  transferDirection: 'Airport to Hotel',
  hotelsCache: [],
  reviewTarget: null,
  userTier: 0,
  userStats: { completedBookings: 0, totalSpent: 0 },
};

const CATALOG = { hotels: [], excursions: [], transfers: [], destinations: [], restaurants: [], reviews: [], articles: [] };
const CATALOG_RAW = { hotels: [], excursions: [], transfers: [], destinations: [], restaurants: [], reviews: [], articles: [] };

// ==================== MULTILANG FIELDS ====================
const MULTILANG_FIELDS = [
  'name', 'title', 'description', 'fullDescription', 'location', 'vehicleType',
  'duration', 'tagline', 'cuisine', 'text', 'itemName', 'excerpt', 'content',
  'openHours', 'category', 'type', 'beds', 'size', 'meetingPoint', 'address', 'subtitle'
];
const MULTILANG_ARRAY_FIELDS = ['amenities', 'includes', 'features', 'excludes', 'whatToBring', 'images', 'menu', 'itinerary'];

// ==================== COUNTRY CODES ====================
const COUNTRY_CODES = [
  { code: 'EG', dial: '+20', name: 'Egypt' },
  { code: 'SA', dial: '+966', name: 'Saudi Arabia' },
  { code: 'AE', dial: '+971', name: 'UAE' },
  { code: 'KW', dial: '+965', name: 'Kuwait' },
  { code: 'QA', dial: '+974', name: 'Qatar' },
  { code: 'BH', dial: '+973', name: 'Bahrain' },
  { code: 'OM', dial: '+968', name: 'Oman' },
  { code: 'JO', dial: '+962', name: 'Jordan' },
  { code: 'GB', dial: '+44', name: 'United Kingdom' },
  { code: 'US', dial: '+1', name: 'United States' },
  { code: 'DE', dial: '+49', name: 'Germany' },
  { code: 'FR', dial: '+33', name: 'France' },
  { code: 'IT', dial: '+39', name: 'Italy' },
  { code: 'ES', dial: '+34', name: 'Spain' },
  { code: 'RU', dial: '+7', name: 'Russia' },
  { code: 'TR', dial: '+90', name: 'Turkey' },
  { code: 'IN', dial: '+91', name: 'India' },
  { code: 'CN', dial: '+86', name: 'China' },
  { code: 'JP', dial: '+81', name: 'Japan' },
  { code: 'BR', dial: '+55', name: 'Brazil' },
  { code: 'CA', dial: '+1', name: 'Canada' },
  { code: 'AU', dial: '+61', name: 'Australia' }
];

function countryFlagEmoji(isoCode) {
  if (!isoCode || isoCode.length !== 2) return '';
  return String.fromCodePoint(...[...isoCode.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
}

function populateCountryCodeSelect() {
  const sel = document.getElementById('authCountryCode');
  if (!sel) return;
  sel.innerHTML = COUNTRY_CODES.map(c =>
    `<option value="${c.dial}">${countryFlagEmoji(c.code)} ${c.dial}</option>`
  ).join('');
  sel.value = '+20';
}

function populateNationalitySelect() {
  const sel = document.getElementById('reviewNationality');
  if (!sel) return;
  sel.innerHTML = COUNTRY_CODES.map(c =>
    `<option value="${c.code}">${countryFlagEmoji(c.code)} ${c.name} (${c.code})</option>`
  ).join('');
  sel.value = 'EG';
}

// ==================== CURRENCY ====================
const CURRENCY_SYMBOLS = { EGP: 'ج.م', USD: '$', EUR: '€', GBP: '£', SAR: 'ر.س', RUB: '₽' };
const DISPLAY_CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'RUB'];
let currencyRates = null;
let currencyAvailable = false;

async function initCurrency() {
  try {
    const cached = JSON.parse(localStorage.getItem('ds_fx_cache') || 'null');
    if (cached && cached.rates && (Date.now() - cached.ts) < 6 * 60 * 60 * 1000) {
      currencyRates = cached.rates;
      currencyAvailable = true;
      applyCurrencyAvailability();
      return;
    }
    const res = await fetch('https://open.er-api.com/v6/latest/EGP');
    const data = await res.json();
    if (data && data.result === 'success' && data.rates) {
      currencyRates = data.rates;
      currencyAvailable = true;
      localStorage.setItem('ds_fx_cache', JSON.stringify({ rates: data.rates, ts: Date.now() }));
    } else {
      currencyAvailable = false;
    }
  } catch (err) {
    console.warn('Currency API unavailable — showing EGP only.', err);
    currencyAvailable = false;
  }
  applyCurrencyAvailability();
}

function applyCurrencyAvailability() {
  if (!currencyAvailable) state.currency = 'EGP';
  const sel = document.getElementById('currencySelect');
  if (sel) {
    sel.innerHTML = (currencyAvailable ? DISPLAY_CURRENCIES : ['EGP']).map(c => `<option value="${c}">${c} (${CURRENCY_SYMBOLS[c]})</option>`).join('');
    sel.value = state.currency;
    sel.disabled = !currencyAvailable;
  }
  const note = document.getElementById('currencyAvailabilityNote');
  if (note) note.classList.toggle('hidden', currencyAvailable);
}

function formatPrice(egpAmount) {
  if (!currencyAvailable || state.currency === 'EGP' || !currencyRates || !currencyRates[state.currency]) {
    return 'ج.م ' + Math.round(egpAmount).toLocaleString();
  }
  const converted = egpAmount * currencyRates[state.currency];
  const symbol = CURRENCY_SYMBOLS[state.currency] || CURRENCY_SYMBOLS.EGP;
  const decimals = state.currency === 'EGP' ? 0 : 2;
  return `${symbol}${converted.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

// ==================== UTILITIES ====================
const utils = {
  isoLocal(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  todayIso() { return this.isoLocal(new Date()); },
  addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return this.isoLocal(d); },
  formatDate(iso) { if (!iso) return '—'; return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); },
  formatPrice: formatPrice,
  generateId() { return 'DS-' + Math.random().toString(36).substr(2, 6).toUpperCase(); },
  renderStars(rating) { let s=''; const r=Math.round(rating||0); for(let i=1;i<=5;i++) s += i<=r ? '<i class="fa-solid fa-star text-gold-400 text-[10px]"></i>' : '<i class="fa-solid fa-star text-[10px]" style="color:#453f5c"></i>'; return s; },
  avgRating(list) { return list.length ? list.reduce((s, r) => s + Number(r.rating || 0), 0) / list.length : null; },
  confetti() {
    const colors = ['#fbbf24', '#fcd34d', '#f97316', '#c2410c', '#fb7185', '#ffffff'];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[Math.floor(Math.random() * colors.length)];
      c.style.width = (Math.random() * 8 + 4) + 'px';
      c.style.height = (Math.random() * 8 + 4) + 'px';
      c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      c.style.animationDelay = Math.random() * 0.5 + 's';
      c.style.animationDuration = (Math.random() * 2 + 2) + 's';
      document.body.appendChild(c);
      setTimeout(() => c.remove(), 4500);
    }
  },
  stepIndicator(current, labels) {
    const steps = labels.map((label, i) => ({ n: i + 1, label }));
    return `<div class="flex items-start justify-center">` + steps.map((s, idx) => {
      const done = s.n < current, activeStep = s.n === current;
      const circleClass = done ? 'bg-gold-400 text-ink-900' : activeStep ? 'bg-white text-violet-700 ring-2 ring-white' : 'bg-white/15 text-white/60';
      const labelClass = activeStep || done ? 'text-white font-semibold' : 'text-white/50';
      const inner = done ? '<i class="fa-solid fa-check"></i>' : s.n;
      let html = `<div class="flex flex-col items-center"><div class="step-circle ${circleClass}">${inner}</div><span class="step-label ${labelClass}">${s.label}</span></div>`;
      if (idx < steps.length - 1) html += `<div class="step-line ${s.n < current ? 'bg-gold-400' : 'bg-white/20'} mt-4"></div>`;
      return html;
    }).join('') + `</div>`;
  },
  createStars(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 50; i++) {
      const star = document.createElement('div');
      star.className = 'star';
      star.style.left = Math.random() * 100 + '%';
      star.style.top = Math.random() * 100 + '%';
      star.style.animationDelay = Math.random() * 3 + 's';
      star.style.animationDuration = (Math.random() * 2 + 2) + 's';
      container.appendChild(star);
    }
  }
};

function toast(msg, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-violet-600' };
  const icons = { success: 'fa-check', error: 'fa-xmark', info: 'fa-info' };
  const t = document.createElement('div');
  t.className = `${colors[type]} text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 toast`;
  t.innerHTML = `<div class="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center"><i class="fa-solid ${icons[type]} text-sm"></i></div><span class="text-sm font-medium">${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-20px)'; setTimeout(() => t.remove(), 400); }, 3000);
}

// ==================== CONFIRM DIALOG ====================
// Accessible replacement for window.confirm(): labelled action buttons,
// focus lands on the SAFE choice, Escape / backdrop = keep, focus returns
// to whatever opened it. Resolves true only when the user confirms.
function confirmDialog({ title, body = '', confirmLabel, cancelLabel, danger = false }) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'ds-dialog-overlay';
    wrap.innerHTML = `
      <div class="ds-dialog" role="alertdialog" aria-modal="true" aria-labelledby="dsDlgTitle" aria-describedby="dsDlgBody">
        <h2 id="dsDlgTitle" class="ds-dialog-title">${esc(title)}</h2>
        <p id="dsDlgBody" class="ds-dialog-body">${esc(body)}</p>
        <div class="ds-dialog-actions">
          <button type="button" class="ds-dialog-btn ds-dialog-btn-safe" data-act="no">${esc(cancelLabel)}</button>
          <button type="button" class="ds-dialog-btn ${danger ? 'ds-dialog-btn-danger' : 'ds-dialog-btn-primary'}" data-act="yes">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const done = val => {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      if (opener && opener.focus) opener.focus();
      resolve(val);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Tab') {                       // keep focus inside the dialog
        const f = wrap.querySelectorAll('button');
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    wrap.addEventListener('click', e => {
      if (e.target === wrap) return done(false);
      const act = e.target.closest('[data-act]');
      if (act) done(act.dataset.act === 'yes');
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-act="no"]').focus();
  });
}

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function hideSplash() {
  const splash = document.getElementById('splashPage');
  if (splash) {
    splash.style.transition = 'opacity .5s ease';
    splash.style.opacity = '0';
    setTimeout(() => { splash.style.display = 'none'; splash.remove(); }, 500);
  }
}

// ==================== THEME ====================
const THEME = {
  get() { return localStorage.getItem('ds_theme') || 'dark'; },
  set(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('ds_theme', t);
    document.querySelectorAll('.theme-switch .knob i').forEach(i => {
      i.className = t === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    });
  },
  toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
  init() { this.set(this.get()); }
};

// ==================== API HELPER ====================
async function apiFetch(endpoint, options = {}, skipAuthRedirect = false) {
  // Supabase mode (see supabase-api.js): accounts, catalog, bookings, favorites,
  // reviews, notifications and the public forms are answered by the database.
  if (window.SB) {
    try {
      return await SB.handle(endpoint, options);
    } catch (e) {
      if (e.status === 401 && !skipAuthRedirect) {
        authToken = null;
        currentUser = null;
        localStorage.removeItem('ds_auth_token');
        localStorage.removeItem('ds_current_user');
        nav.showAuth();
      }
      throw e;
    }
  }

  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

  if (res.status === 401) {
    if (!skipAuthRedirect) {
      authToken = null;
      currentUser = null;
      localStorage.removeItem('ds_auth_token');
      localStorage.removeItem('ds_current_user');
      nav.showAuth();
    }
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Authentication failed');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ==================== I18N ====================
let SUPPORTED_LANGS = ['en'];
let LANG_LABELS = { en: 'English' };
let I18N_DICT = {};
const RTL_LANGS = new Set(['ar']);   // extra languages the admin adds with dir=rtl are added here

async function loadI18nDict() {
  try {
    const manifestRes = await fetch('/data/lang/manifest.json');
    const manifest = await manifestRes.json();
    SUPPORTED_LANGS = manifest.languages.map(l => l.code);
    LANG_LABELS = {};
    manifest.languages.forEach(l => { LANG_LABELS[l.code] = l.label; });
    const dictResponses = await Promise.all(SUPPORTED_LANGS.map(code => fetch('/data/lang/' + code + '.json')));
    const dictJsons = await Promise.all(dictResponses.map(r => r.json()));
    SUPPORTED_LANGS.forEach((code, i) => {
      const langDict = dictJsons[i];
      Object.keys(langDict).forEach(key => {
        if (!I18N_DICT[key]) I18N_DICT[key] = {};
        I18N_DICT[key][code] = langDict[key];
      });
    });
  } catch (err) {
    console.warn('Language files missing, using English only.');
    SUPPORTED_LANGS = ['en'];
    LANG_LABELS = { en: 'English' };
  }
  // site settings: languages the admin enabled/disabled, extra languages (strings come from the database), default language
  try {
    const st = window.DS_SETTINGS_READY ? await window.DS_SETTINGS_READY : null;
    if (st) {
      for (const l of st.langs || []) {
        if (!SUPPORTED_LANGS.includes(l.code)) SUPPORTED_LANGS.push(l.code);
        LANG_LABELS[l.code] = l.native_name || l.name || l.code;
        if (l.dir === 'rtl') RTL_LANGS.add(l.code);
        Object.entries(l.strings || {}).forEach(([key, val]) => { (I18N_DICT[key] = I18N_DICT[key] || {})[l.code] = val; });
      }
      const cfgL = (st.value || {}).languages || {};
      if (Array.isArray(cfgL.enabled) && cfgL.enabled.length) SUPPORTED_LANGS = SUPPORTED_LANGS.filter(c => cfgL.enabled.includes(c));
      if (cfgL.default && SUPPORTED_LANGS.includes(cfgL.default)) window.DS_DEFAULT_LANG = cfgL.default;
    }
  } catch (e) { /* settings unavailable: all built-in languages */ }
  populateLanguageSelects();
}

function populateLanguageSelects() {
  const optionsHtml = SUPPORTED_LANGS.map(code => `<option value="${code}">${LANG_LABELS[code] || code}</option>`).join('');
  document.querySelectorAll('.lang-select').forEach(sel => { sel.innerHTML = optionsHtml; });
}

// Looks up one UI string for the CURRENT language, for use inside JS
// template literals when building cards/toasts/dynamic pages (as opposed
// to data-i18n, which only updates existing static DOM elements). Falls
// back to English, then to the key itself so a missing translation never
// breaks the render — it just shows in English.
function t(key) {
  const entry = I18N_DICT[key];
  const lang = I18N.get();
  return (entry && (entry[lang] || entry.en)) || key;
}

const I18N = {
  get() { return localStorage.getItem('ds_lang') || window.DS_DEFAULT_LANG || 'en'; },
  set(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) lang = SUPPORTED_LANGS.includes(window.DS_DEFAULT_LANG) ? window.DS_DEFAULT_LANG : (SUPPORTED_LANGS.includes('en') ? 'en' : SUPPORTED_LANGS[0]);
    localStorage.setItem('ds_lang', lang);
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', RTL_LANGS.has(lang) ? 'rtl' : 'ltr');
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const entry = I18N_DICT[key];
      const val = entry && (entry[lang] || entry.en);
      if (val) { if (el.tagName === 'OPTION') el.textContent = val; else el.innerHTML = val; }
    });
    // Same lookup, but for the placeholder attribute of form fields
    // (translating innerHTML would do nothing for an <input>/<textarea>).
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const entry = I18N_DICT[key];
      const val = entry && (entry[lang] || entry.en);
      if (val) el.setAttribute('placeholder', val);
    });
    // aria-label for icon-only buttons (same lookup, different attribute)
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const entry = I18N_DICT[el.getAttribute('data-i18n-aria')];
      const val = entry && (entry[lang] || entry.en);
      if (val) el.setAttribute('aria-label', val);
    });
    document.querySelectorAll('.lang-select').forEach(sel => { sel.value = lang; });
    localizeCatalog(lang);
    refreshCatalogUI();
  },
  init() { this.set(this.get()); }
};

// ==================== LOCALIZATION ====================
function localizeValue(value, lang) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value[lang] || value.en || '';
  }
  return value || '';
}

function getImageUrl(item) {
  return localizeValue(item, I18N.get());
}

function localizeItem(raw, lang) {
  const out = Object.assign({}, raw);
  // Always run every multilang field through localizeValue — even when the raw
  // item never had that key at all. localizeValue(undefined, lang) safely
  // returns '' (see above), whereas leaving out[f] untouched left it as the
  // literal `undefined`, which template literals then print as the text
  // "undefined" right on the card. This is what fixes that everywhere at once,
  // for every catalog type, instead of patching each template one by one.
  MULTILANG_FIELDS.forEach(f => { out[f] = localizeValue(raw[f], lang); });
  MULTILANG_ARRAY_FIELDS.forEach(f => {
    out[f] = Array.isArray(raw[f]) ? raw[f].map(v => localizeValue(v, lang)) : (raw[f] !== undefined ? localizeValue(raw[f], lang) : []);
  });
  if (Array.isArray(raw.rooms)) {
    out.rooms = raw.rooms.map(room => ({
      ...room,
      type: localizeValue(room.type, lang),
      beds: localizeValue(room.beds, lang),
      description: localizeValue(room.description, lang),
      amenities: Array.isArray(room.amenities) ? room.amenities.map(a => localizeValue(a, lang)) : [],
    }));
  }
  if (Array.isArray(raw.menu)) {
    out.menu = raw.menu.map(section => ({
      category: localizeValue(section.category, lang),
      items: (section.items || []).map(item => ({
        ...item,
        name: localizeValue(item.name, lang),
        description: localizeValue(item.description, lang),
      })),
    }));
  }
  if (Array.isArray(raw.itinerary)) {
    out.itinerary = raw.itinerary.map(step => ({
      ...step,
      title: localizeValue(step.title, lang),
      description: localizeValue(step.description, lang),
    }));
  }
  return out;
}

function localizeCatalog(lang) {
  CATALOG.hotels = CATALOG_RAW.hotels.map(item => localizeItem(item, lang));
  CATALOG.excursions = CATALOG_RAW.excursions.map(item => localizeItem(item, lang));
  CATALOG.transfers = CATALOG_RAW.transfers.map(item => localizeItem(item, lang));
  CATALOG.destinations = CATALOG_RAW.destinations.map(item => localizeItem(item, lang));
  CATALOG.restaurants = CATALOG_RAW.restaurants.map(item => localizeItem(item, lang));
  CATALOG.reviews = CATALOG_RAW.reviews.map(item => localizeItem(item, lang));
  CATALOG.articles = CATALOG_RAW.articles.map(item => localizeItem(item, lang));
}

// ==================== CATALOG LOADING ====================
async function loadCatalogFromWorker() {
  const files = ['hotels', 'excursions', 'transfers', 'destinations', 'restaurants', 'reviews', 'articles'];
  const STATIC_FILES = ['destinations', 'articles'].concat(window.DS_SUPABASE ? [] : ['reviews']);   // reviews: real customer reviews when Supabase is on (supabase-api.js), static JSON otherwise   // served from /data/*.json (edit them in the repo, then build + push)
  const CACHE_KEY = 'ds_catalog_v3', CACHE_TTL = 10 * 60 * 1000;

  // Every page is now its own HTML file, so the catalog is requested on each
  // navigation. A short session cache makes page-to-page jumps instant; fresh
  // data is always fetched in the background and swapped in.
  let warm = false;
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.t && Date.now() - c.t < CACHE_TTL && c.d) {
      Object.assign(CATALOG_RAW, c.d);
      localizeCatalog(I18N.get());
      refreshCatalogUI();
      warm = true;
    }
  } catch {}

  const fetchAll = async () => {
    const results = await Promise.all(files.map(async (f) => {
      try {
        if (STATIC_FILES.includes(f)) {   // editorial content: plain JSON files shipped with the site (data/*.json), not the database
          const r = await fetch(`/data/${f}.json${window.DS_DATA_V ? '?v=' + window.DS_DATA_V : ''}`);
          if (!r.ok) throw new Error(`${f}.json: HTTP ${r.status}`);
          return [f, await r.json()];
        }
        const data = await apiFetch(`/api/file?file=${f}.json`, {}, true);
        return [f, typeof data.content === 'string' ? JSON.parse(data.content) : (data.content || data)];
      } catch (e) {
        console.warn(`Failed to load ${f}:`, e);
        return [f, null];
      }
    }));
    const fresh = {};
    let saved = {};   // last good copy of every file, kept across sessions so the installed app still shows content offline
    try { saved = JSON.parse(localStorage.getItem('ds_catalog_offline') || '{}'); } catch {}
    for (const [f, v] of results) {
      if (v !== null) { CATALOG_RAW[f] = v; fresh[f] = v; }
      else if (!warm) CATALOG_RAW[f] = saved[f] || [];
    }
    try { if (Object.keys(fresh).length) localStorage.setItem('ds_catalog_offline', JSON.stringify({ ...saved, ...fresh })); } catch {}
    localizeCatalog(I18N.get());
    refreshCatalogUI();
    try { if (Object.keys(fresh).length === files.length) sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: fresh })); } catch {}
  };

  if (warm) { fetchAll(); return; }   // cached data is already on screen
  await fetchAll();
}

function refreshCatalogUI() {
  try { window.DS_renderSiteBits && window.DS_renderSiteBits(); } catch (e) { /* frontend.js not ready yet */ }
  try { if (document.getElementById('searchCard')) search.refreshLabels(); } catch (e) { /* frontend.js not ready yet */ }
  if (document.getElementById('hotelsList')) hotels.render();
  if (document.getElementById('excursionsList')) excursionsUi.render();
  if (document.getElementById('transfersList')) transfersUi.render();
  if (document.getElementById('restaurantsFullList')) restaurantsUi.renderFull();
  if (document.getElementById('destinationsRow')) destinationsUi.render();
  if (document.getElementById('featuredHotels')) ui.renderFeaturedHotels();
  if (document.getElementById('featuredExcursions')) excursionsUi.renderFeatured();
  if (document.getElementById('restaurantsRow')) restaurantsUi.renderRow();
  if (document.getElementById('reviewsRow')) reviewsHomeUi.render();
  if (document.getElementById('articlesRow')) articlesUi.render();
}

// ==================== AUTH ====================
const auth = {
  async signIn(email, password) {
    try {
      const data = await apiFetch('/api/auth/signin', { method: 'POST', body: JSON.stringify({ email, password }) }, true);
      authToken = data.idToken;
      currentUser = { ...data.user, uid: data.user.uid, geniusLevel: data.user.geniusLevel || 0 };
      localStorage.setItem('ds_auth_token', authToken);
      localStorage.setItem('ds_current_user', JSON.stringify(currentUser));
      updateDrawerUser(currentUser.displayName || currentUser.email, currentUser.email, currentUser.photoURL);
      return data.user;
    } catch (e) { toast(e.message, 'error'); return null; }
  },
  async signUp(name, email, password, extra = {}) {
    try {
      const data = await apiFetch('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, phone: extra.phone || '', countryCode: extra.countryCode || '' }),
      }, true);
      authToken = data.idToken;
      currentUser = { ...data.user, uid: data.user.uid, geniusLevel: data.user.geniusLevel || 0 };
      localStorage.setItem('ds_auth_token', authToken);
      localStorage.setItem('ds_current_user', JSON.stringify(currentUser));
      updateDrawerUser(currentUser.displayName || currentUser.email, currentUser.email, currentUser.photoURL);
      return data.user;
    } catch (e) { auth._needsConfirm = !!e.confirm; toast(e.message, e.confirm ? 'info' : 'error'); return null; }
  },
  logout() {
    try { sessionStorage.removeItem('ds_guest'); } catch {}
    if (window.SB) SB.signOut().catch(() => {});
    authToken = null;
    currentUser = null;
    localStorage.removeItem('ds_auth_token');
    localStorage.removeItem('ds_current_user');
    nav.showAuth();
  },
  isLoggedIn() { return !!authToken; },
  continueAsGuest() {
    localStorage.removeItem('ds_auth_token');
    localStorage.removeItem('ds_current_user');
    authToken = null;
    currentUser = null;
    try { sessionStorage.setItem('ds_guest', '1'); } catch {}
    enterApp();
  }
};

// ---- Log in / multi-step sign-up --------------------------------------------------------
// Sign-up is three steps: 1 account (email + password) → 2 details (name + phone) → 3 confirm + terms.
// Log in is a single pane. Both share one <form id="authForm"> and the same field ids.
let authStep = 1;
const AUTH_STEPS = 3;
const AUTH_STEP_KEYS = ['authStepAccount', 'authStepDetails', 'authStepConfirm'];
const AUTH_STEP_FALLBACK = ['Account', 'Your details', 'Confirm'];

function authEl(id) { return document.getElementById(id); }
function authSetErr(field, msg) {
  const map = { email: ['errEmail', 'authEmail'], password: ['errPassword', 'authPassword'], name: ['errName', 'authName'], phone: ['errPhone', 'authPhone'], terms: ['errTerms', 'authTerms'] };
  const [errId, inputId] = map[field] || [];
  const err = authEl(errId), inp = authEl(inputId);
  if (err) err.textContent = msg || '';
  if (inp) { inp.setAttribute('aria-invalid', msg ? 'true' : 'false'); inp.closest('.auth-input, .auth-phone')?.classList.toggle('has-error', !!msg); }
}
function authClearErrors() { ['email', 'password', 'name', 'phone', 'terms'].forEach(f => authSetErr(f, '')); }

function switchAuthMode(mode) {
  authMode = mode;
  authStep = 1;
  const isLogin = mode === 'login';
  const title = isLogin ? t('welcomeBack', 'Welcome Back') : t('createAccount', 'Create Account');
  const sub = isLogin ? t('authSubtitle', 'Sign in to manage your bookings') : t('authSignupSubtitle', 'Create your account in three quick steps');
  const authTitle = authEl('authTitle'); if (authTitle) authTitle.textContent = title;
  const authSub = authEl('authSubtitle'); if (authSub) authSub.textContent = sub;
  const form = authEl('authForm');
  if (form) form.classList.toggle('is-signup', !isLogin);
  authEl('authTabLogin')?.classList.toggle('is-active', isLogin);
  authEl('authTabSignup')?.classList.toggle('is-active', !isLogin);
  authEl('authTabLogin')?.setAttribute('aria-selected', String(isLogin));
  authEl('authTabSignup')?.setAttribute('aria-selected', String(!isLogin));
  authEl('authProgress')?.classList.toggle('hidden', isLogin);
  authEl('authSwitchText').textContent = isLogin ? t('noAccount', "Don't have an account?") : t('haveAccount', 'Already have an account?');
  authEl('authSwitchLink').textContent = isLogin ? t('signupBtn', 'Sign Up') : t('loginBtn', 'Log In');
  const pw = authEl('authPassword'); if (pw) pw.setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
  authClearErrors();
  authRenderStep(false);
}

function authRenderStep(focus = true) {
  const isLogin = authMode === 'login';
  const step = isLogin ? 1 : authStep;
  document.querySelectorAll('#authForm .auth-pane').forEach(p => p.classList.toggle('is-active', Number(p.dataset.pane) === step));
  authEl('authSocial')?.classList.toggle('hidden', !isLogin && step !== 1);
  authEl('authBackBtn')?.classList.toggle('hidden', isLogin || step === 1);
  const btn = authEl('authSubmitBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = isLogin ? t('loginBtn', 'Log In') : step < AUTH_STEPS ? t('continueBtn', 'Continue') : t('createAccount', 'Create Account');
  }
  if (!isLogin) {
    authEl('authStepCount').textContent = `${step} / ${AUTH_STEPS}`;
    authEl('authStepName').textContent = t(AUTH_STEP_KEYS[step - 1], AUTH_STEP_FALLBACK[step - 1]);
    authEl('authProgressFill').style.width = (step / AUTH_STEPS * 100) + '%';
    document.querySelectorAll('#authProgress .auth-step-dot').forEach(d => {
      const n = Number(d.dataset.dot);
      d.classList.toggle('is-active', n === step);
      d.classList.toggle('is-done', n < step);
    });
    if (step === 3) authFillReview();
  }
  if (focus) {
    const first = document.querySelector(`#authForm .auth-pane[data-pane="${step}"] input:not([type=checkbox]), #authForm .auth-pane[data-pane="${step}"] select`);
    if (first && !(step === 3)) setTimeout(() => first.focus({ preventScroll: true }), 60);
  }
}

function authFillReview() {
  const cc = authEl('authCountryCode')?.value || '';
  authEl('revName').textContent = authEl('authName').value.trim();
  authEl('revEmail').textContent = authEl('authEmail').value.trim();
  authEl('revPhone').textContent = `${cc} ${authEl('authPhone').value.trim()}`.trim();
}

function authGoStep(n) {
  if (authMode !== 'signup') return;
  authStep = Math.max(1, Math.min(AUTH_STEPS, n));
  authRenderStep();
}
function authBack() { if (authStep > 1) authGoStep(authStep - 1); }

function toggleAuthPassword(btn) {
  const inp = authEl('authPassword'); if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.querySelector('i').className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  btn.setAttribute('aria-label', show ? t('authHidePassword', 'Hide password') : t('authShowPassword', 'Show password'));
}

function authPasswordScore(pw) {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]|[A-Za-z]/.test(pw)) s++;
  return Math.min(4, pw.length < 6 ? Math.min(s, 1) : s);
}
document.addEventListener('input', (e) => {
  if (!e.target) return;
  if (e.target.id === 'authPassword') {
    const meter = authEl('authStrength'); if (!meter) return;
    const pw = e.target.value;
    const sc = pw ? authPasswordScore(pw) : 0;
    meter.dataset.score = String(sc);
    const labels = ['', t('authPwWeak', 'Weak'), t('authPwFair', 'Fair'), t('authPwGood', 'Good'), t('authPwStrong', 'Strong')];
    authEl('authStrengthLabel').textContent = labels[sc] || '';
  }
  const m = { authEmail: 'email', authPassword: 'password', authName: 'name', authPhone: 'phone', authTerms: 'terms' }[e.target.id];
  if (m) authSetErr(m, '');
});

function authValidate(step) {
  const email = authEl('authEmail').value.trim();
  const password = authEl('authPassword').value;
  let ok = true, firstBad = null;
  const bad = (field, msg, id) => { authSetErr(field, msg); ok = false; if (!firstBad) firstBad = id; };
  if (authMode === 'login' || step === 1) {
    if (!email) bad('email', t('authErrEmailRequired', 'Please enter your email.'), 'authEmail');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) bad('email', t('authErrEmailInvalid', 'This email address doesn’t look right.'), 'authEmail');
    if (!password) bad('password', t('authErrPasswordRequired', 'Please enter your password.'), 'authPassword');
    else if (authMode === 'signup' && password.length < 6) bad('password', t('authErrPasswordShort', 'Password must be at least 6 characters.'), 'authPassword');
  }
  if (authMode === 'signup' && step === 2) {
    const name = authEl('authName').value.trim();
    const phone = authEl('authPhone').value.replace(/[\s\-()]/g, '');
    if (name.length < 2) bad('name', t('authErrName', 'Please enter your full name.'), 'authName');
    if (!/^\d{6,15}$/.test(phone)) bad('phone', t('authErrPhone', 'Enter a valid phone number (digits only).'), 'authPhone');
  }
  if (authMode === 'signup' && step === 3 && !authEl('authTerms').checked) bad('terms', t('authErrTerms', 'Please accept the terms to continue.'), 'authTerms');
  if (firstBad) authEl(firstBad)?.focus({ preventScroll: false });
  return ok;
}

async function authForgotPassword() {
  const email = authEl('authEmail').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    authSetErr('email', t('authErrForgotEmail', 'Enter your email above first, then tap “Forgot password”.'));
    authEl('authEmail').focus();
    return;
  }
  try {
    await apiFetch('/api/auth/reset', { method: 'POST', body: JSON.stringify({ email }) }, true);
    toast(t('authResetSent', 'If an account exists for this email, a reset link is on its way.'), 'info');
  } catch (e) { toast(e.message, 'error'); }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const btn = authEl('authSubmitBtn');
  if (authMode === 'signup' && authStep < AUTH_STEPS) {
    if (authValidate(authStep)) authGoStep(authStep + 1);
    return;
  }
  // log in, or the last sign-up step: re-validate everything that was entered
  if (authMode === 'signup') {
    for (const st of [1, 2, 3]) if (!authValidate(st)) { authGoStep(st); return; }
  } else if (!authValidate(1)) return;

  const email = authEl('authEmail').value.trim();
  const password = authEl('authPassword').value;
  const name = authEl('authName')?.value.trim() || '';
  const countryCode = authEl('authCountryCode')?.value || '';
  const phone = authEl('authPhone')?.value.trim() || '';

  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>'; }
  let user = null;
  try {
    user = authMode === 'signup'
      ? await auth.signUp(name, email, password, { phone, countryCode })
      : await auth.signIn(email, password);
  } catch (err) { console.error(err); }
  if (user) enterApp();
  else if (auth._needsConfirm) { auth._needsConfirm = false; switchAuthMode('login'); }   // account created, email must be confirmed first
  else authRenderStep(false);   // failed: restore the button (toast already shown)
}

// ---- Screens for the links in our e-mails (confirm e-mail / reset password / change e-mail) --------------------
// SB.authLink (supabase-api.js) has already turned the link into a session; this just tells the visitor what happened.
function showAuthLinkScreen(link) {
  if (!link) return;
  document.getElementById('authLinkPage')?.remove();
  const ov = document.createElement('div');
  ov.id = 'authLinkPage';
  ov.className = 'fixed inset-0 overflow-y-auto dark-scene';
  ov.style.zIndex = '99990';
  const close = () => { ov.remove(); document.body.style.overflow = ''; };
  const icon = (cls, tone) => `<div class="auth-link-ico ${tone}"><i class="fa-solid ${cls}" aria-hidden="true"></i></div>`;
  const shell = (inner) => `
    <div class="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1600&q=80')] bg-cover bg-center opacity-20"></div>
    <div class="relative z-10 min-h-full flex items-center justify-center px-5 py-10">
      <div class="auth-card auth-link-card w-full" style="max-width:440px">${inner}</div>
    </div>`;
  const btn = (id, label) => `<button type="button" id="${id}" class="btn-gold auth-submit w-full mt-2">${label}</button>`;

  const done = (ico, tone, title, text) => {
    ov.innerHTML = shell(`${icon(ico, tone)}<h1 class="auth-link-title">${title}</h1><p class="auth-link-text">${text}</p>${btn('alContinue', t('authLinkContinue', 'Continue'))}`);
    ov.querySelector('#alContinue').onclick = close;
  };

  if (link.kind === 'error') {
    const expired = /expired|invalid|otp/i.test(`${link.code} ${link.message}`);
    ov.innerHTML = shell(`${icon('fa-link-slash', 'bad')}<h1 class="auth-link-title">${t('authLinkErrorTitle', 'This link is invalid or has expired')}</h1>
      <p class="auth-link-text">${expired ? t('authLinkErrorText', 'For your security, email links work once and only for a short time. Request a new one and try again.') : esc(link.message)}</p>
      ${btn('alBack', link.flow === 'recovery' ? t('authLinkResetAgain', 'Request a new reset link') : t('authLinkBackToLogin', 'Back to log in'))}`);
    ov.querySelector('#alBack').onclick = () => { close(); if (!auth.isLoggedIn()) nav.showAuth(); };
  } else if (link.kind === 'recovery') {
    ov.innerHTML = shell(`${icon('fa-key', 'gold')}<h1 class="auth-link-title">${t('authLinkRecoveryTitle', 'Choose a new password')}</h1>
      <p class="auth-link-text">${t('authLinkRecoveryText', 'Enter a new password for your account.')}</p>
      <form id="alForm" novalidate>
        <div class="auth-field"><label for="alPw">${t('authNewPassword', 'NEW PASSWORD')}</label>
          <div class="auth-input"><i class="fa-solid fa-lock auth-input-icon" aria-hidden="true"></i><input type="password" id="alPw" autocomplete="new-password" minlength="6"></div>
          <div class="auth-strength" id="alStrength" aria-hidden="true"><span></span><span></span><span></span><span></span><em id="alStrengthLabel"></em></div>
          <p class="auth-err" id="alErr1" role="alert"></p></div>
        <div class="auth-field"><label for="alPw2">${t('authConfirmPassword', 'CONFIRM PASSWORD')}</label>
          <div class="auth-input"><i class="fa-solid fa-lock auth-input-icon" aria-hidden="true"></i><input type="password" id="alPw2" autocomplete="new-password"></div>
          <p class="auth-err" id="alErr2" role="alert"></p></div>
        <button type="submit" id="alSave" class="btn-gold auth-submit w-full">${t('authLinkSavePassword', 'Save new password')}</button>
      </form>`);
    const pw = ov.querySelector('#alPw'), pw2 = ov.querySelector('#alPw2'), e1 = ov.querySelector('#alErr1'), e2 = ov.querySelector('#alErr2');
    pw.addEventListener('input', () => {
      const sc = pw.value ? authPasswordScore(pw.value) : 0, m = ov.querySelector('#alStrength');
      m.dataset.score = String(sc);
      ov.querySelector('#alStrengthLabel').textContent = ['', t('authPwWeak', 'Weak'), t('authPwFair', 'Fair'), t('authPwGood', 'Good'), t('authPwStrong', 'Strong')][sc] || '';
      e1.textContent = '';
    });
    pw2.addEventListener('input', () => { e2.textContent = ''; });
    ov.querySelector('#alForm').onsubmit = async (e) => {
      e.preventDefault();
      e1.textContent = e2.textContent = '';
      if (pw.value.length < 6) { e1.textContent = t('authErrPasswordShort', 'Password must be at least 6 characters.'); pw.focus(); return; }
      if (pw.value !== pw2.value) { e2.textContent = t('authPwMismatch', 'The two passwords do not match.'); pw2.focus(); return; }
      const b = ov.querySelector('#alSave'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>';
      try {
        await SB.updatePassword(pw.value);
        done('fa-circle-check', 'good', t('authLinkDoneTitle', 'Password updated'), t('authLinkDoneText', 'Your new password is saved and you are signed in.'));
      } catch (er) { b.disabled = false; b.textContent = t('authLinkSavePassword', 'Save new password'); e1.textContent = er.message || 'Error'; }
    };
    setTimeout(() => pw.focus(), 80);
  } else if (link.kind === 'email_change') {
    done('fa-circle-check', 'good', t('authLinkEmailChangedTitle', 'Email address updated'), t('authLinkEmailChangedText', 'Your new email address is confirmed.'));
  } else {
    done('fa-circle-check', 'good', t('authLinkConfirmedTitle', 'Email confirmed'), t('authLinkConfirmedText', 'Thank you! Your account is ready and you are signed in.'));
  }
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const hide = document.getElementById('splash'); if (hide) hide.style.display = 'none';
}

// ==================== GOOGLE SIGN-IN ====================
let googleSignInInitialized = false;
let googleClientIdPromise = null;

function t(key, fallback) {
  const entry = I18N_DICT[key];
  const lang = (typeof I18N !== 'undefined' && I18N.get) ? I18N.get() : 'en';
  return (entry && (entry[lang] || entry.en)) || fallback;
}

function isInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|GSA\/|KAKAOTALK|Snapchat|\bWhatsApp\b/i.test(ua);
}

function waitForGoogleLibrary(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const start = Date.now();
    const iv = setInterval(() => {
      if (window.google?.accounts?.id) { clearInterval(iv); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); reject(new Error(t('googleLoadError', 'Google Sign-In library not loaded. Please refresh the page.'))); }
    }, 100);
  });
}

async function getGoogleClientId() {
  if (window._googleClientId) return window._googleClientId;
  if (!googleClientIdPromise) {
    googleClientIdPromise = apiFetch('/api/google-config', {}, true)
      .then(cfg => { window._googleClientId = cfg.clientId; return cfg.clientId; })
      .catch(e => { googleClientIdPromise = null; throw e; });
  }
  return googleClientIdPromise;
}

async function initGoogleSignInButton() {
  const container = document.getElementById('googleSignInBtn');
  if (!container) return;

  if (isInAppBrowser()) {
    container.innerHTML = `<div class="w-full py-3.5 px-4 rounded-2xl text-xs text-center text-white/60 border leading-relaxed" style="border-color:#262626;">
      <i class="fa-solid fa-arrow-up-right-from-square mr-1.5"></i>
      <span data-i18n="openInBrowserForGoogle">${t('openInBrowserForGoogle', "Open this page in your phone's browser (not this app) to sign in with Google.")}</span>
    </div>`;
    return;
  }

  try {
    await waitForGoogleLibrary();
    const clientId = await getGoogleClientId();

    if (!googleSignInInitialized) {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        itp_support: true,
      });
      googleSignInInitialized = true;
    }

    container.innerHTML = '';
    google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'left',
      width: Math.max(240, Math.min(Math.round(container.offsetWidth) || 320, 400)),
    });
  } catch (e) {
    console.error('initGoogleSignInButton error:', e);
    container.innerHTML = `<button type="button" onclick="initGoogleSignInButton()" class="w-full py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 btn-white" style="border:1.5px solid #e8e3f4;">
      <i class="fa-solid fa-arrow-rotate-right"></i> <span>${t('retryGoogle', 'Retry Google Sign-In')}</span>
    </button>`;
  }
}

let _googleBtnResizeTimer = null;
window.addEventListener('resize', () => {
  const authPage = document.getElementById('authPage');
  if (!authPage || authPage.classList.contains('hidden')) return;
  clearTimeout(_googleBtnResizeTimer);
  _googleBtnResizeTimer = setTimeout(initGoogleSignInButton, 200);
});

async function handleGoogleCredentialResponse(response) {
  if (!response.credential) {
    toast('Google did not return an ID token.', 'error');
    return;
  }

  try {
    const data = await apiFetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: response.credential }),
    }, true);

    authToken = data.idToken;
    currentUser = { ...data.user, uid: data.user.uid, geniusLevel: data.user.geniusLevel || 0 };
    localStorage.setItem('ds_auth_token', authToken);
    localStorage.setItem('ds_current_user', JSON.stringify(currentUser));
    updateDrawerUser(currentUser.displayName || currentUser.email, currentUser.email, currentUser.photoURL);
    enterApp();
  } catch (e) {
    console.error('Google Sign-In API error:', e);
    toast(e.message || 'Google Sign-In failed.', 'error');
  }
}

// ==================== USER PROFILE & AVATAR ====================
const profileAvatar = {
  currentPhoto: null,
  render(name, photoURL) {
    this.currentPhoto = photoURL || null;
    const letter = (name || 'G').charAt(0).toUpperCase();
    const wrap = document.getElementById('profileAvatarWrap');
    const drawerAv = document.getElementById('drawerAvatar');
    const navAv = document.getElementById('navProfileAvatar');
    const snavAv = document.getElementById('snavProfileAvatar');
    const navAvDesktop = document.getElementById('navProfileAvatarDesktop');
    const sidebarAv = document.getElementById('sidebarProfileAvatar');
    if (wrap) wrap.innerHTML = photoURL ? `<img alt="" src="${photoURL}" class="w-full h-full object-cover">` : `<span class="font-display text-5xl font-bold text-violet-600" id="profileAvatarLetter">${letter}</span>`;
    if (drawerAv) drawerAv.innerHTML = photoURL ? `<img alt="" src="${photoURL}" class="w-full h-full object-cover">` : letter;
    if (navAv) navAv.innerHTML = photoURL ? `<img src="${photoURL}" alt="">` : letter;
    if (snavAv) snavAv.innerHTML = photoURL ? `<img src="${photoURL}" alt="">` : letter;
    if (navAvDesktop) navAvDesktop.innerHTML = photoURL ? `<img src="${photoURL}" alt="">` : letter;
    if (sidebarAv) sidebarAv.innerHTML = photoURL ? `<img src="${photoURL}" alt="">` : letter;
  },
  handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2; const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        this.save(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  },
  async save(dataUrl) {
    toast('Updating photo…', 'info');
    if (authToken) {
      try {
        const res = await apiFetch('/api/profile', {
          method: 'POST',
          body: JSON.stringify({ uid: currentUser?.uid, profile: { photoURL: dataUrl } }),
        });
        if (currentUser) {
          currentUser.photoURL = dataUrl;
          localStorage.setItem('ds_current_user', JSON.stringify(currentUser));
        }
        this.render(currentUser?.displayName || currentUser?.email || '', dataUrl);
        toast('Profile photo updated', 'success');
      } catch (e) {
        toast('Could not save photo: ' + e.message, 'error');
      }
    } else {
      localStorage.setItem('ds_avatar', dataUrl);
      this.render(document.getElementById('profileName').textContent, dataUrl);
      toast('Profile photo updated', 'success');
    }
  }
};

function updateDrawerUser(name, email, photoURL) {
  const safeName = name || t('guest');
  const safeEmail = email || '';
  const safePhoto = photoURL || null;
  const n = document.getElementById('drawerName'); if (n) n.textContent = safeName;
  const al = document.getElementById('drawerAuthLabel');   // a guest has nothing to log out of: offer sign-in instead
  if (al) { const k = (typeof auth !== 'undefined' && auth.isLoggedIn()) ? 'logout' : 'loginBtn'; al.setAttribute('data-i18n', k); al.textContent = t(k); }
  const e = document.getElementById('drawerEmail'); if (e) e.textContent = safeEmail;
  const pn = document.getElementById('profileName'); if (pn) pn.textContent = safeName;
  const pe = document.getElementById('profileEmail'); if (pe) pe.textContent = safeEmail;
  const sn = document.getElementById('sidebarProfileName'); if (sn) sn.textContent = safeName;
  const se = document.getElementById('sidebarProfileEmail'); if (se) se.textContent = safeEmail;
  profileAvatar.render(safeName, safePhoto);

  const badge = document.getElementById('drawerTierBadge');
  if (badge) {
    const level = (currentUser && currentUser.geniusLevel) || 0;
    if (level > 0) {
      const badges = {1:'🥉', 2:'🥈', 3:'🥇'};
      badge.classList.remove('hidden');
      badge.textContent = badges[level] || '';
      badge.title = `Sharmawy Level ${level}`;
    } else {
      badge.classList.add('hidden');
    }
  }
}

// ==================== REVIEWS ====================
const reviews = {
  currentTarget: null,
  selectedStars: 0,
  pendingImages: [],
  addImages(fileList) {
    const files = Array.from(fileList || []).slice(0, 6 - this.pendingImages.length);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        this.pendingImages.push(reader.result);
        this.renderImagePreview();
      };
      reader.readAsDataURL(file);
    });
    document.getElementById('reviewImages').value = '';
  },
  removeImage(i) {
    this.pendingImages.splice(i, 1);
    this.renderImagePreview();
  },
  renderImagePreview() {
    const el = document.getElementById('reviewImagePreview');
    if (!el) return;
    el.innerHTML = this.pendingImages.map((src, i) => `
      <div class="review-photo-thumb">
        <img src="${src}" alt="">
        <button type="button" onclick="reviews.removeImage(${i})"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('') +
      (this.pendingImages.length < 6 ? `<button type="button" onclick="document.getElementById('reviewImages').click()" class="review-photo-add"><i class="fa-solid fa-camera"></i><span>Add</span></button>` : '');
  },
  async submit(e) {
    e.preventDefault();
    if (this.submitting) return;
    const bookingId = document.getElementById('reviewBookingId').value.trim().toUpperCase();
    const name = document.getElementById('reviewName').value.trim();
    const comment = document.getElementById('reviewComment').value.trim();
    const rating = this.selectedStars || 5;

    if (!bookingId || !comment) return toast('Booking ID and comment required', 'error');

    this.submitting = true;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '.6'; }

    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          type: this.currentTarget.type,
          id: this.currentTarget.id,
          bookingId,
          name,
          comment,
          rating,
          photoURL: currentUser?.photoURL || null,
          images: this.pendingImages
        }),
      });
      document.getElementById('reviewModal').classList.add('hidden');
      toast(t('reviewSubmittedMsg'), 'success');
      const ids = {
        hotel: { list: 'hotelReviewsList', summary: 'hotelRatingSummary', bars: 'hotelRatingBars' },
        excursion: { list: 'excursionReviewsList', summary: 'excursionRatingSummary', bars: 'excursionRatingBars' },
        transfer: { list: 'transferReviewsList', summary: 'transferRatingSummary', bars: 'transferRatingBars' },
      }[this.currentTarget.type] || { list: 'excursionReviewsList', summary: 'excursionRatingSummary', bars: 'excursionRatingBars' };
      loadReviews(this.currentTarget.type, this.currentTarget.id, ids.list, ids.summary, ids.bars);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      this.submitting = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = ''; }
    }
  },
  openModal(type, id, bookingId = '') {
    this.currentTarget = { type, id, bookingId };
    this.selectedStars = 0;
    this.pendingImages = [];
    document.getElementById('reviewBookingId').value = bookingId;
    document.getElementById('reviewName').value = (currentUser && currentUser.displayName) || '';
    document.getElementById('reviewComment').value = '';
    this.renderImagePreview();
    this.paintStars(0);
    document.getElementById('reviewModal').classList.remove('hidden');
  },
  closeModal() {
    document.getElementById('reviewModal').classList.add('hidden');
  },
  setStars(n) {
    this.selectedStars = n;
    this.paintStars(n);
  },
  paintStars(n) {
    document.querySelectorAll('#reviewStarInput i').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.star) <= n);
    });
  }
};

// ==================== LOAD REVIEWS ====================
async function loadReviews(type, id, containerId, summaryId, barsId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  try {
    const data = await apiFetch(`/api/reviews?type=${type}&id=${id}`, {}, true);
    const reviewsList = data.reviews || [];

    if (reviewsList.length === 0) {
      container.innerHTML = `<div class="reviews-empty"><i class="fa-regular fa-comments" aria-hidden="true"></i><p>${t('noReviewsYet')}</p></div>`;
      if (summaryId) { const blk = document.getElementById(summaryId)?.closest('.rating-summary-block'); if (blk) blk.style.display = 'none'; }
      if (barsId) { const el = document.getElementById(barsId); if (el) el.innerHTML = ''; }
      if (summaryId) {
        const summaryEl = document.getElementById(summaryId); if (summaryEl) summaryEl.textContent = '–';
        const starsEl = document.getElementById(summaryId.replace('Summary', 'Stars')); if (starsEl) starsEl.innerHTML = '';
        const countEl = document.getElementById(summaryId.replace('Summary', 'Count')); if (countEl) countEl.textContent = t('noReviewsYet');
      }
      return;
    }

    if (summaryId) { const blk = document.getElementById(summaryId)?.closest('.rating-summary-block'); if (blk) blk.style.display = ''; }
    window.__reviewPhotoSets = window.__reviewPhotoSets || {};
    container.innerHTML = reviewsList.map((rv, ri) => {
      const initial = (rv.name || 'G').trim().charAt(0).toUpperCase();
      const photos = rv.images && rv.images.length ? rv.images : (rv.image ? [rv.image] : []);
      const dateStr = rv.createdAt ? new Date(rv.createdAt).toLocaleDateString() : '';
      const setKey = `${containerId}_${ri}`;
      window.__reviewPhotoSets[setKey] = photos;
      return `
      <div class="review-card-v2">
        <i class="fa-solid fa-quote-right review-card-quote"></i>
        <div class="review-card-head">
          <div class="review-card-avatar">${rv.photoURL ? `<img src="${rv.photoURL}" alt="">` : initial}</div>
          <div class="flex-1 min-w-0">
            <p class="review-card-name">${esc(rv.name || t('guest'))}</p>
            <div class="review-card-meta"><span class="review-verified-badge"><i class="fa-solid fa-circle-check"></i> Verified</span>${dateStr ? ` · ${dateStr}` : ''}</div>
          </div>
        </div>
        <div class="text-gold-500 text-xs my-2">${utils.renderStars(rv.rating)}</div>
        <p class="review-card-comment">${esc(rv.comment || '')}</p>
        ${photos.length ? `
          <div class="review-photo-grid">
            ${photos.slice(0, 3).map((img, i) => `
              <div class="review-photo-grid-cell" onclick="openLightboxSet('${setKey}', ${i})">
                <img src="${img}" alt="">
                ${(i === 2 && photos.length > 3) ? `<div class="review-photo-more">+${photos.length - 3}</div>` : ''}
              </div>`).join('')}
          </div>` : ''}
        ${rv.reply && rv.reply.text ? `
          <div class="review-reply">
            <div class="review-reply-head"><i class="fa-solid fa-reply"></i> ${esc(rv.reply.byName || 'Host')} <span>· Response</span></div>
            <p>${esc(rv.reply.text)}</p>
          </div>` : ''}
      </div>`;
    }).join('');

    if (summaryId) {
      const summaryEl = document.getElementById(summaryId);
      if (summaryEl) {
        const avg = utils.avgRating(reviewsList);
        summaryEl.textContent = avg ? avg.toFixed(1) : '0.0';
      }
      const starsEl = document.getElementById(summaryId.replace('Summary', 'Stars'));
      const countEl = document.getElementById(summaryId.replace('Summary', 'Count'));
      const avg = utils.avgRating(reviewsList);
      if (starsEl) starsEl.innerHTML = utils.renderStars(avg || 0);
      if (countEl) countEl.textContent = `${reviewsList.length} verified review${reviewsList.length === 1 ? '' : 's'}`;
    }

    if (barsId) {
      const barsEl = document.getElementById(barsId);
      if (barsEl) {
        const counts = [5, 4, 3, 2, 1].map(star => reviewsList.filter(rv => Math.round(rv.rating) === star).length);
        const max = Math.max(...counts, 1);
        barsEl.innerHTML = [5, 4, 3, 2, 1].map((star, i) => `
          <div class="rating-bar-row">
            <span style="width:28px">${star} <i class="fa-solid fa-star" style="color:#fbbf24;font-size:9px"></i></span>
            <div class="rating-bar-track"><div class="rating-bar-fill" style="width:${(counts[i] / max) * 100}%"></div></div>
            <span style="width:18px; text-align:right">${counts[i]}</span>
          </div>`).join('');
      }
    }
  } catch (e) {
    console.warn('Failed to load reviews:', e);
    container.innerHTML = `<p class="text-center text-gray-500 text-sm py-6">${t('couldNotLoadReviews')}</p>`;
  }
}

// ==================== FAVORITES / BOOKINGS / NOTIFICATIONS ====================
const favorites = {
  async load() {
    if (!authToken) { this.render(); return; }
    try { const data = await apiFetch('/api/user/favorites'); state.favorites = data.favorites || []; } catch (e) { state.favorites = []; }
    this.render();
  },
  async toggle(id) {
    try {
      await apiFetch('/api/user/favorites', { method: 'POST', body: JSON.stringify({ itemId: id }) });
      const idx = state.favorites.indexOf(id);
      if (idx > -1) state.favorites.splice(idx, 1); else state.favorites.push(id);
      this.render(); refreshCatalogUI();
    } catch (e) { toast('Could not update favorites', 'error'); }
  },
  render() {
    const list = document.getElementById('favoritesList'); if (!list) return;
    const favs = CATALOG.hotels.filter(h => state.favorites.includes(h.id));
    const empty = document.getElementById('emptyFavorites');
    if (favs.length === 0) { list.innerHTML = ''; if (empty) empty.classList.remove('hidden'); return; }
    if (empty) empty.classList.add('hidden');
    list.innerHTML = favs.map(h => ui.renderHotelCard(h)).join('');
  }
};

const bookings = {
  async load() {
    if (!authToken) { this.render(); return; }
    try {
      const data = await apiFetch('/api/user/bookings');
      state.bookings = data.bookings || [];
    } catch (e) {
      state.bookings = [];
    }
    this.render();
  },
  render() {
    const list = document.getElementById('bookingsList'); if (!list) return;
    const upcoming = state.bookings.filter(b => {
      const d = b.checkin || b.date;
      if (!d) return false;
      return new Date(d) >= new Date();
    });
    const past = state.bookings.filter(b => {
      const d = b.checkin || b.date;
      if (!d) return false;
      return new Date(d) < new Date();
    });
    const filtered = state.currentBookingTab === 'upcoming' ? upcoming : past;

    if (filtered.length === 0) { list.innerHTML = ''; document.getElementById('emptyBookings').classList.remove('hidden'); return; }
    document.getElementById('emptyBookings').classList.add('hidden');
    list.innerHTML = filtered.map(b => `
      <div onclick="showBookingDetails('${b.id}')" class="hotel-card rounded-xl p-3 flex gap-3 cursor-pointer">
        <img alt="" src="${getImageUrl(b.image)}" class="w-20 h-20 rounded-lg object-cover" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">
        <div class="flex-1">
          <h3 class="font-display font-bold text-sm">${b.type === 'hotel' ? b.hotelName : b.type === 'excursion' ? b.title : b.vehicleType + ' Transfer'}</h3>
          <p class="text-[10px]">${utils.formatDate(b.checkin || b.date)}</p>
          <p class="font-bold text-violet-500 text-sm">${b.priceFormatted || utils.formatPrice(b.total)}</p>
          ${this.balanceStatusBlock(b)}
        </div>
      </div>`).join('');
  },
  // Only bookings paid via the 50% deposit plan ever carry balanceStatus —
  // a plain full-payment booking has none, so this renders nothing for it.
  balanceStatusBlock(b) {
    if (b.balanceStatus === 'due' && b.remainingAmount > 0) {
      return `
        <div class="mt-2 flex items-center justify-between gap-2 p-2 rounded-lg" style="background:var(--bg-field)">
          <span class="text-[10px] font-semibold" style="color:var(--brand-violet)"><i class="fa-solid fa-clock"></i> ${t('balanceDueLabel').replace('{n}', utils.formatPrice(b.remainingAmount))}</span>
          <button onclick="event.stopPropagation(); openPayBalanceModal('${b.id}', ${b.remainingAmount})" class="text-[10px] font-bold px-3 py-1.5 rounded-lg btn-gold text-ink-900">${t('payRemainingBtn')}</button>
        </div>`;
    }
    if (b.balanceStatus === 'paid' && b.paymentPlan === 'deposit') {
      return `<p class="text-[10px] mt-1" style="color:#16a34a"><i class="fa-solid fa-circle-check"></i> ${t('balancePaidLabel')}</p>`;
    }
    return '';
  },
  switchTab(tab) {
    state.currentBookingTab = tab;
    const up = document.getElementById('tabUpcoming');
    const past = document.getElementById('tabHistory');
    if (up && past) {
      if (tab === 'upcoming') {
        up.className = 'flex-1 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-sm font-bold shadow-lg';
        past.className = 'flex-1 py-3 rounded-xl text-sm font-medium';
        past.style.color = 'var(--text-secondary)';
      } else {
        past.className = 'flex-1 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 text-white text-sm font-bold shadow-lg';
        up.className = 'flex-1 py-3 rounded-xl text-sm font-medium';
        up.style.color = 'var(--text-secondary)';
      }
    }
    this.render();
  }
};

const notifications = {
  list: [],
  async load() {
    if (!authToken) { this.render(); return; }
    try { const data = await apiFetch('/api/notifications'); this.list = data.notifications || []; } catch (e) { this.list = []; }
    this.render();
  },
  render() {
    this.updateBadge();
    const list = document.getElementById('notificationsList'); if (!list) return;
    if (!this.list.length) { list.innerHTML = `<p class="text-center py-10">${t('noNotificationsYet')}</p>`; return; }
    list.innerHTML = this.list.map(n => `
      <div class="card rounded-xl p-3.5 flex items-start gap-3">
        <div class="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center"><i class="fa-solid ${n.icon || 'fa-bell'} text-amber-500"></i></div>
        <div class="flex-1"><h3 class="font-semibold text-sm">${n.title}</h3><p class="text-xs">${n.msg}</p><p class="text-[9px] text-gray-400">${new Date(n.createdAt).toLocaleString()}</p></div>
      </div>`).join('');
  },
  updateBadge() {
    const hasUnread = this.list.some(n => !n.read);
    document.querySelectorAll('.notif-badge').forEach(el => el.classList.toggle('hidden', !hasUnread));
  },
  markAllRead() { this.list.forEach(n => n.read = true); this.render(); },
  markRead(id) { const n = this.list.find(x => x.id === id); if (n && !n.read) { n.read = true; this.render(); } }
};

// ==================== TRANSFER SEARCH ====================
const transferSearch = {
  setDirection(dir) {
    state.transferDirection = dir;
    const arrival = document.getElementById('tsDirArrival');
    const departure = document.getElementById('tsDirDeparture');
    if (arrival && departure) {
      if (dir === 'Airport to Hotel') {
        arrival.style.background = 'linear-gradient(135deg,#fb923c,#c2410c)';
        arrival.style.color = '#fff';
        departure.style.background = 'transparent';
        departure.style.color = 'var(--text-secondary)';
      } else {
        departure.style.background = 'linear-gradient(135deg,#fb923c,#c2410c)';
        departure.style.color = '#fff';
        arrival.style.background = 'transparent';
        arrival.style.color = 'var(--text-secondary)';
      }
    }
  },
  adjustPax(delta) {
    const newVal = state.transferPax + delta;
    if (newVal >= 1 && newVal <= 15) {
      state.transferPax = newVal;
      const label = document.getElementById('tsPassengersLabel');
      if (label) label.textContent = `${newVal} People`;
    }
  },
  apply() {
    const pickup = document.getElementById('tsPickup')?.value || '';
    const dropoff = document.getElementById('tsDropoff')?.value || '';
    const date = document.getElementById('tsDate')?.dataset.value || '';
    if (!pickup || !dropoff || !date) {
      toast('Please fill all transfer fields', 'error');
      return;
    }
    nav.go('transfers');
  },
};

// ==================== FLIGHT SEARCH ====================
const flightSearch = {
  closePaxModal() { document.getElementById('flightPaxModal').classList.add('hidden'); },
  adjust(type, delta) {
    const limits = { adults: { min: 1, max: 9 }, children: { min: 0, max: 6 }, infants: { min: 0, max: 4 } };
    const newVal = (state.flightPax?.[type] || 0) + delta;
    if (newVal >= limits[type].min && newVal <= limits[type].max) {
      if (!state.flightPax) state.flightPax = { adults: 1, children: 0, infants: 0, cabin: 'Economy' };
      state.flightPax[type] = newVal;
      const id = 'fp' + type.charAt(0).toUpperCase() + type.slice(1);
      const el = document.getElementById(id);
      if (el) el.textContent = newVal;
    }
  },
  applyPax() {
    flightSearch.closePaxModal();
    toast('Passengers updated', 'info');
  },
};

// ==================== EVENT DELEGATION FOR DATE FIELDS ====================
document.addEventListener('click', function(e) {
  const dateField = e.target.closest('[data-date-field]');
  if (!dateField) return;

  const fieldId = dateField.dataset.dateField;
  const unavailable = dateField.dataset.unavailable ? dateField.dataset.unavailable.split(',') : [];

  datepicker.open(fieldId, { unavailableIso: unavailable });
});
