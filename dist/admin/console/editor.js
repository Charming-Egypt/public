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
      { id: 'photos', t: 'الصور', s: 'أول صورة هي الغلاف — اسحبي الصور لترتيبها', f: [{ k: 'gallery', kind: 'gallery', max: 12, min: 3 }] },
      { id: 'inc', t: 'اللي مشمول واللي لأ', s: 'وضّح للعميل بالظبط هيدفع في إيه', f: [
        { k: 'includes', l: 'السعر يشمل', kind: 'tags', presets: 'includes', ph: 'أضيفي بند واضغطي Enter' },
        { k: 'excludes', l: 'السعر لا يشمل', kind: 'tags', presets: 'excludes', ph: 'أضيفي بند واضغطي Enter' },
        { k: 'whatToBring', l: 'ياخد معاه إيه', kind: 'tags', presets: 'whatToBring', ph: 'أضيفي بند واضغطي Enter' } ] },
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
      { id: 'desc', t: 'الوصف', s: 'عرّفي العميل بالفندق', f: [
        { k: 'description', l: 'نبذة قصيرة', kind: 'i18n', long: 1, rows: 3, max: 180, req: 1 },
        { k: 'fullDescription', l: 'الوصف الكامل', kind: 'i18n', long: 1, rows: 8, max: 3000 } ] },
      { id: 'photos', t: 'الصور', s: 'أول صورة هي الغلاف — صور الغرف والمسبح والشاطئ والمطاعم', f: [{ k: 'gallery', kind: 'gallery', max: 24, min: 5 }] },
      { id: 'amen', t: 'المرافق والخدمات', s: 'اختاري من القايمة أو أضيفي خدمات خاصة', f: [{ k: 'amenities', l: 'مرافق الفندق', kind: 'tags', presets: 'amenities', ph: 'أضيفي مرفق واضغطي Enter', hideLabel: 1 }] },
      { id: 'rooms', t: 'الغرف والأسعار', s: 'كل نوع غرفة بسعره وسياسة الأطفال بتاعته', f: [{ k: 'rooms', kind: 'rooms' }] },
      { id: 'avail', t: 'التوفر', s: 'علّمي الأيام اللي الفندق مش متاح فيها', f: [{ k: 'unavailableDates', kind: 'dates' }] },
    ],
    price: { k: 'price', l: 'السعر يبدأ من (لليلة)', suffix: 'EGP', help: 'بيظهر "ابتداءً من" على الكارت.' },
    checks: [
      ['اسم الفندق', d => hasText(d.name)], ['الموقع', d => hasText(d.location)], ['الفئة', d => !!d.category], ['السعر', d => d.price > 0], ['نبذة قصيرة', d => hasText(d.description)],
      ['5 صور على الأقل', d => (d.gallery || []).length >= 5], ['غرفة واحدة على الأقل', d => (d.rooms || []).length > 0], ['5 مرافق على الأقل', d => d.amenities && Math.max(0, ...Object.values(d.amenities).map(a => (a || []).length)) >= 5],
      ['الوصف الكامل', d => hasText(d.fullDescription)],
    ],
  },
  transfer: {
    title: 'سيارة', nameKey: 'vehicleType', icon: '🚐',
    sections: [
      { id: 'basic', t: 'بيانات السيارة', s: 'النوع والسعة', f: [
        { k: 'vehicleType', l: 'نوع السيارة', kind: 'i18n', req: 1, max: 60, ph: 'مثال: ميني فان مرسيدس V-Class' },
        { k: 'capacity', l: 'عدد الركاب', kind: 'stepper', req: 1, min: 1, max: 60, help: 'أقصى عدد ركاب مع الشنط.' } ] },
      { id: 'desc', t: 'الوصف', s: 'ميزات الخدمة', f: [{ k: 'description', l: 'وصف الخدمة', kind: 'i18n', long: 1, rows: 4, max: 400, req: 1 }] },
      { id: 'photos', t: 'صور السيارة', s: 'أول صورة هي الغلاف', f: [{ k: 'gallery', kind: 'gallery', max: 8, min: 2 }] },
      { id: 'feat', t: 'المميزات', s: 'اللي بيميّز خدمتك', f: [{ k: 'features', l: 'مميزات السيارة', kind: 'tags', presets: 'features', ph: 'أضيفي ميزة واضغطي Enter', hideLabel: 1 }] },
    ],
    price: { k: 'price', l: 'سعر الرحلة', suffix: 'EGP', help: 'سعر السيارة للرحلة الواحدة.' },
    checks: [
      ['نوع السيارة', d => hasText(d.vehicleType)], ['عدد الركاب', d => d.capacity > 0], ['السعر', d => d.price > 0], ['وصف الخدمة', d => hasText(d.description)],
      ['صورتين على الأقل', d => (d.gallery || []).length >= 2], ['3 مميزات على الأقل', d => d.features && Math.max(0, ...Object.values(d.features).map(a => (a || []).length)) >= 3],
    ],
  },
};
const ROOM_NEW = () => ({ type: {}, price: '', size: '', beds: {}, guests: 2, baseOccupancy: 2, extraAdultFee: '', freeChildrenPerRoom: 0, extraChildFee: '', image: '', description: {}, childPricingTiers: [] });

DS.itemEditor = (host, o) => {
  const spec = SPEC[o.type], item = clone(o.item);
  const D = item;                                             // working copy
  D.gallery = (Array.isArray(item.images) && item.images.length ? item.images : (item.image ? [item.image] : [])).slice();
  if (o.type === 'hotel') (D.rooms || (D.rooms = [])).forEach(r => { r.childPricingTiers = r.childPricingTiers || []; });
  if (o.type === 'excursion') D.itinerary = D.itinerary || [];
  let cur = 'ar', dirty = false, open = new Set([0]), mon = new Date(), anchor = null, rangeMode = false;
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
    i18n: f => `<div class="edf-in">${lab(f)}<div class="wrapi">${i18nInput(f.k, f, D[f.k])}</div>${(!(D[f.k] || {})[cur] && fb(f.k)) ? `<div class="edh alt">${LN[LANGS.find(l => (D[f.k] || {})[l])]}: ${esc(fb(f.k))}</div>` : ''}${help(f)}</div>`,
    num: f => `<div class="edf-in">${lab(f)}<div class="wrapi num">${f.prefix ? `<span class="fx">${f.prefix}</span>` : ''}<input class="edi" type="number" inputmode="decimal" min="0" step="any" data-path="${f.k}" data-ty="num" value="${D[f.k] ?? ''}" placeholder="${f.ph || ''}">${f.suffix ? `<span class="fx">${f.suffix}</span>` : ''}</div>${help(f)}</div>`,
    stepper: f => `<div class="edf-in">${lab(f)}<div class="stepper"><button type="button" data-act="step" data-k="${f.k}" data-d="-1" aria-label="أقل">−</button><input class="edi" type="number" data-path="${f.k}" data-ty="num" min="${f.min || 0}" max="${f.max || 999}" value="${D[f.k] ?? ''}"><button type="button" data-act="step" data-k="${f.k}" data-d="1" aria-label="أكتر">+</button></div>${help(f)}</div>`,
    chips: f => `<div class="edf-in">${lab(f)}<div class="cchips">${f.opts.map(([v, l, ic]) => `<button type="button" class="cc ${D[f.k] === v ? 'on' : ''}" data-act="cat" data-k="${f.k}" data-v="${esc(v)}"><span>${ic || ''}</span>${esc(l)}</button>`).join('')}</div></div>`,
    gallery: f => {
      const g = D.gallery;
      return `<div class="gal" id="gal"><div class="drop" data-act="pick"><b>اسحبي الصور هنا أو اضغطي للاختيار</b><span>JPG / PNG / WebP — بتتضغط تلقائي · حد أقصى ${f.max} صورة${f.min ? ` · الأفضل ${f.min}+` : ''}</span><input type="file" accept="image/*" multiple hidden></div>
        <div class="gg">${g.map((u, i) => `<div class="gi ${i === 0 ? 'cover' : ''}" draggable="true" data-i="${i}">${DS.safeSrc(u) ? `<img src="${esc(DS.safeSrc(u))}" alt="" loading="lazy">` : ''}${i === 0 ? '<em>الغلاف</em>' : ''}
          <div class="gt">${i ? `<button type="button" data-act="gcover" data-i="${i}" title="اجعلها الغلاف">★</button>` : ''}<button type="button" data-act="gdel" data-i="${i}" title="حذف">✕</button></div></div>`).join('')}</div>
        <div class="gurl"><input class="edi ur" dir="ltr" placeholder="أو الصقي رابط صورة (https://…)"><button type="button" class="btn ghost sm" data-act="gadd">إضافة</button></div></div>`;
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
        <div class="dfoot"><label class="sw"><input type="checkbox" data-act="rmode" ${rangeMode ? 'checked' : ''}><span>تحديد فترة (اضغطي أول يوم وآخر يوم)</span></label><span class="edh">${set.size} يوم محجوب</span>${set.size ? '<button type="button" class="btn ghost sm" data-act="dclear">مسح الكل</button>' : ''}</div></div>`;
    },
  };
  const field = f => `<div class="edf ${f.w || 'full'}" data-f="${f.k}">${K[f.kind](f)}</div>`;
  const sections = () => spec.sections.map((s, i) => `<section class="edc" id="sec-${s.id}"><header><span class="si">${i + 1}</span><div><h3>${s.t}</h3><p>${s.s || ''}</p></div></header><div class="edg">${s.f.map(field).join('')}</div></section>`).join('');

  // ---------- side column ----------
  const score = () => { const r = spec.checks.map(([l, fn]) => [l, !!fn(D)]); return { r, pct: Math.round(r.filter(x => x[1]).length / r.length * 100) }; };
  const sideHtml = () => {
    const { r, pct } = score(), p = spec.price;
    return `<div class="edc side-c"><h4>${p.l}</h4><div class="wrapi num big"><input class="edi" type="number" min="0" step="any" data-path="${p.k}" data-ty="num" value="${D[p.k] ?? ''}" placeholder="0"><span class="fx">${p.suffix}</span></div><div class="edh">${p.help}</div></div>
      <div class="edc side-c"><h4>اكتمال الصفحة <b class="pc2" id="pct">${pct}%</b></h4><div class="pbar"><i id="pbar" style="width:${pct}%"></i></div><ul class="ck" id="ck">${r.map(([l, ok]) => `<li class="${ok ? 'ok' : ''}">${l}</li>`).join('')}</ul></div>
      <div id="sidex"></div>`;
  };
  const refreshScore = () => { const { r, pct } = score(); $('#pct', host).textContent = pct + '%'; $('#pbar', host).style.width = pct + '%'; $('#ck', host).innerHTML = r.map(([l, ok]) => `<li class="${ok ? 'ok' : ''}">${l}</li>`).join(''); const dots = $('#langs', host); if (dots) dots.innerHTML = langBtns(); };
  const langBtns = () => { const done = fillLangs(spec.nameKey); return LANGS.map(l => `<button type="button" class="lb ${l === cur ? 'on' : ''}" data-act="lang" data-l="${l}" title="${LN[l]}">${SH[l]}${done.includes(l) ? '<i></i>' : ''}</button>`).join(''); };

  // ---------- page ----------
  host.innerHTML = `<div class="ed"><div class="edbar"><button type="button" class="ib" data-act="back" aria-label="رجوع">→</button><div class="ett"><h2>${isNew ? 'إضافة ' + spec.title + ' جديد' : 'تعديل: ' + esc(tr(item[spec.nameKey]) || item.id)}</h2><span class="edh" id="dirty">${isNew ? 'لسه ما اتحفظش' : 'كل التعديلات محفوظة'}</span></div>
    <div class="lsw"><small>لغة المحتوى</small><div id="langs">${langBtns()}</div></div>
    <button type="button" class="btn ghost" data-act="back">إلغاء</button><button type="button" class="btn" id="saveb" data-act="save">حفظ ${isNew ? 'ونشر' : 'التعديلات'}</button></div>
    <div class="edgrid"><div class="edmain" id="edmain">${sections()}</div><aside class="edside" id="edside">${sideHtml()}</aside></div></div>`;
  const root = $('.ed', host), main = $('#edmain', host);
  if (o.side) o.side($('#sidex', host), D);                                           // admin extras (owner, status…)
  if (o.extra) $('#sidex', host).insertAdjacentHTML('afterbegin', `<div class="edc side-c"><h4>إعدادات الإدارة</h4>${o.extra.map(x => x.kind === 'bool' ? `<label class="sw" style="margin-bottom:10px"><input type="checkbox" data-path="${x.k}" data-ty="bool" ${D[x.k] ? 'checked' : ''}><span>${esc(x.l)}</span></label>` : `<div class="edf-in" style="margin-bottom:10px"><label class="edl">${esc(x.l)}</label><div class="wrapi num"><input class="edi" type="number" step="any" min="0" data-path="${x.k}" data-ty="num" value="${D[x.k] ?? ''}"></div></div>`).join('')}</div>`);

  const markDirty = () => { if (!dirty) { dirty = true; $('#dirty', host).textContent = 'فيه تعديلات غير محفوظة'; $('#dirty', host).classList.add('warn'); } };
  const redraw = k => { const f = spec.sections.flatMap(s => s.f).find(x => x.k === k), el = $(`.edf[data-f="${k}"]`, main); if (el && f) el.innerHTML = K[f.kind](f); };
  const redrawAll = () => { const y = window.scrollY; main.innerHTML = sections(); window.scrollTo(0, y); };
  const upload = async files => {
    const max = (spec.sections.flatMap(s => s.f).find(x => x.kind === 'gallery') || {}).max || 12; let n = 0;
    for (const f of files) {
      if (D.gallery.length >= max) { DS.toast('وصلتي للحد الأقصى من الصور', true); break; }
      try { DS.toast(`جاري رفع الصورة ${++n} من ${files.length}…`); const { url } = await DS.api('/upload', { method: 'POST', body: { image: await DS.compressImage(f) } }); D.gallery.push(url); markDirty(); redraw('gallery'); } catch (e) { DS.toast(e.message, true); }
    }
    refreshScore(); if (n) DS.toast('تم رفع الصور ✓');
  };

  // ---------- events ----------
  root.addEventListener('input', e => {
    const t = e.target, path = t.dataset.path; if (!path) return;
    const ty = t.dataset.ty; let v;
    if (ty === 'i18n') { let ob = getP(D, path); if (!ob || typeof ob !== 'object') { ob = {}; setP(D, path, ob); } ob[cur] = t.value; const c = $(`[data-cnt="${path}"]`, root); if (c) c.textContent = `${t.value.length}/${t.maxLength}`; }
    else { v = ty === 'num' ? (t.value === '' ? '' : Number(t.value)) : ty === 'bool' ? t.checked : t.value; setP(D, path, v); }
    markDirty(); refreshScore();
    if (/^rooms\.\d+\.(type|price|guests|size)/.test(path)) { const i = path.split('.')[1], rh = $(`.room:nth-child(${+i + 1}) .rh div`, root); if (rh) { const r = D.rooms[i]; rh.innerHTML = `<b>${esc(tr(r.type) || 'غرفة جديدة')}</b><small>${r.price ? Number(r.price).toLocaleString('en') + ' EGP / ليلة' : 'لم يُحدد السعر'}${r.guests ? ` · ${r.guests} ضيف` : ''}${r.size ? ` · ${esc(r.size)}` : ''}</small>`; } }
  });
  root.addEventListener('keydown', e => {
    if (e.target.classList.contains('tin') && (e.key === 'Enter' || e.key === ',' || e.key === '،')) { e.preventDefault(); addTag(e.target.dataset.tk, e.target.value); }
    if (e.key === 'Enter' && e.target.classList.contains('ur')) { e.preventDefault(); $('[data-act=gadd]', root).click(); }
  });
  root.addEventListener('focusout', e => { if (e.target.classList.contains('tin') && e.target.value.trim()) addTag(e.target.dataset.tk, e.target.value); });
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
  const A = {
    back: () => { if (dirty && !confirm('فيه تعديلات ما اتحفظتش. تخرجي من غير حفظ؟')) return; window.onbeforeunload = null; o.onBack(); },
    lang: b => { cur = b.dataset.l; $$('#langs .lb', host).forEach(x => x.classList.toggle('on', x.dataset.l === cur)); redrawAll(); },
    cat: b => { D[b.dataset.k] = b.dataset.v; markDirty(); redraw(b.dataset.k); refreshScore(); },
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
      const miss = [];
      if (!hasText(out[spec.nameKey])) miss.push(['الاسم', 'basic']);
      if (!(out.price > 0)) miss.push(['السعر', null]);
      if (!out.image) miss.push(['صورة الغلاف', 'photos']);
      if (!hasText(out.description)) miss.push(['النبذة القصيرة', 'desc']);
      if (o.type === 'hotel' && !hasText(out.location)) miss.push(['الموقع', 'basic']);
      if (o.type === 'transfer' && !(out.capacity > 0)) miss.push(['عدد الركاب', 'basic']);
      if (o.type === 'hotel' && (out.rooms || []).some(r => !hasText(r.type) || !(r.price > 0))) miss.push(['اسم وسعر كل غرفة', 'rooms']);
      if (miss.length) { DS.toast('ناقص: ' + miss.map(x => x[0]).join('، '), true); const t = miss.find(x => x[1]); (t ? $('#sec-' + t[1], host) : $('#edside', host))?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      b.disabled = true; const old = b.textContent; b.textContent = 'جاري الحفظ…';
      try { if (o.beforeSave) await o.beforeSave(out, host); await o.save(out); dirty = false; window.onbeforeunload = null; DS.toast('تم الحفظ ✓'); o.onDone ? o.onDone(out) : o.onBack(); }
      catch (e) { DS.toast(e.message || 'تعذّر الحفظ', true); b.disabled = false; b.textContent = old; }
    },
  };
  root.addEventListener('click', e => { if (e.target.tagName === 'INPUT' && e.target.type === 'file') return; const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return; const f = A[b.dataset.act]; if (f) { e.stopPropagation(); f(b, e); } });
  window.onbeforeunload = () => dirty ? 'فيه تعديلات غير محفوظة' : undefined;
  const appEl = document.getElementById('app'); if (appEl) appEl.classList.add('app-ed');   // the editor gets the full width (no right panel)
  window.scrollTo(0, 0);
};
})();
