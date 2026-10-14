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
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ds_sb_session' },
  });

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

  // ---- ready: refresh an old session before the app boots ------------------------
  const ready = (async () => {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session) { authToken = data.session.access_token; localStorage.setItem('ds_auth_token', authToken); }
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

  async function readCatalog(file) {
    if (PROPERTY_FILES[file]) {
      const rows = await run(sb.from('properties').select('data, rating_avg, rating_count')
        .eq('kind', PROPERTY_FILES[file]).eq('status', 'published').order('sort_order').order('created_at'));
      return rows.map(r => {
        const item = r.data;
        if (r.rating_count > 0) { item.rating = Number(r.rating_avg); item.reviews = r.rating_count; }   // live numbers beat the seeded ones
        return item;
      });
    }
    if (CONTENT_FILES[file]) {
      const rows = await run(sb.from('site_content').select('data').eq('kind', CONTENT_FILES[file]).eq('published', true).order('sort_order'));
      return rows.map(r => r.data);
    }
    throw fail('Unknown catalog file', { status: 404 });
  }

  // ---- the router: legacy endpoint -> Supabase ---------------------------------------
  async function handle(endpoint, options = {}) {
    const url = new URL(endpoint, 'http://x');
    const path = url.pathname;
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
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
        options: { data: { name: body.name, phone: body.phone || '', countryCode: body.countryCode || '' } },
      });
      if (error) throw fail(error.message, { status: 400 });
      if (!data.session) throw fail('Check your inbox: we sent you a link to confirm your email, then log in.', { status: 202, confirm: true });
      return { idToken: data.session.access_token, user: await sessionUser(data.session) };
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
    if (path === '/api/reviews' && method === 'GET') {
      const rows = await run(sb.from('reviews').select('id, name, rating, comment, photo_url, images, owner_reply, created_at')
        .eq('property_id', url.searchParams.get('id')).eq('status', 'published').order('created_at', { ascending: false }).limit(50));
      return { reviews: rows.map(r => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, photoURL: r.photo_url, images: r.images, reply: r.owner_reply, createdAt: r.created_at })) };
    }
    if (path === '/api/reviews' && method === 'POST') { need(); return await run(sb.rpc('submit_review', { p: body })); }

    // --- notifications
    if (path === '/api/notifications') {
      need();
      const rows = await run(sb.from('notifications').select('id, icon, title, msg, read_at, created_at').order('created_at', { ascending: false }).limit(50));
      return { notifications: rows.map(n => ({ id: n.id, icon: n.icon, title: n.title, msg: n.msg, read: !!n.read_at, createdAt: n.created_at })) };
    }

    // --- public forms (guests allowed)
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

  window.SB = { client: sb, ready, handle, signOut: () => sb.auth.signOut() };
})();
