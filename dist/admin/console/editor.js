/* Discover Sharm — full-page item editor (excursions, hotels, transfers)
 * Replaces the old pop-up form. One page, grouped into cards, a sticky action bar, a language switcher that drives
 * every translatable field at once, live completeness checklist, drag-and-drop photos, a room builder and an
 * availability calendar. The saved object has exactly the same shape the old form produced (see schemas.js), so the
 * API, the database mapping and the public sites are untouched.
 *
 *   DS.itemEditor(container, { type: 'excursion'|'hotel'|'transfer', item, save(obj), onBack(), extra?, side?, beforeSave? })
 */
(function () {
const { esc, tr, LANGS, LN } = DS;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const clone = o => JSON.parse(JSON.stringify(o == null ? {} : o));
const SH = { ar: 'ع', en: 'EN', ru: 'RU', de: 'DE', it: 'IT', tr: 'TR' };
const P = (en, ar) => ({ en, ar });

// ---------- tiny state helpers (paths like "rooms.0.price") ----------
const getP = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setP(o, p, v) { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach((k, i) => { if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }

// ---------- presets ----------
const PRE = {
  includes: [P('Hotel pickup & drop-off', 'التوصيل من وإلى الفندق'), P('Lunch', 'وجبة غداء'), P('Soft drinks & water', 'مشروبات ومياه'), P('Snorkeling equipment', 'معدات سنوركلينج'), P('Professional guide', 'مرشد محترف'), P('Entrance fees', 'رسوم الدخول'), P('Insurance', 'تأمين'), P('Towels', 'فوط')],
  excludes: [P('Tips', 'البقشيش'), P('Personal expenses', 'مصاريف شخصية'), P('Alcoholic drinks', 'المشروبات الكحولية'), P('Photos & videos', 'التصوير الفوتوغرافي والفيديو'), P('Extra activities', 'الأنشطة الإضافية')],
  whatToBring: [P('Swimwear', 'ملابس سباحة'), P('Sunscreen', 'واقي شمس'), P('Towel', 'فوطة'), P('Sunglasses & hat', 'نظارة وقبعة'), P('Camera', 'كاميرا'), P('Cash', 'نقود'), P('Comfortable shoes', 'حذاء مريح'), P('Light jacket', 'جاكيت خفيف')],
  amenities: [P('Free WiFi', 'واي فاي مجاني'), P('Swimming pool', 'حمام سباحة'), P('Private beach', 'شاطئ خاص'), P('Spa & wellness', 'سبا ومركز صحي'), P('Gym', 'جيم'), P('Restaurants', 'مطاعم'), P('Kids club', 'نادي أطفال'), P('Air conditioning', 'تكييف'), P('Airport shuttle', 'توصيل من المطار'), P('Parking', 'موقف سيارات'), P('Bar', 'بار'), P('Water sports', 'رياضات مائية'), P('Diving center', 'مركز غوص'), P('Room service', 'خدمة الغرف'), P('Breakfast included', 'الإفطار مشمول'), P('All inclusive', 'شامل كل شيء')],
  features: [P('Air conditioning', 'تكييف'), P('WiFi on board', 'واي فاي'), P('Child seat', 'كرسي أطفال'), P('Free water', 'مياه مجانية'), P('Meet & greet', 'استقبال باللافتة'), P('Large luggage space', 'مساحة أمتعة كبيرة'), P('Professional driver', 'سائق محترف'), P('Free waiting time', 'انتظار مجاني'), P('Flight tracking', 'متابعة الرحلة')],
};
const CATS = {
  excursion: [['Boat trip', 'رحلة بحرية', '🚤'], ['Desert Safari', 'سفاري صحراوي', '🏜️'], ['Diving', 'غوص', '🤿'], ['Snorkeling', 'سنوركلينج', '🐠'], ['Quad', 'كواد', '🏍️'], ['City Tour', 'جولة المدينة', '🏛️']],
  hotel: [['budget', 'اقتصادي', '🏨'], ['luxury', 'فاخر', '✨']],
};

// ---------- page specs ----------
const hasText = o => o && Object.values(o).some(v => String(v || '').trim());
const SPEC = {
  excursion: {
    title: 'رحلة', nameKey: 'title', icon: '🧭',
    sections: [
      { id: 'basic', t: 'المعلومات الأساسية', s: 'الاسم والتصنيف ونقطة التجمع', f: [
        { k: 'title', l: 'اسم الرحلة', kind: 'i18n', req: 1, max: 80, ph: 'مثال: رحلة جزيرة الجفتون بالغوص والسنوركلينج', help: 'اسم واضح ومباشر — بيظهر في البحث وفي صفحة الرحلة.' },
        { k: 'category', l: 'نوع الرحلة', kind: 'chips', req: 1, opts: CATS.excursion },
        { k: 'duration', l: 'المدة', kind: 'i18n', w: 'half', max: 40, ph: 'مثال: 8 ساعات', help: 'بالنص: "8 ساعات" أو "نص يوم".' },
        { k: 'meetingPoint', l: 'نقطة التجمع', kind: 'i18n', w: 'half', max: 120, ph: 'مثال: ريسبشن الفندق / مارينا شرم', help: 'فين العميل هيتقابل مع الفريق.' } ] },
      { id: 'desc', t: 'الوصف', s: 'نبذة قصيرة + وصف تفصيلي بيقنع العميل', f: [
        { k: 'description', l: 'نبذة قصيرة', kind: 'i18n', long: 1, rows: 3, max: 180, req: 1, help: 'بتظهر على الكارت في القوائم (سطرين تقريبًا).' },
        { k: 'fullDescription', l: 'الوصف الكامل', kind: 'i18n', long: 1, rows: 8, max: 3000, help: 'اشرح التجربة: هنعمل إيه، هنروح فين، إيه اللي هيميّزها.' } ] },
      { id: 'photos', t: 'الصور', s: 'أول صورة هي الغلاف — اسحب الصور لترتيبها', f: [{ k: 'gallery', kind: 'gallery', max: 12, min: 3 }] },
      { id: 'inc', t: 'اللي مشمول واللي لأ', s: 'وضّح للعميل بالظبط هيدفع في إيه', f: [
        { k: 'includes', l: 'السعر يشمل', kind: 'tags', presets: 'includes', ph: 'أضيف بند واضغط Enter' },
        { k: 'excludes', l: 'السعر لا يشمل', kind: 'tags', presets: 'excludes', ph: 'أضيف بند واضغط Enter' },
        { k: 'whatToBring', l: 'ياخد معاه إيه', kind: 'tags', presets: 'whatToBring', ph: 'أضيف بند واضغط Enter' } ] },
      { id: 'iti', t: 'برنامج اليوم', s: 'الجدول الزمني خطوة بخطوة', f: [{ k: 'itinerary', kind: 'itinerary' }] },
    ],
    price: { k: 'price', l: 'سعر الفرد', suffix: 'EGP', help: 'السعر للشخص البالغ.' },
    checks: [
      ['اسم الرحلة', d => hasText(d.title)], ['نوع الرحلة', d => !!d.category], ['السعر', d => d.price > 0], ['نبذة قصيرة', d => hasText(d.description)],
      ['3 صور على الأقل', d => (d.gallery || []).length >= 3], ['الوصف الكامل', d => hasText(d.fullDescription)], ['نقطة التجمع', d => hasText(d.meetingPoint)],
      ['بند واحد على الأقل في "يشمل"', d => d.includes && Object.values(d.includes).some(a => a && a.length)], ['برنامج اليوم', d => (d.itinerary || []).length > 0],
    ],
  },
  hotel: {
    title: 'فندق', nameKey: 'name', icon: '🏨',
    sections: [
      { id: 'basic', t: 'المعلومات الأساسية', s: 'الاسم والتصنيف والموقع', f: [
        { k: 'name', l: 'اسم الفندق', kind: 'i18n', req: 1, max: 80, ph: 'مثال: ريتز كارلتون شرم الشيخ' },
        { k: 'category', l: 'فئة الفندق', kind: 'chips', req: 1, opts: CATS.hotel },
        { k: 'location', l: 'الموقع', kind: 'i18n', req: 1, max: 100, ph: 'مثال: خليج نعمة، شرم الشيخ', help: 'المنطقة اللي العميل يعرفها — بيظهر على الكارت.' } ] },
      { id: 'desc', t: 'الوصف', s: 'عرّف العميل بالفندق', f: [
        { k: 'description', l: 'نبذة قصيرة', kind: 'i18n', long: 1, rows: 3, max: 180, req: 1 },
        { k: 'fullDescription', l: 'الوصف الكامل', kind: 'i18n', long: 1, rows: 8, max: 3000 } ] },
      { id: 'photos', t: 'الصور', s: 'أول صورة هي الغلاف — صور الغرف والمسبح والشاطئ والمطاعم', f: [{ k: 'gallery', kind: 'gallery', max: 24, min: 5 }] },
      { id: 'amen', t: 'المرافق والخدمات', s: 'اختار من القايمة أو أضيف خدمات خاصة', f: [{ k: 'amenities', l: 'مرافق الفندق', kind: 'tags', presets: 'amenities', ph: 'أضيف مرفق واضغط Enter', hideLabel: 1 }] },
      { id: 'rooms', t: 'الغرف والأسعار', s: 'كل نوع غرفة بسعره وسياسة الأطفال بتاعته', f: [{ k: 'rooms', kind: 'rooms' }] },
      { id: 'avail', t: 'التوفر', s: 'علّم الأيام اللي الفندق مش متاح فيها', f: [{ k: 'unavailableDates', kind: 'dates' }] },
    ],
    price: { k: 'price', l: 'السعر يبدأ من (لليلة)', suffix: 'EGP', help: 'بيظهر "ابتداءً من" على الكارت.' },
    checks: [
      ['اسم الفندق', d => hasText(d.name)], ['الموقع', d => hasText(d.location)], ['الفئة', d => !!d.category], ['السعر', d => d.price > 0], ['نبذة قصيرة', d => hasText(d.description)],
      ['5 صور على الأقل', d => (d.gallery || []).length >= 5], ['غرفة واحدة على الأقل', d => (d.rooms || []).length > 0], ['5 مرافق على الأقل', d => d.amenities && Math.max(0, ...Object.values(d.amenities).map(a => (a || []).length)) >= 5],
      ['الوصف الكامل', d => hasText(d.fullDescription)],
    ],
  },

  restaurant: {
    title: 'مطعم / كافيه', nameKey: 'name', icon: '🍽️', imageReq: true,
    sections: [
      { id: 'basic', t: 'المعلومات الأساسية', s: 'الاسم والنوع والمطبخ', f: [
        { k: 'name', l: 'الاسم', kind: 'i18n', req: 1, max: 80, ph: 'مثال: مطعم الأسماك على البحر' },
        { k: 'venueType', l: 'النوع', kind: 'chips', req: 1, opts: [['restaurant', 'مطعم', '🍽️'], ['cafe', 'كافيه', '☕']] },
        { k: 'cuisine', l: 'نوع المطبخ', kind: 'i18n', w: 'half', max: 50, ph: 'مثال: مأكولات بحرية / قهوة مختصة' },
        { k: 'priceLevel', l: 'مستوى الأسعار', kind: 'chips', w: 'half', num: 1, opts: [[1, '$ اقتصادي', ''], [2, '$$ متوسط', ''], [3, '$$$ مرتفع', ''], [4, '$$$$ فاخر', '']] } ] },
      { id: 'desc', t: 'الوصف', s: 'عرّف العملاء بالمكان', f: [
        { k: 'description', l: 'نبذة قصيرة', kind: 'i18n', long: 1, rows: 3, max: 180, req: 1 },
        { k: 'fullDescription', l: 'الوصف الكامل', kind: 'i18n', long: 1, rows: 6, max: 2500 } ] },
      { id: 'photos', t: 'الصور', s: 'أول صورة هي الغلاف — المكان، الأكل، الجلسات', f: [{ k: 'gallery', kind: 'gallery', max: 15, min: 3 }] },
      { id: 'menu', t: 'المنيو', s: 'الأقسام والأصناف والأسعار — بتظهر للعميل في صفحة المطعم وبعد مسح الـ QR', f: [{ k: 'menu', kind: 'menu' }] },
      { id: 'contact', t: 'الموقع والتواصل', s: 'العنوان ومواعيد العمل', f: [
        { k: 'location', l: 'المنطقة', kind: 'i18n', req: 1, max: 80, ph: 'مثال: خليج نعمة', w: 'half' },
        { k: 'openHours', l: 'مواعيد العمل', kind: 'i18n', max: 80, ph: 'يوميًا 10:00 ص - 2:00 ص', w: 'half' },
        { k: 'address_full', l: 'العنوان بالتفصيل', kind: 'text', ph: 'الشارع، المبنى، علامة مميزة', w: 'full' },
        { k: 'phone', l: 'التليفون', kind: 'text', dir: 'ltr', ph: '+20 10 0000 0000', w: 'half' },
        { k: 'google_maps_url', l: 'رابط Google Maps', kind: 'text', dir: 'ltr', ph: 'https://maps.google.com/…', w: 'half' },
        { k: 'coordinates.lat', l: 'خط العرض (Latitude)', kind: 'num', signed: 1, ph: '27.9158', w: 'half' },
        { k: 'coordinates.lng', l: 'خط الطول (Longitude)', kind: 'num', signed: 1, ph: '34.3300', w: 'half' } ] },
    ],
    need: [['الموقع (المنطقة)', d => hasText(d.location), 'contact']],
    checks: [
      ['الاسم', d => hasText(d.name)], ['النوع (مطعم/كافيه)', d => !!d.venueType], ['نبذة قصيرة', d => hasText(d.description)], ['3 صور على الأقل', d => (d.gallery || []).length >= 3],
      ['صنف واحد على الأقل في المنيو', d => (d.menu || []).some(c => (c.items || []).length)], ['المنطقة', d => hasText(d.location)], ['مواعيد العمل', d => hasText(d.openHours)],
      ['التليفون', d => !!String(d.phone || '').trim()], ['الإحداثيات (للخريطة)', d => d.coordinates && d.coordinates.lat && d.coordinates.lng],
    ],
  },
  branch: {
    title: 'فرع', nameKey: 'name', icon: '📍', imageReq: false, descReq: false,
    sections: [
      { id: 'basic', t: 'بيانات الفرع', s: 'اسم الفرع وعنوانه — الفرع الجديد بيحتاج موافقة الإدارة قبل ما يظهر للعملاء', f: [
        { k: 'name', l: 'اسم الفرع', kind: 'i18n', req: 1, max: 80, ph: 'مثال: فرع خليج نعمة' },
        { k: 'area', l: 'المنطقة', kind: 'i18n', w: 'half', max: 60, ph: 'مثال: خليج نعمة' },
        { k: 'openHours', l: 'مواعيد العمل', kind: 'i18n', w: 'half', max: 80, ph: 'يوميًا 10:00 ص - 2:00 ص' },
        { k: 'address', l: 'العنوان', kind: 'i18n', req: 1, long: 1, rows: 2, max: 200, ph: 'الشارع، المبنى، علامة مميزة' } ] },
      { id: 'contact', t: 'التواصل والخريطة', s: 'عشان العميل يوصل للفرع', f: [
        { k: 'phone', l: 'تليفون الفرع', kind: 'text', dir: 'ltr', w: 'half', ph: '+20 10 0000 0000' },
        { k: 'google_maps_url', l: 'رابط Google Maps', kind: 'text', dir: 'ltr', w: 'half', ph: 'https://maps.google.com/…' },
        { k: 'lat', l: 'خط العرض (Latitude)', kind: 'num', signed: 1, w: 'half', ph: '27.9158' },
        { k: 'lng', l: 'خط الطول (Longitude)', kind: 'num', signed: 1, w: 'half', ph: '34.3300' } ] },
      { id: 'photos', t: 'صور الفرع', s: 'اختياري — أول صورة هي الغلاف', f: [{ k: 'gallery', kind: 'gallery', max: 8, min: 1 }] },
    ],
    checks: [['اسم الفرع', d => hasText(d.name)], ['العنوان', d => hasText(d.address)], ['المنطقة', d => hasText(d.area)], ['مواعيد العمل', d => hasText(d.openHours)], ['التليفون', d => !!String(d.phone || '').trim()], ['رابط أو إحداثيات الخريطة', d => !!String(d.google_maps_url || '').trim() || (d.lat && d.lng)]],
  },
  transfer: {
    title: 'سيارة', nameKey: 'vehicleType', icon: '🚐',
    sections: [
      { id: 'basic', t: 'بيانات السيارة', s: 'النوع والسعة', f: [
        { k: 'vehicleType', l: 'نوع السيارة', kind: 'i18n', req: 1, max: 60, ph: 'مثال: ميني فان مرسيدس V-Class' },
        { k: 'capacity', l: 'عدد الركاب', kind: 'stepper', req: 1, min: 1, max: 60, help: 'أقصى عدد ركاب مع الشنط.' } ] },
      { id: 'desc', t: 'الوصف', s: 'ميزات الخدمة', f: [{ k: 'description', l: 'وصف الخدمة', kind: 'i18n', long: 1, rows: 4, max: 400, req: 1 }] },
      { id: 'photos', t: 'صور السيارة', s: 'أول صورة هي الغلاف', f: [{ k: 'gallery', kind: 'gallery', max: 8, min: 2 }] },
      { id: 'feat', t: 'المميزات', s: 'اللي بيميّز خدمتك', f: [{ k: 'features', l: 'مميزات السيارة', kind: 'tags', presets: 'features', ph: 'أضيف ميزة واضغط Enter', hideLabel: 1 }] },
    ],
    price: { k: 'price', l: 'سعر الرحلة', suffix: 'EGP', help: 'سعر السيارة للرحلة الواحدة.' },
    checks: [
      ['نوع السيارة', d => hasText(d.vehicleType)], ['عدد الركاب', d => d.capacity > 0], ['السعر', d => d.price > 0], ['وصف الخدمة', d => hasText(d.description)],
      ['صورتين على الأقل', d => (d.gallery || []).length >= 2], ['3 مميزات على الأقل', d => d.features && Math.max(0, ...Object.values(d.features).map(a => (a || []).length)) >= 3],
    ],
  },
};
// Journal posts and destinations: stored ONLY in the GitHub data repo (api/journal, api/destinations), super admin only. Same full-page editor + AI translation.
SPEC.journal = {
  title: 'تدوينة', fem: 1, nameKey: 'title', icon: '📰', descReq: false,
  sections: [
    { id: 'basic', t: 'بيانات التدوينة', s: 'العنوان والكاتب ووقت القراءة', f: [
      { k: 'title', l: 'عنوان التدوينة', kind: 'i18n', req: 1, max: 120, ph: 'مثال: أفضل ٥ أماكن للسنوركل في شرم الشيخ' },
      { k: 'author', l: 'الكاتب', kind: 'text', w: 'half', ph: 'اسم الكاتب (اختياري)' },
      { k: 'readTimeMinutes', l: 'وقت القراءة (بالدقايق)', kind: 'num', w: 'half', ph: '5' },
      { k: 'excerpt', l: 'مقتطف', kind: 'i18n', long: 1, rows: 3, max: 220, help: 'سطرين بيظهروا على كارت التدوينة في القائمة.' } ] },
    { id: 'photos', t: 'صور السلايدر', s: 'أول صورة هي الغلاف — كل الصور بتظهر في السلايدر أعلى صفحة التدوينة', f: [{ k: 'gallery', kind: 'gallery', max: 12, min: 1 }] },
    { id: 'body', t: 'نص التدوينة (HTML)', s: 'اكتب بالـ HTML وظبّط الشكل براحتك — الترجمة التلقائية بتترجم النصوص بس وتسيب الوسوم والستايل زي ما هي', f: [
      { k: 'content', l: 'المحتوى', kind: 'html', rows: 18, ph: '<h2>عنوان فرعي</h2>\n<p>فقرة…</p>\n<img src="https://…" style="width:100%;border-radius:16px">',
        help: 'مسموح: عناوين، فقرات، قوايم، جداول، صور، روابط، فيديو يوتيوب (iframe)، و style="…" على أي عنصر. بيتشال تلقائيًا: <script> و <style> وأي onclick=.' } ] },
  ],
  checks: [['العنوان', d => hasText(d.title)], ['صورة واحدة على الأقل', d => (d.gallery || []).length >= 1], ['المقتطف', d => hasText(d.excerpt)], ['نص التدوينة', d => hasText(d.content)], ['الكاتب', d => !!String(d.author || '').trim()]],
};
SPEC.destination = {
  title: 'وجهة', fem: 1, nameKey: 'name', icon: '📍',
  sections: [
    { id: 'basic', t: 'المعلومات الأساسية', s: 'الاسم والموقع والشعار', f: [
      { k: 'name', l: 'اسم الوجهة', kind: 'i18n', req: 1, max: 80, ph: 'مثال: خليج نعمة' },
      { k: 'tagline', l: 'الشعار', kind: 'i18n', max: 100, ph: 'جملة قصيرة تعرّف بالمكان' },
      { k: 'location', l: 'الموقع', kind: 'i18n', max: 100, ph: 'مثال: شرم الشيخ' } ] },
    { id: 'desc', t: 'الوصف', s: 'نبذة قصيرة + وصف كامل', f: [
      { k: 'description', l: 'نبذة قصيرة', kind: 'i18n', long: 1, rows: 3, max: 180, req: 1 },
      { k: 'fullDescription', l: 'الوصف الكامل', kind: 'i18n', long: 1, rows: 8, max: 3000 } ] },
    { id: 'photos', t: 'الصور', s: 'أول صورة هي الغلاف — بتظهر كسلايدر أعلى الصفحة', f: [{ k: 'gallery', kind: 'gallery', max: 12, min: 3 }] },
    { id: 'contact', t: 'الموقع على الخريطة', s: 'اختياري', f: [
      { k: 'phone', l: 'التليفون', kind: 'text', dir: 'ltr', w: 'half', ph: '+20 …' },
      { k: 'google_maps_url', l: 'رابط Google Maps', kind: 'text', dir: 'ltr', w: 'half', ph: 'https://maps.google.com/…' },
      { k: 'google_place_id', l: 'Google Place ID', kind: 'text', dir: 'ltr', w: 'half' },
      { k: 'rating', l: 'التقييم (0-5)', kind: 'num', w: 'half', ph: '4.7' },
      { k: 'review_count', l: 'عدد التقييمات', kind: 'num', w: 'half', ph: '120' },
      { k: 'coordinates.lat', l: 'خط العرض (Latitude)', kind: 'num', signed: 1, w: 'half', ph: '27.9158' },
      { k: 'coordinates.lng', l: 'خط الطول (Longitude)', kind: 'num', signed: 1, w: 'half', ph: '34.3300' } ] },
  ],
  checks: [['الاسم', d => hasText(d.name)], ['نبذة قصيرة', d => hasText(d.description)], ['3 صور على الأقل', d => (d.gallery || []).length >= 3], ['الوصف الكامل', d => hasText(d.fullDescription)], ['الموقع', d => hasText(d.location)]],
};
const ROOM_NEW = () => ({ type: {}, price: '', size: '', beds: {}, guests: 2, baseOccupancy: 2, extraAdultFee: '', freeChildrenPerRoom: 0, extraChildFee: '', image: '', description: {}, childPricingTiers: [] });

DS.itemEditor = (host, o) => {
  const spec = SPEC[o.type], item = clone(o.item);
  const ORIG = clone(o.item || {});                            // untouched copy: D is edited live, so change detection must compare against this
  const D = item;                                             // working copy
  D.gallery = (Array.isArray(item.images) && item.images.length ? item.images : (item.image ? [item.image] : [])).slice();
  if (o.type === 'hotel') (D.rooms || (D.rooms = [])).forEach(r => { r.childPricingTiers = r.childPricingTiers || []; });
  if (o.type === 'excursion') D.itinerary = D.itinerary || [];
  if (o.type === 'restaurant') D.menu = D.menu || [];
  const hasAr = String(tr((item[spec.nameKey] || {}).ar) || '').trim(), hasEn = String(((item[spec.nameKey] || {}).en) || '').trim();
  let cur = (!hasAr && hasEn) ? 'en' : 'ar', dirty = false, open = new Set([0]), mon = new Date(), anchor = null, rangeMode = false;
  const isNew = !o.item || !o.item.id;
  const fillLangs = k => LANGS.filter(l => String((D[k] || {})[l] || '').trim());

  // ---------- field renderers ----------
  const lab = (f, extra = '') => f.l && !f.hideLabel ? `<label class="edl">${esc(f.l)}${f.req ? '<i class="rq">*</i>' : ''}${extra}</label>` : '';
  const help = f => f.help ? `<div class="edh">${esc(f.help)}</div>` : '';
  const fb = (path, obj) => { const v = getP(D, path) || {}; const alt = LANGS.map(l => v[l]).find(Boolean); return !v[cur] && alt ? alt : ''; };
  function i18nInput(path, f, val) {
    const v = (val && val[cur]) || '', ph = f.ph || '';
    const cnt = f.max ? `<span class="cnt" data-cnt="${path}">${v.length}/${f.max}</span>` : '';
    const dir = cur === 'ar' ? 'rtl' : 'ltr';
    return f.long ? `<textarea class="edi" dir="${dir}" rows="${f.rows || 4}" data-path="${path}" data-ty="i18n" ${f.max ? `maxlength="${f.max}"` : ''} placeholder="${esc(ph)}">${esc(v)}</textarea>${cnt}`
                  : `<input class="edi" dir="${dir}" data-path="${path}" data-ty="i18n" ${f.max ? `maxlength="${f.max}"` : ''} value="${esc(v)}" placeholder="${esc(ph)}">${cnt}`;
  }
  const K = {
    i18n: f => `<div class="edf-in">${lab(f)}<div class="wrapi">${i18nInput(f.k, f, D[f.k])}</div>${help(f)}</div>`,
    html: f => {
      const v = ((D[f.k] || {})[cur]) || '', pv = (h) => `<!doctype html><meta charset="utf-8"><body dir="${cur === 'ar' ? 'rtl' : 'ltr'}" style="font:15px/1.8 system-ui,sans-serif;margin:14px;color:#222">${h}`;
      return `<div class="edf-in">${lab(f)}<div class="wrapi"><textarea class="edi code" dir="ltr" spellcheck="false" rows="${f.rows || 16}" data-path="${f.k}" data-ty="i18n" data-html="1" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea></div>${help(f)}
        <details class="hprev"><summary>معاينة</summary><iframe sandbox title="preview" data-prev="${f.k}" srcdoc="${esc(pv(v))}"></iframe></details></div>`;
    },
    text: f => `<div class="edf-in">${lab(f)}<div class="wrapi"><input class="edi" ${f.dir ? `dir="${f.dir}"` : ''} data-path="${f.k}" data-ty="text" value="${esc(getP(D, f.k) ?? '')}" placeholder="${esc(f.ph || '')}"></div>${help(f)}</div>`,
    num: f => `<div class="edf-in">${lab(f)}<div class="wrapi num">${f.prefix ? `<span class="fx">${f.prefix}</span>` : ''}<input class="edi" type="number" inputmode="decimal" ${f.signed ? '' : 'min="0"'} step="any" data-path="${f.k}" data-ty="num" value="${getP(D, f.k) ?? ''}" placeholder="${f.ph || ''}">${f.suffix ? `<span class="fx">${f.suffix}</span>` : ''}</div>${help(f)}</div>`,
    stepper: f => `<div class="edf-in">${lab(f)}<div class="stepper"><button type="button" data-act="step" data-k="${f.k}" data-d="-1" aria-label="أقل">−</button><input class="edi" type="number" data-path="${f.k}" data-ty="num" min="${f.min || 0}" max="${f.max || 999}" value="${D[f.k] ?? ''}"><button type="button" data-act="step" data-k="${f.k}" data-d="1" aria-label="أكتر">+</button></div>${help(f)}</div>`,
    chips: f => `<div class="edf-in">${lab(f)}<div class="cchips">${f.opts.map(([v, l, ic]) => `<button type="button" class="cc ${D[f.k] === v ? 'on' : ''}" data-act="cat" data-k="${f.k}" data-v="${esc(String(v))}"><span>${ic || ''}</span>${esc(l)}</button>`).join('')}</div></div>`,
    gallery: f => {
      const g = D.gallery;
      return `<div class="gal" id="gal"><div class="drop" data-act="pick"><b>اسحب الصور هنا أو اضغط للاختيار</b><span>JPG / PNG / WebP — بتتضغط تلقائي · حد أقصى ${f.max} صورة${f.min ? ` · الأفضل ${f.min}+` : ''}</span><input type="file" accept="image/*" multiple hidden></div>
        <div class="gg">${g.map((u, i) => `<div class="gi ${i === 0 ? 'cover' : ''}" draggable="true" data-i="${i}">${DS.safeSrc(u) ? `<img src="${esc(DS.safeSrc(u))}" alt="" loading="lazy">` : ''}${i === 0 ? '<em>الغلاف</em>' : ''}
          <div class="gt">${i ? `<button type="button" data-act="gcover" data-i="${i}" title="اجعلها الغلاف">★</button>` : ''}<button type="button" data-act="gdel" data-i="${i}" title="حذف">✕</button></div></div>`).join('')}</div>
        <div class="gurl"><input class="edi ur" dir="ltr" placeholder="أو الصق رابط صورة (https://…)"><button type="button" class="btn ghost sm" data-act="gadd">إضافة</button></div></div>`;
    },
    tags: f => {
      const list = ((D[f.k] || {})[cur]) || [], pre = PRE[f.presets] || [];
      const avail = pre.filter(p => !(((D[f.k] || {})[cur] || []).includes(p[cur === 'ar' ? 'ar' : 'en'])));
      return `<div class="edf-in">${lab(f, `<span class="cnt" style="margin-inline-start:auto">${list.length}</span>`)}<div class="tagbox"><div class="tl">${list.map((t, i) => `<span class="tg">${esc(t)}<button type="button" data-act="tdel" data-k="${f.k}" data-i="${i}" aria-label="حذف">×</button></span>`).join('') || '<span class="edh">لسه مفيش بنود</span>'}</div>
        <input class="edi tin" dir="${cur === 'ar' ? 'rtl' : 'ltr'}" data-tk="${f.k}" placeholder="${esc(f.ph || '')}"></div>
        ${avail.length ? `<div class="sug"><span>اقتراحات:</span>${avail.map(p => `<button type="button" data-act="tpre" data-k="${f.k}" data-en="${esc(p.en)}" data-ar="${esc(p.ar)}">+ ${esc(cur === 'ar' ? p.ar : p.en)}</button>`).join('')}</div>` : ''}</div>`;
    },
    itinerary: f => {
      const L = D.itinerary;
      return `<div class="iti">${L.map((r, i) => `<div class="ir"><div class="dot"><b>${i + 1}</b></div><div class="irb">
        <div class="irh"><input class="edi tm" type="time" data-path="itinerary.${i}.time" data-ty="text" value="${esc(r.time || '')}"><div class="mv"><button type="button" data-act="iup" data-i="${i}" ${i ? '' : 'disabled'}>↑</button><button type="button" data-act="idn" data-i="${i}" ${i < L.length - 1 ? '' : 'disabled'}>↓</button><button type="button" data-act="idel" data-i="${i}">حذف</button></div></div>
        <div class="wrapi">${i18nInput(`itinerary.${i}.title`, { ph: 'عنوان الخطوة: مثال: الإبحار نحو الشعاب' }, r.title)}</div>
        <div class="wrapi">${i18nInput(`itinerary.${i}.description`, { long: 1, rows: 2, ph: 'تفاصيل الخطوة (اختياري)' }, r.description)}</div></div></div>`).join('')}
        <button type="button" class="btn ghost" data-act="iadd">+ إضافة خطوة</button></div>`;
    },
    menu: f => {
      const M = D.menu;
      return `<div class="menu">${M.map((c, i) => `<div class="mcat"><div class="mch"><span class="rn">${i + 1}</span><div class="wrapi">${i18nInput(`menu.${i}.category`, { ph: 'اسم القسم: مثال: المقبلات', max: 50 }, c.category)}</div>
        <div class="mv"><button type="button" data-act="mup" data-i="${i}" ${i ? '' : 'disabled'}>↑</button><button type="button" data-act="mdn" data-i="${i}" ${i < M.length - 1 ? '' : 'disabled'}>↓</button><button type="button" data-act="mdel" data-i="${i}">حذف القسم</button></div></div>
        ${(c.items || []).map((it, j) => `<div class="mit"><div class="wrapi">${i18nInput(`menu.${i}.items.${j}.name`, { ph: 'اسم الصنف', max: 70 }, it.name)}</div>
          <div class="wrapi num"><input class="edi" type="number" min="0" step="any" data-path="menu.${i}.items.${j}.price" data-ty="num" value="${it.price ?? ''}" placeholder="السعر"><span class="fx">EGP</span></div>
          <button type="button" class="x2" data-act="midel" data-i="${i}" data-j="${j}" aria-label="حذف الصنف">✕</button>
          <div class="wrapi mdesc">${i18nInput(`menu.${i}.items.${j}.description`, { ph: 'وصف قصير (اختياري): المكونات…', max: 140 }, it.description)}</div></div>`).join('')}
        <button type="button" class="btn ghost sm" data-act="miadd" data-i="${i}">+ إضافة صنف</button></div>`).join('')}
        <button type="button" class="btn ghost" data-act="madd">+ إضافة قسم في المنيو</button></div>`;
    },
    rooms: f => {
      const R = D.rooms;
      const num = (path, l, ph, sfx) => `<div class="edf-in"><label class="edl">${l}</label><div class="wrapi num"><input class="edi" type="number" min="0" step="any" data-path="${path}" data-ty="num" value="${getP(D, path) ?? ''}" placeholder="${ph || ''}">${sfx ? `<span class="fx">${sfx}</span>` : ''}</div></div>`;
      return `<div class="rooms">${R.map((r, i) => `<div class="room ${open.has(i) ? 'open' : ''}"><div class="rh" data-act="rtoggle" data-i="${i}"><span class="rn">${i + 1}</span><div><b>${esc(tr(r.type) || 'غرفة جديدة')}</b><small>${r.price ? Number(r.price).toLocaleString('en') + ' EGP / ليلة' : 'لم يُحدد السعر'}${r.guests ? ` · ${r.guests} ضيف` : ''}${r.size ? ` · ${esc(r.size)}` : ''}</small></div>
        <span class="rb2"><button type="button" data-act="rdup" data-i="${i}" title="نسخ">⧉</button><button type="button" data-act="rdel" data-i="${i}" title="حذف">🗑</button><i class="ch">⌄</i></span></div>
        <div class="rbody"><div class="g6">
          <div class="edf-in c6"><label class="edl">نوع الغرفة<i class="rq">*</i></label><div class="wrapi">${i18nInput(`rooms.${i}.type`, { ph: 'مثال: غرفة ديلوكس بإطلالة بحرية', max: 60 }, r.type)}</div></div>
          ${`<div class="c2">${num(`rooms.${i}.price`, 'السعر / ليلة', '', 'EGP')}</div>`}
          <div class="edf-in c2"><label class="edl">المساحة</label><div class="wrapi"><input class="edi" data-path="rooms.${i}.size" data-ty="text" value="${esc(r.size || '')}" placeholder="35 م²"></div></div>
          <div class="c2">${num(`rooms.${i}.guests`, 'أقصى عدد ضيوف', '2')}</div>
          <div class="edf-in c3"><label class="edl">الأسرّة</label><div class="wrapi">${i18nInput(`rooms.${i}.beds`, { ph: 'مثال: سرير كينج أو سريرين', max: 60 }, r.beds)}</div></div>
          <div class="c3">${num(`rooms.${i}.baseOccupancy`, 'الإشغال الأساسي', '2')}</div>
          <div class="c2">${num(`rooms.${i}.extraAdultFee`, 'رسوم بالغ إضافي', '', 'EGP')}</div><div class="c2">${num(`rooms.${i}.freeChildrenPerRoom`, 'أطفال مجانًا / غرفة', '0')}</div><div class="c2">${num(`rooms.${i}.extraChildFee`, 'رسوم طفل إضافي', '', 'EGP')}</div>
          <div class="edf-in c6"><label class="edl">وصف الغرفة</label><div class="wrapi">${i18nInput(`rooms.${i}.description`, { long: 1, rows: 3, max: 400, ph: 'المميزات والإطلالة…' }, r.description)}</div></div>
          <div class="edf-in c6"><label class="edl">صورة الغرفة</label><div class="rimg">${r.image && DS.safeSrc(r.image) ? `<img src="${esc(DS.safeSrc(r.image))}" alt="">` : '<span>لا توجد صورة</span>'}<div><button type="button" class="btn ghost sm" data-act="rimg" data-i="${i}">رفع صورة</button>${r.image ? `<button type="button" class="btn ghost sm" data-act="rimgdel" data-i="${i}">إزالة</button>` : ''}<input type="file" accept="image/*" hidden></div></div></div>
          <div class="c6 tiers"><label class="edl">سياسة أسعار الأطفال حسب العمر <span class="edh" style="display:inline">(اختياري)</span></label>
            ${(r.childPricingTiers || []).map((t, j) => `<div class="tr3"><div>${num(`rooms.${i}.childPricingTiers.${j}.minAge`, 'من سن', '0')}</div><div>${num(`rooms.${i}.childPricingTiers.${j}.maxAge`, 'إلى سن', '11')}</div><div>${num(`rooms.${i}.childPricingTiers.${j}.fee`, 'الرسوم / ليلة', '', 'EGP')}</div><button type="button" class="x2" data-act="tierdel" data-i="${i}" data-j="${j}" aria-label="حذف">✕</button></div>`).join('')}
            <button type="button" class="btn ghost sm" data-act="tieradd" data-i="${i}">+ إضافة شريحة عمرية</button></div>
        </div></div></div>`).join('')}<button type="button" class="btn ghost" data-act="radd">+ إضافة نوع غرفة</button></div>`;
    },
    dates: f => {
      const y = mon.getFullYear(), m = mon.getMonth(), first = new Date(y, m, 1), lead = (first.getDay() + 1) % 7, days = new Date(y, m + 1, 0).getDate(), set = new Set(D.unavailableDates || []);
      const MN = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'], DN = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'], iso = d => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      let cells = ''; for (let i = 0; i < lead; i++) cells += '<span class="o"></span>';
      for (let d = 1; d <= days; d++) cells += `<button type="button" class="dc ${set.has(iso(d)) ? 'blk' : ''} ${anchor === iso(d) ? 'anc' : ''}" data-act="day" data-d="${iso(d)}">${d}</button>`;
      return `<div class="dcal"><div class="dh"><button type="button" data-act="mon" data-d="1">›</button><b>${MN[m]} ${y}</b><button type="button" data-act="mon" data-d="-1">‹</button></div><div class="dg">${DN.map(x => `<i>${x}</i>`).join('')}${cells}</div>
        <div class="dfoot"><label class="sw"><input type="checkbox" data-act="rmode" ${rangeMode ? 'checked' : ''}><span>تحديد فترة (اضغط أول يوم وآخر يوم)</span></label><span class="edh">${set.size} يوم محجوب</span>${set.size ? '<button type="button" class="btn ghost sm" data-act="dclear">مسح الكل</button>' : ''}</div></div>`;
    },
  };
  const field = f => `<div class="edf ${f.w || 'full'}" data-f="${f.k}">${K[f.kind](f)}</div>`;
  const sections = () => spec.sections.map((s, i) => `<section class="edc" id="sec-${s.id}"><header><span class="si">${i + 1}</span><div><h3>${s.t}</h3><p>${s.s || ''}</p></div></header><div class="edg">${s.f.map(field).join('')}</div></section>`).join('');

  // ---------- side column ----------
  const score = () => { const r = spec.checks.map(([l, fn]) => [l, !!fn(D)]); return { r, pct: Math.round(r.filter(x => x[1]).length / r.length * 100) }; };
  const sideHtml = () => {
    const { r, pct } = score(), p = spec.price;
    return `${p ? `<div class="edc side-c"><h4>${p.l}</h4><div class="wrapi num big"><input class="edi" type="number" min="0" step="any" data-path="${p.k}" data-ty="num" value="${D[p.k] ?? ''}" placeholder="0"><span class="fx">${p.suffix}</span></div><div class="edh">${p.help}</div></div>` : ''}
      <div class="edc side-c"><h4>اكتمال الصفحة <b class="pc2" id="pct">${pct}%</b></h4><div class="pbar"><i id="pbar" style="width:${pct}%"></i></div><ul class="ck" id="ck">${r.map(([l, ok]) => `<li class="${ok ? 'ok' : ''}">${l}</li>`).join('')}</ul></div>
      <div id="sidex"></div>`;
  };
  const refreshScore = () => { const { r, pct } = score(); $('#pct', host).textContent = pct + '%'; $('#pbar', host).style.width = pct + '%'; $('#ck', host).innerHTML = r.map(([l, ok]) => `<li class="${ok ? 'ok' : ''}">${l}</li>`).join(''); };
  const langBtns = () => [['ar', 'العربية'], ['en', 'English']].map(([l, n]) => `<button type="button" class="lb ${l === cur ? 'on' : ''}" data-act="lang" data-l="${l}">${n}</button>`).join('');

  // ---------- page ----------
  host.innerHTML = `<div class="ed"><div class="edbar"><button type="button" class="ib" data-act="back" aria-label="رجوع">→</button><div class="ett"><h2>${isNew ? 'إضافة ' + spec.title + (spec.fem ? ' جديدة' : ' جديد') : 'تعديل: ' + esc(tr(item[spec.nameKey]) || item.id)}</h2><span class="edh" id="dirty">${isNew ? 'لسه ما اتحفظش' : 'كل التعديلات محفوظة'}</span></div>
    <div class="lsw"><small>لغة الإدخال</small><div id="langs">${langBtns()}</div></div>
    <button type="button" class="btn ghost" data-act="back">إلغاء</button><button type="button" class="btn" id="saveb" data-act="save">حفظ ${isNew ? 'ونشر' : 'التعديلات'}</button></div>
    <div class="edgrid"><div class="edmain" id="edmain"><div class="edc tbanner"><span class="si">🌐</span><div><b>اكتب بلغة واحدة بس</b><p>اختار <b>العربية</b> أو <b>English</b> من فوق وأدخل كل البيانات بيها. عند الحفظ بتتترجم تلقائيًا لباقي لغات الموقع: <span id="tl"></span>.</p></div></div>${sections()}</div><aside class="edside" id="edside">${sideHtml()}</aside></div></div>`;
  const root = $('.ed', host), main = $('#edmain', host);
  const tlabel = () => { $('#tl', host).textContent = LANGS.filter(l => l !== cur).map(l => LN[l]).join('، '); }; tlabel();
  if (o.side) o.side($('#sidex', host), D);                                           // admin extras (owner, status…)
  if (o.extra) $('#sidex', host).insertAdjacentHTML('afterbegin', `<div class="edc side-c"><h4>إعدادات الإدارة</h4>${o.extra.map(x => x.kind === 'bool' ? `<label class="sw" style="margin-bottom:10px"><input type="checkbox" data-path="${x.k}" data-ty="bool" ${D[x.k] ? 'checked' : ''}><span>${esc(x.l)}</span></label>` : `<div class="edf-in" style="margin-bottom:10px"><label class="edl">${esc(x.l)}</label><div class="wrapi num"><input class="edi" type="number" step="any" min="0" data-path="${x.k}" data-ty="num" value="${D[x.k] ?? ''}"></div></div>`).join('')}</div>`);

  const markDirty = () => { if (!dirty) { dirty = true; $('#dirty', host).textContent = 'فيه تعديلات غير محفوظة'; $('#dirty', host).classList.add('warn'); } };
  const redraw = k => { const f = spec.sections.flatMap(s => s.f).find(x => x.k === k), el = $(`.edf[data-f="${k}"]`, main); if (el && f) el.innerHTML = K[f.kind](f); };
  const redrawAll = () => { const y = window.scrollY; main.innerHTML = sections(); window.scrollTo(0, y); };
  const upload = async files => {
    const max = (spec.sections.flatMap(s => s.f).find(x => x.kind === 'gallery') || {}).max || 12; let n = 0;
    for (const f of files) {
      if (D.gallery.length >= max) { DS.toast('وصلت للحد الأقصى من الصور', true); break; }
      try { DS.toast(`جاري رفع الصورة ${++n} من ${files.length}…`); const { url } = await DS.api('/upload', { method: 'POST', body: { image: await DS.compressImage(f) } }); D.gallery.push(url); markDirty(); redraw('gallery'); } catch (e) { DS.toast(e.message, true); }
    }
    refreshScore(); if (n) DS.toast('تم رفع الصور ✓');
  };

  // ---------- events ----------
  root.addEventListener('input', e => {
    const t = e.target, path = t.dataset.path; if (!path) return;
    const ty = t.dataset.ty; let v;
    if (ty === 'i18n') { let ob = getP(D, path); if (!ob || typeof ob !== 'object') { ob = {}; setP(D, path, ob); } ob[cur] = t.value; const c = $(`[data-cnt="${path}"]`, root); if (c) c.textContent = `${t.value.length}/${t.maxLength}`; if (t.dataset.html) { const fr = $(`iframe[data-prev="${path}"]`, root); if (fr) fr.srcdoc = `<!doctype html><meta charset="utf-8"><body dir="${cur === 'ar' ? 'rtl' : 'ltr'}" style="font:15px/1.8 system-ui,sans-serif;margin:14px;color:#222">${t.value}`; } }
    else { v = ty === 'num' ? (t.value === '' ? '' : Number(t.value)) : ty === 'bool' ? t.checked : t.value; setP(D, path, v); }
    markDirty(); refreshScore();
    if (/^rooms\.\d+\.(type|price|guests|size)/.test(path)) { const i = path.split('.')[1], rh = $(`.room:nth-child(${+i + 1}) .rh div`, root); if (rh) { const r = D.rooms[i]; rh.innerHTML = `<b>${esc(tr(r.type) || 'غرفة جديدة')}</b><small>${r.price ? Number(r.price).toLocaleString('en') + ' EGP / ليلة' : 'لم يُحدد السعر'}${r.guests ? ` · ${r.guests} ضيف` : ''}${r.size ? ` · ${esc(r.size)}` : ''}</small>`; } }
  });
  root.addEventListener('keydown', e => {
    if (e.target.classList.contains('tin') && (e.key === 'Enter' || e.key === ',' || e.key === '،')) { e.preventDefault(); const el = e.target, v = el.value; el.value = ''; addTag(el.dataset.tk, v); }
    if (e.key === 'Enter' && e.target.classList.contains('ur')) { e.preventDefault(); $('[data-act=gadd]', root).click(); }
  });
  root.addEventListener('focusout', e => { const el = e.target; if (el.classList && el.classList.contains('tin') && el.value.trim()) { const v = el.value; el.value = ''; addTag(el.dataset.tk, v); } });
  function addTag(k, v) { v = String(v).trim().replace(/[,،]+$/, ''); if (!v) return; const ob = D[k] || (D[k] = {}); const a = ob[cur] || (ob[cur] = []); if (!a.includes(v)) a.push(v); markDirty(); redraw(k); $(`.edf[data-f="${k}"] .tin`, root)?.focus(); refreshScore(); }
  root.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('#gal input[type=file]')) { const fs = [...t.files]; t.value = ''; upload(fs); }
    if (t.matches('.rimg input[type=file]')) { const i = t.dataset.i, f = t.files[0]; t.value = ''; if (!f) return; try { DS.toast('جاري رفع الصورة…'); const { url } = await DS.api('/upload', { method: 'POST', body: { image: await DS.compressImage(f) } }); D.rooms[i].image = url; markDirty(); redraw('rooms'); } catch (er) { DS.toast(er.message, true); } }
    if (t.dataset.act === 'rmode') { rangeMode = t.checked; anchor = null; redraw('unavailableDates'); }
  });
  // drag & drop: files onto the gallery, reorder thumbnails
  let dragI = null;
  root.addEventListener('dragstart', e => { const g = e.target.closest('.gi'); if (g) { dragI = +g.dataset.i; e.dataTransfer.effectAllowed = 'move'; } });
  root.addEventListener('dragover', e => { if (e.target.closest('#gal')) { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) e.target.closest('.drop,#gal')?.classList.add('over'); } });
  root.addEventListener('dragleave', e => { $$('.over', root).forEach(x => x.classList.remove('over')); });
  root.addEventListener('drop', e => {
    const gal = e.target.closest('#gal'); if (!gal) return; e.preventDefault(); $$('.over', root).forEach(x => x.classList.remove('over'));
    if (e.dataTransfer.files && e.dataTransfer.files.length) { upload([...e.dataTransfer.files].filter(f => /^image\//.test(f.type))); return; }
    const to = e.target.closest('.gi'); if (to != null && dragI != null) { const j = +to.dataset.i; D.gallery.splice(j, 0, D.gallery.splice(dragI, 1)[0]); dragI = null; markDirty(); redraw('gallery'); refreshScore(); }
  });
  // ---------- auto-translation: every translatable value -> all site languages ----------
  const filled = v => Array.isArray(v) ? v.some(x => String(x || '').trim()) : !!String(v || '').trim();
  function holders(out) {
    const hs = [];
    for (const f of spec.sections.flatMap(x => x.f)) if (f.kind === 'i18n' || f.kind === 'tags') hs.push({ o: out, k: f.k, path: f.k, list: f.kind === 'tags' });
    (out.itinerary || []).forEach((r, i) => ['title', 'description'].forEach(k => hs.push({ o: r, k, path: `itinerary.${i}.${k}`, list: false })));
    (out.menu || []).forEach((c, i) => { hs.push({ o: c, k: 'category', path: `menu.${i}.category`, list: false }); (c.items || []).forEach((it, j) => ['name', 'description'].forEach(k => hs.push({ o: it, k, path: `menu.${i}.items.${j}.${k}`, list: false }))); });
    (out.rooms || []).forEach((r, i) => ['type', 'beds', 'description'].forEach(k => hs.push({ o: r, k, path: `rooms.${i}.${k}`, list: false })));
    return hs.filter(h => h.o[h.k] && typeof h.o[h.k] === 'object' && Object.values(h.o[h.k]).some(filled));
  }
  async function translateAll(out, progress) {
    const jobs = {}, plan = [];                                      // jobs[lang] = Set(texts); plan = what to write back afterwards
    for (const h of holders(out)) {
      const v = h.o[h.k], orig = getP(ORIG, h.path) || {};
      const sl = filled(v[cur]) ? cur : ['ar', 'en', ...LANGS].find(l => filled(v[l]));                // the language this value was typed in
      const src = h.list ? (v[sl] || []).map(x => String(x).trim()).filter(Boolean) : String(v[sl]).trim();
      const same = JSON.stringify(orig[sl] ?? null) === JSON.stringify(h.list ? src : src);
      for (const L of LANGS) {
        if (L === sl) continue;
        const have = h.list ? (v[L] || []).length === src.length && src.length : filled(v[L]);
        if (have && same) continue;                                  // unchanged and already translated -> keep (saves quota, keeps manual fixes)
        (jobs[L] ||= new Set()); (h.list ? src : [src]).forEach(t => jobs[L].add(t));
        plan.push({ h, L, src, sl });
      }
      if (h.list) v[sl] = src;
    }
    const langs = Object.keys(jobs); if (!langs.length) return;
    const maps = {}; let done = 0;
    await Promise.all(langs.map(async L => {
      const bySrc = {};                                              // a text can come from different source languages -> translate per source language
      for (const t of jobs[L]) { const sl = plan.find(p => p.L === L && (p.h.list ? p.src.includes(t) : p.src === t)).sl; (bySrc[sl] ||= []).push(t); }
      maps[L] = {};
      for (const [sl, texts] of Object.entries(bySrc)) { const r = await DS.translate(sl, L, texts); texts.forEach((t, i) => { maps[L][t] = r[i]; }); }
      progress(`${++done}/${langs.length}`);
    }));
    for (const { h, L, src } of plan) h.o[h.k][L] = h.list ? src.map(t => maps[L][t]) : maps[L][src];
  }
  // HTML bodies: translate ONLY the text nodes, then put the translated texts back into the same markup (tags, classes, styles, images untouched)
  const NO_TR = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA']);
  function htmlParts(html) {
    const doc = new DOMParser().parseFromString('<body>' + html, 'text/html'), nodes = [], w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { if (!n.nodeValue.trim()) continue; let p = n.parentNode, skip = false; while (p && p !== doc.body) { if (NO_TR.has(p.nodeName)) { skip = true; break; } p = p.parentNode; } if (!skip) nodes.push(n); }
    return { doc, nodes };
  }
  async function translateHtml(out, progress) {
    for (const f of spec.sections.flatMap(x => x.f).filter(x => x.kind === 'html')) {
      const v = out[f.k]; if (!v || typeof v !== 'object') continue;
      const sl = filled(v[cur]) ? cur : ['ar', 'en', ...LANGS].find(l => filled(v[l])); if (!sl) continue;
      const src = v[sl], same = ((getP(ORIG, f.k) || {})[sl]) === src;
      for (const L of LANGS) {
        if (L === sl || (filled(v[L]) && same)) continue;              // unchanged and already translated -> keep
        const { doc, nodes } = htmlParts(src), texts = nodes.map(n => n.nodeValue.trim()), done = [];
        for (let i = 0; i < texts.length;) { let j = i, chars = 0; while (j < texts.length && j - i < 40 && chars + texts[j].length <= 12000) chars += texts[j++].length; if (j === i) j++; done.push(...await DS.translate(sl, L, texts.slice(i, j))); i = j; }
        nodes.forEach((n, k) => { const o2 = n.nodeValue; n.nodeValue = o2.match(/^\s*/)[0] + (done[k] || texts[k]) + o2.match(/\s*$/)[0]; });
        v[L] = doc.body.innerHTML; progress(L);
      }
    }
  }
  const A = {
    back: () => { if (dirty && !confirm('فيه تعديلات ما اتحفظتش. تخرج من غير حفظ؟')) return; window.onbeforeunload = null; o.onBack(); },
    lang: b => { cur = b.dataset.l; $$('#langs .lb', host).forEach(x => x.classList.toggle('on', x.dataset.l === cur)); tlabel(); redrawAll(); },
    cat: b => { const fl = spec.sections.flatMap(x => x.f).find(x => x.k === b.dataset.k); D[b.dataset.k] = fl && fl.num ? Number(b.dataset.v) : b.dataset.v; markDirty(); redraw(b.dataset.k); refreshScore(); },
    step: b => { const k = b.dataset.k; D[k] = Math.max(1, (Number(D[k]) || 0) + Number(b.dataset.d)); markDirty(); redraw(k); refreshScore(); },
    pick: b => $('input[type=file]', b).click(),
    gdel: b => { D.gallery.splice(+b.dataset.i, 1); markDirty(); redraw('gallery'); refreshScore(); },
    gcover: b => { D.gallery.unshift(D.gallery.splice(+b.dataset.i, 1)[0]); markDirty(); redraw('gallery'); },
    gadd: () => { const i = $('.ur', root), u = i.value.trim(); if (!/^https?:\/\//i.test(u)) return DS.toast('الرابط لازم يبدأ بـ https://', true); D.gallery.push(u); markDirty(); redraw('gallery'); refreshScore(); },
    tdel: b => { D[b.dataset.k][cur].splice(+b.dataset.i, 1); markDirty(); redraw(b.dataset.k); refreshScore(); },
    tpre: b => { const k = b.dataset.k, ob = D[k] || (D[k] = {}); for (const l of ['en', 'ar']) { const a = ob[l] || (ob[l] = []), v = b.dataset[l]; if (!a.includes(v)) a.push(v); } markDirty(); redraw(k); refreshScore(); },
    iadd: () => { D.itinerary.push({ time: '', title: {}, description: {} }); markDirty(); redraw('itinerary'); refreshScore(); },
    idel: b => { D.itinerary.splice(+b.dataset.i, 1); markDirty(); redraw('itinerary'); refreshScore(); },
    iup: b => { const i = +b.dataset.i; D.itinerary.splice(i - 1, 0, D.itinerary.splice(i, 1)[0]); markDirty(); redraw('itinerary'); },
    idn: b => { const i = +b.dataset.i; D.itinerary.splice(i + 1, 0, D.itinerary.splice(i, 1)[0]); markDirty(); redraw('itinerary'); },
    madd: () => { D.menu.push({ category: {}, items: [{ name: {}, price: '', description: {} }] }); markDirty(); redraw('menu'); refreshScore(); },
    mdel: b => { if (!confirm('حذف القسم وكل أصنافه؟')) return; D.menu.splice(+b.dataset.i, 1); markDirty(); redraw('menu'); refreshScore(); },
    mup: b => { const i = +b.dataset.i; D.menu.splice(i - 1, 0, D.menu.splice(i, 1)[0]); markDirty(); redraw('menu'); },
    mdn: b => { const i = +b.dataset.i; D.menu.splice(i + 1, 0, D.menu.splice(i, 1)[0]); markDirty(); redraw('menu'); },
    miadd: b => { D.menu[+b.dataset.i].items.push({ name: {}, price: '', description: {} }); markDirty(); redraw('menu'); refreshScore(); },
    midel: b => { D.menu[+b.dataset.i].items.splice(+b.dataset.j, 1); markDirty(); redraw('menu'); refreshScore(); },
    radd: () => { D.rooms.push(ROOM_NEW()); open = new Set([D.rooms.length - 1]); markDirty(); redraw('rooms'); refreshScore(); },
    rdel: b => { if (!confirm('حذف نوع الغرفة ده؟')) return; D.rooms.splice(+b.dataset.i, 1); open = new Set(); markDirty(); redraw('rooms'); refreshScore(); },
    rdup: b => { const c = clone(D.rooms[+b.dataset.i]); D.rooms.splice(+b.dataset.i + 1, 0, c); open = new Set([+b.dataset.i + 1]); markDirty(); redraw('rooms'); },
    rtoggle: b => { const i = +b.dataset.i; open.has(i) ? open.delete(i) : open.add(i); b.closest('.room').classList.toggle('open', open.has(i)); },
    rimg: b => { const inp = $('input[type=file]', b.parentNode); inp.dataset.i = b.dataset.i; inp.click(); },
    rimgdel: b => { D.rooms[+b.dataset.i].image = ''; markDirty(); redraw('rooms'); },
    tieradd: b => { (D.rooms[+b.dataset.i].childPricingTiers ||= []).push({ minAge: '', maxAge: '', fee: '' }); markDirty(); redraw('rooms'); },
    tierdel: b => { D.rooms[+b.dataset.i].childPricingTiers.splice(+b.dataset.j, 1); markDirty(); redraw('rooms'); },
    mon: b => { mon = new Date(mon.getFullYear(), mon.getMonth() + Number(b.dataset.d), 1); redraw('unavailableDates'); },
    dclear: () => { D.unavailableDates = []; markDirty(); redraw('unavailableDates'); },
    day: b => {
      const set = new Set(D.unavailableDates || []), d = b.dataset.d;
      if (rangeMode && anchor && anchor !== d) { let a = new Date(anchor), z = new Date(d); if (a > z) [a, z] = [z, a]; const block = !set.has(d); for (let x = new Date(a); x <= z; x.setDate(x.getDate() + 1)) { const k = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; block ? set.add(k) : set.delete(k); } anchor = null; }
      else if (rangeMode) { anchor = d; }
      else set.has(d) ? set.delete(d) : set.add(d);
      D.unavailableDates = [...set].sort(); markDirty(); redraw('unavailableDates');
    },
    save: async b => {
      const out = clone(item); Object.assign(out, D); delete out.gallery;
      out.image = D.gallery[0] || ''; out.images = D.gallery.slice();
      for (const [k, v] of Object.entries(out)) if (v && typeof v === 'object' && !Array.isArray(v)) { for (const l of Object.keys(v)) if (Array.isArray(v[l]) ? !v[l].length : !String(v[l] ?? '').trim()) delete v[l]; }
      if (out.rooms) out.rooms.forEach(r => { for (const k of ['type', 'beds', 'description']) { r[k] = r[k] || {}; for (const l of Object.keys(r[k])) if (!String(r[k][l]).trim()) delete r[k][l]; } });
      if (out.coordinates && !(out.coordinates.lat && out.coordinates.lng)) delete out.coordinates;
      if (o.type === 'branch') { if (!out.lat || !out.lng) { delete out.lat; delete out.lng; } }
      const miss = [];
      if (!hasText(out[spec.nameKey])) miss.push(['الاسم', 'basic']);   // (any language: translation fills the rest)
      if (spec.price && !(out.price > 0)) miss.push(['السعر', null]);
      if (spec.imageReq !== false && !out.image) miss.push(['صورة الغلاف', 'photos']);
      if (spec.descReq !== false && !hasText(out.description)) miss.push(['النبذة القصيرة', 'desc']);
      (spec.need || []).forEach(([l, fn, sec]) => { if (!fn(out)) miss.push([l, sec]); });
      if (o.type === 'hotel' && !hasText(out.location)) miss.push(['الموقع', 'basic']);
      if (o.type === 'transfer' && !(out.capacity > 0)) miss.push(['عدد الركاب', 'basic']);
      if (o.type === 'hotel' && (out.rooms || []).some(r => !hasText(r.type) || !(r.price > 0))) miss.push(['اسم وسعر كل غرفة', 'rooms']);
      if (miss.length) { DS.toast('ناقص: ' + miss.map(x => x[0]).join('، '), true); const t = miss.find(x => x[1]); (t ? $('#sec-' + t[1], host) : $('#edside', host))?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      b.disabled = true; const old = b.textContent;
      try {
        b.textContent = 'جاري الترجمة…';
        try { await translateAll(out, (n) => { b.textContent = `جاري الترجمة… (${n})`; }); await translateHtml(out, (l) => { b.textContent = `جاري ترجمة النص… (${l})`; }); }
        catch (e) { if (!confirm('الترجمة التلقائية فشلت: ' + (e.message || e) + '\n\nتحفظ النص بلغته الأصلية بس؟ (باقي اللغات هتفضل ناقصة)')) { DS.toast('اتلغى الحفظ — الترجمة فشلت: ' + (e.message || e), true); b.disabled = false; b.textContent = old; return; } }
        b.textContent = 'جاري الحفظ…';
        if (o.beforeSave) await o.beforeSave(out, host); await o.save(out); dirty = false; window.onbeforeunload = null; DS.toast('تم الحفظ ✓'); o.onDone ? o.onDone(out) : o.onBack(); }
      catch (e) { DS.toast(e.message || 'تعذّر الحفظ', true); b.disabled = false; b.textContent = old; }
    },
  };
  root.addEventListener('click', e => { if (e.target.tagName === 'INPUT' && e.target.type === 'file') return; const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return; const f = A[b.dataset.act]; if (f) { e.stopPropagation(); f(b, e); } });
  window.onbeforeunload = () => dirty ? 'فيه تعديلات غير محفوظة' : undefined;
  const appEl = document.getElementById('app'); if (appEl) appEl.classList.add('app-ed');   // the editor gets the full width (no right panel)
  window.scrollTo(0, 0);
};
})();
