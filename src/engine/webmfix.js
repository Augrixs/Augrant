// MediaRecorder writes WebM files without a Duration, so players show 0:00.
// This adds the missing Duration element to the Info block. If the file does not look the way we
// expect, the original bytes come back unchanged.

function readId(b, p) {
  const f = b[p];
  if (!f) return null;
  let len = 1;
  let m = 0x80;
  while (len <= 4 && !(f & m)) {
    len++;
    m >>= 1;
  }
  if (len > 4) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
  return { id, len };
}

function readSize(b, p) {
  const f = b[p];
  if (f === undefined) return null;
  let len = 1;
  let m = 0x80;
  while (len <= 8 && !(f & m)) {
    len++;
    m >>= 1;
  }
  if (len > 8) return null;
  let v = f & (m - 1);
  let ones = (f & (m - 1)) === m - 1;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[p + i];
    if (b[p + i] !== 0xff) ones = false;
  }
  return { len, value: v, unknown: ones };
}

function writeSize(value, len) {
  const out = new Uint8Array(len);
  let v = value;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEKHEAD = 0x114d9b74;
const ID_INFO = 0x1549a966;
const ID_CLUSTER = 0x1f43b675;
const ID_DURATION = 0x4489;
const ID_TIMECODE_SCALE = 0x2ad7b1;

export function patchWebmDuration(bytes, durationMs) {
  try {
    if (!(durationMs > 0)) return bytes;
    const head = readId(bytes, 0);
    if (!head || head.id !== ID_EBML) return bytes;
    const hs = readSize(bytes, head.len);
    if (!hs) return bytes;
    const segPos = head.len + hs.len + hs.value;
    const seg = readId(bytes, segPos);
    if (!seg || seg.id !== ID_SEGMENT) return bytes;
    const segSizePos = segPos + seg.len;
    const segSize = readSize(bytes, segSizePos);
    if (!segSize) return bytes;
    let q = segSizePos + segSize.len;
    const segEnd = segSize.unknown ? bytes.length : Math.min(bytes.length, q + segSize.value);

    while (q < segEnd) {
      const id = readId(bytes, q);
      if (!id) return bytes;
      const sz = readSize(bytes, q + id.len);
      if (!sz) return bytes;
      const payload = q + id.len + sz.len;
      if (id.id === ID_SEEKHEAD) return bytes; // byte offsets would shift: leave the file alone
      if (id.id === ID_CLUSTER) return bytes; // reached the media without finding an Info block
      if (id.id === ID_INFO) {
        const end = payload + sz.value;
        let scale = 1000000;
        let r = payload;
        while (r < end) {
          const i2 = readId(bytes, r);
          if (!i2) return bytes;
          const s2 = readSize(bytes, r + i2.len);
          if (!s2) return bytes;
          if (i2.id === ID_DURATION) return bytes; // already there
          if (i2.id === ID_TIMECODE_SCALE) {
            let v = 0;
            for (let k = 0; k < s2.value; k++) v = v * 256 + bytes[r + i2.len + s2.len + k];
            if (v > 0) scale = v;
          }
          r += i2.len + s2.len + s2.value;
        }
        const ticks = (durationMs * 1000000) / scale;
        const dur = new Uint8Array(11);
        dur[0] = 0x44;
        dur[1] = 0x89;
        dur[2] = 0x88;
        new DataView(dur.buffer).setFloat64(3, ticks, false);
        const newSize = sz.value + 11;
        if (newSize >= Math.pow(2, 7 * sz.len) - 1) return bytes;
        const out = new Uint8Array(bytes.length + 11);
        out.set(bytes.subarray(0, end), 0);
        out.set(dur, end);
        out.set(bytes.subarray(end), end + 11);
        out.set(writeSize(newSize, sz.len), q + id.len);
        if (!segSize.unknown) {
          const ns = segSize.value + 11;
          if (ns >= Math.pow(2, 7 * segSize.len) - 1) return bytes;
          out.set(writeSize(ns, segSize.len), segSizePos);
        }
        return out;
      }
      if (sz.unknown) return bytes;
      q = payload + sz.value;
    }
    return bytes;
  } catch {
    return bytes;
  }
}
