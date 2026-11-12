/* Discover Sharm — consoles (admin / owner) as an installable app.
 * Registers the service worker and exposes DS_PWA { canInstall(), install(), isIOS(), standalone() } for the "Install app" row in the sheet / picker. */
(function () {
  'use strict';
  let deferred = null;
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const ping = () => { try { window.dispatchEvent(new Event('ds-pwa')); } catch (e) {} };
  window.DS_PWA = {
    standalone,
    isIOS: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    canInstall: () => !!deferred && !standalone(),
    async install() {
      if (!deferred) return false;
      deferred.prompt();
      let res = null; try { res = await deferred.userChoice; } catch (e) {}
      deferred = null; ping();
      return !!(res && res.outcome === 'accepted');
    },
  };
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; ping(); });
  window.addEventListener('appinstalled', () => { deferred = null; ping(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
  }
})();
