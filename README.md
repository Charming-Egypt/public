# Discover Sharm — multi-page site

Every screen is its own HTML file with its own URL. No client-side router, no
`pushState`, no 404 redirect trick. Works on any static host as-is.

```
/                       home
/excursions/            list            /excursions/view/?id=e1    detail
/transfers/             list            /transfers/view/?id=t1     detail
/journal/               list            /journal/view/?id=a1       article
/destinations/view/?id=d1               /about/ /contact/ /partner/
/cancellation-policy/ /refund-policy/ /terms/ /privacy/
/bookings/ /profile/ /settings/ /notifications/      (account, noindex)
/admin/  /console/  /owner/                          (unchanged)
```

## Run it

```bash
npm run dev:live          # http://localhost:8080, /api/* proxied to the live backend
npm run dev               # same, without a backend (catalog stays empty)
```

Needs Node 18+. Run `npm install` once, then `npm run build` to regenerate the
pages and compile Tailwind locally for production. Run `npm run dev` to serve
the generated site at `http://localhost:8080`.

## Deploy

The generated pages are committed, so **no build step is needed**: upload / push
the folder to GitHub Pages (CNAME is already set), Cloudflare Pages, Netlify, S3…
`/api/*` must be routed to your Worker on the same origin, exactly as before.

`404.html` forwards old single-page-app links (`/excursions/dolphin-house`) to
`/excursions/view/?id=dolphin-house`, so existing shared links keep working.

## Change things

| I want to…                         | Do this                                                              |
|------------------------------------|----------------------------------------------------------------------|
| Turn a section (hotels, restaurants, …) on or off | `site.config.json` → `show`, then `npm run build` (all on by default) |
| Edit a page's content              | `src/pages/<name>.html`, then `npm run build`                        |
| Edit header, menu, modals, footer  | `src/partials/chrome.html` / `bottom-nav.html`, then `npm run build` |
| Change a page title / description  | `site.config.json` → `pages`, then `npm run build`                   |
| Add a page                         | new `src/pages/<name>.html` + an entry in `site.config.json` + `ROUTES`/`PAGE_TITLES` in `frontend.js` |

`npm run build` regenerates every page, `tailwind.generated.css`, `sitemap.xml`,
`robots.txt` and the cache-busting hashes (`?v=…`) on CSS/JS. Run it after
changing **any** `.css`/`.js` file too, so visitors get the new version.

## How it behaves

- **Navigation** — menu items are real `<a href>` links (open in new tab, crawlable).
  JS-built cards call `showExcursionPage(id)` etc.; `page-navigation.js` turns that into a
  link to the item's own page.
- **Sign-in gate** — unchanged, but "Continue as guest" is remembered for the
  browser session, so you aren't asked again on every page.
- **Splash** — only on the first home-page visit of a session.
- **Catalog** — the 8 catalog files now load in parallel and are cached for the
  session, so page-to-page jumps are instant; fresh data is fetched in the background.
- **Search** — choices made on the home page carry over to the results page.
- **Checkout / booking steps** are still in-page overlays (they are a single
  transaction, not separate destinations). Closing one returns to its page.

## Known limits

- Detail pages (`…/view/?id=`) fill in from the live catalog after load, so search
  engines see the shell, not the item. Pre-rendering them needs the catalog at build
  time; say the word and the build script can fetch it.

## Also in this release (UX polish v13)

See `docs/UX-POLISH-CHANGELOG.md` and the live token reference at `/design-system/`.

## Supabase backend

Accounts, owners, properties and bookings live in Supabase: see `supabase/README.md` (Arabic) for setup.
Leave `supabase.url` empty in `site.config.json` to keep running on the legacy API.
