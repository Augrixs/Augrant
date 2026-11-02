// Saved projects live on this phone (IndexedDB): the settings of the edit, plus a copy of the picked audio and video files.
const DB = 'augrant-projects';
const TRASH_DAYS = 7;

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => {
        rq.result.createObjectStore('projects', { keyPath: 'id' });
        rq.result.createObjectStore('files');
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
  }
  return dbp;
}

function run(store, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const out = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const listProjects = () => run('projects', 'readonly', (s) => s.getAll()).then((r) => r || []);
export const getProject = (id) => run('projects', 'readonly', (s) => s.get(id));
export const putProject = (rec) => run('projects', 'readwrite', (s) => s.put(rec));
export const putFile = (key, blob) => run('files', 'readwrite', (s) => s.put(blob, key));
export const getFile = (key) => run('files', 'readonly', (s) => s.get(key));
export const fileKey = (pid, sid) => `${pid}:${sid}`;

export async function patchProject(id, fields) {
  const rec = await getProject(id);
  if (!rec) return null;
  Object.assign(rec, fields);
  await putProject(rec);
  return rec;
}

export const renameProject = (id, name) => patchProject(id, { name: String(name).trim().slice(0, 60) || 'Untitled', updatedAt: Date.now() });
export const trashProject = (id) => patchProject(id, { trashedAt: Date.now() });
export const restoreProject = (id) => patchProject(id, { trashedAt: null });

// Removes the project and every file saved for it. Nothing is kept.
export async function deleteProject(id) {
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction(['projects', 'files'], 'readwrite');
    tx.objectStore('projects').delete(id);
    tx.objectStore('files').delete(IDBKeyRange.bound(id + ':', id + ':￿'));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export const daysLeft = (rec) => Math.max(0, Math.ceil((rec.trashedAt + TRASH_DAYS * 86400000 - Date.now()) / 86400000));

// Anything that has been in the trash for 7 days is deleted for good.
export async function purgeOld() {
  const all = await listProjects();
  const old = all.filter((p) => p.trashedAt && Date.now() - p.trashedAt > TRASH_DAYS * 86400000);
  for (const p of old) await deleteProject(p.id);
  return old.length;
}

export const safeName = (n) => String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 60) || 'Augrant';
