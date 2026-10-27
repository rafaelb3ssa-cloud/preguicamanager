import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const fail = (message: string, status = 400) => reply({ error: message }, status);
const sha = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, '0')).join('');
};
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
type Profile = { id: string; display_name: string; role: 'owner' | 'manager' | 'staff'; active: boolean };

async function currentProfile(req: Request): Promise<Profile | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (token.length < 32) return null;
  const { data: session } = await db.from('app_sessions').select('profile_id, expires_at')
    .eq('token_hash', await sha(token)).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!session) return null;
  const { data } = await db.from('profiles').select('id,display_name,role,active').eq('id', session.profile_id).eq('active', true).maybeSingle();
  return data as Profile | null;
}
const canManage = (profile: Profile) => profile.role === 'owner' || profile.role === 'manager';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return fail('Método não permitido.', 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('Pedido inválido.'); }
  const action = String(body.action || '');

  if (action === 'list-users') {
    const { data, error } = await db.from('profiles').select('id,display_name').eq('active', true).order('display_name');
    if (error) return fail('Não foi possível carregar os utilizadores.', 500);
    return reply({ users: data || [] });
  }

  if (action === 'login') {
    const profileId = String(body.profileId || '');
    const pin = String(body.pin || '');
    if (!/^[0-9]{4,8}$/.test(pin) || !/^[0-9a-f-]{36}$/i.test(profileId)) return fail('PIN ou utilizador inválido.', 401);
    const attemptKey = `pin:${profileId}`;
    const { data: locked } = await db.rpc('check_pin_login_lock', { p_attempt_key: attemptKey });
    if (locked) return fail('Demasiadas tentativas. Tenta novamente dentro de 15 minutos.', 429);
    const { data: valid, error: verifyError } = await db.rpc('verify_app_pin', { p_profile_id: profileId, p_pin: pin });
    if (verifyError || valid !== true) {
      await db.rpc('record_pin_login_attempt', { p_attempt_key: attemptKey, p_success: false });
      return fail('PIN incorreto.', 401);
    }
    await db.rpc('record_pin_login_attempt', { p_attempt_key: attemptKey, p_success: true });
    const { data: profile, error } = await db.from('profiles').select('id,display_name,role,active').eq('id', profileId).eq('active', true).single();
    if (error || !profile) return fail('Utilizador indisponível.', 401);
    const token = randomToken();
    const { error: sessionError } = await db.from('app_sessions').insert({ token_hash: await sha(token), profile_id: profile.id, expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() });
    if (sessionError) return fail('Não foi possível iniciar sessão.', 500);
    return reply({ token, profile });
  }

  if (action === 'logout') {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (token) await db.from('app_sessions').delete().eq('token_hash', await sha(token));
    return reply({ ok: true });
  }

  const actor = await currentProfile(req);
  if (!actor) return fail('Sessão expirada. Entra novamente.', 401);
  if (action === 'session') return reply({ profile: actor });

  if (action.startsWith('users:')) {
    if (!canManage(actor)) return fail('Só a gerência pode gerir utilizadores.', 403);
    if (action === 'users:list') {
      const { data, error } = await db.from('profiles').select('id,display_name,role,active,created_at').order('created_at');
      return error ? fail('Não foi possível carregar a equipa.', 500) : reply({ users: data || [] });
    }
    if (action === 'users:create') {
      const name = String(body.name || '').trim();
      const pin = String(body.pin || '');
      const role = actor.role === 'owner' && body.role === 'manager' ? 'manager' : 'staff';
      if (!name || name.length > 80 || !/^[0-9]{4,8}$/.test(pin)) return fail('Indica um nome e um PIN de 4 a 8 algarismos.');
      const { data, error } = await db.rpc('create_pin_profile', { p_name: name, p_role: role, p_pin: pin });
      return error ? fail('Não foi possível criar a conta.', 400) : reply({ user: data });
    }
    const userId = String(body.userId || '');
    const { data: target, error: targetError } = await db.from('profiles').select('id,role,active').eq('id', userId).maybeSingle();
    if (targetError || !target) return fail('Utilizador não encontrado.', 404);
    if (target.role === 'owner') return fail('A conta proprietária não pode ser alterada por aqui.', 403);
    if (actor.role !== 'owner' && target.role !== 'staff') return fail('Só o proprietário pode gerir contas de gerência.', 403);
    if (action === 'users:deactivate') {
      const { error } = await db.from('profiles').update({ active: false }).eq('id', userId);
      await db.from('app_sessions').delete().eq('profile_id', userId);
      return error ? fail('Não foi possível desativar a conta.', 500) : reply({ ok: true });
    }
    if (action === 'users:update') {
      const patch: Record<string, unknown> = {};
      if (typeof body.name === 'string' && body.name.trim()) patch.display_name = body.name.trim().slice(0, 80);
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (actor.role === 'owner' && (body.role === 'manager' || body.role === 'staff')) patch.role = body.role;
      const { error } = Object.keys(patch).length ? await db.from('profiles').update(patch).eq('id', userId) : { error: null };
      if (typeof body.pin === 'string' && body.pin) {
        const { error: pinError } = await db.rpc('change_profile_pin', { p_profile_id: userId, p_pin: body.pin });
        if (pinError) return fail('O PIN deve ter 4 a 8 algarismos.', 400);
        await db.from('app_sessions').delete().eq('profile_id', userId);
      }
      return error ? fail('Não foi possível atualizar a conta.', 500) : reply({ ok: true });
    }
  }
  return fail('Ação desconhecida.', 404);
});
