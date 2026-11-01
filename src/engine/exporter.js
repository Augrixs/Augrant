import { renderFrame, createTransport, duration, syncVideo, primeVideo } from './player.js';
import { renderMp3 } from './audio.js';

export const QUALITIES = [
  { id: '360', label: '360p', w: 360, h: 640, bps: 1500000 },
  { id: '480', label: '480p', w: 480, h: 854, bps: 2500000 },
  { id: '720', label: '720p (HD)', w: 720, h: 1280, bps: 5000000 },
  { id: '1080', label: '1080p (Full HD)', w: 1080, h: 1920, bps: 8000000 },
  { id: '1440', label: '2K (1440p) ช้า อาจค้าง', w: 1440, h: 2560, bps: 14000000 },
  { id: '2160', label: '4K (2160p) ช้ามาก มักค้างบนมือถือ', w: 2160, h: 3840, bps: 30000000 },
];

export const FORMATS = [
  { id: 'mp4', label: 'MP4 (วิดีโอ)' },
  { id: 'webm', label: 'WebM (วิดีโอ)' },
  { id: 'mp3', label: 'MP3 (เสียงอย่างเดียว)' },
];

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
  // MP4 not available on this phone: fall back to WebM
  const w = lists.webm.find(ok);
  return w ? { mime: w, ext: 'webm', fellBack: format === 'mp4' } : null;
}

// Returns { blob, ext, mime, fellBack }. Video export runs in real time (a 12 s clip takes about 12 s).
export async function exportProject(p, { format, quality, onProgress, signal }) {
  const dur = duration(p);
  if (!(dur > 0)) throw new Error('ไม่มีเนื้อหาให้ส่งออก');

  if (format === 'mp3') {
    const blob = await renderMp3(p, dur, (x) => onProgress && onProgress(x));
    return { blob, ext: 'mp3', mime: 'audio/mpeg' };
  }

  if (!window.MediaRecorder) throw new Error('เครื่องนี้อัดวิดีโอไม่ได้');
  const q = QUALITIES.find((x) => x.id === quality) || QUALITIES[2];
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

  // Make sure the first video frame is ready before recording starts, so the clip never opens on the fallback background.
  await primeVideo(p, 0);
  if (signal && signal.aborted) {
    if (wake) wake.release().catch(() => {});
    throw new Error('cancelled');
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
        // keep recording a moment so the last frame is captured
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
      reject(new Error('cancelled'));
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
      rec.onstop = () => {
        cleanup();
        if (!parts.length) return reject(new Error('บันทึกไม่ได้ ลองลดความละเอียด'));
        const type = pick.mime.split(';')[0];
        resolve({ blob: new Blob(parts, { type }), ext: pick.ext, mime: type, fellBack: pick.fellBack });
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
