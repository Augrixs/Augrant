import { h, icon, toast, loadingOverlay, confirmSheet } from '../util.js';
import { me, updateProfile, signOutNow, sb } from '../supa.js';
import { decorate } from './shop.js';
import { avatar } from '../social.js';
import { stat } from './social.js';
import { PLATFORMS, normalizeLink } from '../core/links.js';

// Resize the picked picture so the cover stays small enough to keep in the database.
async function coverFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const W = 960;
    const H = 360;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * sc;
    const hh = img.naturalHeight * sc;
    ctx.drawImage(img, (W - w) / 2, (H - hh) / 2, w, hh);
    return c.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function avatarFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const S = 256;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const sc = Math.max(S / img.naturalWidth, S / img.naturalHeight);
    const w = img.naturalWidth * sc;
    const hh = img.naturalHeight * sc;
    c.getContext('2d').drawImage(img, (S - w) / 2, (S - hh) / 2, w, hh);
    return c.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function profileView(go) {
  const p = me.profile;
  const cover = h('div', { class: 'cover' });
  const paint = () => {
    cover.style.backgroundImage = me.profile.cover_data ? `url(${me.profile.cover_data})` : '';
  };
  paint();

  const pick = h('input', { type: 'file', accept: 'image/*', hidden: true });
  pick.addEventListener('change', async () => {
    const f = pick.files && pick.files[0];
    if (!f) return;
    const ov = loadingOverlay('กำลังอัปโหลดปก...');
    try {
      await updateProfile({ cover_data: await coverFromFile(f) });
      paint();
      toast('เปลี่ยนปกแล้ว');
    } catch {
      toast('เปลี่ยนปกไม่สำเร็จ ลองรูปอื่นหรือลองใหม่');
    } finally {
      ov.done();
      pick.value = '';
    }
  });
  cover.append(
    h('button', { class: 'btn sm edit-cover', type: 'button', onclick: () => pick.click() }, icon('image'), 'เปลี่ยนปก'),
    pick,
  );

  const dn = h('input', { class: 'input', id: 'dn', type: 'text', maxlength: 40, value: p.display_name || '', placeholder: 'ชื่อเล่น (Display name)' });
  const save = h('button', { class: 'btn primary', type: 'button' }, 'บันทึกชื่อเล่น');
  save.addEventListener('click', async () => {
    const v = dn.value.trim();
    if (!v) return toast('ใส่ชื่อเล่นก่อน');
    save.disabled = true;
    try {
      await updateProfile({ display_name: v });
      toast('บันทึกแล้ว');
    } catch {
      toast('บันทึกไม่สำเร็จ ลองใหม่');
    } finally {
      save.disabled = false;
    }
  });

  // round profile picture
  const avWrap = h('div', { class: 'av-wrap' });
  const paintAv = () => avWrap.replaceChildren(avatar(me.profile, 92));
  paintAv();
  decorate(me.user.id, { avBox: avWrap, size: 92, p: me.profile, bgEl: cover });
  const avPick = h('input', { type: 'file', accept: 'image/*', hidden: true });
  avPick.addEventListener('change', async () => {
    const f = avPick.files && avPick.files[0];
    if (!f) return;
    const ov = loadingOverlay('กำลังเปลี่ยนรูปโปรไฟล์...');
    try {
      await updateProfile({ avatar_data: await avatarFromFile(f) });
      paintAv();
      toast('เปลี่ยนรูปโปรไฟล์แล้ว');
    } catch {
      toast('เปลี่ยนรูปไม่สำเร็จ');
    } finally {
      ov.done();
      avPick.value = '';
    }
  });
  const stats = h('div', { class: 'stats' });
  (async () => {
    try {
      const [posts, fr] = await Promise.all([
        sb.from('posts').select('id,likes(count),comments(count)').eq('author', p.id),
        sb.from('friendships').select('id', { count: 'exact', head: true }).eq('status', 'accepted').or(`requester.eq.${p.id},addressee.eq.${p.id}`),
      ]);
      const rows = posts.data || [];
      const sum = (k) => rows.reduce((a, r) => a + ((r[k] && r[k][0] && r[k][0].count) || 0), 0);
      stats.replaceChildren(stat(rows.length, 'โพสต์'), stat(fr.count || 0, 'เพื่อน'), stat(sum('likes'), 'ไลก์'), stat(sum('comments'), 'คอมเมนต์'));
    } catch {
      /* stats are optional */
    }
  })();

  // birthday, gender and social links
  const bday = h('input', { class: 'input', type: 'date', value: p.birthday || '' });
  const gSel = h('select', { class: 'input' }, [['', 'ไม่ระบุ'], ['male', 'ชาย'], ['female', 'หญิง']].map(([v, l]) => h('option', { value: v }, l)));
  gSel.value = p.gender || '';
  const linkInputs = PLATFORMS.map((pl) => ({ pl, el: h('input', { class: 'input', type: 'url', placeholder: pl.example, value: (p.links && p.links[pl.id]) || '', autocapitalize: 'none', spellcheck: 'false' }) }));
  const saveInfo = h('button', { class: 'btn primary', type: 'button' }, 'บันทึกข้อมูลส่วนตัวและลิงก์');
  saveInfo.addEventListener('click', async () => {
    const links = {};
    for (const { pl, el } of linkInputs) {
      const v = normalizeLink(pl.id, el.value);
      if (v === null) return toast(`ช่อง ${pl.label} ใส่ได้เฉพาะลิงก์ของ ${pl.label} เท่านั้น`, 4200);
      if (v) links[pl.id] = v;
    }
    saveInfo.disabled = true;
    try {
      await updateProfile({ links, birthday: bday.value || null, gender: gSel.value || null });
      toast('บันทึกแล้ว');
    } catch {
      toast('บันทึกไม่สำเร็จ ลองใหม่');
    } finally {
      saveInfo.disabled = false;
    }
  });
  const info = h('div', { class: 'card stack' }, h('b', {}, 'ข้อมูลส่วนตัว (เห็นเฉพาะคุณ)'), h('label', { class: 'field' }, 'วันเกิด', bday), h('label', { class: 'field' }, 'เพศ', gSel), h('b', {}, 'ลิงก์โซเชียลของคุณ'), ...linkInputs.map(({ pl, el }) => h('label', { class: 'field' }, pl.label, el)), saveInfo);

  return h(
    'div',
    { class: 'screen' },
    cover,
    h(
      'div',
      { class: 'profile-card' },
      h('div', { class: 'who' }, h('div', { class: 'av-col' }, avWrap, h('button', { class: 'btn ghost sm', type: 'button', onclick: () => avPick.click() }, 'เปลี่ยนรูป'), avPick), h('div', {}, h('h2', {}, p.display_name || p.username), h('div', { class: 'muted' }, '@' + p.username, ' ', p.role === 'admin' ? h('span', { class: 'pill admin' }, 'admin') : null))),
      stats,
      h('button', { class: 'btn', type: 'button', onclick: () => go('posts:' + p.id) }, 'โพสต์ของฉัน'),
      info,
      h('label', { class: 'field' }, 'Display name', dn),
      save,
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            if (await confirmSheet('ออกจากระบบ', 'ต้องการออกจากระบบใช่ไหม', 'ออกจากระบบ')) {
              await signOutNow();
              go('login');
            }
          },
        },
        icon('logout'),
        'Log out',
      ),
      h('p', { class: 'muted small' }, 'Username เปลี่ยนเองไม่ได้ ให้แอดมินเป็นคนเปลี่ยนให้'),
    ),
  );
}
