# Discover Sharm على Supabase — دليل التشغيل

كل الحسابات (عملاء / مالكين / سوبر أدمن) والعقارات والحجوزات بقت في قاعدة بيانات Supabase. الأمان كله جوّه
القاعدة نفسها (Row Level Security + دوال RPC)، فالمفتاح العام (`anon key`) اللي في الصفحة آمن إنه يبان.

## 1) إعداد المشروع (مرة واحدة)

1. أنشئ مشروع Supabase.
2. **Authentication → Providers → Email**: سيب **Confirm email = ON**. ده شرط أمان: صلاحية "مالك" بتتفعّل بس بعد تأكيد الإيميل.
3. **Authentication → Providers → Google**: فعّله وحط Client ID / Secret. نفس الـ Client ID حطه كمتغير `DS_GOOGLE_CLIENT_ID` في مشروعي www و app على Cloudflare Pages.
4. **Authentication → URL Configuration**: Site URL = `https://www.discover-sharm.com`, and add ALL THREE to **Redirect URLs**: `https://www.discover-sharm.com/**`, `https://app.discover-sharm.com/**`, `https://admin.discover-sharm.com/**` (confirmation e-mails return to the site the person signed up on; the admin password-reset link returns to the admin site).
5. **Authentication → Rate limits + CAPTCHA**: فعّل Turnstile/hCaptcha (حماية من الحسابات الوهمية).
6. **Database → Extensions**: فعّل `pg_cron` (التنظيف الليلي).

## 2) تحميل قاعدة البيانات

في **SQL Editor** شغّل بالترتيب (أو `supabase db push`):

```
supabase/migrations/20261012000100_schema.sql          الجداول
supabase/migrations/20261012000200_functions.sql       الدوال (حساب السعر، الحجز، الإلغاء، التقييم، الأدمن…)
supabase/migrations/20261012000300_indexes.sql         الـ Indexes
supabase/migrations/20261012000400_rls_and_grants.sql  الصلاحيات + RLS
supabase/migrations/20261012000500_storage_and_cron.sql الصور + التنظيف الليلي
supabase/migrations/20261012000600_payments.sql        دوال تأكيد الدفع (service role فقط)
supabase/migrations/20261012000700_backoffice.sql      لوحات الأدمن/المالك: الأرباح، السحب، العمولات، الإحصائيات
supabase/seed.sql                                      الكتالوج الحالي (فنادق، رحلات، مطاعم…)
```

> ⚠️ الملفات دي **اتكتبت واتراجعت لكن ما اتشغلتش على Postgres حقيقي** (مفيش قاعدة في بيئة التطوير).
> شغّلها الأول على مشروع تجريبي (staging) وبعدين شغّل `supabase/tests/rls_tests.sql`:
> حوالي 55 فحص أمان ومحاسبة بيطبع PASS/FAIL وبيعمل rollback فمبيسيبش بيانات.
> لو أي سطر فشل ابعتلي اسم الفحص ورسالة الخطأ وأصلّحه.

## 3) أول سوبر أدمن

اعمل حساب عادي من الموقع وأكد الإيميل، وبعدين من SQL Editor:

```sql
update public.profiles set role = 'super_admin' where email = 'you@example.com';
```

مفيش أي طريقة من الموقع تعمل سوبر أدمن. باقي الأدوار بتتغير بدالة `admin_set_user_role`.

## 4) ربط الموقع

متغيرات بيئة على Cloudflare Pages (Settings ← Variables and Secrets) — مش في الكود:

| المتغير | الاسم |
|---|---|
| Project URL | `DS_SUPABASE_URL` |
| anon public key | `DS_SUPABASE_ANON_KEY` |

ثم Redeploy. لو فاضيين الموقع بيتبني من غير Supabase (للتجربة بس).
**ممنوع** تحط `service_role key` في الموقع أو الريبو — بيتحط بس كسر في Worker الدفع.

## الأدوار

| الدور | يعمل إيه |
|---|---|
| عميل `user` | يشوف ويعدّل بروفايله (الاسم/التليفون/الصورة بس)، ينشئ حجز، يلغي حجزه، مفضلة، تقييم لحجز مدفوع |
| مالك `owner` | يضيف عقارات من نوع اتوافق عليه (مسودة)، يعدّل بياناتها، يبعتها للمراجعة، يشوف حجوزات عقاراته، يرد على التقييمات، يطلب سحب أرباح |
| سوبر أدمن | كل حاجة: نشر/أرشفة، تغيير الأدوار، الطلبات، العمولة، السحوبات، الإحصائيات، سجل التدقيق |

المالك يبقى مالك بإنه يقدّم طلب شراكة، والأدمن يوافق (`admin_decide_application`)، وأول ما إيميله يتأكد بيتفعّل تلقائياً.

## ليه ده بيوفّر موارد القاعدة

- **Indexes جزئية** (كتالوج منشور بس، حجوزات غير معلّقة بس، طوابير مفتوحة بس) + BRIN للتنظيف: أصغر حجم وأقل تكلفة كتابة. مفيش GIN على JSON ولا Index على مفاتيح ما بتتحذفش.
- **RLS بـ `(select auth.uid())`**: بيتحسب مرة واحدة في الاستعلام مش لكل صف.
- **صلاحيات أعمدة**: العميل مش قادر يكتب `role` أو الأسعار أو الحالة أصلاً؛ ده بيمنع الكتابة قبل ما توصل لأي منطق.
- **السعر محسوب في القاعدة** (`create_booking`)، مفيش رحلة ذهاب وعودة لـ Worker.
- **تقييم متوسط بيتحدّث تدريجياً** بدل `avg()` عند كل عرض.
- **القوائم بتقرأ أعمدة حقيقية** (النوع/الترتيب/السعر) ومبتفتحش JSON، والمتصفح بيخزّن الكتالوج 10 دقايق.
- **الصور في Storage** مش base64 جوّه الصفوف.
- **تنظيف ليلي** (`housekeeping`): جلسات الدفع المنتهية، إشعارات أقدم من 90 يوم، حجوزات فاشلة أقدم من 90 يوم.
- **Throttle** لنماذج الاتصال والشراكة جوّه الدالة (بدون Realtime ولا جداول إضافية).

## Edge Function (إنشاء حسابات الأونرز من لوحة الأدمن)

```bash
supabase functions deploy admin-create-user
```
الدالة بتتحقق إن اللي بيناديها سوبر أدمن، وبعدين بتنشئ الحساب بمفتاح الخدمة (اللي مبيظهرش في المتصفح).

## تنظيف وصيانة

- `housekeeping()` بتشتغل كل ليلة (pg_cron): جلسات الدفع المنتهية، إشعارات > 90 يوم، حجوزات فاشلة > 90 يوم.
- من لوحة الأدمن → صيانة: "مسح الحجوزات المعلّقة" و"إعادة ربط الحجوزات بالأونرز".
