/* Discover Sharm — "إعدادات الموقع" (super admin): what the public sites show and how they behave.
 * Stored in public.site_settings (one JSON row, public read) + public.ui_languages (extra interface languages).
 * The public sites read it on every load (shared/supabase-api.js -> frontend.js), so a change here is live in seconds.
 */
(function () {
const { esc } = DS;
const BUILTIN = [['ar', 'العربية', 'rtl'], ['en', 'English', 'ltr'], ['ru', 'Русский', 'ltr'], ['de', 'Deutsch', 'ltr'], ['it', 'Italiano', 'ltr'], ['tr', 'Türkçe', 'ltr']];
const SECTIONS = [['hotels', 'الفنادق', '🏨'], ['excursions', 'الرحلات', '🧭'], ['transfers', 'الترانسفير', '🚐'], ['restaurants', 'المطاعم والكافيهات', '🍽️'], ['destinations', 'الوجهات', '📍'], ['journal', 'المجلة (المقالات)', '📰']];
const RTL = new Set(['ar', 'fa', 'ur', 'he', 'ps', 'sd', 'ku', 'yi']);
const DEFAULTS = { sections: Object.fromEntries(SECTIONS.map(([k]) => [k, true])), languages: { enabled: BUILTIN.map(l => l[0]), default: 'en' },
  announcement: { enabled: false, text: {}, link: '', tone: 'info' }, maintenance: { enabled: false, message: {} },
  contact: { phone: '', whatsapp: '', email: '', facebook: '', instagram: '', tiktok: '', youtube: '' }, site: { name: 'Discover Sharm' } };
const merge = (d, v) => { const o = Array.isArray(d) ? [] : { ...d }; for (const k of Object.keys(v || {})) o[k] = (v[k] && typeof v[k] === 'object' && !Array.isArray(v[k]) && d && typeof d[k] === 'object') ? merge(d[k], v[k]) : v[k]; return o; };

// protect {placeholders}, %s and <tags> so the translator leaves them alone
const protect = (s) => { const tok = []; const t = s.replace(/\{[^}]*\}|%\w|<[^>]+>|&\w+;/g, (m) => { tok.push(m); return `XQ${tok.length - 1}X`; }); return { t, tok }; };
const restore = (s, tok) => s.replace(/XQ\s*(\d+)\s*X/g, (_, i) => tok[+i] ?? '');

// text typed in ONE language -> object with every site language (uses the same translation Worker as the editor)
async function translateAll(text, from, langs) {
  const out = { [from]: text };
  await Promise.all(langs.filter(l => l !== from).map(async l => { try { out[l] = (await DS.translate(from, l, [text]))[0]; } catch (e) { throw new Error('الترجمة فشلت: ' + e.message); } }));
  return out;
}

DS.settingsView = () => async (m) => {
  const res = await DS.api('/settings'); let S = merge(DEFAULTS, res.settings), custom = res.languages || [];
  const allLangs = () => BUILTIN.map(l => l[0]).concat(custom.map(l => l.code));
  const save = async (btn, extra) => {
    btn && (btn.disabled = true);
    try { await DS.api('/settings', { method: 'PUT', body: { value: S } }); DS.toast('تم الحفظ — التغيير ظاهر على الموقع خلال ثواني ✓'); if (extra) extra(); }
    catch (e) { DS.toast(e.message, true); } finally { btn && (btn.disabled = false); }
  };
  const field = (l, id, v, o = {}) => `<div class="fld"><label>${l}</label><input id="${id}" value="${esc(v || '')}" ${o.dir ? `dir="${o.dir}"` : ''} placeholder="${esc(o.ph || '')}">${o.h ? `<small>${o.h}</small>` : ''}</div>`;
  const sw = (id, on, label) => `<label class="sw"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  const draw = () => {
    const L = S.languages, en = new Set(L.enabled);
    const langRows = [...BUILTIN.map(([c, n]) => ({ code: c, name: n, builtin: true })), ...custom.map(l => ({ code: l.code, name: l.nativeName + ' · ' + l.name, builtin: false, keys: l.keys, db: l.enabled }))];
    m.innerHTML = `<h2 class="pt">إعدادات الموقع <span class="muted">التغييرات بتظهر على www و app مباشرة</span></h2>
      <div class="card"><span class="ct">الأقسام</span><p class="muted" style="margin-bottom:12px">لو قفلت قسم بيختفي من القوائم والصفحة الرئيسية والبحث (وبيفضل المحتوى محفوظ).</p>
        <div class="grid2">${SECTIONS.map(([k, l, ic]) => `<div class="li" style="margin:0;padding:12px 14px">${sw('sec_' + k, S.sections[k] !== false, `<span style="font-size:18px">${ic}</span> ${l}`)}</div>`).join('')}</div>
        <div class="row" style="margin-top:14px"><button class="btn" id="s_sec">حفظ الأقسام</button></div></div>

      <div class="card"><span class="ct">اللغات</span><p class="muted" style="margin-bottom:12px">فعّل/عطّل لغات الموقع واختار اللغة الافتراضية للزائر الجديد. اللغة اللي بتضيفها بتتترجم واجهتها تلقائيًا، وأي محتوى جديد (رحلات/فنادق/مطاعم) بيتترجم ليها عند الحفظ.</p>
        ${DS.table([{ h: 'اللغة', f: r => `<b>${esc(r.name)}</b> <span class="muted" dir="ltr">${r.code}</span>${r.builtin ? '' : ` <span class="badge b-blue">مضافة · ${r.keys} نص</span>`}` },
          { h: 'مفعّلة', f: r => `<input type="checkbox" data-le="${r.code}" ${en.has(r.code) ? 'checked' : ''}>` },
          { h: 'الافتراضية', f: r => `<input type="radio" name="dl" data-ld="${r.code}" ${L.default === r.code ? 'checked' : ''}>` },
          { h: '', f: r => r.builtin ? '' : `<button class="btn ghost sm" data-lr="${r.code}">إعادة ترجمة</button> <button class="btn red sm" data-lx="${r.code}">حذف</button>` }], langRows)}
        <div class="row" style="margin-top:14px"><button class="btn" id="s_lang">حفظ اللغات</button></div>
        <div class="li" style="margin-top:18px"><b>إضافة لغة جديدة</b><div class="grid2" style="margin-top:12px">${field('كود اللغة (حرفين)', 'nl_code', '', { dir: 'ltr', ph: 'fr', h: 'ISO 639-1 مثل fr, es, pl, zh' })}${field('الاسم بالإنجليزي', 'nl_name', '', { dir: 'ltr', ph: 'French' })}${field('الاسم كما يظهر للزائر', 'nl_native', '', { ph: 'Français' })}
          <div class="fld"><label>اتجاه الكتابة</label><select id="nl_dir"><option value="ltr">من اليسار لليمين</option><option value="rtl">من اليمين لليسار</option></select></div></div>
          <div class="row"><button class="btn" id="nl_add">إضافة وترجمة الواجهة تلقائيًا</button><span class="muted" id="nl_prog"></span></div><small class="muted">بتاخد دقيقة تقريبًا (حوالي 500 نص). راجع الترجمة بعدها من الموقع نفسه.</small></div></div>

      <div class="card"><span class="ct">شريط إعلان أعلى الموقع</span>
        ${sw('an_on', S.announcement.enabled, 'تفعيل الشريط')}
        <div class="grid2" style="margin-top:12px"><div class="fld"><label>نص الإعلان (اكتبه بلغة واحدة)</label><input id="an_text" value="${esc(S.announcement.text.ar || S.announcement.text.en || '')}" placeholder="مثال: خصم 20% على رحلات الغوص هذا الأسبوع"></div>
          <div class="fld"><label>لغة النص</label><select id="an_lang"><option value="ar" ${S.announcement.text.ar || !S.announcement.text.en ? 'selected' : ''}>العربية</option><option value="en" ${!S.announcement.text.ar && S.announcement.text.en ? 'selected' : ''}>English</option></select><small>بيتترجم لباقي اللغات عند الحفظ.</small></div>
          ${field('رابط عند الضغط (اختياري)', 'an_link', S.announcement.link, { dir: 'ltr', ph: 'https://…' })}
          <div class="fld"><label>اللون</label><select id="an_tone"><option value="info" ${S.announcement.tone === 'info' ? 'selected' : ''}>برتقالي (عادي)</option><option value="promo" ${S.announcement.tone === 'promo' ? 'selected' : ''}>أخضر (عرض)</option><option value="warn" ${S.announcement.tone === 'warn' ? 'selected' : ''}>أحمر (تنبيه)</option></select></div></div>
        <div class="row"><button class="btn" id="s_an">حفظ الإعلان</button></div></div>

      <div class="card"><span class="ct">وضع الصيانة</span><p class="muted" style="margin-bottom:10px">لو فعّلته الزوار بيشوفوا صفحة صيانة بدل الموقع. للمعاينة كموظف افتح أي رابط بـ <code dir="ltr">?preview=1</code>.</p>
        ${sw('mt_on', S.maintenance.enabled, 'تفعيل وضع الصيانة')}
        <div class="grid2" style="margin-top:12px"><div class="fld"><label>الرسالة (بلغة واحدة)</label><input id="mt_text" value="${esc(S.maintenance.message.ar || S.maintenance.message.en || '')}" placeholder="الموقع تحت الصيانة وهنرجع قريبًا"></div>
          <div class="fld"><label>لغة الرسالة</label><select id="mt_lang"><option value="ar" ${S.maintenance.message.ar || !S.maintenance.message.en ? 'selected' : ''}>العربية</option><option value="en" ${!S.maintenance.message.ar && S.maintenance.message.en ? 'selected' : ''}>English</option></select></div></div>
        <div class="row"><button class="btn" id="s_mt">حفظ</button></div></div>

      <div class="card"><span class="ct">التواصل والسوشيال ميديا</span><p class="muted" style="margin-bottom:10px">بتظهر في صفحة "تواصل معنا" وفي الفوتر.</p>
        <div class="grid2">${[['phone', 'التليفون', '+20 …'], ['whatsapp', 'واتساب (برقم الدولة)', '2010…'], ['email', 'الإيميل', 'info@…'], ['facebook', 'فيسبوك (رابط)', 'https://facebook.com/…'], ['instagram', 'إنستجرام (رابط)', 'https://instagram.com/…'], ['tiktok', 'تيك توك (رابط)', 'https://tiktok.com/@…'], ['youtube', 'يوتيوب (رابط)', 'https://youtube.com/…']].map(([k, l, ph]) => field(l, 'ct_' + k, S.contact[k], { dir: 'ltr', ph })).join('')}</div>
        <div class="row"><button class="btn" id="s_ct">حفظ بيانات التواصل</button></div></div>

      <div class="card"><span class="ct">صيانة البيانات</span><div class="row">
        <button class="btn ghost" id="pp">تنظيف جلسات الدفع غير المكتملة</button><button class="btn ghost" id="ri">إعادة ربط الحجوزات بأصحابها</button></div></div>`;
  };
  draw();
  const $ = (s) => m.querySelector(s), v = (id) => ($('#' + id) || {}).value || '';
  m.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.id === 's_sec') { SECTIONS.forEach(([k]) => { S.sections[k] = $('#sec_' + k).checked; }); await save(b); }
      if (b.id === 's_lang') {
        const en = allLangs().filter(c => $(`[data-le="${c}"]`).checked), df = ($('[name=dl]:checked') || {}).dataset ? $('[name=dl]:checked').dataset.ld : S.languages.default;
        if (!en.length) return DS.toast('لازم لغة واحدة على الأقل مفعّلة', true); if (!en.includes(df)) return DS.toast('اللغة الافتراضية لازم تكون مفعّلة', true);
        S.languages = { enabled: en, default: df }; await save(b);
        for (const l of custom) if (l.enabled !== en.includes(l.code)) { await DS.api('/languages', { method: 'POST', body: { code: l.code, name: l.name, nativeName: l.nativeName, dir: l.dir, enabled: en.includes(l.code) } }); l.enabled = en.includes(l.code); }
      }
      if (b.id === 's_an') { const on = $('#an_on').checked, txt = v('an_text').trim(); if (on && !txt) return DS.toast('اكتب نص الإعلان', true);
        b.disabled = true; b.textContent = 'جاري الترجمة…'; S.announcement = { enabled: on, text: txt ? await translateAll(txt, v('an_lang'), allLangs()) : {}, link: v('an_link').trim(), tone: v('an_tone') }; b.textContent = 'حفظ الإعلان'; await save(b); }
      if (b.id === 's_mt') { const on = $('#mt_on').checked, txt = v('mt_text').trim(); b.disabled = true; b.textContent = 'جاري الترجمة…'; S.maintenance = { enabled: on, message: txt ? await translateAll(txt, v('mt_lang'), allLangs()) : {} }; b.textContent = 'حفظ'; await save(b); }
      if (b.id === 's_ct') { S.contact = Object.fromEntries(Object.keys(DEFAULTS.contact).map(k => [k, v('ct_' + k).trim()])); await save(b); }
      if (b.id === 'pp') { if (!confirm('هيتم حذف جلسات checkout اللي انتهت من أكتر من 24 ساعة. تكمّل؟')) return; const r = await DS.api('/maintenance/purge-pending', { method: 'POST', body: {} }); DS.toast('تم حذف ' + r.removed); }
      if (b.id === 'ri') { if (!confirm('هيتم إعادة ربط الحجوزات القديمة بأصحابها. تكمّل؟')) return; const r = await DS.api('/maintenance/reindex', { method: 'POST', body: {} }); DS.toast('تم تحديث ' + r.bookingsUpdated + ' حجز'); }
      if (b.id === 'nl_add' || b.dataset.lr) await addLanguage(b);
      if (b.dataset.lx && confirm('حذف اللغة وكل ترجماتها؟')) { await DS.api('/languages/' + b.dataset.lx, { method: 'DELETE' }); custom = custom.filter(l => l.code !== b.dataset.lx); S.languages.enabled = S.languages.enabled.filter(c => c !== b.dataset.lx); if (S.languages.default === b.dataset.lx) S.languages.default = 'en'; await save(null); draw(); }
    } catch (er) { DS.toast(er.message, true); const x = e.target.closest('button'); if (x) x.disabled = false; }
  };
  // ---- add a language: translate every interface string (data/lang/en.json) through the translation Worker
  async function addLanguage(btn) {
    const redo = btn.dataset.lr, ex = custom.find(l => l.code === redo);
    const code = (redo || v('nl_code')).trim().toLowerCase(), name = ex ? ex.name : v('nl_name').trim(), nat = ex ? ex.nativeName : v('nl_native').trim(), dir = ex ? ex.dir : v('nl_dir');
    if (!/^[a-z]{2,3}$/.test(code) || !name || !nat) return DS.toast('امل الكود والاسم', true);
    if (!redo && allLangs().includes(code)) return DS.toast('اللغة دي موجودة بالفعل', true);
    const prog = $('#nl_prog'); btn.disabled = true;
    const base = await (await fetch('/lang/en.json')).json(), keys = Object.keys(base).filter(k => typeof base[k] === 'string'), strings = {};
    const jobs = keys.map(k => { const p = protect(base[k]); return { k, p }; }), todo = jobs.filter(j => /[A-Za-z]{2}/.test(j.p.t));
    jobs.filter(j => !todo.includes(j)).forEach(j => { strings[j.k] = base[j.k]; });
    const CH = 40;
    for (let i = 0; i < todo.length; i += CH) {
      const part = todo.slice(i, i + CH); prog.textContent = `جاري الترجمة… ${Math.min(i + CH, todo.length)} / ${todo.length}`;
      const r = await DS.translate('en', code, part.map(j => j.p.t));
      part.forEach((j, n) => { strings[j.k] = restore(r[n] || j.p.t, j.p.tok); });
    }
    await DS.api('/languages', { method: 'POST', body: { code, name, nativeName: nat, dir: RTL.has(code) ? 'rtl' : dir, strings, enabled: true } });
    if (!S.languages.enabled.includes(code)) S.languages.enabled.push(code);
    await DS.api('/settings', { method: 'PUT', body: { value: S } });
    DS.toast(`تمت إضافة ${nat} وتفعيلها ✓`); const r2 = await DS.api('/settings'); custom = r2.languages; draw();
  }
};
})();
