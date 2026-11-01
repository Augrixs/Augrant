// Pure caption helpers (no DOM). A word is { t: text, s: start seconds, e: end seconds }.

export function isThai(s) {
  return /[฀-๿]/.test(s);
}

// Split text into display words. Punctuation is glued to the previous word.
// Returns [{ start, end }] as character indices into `text`.
export function segmentWords(text) {
  const out = [];
  const hasSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
  if (hasSegmenter) {
    const seg = new Intl.Segmenter(isThai(text) ? 'th' : undefined, { granularity: 'word' });
    for (const s of seg.segment(text)) {
      if (s.isWordLike) {
        out.push({ start: s.index, end: s.index + s.segment.length });
      } else if (out.length && s.segment.trim() && !/\s/.test(s.segment)) {
        out[out.length - 1].end = s.index + s.segment.length;
      }
    }
  } else {
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// chunks: [{ text, timestamp: [start, end] }] from Whisper (word pieces or whole segments).
// Spreads each chunk's time evenly over its characters, then cuts the joined text into real words.
export function retimeWords(chunks) {
  let full = '';
  const cs = [];
  const ce = [];
  for (const ch of chunks) {
    const txt = String(ch.text ?? '');
    const ts = ch.timestamp || [0, null];
    const s = Number(ts[0]) || 0;
    const e = ts[1] == null ? s + 0.5 : Number(ts[1]);
    const lead = txt.length - txt.trimStart().length;
    const n = Math.max(1, txt.length - lead);
    for (let i = 0; i < txt.length; i++) {
      if (i < lead) {
        cs.push(s);
        ce.push(s);
      } else {
        const k = i - lead;
        cs.push(s + (e - s) * (k / n));
        ce.push(s + (e - s) * ((k + 1) / n));
      }
    }
    full += txt;
  }
  const words = [];
  for (const w of segmentWords(full)) {
    const t = full.slice(w.start, w.end).trim();
    if (!t) continue;
    words.push({ t, s: cs[w.start], e: ce[w.end - 1] });
  }
  let prevS = 0;
  for (const w of words) {
    if (!(w.s >= prevS)) w.s = prevS;
    if (!(w.e > w.s + 0.05)) w.e = w.s + 0.05;
    prevS = w.s;
  }
  return words;
}

// Greedy single-row layout. measure(text) -> width. Each line holds as many words as fit in maxW.
export function layoutLines(words, measure, maxW, gap) {
  const lines = [];
  let cur = null;
  words.forEach((w, i) => {
    const wd = measure(w.t);
    if (!cur || cur.width + gap + wd > maxW) {
      cur = { idx: [i], width: wd, widths: [wd] };
      lines.push(cur);
    } else {
      cur.idx.push(i);
      cur.width += gap + wd;
      cur.widths.push(wd);
    }
  });
  lines.forEach((l, k) => {
    const first = words[l.idx[0]];
    const last = words[l.idx[l.idx.length - 1]];
    l.start = first.s;
    const next = lines[k + 1];
    l.end = next ? Math.min(words[next.idx[0]].s, last.e + 0.8) : last.e + 0.5;
    if (l.end <= l.start) l.end = l.start + 0.3;
  });
  return lines;
}

// A clip starting at `start` changed length from oldDur to newDur (speed change):
// words inside it are stretched, words after it move by the difference.
export function remapWordsForClip(words, start, oldDur, newDur) {
  const end = start + oldDur;
  const k = newDur / oldDur;
  const shift = newDur - oldDur;
  const map = (x) => (x <= start ? x : x >= end ? x + shift : start + (x - start) * k);
  return words.map((w) => ({ ...w, s: map(w.s), e: map(w.e) }));
}

// A stretch [from, from + dur) was cut out of the voice track: drop its words, pull later words left.
export function rippleWords(words, from, dur) {
  const to = from + dur;
  const out = [];
  for (const w of words) {
    if (w.e <= from) out.push(w);
    else if (w.s >= to) out.push({ ...w, s: w.s - dur, e: w.e - dur });
  }
  return out;
}

// Index of the word being spoken at time t (last word that already started), or -1.
export function currentWordIndex(words, t) {
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].s <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export function lineAt(lines, t) {
  for (const l of lines) {
    if (t >= l.start && t < l.end) return l;
  }
  return null;
}
