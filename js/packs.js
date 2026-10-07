// Recipe packs. The recipes live only in encrypted files, packs/<id>.pack.json.
// An access code opens the key slot(s) it has; the pack's key is then saved on this device
// (IndexedDB, as a key the browser won't let anyone read back where possible), so the app
// opens offline afterwards without the code.
import * as db from './db.js';
import * as pc from './packcrypto.js';
import { ACCESS_CODE_HASHES, STORE_URL, ITALIAN_STORE_URL } from '../config.js';
import { addEstimates } from './money.js';

// Every pack the app knows about, in the order they're shown.
export const CATALOG = [
  {
    id: 'copycat',
    label: 'Copycat',
    title: "Sal's Kitchen",
    expected: 33,
    pitch: "Sal's 33 restaurant-style copycat recipes.",
    codeHint: 'Unlock with the code from your Sal’s Kitchen purchase.',
    storeUrl: STORE_URL,
  },
  {
    id: 'italian',
    label: 'Italian Kitchen',
    title: "Sal's Italian Kitchen",
    expected: 60,
    pitch: '60 real Italian recipes.',
    codeHint: 'Unlock with the code from your Italian Kitchen purchase.',
    storeUrl: ITALIAN_STORE_URL,
  },
];
export const catalogEntry = (id) => CATALOG.find((p) => p.id === id);

// Test mode: only on this computer (localhost), only with ?packs=test in the address.
// Then the app reads the TEST packs in tests/fixtures/ instead of packs/.
export function isTestMode() {
  try {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    return local && new URLSearchParams(location.search).get('packs') === 'test';
  } catch (e) {
    return false;
  }
}
const folder = () => (isTestMode() ? 'tests/fixtures/' : 'packs/');
export const packUrl = (id) => `${folder()}${id}.pack.json`;

// id → { status: 'ok' | 'missing' | 'offline' | 'damaged', file }
const files = new Map();
// id → { file, title, chapters, recipes }   (packs that are open on this device)
const open = new Map();
// Packs whose saved key no longer fits (the pack was rebuilt with a new key).
const staleKeys = new Set();
let extraHashes = [];

export const fileStatus = (id) => (files.get(id) || { status: 'missing' }).status;
export const packFile = (id) => (files.get(id) || {}).file || null;
export const isOpen = (id) => open.has(id);
export const openPacks = () => CATALOG.filter((p) => open.has(p.id)).map((p) => open.get(p.id));
export const hasStaleKey = (id) => staleKeys.has(id);
export const anyFileAvailable = () => CATALOG.some((p) => fileStatus(p.id) === 'ok');
export function recipeCount(id) {
  if (open.has(id)) return open.get(id).recipes.length;
  const f = packFile(id);
  return f && Number(f.recipeCount) > 0 ? Number(f.recipeCount) : catalogEntry(id).expected;
}

async function loadTestConfig() {
  if (!isTestMode()) return;
  try {
    const res = await fetch('tests/fixtures/test-config.json', { cache: 'no-cache' });
    const cfg = await res.json();
    extraHashes = cfg.accessCodeHashes || [];
    addEstimates({ restaurantPrices: cfg.restaurantPrices, costPerServing: cfg.costPerServing, servings: cfg.servings });
  } catch (e) {
    console.warn('Test config not loaded', e);
  }
}

async function fetchPackFile(id, fresh) {
  let res;
  try {
    res = await fetch(packUrl(id), { cache: fresh ? 'reload' : 'no-cache' });
  } catch (e) {
    return { status: 'offline' };
  }
  if (!res.ok) return { status: res.status === 503 ? 'offline' : 'missing' };
  try {
    const file = await res.json();
    return pc.isPackFile(file) && file.id === id ? { status: 'ok', file } : { status: 'damaged' };
  } catch (e) {
    return { status: 'damaged' };
  }
}

function prepare(id, file, data) {
  if (!data || !Array.isArray(data.chapters) || !Array.isArray(data.recipes)) throw new Error('Pack content is damaged.');
  const chapters = data.chapters.map((c) => ({ ...c, pack: id, key: `${id}:${c.num}` }));
  const recipes = data.recipes.map((r) => ({ ...r, pack: id, rid: `${id}:${r.num}` }));
  return { id, file, title: data.title || file.title, chapters, recipes };
}

async function keyFromRecord(rec) {
  if (rec.key && typeof rec.key === 'object' && rec.key.type === 'secret') return rec.key;
  if (rec.raw) return pc.importContentKey(rec.raw instanceof Uint8Array ? rec.raw : new Uint8Array(rec.raw));
  throw new Error('No key');
}

// Save the key for this device: as a non-extractable CryptoKey where the browser can store one,
// otherwise as the raw key bytes.
async function saveKey(id, key, raw, version) {
  const at = new Date().toISOString();
  try {
    await db.putPackKey({ id, key, version, at });
  } catch (e) {
    await db.putPackKey({ id, raw, version, at });
  }
}

// Start-up: fetch the pack files and open every pack this device has a key for.
export async function init({ fresh = false } = {}) {
  if (!pc.hasWebCrypto()) throw new Error('nocrypto');
  await loadTestConfig();
  const [results, keys] = await Promise.all([
    Promise.all(CATALOG.map((p) => fetchPackFile(p.id, fresh))),
    db.listPackKeys(),
  ]);
  CATALOG.forEach((p, i) => files.set(p.id, results[i]));
  open.clear();
  staleKeys.clear();
  for (const rec of keys) {
    const f = files.get(rec.id);
    if (!f || f.status !== 'ok') continue;
    try {
      const key = await keyFromRecord(rec);
      open.set(rec.id, prepare(rec.id, f.file, await pc.decryptPack(f.file, key)));
    } catch (e) {
      staleKeys.add(rec.id);
    }
  }
}

// Is this any valid code? A fast check against the hashes in config.js, before the slow part.
export async function passesPrecheck(code) {
  const hash = await SalHash.sha256Hex(pc.normalizeCode(code));
  return [...ACCESS_CODE_HASHES, ...extraHashes].map((h) => String(h).trim().toLowerCase()).includes(hash);
}

async function rememberCode(code) {
  const list = (await db.getMeta('codes')) || [];
  if (!list.includes(code)) await db.setMeta('codes', [...list, code]);
}

// Try a code on every pack that's available and not open yet (`only` limits it to some packs).
// Returns the ids of the packs it opened. onProgress(text) reports what's happening.
export async function unlockWithCode(rawCode, { only = null, onProgress = null } = {}) {
  const code = pc.normalizeCode(rawCode);
  const opened = [];
  for (const p of CATALOG) {
    if (only && !only.includes(p.id)) continue;
    const f = files.get(p.id);
    if (!f || f.status !== 'ok' || open.has(p.id)) continue;
    if (onProgress) onProgress(p);
    const raw = await pc.unwrapWithCode(f.file, code);
    if (!raw) continue;
    const key = await pc.importContentKey(raw);
    const data = await pc.decryptPack(f.file, key);
    open.set(p.id, prepare(p.id, f.file, data));
    staleKeys.delete(p.id);
    await saveKey(p.id, key, raw, f.file.version);
    opened.push(p.id);
  }
  if (opened.length) await rememberCode(code);
  return opened;
}

// Codes this device already used may open packs that were added or rebuilt since
// (a bundle code and a new pack, or a pack rebuilt with a new key). Each pack version is tried once.
// only: limit to some packs (for example the ones whose saved key stopped fitting).
export async function tryRememberedCodes({ only = null } = {}) {
  const codes = (await db.getMeta('codes')) || [];
  if (!codes.length) return [];
  const tried = (await db.getMeta('codesTried')) || {};
  const opened = [];
  for (const p of CATALOG) {
    if (only && !only.includes(p.id)) continue;
    const f = files.get(p.id);
    if (!f || f.status !== 'ok' || open.has(p.id)) continue;
    const mark = `${f.file.version}:${codes.length}`;
    if (tried[p.id] === mark) continue;
    for (const c of codes) {
      if ((await unlockWithCode(c, { only: [p.id] })).length) {
        opened.push(p.id);
        break;
      }
    }
    tried[p.id] = mark;
  }
  await db.setMeta('codesTried', tried);
  return opened;
}
