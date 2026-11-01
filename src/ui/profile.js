import { h, icon, toast, loadingOverlay, confirmSheet } from '../util.js';
import { me, updateProfile, signOutNow } from '../supa.js';

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

  return h(
    'div',
    { class: 'screen' },
    cover,
    h(
      'div',
      { class: 'profile-card' },
      h('div', {}, h('h2', {}, p.display_name || p.username), h('div', { class: 'muted' }, '@' + p.username, ' ', p.role === 'admin' ? h('span', { class: 'pill admin' }, 'admin') : null)),
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
