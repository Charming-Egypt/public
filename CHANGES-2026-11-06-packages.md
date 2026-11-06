# Packages (Honeymoon / Friends / Family / Adventure)
A package = an ordinary excursion item with `packageType` set (+ optional `days`). Booking, server price check, payment, voucher, reviews and owner/admin editing all reuse the excursion pipeline; no SQL migration needed.
- Admin / owner (Trips editor): new "باكدج؟" section -> choose the package type + days. Leave "رحلة عادية" for a normal trip. Price = per person; list what is inside under "السعر يشمل".
- App/www: new /packages/ page (type chips), "Packages" in drawer + desktop nav, home strip (auto-hidden until a package exists), "Package" pill in My Bookings, package badge on the detail page. Packages are hidden from the Excursions list.
- Config: site.config.json `pages.packages`, `show.packages`; site setting `sections.packages` can switch it off at runtime.
- Files: shared/frontend.js (packagesUi), shared/data.js, shared/booking.js, shared/style.css, src/pages/packages.html, src/pages/home.html, src/partials/chrome.html, console/editor.js, lang en/ar.
