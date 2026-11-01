import { clipAt, projectDuration, srcTimeOf } from '../core/timeline.js';
import { layoutLines, currentWordIndex, lineAt, isThai } from '../core/captions.js';
import { canvasFont } from '../fonts.js';
import { audioContext, scheduleAudio, makeLimiter } from './audio.js';

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

// One background canvas per output size. It keeps the last video frame that was decoded.
function bgLayer(p, W, H) {
  const key = W + 'x' + H;
  if (!p._bg || p._bg.key !== key) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    p._bg = { key, cv, ctx: cv.getContext('2d'), has: false };
  }
  return p._bg;
}

const videoOf = (p, c) => {
  const s = c && p.sources[c.src];
  return s && s.el ? s.el : null;
};
const clampSrc = (v, want) => (v.duration && want > v.duration - 0.05 ? Math.max(0, v.duration - 0.05) : want);

// Seeks and waits until the picture for that time has really been shown. Waiting only for "seeked"
// can leave the previous frame on screen, which made exported videos stutter.
function seekExact(v, want) {
  return new Promise((resolve) => {
    let done = false;
    let fallback = 0;
    const fin = () => {
      if (done) return;
      done = true;
      v.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      clearTimeout(fallback);
      resolve();
    };
    const timer = setTimeout(fin, 3000);
    const onSeeked = () => {
      if (!v.requestVideoFrameCallback) fallback = setTimeout(fin, 40);
      else fallback = setTimeout(fin, 350); // no new frame was shown: the picture is already right
    };
    if (v.requestVideoFrameCallback) {
      const onFrame = (_now, meta) => {
        if (done) return;
        if (Math.abs(meta.mediaTime - want) <= 0.05) fin();
        else v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    }
    v.addEventListener('seeked', onSeeked);
    v.currentTime = want;
  });
}

// Moves the video of the clip at time t to the right frame and waits until it can be drawn.
// Used before playing and for every frame of an export.
export async function primeVideo(p, t, tol = 0.02) {
  const c = clipAt(p.vClips, t) || p.vClips[0];
  const v = videoOf(p, c);
  for (const s of Object.values(p.sources)) if (s.el && s.el !== v && !s.el.paused) s.el.pause();
  if (!v || !c) return;
  const want = clampSrc(v, srcTimeOf(c, Math.min(Math.max(t, c.start), c.start + c.dur)));
  if (!v.paused) v.pause();
  if (Math.abs(v.currentTime - want) > tol || v.seeking) await seekExact(v, want);
  if (v.readyState < 2) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      v.addEventListener(
        'canplay',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  v._clipId = c.id;
}

// Draws one frame. `hit` (optional array) receives bounding boxes in logical coordinates.
export function renderFrame(ctx, W, H, p, t, opts = {}) {
  const hit = opts.hit;
  if (hit) hit.length = 0;
  ctx.setTransform(W / LW, 0, 0, H / LH, 0, 0);
  ctx.clearRect(0, 0, LW, LH);

  const clip = clipAt(p.vClips, t);
  const v = videoOf(p, clip);
  const bg = bgLayer(p, W, H);
  if (clip && v && v.readyState >= 2 && v.videoWidth) {
    const sc = Math.max(LW / v.videoWidth, LH / v.videoHeight);
    const dw = v.videoWidth * sc;
    const dh = v.videoHeight * sc;
    bg.ctx.setTransform(W / LW, 0, 0, H / LH, 0, 0);
    bg.ctx.drawImage(v, (LW - dw) / 2, (LH - dh) / 2, dw, dh);
    bg.has = true;
  }
  if (clip && bg.has) {
    // the last decoded frame stays on screen while the video catches up after a seek
    ctx.drawImage(bg.cv, 0, 0, LW, LH);
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

// Keeps the hidden <video> elements in step with the timeline.
// Normal speeds use the browser's own playback rate. Very slow or very fast clips are driven by seeking.
export function syncVideo(p, t, playing) {
  const c = clipAt(p.vClips, t);
  const v = videoOf(p, c);
  for (const s of Object.values(p.sources)) if (s.el && s.el !== v && !s.el.paused) s.el.pause();
  if (!c || !v) return;
  const want = clampSrc(v, srcTimeOf(c, t));
  const sp = c.speed || 1;
  const drift = Math.abs(v.currentTime - want);
  if (!playing || c.hold) {
    if (!v.paused) v.pause();
    if (drift > 0.04) v.currentTime = want;
    return;
  }
  const now = performance.now();
  const changed = v._clipId !== c.id;
  v._clipId = c.id;
  if (sp < 0.25 || sp > 4) {
    if (!v.paused) v.pause();
    if (!v.seeking && drift > 0.03) v.currentTime = want;
    return;
  }
  if (v.playbackRate !== sp) v.playbackRate = sp;
  const thr = 0.5 * Math.max(1, sp);
  // seek when a new clip starts far from where the video is, or when the picture fell far behind
  if ((changed && drift > 0.08 * Math.max(1, sp)) || (drift > thr && now - (v._seekAt || 0) > 1200)) {
    v._seekAt = now;
    v.currentTime = want;
  }
  if (v.paused || v.ended) v.play().catch(() => {});
  // watchdog: a video that should be playing but does not move gets kicked
  if (v.seeking || Math.abs(v.currentTime - (v._wdCT ?? -1)) > 0.001) {
    v._wdCT = v.currentTime;
    v._wdAt = now;
  } else if (now - (v._wdAt || now) > 800) {
    v._wdAt = now;
    v.currentTime = want;
    v.play().catch(() => {});
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
  let token = 0; // bumped by pause, seek and dispose so a play() still waiting for the video gives up

  function ensureGraph() {
    if (actx) return;
    actx = audioContext();
    master = makeLimiter(actx, null);
    if (exportMode) {
      streamDest = actx.createMediaStreamDestination();
      master.__out.connect(streamDest);
    } else {
      master.__out.connect(actx.destination);
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
      // the sound reaches the ear a little after it is scheduled, so the picture waits for it
      const lat = exportMode ? 0 : Math.min(0.6, actx.outputLatency || 0);
      const el = actx.currentTime - c0 - lat;
      t = Math.max(t0, t0 + el);
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
    const my = ++token;
    ensureGraph();
    if (actx.state !== 'running') await actx.resume();
    const dur = duration(p);
    if (t >= dur - 0.05) t = 0;
    stopSources();
    // get the first picture ready, and the video running, before the sound starts
    await primeVideo(p, t);
    if (my !== token) return false;
    const cur = clipAt(p.vClips, t);
    const v = cur && p.sources[cur.src] && p.sources[cur.src].el;
    if (v && !cur.hold && (cur.speed || 1) >= 0.25 && (cur.speed || 1) <= 4) {
      try {
        v.playbackRate = cur.speed || 1;
        await Promise.race([v.play(), new Promise((res) => setTimeout(res, 700))]);
      } catch {
        /* syncVideo tries again on the next frame */
      }
      if (my !== token) return false;
    }
    const when = actx.currentTime + 0.08;
    sources = scheduleAudio(actx, voiceG, bgG, p, t, when);
    t0 = t;
    c0 = when;
    playing = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    return true;
  }

  function pause() {
    token++;
    if (!playing) return;
    playing = false;
    stopSources();
    syncVideo(p, t, false);
  }

  function seek(nt) {
    token++;
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
    token++;
    playing = false;
    stopSources();
    cancelAnimationFrame(raf);
    for (const s of Object.values(p.sources)) if (s.el && !s.el.paused) s.el.pause();
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
