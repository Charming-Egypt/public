# media.discover-sharm.com — بيدج الصور (Cloudflare Pages)

الصور بتتحفظ في الريبو الخاص على GitHub (زي ما كان، الـ Worker بيكتب فيه بالـ `GITHUB_TOKEN`)، وبيدج منفصل اسمه **discover-sharm-media** بيبني من نفس الريبو وبينشر الصور على `media.discover-sharm.com`. عرض الملفات الثابتة على Cloudflare Pages من غير حد للـ bandwidth، فالزوار مبيعدّوش على الـ Worker ولا على GitHub.

## الإعداد (مرة واحدة)
1. انسخ `build-media.mjs` لـ **جذر الريبو الخاص** (ريبو الداتا) واعمل commit.
2. Cloudflare → Workers & Pages → Create → Pages → **Connect to Git** → اختار ريبو الداتا الخاص (هتديله صلاحية Cloudflare Pages GitHub App على الريبو ده بس).
3. اسم المشروع: `discover-sharm-media`، الـ branch: `main`.
4. Build settings:
   - Build command: `node build-media.mjs`
   - Build output directory: `out`
   - Root directory: (سيبه فاضي)
5. بعد أول نشر: Settings → Build → **Build watch paths** → Include: `api/*/img/*` و`build-media.mjs`
   (عشان تعديلات الأصناف والإعدادات — وهي commits كتير — ما تعملش build وتاكل من الـ 500 build في الشهر).
6. Custom domains → أضف **media.discover-sharm.com**.
7. في الـ content Worker: `MEDIA_BASE = "https://media.discover-sharm.com"` (موجود في `wrangler.content.toml`) ثم `wrangler deploy`.
8. في Pages بتاع الموقع (www / app / admin): `DS_MEDIA_BASE=https://media.discover-sharm.com` وأعد النشر.

## إزاي بيشتغل
- الأدمن يرفع صورة → الـ Worker يكتبها في GitHub ويرجّع رابط الـ Worker (بيشتغل فورًا).
- GitHub commit → Pages يبني (حوالي دقيقة) → الصورة تظهر في `img/manifest.json`.
- الـ Worker (كل 5 دقايق، أو عند أي حفظ) بيقرا الـ manifest وبيحوّل رابط كل صورة منشورة لـ `media.discover-sharm.com` في الكتالوج. الصورة اللي لسه مش في الـ manifest بتفضل تتحمّل من الـ Worker → **مفيش صورة بتظهر مكسورة أبدًا**، حتى لو خلصت الـ 500 build.

## حدود الخطة المجانية (Cloudflare Pages)
- 500 build في الشهر، build واحد في نفس الوقت (كل صورة جديدة = commit = build؛ رفع 10 صور ورا بعض ممكن يعمل أكتر من build)
- 20,000 ملف للموقع الواحد، و25 MB للملف (الكونسول بيضغط الصورة لأقل من 900 KB)
- عرض الملفات الثابتة (bandwidth): بدون حد
- أول مرة: اعمل Retry/Deploy يدوي من لوحة Pages عشان تظهر الصور القديمة كلها، أو اعمل commit صغير على `build-media.mjs`.
