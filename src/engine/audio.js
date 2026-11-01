import { Mp3Encoder } from '@breezystack/lamejs';

let shared = null;
export function audioContext() {
  if (!shared) {
    const AC = window.AudioContext || window.webkitAudioContext;
    shared = new AC();
  }
  return shared;
}

export async function decodeFile(file) {
  const ab = await file.arrayBuffer();
  return audioContext().decodeAudioData(ab);
}

// Max amplitude per 20 ms window, used to draw waveforms.
export function peaksOf(buffer) {
  const data = buffer.getChannelData(0);
  const win = Math.max(1, Math.floor(buffer.sampleRate * 0.02));
  const n = Math.ceil(data.length / win);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(data.length, (i + 1) * win);
    for (let j = i * win; j < end; j += 4) {
      const v = Math.abs(data[j]);
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}

// How much to multiply a recording so its speech sits at a good level (RMS of the non-silent parts).
// Quiet recordings get a big boost, loud ones are left alone. The limiter catches any peaks.
export function loudnessGain(buffer, target = 0.2, maxGain = 30) {
  if (!buffer) return 1;
  const data = buffer.getChannelData(0);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 3) {
    const v = data[i];
    if (v > 0.01 || v < -0.01) {
      sum += v * v;
      n++;
    }
  }
  if (n < 100) return 1;
  const rms = Math.sqrt(sum / n);
  if (!(rms > 0)) return 1;
  return Math.min(maxGain, Math.max(0.5, target / rms));
}

const SOFT_CURVE = (() => {
  const n = 2048;
  const c = new Float32Array(n);
  const k = 1.6;
  const d = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * k) / d;
  }
  return c;
})();

// Compressor + make-up gain + soft clipper. Connect sources to the returned node.
// It keeps very high volume settings loud without turning into crackle.
export function makeLimiter(actx, dest) {
  const comp = actx.createDynamicsCompressor();
  comp.threshold.value = -4;
  comp.knee.value = 0;
  comp.ratio.value = 20;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  const makeup = actx.createGain();
  makeup.gain.value = 1.0;
  const shaper = actx.createWaveShaper();
  shaper.curve = SOFT_CURVE;
  shaper.oversample = '2x';
  comp.connect(makeup);
  makeup.connect(shaper);
  if (dest) shaper.connect(dest);
  comp.__out = shaper;
  return comp;
}

// Plays every audio clip of the project through two gain nodes (voice and background video).
// Works on both AudioContext (live) and OfflineAudioContext (export).
// Each clip plays its own source at its own speed. Frozen (hold) clips are silent.
export function scheduleAudio(actx, voiceOut, bgOut, p, fromT, when) {
  const srcs = [];
  const put = (c, node) => {
    const s = p.sources[c.src];
    if (!s || !s.buffer || c.hold) return;
    const end = c.start + c.dur;
    if (end <= fromT + 1e-4) return;
    const begin = Math.max(c.start, fromT);
    const sp = c.speed || 1;
    const offset = c.srcStart + (begin - c.start) * sp;
    if (offset >= s.buffer.duration) return;
    const len = Math.min((end - begin) * sp, s.buffer.duration - offset);
    if (!(len > 0)) return;
    const node1 = actx.createBufferSource();
    node1.buffer = s.buffer;
    node1.playbackRate.value = sp;
    const g = actx.createGain();
    g.gain.value = s.norm || 1;
    node1.connect(g);
    g.connect(node);
    node1.start(when + (begin - fromT), offset, len);
    srcs.push(node1);
  };
  for (const c of p.aClips) put(c, voiceOut);
  for (const c of p.vClips) put(c, bgOut);
  return srcs;
}

// Voice track only, mono 16 kHz, for speech recognition.
export async function renderVoice16k(p, duration) {
  const len = Math.max(1, Math.ceil(duration * 16000));
  const off = new OfflineAudioContext(1, len, 16000);
  const g = off.createGain();
  g.connect(off.destination);
  scheduleAudio(off, g, off.createGain(), { sources: p.sources, aClips: p.aClips, vClips: [] }, 0, 0);
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

// The whole mix (voice + background sound) as one stereo AudioBuffer.
export async function renderMix(p, duration, rate = 48000) {
  const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * rate)), rate);
  const lim = makeLimiter(off, off.destination);
  const vg = off.createGain();
  const bg = off.createGain();
  vg.gain.value = p.vol.voice / 100;
  bg.gain.value = p.vol.bg / 100;
  vg.connect(lim);
  bg.connect(lim);
  scheduleAudio(off, vg, bg, p, 0, 0);
  return off.startRendering();
}

export async function renderMp3(p, duration, onProgress) {
  const buf = await renderMix(p, duration, 44100);
  const rate = buf.sampleRate;
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const toInt = (f) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const v = Math.max(-1, Math.min(1, f[i]));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  };
  const li = toInt(l);
  const ri = toInt(r);
  const enc = new Mp3Encoder(2, rate, 128);
  const parts = [];
  const block = 1152 * 10;
  for (let i = 0; i < li.length; i += block) {
    const a = enc.encodeBuffer(li.subarray(i, i + block), ri.subarray(i, i + block));
    if (a.length) parts.push(new Uint8Array(a));
    if (onProgress) onProgress(Math.min(1, i / li.length));
    if ((i / block) % 20 === 0) await new Promise((res) => setTimeout(res, 0));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: 'audio/mpeg' });
}
