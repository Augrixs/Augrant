import test from 'node:test';
import assert from 'node:assert/strict';
import { fitVideoToAudio, splitAt, removeClip, layout, total, clampVolume, clipAt } from '../src/core/timeline.js';
import { retimeWords, segmentWords, layoutLines, currentWordIndex, lineAt, rippleWords } from '../src/core/captions.js';

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
  const c = fitVideoToAudio(30, 12);
  assert.equal(c.length, 1);
  assert.equal(c[0].dur, 12);
  assert.equal(c[0].start, 0);
});

test('video shorter than audio loops to cover the audio', () => {
  const c = fitVideoToAudio(5, 12);
  assert.equal(c.length, 3);
  assert.deepEqual(c.map((x) => x.dur), [5, 5, 2]);
  assert.deepEqual(c.map((x) => x.start), [0, 5, 10]);
  assert.ok(Math.abs(total(c) - 12) < 1e-9);
});

test('split and remove keep clips contiguous', () => {
  let c = fitVideoToAudio(30, 12);
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
