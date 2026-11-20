// Edge Function: admin-create-user
// Lets a SUPER ADMIN create a login (e-mail + password) for a new owner from the admin console.
// Creating an auth user needs the service-role key, so it can not run in the browser.
//
// Deploy:  supabase functions deploy admin-create-user
// The platform injects SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',          // the caller must still present a valid super-admin JWT
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') || '';

  // 1. who is calling? Ask the database, as the caller, whether they are a super admin.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: user } = await asCaller.auth.getUser();
  if (!user?.user) return json({ error: 'Unauthorized' }, 401);
  const { data: isAdmin } = await asCaller.rpc('is_super_admin');
  if (isAdmin !== true) return json({ error: 'Forbidden' }, 403);

  // 2. validate the input
  let body: { email?: string; password?: string; name?: string; phone?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) return json({ error: 'إيميل غير صالح' }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: 'الباسورد لازم يكون 8 حروف على الأقل' }, 400);

  // 3. create the login (the database trigger creates the matching profile row)
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name: String(body.name || '').slice(0, 120), phone: String(body.phone || '').slice(0, 30) },
  });
  if (error || !data.user) {
    const taken = /already|registered|exists/i.test(error?.message || '');
    return json({ error: taken ? 'الإيميل ده مسجّل بالفعل — اختار "ترقية حساب موجود"' : (error?.message || 'تعذّر إنشاء الحساب') }, taken ? 409 : 400);
  }

  return json({ success: true, uid: data.user.id });
});
