# لوحات الأونرز على دومين منفصل: owner.discover-sharm.com

- موقع رابع جديد `dist/owner` (`npm run build:owner` / `npm run build` يبني الأربعة).
  - `owner.discover-sharm.com/` صفحة اختيار نوع الحساب، و `/ex.html` `/pkg.html` `/hotel.html` `/restaurant.html` `/transfer.html` اللوحات.
  - مفيش كود السوبر أدمن على الدومين ده، والجلسات منفصلة عن الأدمن (origin مختلف).
- `admin.discover-sharm.com` بقى للسوبر أدمن فقط. `/owner/*` عليه (و www و app) بيحوّل 301 لـ `owner.discover-sharm.com`. 

## لازم تعمل (مرة واحدة)
1. Cloudflare Pages: مشروع جديد `discover-sharm-owner` — Build command `npm run build:owner`، Output `dist/owner`، نفس متغيرات `DS_*` اللي على مشروع الأدمن (SUPABASE_URL/ANON_KEY/CONTENT_BASE/SETTINGS_BASE/MEDIA_BASE/TRANSLATE_BASE) — وأضف Custom domain `owner.discover-sharm.com`.
2. Supabase → Authentication → URL Configuration → Redirect URLs: أضف `https://owner.discover-sharm.com/**`.
3. على الـ Workers (content و settings و translate): أضف `https://owner.discover-sharm.com` في متغير `ALLOWED_ORIGINS` (مفصولة بفاصلة)، من لوحة Cloudflare.
4. أعد بناء ونشر admin و www و app (علشان الـ redirects).
