import { retimeWords } from '../core/captions.js';

// Model ids are tried in order. The "timestamped" builds give word level times; the plain
// ones only give phrases, which retimeWords() then splits into words.
export const MODELS = {
  tiny: ['onnx-community/whisper-tiny_timestamped', 'Xenova/whisper-tiny'],
  base: ['onnx-community/whisper-base_timestamped', 'Xenova/whisper-base'],
  small: ['onnx-community/whisper-small_timestamped', 'Xenova/whisper-small'],
};

export const LANGS = [
  ['auto', 'ตรวจจับอัตโนมัติ'],
  ['thai', 'ไทย'],
  ['english', 'English'],
  ['chinese', '中文'],
  ['japanese', '日本語'],
  ['korean', '한국어'],
  ['vietnamese', 'Tiếng Việt'],
  ['indonesian', 'Bahasa Indonesia'],
  ['spanish', 'Español'],
  ['french', 'Français'],
  ['german', 'Deutsch'],
  ['russian', 'Русский'],
];

let cache = { key: '', pipe: null };

async function loadPipe(modelKey, onStatus) {
  const key = modelKey;
  if (cache.key === key && cache.pipe) return cache.pipe;
  const tf = await import('@huggingface/transformers');
  tf.env.allowLocalModels = false;
  tf.env.useBrowserCache = true;
  try {
    tf.env.backends.onnx.wasm.numThreads = 1;
  } catch {
    /* ignore */
  }
  let lastErr = null;
  for (const id of MODELS[modelKey] || MODELS.base) {
    for (const dtype of ['q8', undefined]) {
      try {
        onStatus('กำลังโหลดโมเดลถอดเสียง (ครั้งแรกใช้เวลานาน)...');
        const opts = {
          device: 'wasm',
          progress_callback: (pr) => {
            if (pr && pr.status === 'progress' && typeof pr.progress === 'number') {
              onStatus(`กำลังดาวน์โหลดโมเดล ${Math.round(pr.progress)}%`);
            }
          },
        };
        if (dtype) opts.dtype = dtype;
        const pipe = await tf.pipeline('automatic-speech-recognition', id, opts);
        cache = { key, pipe };
        return pipe;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error('โหลดโมเดลไม่สำเร็จ');
}

// audio: Float32Array, mono, 16 kHz. Returns [{ t, s, e }].
export async function transcribe(audio, { lang = 'auto', model = 'base', onStatus = () => {} } = {}) {
  const pipe = await loadPipe(model, onStatus);
  onStatus('กำลังถอดเสียงเป็นข้อความ...');
  const base = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
  if (lang && lang !== 'auto') base.language = lang;
  let out;
  try {
    out = await pipe(audio, { ...base, return_timestamps: 'word' });
  } catch {
    out = await pipe(audio, { ...base, return_timestamps: true });
  }
  const chunks = Array.isArray(out) ? out.flatMap((o) => o.chunks || []) : out.chunks || [];
  if (!chunks.length && out && out.text) {
    return retimeWords([{ text: out.text, timestamp: [0, audio.length / 16000] }]);
  }
  return retimeWords(chunks);
}

export async function clearModelCache() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => /transformers/i.test(k)).map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }
  cache = { key: '', pipe: null };
}
