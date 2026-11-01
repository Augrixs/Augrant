import test from 'node:test';
import assert from 'node:assert/strict';
import { fitVideoToAudio, splitAt, removeClip, layout, total, clampVolume, clipAt, setClipSpeed, srcTimeOf, clampSpeed } from '../src/core/timeline.js';
import { patchWebmDuration } from '../src/engine/webmfix.js';
import { retimeWords, segmentWords, layoutLines, currentWordIndex, lineAt, rippleWords, remapWordsForClip } from '../src/core/captions.js';

test('cutting audio drops its words and pulls later words left', () => {
  const w = [
    { t: 'a', s: 0, e: 1 },
    { t: 'b', s: 2, e: 3 },
    { t: 'c', s: 5, e: 6 },
  ];
  const r = rippleWords(w, 1.5, 2);
  assert.deepEqual(r.map((x) => x.t), ['a', 'c']);
  assert.equal(r[1].s, 3);
  assert.equal(r[1].e, 4);
});

test('video longer than audio is trimmed to audio length', () => {
  const c = fitVideoToAudio({ id: 'v', dur: 30 }, 12);
  assert.equal(c.length, 1);
  assert.equal(c[0].dur, 12);
  assert.equal(c[0].start, 0);
});

test('video shorter than audio loops to cover the audio', () => {
  const c = fitVideoToAudio({ id: 'v', dur: 5 }, 12);
  assert.equal(c.length, 3);
  assert.deepEqual(c.map((x) => x.dur), [5, 5, 2]);
  assert.deepEqual(c.map((x) => x.start), [0, 5, 10]);
  assert.ok(Math.abs(total(c) - 12) < 1e-9);
});

test('split and remove keep clips contiguous', () => {
  let c = fitVideoToAudio({ id: 'v', dur: 30 }, 12);
  const s = splitAt(c, 4);
  assert.equal(s.length, 2);
  assert.equal(s[1].start, 4);
  assert.equal(s[1].srcStart, 4);
  assert.equal(splitAt(s, 0.02), null);
  const r = removeClip(s, s[0].id);
  assert.equal(r.length, 1);
  assert.equal(r[0].start, 0);
  assert.equal(r[0].dur, 8);
  assert.equal(clipAt(layout([{ id: 'a', srcStart: 0, dur: 2 }]), 1.5).id, 'a');
});

test('volume is clamped to 1..1000', () => {
  assert.equal(clampVolume(0), 1);
  assert.equal(clampVolume(5000), 1000);
  assert.equal(clampVolume('250'), 250);
  assert.equal(clampVolume('abc'), 100);
});

test('Thai text is cut into words and timed by characters', () => {
  const chunks = [
    { text: 'สวัส', timestamp: [0, 0.4] },
    { text: 'ดีครับ', timestamp: [0.4, 1.0] },
    { text: ' ทุกคน', timestamp: [1.2, 1.8] },
  ];
  const words = retimeWords(chunks);
  assert.ok(words.length >= 2);
  assert.equal(words.map((w) => w.t).join(''), 'สวัสดีครับทุกคน');
  for (let i = 1; i < words.length; i++) assert.ok(words[i].s >= words[i - 1].s);
  assert.ok(words[0].s >= 0 && words[words.length - 1].e <= 1.9);
});

test('English words keep punctuation and timing', () => {
  const words = retimeWords([
    { text: ' Hey', timestamp: [0, 0.3] },
    { text: ' guys,', timestamp: [0.3, 0.8] },
    { text: ' how', timestamp: [0.9, 1.1] },
  ]);
  assert.deepEqual(words.map((w) => w.t), ['Hey', 'guys,', 'how']);
  assert.ok(Math.abs(words[1].s - 0.3) < 0.05);
  assert.deepEqual(segmentWords('a b').length, 2);
});

test('lines fit the width and expose timing', () => {
  const words = ['Hey', 'guys', 'how', 'are', 'you'].map((t, i) => ({ t, s: i * 0.5, e: i * 0.5 + 0.4 }));
  const lines = layoutLines(words, (t) => t.length * 10, 80, 10);
  assert.ok(lines.every((l) => l.width <= 80));
  assert.equal(lines[0].start, 0);
  assert.equal(currentWordIndex(words, 1.1), 2);
  assert.equal(currentWordIndex(words, -1), -1);
  assert.ok(lineAt(lines, 0.1));
});

test('a short leftover freezes on the last frame instead of showing a gap', () => {
  const c = fitVideoToAudio({ id: 'v', dur: 5 }, 10.8);
  assert.deepEqual(c.map((x) => +x.dur.toFixed(3)), [5, 5, 0.8]);
  assert.equal(c[2].hold, true);
  assert.ok(c[2].srcStart > 4.9);
  assert.ok(Math.abs(total(c) - 10.8) < 1e-9);
  assert.equal(c[0].src, 'v');
});

test('changing speed changes the clip length and keeps the same part of the source', () => {
  const c = fitVideoToAudio({ id: 'v', dur: 30 }, 10);
  const r = setClipSpeed(c, c[0].id, 2);
  assert.equal(r.clips[0].dur, 5);
  assert.equal(r.clips[0].speed, 2);
  assert.equal(r.oldDur, 10);
  assert.equal(r.newDur, 5);
  const slow = setClipSpeed(r.clips, r.clips[0].id, 0.5);
  assert.equal(slow.clips[0].dur, 20);
  assert.equal(setClipSpeed(c, 'nope', 2), null);
  assert.equal(clampSpeed(500), 100);
  assert.equal(clampSpeed(0), 0.1);
  assert.equal(clampSpeed('abc'), 1);
});

test('source time follows speed, split keeps it continuous', () => {
  let c = fitVideoToAudio({ id: 'v', dur: 30 }, 10);
  c = setClipSpeed(c, c[0].id, 2).clips; // 5 s on the timeline, 10 s of source
  assert.equal(srcTimeOf(c[0], 2), 4);
  const s = splitAt(c, 2);
  assert.equal(s[1].srcStart, 4);
  assert.equal(s[1].speed, 2);
  assert.equal(srcTimeOf(s[1], 2), 4);
});

test('captions are stretched with a speed change', () => {
  const w = [
    { t: 'a', s: 0, e: 1 },
    { t: 'b', s: 4, e: 5 },
    { t: 'c', s: 12, e: 13 },
  ];
  // the clip 0..10 becomes 5 long
  const r = remapWordsForClip(w, 0, 10, 5);
  assert.equal(r[0].e, 0.5);
  assert.equal(r[1].s, 2);
  assert.equal(r[2].s, 7);
});

function ebml(id, payload, sizeLen = 1) {
  const n = payload.length;
  const size = [];
  if (sizeLen === 1) size.push(0x80 | n);
  else size.push(0x10 | ((n >> 24) & 0x0f), (n >> 16) & 255, (n >> 8) & 255, n & 255);
  return [...id, ...size, ...payload];
}

test('WebM without a length gets a Duration element', () => {
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
  const info = ebml([0x15, 0x49, 0xa9, 0x66], [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
  const cluster = ebml([0x1f, 0x43, 0xb6, 0x75], []);
  const seg = ebml([0x18, 0x53, 0x80, 0x67], [...info, ...cluster], 4);
  const file = new Uint8Array([...header, ...seg]);
  const out = patchWebmDuration(file, 5000);
  assert.equal(out.length, file.length + 11);
  let at = -1;
  for (let i = 0; i < out.length - 2; i++) if (out[i] === 0x44 && out[i + 1] === 0x89 && out[i + 2] === 0x88) at = i;
  assert.ok(at > 0);
  assert.equal(new DataView(out.buffer, out.byteOffset).getFloat64(at + 3, false), 5000);
  // patching twice or patching garbage leaves the bytes alone
  assert.equal(patchWebmDuration(out, 5000), out);
  const junk = new Uint8Array([1, 2, 3, 4]);
  assert.equal(patchWebmDuration(junk, 5000), junk);
});
