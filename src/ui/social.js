import { h, icon, toast, ICON, confirmSheet, fmtDate } from '../util.js';
import { me, sb } from '../supa.js';
import { avatar, nameOf, linkButtons, listPeople, getProfile, friendshipWith, addFriend, acceptFriend, removeFriendship, noteView } from '../social.js';
import { decorate } from './shop.js';
import { clean } from '../core/profanity.js';

// Social tab: people you may know, with search.
export function socialView(go) {
  const list = h('div', { class: 'list' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'ค้นหาชื่อหรือ Username', 'aria-label': 'ค้นหา' });
  let timer = 0;
  async function load() {
    list.replaceChildren(h('div', { class: 'muted small' }, 'กำลังโหลด...'));
    try {
      const people = await listPeople(search.value);
      list.replaceChildren(
        ...(people.length
          ? people.map((p) =>
              h(
                'button',
                { class: 'card person', type: 'button', onclick: () => go('user:' + p.id) },
                avatar(p, 46),
                h('div', { class: 'grow' }, h('b', {}, clean(nameOf(p))), h('div', { class: 'muted small' }, '@' + p.username)),
                p.role === 'admin' ? h('span', { class: 'pill admin' }, 'admin') : null,
              ),
            )
          : [h('div', { class: 'muted' }, search.value ? 'ไม่พบคนที่ค้นหา' : 'ยังไม่มีคนอื่นในระบบ')]),
      );
    } catch (e) {
      list.replaceChildren(h('div', { class: 'err' }, 'โหลดไม่ได้: ' + (e.message || e)));
    }
  }
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 350);
  });
  load();
  return h('div', { class: 'screen' }, h('div', { class: 'page-title2' }, 'Social'), h('div', { class: 'pad stack' }, search, h('b', {}, 'แนะนำให้รู้จัก'), list));
}

// Someone else's profile: round picture, name, when the account was made, friend button.
export function userView(go, id) {
  const root = h('div', { class: 'screen' });
  const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'กลับ', onclick: () => go('social') });
  back.innerHTML = ICON.back;
  root.append(h('div', { class: 'topbar' }, back, h('h2', {}, 'โปรไฟล์')));
  const body = h('div', { class: 'profile-card' }, h('div', { class: 'muted' }, 'กำลังโหลด...'));
  root.append(body);
  if (id === me.user.id) {
    go('profile');
    return root;
  }
  noteView(id);

  async function load() {
    try {
      const [p, fr, posts, friends] = await Promise.all([
        getProfile(id, true),
        friendshipWith(id),
        sb.from('posts').select('id,likes(count),comments(count)').eq('author', id),
        sb.from('friendships').select('id', { count: 'exact', head: true }).eq('status', 'accepted').or(`requester.eq.${id},addressee.eq.${id}`),
      ]);
      if (!p) return body.replaceChildren(h('div', { class: 'err' }, 'ไม่พบบัญชีนี้'));
      const rows = posts.data || [];
      const likes = rows.reduce((a, r) => a + ((r.likes && r.likes[0] && r.likes[0].count) || 0), 0);
      const comments = rows.reduce((a, r) => a + ((r.comments && r.comments[0] && r.comments[0].count) || 0), 0);
      const action = h('div', { class: 'row' });
      if (!fr) {
        action.append(h('button', { class: 'btn primary', type: 'button', onclick: async () => { try { await addFriend(id); toast('ส่งคำขอเป็นเพื่อนแล้ว'); load(); } catch (e) { toast('ส่งไม่สำเร็จ: ' + (e.message || e)); } } }, icon('plus'), 'Add friend'));
      } else if (fr.status === 'accepted') {
        action.append(
          h('span', { class: 'pill friend' }, icon('check'), 'Friend'),
          h('button', { class: 'btn primary', type: 'button', onclick: () => go('chat:' + id) }, 'Chat'),
          h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { if (await confirmSheet('เลิกเป็นเพื่อน', 'เลิกเป็นเพื่อนกับ ' + nameOf(p) + ' ใช่ไหม', 'เลิกเป็นเพื่อน')) { await removeFriendship(fr.id); load(); } } }, 'เลิกเป็นเพื่อน'),
        );
      } else if (fr.requester === me.user.id) {
        action.append(h('button', { class: 'btn', type: 'button', onclick: async () => { await removeFriendship(fr.id); toast('ยกเลิกคำขอแล้ว'); load(); } }, 'Request (รอรับ)'));
      } else {
        action.append(
          h('button', { class: 'btn primary', type: 'button', onclick: async () => { await acceptFriend(fr.id); toast('เป็นเพื่อนกันแล้ว'); load(); } }, 'Accept'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { await removeFriendship(fr.id); load(); } }, 'Decline'),
        );
      }
      const cover = h('div', { class: 'cover small', style: p.cover_data ? { backgroundImage: `url(${p.cover_data})` } : {} });
      const avBox = h('div', {}, avatar(p, 92));
      const nameEl = h('h2', {}, clean(nameOf(p)));
      decorate(p.id, { avBox, size: 92, p, nameEl, bgEl: cover });
      body.replaceChildren(
        cover,
        h('div', { class: 'who' }, avBox, h('div', {}, nameEl, h('div', { class: 'muted' }, '@' + p.username, ' ', p.role === 'admin' ? h('span', { class: 'pill admin' }, 'admin') : null))),
        h('div', { class: 'muted small' }, 'สร้างบัญชีเมื่อ ' + fmtDate(p.created_at)),
        linkButtons(p.links),
        h('div', { class: 'stats' }, stat(rows.length, 'โพสต์'), stat(friends.count || 0, 'เพื่อน'), stat(likes, 'ไลก์'), stat(comments, 'คอมเมนต์')),
        action,
        h('button', { class: 'btn', type: 'button', onclick: () => go('posts:' + id) }, 'ดูโพสต์ของ ' + clean(nameOf(p))),
      );
    } catch (e) {
      body.replaceChildren(h('div', { class: 'err' }, 'โหลดไม่ได้: ' + (e.message || e)));
    }
  }
  load();
  return root;
}

export const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, String(n)), h('span', { class: 'muted small' }, label));
