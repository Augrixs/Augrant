import { clipAt, projectDuration } from '../core/timeline.js';
import { layoutLines, currentWordIndex, lineAt, isThai } from '../core/captions.js';
import { canvasFont } from '../fonts.js';
import { audioContext, scheduleAudio } from './audio.js';

export const LW = 1080; // logical canvas size, scaled to the real canvas on draw
export const LH = 1920;

export const duration = (p) => projectDuration(p.aClips, p.vClips);

function outlineText(ctx, text, x, y, fill, stroke, lw) {
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawGradient(ctx, now) {
  const g = ctx.createLinearGradient(0, 0, LW, LH);
  g.addColorStop(0, '#1b2169');
  g.addColorStop(1, '#0b0d26');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, LW, LH);
  const blobs = [
    [0.2, 0.25, '#2f3df5', 800, 0],
    [0.85, 0.6, '#3aa0ff', 700, 2],
    [0.4, 0.9, '#6c3bff', 850, 4],
  ];
  for (const [bx, by, col, r, ph] of blobs) {
    const x = LW * bx + Math.sin(now / 2300 + ph) * 120;
    const y = LH * by + Math.cos(now / 2900 + ph) * 160;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col + 'aa');
    rg.addColorStop(1, col + '00');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, LW, LH);
  }
}

// Caption lines are cached on the project: they only change with font, size or the word list.
function captionLines(ctx, p) {
  const st = p.style;
  const key = `${st.font}|${st.size}|${p.wordsVersion || 0}`;
  if (p._lineKey === key && p._lines) return p._lines;
  ctx.font = canvasFont(st.font, st.size);
  const text = p.words.map((w) => w.t).join('');
  const gap = isThai(text) ? st.size * 0.06 : st.size * 0.28;
  p._gap = gap;
  p._lines = layoutLines(p.words, (t) => ctx.measureText(t).width, LW * 0.9, gap);
  p._lineKey = key;
  return p._lines;
}

export const getCaptionLines = captionLines;

export function invalidateCaptions(p) {
  p._lineKey = null;
  p.wordsVersion = (p.wordsVersion || 0) + 1;
}

// Draws one frame. `hit` (optional array) receives bounding boxes in logical coordinates.
export function renderFrame(ctx, W, H, p, t, opts = {}) {
  const hit = opts.hit;
  if (hit) hit.length = 0;
  ctx.setTransform(W / LW, 0, 0, H / LH, 0, 0);
  ctx.clearRect(0, 0, LW, LH);

  const v = p.video && p.video.el;
  const clip = clipAt(p.vClips, t);
  if (clip && v && v.readyState >= 2 && v.videoWidth) {
    const sc = Math.max(LW / v.videoWidth, LH / v.videoHeight);
    const dw = v.videoWidth * sc;
    const dh = v.videoHeight * sc;
    ctx.drawImage(v, (LW - dw) / 2, (LH - dh) / 2, dw, dh);
  } else {
    drawGradient(ctx, opts.now || 0);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, 0, LW, LH);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // free text layers
  for (const tx of p.texts) {
    if (t < tx.s || t >= tx.e) continue;
    ctx.font = canvasFont(tx.font, tx.size);
    const lines = String(tx.text).split('\n');
    const lh = tx.size * 1.25;
    let maxw = 0;
    for (const ln of lines) maxw = Math.max(maxw, ctx.measureText(ln).width);
    const cx = tx.x * LW;
    const top = tx.y * LH - (lines.length * lh) / 2;
    lines.forEach((ln, i) => {
      const w = ctx.measureText(ln).width;
      outlineText(ctx, ln, cx - w / 2, top + i * lh + tx.size, tx.color, '#000', tx.size * 0.14);
    });
    if (hit) hit.push({ kind: 'text', id: tx.id, x0: cx - maxw / 2 - 20, y0: top - 10, x1: cx + maxw / 2 + 20, y1: top + lines.length * lh + 10 });
  }

  // captions: one row, current word in the highlight colour
  if (p.words.length) {
    const lines = captionLines(ctx, p);
    const ln = lineAt(lines, t);
    const st = p.style;
    if (ln) {
      ctx.font = canvasFont(st.font, st.size);
      const cur = currentWordIndex(p.words, t);
      const x0 = (LW - ln.width) / 2;
      const y = st.y * LH + st.size * 0.35;
      let x = x0;
      ln.idx.forEach((wi, k) => {
        const w = p.words[wi];
        const wd = ln.widths[k];
        const isCur = wi === cur;
        let sc = 1;
        if (isCur) sc = 1 + 0.12 * Math.max(0, 1 - (t - w.s) / 0.12);
        ctx.save();
        ctx.translate(x + wd / 2, y);
        ctx.scale(sc, sc);
        outlineText(ctx, w.t, -wd / 2, 0, isCur ? st.color : st.base, '#000', st.size * 0.16);
        ctx.restore();
        x += wd + p._gap;
      });
      if (hit) hit.push({ kind: 'caption', id: 'caption', x0: x0 - 20, y0: y - st.size, x1: x0 + ln.width + 20, y1: y + st.size * 0.4 });
    } else if (hit) {
      const y = st.y * LH + st.size * 0.35;
      hit.push({ kind: 'caption', id: 'caption', x0: LW * 0.2, y0: y - st.size, x1: LW * 0.8, y1: y + st.size * 0.4 });
    }
  }

  if (opts.sel && hit) {
    const b = hit.find((x) => x.id === opts.sel);
    if (b) {
      ctx.save();
      ctx.setLineDash([16, 12]);
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#7fb4ff';
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      ctx.restore();
    }
  }
}

// Keeps the hidden <video> in step with the timeline.
export function syncVideo(p, t, playing) {
  const v = p.video && p.video.el;
  if (!v) return;
  const c = clipAt(p.vClips, t);
  if (!c) {
    if (!v.paused) v.pause();
    return;
  }
  let want = c.srcStart + (t - c.start);
  if (v.duration && want > v.duration - 0.05) want = Math.max(0, v.duration - 0.05);
  if (playing) {
    if (Math.abs(v.currentTime - want) > 0.35) v.currentTime = want;
    if (v.paused) v.play().catch(() => {});
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
  }
}

// Playback clock. The audio clock drives the timeline so the picture follows the sound.
// exportMode sends sound to a MediaStream instead of the speakers.
export function createTransport(p, { onFrame, onEnd, exportMode = false }) {
  let actx = null;
  let master = null;
  let voiceG = null;
  let bgG = null;
  let streamDest = null;
  let sources = [];
  let playing = false;
  let t = 0;
  let t0 = 0;
  let c0 = 0;
  let raf = 0;

  function ensureGraph() {
    if (actx) return;
    actx = audioContext();
    master = actx.createGain();
    const comp = actx.createDynamicsCompressor();
    master.connect(comp);
    if (exportMode) {
      streamDest = actx.createMediaStreamDestination();
      comp.connect(streamDest);
    } else {
      comp.connect(actx.destination);
    }
    voiceG = actx.createGain();
    bgG = actx.createGain();
    voiceG.connect(master);
    bgG.connect(master);
    setVolumes();
  }

  function setVolumes() {
    if (!actx) return;
    voiceG.gain.value = p.vol.voice / 100;
    bgG.gain.value = p.vol.bg / 100;
  }

  function stopSources() {
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    sources = [];
  }

  function frame(now) {
    if (playing) {
      const el = actx.currentTime - c0;
      t = t0 + Math.max(0, el);
      const dur = duration(p);
      if (t >= dur) {
        t = dur;
        pause();
        syncVideo(p, Math.max(0, dur - 0.01), false);
        onFrame(t, now);
        raf = requestAnimationFrame(frame);
        if (onEnd) onEnd();
        return;
      }
      syncVideo(p, t, true);
    }
    onFrame(t, now);
    raf = requestAnimationFrame(frame);
  }

  async function play() {
    ensureGraph();
    if (actx.state !== 'running') await actx.resume();
    const dur = duration(p);
    if (t >= dur - 0.05) t = 0;
    stopSources();
    const when = actx.currentTime + 0.08;
    sources = scheduleAudio(actx, voiceG, bgG, p, t, when);
    t0 = t;
    c0 = when;
    playing = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (!playing) return;
    playing = false;
    stopSources();
    syncVideo(p, t, false);
  }

  function seek(nt) {
    const dur = duration(p);
    t = Math.min(Math.max(0, nt), dur);
    if (playing) {
      stopSources();
      const when = actx.currentTime + 0.05;
      sources = scheduleAudio(actx, voiceG, bgG, p, t, when);
      t0 = t;
      c0 = when;
    } else {
      syncVideo(p, t, false);
      onFrame(t, performance.now());
    }
  }

  function start() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function dispose() {
    playing = false;
    stopSources();
    cancelAnimationFrame(raf);
    if (p.video && p.video.el && !p.video.el.paused) p.video.el.pause();
  }

  return {
    play,
    pause,
    seek,
    start,
    dispose,
    setVolumes,
    get time() {
      return t;
    },
    get playing() {
      return playing;
    },
    get audioStream() {
      ensureGraph();
      return streamDest ? streamDest.stream : null;
    },
    refresh: () => onFrame(t, performance.now()),
  };
}
