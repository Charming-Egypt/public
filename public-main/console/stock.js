/* Discover Sharm — consoles: "Photo library" (ready-made photos). Owners and admins look here FIRST and upload a new photo only when
 * what they need is not in it. The photos live in the main website project (shared/stock/<section>/…, see tools/stock-index.mjs) and are
 * listed in <site>/stock/index.json, so picking one costs nothing: no upload, no GitHub commit, no Pages build.
 *
 *   DS.stockPicker({ type: 'hotel'|'excursion'|…, max: <how many more may be added>, taken: [urls already in the item], onPick(urls) })
 */
(function () {
'use strict';
const DS = window.DS, esc = DS.esc;
const SECTION = { hotel: 'hotels', excursion: 'excursions', transfer: 'transfers', restaurant: 'restaurants', branch: 'restaurants', destination: 'destinations', journal: 'journal' };
const LABEL = { general: 'عام (لكل الأقسام)', hotels: 'الفنادق', excursions: 'الرحلات', transfers: 'الانتقالات', restaurants: 'المطاعم', destinations: 'الوجهات', journal: 'المدونة' };
const base = () => String(window.DS_STOCK_BASE || '').replace(/\/+$/, '');
let cache = null;

async function loadIndex() {
  if (cache) return cache;
  const r = await fetch(`${base()}/index.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error('library_unavailable');
  cache = await r.json();
  return cache;
}
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '');   // lower-case, Arabic diacritics off
const nameOf = it => (window.DS_ALANG === 'ar' ? (it.ar || it.en) : (it.en || it.ar)) || it.file;
const urlOf = it => `${base()}/${it.file}`;

/** pure: which library photos match → used by the window and by the tests */
function filterStock(index, { section, album = '', q = '' } = {}) {
  const want = new Set([section, 'general'].filter(Boolean));
  const terms = norm(q).split(/\s+/).filter(Boolean);
  return (index.items || []).filter(it => want.has(it.section) && (!album || (it.section + '/' + it.album) === album) &&
    terms.every(t => norm([it.en, it.ar, it.album, ...(it.tags || [])].join(' ')).includes(t)));
}

DS.stockFilter = filterStock;
DS.stockPicker = async function (o) {
  const section = SECTION[o.type] || 'general', max = Math.max(0, o.max == null ? 99 : o.max), taken = new Set(o.taken || []);
  let index;
  try { index = await loadIndex(); } catch (e) { return DS.toast('مكتبة الصور مش متاحة دلوقتي — ارفع الصورة مباشرة', true); }
  const st = { q: '', album: '', sel: [], shown: 60 };
  const body = document.createElement('div'); body.className = 'sp';
  const albums = [...(index.albums[section] || []).map(a => [section + '/' + a, a]), ...(index.albums.general || []).map(a => ['general/' + a, a])];
  const draw = () => {
    const list = filterStock(index, { section, album: st.album, q: st.q });
    const left = max - st.sel.length;
    body.querySelector('.spg').innerHTML = list.slice(0, st.shown).map(it => {
      const u = urlOf(it), on = st.sel.includes(it.id), had = taken.has(u);
      return `<button type="button" class="spi ${on ? 'on' : ''} ${had ? 'had' : ''}" data-id="${esc(it.id)}" ${had ? 'disabled' : ''} title="${esc(nameOf(it))}"><img src="${esc(u)}" alt="" loading="lazy"><span class="spn">${esc(nameOf(it))}</span>${on ? `<i class="spk">✓ ${st.sel.indexOf(it.id) + 1}</i>` : ''}${had ? '<i class="spk">مضافة</i>' : ''}</button>`;
    }).join('') || `<div class="spe">${index.items.length ? 'مفيش صورة بالاسم ده — جرّب كلمة تانية أو ارفع صورة جديدة' : 'مكتبة الصور لسه فاضية — ارفع الصورة مباشرة'}</div>`;
    body.querySelector('.spm').innerHTML = list.length > st.shown ? `<button type="button" class="btn ghost sm" data-more>عرض المزيد (${list.length - st.shown})</button>` : '';
    body.querySelector('.spc').textContent = `${st.sel.length} / ${max}`;
    body.querySelectorAll('.spch').forEach(b => b.classList.toggle('on', b.dataset.al === st.album));
    body.querySelector('.sps').disabled = !st.sel.length;
    body.querySelector('.spg').dataset.full = left <= 0 ? '1' : '';
  };
  body.innerHTML = `<p class="muted sph">دوّر هنا الأول — وارفع صورة جديدة بس لو اللي محتاجه مش موجود.</p>
    <input type="search" class="edi spq" placeholder="ابحث: غروب، حمام سباحة، غوص…" autocomplete="off">
    <div class="spchs"><button type="button" class="spch on" data-al="">الكل</button>${albums.map(([k, a]) => `<button type="button" class="spch" data-al="${esc(k)}">${esc(a)}</button>`).join('')}</div>
    <div class="spg"></div><div class="spm"></div>
    <div class="spf"><span class="muted">اختيار: <b class="spc"></b> · ${esc(LABEL[section] || '')}</span><button type="button" class="btn sps" disabled>إضافة المحدد</button></div>`;
  let t; body.querySelector('.spq').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.shown = 60; draw(); }, 150); });
  body.addEventListener('click', e => {
    const ch = e.target.closest('.spch'); if (ch) { st.album = ch.dataset.al; st.shown = 60; return draw(); }
    if (e.target.closest('[data-more]')) { st.shown += 60; return draw(); }
    const it = e.target.closest('.spi'); if (it && !it.disabled) {
      const id = it.dataset.id, i = st.sel.indexOf(id);
      if (i >= 0) st.sel.splice(i, 1); else if (st.sel.length < max) st.sel.push(id); else DS.toast('وصلت للحد الأقصى من الصور', true);
      return draw();
    }
    if (e.target.closest('.sps') && st.sel.length) {
      const urls = st.sel.map(id => (index.items.find(x => x.id === id) || {}).file).filter(Boolean).map(f => `${base()}/${f}`);
      modal.close(); o.onPick(urls);
    }
  });
  const modal = DS.modal({ title: 'مكتبة الصور الجاهزة', body, wide: true, actions: [], onOpen: draw });
};
})();
