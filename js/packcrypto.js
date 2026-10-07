// Opening encrypted recipe packs in the browser (WebCrypto). Must match tools/packlib.py exactly:
//   content key  = 32 random bytes; the pack JSON is AES-GCM encrypted with it (12-byte iv, 16-byte tag)
//   key slot     = the content key, AES-GCM encrypted with PBKDF2-SHA256(normalizeCode(code), salt, iterations)
const enc = new TextEncoder();
const dec = new TextDecoder();

export function hasWebCrypto() {
  return !!(globalThis.crypto && globalThis.crypto.subtle);
}

export function fromB64(s) {
  const bin = atob(String(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Same as SalHash.normalizeCode (js/sha256.js) and normalize_code (tools/packlib.py).
export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function isPackFile(p) {
  return !!(p && typeof p.id === 'string' && p.cipher === 'AES-GCM' && p.kdf === 'PBKDF2-SHA256'
    && Number(p.iterations) > 0 && Array.isArray(p.keySlots) && typeof p.iv === 'string' && typeof p.ciphertext === 'string');
}

async function slotKey(codeKey, slot, iterations) {
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(slot.salt), iterations },
    codeKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

// The raw content key (Uint8Array) when `code` opens one of the pack's key slots, else null.
// onProgress(done, total) is called after each slot (the slow part: one PBKDF2 per slot).
export async function unwrapWithCode(pack, code, onProgress) {
  const codeKey = await crypto.subtle.importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, ['deriveKey']);
  const iterations = Number(pack.iterations);
  const slots = pack.keySlots || [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    try {
      const kek = await slotKey(codeKey, s, iterations);
      const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(s.iv) }, kek, fromB64(s.wrappedKey));
      if (onProgress) onProgress(slots.length, slots.length);
      return new Uint8Array(raw);
    } catch (e) {
      // Wrong code for this slot (or a damaged slot): try the next one.
    }
    if (onProgress) onProgress(i + 1, slots.length);
  }
  return null;
}

// A key that can decrypt but can never be read back out of the browser.
export function importContentKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
}

// The pack's recipes ({ id, title, chapters, recipes }). Throws when the key doesn't fit.
export async function decryptPack(pack, key) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(pack.iv) }, key, fromB64(pack.ciphertext));
  return JSON.parse(dec.decode(plain));
}
