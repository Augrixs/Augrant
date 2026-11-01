import lamejs from '@breezystack/lamejs';
import { clipAt } from '../core/timeline.js';

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

// Plays every audio clip of the project through two gain nodes (voice and background video).
// Works on both AudioContext (live) and OfflineAudioContext (MP3 export).
export function scheduleAudio(actx, voiceOut, bgOut, project, fromT, when) {
  const srcs = [];
  const put = (buf, node, start, srcStart, dur) => {
    const end = start + dur;
    if (!buf || end <= fromT) return;
    const begin = Math.max(start, fromT);
    const s = actx.createBufferSource();
    s.buffer = buf;
    s.connect(node);
    s.start(when + (begin - fromT), srcStart + (begin - start), end - begin);
    srcs.push(s);
  };
  for (const c of project.aClips) put(project.audio.buffer, voiceOut, c.start, c.srcStart, c.dur);
  for (const c of project.vClips) put(project.video.buffer, bgOut, c.start, c.srcStart, c.dur);
  return srcs;
}

// Voice track only, mono 16 kHz, for speech recognition.
export async function renderVoice16k(project, duration) {
  const len = Math.max(1, Math.ceil(duration * 16000));
  const off = new OfflineAudioContext(1, len, 16000);
  const g = off.createGain();
  g.connect(off.destination);
  scheduleAudio(off, g, off.createGain(), { ...project, vClips: [], video: { buffer: null } }, 0, 0);
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

export async function renderMp3(project, duration, onProgress) {
  const rate = 44100;
  const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * rate)), rate);
  const comp = off.createDynamicsCompressor();
  comp.connect(off.destination);
  const vg = off.createGain();
  const bg = off.createGain();
  vg.gain.value = project.vol.voice / 100;
  bg.gain.value = project.vol.bg / 100;
  vg.connect(comp);
  bg.connect(comp);
  scheduleAudio(off, vg, bg, project, 0, 0);
  const buf = await off.startRendering();
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
  const enc = new lamejs.Mp3Encoder(2, rate, 128);
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

export { clipAt };
