import { h, icon, ICON, toast, sheet, fmtTime, loadingOverlay, confirmSheet, loadSettings } from '../util.js';
import { FONTS, ensureFont, canvasFont, fontStack } from '../fonts.js';
import { uid, layout, fitVideoToAudio, splitAt, removeClip, total, clampVolume, setClipSpeed, MIN_SPEED, MAX_SPEED } from '../core/timeline.js';
import { rippleWords, remapWordsForClip } from '../core/captions.js';
import { decodeFile, peaksOf, renderVoice16k, loudnessGain } from '../engine/audio.js';
import { renderFrame, createTransport, duration, invalidateCaptions, getCaptionLines, primeVideo, LW, LH } from '../engine/player.js';
import { transcribe, LANGS } from '../engine/whisper.js';
import { exportProject, QUALITIES, FORMATS } from '../engine/exporter.js';
import { requestMedia, pickFolder, savedFolder, saveBlob, isNative, isIOS } from '../native.js';
import { saveClip } from '../supa.js';

const COLORS = ['#FFD43B', '#4DF0B0', '#FF6B9A', '#62D9FF', '#FF8A3D', '#B28DFF', '#FFFFFF'];

/* ---------- media loading ---------- */
const MIMES = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
};

// Some file managers hand over files with no type. The video element then refuses a perfectly good mp4,
// so the file is wrapped with a type guessed from its name.
function typedVideo(file) {
  if (file.type && file.type.startsWith('video/')) return file;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return new Blob([file], { type: MIMES[ext] || 'video/mp4' });
}

async function loadAudioSrc(file) {
  let buffer;
  try {
    buffer = await decodeFile(file);
  } catch {
    throw new Error('เปิดไฟล์เสียงนี้ไม่ได้ ลองไฟล์ mp3, m4a, wav หรือ aac');
  }
  return { id: uid('s'), kind: 'audio', name: file.name, buffer, dur: buffer.duration, norm: loudnessGain(buffer, 0.14, 30), peaks: peaksOf(buffer) };
}

async function loadVideoSrc(file) {
  const typed = typedVideo(file);
  const url = URL.createObjectURL(typed);
  const el = document.createElement('video');
  el.muted = true;
  el.loop = false;
  el.playsInline = true;
  el.setAttribute('playsinline', '');
  el.preload = 'auto';
  // kept on screen but invisible: some phones stop decoding frames of a video that is far off screen
  el.style.cssText = 'position:fixed;left:0;top:0;width:48px;height:48px;opacity:0.02;pointer-events:none;z-index:-1';
  document.body.append(el);
  el.src = url;
  const drop = () => {
    URL.revokeObjectURL(url);
    el.remove();
  };
  try {
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('อ่านวิดีโอนานเกินไป ไฟล์อาจใหญ่หรือเสีย')), 25000);
      el.onloadeddata = () => {
        clearTimeout(timer);
        res();
      };
      el.onerror = () => {
        clearTimeout(timer);
        const code = el.error ? el.error.code : 0;
        rej(new Error(code === 4 ? 'เครื่องนี้เปิดวิดีโอนี้ไม่ได้ อาจเป็นรูปแบบ H.265/HEVC ลองแปลงเป็น MP4 (H.264) ก่อน' : 'เปิดวิดีโอนี้ไม่ได้ ไฟล์อาจเสีย'));
      };
    });
  } catch (e) {
    drop();
    throw e;
  }
  if (!Number.isFinite(el.duration) || el.duration <= 0) {
    drop();
    throw new Error('อ่านความยาววิดีโอไม่ได้');
  }
  let buffer = null;
  try {
    buffer = await decodeFile(file);
  } catch {
    buffer = null; // the video has no usable sound track
  }
  return { id: uid('s'), kind: 'video', name: file.name, url, el, dur: el.duration, buffer, norm: buffer ? loudnessGain(buffer, 0.05, 12) : 1 };
}

function releaseSource(s) {
  if (!s || !s.el) return;
  try {
    s.el.pause();
    s.el.removeAttribute('src');
    s.el.load();
  } catch {
    /* ignore */
  }
  s.el.remove();
  URL.revokeObjectURL(s.url);
}

function releaseAll(p) {
  if (p) Object.values(p.sources).forEach(releaseSource);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { position: 'fixed', left: '-9999px' } });
    inp.addEventListener('change', () => {
      resolve(inp.files && inp.files[0] ? inp.files[0] : null);
      setTimeout(() => inp.remove(), 1000);
    });
    inp.addEventListener('cancel', () => {
      resolve(null);
      setTimeout(() => inp.remove(), 1000);
    });
    document.body.append(inp);
    inp.click();
  });
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hasBgSound = (p) => Object.values(p.sources).some((s) => s.kind === 'video' && s.buffer);

/* ---------- style picker (used on the style page and inside the editor) ---------- */
function stylePicker(p, onChange) {
  const canvas = h('canvas', { width: 960, height: 540 });
  const ctx = canvas.getContext('2d');
  const words = [['Hey', 0], ["It's", 0.5], ['me', 1], ['Caption', 1.5]];
  let alive = true;
  let raf = 0;

  function draw(now) {
    if (!alive) return;
    const t = (now / 1000) % 2.2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 960, 540);
    g.addColorStop(0, '#1b2169');
    g.addColorStop(1, '#0b0d26');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 960, 540);
    const st = p.style;
    ctx.font = canvasFont(st.font, st.size);
    ctx.textBaseline = 'alphabetic';
    const gap = st.size * 0.28;
    const ws = words.map((w) => ctx.measureText(w[0]).width);
    const totalW = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
    const sc = Math.min(1, 900 / totalW);
    ctx.translate(480, 270 + st.size * 0.3 * sc);
    ctx.scale(sc, sc);
    let x = -totalW / 2;
    let cur = -1;
    words.forEach((w, i) => {
      if (t >= w[1]) cur = i;
    });
    words.forEach((w, i) => {
      ctx.lineJoin = 'round';
      ctx.lineWidth = st.size * 0.16;
      ctx.strokeStyle = '#000';
      ctx.strokeText(w[0], x, 0);
      ctx.fillStyle = i === cur ? st.color : st.base;
      ctx.fillText(w[0], x, 0);
      x += ws[i] + gap;
    });
    raf = requestAnimationFrame(draw);
  }

  const fontBtns = FONTS.map((f) => {
    const b = h('button', { class: 'font-btn' + (p.style.font === f.id ? ' on' : ''), type: 'button', style: { fontFamily: fontStack(f.id), fontWeight: String(f.w) } }, 'Hey สวัสดี', h('div', { class: 'small muted', style: { fontFamily: 'var(--font)', fontWeight: '400' } }, f.id));
    b.addEventListener('click', async () => {
      p.style.font = f.id;
      fontBtns.forEach((x) => x.classList.toggle('on', x === b));
      await ensureFont(f.id);
      invalidateCaptions(p);
      onChange();
    });
    return b;
  });

  const swatches = COLORS.map((c) => {
    const b = h('button', { class: 'sw' + (p.style.color.toLowerCase() === c.toLowerCase() ? ' on' : ''), type: 'button', style: { background: c }, 'aria-label': c });
    b.addEventListener('click', () => {
      p.style.color = c;
      swatches.forEach((x) => x.classList.toggle('on', x === b));
      onChange();
    });
    return b;
  });
  const custom = h('input', { class: 'sw-input', type: 'color', value: p.style.color, 'aria-label': 'เลือกสีเอง' });
  custom.addEventListener('input', () => {
    p.style.color = custom.value;
    swatches.forEach((x) => x.classList.remove('on'));
    onChange();
  });

  const size = h('input', { type: 'range', min: 40, max: 140, step: 2, value: p.style.size });
  size.addEventListener('input', () => {
    p.style.size = Number(size.value);
    invalidateCaptions(p);
    onChange();
  });

  const el = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'sample-box' }, canvas),
    h('b', {}, 'สีคำที่กำลังพูด (คำอื่นเป็นสีขาว)'),
    h('div', { class: 'swatches' }, swatches, custom),
    h('b', {}, 'ขนาดตัวอักษร'),
    size,
    h('b', {}, 'ฟอนต์'),
    h('div', { class: 'font-grid' }, fontBtns),
  );
  ensureFont(p.style.font);
  raf = requestAnimationFrame(draw);
  return {
    el,
    dispose: () => {
      alive = false;
      cancelAnimationFrame(raf);
    },
  };
}

/* ---------- the whole create flow ---------- */
export function createFlow(onExit) {
  const root = h('div', { class: 'screen' });
  const files = { audio: null, video: null };
  let project = null;
  let transport = null;
  let picker = null;

  const cleanup = () => {
    if (transport) transport.dispose();
    transport = null;
    if (picker) picker.dispose();
    picker = null;
  };
  root.dispose = () => {
    cleanup();
    releaseAll(project);
    project = null;
  };

  const show = (el) => root.replaceChildren(el);

  /* ----- step 1: upload audio and background video ----- */
  function stepImport() {
    cleanup();
    requestMedia();
    const mk = (kind, title, sub, accept, ic) => {
      const t = h('div', { class: 'tile' });
      const inp = h('input', { type: 'file', accept, 'aria-label': title });
      const render = () => {
        const f = files[kind];
        t.classList.toggle('done', !!f);
        t.replaceChildren(icon(f ? 'check' : ic), h('b', {}, title), h('div', { class: 'muted small' }, f ? f.name : sub), inp);
      };
      inp.addEventListener('change', () => {
        if (inp.files && inp.files[0]) {
          files[kind] = inp.files[0];
          render();
          next.disabled = !(files.audio && files.video);
        }
      });
      render();
      return t;
    };
    const next = h('button', { class: 'btn primary', type: 'button', disabled: !(files.audio && files.video) }, 'ต่อไป: เลือกฟอนต์และสี');
    next.addEventListener('click', prepare);
    const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'กลับ', onclick: onExit });
    back.innerHTML = ICON.back;
    show(
      h(
        'div',
        { class: 'screen' },
        h('div', { class: 'topbar' }, back, h('h2', {}, 'Create A Videos')),
        h(
          'div',
          { class: 'pad stack' },
          mk('audio', 'Upload Audio', 'เลือกไฟล์เสียงพูดจากเครื่อง', 'audio/*', 'music'),
          mk('video', 'Upload Background Video', 'เลือกวิดีโอพื้นหลังจากเครื่อง', 'video/*', 'film'),
          h('p', { class: 'muted small' }, 'วิดีโอจะถูกตัดให้ยาวเท่าเสียงอัตโนมัติ ถ้าสั้นกว่าเสียงจะเล่นวน และเพิ่มคลิปอื่นได้ในหน้าตัดต่อ'),
          next,
        ),
      ),
    );
  }

  async function prepare() {
    const ov = loadingOverlay('กำลังอ่านไฟล์เสียง...');
    try {
      const audio = await loadAudioSrc(files.audio);
      ov.set('กำลังอ่านวิดีโอ...');
      const video = await loadVideoSrc(files.video);
      releaseAll(project);
      const s = loadSettings();
      project = {
        title: audio.name.replace(/\.[^.]+$/, '') || 'Untitled',
        sources: { [audio.id]: audio, [video.id]: video },
        aClips: layout([{ id: uid(), src: audio.id, srcStart: 0, dur: audio.dur, speed: 1 }]),
        vClips: fitVideoToAudio({ id: video.id, dur: video.dur }, audio.dur),
        vol: { voice: s.voiceVol, bg: s.bgVol },
        style: { font: 'Prompt', color: '#FFD43B', base: '#FFFFFF', size: 72, y: 0.72 },
        words: [],
        texts: [],
        wordsVersion: 0,
      };
      ov.done();
      stepStyle();
    } catch (e) {
      ov.done();
      toast(e.message || 'เปิดไฟล์ไม่ได้', 5200);
    }
  }

  /* ----- step 2: font and colour ----- */
  function stepStyle() {
    cleanup();
    picker = stylePicker(project, () => {});
    const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'กลับ', onclick: stepImport });
    back.innerHTML = ICON.back;
    show(
      h(
        'div',
        { class: 'screen' },
        h('div', { class: 'topbar' }, back, h('h2', {}, 'ฟอนต์และสีตัวหนังสือ')),
        h('div', { class: 'pad stack' }, picker.el, h('button', { class: 'btn primary', type: 'button', onclick: stepEditor }, 'เข้าหน้าตัดต่อ')),
      ),
    );
  }

  /* ----- step 3: editor ----- */
  function stepEditor() {
    cleanup();
    const p = project;
    let sel = null; // { kind: 'v' | 'a' | 'text' | 'caption', id }
    let pps = 60;
    let exporting = false;
    let playSeq = 0;
    const hit = [];

    const canvas = h('canvas', { width: 540, height: 960 });
    const ctx = canvas.getContext('2d');
    const timeLbl = h('div', { class: 't' }, '0:00.0 / 0:00.0');
    const playBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'เล่นหรือหยุด' });
    playBtn.innerHTML = ICON.play;
    const setPlayIcon = (on) => (playBtn.innerHTML = on ? ICON.pause : ICON.play);
    const tlInner = h('div', { class: 'tl-inner' });
    const tl = h('div', { class: 'tl' }, tlInner);
    const playhead = h('div', { class: 'playhead' });
    const toolsEl = h('div', { class: 'tools' });

    const selId = () => (sel ? (sel.kind === 'text' ? sel.id : sel.kind === 'caption' ? 'caption' : null) : null);
    const srcOf = (c) => p.sources[c.src];

    transport = createTransport(p, {
      onFrame: (t, now) => {
        if (exporting) return;
        renderFrame(ctx, canvas.width, canvas.height, p, t, { hit, now, sel: selId() });
        timeLbl.textContent = fmtTime(t, true) + ' / ' + fmtTime(duration(p), true);
        playhead.style.left = t * pps + 'px';
        if (transport && transport.playing) {
          const x = t * pps;
          if (x > tl.scrollLeft + tl.clientWidth - 40 || x < tl.scrollLeft) tl.scrollLeft = Math.max(0, x - tl.clientWidth * 0.3);
        }
      },
      onEnd: () => setPlayIcon(false),
    });
    transport.start();

    /* ---- timeline drawing ---- */
    function waveform(c) {
      const src = srcOf(c);
      const w = Math.min(4000, Math.max(8, Math.ceil(c.dur * pps)));
      const cv = h('canvas', { width: w, height: 32 });
      if (!src || !src.peaks) return cv;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      const peaks = src.peaks;
      const per = 50; // peaks per second (20 ms each)
      const span = c.dur * (c.speed || 1);
      for (let x = 0; x < w; x++) {
        const i0 = Math.floor((c.srcStart + (x / w) * span) * per);
        const i1 = Math.max(i0 + 1, Math.floor((c.srcStart + ((x + 1) / w) * span) * per));
        let m = 0;
        for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
        const hh = Math.max(1, Math.min(30, m * 40 * (src.norm > 1 ? Math.min(src.norm, 4) / 2 : 1)));
        g.fillRect(x, 16 - hh / 2, 1, hh);
      }
      return cv;
    }

    function block(kind, id, cls, start, dur, top) {
      const on = sel && sel.kind === kind && sel.id === id;
      return h('div', {
        class: 'blk ' + cls + (on ? ' sel' : ''),
        style: { left: start * pps + 'px', width: Math.max(8, dur * pps - 2) + 'px', top: top + 'px' },
        onclick: (e) => {
          e.stopPropagation();
          if (kind === 'v' || kind === 'a') {
            const r = tlInner.getBoundingClientRect();
            transport.seek(clamp((e.clientX - r.left) / pps, 0, duration(p)));
          }
          select({ kind, id });
        },
      });
    }

    const speedTag = (c) => (c.speed && Math.abs(c.speed - 1) > 0.001 ? ' ×' + +c.speed.toFixed(2) : '');

    // text blocks: drag the body to move, drag the two ends to change how long the text shows
    function bindTextDrag(b, tx) {
      const begin = (e, mode) => {
        e.stopPropagation();
        e.preventDefault();
        const target = e.currentTarget;
        try {
          target.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const x0 = e.clientX;
        const s0 = tx.s;
        const e0 = tx.e;
        let moved = false;
        const move = (ev) => {
          const dt = (ev.clientX - x0) / pps;
          if (Math.abs(ev.clientX - x0) > 3) moved = true;
          if (mode === 'l') tx.s = clamp(s0 + dt, 0, e0 - 0.3);
          else if (mode === 'r') tx.e = Math.max(s0 + 0.3, e0 + dt);
          else {
            const len = e0 - s0;
            tx.s = Math.max(0, s0 + dt);
            tx.e = tx.s + len;
          }
          b.style.left = tx.s * pps + 'px';
          b.style.width = Math.max(8, (tx.e - tx.s) * pps - 2) + 'px';
          transport.refresh();
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          if (moved) renderTimeline();
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      };
      const hl = h('div', { class: 'hdl l', 'aria-label': 'ลากปรับจุดเริ่ม' });
      const hr = h('div', { class: 'hdl r', 'aria-label': 'ลากปรับจุดจบ' });
      hl.addEventListener('pointerdown', (e) => begin(e, 'l'));
      hr.addEventListener('pointerdown', (e) => begin(e, 'r'));
      b.addEventListener('pointerdown', (e) => {
        if (e.target === b || e.target.nodeType === 3 || e.target.tagName === 'SPAN') begin(e, 'm');
      });
      b.classList.add('edit');
      b.append(hl, hr);
    }

    function renderTimeline() {
      const dur = duration(p);
      tlInner.style.width = Math.max(dur * pps + 80, tl.clientWidth) + 'px';
      const kids = [];
      const ruler = h('div', { class: 'ruler' });
      const step = pps >= 80 ? 1 : pps >= 40 ? 2 : pps >= 20 ? 5 : 10;
      for (let s = 0; s <= dur; s += step) ruler.append(h('div', { class: 'tick', style: { left: s * pps + 'px' } }, fmtTime(s)));
      ruler.addEventListener('pointerdown', (e) => {
        try {
          ruler.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const go = (ev) => {
          const r = tlInner.getBoundingClientRect();
          transport.seek(clamp((ev.clientX - r.left) / pps, 0, duration(p)));
        };
        go(e);
        ruler.addEventListener('pointermove', go);
        const end = () => ruler.removeEventListener('pointermove', go);
        ruler.addEventListener('pointerup', end, { once: true });
        ruler.addEventListener('pointercancel', end, { once: true });
      });
      kids.push(ruler);
      p.vClips.forEach((c) => {
        const b = block('v', c.id, 'v' + (c.hold ? ' hold' : ''), c.start, c.dur, 24);
        const s = srcOf(c);
        b.append(h('span', { class: 'lbl' }, (c.hold ? '❄ ' : '') + (s ? s.name : 'Video') + speedTag(c)));
        kids.push(b);
      });
      p.aClips.forEach((c) => {
        const b = block('a', c.id, 'a', c.start, c.dur, 62);
        const s = srcOf(c);
        b.append(waveform(c), h('span', { class: 'lbl' }, (s ? s.name : 'เสียง') + speedTag(c)));
        kids.push(b);
      });
      if (p.words.length) {
        const lines = getCaptionLines(ctx, p);
        lines.forEach((l) => {
          const b = block('caption', 'caption', 'c', l.start, Math.max(0.2, l.end - l.start), 100);
          b.addEventListener('click', () => transport.seek(l.start));
          b.append(h('span', { class: 'lbl' }, p.words.slice(l.idx[0], l.idx[l.idx.length - 1] + 1).map((w) => w.t).join(' ')));
          kids.push(b);
        });
      }
      // texts that overlap in time go on separate rows
      const laneEnds = [];
      [...p.texts]
        .sort((a, b) => a.s - b.s)
        .forEach((tx) => {
          let lane = laneEnds.findIndex((e) => e <= tx.s + 0.001);
          if (lane < 0) lane = laneEnds.length;
          laneEnds[lane] = tx.e;
          const b = block('text', tx.id, 'x', tx.s, Math.max(0.3, tx.e - tx.s), 138 + lane * 36);
          b.append(h('span', { class: 'lbl' }, String(tx.text).split('\n')[0]));
          if (sel && sel.kind === 'text' && sel.id === tx.id) bindTextDrag(b, tx);
          kids.push(b);
        });
      tlInner.style.height = Math.max(176, 138 + Math.max(1, laneEnds.length) * 36 + 6) + 'px';
      kids.push(playhead);
      tlInner.replaceChildren(...kids);
      playhead.style.left = transport.time * pps + 'px';
    }

    function select(s) {
      sel = s;
      renderTimeline();
      renderTools();
      transport.refresh();
    }

    tlInner.addEventListener('click', (e) => {
      if (e.target.closest('.blk')) return;
      const r = tlInner.getBoundingClientRect();
      transport.seek(clamp((e.clientX - r.left) / pps, 0, duration(p)));
      if (sel) select(null);
    });

    /* ---- dragging text and captions in the preview ---- */
    let drag = null;
    const toLogical = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * LW, y: ((e.clientY - r.top) / r.height) * LH };
    };
    canvas.addEventListener('pointerdown', (e) => {
      const { x, y } = toLogical(e);
      const b = [...hit].reverse().find((k) => x >= k.x0 && x <= k.x1 && y >= k.y0 && y <= k.y1);
      if (!b) {
        if (sel) select(null);
        return;
      }
      if (b.kind === 'text') {
        const tx = p.texts.find((k) => k.id === b.id);
        if (!(sel && sel.kind === 'text' && sel.id === b.id)) select({ kind: 'text', id: b.id });
        drag = { kind: 'text', tx, x, y, sx: tx.x, sy: tx.y };
      } else {
        if (!(sel && sel.kind === 'caption')) select({ kind: 'caption', id: 'caption' });
        drag = { kind: 'caption', x, y, sy: p.style.y };
      }
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const { x, y } = toLogical(e);
      if (drag.kind === 'text') {
        drag.tx.x = clamp(drag.sx + (x - drag.x) / LW, 0.05, 0.95);
        drag.tx.y = clamp(drag.sy + (y - drag.y) / LH, 0.04, 0.96);
      } else {
        p.style.y = clamp(drag.sy + (y - drag.y) / LH, 0.04, 0.96);
      }
      transport.refresh();
    });
    const endDrag = () => (drag = null);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // The icon flips straight away and the button can always stop playback, even while the video is still getting ready.
    playBtn.addEventListener('click', async () => {
      const my = ++playSeq;
      if (transport.playing || playBtn.dataset.starting === '1') {
        transport.pause();
        playBtn.dataset.starting = '0';
        setPlayIcon(false);
        return;
      }
      playBtn.dataset.starting = '1';
      setPlayIcon(true);
      let ok = false;
      try {
        ok = await transport.play();
      } catch {
        ok = false;
      }
      if (my !== playSeq) return;
      playBtn.dataset.starting = '0';
      setPlayIcon(!!ok && transport.playing);
    });

    const zoom = (f) => {
      pps = clamp(pps * f, 8, 400);
      renderTimeline();
    };

    /* ---- adding clips ---- */
    async function addVideo() {
      const f = await pickFile('video/*');
      if (!f) return;
      const ov = loadingOverlay('กำลังอ่านวิดีโอ...');
      try {
        const v = await loadVideoSrc(f);
        p.sources[v.id] = v;
        const clip = { id: uid(), src: v.id, srcStart: 0, dur: v.dur, speed: 1 };
        p.vClips = layout([...p.vClips, clip]);
        const added = p.vClips[p.vClips.length - 1];
        sel = { kind: 'v', id: added.id };
        renderTimeline();
        renderTools();
        transport.seek(added.start);
        tl.scrollLeft = Math.max(0, added.start * pps - 20);
        toast('เพิ่มคลิปวิดีโอต่อท้ายแล้ว (ดูในแทร็กวิดีโอ)');
      } catch (e) {
        toast(e.message || 'เปิดวิดีโอไม่ได้', 5200);
      } finally {
        ov.done();
      }
    }

    async function addAudio() {
      const f = await pickFile('audio/*');
      if (!f) return;
      const ov = loadingOverlay('กำลังอ่านไฟล์เสียง...');
      try {
        const a = await loadAudioSrc(f);
        p.sources[a.id] = a;
        const clip = { id: uid(), src: a.id, srcStart: 0, dur: a.dur, speed: 1 };
        p.aClips = layout([...p.aClips, clip]);
        const added = p.aClips[p.aClips.length - 1];
        sel = { kind: 'a', id: added.id };
        renderTimeline();
        renderTools();
        transport.seek(added.start);
        tl.scrollLeft = Math.max(0, added.start * pps - 20);
        toast('เพิ่มคลิปเสียงต่อท้ายแล้ว (ดูในแทร็กเสียง)');
      } catch (e) {
        toast(e.message || 'เปิดไฟล์เสียงไม่ได้', 5200);
      } finally {
        ov.done();
      }
    }

    /* ---- captions ---- */
    function captionsSheet() {
      transport.pause();
      setPlayIcon(false);
      const lang = h('select', { class: 'input', id: 'lang' }, LANGS.map(([v, l]) => h('option', { value: v }, l)));
      lang.value = p.lang || 'auto';
      const status = h('div', { class: 'muted small' }, 'ครั้งแรกต้องดาวน์โหลดโมเดลถอดเสียง ใช้อินเทอร์เน็ตและเวลาสักพัก หลังจากนั้นใช้ซ้ำได้');
      const go = h('button', { class: 'btn primary', type: 'button' }, p.words.length ? 'สร้างคำบรรยายใหม่' : 'สร้างคำบรรยายจากเสียง');
      const edit = h('button', { class: 'btn', type: 'button', hidden: !p.words.length }, 'แก้ไขข้อความ');
      const s = sheet('คำบรรยายอัตโนมัติ', h('div', { class: 'stack' }, h('label', { class: 'field' }, 'ภาษาในเสียง', lang), status, go, edit), { modal: false });
      go.addEventListener('click', async () => {
        go.disabled = true;
        p.lang = lang.value;
        try {
          status.textContent = 'กำลังเตรียมเสียง...';
          const audio = await renderVoice16k(p, total(p.aClips));
          const words = await transcribe(audio, { lang: lang.value, model: loadSettings().whisper, onStatus: (m) => (status.textContent = m) });
          if (!words.length) {
            status.textContent = 'ไม่พบเสียงพูด ลองเลือกภาษาให้ตรงกับเสียง';
          } else {
            p.words = words;
            invalidateCaptions(p);
            renderTimeline();
            transport.seek(0);
            status.textContent = `เสร็จแล้ว ${words.length} คำ กดแก้ไขข้อความเพื่อตรวจคำที่ผิด`;
            edit.hidden = false;
            go.textContent = 'สร้างคำบรรยายใหม่';
          }
        } catch (e) {
          status.textContent = 'ทำไม่สำเร็จ: ' + ((e && e.message) || e) + ' (ต้องต่ออินเทอร์เน็ตตอนโหลดโมเดลครั้งแรก)';
        } finally {
          go.disabled = false;
        }
      });
      edit.addEventListener('click', () => {
        s.close();
        transcriptSheet(false);
      });
    }

    // Edit the words of the captions. Tap words to pick them (several allowed), or pick all of them.
    function transcriptSheet(pickAll) {
      const picked = new Set();
      if (pickAll) p.words.forEach((_, i) => picked.add(i));
      const chips = h('div', { class: 'chips' });
      const input = h('input', { class: 'input', type: 'text', id: 'wedit' });
      const ok = h('button', { class: 'btn primary sm', type: 'button' }, 'ใช้คำนี้');
      const editor = h('div', { class: 'row', hidden: true }, input, ok);
      const count = h('div', { class: 'muted small' });
      const allBtn = h('button', { class: 'btn sm', type: 'button' }, 'เลือกทั้งหมด');
      const noneBtn = h('button', { class: 'btn sm', type: 'button' }, 'ไม่เลือก');
      const delBtn = h('button', { class: 'btn danger sm', type: 'button' }, 'ลบที่เลือก');
      const find = h('input', { class: 'input', type: 'text', placeholder: 'คำที่จะหา' });
      const rep = h('input', { class: 'input', type: 'text', placeholder: 'แทนที่ด้วย' });
      const repBtn = h('button', { class: 'btn sm', type: 'button' }, 'แทนที่');
      const changed = () => {
        invalidateCaptions(p);
        renderTimeline();
        transport.refresh();
      };
      const paint = () => {
        chips.replaceChildren(
          ...p.words.map((w, i) => {
            const c = h('button', { class: 'chip' + (picked.has(i) ? ' on' : ''), type: 'button' }, w.t);
            c.addEventListener('click', () => {
              if (picked.has(i)) picked.delete(i);
              else picked.add(i);
              if (picked.size === 1) transport.seek(w.s);
              paint();
            });
            return c;
          }),
        );
        count.textContent = `เลือกแล้ว ${picked.size} จาก ${p.words.length} คำ`;
        delBtn.disabled = picked.size === 0;
        editor.hidden = picked.size !== 1;
        if (picked.size === 1) input.value = p.words[[...picked][0]].t;
      };
      allBtn.addEventListener('click', () => {
        p.words.forEach((_, i) => picked.add(i));
        paint();
      });
      noneBtn.addEventListener('click', () => {
        picked.clear();
        paint();
      });
      ok.addEventListener('click', () => {
        if (picked.size !== 1) return;
        const i = [...picked][0];
        const v = input.value.trim();
        if (v) p.words[i].t = v;
        else p.words.splice(i, 1);
        picked.clear();
        changed();
        paint();
      });
      delBtn.addEventListener('click', () => {
        if (!picked.size) return;
        p.words = p.words.filter((_, i) => !picked.has(i));
        picked.clear();
        changed();
        paint();
      });
      repBtn.addEventListener('click', () => {
        const f = find.value;
        if (!f) return toast('ใส่คำที่จะหาก่อน');
        let n = 0;
        p.words.forEach((w, i) => {
          if (picked.size && !picked.has(i)) return;
          if (w.t.includes(f)) {
            w.t = w.t.split(f).join(rep.value);
            n++;
          }
        });
        p.words = p.words.filter((w) => w.t.trim());
        picked.clear();
        changed();
        paint();
        toast(n ? `แทนที่แล้ว ${n} คำ` : 'ไม่พบคำนี้');
      });
      paint();
      sheet(
        'แก้ไขข้อความคำบรรยาย',
        h(
          'div',
          { class: 'stack' },
          h('p', { class: 'muted small' }, 'แตะคำเพื่อเลือก เลือกได้หลายคำ หรือกด "เลือกทั้งหมด" เวลาของคำจะคงเดิม'),
          h('div', { class: 'row' }, allBtn, noneBtn, delBtn),
          count,
          editor,
          chips,
          h('b', {}, 'ค้นหาและแทนที่ (ใช้กับคำที่เลือก ถ้าไม่เลือกจะใช้กับทั้งหมด)'),
          find,
          rep,
          repBtn,
        ),
      );
    }

    /* ---- text layers ---- */
    function addText() {
      const dur = duration(p);
      let s = transport.time;
      let e = s + 3;
      if (e > dur && dur > 0.5) {
        e = dur;
        s = Math.max(0, e - 3);
      }
      const tx = { id: uid('t'), text: 'ข้อความ', x: 0.5, y: 0.3, s, e, size: 80, color: '#FFFFFF', font: p.style.font };
      p.texts.push(tx);
      transport.seek(s);
      select({ kind: 'text', id: tx.id });
      textSheet(tx);
    }

    function textSheet(tx) {
      const ta = h('textarea', { class: 'input', id: 'txt', rows: 3, value: tx.text });
      const size = h('input', { type: 'range', min: 30, max: 220, step: 2, value: tx.size });
      const col = h('input', { class: 'sw-input', type: 'color', value: tx.color });
      const font = h('select', { class: 'input', id: 'tfont' }, FONTS.map((f) => h('option', { value: f.id }, f.id)));
      font.value = tx.font;
      const upd = () => {
        tx.text = ta.value || ' ';
        tx.size = Number(size.value);
        tx.color = col.value;
        tx.font = font.value;
        ensureFont(tx.font);
        transport.refresh();
      };
      [ta, size, col, font].forEach((el) => el.addEventListener('input', upd));
      const s = sheet(
        'ข้อความ',
        h(
          'div',
          { class: 'stack' },
          ta,
          h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'สี'), col, h('span', { class: 'muted small' }, 'ขนาด'), size),
          h('label', { class: 'field' }, 'ฟอนต์', font),
          h('p', { class: 'muted small' }, 'ลากข้อความในหน้าต่างวิดีโอเพื่อย้ายตำแหน่ง · ลากขอบซ้าย/ขวาของแถบข้อความในไทม์ไลน์เพื่อปรับความยาว'),
        ),
        { onClose: () => renderTimeline() },
      );
      return s;
    }

    function timeSheet(tx) {
      const s0 = h('input', { class: 'input', id: 'ts', type: 'number', min: 0, step: 0.1, value: tx.s.toFixed(1) });
      const e0 = h('input', { class: 'input', id: 'te', type: 'number', min: 0, step: 0.1, value: tx.e.toFixed(1) });
      const timing = () => {
        const a = Math.max(0, Number(s0.value) || 0);
        const b = Math.max(a + 0.2, Number(e0.value) || a + 1);
        tx.s = a;
        tx.e = b;
        renderTimeline();
        transport.refresh();
      };
      [s0, e0].forEach((el) => el.addEventListener('change', timing));
      sheet('เวลาที่ข้อความแสดง', h('div', { class: 'stack' }, h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'เริ่ม (วินาที)', s0), h('label', { class: 'field grow' }, 'จบ (วินาที)', e0))));
    }

    function styleSheet() {
      const pk = stylePicker(p, () => {
        renderTimeline();
        transport.refresh();
      });
      sheet('ฟอนต์และสี (คำบรรยาย)', h('div', {}, pk.el), { onClose: () => pk.dispose() });
    }

    /* ---- volume and speed ---- */
    function volumeSheet() {
      const row = (label, key, enabled) => {
        const range = h('input', { type: 'range', min: 1, max: 1000, step: 1, value: p.vol[key], disabled: !enabled });
        const num = h('input', { class: 'input', type: 'number', min: 1, max: 1000, value: p.vol[key], disabled: !enabled });
        const set = (v) => {
          const n = clampVolume(v);
          p.vol[key] = n;
          range.value = n;
          num.value = n;
          transport.setVolumes();
        };
        range.addEventListener('input', () => set(range.value));
        num.addEventListener('change', () => set(num.value));
        return h('div', { class: 'stack' }, h('b', {}, label), h('div', { class: 'range-row' }, range, num));
      };
      const bgOk = hasBgSound(p);
      sheet(
        'ความดังเสียง (1-1000)',
        h(
          'div',
          { class: 'stack' },
          row('เสียงพูด', 'voice', true),
          row('เสียงของวิดีโอพื้นหลัง', 'bg', bgOk),
          bgOk ? null : h('p', { class: 'muted small' }, 'วิดีโอที่ใช้ไม่มีเสียงที่อ่านได้'),
          h('p', { class: 'muted small' }, '100 = ดังชัดเจนแล้ว (แอปปรับเสียงเบาให้ดังขึ้นเองอัตโนมัติ) เลขสูงขึ้นจะดังมากขึ้นอีก ค่าสูงมากเสียงอาจแตก'),
        ),
      );
    }

    function speedSheet(kind) {
      const key = kind === 'v' ? 'vClips' : 'aClips';
      const c = sel && p[key].find((k) => k.id === sel.id);
      if (!c) return toast('เลือกคลิปก่อน');
      if (c.hold) return toast('คลิปนี้เป็นภาพค้างท้ายคลิป ปรับความเร็วไม่ได้');
      const id = c.id;
      const span = c.dur * (c.speed || 1);
      let cur = c.speed || 1;
      const range = h('input', { type: 'range', min: -1, max: 2, step: 0.01, value: Math.log10(cur) });
      const num = h('input', { class: 'input', type: 'number', min: MIN_SPEED, max: MAX_SPEED, step: 0.1, value: +cur.toFixed(2) });
      const info = h('div', { class: 'muted small' });
      const set = (v, fromNum) => {
        const n = Number(v);
        cur = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number.isFinite(n) && n > 0 ? n : 1));
        range.value = Math.log10(cur);
        if (!fromNum) num.value = +cur.toFixed(2);
        info.textContent = `ความเร็ว ×${+cur.toFixed(2)} · คลิปจะยาว ${(span / cur).toFixed(1)} วินาที`;
      };
      range.addEventListener('input', () => set(Math.pow(10, Number(range.value))));
      num.addEventListener('input', () => set(num.value, true));
      const chips = h(
        'div',
        { class: 'chips' },
        [0.25, 0.5, 1, 1.5, 2, 3, 5, 10, 20, 50, 100].map((v) => h('button', { class: 'chip', type: 'button', onclick: () => set(v) }, '×' + v)),
      );
      const apply = h('button', { class: 'btn primary', type: 'button' }, 'ใช้ความเร็วนี้');
      set(cur);
      const s = sheet(kind === 'v' ? 'ความเร็ววิดีโอ (×0.1 - ×100)' : 'ความเร็วเสียง (×0.1 - ×100)', h('div', { class: 'stack' }, h('div', { class: 'range-row' }, range, num), info, chips, apply, h('p', { class: 'muted small' }, kind === 'a' ? 'เร็วขึ้นเสียงจะสูงขึ้น ช้าลงเสียงจะต่ำลง คำบรรยายจะเลื่อนตามให้เอง' : 'ภาพของวิดีโอเท่านั้น เสียงของวิดีโอจะเปลี่ยนความเร็วตามด้วย')));
      apply.addEventListener('click', () => {
        const r = setClipSpeed(p[key], id, cur);
        if (!r) return;
        p[key] = r.clips;
        if (kind === 'a' && p.words.length) {
          p.words = remapWordsForClip(p.words, r.start, r.oldDur, r.newDur);
          invalidateCaptions(p);
        }
        s.close();
        transport.seek(clamp(transport.time, 0, duration(p)));
        renderTimeline();
        transport.refresh();
        toast(`ตั้งความเร็ว ×${+r.speed.toFixed(2)} แล้ว`);
      });
    }

    /* ---- split, delete, copy ---- */
    function split() {
      if (!sel || (sel.kind !== 'v' && sel.kind !== 'a')) return toast('เลือกคลิปวิดีโอหรือคลิปเสียงที่จะแบ่งก่อน');
      const key = sel.kind === 'v' ? 'vClips' : 'aClips';
      const r = splitAt(p[key], transport.time);
      if (!r) return toast('เลื่อนเส้นเวลาไปกลางคลิปที่เลือกก่อนแบ่ง');
      p[key] = r;
      select(null);
      toast('แบ่งคลิปแล้ว');
    }

    async function remove() {
      if (!sel) return toast('เลือกสิ่งที่จะลบก่อน');
      if (sel.kind === 'text') {
        p.texts = p.texts.filter((k) => k.id !== sel.id);
      } else if (sel.kind === 'caption') {
        if (!(await confirmSheet('ลบคำบรรยาย', 'ลบคำบรรยายทั้งหมด ต้องสร้างใหม่ถ้าต้องการ', 'ลบ'))) return;
        p.words = [];
        invalidateCaptions(p);
      } else if (sel.kind === 'v') {
        p.vClips = removeClip(p.vClips, sel.id);
      } else if (sel.kind === 'a') {
        const c = p.aClips.find((k) => k.id === sel.id);
        p.aClips = removeClip(p.aClips, sel.id);
        if (c && p.words.length) {
          p.words = rippleWords(p.words, c.start, c.dur);
          invalidateCaptions(p);
        }
      }
      sel = null;
      transport.seek(Math.min(transport.time, duration(p)));
      renderTimeline();
      renderTools();
      transport.refresh();
    }

    function copyText() {
      const tx = p.texts.find((k) => k.id === (sel && sel.id));
      if (!tx) return;
      const c = { ...tx, id: uid('t'), y: Math.min(0.9, tx.y + 0.08) };
      p.texts.push(c);
      select({ kind: 'text', id: c.id });
      toast('ทำสำเนาข้อความแล้ว');
    }

    /* ---- the tool row changes with what is selected, like CapCut ---- */
    const tool = (ic, label, fn, cls = '') => {
      const b = h('button', { class: 'tool ' + cls, type: 'button' }, icon(ic), label);
      b.addEventListener('click', fn);
      return b;
    };
    function renderTools() {
      const done = tool('close', 'เสร็จ', () => select(null));
      let items;
      if (!sel) {
        items = [tool('film', 'Video+', addVideo), tool('music', 'Audio+', addAudio), tool('caption', 'Captions', captionsSheet), tool('text', 'Text+', addText), tool('style', 'Style', styleSheet), tool('volume', 'Volume', volumeSheet)];
      } else if (sel.kind === 'v') {
        items = [done, tool('scissors', 'Split', split), tool('speed', 'Speed', () => speedSheet('v')), tool('volume', 'Volume', volumeSheet), tool('film', 'Video+', addVideo), tool('trash', 'Delete', remove, 'del')];
      } else if (sel.kind === 'a') {
        items = [done, tool('scissors', 'Split', split), tool('speed', 'Speed', () => speedSheet('a')), tool('volume', 'Volume', volumeSheet), tool('music', 'Audio+', addAudio), tool('trash', 'Delete', remove, 'del')];
      } else if (sel.kind === 'caption') {
        items = [done, tool('edit', 'Edit', () => (p.words.length ? transcriptSheet(false) : toast('ยังไม่มีคำบรรยาย'))), tool('check', 'Select all', () => (p.words.length ? transcriptSheet(true) : toast('ยังไม่มีคำบรรยาย'))), tool('style', 'Style', styleSheet), tool('caption', 'Re-make', captionsSheet), tool('trash', 'Delete', remove, 'del')];
      } else {
        const tx = p.texts.find((k) => k.id === sel.id);
        items = [done, tool('edit', 'Edit', () => tx && textSheet(tx)), tool('clock', 'Time', () => tx && timeSheet(tx)), tool('copy', 'Copy', copyText), tool('text', 'Text+', addText), tool('trash', 'Delete', remove, 'del')];
      }
      toolsEl.replaceChildren(...items);
    }

    /* ---- export ---- */
    function exportSheet() {
      transport.pause();
      setPlayIcon(false);
      const st = loadSettings();
      let fmt = st.format;
      let quality = st.quality;
      let folder = savedFolder();
      let busy = false;
      let ctl = null;

      const fmtBox = h('div', { class: 'opt' }, FORMATS.map((f) => h('label', {}, h('input', { type: 'radio', name: 'fmt', value: f.id, checked: f.id === fmt }), h('span', {}, f.label))));
      const qSel = h('select', { class: 'input', id: 'qsel' }, QUALITIES.map((q) => h('option', { value: q.id }, q.label)));
      qSel.value = quality;
      const folderLbl = h('div', { class: 'muted small' }, isNative ? (folder ? 'โฟลเดอร์: ' + folder.name : 'ยังไม่ได้เลือกโฟลเดอร์') : isIOS ? 'บน iPhone พอ export เสร็จจะเปิดหน้าต่างแชร์ให้เลือกที่บันทึก' : 'บนเบราว์เซอร์ไฟล์จะลงโฟลเดอร์ดาวน์โหลด');
      const folderBtn = h('button', { class: 'btn', type: 'button', hidden: !isNative }, icon('folder'), 'เลือกโฟลเดอร์ที่จะบันทึก');
      const barFill = h('i', {});
      const prog = h('div', { class: 'bar', hidden: true }, barFill);
      const msg = h('div', { class: 'muted small' });
      const go = h('button', { class: 'btn primary', type: 'button' }, 'เริ่ม Export');
      const cancel = h('button', { class: 'btn', type: 'button', hidden: true }, 'ยกเลิก');
      const sync = () => (qSel.disabled = fmt === 'mp3');
      fmtBox.addEventListener('change', (e) => {
        if (e.target && e.target.name === 'fmt') {
          fmt = e.target.value;
          sync();
        }
      });
      sync();

      const s = sheet(
        'Export',
        h(
          'div',
          { class: 'stack' },
          h('b', {}, 'ชนิดไฟล์'),
          fmtBox,
          h('label', { class: 'field' }, 'ความละเอียด', qSel),
          folderLbl,
          folderBtn,
          prog,
          msg,
          h('div', { class: 'row' }, go, cancel),
          h('p', { class: 'muted small' }, 'ระหว่าง export ห้ามสลับออกจากแอปและห้ามปิดหน้าจอ ความละเอียดสูงจะใช้เวลานานกว่า'),
        ),
        {
          onClose: () => {
            if (busy && ctl) ctl.abort();
          },
        },
      );

      folderBtn.addEventListener('click', async () => {
        const f = await pickFolder();
        if (f) {
          folder = f;
          folderLbl.textContent = 'โฟลเดอร์: ' + f.name;
        }
      });
      cancel.addEventListener('click', () => ctl && ctl.abort());

      go.addEventListener('click', async () => {
        if (busy) return;
        if (isNative && !folder) {
          folder = await pickFolder();
          if (!folder) return toast('ต้องเลือกโฟลเดอร์ที่จะบันทึกก่อน');
          folderLbl.textContent = 'โฟลเดอร์: ' + folder.name;
        }
        quality = qSel.value;
        busy = true;
        exporting = true;
        go.disabled = true;
        cancel.hidden = false;
        prog.hidden = false;
        ctl = new AbortController();
        msg.textContent = fmt === 'mp3' ? 'กำลังสร้างไฟล์เสียง...' : 'กำลัง export กรุณารอและอย่าสลับแอป...';
        try {
          const res = await exportProject(p, {
            format: fmt,
            quality,
            signal: ctl.signal,
            onProgress: (x) => (barFill.style.width = Math.round(x * 100) + '%'),
            onStatus: (m) => (msg.textContent = m),
          });
          msg.textContent = 'กำลังบันทึกไฟล์...';
          const d = new Date();
          const pad = (n) => String(n).padStart(2, '0');
          const name = `Augrant_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${res.ext}`;
          const out = await saveBlob(folder, name, res.mime, res.blob, (x) => (barFill.style.width = Math.round(x * 100) + '%'));
          saveClip({ title: p.title, duration: duration(p), quality: fmt === 'mp3' ? 'audio' : quality, format: res.ext, transcript: p.words.map((w) => w.t).join(' ') }).catch(() => {});
          busy = false;
          exporting = false;
          s.close();
          transport.seek(0);
          toast((res.fellBack ? 'เครื่องนี้ไม่รองรับ MP4 จึงบันทึกเป็น WebM · ' : '') + 'บันทึกแล้วที่ ' + out.where + ' · ' + name, 5200);
        } catch (e) {
          busy = false;
          exporting = false;
          go.disabled = false;
          cancel.hidden = true;
          prog.hidden = true;
          barFill.style.width = '0';
          msg.textContent = e && e.message === 'cancelled' ? 'ยกเลิกแล้ว' : 'ไม่สำเร็จ: ' + ((e && e.message) || e);
          transport.seek(0);
        }
      });
    }

    /* ---- layout ---- */
    const back = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'กลับ' });
    back.innerHTML = ICON.back;
    back.addEventListener('click', async () => {
      if (await confirmSheet('ออกจากหน้าตัดต่อ', 'งานที่ยังไม่ Export จะหายไป', 'ออก')) {
        cleanup();
        stepStyle();
      }
    });
    const exp = h('button', { class: 'exp-btn', type: 'button' }, 'Export');
    exp.addEventListener('click', exportSheet);
    const zi = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ซูมเข้า' });
    zi.innerHTML = ICON.zoomIn;
    zi.addEventListener('click', () => zoom(1.4));
    const zo = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'ซูมออก' });
    zo.innerHTML = ICON.zoomOut;
    zo.addEventListener('click', () => zoom(1 / 1.4));

    show(
      h(
        'div',
        { class: 'editor' },
        h('div', { class: 'topbar' }, back, h('h2', {}, p.title), exp),
        h('div', { class: 'preview' }, canvas),
        h('div', { class: 'transport' }, playBtn, timeLbl, zo, zi),
        tl,
        toolsEl,
      ),
    );
    renderTimeline();
    renderTools();
    transport.seek(0);
    // warm up the first picture so the preview never opens on the plain background
    primeVideo(p, 0).then(() => transport && transport.refresh());
  }

  stepImport();
  return root;
}
