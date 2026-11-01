import { h, toast } from '../util.js';
import { me, sb } from '../supa.js';
import { avatar, nameOf, when, acceptFriend, removeFriendship } from '../social.js';
import { clean } from '../core/profanity.js';

const WHAT = {
  friend_accept: 'รับคำขอเป็นเพื่อนของคุณแล้ว',
  like: 'กดไลก์โพสต์ของคุณ',
  comment: 'คอมเมนต์โพสต์ของคุณ',
  share: 'แชร์โพสต์ของคุณ',
  friend_request: 'ส่งคำขอเป็นเพื่อน',
};

export function inboxView(go, onRead) {
  const root = h('div', { class: 'screen' });
  const reqBox = h('div', { class: 'list' });
  const noteBox = h('div', { class: 'list' });
  root.append(h('div', { class: 'page-title2' }, 'Inbox'), h('div', { class: 'pad stack' }, h('b', {}, 'คำขอเป็นเพื่อน'), reqBox, h('b', {}, 'การแจ้งเตือน'), noteBox));

  async function load() {
    const [rq, nt] = await Promise.all([
      sb.from('friendships').select('id,created_at,req:profiles!friendships_requester_fkey(id,username,display_name,avatar_data)').eq('status', 'pending').eq('addressee', me.user.id).order('created_at', { ascending: false }),
      sb.from('notifications').select('id,type,post_id,body,read,created_at,actor_p:profiles!notifications_actor_fkey(id,username,display_name,avatar_data)').eq('user_id', me.user.id).neq('type', 'friend_request').order('created_at', { ascending: false }).limit(60),
    ]);
    if (rq.error || nt.error) {
      reqBox.replaceChildren(h('div', { class: 'err' }, 'โหลดไม่ได้: ' + ((rq.error || nt.error).message || '')));
      return;
    }
    reqBox.replaceChildren(
      ...(rq.data.length
        ? rq.data.map((r) => {
            const done = (msg) => {
              toast(msg);
              load();
              if (onRead) onRead();
            };
            return h(
              'div',
              { class: 'card person' },
              h('button', { class: 'plain', type: 'button', onclick: () => go('user:' + r.req.id) }, avatar(r.req, 46)),
              h('div', { class: 'grow' }, h('b', {}, clean(nameOf(r.req))), h('div', { class: 'muted small' }, 'ขอเป็นเพื่อน · ' + when(r.created_at))),
              h('button', { class: 'btn primary sm', type: 'button', onclick: async () => { await acceptFriend(r.id); done('เป็นเพื่อนกันแล้ว'); } }, 'รับ'),
              h('button', { class: 'btn sm', type: 'button', onclick: async () => { await removeFriendship(r.id); done('ปฏิเสธแล้ว'); } }, 'ลบ'),
            );
          })
        : [h('div', { class: 'muted small' }, 'ไม่มีคำขอ')]),
    );
    noteBox.replaceChildren(
      ...(nt.data.length
        ? nt.data.map((n) =>
            h(
              'button',
              { class: 'card person' + (n.read ? '' : ' unread'), type: 'button', onclick: () => (n.post_id ? go('postview:' + n.post_id) : go('user:' + n.actor_p.id)) },
              avatar(n.actor_p, 42),
              h('div', { class: 'grow' }, h('div', {}, h('b', {}, clean(nameOf(n.actor_p))), ' ' + (WHAT[n.type] || '')), n.body ? h('div', { class: 'muted small' }, '“' + clean(n.body) + '”') : null, h('div', { class: 'muted small' }, when(n.created_at))),
            ),
          )
        : [h('div', { class: 'muted small' }, 'ยังไม่มีการแจ้งเตือน')]),
    );
    // opening the Inbox marks everything as read
    if (nt.data.some((n) => !n.read)) {
      await sb.from('notifications').update({ read: true }).eq('user_id', me.user.id).eq('read', false);
      if (onRead) onRead();
    }
  }
  load();
  return root;
}
