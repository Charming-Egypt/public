// Edge Function: send-push
// Delivers a Web Push to every device of the user that a row in public.notifications belongs to.
//
// Setup (once):
//   1. node tools/gen-vapid.mjs                                   -> prints a VAPID public + private key
//   2. supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@discover-sharm.com PUSH_WEBHOOK_SECRET=<random string>
//   3. supabase functions deploy send-push --no-verify-jwt
//   4. Dashboard -> Database -> Webhooks -> Create:  table `notifications`, event INSERT,
//      type "Supabase Edge Functions" -> send-push, add HTTP header  x-webhook-secret: <the same random string>
//   5. Cloudflare Pages (app project) variable  DS_VAPID_PUBLIC_KEY = the public key, then redeploy.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const APP_URL = Deno.env.get('APP_URL') || 'https://app.discover-sharm.com';
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) return json({ error: 'Unauthorized' }, 401);

  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return json({ error: 'VAPID keys are not set' }, 500);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:support@discover-sharm.com', pub, priv);

  let body: { type?: string; record?: { user_id?: string; title?: string; msg?: string; icon?: string; id?: string } };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const n = body.record;
  if (body.type !== 'INSERT' || !n?.user_id) return json({ skipped: true });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: subs, error } = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', n.user_id);
  if (error) return json({ error: error.message }, 500);

  const payload = JSON.stringify({ title: n.title || 'Discover Sharm', body: n.msg || '', url: APP_URL + '/notifications/', tag: n.id || undefined });
  let sent = 0; const dead: string[] = [];
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint);   // the browser dropped the subscription
    }
  }));
  if (dead.length) await db.from('push_subscriptions').delete().in('endpoint', dead);
  return json({ sent, removed: dead.length });
});
