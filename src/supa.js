import { createClient } from '@supabase/supabase-js';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const isAppNative = Capacitor.isNativePlatform();
const WEB_HOME = 'https://augrixs.github.io/Augrant/';
const APP_SCHEME = 'com.augrixs.augrant://auth';

export const SUPABASE_URL = 'https://rqnbkhgayhcxxvjkkwej.supabase.co';
// Publishable key: safe to ship in the app. Data is protected by the row level rules in supabase/setup.sql.
export const SUPABASE_KEY = 'sb_publishable_DK8nP_2X1Tz0UoDxp4GkqA_xVb8ktpk';
const EMAIL_DOMAIN = 'augrant.app';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isAppNative },
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
  me.user = s.session.user;
  me.profile = data || null; // no row yet = signed up but still has to pick a username
  return data || null;
}

// `who` is a username or an email address.
export async function signIn(who, password) {
  const id = String(who || '').trim();
  let email = id.includes('@') ? id.toLowerCase() : emailOf(id);
  if (!id.includes('@')) {
    try {
      const { data } = await sb.rpc('login_email', { p_username: normUsername(id) });
      if (data) email = data;
    } catch {
      /* the plain username email is used */
    }
  }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = String(error.message || '');
    if (/invalid login|invalid credentials/i.test(msg)) throw new Error('Username/อีเมล หรือรหัสผ่านไม่ถูกต้อง');
    throw new Error('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  }
  const p = await loadProfile();
  if (!p) return null; // still needs a username: the app opens the setup page
  await logActivity('login', {});
  await startTracking();
  return p;
}

// ---- sign up with an emailed 6-digit code ----
const niceAuthError = (e) => {
  const m = String((e && e.message) || e || '');
  if (/rate limit|too many|seconds/i.test(m)) return 'ขอรหัสถี่เกินไป รอสักครู่แล้วลองใหม่';
  if (/expired|invalid/i.test(m)) return 'รหัสไม่ถูกต้องหรือหมดอายุ';
  if (/valid email|invalid format/i.test(m)) return 'อีเมลไม่ถูกต้อง';
  if (!m || m === '{}' || /sending|smtp|unexpected|500/i.test(m)) return 'ส่งอีเมลไม่ได้ ระบบส่งอีเมลของแอปมีปัญหา แจ้งแอดมิน หรือลองใหม่ภายหลัง';
  return m;
};

export async function sendEmailCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true, emailRedirectTo: 'https://augrixs.github.io/Augrant/' } });
  if (error) throw new Error(niceAuthError(error));
}

export async function verifyEmailCode(email, code) {
  const { error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: String(code).trim(), type: 'email' });
  if (error) throw new Error(niceAuthError(error));
  return loadProfile();
}

export async function usernameFree(u) {
  const { data, error } = await sb.rpc('username_free', { p_username: normUsername(u) });
  if (error) throw error;
  return !!data;
}

// Last step of sign-up: password, unique username, optional birthday and gender.
export async function finishSignUp({ username, displayName, password, birthday, gender }) {
  const u = normUsername(username);
  if (!validUsername(u)) throw new Error('Username ใช้ a-z 0-9 _ . - ยาว 3-24 ตัว');
  if (!(await usernameFree(u))) throw new Error('Username นี้มีคนใช้แล้ว');
  if (password) {
    const { error: pe } = await sb.auth.updateUser({ password });
    if (pe) throw new Error(niceAuthError(pe));
  }
  const row = { id: me.user.id, username: u, display_name: String(displayName || '').trim().slice(0, 30) || u };
  if (birthday) row.birthday = birthday;
  if (gender === 'male' || gender === 'female') row.gender = gender;
  const { error } = await sb.from('profiles').insert(row);
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Username นี้มีคนใช้แล้ว' : error.message);
  await loadProfile();
  await logActivity('login', {});
  await startTracking();
  return me.profile;
}

// Google. On the phone app the browser comes back through the com.augrixs.augrant:// link.
export const needVerify = () => { try { return localStorage.getItem('augrant_verify') === '1'; } catch { return false; } };
export const setVerify = (on) => { try { on ? localStorage.setItem('augrant_verify', '1') : localStorage.removeItem('augrant_verify'); } catch { /* ignore */ } };
export async function googleSignIn() {
  setVerify(true);
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: isAppNative ? APP_SCHEME : WEB_HOME, skipBrowserRedirect: isAppNative, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw new Error(error.message);
  if (isAppNative && data && data.url) await Browser.open({ url: data.url });
}

// On an Android phone's browser: hand the signed-in session to the installed app.
export const canOpenApp = !isAppNative && /Android/i.test(navigator.userAgent || '');
export async function openAppWithSession() {
  const { data } = await sb.auth.getSession();
  const s = data && data.session;
  if (!s) throw new Error('not signed in');
  window.location.href = `${APP_SCHEME}#access_token=${encodeURIComponent(s.access_token)}&refresh_token=${encodeURIComponent(s.refresh_token)}`;
}

// Reads the tokens Supabase puts on the link after Google sign-in.
export async function handleAuthUrl(url) {
  const u = String(url || '');
  if (!u.startsWith(APP_SCHEME)) return false;
  const q = new URLSearchParams(u.split('#')[1] || u.split('?')[1] || '');
  const at = q.get('access_token');
  const rt = q.get('refresh_token');
  try {
    await Browser.close();
  } catch {
    /* already closed */
  }
  if (!at || !rt) return false;
  const { error } = await sb.auth.setSession({ access_token: at, refresh_token: rt });
  return !error;
}

// Settings: link or change the email of an existing account (needs the 6-digit code)
export async function startEmailChange(email) {
  const { error } = await sb.auth.updateUser({ email: email.trim().toLowerCase() });
  if (error) throw new Error(niceAuthError(error));
}
export async function finishEmailChange(email, code) {
  const { error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: String(code).trim(), type: 'email_change' });
  if (error) throw new Error(niceAuthError(error));
  const { data } = await sb.auth.getUser();
  if (data && data.user) me.user = data.user;
}
export const hasRealEmail = () => !!(me.user && me.user.email && !me.user.email.endsWith('@' + EMAIL_DOMAIN));

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
