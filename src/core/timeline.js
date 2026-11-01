// Pure timeline helpers (no DOM). A clip is { id, srcStart, dur, start } where
// srcStart is the offset inside the source file and start is the position on the timeline.

let counter = 0;
export function uid(prefix = 'c') {
  counter += 1;
  return prefix + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

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

// Video 30s + audio 12s -> one clip of 12s. Video 5s + audio 12s -> 5s, 5s, 2s (loops).
export function fitVideoToAudio(videoDur, audioDur) {
  if (!(videoDur > 0) || !(audioDur > 0)) return [];
  if (videoDur >= audioDur) return layout([{ id: uid(), srcStart: 0, dur: audioDur }]);
  const out = [];
  let left = audioDur;
  while (left > 0.0005) {
    const d = Math.min(videoDur, left);
    out.push({ id: uid(), srcStart: 0, dur: d });
    left -= d;
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
  const a = { id: uid(), srcStart: c.srcStart, dur: cut };
  const b = { id: uid(), srcStart: c.srcStart + cut, dur: c.dur - cut };
  return layout([...clips.slice(0, i), a, b, ...clips.slice(i + 1)]);
}

export function removeClip(clips, id) {
  return layout(clips.filter((c) => c.id !== id));
}

export function projectDuration(aClips, vClips) {
  return Math.max(total(aClips), total(vClips));
}

export function clampVolume(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 100;
  return Math.min(1000, Math.max(1, n));
}
