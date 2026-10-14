# خطوات التشغيل (Go-live) — بالترتيب

> الموقع بيفضل على النظام القديم طول ما `supabase.url` فاضي في `site.config.json`. اشتغلي على **مشروع تجريبي** الأول.

## 1) قاعدة البيانات
1. أنشئي مشروع Supabase، واعملي إعدادات Auth زي `supabase/README.md` (تأكيد الإيميل **ON**، Google، CAPTCHA، pg_cron).
2. شغّلي الـ 7 migrations بالترتيب ثم `seed.sql` ثم `tests/rls_tests.sql` (لازم كله PASS).
3. أول سوبر أدمن: سجّلي حساب عادي وأكدي الإيميل، وبعدين:
   `update public.profiles set role = 'super_admin' where email = 'you@example.com';`
4. `supabase functions deploy admin-create-user`

## 2) Worker الدفع
1. عدّلي `workers/wrangler.payments.toml` (SUPABASE_URL، anon key، Kashier merchant id، SITE_URL، MAIL_FROM).
2. الأسرار: `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY | KASHIER_API_KEY | KASHIER_SECRET_KEY | RESEND_API_KEY -c workers/wrangler.payments.toml`
3. `npx wrangler deploy -c workers/wrangler.payments.toml` وخليه على دومين زي `pay.discover-sharm.com`.
4. في Kashier: Webhook URL = `https://pay.discover-sharm.com/api/kashier/webhook`.
5. جرّبي بـ `KASHIER_MODE = "test"` وكروت الاختبار قبل ما تحوّلي لـ live.

## 3) الموقع
1. `site.config.json` → `supabase`: `url`, `anonKey` (public), `googleClientId`, `paymentsBase` (= دومين الـ Worker).
2. `npm run build` ثم ارفعي الفولدر كله (GitHub Pages / Cloudflare Pages…). `CNAME` موجود.
3. (اختياري) نقل البيانات القديمة:
   - المستخدمين: أداة `supabase-community/firebase-to-supabase`.
   - الحجوزات: `node tools/import-firebase-bookings.mjs firebase-export.json > supabase/import-bookings.sql` ثم شغّليه.

## 4) تجربة قبل الإطلاق (10 دقايق)
- سجّلي كعميل → احجزي رحلة → ادفعي بكارت اختبار → تأكدي إن الحجز ظهر في "حجوزاتي" وجه إيميل التأكيد وفتح الفاوتشر.
- من لوحة الأدمن: أنشئي أونر → سجّلي دخوله في `/owner/ex.html` → أضيفي رحلة (تظهر "بانتظار المراجعة") → انشريها من الأدمن.
- كعميل احجزي الرحلة دي، وبعد تاريخها سجّلي "تم" من لوحة الأونر → تأكدي إن الأرباح ظهرت → اطلبي سحب → اعتمديه من الأدمن.

## الرجوع للنظام القديم (Rollback)
امسحي `supabase.url` من `site.config.json`، `npm run build`، وارفعي. الـ Workers القديمة في `legacy/workers/`.

## الاختبارات الآلية (من غير إنترنت)
```
node workers/tests/payments.test.mjs      # Worker الدفع على Supabase/Kashier تجريبيين
```
