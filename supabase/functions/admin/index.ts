// Edge Function "admin": create, delete, rename accounts and reset passwords.
// Only callers whose profile has role = 'admin' are served. The service key never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const DOMAIN = 'augrant.app';
const USERNAME = /^[a-z0-9_.-]{3,24}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'ไม่ได้เข้าสู่ระบบ' }, 401);

  // Who is calling?
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const asCaller = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: u, error: ue } = await asCaller.auth.getUser(token);
  if (ue || !u.user) return json({ error: 'ไม่ได้เข้าสู่ระบบ' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: me } = await admin.from('profiles').select('role').eq('id', u.user.id).maybeSingle();
  if (!me || me.role !== 'admin') return json({ error: 'เฉพาะแอดมินเท่านั้น' }, 403);

  let body: Record<string, string> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400);
  }

  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

  try {
    switch (body.action) {
      case 'create_user': {
        const username = norm(body.username);
        const password = String(body.password ?? '');
        if (!USERNAME.test(username)) return json({ error: 'username ไม่ถูกต้อง' }, 400);
        if (password.length < 8) return json({ error: 'รหัสผ่านอย่างน้อย 8 ตัว' }, 400);
        const { data: dup } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
        if (dup) return json({ error: 'username นี้ถูกใช้แล้ว' }, 409);
        const { data: created, error } = await admin.auth.admin.createUser({
          email: `${username}@${DOMAIN}`,
          password,
          email_confirm: true,
        });
        if (error || !created.user) return json({ error: error?.message ?? 'สร้างบัญชีไม่ได้' }, 400);
        const { error: pe } = await admin.from('profiles').insert({
          id: created.user.id,
          username,
          display_name: String(body.display_name ?? username).slice(0, 40) || username,
          role: 'user',
        });
        if (pe) {
          await admin.auth.admin.deleteUser(created.user.id);
          return json({ error: pe.message }, 400);
        }
        return json({ ok: true, id: created.user.id });
      }

      case 'delete_user': {
        const id = String(body.user_id ?? '');
        if (!id) return json({ error: 'ไม่มี user_id' }, 400);
        if (id === u.user.id) return json({ error: 'ลบบัญชีตัวเองไม่ได้' }, 400);
        const { error } = await admin.auth.admin.deleteUser(id); // profiles and history cascade
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      case 'rename_user': {
        const id = String(body.user_id ?? '');
        const username = norm(body.username);
        if (!id || !USERNAME.test(username)) return json({ error: 'username ไม่ถูกต้อง' }, 400);
        const { data: dup } = await admin.from('profiles').select('id').eq('username', username).neq('id', id).maybeSingle();
        if (dup) return json({ error: 'username นี้ถูกใช้แล้ว' }, 409);
        const { error: ae } = await admin.auth.admin.updateUserById(id, { email: `${username}@${DOMAIN}`, email_confirm: true });
        if (ae) return json({ error: ae.message }, 400);
        const { error: pe } = await admin.from('profiles').update({ username }).eq('id', id);
        if (pe) return json({ error: pe.message }, 400);
        return json({ ok: true });
      }

      case 'reset_password': {
        const id = String(body.user_id ?? '');
        const password = String(body.password ?? '');
        if (!id) return json({ error: 'ไม่มี user_id' }, 400);
        if (password.length < 8) return json({ error: 'รหัสผ่านอย่างน้อย 8 ตัว' }, 400);
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: 'ไม่รู้จักคำสั่ง' }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
