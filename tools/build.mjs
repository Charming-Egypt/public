#!/usr/bin/env node
/**
 * Discover Sharm — builds THREE separate static sites from one source tree.
 *
 *   node tools/build.mjs            # all three
 *   node tools/build.mjs www        # only www.discover-sharm.com   -> dist/www
 *   node tools/build.mjs app        # only app.discover-sharm.com   -> dist/app
 *   node tools/build.mjs admin      # only admin.discover-sharm.com -> dist/admin
 *
 * www   desktop / large screens. Same pages as the app, desktop layout, no bottom tab bar, no splash.
 * app   phones + tablets. App-style layout everywhere (the desktop CSS rules are switched off at build time).
 * admin super-admin console (/) + owner consoles (/owner/…). Separate origin, no shared login cookies, noindex, locked-down headers.
 *
 * www and app are linked: ds-site.js sends each visitor to the right one, ds-bridge.js shares the login session,
 * language, theme and currency between them. Each dist/<site> folder is complete — upload it as its own project.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cfg = JSON.parse(read('site.config.json'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const SITES = Object.fromEntries(Object.entries(cfg.sites).map(([k, v]) => [k, v.domain.replace(/\/$/, '')]));

const want = process.argv[2] || 'all';
const targets = want === 'all' ? ['www', 'app', 'admin'] : [want];
for (const t of targets) if (!['www', 'app', 'admin'].includes(t)) { console.error(`Unknown site "${t}" (use www, app, admin or all)`); process.exit(1); }

// ---- Supabase / Google / payments / translation: ENVIRONMENT VARIABLES ONLY (never in site.config.json) ------------------
// On Cloudflare Pages set them in the project: Settings → Variables and Secrets (Production + Preview), then redeploy.
// Locally, put them in a `.env` file next to package.json (git-ignored; see .env.example).
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env: fine */ }
const env = (k) => (process.env[k] || '').trim();
// "translate.discover-sharm.com" (no scheme) used to become a RELATIVE url in the browser -> 404. Always make it absolute, no trailing slash.
const url = (v) => { v = String(v || '').trim().replace(/\/+$/, ''); return v && !/^https?:\/\//i.test(v) ? 'https://' + v : v; };
const sbc = { url: url(env('DS_SUPABASE_URL')), anonKey: env('DS_SUPABASE_ANON_KEY'), googleClientId: env('DS_GOOGLE_CLIENT_ID'),
  paymentsBase: url(env('DS_PAYMENTS_BASE')), translateBase: url(env('DS_TRANSLATE_BASE')), contentBase: url(env('DS_CONTENT_BASE')), settingsBase: url(env('DS_SETTINGS_BASE')) };
const useSupabase = !!(sbc.url && sbc.anonKey);
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';   // pinned

// ---- Security headers (written into each site's _headers) -------------------------------------------------------------
// HSTS: browsers refuse plain HTTP for a year once they have seen this over HTTPS. (Add `; preload` only after submitting to hstspreload.org.)
const HSTS = 'max-age=31536000; includeSubDomains';
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const wsOf = (u) => { try { const x = new URL(u); return 'wss://' + x.host; } catch { return ''; } };
// Content-Security-Policy. The pages still use inline <script> blocks and onclick="" handlers, so script-src needs 'unsafe-inline'
// until those are moved into .js files (then drop it and the policy becomes a real XSS barrier). What it already does today:
// limits <script src> to our own files + the 3 known script hosts, blocks <object>/<embed>, pins <base>, forbids framing by other sites,
// and upgrades any stray http:// subresource.
function csp(site) {
  const uniq = (a) => [...new Set(a.filter(Boolean))].join(' ');
  if (site === 'admin') {
    return [
      "default-src 'self'",
      `script-src ${uniq(["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'])}`,
      `style-src ${uniq(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'])}`,
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      `connect-src ${uniq(["'self'", originOf(sbc.url), wsOf(sbc.url), originOf(sbc.translateBase), originOf(sbc.contentBase), originOf(sbc.settingsBase)])}`,
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.google.com", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", 'upgrade-insecure-requests',
    ].join('; ');
  }
  return [
    "default-src 'self'",
    `script-src ${uniq(["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://accounts.google.com'])}`,
    `style-src ${uniq(["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com', 'https://accounts.google.com'])}`,
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob: https:",
    `connect-src ${uniq(["'self'", originOf(sbc.url), wsOf(sbc.url), originOf(sbc.paymentsBase), originOf(sbc.contentBase), originOf(sbc.settingsBase), 'https://open.er-api.com', 'https://accounts.google.com'])}`,
    // https: (not a short list) because the card-verification (3-D Secure) frame can land on the issuing bank's own domain
    "frame-src https:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'",
    "worker-src 'self'", "manifest-src 'self'", 'upgrade-insecure-requests',
  ].join('; ');
}
// content hash of the editorial JSON (destinations / articles / reviews / promoSlides): cache-busts /data/*.json when you edit them
const DATA_V = (() => { const h = crypto.createHash('sha1'); for (const f of ['destinations', 'articles', 'reviews', 'promoSlides']) h.update(fs.readFileSync(path.join(ROOT, 'shared', 'data', f + '.json'))); return h.digest('hex').slice(0, 8); })();
// contact + social links come from Cloudflare Pages variables (not from the admin settings)
const contact = { phone: env('DS_CONTACT_PHONE'), whatsapp: env('DS_CONTACT_WHATSAPP'), email: env('DS_CONTACT_EMAIL'),
  facebook: url(env('DS_SOCIAL_FACEBOOK')), instagram: url(env('DS_SOCIAL_INSTAGRAM')), tiktok: url(env('DS_SOCIAL_TIKTOK')), youtube: url(env('DS_SOCIAL_YOUTUBE')) };
const apiBase = url(process.env.DS_API_BASE ?? cfg.apiBase ?? '');

// ---- small fs helpers --------------------------------------------------------------------------------------------------
const outRoot = (site) => path.join(ROOT, 'dist', site);
const mk = (site) => ({
  write(p, s) { const f = path.join(outRoot(site), p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); },
  copy(from, to) { const f = path.join(outRoot(site), to); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.cpSync(path.join(ROOT, from), f, { recursive: true }); },
});
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);

// ============================================================================================================================
//  PUBLIC SITES (www + app)
// ============================================================================================================================
const on = cfg.show;
const sectionEnabled = (key) => (key in on ? !!on[key] : true);
const pageEnabled = () => true;   // every section's pages are always built: the admin switches sections on/off at runtime (site settings); config "show" only gives the defaults
const P = (n) => read(`src/partials/${n}.html`);
const pathOf = (key) => (cfg.pages[key] ? cfg.pages[key].path : null);

/** <button onclick="nav.go('x')">…</button>  →  <a href="/x/">…</a> */
function linkify(html) {
  return html.replace(
    /<button([^>]*?)\sonclick="(?:event\.stopPropagation\(\);\s*)?nav\.go\('(\w+)'\)(?:;\s*sidebar\.close\(\))?"([^>]*)>([\s\S]*?)<\/button>/g,
    (m, a, key, b, inner) => {
      const href = pathOf(key);
      if (!href || !pageEnabled(key)) return m;
      const attrs = (a + b).replace(/\stype="button"/g, '');
      return `<a href="${href}" data-nl${attrs}>${inner}</a>`;
    }
  ).replace(
    /<a(\s[^>]*?)?\sonclick="nav\.go\('(\w+)'\)"/g,
    (m, a = '', key) => {
      const href = pathOf(key);
      return href && pageEnabled(key) && !/\shref=/.test(a) ? `<a href="${href}"${a}` : m;
    }
  );
}

/** App site: switch the desktop rules off, so the app layout holds on tablets in landscape too. */
const NEUTRAL = '100000px';
const forApp = {
  'style.css': (s) => s
    .replace(/@media \(min-width: (1024|1280)px\)/g, `@media (min-width: ${NEUTRAL})`)
    .replace(/@media \(max-width: 1023px\)/g, '@media all')
    .replace(/@media \(max-width: 1180px\)/g, '@media (max-width: 0px)'),
  'tailwind.css': (s) => s.replace(/@media \(min-width:(1024|1280|1536)px\)/g, `@media (min-width:${NEUTRAL})`),
};

function buildPublic(site) {
  const out = mk(site);
  const domain = SITES[site], other = SITES[site === 'www' ? 'app' : 'www'];
  fs.rmSync(outRoot(site), { recursive: true, force: true });

  // ---- assets (hashed for cache busting) -----------------------------------------------------------------------------
  const siteCss = `site-${site}.css`;
  const assetList = ['style.css', 'tailwind.css', 'data.js', 'supabase-api.js', 'booking.js', 'frontend.js', 'router.js', 'ds-bridge.js', 'ds-site.js'];
  const V = {};
  if (site === 'app') assetList.push('pwa.js');
  for (const f of assetList) {
    let body = fs.readFileSync(path.join(ROOT, 'shared', f), 'utf8');
    if (site === 'app' && forApp[f]) body = forApp[f](body);
    out.write(f, body); V[f] = sha(body);
  }
  const extra = fs.readFileSync(path.join(ROOT, 'shared', siteCss), 'utf8');
  out.write('site.css', extra); V['site.css'] = sha(extra);
  out.copy('shared/data', 'data');
  out.copy('shared/favicon.ico', 'favicon.ico');

  // ---- <head> --------------------------------------------------------------------------------------------------------
  const fallbackLogo = P('fallback-logo').trim();
  const head = ({ title, description, canonicalPath, noindex }) => {
    // Google's "separate URLs" setup: the mobile page's canonical is the desktop page; the desktop page points to the mobile one.
    const canonical = SITES.www + canonicalPath;
    const alt = noindex ? '' : (site === 'www'
      ? `\n  <link rel="alternate" media="only screen and (max-width: 1023px)" href="${SITES.app + canonicalPath}" />`
      : '');
    const ld = canonicalPath === '/' && site === 'www' ? `\n  <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.siteName, url: SITES.www + '/', description })}</script>` : '';
    return `<!DOCTYPE html>
<html lang="en" dir="ltr" data-theme="dark" data-site="${site}">
<head>
  <meta charset="UTF-8" />
  <script>if(location.protocol==='http:'&&!/^(localhost|127\.|\[::1\]|.*\.local$)/.test(location.hostname))location.replace('https:'+location.href.slice(5));</script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonical}" />${alt}${noindex ? '\n  <meta name="robots" content="noindex, nofollow" />' : ''}
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${esc(cfg.siteName)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${SITES.www + canonicalPath}" />
  <meta name="twitter:card" content="summary_large_image" />${ld}${site === 'app' ? `
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#0d0d0f" />
  <meta name="application-name" content="${esc(cfg.siteName)}" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="${esc(cfg.siteName)}" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="format-detection" content="telephone=no" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
  <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />` : ''}

  <script src="/ds-bridge.js?v=${V['ds-bridge.js']}"></script>
  <script>
    window.DS_SITE = ${JSON.stringify(site)};
    window.DS_SITES = ${JSON.stringify({ www: SITES.www, app: SITES.app })};
    window.DS_API_BASE = ${JSON.stringify(apiBase)};
    window.DS_DATA_V = ${JSON.stringify(DATA_V)};
  </script>
  <script src="/ds-site.js?v=${V['ds-site.js']}"></script>
  <script>
    // Runs before first paint: theme + language (no flash), and the sign-in gate.
    // A login or "continue as guest" made on the OTHER site counts here too (see ds-bridge.js).
    (function () {
      try {
        var d = document.documentElement;
        d.dataset.theme = localStorage.getItem('ds_theme') || 'dark';
        var l = localStorage.getItem('ds_lang') || 'en';
        d.lang = l; d.dir = l === 'ar' ? 'rtl' : 'ltr';
        var signedIn = localStorage.getItem('ds_auth_token') || (window.DS_HAS_SESSION && DS_HAS_SESSION());
        if (!signedIn && !sessionStorage.getItem('ds_guest')) d.dataset.gate = 'auth';
      } catch (e) {}
    })();
    window.DS_CONFIG = ${JSON.stringify({
      SHOW_HOTELS: sectionEnabled('hotels'), SHOW_EXCURSIONS: sectionEnabled('excursions'),
      SHOW_TRANSFERS: sectionEnabled('transfers'), SHOW_RESTAURANTS: sectionEnabled('restaurants'),
      SHOW_DESTINATIONS: sectionEnabled('destinations'), SHOW_JOURNAL: sectionEnabled('journal'),
      CONTACT: contact, VAPID: site === 'app' ? env('DS_VAPID_PUBLIC_KEY') : '',
    })};
  </script>
  ${fallbackLogo}

  <link rel="stylesheet" href="/style.css?v=${V['style.css']}" />
  <link rel="stylesheet" href="/tailwind.css?v=${V['tailwind.css']}" />
  <link rel="stylesheet" href="/site.css?v=${V['site.css']}" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</head>`;
  };

  const scripts = () => `
  ${useSupabase ? `<script>window.DS_SUPABASE = ${JSON.stringify({ url: sbc.url, anonKey: sbc.anonKey, googleClientId: sbc.googleClientId || '', paymentsBase: sbc.paymentsBase || '', contentBase: sbc.contentBase || '', settingsBase: sbc.settingsBase || '' })};</script>
  <script src="${SUPABASE_JS}"></script>` : '<!-- Supabase not configured: running on the legacy API -->'}
  <script src="/data.js?v=${V['data.js']}"></script>
  ${useSupabase ? `<script src="/supabase-api.js?v=${V['supabase-api.js']}"></script>` : ''}
  <script src="/booking.js?v=${V['booking.js']}"></script>
  <script src="/frontend.js?v=${V['frontend.js']}"></script>
  <script src="/router.js?v=${V['router.js']}"></script>${site === 'app' ? `
  <script src="/pwa.js?v=${V['pwa.js']}"></script>` : ''}
</body>
</html>
`;

  // ---- body shell ----------------------------------------------------------------------------------------------------
  const splash = P('splash'), chrome = P('chrome'), bottomNav = P('bottom-nav');
  const bodyShell = ({ route, detail, pageHtml, withSplash }) => {
    const attrs = `data-route="${route}"${detail ? ` data-detail="${detail}"` : ''}`;
    const splashHtml = withSplash && site === 'app'       // the animated splash is an app-launch screen: app site only
      ? splash.trim() + `\n  <script>try{if(sessionStorage.getItem('ds_splashed')){var s=document.getElementById('splashPage');if(s)s.remove()}else{sessionStorage.setItem('ds_splashed','1')}}catch(e){}</script>\n`
      : '';
    const idx = chrome.indexOf('<div id="authPage"');
    const chromeHtml = linkify(chrome.slice(0, idx) + splashHtml + chrome.slice(idx));
    return `<body ${attrs}>
  <a href="#mainApp" class="skip-link" data-i18n="skipToContent">Skip to content</a>
${chromeHtml}
  <div id="mainApp" class="relative z-10" tabindex="-1">
${pageHtml}
${linkify(bottomNav)}
  </div>
`;
  };

  // ---- pages ---------------------------------------------------------------------------------------------------------
  const urls = []; let count = 0;
  for (const [key, meta] of Object.entries(cfg.pages)) {
    if (!pageEnabled(key)) continue;
    const bodyHtml = read(`src/pages/${key}.html`).replace('class="page"', 'class="page active"');
    const html = head({ title: meta.title, description: meta.description, canonicalPath: meta.path, noindex: meta.noindex })
      + '\n' + bodyShell({ route: key, pageHtml: linkify(bodyHtml), withSplash: key === 'home' }) + scripts();
    out.write(meta.path === '/' ? 'index.html' : path.join(meta.path, 'index.html'), html);
    if (!meta.noindex) urls.push(meta.path);
    count++;
  }
  for (const [section, meta] of Object.entries(cfg.details)) {
    const html = head({ title: meta.title, description: meta.title.replace(' — ', ' · '), canonicalPath: meta.path, noindex: true })
      + '\n' + bodyShell({ route: meta.nav, detail: section, pageHtml: '', withSplash: false }) + scripts();
    out.write(path.join(meta.path, 'index.html'), html);
    count++;
  }

  // ---- PWA (app site only): manifest, icons, offline page, service worker ---------------------------------------
  if (site === 'app') {
    out.copy('shared/pwa', 'icons');
    out.write('offline.html', read('shared/offline.html'));
    const shortcuts = [['excursions', 'Excursions', '/excursions/'], ['transfers', 'Transfers', '/transfers/'], ['restaurants', 'Restaurants', '/restaurants/'], ['bookings', 'My Bookings', '/bookings/']]
      .filter(([k]) => pageEnabled(k)).map(([, name, url]) => ({ name, short_name: name, url, icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] }));
    out.write('manifest.webmanifest', JSON.stringify({
      id: '/', name: cfg.siteName, short_name: 'Discover', lang: 'en',
      description: cfg.pages.home?.description || 'Excursions, transfers and dining in Sharm El-Sheikh.',
      start_url: '/?utm_source=pwa', scope: '/', display: 'standalone', display_override: ['fullscreen', 'standalone', 'minimal-ui'],
      orientation: 'portrait', background_color: '#0d0d0f', theme_color: '#0d0d0f', categories: ['travel', 'lifestyle'],
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts,
      screenshots: fs.existsSync(path.join(ROOT, 'shared/pwa-shots')) ? fs.readdirSync(path.join(ROOT, 'shared/pwa-shots')).filter((f) => /\.png$/.test(f)).sort()
        .map((f, i) => ({ src: '/screenshots/' + f, sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: ['Home', 'Excursions', 'Details', 'Profile'][i] || 'Discover Sharm' })) : [],
    }, null, 2));
    if (fs.existsSync(path.join(ROOT, 'shared/pwa-shots'))) out.copy('shared/pwa-shots', 'screenshots');
    const shellPages = ['/', ...Object.values(cfg.pages).filter((m) => m.path !== '/' && !m.noindex).map((m) => m.path)]
      .filter((u, i, a) => a.indexOf(u) === i).filter((u) => u === '/' || fs.existsSync(path.join(outRoot(site), u, 'index.html')));
    const precache = [...new Set([
      '/offline.html', '/manifest.webmanifest', ...shellPages,
      '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
      ...assetList.map((f) => `/${f}?v=${V[f]}`), `/site.css?v=${V['site.css']}`,
      '/data/destinations.json', '/data/excursions.json', '/data/transfers.json', '/data/restaurants.json',
    ])];
    const version = sha(JSON.stringify([V, precache]));
    out.write('sw.js', read('shared/sw.template.js').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 2)));
  }

  // ---- voucher (needs Supabase; same page on both sites, never redirected) -----------------------------------------
  if (useSupabase) {
    out.write('voucher/index.html', read('src/voucher.html')
      .replace('{{SUPABASE_CONFIG}}', JSON.stringify({ url: sbc.url, anonKey: sbc.anonKey }))
      .replace('{{SUPABASE_JS}}', SUPABASE_JS));
  }

  // ---- design system reference: desktop site only ------------------------------------------------------------------
  if (site === 'www') out.copy('design-system', 'design-system');

  // ---- 404 (+ legacy single-page-app link forwarding) -------------------------------------------------------------
  const legacy = Object.fromEntries(Object.entries(cfg.details).map(([s, m]) => [m.path.split('/')[1], { section: s, path: m.path }]));
  out.write('404.html', `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Page not found — ${esc(cfg.siteName)}</title><meta name="robots" content="noindex" />
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center;padding:24px}
  h1{font-size:56px;margin:0 0 8px;color:#f97316} p{color:#a3a3a3;margin:0 0 24px}
  a{display:inline-block;padding:14px 28px;border-radius:14px;background:#c2410c;color:#fff;text-decoration:none;font-weight:700}
</style>
<script>
  // Old single-page-app links such as /excursions/dolphin-house → the real detail page /excursions/view/?id=dolphin-house
  (function () {
    var map = ${JSON.stringify(legacy)};
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts.length === 2 && map[parts[0]] && parts[1] !== 'view') {
      location.replace(map[parts[0]].path + '?id=' + encodeURIComponent(decodeURIComponent(parts[1])));
    }
  })();
</script></head>
<body><main><h1>404</h1><p>We couldn't find that page.</p><a href="/">Back to Discover Sharm</a></main></body></html>
`);

  // ---- robots + sitemap (the sitemap lists the www URLs: they are the canonical ones) -------------------------------
  out.write('robots.txt', `User-agent: *\nDisallow: /design-system/\nSitemap: ${SITES.www}/sitemap.xml\n`);
  if (site === 'www') {
    out.write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.map((u) =>
      `  <url><loc>${SITES.www}${u}</loc><xhtml:link rel="alternate" media="only screen and (max-width: 1023px)" href="${SITES.app}${u}"/></url>`).join('\n')}\n</urlset>\n`);
  }

  // ---- hosting files ---------------------------------------------------------------------------------------------
  out.write('CNAME', new URL(domain).hostname + '\n');
  out.write('.nojekyll', '');
  out.write('_redirects', [
    '# Staff consoles moved to their own site (Cloudflare Pages / Netlify syntax)',
    `/admin      ${SITES.admin}/        301`,
    `/admin/*    ${SITES.admin}/        301`,
    `/owner/*    ${SITES.admin}/owner/:splat  301`,
    `/console/*  ${SITES.admin}/        301`,
    '',
  ].join('\n'));
  out.write('_headers', [
    '/*',
    `  Strict-Transport-Security: ${HSTS}`,
    `  Content-Security-Policy: ${csp(site)}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(self)',
    '  X-Frame-Options: SAMEORIGIN',
    '',
    ...(site === 'app'
      ? [...assetList, 'site.css'].flatMap((f) => [`/${f}`, '  Cache-Control: public, max-age=31536000, immutable'])
      : ['/*.css', '  Cache-Control: public, max-age=31536000, immutable', '/*.js', '  Cache-Control: public, max-age=31536000, immutable']),
    ...(site === 'app' ? [
      '/sw.js', '  Cache-Control: no-cache', '  Service-Worker-Allowed: /',
      '/manifest.webmanifest', '  Content-Type: application/manifest+json', '  Cache-Control: public, max-age=3600',
      '/offline.html', '  Cache-Control: no-cache',
      '/icons/*', '  Cache-Control: public, max-age=2592000',
    ] : []),
    '/data/*',
    '  Cache-Control: public, max-age=300',
    '',
  ].join('\n'));

  console.log(`[${site}] ${count} pages · ${domain}  (assets: ${Object.entries(V).map(([k, v]) => k + '@' + v).join(', ')})`);
}

// ============================================================================================================================
//  ADMIN SITE
// ============================================================================================================================
function buildAdmin() {
  const site = 'admin', out = mk(site), domain = SITES.admin;
  fs.rmSync(outRoot(site), { recursive: true, force: true });

  const files = ['console.css', 'i18n.js', 'console.js', 'editor.js', 'qr.js', 'restaurants.js', 'settings.js', 'schemas.js', 'supabase-console.js'];
  const V = {};
  for (const f of files) { const b = fs.readFileSync(path.join(ROOT, 'console', f)); out.write(`console/${f}`, b); V[f] = sha(b); }
  const adminJs = fs.readFileSync(path.join(ROOT, 'admin-src', 'admin.js')); out.write('admin.js', adminJs); V['admin.js'] = sha(adminJs);

  const sbCfg = `// GENERATED by tools/build.mjs from site.config.json — public values only.
window.DS_SUPABASE = ${useSupabase ? JSON.stringify({ url: sbc.url, anonKey: sbc.anonKey, translateBase: (sbc.translateBase || '').replace(/\/$/, ''), contentBase: (sbc.contentBase || '').replace(/\/$/, ''), settingsBase: (sbc.settingsBase || '').replace(/\/$/, '') }) : 'null'};
${useSupabase ? `document.write('<script src="${SUPABASE_JS}"><\\/script>');` : ''}
`;
  out.write('console/supabase-config.js', sbCfg); V['supabase-config.js'] = sha(sbCfg);

  // every admin-src page: absolute asset paths + cache-busting hashes
  const page = (srcRel, outRel) => {
    let h = read(`admin-src/${srcRel}`)
      .replace('<link rel="stylesheet" href="../console/console.css">', `<script src="/console/i18n.js?v=${V['i18n.js']}"></script>\n<link rel="stylesheet" href="../console/console.css">`)
      .replace('href="../console/console.css"', `href="/console/console.css?v=${V['console.css']}"`)
      .replace('src="../console/supabase-config.js"', `src="/console/supabase-config.js?v=${V['supabase-config.js']}"`)
      .replace('src="../console/supabase-console.js"', `src="/console/supabase-console.js?v=${V['supabase-console.js']}"`)
      .replace('src="../console/console.js"', `src="/console/console.js?v=${V['console.js']}"`)
      // schemas + the console modules (editor, QR, restaurants, settings) load right after console.js, before any inline script
      .replace('src="../console/schemas.js"></script>', `src="/console/schemas.js?v=${V['schemas.js']}"></script>\n` + ['editor', 'qr', 'restaurants', 'settings'].map(f => `<script src="/console/${f}.js?v=${V[f + '.js']}"></script>`).join('\n'))
      .replace('src="admin.js"', `src="/admin.js?v=${V['admin.js']}"`);
    out.write(outRel, h);
  };
  page('index.html', 'index.html');
  for (const f of fs.readdirSync(path.join(ROOT, 'admin-src', 'owner'))) page(`owner/${f}`, `owner/${f}`);
  out.write('owner/index.html', read('admin-src/owner-index.html').replace('</head>', `<script src="/console/i18n.js?v=${V['i18n.js']}"></script>\n</head>`));
  for (const f of fs.readdirSync(path.join(ROOT, 'console', 'admin-lang'))) out.copy(`console/admin-lang/${f}`, `lang/admin-${f}`);   // console interface languages (see console/i18n.js)
  out.copy('shared/favicon.ico', 'favicon.ico');
  out.copy('shared/data/lang/en.json', 'lang/en.json');   // the English UI strings: the source text when a new language is added (console/settings.js)

  out.write('404.html', `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>404</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1b44;color:#fff;font-family:system-ui,sans-serif;text-align:center}a{color:#fbbf24}</style></head>
<body><main><h1>404</h1><p>الصفحة دي مش موجودة</p><a href="/">لوحة الإدارة</a></main></body></html>\n`);

  out.write('robots.txt', 'User-agent: *\nDisallow: /\n');
  out.write('CNAME', new URL(domain).hostname + '\n');
  out.write('.nojekyll', '');
  out.write('_headers', [
    '/*',
    `  Strict-Transport-Security: ${HSTS}`,
    `  Content-Security-Policy: ${csp('admin')}`,
    '  X-Robots-Tag: noindex, nofollow, noarchive',
    '  X-Frame-Options: DENY',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
    '  Cross-Origin-Opener-Policy: same-origin',
    '',
    '/console/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/admin.js',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'));

  console.log(`[admin] super-admin + ${fs.readdirSync(path.join(ROOT, 'admin-src', 'owner')).length} owner consoles · ${domain}  (Supabase ${useSupabase ? 'ON' : 'not configured'})`);
}

const warn = [];
if (!useSupabase) warn.push('DS_SUPABASE_URL / DS_SUPABASE_ANON_KEY are not set — building WITHOUT Supabase (sign-in, bookings and catalog will not work).');
if (targets.some(t => t !== 'admin') && useSupabase && !sbc.paymentsBase) warn.push('DS_PAYMENTS_BASE is not set — online payment is disabled.');
if (targets.some(t => t !== 'admin') && useSupabase && !sbc.googleClientId) warn.push('DS_GOOGLE_CLIENT_ID is not set — "Continue with Google" is hidden.');
if (useSupabase && !sbc.settingsBase) warn.push('DS_SETTINGS_BASE is not set — site settings are read from / saved to the database (old behaviour), NOT settings.json in the GitHub data repo.');
if (useSupabase && !sbc.contentBase) warn.push('DS_CONTENT_BASE is not set — items are read from / saved to the database (old behaviour), NOT the GitHub data repo.');
if (targets.includes('admin') && useSupabase && !sbc.translateBase) warn.push('DS_TRANSLATE_BASE is not set — the consoles cannot auto-translate on save.');
for (const t of targets) (t === 'admin' ? buildAdmin : buildPublic)(t);
for (const w of warn) console.warn('\x1b[33m⚠ ' + w + '\x1b[0m');
