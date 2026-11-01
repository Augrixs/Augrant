import { h, loadSettings, saveSettings, toast, confirmSheet } from '../util.js';
import { me, signOutNow } from '../supa.js';
import { QUALITIES, FORMATS } from '../engine/exporter.js';
import { MODELS, clearModelCache } from '../engine/whisper.js';
import cover from '../assets/cover.png';

export function homeView(go) {
  const name = (me.profile && (me.profile.display_name || me.profile.username)) || '';
  return h(
    'div',
    { class: 'screen mc-bg home' },
    h('img', { class: 'logo', src: cover, alt: 'Augrixs Community' }),
    h('div', { class: 'hello' }, 'WELCOME', h('br'), name),
    h(
      'div',
      { class: 'mc-menu' },
      h('button', { class: 'mc-btn', type: 'button', onclick: () => go('create') }, 'Create A Videos'),
      h('button', { class: 'mc-btn', type: 'button', onclick: () => go('settings') }, 'Settings'),
      h('button', { class: 'mc-btn', type: 'button', onclick: () => go('credits') }, 'Credits'),
    ),
  );
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
      h('p', { class: 'muted small' }, 'Augrant 1.0'),
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
