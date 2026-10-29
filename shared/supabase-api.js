// ==================== SUPABASE BACKEND ====================
// Everything the pages used to ask the old workers for (accounts, profile, catalog,
// bookings, favorites, reviews, notifications, forms) now goes straight to Supabase.
// Security does NOT live here: the anon key below is public by design, and every rule is
// enforced by Row Level Security + RPCs in supabase/migrations/.
//
// It plugs in under the existing apiFetch('/api/...') calls, so the pages did not change.
// Payment endpoints (/api/kashier/*, /api/notify/*) still go to the payments worker —
// that worker holds the gateway secret and must be called with the Supabase token.
(function () {
  const cfg = window.DS_SUPABASE;
  if (!cfg || !cfg.url || !cfg.anonKey || !window.supabase) { window.SB = null; return; }

  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ds_sb_session',
      // www + app share one login: ds-bridge.js keeps the session in cookies scoped to .discover-sharm.com
      ...(window.DS_SESSION_STORAGE ? { storage: window.DS_SESSION_STORAGE } : {}) },
  });

  // ---- photos: loaded from static hosting; if one is not there (yet), the content Worker serves it (and copies it over for next time) ----
  if (cfg.mediaBase && cfg.contentBase) {
    const pre = cfg.mediaBase + '/img/';
    document.addEventListener('error', (e) => {
      const el = e.target;
      if (!el || el.tagName !== 'IMG' || el.dataset.dsFb) return;
      const src = el.currentSrc || el.src || '';
      if (src.indexOf(pre) === 0) { el.dataset.dsFb = '1'; el.src = cfg.contentBase + '/img/' + src.slice(pre.length); }
    }, true);
  }

  // Static JSON on the media domain (catalog/, settings/) is cached by Cloudflare's CDN. Each folder has a tiny version.json ({ v: <content hash> }, rechecked every
  // few seconds); the file is then asked for as ...json?v=<hash>. A changed file = a new hash = a new URL, so no cache ever has to be purged. If the pointer is
  // missing (older deployment) the plain URL is used, exactly as before.
  async function mediaUrl(file) {
    const plain = `${cfg.mediaBase}/${file}`;
    try {
      const r = await fetch(`${cfg.mediaBase}/${file.split('/')[0]}/version.json`);
      if (r.ok) { const j = await r.json(); if (j && /^[a-f0-9]{8,64}$/.test(String(j.v))) return `${plain}?v=${j.v}`; }
    } catch (e) { /* no pointer */ }
    return plain;
  }

  // ---- site settings (sections on/off, languages, announcement, maintenance, contact): public row, cached for instant next load ----
  (() => {
  const KEY = 'ds_site_settings', FRESH_MS = cfg.mediaBase ? 20 * 1000 : 5 * 60 * 1000;   // on static hosting a recheck is nearly free, so edits show within ~20 s
  let cached = null; try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  // a copy younger than 5 minutes is used as-is: browsing 6 pages makes ONE settings request, not 6
  if (cached && cached.t && Date.now() - cached.t < FRESH_MS) { window.DS_SETTINGS_READY = Promise.resolve(cached); return; }
  const fresh = (async () => {
    let res;
    if (cfg.mediaBase) {   // static copy published by the settings Worker on every save (no Worker call, no database)
      try { const r = await fetch(await mediaUrl('settings/settings.json')); if (r.ok) { const j = await r.json(); res = { value: j.value || {}, langs: j.langs || [] }; } } catch (e) { /* fall through to the Worker */ }
    }
    if (res) { /* static copy answered */ }
    else if (cfg.settingsBase) {   // settings live in settings.json in the private GitHub data repo; the settings Worker serves them
      const r = await fetch(`${cfg.settingsBase}/settings`);
      if (!r.ok) throw new Error('settings ' + r.status);
      const j = await r.json(); res = { value: j.value || {}, langs: j.langs || [] };
    } else {
      const [s, l] = await Promise.all([
        sb.from('site_settings').select('value').eq('id', 1).maybeSingle(),
        sb.from('ui_languages').select('code, name, native_name, dir, strings, sort_order').eq('enabled', true).order('sort_order'),
      ]);
      if (s.error && l.error) throw s.error;
      res = { value: (s.data && s.data.value) || {}, langs: l.data || [] };
    }
    res.t = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(res)); } catch {}   // (extra-language strings are ~20 KB each)
    return res;
  })().catch(() => cached);
  // never hold the page for more than 2.5 s: use the cached copy if the network is slow
  window.DS_SETTINGS_READY = Promise.race([fresh, new Promise(r => setTimeout(() => r(cached), 2500))]);
})();

  // ---- session <-> the existing authToken/currentUser globals --------------------
  const TIERS_FALLBACK = 0;
  const toUser = (session, profile) => {
    const u = session.user, m = u.user_metadata || {};
    return {
      uid: u.id,
      email: u.email,
      displayName: (profile && profile.display_name) || m.name || m.full_name || (u.email || '').split('@')[0],
      photoURL: (profile && profile.avatar_url) || m.avatar_url || m.picture || null,
      phone: (profile && profile.phone) || m.phone || '',
      countryCode: (profile && profile.country_code) || m.countryCode || '',
      role: (profile && profile.role) || 'user',
      geniusLevel: (profile && profile.loyalty_tier) || TIERS_FALLBACK,
    };
  };

  const fail = (message, extra) => Object.assign(new Error(message), extra || {});
  const explain = (error) => {
    if (!error) return null;
    const msg = error.message || 'Request failed';
    if (error.details === 'price_changed' || msg === 'price_changed')
      return fail('السعر اتغيّر — حدّث الصفحة وحاول تاني (Price changed, please refresh)', { total: Number(error.hint), status: 409 });
    if (error.details === 'rate_limited') return fail('Too many requests — please wait a few minutes.', { status: 429 });
    if (error.code === '28000') return fail('Authentication failed', { status: 401 });
    if (error.code === '42501') return fail('Not allowed', { status: 403 });
    if (error.code === 'P0002') return fail('Not found', { status: 404 });
    if (error.code === '23505') return fail(msg, { status: 409 });
    return fail(msg, { status: error.status });
  };
  const run = async (promise) => {
    const { data, error } = await promise;
    if (error) throw explain(error);
    return data;
  };

  // ---- email links (confirm e-mail / reset password / change e-mail) ---------------
  // Supabase sends the visitor back here with tokens in the URL. We read them ourselves (detectSessionInUrl is off),
  // turn them into a session, strip them from the address bar, and report what happened so the page can show a proper
  // screen ("e-mail confirmed" / "choose a new password" / "link expired") instead of silently dropping the visitor on the site.
  const authLink = (async () => {
    const h = new URLSearchParams(location.hash.replace(/^#/, '')), q = new URLSearchParams(location.search);
    const g = (k) => h.get(k) || q.get(k);
    const flow = g('auth'), type = g('type');
    const hasToken = h.get('access_token') || q.get('code') || q.get('token_hash');
    const errMsg = g('error_description') || g('error');
    if (!hasToken && !errMsg) return null;
    const kindOf = () => (type === 'recovery' || flow === 'recovery') ? 'recovery' : (type === 'email_change' ? 'email_change' : 'confirmed');
    const clean = () => { ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'error', 'error_code', 'error_description'].forEach(k => { h.delete(k); q.delete(k); }); q.delete('code'); q.delete('token_hash'); q.delete('auth');
      try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + (h.toString() ? '#' + h.toString() : '')); } catch (e) {} };
    try {
      if (errMsg) { const r = { kind: 'error', flow: kindOf(), message: String(errMsg).replace(/\+/g, ' '), code: g('error_code') || '' }; clean(); return r; }
      let error = null;
      if (h.get('access_token') && h.get('refresh_token')) ({ error } = await sb.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') }));
      else if (q.get('code')) ({ error } = await sb.auth.exchangeCodeForSession(q.get('code')));
      else if (q.get('token_hash') && type) ({ error } = await sb.auth.verifyOtp({ token_hash: q.get('token_hash'), type }));
      const kind = kindOf(); clean();
      return error ? { kind: 'error', flow: kind, message: error.message, code: error.code || '' } : { kind };
    } catch (e) { clean(); return { kind: 'error', flow: kindOf(), message: (e && e.message) || 'Link failed', code: '' }; }
  })();

  // ---- ready: refresh an old session before the app boots ------------------------
  const ready = (async () => {
    try {
      await authLink;
      const { data } = await sb.auth.getSession();
      if (data.session) {
        authToken = data.session.access_token; localStorage.setItem('ds_auth_token', authToken);
        // signed in on the other site (or as someone else here): rebuild the profile this site shows
        if (!currentUser || currentUser.uid !== data.session.user.id) {
          try { currentUser = await sessionUser(data.session); localStorage.setItem('ds_current_user', JSON.stringify(currentUser)); } catch (e) { /* offline: the next call retries */ }
        }
      }
      else if (authToken) { authToken = null; localStorage.removeItem('ds_auth_token'); localStorage.removeItem('ds_current_user'); }
    } catch (e) { console.warn('session restore failed', e); }
  })();

  sb.auth.onAuthStateChange((event, session) => {
    if (session) { authToken = session.access_token; localStorage.setItem('ds_auth_token', authToken); }
    else if (event === 'SIGNED_OUT') { authToken = null; localStorage.removeItem('ds_auth_token'); }
  });

  const sessionUser = async (session) => {
    const { data: profile } = await sb.from('profiles')
      .select('display_name, avatar_url, phone, country_code, role, loyalty_tier').eq('id', session.user.id).maybeSingle();
    return toUser(session, profile);
  };

  // ---- catalog ---------------------------------------------------------------------
  const PROPERTY_FILES = { 'hotels.json': 'hotel', 'excursions.json': 'excursion', 'transfers.json': 'transfer', 'restaurants.json': 'restaurant' };
  const CONTENT_FILES = { 'destinations.json': 'destination', 'articles.json': 'article', 'promoSlides.json': 'promo_slide', 'reviews.json': 'testimonial' };

  // Items live as JSON files in the private GitHub data repo; the content Worker serves the published ones (cfg.contentBase).
  // Without cfg.contentBase the pages keep reading the database copy (old behaviour).
  async function contentCatalog(name) {
    const r = await fetch(`${cfg.contentBase}/catalog/${name}.json`);
    if (!r.ok) throw fail('Catalog unavailable', { status: r.status });
    return await r.json();   // { updatedAt, items: [...] }
  }

  // The WHOLE public catalog in one request (all catalogs + live ratings + restaurant branches + home testimonials), answered from the
  // content Worker's edge cache. Replaces 6 Worker calls + 6 database queries that used to run on every page view.
  async function readBundle() {
    if (cfg.mediaBase) {   // static hosting: published the moment staff save; the browser rechecks it every few seconds (tiny 304 when unchanged)
      try { const sr = await fetch(await mediaUrl('catalog/bundle.json')); if (sr.ok) return await sr.json(); } catch (e) { /* not published yet / unreachable: ask the Worker */ }
    }
    const r = await fetch(`${cfg.contentBase}/catalog/bundle.json`);
    if (!r.ok) throw fail('Catalog unavailable', { status: r.status });
    return await r.json();   // { hotels, excursions, transfers, restaurants, destinations|null, articles|null, reviews|null }
  }

  // reviews of one item, edge-cached by the content Worker and kept 3 minutes in this tab (comparing items = no repeat requests)
  async function readReviews(id) {
    const key = 'ds_rv_' + id;
    try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 3 * 60 * 1000) return c.d; } catch {}
    let rows;
    if (cfg.contentBase) {
      const r = await fetch(`${cfg.contentBase}/reviews/${encodeURIComponent(id)}.json`);
      if (!r.ok) throw fail('Reviews unavailable', { status: r.status });
      rows = (await r.json()).reviews || [];
    } else {
      rows = await run(sb.from('reviews').select('id, name, rating, comment, photo_url, images, owner_reply, created_at')
        .eq('property_id', id).eq('status', 'published').order('created_at', { ascending: false }).limit(50));
    }
    const d = { reviews: rows.map(r => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, photoURL: r.photo_url, images: r.images, reply: r.owner_reply, createdAt: r.created_at })) };
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch {}
    return d;
  }

  async function readCatalog(file) {
    if (PROPERTY_FILES[file]) {
      const isRest = PROPERTY_FILES[file] === 'restaurant';
      let rows;
      if (cfg.contentBase) {
        // the item content comes from GitHub (via the Worker); ratings are live numbers from customer reviews in the database
        const [cat, meta] = await Promise.all([
          contentCatalog(file.replace('.json', '')),
          run(sb.from('properties').select('id, rating_avg, rating_count').eq('kind', PROPERTY_FILES[file]).eq('status', 'published')).catch(() => []),
        ]);
        const m = new Map(meta.map(x => [x.id, x]));
        rows = (cat.items || []).map(item => ({ id: item.id, data: { ...item }, rating_avg: (m.get(item.id) || {}).rating_avg || 0, rating_count: (m.get(item.id) || {}).rating_count || 0 }));
      } else {
        rows = await run(sb.from('properties').select('id, data, rating_avg, rating_count')
          .eq('kind', PROPERTY_FILES[file]).eq('status', 'published').order('sort_order').order('created_at'));
      }
      let branches = {};   // restaurants: only branches the super admin approved are public (RLS enforces it too)
      if (isRest && rows.length) {
        try {
          (await run(sb.from('restaurant_branches').select('id, property_id, data').eq('status', 'approved').order('sort_order').order('created_at')))
            .forEach(b => { (branches[b.property_id] = branches[b.property_id] || []).push({ ...b.data, id: b.id }); });
        } catch (e) { /* branches table not migrated yet: no branches shown */ }
      }
      return rows.map(r => {
        const item = r.data;
        if (r.rating_count > 0) { item.rating = Number(r.rating_avg); item.reviews = r.rating_count; }   // live numbers beat the seeded ones
        if (isRest) item.branches = branches[r.id] || [];
        return item;
      });
    }
    if (file === 'reviews.json') {   // home page testimonials = REAL customer reviews (4★+ with a written comment); the static file is only a fallback while there are none
      try {
        const rows = await run(sb.from('reviews').select('id, name, rating, comment, created_at, properties!inner(name, kind, status)')
          .eq('status', 'published').eq('properties.status', 'published').gte('rating', 4).not('comment', 'is', null)
          .order('created_at', { ascending: false }).limit(40));
        const real = rows.filter(r => String(r.comment || '').trim().length >= 25).slice(0, 20)
          .map(r => ({ id: r.id, name: (r.name || '').trim() || 'Guest', rating: r.rating, text: String(r.comment).trim(), itemName: r.properties.name || '', section: r.properties.kind }));
        if (real.length) return real;
      } catch (e) { /* fall through to the static file */ }
    }
    if ((file === 'articles.json' || file === 'destinations.json') && cfg.contentBase) {   // journal posts + destinations: GitHub-backed; until they are exported, the bundled static file keeps the section alive
      try {
        const j = await contentCatalog(file === 'articles.json' ? 'journal' : 'destinations');
        if (!(j.fallback && !(j.items || []).length)) return j.items || [];
      } catch (e) { /* fall through to the static file */ }
    }
    if (CONTENT_FILES[file]) {   // editorial content is static JSON (data/*.json), not a table
      const r = await fetch(`/data/${file}${window.DS_DATA_V ? '?v=' + window.DS_DATA_V : ''}`);
      if (!r.ok) throw fail('Unknown catalog file', { status: 404 });
      return await r.json();
    }
    throw fail('Unknown catalog file', { status: 404 });
  }

  // ---- the router: legacy endpoint -> Supabase ---------------------------------------
  async function handle(endpoint, options = {}) {
    const url = new URL(endpoint, 'http://x');
    const path = url.pathname;
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};

    // --- public reads: no account involved
    if (path === '/api/catalog' && cfg.contentBase) return await readBundle();
    if (path === '/api/reviews' && method === 'GET') return await readReviews(url.searchParams.get('id'));

    const { data: { session } } = await sb.auth.getSession();
    const need = () => { if (!session) throw fail('Authentication failed', { status: 401 }); return session; };

    // --- catalog
    if (path === '/api/file') return { content: await readCatalog(url.searchParams.get('file')) };

    // --- accounts
    if (path === '/api/google-config') return { clientId: cfg.googleClientId || '' };
    if (path === '/api/auth/signin') {
      const { data, error } = await sb.auth.signInWithPassword({ email: body.email, password: body.password });
      if (error) throw fail(/invalid login/i.test(error.message) ? 'Wrong email or password' : error.message, { status: 401 });
      return { idToken: data.session.access_token, user: await sessionUser(data.session) };
    }
    if (path === '/api/auth/signup') {
      const { data, error } = await sb.auth.signUp({
        email: body.email, password: body.password,
        options: { emailRedirectTo: location.origin + '/?auth=confirm', data: { name: body.name, phone: body.phone || '', countryCode: body.countryCode || '' } },
      });
      if (error) throw fail(error.message, { status: 400 });
      if (!data.session) throw fail('Check your inbox: we sent you a link to confirm your email, then log in.', { status: 202, confirm: true });
      return { idToken: data.session.access_token, user: await sessionUser(data.session) };
    }
    if (path === '/api/auth/reset') {
      const { error } = await sb.auth.resetPasswordForEmail(body.email, { redirectTo: location.origin + '/?auth=recovery' });
      if (error) throw fail(error.message, { status: 400 });
      return { success: true };
    }
    if (path === '/api/auth/google') {
      const { data, error } = await sb.auth.signInWithIdToken({ provider: 'google', token: body.idToken });
      if (error) throw fail(error.message, { status: 401 });
      return { idToken: data.session.access_token, user: await sessionUser(data.session) };
    }

    // --- profile
    if (path === '/api/profile' && method === 'GET') {
      need();
      const p = await run(sb.from('profiles').select('*').eq('id', session.user.id).single());
      return { profile: {
        uid: p.id, email: p.email, displayName: p.display_name, phone: p.phone, countryCode: p.country_code, photoURL: p.avatar_url,
        role: p.role, loyaltyTier: p.loyalty_tier, stats: { completedBookings: p.completed_bookings, totalSpent: Number(p.total_spent) },
      } };
    }
    if (path === '/api/profile' && method === 'POST') {
      need();
      const patch = {}, src = body.profile || {};
      if ('displayName' in src) patch.display_name = String(src.displayName || '').slice(0, 120);
      if ('phone' in src) patch.phone = String(src.phone || '').slice(0, 30);
      if ('countryCode' in src) patch.country_code = String(src.countryCode || '').slice(0, 8);
      if (src.photoURL) {
        if (/^data:image\//.test(src.photoURL)) {            // avatars live in Storage, not in the table row
          const blob = await (await fetch(src.photoURL)).blob();
          const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
          const key = `${session.user.id}/avatar.${ext}`;
          await run(sb.storage.from('avatars').upload(key, blob, { upsert: true, contentType: blob.type, cacheControl: '3600' }));
          patch.avatar_url = `${sb.storage.from('avatars').getPublicUrl(key).data.publicUrl}?v=${Date.now()}`;
        } else if (/^https:\/\//.test(src.photoURL)) patch.avatar_url = src.photoURL;
      }
      if (Object.keys(patch).length) await run(sb.from('profiles').update(patch).eq('id', session.user.id));
      return { success: true, photoURL: patch.avatar_url };
    }

    // --- bookings
    if (path === '/api/user/bookings' && method === 'GET') {
      need();
      return { success: true, bookings: await run(sb.rpc('list_my_bookings', { p_limit: 200 })) };
    }
    if (path === '/api/user/bookings' && method === 'POST') {
      need();
      return await run(sb.rpc('create_booking', { p: body.booking }));
    }
    if (path.startsWith('/api/hotels/booking/')) {
      need();
      const id = decodeURIComponent(path.split('/').pop());
      if (method === 'DELETE') return await run(sb.rpc('cancel_booking', { p_id: id, p_reason: body.reason || null }));
      const rows = await run(sb.rpc('list_my_bookings', { p_limit: 500 }));
      const b = rows.find(x => x.id === id);
      if (!b) throw fail('Booking not found', { status: 404 });
      return { success: true, booking: b };
    }

    // --- favorites
    if (path === '/api/user/favorites' && method === 'GET') {
      need();
      const rows = await run(sb.from('favorites').select('property_id').eq('user_id', session.user.id));
      return { favorites: rows.map(r => r.property_id) };
    }
    if (path === '/api/user/favorites' && method === 'POST') {
      need();
      return { success: true, favorite: await run(sb.rpc('toggle_favorite', { p_property: body.itemId })) };
    }

    // --- reviews
    if (path === '/api/reviews' && method === 'POST') { need(); const out = await run(sb.rpc('submit_review', { p: body })); try { sessionStorage.removeItem('ds_rv_' + body.id); } catch {} return out; }

    // --- notifications
    if (path === '/api/notifications') {
      need();
      const rows = await run(sb.from('notifications').select('id, icon, title, msg, read_at, created_at').order('created_at', { ascending: false }).limit(50));
      return { notifications: rows.map(n => ({ id: n.id, icon: n.icon, title: n.title, msg: n.msg, read: !!n.read_at, createdAt: n.created_at })) };
    }

    // --- public forms (guests allowed)
    if (path === '/api/push/subscribe' && method === 'POST') { need(); await run(sb.rpc('save_push_subscription', { p: body })); return { success: true }; }
    if (path === '/api/push/unsubscribe' && method === 'POST') { need(); await run(sb.rpc('delete_push_subscription', { p_endpoint: body.endpoint })); return { success: true }; }
    if (path === '/api/contact') { await run(sb.rpc('submit_contact', { p_name: body.name, p_email: body.email, p_message: body.message })); return { success: true }; }
    if (path === '/api/partner-application') { await run(sb.rpc('submit_partner_application', { p: body })); return { success: true }; }

    // --- payments + e-mail: the worker keeps the gateway secret; it receives the Supabase token
    if (path.startsWith('/api/kashier/') || path.startsWith('/api/notify/')) {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      if (session) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch(`${cfg.paymentsBase || ''}${endpoint}`, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) throw fail(data.error || 'Authentication failed', { status: 401 });
      if (!res.ok) throw fail(data.error || 'Request failed', { status: res.status });
      return data;
    }

    throw fail(`Unsupported endpoint ${path}`, { status: 404 });
  }

  window.SB = { client: sb, ready, authLink, handle, signOut: () => sb.auth.signOut(),
    updatePassword: async (password) => { const { error } = await sb.auth.updateUser({ password }); if (error) throw error; } };
})();
