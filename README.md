# Discover Sharm — تلات مواقع من مشروع واحد

```
www.discover-sharm.com    ← الكمبيوتر والشاشات الكبيرة      (dist/www)
app.discover-sharm.com    ← الموبايل والتابلت، تصميم تطبيق   (dist/app)
admin.discover-sharm.com  ← السوبر أدمن + لوحات الأونرز      (dist/admin)
```

التلات بيتبنوا من نفس الكود (`npm run build`) وبيتشاركوا نفس قاعدة بيانات Supabase ونفس Worker الدفع، فهم **نظام واحد** حتى لو كل موقع على دومين لوحده.

## إيه اللي بيربطهم ببعض

| الحاجة | بتتم إزاي |
|---|---|
| **توجيه تلقائي حسب الجهاز** | `shared/ds-site.js`: لو حد فتح www من موبايل/تابلت يتحوّل لنفس الصفحة على app، والعكس للكمبيوتر. المسار والـ query بيتحفظوا. محركات البحث (Googlebot…) مش بتتحوّل. |
| **تسجيل دخول واحد** (www ⇄ app) | `shared/ds-bridge.js`: جلسة Supabase متخزنة في كوكيز على `.discover-sharm.com` (متقسمة لأجزاء). تدخل من موقع تلاقيك داخل في التاني. |
| **اللغة / الثيم / العملة / "كمّل كضيف"** | نفس الـ bridge بينقلهم بين www و app. |
| **كانونيكال / SEO** | صفحات app فيها `canonical` لنظيرتها على www، وصفحات www فيها `rel=alternate` للموبايل (الإعداد اللي Google بيوصي بيه للـ URLs المنفصلة). الـ sitemap على www بس. |
| **الأدمن معزول عن قصد** | `admin` مابيحمّلش الـ bridge ومابيشاركش كوكيز مع الموقعين العامين: جلسة الموظفين مش بتتعرّض لأي XSS محتمل في الموقع العام. |

اختيار يدوي: `?view=www` أو `?view=app` في أي رابط بيثبّت الاختيار سنة (كوكي `ds_view`). مفيد لو حد عايز نسخة الكمبيوتر من الموبايل.

## المحتوى الثابت والبحث والتصميم
- **JSON ثابت:** الوجهات والمقالات وتقييمات الصفحة الرئيسية والشرائح من `shared/data/*.json` (عدّلي ثم build + push). الباقي (فنادق/رحلات/ترانسفير/مطاعم/حجوزات) من Supabase.
- **كارت البحث** رجع في الصفحة الرئيسية: تابات فنادق / رحلات / ترانسفير على حسب الأقسام المفعّلة في `site.config.json`.
- **الأدمن والأونرز:** دارك مود فقط (Admin V7) بكروت غامقة. الشعار من `LOGO` في أول `console/console.js`.

## الفرق بين www و app

- **www**: نفس الصفحات بتصميم الديسكتوب، من غير شريط التنقل السفلي ولا السبلاش.
- **app**: تصميم التطبيق على كل المقاسات (شريط سفلي + هيدر التطبيق + سبلاش). الـ build بيطفّي قواعد CSS الخاصة بالديسكتوب (≥1024px) للموقع ده، فالتابلت في الوضع الأفقي بياخد تصميم التطبيق (متسنتر لحد 860px).
- **admin**: `/` = السوبر أدمن، `/owner/` = اختيار لوحة الأونر (`/owner/ex.html` رحلات، `/owner/hotel.html` فنادق، `/owner/transfer.html` انتقالات). noindex كامل + headers أمان.

الروابط القديمة `/admin` و `/owner/*` على www/app بتتحوّل 301 للأدمن الجديد (ملف `_redirects`).

## الأوامر

```bash
npm run build            # التلات مواقع  → dist/www  dist/app  dist/admin
npm run build:www        # واحد بس (build:app / build:admin)
npm run dev:www          # http://localhost:8081   (dev:app → 8082 ، dev:admin → 8083)
npm run test:payments    # 37 فحص لـ Worker الدفع
```

محتاج Node 18+ ومفيش dependencies. **شغّل `npm run build` بعد أي تعديل** في `src/` أو `shared/` أو `console/` أو `site.config.json`.

## هيكل المصدر

```
site.config.json     دومينات المواقع + الصفحات + أي قسم شغال/مقفول + مفاتيح Supabase العامة
src/                 صفحات وأجزاء HTML المشتركة بين www و app
shared/              CSS/JS المشترك + ds-bridge.js + ds-site.js + site-www.css + site-app.css
console/  admin-src/ كود الأدمن واللوحات (بيتبني في dist/admin)
supabase/  workers/  قاعدة البيانات (migrations + RLS) و Worker الدفع
dist/                الناتج الجاهز — كل فولدر يترفع لوحده
```

| عايز… | اعمل |
|---|---|
| تقفل/تفتح قسم (فنادق، مطاعم…) | `site.config.json` → `show` ثم build |
| تغيّر محتوى صفحة | `src/pages/<name>.html` ثم build |
| تغيّر الهيدر/المنيو/المودالز | `src/partials/chrome.html` / `bottom-nav.html` ثم build |
| تغيّر شكل الديسكتوب فقط | `shared/site-www.css` |
| تغيّر شكل التطبيق فقط | `shared/site-app.css` |
| تغيّر الدومينات | `site.config.json` → `sites` |

التشغيل بالتفصيل: **`DEPLOY.md`**. قاعدة البيانات: `supabase/README.md`.
