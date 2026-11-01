import { renderFrame, createTransport, duration, syncVideo, primeVideo } from './player.js';
import { renderMp3, renderMix } from './audio.js';
import { patchWebmDuration } from './webmfix.js';

export const QUALITIES = [
  { id: '360', label: '360p', w: 360, h: 640, bps: 1500000 },
  { id: '480', label: '480p', w: 480, h: 854, bps: 2500000 },
  { id: '720', label: '720p (HD)', w: 720, h: 1280, bps: 5000000 },
  { id: '1080', label: '1080p (Full HD)', w: 1080, h: 1920, bps: 8000000 },
  { id: '1440', label: '2K (1440p) ช้า', w: 1440, h: 2560, bps: 14000000 },
  { id: '2160', label: '4K (2160p) ช้ามาก', w: 2160, h: 3840, bps: 30000000 },
];

export const FORMATS = [
  { id: 'mp4', label: 'MP4 (วิดีโอ)' },
  { id: 'webm', label: 'WebM (วิดีโอ)' },
  { id: 'mp3', label: 'MP3 (เสียงอย่างเดียว)' },
];

const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cancelled = () => new Error('cancelled');

/* ---------- path 1: WebCodecs (fast, exact length, never freezes) ---------- */

function avcCandidates(W, H) {
  const px = W * H;
  if (px <= 921600) return ['avc1.64001f', 'avc1.4d001f', 'avc1.640028', 'avc1.42001f'];
  if (px <= 2073600) return ['avc1.640028', 'avc1.4d0028', 'avc1.640032', 'avc1.42001f'];
  if (px <= 3686400) return ['avc1.640032', 'avc1.640033', 'avc1.4d0032'];
  return ['avc1.640033', 'avc1.640034', 'avc1.4d0033'];
}

async function pickVideoConfig(format, W, H, bps) {
  const list = format === 'mp4' ? avcCandidates(W, H) : ['vp09.00.10.08', 'vp8'];
  for (const codec of list) {
    const cfg = { codec, width: W, height: H, bitrate: bps, framerate: FPS };
    if (format === 'mp4') cfg.avc = { format: 'avc' };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r && r.supported) return cfg;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function pickAudioConfig(format) {
  const list = format === 'mp4' ? ['mp4a.40.2', 'opus'] : ['opus'];
  for (const codec of list) {
    const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 };
    try {
      const r = await AudioEncoder.isConfigSupported(cfg);
      if (r && r.supported) return cfg;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function exportWebCodecs(p, { format, q, onProgress, onStatus, signal }) {
  const dur = duration(p);
  const W = q.w;
  const H = q.h;
  const vcfg = await pickVideoConfig(format, W, H, q.bps);
  const acfg = await pickAudioConfig(format);
  if (!vcfg || !acfg) {
    const e = new Error('unsupported');
    e.code = 'unsupported';
    throw e;
  }
  const isMp4 = format === 'mp4';
  const mod = isMp4 ? await import('mp4-muxer') : await import('webm-muxer');
  const target = new mod.ArrayBufferTarget();
  const audioOpts = { numberOfChannels: 2, sampleRate: 48000 };
  const muxer = isMp4
    ? new mod.Muxer({ target, video: { codec: 'avc', width: W, height: H }, audio: { codec: acfg.codec === 'opus' ? 'opus' : 'aac', ...audioOpts }, fastStart: 'in-memory' })
    : new mod.Muxer({ target, video: { codec: vcfg.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width: W, height: H, frameRate: FPS }, audio: { codec: 'A_OPUS', ...audioOpts } });

  let encErr = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encErr = e) });
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (encErr = e) });
  const closeAll = () => {
    try {
      if (venc.state !== 'closed') venc.close();
    } catch {
      /* ignore */
    }
    try {
      if (aenc.state !== 'closed') aenc.close();
    } catch {
      /* ignore */
    }
  };
  try {
    venc.configure(vcfg);
    aenc.configure(acfg);

    if (onStatus) onStatus('กำลังเตรียมเสียง...');
    const mix = await renderMix(p, dur, 48000);
    const L = mix.getChannelData(0);
    const R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
    let aPos = 0;
    const feedAudio = (untilSec) => {
      const end = Math.min(L.length, Math.floor(untilSec * 48000));
      while (aPos < end) {
        const n = Math.min(4800, end - aPos);
        const data = new Float32Array(n * 2);
        data.set(L.subarray(aPos, aPos + n), 0);
        data.set(R.subarray(aPos, aPos + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((aPos / 48000) * 1e6), data });
        aenc.encode(ad);
        ad.close();
        aPos += n;
      }
    };

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const frames = Math.max(1, Math.round(dur * FPS));
    const started = performance.now();
    if (onStatus) onStatus('กำลังสร้างวิดีโอ...');
    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) throw cancelled();
      if (encErr) throw encErr;
      const t = Math.min(i / FPS, Math.max(0, dur - 0.0005));
      await primeVideo(p, t, 0.012);
      renderFrame(ctx, W, H, p, t, { now: t * 1000 });
      const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
      vf.close();
      feedAudio(t + 0.6);
      while (venc.encodeQueueSize > 6 || aenc.encodeQueueSize > 24) {
        if (encErr) throw encErr;
        await sleep(4);
      }
      if (i % 3 === 0) {
        if (onProgress) onProgress(i / frames);
        if (onStatus && i > 20) {
          const per = (performance.now() - started) / i;
          const left = Math.max(0, Math.round((per * (frames - i)) / 1000));
          onStatus(`กำลังสร้างวิดีโอ... เหลือประมาณ ${left} วินาที`);
        }
      }
    }
    feedAudio(dur + 1);
    await venc.flush();
    await aenc.flush();
    if (encErr) throw encErr;
    muxer.finalize();
    closeAll();
    const mime = isMp4 ? 'video/mp4' : 'video/webm';
    if (onProgress) onProgress(1);
    return { blob: new Blob([target.buffer], { type: mime }), ext: format, mime };
  } catch (e) {
    closeAll();
    throw e;
  }
}

/* ---------- path 2: MediaRecorder (real time, used only when WebCodecs is missing or fails) ---------- */

function pickMime(format) {
  const lists = {
    mp4: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'],
    webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
  };
  const ok = (m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  };
  const first = (lists[format] || []).find(ok);
  if (first) return { mime: first, ext: format };
  const w = lists.webm.find(ok);
  return w ? { mime: w, ext: 'webm', fellBack: format === 'mp4' } : null;
}

async function exportRecorder(p, { format, q, onProgress, signal }) {
  const dur = duration(p);
  if (!window.MediaRecorder) throw new Error('เครื่องนี้อัดวิดีโอไม่ได้');
  const pick = pickMime(format);
  if (!pick) throw new Error('เครื่องนี้ไม่รองรับการบันทึกวิดีโอ');
  const canvas = document.createElement('canvas');
  canvas.width = q.w;
  canvas.height = q.h;
  const ctx = canvas.getContext('2d');

  let wake = null;
  try {
    wake = await navigator.wakeLock.request('screen');
  } catch {
    /* optional */
  }
  await primeVideo(p, 0);
  if (signal && signal.aborted) {
    if (wake) wake.release().catch(() => {});
    throw cancelled();
  }

  return new Promise((resolve, reject) => {
    let finished = false;
    let rec = null;
    const parts = [];
    const transport = createTransport(p, {
      exportMode: true,
      onFrame: (t, now) => {
        renderFrame(ctx, q.w, q.h, p, t, { now });
        if (onProgress) onProgress(Math.min(1, t / dur));
      },
      onEnd: () => {
        setTimeout(() => {
          if (!finished && rec && rec.state !== 'inactive') rec.stop();
        }, 400);
      },
    });
    const cleanup = () => {
      finished = true;
      transport.dispose();
      if (wake) wake.release().catch(() => {});
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (finished) return;
      cleanup();
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        rec.stop();
      }
      reject(cancelled());
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort);
    }
    try {
      const stream = canvas.captureStream(30);
      const audio = transport.audioStream;
      if (audio) audio.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      rec = new MediaRecorder(stream, { mimeType: pick.mime, videoBitsPerSecond: q.bps, audioBitsPerSecond: 160000 });
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) parts.push(e.data);
      };
      rec.onerror = () => {
        cleanup();
        reject(new Error('การบันทึกวิดีโอขัดข้อง ลองลดความละเอียด'));
      };
      rec.onstop = async () => {
        cleanup();
        if (!parts.length) return reject(new Error('บันทึกไม่ได้ ลองลดความละเอียด'));
        const type = pick.mime.split(';')[0];
        let blob = new Blob(parts, { type });
        if (type === 'video/webm') {
          // MediaRecorder leaves the length out of WebM files, which makes players show 0:00. Put it back.
          try {
            const fixed = patchWebmDuration(new Uint8Array(await blob.arrayBuffer()), dur * 1000);
            blob = new Blob([fixed], { type });
          } catch {
            /* keep the original */
          }
        }
        resolve({ blob, ext: pick.ext, mime: type, fellBack: pick.fellBack });
      };
      syncVideo(p, 0, false);
      rec.start(500);
      transport.seek(0);
      transport.play().catch((e) => {
        cleanup();
        reject(e);
      });
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

/* ---------- entry point ---------- */

// Returns { blob, ext, mime, fellBack }.
export async function exportProject(p, { format, quality, onProgress, onStatus, signal }) {
  const dur = duration(p);
  if (!(dur > 0)) throw new Error('ไม่มีเนื้อหาให้ส่งออก');

  if (format === 'mp3') {
    const blob = await renderMp3(p, dur, (x) => onProgress && onProgress(x));
    return { blob, ext: 'mp3', mime: 'audio/mpeg' };
  }

  const q = QUALITIES.find((x) => x.id === quality) || QUALITIES[2];
  let wake = null;
  try {
    wake = await navigator.wakeLock.request('screen');
  } catch {
    /* optional */
  }
  try {
    const hasWC = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof AudioData !== 'undefined';
    if (hasWC) {
      try {
        return await exportWebCodecs(p, { format, q, onProgress, onStatus, signal });
      } catch (e) {
        if (e && e.message === 'cancelled') throw e;
        if (onStatus) onStatus('วิธีเร็วใช้ไม่ได้บนเครื่องนี้ กำลังใช้วิธีบันทึกแบบเรียลไทม์...');
        if (onProgress) onProgress(0);
      }
    }
    return await exportRecorder(p, { format, q, onProgress, signal });
  } finally {
    if (wake) wake.release().catch(() => {});
  }
}
