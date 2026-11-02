import { h, icon, loadSettings, saveSettings, toast, confirmSheet } from '../util.js';
import { avatar } from '../social.js';
import { listProjects, renameProject, trashProject, restoreProject, deleteProject, purgeOld, daysLeft } from '../projects.js';
import { sheet, ago, ICON } from '../util.js';
import { me, signOutNow, hasRealEmail, startEmailChange, finishEmailChange } from '../supa.js';
import { QUALITIES, FORMATS } from '../engine/exporter.js';
import { MODELS, clearModelCache } from '../engine/whisper.js';
import { setSfx } from '../sfx.js';
import cover from '../assets/cover.png';

function greeting() {
  const hr = new Date().getHours(); // the phone's own clock, so it follows the country
  if (hr >= 5 && hr < 12) return 'สวัสดีตอนเช้า';
  if (hr >= 12 && hr < 17) return 'สวัสดีตอนบ่าย';
  if (hr >= 17 && hr < 21) return 'สวัสดีตอนเย็น';
  return 'สวัสดีตอนค่ำ';
}

export function homeView(go) {
  const name = (me.profile && (me.profile.display_name || me.profile.username)) || '';
  const gear = h('button', { class: 'gear-btn', type: 'button', 'aria-label': 'Setting', onclick: () => go('settings') }, icon('gear'), h('span', {}, 'Setting'));
  return h(
    'div',
    { class: 'screen mc-bg home' },
    h(
      'div',
      { class: 'home-top' },
      h('button', { class: 'me-chip', type: 'button', onclick: () => go('profile') }, avatar(me.profile, 40), h('b', {}, name)),
      gear,
    ),
    h('img', { class: 'logo', src: cover, alt: 'Augrixs Community' }),
    h('div', { class: 'hello' }, greeting(), h('br'), 'Welcome, ' + name),
    h(
      'div',
      { class: 'mc-menu' },
      h('button', { class: 'mc-btn', type: 'button', onclick: () => go('create') }, 'Create A Videos'),
      h('button', { class: 'mc-btn', type: 'button', onclick: () => go('credits') }, 'Credits'),
    ),
    projectList(go),
  );
}

// Saved projects, newest first. The three dots open rename / move to trash.
function projectList(go) {
  const box = h('div', { class: 'projects' });
  async function load() {
    try {
      await purgeOld();
      const all = (await listProjects()).filter((p) => !p.trashedAt).sort((a, b) => b.updatedAt - a.updatedAt);
      box.replaceChildren(
        ...(all.length
          ? [h('div', { class: 'proj-title' }, 'โปรเจกต์ของฉัน'), ...all.map((p) => projectCard(p))]
          : []),
      );
    } catch {
      box.replaceChildren();
    }
  }
  function projectCard(p) {
    const dots = h('button', { class: 'dots', type: 'button', 'aria-label': 'เมนูโปรเจกต์' }, '⋮');
    dots.addEventListener('click', (e) => {
      e.stopPropagation();
      const s = sheet(p.name, h('div', { class: 'stack' },
        h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); rename(p); } }, icon('edit'), 'เปลี่ยนชื่อ'),
        h('button', { class: 'btn danger', type: 'button', onclick: async () => { await trashProject(p.id); s.close(); toast('ย้ายไปถังขยะแล้ว อยู่ได้ 7 วัน'); load(); } }, icon('trash'), 'ย้ายไปถังขยะ'),
      ));
    });
    return h('div', { class: 'proj', onclick: () => go('create:' + p.id) }, h('div', { class: 'grow' }, h('b', {}, p.name), h('div', { class: 'muted small' }, 'แก้ล่าสุด ' + ago(new Date(p.updatedAt).toISOString()))), dots);
  }
  function rename(p) {
    const inp = h('input', { class: 'input', type: 'text', maxlength: 60, value: p.name });
    const ok = h('button', { class: 'btn primary', type: 'button' }, 'บันทึกชื่อ');
    const s = sheet('เปลี่ยนชื่อโปรเจกต์', h('div', { class: 'stack' }, inp, h('p', { class: 'muted small' }, 'ชื่อนี้จะเป็นชื่อไฟล์ตอน Export'), ok));
    ok.addEventListener('click', async () => {
      await renameProject(p.id, inp.value);
      s.close();
      load();
    });
  }
  load();
  return box;
}

// Trash: projects stay 7 days, then are deleted by the app. Delete here removes everything at once.
export function trashView(go) {
  const list = h('div', { class: 'list' });
  async function load() {
    await purgeOld();
    const all = (await listProjects()).filter((p) => p.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt);
    empty.hidden = !all.length;
    list.replaceChildren(
      ...(all.length
        ? all.map((p) =>
            h('div', { class: 'card stack' }, h('b', {}, p.name), h('div', { class: 'muted small' }, 'จะถูกลบเองใน ' + daysLeft(p) + ' วัน'),
              h('div', { class: 'row' },
                h('button', { class: 'btn sm', type: 'button', onclick: async () => { await restoreProject(p.id); toast('กู้คืนแล้ว'); load(); } }, 'กู้คืน'),
                h('button', { class: 'btn danger sm', type: 'button', onclick: async () => { await deleteProject(p.id); toast('ลบถาวรแล้ว'); load(); } }, 'ลบถาวร'))),
          )
        : [h('div', { class: 'muted' }, 'ถังขยะว่างเปล่า')]),
    );
  }
  const empty = h('button', { class: 'btn danger', type: 'button', hidden: true, onclick: async () => {
    if (!(await confirmSheet('ลบทั้งหมดในถังขยะ', 'แน่ใจหรือไม่ โปรเจกต์ทั้งหมดในถังขยะจะถูกลบถาวร กู้คืนไม่ได้', 'ลบถาวรทั้งหมด'))) return;
    for (const p of (await listProjects()).filter((x) => x.trashedAt)) await deleteProject(p.id);
    toast('ล้างถังขยะแล้ว');
    load();
  } }, 'ลบทั้งหมดในถังขยะ');
  load();
  return h('div', { class: 'screen mc-bg' }, h('div', { class: 'page-title' }, 'ถังขยะ'), h('div', { class: 'pad stack' }, h('p', { class: 'muted small' }, 'โปรเจกต์ที่ย้ายมาที่นี่จะถูกลบเองหลัง 7 วัน'), list, empty, h('button', { class: 'mc-btn small', type: 'button', onclick: () => go('settings') }, 'Back')));
}

// Link or change the account email. The new address must be confirmed with a 6-digit code.
function emailBox() {
  const status = h('div', { class: 'muted small' });
  const box = h('div', { class: 'card stack' }, h('b', {}, 'อีเมลของบัญชี'), status);
  const paint = () => {
    status.textContent = hasRealEmail() ? 'อีเมลตอนนี้: ' + me.user.email : 'ยังไม่ได้เชื่อมอีเมล (Gmail, Hotmail หรืออื่นๆ) เชื่อมไว้เพื่อกู้บัญชีได้';
  };
  paint();
  const email = h('input', { class: 'input', type: 'email', placeholder: 'อีเมลใหม่', autocapitalize: 'none', inputmode: 'email' });
  const send = h('button', { class: 'btn', type: 'button' }, hasRealEmail() ? 'เปลี่ยนอีเมล (ส่งรหัส 6 ตัว)' : 'เชื่อมอีเมล (ส่งรหัส 6 ตัว)');
  const code = h('input', { class: 'input', type: 'text', inputmode: 'numeric', maxlength: 6, placeholder: 'รหัส 6 ตัว', hidden: true });
  const ok = h('button', { class: 'btn primary', type: 'button', hidden: true }, 'ยืนยันรหัส');
  let pending = '';
  send.addEventListener('click', async () => {
    const v = email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('อีเมลไม่ถูกต้อง');
    send.disabled = true;
    try {
      await startEmailChange(v);
      pending = v;
      code.hidden = false;
      ok.hidden = false;
      toast('ส่งรหัส 6 ตัวไปที่ ' + v + ' แล้ว');
    } catch (e) {
      toast(e.message, 4200);
    } finally {
      send.disabled = false;
    }
  });
  ok.addEventListener('click', async () => {
    if (!/^\d{6}$/.test(code.value.trim())) return toast('ใส่เลข 6 ตัว');
    ok.disabled = true;
    try {
      await finishEmailChange(pending, code.value);
      toast('เชื่อมอีเมลแล้ว');
      code.hidden = true;
      ok.hidden = true;
      email.value = '';
      code.value = '';
      paint();
    } catch (e) {
      toast(e.message, 4200);
    } finally {
      ok.disabled = false;
    }
  });
  box.append(email, send, code, ok);
  return box;
}

export function settingsView(go) {
  const s = loadSettings();
  const upd = (k, v) => {
    s[k] = v;
    saveSettings(s);
  };
  const sel = (id, opts, val, cb) => {
    const el = h('select', { class: 'input', id }, opts.map(([v, l]) => h('option', { value: v }, l)));
    el.value = val;
    el.addEventListener('change', () => cb(el.value));
    return el;
  };
  const vol = (id, val, cb) => {
    const el = h('input', { class: 'input', id, type: 'number', min: 1, max: 1000, value: val });
    el.addEventListener('change', () => {
      const n = Math.min(1000, Math.max(1, Math.round(Number(el.value)) || 100));
      el.value = n;
      cb(n);
    });
    return el;
  };
  return h(
    'div',
    { class: 'screen mc-bg' },
    h('div', { class: 'page-title' }, 'SETTINGS'),
    h(
      'div',
      { class: 'pad stack' },
      emailBox(),
      h('button', { class: 'btn', type: 'button', onclick: () => go('trash') }, icon('trash'), 'ถังขยะ (โปรเจกต์ที่ลบ)'),
      h('label', { class: 'field' }, 'ความละเอียดเริ่มต้นตอน Export', sel('q', QUALITIES.map((q) => [q.id, q.label]), s.quality, (v) => upd('quality', v))),
      h('label', { class: 'field' }, 'ชนิดไฟล์เริ่มต้น', sel('f', FORMATS.map((f) => [f.id, f.label]), s.format, (v) => upd('format', v))),
      h('label', { class: 'field' }, 'ความดังเสียงพูดเริ่มต้น (1-1000)', vol('vv', s.voiceVol, (n) => upd('voiceVol', n))),
      h('label', { class: 'field' }, 'ความดังเสียงวิดีโอพื้นหลังเริ่มต้น (1-1000)', vol('bv', s.bgVol, (n) => upd('bgVol', n))),
      h(
        'label',
        { class: 'field' },
        'โมเดลถอดเสียง',
        sel(
          'm',
          Object.keys(MODELS).map((k) => [k, { tiny: 'tiny: เร็ว แม่นน้อย', base: 'base: แนะนำ', small: 'small: แม่นกว่า ช้า ไฟล์ใหญ่' }[k]]),
          s.whisper,
          (v) => upd('whisper', v),
        ),
      ),
      h(
        'label',
        { class: 'row', style: { gap: '10px' } },
        h('input', { type: 'checkbox', checked: s.sfx !== false, onchange: (e) => { upd('sfx', e.target.checked); setSfx(e.target.checked); } }),
        'เสียงเอฟเฟกต์ตอนกดปุ่ม',
      ),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            await clearModelCache();
            toast('ล้างโมเดลที่ดาวน์โหลดไว้แล้ว');
          },
        },
        'ล้างโมเดลถอดเสียงที่โหลดไว้',
      ),
      h(
        'button',
        {
          class: 'btn danger',
          type: 'button',
          onclick: async () => {
            if (await confirmSheet('ออกจากระบบ', 'ต้องการออกจากระบบใช่ไหม', 'ออกจากระบบ')) {
              await signOutNow();
              go('login');
            }
          },
        },
        'Log out',
      ),
      h('p', { class: 'muted small' }, 'Augrant 1.1'),
      h('button', { class: 'mc-btn small', type: 'button', onclick: () => go('home') }, 'Done'),
    ),
  );
}

export function creditsView(go) {
  const line = (a, b) => h('p', {}, h('b', {}, a), ' ', b);
  return h(
    'div',
    { class: 'screen mc-bg' },
    h('div', { class: 'page-title' }, 'CREDITS'),
    h(
      'div',
      { class: 'pad stack' },
      line('Augrant', 'โดย Augrixs Community'),
      line('ถอดเสียง', 'Whisper (OpenAI) ผ่าน Transformers.js (Hugging Face)'),
      line('ฐานข้อมูลและบัญชี', 'Supabase'),
      line('แอปมือถือ', 'Capacitor'),
      line('ฟอนต์', 'Fontsource (SIL Open Font License)'),
      line('เข้ารหัส MP3', 'lamejs'),
      h('p', { class: 'muted small' }, 'หน้าตาเมนูออกแบบเองให้คล้ายสไตล์เกมบล็อก ไม่ได้ใช้ภาพหรือฟอนต์ของเกมใด'),
      h('button', { class: 'mc-btn small', type: 'button', onclick: () => go('home') }, 'Done'),
    ),
  );
}
