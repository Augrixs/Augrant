// Bans: an admin bans an account for a time and a reason. The database refuses posts, comments, likes,
// messages and friend requests from a banned account, and the app shows the ban screen.
import { sb, me } from './supa.js';

export const DURATIONS = [
  [1, '1 Min'],
  [10, '10 Mins'],
  [60, '1 Hour'],
  [1440, '1 Day'],
  [10080, '7 Days'],
  [43200, '30 Days'],
  [0, 'Permanent'],
];
export const REASONS = ['Bullying', 'NSFW', 'Hacking', 'Spam', 'Other'];

export function lengthLabel(mins) {
  const hit = DURATIONS.find(([m]) => m === mins);
  if (hit) return hit[1];
  if (mins >= 1440) return Math.round(mins / 1440) + ' Days';
  if (mins >= 60) return Math.round(mins / 60) + ' Hours';
  return mins + ' Mins';
}

// The active ban of this account (or of another one, for admins), or null.
export async function activeBan(userId = me.user && me.user.id) {
  if (!userId) return null;
  const { data } = await sb.from('bans').select('*').eq('user_id', userId).maybeSingle();
  if (!data) return null;
  const until = data.until ? new Date(data.until) : null;
  if (until && until.getTime() <= Date.now()) return null;
  const mins = until ? Math.max(1, Math.round((until - new Date(data.created_at)) / 60000)) : 0;
  return { reason: data.reason, note: data.note, until, minutes: mins, label: until ? lengthLabel(mins) : 'Permanent' };
}

export async function banUser(userId, minutes, reason, note) {
  const { error } = await sb.rpc('admin_ban_user', { p_user: userId, p_minutes: minutes, p_reason: reason, p_note: note || null });
  if (error) throw new Error(error.message);
}
export async function unbanUser(userId) {
  const { error } = await sb.rpc('admin_unban_user', { p_user: userId });
  if (error) throw new Error(error.message);
}
