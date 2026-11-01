import { h, toast, ICON } from '../util.js';
import { me, sb } from '../supa.js';
import { avatar, nameOf, when, friendProfiles, getProfile } from '../social.js';
import { clean } from '../core/profanity.js';

// Chat tab: your friends, with a number on the ones who wrote to you.
export function chatListView(go) {
  const list = h('div', { class: 'list' }, h('div', { class: 'muted small' }, 'กำลังโหลด...'));
  (async () => {
    try {
      const [friends, unread] = await Promise.all([friendProfiles(), sb.from('messages').select('sender').eq('recipient', me.user.id).is('read_at', null)]);
      const n = {};
      (unread.data || []).forEach((m) => (n[m.sender] = (n[m.sender] || 0) + 1));
      friends.sort((a, b) => (n[b.id] || 0) - (n[a.id] || 0));
      list.replaceChildren(
        ...(friends.length
          ? friends.map((p) => h('button', { class: 'card person', type: 'button', onclick: () => go('chat:' + p.id) }, avatar(p, 46), h('div', { class: 'grow' }, h('b', {}, clean(nameOf(p))), h('div', { class: 'muted small' }, '@' + p.username)), n[p.id] ? h('span', { class: 'badge' }, String(n[p.id])) : null))
          : [h('div', { class: 'muted' }, 'ยังไม่มีเพื่อน แอดเพื่อนที่แท็บ Social ก่อน')]),
      );
    } catch (e) {
      list.replaceChildren(h('div', { class: 'err' }, 'โหลดไม่ได้: ' + (e.message || e)));
    }
  })();
  return h('div', { class: 'screen' }, h('div', { class: 'page-title2' }, 'Chat'), h('div', { class: 'pad stack' }, list));
}

export function chatView(go, otherId, onRead) {
  const root = h('div', { class: 'screen chat' });
  const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'กลับ', onclick: () => go('chat') });
  back.innerHTML = ICON.back;
  const title = h('h2', {}, '...');
  const head = h('div', { class: 'topbar' }, back, title);
  const log = h('div', { class: 'chat-log' });
  const input = h('input', { class: 'input', type: 'text', maxlength: 2000, placeholder: 'พิมพ์ข้อความ...' });
  const send = h('button', { class: 'btn primary', type: 'button' }, 'ส่ง');
  root.append(head, log, h('div', { class: 'chat-bar' }, input, send));

  let other = null;
  let lastKey = '';
  let timer = 0;
  let dead = false;
  root.dispose = () => {
    dead = true;
    clearInterval(timer);
  };

  async function load(first) {
    const a = me.user.id;
    const b = otherId;
    const { data, error } = await sb
      .from('messages')
      .select('id,sender,body,created_at,read_at')
      .or(`and(sender.eq.${a},recipient.eq.${b}),and(sender.eq.${b},recipient.eq.${a})`)
      .order('created_at', { ascending: false })
      .limit(100);
    if (dead || error) return;
    const msgs = data.reverse();
    const key = msgs.map((m) => m.id + (m.read_at ? 'r' : '')).join(',');
    if (key !== lastKey) {
      lastKey = key;
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80 || first;
      log.replaceChildren(
        ...(msgs.length
          ? msgs.map((m) => h('div', { class: 'bubble ' + (m.sender === a ? 'me' : 'them') }, h('div', {}, clean(m.body)), h('div', { class: 'muted tiny' }, when(m.created_at) + (m.sender === a && m.read_at ? ' · อ่านแล้ว' : ''))))
          : [h('div', { class: 'muted small center' }, 'ยังไม่มีข้อความ ทักทายเลย')]),
      );
      if (atBottom) log.scrollTop = log.scrollHeight;
    }
    if (msgs.some((m) => m.sender === b && !m.read_at)) {
      await sb.from('messages').update({ read_at: new Date().toISOString() }).eq('sender', b).eq('recipient', a).is('read_at', null);
      if (onRead) onRead();
    }
  }

  async function doSend() {
    const body = input.value.trim();
    if (!body) return;
    send.disabled = true;
    const { error } = await sb.from('messages').insert({ sender: me.user.id, recipient: otherId, body });
    send.disabled = false;
    if (error) return toast('ส่งไม่สำเร็จ ต้องเป็นเพื่อนกันก่อน');
    input.value = '';
    await load(true);
  }
  send.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && doSend());

  getProfile(otherId).then((p) => {
    other = p;
    if (!p || dead) return;
    title.textContent = clean(nameOf(p));
    head.insertBefore(avatar(p, 34), title);
  });
  load(true);
  timer = setInterval(() => load(false), 3000);
  return root;
}
