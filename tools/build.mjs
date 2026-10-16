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

// ---- Supabase (public values only). env vars win, for CI / local testing ---------------------------------------------
const sbc = { ...(cfg.supabase || {}),
  ...(process.env.DS_SUPABASE_URL ? { url: process.env.DS_SUPABASE_URL } : {}),
  ...(process.env.DS_SUPABASE_ANON_KEY ? { anonKey: process.env.DS_SUPABASE_ANON_KEY } : {}),
  ...(process.env.DS_PAYMENTS_BASE ? { paymentsBase: process.env.DS_PAYMENTS_BASE } : {}) };
const useSupabase = !!(sbc.url && sbc.anonKey);
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';   // pinned
// content hash of the editorial JSON (destinations / articles / reviews / promoSlides): cache-busts /data/*.json when you edit them
const DATA_V = (() => { const h = crypto.createHash('sha1'); for (const f of ['destinations', 'articles', 'reviews', 'promoSlides']) h.update(fs.readFileSync(path.join(ROOT, 'shared', 'data', f + '.json'))); return h.digest('hex').slice(0, 8); })();
const apiBase = (process.env.DS_API_BASE ?? cfg.apiBase ?? '').replace(/\/$/, '');

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
const pageEnabled = (key) => ['hotels', 'excursions', 'transfers', 'restaurants'].includes(key) ? sectionEnabled(key) : true;
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonical}" />${alt}${noindex ? '\n  <meta name="robots" content="noindex, nofollow" />' : ''}
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${esc(cfg.siteName)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${SITES.www + canonicalPath}" />
  <meta name="twitter:card" content="summary_large_image" />${ld}

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
      SHOW_DESTINATIONS: sectionEnabled('destinations'),
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
  ${useSupabase ? `<script>window.DS_SUPABASE = ${JSON.stringify({ url: sbc.url, anonKey: sbc.anonKey, googleClientId: sbc.googleClientId || '', paymentsBase: sbc.paymentsBase || '' })};</script>
  <script src="${SUPABASE_JS}"></script>` : '<!-- Supabase not configured: running on the legacy API -->'}
  <script src="/data.js?v=${V['data.js']}"></script>
  ${useSupabase ? `<script src="/supabase-api.js?v=${V['supabase-api.js']}"></script>` : ''}
  <script src="/booking.js?v=${V['booking.js']}"></script>
  <script src="/frontend.js?v=${V['frontend.js']}"></script>
  <script src="/router.js?v=${V['router.js']}"></script>
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
    if (!sectionEnabled(section === 'articles' ? 'journal' : section)) continue;
    const html = head({ title: meta.title, description: meta.title.replace(' — ', ' · '), canonicalPath: meta.path, noindex: true })
      + '\n' + bodyShell({ route: meta.nav, detail: section, pageHtml: '', withSplash: false }) + scripts();
    out.write(path.join(meta.path, 'index.html'), html);
    count++;
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
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(self)',
    '  X-Frame-Options: SAMEORIGIN',
    '',
    '/*.css',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/*.js',
    '  Cache-Control: public, max-age=31536000, immutable',
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

  const files = ['console.css', 'console.js', 'editor.js', 'schemas.js', 'supabase-console.js'];
  const V = {};
  for (const f of files) { const b = fs.readFileSync(path.join(ROOT, 'console', f)); out.write(`console/${f}`, b); V[f] = sha(b); }
  const adminJs = fs.readFileSync(path.join(ROOT, 'admin-src', 'admin.js')); out.write('admin.js', adminJs); V['admin.js'] = sha(adminJs);

  const sbCfg = `// GENERATED by tools/build.mjs from site.config.json — public values only.
window.DS_SUPABASE = ${useSupabase ? JSON.stringify({ url: sbc.url, anonKey: sbc.anonKey }) : 'null'};
${useSupabase ? `document.write('<script src="${SUPABASE_JS}"><\\/script>');` : ''}
`;
  out.write('console/supabase-config.js', sbCfg); V['supabase-config.js'] = sha(sbCfg);

  // every admin-src page: absolute asset paths + cache-busting hashes
  const page = (srcRel, outRel) => {
    let h = read(`admin-src/${srcRel}`)
      .replace('href="../console/console.css"', `href="/console/console.css?v=${V['console.css']}"`)
      .replace('src="../console/supabase-config.js"', `src="/console/supabase-config.js?v=${V['supabase-config.js']}"`)
      .replace('src="../console/supabase-console.js"', `src="/console/supabase-console.js?v=${V['supabase-console.js']}"`)
      .replace('src="../console/console.js"', `src="/console/console.js?v=${V['console.js']}"></script>\n<script src="/console/editor.js?v=${V['editor.js']}"`)
      .replace('src="../console/schemas.js"', `src="/console/schemas.js?v=${V['schemas.js']}"`)
      .replace('src="admin.js"', `src="/admin.js?v=${V['admin.js']}"`);
    out.write(outRel, h);
  };
  page('index.html', 'index.html');
  for (const f of fs.readdirSync(path.join(ROOT, 'admin-src', 'owner'))) page(`owner/${f}`, `owner/${f}`);
  out.write('owner/index.html', read('admin-src/owner-index.html'));
  out.copy('shared/favicon.ico', 'favicon.ico');

  out.write('404.html', `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>404</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1b44;color:#fff;font-family:system-ui,sans-serif;text-align:center}a{color:#fbbf24}</style></head>
<body><main><h1>404</h1><p>الصفحة دي مش موجودة</p><a href="/">لوحة الإدارة</a></main></body></html>\n`);

  out.write('robots.txt', 'User-agent: *\nDisallow: /\n');
  out.write('CNAME', new URL(domain).hostname + '\n');
  out.write('.nojekyll', '');
  out.write('_headers', [
    '/*',
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

for (const t of targets) (t === 'admin' ? buildAdmin : buildPublic)(t);
