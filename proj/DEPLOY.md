# خطوات التشغيل — التلات مواقع

> التوصية: **Cloudflare Pages** لكل موقع (بتدعم `_headers` و `_redirects` اللي الـ build بيطلّعهم). GitHub Pages شغّال كمان (فيه `CNAME`) بس مابيقرأش الـ headers ولا الـ redirects.

## 1) قاعدة البيانات و Worker الدفع (مرة واحدة)
نفس الخطوات القديمة: الـ 7 migrations → `seed.sql` → `tests/rls_tests.sql` → أول سوبر أدمن → `supabase functions deploy admin-create-user` → نشر `workers/payments-worker.js` على `pay.discover-sharm.com`.

## 2) إعدادات Supabase الجديدة بسبب التقسيم ⚠️
1. **Authentication → URL Configuration**
   - Site URL: `https://www.discover-sharm.com`
   - Redirect URLs (التلاتة): `https://www.discover-sharm.com/**` ، `https://app.discover-sharm.com/**` ، `https://admin.discover-sharm.com/**`
2. **Google Sign-In** (Google Cloud Console → OAuth client): ضيف في *Authorized JavaScript origins* الدومينين `https://www.discover-sharm.com` و `https://app.discover-sharm.com`.
3. **Worker الدفع**: `ALLOWED_ORIGINS` فيه www و app بالفعل. الأدمن مابيكلّمش الـ Worker، فمتضيفوش.
4. `workers/wrangler.payments.toml` → `SITE_URL` (رابط الفاوتشر في الإيميل) سيبه `https://app.discover-sharm.com` أو غيّره لـ www — صفحة `/voucher/` موجودة على الاتنين ومابتتحوّلش.

> **قائمة كل المتغيرات (Pages و Workers) في ملف `VARIABLES.md`** — الأفضل تبدأ منه.

## المتغيرات على Cloudflare Pages (بدل site.config.json)
Workers & Pages ← المشروع ← **Settings ← Variables and Secrets ← Add** (للـ Production، وللـ Preview لو بتستخدمه). بعد أي تغيير اعمل **Retry deployment** عشان الـ build ياخدها.

| المتغير | www | app | admin | القيمة |
|---|:-:|:-:|:-:|---|
| `DS_SUPABASE_URL` | ✅ | ✅ | ✅ | Project URL من Supabase |
| `DS_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ | anon public key |
| `DS_GOOGLE_CLIENT_ID` | ✅ | ✅ | | Google OAuth Client ID |
| `DS_PAYMENTS_BASE` | ✅ | ✅ | | رابط Worker الدفع (بدون `/` في الآخر) |
| `DS_TRANSLATE_BASE` | | | ✅ | رابط Worker الترجمة |

- **لازم الـ build يتعمل على Cloudflare** (Build command `npm run build:www` / `:app` / `:admin` والـ output `dist/www` / `dist/app` / `dist/admin`)، لأن المتغيرات بتتحقن وقت الـ build. فولدر `dist` مش في الـ repo (`.gitignore`) — ماترفعيهوش.
- الـ build بيطبع تحذير أصفر لو متغير ناقص (مثلًا الدفع أو جوجل أو الترجمة)، وده في Build log بتاع Cloudflare.
- محليًا (VS Code): انسخ `.env.example` لـ `.env` وامل القيم، وبعدين `npm run build`. الملف ده في `.gitignore` ومش بيترفع.
- القيم دي (anon key وغيرها) بتبان في كود المتصفح لأي حد بالضرورة؛ أما `service_role` ومفاتيح Kashier فبتتحط **أسرار في الـ Workers بس** (`wrangler secret put`)، ماتحطيهاش هنا أبدًا.

## 3) الإعدادات والـ build
**مفيش أي مفتاح أو رابط بيتكتب في الكود.** كل الإعدادات متغيرات بيئة على Cloudflare Pages (القسم الجاي).
> لازم Supabase يكون مفعّل: التلات مواقع على دومينات مختلفة، فالـ API القديم (`/api/*` على نفس الدومين) مابقاش متاح. (`apiBase` في الإعدادات لو لسه محتاجة Worker قديم على دومين تاني، للموقعين العامين بس.)

```bash
npm run build
```

## 4) النشر — ثلاث مشاريع منفصلة
| المشروع | فولدر الرفع | الدومين |
|---|---|---|
| discover-sharm-www   | `dist/www`   | `www.discover-sharm.com` (وحوّل الـ apex `discover-sharm.com` → www) |
| discover-sharm-app   | `dist/app`   | `app.discover-sharm.com` |
| discover-sharm-admin | `dist/admin` | `admin.discover-sharm.com` |

Cloudflare Pages: Create project → Direct Upload (أو GitHub مع Build command `npm run build` و Output directory `dist/www` / `dist/app` / `dist/admin`).

**مهم:** الكوكيز المشتركة مضبوطة على `.discover-sharm.com`، فالموقعين العامين لازم يبقوا تحت نفس الدومين الأب (وهما كده). على `localhost` الكوكيز بتشتغل لكل منفذ لوحده — عادي للتجربة.

**اختياري موصى بيه للأدمن:** Cloudflare Zero Trust → Access، سياسة على `admin.discover-sharm.com` (إيميلات الفريق بس) — طبقة حماية قبل شاشة تسجيل الدخول نفسها.

## 🔒 HTTPS والـ Security headers (توصيات فحص الأمان)
الـ build بيكتب في `_headers` لكل موقع: `Strict-Transport-Security` (سنة) و `Content-Security-Policy` (`script-src` و `object-src 'none'` و `base-uri 'self'` و `frame-src`...). الـ CSP بتتبني تلقائي من متغيرات `DS_SUPABASE_URL` و `DS_PAYMENTS_BASE` و `DS_TRANSLATE_BASE`، فأي Worker جديد تضيفه اتأكد إنه مضاف هناك (دالة `csp()` في `tools/build.mjs`).

**تحويل HTTP → HTTPS (من لوحة Cloudflare، مش من الكود):** اختار دومين `discover-sharm.com` ← **SSL/TLS ← Edge Certificates ← Always Use HTTPS = On**. كمان تأكد إن **SSL/TLS ← Overview** على *Full (strict)*. ده بيغطي www و app و admin والـ apex مرة واحدة (الـ `_redirects` ما بيعرفش يفرّق http من https). فيه كمان سكريبت صغير في أول `<head>` بيحوّل لـ https لو الصفحة اتفتحت على http (احتياطي).
لو الموقع على GitHub Pages: Settings ← Pages ← **Enforce HTTPS**.

> الـ CSP فيها `'unsafe-inline'` في `script-src` لأن الصفحات لسه فيها `onclick=""` وسكريبتات inline. دي بتغطي توصيات الفحص (script-src/object-src/base-uri/frame-src موجودين) بس الحماية من XSS الكاملة محتاجة نقل الـ inline handlers لملفات `.js` وبعدين شيل `'unsafe-inline'`.
> بعد النشر: افتح الموقع وجرّب (تسجيل دخول Google، حجز، دفع بكارت 3DS، صور، خرايط) والـ Console لازم يبقى من غير أخطاء `Refused to ...`. لو ظهر خطأ، الرسالة بتقول أنهي دومين ناقص وتضيفه في `csp()`.

## 🗂️ المحتوى في GitHub برايفت (فنادق · رحلات · ترانسفير · مطاعم · تدوينات)

**الفكرة:** كل عنصر ملف `api/<الفئة>/{id}.json` في **ريبو برايفت منفصل للداتا**، وكل فئة ليها ملف فهرس (`api/hotels/hotels.json` …) فيه **المنشور بس** — الموقع بيقرا منه. الداتا بيس بيحتفظ بـ id العنصر و id المالك والحالة وحقول السعر اللي الحجز بيتحقق منها. التوكن مخزّن كـ Secret في Cloudflare وبيستخدمه Worker واحد (`discover-sharm-content`) — المتصفح عمره ما بيشوفه.

```
api/hotels/{id}.json         العنصر   { id, ownerId, published:false|true, ...الحقول }
api/hotels/{id}.draft.json   تعديل الأونر على عنصر منشور (مستني موافقتك)
api/hotels/hotels.json       الفهرس العام: { updatedAt, items:[المنشور بس] }
api/hotels/img/{hash}.jpg    الصور
(نفس الشكل: excursions · transfers · restaurants · journal)
```
- **أونر/أدمن يضيف عنصر** ← الملف بيتكتب بـ `published:false` ومش بيظهر في الفهرس.
- **السوبر أدمن يضغط "نشر"** (أو يختار "منشور" ويحفظ) ← `published:true` + العنصر بيتضاف للفهرس + حالته في الداتا بيس `published` + نسخة السعر في الداتا بيس بتتحدّث.
- **أونر يعدّل عنصر منشور** ← بيتحفظ كـ `{id}.draft.json` والنسخة المنشورة والسعر **ما بيتغيروش** لحد ما الأدمن يضغط **اعتماد التعديل**.
- كل تغيير بيتسجّل كـ commit في ريبو الداتا باسم/ID صاحبه = سجل مراجعة مجاني.

### خطوات التفعيل (مرة واحدة، بالترتيب)
1. **ريبو الداتا:** أنشئ ريبو **Private** جديد (مثلًا `discover-sharm-data`) فيه branch `main`. (مش نفس ريبو الكود، عشان كل commit نشر ما يشغّلش builds للمواقع.)
2. **Token:** GitHub ← Settings ← Developer settings ← *Fine-grained personal access tokens* ← Repository access = **ريبو الداتا بس** ← Contents = **Read and write**.
3. **Supabase:** شغّل في SQL Editor: `20261022001100_github_content.sql`. (بعد التانية المتصفح مابقاش يقدر يكتب في جدول `properties` — الكتابة من الـ Worker بس.)
4. **انقل الداتا الحالية:**
   ```bash
   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run export:content -- api-export
   ```
   انسخ فولدر `api-export/api` لريبو الداتا واعمل commit + push.
   الأمر بيصدّر كمان التدوينات والوجهات (من `shared/data`) وكل إعدادات الموقع واللغات لـ `api/settings/settings.json`. التدوينات والوجهات للسوبر أدمن بس وبتتحفظ في GitHub فقط (مفيش صف ليها في الداتا بيس).
5. **انشر الـ Worker:** `cd workers && npx wrangler secret put GITHUB_TOKEN -c wrangler.content.toml` و `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY -c wrangler.content.toml` ثم `npx wrangler deploy -c wrangler.content.toml`، وظبط المتغيرات (جدول "Worker المحتوى" في `VARIABLES.md`) وأضف الدومين `content.discover-sharm.com`.
6. **متغير Pages:** `DS_CONTENT_BASE=https://content.discover-sharm.com` في مشاريع www و app و admin ← **Retry deployment**.
6b. **settings-worker (إعدادات الموقع):** الإعدادات كلها في `api/settings/settings.json` ومحدش يوصلها غير عن طريقه.
   ```bash
   cd workers
   npx wrangler secret put GITHUB_TOKEN -c wrangler.settings.toml
   npx wrangler deploy -c wrangler.settings.toml
   ```
   ظبط `SUPABASE_URL` و `SUPABASE_ANON_KEY` و `GITHUB_REPO` و `GITHUB_BRANCH` و `ALLOWED_ORIGINS`، وأضف الدومين `settings.discover-sharm.com`، وحط `DS_SETTINGS_BASE=https://settings.discover-sharm.com` في مشاريع www و app و admin ← **Retry deployment**. (الكتابة للسوبر أدمن بس، بيتحقق منه بـ `is_super_admin()` بتوكن المستخدم نفسه من غير service key.)
7. **جرّب:** افتح `https://content.discover-sharm.com/catalog/hotels.json` (لازم يرجّع الفنادق) ← ادخل الأدمن وأضف فندق (لازم يظهر ملف `{id}.json` في الريبو بـ `published:false`) ← انشره ← يظهر في `hotels.json` وعلى الموقع (خلال ~دقيقة بسبب الـ cache).

> **أمان الانتقال:** لحد ما تنقل الداتا (خطوة 4) الـ Worker بيرجّع نسخة الداتا بيس تلقائيًا (`"fallback": true`) فالموقع مش بيفضى. ولحد ما تضبط `DS_CONTENT_BASE` كل حاجة شغالة زي الأول.
> **التدوينات:** السوبر أدمن بيضيفها من تبويب "التدوينات" في الأدمن. الأونر يقدر يضيف تدوينة لو أضفتي `journal` لصلاحياته (`profiles.owner_kinds`)، بس لسه مفيش صفحة تدوينات في لوحة الأونر.
> **حدود:** الصور المرفوعة قبل كده فضلت على Supabase Storage (روابطها بتشتغل). الصور الجديدة بتتحفظ في `api/<الفئة>/img/` وبتتقدّم عن طريق الـ Worker (حد أقصى 900KB للصورة بعد الضغط).

## 5) تجربة قبل الإطلاق (10 دقايق)
1. من الموبايل افتح `www.discover-sharm.com/excursions/` → لازم يتحوّل لـ `app.discover-sharm.com/excursions/`.
2. من الكمبيوتر افتح `app.discover-sharm.com` → يتحوّل لـ www.
3. سجّل دخول على app، وبعدين افتح `?view=www` من نفس الجهاز → لازم تلاقي نفسك داخل من غير ما تسجّل تاني، واللغة/الثيم زي ما هما.
4. احجز رحلة بكارت اختبار على app → تظهر في "حجوزاتي" على www.
5. `admin.discover-sharm.com` → سوبر أدمن → أنشئ أونر → سجّل دخوله من `/owner/ex.html`.
6. `www.discover-sharm.com/admin` → لازم يحوّل لـ admin.

## الرجوع للنظام القديم
مش بنفس البساطة زي قبل لأن المواقع اتفصلت؛ الـ Workers القديمة لسه في `legacy/` للتوثيق. احتفظ بنسخة المشروع الأصلي (`public-main-fixed.zip`) لحد ما تتأكد إن كل حاجة ماشية.


---

## المحتوى الثابت (JSON) — الوجهات والمقالات والتقييمات
`destinations.json` و `articles.json` و `reviews.json` (تقييمات الصفحة الرئيسية) و `promoSlides.json` بقوا ملفات ثابتة في **`shared/data/`**، مش في Supabase.
للتعديل: افتح الملف في VS Code ← عدّل ← `npm run build` ← `git push`. رقم نسخة تلقائي (`DS_DATA_V`) بيتغيّر مع كل تعديل فالمتصفحات بتجيب الجديد على طول.
اتشالوا من لوحة الأدمن: تابات الوجهات/المقالات/التقييمات/الشرائح وصفحة "الملفات". اللي لسه في Supabase: الفنادق والرحلات والترانسفير والمطاعم (محتاجة أسعار وحجوزات وأونرز) وتقييمات العملاء على كل عنصر.

## `DS_PAYMENTS_BASE` / `paymentsBase` — منين أجيبه؟
هو **رابط الـ Worker بتاع الدفع** بعد ما تنشره على Cloudflare (مش حاجة بتتولّد من Supabase):
```bash
cd workers
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY -c wrangler.payments.toml     # + KASHIER_API_KEY و KASHIER_SECRET_KEY (و RESEND_API_KEY اختياري)
npx wrangler deploy -c wrangler.payments.toml
```
1. **أسرع حاجة:** في آخر الأمر wrangler بيطبع الرابط، شكله `https://discover-sharm-payments.<حسابك>.workers.dev` ← ده هو `paymentsBase` (بدون `/` في الآخر).
2. **الأحسن للإنتاج:** Cloudflare → Workers & Pages ← `discover-sharm-payments` ← Settings ← Domains & Routes ← Add ← Custom domain: `pay.discover-sharm.com`. وقتها `paymentsBase` = `https://pay.discover-sharm.com`.
3. حطّه كمتغير `DS_PAYMENTS_BASE` في مشروعي Cloudflare Pages بتوع www و app (الأدمن مش محتاجه) — بدون `/` في الآخر.
4. تأكد إن `SUPABASE_URL` و `SUPABASE_ANON_KEY` و `KASHIER_*` متظبطين في `[vars]` بتاع `wrangler.payments.toml`، وإن `ALLOWED_ORIGINS` فيه www و app.
5. اختبار: افتح `<paymentsBase>/health` (أو أي endpoint عام موجود في الـ Worker) — لو رجّع رد يبقى شغال.


---

## الترجمة التلقائية (إدخال بلغة واحدة)
الأونر/الأدمن بيكتب بالعربي **أو** الإنجليزي (بيختار من فوق في صفحة الإضافة)، وعند الحفظ بيتترجم كل النص (الأسماء، الأوصاف، المميزات، برنامج اليوم، الغرف…) لباقي اللغات: AR / EN / RU / DE / IT / TR، بما فيهم اللغة التانية من العربي/الإنجليزي.
- التعديل بيترجم **اللي اتغيّر بس**؛ النص اللي ما اتغيّرش وترجمته موجودة بيتسايب زي ما هو.
- لو الترجمة فشلت بيسأل: تحفظ بلغتك الأصلية بس؟ (والموقع بيرجع للعربي/الإنجليزي للغات الناقصة).

### التفعيل (مرة واحدة) — Worker على Cloudflare Workers AI (من غير مفاتيح)
```bash
cd workers
# افتح wrangler.translate.toml وحط SUPABASE_URL و SUPABASE_ANON_KEY (نفس بتوع الدفع)
npx wrangler deploy -c wrangler.translate.toml
```
1. أول ما ينشر هيطبع رابط `https://discover-sharm-translate.<حسابك>.workers.dev` (أو اربطه بدومين `translate.discover-sharm.com` من Cloudflare).
2. حطه كمتغير `DS_TRANSLATE_BASE` في مشروع الأدمن على Cloudflare Pages، ثم Redeploy.
3. `ALLOWED_ORIGINS` في الـ toml لازم يبقى `https://admin.discover-sharm.com`.
4. الـ Worker مقفول على الموظفين بس (سوبر أدمن أو أونر)، مش مترجم عام. اختبار: `npm run test:translate`.
> Workers AI عنده حصة مجانية يومية؛ راجع تسعير Cloudflare لو الاستخدام كبير. جودة الترجمة الآلية كويسة للأوصاف العامة لكن راجع الأسماء المهمة بنفسك.

### لو الترجمة رجّعت خطأ CORS أو 401 في الـ Console
1. **CORS** (`No 'Access-Control-Allow-Origin'`): أعيد نشر الـ Worker (`npx wrangler deploy -c wrangler.translate.toml`) بالنسخة الجديدة، وتأكد إن `ALLOWED_ORIGINS` في Cloudflare ← Worker ← Settings ← Variables = `https://admin.discover-sharm.com` (من غير `/` في الآخر). لو متغيّر في الداشبورد بقيمة فاضية أو غلط هيغطّي على الـ toml.
2. **401 Not allowed**: `SUPABASE_URL` / `SUPABASE_ANON_KEY` في الـ Worker لسه placeholders، أو الحساب مش سوبر أدمن/أونر.
3. اختبار سريع من الترمنال:
```bash
curl -i -X OPTIONS https://translate.discover-sharm.com/translate -H "Origin: https://admin.discover-sharm.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type"
```
المفروض يرجّع `204` وفيه `access-control-allow-origin: https://admin.discover-sharm.com`. لو رجّع صفحة Cloudflare أو 404 يبقى الدومين مش مربوط بالـ Worker ده.

### 401 Not allowed — إزاي أعرف السبب
الرسالة دلوقتي فيها كود السبب بين أقواس، مثلًا `Not allowed [worker_supabase_vars_missing]`:
| الكود | المعنى والحل |
|---|---|
| `worker_supabase_vars_missing` | `SUPABASE_URL` / `SUPABASE_ANON_KEY` في الـ Worker فاضيين أو لسه `YOUR-PROJECT`. اكتبهم في `wrangler.translate.toml` (أو Cloudflare ← Worker ← Settings ← Variables) وأعيد النشر. |
| `token_rejected_check_anon_key_and_project` | الـ anon key أو الـ URL في الـ Worker من مشروع Supabase غير اللي الأدمن بيسجل دخول منه. لازم نفس قيم `DS_SUPABASE_URL` / `DS_SUPABASE_ANON_KEY`. |
| `account_is_not_staff_or_inactive` | الحساب مش سوبر أدمن أو أونر، أو متوقف (`is_active = false`). |
| `rpc_failed_404` | الـ migrations ما اتطبقتش (دوال `is_super_admin` / `is_owner` مش موجودة). |


---

## v18 — المطاعم والكافيهات، الفروع، QR، وإعدادات الموقع (بدل سجل العمليات)

### 1) خطوات التفعيل (بالترتيب)
1. **Supabase ← SQL Editor** (أو `supabase db push`): شغّل الملف الجديد `supabase/migrations/20261017000800_restaurants_site_settings.sql`. هو بيعمل: جدول الفروع `restaurant_branches` (بموافقة السوبر أدمن)، `site_settings`، `ui_languages`، **ويمسح جدول `audit_log` نهائيًا** (دالة `audit()` بقت فاضية بدون تخزين).
2. أعيد نشر الـ Edge Function (اتشال منها كتابة سجل العمليات): `npx supabase functions deploy admin-create-user`.
3. أعيد نشر **Worker الترجمة** (بقى بيقبل أي لغة ISO مش 6 بس): `cd workers && npx wrangler deploy -c wrangler.translate.toml`.
4. `git push` وانتظر بناء Cloudflare Pages للتلات مشاريع (Retry deployment).

### 2) أونر مطعم / كافيه
- السوبر أدمن ← **الأونرز** ← إضافة أونر بدور **مالك مطعم / كافيه** (كل مطعم بيتربط بأونر من صفحة المطعم نفسها: خانة "المالك").
- الأونر بيدخل من `admin.discover-sharm.com/owner/restaurant.html` (اتضافت في صفحة اختيار اللوحات).
- لوحته: **مطاعمي** (صفحة إضافة/تعديل كاملة: النوع مطعم/كافيه، مستوى الأسعار، الصور، **منيو بالأقسام والأصناف**، الموقع والخريطة، مواعيد العمل) — بنفس نظام الإدخال بلغة واحدة والترجمة التلقائية.
- **الفروع**: الأونر بيضيف أكتر من فرع (حد أقصى 30 للمطعم). كل فرع جديد أو معدّل بيروح **بانتظار الموافقة**، والسوبر أدمن بيعتمده أو يرفضه (بسبب) من **فروع المطاعم**. الفروع المعتمدة بس بتظهر للعملاء في صفحة المطعم.
- **QR Code**: لكل مطعم ولكل فرع معتمد — معاينة، لون، تحميل PNG/SVG، وطباعة **بوستر A4** أو **كارت ترابيزة A6**. الـ QR بيفتح صفحة المطعم (والفرع بيتمرّر بـ `?branch=` وبيتعلّم في الصفحة). الرابط الأساسي `https://app.discover-sharm.com` وبيتعدّل من نفس الشاشة.
- الشركاء الجداد: خانة **مطعم / كافيه** اتضافت في نموذج "كن شريكًا"، واعتماد الطلب بيعمل حساب `restaurants_owner`.

### 3) إعدادات الموقع (مكان سجل العمليات)
السوبر أدمن ← **إعدادات الموقع**: بتتطبق على www و app خلال ثواني (الموقع بيقراها كل مرة ويخزّن آخر نسخة):
- **الأقسام**: تفعيل/إلغاء الفنادق والرحلات والترانسفير والمطاعم والوجهات والمجلة. (كل صفحات الأقسام بتتبني دايمًا، و`show` في `site.config.json` بقى مجرد الإعداد الافتراضي.)
- **اللغات**: تفعيل/تعطيل أي لغة، اللغة الافتراضية، و**إضافة لغة جديدة** (مثلًا fr): بتتترجم واجهة الموقع كلها (~500 نص) تلقائيًا وتتخزن في قاعدة البيانات، وأي محتوى جديد (رحلات/فنادق/مطاعم) بيتترجم ليها عند الحفظ. راجع الترجمة بنفسك بعدها.
- **شريط إعلان** أعلى الموقع (نص بلغة واحدة ويتترجم، رابط، لون).
- **وضع الصيانة** (للمعاينة كموظفة: `?preview=1` في أي رابط).
- **التواصل والسوشيال**: تليفون، واتساب، إيميل، فيسبوك، إنستجرام، تيك توك، يوتيوب — بتظهر في الفوتر وصفحة "تواصل معنا".
- **صيانة البيانات**: أزرار تنظيف جلسات الدفع غير المكتملة وإعادة ربط الحجوزات (كانوا في صفحة السجل).
> الإعدادات بتتخزن في جدول `site_settings` وهو **قراءة عامة**: ماتكتبيش فيه أي سر.
