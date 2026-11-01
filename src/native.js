import { Capacitor, registerPlugin } from '@capacitor/core';

const Saf = registerPlugin('Saf');
const platform = Capacitor.getPlatform();
export const isIOS = platform === 'ios';
// true only where the app can pick a save folder (the Android app). The iPhone app uses the share sheet instead.
export const isNative = platform === 'android';

const FOLDER_KEY = 'augrant.folder';

// Shows the standard Android permission dialog for videos, audio and images.
export async function requestMedia() {
  if (!isNative) return true;
  try {
    const r = await Saf.requestMedia();
    return !!r.granted;
  } catch {
    return false;
  }
}

export function savedFolder() {
  try {
    return JSON.parse(localStorage.getItem(FOLDER_KEY) || 'null');
  } catch {
    return null;
  }
}

export async function pickFolder() {
  if (!isNative) return null;
  try {
    const r = await Saf.pickFolder();
    const f = { uri: r.uri, name: r.name || r.uri };
    try {
      localStorage.setItem(FOLDER_KEY, JSON.stringify(f));
    } catch {
      /* ignore */
    }
    return f;
  } catch {
    return null;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// Writes the blob into the chosen folder in 1 MB pieces. In a normal browser it downloads the file.
export async function saveBlob(folder, name, mime, blob, onProgress) {
  if (isIOS && navigator.share) {
    // iPhone: the share sheet lets the person pick "Save Video", "Save to Files", etc.
    const file = new File([blob], name, { type: mime });
    try {
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return { where: 'ที่คุณเลือกในหน้าต่างแชร์' };
      }
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('cancelled');
    }
  }
  if (!isNative || !folder) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);
    return { where: 'ดาวน์โหลดของเบราว์เซอร์' };
  }
  const { id } = await Saf.openFile({ tree: folder.uri, name, mime });
  try {
    const chunk = 1024 * 1024;
    for (let off = 0; off < blob.size; off += chunk) {
      const data = await blobToBase64(blob.slice(off, off + chunk));
      await Saf.write({ id, data });
      if (onProgress) onProgress(Math.min(1, (off + chunk) / blob.size));
    }
  } finally {
    await Saf.close({ id });
  }
  return { where: folder.name };
}
