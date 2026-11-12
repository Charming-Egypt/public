/* Discover Sharm — which site is right for this device?  (runs in <head>, before first paint)
 *
 *   www.discover-sharm.com  = desktop / large screens   (mouse + keyboard)
 *   app.discover-sharm.com  = phones + tablets          (touch, app-style navigation)
 *
 * A visitor who lands on the "wrong" site is sent to the same page on the right one
 * (path, query and hash are kept). Rules:
 *   - search-engine bots are never redirected (each URL is indexable; canonical/alternate tags say how they relate)
 *   - ?view=www or ?view=app is a manual choice: it is remembered for a year (cookie ds_view) and wins over detection
 *   - utility pages that have no "other version" (the printable voucher) are never redirected
 * Needs window.DS_SITE ('www' | 'app') and window.DS_SITES ({www, app, admin}) set just before it.
 */
(function () {
  'use strict';
  var site = window.DS_SITE, sites = window.DS_SITES || {};
  if (site !== 'www' && site !== 'app') return;
  var C = window.DS_COOKIE;
  if (!C) return;

  var q = new URLSearchParams(location.search), forced = q.get('view');
  if (forced === 'www' || forced === 'app') {
    C.set('ds_view', forced, C.year);
    q.delete('view');
    var clean = location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash;
    try { history.replaceState(null, '', clean); } catch (e) {}
  }
  var choice = forced === 'www' || forced === 'app' ? forced : C.get('ds_view');
  window.DS_VIEW_FORCED = !!choice;

  var ua = navigator.userAgent || '';
  if (/bot|crawl|spider|slurp|facebookexternalhit|bingpreview|lighthouse|headless/i.test(ua)) return;
  if (/^\/voucher\//.test(location.pathname)) return;

  function wanted() {
    if (choice === 'www' || choice === 'app') return choice;
    var touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && !matchMedia('(hover: hover) and (pointer: fine)').matches;
    var iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;                 // iPad that pretends to be a Mac
    var mobileUA = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Silk|Kindle/i.test(ua) || iPadOS;
    var w = Math.min(screen.width, screen.height) || window.innerWidth;                // physical short side, not the window size
    if (mobileUA || touch && w < 1100) return 'app';
    return 'www';
  }

  var target = wanted();
  if (target !== site && sites[target]) {
    location.replace(sites[target].replace(/\/$/, '') + location.pathname + location.search + location.hash);
    return;
  }

  // "?view=www" on a phone: render the real desktop layout (the viewport is widened so the 1024px rules apply)
  if (site === 'www' && window.DS_VIEW_FORCED && window.innerWidth < 1024) {
    var m = document.querySelector('meta[name="viewport"]');
    if (m) m.setAttribute('content', 'width=1280, initial-scale=' + (window.innerWidth / 1280).toFixed(3));
  }

  /** other code / links can offer a switch:  DS_SWITCH_VIEW('www') */
  window.DS_SWITCH_VIEW = function (to) {
    C.set('ds_view', to, C.year);
    location.href = sites[to].replace(/\/$/, '') + location.pathname + location.search + location.hash;
  };
})();
