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
  // The top of the page is the top of the wave canopy (site-app.css "TOP WAVES"), whose first colour is --bg-body — so the status bar
  // takes the page colour in both themes and reads as transparent. The one exception: a detail-style page that has no wave canopy of
  // its own (no .dh hero) is still drawn on --bg-card. Values mirror --bg-body / --bg-card in site-app.css.
  var tcQueued = false;
  function syncThemeColor() {
    tcQueued = false;
    var light = doc.dataset.theme === 'light', pg = document.querySelector('.page.active');
    var detail = !!(pg && /DetailPage$/.test(pg.id) && !pg.querySelector('.dh'));
    if (meta) meta.setAttribute('content', detail ? (light ? '#ffffff' : '#171719') : (light ? '#f6f5f3' : '#0d0d0f'));
  }
  function queueTheme() { if (!tcQueued) { tcQueued = true; requestAnimationFrame(syncThemeColor); } }
  syncThemeColor();
  new MutationObserver(queueTheme).observe(doc, { attributes: true, attributeFilter: ['data-theme'] });
  new MutationObserver(queueTheme).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });

  /* ---------- scroll flags for the top waves ----------
     ds-scrolled : content has started to slide under the status bar → frosted status-bar scrim + frosted inner-page header
     ds-far      : the waves are well out of view → pause their animation */
  var scQueued = false;
  function syncScroll() {
    scQueued = false;
    var y = window.pageYOffset || doc.scrollTop || 0;
    doc.classList.toggle('ds-scrolled', y > 8);
    doc.classList.toggle('ds-far', y > 320);
  }
  function queueScroll() { if (!scQueued) { scQueued = true; requestAnimationFrame(syncScroll); } }
  window.addEventListener('scroll', queueScroll, { passive: true });
  window.addEventListener('pageshow', queueScroll);
  syncScroll();

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

  /* ---------- outbox (IndexedDB) : things done offline that finish by themselves when the network is back ---------- */
  /* kinds: contact · review → sent automatically · draft → an unfinished booking (card payment needs the network, so we keep the form and remind) */
  var DB_NAME = 'ds-outbox';
  function db() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no idb'));
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('items', { keyPath: 'id' }); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return db().then(function (d) { return new Promise(function (res, rej) {
      var t0 = d.transaction('items', mode), st = t0.objectStore('items'), out = fn(st);
      t0.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); }; t0.onerror = function () { rej(t0.error); };
    }); });
  }
  function lang() { try { return localStorage.getItem('ds_lang') || 'en'; } catch (e) { return 'en'; } }
  function isAuthed() { try { return typeof authToken !== 'undefined' && !!authToken; } catch (e) { return false; } }
  function registerSync() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) { if (reg.sync) reg.sync.register('ds-outbox').catch(function () {}); }).catch(function () {});
  }
  var OUTBOX = {
    add: function (kind, payload, meta) {
      var id = kind === 'draft' ? 'draft' : kind + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      var item = { id: id, kind: kind, payload: payload, meta: meta || {}, lang: lang(), ts: Date.now() };
      return tx('readwrite', function (st) { st.put(item); }).then(function () { registerSync(); return true; }, function () { return false; });
    },
    list: function () { return tx('readonly', function (st) { return st.getAll(); }).then(function (r) { return r || []; }, function () { return []; }); },
    remove: function (id) { return tx('readwrite', function (st) { st.delete(id); }).catch(function () {}); },
    flushing: false,
    flush: function () {
      if (OUTBOX.flushing || !navigator.onLine || typeof apiFetch !== 'function') return Promise.resolve();
      OUTBOX.flushing = true;
      return OUTBOX.list().then(function (items) {
        var sent = 0;
        return items.filter(function (i) { return i.kind !== 'draft'; }).reduce(function (chain, it) {
          return chain.then(function () {
            if (it.kind === 'review' && !isAuthed()) return;
            var url = it.kind === 'contact' ? '/api/contact' : '/api/reviews';
            return apiFetch(url, { method: 'POST', body: JSON.stringify(it.payload) }, true)
              .then(function () { sent++; return OUTBOX.remove(it.id); })
              .catch(function (e) { if (e && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) return OUTBOX.remove(it.id); });
          });
        }, Promise.resolve()).then(function () { if (sent) toastMsg(tr('pwaQueuedSent', 'Your saved messages were sent'), 'success'); });
      }).catch(function () {}).then(function () { OUTBOX.flushing = false; showDraftBar(); });
    }
  };
  window.DS_OUTBOX = OUTBOX;

  /* ---------- unfinished booking: "Continue" bar ---------- */
  function hideDraftBar() { var b = document.getElementById('pwaDraft'); if (b) b.remove(); }
  function showDraftBar() {
    if (!navigator.onLine) return hideDraftBar();
    OUTBOX.list().then(function (items) {
      var d = items.filter(function (i) { return i.kind === 'draft'; })[0];
      if (!d || !isAuthed()) return hideDraftBar();
      if (document.getElementById('pwaDraft')) return;
      var bar = el('<div id="pwaDraft" class="pwa-bar pwa-update" role="status"><span></span><button type="button" data-i18n="pwaDraftBtn">' + tr('pwaDraftBtn', 'Continue') + '</button></div>');
      bar.querySelector('span').textContent = tr('pwaDraftBar', 'Finish your booking') + (d.meta && d.meta.title ? ' · ' + d.meta.title : '');
      bar.querySelector('button').onclick = function () { resumeDraft(); };
      document.body.appendChild(bar);
    });
  }
  function resumeDraft() {
    return OUTBOX.list().then(function (items) {
      var d = items.filter(function (i) { return i.kind === 'draft'; })[0];
      hideDraftBar();
      if (!d) return;
      if (typeof resumeBookingDraft === 'function' && resumeBookingDraft(d.payload) !== false) return OUTBOX.remove('draft');
    });
  }
  window.addEventListener('online', function () { setTimeout(function () { OUTBOX.flush(); }, 800); });
  window.addEventListener('offline', hideDraftBar);
  window.addEventListener('load', function () {
    setTimeout(function () {
      OUTBOX.flush();
      if (/[?&]resume=1/.test(location.search) && isAuthed()) resumeDraft();
    }, 1500);
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'FLUSH_OUTBOX') OUTBOX.flush();
    if (m.type === 'PUSH_RESUBSCRIBE') syncPush(true);
  });

  /* ---------- Web Push ---------- */
  var VAPID = (window.DS_CONFIG && DS_CONFIG.VAPID) || '';
  function b64ToU8(b) { b = (b + '==='.slice((b.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/'); var r = atob(b), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  var pushOK = !!(VAPID && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && (!isIOS || standalone));
  function pushRow() { return document.getElementById('pwaPushRow'); }
  function currentSub() { return navigator.serviceWorker.ready.then(function (r) { return r.pushManager.getSubscription(); }); }
  function sendSub(sub) {
    if (!isAuthed() || typeof apiFetch !== 'function') return Promise.resolve(false);
    return apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), lang: lang(), ua: (navigator.userAgent || '').slice(0, 300) }) }, true).then(function () { return true; }, function () { return false; });
  }
  function renderPushRow() {
    var row = pushRow(); if (!row) return;
    if (!pushOK) { row.classList.add('hidden'); return; }
    row.classList.remove('hidden');
    var btn = row.querySelector('button'), note = row.querySelector('.pwa-push-note');
    currentSub().then(function (sub) {
      var denied = Notification.permission === 'denied', on = !!sub && Notification.permission === 'granted';
      btn.dataset.on = on ? '1' : '';
      btn.disabled = denied;
      btn.setAttribute('data-i18n', on ? 'pwaPushOff' : 'pwaPushOn');
      btn.textContent = on ? tr('pwaPushOff', 'Turn off') : tr('pwaPushOn', 'Turn on');
      if (note) { note.classList.toggle('hidden', !denied); note.textContent = tr('pwaPushDenied', 'Blocked in your browser settings'); }
    }).catch(function () {});
  }
  function enablePush() {
    if (!pushOK) return Promise.resolve(false);
    if (!isAuthed()) { toastMsg(tr('pwaPushLogin', 'Sign in to turn on notifications'), 'error'); return Promise.resolve(false); }
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') return false;
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID) }); });
      }).then(sendSub).then(function (ok) { if (ok) toastMsg(tr('pwaPushEnabled', 'Notifications are on'), 'success'); return ok; });
    }).catch(function () { toastMsg(tr('pwaPushFail', 'Could not turn on notifications'), 'error'); return false; }).then(function (r) { renderPushRow(); return r; });
  }
  function disablePush() {
    return currentSub().then(function (sub) {
      if (!sub) return;
      var ep = sub.endpoint;
      return (isAuthed() && typeof apiFetch === 'function' ? apiFetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: ep }) }, true).catch(function () {}) : Promise.resolve()).then(function () { return sub.unsubscribe(); });
    }).catch(function () {}).then(renderPushRow);
  }
  /* keep the server copy fresh (and re-attached to the signed-in user) */
  function syncPush(force) {
    if (!pushOK || Notification.permission !== 'granted' || !isAuthed()) return;
    var last = +store.get('ds_push_sync') || 0;
    if (!force && Date.now() - last < DAY) return;
    currentSub().then(function (sub) {
      return (sub || navigator.serviceWorker.ready.then(function (r) { return r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID) }); })).then(sendSub);
    }).then(function (ok) { if (ok) store.set('ds_push_sync', String(Date.now())); }).catch(function () {});
  }
  function pushLogout() {   // the device stops receiving this user's notifications
    if (!pushOK) return;
    store.set('ds_push_sync', '0');
    disablePush();
  }
  window.PWA.enablePush = enablePush; window.PWA.disablePush = disablePush; window.PWA.pushLogout = pushLogout;
  window.PWA.togglePush = function () { var b = document.querySelector('#pwaPushRow button'); return b && b.dataset.on ? disablePush() : enablePush(); };
  window.PWA.resumeDraft = resumeDraft;
  window.addEventListener('DOMContentLoaded', function () { renderPushRow(); setTimeout(function () { syncPush(false); showDraftBar(); }, 2500); });
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-route="settings"],[onclick*="settings"]')) setTimeout(renderPushRow, 50); });
})();
