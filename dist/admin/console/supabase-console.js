// ==================== SUPABASE BACKEND FOR THE CONSOLES ====================
// The owner panels (/owner/*) and the super-admin panel (/admin) keep their screens exactly as they were.
// Only DS.api() changes: instead of calling the old workers it reads/writes Supabase.
//   - reads go through tables with Row Level Security (an owner can only ever SELECT their own rows)
//   - every write that touches money, roles, ownership or publication goes through a database function
//     that re-checks who is calling (see supabase/migrations/)
// Creating a login for a new owner needs the service key, so that one call goes to the
// `admin-create-user` Edge Function (supabase/functions/admin-create-user).
(function () {
  const cfg = window.DS_SUPABASE;
  if (!cfg || !cfg.url || !cfg.anonKey || !window.supabase) return;

  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ds_sb_session' },
  });

  window.DS_ACCESS_TOKEN = async () => (await sb.auth.getSession()).data.session?.access_token || '';   // used by DS.translate (console.js)
  // Items (hotels, excursions, transfers, restaurants, journal) are saved as JSON files in the private GitHub data repo by the content Worker
  // (cfg.contentBase). The Worker re-checks who is calling; the browser never sees a GitHub token. Without contentBase: the old database path below.
  const CB = String(cfg.contentBase || '').replace(/\/+$/, '');
  async function content(method, path, body) {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    if (!tok) throw Object.assign(new Error('الجلسة انتهت — سجّل دخول تاني'), { status: 401 });
    let r; try { r = await fetch(CB + path, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw Object.assign(new Error('تعذّر الوصول لخدمة المحتوى — جرّب تاني'), { status: 503 }); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(AR[j.code] || j.error || 'فشل الطلب'), { status: r.status });
    return j;
  }
  const KIND_OF_SCOPE = { trips: 'excursion', excursion: 'excursion', hotel: 'hotel', hotels: 'hotel', transfer: 'transfer', transfers: 'transfer', restaurant: 'restaurant', restaurants: 'restaurant' };   // owner pages pass CFG.key = trips | hotels | transfers
  const ROLE_OF_KIND = { hotel: 'hotels_owner', excursion: 'trips_owner', transfer: 'transfers_owner', restaurant: 'restaurants_owner' };
  const SITE_KIND = { destination: 'destination', article: 'article', review: 'testimonial', promoSlide: 'promo_slide' };
  const PROPERTY_TYPES = ['hotel', 'excursion', 'transfer', 'restaurant'];
  const CATALOG_FILES = { 'hotels.json': 'hotel', 'excursions.json': 'excursion', 'transfers.json': 'transfer', 'restaurants.json': 'restaurant',
    'destinations.json': 'destination', 'articles.json': 'article', 'promoSlides.json': 'promo_slide', 'reviews.json': 'testimonial' };

  const AR = {
    limit_reached: 'وصلت للحد الأقصى من العناصر المسموح بيه لحسابك',
    too_early: 'ميعاد الخدمة لسه ماجاش — تقدر تسجّل التنفيذ بعده',
    account_locked: 'طلبات الصرف متوقفة 24 ساعة بعد تغيير حساب الاستلام (حماية لحسابك)',
    price_changed: 'السعر اتغيّر',
  };
  const fail = (message, status) => Object.assign(new Error(message), { status });
  const explain = (e) => {
    if (!e) return null;
    if (e.code === '28000' || e.status === 401 || /JWT|not authenticated/i.test(e.message || '')) return fail('الجلسة انتهت — سجّل دخول تاني', 401);
    if (e.code === '42501') return fail('مش مسموح لحسابك بالعملية دي', 403);
    if (e.code === 'P0002') return fail('مش موجود', 404);
    if (AR[e.details]) return fail(AR[e.details], 409);
    if (e.code === '23505') return fail('موجود بالفعل', 409);
    return fail(e.message || 'فشل الطلب', e.status || 400);
  };
  const run = async (p) => { const { data, error } = await p; if (error) throw explain(error); return data; };
  const rpc = (name, args) => run(sb.rpc(name, args || {}));

  const nameOf = (v) => (v && typeof v === 'object') ? (v.en || v.ar || Object.values(v)[0] || '') : (v || '');
  const itemName = (b) => nameOf(b.hotelName || b.title || b.vehicleType);
  const iso = (v) => v || null;
  const pct = (f) => (f == null ? null : Math.round(Number(f) * 10000) / 100);
  const roleOf = (p) => p.role === 'super_admin' ? 'super_admin' : (ROLE_OF_KIND[(p.owner_kinds || [])[0]] || 'restaurants_owner');
  const withData = (r, extra) => ({ ...r.data, id: r.id, status: r.status, ...(r.rating_count > 0 ? { rating: Number(r.rating_avg) } : {}), ...(extra || {}) });

  // ---------- session ------------------------------------------------------------------------------
  let meCache = { t: 0, uid: null, v: null };       // one profile read per 30 s instead of one per click
  async function me() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { meCache = { t: 0, uid: null, v: null }; throw fail('الجلسة انتهت — سجّل دخول تاني', 401); }
    if (meCache.v && meCache.uid === session.user.id && Date.now() - meCache.t < 30000) return meCache.v;
    const p = await run(sb.from('profiles').select('id, display_name, email, role, owner_kinds, max_items, commission_rate, is_active').eq('id', session.user.id).single());
    if (!p.is_active) throw fail('الحساب موقوف', 403);
    meCache = { t: Date.now(), uid: session.user.id, v: { ...p, session } };
    return meCache.v;
  }

  // ---------- shared builders ---------------------------------------------------------------------------
  const accountView = (a) => a ? { method: a.method, ...a.details } : null;

  async function settings() {
    const s = await run(sb.from('platform_settings').select('*').eq('id', 1).single());
    return { rates: { hotel: pct(s.commission_hotel), excursion: pct(s.commission_excursion), transfer: pct(s.commission_transfer) }, minPayout: Number(s.min_payout), raw: s };
  }

  async function financeFor(uid, kindForRate) {
    const [bal, payouts, adjustments, account, earned, st, prof] = await Promise.all([
      rpc('owner_balance', { p_owner: uid }),
      run(sb.from('payouts').select('id, amount, status, method, account, reference, note, requested_at, paid_at').eq('owner_id', uid).order('requested_at', { ascending: false }).limit(200)),
      run(sb.from('adjustments').select('amount, reason, created_at').eq('owner_id', uid).order('created_at', { ascending: false }).limit(200)),
      run(sb.from('payout_accounts').select('method, details, locked_until').eq('owner_id', uid).maybeSingle()),
      run(sb.from('bookings').select('id, kind, created_at, service_date, check_in, subtotal, commission_rate, commission_amount, owner_amount, earned_at, guest_name, hotelName:data->hotelName, title:data->title, vehicleType:data->vehicleType')
        .eq('owner_id', uid).not('earned_at', 'is', null).eq('earning_void', false).order('earned_at', { ascending: false }).limit(1000)),
      settings(),
      run(sb.from('profiles').select('commission_rate').eq('id', uid).single()),
    ]);
    const rate = prof.commission_rate != null ? pct(prof.commission_rate) : (st.rates[kindForRate] ?? 10);
    return {
      summary: bal, rate, minPayout: st.minPayout,
      account: accountView(account), accountLockMs: account && account.locked_until ? Math.max(0, new Date(account.locked_until) - Date.now()) : 0,
      payouts: payouts.map(p => ({ id: p.id, amount: Number(p.amount), status: p.status, method: p.method, account: p.account ? { method: p.method, ...p.account } : null, reference: p.reference, note: p.note, requestedAt: p.requested_at, paidAt: p.paid_at, ownerUid: uid })),
      adjustments: adjustments.map(a => ({ amount: Number(a.amount), reason: a.reason, createdAt: a.created_at })),
      earnings: earned.map(e => ({ id: e.id, item: itemName(e), customer: e.guest_name || '', serviceDate: e.check_in || e.service_date, at: e.earned_at,
        gross: Number(e.subtotal), commission: Number(e.commission_amount), rate: pct(e.commission_rate), net: Number(e.owner_amount) })),
    };
  }

  async function listReviews(scope, who) {
    let q = sb.from('reviews').select('id, rating, name, comment, photo_url, images, owner_reply, replied_at, created_at, status, property_id, properties!inner(kind, name, owner_id)')
      .order('created_at', { ascending: false }).limit(500);
    if (scope !== 'admin') q = q.eq('properties.owner_id', who.id).eq('properties.kind', KIND_OF_SCOPE[scope]);
    const rows = await run(q);
    return rows.filter(r => r.status === 'published').map(r => ({
      id: r.id, type: r.properties.kind, itemId: r.property_id, itemName: r.properties.name, rating: r.rating, name: r.name, comment: r.comment,
      photoURL: r.photo_url, images: r.images || [], createdAt: r.created_at,
      ...(r.owner_reply ? { reply: { text: r.owner_reply, byName: who.display_name || '', at: r.replied_at } } : {}),
    }));
  }

  const BRANCH_COLS = 'id, property_id, status, data, admin_note, created_at, sort_order';
  const branchOut = (r) => ({ ...r.data, id: r.id, propertyId: r.property_id, status: r.status, adminNote: r.admin_note || '', createdAt: r.created_at, restaurant: nameOf((r.properties && r.properties.data || {}).name) });

  // ---------- the router ----------------------------------------------------------------------------------------
  async function api(CFG, path, o = {}) {
    const url = new URL(path, 'http://x'), seg = url.pathname.split('/').filter(Boolean), method = (o.method || 'GET').toUpperCase(), body = o.body || {};
    const scope = CFG.key;                       // 'admin' | 'trips' | 'hotel' | 'transfer'
    const kind = KIND_OF_SCOPE[scope];
    const who = await me();
    const isAdmin = who.role === 'super_admin';
    const [a, b, c, d] = seg;

    if (a === 'langs') { const rows = await run(sb.from('ui_languages').select('code, native_name').eq('enabled', true).order('sort_order')); return { languages: rows.map(r => ({ code: r.code, nativeName: r.native_name })) }; }

    if (a === 'me') {
      if (scope === 'admin') { if (!isAdmin) throw fail('الحساب ده مش سوبر أدمن', 403); return { uid: who.id, name: who.display_name, email: who.email, role: 'super_admin' }; }
      if (who.role !== 'owner' || !(who.owner_kinds || []).includes(kind)) throw fail('الحساب ده مش مسجّل كأونر للنوع ده', 403);
      const { count } = await sb.from('properties').select('id', { count: 'exact', head: true }).eq('owner_id', who.id).eq('kind', kind).neq('status', 'archived');
      return { uid: who.id, name: who.display_name, email: who.email, role: ROLE_OF_KIND[kind], maxItems: who.max_items ?? (kind === 'hotel' ? 2 : null), itemCount: count || 0, hasReviews: true };
    }

    if (a === 'upload' && method === 'POST' && CB) return content('POST', '/upload', { image: body.image, cat: window.DS_UPLOAD_CAT || kind || 'excursion' });
    if (a === 'upload' && method === 'POST') {
      const blob = await (await fetch(body.image)).blob();
      const key = `${who.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
      await run(sb.storage.from('listing-media').upload(key, blob, { contentType: blob.type, cacheControl: '31536000' }));
      return { url: sb.storage.from('listing-media').getPublicUrl(key).data.publicUrl };
    }

    // ===== bookings (owner + admin) =====
    if (a === 'bookings') {
      if (!b && method === 'GET') {
        const bookings = isAdmin && scope === 'admin'
          ? await rpc('admin_list_bookings', { p_status: url.searchParams.get('status') || null, p_kind: url.searchParams.get('type') || null, p_owner: url.searchParams.get('owner') || null, p_limit: 300 })
          : (await rpc('list_incoming_bookings', { p_limit: 300 })).filter(x => !kind || x.type === kind);
        return { bookings };
      }
      const id = decodeURIComponent(b || '');
      if (c === 'cancel' && method === 'POST') { await rpc('cancel_booking', { p_id: id, p_reason: body.reason || null }); return { success: true }; }
      if (method === 'PUT') {
        if (scope === 'admin' && body.status) await rpc('admin_set_booking_status', { p_id: id, p_status: body.status, p_note: body.adminNote ?? null });
        if ('ownerStatus' in body || 'ownerNote' in body) await rpc('owner_update_booking', { p_id: id, p_owner_status: body.ownerStatus ?? null, p_note: body.ownerNote ?? null });
        return { success: true };
      }
      if (method === 'DELETE') { await rpc('admin_delete_booking', { p_id: id }); return { success: true }; }
    }

    // ===== reviews =====
    if (a === 'reviews') {
      if (!b && method === 'GET') return { reviews: await listReviews(scope, who) };
      // admin: /reviews/<type>/<itemId>/<id>[/reply]   owner: /reviews/<itemId>/<id>[/reply]
      const rid = decodeURIComponent((scope === 'admin' ? seg[3] : seg[2]) || '');
      const tail = scope === 'admin' ? seg[4] : seg[3];
      if (tail === 'reply' && method === 'PUT') { await rpc('owner_reply_review', { p_id: rid, p_reply: body.text || '' }); return { reply: { text: body.text, byName: who.display_name || '', at: new Date().toISOString() } }; }
      if (tail === 'reply' && method === 'DELETE') { await rpc('owner_reply_review', { p_id: rid, p_reply: '' }); return { success: true }; }
      if (!tail && method === 'DELETE') { await rpc('admin_set_review_status', { p_id: rid, p_status: 'hidden' }); return { success: true }; }
    }

    // ===== owner finance =====
    if (scope !== 'admin') {
      if (a === 'finance') return await financeFor(who.id, kind);
      if (a === 'payout-account' && method === 'PUT') {
        const details = body.method === 'bank' ? { bank: body.bank } : { instapay: body.instapay };
        const cur = await run(sb.from('payout_accounts').select('owner_id').eq('owner_id', who.id).maybeSingle());
        if (cur) await run(sb.from('payout_accounts').update({ method: body.method, details }).eq('owner_id', who.id));
        else await run(sb.from('payout_accounts').insert({ owner_id: who.id, method: body.method, details }));
        return { success: true };
      }
      if (a === 'payouts' && method === 'POST') { await rpc('request_payout', { p_amount: Number(body.amount) }); return { success: true }; }
      if (a === 'payouts' && method === 'DELETE') { await rpc('cancel_payout', { p_id: decodeURIComponent(b) }); return { success: true }; }

      // ===== restaurant / café branches (owner side; every change goes back to "pending" for the super admin) =====
      if (a === 'branches' && kind === 'restaurant') {
        const clean = (v) => { const x = { ...v }; ['id', 'status', 'propertyId', 'adminNote', 'createdAt', 'restaurant'].forEach(k => delete x[k]); return x; };
        if (!b && method === 'GET') return { branches: (await run(sb.from('restaurant_branches').select(BRANCH_COLS + ', properties(data)').eq('owner_id', who.id).order('created_at', { ascending: true }))).map(branchOut) };
        if (!b && method === 'POST') { const row = await run(sb.from('restaurant_branches').insert({ property_id: body.propertyId, data: clean(body) }).select('id').single()); return { success: true, id: row.id }; }
        const bid = decodeURIComponent(b);
        if (method === 'PUT') { await run(sb.from('restaurant_branches').update({ data: clean(body) }).eq('id', bid)); return { success: true }; }
        if (method === 'DELETE') { await run(sb.from('restaurant_branches').delete().eq('id', bid)); return { success: true }; }
      }
      // ===== owner items =====
      if (a === 'items' && CB) {
        if (!b && method === 'GET') return content('GET', '/items/' + kind);
        if (!b && method === 'POST') return content('POST', '/items/' + kind, body);
        const cid = encodeURIComponent(decodeURIComponent(b));
        if (method === 'PUT') return content('PUT', '/items/' + kind + '/' + cid, body);
        if (method === 'DELETE') return content('DELETE', '/items/' + kind + '/' + cid);
      }
      if (a === 'items') {
        if (!b && method === 'GET') {
          const rows = await run(sb.from('properties').select('id, status, data, rating_avg, rating_count').eq('owner_id', who.id).eq('kind', kind).neq('status', 'archived').order('created_at', { ascending: false }));
          return { items: rows.map(r => withData(r)) };
        }
        const clean = (v) => { const x = { ...v }; delete x.id; delete x.status; delete x.owner; delete x.rating; return x; };
        if (!b && method === 'POST') {
          const row = await run(sb.from('properties').insert({ kind, owner_id: who.id, status: 'pending_review', data: clean(body) }).select('id, status, data').single());
          return { success: true, item: withData(row) };
        }
        const id = decodeURIComponent(b);
        if (method === 'PUT') { await run(sb.from('properties').update({ data: clean(body) }).eq('id', id)); return { success: true }; }
        if (method === 'DELETE') { await rpc('owner_archive_property', { p_id: id }); return { success: true }; }
      }
    }

    // ===== super admin only =====
    if (scope === 'admin') {
      if (!isAdmin) throw fail('مش مسموح', 403);

      if (a === 'stats') return await rpc('console_stats');

      if (a === 'roles') {
        if (!b && method === 'GET') {
          const [profs, accts, props] = await Promise.all([
            run(sb.from('profiles').select('id, display_name, email, phone, role, owner_kinds, is_active, commission_rate').neq('role', 'user').order('created_at', { ascending: false }).limit(500)),
            run(sb.from('payout_accounts').select('owner_id, method')),
            run(sb.from('properties').select('owner_id, kind').not('owner_id', 'is', null).neq('status', 'archived').limit(5000)),
          ]);
          const acc = Object.fromEntries(accts.map(x => [x.owner_id, x.method]));
          const counts = {}; props.forEach(p => { const m = counts[p.owner_id] = counts[p.owner_id] || {}; m[p.kind] = (m[p.kind] || 0) + 1; });
          return { roles: profs.map(p => ({ uid: p.id, name: p.display_name, email: p.email, phone: p.phone, role: roleOf(p), status: p.is_active ? 'active' : 'suspended',
            commissionRate: pct(p.commission_rate), hasPayout: !!acc[p.id], payoutMethod: acc[p.id], itemCounts: counts[p.id] || {} })) };
        }
        if (!b && method === 'POST') {
          let uid = body.uid;
          if (!uid) {
            const { data: { session } } = await sb.auth.getSession();
            const res = await fetch(`${cfg.url}/functions/v1/admin-create-user`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey, Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ email: body.email, password: body.password, name: body.name, phone: body.phone }) });
            const out = await res.json().catch(() => ({}));
            if (!res.ok) throw fail(out.error || 'تعذّر إنشاء الحساب', res.status);
            uid = out.uid;
          }
          await rpc('admin_update_owner', { p_user: uid, p_name: body.name || null, p_phone: body.phone || null, p_role: body.role, p_commission: body.commissionRate === '' || body.commissionRate == null ? null : Number(body.commissionRate), p_set_commission: true });
          return { success: true, uid };
        }
        const uid = decodeURIComponent(b || '');
        if (c === 'reset-password' && method === 'POST') {
          const p = await run(sb.from('profiles').select('email').eq('id', uid).single());
          const { error } = await sb.auth.resetPasswordForEmail(p.email, { redirectTo: location.origin + '/' });
          if (error) throw fail(error.message, 400); return { success: true };
        }
        if (method === 'PUT') {
          if ('status' in body && Object.keys(body).length === 1) { await rpc('admin_set_user_active', { p_user: uid, p_active: body.status !== 'suspended' }); return { success: true }; }
          await rpc('admin_update_owner', { p_user: uid, p_name: body.name ?? null, p_phone: body.phone ?? null, p_role: body.role ?? null,
            p_commission: body.commissionRate === '' || body.commissionRate == null ? null : Number(body.commissionRate), p_set_commission: 'commissionRate' in body });
          return { success: true };
        }
        if (method === 'DELETE') { await rpc('admin_set_user_role', { p_user: uid, p_role: 'user' }); return { success: true }; }
      }

      if (a === 'customers') {
        const off = Number(url.searchParams.get('offset') || 0), lim = Math.min(Number(url.searchParams.get('limit') || 50), 100);
        const { data, error, count } = await sb.from('profiles').select('id, display_name, email, phone, country_code, role, owner_kinds, completed_bookings, total_spent', { count: 'exact' }).order('created_at', { ascending: false }).range(off, off + lim - 1);
        if (error) throw explain(error);
        return { total: count || 0, users: data.map(p => ({ uid: p.id, role: p.role === 'user' ? undefined : roleOf(p),
          profile: { name: p.display_name, email: p.email, phone: p.phone, fullPhone: p.phone ? `${p.country_code || ''}${p.phone}` : '' }, stats: { completedBookings: p.completed_bookings, totalSpent: Number(p.total_spent) } })) };
      }

      if (a === 'items') {
        const type = b, id = c ? decodeURIComponent(c) : null;
        if (CB && (PROPERTY_TYPES.includes(type) || type === 'journal')) {
          const cid = id ? encodeURIComponent(id) : '';
          if (!id) return method === 'GET' ? content('GET', '/items/' + type) : content('POST', '/items/' + type, body);
          if (d === 'publish' || d === 'unpublish') return content('POST', '/items/' + type + '/' + cid + '/' + d, body);
          return content(method, '/items/' + type + '/' + cid, method === 'PUT' ? body : undefined);
        }
        if (PROPERTY_TYPES.includes(type)) {
          if (!id && method === 'GET') {
            const rows = await run(sb.from('properties').select('id, status, owner_id, data, rating_avg, rating_count').eq('kind', type).order('sort_order').order('created_at').limit(1000));
            return { items: rows.map(r => withData(r, { owner: r.owner_id || undefined })) };
          }
          const split = (v) => { const x = { ...v }; const owner = x.owner, status = x.status; delete x.owner; delete x.status; delete x.rating; delete x.id; return { data: x, owner, status }; };
          if (!id && method === 'POST') {
            const { data, owner, status } = split(body);
            const row = await run(sb.from('properties').insert({ kind: type, owner_id: owner || null, status: status || 'published', data }).select('id, status, owner_id, data').single());
            return { success: true, item: withData(row, { owner: row.owner_id || undefined }) };
          }
          if (method === 'PUT') {
            const { data, owner, status } = split(body);
            await run(sb.from('properties').update({ data }).eq('id', id));
            await rpc('admin_set_property_meta', { p_id: id, p_owner: owner || null, p_clear_owner: !owner });
            if (status) await rpc('admin_set_property_status', { p_id: id, p_status: status });
            return { success: true };
          }
          if (method === 'DELETE') { await run(sb.from('properties').delete().eq('id', id)); return { success: true }; }
        } else if (SITE_KIND[type]) {
          const sk = SITE_KIND[type];
          if (!id && method === 'GET') { const rows = await run(sb.from('site_content').select('id, data').eq('kind', sk).order('sort_order').limit(1000)); return { items: rows.map(r => ({ ...r.data, id: r.id })) }; }
          const strip = (v) => { const x = { ...v }; delete x.id; delete x.owner; delete x.status; return x; };
          if (!id && method === 'POST') {
            const nid = `${sk.slice(0, 3)}_${Math.random().toString(36).slice(2, 10)}`;
            await run(sb.from('site_content').insert({ kind: sk, id: nid, data: strip(body) })); return { success: true, item: { ...strip(body), id: nid } };
          }
          if (method === 'PUT') { await run(sb.from('site_content').update({ data: strip(body) }).eq('kind', sk).eq('id', id)); return { success: true }; }
          if (method === 'DELETE') { await run(sb.from('site_content').delete().eq('kind', sk).eq('id', id)); return { success: true }; }
        }
      }

      if (a === 'finance') {
        if (b === 'settings') {
          if (method === 'GET') { const s = await settings(); return { settings: { rates: s.rates, minPayout: s.minPayout } }; }
          const r = body.rates || {}; await rpc('admin_update_settings', { p_hotel: Number(r.hotel), p_excursion: Number(r.excursion), p_transfer: Number(r.transfer), p_min_payout: Number(body.minPayout) }); return { success: true };
        }
        if (b === 'payouts' && c) { await rpc('admin_set_payout_status', { p_id: c, p_status: body.status, p_reference: body.reference || null, p_note: body.note || null }); return { success: true }; }
        if (b === 'payouts' && method === 'POST') { await rpc('admin_record_payout', { p_owner: body.ownerUid, p_amount: Number(body.amount), p_method: body.method || null, p_reference: body.reference || null, p_note: body.note || null }); return { success: true }; }
        if (b === 'payouts') {
          let q = sb.from('payouts').select('id, owner_id, amount, status, method, account, reference, note, requested_at, paid_at').order('requested_at', { ascending: false }).limit(300);
          const st = url.searchParams.get('status'); if (st) q = q.eq('status', st);
          return { payouts: (await run(q)).map(p => ({ id: p.id, ownerUid: p.owner_id, amount: Number(p.amount), status: p.status, method: p.method, account: p.account ? { method: p.method, ...p.account } : null, reference: p.reference, note: p.note, requestedAt: p.requested_at, paidAt: p.paid_at })) };
        }
        if (b === 'adjustments' && method === 'POST') { await rpc('admin_add_adjustment', { p_owner: body.ownerUid, p_amount: Number(body.amount), p_reason: body.reason }); return { success: true }; }
        if (b === 'owner' && c) {
          const p = await run(sb.from('profiles').select('owner_kinds').eq('id', c).single());
          return await financeFor(c, (p.owner_kinds || [])[0]);
        }
        if (b === 'report') return await report(url.searchParams);
      }

      if (a === 'applications') {
        if (!b && method === 'GET') return { applications: (await rpc('admin_list_applications')).map(x => ({ ...x, status: x.status === 'pending' ? 'new' : x.status })) };
        if (b && method === 'GET') return { application: await rpc('admin_get_application', { p_id: b }) };
        if (b && method === 'PUT') { await rpc('admin_set_application_status', { p_id: b, p_status: body.status === 'new' ? 'pending' : body.status, p_note: body.adminNote || null }); return { success: true }; }
        if (b && method === 'DELETE') { await run(sb.from('partner_applications').delete().eq('id', b)); return { success: true }; }
      }

      if (a === 'messages') {
        if (!b && method === 'GET') { const rows = await run(sb.from('contact_messages').select('id, name, email, message, status, created_at').order('created_at', { ascending: false }).limit(300)); return { messages: rows.map(m => ({ id: m.id, name: m.name, email: m.email, message: m.message, status: m.status, createdAt: m.created_at })) }; }
        if (b && method === 'PUT') { await run(sb.from('contact_messages').update({ status: body.status }).eq('id', b)); return { success: true }; }
        if (b && method === 'DELETE') { await run(sb.from('contact_messages').delete().eq('id', b)); return { success: true }; }
      }

      // ===== restaurant / café branches: the approval queue =====
      if (a === 'branches') {
        if (!b && method === 'GET') {
          const rows = await run(sb.from('restaurant_branches').select(BRANCH_COLS + ', owner_id, properties(id, data)').order('created_at', { ascending: false }).limit(500));
          const ids = [...new Set(rows.map(r => r.owner_id))], profs = ids.length ? await run(sb.from('profiles').select('id, display_name, email').in('id', ids)) : [];
          const pm = Object.fromEntries(profs.map(p => [p.id, p]));
          return { branches: rows.map(r => ({ ...branchOut(r), ownerUid: r.owner_id, ownerName: (pm[r.owner_id] || {}).display_name || (pm[r.owner_id] || {}).email || '' })) };
        }
        const clean = (v) => { const x = { ...v }; ['id', 'status', 'propertyId', 'adminNote', 'createdAt', 'restaurant', 'ownerUid', 'ownerName'].forEach(k => delete x[k]); return x; };
        if (!b && method === 'POST') { const row = await run(sb.from('restaurant_branches').insert({ property_id: body.propertyId, data: clean(body) }).select('id').single()); await rpc('admin_set_branch_status', { p_id: row.id, p_status: 'approved', p_note: null }); return { success: true, id: row.id }; }
        const bid = decodeURIComponent(b);
        if (method === 'PUT') {
          if (body.status && Object.keys(body).length <= 3) { await rpc('admin_set_branch_status', { p_id: bid, p_status: body.status, p_note: body.note || null }); return { success: true }; }
          await run(sb.from('restaurant_branches').update({ data: clean(body) }).eq('id', bid)); if (body.status) await rpc('admin_set_branch_status', { p_id: bid, p_status: body.status, p_note: null }); return { success: true };
        }
        if (method === 'DELETE') { await run(sb.from('restaurant_branches').delete().eq('id', bid)); return { success: true }; }
      }
      // ===== site settings + extra interface languages =====
      if (a === 'settings') {
        if (method === 'GET') {
          const [row, langs] = await Promise.all([run(sb.from('site_settings').select('value, updated_at').eq('id', 1).single()), run(sb.from('ui_languages').select('code, name, native_name, dir, enabled, sort_order, strings').order('sort_order'))]);
          return { settings: row.value || {}, updatedAt: row.updated_at, languages: langs.map(l => ({ code: l.code, name: l.name, nativeName: l.native_name, dir: l.dir, enabled: l.enabled, order: l.sort_order, keys: Object.keys(l.strings || {}).length })) };
        }
        await rpc('admin_set_site_settings', { p_value: body.value || {} }); return { success: true };
      }
      if (a === 'languages') {
        if (method === 'POST') { await rpc('admin_save_language', { p_code: body.code, p_name: body.name, p_native: body.nativeName, p_dir: body.dir || 'ltr', p_strings: body.strings || {}, p_enabled: body.enabled !== false }); return { success: true }; }
        if (method === 'DELETE') { await rpc('admin_delete_language', { p_code: decodeURIComponent(b || '') }); return { success: true }; }
      }
      if (a === 'maintenance' && b === 'purge-pending') return { removed: await rpc('admin_purge_pending') };
      if (a === 'maintenance' && b === 'reindex') return { bookingsUpdated: await rpc('admin_reindex_booking_owners') };

      // the old "raw files" screen: now a JSON view/import of the catalog tables
      if (a === 'files') return { files: Object.keys(CATALOG_FILES) };
      if (a === 'file') {
        const f = url.searchParams.get('file') || (body && body.file), k = CATALOG_FILES[f];
        if (!k) throw fail('ملف غير معروف', 404);
        if (method === 'GET') {
          const rows = PROPERTY_TYPES.includes(k)
            ? (await run(sb.from('properties').select('id, data').eq('kind', k).order('sort_order').limit(2000))).map(r => ({ ...r.data, id: r.id }))
            : (await run(sb.from('site_content').select('id, data').eq('kind', k).order('sort_order').limit(2000))).map(r => ({ ...r.data, id: r.id }));
          return { content: JSON.stringify(rows), sha: 'db' };
        }
        let arr; try { arr = JSON.parse(body.content); } catch { throw fail('JSON غير صالح', 400); }
        if (!Array.isArray(arr) || arr.some(x => !x || typeof x.id !== 'string')) throw fail('لازم مصفوفة عناصر وكل عنصر له id', 400);
        for (const it of arr) {
          const { id, ...data } = it;
          if (PROPERTY_TYPES.includes(k)) { const e = await run(sb.from('properties').select('id').eq('id', id).maybeSingle()); if (e) await run(sb.from('properties').update({ data }).eq('id', id)); else await run(sb.from('properties').insert({ id, kind: k, status: 'published', data })); }
          else await run(sb.from('site_content').upsert({ kind: k, id, data }, { onConflict: 'kind,id' }));
        }
        return { success: true, upserted: arr.length };
      }
    }
    throw fail(`Unsupported endpoint ${method} ${path}`, 404);
  }

  // ---------- accounting report ------------------------------------------------------------------------------------------
  async function report(sp) {
    const from = sp.get('from'), to = sp.get('to'), basis = sp.get('basis') || 'booked', type = sp.get('type'), owner = sp.get('owner');
    let q = sb.from('bookings').select('id, kind, owner_id, created_at, service_date, check_in, subtotal, taxes, commission_rate, commission_amount, owner_amount, earned_at, earning_void, guest_name, hotelName:data->hotelName, title:data->title, vehicleType:data->vehicleType')
      .eq('status', 'completed').order('created_at', { ascending: false }).limit(1501);
    const col = basis === 'realized' ? 'earned_at' : 'created_at';
    if (basis === 'realized') q = q.not('earned_at', 'is', null);
    if (from) q = q.gte(col, from);
    if (to) q = q.lt(col, new Date(new Date(to).getTime() + 86400000).toISOString().slice(0, 10));
    if (type) q = q.eq('kind', type);
    if (owner) q = q.eq('owner_id', owner);
    const [raw, st, balances, profs, payouts] = await Promise.all([run(q), settings(), rpc('admin_owner_balances'),
      run(sb.from('profiles').select('id, display_name, email, owner_kinds, commission_rate').eq('role', 'owner').limit(500)),
      run(sb.from('payouts').select('amount, status').in('status', ['paid', 'requested']).limit(5000))]);
    const truncated = raw.length > 1500, list = raw.slice(0, 1500);
    const pm = Object.fromEntries(profs.map(p => [p.id, p])), bal = Object.fromEntries(balances.map(x => [x.uid, x]));
    const expectedRate = (r) => { const p = pm[r.owner_id]; return p && p.commission_rate != null ? Number(p.commission_rate) : Number(st.raw['commission_' + r.kind] ?? st.raw.default_commission_rate); };
    const rows = list.map(r => { const realized = !!r.earned_at && !r.earning_void;
      return { id: r.id, type: r.kind, ownerUid: r.owner_id, item: itemName(r), customer: r.guest_name || '', createdAt: r.created_at, serviceDate: r.check_in || r.service_date, gross: Number(r.subtotal),
        rate: realized ? pct(r.commission_rate) : pct(expectedRate(r)), commission: realized ? Number(r.commission_amount) : null, net: realized ? Number(r.owner_amount) : null, realized }; });
    const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
    const t = { gross: sum(list, r => Number(r.subtotal)), taxes: sum(list, r => Number(r.taxes)),
      commissionRealized: sum(rows.filter(r => r.realized), r => r.commission),
      commissionPending: sum(list.filter(r => !(r.earned_at && !r.earning_void)), r => Number(r.subtotal) * expectedRate(r)),
      netRealized: sum(rows.filter(r => r.realized), r => r.net),
      owed: sum(balances, x => Math.max(0, x.available)),
      paidOut: sum(payouts.filter(p => p.status === 'paid'), p => Number(p.amount)), pendingPayouts: sum(payouts.filter(p => p.status === 'requested'), p => Number(p.amount)),
      unowned: sum(rows.filter(r => !r.ownerUid), r => r.gross) };
    const owners = profs.map(p => { const mine = rows.filter(r => r.ownerUid === p.id), b = bal[p.id] || { available: 0, paid: 0 };
      return { uid: p.id, name: p.display_name || p.email, role: roleOf({ role: 'owner', owner_kinds: p.owner_kinds }), bookings: mine.length, gross: sum(mine, r => r.gross),
        commissionRealized: sum(mine.filter(r => r.realized), r => r.commission), commissionPending: sum(mine.filter(r => !r.realized), r => r.gross * expectedRate({ owner_id: p.id, kind: (p.owner_kinds || [])[0] })),
        netRealized: sum(mine.filter(r => r.realized), r => r.net), balance: { available: Number(b.available), paid: Number(b.paid) } }; }).filter(o => o.bookings || o.balance.available || o.balance.paid);
    return { totals: t, owners, rows, truncated };
  }

  // ---------- auth used by console.js -----------------------------------------------------------------------------------
  window.DSX = {
    api,
    async login(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error('الإيميل أو الباسورد غلط');
    },
    async session() { const { data: { session } } = await sb.auth.getSession(); return !!session; },
    async logout() { meCache = { t: 0, uid: null, v: null }; try { await sb.auth.signOut(); } catch {} },
  };
})();
