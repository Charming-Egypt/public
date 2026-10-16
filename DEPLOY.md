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

## 3) الإعدادات والـ build
`site.config.json` → `supabase`: `url` و `anonKey` (عامّين) و `googleClientId` و `paymentsBase` (= `https://pay.discover-sharm.com`).
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
3. حطّيه في `site.config.json` ← `supabase.paymentsBase`، أو كـ Environment variable باسم `DS_PAYMENTS_BASE` في مشروعي Cloudflare Pages بتوع www و app (الأدمن مش محتاجه).
4. تأكدي إن `SUPABASE_URL` و `SUPABASE_ANON_KEY` و `KASHIER_*` متظبطين في `[vars]` بتاع `wrangler.payments.toml`، وإن `ALLOWED_ORIGINS` فيه www و app.
5. اختبار: افتحي `<paymentsBase>/health` (أو أي endpoint عام موجود في الـ Worker) — لو رجّع رد يبقى شغال.
