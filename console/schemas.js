/* Form schemas for every content type — shared by the owner panels and the super-admin content manager. */
(function () {
const L = (k, l, long) => ({ k, l, t: 'i18n', long }), N = (k, l) => ({ k, l, t: 'num' }), T = (k, l, opts) => ({ k, l, opts });
const S = {};
S.excursion = [L('title', 'اسم الرحلة'), T('category', 'الفئة', ['Boat trip', 'Desert Safari', 'Diving', 'Snorkeling', 'Quad', 'City Tour']), N('price', 'السعر للفرد (EGP)'), L('duration', 'المدة (مثال: يوم كامل 8 ساعات)'),
  { k: 'image', l: 'الصورة الرئيسية', t: 'img' }, { k: 'images', l: 'معرض الصور', t: 'imgs' }, L('description', 'وصف قصير', true), L('fullDescription', 'الوصف الكامل', true), L('meetingPoint', 'نقطة التجمّع'),
  { k: 'includes', l: 'السعر يشمل', t: 'i18nlist' }, { k: 'excludes', l: 'السعر لا يشمل', t: 'i18nlist' }, { k: 'whatToBring', l: 'المطلوب إحضاره', t: 'i18nlist' },
  { k: 'itinerary', l: 'برنامج الرحلة', t: 'list', add: 'خطوة', sub: [T('time', 'الوقت (07:30)'), L('title', 'العنوان'), L('description', 'الوصف', true)] }];
S.hotel = [L('name', 'اسم الفندق'), T('category', 'الفئة', ['budget', 'luxury']), N('price', 'أقل سعر في الليلة (EGP)'), L('location', 'العنوان'),
  { k: 'image', l: 'الصورة الرئيسية', t: 'img' }, { k: 'images', l: 'معرض الصور', t: 'imgs' }, L('description', 'وصف قصير', true), L('fullDescription', 'الوصف الكامل', true),
  { k: 'amenities', l: 'المرافق', t: 'i18nlist' }, { k: 'unavailableDates', l: 'أيام مقفولة (مفيش حجز)', t: 'dates' },
  { k: 'rooms', l: 'الغرف', t: 'list', add: 'غرفة', sub: [L('type', 'نوع الغرفة'), N('price', 'السعر/ليلة'), T('size', 'المساحة (35m²)'), L('beds', 'الأسرّة'), N('guests', 'أقصى عدد ضيوف'), N('baseOccupancy', 'الإشغال الأساسي'),
    N('extraAdultFee', 'رسوم بالغ إضافي'), N('freeChildrenPerRoom', 'أطفال مجانًا/غرفة'), N('extraChildFee', 'رسوم طفل إضافي'), { k: 'image', l: 'صورة الغرفة', t: 'img' }, L('description', 'وصف الغرفة', true),
    { k: 'childPricingTiers', l: 'رسوم الأطفال حسب السن (للّيلة) — اختياري', t: 'list', add: 'شريحة سن', sub: [N('minAge', 'من سن'), N('maxAge', 'إلى سن'), N('fee', 'الرسوم/ليلة')] }] }];
S.transfer = [L('vehicleType', 'نوع السيارة'), N('capacity', 'عدد الركاب'), N('price', 'السعر (EGP)'), { k: 'image', l: 'الصورة', t: 'img' }, L('description', 'الوصف', true), { k: 'features', l: 'المميزات', t: 'i18nlist' }];
const coords = { k: 'coordinates', l: 'الإحداثيات', t: 'obj', sub: [N('lat', 'Latitude'), N('lng', 'Longitude')] };
const A = {}; // admin-only extras / extra content types
A.hotel = S.hotel.concat([N('rating', 'التقييم (0-5)'), N('reviews', 'عدد التقييمات'), { k: 'bestseller', l: 'شارة', t: 'bool', h: 'الأكثر مبيعًا' }]);
A.excursion = S.excursion.concat([N('rating', 'التقييم (0-5)'), N('reviews', 'عدد التقييمات')]);
A.transfer = S.transfer;
A.destination = [L('name', 'اسم الوجهة'), L('tagline', 'الشعار'), L('description', 'وصف قصير', true), L('fullDescription', 'الوصف الكامل', true), L('location', 'الموقع'), { k: 'image', l: 'الصورة الرئيسية', t: 'img' }, { k: 'images', l: 'معرض الصور', t: 'imgs' },
  N('rating', 'التقييم'), N('review_count', 'عدد التقييمات'), T('phone', 'التليفون'), coords, T('google_maps_url', 'رابط جوجل ماب'), T('google_place_id', 'Google Place ID')];
A.restaurant = [L('name', 'اسم المطعم'), L('cuisine', 'نوع المطبخ'), N('priceLevel', 'مستوى السعر (1-4)'), N('rating', 'التقييم'), N('reviews', 'عدد التقييمات'), { k: 'image', l: 'الصورة الرئيسية', t: 'img' }, { k: 'images', l: 'معرض الصور', t: 'imgs' },
  L('description', 'وصف قصير', true), L('fullDescription', 'الوصف الكامل', true), L('location', 'المنطقة'), T('address_full', 'العنوان بالتفصيل'), L('openHours', 'مواعيد العمل'), T('phone', 'التليفون'), coords, T('google_maps_url', 'رابط جوجل ماب')];
A.article = [L('title', 'عنوان المقال'), L('excerpt', 'مقتطف', true), L('content', 'المحتوى', true), { k: 'image', l: 'الصورة', t: 'img' }, T('author', 'الكاتب'), N('readTimeMinutes', 'وقت القراءة (دقيقة)')];
A.review = [T('name', 'اسم صاحب التقييم'), N('rating', 'التقييم (1-5)'), T('section', 'القسم', ['hotel', 'excursion', 'restaurant']), L('itemName', 'اسم العنصر'), { k: 'image', l: 'صورة', t: 'img' }, L('text', 'نص التقييم', true)];
DS.SCH = S; DS.SCH_ADMIN = A;
})();
