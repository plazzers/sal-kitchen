// Everything is stored on this device in IndexedDB. Nothing is sent anywhere.
//   meta     — small settings: unlocked, favorites, shopping list, install banner…
//   progress — one record per recipe: ticked ingredients, finished steps, last scale
//   plans    — (v2) one record per ISO week: what's planned on each day
//   savings  — (v2) one record per meal marked "We made it"
// Version 2 only ADDS the plans and savings stores. Nothing that was saved before is touched.
let DB_NAME = 'sals-kitchen';
const DB_VERSION = 2;

let dbPromise = null;

// Only for tests/planner.html, so the self-tests never touch real data.
export function useDatabase(name) {
  DB_NAME = name;
  dbPromise = null;
}

export function closeDB() {
  const p = dbPromise;
  dbPromise = null;
  return p ? p.then((db) => db.close(), () => {}) : Promise.resolve();
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'num' });
      if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'week' });
      if (!db.objectStoreNames.contains('savings')) db.createObjectStore('savings', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Let a newer version of the app (in another tab) upgrade the database.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    // An older copy of the app is open in another tab. The upgrade waits until it closes.
    req.onblocked = () => document.dispatchEvent(new CustomEvent('sal-db-blocked'));
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

export const getPlanWeek = (week) => tx('plans', 'readonly', (t) => promisify(t.objectStore('plans').get(week)));
export const putPlanWeek = (rec) => tx('plans', 'readwrite', (t) => { t.objectStore('plans').put(rec); });
export const listPlans = () => tx('plans', 'readonly', (t) => promisify(t.objectStore('plans').getAll()));

export const putSaving = (s) => tx('savings', 'readwrite', (t) => { t.objectStore('savings').put(s); });
export const deleteSaving = (id) => tx('savings', 'readwrite', (t) => { t.objectStore('savings').delete(id); });
export const listSavings = () => tx('savings', 'readonly', (t) => promisify(t.objectStore('savings').getAll()));
export const clearSavings = () => tx('savings', 'readwrite', (t) => { t.objectStore('savings').clear(); });

export function emptyShopping() {
  return { groups: [], custom: [] };
}

// ----- Backup & restore -----

// Format 2 (app v2) adds plans, pantry staples, savings and planner settings.
// Format 1 backups (made before the planner existed) still restore.
export const BACKUP_FORMAT = 2;

export async function exportAll() {
  const [favorites, shopping, progress, plans, savings, pantry, planSettings] = await Promise.all([
    getMeta('favorites'), getMeta('shopping'), listProgress(), listPlans(), listSavings(), getMeta('pantry'), getMeta('planSettings'),
  ]);
  return {
    app: 'sals-kitchen',
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    favorites: favorites || [],
    shopping: shopping || emptyShopping(),
    progress: progress || [],
    plans: plans || [],
    savings: savings || [],
    pantry: pantry || { ids: [], custom: [] },
    planSettings: planSettings || {},
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
  if (typeof data.format === 'number' && data.format > BACKUP_FORMAT) {
    throw new Error('This backup was made by a newer version of the app. Please open the app with internet so it can update, then try again.');
  }
  if (data.format >= 2) {
    if (!Array.isArray(data.plans || []) || !(data.plans || []).every((w) => w && typeof w.week === 'string' && w.days && typeof w.days === 'object')) throw bad;
    if (!Array.isArray(data.savings || []) || !(data.savings || []).every((x) => x && typeof x.id === 'string' && typeof x.saved === 'number')) throw bad;
    const pan = data.pantry || { ids: [], custom: [] };
    if (!Array.isArray(pan.ids || []) || !Array.isArray(pan.custom || [])) throw bad;
  }
  return data;
}

// Restore replaces favorites, the shopping list and all ticks on this device.
// A format 2 backup also replaces the plans, savings, pantry staples and planner settings.
// A format 1 backup leaves those alone (it doesn't have them).
export async function importAll(data) {
  validateBackup(data);
  const v2 = data.format >= 2;
  await tx(v2 ? ['meta', 'progress', 'plans', 'savings'] : ['meta', 'progress'], 'readwrite', (t) => {
    t.objectStore('meta').put(data.favorites || [], 'favorites');
    t.objectStore('meta').put(data.shopping || emptyShopping(), 'shopping');
    const store = t.objectStore('progress');
    store.clear();
    (data.progress || []).forEach((p) => store.put({ num: p.num, ticks: p.ticks || [], done: p.done || [], factor: typeof p.factor === 'number' ? p.factor : 1 }));
    if (!v2) return;
    const pan = data.pantry || {};
    t.objectStore('meta').put({ ids: pan.ids || [], custom: pan.custom || [] }, 'pantry');
    t.objectStore('meta').put(data.planSettings || {}, 'planSettings');
    const plans = t.objectStore('plans');
    plans.clear();
    (data.plans || []).forEach((w) => plans.put(w));
    const savings = t.objectStore('savings');
    savings.clear();
    (data.savings || []).forEach((x) => savings.put(x));
  });
}
