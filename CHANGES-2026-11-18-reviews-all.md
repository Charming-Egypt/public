# كل إصلاحات وإضافات الريفيوهات (2026-11-18)

## 1) إصلاح فورم "Write a review"
- shared/style.css (آخر الملف): الـ select (العلم فوق النص + سهمين)، النجوم المعكوسة، الأيقونات البيضا على الزراير البرتقالي، زرار Add، كارت الفاوتشر، المسافة تحت الـ bottom bar.
- shared/reviews-page.js: الـ select خد class `lf-keep`، شلنا الكاميرا المكررة، الكود في <code> والتاريخ بخط عادي.

## 2) الريفيوهات الافتراضية (36 ريفيو × 6 لغات)
- shared/data/reviews.json: 12 لكل منتج (e1 رأس محمد، e2 سفاري الصحراء البيضاء، t1 ترانسفير H1). كل ريفيو عليه `itemId` + `section`.

## 3) الربط بالصفحات + عدم الاختفاء
- الحقيقية الأول والافتراضية بعدها، ومبتختفيش لما حد يكتب ريفيو حقيقي:
  - صفحة المنتج: shared/data.js (`loadReviews` + `defaultReviewsFor`)
  - صفحة /reviews/: shared/reviews-page.js (الإحصائيات والقايمة والـ pagination)
  - الهوم: shared/supabase-api.js + shared/frontend.js (أول 24 في السلايدر)
- كارت الريفيو بيفتح صفحة المنتج.

بعد النسخ فوق المشروع: npm run build
