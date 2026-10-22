/* Discover Sharm — PWA layer (app.discover-sharm.com only).
 * service-worker registration + update prompt · install card (Android/desktop prompt, iOS "Add to Home Screen" help)
 * · offline/online banner · browser theme-colour that follows light/dark · "installed app" flag for CSS. */
(function () {
  'use strict';
  if (window.DS_SITE !== 'app') return;
  var doc = document.documentElement;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (standalone) doc.classList.add('is-pwa');

  function tr(k, fb) { try { var v = typeof t === 'function' ? t(k) : null; return v && v !== k ? v : fb; } catch (e) { return fb; } }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function toastMsg(m, type) { try { if (typeof toast === 'function') toast(m, type || 'success'); } catch (e) {} }
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- browser theme colour follows the app theme ---------- */
  var meta = document.querySelector('meta[name="theme-color"]');
  function syncThemeColor() { if (meta) meta.setAttribute('content', doc.dataset.theme === 'light' ? '#f6f5f3' : '#0d0d0f'); }
  syncThemeColor();
  new MutationObserver(syncThemeColor).observe(doc, { attributes: true, attributeFilter: ['data-theme'] });

  /* ---------- service worker + update prompt ---------- */
  var refreshing = false;
  function showUpdate(reg) {
    if (document.getElementById('pwaUpdate')) return;
    var bar = el('<div id="pwaUpdate" class="pwa-bar pwa-update" role="status"><span data-i18n="pwaUpdateReady">' + tr('pwaUpdateReady', 'A new version is ready') + '</span><button type="button" data-i18n="pwaRefresh">' + tr('pwaRefresh', 'Refresh') + '</button></div>');
    bar.querySelector('button').onclick = function () { if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING'); };
    document.body.appendChild(bar);
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (reg) {
        if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg);
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(reg); });
        });
        setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); });
      }).catch(function () {});
    });
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (refreshing) return; refreshing = true; location.reload(); });
  }

  /* ---------- offline / online ---------- */
  var offBar = null;
  function setOffline(off) {
    if (off && !offBar) {
      offBar = el('<div class="pwa-bar pwa-offline" role="status"><i class="fa-solid fa-wifi" aria-hidden="true"></i><span data-i18n="pwaOffline">' + tr('pwaOffline', 'You are offline — showing saved pages') + '</span></div>');
      document.body.appendChild(offBar);
    } else if (!off && offBar) { offBar.remove(); offBar = null; toastMsg(tr('pwaBackOnline', 'Back online'), 'success'); }
  }
  window.addEventListener('offline', function () { setOffline(true); });
  window.addEventListener('online', function () { setOffline(false); });
  if (!navigator.onLine) window.addEventListener('DOMContentLoaded', function () { setOffline(true); });

  /* ---------- install ---------- */
  var deferred = null;
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var DAY = 864e5;
  function dismissed() { var v = +store.get('ds_pwa_dismiss'); return v && Date.now() - v < 7 * DAY; }

  function settingsRow(show) { var r = document.getElementById('pwaInstallRow'); if (r) r.classList.toggle('hidden', !show); }
  function hideCard() { var c = document.getElementById('pwaInstall'); if (c) { c.classList.remove('show'); setTimeout(function () { c.remove(); }, 300); } }

  function showCard() {
    if (standalone || document.getElementById('pwaInstall')) return;
    var ios = isIOS && !deferred;
    var card = el('<div id="pwaInstall" class="pwa-install" role="dialog" aria-label="Install"><img src="/icons/icon-192.png" alt="" width="52" height="52" />' +
      '<div class="pwa-txt"><b data-i18n="pwaInstallTitle">' + tr('pwaInstallTitle', 'Install Discover Sharm') + '</b>' +
      '<span data-i18n="' + (ios ? 'pwaIosHint' : 'pwaInstallText') + '">' + (ios ? tr('pwaIosHint', 'Tap Share, then “Add to Home Screen”') : tr('pwaInstallText', 'Quick access, works offline, full-screen app')) + '</span></div>' +
      (ios ? '' : '<button type="button" class="pwa-go" data-i18n="pwaInstallBtn">' + tr('pwaInstallBtn', 'Install') + '</button>') +
      '<button type="button" class="pwa-x" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>');
    card.querySelector('.pwa-x').onclick = function () { store.set('ds_pwa_dismiss', String(Date.now())); hideCard(); };
    var go = card.querySelector('.pwa-go'); if (go) go.onclick = function () { install(); };
    document.body.appendChild(card);
    requestAnimationFrame(function () { card.classList.add('show'); });
  }

  function install() {
    if (deferred) {
      var p = deferred; deferred = null; hideCard();
      p.prompt();
      return p.userChoice.then(function (c) { if (c.outcome !== 'accepted') store.set('ds_pwa_dismiss', String(Date.now())); settingsRow(false); });
    }
    if (isIOS) showCard();
  }
  window.PWA = { install: install, isStandalone: standalone, canInstall: function () { return !!deferred || (isIOS && !standalone); } };

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e; settingsRow(true);
    if (!dismissed()) setTimeout(function () { if (!doc.dataset.gate) showCard(); }, 4000);
  });
  window.addEventListener('appinstalled', function () { deferred = null; hideCard(); settingsRow(false); toastMsg(tr('pwaInstalled', 'App installed'), 'success'); });

  window.addEventListener('DOMContentLoaded', function () {
    if (standalone) return;
    if (isIOS) {
      settingsRow(true);
      var n = (+store.get('ds_pwa_visits') || 0) + 1; store.set('ds_pwa_visits', String(n));
      if (n >= 2 && !dismissed()) setTimeout(function () { if (!doc.dataset.gate) showCard(); }, 5000);
    }
  });
})();
