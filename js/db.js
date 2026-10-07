// Everything is stored on this device in IndexedDB. Nothing is sent anywhere.
//   meta     — small settings: unlocked, favorites, shopping list, install banner…
//   progress — one record per recipe: ticked ingredients, finished steps, last scale
const DB_NAME = 'sals-kitchen';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'num' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The app is open in another tab. Please close other tabs of this app.'));
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Saving was cancelled. Your device may be out of storage space.'));
  });
}

export const getMeta = (key) => tx('meta', 'readonly', (t) => promisify(t.objectStore('meta').get(key)));
export const setMeta = (key, value) => tx('meta', 'readwrite', (t) => { t.objectStore('meta').put(value, key); });

export const getProgress = (num) => tx('progress', 'readonly', (t) => promisify(t.objectStore('progress').get(num)));
export const putProgress = (p) => tx('progress', 'readwrite', (t) => { t.objectStore('progress').put(p); });
export const listProgress = () => tx('progress', 'readonly', (t) => promisify(t.objectStore('progress').getAll()));

export function emptyShopping() {
  return { groups: [], custom: [] };
}

// ----- Backup & restore -----

export async function exportAll() {
  const [favorites, shopping, progress] = await Promise.all([getMeta('favorites'), getMeta('shopping'), listProgress()]);
  return {
    app: 'sals-kitchen',
    format: 1,
    exportedAt: new Date().toISOString(),
    favorites: favorites || [],
    shopping: shopping || emptyShopping(),
    progress: progress || [],
  };
}

const isNumArray = (a) => Array.isArray(a) && a.every((n) => typeof n === 'number');
const isItem = (i) => i && typeof i.text === 'string';

export function validateBackup(data) {
  if (!data || data.app !== 'sals-kitchen') throw new Error("This file isn't a Sal's Kitchen backup.");
  const bad = new Error('The backup file looks damaged.');
  if (!isNumArray(data.favorites || [])) throw bad;
  const s = data.shopping || emptyShopping();
  if (!Array.isArray(s.groups) || !Array.isArray(s.custom)) throw bad;
  if (!s.custom.every(isItem)) throw bad;
  if (!s.groups.every((g) => g && typeof g.title === 'string' && Array.isArray(g.items) && g.items.every(isItem))) throw bad;
  if (!Array.isArray(data.progress || [])) throw bad;
  for (const p of data.progress || []) {
    if (!p || typeof p.num !== 'number' || !isNumArray(p.ticks || []) || !isNumArray(p.done || [])) throw bad;
  }
  return data;
}

// Restore replaces favorites, the shopping list and all ticks on this device.
export async function importAll(data) {
  validateBackup(data);
  await tx(['meta', 'progress'], 'readwrite', (t) => {
    t.objectStore('meta').put(data.favorites || [], 'favorites');
    t.objectStore('meta').put(data.shopping || emptyShopping(), 'shopping');
    const store = t.objectStore('progress');
    store.clear();
    (data.progress || []).forEach((p) => store.put({ num: p.num, ticks: p.ticks || [], done: p.done || [], factor: typeof p.factor === 'number' ? p.factor : 1 }));
  });
}
