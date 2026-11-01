import { h, toast, sheet, fmtDate, ago, confirmSheet, loadingOverlay } from '../util.js';
import { sb, adminCall, normUsername, validUsername, me } from '../supa.js';

const ACTION_LABEL = {
  login: 'เข้าสู่ระบบ',
  logout: 'ออกจากระบบ',
  clip_created: 'สร้างคลิป',
  profile_update: 'แก้โปรไฟล์',
};

export function adminView() {
  const root = h('div', { class: 'screen' });
  const wrap = h('div', { class: 'admin' });
  root.append(wrap);

  const listBox = h('div', { class: 'list' });
  const status = h('div', { class: 'muted small' });

  async function refresh() {
    status.textContent = 'กำลังโหลด...';
    const { data, error } = await sb.from('admin_overview').select('*').order('created_at', { ascending: true });
    if (error) {
      status.textContent = 'โหลดไม่ได้: ' + error.message;
      return;
    }
    status.textContent = `${data.length} บัญชี`;
    listBox.replaceChildren(
      ...data.map((u) =>
        h(
          'div',
          { class: 'card u-item', onclick: () => openUser(u) },
          h('div', { class: 'u-top' }, h('b', {}, u.display_name || u.username), u.role === 'admin' ? h('span', { class: 'pill admin' }, 'admin') : null),
          h('div', { class: 'muted small' }, '@' + u.username),
          h(
            'div',
            { class: 'kv' },
            h('b', {}, 'ใช้ล่าสุด'),
            h('span', {}, ago(u.last_seen)),
            h('b', {}, 'ทำล่าสุด'),
            h('span', {}, u.last_action || '-'),
            h('b', {}, 'คลิปที่สร้าง'),
            h('span', {}, String(u.clip_count)),
          ),
        ),
      ),
    );
  }

  // ---- create account ----
  const nu = h('input', { class: 'input', id: 'nu', type: 'text', placeholder: 'username (a-z 0-9 _ . -)', autocapitalize: 'none', spellcheck: 'false' });
  const nd = h('input', { class: 'input', id: 'nd', type: 'text', placeholder: 'Display name' });
  const np = h('input', { class: 'input', id: 'np', type: 'text', placeholder: 'รหัสผ่าน (อย่างน้อย 8 ตัว)', autocapitalize: 'none', spellcheck: 'false' });
  const create = h('button', { class: 'btn primary', type: 'button' }, 'สร้างบัญชี');
  create.addEventListener('click', async () => {
    const u = normUsername(nu.value);
    if (!validUsername(u)) return toast('username ใช้ a-z 0-9 _ . - ยาว 3-24 ตัว');
    if (np.value.length < 8) return toast('รหัสผ่านอย่างน้อย 8 ตัว');
    create.disabled = true;
    try {
      await adminCall('create_user', { username: u, password: np.value, display_name: nd.value.trim() || u });
      toast('สร้างบัญชี @' + u + ' แล้ว');
      nu.value = '';
      nd.value = '';
      np.value = '';
      await refresh();
    } catch (e) {
      toast('สร้างไม่ได้: ' + e.message, 4200);
    } finally {
      create.disabled = false;
    }
  });

  wrap.append(
    h('h2', {}, 'Admin Panel Augrixs Rant'),
    h('div', { class: 'card stack' }, h('b', {}, 'สร้างบัญชีให้เพื่อน'), nu, nd, np, create),
    h('div', { class: 'row' }, h('b', { class: 'grow' }, 'บัญชีทั้งหมด'), h('button', { class: 'btn sm', type: 'button', onclick: refresh }, 'รีเฟรช')),
    status,
    listBox,
  );

  // ---- one account ----
  async function openUser(u) {
    const body = h('div', { class: 'stack' });
    const s = sheet('@' + u.username, body);
    body.append(h('div', { class: 'muted' }, 'กำลังโหลด...'));

    const [ses, clips, act] = await Promise.all([
      sb.from('sessions').select('*').eq('user_id', u.id).order('started_at', { ascending: false }).limit(30),
      sb.from('clips').select('*').eq('user_id', u.id).order('created_at', { ascending: false }).limit(30),
      sb.from('activity').select('*').eq('user_id', u.id).order('created_at', { ascending: false }).limit(40),
    ]);

    const sessionRow = (x) => {
      const out = x.ended_at ? fmtDate(x.ended_at) : 'ใช้งานล่าสุด ' + fmtDate(x.last_seen_at);
      return h('div', { class: 'li' }, 'เข้า ' + fmtDate(x.started_at), h('br'), 'ออก ' + out);
    };
    const clipRow = (x) =>
      h(
        'div',
        { class: 'li' },
        h('b', {}, x.title || 'คลิป'),
        h('br'),
        `${fmtDate(x.created_at)} · ${Math.round(x.duration_s || 0)} วิ · ${x.quality || '-'} · ${x.format || '-'}`,
        x.transcript ? h('div', { class: 'muted' }, x.transcript.slice(0, 120)) : null,
      );
    const actRow = (x) => h('div', { class: 'li' }, fmtDate(x.created_at) + ' · ' + (ACTION_LABEL[x.type] || x.type) + (x.detail && x.detail.title ? ' · ' + x.detail.title : ''));

    const isSelf = u.id === me.user.id;
    const ren = h('input', { class: 'input', type: 'text', value: u.username, autocapitalize: 'none', spellcheck: 'false' });
    const pw = h('input', { class: 'input', type: 'text', placeholder: 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)', autocapitalize: 'none' });

    const act1 = async (label, fn) => {
      const ov = loadingOverlay(label);
      try {
        await fn();
        return true;
      } catch (e) {
        toast('ไม่สำเร็จ: ' + e.message, 4200);
        return false;
      } finally {
        ov.done();
      }
    };

    body.replaceChildren(
      h('div', { class: 'kv' }, h('b', {}, 'ชื่อเล่น'), h('span', {}, u.display_name || '-'), h('b', {}, 'สร้างบัญชีเมื่อ'), h('span', {}, fmtDate(u.created_at)), h('b', {}, 'เข้าล่าสุด'), h('span', {}, fmtDate(u.last_login)), h('b', {}, 'ใช้ล่าสุด'), h('span', {}, fmtDate(u.last_seen))),
      h('b', {}, 'เวลาเข้า-ออกแอป'),
      h('div', { class: 'list' }, ses.data && ses.data.length ? ses.data.map(sessionRow) : h('div', { class: 'muted' }, 'ยังไม่มีข้อมูล')),
      h('b', {}, 'คลิปที่สร้าง'),
      h('div', { class: 'list' }, clips.data && clips.data.length ? clips.data.map(clipRow) : h('div', { class: 'muted' }, 'ยังไม่เคยสร้าง')),
      h('b', {}, 'ทำอะไรล่าสุด'),
      h('div', { class: 'list' }, act.data && act.data.length ? act.data.map(actRow) : h('div', { class: 'muted' }, 'ยังไม่มีข้อมูล')),
      h('b', {}, 'เปลี่ยน username'),
      ren,
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          const nn = normUsername(ren.value);
          if (!validUsername(nn)) return toast('username ใช้ a-z 0-9 _ . - ยาว 3-24 ตัว');
          if (nn === u.username) return;
          if (await act1('กำลังเปลี่ยน...', () => adminCall('rename_user', { user_id: u.id, username: nn }))) {
            toast('เปลี่ยนเป็น @' + nn + ' แล้ว');
            s.close();
            refresh();
          }
        },
      }, 'บันทึก username'),
      h('b', {}, 'ตั้งรหัสผ่านใหม่'),
      pw,
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: async () => {
          if (pw.value.length < 8) return toast('รหัสผ่านอย่างน้อย 8 ตัว');
          if (await act1('กำลังตั้งรหัสผ่าน...', () => adminCall('reset_password', { user_id: u.id, password: pw.value }))) {
            pw.value = '';
            toast('ตั้งรหัสผ่านใหม่แล้ว');
          }
        },
      }, 'ตั้งรหัสผ่านใหม่'),
      isSelf
        ? h('p', { class: 'muted small' }, 'นี่คือบัญชีของคุณ ลบเองไม่ได้')
        : h('button', {
            class: 'btn danger',
            type: 'button',
            onclick: async () => {
              if (!(await confirmSheet('ลบบัญชี @' + u.username, 'ลบแล้วกู้คืนไม่ได้ ประวัติการใช้งานและคลิปของบัญชีนี้จะหายด้วย', 'ลบบัญชี'))) return;
              if (await act1('กำลังลบ...', () => adminCall('delete_user', { user_id: u.id }))) {
                toast('ลบบัญชีแล้ว');
                s.close();
                refresh();
              }
            },
          }, 'ลบบัญชีนี้'),
    );
  }

  refresh();
  return root;
}
