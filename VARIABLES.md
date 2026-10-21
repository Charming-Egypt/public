# كل المتغيّرات (Cloudflare فقط — مفيش حاجة في الكود)

> **القواعد:**
> - متغيرات **Pages** بتتحقن وقت الـ build، فبعد أي تغيير: Deployments ← **Retry deployment**.
> - متغيرات **Workers** بتتطبق على طول بعد الحفظ (Save and deploy). ملفات `wrangler.*.toml` مفيهاش قيم (`keep_vars = true`) فنشر الـ Worker مش هيمسح اللي في الداشبورد.
> - النوع: **Text** = عادي، **Secret** = مخفي (للمفاتيح السرية).

## أولًا — القيم اللي هتجيبها

| القيمة | تجيبها منين |
|---|---|
| **Supabase URL** | Supabase ← Project Settings ← API ← *Project URL* (`https://xxxx.supabase.co`) |
| **Supabase anon key** | نفس الصفحة ← *anon public* |
| **Supabase service_role** | نفس الصفحة ← *service_role* (**سرّي جدًا — للـ Worker الدفع بس**) |
| **Google Client ID** | Google Cloud Console ← APIs & Services ← Credentials ← OAuth 2.0 Client ID (Web) ← *Client ID*. (ونفس الـ Client ID/Secret تتفعّل في Supabase ← Authentication ← Providers ← Google) |
| **رابط الدفع** | بعد نشر Worker الدفع: `https://discover-sharm-payments.<حسابك>.workers.dev` أو دومينك `https://pay.discover-sharm.com` |
| **رابط الترجمة** | بعد نشر Worker الترجمة: `https://discover-sharm-translate.<حسابك>.workers.dev` أو `https://translate.discover-sharm.com` |
| **Kashier** | لوحة Kashier ← Merchant ID + API Key + Secret Key |
| **Resend** (اختياري) | resend.com ← API Keys |

> الروابط تتكتب كاملة بـ `https://` وبدون `/` في الآخر (البناء بيصلّحها لو نسيت، بس الأفضل تكتبها صح).

## ثانيًا — مشاريع Pages (Settings ← Variables and Secrets)

| المتغير | www | app | admin | النوع |
|---|:-:|:-:|:-:|---|
| `DS_SUPABASE_URL` | ✅ | ✅ | ✅ | Text |
| `DS_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ | Text |
| `DS_GOOGLE_CLIENT_ID` | ✅ | ✅ | | Text |
| `DS_PAYMENTS_BASE` | ✅ | ✅ | | Text |
| `DS_TRANSLATE_BASE` | | | ✅ | Text |
| `DS_CONTACT_PHONE` | ✅ | ✅ | | Text — مثال `+20 100 000 0000` |
| `DS_CONTACT_WHATSAPP` | ✅ | ✅ | | Text — رقم واتساب بكود الدولة `20100…` |
| `DS_CONTACT_EMAIL` | ✅ | ✅ | | Text |
| `DS_SOCIAL_FACEBOOK` | ✅ | ✅ | | Text — رابط كامل |
| `DS_SOCIAL_INSTAGRAM` | ✅ | ✅ | | Text — رابط كامل |
| `DS_SOCIAL_TIKTOK` | ✅ | ✅ | | Text — رابط كامل |
| `DS_SOCIAL_YOUTUBE` | ✅ | ✅ | | Text — رابط كامل (اختياري) |

> بيانات التواصل والسوشيال بقت متغيرات Cloudflare (مش في إعدادات السوبر أدمن). لو كل المتغيرات فاضية الصفحة بتفضل زي ما هي؛ ولو حطيت أي واحد، أيقونات السوشيال اللي مالهاش رابط بتختفي. بعد التغيير: **Retry deployment**.

(ولو الـ build مش لاقي Node مناسب ضيف `NODE_VERSION` = `20` في كل مشروع.)

## ثالثًا — Worker الدفع `discover-sharm-payments` (Settings ← Variables and Secrets)

| المتغير | القيمة | النوع |
|---|---|---|
| `SUPABASE_URL` | Supabase Project URL | Text |
| `SUPABASE_ANON_KEY` | anon public key | Text |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **Secret** |
| `KASHIER_MERCHANT_ID` | Merchant ID من Kashier (`MID-…`) | Text |
| `KASHIER_API_KEY` | API Key من Kashier | **Secret** |
| `KASHIER_SECRET_KEY` | Secret Key (توقيع الـ webhook) | **Secret** |
| `KASHIER_MODE` | `live` (أو `test` للتجربة) | Text |
| `KASHIER_CURRENCY` | `EGP` | Text |
| `SITE_URL` | `https://app.discover-sharm.com` (رابط الفاوتشر في الإيميل) | Text |
| `MAIL_FROM` | `Discover Sharm <bookings@discover-sharm.com>` | Text |
| `RESEND_API_KEY` | اختياري — إيميلات التأكيد | **Secret** |

اختياري: KV Namespace باسم الـ binding `RATE_LIMIT_KV` (Settings ← Bindings) لتحديد معدل الطلبات.

## رابعًا — Worker الترجمة `discover-sharm-translate` (Settings ← Variables and Secrets)

| المتغير | القيمة | النوع |
|---|---|---|
| `SUPABASE_URL` | Supabase Project URL (نفس الأدمن) | Text |
| `SUPABASE_ANON_KEY` | anon public key | Text |
| `ALLOWED_ORIGINS` | `https://admin.discover-sharm.com` | Text |

والـ **Workers AI binding** باسم `AI` موجود في `wrangler.translate.toml` (`[ai]`)؛ لو نشرته من الداشبورد بدل wrangler ضيفه من Settings ← Bindings ← Add ← Workers AI ← اسم المتغير `AI`.

## خامسًا — الترتيب الصح أول مرة
1. انشر Worker الدفع والترجمة (`npx wrangler deploy -c wrangler.payments.toml` / `-c wrangler.translate.toml`).
2. اضبط متغيرات كل Worker من الجداول فوق.
3. اربط الدومينين (`pay.…` و `translate.…`) من Settings ← Domains & Routes، أو استخدم رابط workers.dev.
4. حطي روابطهم في متغيرات Pages (`DS_PAYMENTS_BASE` / `DS_TRANSLATE_BASE`) مع باقي متغيرات الجدول التاني.
5. Retry deployment للتلات مشاريع.
6. Supabase ← Authentication ← URL Configuration: ضيف الدومينات التلاتة في Redirect URLs.
