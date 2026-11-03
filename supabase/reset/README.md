# تصفير Supabase ورفع المطلوب للتشغيل فقط

> ⚠️ الخطوة 1 بتمسح كل حاجة ومفيش رجوع. خُد Backup الأول (Dashboard ← Database ← Backups).

## الترتيب (SQL Editor، كل ملف Run مرة واحدة)

| # | الملف | بيعمل إيه |
|---|---|---|
| 1 | `00_wipe_everything.sql` | يمسح كل جداول/دوال/أنواع/سياسات `public` + سياسات الـ Storage + مهمة التنظيف الليلي. بيطبع في الآخر جدول فاضي للتأكيد. |
| 1b | `00b_wipe_auth_users.sql` | **اختياري** — يمسح كل الحسابات (عملاء/أونرز/أدمن). |
| 2 | `01_install_schema.sql` | يبني الجداول والدوال والـ RLS والـ Storage والـ cron (كل الـ migrations الـ 10 بالترتيب في سكريبت واحد = transaction واحدة، لو فيه خطأ بيرجّع كله). |
| 3 | **الأفضل:** `02b_properties_from_github.sql` (يتولّد بالأداة تحت) — أو `02_seed_minimal.sql` | صفوف `properties` (فنادق/رحلات/ترانسفير/مطاعم). **الأول بيتبني من ملفات GitHub الحقيقية** فأسعار الداتا بيس = أسعار الموقع. التاني من الكتالوج المرفق في الكود وممكن يبقى قديم (انظر تحت). |
| 4 | سجّل حساب من الموقع وأكّد الإيميل، وبعدها `03_first_super_admin.sql` (غيّر الإيميل) | أول سوبر أدمن. |

بعد كده: `supabase functions deploy admin-create-user` و `send-push` لو لسه ما اتنشروش (الـ Edge Functions مش بتتمسح).

## إيه اللي اتشال عن السيرفر القديم؟
- **`site_content` (31 صف)**: الوجهات والمقالات والشرائح والتقييمات بقت JSON ثابت في `shared/data/` فمش بتتحمّل في الداتا بيس. الجدول نفسه فاضل فاضي (الكود في `console/supabase-console.js` لسه بيشاور عليه، فمسحه محتاج تنضيف كود الأدمن).
- **`audit_log`**: بيتبني وبيتمسح في migration 8 (زي ما كان). مفيش بيانات.

## اللي مش بيتمسح (حاجة تعرفها)
- **ملفات الـ Storage** (صور البروفايلات والعقارات): Supabase بيمنع حذفها بـ SQL. لو عايز تفضيها: Dashboard ← Storage ← افتح الـ bucket ← حدد الكل ← Delete.
- **ريبو GitHub الخاص بالمحتوى**: متلمسش. لو فيه عناصر اتضافت من الأدمن بعد الـ seed (ids مش `h1`/`e1`/`t1`/`r1`…) هتبقى موجودة في GitHub وناقصة في `properties` → ما تتحجزش. حلها: أعد إضافتها من الأدمن، أو ابعتلي الـ ids وأجهزلك سكريبت إدراج.

## لو أضفت migration جديدة
`node tools/make-install-sql.mjs` بيعيد توليد `01_install_schema.sql` و `02_seed_minimal.sql`.

## تنبيه
الملفات دي اتجهزت من الـ migrations الموجودة من غير تشغيلها على Postgres حقيقي (مفيش قاعدة في بيئتي). جرّبها على مشروع staging الأول، وبعدها شغّل `supabase/tests/rls_tests.sql` (55 فحص أمان) للتأكد.


## ⚠️ خطأ الدفع "السعر اتغيّر" بعد التصفير
الحجز بيتسعّر في **الداتا بيس** (`compute_booking_price` بيقرا `properties.data`) بينما الزائر بيشوف السعر من **ملفات GitHub**. لو الصفوف اتعملت من الكتالوج القديم المرفق في الكود (`02_seed_minimal.sql`) والسعر اتعدّل بعدها من الأدمن (مثلاً الرحلة 1,700 → 1,800)، السيرفر يرفض الدفع. الحل: ابنِ الصفوف من GitHub نفسه.

```bash
# 1) اسحب ريبو الداتا الخاص (اللي فيه api/hotels, api/excursions, ...)
git clone https://github.com/<owner>/<data-repo>.git ../data-repo
# 2) ولّد الـ SQL (أو: GITHUB_TOKEN=ghp_... node tools/rebuild-db-from-github.mjs --repo <owner>/<data-repo>)
node tools/rebuild-db-from-github.mjs --dir ../data-repo
# 3) شغّل supabase/reset/02b_properties_from_github.sql في SQL Editor (بدل 02)
```
بيرجّع كمان: المالك (لو حسابه لسه موجود في `profiles`)، حالة النشر، الترتيب، المميز، وعناصر الأونرز اللي اتضافت بعد الـ seed القديم. بعده شغّل `03b_backfill_profiles.sql` لو ما مسحتش الحسابات (`00b`) — الحسابات القديمة محتاجة صفوف profiles.

حل سريع لعنصر واحد لحد ما تشغّل الأداة: `update public.properties set data = jsonb_set(data, '{price}', '1800') where id = 'e1';` (الفنادق أسعارها جوه `rooms`، فاستخدم الأداة).
