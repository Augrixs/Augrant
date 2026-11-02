// Auru: wallet, daily claim, shop and equipped cosmetics. All money logic lives in Supabase
// (security-definer functions); this file only reads state and calls them.
import { sb, me } from './supa.js';

// What each shop item looks like. Prices and start dates come from the shop_items table.
export const LOOKS = {
  halloween_frame: { slot: 'frame', th: 'กรอบฟักทองเรืองแสง', en: 'Glowing Pumpkin Frame', cls: 'fr-pumpkin' },
  halloween_name: { slot: 'name_style', th: 'ชื่อส้มเรืองแสงลายฮาโลวีน', en: 'Halloween Glow Name', cls: 'nm-pumpkin' },
  halloween_bg: { slot: 'background', th: 'พื้นหลังโปรไฟล์ส้มฮาโลวีน', en: 'Halloween Profile Background', cls: 'bg-pumpkin' },
  frame_blue: { slot: 'frame', th: 'กรอบน้ำเงิน', en: 'Blue Frame', cls: 'fr-blue' },
  frame_sky: { slot: 'frame', th: 'กรอบฟ้าอ่อน', en: 'Sky Frame', cls: 'fr-sky' },
  frame_gold: { slot: 'frame', th: 'กรอบทอง', en: 'Gold Frame', cls: 'fr-gold' },
  frame_neon: { slot: 'frame', th: 'กรอบนีออน', en: 'Neon Frame', cls: 'fr-neon' },
  frame_rainbow: { slot: 'frame', th: 'กรอบสายรุ้ง', en: 'Rainbow Frame', cls: 'fr-rainbow' },
  name_blue: { slot: 'name_style', th: 'ชื่อสีน้ำเงิน', en: 'Blue Name', cls: 'nm-blue' },
  name_sky: { slot: 'name_style', th: 'ชื่อฟ้าอ่อนเรืองแสง', en: 'Sky Glow Name', cls: 'nm-sky' },
  name_gold: { slot: 'name_style', th: 'ชื่อทองเรืองแสง', en: 'Gold Glow Name', cls: 'nm-gold' },
  name_rainbow: { slot: 'name_style', th: 'ชื่อสายรุ้ง', en: 'Rainbow Name', cls: 'nm-rainbow' },
  bg_blue: { slot: 'background', th: 'พื้นหลังน้ำเงิน', en: 'Blue Background', cls: 'bg-blue' },
  bg_sky: { slot: 'background', th: 'พื้นหลังฟ้าอ่อน', en: 'Sky Background', cls: 'bg-sky' },
  bg_aurora: { slot: 'background', th: 'พื้นหลังออโรรา', en: 'Aurora Background', cls: 'bg-aurora' },
  blue_bundle: { slot: 'bundle', th: 'Blue Bundle (ขายตลอด)', en: 'Blue Bundle (always on sale)', contains: ['frame_blue', 'name_sky', 'bg_blue'], price: 440, own: true },
  rainbow_bundle: { slot: 'bundle', th: 'Rainbow Bundle (ขายตลอด)', en: 'Rainbow Bundle (always on sale)', contains: ['frame_rainbow', 'name_rainbow', 'bg_aurora'], price: 800, own: true },
  halloween_bundle: { slot: 'bundle', th: 'Halloween Bundle', en: 'Halloween Bundle', contains: ['halloween_frame', 'halloween_name', 'halloween_bg'] },
};
export const SLOTS = ['frame', 'name_style', 'background'];

const pick = (r, ...keys) => {
  for (const k of keys) if (r && r[k] !== undefined && r[k] !== null) return r[k];
  return undefined;
};
const tzOffset = () => -new Date().getTimezoneOffset(); // minutes east of UTC, e.g. 420 for Thailand
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isoWeekday = (d = new Date()) => ((d.getDay() + 6) % 7) + 1; // Mon=1 .. Sun=7
export const dailyAmount = (d = new Date()) => 100 + 10 * (isoWeekday(d) - 1);

export const TASKS = [
  { id: 'post', reward: 20, th: 'โพสต์ 1 โพสต์วันนี้', en: 'Make a post today' },
  { id: 'comment', reward: 10, th: 'คอมเมนต์ 1 ครั้งวันนี้', en: 'Write a comment today' },
  { id: 'like', reward: 10, th: 'กดไลก์ 1 โพสต์วันนี้', en: 'Like a post today' },
];
export const MONTHLY = 500;

export async function loadEconomy() {
  const uid = me.user && me.user.id;
  const out = { balance: 0, items: [], owned: new Set(), equipped: {}, claimedToday: false, tasksDone: new Set(), monthClaimed: false };
  if (!uid) return out;
  const [w, items, inv, eq, dc, tc, mc] = await Promise.all([
    sb.from('wallets').select('*').eq('user_id', uid).maybeSingle(),
    sb.from('shop_items').select('*'),
    sb.from('inventory').select('*').eq('user_id', uid),
    sb.from('equipped').select('*').eq('user_id', uid),
    sb.from('daily_claims').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(3),
    sb.from('task_claims').select('task,day').eq('user_id', uid).eq('day', localDay()),
    sb.from('monthly_claims').select('month').eq('user_id', uid),
  ]);
  out.balance = Number((w.data && pick(w.data, 'balance')) || 0);
  out.items = (items.data || []).map((r) => ({
    id: pick(r, 'id', 'item_id', 'slug', 'key'),
    price: Number(pick(r, 'price', 'cost') || 0),
    startsAt: pick(r, 'starts_at') ? new Date(pick(r, 'starts_at')) : null,
    endsAt: pick(r, 'ends_at') ? new Date(pick(r, 'ends_at')) : null,
    raw: r,
  }));
  for (const r of inv.data || []) out.owned.add(pick(r, 'item_id', 'item'));
  for (const r of eq.data || []) out.equipped[pick(r, 'slot')] = pick(r, 'item_id', 'item');
  // "claimed today": any date-looking value on the newest rows that equals today's local date
  const today = localDay();
  out.claimedToday = (dc.data || []).some((r) => Object.values(r).some((v) => typeof v === 'string' && v.slice(0, 10) === today && /^\d{4}-\d{2}-\d{2}/.test(v)));
  for (const r of tc.data || []) out.tasksDone.add(r.task);
  out.monthClaimed = (mc.data || []).some((r) => r.month === localDay().slice(0, 7));
  return out;
}

// Rows other people can see: what a list of users has equipped.
export async function equippedOf(ids) {
  const map = {};
  if (!ids.length) return map;
  const { data } = await sb.from('equipped').select('*').in('user_id', ids);
  for (const r of data || []) (map[r.user_id] ||= {})[pick(r, 'slot')] = pick(r, 'item_id', 'item');
  return map;
}

const call = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};
export const claimDaily = () => call('claim_daily', { p_tz_offset_min: tzOffset() });
export const claimTask = (id) => call('claim_task', { p_task: id, p_tz_offset_min: tzOffset() });
export const claimMonthly = () => call('claim_monthly', { p_tz_offset_min: tzOffset() });
export const buyBundle = (id) => call('buy_bundle', { p_bundle: id });
export const buyItem = (id) => call('buy_item', { p_item: id });
export const equipItem = (id) => call('equip_item', { p_item: id });
export const unequipSlot = (slot) => call('unequip_slot', { p_slot: slot });

export const clsOf = (id) => (LOOKS[id] && LOOKS[id].cls) || '';
