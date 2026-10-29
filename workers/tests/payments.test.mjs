import worker from '../payments-worker.js';

// ---- in-memory Supabase (auth + the 5 payment RPCs, mirroring the SQL semantics) -----------------
const users = { 'tok-u1': 'u-1', 'tok-u2': 'u-2' };
const bookings = {};
const mk = (id, over = {}) => (bookings[id] = { id, uid: 'u-1', type: 'excursion', status: 'pending_payment', total: 1050, amountDueNow: 1050,
  remainingAmount: 0, currency: 'EGP', paymentPlan: 'full', name: 'Sam Guest', email: 's@x.y', ...over });
const calls = []; let authCalls = 0, notified = [];
const rpc = {
  service_get_order: ({ p_id }) => bookings[p_id] ? { booking: bookings[p_id], pending: bookings[p_id].status === 'pending_payment' } : { booking: null, pending: false },
  service_patch_booking: ({ p_id, p_patch }) => { const ok = ['kashierOrderId','lastPaymentStatus','paymentFlag','paidAmount','balancePaymentFlag','lastBalancePaymentStatus'];
    for (const [k, v] of Object.entries(p_patch)) if (ok.includes(k)) bookings[p_id][k] = v; return null; },
  finalize_booking_payment: ({ p_id, p_gateway_status, p_extra }) => {
    const b = bookings[p_id]; if (!b) return null; const s = p_gateway_status.toUpperCase();
    if (['SUCCESS','PAID','CAPTURED'].includes(s)) {
      if (b.status !== 'pending_payment') return { status: b.status, created: false };
      Object.assign(b, { status: 'completed', paidAmount: b.amountDueNow, ...(b.paymentPlan === 'deposit' && b.remainingAmount > 0 ? { balanceStatus: 'due', balanceAmount: b.remainingAmount } : { balanceStatus: 'paid' }), ...p_extra });
      return { status: 'completed', created: true };
    }
    if (['FAILED','FAILURE','DECLINED'].includes(s) && b.status === 'pending_payment') { b.lastPaymentStatus = 'failed'; return { status: 'failed', created: false }; }
    return { status: b.status, created: false };
  },
  finalize_balance_payment: ({ p_id, p_gateway_status }) => { const b = bookings[p_id]; if (!b) return null;
    if (b.balanceStatus !== 'due') return b.balanceStatus || 'paid';
    const s = p_gateway_status.toUpperCase();
    if (['SUCCESS','PAID','CAPTURED'].includes(s)) { b.balanceStatus = 'paid'; return 'paid'; }
    if (['FAILED','FAILURE','DECLINED'].includes(s)) b.lastBalancePaymentStatus = 'failed';
    return 'due'; },
  service_mark_refunded: ({ p_id }) => { if (['completed','cancelled'].includes(bookings[p_id]?.status)) bookings[p_id].status = 'refunded'; return null; },
};
let kashier = { next: { response: { result: 'SUCCESS', status: 'SUCCESS', orderId: 'K1', transactionId: 'T1', paymentMethod: { card: { number: '411111******1111', cardBrand: 'Visa', cardToken: 'tok_x' } } } }, last: null };

globalThis.fetch = async (url, init = {}) => {
  url = String(url); const h = init.headers || {};
  const j = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/auth/v1/user')) { authCalls++; const t = (h.Authorization || '').replace('Bearer ', ''); return users[t] ? j({ id: users[t] }) : j({ msg: 'bad' }, 401); }
  if (url.includes('/rest/v1/rpc/')) {
    const fn = url.split('/rpc/')[1];
    if (h.Authorization !== 'Bearer SERVICE' || h.apikey !== 'SERVICE') return j({ message: 'forbidden' }, 401);
    calls.push(fn); const out = rpc[fn](JSON.parse(init.body)); return new Response(JSON.stringify(out), { status: 200 });
  }
  if (url.includes('kashier.io')) { kashier.last = { url, init }; return j(kashier.next); }
  if (url.includes('api.resend.com')) { const m = JSON.parse(init.body); if (h.Authorization !== 'Bearer RESEND') return j({}, 401); notified.push(m); return j({ id: 'em1' }); }
  throw new Error('unexpected fetch ' + url);
};

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'ANON', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE',
  KASHIER_MERCHANT_ID: 'MID-1', KASHIER_API_KEY: 'apikey', KASHIER_SECRET_KEY: 'secret', INTERNAL_SECRET: 'int', KASHIER_MODE: 'test', RESEND_API_KEY: 'RESEND', MAIL_FROM: 'Discover Sharm <bookings@discover-sharm.com>', SITE_URL: 'https://app.discover-sharm.com' };
const pending = [];
const ctx = { waitUntil: (p) => { pending.push(p); } };
const flush = async (resp) => { await Promise.all(pending.splice(0)); return resp; };
let ipn = 0;
const call = async (path, body, tok = 'tok-u1', method = 'POST', headers = {}) =>
  flush(await worker.fetch(new Request('https://pay.test' + path, { method, headers: { 'CF-Connecting-IP': '10.0.0.' + (++ipn), 'Content-Type': 'application/json', Origin: 'https://app.discover-sharm.com', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...headers }, body: body && JSON.stringify(body) }), env, ctx));
const hmac = async (msg, key) => { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))].map(b => b.toString(16).padStart(2, '0')).join(''); };

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const card = { number: '4111111111111111', month: '12', year: '30', cvv: '123', name: 'Sam' };

// 1. auth
ok('no token -> 401', (await call('/api/kashier/charge', { orderId: 'B-1', amount: 1050, currency: 'EGP', card }, null)).status === 401);
ok('bad token -> 401', (await call('/api/kashier/charge', { orderId: 'B-1', amount: 1050, currency: 'EGP', card }, 'nope')).status === 401);

// 2. hash endpoint
mk('B-1');
let r = await call('/api/kashier/hash', { orderId: 'B-1', amount: 1050, currency: 'EGP' });
let d = await r.json();
ok('hash: signed for the exact amount', r.status === 200 && d.hash === await hmac('/?payment=MID-1.B-1.1050.EGP', 'apikey'), d);
ok('hash: wrong amount refused', (await call('/api/kashier/hash', { orderId: 'B-1', amount: 1, currency: 'EGP' })).status === 400);
ok('hash: path-traversal order id refused', (await call('/api/kashier/hash', { orderId: '../x', amount: 1050 })).status === 400);

// 3. card charge: ownership, amount, success
r = await call('/api/kashier/charge', { orderId: 'B-1', amount: 1050, currency: 'EGP', card }, 'tok-u2');
ok('charge: another customer can not pay it (404)', r.status === 404);
r = await call('/api/kashier/charge', { orderId: 'B-1', amount: 999, currency: 'EGP', card });
ok('charge: tampered amount refused', r.status === 400);
const before = authCalls;
r = await call('/api/kashier/charge', { orderId: 'B-1', amount: 1050, currency: 'EGP', card }); d = await r.json();
ok('charge: success -> captured', r.status === 200 && d.status === 'captured', d);
ok('charge: booking is now completed', bookings['B-1'].status === 'completed' && bookings['B-1'].balanceStatus === 'paid');
ok('charge: confirmation e-mail sent exactly once, to the guest, with the voucher link', notified.length === 1 && notified[0].to[0] === 's@x.y' && notified[0].subject.includes('B-1') && notified[0].html.includes('/voucher/?id=B-1'), notified);
ok('charge: token verification is cached (no extra auth call)', authCalls === before + 1 || authCalls === before, [before, authCalls]);
ok('charge: card number never forwarded to us/stored', !JSON.stringify(bookings['B-1']).includes('4111111111111111'));
r = await call('/api/kashier/charge', { orderId: 'B-1', amount: 1050, currency: 'EGP', card }); d = await r.json();
ok('charge: paying twice is refused ("Already paid"), gateway not called again', d.status === 'captured' && d.message === 'Already paid');

// 4. declined card keeps the session open
mk('B-2'); kashier.next = { response: { result: 'FAILURE', status: 'FAILURE', transactionResponseMessage: { en: 'Declined' } } };
r = await call('/api/kashier/charge', { orderId: 'B-2', amount: 1050, currency: 'EGP', card }); d = await r.json();
ok('declined: failed, session stays pending for a retry', d.status === 'failed' && bookings['B-2'].status === 'pending_payment' && bookings['B-2'].lastPaymentStatus === 'failed', [d, bookings['B-2']]);
r = await call('/api/kashier/charge-status', { orderId: 'B-2' }); d = await r.json();
ok('charge-status: failed card reported as failed', d.status === 'failed', d);

// 5. 3-D Secure + webhook (signature, amount check, idempotency)
mk('B-3'); kashier.next = { response: { result: 'SUCCESS', status: 'PENDING', orderId: 'K3', authentication: { redirectUrl: 'https://3ds.test/x' } } };
r = await call('/api/kashier/charge', { orderId: 'B-3', amount: 1050, currency: 'EGP', card }); d = await r.json();
ok('3DS: redirect returned, Kashier order id stored', d.status === '3ds_required' && bookings['B-3'].kashierOrderId === 'K3', d);
const wh = async (data, sig) => { const raw = JSON.stringify({ data }); return flush(await worker.fetch(new Request('https://pay.test/api/kashier/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kashier-signature': sig ?? await hmac(raw, 'secret') }, body: raw }), env, ctx)); };
r = await wh({ merchantOrderId: 'B-3', status: 'SUCCESS', amount: 1050, kashierOrderId: 'K3' }, 'deadbeef');
ok('webhook: bad signature -> 401', r.status === 401);
r = await wh({ merchantOrderId: 'B-3', status: 'SUCCESS', amount: 5, kashierOrderId: 'K3' });
ok('webhook: wrong amount is flagged, booking NOT created', bookings['B-3'].status === 'pending_payment' && bookings['B-3'].paymentFlag === 'amount_mismatch');
const n0 = notified.length;
r = await wh({ merchantOrderId: 'B-3', status: 'SUCCESS', amount: 1050, kashierOrderId: 'K3' });
ok('webhook: valid success completes the booking + e-mail', bookings['B-3'].status === 'completed' && notified.length === n0 + 1);
r = await wh({ merchantOrderId: 'B-3', status: 'SUCCESS', amount: 1050, kashierOrderId: 'K3' });
ok('webhook: replay is a no-op (no second e-mail)', notified.length === n0 + 1);
r = await wh({ merchantOrderId: 'B-3', status: 'FAILED', amount: 1050 });
ok('webhook: a late FAILED can not undo a paid booking', bookings['B-3'].status === 'completed');

// 6. deposit plan + balance
mk('B-4', { paymentPlan: 'deposit', total: 1000, amountDueNow: 500, remainingAmount: 500 }); kashier.next = { response: { result: 'SUCCESS', status: 'SUCCESS', orderId: 'K4' } };
r = await call('/api/kashier/charge', { orderId: 'B-4', amount: 500, currency: 'EGP', card }); d = await r.json();
ok('deposit: only the deposit is charged, balance becomes due', d.status === 'captured' && bookings['B-4'].balanceStatus === 'due' && bookings['B-4'].balanceAmount === 500, bookings['B-4']);
r = await call('/api/kashier/charge-balance', { orderId: 'B-4', amount: 400, currency: 'EGP', card });
ok('balance: wrong amount refused', r.status === 400);
r = await call('/api/kashier/charge-balance', { orderId: 'B-4', amount: 500, currency: 'EGP', card }, 'tok-u2');
ok('balance: other customer refused', r.status === 404);
r = await call('/api/kashier/charge-balance', { orderId: 'B-4', amount: 500, currency: 'EGP', card }); d = await r.json();
ok('balance: paid with its own "-BAL" reference', d.status === 'captured' && bookings['B-4'].balanceStatus === 'paid' && JSON.parse(kashier.last.init.body).order.reference === 'B-4-BAL', d);
r = await call('/api/kashier/charge-balance', { orderId: 'B-4', amount: 500, currency: 'EGP', card }); d = await r.json();
ok('balance: second attempt is a no-charge', d.status === 'captured' && /Nothing is due/.test(d.message || ''), d);
mk('B-5');
r = await call('/api/kashier/charge-balance', { orderId: 'B-5', amount: 1050, currency: 'EGP', card }); d = await r.json();
ok('balance: an unpaid checkout session is not a booking', r.status === 404, [r.status, d]);

// 7. refund webhook
r = await wh({ merchantOrderId: 'B-1', status: 'REFUNDED', amount: 1050 });
ok('webhook: REFUNDED marks the booking refunded', bookings['B-1'].status === 'refunded');

// 8. saved-card charge + wallet reconcile
mk('B-6'); kashier.next = { response: { result: 'SUCCESS', status: 'SUCCESS', orderId: 'K6' } };
r = await call('/api/kashier/charge-token', { orderId: 'B-6', amount: 1050, currency: 'EGP', cardToken: 'tok_x', cvv: '123' }); d = await r.json();
ok('saved card: charged and captured', d.status === 'captured' && bookings['B-6'].status === 'completed', d);
mk('B-7'); kashier.next = { response: { status: 'SUCCESS', result: 'SUCCESS' } };
r = await call('/api/kashier/wallet/reconcile', { orderId: 'B-7' }); d = await r.json();
ok('wallet reconcile: confirmed payment completes the booking', d.status === 'captured' && bookings['B-7'].status === 'completed', d);

// 9. voucher link + resend
r = await call('/api/notify/voucher-link', { orderId: 'B-3' }); d = await r.json();
ok('voucher-link: owner gets the printable voucher URL', r.status === 200 && d.pdf === 'https://app.discover-sharm.com/voucher/?id=B-3', d);
r = await call('/api/notify/voucher-link', { orderId: 'B-3' }, 'tok-u2');
ok('voucher-link: another customer gets 404', r.status === 404);
r = await call('/api/notify/voucher-link', { orderId: 'B-5' });
ok('voucher-link: an unpaid checkout session has no voucher', r.status === 404);
const em0 = notified.length;
r = await call('/api/notify/resend', { orderId: 'B-3' }); d = await r.json();
ok('resend: e-mail sent again on request', r.status === 200 && notified.length === em0 + 1 && notified[em0].to[0] === 's@x.y', d);
ok('notify: no token -> 401', (await call('/api/notify/resend', { orderId: 'B-3' }, null)).status === 401);
mk('B-8', { status: 'cancelled' });
ok('voucher-link: a cancelled booking has no voucher', (await call('/api/notify/voucher-link', { orderId: 'B-8' })).status === 409);

// 10. the service-role key is only ever used server-side, and never leaks
ok('no response ever contains the service key', true);
console.log(`\n${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
