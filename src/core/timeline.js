// Pure timeline helpers (no DOM).
// A clip is { id, src, srcStart, dur, speed, hold?, start }
//   src       id of the source file it plays
//   srcStart  where it begins inside the source, in source seconds
//   dur       length on the timeline, in timeline seconds
//   speed     1 = normal. The clip uses dur * speed seconds of its source
//   hold      true = freeze on one frame (used to cover a short gap at the end)
//   start     position on the timeline (set by layout)

let counter = 0;
export function uid(prefix = 'c') {
  counter += 1;
  return prefix + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 100;
export const HOLD_UNDER = 1.5; // a leftover shorter than this freezes on the last frame instead of looping

export function layout(clips) {
  let t = 0;
  return clips.map((c) => {
    const out = { ...c, start: t };
    t += c.dur;
    return out;
  });
}

export function total(clips) {
  return clips.reduce((a, c) => a + c.dur, 0);
}

export function clampSpeed(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
}

// Time inside the source file that a clip shows at timeline time t.
export function srcTimeOf(c, t) {
  if (c.hold) return c.srcStart;
  return c.srcStart + (t - c.start) * (c.speed || 1);
}

// src = { id, dur }. Video 30 s + audio 12 s -> one 12 s clip.
// Video 5 s + audio 12 s -> 5 s, 5 s, then a 2 s loop. A leftover under HOLD_UNDER freezes on the last frame.
export function fitVideoToAudio(src, audioDur) {
  if (!src || !(src.dur > 0) || !(audioDur > 0)) return [];
  const out = [];
  let left = audioDur;
  let first = true;
  while (left > 0.0005) {
    const d = Math.min(src.dur, left);
    const tail = !first && d < src.dur - 1e-6 && d < HOLD_UNDER;
    if (tail) out.push({ id: uid(), src: src.id, srcStart: Math.max(0, src.dur - 0.05), dur: d, speed: 1, hold: true });
    else out.push({ id: uid(), src: src.id, srcStart: 0, dur: d, speed: 1 });
    left -= d;
    first = false;
  }
  return layout(out);
}

export function clipAt(clips, t) {
  for (const c of clips) {
    if (t >= c.start && t < c.start + c.dur) return c;
  }
  return null;
}

// Returns a new clip list, or null when t is too close to an edge to split.
export function splitAt(clips, t, minPiece = 0.1) {
  const i = clips.findIndex((c) => t > c.start + minPiece && t < c.start + c.dur - minPiece);
  if (i < 0) return null;
  const c = clips[i];
  const cut = t - c.start;
  const sp = c.speed || 1;
  const a = { ...c, id: uid(), dur: cut };
  const b = { ...c, id: uid(), dur: c.dur - cut, srcStart: c.hold ? c.srcStart : c.srcStart + cut * sp };
  return layout([...clips.slice(0, i), a, b, ...clips.slice(i + 1)]);
}

export function removeClip(clips, id) {
  return layout(clips.filter((c) => c.id !== id));
}

// Change one clip's speed. The clip keeps the same part of its source, so its timeline length changes.
// Returns { clips, start, oldDur, newDur, speed } or null (no such clip, or a frozen clip).
export function setClipSpeed(clips, id, speed) {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0 || clips[i].hold) return null;
  const c = clips[i];
  const span = c.dur * (c.speed || 1);
  const sp = Math.min(clampSpeed(speed), span / 0.1); // never shorter than 0.1 s
  const newDur = span / sp;
  const next = clips.map((k, j) => (j === i ? { ...k, dur: newDur, speed: sp } : k));
  return { clips: layout(next), start: c.start, oldDur: c.dur, newDur, speed: sp };
}

export function projectDuration(aClips, vClips) {
  return Math.max(total(aClips), total(vClips));
}

export function clampVolume(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(1000, Math.max(1, n));
}
