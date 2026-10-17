# خطوات التشغيل — التلات مواقع

> التوصية: **Cloudflare Pages** لكل موقع (بتدعم `_headers` و `_redirects` اللي الـ build بيطلّعهم). GitHub Pages شغّال كمان (فيه `CNAME`) بس مابيقرأش الـ headers ولا الـ redirects.

## 1) قاعدة البيانات و Worker الدفع (مرة واحدة)
نفس الخطوات القديمة: الـ 7 migrations → `seed.sql` → `tests/rls_tests.sql` → أول سوبر أدمن → `supabase functions deploy admin-create-user` → نشر `workers/payments-worker.js` على `pay.discover-sharm.com`.

## 2) إعدادات Supabase الجديدة بسبب التقسيم ⚠️
1. **Authentication → URL Configuration**
   - Site URL: `https://www.discover-sharm.com`
   - Redirect URLs (التلاتة): `https://www.discover-sharm.com/**` ، `https://app.discover-sharm.com/**` ، `https://admin.discover-sharm.com/**`
2. **Google Sign-In** (Google Cloud Console → OAuth client): ضيفي في *Authorized JavaScript origins* الدومينين `https://www.discover-sharm.com` و `https://app.discover-sharm.com`.
3. **Worker الدفع**: `ALLOWED_ORIGINS` فيه www و app بالفعل. الأدمن مابيكلّمش الـ Worker، فمتضيفوش.
4. `workers/wrangler.payments.toml` → `SITE_URL` (رابط الفاوتشر في الإيميل) سيبيه `https://app.discover-sharm.com` أو غيّريه لـ www — صفحة `/voucher/` موجودة على الاتنين ومابتتحوّلش.

## المتغيرات على Cloudflare Pages (بدل site.config.json)
Workers & Pages ← المشروع ← **Settings ← Variables and Secrets ← Add** (للـ Production، وللـ Preview لو بتستخدميه). بعد أي تغيير اعملي **Retry deployment** عشان الـ build ياخدها.

| المتغير | www | app | admin | القيمة |
|---|:-:|:-:|:-:|---|
| `DS_SUPABASE_URL` | ✅ | ✅ | ✅ | Project URL من Supabase |
| `DS_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ | anon public key |
| `DS_GOOGLE_CLIENT_ID` | ✅ | ✅ | | Google OAuth Client ID |
| `DS_PAYMENTS_BASE` | ✅ | ✅ | | رابط Worker الدفع (بدون `/` في الآخر) |
| `DS_TRANSLATE_BASE` | | | ✅ | رابط Worker الترجمة |

- **لازم الـ build يتعمل على Cloudflare** (Build command `npm run build:www` / `:app` / `:admin` والـ output `dist/www` / `dist/app` / `dist/admin`)، لأن المتغيرات بتتحقن وقت الـ build. فولدر `dist` مش في الـ repo (`.gitignore`) — ماترفعيهوش.
- الـ build بيطبع تحذير أصفر لو متغير ناقص (مثلًا الدفع أو جوجل أو الترجمة)، وده في Build log بتاع Cloudflare.
- محليًا (VS Code): انسخي `.env.example` لـ `.env` واملي القيم، وبعدين `npm run build`. الملف ده في `.gitignore` ومش بيترفع.
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
| discover-sharm-www   | `dist/www`   | `www.discover-sharm.com` (وحوّلي الـ apex `discover-sharm.com` → www) |
| discover-sharm-app   | `dist/app`   | `app.discover-sharm.com` |
| discover-sharm-admin | `dist/admin` | `admin.discover-sharm.com` |

Cloudflare Pages: Create project → Direct Upload (أو GitHub مع Build command `npm run build` و Output directory `dist/www` / `dist/app` / `dist/admin`).

**مهم:** الكوكيز المشتركة مضبوطة على `.discover-sharm.com`، فالموقعين العامين لازم يبقوا تحت نفس الدومين الأب (وهما كده). على `localhost` الكوكيز بتشتغل لكل منفذ لوحده — عادي للتجربة.

**اختياري موصى بيه للأدمن:** Cloudflare Zero Trust → Access، سياسة على `admin.discover-sharm.com` (إيميلات الفريق بس) — طبقة حماية قبل شاشة تسجيل الدخول نفسها.

## 5) تجربة قبل الإطلاق (10 دقايق)
1. من الموبايل افتحي `www.discover-sharm.com/excursions/` → لازم يتحوّل لـ `app.discover-sharm.com/excursions/`.
2. من الكمبيوتر افتحي `app.discover-sharm.com` → يتحوّل لـ www.
3. سجّلي دخول على app، وبعدين افتحي `?view=www` من نفس الجهاز → لازم تلاقيكي داخلة من غير ما تسجّلي تاني، واللغة/الثيم زي ما هما.
4. احجزي رحلة بكارت اختبار على app → تظهر في "حجوزاتي" على www.
5. `admin.discover-sharm.com` → سوبر أدمن → أنشئي أونر → سجّلي دخوله من `/owner/ex.html`.
6. `www.discover-sharm.com/admin` → لازم يحوّل لـ admin.

## الرجوع للنظام القديم
مش بنفس البساطة زي قبل لأن المواقع اتفصلت؛ الـ Workers القديمة لسه في `legacy/` للتوثيق. احتفظي بنسخة المشروع الأصلي (`public-main-fixed.zip`) لحد ما تتأكدي إن كل حاجة ماشية.


---

## المحتوى الثابت (JSON) — الوجهات والمقالات والتقييمات
`destinations.json` و `articles.json` و `reviews.json` (تقييمات الصفحة الرئيسية) و `promoSlides.json` بقوا ملفات ثابتة في **`shared/data/`**، مش في Supabase.
للتعديل: افتحي الملف في VS Code ← عدّلي ← `npm run build` ← `git push`. رقم نسخة تلقائي (`DS_DATA_V`) بيتغيّر مع كل تعديل فالمتصفحات بتجيب الجديد على طول.
اتشالوا من لوحة الأدمن: تابات الوجهات/المقالات/التقييمات/الشرائح وصفحة "الملفات". اللي لسه في Supabase: الفنادق والرحلات والترانسفير والمطاعم (محتاجة أسعار وحجوزات وأونرز) وتقييمات العملاء على كل عنصر.

## `DS_PAYMENTS_BASE` / `paymentsBase` — منين أجيبه؟
هو **رابط الـ Worker بتاع الدفع** بعد ما تنشريه على Cloudflare (مش حاجة بتتولّد من Supabase):
```bash
cd workers
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY -c wrangler.payments.toml     # + KASHIER_API_KEY و KASHIER_SECRET_KEY (و RESEND_API_KEY اختياري)
npx wrangler deploy -c wrangler.payments.toml
```
1. **أسرع حاجة:** في آخر الأمر wrangler بيطبع الرابط، شكله `https://discover-sharm-payments.<حسابك>.workers.dev` ← ده هو `paymentsBase` (بدون `/` في الآخر).
2. **الأحسن للإنتاج:** Cloudflare → Workers & Pages ← `discover-sharm-payments` ← Settings ← Domains & Routes ← Add ← Custom domain: `pay.discover-sharm.com`. وقتها `paymentsBase` = `https://pay.discover-sharm.com`.
3. حطّيه كمتغير `DS_PAYMENTS_BASE` في مشروعي Cloudflare Pages بتوع www و app (الأدمن مش محتاجه) — بدون `/` في الآخر.
4. تأكدي إن `SUPABASE_URL` و `SUPABASE_ANON_KEY` و `KASHIER_*` متظبطين في `[vars]` بتاع `wrangler.payments.toml`، وإن `ALLOWED_ORIGINS` فيه www و app.
5. اختبار: افتحي `<paymentsBase>/health` (أو أي endpoint عام موجود في الـ Worker) — لو رجّع رد يبقى شغال.


---

## الترجمة التلقائية (إدخال بلغة واحدة)
الأونر/الأدمن بيكتب بالعربي **أو** الإنجليزي (بيختار من فوق في صفحة الإضافة)، وعند الحفظ بيتترجم كل النص (الأسماء، الأوصاف، المميزات، برنامج اليوم، الغرف…) لباقي اللغات: AR / EN / RU / DE / IT / TR، بما فيهم اللغة التانية من العربي/الإنجليزي.
- التعديل بيترجم **اللي اتغيّر بس**؛ النص اللي ما اتغيّرش وترجمته موجودة بيتسايب زي ما هو.
- لو الترجمة فشلت بيسأل: تحفظ بلغتك الأصلية بس؟ (والموقع بيرجع للعربي/الإنجليزي للغات الناقصة).

### التفعيل (مرة واحدة) — Worker على Cloudflare Workers AI (من غير مفاتيح)
```bash
cd workers
# افتحي wrangler.translate.toml وحطي SUPABASE_URL و SUPABASE_ANON_KEY (نفس بتوع الدفع)
npx wrangler deploy -c wrangler.translate.toml
```
1. أول ما ينشر هيطبع رابط `https://discover-sharm-translate.<حسابك>.workers.dev` (أو اربطيه بدومين `translate.discover-sharm.com` من Cloudflare).
2. حطيه كمتغير `DS_TRANSLATE_BASE` في مشروع الأدمن على Cloudflare Pages، ثم Redeploy.
3. `ALLOWED_ORIGINS` في الـ toml لازم يبقى `https://admin.discover-sharm.com`.
4. الـ Worker مقفول على الموظفين بس (سوبر أدمن أو أونر)، مش مترجم عام. اختبار: `npm run test:translate`.
> Workers AI عنده حصة مجانية يومية؛ راجعي تسعير Cloudflare لو الاستخدام كبير. جودة الترجمة الآلية كويسة للأوصاف العامة لكن راجعي الأسماء المهمة بنفسك.

### لو الترجمة رجّعت خطأ CORS أو 401 في الـ Console
1. **CORS** (`No 'Access-Control-Allow-Origin'`): أعيدي نشر الـ Worker (`npx wrangler deploy -c wrangler.translate.toml`) بالنسخة الجديدة، وتأكدي إن `ALLOWED_ORIGINS` في Cloudflare ← Worker ← Settings ← Variables = `https://admin.discover-sharm.com` (من غير `/` في الآخر). لو متغيّر في الداشبورد بقيمة فاضية أو غلط هيغطّي على الـ toml.
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
| `worker_supabase_vars_missing` | `SUPABASE_URL` / `SUPABASE_ANON_KEY` في الـ Worker فاضيين أو لسه `YOUR-PROJECT`. اكتبيهم في `wrangler.translate.toml` (أو Cloudflare ← Worker ← Settings ← Variables) وأعيدي النشر. |
| `token_rejected_check_anon_key_and_project` | الـ anon key أو الـ URL في الـ Worker من مشروع Supabase غير اللي الأدمن بيسجل دخول منه. لازم نفس قيم `DS_SUPABASE_URL` / `DS_SUPABASE_ANON_KEY`. |
| `account_is_not_staff_or_inactive` | الحساب مش سوبر أدمن أو أونر، أو متوقف (`is_active = false`). |
| `rpc_failed_404` | الـ migrations ما اتطبقتش (دوال `is_super_admin` / `is_owner` مش موجودة). |
