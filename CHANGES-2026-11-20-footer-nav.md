# Footer + bottom nav — night design
- src/pages/home.html: footer payment pills (VISA / Mastercard / wallet / InstaPay), socials Instagram · Facebook · YouTube · TikTok, link rows with trailing dots.
- shared/style.css (end): dark navy->teal footer, glow ribbons, glass pills, outlined orange social circles, palms.
- src/partials/bottom-nav.html + shared/site-app.css: labelled tabs, curved bar with glowing orange edge, orange centre button, active underline, red count badge. Icons unchanged.
- shared/data.js: bottom-nav badge shows unread count. shared/frontend.js: YouTube link from contact settings. lang files: navBookingsTab.
- Follow-up: footer now follows light/dark theme (--ft-* variables); fixed 14px horizontal overflow on the home page (palms/glow) that shrank the page and misaligned the fixed nav; removed seam under footer waves and the seam between nav pieces; tighter footer spacing.
