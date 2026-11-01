import { createClient } from '@supabase/supabase-js';
import { App } from '@capacitor/app';

export const SUPABASE_URL = 'https://rqnbkhgayhcxxvjkkwej.supabase.co';
// Publishable key: safe to ship in the app. Data is protected by the row level rules in supabase/setup.sql.
export const SUPABASE_KEY = 'sb_publishable_DK8nP_2X1Tz0UoDxp4GkqA_xVb8ktpk';
const EMAIL_DOMAIN = 'augrant.app';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export const normUsername = (u) => String(u || '').trim().toLowerCase();
export const validUsername = (u) => /^[a-z0-9_.-]{3,24}$/.test(u);
const emailOf = (u) => `${normUsername(u)}@${EMAIL_DOMAIN}`;

export const me = { user: null, profile: null };

export async function loadProfile() {
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', s.session.user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    await sb.auth.signOut();
    return null;
  }
  me.user = s.session.user;
  me.profile = data;
  return data;
}

export async function signIn(username, password) {
  const u = normUsername(username);
  const { error } = await sb.auth.signInWithPassword({ email: emailOf(u), password });
  if (error) {
    const msg = String(error.message || '');
    if (/invalid login|invalid credentials/i.test(msg)) throw new Error('Username หรือรหัสผ่านไม่ถูกต้อง');
    throw new Error('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  }
  const p = await loadProfile();
  if (!p) throw new Error('บัญชีนี้ยังไม่ได้ตั้งค่า ติดต่อแอดมิน');
  await logActivity('login', {});
  await startTracking();
  return p;
}

export async function signOutNow() {
  try {
    await logActivity('logout', {});
  } catch {
    /* offline: still sign out locally */
  }
  await stopTracking();
  await sb.auth.signOut();
  me.user = null;
  me.profile = null;
}

export async function updateProfile(fields) {
  const { data, error } = await sb.from('profiles').update(fields).eq('id', me.user.id).select().single();
  if (error) throw error;
  me.profile = data;
  await logActivity('profile_update', { fields: Object.keys(fields) });
  return data;
}

export async function logActivity(type, detail) {
  if (!me.user) return;
  await sb.from('activity').insert({ user_id: me.user.id, type, detail: detail || {} });
}

export async function saveClip(info) {
  if (!me.user) return;
  await sb.from('clips').insert({
    user_id: me.user.id,
    title: info.title,
    duration_s: info.duration,
    quality: info.quality,
    format: info.format,
    transcript: (info.transcript || '').slice(0, 600),
  });
  await logActivity('clip_created', { title: info.title, format: info.format, quality: info.quality });
}

// ---- usage tracking: one row per foreground period ----
let sessionId = null;
let beat = 0;
let listenersOn = false;

async function openSession() {
  if (!me.user || sessionId) return;
  const { data } = await sb.from('sessions').insert({ user_id: me.user.id }).select('id').single();
  sessionId = data ? data.id : null;
  clearInterval(beat);
  beat = setInterval(() => {
    if (sessionId) sb.from('sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', sessionId).then(() => {});
  }, 45000);
}

async function closeSession() {
  clearInterval(beat);
  if (!sessionId) return;
  const id = sessionId;
  sessionId = null;
  const now = new Date().toISOString();
  await sb.from('sessions').update({ ended_at: now, last_seen_at: now }).eq('id', id);
}

export async function startTracking() {
  await openSession();
  if (listenersOn) return;
  listenersOn = true;
  const onState = (active) => {
    if (!me.user) return;
    if (active) openSession();
    else closeSession();
  };
  try {
    App.addListener('appStateChange', ({ isActive }) => onState(isActive));
  } catch {
    /* web build */
  }
  document.addEventListener('visibilitychange', () => onState(!document.hidden));
}

export async function stopTracking() {
  await closeSession();
}

// ---- admin ----
export async function adminCall(action, payload) {
  const { data, error } = await sb.functions.invoke('admin', { body: { action, ...payload } });
  if (error) {
    let msg = error.message || 'error';
    try {
      const j = await error.context.json();
      if (j && j.error) msg = j.error;
    } catch {
      /* keep message */
    }
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}
