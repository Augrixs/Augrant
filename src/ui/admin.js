import { h, toast, sheet, fmtDate, ago, confirmSheet, loadingOverlay } from '../util.js';
import { sb, adminCall, me } from '../supa.js';
import { adminGiveAuru } from '../economy.js';

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
  const commentBox = h('div', { class: 'list' });
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

  const gName = h('input', { class: 'input', type: 'text', placeholder: 'username', value: me.profile ? me.profile.username : '', autocapitalize: 'none' });
  const gAmt = h('input', { class: 'input', type: 'number', placeholder: 'Auru', value: 100 });
  const gBtn = h('button', { class: 'btn primary', type: 'button' }, 'Give Auru');
  gBtn.addEventListener('click', async () => {
    const n = Math.round(Number(gAmt.value));
    if (!gName.value.trim() || !n || !Number.isSafeInteger(n)) return toast('ใส่ username และจำนวน');
    gBtn.disabled = true;
    try {
      const bal = await adminGiveAuru(gName.value.trim(), n);
      toast(`ให้ ${n} Auru แล้ว (ยอดใหม่ ${bal})`, 4200);
    } catch (e) {
      toast(e.message, 4800);
    } finally {
      gBtn.disabled = false;
    }
  });
  wrap.append(
    h('h2', {}, 'Admin Panel Augrixs Rant'),
    h('div', { class: 'card stack' }, h('b', {}, 'ให้ Auru (ตัวเองหรือคนอื่นตาม username)'), gName, gAmt, h('small', { class: 'muted' }, 'ใส่เลขติดลบเพื่อหักคืนได้ (ยอดไม่ต่ำกว่า 0) ใส่ได้เกินล้าน'), gBtn),
    h('div', { class: 'row' }, h('b', { class: 'grow' }, 'บัญชีทั้งหมด'), h('button', { class: 'btn sm', type: 'button', onclick: refresh }, 'รีเฟรช')),
    status,
    listBox,
    h('div', { class: 'row' }, h('b', { class: 'grow' }, 'คอมเมนต์ล่าสุด (หลังบ้าน)'), h('button', { class: 'btn sm', type: 'button', onclick: loadComments }, 'รีเฟรช')),
    commentBox,
  );

  // ---- who commented what (raw text, not masked) ----
  async function loadComments() {
    const { data, error } = await sb
      .from('comments')
      .select('id,body,created_at,post_id,who:profiles!comments_author_fkey(username,display_name)')
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) return commentBox.replaceChildren(h('div', { class: 'err' }, 'โหลดไม่ได้: ' + error.message));
    commentBox.replaceChildren(
      ...(data.length
        ? data.map((c) =>
            h(
              'div',
              { class: 'li' },
              h('b', {}, '@' + ((c.who && c.who.username) || '?')),
              ' · ' + fmtDate(c.created_at),
              h('div', {}, c.body),
              h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { await sb.from('comments').delete().eq('id', c.id); loadComments(); } }, 'ลบ'),
            ),
          )
        : [h('div', { class: 'muted small' }, 'ยังไม่มีคอมเมนต์')]),
    );
  }

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
  loadComments();
  return root;
}
