# UX Polish v13 — what changed and why

## Accessibility
| Change | Where | Why |
|---|---|---|
| Pinch-zoom re-enabled (`maximum-scale`/`user-scalable=no` removed, `viewport-fit=cover` added) | index.html | WCAG 1.4.4 |
| 28 icon-only buttons got translated `aria-label`s (`data-i18n-aria`) + decorative icons `aria-hidden` | index.html, data.js, data/lang/*.json | Screen readers announced "button" only |
| 25 `<img>` templates got `alt=""` (cards already carry the title text) | frontend.js, booking.js, data.js | Decorative images no longer read as filenames |
| Global `:focus-visible` ring | style.css | Keyboard users had no visible focus |
| `prefers-reduced-motion` support | style.css | Splash, stars, orbs, toasts |
| Toasts announce via `role="status"` | index.html | Success/error was silent for screen readers |
| 44px touch floor on icon buttons (coarse pointers) | style.css | Mobile-first audience |

## Contrast
| Token | Before | After |
|---|---|---|
| Light `--text-secondary` | #8a8399 (3.6:1) | #6b6478 (5.4:1) |
| White text on orange buttons | 2.1–2.8:1 gradient | `--brand-600`→`--brand-700` (5.2:1+) |
| Tiny text (9–11px Tailwind) | 105 uses | floored to 12px |

## UX / Copy
- `window.confirm()` → accessible `confirmDialog()` with labelled buttons ("Cancel booking" / "Keep booking"), focus on the safe choice, Esc/backdrop = keep, Tab trap, focus restore. All 6 languages.
- Cancellation error no longer prints `e.message`; says what to do next. Logged to console instead.
- "Please login to book" → "Sign in to book" (6 languages).
- Back arrow now flips with direction (it pointed right in every LTR language).

## System
- New token layer (brand, space, radius, type, shadow, motion, z-index) appended to style.css.
- `design-system/index.html` — live reference page rendering the real tokens, with theme + RTL toggles.
- 2 physical margin/padding rules converted to logical properties.

## Rollback
Delete the "UX POLISH v13" block at the end of style.css to remove all CSS changes. Orange buttons are one token: change `--brand-600` to bring back a brighter orange.

## Not done (needs a decision)
- Rename Tailwind `violet-*` → `brand-*` and `mist-*` → `neutral-*` (touches every template).
- Move the 138 inline `style=` attributes and ~181 hex values in style.css onto tokens (mechanical but large; best done per-screen with visual review).
- Per-image meaningful `alt` text for hotel galleries.
- Visual QA: I couldn't render the app (CDN assets need network). Check the 12px type floor on small badges and the darker button gradient.

## v14 — multi-page conversion
See README.md. 17 screens → 19 real HTML files (+6 detail shells), `tools/build.mjs`,
`tools/serve.mjs`, `router.js`, parallel + cached catalog loading, remembered guest
choice, sitemap/robots/canonical/OG tags, legacy-link redirect in `404.html`.

## v15 — Supabase
Database (accounts, owners, properties, bookings, finance) + RLS + indexes; site adapter; payments Worker port
(3-D Secure `status` override fixed along the way); admin/owner consoles on Supabase; e-mail + printable voucher;
Firebase booking importer; owner listings now start as "pending review" and a super admin publishes them.

## v16 — bug-fix pass
- Home hero: removed the leftover (dead, English-only, hotel-first) search card; hero copy now matches the enabled sections in all 6 languages; hero background rotation restarted (it was only wired to the removed card) and no longer runs on pages without a hero.
- Tailwind compiled locally (`tailwind.css`) instead of the runtime CDN script: no flash of unstyled content, no CDN dependency, no `tailwind is not defined` risk.
- `build.mjs` removes pages of switched-off sections so stale hotels/restaurants pages are not left behind; committed pages were regenerated (they were out of sync with `site.config.json`).
- Side drawer is opaque (page text bled through); guests see "Log In" instead of "Logout".
- Partner form: document slot labels showed `undefined`; partner-type chips, "Upload", review counts, "No reviews yet", "Could not load reviews", "No notifications yet", "Guest", "Included" and excursion category badges are now translated (10 new keys × 6 languages).
- "Browse Hotels" empty-state button on My Bookings now reads "Browse Excursions"; Favorites stat hidden when hotels are off.


## v17 — three sites, static content, search, new consoles
- Split into www (desktop) / app (phones+tablets) / admin; shared login + prefs between www and app (`ds-bridge.js`), device routing (`ds-site.js`).
- Destinations, journal articles, site reviews and promo slides are plain JSON (`shared/data/*.json`), not database rows; admin content tabs and the JSON file editor were removed.
- Home search card restored and extended: Hotels / Excursions / Transfers tabs (only enabled sections show), dates in the user's language, category picker, free-text transfer search, 6 languages.
- Admin / owner consoles redesigned: dark "Admin V7" glass look (default) and light "Tour" look; floating rail with tooltips, greeting header with live page filter, right panel with calendar + next bookings, floating bottom bar on phones.
