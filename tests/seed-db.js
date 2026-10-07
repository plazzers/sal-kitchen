// Test helper: create an IndexedDB database exactly as an older app version left it.
//   version 1: stores meta + progress (keyPath "num")
//   version 2: + plans (keyPath "week") + savings (keyPath "id")
// data: the shape of tests/fixtures/v2-database.json
export function deleteDatabase(name) {
  return new Promise((res) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}

export async function seedOldDatabase(name, version, data) {
  await deleteDatabase(name);
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('meta');
      d.createObjectStore('progress', { keyPath: 'num' });
      if (version >= 2) {
        d.createObjectStore('plans', { keyPath: 'week' });
        d.createObjectStore('savings', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const d = req.result;
      const stores = version >= 2 ? ['meta', 'progress', 'plans', 'savings'] : ['meta', 'progress'];
      const t = d.transaction(stores, 'readwrite');
      const v1Meta = ['unlocked', 'favorites', 'shopping', 'installBannerDismissed', 'lastBackup'];
      Object.entries(data.meta).forEach(([k, v]) => { if (version >= 2 || v1Meta.includes(k)) t.objectStore('meta').put(v, k); });
      data.progress.forEach((p) => t.objectStore('progress').put(p));
      if (version >= 2) {
        data.plans.forEach((w) => t.objectStore('plans').put(w));
        data.savings.forEach((x) => t.objectStore('savings').put(x));
      }
      t.oncomplete = () => { d.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
}
