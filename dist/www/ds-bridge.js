/* Discover Sharm — cross-site bridge (www.discover-sharm.com  <->  app.discover-sharm.com)
 *
 * The two public sites are different origins, so localStorage is NOT shared between them.
 * This tiny script (loaded first, blocking, on every public page) shares what must follow the
 * visitor from one site to the other, using cookies scoped to the parent domain (.discover-sharm.com):
 *
 *   1. the Supabase login session      -> window.DS_SESSION_STORAGE (chunked cookies, used by supabase-api.js)
 *   2. theme / language / currency     -> cookie  ds_prefs   (mirrored from + into localStorage)
 *   3. "Continue as guest" choice      -> cookie  ds_guest   (session cookie)
 *
 * The admin site does NOT load this file on purpose: staff sessions stay isolated on admin.discover-sharm.com.
 * On localhost / any other host the cookies are simply host-only, so local development still works.
 */
(function () {
  'use strict';
  var host = location.hostname, PARENT = 'discover-sharm.com';
  var domain = (host === PARENT || host.slice(-(PARENT.length + 1)) === '.' + PARENT) ? '; Domain=.' + PARENT : '';
  var secure = location.protocol === 'https:' ? '; Secure' : '';
  var YEAR = 31536000;

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()\[\]\\\/+^]/g, '\\$&') + '=([^;]*)'));
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return null; }
  }
  function setCookie(name, value, maxAge) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; Path=/' + domain + '; SameSite=Lax' + secure +
      (maxAge === undefined ? '' : '; Max-Age=' + maxAge);
  }
  function delCookie(name) {
    document.cookie = name + '=; Path=/' + domain + '; SameSite=Lax' + secure + '; Max-Age=0';
  }

  // ---- 1. Supabase session in chunked cookies (a cookie holds ~4 KB, a session can be a bit more) ----------------
  // The value is URL-encoded first and the ENCODED text is cut into chunks, so a chunk can never exceed the cookie limit
  // (JSON punctuation grows 3x when encoded); a cut never lands inside a %XX escape.
  var CHUNK = 3000;
  function setRaw(name, encoded, maxAge) {
    document.cookie = name + '=' + encoded + '; Path=/' + domain + '; SameSite=Lax' + secure + '; Max-Age=' + maxAge;
  }
  function getRaw(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()\[\]\\\/+^]/g, '\\$&') + '=([^;]*)'));
    return m ? m[1] : null;
  }
  window.DS_SESSION_STORAGE = {
    getItem: function (key) {
      var n = parseInt(getRaw(key + '_n') || '0', 10), out = '';
      if (n > 0) {
        for (var i = 0; i < n; i++) { var part = getRaw(key + '_' + i); if (part === null) return null; out += part; }
        try { return decodeURIComponent(out); } catch (e) { return null; }
      }
      try { return localStorage.getItem(key); } catch (e) { return null; }   // a login made before the split: still honoured once
    },
    setItem: function (key, value) {
      var enc = encodeURIComponent(value), parts = [], pos = 0;
      while (pos < enc.length) {
        var end = Math.min(pos + CHUNK, enc.length);
        if (end < enc.length) { var pct = enc.lastIndexOf('%', end); if (pct > end - 3 && pct >= pos) end = pct; }   // do not split %XX
        parts.push(enc.slice(pos, end)); pos = end;
      }
      var old = parseInt(getRaw(key + '_n') || '0', 10);
      for (var i = 0; i < parts.length; i++) setRaw(key + '_' + i, parts[i], YEAR);
      for (var j = parts.length; j < old; j++) delCookie(key + '_' + j);
      setRaw(key + '_n', String(parts.length), YEAR);
      try { localStorage.removeItem(key); } catch (e) {}
    },
    removeItem: function (key) {
      var old = parseInt(getRaw(key + '_n') || '0', 10);
      for (var i = 0; i < old; i++) delCookie(key + '_' + i);
      delCookie(key + '_n');
      try { localStorage.removeItem(key); } catch (e) {}
    },
  };

  // ---- 2 + 3. preferences and guest flag --------------------------------------------------------------------------
  var PREF_KEYS = ['ds_theme', 'ds_lang', 'ds_display_currency'];
  var rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;

  function readPrefs() { try { return JSON.parse(getCookie('ds_prefs') || '{}') || {}; } catch (e) { return {}; } }
  function writePrefs() {
    var p = {};
    PREF_KEYS.forEach(function (k) { try { var v = localStorage.getItem(k); if (v) p[k] = v; } catch (e) {} });
    setCookie('ds_prefs', JSON.stringify(p), YEAR);
  }

  try {   // seed this origin from the other one on first visit (before the page's own theme/lang script runs)
    var prefs = readPrefs();
    PREF_KEYS.forEach(function (k) { if (prefs[k] && !localStorage.getItem(k)) rawSet.call(localStorage, k, prefs[k]); });
    if (getCookie('ds_guest') && !sessionStorage.getItem('ds_guest')) rawSet.call(sessionStorage, 'ds_guest', '1');
  } catch (e) {}

  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    try {
      if (this === window.localStorage && PREF_KEYS.indexOf(k) > -1) writePrefs();
      if (this === window.sessionStorage && k === 'ds_guest') setCookie('ds_guest', '1');   // session cookie: gone when the browser closes
    } catch (e) {}
  };
  Storage.prototype.removeItem = function (k) {
    rawRemove.call(this, k);
    try { if (this === window.sessionStorage && k === 'ds_guest') delCookie('ds_guest'); } catch (e) {}
  };

  /** used by the pre-paint gate script in <head>: is there a login (or guest choice) from either site? */
  window.DS_HAS_SESSION = function () {
    return parseInt(getCookie('ds_sb_session_n') || '0', 10) > 0;
  };
  window.DS_COOKIE = { get: getCookie, set: setCookie, del: delCookie, year: YEAR };
})();
