import { h, icon, ICON, toast, sheet, fmtTime, loadingOverlay, confirmSheet, loadSettings } from '../util.js';
import { FONTS, ensureFont, canvasFont, fontStack } from '../fonts.js';
import { uid, layout, fitVideoToAudio, splitAt, removeClip, total, clampVolume } from '../core/timeline.js';
import { rippleWords } from '../core/captions.js';
import { decodeFile, peaksOf, renderVoice16k } from '../engine/audio.js';
import { renderFrame, createTransport, duration, invalidateCaptions, getCaptionLines, LW, LH } from '../engine/player.js';
import { transcribe, LANGS } from '../engine/whisper.js';
import { exportProject, QUALITIES, FORMATS } from '../engine/exporter.js';
import { requestMedia, pickFolder, savedFolder, saveBlob, isNative } from '../native.js';
import { saveClip } from '../supa.js';

const COLORS = ['#FFD43B', '#4DF0B0', '#FF6B9A', '#62D9FF', '#FF8A3D', '#B28DFF', '#FFFFFF'];

/* ---------- media loading ---------- */
async function loadAudio(file) {
  let buffer;
  try {
    buffer = await decodeFile(file);
  } catch {
    throw new Error('เปิดไฟล์เสียงนี้ไม่ได้ ลองไฟล์ mp3, m4a หรือ wav');
  }
  return { name: file.name, buffer, dur: buffer.duration, peaks: peaksOf(buffer) };
}

async function loadVideo(file) {
  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.muted = true;
  el.loop = false;
  el.playsInline = true;
  el.setAttribute('playsinline', '');
  el.preload = 'auto';
  el.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.append(el);
  el.src = url;
  try {
    await new Promise((res, rej) => {
      el.onloadeddata = res;
      el.onerror = () => rej(new Error('เปิดวิดีโอนี้ไม่ได้ ลองไฟล์ mp4'));
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    el.remove();
    throw e;
  }
  if (!Number.isFinite(el.duration) || el.duration <= 0) {
    URL.revokeObjectURL(url);
    el.remove();
    throw new Error('อ่านความยาววิดีโอไม่ได้');
  }
  let buffer = null;
  try {
    buffer = await decodeFile(file);
  } catch {
    buffer = null; // the video has no usable sound track
  }
  return { name: file.name, url, el, dur: el.duration, buffer };
}

function releaseVideo(v) {
  if (!v) return;
  try {
    v.el.pause();
    v.el.removeAttribute('src');
    v.el.load();
  } catch {
    /* ignore */
  }
  v.el.remove();
  URL.revokeObjectURL(v.url);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { position: 'fixed', left: '-9999px' } });
    inp.addEventListener('change', () => {
      resolve(inp.files && inp.files[0] ? inp.files[0] : null);
      setTimeout(() => inp.remove(), 1000);
    });
    document.body.append(inp);
    inp.click();
  });
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

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
    if (project) releaseVideo(project.video);
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
          h('p', { class: 'muted small' }, 'วิดีโอจะถูกตัดให้ยาวเท่าเสียงอัตโนมัติ ถ้าสั้นกว่าเสียงจะเล่นวน'),
          next,
        ),
      ),
    );
  }

  async function prepare() {
    const ov = loadingOverlay('กำลังอ่านไฟล์เสียง...');
    try {
      const audio = await loadAudio(files.audio);
      ov.set('กำลังอ่านวิดีโอ...');
      const video = await loadVideo(files.video);
      if (project) releaseVideo(project.video);
      const s = loadSettings();
      project = {
        title: audio.name.replace(/\.[^.]+$/, '') || 'Untitled',
        audio,
        video,
        aClips: layout([{ id: uid(), srcStart: 0, dur: audio.dur }]),
        vClips: fitVideoToAudio(video.dur, audio.dur),
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
      toast(e.message || 'เปิดไฟล์ไม่ได้', 4200);
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

    const selId = () => (sel ? (sel.kind === 'text' ? sel.id : sel.kind === 'caption' ? 'caption' : null) : null);

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

    /* timeline drawing */
    function waveform(c) {
      const w = Math.min(4000, Math.max(8, Math.ceil(c.dur * pps)));
      const cv = h('canvas', { width: w, height: 32 });
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      const peaks = p.audio.peaks;
      const per = 50; // peaks per second (20 ms each)
      for (let x = 0; x < w; x++) {
        const i0 = Math.floor((c.srcStart + (x / w) * c.dur) * per);
        const i1 = Math.max(i0 + 1, Math.floor((c.srcStart + ((x + 1) / w) * c.dur) * per));
        let m = 0;
        for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
        const hh = Math.max(1, Math.min(30, m * 40));
        g.fillRect(x, 16 - hh / 2, 1, hh);
      }
      return cv;
    }

    function block(kind, id, cls, start, dur, label, top, extra) {
      const on = sel && sel.kind === kind && sel.id === id;
      const b = h('div', {
        class: 'blk ' + cls + (on ? ' sel' : ''),
        style: { left: start * pps + 'px', width: Math.max(8, dur * pps - 2) + 'px', top: top + 'px' },
        onclick: (e) => {
          e.stopPropagation();
          select({ kind, id });
          if (extra) extra();
        },
      });
      return b;
    }

    function renderTimeline() {
      const dur = duration(p);
      tlInner.style.width = Math.max(dur * pps + 80, tl.clientWidth) + 'px';
      const kids = [];
      const ruler = h('div', { class: 'ruler' });
      const step = pps >= 80 ? 1 : pps >= 40 ? 2 : pps >= 20 ? 5 : 10;
      for (let s = 0; s <= dur; s += step) ruler.append(h('div', { class: 'tick', style: { left: s * pps + 'px' } }, fmtTime(s)));
      kids.push(ruler);
      p.vClips.forEach((c, i) => {
        const b = block('v', c.id, 'v', c.start, c.dur, '', 24);
        b.append('Video ' + (i + 1));
        kids.push(b);
      });
      p.aClips.forEach((c, i) => {
        const b = block('a', c.id, 'a', c.start, c.dur, '', 62);
        b.append(waveform(c), h('span', { style: { position: 'relative' } }, 'เสียง ' + (i + 1)));
        kids.push(b);
      });
      if (p.words.length) {
        const lines = getCaptionLines(ctx, p);
        lines.forEach((l) => {
          const b = block('caption', 'caption', 'c', l.start, Math.max(0.2, l.end - l.start), '', 100, () => transport.seek(l.start));
          b.append(p.words.slice(l.idx[0], l.idx[l.idx.length - 1] + 1).map((w) => w.t).join(' '));
          kids.push(b);
        });
      }
      p.texts.forEach((tx) => {
        const b = block('text', tx.id, 'x', tx.s, Math.max(0.3, tx.e - tx.s), '', 138);
        b.append(tx.text.split('\n')[0]);
        kids.push(b);
      });
      kids.push(playhead);
      tlInner.replaceChildren(...kids);
      playhead.style.left = transport.time * pps + 'px';
    }

    function select(s) {
      sel = s;
      renderTimeline();
      transport.refresh();
    }

    tlInner.addEventListener('click', (e) => {
      if (e.target.closest('.blk')) return;
      const r = tlInner.getBoundingClientRect();
      transport.seek((e.clientX - r.left) / pps);
      if (sel) select(null);
    });

    /* dragging text and captions in the preview */
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
        select({ kind: 'text', id: b.id });
        drag = { kind: 'text', tx, x, y, sx: tx.x, sy: tx.y };
      } else {
        select({ kind: 'caption', id: 'caption' });
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

    playBtn.addEventListener('click', async () => {
      if (transport.playing) {
        transport.pause();
        setPlayIcon(false);
      } else {
        await transport.play();
        setPlayIcon(true);
      }
    });

    const zoom = (f) => {
      pps = clamp(pps * f, 8, 400);
      renderTimeline();
    };

    /* ----- tools ----- */
    async function replaceVideo() {
      const f = await pickFile('video/*');
      if (!f) return;
      const ov = loadingOverlay('กำลังอ่านวิดีโอ...');
      try {
        const v = await loadVideo(f);
        const old = p.video;
        p.video = v;
        p.vClips = fitVideoToAudio(v.dur, total(p.aClips));
        releaseVideo(old);
        renderTimeline();
        transport.seek(0);
        toast('เปลี่ยนวิดีโอพื้นหลังแล้ว');
      } catch (e) {
        toast(e.message || 'เปิดวิดีโอไม่ได้');
      } finally {
        ov.done();
      }
    }

    async function replaceAudio() {
      const f = await pickFile('audio/*');
      if (!f) return;
      if (p.words.length && !(await confirmSheet('เปลี่ยนไฟล์เสียง', 'คำบรรยายเดิมจะถูกล้าง ต้องสร้างใหม่จากเสียงใหม่', 'เปลี่ยน'))) return;
      const ov = loadingOverlay('กำลังอ่านไฟล์เสียง...');
      try {
        const a = await loadAudio(f);
        transport.pause();
        setPlayIcon(false);
        p.audio = a;
        p.aClips = layout([{ id: uid(), srcStart: 0, dur: a.dur }]);
        p.vClips = fitVideoToAudio(p.video.dur, a.dur);
        p.words = [];
        invalidateCaptions(p);
        renderTimeline();
        transport.seek(0);
        toast('เปลี่ยนไฟล์เสียงแล้ว วิดีโอถูกปรับให้ยาวเท่าเสียง');
      } catch (e) {
        toast(e.message || 'เปิดไฟล์เสียงไม่ได้');
      } finally {
        ov.done();
      }
    }

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
            transport.refresh();
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
        transcriptSheet();
      });
    }

    function transcriptSheet() {
      let cur = -1;
      const chips = h('div', { class: 'chips' });
      const input = h('input', { class: 'input', type: 'text', id: 'wedit' });
      const ok = h('button', { class: 'btn primary sm', type: 'button' }, 'ใช้คำนี้');
      const del = h('button', { class: 'btn danger sm', type: 'button' }, 'ลบคำนี้');
      const editor = h('div', { class: 'row', hidden: true }, input, ok, del);
      const paint = () => {
        chips.replaceChildren(
          ...p.words.map((w, i) => {
            const c = h('button', { class: 'chip' + (i === cur ? ' on' : ''), type: 'button' }, w.t);
            c.addEventListener('click', () => {
              cur = i;
              input.value = w.t;
              editor.hidden = false;
              transport.seek(w.s);
              paint();
            });
            return c;
          }),
        );
      };
      const changed = () => {
        invalidateCaptions(p);
        renderTimeline();
        transport.refresh();
      };
      ok.addEventListener('click', () => {
        if (cur < 0) return;
        const v = input.value.trim();
        if (v) p.words[cur].t = v;
        else p.words.splice(cur, 1);
        cur = -1;
        editor.hidden = true;
        changed();
        paint();
      });
      del.addEventListener('click', () => {
        if (cur < 0) return;
        p.words.splice(cur, 1);
        cur = -1;
        editor.hidden = true;
        changed();
        paint();
      });
      paint();
      sheet('แก้ไขข้อความคำบรรยาย', h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'แตะคำที่ผิดเพื่อแก้ไข เวลาของคำจะคงเดิม'), editor, chips));
    }

    function addText() {
      const t = transport.time;
      const dur = duration(p);
      const tx = { id: uid('t'), text: 'ข้อความ', x: 0.5, y: 0.3, s: t, e: Math.max(t + 0.5, dur), size: 80, color: '#FFFFFF', font: p.style.font };
      p.texts.push(tx);
      select({ kind: 'text', id: tx.id });
      textSheet(tx);
    }

    function textSheet(tx) {
      const ta = h('textarea', { class: 'input', id: 'txt', rows: 3, value: tx.text });
      const size = h('input', { type: 'range', min: 30, max: 220, step: 2, value: tx.size });
      const col = h('input', { class: 'sw-input', type: 'color', value: tx.color });
      const font = h('select', { class: 'input', id: 'tfont' }, FONTS.map((f) => h('option', { value: f.id }, f.id)));
      font.value = tx.font;
      const s0 = h('input', { class: 'input', id: 'ts', type: 'number', min: 0, step: 0.1, value: tx.s.toFixed(1) });
      const e0 = h('input', { class: 'input', id: 'te', type: 'number', min: 0, step: 0.1, value: tx.e.toFixed(1) });
      const upd = () => {
        tx.text = ta.value || ' ';
        tx.size = Number(size.value);
        tx.color = col.value;
        tx.font = font.value;
        ensureFont(tx.font);
        transport.refresh();
      };
      [ta, size, col, font].forEach((el) => el.addEventListener('input', upd));
      const timing = () => {
        const a = Math.max(0, Number(s0.value) || 0);
        const b = Math.max(a + 0.2, Number(e0.value) || a + 1);
        tx.s = a;
        tx.e = b;
        renderTimeline();
        transport.refresh();
      };
      [s0, e0].forEach((el) => el.addEventListener('change', timing));
      const del = h('button', { class: 'btn danger', type: 'button' }, 'ลบข้อความนี้');
      const s = sheet(
        'ข้อความ',
        h(
          'div',
          { class: 'stack' },
          ta,
          h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'สี'), col, h('span', { class: 'muted small' }, 'ขนาด'), size),
          h('label', { class: 'field' }, 'ฟอนต์', font),
          h('div', { class: 'row' }, h('label', { class: 'field grow' }, 'เริ่ม (วินาที)', s0), h('label', { class: 'field grow' }, 'จบ (วินาที)', e0)),
          h('p', { class: 'muted small' }, 'ลากข้อความในหน้าต่างวิดีโอเพื่อย้ายตำแหน่ง'),
          del,
        ),
        { onClose: () => renderTimeline() },
      );
      del.addEventListener('click', () => {
        p.texts = p.texts.filter((k) => k.id !== tx.id);
        sel = null;
        s.close();
        renderTimeline();
        transport.refresh();
      });
    }

    function styleSheet() {
      let pk = null;
      const box = h('div', {});
      pk = stylePicker(p, () => {
        renderTimeline();
        transport.refresh();
      });
      box.append(pk.el);
      sheet('ฟอนต์และสี', box, { onClose: () => pk.dispose() });
    }

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
      sheet(
        'ความดังเสียง (1-1000)',
        h(
          'div',
          { class: 'stack' },
          row('เสียงพูด', 'voice', true),
          row('เสียงของวิดีโอพื้นหลัง', 'bg', !!p.video.buffer),
          p.video.buffer ? null : h('p', { class: 'muted small' }, 'วิดีโอนี้ไม่มีเสียงที่อ่านได้'),
          h('p', { class: 'muted small' }, '100 = ความดังปกติ ค่าเกิน 200 เสียงอาจแตก'),
        ),
      );
    }

    function split() {
      const t = transport.time;
      if (!sel || (sel.kind !== 'v' && sel.kind !== 'a')) return toast('เลือกคลิปวิดีโอหรือคลิปเสียงที่จะแบ่งก่อน');
      const key = sel.kind === 'v' ? 'vClips' : 'aClips';
      const r = splitAt(p[key], t);
      if (!r) return toast('เลื่อนเส้นเวลาไปกลางคลิปก่อนแบ่ง');
      p[key] = r;
      sel = null;
      renderTimeline();
      transport.refresh();
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
        if (p.aClips.length <= 1) return toast('ต้องเหลือคลิปเสียงอย่างน้อย 1 คลิป');
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
      transport.refresh();
    }

    function editSelected() {
      if (sel && sel.kind === 'text') return textSheet(p.texts.find((k) => k.id === sel.id));
      if (p.words.length) return transcriptSheet();
      toast('เลือกข้อความที่จะแก้ หรือสร้างคำบรรยายก่อน');
    }

    /* ----- export ----- */
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
      const folderLbl = h('div', { class: 'muted small' }, isNative ? (folder ? 'โฟลเดอร์: ' + folder.name : 'ยังไม่ได้เลือกโฟลเดอร์') : 'บนเบราว์เซอร์ไฟล์จะลงโฟลเดอร์ดาวน์โหลด');
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
          h('p', { class: 'muted small' }, 'วิดีโอใช้เวลา export เท่าความยาวคลิป ห้ามสลับออกจากแอปและห้ามปิดหน้าจอ ถ้าค้างให้ลดความละเอียด'),
        ),
        { onClose: () => !busy },
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

    /* ----- layout ----- */
    const tool = (ic, label, fn) => {
      const b = h('button', { class: 'tool', type: 'button' }, icon(ic), label);
      b.addEventListener('click', fn);
      return b;
    };
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
        h(
          'div',
          { class: 'tools' },
          tool('film', 'Video+', replaceVideo),
          tool('music', 'Audio+', replaceAudio),
          tool('caption', 'Captions', captionsSheet),
          tool('text', 'Text+', addText),
          tool('style', 'Style', styleSheet),
          tool('volume', 'Volume', volumeSheet),
          tool('scissors', 'Split', split),
          tool('trash', 'Delete', remove),
          tool('edit', 'Edit', editSelected),
        ),
      ),
    );
    renderTimeline();
    transport.seek(0);
  }

  stepImport();
  return root;
}
