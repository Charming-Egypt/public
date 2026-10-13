#!/usr/bin/env node
/**
 * Discover Sharm — static multi-page build (zero dependencies).
 *
 *   node tools/build.mjs
 *
 * Reads  : site.config.json, src/partials/*, src/pages/*
 * Writes : one real index.html per route (e.g. excursions/index.html),
 *          one detail shell per section (e.g. excursions/view/index.html),
 *          404.html, robots.txt, sitemap.xml
 *
 * The generated files are committed, so the site works with NO build step
 * on any static host. Re-run the build only after editing src/ or the config.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => {
  const full = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, s);
};
const cfg = JSON.parse(read('site.config.json'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// ---- cache-busting: short content hash per asset --------------------------
const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 8);
const V = Object.fromEntries(['style.css', 'tailwind.generated.css', 'data.js', 'supabase-api.js', 'booking.js', 'frontend.js', 'page-navigation.js'].map((f) => [f, hash(f)]));

// ---- which sections are switched on? --------------------------------------
const on = cfg.show;
const sectionEnabled = (key) => (key in on ? !!on[key] : true);
const pageEnabled = (key) => ['hotels', 'excursions', 'transfers', 'restaurants'].includes(key) ? sectionEnabled(key) : true;

// ---- shared partials -------------------------------------------------------
const P = (n) => read(`src/partials/${n}.html`);
const fallbackLogo = P('fallback-logo');
const splash = P('splash');
const chrome = P('chrome');
const bottomNav = P('bottom-nav');

// page key -> clean path (used to turn nav.go('x') buttons into real links)
const pathOf = (key) => (cfg.pages[key] ? cfg.pages[key].path : null);

/** <button onclick="nav.go('x')">…</button>  →  <a href="/x/">…</a> */
function linkify(html) {
  return html.replace(
    /<button([^>]*?)\sonclick="(?:event\.stopPropagation\(\);\s*)?nav\.go\('(\w+)'\)(?:;\s*sidebar\.close\(\))?"([^>]*)>([\s\S]*?)<\/button>/g,
    (m, a, key, b, inner) => {
      const href = pathOf(key);
      if (!href || !pageEnabled(key)) return m;           // unknown / switched-off page: leave the JS handler
      const attrs = (a + b).replace(/\stype="button"/g, '');
      return `<a href="${href}" data-nl${attrs}>${inner}</a>`;
    }
  ).replace(
    // footer-style <a onclick="nav.go('x')"> that never had an href: make them crawlable links
    /<a(\s[^>]*?)?\sonclick="nav\.go\('(\w+)'\)"/g,
    (m, a = '', key) => {
      const href = pathOf(key);
      return href && pageEnabled(key) && !/\shref=/.test(a) ? `<a href="${href}"${a}` : m;
    }
  );
}

// ---- <head> ---------------------------------------------------------------
function head({ title, description, canonicalPath, noindex }) {
  const url = cfg.domain + canonicalPath;
  const ld = canonicalPath === '/' ? `
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.siteName, url: cfg.domain + '/',
    description,
  })}</script>` : '';
  return `<!DOCTYPE html>
<html lang="en" dir="ltr" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${url}" />${noindex ? '\n  <meta name="robots" content="noindex, nofollow" />' : ''}
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${esc(cfg.siteName)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${url}" />
  <meta name="twitter:card" content="summary_large_image" />${ld}

  <script>
    // Runs before first paint: theme + language (no flash), and the auth gate.
    // Visitors with no session and no "continue as guest" choice see the sign-in
    // screen first, exactly like before — but the choice now survives page loads.
    (function () {
      try {
        var d = document.documentElement;
        d.dataset.theme = localStorage.getItem('ds_theme') || 'dark';
        var l = localStorage.getItem('ds_lang') || 'en';
        d.lang = l; d.dir = l === 'ar' ? 'rtl' : 'ltr';
        if (!localStorage.getItem('ds_auth_token') && !sessionStorage.getItem('ds_guest')) d.dataset.gate = 'auth';
      } catch (e) {}
    })();
    window.DS_CONFIG = ${JSON.stringify({
      SHOW_HOTELS: sectionEnabled('hotels'), SHOW_EXCURSIONS: sectionEnabled('excursions'),
      SHOW_TRANSFERS: sectionEnabled('transfers'), SHOW_RESTAURANTS: sectionEnabled('restaurants'),
      SHOW_DESTINATIONS: sectionEnabled('destinations'),
    })};
  </script>
  ${fallbackLogo.trim()}

  <link rel="stylesheet" href="/style.css?v=${V['style.css']}" />
  <link rel="stylesheet" href="/tailwind.generated.css?v=${V['tailwind.generated.css']}" />
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23fbbf24'/%3E%3Ctext x='32' y='43' text-anchor='middle' font-family='Georgia,serif' font-weight='700' font-size='25' fill='%23000'%3EDS%3C/text%3E%3C/svg%3E" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <script src="https://accounts.google.com/gsi/client" async defer></script>
</head>`;
}

// Supabase mode is on when site.config.json has a project url + anon key (both are public values).
const sbc = { ...(cfg.supabase || {}),
  ...(process.env.DS_SUPABASE_URL ? { url: process.env.DS_SUPABASE_URL } : {}),
  ...(process.env.DS_SUPABASE_ANON_KEY ? { anonKey: process.env.DS_SUPABASE_ANON_KEY } : {}),
  ...(process.env.DS_PAYMENTS_BASE ? { paymentsBase: process.env.DS_PAYMENTS_BASE } : {}) };   // env vars win (CI / local testing)
const useSupabase = !!(sbc.url && sbc.anonKey);
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';   // pinned

const scripts = () => `
  ${useSupabase ? `<script>window.DS_SUPABASE = ${JSON.stringify({ url: sbc.url, anonKey: sbc.anonKey, googleClientId: sbc.googleClientId || '', paymentsBase: sbc.paymentsBase || '' })};</script>
  <script src="${SUPABASE_JS}"></script>` : '<!-- Supabase not configured: running on the legacy API -->'}
  <script src="/data.js?v=${V['data.js']}"></script>
  ${useSupabase ? `<script src="/supabase-api.js?v=${V['supabase-api.js']}"></script>` : ''}
  <script src="/booking.js?v=${V['booking.js']}"></script>
  <script src="/frontend.js?v=${V['frontend.js']}"></script>
  <script src="/page-navigation.js?v=${V['page-navigation.js']}"></script>
</body>
</html>
`;

function bodyShell({ route, detail, pageHtml, withSplash }) {
  const attrs = `data-route="${route}"${detail ? ` data-detail="${detail}"` : ''}`;
  const splashHtml = withSplash
    ? splash.trim() + `
  <script>try{if(sessionStorage.getItem('ds_splashed')){var s=document.getElementById('splashPage');if(s)s.remove()}else{sessionStorage.setItem('ds_splashed','1')}}catch(e){}</script>\n`
    : '';
  // chrome = toast, lightbox, auth screen, modals, drawer, headers. The splash
  // sits between the first and second block in the original markup, so it is
  // injected right before the auth screen.
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
}

// ---- generate pages ---------------------------------------------------------
const urls = [];
let count = 0;

for (const [key, meta] of Object.entries(cfg.pages)) {
  if (!pageEnabled(key)) continue;
  const bodyHtml = read(`src/pages/${key}.html`).replace('class="page"', 'class="page active"');
  const html = head({ title: meta.title, description: meta.description, canonicalPath: meta.path, noindex: meta.noindex })
    + '\n' + bodyShell({ route: key, pageHtml: linkify(bodyHtml), withSplash: key === 'home' }) + scripts();
  write(meta.path === '/' ? 'index.html' : path.join(meta.path, 'index.html'), html);
  if (!meta.noindex) urls.push(meta.path);
  count++;
}

for (const [section, meta] of Object.entries(cfg.details)) {
  if (!sectionEnabled(section === 'articles' ? 'journal' : section)) continue;
  const html = head({ title: meta.title, description: meta.title.replace(' — ', ' · '), canonicalPath: meta.path, noindex: true })
    + '\n' + bodyShell({ route: meta.nav, detail: section, pageHtml: '', withSplash: false }) + scripts();
  write(path.join(meta.path, 'index.html'), html);
  count++;
}

// ---- 404 (friendly page + legacy-URL redirect) ------------------------------
const legacy = Object.fromEntries(Object.entries(cfg.details).map(([s, m]) => [m.path.split('/')[1], { section: s, path: m.path }]));
write('404.html', `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Page not found — ${esc(cfg.siteName)}</title><meta name="robots" content="noindex" />
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center;padding:24px}
  h1{font-size:56px;margin:0 0 8px;color:#f97316} p{color:#a3a3a3;margin:0 0 24px}
  a{display:inline-block;padding:14px 28px;border-radius:14px;background:#c2410c;color:#fff;text-decoration:none;font-weight:700}
</style>
<script>
  // Old single-page-app links such as /excursions/dolphin-house keep working:
  // they are forwarded to the real detail page /excursions/view/?id=dolphin-house.
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

// ---- robots + sitemap ---------------------------------------------------------
write('robots.txt', `User-agent: *\nDisallow: /admin/\nDisallow: /console/\nDisallow: /owner/\nDisallow: /design-system/\nSitemap: ${cfg.domain}/sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${cfg.domain}${u}</loc></url>`).join('\n')}\n</urlset>\n`);

console.log(`Built ${count} pages + 404.html, robots.txt, sitemap.xml  (assets: ${Object.entries(V).map(([k, v]) => k + '@' + v).join(', ')})`);
