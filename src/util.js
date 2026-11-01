// Small DOM helpers shared by every screen.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (['value', 'checked', 'disabled', 'hidden', 'src', 'min', 'max', 'step'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (kid) => {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(add);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return el;
}

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;

export const ICON = {
  eye: svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>'),
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  play: svg('<path d="M7 4l13 8-13 8z" fill="currentColor"/>'),
  pause: svg('<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  scissors: svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8l11 10M8.5 16l11-10"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  film: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  style: svg('<path d="M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2s0-2.5 1.5-2.5H18a3 3 0 003-3C21 7 17 3 12 3z"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="11" r="1"/>'),
  volume: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/>'),
  caption: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h4M7 14h2M13 10h4M11 14h6"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M11 8v6M8 11h6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M8 11h6"/>'),
  folder: svg('<path d="M3 6h6l2 2h10v11H3z"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  logout: svg('<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>'),
  speed: svg('<path d="M4 18a8 8 0 1116 0"/><path d="M12 18l4-6"/><path d="M12 6v2M5.5 9l1.4 1.4M18.5 9l-1.4 1.4"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4h12"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>'),
};

export function icon(name, cls = '') {
  const s = h('span', { class: 'ic ' + cls });
  s.innerHTML = ICON[name] || '';
  return s;
}

export function fmtTime(sec, tenths = false) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const base = m + ':' + String(s).padStart(2, '0');
  return tenths ? base + '.' + Math.floor((sec % 1) * 10) : base;
}

const dtf = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : dtf.format(d);
}

export function ago(iso) {
  if (!iso) return 'ยังไม่เคยเข้า';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 90) return 'เมื่อสักครู่';
  if (diff < 3600) return Math.floor(diff / 60) + ' นาทีที่แล้ว';
  if (diff < 86400) return Math.floor(diff / 3600) + ' ชั่วโมงที่แล้ว';
  return Math.floor(diff / 86400) + ' วันที่แล้ว';
}

let toastTimer = 0;
export function toast(msg, ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Bottom sheet. Returns { el, body, close }.
export function sheet(title, content, opts = {}) {
  const body = h('div', { class: 'sheet-body' }, content);
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ปิด' });
  closeBtn.innerHTML = ICON.close;
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('div', { class: 'sheet-head' }, h('h3', {}, title), closeBtn), body);
  const back = h('div', { class: 'sheet-back' }, panel);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    if (opts.onClose) opts.onClose();
  };
  closeBtn.addEventListener('click', close);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back && !opts.modal) close();
  });
  document.body.append(back);
  return { el: back, body, close };
}

export function confirmSheet(title, message, okLabel = 'ยืนยัน') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      s.close();
      resolve(v);
    };
    const s = sheet(
      title,
      h('div', { class: 'stack' }, h('p', {}, message), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, 'ยกเลิก'), h('button', { class: 'btn danger', type: 'button', onclick: () => finish(true) }, okLabel))),
      { onClose: () => finish(false) },
    );
  });
}

export function loadingOverlay(text) {
  const label = h('div', { class: 'loading-text' }, text);
  const el = h('div', { class: 'loading' }, h('div', { class: 'spinner' }), label);
  document.body.append(el);
  return { set: (t) => (label.textContent = t), done: () => el.remove() };
}

export function debounce(fn, ms) {
  let t = 0;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function loadSettings() {
  const def = { quality: '720', format: 'mp4', voiceVol: 100, bgVol: 30, whisper: 'base', sfx: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('augrant.settings') || '{}') };
  } catch {
    return def;
  }
}
export function saveSettings(s) {
  try {
    localStorage.setItem('augrant.settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
