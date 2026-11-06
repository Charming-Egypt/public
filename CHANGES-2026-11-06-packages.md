# Packages (Honeymoon / Friends / Family / Adventure)
A package = an ordinary excursion item with `packageType` set (+ optional `days`). Booking, server price check, payment, voucher, reviews and owner/admin editing all reuse the excursion pipeline; no SQL migration needed.
- Admin / owner (Trips editor): new "باكدج؟" section -> choose the package type + days. Leave "رحلة عادية" for a normal trip. Price = per person; list what is inside under "السعر يشمل".
- App/www: new /packages/ page (type chips), "Packages" in drawer + desktop nav, home strip (auto-hidden until a package exists), "Package" pill in My Bookings, package badge on the detail page. Packages are hidden from the Excursions list.
- Config: site.config.json `pages.packages`, `show.packages`; site setting `sections.packages` can switch it off at runtime.
- Files: shared/frontend.js (packagesUi), shared/data.js, shared/booking.js, shared/style.css, src/pages/packages.html, src/pages/home.html, src/partials/chrome.html, console/editor.js, lang en/ar.

## Update: Packages as their own section (admin + owner)
- Super admin: new "الباكدجات" tab in المحتوى (own list, own editor). The "الرحلات" tab now lists normal trips only.
- Owner: new panel /owner/pkg.html (also linked from /owner/). /owner/ex.html lists trips only. Same trips_owner account works in both panels.
- Editor: package form (name, type chips honeymoon/friends/family/adventure, days, price, includes, itinerary). The old "باكدج؟" switch inside the trips editor was removed.
- Site settings: new "الباكدجات" on/off switch (sections.packages).
- Still shared with trips on purpose: DB kind (excursion), booking/payment, commission rate, owner role, bookings + finance views. No SQL or Worker changes.
