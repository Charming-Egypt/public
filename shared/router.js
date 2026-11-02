// ==================== MULTI-PAGE GLUE ====================
// Loaded last on every page. Three jobs:
//   1. Item cards call showExcursionPage('id') etc. In the old SPA that painted
//      a screen in place. Now it navigates to the item's own page
//      (/excursions/view/?id=…), where the original renderer runs.
//   2. Closing a detail page goes back where the visitor came from.
//   3. Keeps search choices alive across the page load between "search" on the
//      home page and the results page.
(function () {
  const DETAIL = {
    showExcursionPage:   ['excursions',   'closeExcursionPage'],
    showTransferPage:    ['transfers',    'closeTransferPage'],
    showRestaurantPage:  ['restaurants',  'closeRestaurantPage'],
    showHotelPage:       ['hotels',       'closeHotelPage'],
    showDestinationPage: ['destinations', 'closeDestinationPage'],
    showArticlePage:     ['articles',     'closeArticlePage'],
  };

  for (const [fnName, [section, closeName]] of Object.entries(DETAIL)) {
    const original = window[fnName];
    if (typeof original !== 'function') continue;
    __renderers[fnName] = original;

    window[fnName] = function (id, opts = {}) {
      if (opts.render) return original(id, opts);               // called by the detail shell
      persistUiState();
      location.assign(pathForDetail(section, id));
    };

    window[closeName] = function () {
      const def = DETAIL_ROUTES[section];
      const onDetailPage = document.body.dataset.detail === section;
      if (!onDetailPage) { const p = document.querySelector('#mainApp .page.active'); if (p) p.remove(); return; }
      let internal = false;
      try { internal = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch {}
      if (internal && history.length > 1) history.back(); else location.assign(pathForPage(def.list));
    };
  }

  // ---- UI state that must survive a page load ---------------------------------
  const KEY = 'ds_ui_state_v1';
  const STATE_KEYS = ['searchQuery', 'excursionSearchQuery', 'transferSearchQuery', 'currentFilter',
    'currentExcursionFilter', 'activeSearchTab', 'guests', 'transferPax', 'transferDirection',
    'excursionSortBy', 'hotelSortBy', 'transferSortBy', 'tripPax'];
  const SEARCH_KEYS = ['selectedCheckIn', 'selectedCheckOut', 'selectedCategory', 'activeTab'];

  window.persistUiState = function () {
    try {
      const snap = { state: {}, search: {} };
      STATE_KEYS.forEach(k => { if (k in state) snap.state[k] = state[k]; });
      if (typeof search !== 'undefined') SEARCH_KEYS.forEach(k => { if (k in search) snap.search[k] = search[k]; });
      sessionStorage.setItem(KEY, JSON.stringify(snap));
    } catch {}
  };

  window.restoreUiState = function () {
    try {
      const snap = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (!snap) return;
      Object.assign(state, snap.state || {});
      if (typeof search !== 'undefined') Object.assign(search, snap.search || {});
    } catch {}
  };

  window.addEventListener('pagehide', persistUiState);
})();
