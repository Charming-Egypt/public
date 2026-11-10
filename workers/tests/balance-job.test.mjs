// Hourly balance job: e-mails reminders / cancellations returned by public.balance_job. Run: node workers/tests/balance-job.test.mjs
import worker from '../payments-worker.js';
let pass = 0, fail = 0; const ok = (n, c, d) => { c ? pass++ : (fail++, console.log('FAIL', n, d ?? '')); console.log((c ? 'PASS ' : 'FAIL ') + n); };
const mails = []; let jobResult = { reminders: [], cancelled: [] }; let rpcAuth = null; const rpcCalls = []; const kashier = []; let kashierReply = { response: { result: 'SUCCESS', status: 'SUCCESS' } };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('/rest/v1/rpc/balance_job')) { rpcAuth = init.headers.Authorization; return new Response(JSON.stringify(jobResult), { status: 200 }); }
  if (url.includes('/rest/v1/rpc/')) { const fn = url.split('/rpc/')[1]; rpcCalls.push([fn, JSON.parse(init.body || '{}')]); return new Response(JSON.stringify(fn === 'finalize_balance_payment' ? (/SUCCESS/.test(JSON.parse(init.body).p_gateway_status) ? 'paid' : 'due') : null), { status: 200 }); }
  if (url.includes('fep.kashier.io')) { kashier.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify(kashierReply), { status: 200 }); }
  if (url.includes('api.resend.com')) { mails.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
  throw new Error('unexpected ' + url);
};
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE', RESEND_API_KEY: 'R', MAIL_FROM: 'DS <b@d.com>', KASHIER_MERCHANT_ID: 'MID-1', KASHIER_API_KEY: 'k', KASHIER_SECRET_KEY: 's' };
const run = async () => { const p = []; await worker.scheduled({}, env, { waitUntil: (x) => p.push(x) }); await Promise.all(p); };

await run(); ok('empty job sends nothing, uses service key', mails.length === 0 && rpcAuth === 'Bearer SERVICE');
jobResult = { reminders: [
    { id: 'B-1', email: 'a@x.com', name: 'Ann', remaining_amount: 525, currency: 'EGP', due_at: '2026-11-10T10:00:00Z', n: 1 },
    { id: 'B-2', email: 'b@x.com', name: 'Bob', remaining_amount: 100, currency: 'EGP', due_at: '2026-11-09T10:00:00Z', n: 2 },
    { id: 'B-3', email: 'not-an-email', name: 'X', remaining_amount: 1, currency: 'EGP', due_at: '2026-11-09T10:00:00Z', n: 1 }],
  cancelled: [{ id: 'B-4', email: 'c@x.com', name: 'Cy', remaining_amount: 300, currency: 'EGP' }] };
await run();
ok('3 valid e-mails (bad address skipped)', mails.length === 3, mails.length);
const by = (to) => mails.find((m) => m.to[0] === to);
ok('first reminder', /Reminder/.test(by('a@x.com').subject) && by('a@x.com').html.includes('525 EGP'));
ok('second one is "last reminder"', /Last reminder/.test(by('b@x.com').subject));
ok('cancellation notice mentions deposit kept', /cancelled/i.test(by('c@x.com').subject) && /not refunded automatically/.test(by('c@x.com').html));
ok('names are HTML-escaped', !by('a@x.com').html.includes('<script'));
jobResult = { reminders: [{ id: 'B-5', email: 'd@x.com', name: '<script>x</script>', remaining_amount: 1, currency: 'EGP', due_at: '2026-11-09T10:00:00Z', n: 1 }], cancelled: [] };
mails.length = 0; await run(); ok('script in name escaped', mails.length === 1 && !mails[0].html.includes('<script>x'));

// ---- automatic collection (AUTO_BALANCE) ----
const pay = { id: 'B-9', uid: 'u-1', card_token: 'tok_x', agreement_id: 'agr_x', masked_card: '411111******1111', remaining_amount: 525, currency: 'EGP', email: 'p@x.com', name: 'Pat', due_at: '2026-11-10T10:00:00Z' };
jobResult = { reminders: [], cancelled: [], autopay: [pay] };
mails.length = 0; kashier.length = 0; rpcCalls.length = 0;
await run(); ok('feature off (no AUTO_BALANCE): nothing is charged', kashier.length === 0 && mails.length === 0);
env.AUTO_BALANCE = 'on';
await run();
ok('charge: merchant-initiated payload (token + agreement, no CVV, no 3DS)', kashier.length === 1 && kashier[0].body.interactionSource === 'RECURRING' && kashier[0].body.paymentMethod.card.cardToken === 'tok_x' && kashier[0].body.paymentMethod.card.agreement.id === 'agr_x' && kashier[0].body.paymentMethod.card.enable3DS === false && !('securityCode' in kashier[0].body.paymentMethod.card), kashier[0]?.body);
env.AUTOPAY_INTERACTION = 'CONTAUTH'; kashier.length = 0; jobResult = { reminders: [], cancelled: [], autopay: [pay] }; await run();
ok('payload carries a timestamp', !!kashier[0]?.body.timestamp);
ok('AUTOPAY_INTERACTION overrides the interaction source', kashier[0]?.body.interactionSource === 'CONTAUTH'); delete env.AUTOPAY_INTERACTION; kashier.length = 0; mails.length = 0; rpcCalls.length = 0; await run();
ok('charge: balance reference + exact amount', kashier[0].body.order.reference === 'B-9-BAL' && kashier[0].body.order.amount === '525' && kashier[0].body.customer.reference === 'u-1');
ok('success: booking marked paid + "balance paid" e-mail', rpcCalls.some(([f, a]) => f === 'finalize_balance_payment' && a.p_id === 'B-9') && mails.length === 1 && /paid/i.test(mails[0].subject), mails.map((m) => m.subject));
kashierReply = { response: { result: 'FAILURE', status: 'FAILED', transactionResponseMessage: { en: 'Insufficient funds' } } };
mails.length = 0; rpcCalls.length = 0; await run();
ok('failure: error stored + "could not charge" e-mail', rpcCalls.some(([f, a]) => f === 'autopay_upsert' && /Insufficient/.test(a.p_patch.last_error)) && mails.length === 1 && /could not charge/i.test(mails[0].subject), mails.map((m) => m.subject));
kashierReply = { response: { result: 'SUCCESS', authentication: { redirectUrl: 'https://3ds' } } };
mails.length = 0; await run(); ok('3DS requested while the guest is away = failure, no crash', mails.length === 1 && /could not charge/i.test(mails[0].subject));
jobResult = { reminders: [{ id: 'B-8', email: 'r@x.com', name: 'R', remaining_amount: 1, currency: 'EGP', due_at: '2026-11-10T10:00:00Z', n: 1, autopay_card: '411111******1111' }], cancelled: [], autopay: [] };
mails.length = 0; await run(); ok('heads-up e-mail for autopay bookings', mails.length === 1 && /will charge/i.test(mails[0].subject) && mails[0].html.includes('1111'));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
