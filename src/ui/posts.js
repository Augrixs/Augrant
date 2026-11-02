import { h, icon, toast, sheet, ICON, ago, loadingOverlay, confirmSheet } from '../util.js';
import { me, sb } from '../supa.js';
import { avatar, nameOf, when, friendIds, postLink, noteView, viewCounts, getProfile } from '../social.js';
import { clean } from '../core/profanity.js';

const BGS = [
  ['#2f6bff', '#6c3bff'],
  ['#ff6b9a', '#ff8a3d'],
  ['#12b886', '#2f6bff'],
  ['#222222', '#555555'],
  ['#b28dff', '#62d9ff'],
  ['#e5484d', '#7a1f1f'],
];
const MAX_VIDEO = 50 * 1024 * 1024;
const SELECT = 'id,author,kind,body,bg,media_path,created_at,profiles:author(id,username,display_name,avatar_data,role),likes(count),comments(count)';

const mediaUrl = (path) => sb.storage.from('posts').getPublicUrl(path).data.publicUrl;
const countOf = (rel) => (rel && rel[0] && rel[0].count) || 0;
const bgCss = (i) => (i != null && BGS[Number(i)] ? `linear-gradient(135deg, ${BGS[Number(i)][0]}, ${BGS[Number(i)][1]})` : '');

// Shrinks a picture to at most 1280 px. Some file managers hand over pictures the <img> tag cannot read,
// so createImageBitmap is tried first, then <img>; if both fail the original file is uploaded as it is.
async function shrinkImage(file) {
  const max = 1280;
  let src;
  let w;
  let hgt;
  let close = () => {};
  try {
    const bmp = await createImageBitmap(file);
    src = bmp;
    w = bmp.width;
    hgt = bmp.height;
    close = () => bmp.close && bmp.close();
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      URL.revokeObjectURL(url);
      return file;
    }
    src = img;
    w = img.naturalWidth;
    hgt = img.naturalHeight;
    close = () => URL.revokeObjectURL(url);
  }
  try {
    const sc = Math.min(1, max / Math.max(w, hgt));
    const c = document.createElement('canvas');
    c.width = Math.round(w * sc);
    c.height = Math.round(hgt * sc);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    return blob || file;
  } finally {
    close();
  }
}

async function loadPosts({ authorId, id } = {}) {
  let q = sb.from('posts').select(SELECT);
  if (id) q = q.eq('id', id);
  else {
    if (authorId) q = q.eq('author', authorId);
    q = q.order('created_at', { ascending: false }).limit(60);
  }
  const { data, error } = await q;
  if (error) throw error;
  if (!data.length) return [];
  const { data: mine } = await sb.from('likes').select('post_id').eq('user_id', me.user.id).in('post_id', data.map((p) => p.id));
  const liked = new Set((mine || []).map((r) => r.post_id));
  return data.map((p) => ({ ...p, liked: liked.has(p.id), nLikes: countOf(p.likes), nComments: countOf(p.comments) }));
}

// The feed leans toward friends and people whose posts you open often, newest first.
async function rank(posts) {
  let friends = new Set();
  try {
    friends = new Set(await friendIds());
  } catch {
    /* rank by time only */
  }
  const views = viewCounts();
  const score = (p) => new Date(p.created_at).getTime() + (friends.has(p.author) ? 6 * 3600e3 : 0) + Math.min(10, views[p.author] || 0) * 1800e3 + (p.author === me.user.id ? 2 * 3600e3 : 0);
  return [...posts].sort((a, b) => score(b) - score(a));
}

/* ---------- one post ---------- */
function postCard(p, { go, onDeleted }) {
  const card = h('div', { class: 'card post' });
  const who = h(
    'button',
    { class: 'post-head', type: 'button', onclick: () => { noteView(p.author); go(p.author === me.user.id ? 'profile' : 'user:' + p.author); } },
    avatar(p.profiles, 42),
    h('div', {}, h('b', {}, clean(nameOf(p.profiles))), h('div', { class: 'muted small' }, 'ลงเมื่อ ' + ago(p.created_at).replace('ที่แล้ว', 'ที่แล้ว'))),
  );
  const mine = p.author === me.user.id || (me.profile && me.profile.role === 'admin');
  const del = mine
    ? h('button', { class: 'icon-btn del', type: 'button', 'aria-label': 'ลบโพสต์', onclick: async () => {
        if (!(await confirmSheet('ลบโพสต์', 'ลบโพสต์นี้ใช่ไหม', 'ลบ'))) return;
        if (p.media_path) await sb.storage.from('posts').remove([p.media_path]).catch(() => {});
        const { error } = await sb.from('posts').delete().eq('id', p.id);
        if (error) return toast('ลบไม่สำเร็จ');
        card.remove();
        if (onDeleted) onDeleted(p);
      } })
    : null;
  if (del) del.innerHTML = ICON.trash;
  card.append(h('div', { class: 'row-between' }, who, del));

  if (p.kind === 'text' && p.bg != null && bgCss(p.bg)) {
    card.append(h('div', { class: 'post-bg', style: { background: bgCss(p.bg) } }, clean(p.body)));
  } else if (p.body) {
    card.append(h('p', { class: 'post-text' }, clean(p.body)));
  }
  if (p.kind === 'image' && p.media_path) card.append(h('img', { class: 'post-media', src: mediaUrl(p.media_path), loading: 'lazy', alt: '' }));
  if (p.kind === 'video' && p.media_path) card.append(h('video', { class: 'post-media', src: mediaUrl(p.media_path), controls: true, playsinline: true, preload: 'metadata' }));

  const likeBtn = h('button', { class: 'act' + (p.liked ? ' on' : ''), type: 'button' });
  const cBtn = h('button', { class: 'act', type: 'button' });
  const sBtn = h('button', { class: 'act', type: 'button' }, '↗ แชร์');
  const paint = () => {
    likeBtn.textContent = (p.liked ? '♥ ' : '♡ ') + p.nLikes;
    likeBtn.classList.toggle('on', p.liked);
    cBtn.textContent = '💬 ' + p.nComments;
  };
  paint();
  likeBtn.addEventListener('click', async () => {
    const was = p.liked;
    p.liked = !was;
    p.nLikes += was ? -1 : 1;
    paint();
    const { error } = was ? await sb.from('likes').delete().eq('post_id', p.id).eq('user_id', me.user.id) : await sb.from('likes').insert({ post_id: p.id, user_id: me.user.id });
    if (error) {
      p.liked = was;
      p.nLikes += was ? 1 : -1;
      paint();
      toast('กดไลก์ไม่สำเร็จ');
    }
  });
  cBtn.addEventListener('click', () => commentsSheet(p, (n) => { p.nComments = n; paint(); }, go));
  sBtn.addEventListener('click', async () => {
    const url = postLink(p.id);
    try {
      if (navigator.share) await navigator.share({ title: 'Augrant', text: 'โพสต์ใน Augrant', url });
      else {
        await navigator.clipboard.writeText(url);
        toast('คัดลอกลิงก์แล้ว ส่งให้เพื่อนที่มีแอป Augrant ได้เลย');
      }
      sb.rpc('share_post', { p_post: p.id }).then(() => {}, () => {});
    } catch (e) {
      if (!e || e.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(url);
          toast('คัดลอกลิงก์แล้ว');
        } catch {
          toast(url, 6000);
        }
      }
    }
  });
  card.append(h('div', { class: 'acts' }, likeBtn, cBtn, sBtn));
  return card;
}

function commentsSheet(p, onCount, go) {
  const list = h('div', { class: 'list' });
  const input = h('input', { class: 'input', type: 'text', maxlength: 1000, placeholder: 'เขียนคอมเมนต์...' });
  const send = h('button', { class: 'btn primary sm', type: 'button' }, 'ส่ง');
  let count = p.nComments;
  async function load() {
    const { data, error } = await sb.from('comments').select('id,body,created_at,author,profiles:author(id,username,display_name,avatar_data)').eq('post_id', p.id).order('created_at', { ascending: true });
    if (error) return list.replaceChildren(h('div', { class: 'err' }, 'โหลดไม่ได้'));
    count = data.length;
    onCount(count);
    list.replaceChildren(
      ...(data.length
        ? data.map((c) => {
            const can = c.author === me.user.id || p.author === me.user.id || (me.profile && me.profile.role === 'admin');
            const del = can ? h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { await sb.from('comments').delete().eq('id', c.id); load(); } }, 'ลบ') : null;
            return h(
              'div',
              { class: 'comment' },
              avatar(c.profiles, 34),
              h('div', { class: 'grow' }, h('b', {}, clean(nameOf(c.profiles))), h('div', {}, clean(c.body)), h('div', { class: 'muted small' }, when(c.created_at))),
              del,
            );
          })
        : [h('div', { class: 'muted' }, 'ยังไม่มีคอมเมนต์')]),
    );
  }
  send.addEventListener('click', async () => {
    const body = input.value.trim();
    if (!body) return;
    send.disabled = true;
    const { error } = await sb.from('comments').insert({ post_id: p.id, author: me.user.id, body });
    send.disabled = false;
    if (error) return toast('ส่งไม่สำเร็จ');
    input.value = '';
    load();
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && send.click());
  sheet('คอมเมนต์', h('div', { class: 'stack' }, list, h('div', { class: 'row nowrap' }, input, send)));
  load();
}

/* ---------- writing a post ---------- */
function composeSheet(onPosted) {
  const ta = h('textarea', { class: 'input', rows: 4, maxlength: 3000, placeholder: 'คุณกำลังคิดอะไรอยู่?' });
  let bg = null;
  let file = null;
  let kind = 'text';
  const preview = h('div', { class: 'muted small' });
  const bgRow = h('div', { class: 'swatches' });
  const paintBg = () => {
    ta.style.background = bg != null ? bgCss(bg) : '';
    ta.style.color = bg != null ? '#fff' : '';
    ta.style.textAlign = bg != null ? 'center' : '';
    bgRow.replaceChildren(
      h('button', { class: 'sw' + (bg == null ? ' on' : ''), type: 'button', style: { background: '#2b2d31' }, 'aria-label': 'ไม่มีพื้นหลัง', onclick: () => { bg = null; paintBg(); } }),
      ...BGS.map((_, i) => h('button', { class: 'sw' + (bg === i ? ' on' : ''), type: 'button', style: { background: bgCss(i) }, onclick: () => { bg = i; paintBg(); } })),
    );
    bgRow.hidden = !!file;
  };
  paintBg();
  const pick = (accept, k) => {
    const inp = h('input', { type: 'file', accept, style: { position: 'fixed', left: '-9999px' } });
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      if (k === 'video' && f.size > MAX_VIDEO) return toast('วิดีโอใหญ่เกิน 50 MB เลือกคลิปที่เล็กกว่านี้');
      file = f;
      kind = k;
      bg = null;
      paintBg();
      preview.textContent = (k === 'image' ? '🖼 ' : '🎬 ') + f.name + ' (' + (f.size / 1048576).toFixed(1) + ' MB)';
    });
    document.body.append(inp);
    inp.click();
  };
  const post = h('button', { class: 'btn primary', type: 'button' }, 'โพสต์');
  const s = sheet(
    'สร้างโพสต์',
    h('div', { class: 'stack' }, ta, bgRow, h('div', { class: 'row' }, h('button', { class: 'btn sm', type: 'button', onclick: () => pick('image/*', 'image') }, icon('image'), 'รูป'), h('button', { class: 'btn sm', type: 'button', onclick: () => pick('video/*', 'video') }, icon('film'), 'วิดีโอ')), preview, post),
  );
  post.addEventListener('click', async () => {
    const body = ta.value.trim();
    if (!body && !file) return toast('พิมพ์ข้อความหรือเลือกรูป/วิดีโอก่อน');
    const ov = loadingOverlay(file ? 'กำลังอัปโหลด... ไฟล์ใหญ่จะนานหน่อย' : 'กำลังโพสต์...');
    post.disabled = true;
    try {
      let path = null;
      if (file) {
        const blob = kind === 'image' ? await shrinkImage(file) : file;
        const shrunk = kind === 'image' && blob !== file;
        const ext = shrunk ? 'jpg' : (file.name.split('.').pop() || (kind === 'image' ? 'jpg' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '') || (kind === 'image' ? 'jpg' : 'mp4');
        path = `${me.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: ue } = await sb.storage.from('posts').upload(path, blob, { contentType: shrunk ? 'image/jpeg' : file.type || (kind === 'image' ? 'image/' + (ext === 'jpg' ? 'jpeg' : ext) : 'video/mp4'), upsert: false });
        if (ue) throw ue;
      }
      const { error } = await sb.from('posts').insert({ author: me.user.id, kind: file ? kind : 'text', body, bg: file || bg == null ? null : String(bg), media_path: path });
      if (error) throw error;
      s.close();
      toast('โพสต์แล้ว');
      onPosted();
    } catch (e) {
      toast('โพสต์ไม่สำเร็จ: ' + (e.message || e), 5000);
    } finally {
      ov.done();
      post.disabled = false;
    }
  });
}

/* ---------- screens ---------- */
export function postsView(go, { authorId } = {}) {
  const list = h('div', { class: 'stack' });
  const root = h('div', { class: 'screen' });
  if (authorId) {
    const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'กลับ', onclick: () => go(authorId === me.user.id ? 'profile' : 'user:' + authorId) });
    back.innerHTML = ICON.back;
    root.append(h('div', { class: 'topbar' }, back, h('h2', {}, 'โพสต์')));
  } else {
    root.append(h('div', { class: 'page-title2' }, 'Post'));
  }
  const body = h('div', { class: 'pad stack' });
  if (!authorId) {
    body.append(h('button', { class: 'card composer', type: 'button', onclick: () => composeSheet(load) }, avatar(me.profile, 40), h('span', { class: 'muted' }, 'คุณกำลังคิดอะไรอยู่?')));
  }
  body.append(list);
  root.append(body);
  async function load() {
    list.replaceChildren(h('div', { class: 'muted small' }, 'กำลังโหลด...'));
    try {
      let posts = await loadPosts({ authorId });
      if (!authorId) posts = await rank(posts);
      list.replaceChildren(...(posts.length ? posts.map((p) => postCard(p, { go })) : [h('div', { class: 'muted' }, 'ยังไม่มีโพสต์ ลองโพสต์อันแรกเลย')]));
    } catch (e) {
      list.replaceChildren(h('div', { class: 'err' }, 'โหลดไม่ได้: ' + (e.message || e)));
    }
  }
  load();
  return root;
}

// opened from a shared link
export function postView(go, id) {
  const root = h('div', { class: 'screen' });
  const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'กลับ', onclick: () => go('post') });
  back.innerHTML = ICON.back;
  const box = h('div', { class: 'pad stack' }, h('div', { class: 'muted' }, 'กำลังโหลด...'));
  root.append(h('div', { class: 'topbar' }, back, h('h2', {}, 'โพสต์')), box);
  loadPosts({ id })
    .then((r) => box.replaceChildren(r[0] ? postCard(r[0], { go, onDeleted: () => go('post') }) : h('div', { class: 'err' }, 'ไม่พบโพสต์นี้ (อาจถูกลบแล้ว)')))
    .catch((e) => box.replaceChildren(h('div', { class: 'err' }, 'โหลดไม่ได้: ' + (e.message || e))));
  return root;
}

export { composeSheet, getProfile };
