// ==================== REVIEWS PAGE (/reviews/) ====================
// Read: public reviews + summary.  Write: ONLY with a voucher number, and only while signed in as the account that holds it.
//   - Reviewer identity (name, avatar) is never typed: the database takes it from the account (see submit_review in
//     supabase/migrations/20261104000100_reviews_voucher.sql).  The form accepts a rating, a comment and photos. Nothing else.
//   - The voucher is checked on the server (lookup_review_voucher) BEFORE the form opens, and again on submit.
const reviewsPg = (() => {
  const PAGE = 8, MAX_PHOTOS = 4, MIN_CHARS = 10, MAX_CHARS = 1000;
  const S = {
    tab: 'list', kind: 'all', sort: 'new', photos: false,
    rows: [], offset: 0, more: false, loading: false, loaded: false,
    stats: null, staticRows: null,
    step: 'voucher',            // voucher | form | done
    voucher: null,              // answer of lookup_review_voucher (ok === true)
    eligible: null,             // the account's reviewable bookings (shortcut chips, still voucher-based)
    stars: 0, nat: '', files: [], busy: false, err: '', doneInfo: null, inited: false,
  };
  const $ = (id) => document.getElementById(id);
  const tt = (k, f) => t(k, f);
  const E = (s) => esc(String(s == null ? '' : s));
  const client = () => (window.SB && window.SB.client) || null;
  const signedIn = () => !!(typeof auth !== 'undefined' && auth.isLoggedIn());
  const lang = () => (typeof I18N !== 'undefined' && I18N.get) ? I18N.get() : 'en';
  const KIND_ICON = { excursion: 'fa-umbrella-beach', transfer: 'fa-shuttle-van', restaurant: 'fa-utensils', hotel: 'fa-hotel' };
  const KIND_KEY = { excursion: 'rvKindExcursion', transfer: 'rvKindTransfer', restaurant: 'rvKindRestaurant', hotel: 'rvKindHotel' };
  const KIND_DEF = { excursion: 'Excursions', transfer: 'Transfers', restaurant: 'Restaurants', hotel: 'Hotels' };
  const stars = (n, cls = '') => `<span class="rvp-stars ${cls}" aria-label="${n} / 5">${[1, 2, 3, 4, 5].map(i => `<i class="fa-solid fa-star${i <= Math.round(n) ? ' on' : ''}" aria-hidden="true"></i>`).join('')}</span>`;
  const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
  // "Sophia Marie Lopez" -> "Sophia L."  (public pages never show a full name)
  const mask = (n) => {
    n = String(n || '').trim(); if (!n) return tt('guest', 'Guest');
    const p = n.split(/\s+/); if (p.length < 2) return p[0];
    return `${p[0]} ${[...p[p.length - 1]][0].toUpperCase()}.`;
  };
  // nationality: ISO-3166 alpha-2 -> flag emoji + country name in the page language
  const flag = (cc) => (typeof countryFlagEmoji === 'function' ? countryFlagEmoji(cc) : '');
  const countryName = (cc) => {
    try { const n = new Intl.DisplayNames([lang()], { type: 'region' }).of(cc); if (n && n !== cc) return n; } catch {}
    const c = (typeof COUNTRY_CODES !== 'undefined' ? COUNTRY_CODES : []).find(x => x.code === cc); return c ? c.name : cc;
  };
  const validCC = (cc) => /^[A-Z]{2}$/.test(cc || '');
  const kinds = () => ['excursion', 'transfer', 'restaurant', ...((typeof SHOW_HOTELS !== 'undefined' && SHOW_HOTELS) ? ['hotel'] : [])]
    .filter(k => ({ excursion: typeof SHOW_EXCURSIONS === 'undefined' || SHOW_EXCURSIONS, transfer: typeof SHOW_TRANSFERS === 'undefined' || SHOW_TRANSFERS, restaurant: typeof SHOW_RESTAURANTS === 'undefined' || SHOW_RESTAURANTS, hotel: true })[k]);

  // ---------------------------------------------------------------- data
  async function staticFallback() {
    if (S.staticRows) return S.staticRows;
    try { await ensureCatalogLoaded(); } catch {}
    S.staticRows = (CATALOG.reviews || []).map((r, i) => ({
      id: r.id || 's' + i, name: r.name, nationality: r.nationality || r.country || '', rating: Number(r.rating) || 5, comment: r.text || '', images: [], owner_reply: null, created_at: null,
      properties: { name: typeof r.itemName === 'string' ? r.itemName : '', kind: r.section || 'excursion', id: null },
    }));
    return S.staticRows;
  }
  async function loadStats() {
    try {
      const c = client(); if (!c) throw 0;
      const { data, error } = await c.rpc('review_stats'); if (error) throw error;
      if (data && data.count > 0) return data;
    } catch {}
    const rows = await staticFallback(), st = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    rows.forEach(r => { st[Math.min(5, Math.max(1, r.rating))]++; });
    const n = rows.length;
    return { count: n, avg: n ? rows.reduce((s, r) => s + r.rating, 0) / n : 0, stars: st, photos: 0 };
  }
  async function loadRows() {
    const c = client();
    if (c) {
      try {
        let q = c.from('reviews').select('id, name, nationality, rating, comment, photo_url, images, owner_reply, created_at, properties!inner(id, name, kind, status)')
          .eq('status', 'published').eq('properties.status', 'published').not('comment', 'is', null);
        if (S.kind !== 'all') q = q.eq('properties.kind', S.kind);
        if (S.photos) q = q.neq('images', '[]');
        q = S.sort === 'top' ? q.order('rating', { ascending: false }).order('created_at', { ascending: false }) : q.order('created_at', { ascending: false });
        const { data, error } = await q.range(S.offset, S.offset + PAGE - 1);
        if (error) throw error;
        // no real reviews yet and nothing filtered: show the bundled testimonials instead of an empty page
        if ((data && data.length) || S.offset > 0 || S.kind !== 'all' || S.photos) return { rows: data || [], more: (data || []).length === PAGE };
      } catch (e) { /* fall through to the bundled testimonials */ }
    }
    let rows = (await staticFallback()).filter(r => (S.kind === 'all' || r.properties.kind === S.kind) && !S.photos);
    if (S.sort === 'top') rows = rows.slice().sort((a, b) => b.rating - a.rating);
    return { rows: rows.slice(S.offset, S.offset + PAGE), more: rows.length > S.offset + PAGE };
  }

  // ---------------------------------------------------------------- read: summary + filters + cards
  function paintHero() {
    const el = $('rvpHero'); if (!el) return;
    const s = S.stats || { count: 0, avg: 0, stars: {} };
    if (!s.count) {
      el.innerHTML = `
        <div class="rvp-empty-hero"><div class="rvp-empty-ico"><i class="fa-regular fa-star" aria-hidden="true"></i></div>
        <h2 class="rvp-hero-title">${tt('rvBeFirst', 'Be the first to share your experience')}</h2>
        <p class="rvp-hero-sub">${tt('rvHeroSub', 'Every review is tied to a real booking voucher, so what you read here comes from guests who were really there.')}</p>
        <button type="button" class="rvp-cta" onclick="reviewsPg.tab('write')"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i> ${tt('rvTabWrite', 'Write a review')}</button></div>`;
      return;
    }
    const avg = Number(s.avg) || 0, total = s.count;
    const bars = [5, 4, 3, 2, 1].map(n => {
      const c = Number((s.stars || {})[n]) || 0, pct = total ? Math.round(c * 100 / total) : 0;
      return `<div class="rvp-bar"><span>${n}<i class="fa-solid fa-star" aria-hidden="true"></i></span><div><i style="width:${pct}%"></i></div><em>${c}</em></div>`;
    }).join('');
    const title = tt('rvHeroTitle', 'Loved by {n} verified guests').replace('{n}', `<em>${total.toLocaleString(lang())}</em>`);
    el.innerHTML = `
      <h2 class="rvp-hero-title">${title}</h2>
      <p class="rvp-hero-sub">${tt('rvHeroSub', 'Every review is tied to a real booking voucher, so what you read here comes from guests who were really there.')}</p>
      <div class="rvp-hero-main">
        <div class="rvp-score"><b>${avg.toFixed(1)}</b>${stars(avg)}<small>${tt('rvOutOf', 'OUT OF 5')}</small></div>
        <div class="rvp-bars" aria-label="${tt('rvBreakdown', 'Rating breakdown')}">${bars}</div>
      </div>
      <button type="button" class="rvp-cta" onclick="reviewsPg.tab('write')"><i class="fa-solid fa-pen-nib" aria-hidden="true"></i> ${tt('rvTabWrite', 'Write a review')}</button>`;
  }
  function paintFilters() {
    const el = $('rvpFilters'); if (!el) return;
    const chip = (key, val, label, icon, on) => `<button type="button" class="rvp-chip${on ? ' on' : ''}" aria-pressed="${on}" onclick="reviewsPg.filter('${key}','${val}')">${icon ? `<i class="fa-solid ${icon}" aria-hidden="true"></i>` : ''}${label}</button>`;
    el.innerHTML =
      chip('kind', 'all', tt('rvAll', 'All'), 'fa-layer-group', S.kind === 'all') +
      kinds().map(k => chip('kind', k, tt(KIND_KEY[k], KIND_DEF[k]), KIND_ICON[k], S.kind === k)).join('') +
      `<span class="rvp-sep" aria-hidden="true"></span>` +
      chip('photos', S.photos ? '0' : '1', tt('rvWithPhotos', 'With photos'), 'fa-camera', S.photos) +
      chip('sort', S.sort === 'new' ? 'top' : 'new', S.sort === 'new' ? tt('rvSortNew', 'Newest') : tt('rvSortTop', 'Top rated'), S.sort === 'new' ? 'fa-clock' : 'fa-arrow-up-wide-short', false);
  }
  function card(r, i) {
    const p = r.properties || {}, photos = Array.isArray(r.images) ? r.images.filter(Boolean) : [];
    const key = 'rvp_' + (r.id || i);
    window.__reviewPhotoSets = window.__reviewPhotoSets || {}; window.__reviewPhotoSets[key] = photos;
    const initial = [...String(r.name || 'G').trim()][0] || 'G';
    const kind = p.kind && KIND_ICON[p.kind] ? p.kind : null;
    const link = p.id && kind && typeof pathForDetail === 'function' && DETAIL_ROUTES[kind + 's'] ? pathForDetail(kind + 's', p.id) : '';
    const chipInner = `<i class="fa-solid ${kind ? KIND_ICON[kind] : 'fa-location-dot'}" aria-hidden="true"></i><span>${E(p.name || '')}</span>`;
    const itemChip = p.name ? (link ? `<a class="rvp-item" href="${E(link)}">${chipInner}</a>` : `<span class="rvp-item">${chipInner}</span>`) : '<span></span>';
    return `<article class="rvp-card" style="--i:${Math.min(i, 8)}">
      <header class="rvp-card-head">
        <div class="rvp-avatar">${r.photo_url ? `<img src="${E(r.photo_url)}" alt="" loading="lazy" onerror="this.remove()">` : E(initial.toUpperCase())}<span class="rvp-tick" title="${tt('rvVerified', 'Verified voucher')}"><i class="fa-solid fa-check" aria-hidden="true"></i></span></div>
        <div class="rvp-who"><div class="rvp-nm"><b>${E(mask(r.name))}</b>${validCC(r.nationality) ? `<span class="rvp-nat" title="${E(countryName(r.nationality))}"><span class="rvp-flag" aria-hidden="true">${flag(r.nationality)}</span><span>${E(countryName(r.nationality))}</span></span>` : ''}</div><span class="rvp-meta">${stars(r.rating, 'sm')}${r.created_at ? `<small>${fmtDate(r.created_at)}</small>` : ''}</span></div>
        <span class="rvp-vbadge"><i class="fa-solid fa-ticket" aria-hidden="true"></i><span>${tt('rvVerified', 'Verified voucher')}</span></span>
      </header>
      <p class="rvp-text" dir="auto">${E(r.comment)}</p>
      ${photos.length ? `<div class="rvp-photos n${Math.min(photos.length, 3)}">${photos.slice(0, 3).map((src, j) => `<button type="button" onclick="openLightboxSet('${key}', ${j})" aria-label="${tt('rvOpenPhoto', 'Open photo')}"><img src="${E(src)}" alt="" loading="lazy">${j === 2 && photos.length > 3 ? `<span>+${photos.length - 3}</span>` : ''}</button>`).join('')}</div>` : ''}
      ${r.owner_reply ? `<div class="rvp-reply"><b><i class="fa-solid fa-reply" aria-hidden="true"></i> ${tt('rvReply', 'Reply from Discover Sharm')}</b><p dir="auto">${E(typeof r.owner_reply === 'string' ? r.owner_reply : r.owner_reply.text || '')}</p></div>` : ''}
      <footer class="rvp-card-foot">${itemChip}</footer>
    </article>`;
  }
  function paintList() {
    const el = $('rvpList'), more = $('rvpMore'); if (!el) return;
    if (!S.rows.length) {
      el.innerHTML = S.loading ? '<div class="sk sk-review" style="height:190px"></div><div class="sk sk-review" style="height:190px"></div>'
        : `<div class="rvp-empty"><i class="fa-regular fa-comments" aria-hidden="true"></i><p>${tt('rvNone', 'No reviews match these filters yet.')}</p></div>`;
    } else el.innerHTML = S.rows.map(card).join('');
    if (more) more.innerHTML = S.more ? `<button type="button" class="rvp-load" ${S.loading ? 'disabled' : ''} onclick="reviewsPg.more()">${S.loading ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>' : tt('rvLoadMore', 'Show more reviews')}</button>` : '';
  }
  async function fetchRows(reset) {
    if (S.loading) return;
    if (reset) { S.rows = []; S.offset = 0; S.more = false; }
    S.loading = true; paintList();
    try {
      const { rows, more } = await loadRows();
      S.rows = S.rows.concat(rows); S.offset = S.rows.length; S.more = more;
    } finally { S.loading = false; S.loaded = true; paintList(); }
  }

  // ---------------------------------------------------------------- write: state machine
  const panel = () => $('rvpWritePanel');
  const who = () => {
    const u = (typeof currentUser !== 'undefined' && currentUser) || {};
    return { name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' };
  };
  function identityRow() {
    const w = who(), nm = w.name || w.email.split('@')[0] || tt('guest', 'Guest');
    return `<div class="rvp-id"><div class="rvp-avatar sm">${w.photo ? `<img src="${E(w.photo)}" alt="" onerror="this.remove()">` : E(([...nm][0] || 'G').toUpperCase())}</div>
      <div class="rvp-id-t"><small>${tt('rvReviewingAs', 'Reviewing as')}</small><b>${E(mask(nm))}</b></div>
      <span class="rvp-lock" title="${tt('rvFromAccount', 'Taken from your account')}"><i class="fa-solid fa-lock" aria-hidden="true"></i> ${tt('rvFromAccount', 'Taken from your account')}</span></div>`;
  }
  const REASON = {
    invalid: ['rvErrInvalid', 'That does not look like a voucher number. It looks like DS-XXXXXX.'],
    not_found: ['rvErrNotFound', 'We could not find this voucher on your account. Make sure you are signed in with the account that made the booking.'],
    not_paid: ['rvErrNotPaid', 'This booking is not confirmed yet, so it cannot be reviewed.'],
    already_reviewed: ['rvErrDone', 'This voucher has already been reviewed. One review per voucher.'],
    not_yet: ['rvErrNotYet', 'You can review once your experience has taken place.'],
    no_item: ['rvErrNoItem', 'This service is no longer available for reviews.'],
  };
  function paintWrite() {
    const el = panel(); if (!el) return;
    const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || null;
    if (S.uid !== uid) { S.uid = uid; S.step = 'voucher'; S.voucher = null; S.eligible = null; S.err = ''; S.files = []; S.stars = 0; }   // another account: start clean
    if (!client()) {   // legacy / offline build: no database, no verified reviews
      el.innerHTML = `<div class="rvp-gate"><div class="rvp-gate-ico"><i class="fa-solid fa-plug-circle-xmark" aria-hidden="true"></i></div><h3>${tt('rvUnavailable', 'Reviews are temporarily unavailable')}</h3><p>${tt('rvUnavailableSub', 'Please try again in a little while.')}</p></div>`;
      return;
    }
    if (!signedIn()) {
      el.innerHTML = `<div class="rvp-gate"><div class="rvp-gate-ico"><i class="fa-solid fa-user-lock" aria-hidden="true"></i></div>
        <h3>${tt('rvSignInTitle', 'Sign in to write a review')}</h3>
        <p>${tt('rvSignInSub', 'Reviews can only be written by the account that holds the booking voucher. Sign in with that account to continue.')}</p>
        <button type="button" class="rvp-cta" onclick="reviewsPg.signIn()"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> ${tt('loginBtn', 'Sign In')}</button></div>`;
      return;
    }
    if (S.step === 'done') return paintDone(el);
    if (S.step === 'form' && S.voucher) return paintForm(el);
    paintVoucher(el);
    if (S.eligible === null && !S.eligBusy) loadEligible();
  }
  function steps(n) {
    const names = [tt('rvStepVoucher', 'Voucher'), tt('rvStepReview', 'Your review')];
    return `<ol class="rvp-steps" aria-label="${tt('rvSteps', 'Steps')}">${names.map((s, i) => `<li class="${i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''}"><span>${i + 1 < n ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : i + 1}</span>${s}</li>`).join('<li class="ln" aria-hidden="true"></li>')}</ol>`;
  }
  function paintVoucher(el) {
    const keep = ($('rvpVoucher') || {}).value || '';
    const elig = S.eligible;
    el.innerHTML = `<div class="rvp-panel">
      ${steps(1)}
      <form id="rvpVForm" class="rvp-vform" autocomplete="off" novalidate>
        <label for="rvpVoucher" class="rvp-label">${tt('rvVoucherLabel', 'VOUCHER NUMBER')}</label>
        <div class="rvp-vrow">
          <div class="rvp-vinput"><i class="fa-solid fa-ticket" aria-hidden="true"></i>
            <input id="rvpVoucher" type="text" inputmode="text" maxlength="40" placeholder="DS-XXXXXX" spellcheck="false" autocapitalize="characters" autocorrect="off" value="${E(keep)}" aria-describedby="rvpVErr"></div>
          <button type="submit" class="rvp-cta" id="rvpVBtn">${tt('rvVerify', 'Verify')}</button>
        </div>
        <p class="rvp-hint"><i class="fa-regular fa-circle-question" aria-hidden="true"></i> ${tt('rvVoucherHint', 'You will find it on your confirmation e-mail and PDF voucher, and under My Bookings.')}</p>
        <p class="rvp-err" id="rvpVErr" role="alert">${E(S.err)}</p>
      </form>
      ${elig && elig.length ? `<div class="rvp-elig"><p class="rvp-label">${tt('rvReadyTitle', 'READY TO REVIEW')}</p>
        ${elig.slice(0, 6).map(b => `<button type="button" class="rvp-elig-row" onclick="reviewsPg.pick('${E(b.id)}')">
          <span class="rvp-elig-ico"><i class="fa-solid ${KIND_ICON[b.type] || 'fa-ticket'}" aria-hidden="true"></i></span>
          <span class="rvp-elig-t"><b>${E(b.title || b.hotelName || b.vehicleType || b.id)}</b><small>${E(b.id)}${(b.date || b.checkin) ? ' · ' + fmtDate(b.date || b.checkin) : ''}</small></span>
          <i class="fa-solid fa-chevron-right rvp-chev" aria-hidden="true"></i></button>`).join('')}</div>` : ''}
    </div>`;
    $('rvpVForm').addEventListener('submit', (ev) => { ev.preventDefault(); verify($('rvpVoucher').value); });
    $('rvpVoucher').addEventListener('input', (ev) => { ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (S.err) { S.err = ''; $('rvpVErr').textContent = ''; } });
  }
  function paintForm(el) {
    const v = S.voucher, st = S.stars;
    const LAB = ['', tt('rvStar1', 'Poor'), tt('rvStar2', 'Fair'), tt('rvStar3', 'Good'), tt('rvStar4', 'Very good'), tt('rvStar5', 'Excellent')];
    const ta = $('rvpText') ? $('rvpText').value : (S._draft || '');
    el.innerHTML = `<div class="rvp-panel">
      ${steps(2)}
      <div class="rvp-svc">
        ${v.image ? `<img src="${E(v.image)}" alt="" onerror="this.remove()">` : `<span class="rvp-svc-ico"><i class="fa-solid ${KIND_ICON[v.kind] || 'fa-ticket'}" aria-hidden="true"></i></span>`}
        <div class="rvp-svc-t"><span class="rvp-ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${tt('rvVoucherOk', 'Voucher verified')}</span><b>${E(v.title || v.id)}</b>
          <small>${E(v.id)}${v.date ? ' · ' + fmtDate(v.date) : ''}</small></div>
        <button type="button" class="rvp-link" onclick="reviewsPg.reset()">${tt('rvChange', 'Change')}</button>
      </div>
      <form id="rvpForm" novalidate>
        <label for="rvpNat" class="rvp-label">${tt('rvNationality', 'YOUR COUNTRY')}</label>
        <div class="rvp-sel"><span class="rvp-sel-flag" id="rvpNatFlag" aria-hidden="true">${S.nat ? flag(S.nat) : '🌍'}</span>
          <select id="rvpNat"><option value="">${tt('rvNationalityPick', 'Select your country')}</option>${natOptions()}</select><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></div>
        <p class="rvp-label">${tt('yourRating', 'YOUR RATING')}</p>
        <div class="rvp-rate" role="radiogroup" aria-label="${tt('yourRating', 'YOUR RATING')}">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${st === n}" aria-label="${n}" class="${n <= st ? 'on' : ''}" data-n="${n}"><i class="fa-solid fa-star" aria-hidden="true"></i></button>`).join('')}
          <span class="rvp-rate-l" id="rvpRateL">${st ? LAB[st] : tt('rvTapStar', 'Tap a star')}</span>
        </div>
        <label for="rvpText" class="rvp-label">${tt('yourReview', 'YOUR REVIEW')}</label>
        <textarea id="rvpText" rows="5" maxlength="${MAX_CHARS}" placeholder="${tt('rvPlaceholder', 'What made your experience special? Tell future guests what to expect.')}">${E(ta)}</textarea>
        <div class="rvp-count"><span id="rvpCountMin"></span><span><b id="rvpCount">0</b> / ${MAX_CHARS}</span></div>
        ${client() ? `<p class="rvp-label">${tt('photosOptional', 'PHOTOS (OPTIONAL)')}</p>
        <input type="file" id="rvpFile" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden>
        <div class="rvp-pics" id="rvpPics"></div>` : ''}
        <p class="rvp-err" id="rvpErr" role="alert">${E(S.err)}</p>
        <button type="submit" class="rvp-submit" id="rvpSubmit"><span>${tt('submitReview', 'Submit Review')}</span><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button>
        <p class="rvp-fine"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i> ${tt('rvFine', 'Your review is published with your first name, last initial and country.')}</p>
      </form></div>`;
    const form = $('rvpForm'), txt = $('rvpText');
    const nat = $('rvpNat'); if (nat) nat.addEventListener('change', () => { S.nat = nat.value; $('rvpNatFlag').textContent = S.nat ? flag(S.nat) : '🌍'; S.err = ''; $('rvpErr').textContent = ''; });
    const count = () => { const n = txt.value.trim().length; $('rvpCount').textContent = txt.value.length; $('rvpCountMin').textContent = n && n < MIN_CHARS ? tt('rvMin', 'At least {n} characters').replace('{n}', MIN_CHARS) : ''; S._draft = txt.value; };
    txt.addEventListener('input', count); count();
    form.querySelectorAll('.rvp-rate button').forEach(b => b.addEventListener('click', () => setStars(Number(b.dataset.n), LAB)));
    form.querySelector('.rvp-rate').addEventListener('keydown', (ev) => {
      if (!/^Arrow(Left|Right|Up|Down)$/.test(ev.key)) return; ev.preventDefault();
      const rtl = document.documentElement.dir === 'rtl';
      const d = ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowDown' ? -1 : (ev.key === 'ArrowRight') === !rtl ? 1 : -1;
      setStars(Math.min(5, Math.max(1, (S.stars || 0) + d)), LAB);
      const nb = form.querySelector(`.rvp-rate button[data-n="${S.stars}"]`); if (nb) nb.focus();
    });
    form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
    const f = $('rvpFile'); if (f) f.addEventListener('change', () => { addFiles(f.files); f.value = ''; });
    paintPics();
  }
  function natOptions() {
    const list = (typeof COUNTRY_CODES !== 'undefined' ? COUNTRY_CODES : []).map(c => ({ code: c.code, n: countryName(c.code) }))
      .sort((a, b) => a.n.localeCompare(b.n, lang()));
    return list.map(c => `<option value="${c.code}"${c.code === S.nat ? ' selected' : ''}>${flag(c.code)} ${E(c.n)}</option>`).join('');
  }
  function setStars(n, LAB) {
    S.stars = n;
    document.querySelectorAll('#rvpForm .rvp-rate button').forEach(b => { const on = Number(b.dataset.n) <= n; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(Number(b.dataset.n) === n)); });
    const l = $('rvpRateL'); if (l) l.textContent = LAB[n];
    S.err = ''; const e = $('rvpErr'); if (e) e.textContent = '';
  }
  function paintPics() {
    const el = $('rvpPics'); if (!el) return;
    el.innerHTML = S.files.map((f, i) => `<div class="rvp-pic"><img src="${E(f.url)}" alt=""><button type="button" aria-label="${tt('rvRemove', 'Remove photo')}" onclick="reviewsPg.drop(${i})"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>`).join('')
      + (S.files.length < MAX_PHOTOS ? `<button type="button" class="rvp-pic add" onclick="document.getElementById('rvpFile').click()"><i class="fa-solid fa-camera" aria-hidden="true"></i><span>${tt('add', 'Add')}</span><small>${S.files.length}/${MAX_PHOTOS}</small></button>` : '');
  }
  function paintDone(el) {
    const d = S.doneInfo || {};
    el.innerHTML = `<div class="rvp-panel rvp-done"><div class="rvp-done-ico"><i class="fa-solid fa-check" aria-hidden="true"></i></div>
      <h3>${tt('rvThanksTitle', 'Thank you!')}</h3>
      <p>${tt('rvThanksSub', 'Your review is live. It helps other travellers choose with confidence.')}</p>
      ${d.rating ? `<div class="rvp-done-stars">${stars(d.rating)}</div>` : ''}
      <button type="button" class="rvp-cta" onclick="reviewsPg.afterDone()"><i class="fa-regular fa-comments" aria-hidden="true"></i> ${tt('rvSeeReviews', 'See all reviews')}</button></div>`;
  }

  // ---------------------------------------------------------------- write: actions
  async function verify(raw) {
    const id = String(raw || '').trim().toUpperCase();
    S.err = ''; const btn = $('rvpVBtn'), errEl = $('rvpVErr');
    if (!id) { S.err = tt('rvErrEmpty', 'Enter your voucher number.'); if (errEl) errEl.textContent = S.err; return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>'; }
    try {
      const { data, error } = await client().rpc('lookup_review_voucher', { p_voucher: id });
      if (error) throw error;
      if (!data || !data.ok) { const r = REASON[(data || {}).reason] || REASON.not_found; S.err = tt(r[0], r[1]); }
      else { S.voucher = data; S.step = 'form'; S.stars = 0; S.files = []; S._draft = ''; }
    } catch (e) {
      if (e && (e.code === '28000' || e.status === 401)) { S.err = tt('rvErrAuth', 'Your session expired. Please sign in again.'); }
      else S.err = tt('rvErrNet', 'Could not verify the voucher. Check your connection and try again.');
    }
    paintWrite();
    if (S.step === 'form') { const p = panel(); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  // Photos: shrunk in the browser (longest side 1600 px, JPEG) before upload, so 12 MP phone shots stay a few hundred KB.
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('blob')); }, 'image/jpeg', 0.82);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
      img.src = url;
    });
  }
  async function addFiles(list) {
    const room = MAX_PHOTOS - S.files.length; let bad = 0;
    for (const f of Array.from(list || []).slice(0, room)) {
      if (!/^image\//.test(f.type)) { bad++; continue; }
      try { const blob = await shrink(f); S.files.push({ blob, url: URL.createObjectURL(blob) }); } catch { bad++; }
    }
    if (bad) toast(tt('rvPhotoBad', 'One photo could not be read. Try JPG or PNG.'), 'error');
    paintPics();
  }
  function drop(i) { const f = S.files[i]; if (f) URL.revokeObjectURL(f.url); S.files.splice(i, 1); paintPics(); }
  async function submit() {
    if (S.busy) return;
    const txt = ($('rvpText').value || '').trim(), errEl = $('rvpErr'), btn = $('rvpSubmit');
    const fail = (m) => { S.err = m; errEl.textContent = m; };
    if (!validCC(S.nat)) return fail(tt('rvErrNat', 'Please select your country.'));
    if (!S.stars) return fail(tt('rvErrStars', 'Please choose a star rating.'));
    if (txt.length < MIN_CHARS) return fail(tt('rvMin', 'At least {n} characters').replace('{n}', MIN_CHARS));
    S.busy = true; S.err = ''; errEl.textContent = '';
    btn.disabled = true; btn.classList.add('busy');
    const uploaded = [];
    try {
      const c = client(), { data: sess } = await c.auth.getSession(), uid = sess && sess.session && sess.session.user.id;
      if (!uid) throw Object.assign(new Error('auth'), { code: '28000' });
      for (let i = 0; i < S.files.length; i++) {
        btn.querySelector('span').textContent = `${tt('rvUploading', 'Uploading photos')} ${i + 1}/${S.files.length}`;
        const path = `${uid}/${S.voucher.id}-${Date.now()}-${i}.jpg`;
        const up = await c.storage.from('review-media').upload(path, S.files[i].blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (up.error) throw up.error;
        uploaded.push(path);
      }
      btn.querySelector('span').textContent = tt('rvSending', 'Sending…');
      const images = uploaded.map(p => c.storage.from('review-media').getPublicUrl(p).data.publicUrl);
      // identity is NOT sent: the database reads name + avatar from the signed-in account
      const { error } = await c.rpc('submit_review', { p: { bookingId: S.voucher.id, rating: S.stars, comment: txt, nationality: S.nat, images } });
      if (error) throw error;
      S.doneInfo = { rating: S.stars };
      try { Object.keys(sessionStorage).filter(k => k.startsWith('ds_rv_')).forEach(k => sessionStorage.removeItem(k)); } catch {}
      try { userCache.clear('bk'); } catch {}
      S.files.forEach(f => URL.revokeObjectURL(f.url)); S.files = []; S.step = 'done'; S._draft = '';
      try { utils.confetti(); } catch {}
      paintWrite(); panel().scrollIntoView({ behavior: 'smooth', block: 'start' });
      S.stats = null; S.loaded = false; init(true);       // refresh the summary + list behind the scenes
    } catch (e) {
      if (uploaded.length) { try { await client().storage.from('review-media').remove(uploaded); } catch {} }   // do not leave orphan photos behind
      const code = e && e.code, msg = String((e && e.message) || '');
      S.err = code === '23505' ? tt('rvErrDone', 'This voucher has already been reviewed. One review per voucher.')
        : code === 'P0002' ? tt('rvErrNotFound', REASON.not_found[1])
        : code === 'P0001' ? tt('rvErrNotYet', REASON.not_yet[1])
        : code === '28000' ? tt('rvErrAuth', 'Your session expired. Please sign in again.')
        : /exceeded|size|too large/i.test(msg) ? tt('rvErrSize', 'A photo is too large. Try a smaller one.')
        : tt('rvErrSubmit', 'We could not send your review. Please try again.');
      S.busy = false; paintWrite();
      return;
    }
    S.busy = false;
  }

  async function loadEligible() {
    if (!signedIn() || !client()) return;
    S.eligBusy = true;
    try {
      const data = await apiFetch('/api/user/bookings', {}, true);
      const today = utils.todayIso();
      S.eligible = (data.bookings || []).filter(b => b.status === 'completed' && !b.reviewed && (b.date || b.checkout || b.checkin || '0000') <= today)
        .sort((a, b) => String(b.date || b.checkin || '').localeCompare(String(a.date || a.checkin || '')));
    } catch { S.eligible = []; }
    S.eligBusy = false;
    if (S.tab === 'write' && S.step === 'voucher') paintWrite();
  }

  // ---------------------------------------------------------------- public api
  function tab(which, quiet) {
    S.tab = which === 'write' ? 'write' : 'list';
    const w = S.tab === 'write';
    $('rvpListPanel').hidden = w; $('rvpWritePanel').hidden = !w;
    const root = $('rvpTabList').closest('.rvp'); if (root) root.dataset.tab = S.tab;   // phones: the summary card steps aside while writing
    $('rvpTabList').setAttribute('aria-selected', String(!w)); $('rvpTabWrite').setAttribute('aria-selected', String(w));
    if (w) paintWrite();
    if (!quiet) { try { history.replaceState(null, '', w ? '?write=1' : location.pathname); } catch {} const t0 = $('rvpTabList').parentElement; if (t0) t0.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
  async function init(refreshOnly) {
    const first = !S.inited; S.inited = true;
    if (!refreshOnly || !S.stats) { S.stats = await loadStats(); paintHero(); }
    paintFilters();
    if (!S.loaded) await fetchRows(true);
    if (first) {
      const q = new URLSearchParams(location.search), v = (q.get('v') || '').trim();
      if (q.get('write') === '1' || v) {
        tab('write', true);
        if (v && signedIn() && client()) { const inp = $('rvpVoucher'); if (inp) inp.value = v.toUpperCase(); verify(v); }
      }
    }
  }
  return {
    init, tab, drop,
    rerender() { if (!$('reviewsPage')) return; paintHero(); paintFilters(); paintList(); if (S.tab === 'write') paintWrite(); },
    filter(key, val) {
      if (key === 'kind') S.kind = val; else if (key === 'photos') S.photos = val === '1'; else if (key === 'sort') S.sort = val;
      paintFilters(); fetchRows(true);
    },
    more() { fetchRows(false); },
    pick(id) { const i = $('rvpVoucher'); if (i) i.value = id; verify(id); },
    reset() { S.step = 'voucher'; S.voucher = null; S.err = ''; S.files.forEach(f => URL.revokeObjectURL(f.url)); S.files = []; S.stars = 0; paintWrite(); },
    signIn() { nav.showAuth(); },
    afterDone() { S.step = 'voucher'; S.voucher = null; S.eligible = null; tab('list'); },
  };
})();
