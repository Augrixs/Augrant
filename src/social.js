// Data helpers and small widgets shared by Social, Post, Inbox and Chat.
import { h } from './util.js';
import { sb, me } from './supa.js';

export const SHARE_BASE = 'https://augrixs.github.io/Augrant/';
export const BASIC = 'id,username,display_name,role,avatar_data,created_at';

export const nameOf = (p) => (p && (p.display_name || p.username)) || '?';

// Circle profile picture, or the first letter of the name when there is none.
export function avatar(p, size = 40) {
  const el = h('div', { class: 'avatar', style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.42) + 'px' } });
  if (p && p.avatar_data) el.style.backgroundImage = `url(${p.avatar_data})`;
  else el.textContent = nameOf(p).slice(0, 1).toUpperCase();
  return el;
}

export function when(iso) {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export async function getProfile(id, withCover = false) {
  const { data, error } = await sb.from('profiles').select(withCover ? BASIC + ',cover_data' : BASIC).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listPeople(q) {
  let req = sb.from('profiles').select(BASIC).neq('id', me.user.id).order('created_at', { ascending: false }).limit(60);
  const t = String(q || '').trim().replace(/[%,()]/g, '');
  if (t) req = req.or(`username.ilike.%${t}%,display_name.ilike.%${t}%`);
  const { data, error } = await req;
  if (error) throw error;
  return data;
}

// null, or the friendship row between me and `otherId`
export async function friendshipWith(otherId) {
  const { data, error } = await sb
    .from('friendships')
    .select('*')
    .or(`and(requester.eq.${me.user.id},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${me.user.id})`)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function addFriend(otherId) {
  const { error } = await sb.from('friendships').insert({ requester: me.user.id, addressee: otherId });
  if (error) throw error;
}
export async function acceptFriend(id) {
  const { error } = await sb.from('friendships').update({ status: 'accepted' }).eq('id', id);
  if (error) throw error;
}
export async function removeFriendship(id) {
  const { error } = await sb.from('friendships').delete().eq('id', id);
  if (error) throw error;
}

export async function friendIds() {
  const { data, error } = await sb.from('friendships').select('requester,addressee').eq('status', 'accepted');
  if (error) throw error;
  return data.map((r) => (r.requester === me.user.id ? r.addressee : r.requester));
}

export async function friendProfiles() {
  const ids = await friendIds();
  if (!ids.length) return [];
  const { data, error } = await sb.from('profiles').select(BASIC).in('id', ids);
  if (error) throw error;
  return data;
}

// numbers for the bottom bar badges
export async function badgeCounts() {
  const uid = me.user.id;
  const q = (t, f) => f(sb.from(t).select('id', { count: 'exact', head: true }));
  const [fr, req, nt, ms] = await Promise.all([
    q('friendships', (x) => x.eq('status', 'accepted')),
    q('friendships', (x) => x.eq('status', 'pending').eq('addressee', uid)),
    q('notifications', (x) => x.eq('user_id', uid).eq('read', false)),
    q('messages', (x) => x.eq('recipient', uid).is('read_at', null)),
  ]);
  const n = (r) => r.count || 0;
  const allN = await q('notifications', (x) => x.eq('user_id', uid));
  return { friends: n(fr), requests: n(req), unread: n(nt) + n(req), messages: n(ms), hasInbox: n(allN) + n(req) > 0 };
}

/* how often I open each person's posts and profile: used to rank the feed */
const VIEW_KEY = 'augrant.views';
export function noteView(authorId) {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    v[authorId] = (v[authorId] || 0) + 1;
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
export function viewCounts() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
  } catch {
    return {};
  }
}

export function postLink(id) {
  return `${SHARE_BASE}#/post/${id}`;
}
