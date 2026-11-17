# حماية العميل من نصب السيلر (2026-11-12)

المنصة بتتأكد إن **السيلر دفع للمنصة** (Kashier بيأكّد من السيرفر). اللي مكانش متأمّن: **اللي العميل دفعه للسيلر كاش**. التعديلات دي بتقفل الثغرة:

1. **كود تأكيد على إيميل العميل قبل أي دفع** — الـ Worker بيبعت كود من 6 أرقام للعميل نفسه (`/api/seller/otp/send`)، والسيلر بيكتب اللي العميل يقراه (`/api/seller/otp/verify`). `wallet/initiate` و`charge` و`hash` بيرفضوا حجز السيلر من غير الكود (`contact_proof_required`). الكود مربوط بالحجز والإيميل وصالح 10 دقايق (HMAC، من غير تخزين). الكود نفسه فيه الإجمالي والمدفوع أونلاين والمتبقي.
2. **بيانات العميل بتتقفل** بعد التأكيد (trigger `lock_seller_booking_contact`)، وإيميل التأكيد والفاوتشر بتبعتهم المنصة تلقائيًا للعميل (مش السيلر).
3. **الفاوتشر وإيميل التأكيد** فيهم: "المدفوع أونلاين X — المتبقي Y لمقدّم الخدمة فقط — مش لأي حد تاني" + لينك تحقق. رسالة الواتساب فيها نفس الكلام.
4. **صفحة تحقق عامة** `/verify/?id=…` (على الموقعين) — حالة الحجز والمدفوع والمتبقي، وفيها **نموذج بلاغ**.
5. **العربون للسيلر بصلاحية فقط**: `seller_deposit_ok` (الافتراضي لأ)، وحد أقصى للمتبقي على العميل `seller_deposit_max_remaining` (5000).
6. **توثيق السيلر**: السيلر الجديد `seller_verified = false` فلا يحجز لعملاء لحد ما الأدمن يوثّقه (السيلرز الحاليين اتوثّقوا تلقائيًا في الـ migration). **حد يومي** `seller_daily_limit` (30000). السيلر الموقوف `seller_flagged` ما يحجزش. كله بـ trigger على `bookings` فمفيش طريق لتجاوزه.
7. **بلاغات العملاء** (`report_seller`): بتجمّد عمولة السيلر على الحجز المُبلَّغ عنه، وبلاغان على حجزين مختلفين بيوقفوا السيلر تلقائيًا. الأدمن بيقرر: صح (الإيقاف يفضل) أو مش صح (العمولة ترجع).
8. **إشارات خطر للأدمن** (`admin_seller_risk`): نفس الإيميل/الرقم 3+ مرات، 10+ حجوزات في يوم، 5+ عربون، بلاغ مفتوح.
9. **تبويب جديد "السيلرز" في لوحة الأدمن**: توثيق/إيقاف، العربون والحدود، البلاغات، الإشارات.

## ملفات
- `supabase/migrations/20261112000200_seller_customer_protection.sql` (واتضافت لـ `supabase/reset/01_install_schema.sql`)
- `workers/payments-worker.js` + اختبارات في `workers/tests/payments.test.mjs` (61/61)
- `console/seller-desk.js`، `console/supabase-console.js` (مسارات `/desk/status` و`/sellers/*`)، `admin-src/admin.js`، `console/admin-lang/en.json`
- `src/voucher.html`، `src/verify.html` (جديد)، `tools/build.mjs`، `shared/ds-site.js`

## التفعيل
1. شغّل الـ migration `20261112000200_seller_customer_protection.sql`.
2. أعد نشر Worker الدفع. لازم الإيميل شغّال (`RESEND_API_KEY` + `MAIL_FROM` أو SMTP) وإلا كود العميل مش هيتبعت وحجز السيلر مش هيكمّل. اختياري: `OTP_SECRET` (بيتاخد من `KASHIER_SECRET_KEY` لو مش موجود).
3. ابنِ وارفع **seller** و**admin** و**app/www** (صفحة `/verify/` والفاوتشر).
4. من تبويب "السيلرز": وثّق السيلرز الجداد، وفعّل العربون بس لمن تثق فيه.

## حدود لازم تعرفها
- العميل لسه ممكن يتنصب عليه لو أعطى السيلر الكود وهو غلطان في المبلغ، أو لو مفتحش الإيميل أصلاً. الكود بيعرض له المبلغ بالظبط علشان ده مايحصلش.
- المنصة مبتشوفش الكاش — الحماية قائمة على إن العميل نفسه يشوف المبلغ ويأكّده، وعلى البلاغات والحدود والمراجعة.

---
## نسخة مدموجة (2026-11-13)
دمج: حماية العملاء + مكتب السيلر (wizard 3 خطوات: date picker وعدّادات بالغين/أطفال) + إصلاحات: CSP لخدمة الدفع، إخفاء "Make owner" للسيلر، استبعاد السيلر من فلتر الأونرز، ترجمات إنجليزي للنصوص الجديدة.

### داشبوردز الكمبيوتر (2026-11-13)
- إزالة صورة الخلفية؛ خلفية سادة. وضع داكن (الأساسي) + وضع فاتح، زر تبديل في الشريط الجانبي، محفوظ في localStorage (`ds_console_theme`). الموبايل/التابلت لسه بشكل الـ app.

### تحديث الإعدادات (2026-11-13)
- بدون أي polling بالتايمر. المتصفح بيعيد فحص الإعدادات بس عند فتح صفحة أو رجوع التاب، وبحد أدنى: 10 ثواني مع النسخة الثابتة (R2/CDN)، دقيقتين مع الـ Worker/قاعدة البيانات. لو فيه تغيير بيتطبق بدون ريفرش.
- settings-worker رجع كاش 15/30/120 (قراءة GitHub مرة كل 30 ثانية لكل منطقة CDN مهما كان عدد الزوار).
- الأسرع والأرخص: ربط R2 (`MEDIA` + `MEDIA_BASE`) للنسخة الثابتة.

#### تفعيل التحديث خلال ثواني بدون ضغط على السيرفر (مرة واحدة)
1. Cloudflare R2: استخدم نفس الـ bucket بتاع الـ content worker، وفعّل له دومين عام (مثلًا media.discover-sharm.com).
2. في `wrangler.settings.toml`: فك تعليق `[[r2_buckets]] binding = "MEDIA"` وضبط `MEDIA_BASE = "https://media.discover-sharm.com"`، وأعد نشر settings-worker.
3. عند البناء: `DS_MEDIA_BASE=https://media.discover-sharm.com` ثم ارفع الـ app/www والأدمن.
4. احفظ أي إعداد من الأدمن مرة، وتأكد إن `…/settings/settings.json` و`…/settings/version.json` ظاهرين.
بعدها الزوار بيقروا ملفين ثابتين من الـ CDN (بدون Worker ولا قاعدة بيانات) والتغيير بيوصل خلال ~10-15 ثانية.

### أيقونات مميزة لكل داشبورد (2026-11-14)
- نفس لوجو Discover Sharm والخلفية الكحلي، مع إطار وشارة بلون الدور: Admin بنفسجي، Owner تركواز، Seller أخضر. المصدر: `tools/make-role-icons.py` → `shared/pwa-admin|owner|seller/` (أيقونة عادية + maskable + apple-touch + favicon).
- `tools/build.mjs` بينسخ أيقونات الدور فوق `shared/pwa` ويضيف `?v=<hash>` لكل روابط الأيقونات. تطبيق الزوار (Discover) لسه بالأيقونة الأصلية.
- على الموبايل: لازم تمسح تطبيق الداشبورد وتثبّته تاني عشان الأيقونة تتغير.

### تشخيص: الإعدادات مش بتوصل لـ R2 (2026-11-14)
- الأدمن بقى يعرض تنبيه بعد الحفظ لو R2 ما اتحدّثش (السبب بيظهر: binding ناقص / MEDIA_BASE ناقص / خطأ كتابة) أو لو الأدمن مبني من غير `DS_SETTINGS_BASE` (الحفظ بيروح للقاعدة بس).
- `/health` في settings-worker بيرجّع حالة الـ binding والـ MEDIA_BASE وتوكن GitHub.
- حفظ بدون تغيير بيعيد نشر النسخة الحالية على R2.

### الموقع مش بيسمع الإعدادات رغم إن R2 بيتحدّث (2026-11-14)
- `applySiteSettings` كان ناسي قسم الباقات (`SHOW_PACKAGES`) → اتصلّح.
- ملف `version.json` بقى يتطلب بـ `?t=<10s>` و `cache: no-cache` عشان أي Cache Rule في Cloudflare ما تجمّده.
- الموقع بيسجّل في الـ console مصدر الإعدادات: `[DS] settings loaded from media | worker | database`.
- لو الأقسام/اللغات اتغيّرت والتاب مفتوح: زرار "الموقع اتحدّث — اضغط للتحديث"؛ الإعلان والصيانة وبيانات التواصل بتتطبّق فورًا.
- الداشبوردات (admin/owner/seller) مبتقراش إعدادات الموقع أصلًا.

### الأقسام تظهر/تختفي حسب الإعدادات (2026-11-14)
- الموقع: `applySectionVisibility()` بتخفي (وترجّع) أي رابط/تايل/بلوك في الصفحة الرئيسية بيشاور على قسم مقفول: الدروار، الناف، الفوتر، "View all"، بطاقة المجلة، بانر التنقلات. بتشتغل عند التحميل وعند أي تغيير في الإعدادات.
- السيلر ديسك: `/desk/catalog` بيقرأ إعدادات الأقسام (من R2 نفسه) ويخفي الأنواع المقفولة (رحلات/باكدجات/انتقالات/فنادق).
- ملحوظة: ده فلتر واجهة؛ قاعدة البيانات لسه بتقبل حجز نوع مقفول لو اتبعتله طلب مباشر.

### منع حجز الأقسام المقفولة من السيرفر (2026-11-14)
- migration جديد: `20261114000100_sections_enforced.sql` — trigger على `bookings` بيرفض أي حجز جديد لقسم مقفول (الفنادق لازم تكون مفعّلة صراحة؛ الرحلات/الباكدجات/الانتقالات مفتوحة إلا لو اتقفلت). الحجوزات القديمة والمدفوعات ما بتتأثرش.
- settings-worker بيزامن `site_settings` في قاعدة البيانات مع كل حفظ (بتوكن السوبر أدمن). **لازم تحفظ الإعدادات مرة بعد النشر** عشان القاعدة تتزامن. لو المزامنة فشلت الأدمن بيظهر تنبيه.

### إعدادات إظهار/إخفاء لكل البلاطات والعناصر (2026-11-14)
- الأدمن ← إعدادات الموقع ← كارت جديد "البلاطات والعناصر": 33 مفتاح (الهيرو، بلاطات التصنيفات، كل بلوكات الصفحة الرئيسية، عناصر القوائم والهيدر، أجزاء الفوتر). بتتخزن في `settings.tiles` (`false` = مخفي) وبتظهر على الموقع فورًا بدون ريفرش (CSS على `html[data-ds-hide]`).
- الأقسام المقفولة (الرحلات/الترانسفير/المطاعم/الوجهات/المجلة/الباكدجات) بقت بتخفي كمان البلوكات والبلاطات بتاعتها في الصفحة الرئيسية، وكارت البحث لو مفيش حاجة تتبحث. الاختبار: صفر عناصر ظاهرة تخص قسم مقفول.
- اختبارات: `npm run test:tiles` (تطابق مفاتيح الأدمن والموقع).

### الموقع مفتوح للزوار + شاشات الحساب موحّدة (2026-11-14)
- شلت الإجبار على تسجيل الدخول عند أول زيارة (سكريبت `data-gate` في build.mjs وبوابة `showAuth` في الـ init). الزائر بيتصفح كل المحتوى، وتسجيل الدخول/إنشاء الحساب بيتطلب بس عند: الحجز والدفع (فنادق/رحلات/ترانسفير)، المفضلة، وصفحات حجوزاتي/الملف/الإشعارات. بعد الدخول بيكمل نفس العملية تلقائي (`auth.require` + `runPending`).
- شاشة الدخول بقت overlay فوق الصفحة وفيها زر "متابعة التصفح". فتح `/bookings/` كزائر بيظهر الشاشة، وإغلاقها بيرجع للرئيسية. تسجيل الخروج بيرجع للرئيسية كزائر.
- نسيت كلمة المرور، "راجع بريدك" بعد التسجيل/الاستعادة (مع إعادة إرسال كل 30 ثانية)، وشاشات روابط الإيميل (تأكيد، كلمة مرور جديدة، رابط منتهي، تغيير الإيميل): كلها بتظهر داخل نفس صفحة الدخول/التسجيل (نفس اللوحة والكارت والحقول). النصوص مترجمة للست لغات.

## Become a Partner redesign + Affiliate (seller) application
- `src/pages/partner.html`: reorganised into sections (why partner, how it works, 4 numbered form sections, seller call-to-action). Same form ids/logic.
- New page `/affiliate/` (`src/pages/affiliate.html`): for users with a normal account to apply as a seller. Guests see a log-in card; shows status (under review / approved / rejected with note); form prefilled from the profile.
- DB: `20261115000100_seller_applications.sql` — `seller_applications` table, `submit_seller_application`, `my_seller_application`, `admin_list_seller_applications`, `admin_decide_seller_application` (approve = is_seller + code + optional commission, notification to the user). **Run this migration.**
- Admin: new tab "طلبات السيلرز" (approve with optional commission / reject with note). Route `/api/admin/sellers/applications`.
- Site: `/api/seller-application` in supabase-api.js; footer link "Become a Seller". Texts: all 6 site languages.
- Not verified: the SQL migration (no Postgres here); icons (FontAwesome blocked in the test browser).

## Contracts + required documents
- Long file names no longer overflow the upload boxes (ellipsis, `minmax(0,1fr)` grid).
- Contract PDFs (en + ar) for partners and sellers in `shared/contracts/` (generated by `node tools/make-contracts.mjs`, copied to `/contracts/` in every site build). The forms link to the right language; the signed copy is uploaded with the application.
- Seller application now requires an ID / passport photo (back optional) and the signed agreement; partner application requires the owner/manager ID and the signed agreement. Enforced in the database too (`20261115000200_application_documents.sql` — **run it after 20261115000100**).
- Images are shrunk in the browser (max 1600px JPEG) before upload; PDFs max 1.5 MB.
- Admin: seller applications show the uploaded documents (download links), like partner applications.
- The contract wording is a standard template — have a lawyer review it before use.

## Logout fix
- Log-out waited for nothing: the page navigated away before Supabase revoked the session, so the stored (cookie) session logged the user straight back in. `auth.logout()` now waits (max 2.5 s) for sign-out, then clears the shared cookie session and local copies.

## Journal article components
- `shared/style.css`: `.article-body .ab-*` components (chips, stats, cards, swipe cards, spots, tips, links, video) that follow the site theme and accent on app + www.
- `docs/articles/best-snorkeling-spots-sharm.html`: the snorkeling article converted to them (paste into the admin article content field).

## Home: latest articles
- Home shows the 2 latest articles; "Show more" reveals 2 more each tap; "View All" (section header) opens the full journal page.

## Home: emergency numbers
- New block above reviews: 4 tap-to-call cards (Ambulance 123, Police 122, Fire 180, Tourist police 126). Can be hidden from admin settings (tile `home-emergency`). 6 languages.

## Admin journal: hand-written posts
- Posts added by hand to `journal/journal.json` (no own file) now appear in the admin journal list as published. Opening/saving one creates its normal item file; unpublish/delete work. **Redeploy the content Worker (workers/content-worker.js).** Test added in content.test.mjs.

## Currency exchange page
- New page `/exchange/` (live converter with swap, 20 currencies, popular-rate tiles against EGP, disclaimer), same rates source/cache as the price currency switcher. Footer links (desktop 'Company' column + mobile links). 6 languages.

## Site icons — new brand icon set
- 142 custom icons (solid, rounded, knocked-out details, brand orange gradient) replace the Font Awesome look everywhere on the site without touching the markup: `tools/icons/set.mjs` (drawings) → `tools/make-icons.mjs` → `shared/icons.css` (generated on every build, linked on all pages).
- Icons on orange buttons/circles switch to white or dark ink automatically (detected from style.css); icons with their own colour class (text-white/gold/red/green…) stay flat; emergency cards keep their own colours.
- Icons that are not in the set (e.g. an unusual icon chosen for a content item in the admin) still fall back to Font Awesome. To add an icon: add a drawing in `tools/icons/set.mjs`.

## Icons: dark/light + bottom bar + white on orange
- Icon gradient now has a light-mode variant (deeper orange) and a dark-mode one.
- Bottom-nav icons are neutral grey by default (theme-aware); the orange gradient shows only on the active page or while pressed.
- Every icon on an orange/gold surface is now always white (the dark-ink variant was removed).
- Hero search tabs: active tab icon shows the brand gradient, inactive tab icon follows text colour (dark in light mode).
- Footer: payment icons use real Visa/Mastercard marks (own colours) with flat wallet/cash icons; social icons show their brand colours (they were white-on-grey before).
