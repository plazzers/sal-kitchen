"""Shared code for build_packs.py and verify_pack.py.

Pack file format (everything binary is base64):

    {
      "id": "copycat", "version": 3, "title": "...", "recipeCount": 33,
      "cipher": "AES-GCM", "kdf": "PBKDF2-SHA256", "iterations": 250000,
      "keySlots": [ { "salt": 16 bytes, "iv": 12 bytes, "wrappedKey": 32-byte key + 16-byte tag }, ... ],
      "iv": 12 bytes,
      "ciphertext": AES-GCM(content key, iv, UTF-8 JSON of the pack) + 16-byte tag
    }

One random 256-bit content key encrypts the pack. Each access code gets a key slot:
the content key encrypted with AES-GCM under PBKDF2-SHA256(normalize_code(code), salt).
js/packcrypto.js does exactly the same in the browser with WebCrypto.
"""

import base64
import hashlib
import json
import os
import re

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

CIPHER = "AES-GCM"
KDF = "PBKDF2-SHA256"
ITERATIONS = 250000
KEY_BYTES = 32
SALT_BYTES = 16
IV_BYTES = 12

PACK_ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")

DEFAULT_TITLES = {
    "copycat": "Sal's Kitchen",
    "italian": "Sal's Italian Kitchen",
}


class PackError(Exception):
    """A problem the person running the tool can fix (bad input file, no codes…)."""


def b64(data):
    return base64.b64encode(data).decode("ascii")


def unb64(text):
    return base64.b64decode(text.encode("ascii"), validate=True)


def normalize_code(code):
    """Same as SalHash.normalizeCode in js/sha256.js: no outer spaces, upper case."""
    return str(code or "").strip().upper()


def code_hash(code):
    """The SHA-256 line config.js expects for the quick pre-check."""
    return hashlib.sha256(normalize_code(code).encode("utf-8")).hexdigest()


def derive_kek(code, salt, iterations):
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=KEY_BYTES, salt=salt, iterations=iterations)
    return kdf.derive(normalize_code(code).encode("utf-8"))


def make_slot(code, content_key, iterations):
    salt = os.urandom(SALT_BYTES)
    iv = os.urandom(IV_BYTES)
    wrapped = AESGCM(derive_kek(code, salt, iterations)).encrypt(iv, content_key, None)
    return {"salt": b64(salt), "iv": b64(iv), "wrappedKey": b64(wrapped)}


def unwrap_with_code(pack, code):
    """The content key if `code` opens one of the pack's key slots, else None."""
    iterations = int(pack["iterations"])
    for slot in pack.get("keySlots", []):
        kek = derive_kek(code, unb64(slot["salt"]), iterations)
        try:
            return AESGCM(kek).decrypt(unb64(slot["iv"]), unb64(slot["wrappedKey"]), None)
        except InvalidTag:
            continue
    return None


def decrypt_pack(pack, content_key):
    plain = AESGCM(content_key).decrypt(unb64(pack["iv"]), unb64(pack["ciphertext"]), None)
    return json.loads(plain.decode("utf-8"))


def check_pack_file(pack):
    """Basic shape check for an encrypted pack file."""
    for field in ("id", "version", "title", "recipeCount", "cipher", "kdf", "iterations", "keySlots", "iv", "ciphertext"):
        if field not in pack:
            raise PackError(f"The pack file is missing '{field}'.")
    if pack["cipher"] != CIPHER or pack["kdf"] != KDF:
        raise PackError("The pack file uses a cipher this tool doesn't know.")


def read_codes(path):
    """One code per line. Blank lines and lines starting with # are ignored."""
    codes = []
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            codes.append(normalize_code(line))
    return codes


def load_plain_pack(path, pack_id):
    """Read the plaintext recipes.

    Accepts either a pack JSON file ({id?, title?, chapters, recipes}) or the old
    data/recipes.js file from the app (export const CHAPTERS = [...]; export const RECIPES = [...];).
    """
    with open(path, encoding="utf-8-sig") as f:
        text = f.read()
    if path.endswith(".js"):
        doc = {"chapters": _js_array(text, "CHAPTERS"), "recipes": _js_array(text, "RECIPES")}
    else:
        try:
            doc = json.loads(text)
        except json.JSONDecodeError as e:
            raise PackError(f"{path} is not valid JSON (line {e.lineno}): {e.msg}")
    if not isinstance(doc, dict):
        raise PackError(f"{path} should hold one JSON object with 'chapters' and 'recipes'.")
    if doc.get("id") not in (None, pack_id):
        raise PackError(f"{path} says it is the '{doc.get('id')}' pack, not '{pack_id}'.")
    doc["id"] = pack_id
    doc["title"] = doc.get("title") or DEFAULT_TITLES.get(pack_id, pack_id)
    validate_plain_pack(doc)
    return {
        "id": doc["id"],
        "title": doc["title"],
        "chapters": doc["chapters"],
        "recipes": doc["recipes"],
    }


def _js_array(text, name):
    m = re.search(r"export\s+const\s+" + name + r"\s*=\s*", text)
    if not m:
        raise PackError(f"Couldn't find 'export const {name} = [' in the .js file.")
    try:
        value, _ = json.JSONDecoder().raw_decode(text, m.end())
    except json.JSONDecodeError as e:
        raise PackError(f"The {name} list in the .js file isn't plain JSON (line {e.lineno}): {e.msg}")
    return value


def _is_str_list(x):
    return isinstance(x, list) and all(isinstance(s, str) and s.strip() for s in x)


def validate_plain_pack(doc):
    chapters = doc.get("chapters")
    recipes = doc.get("recipes")
    if not isinstance(chapters, list) or not chapters:
        raise PackError("The pack needs a non-empty 'chapters' list.")
    if not isinstance(recipes, list) or not recipes:
        raise PackError("The pack needs a non-empty 'recipes' list.")
    ch_nums = set()
    for i, ch in enumerate(chapters):
        if not isinstance(ch, dict) or not isinstance(ch.get("num"), int) or not isinstance(ch.get("title"), str) or not ch["title"].strip():
            raise PackError(f"Chapter #{i + 1} needs a whole-number 'num' and a 'title'.")
        if "intro" in ch and not isinstance(ch["intro"], str):
            raise PackError(f"Chapter {ch['num']}: 'intro' must be text.")
        if ch["num"] in ch_nums:
            raise PackError(f"Chapter number {ch['num']} is used twice.")
        ch_nums.add(ch["num"])
    nums = set()
    for i, r in enumerate(recipes):
        where = f"Recipe #{i + 1}"
        if not isinstance(r, dict) or not isinstance(r.get("num"), int) or r["num"] < 1:
            raise PackError(f"{where} needs a whole-number 'num' (1 or more).")
        where = f"Recipe {r['num']}"
        if r["num"] in nums:
            raise PackError(f"Recipe number {r['num']} is used twice. Numbers must be unique.")
        nums.add(r["num"])
        if r.get("chapter") not in ch_nums:
            raise PackError(f"{where}: chapter {r.get('chapter')!r} isn't in the chapters list.")
        for field in ("title", "subtitle", "serves", "time", "cost", "tip"):
            if not isinstance(r.get(field), str) or not r[field].strip():
                raise PackError(f"{where}: '{field}' must be some text.")
        for field in ("ingredients", "steps"):
            if not _is_str_list(r.get(field)) or not r[field]:
                raise PackError(f"{where}: '{field}' must be a list of lines.")


def build_pack(plain, codes, content_key=None, version=1, iterations=ITERATIONS):
    """Encrypt a plaintext pack for a list of (normalized, unique) codes."""
    if not codes:
        raise PackError("No access codes given. Every pack needs at least one code.")
    if content_key is None:
        content_key = os.urandom(KEY_BYTES)
    if len(content_key) != KEY_BYTES:
        raise PackError("The content key must be 32 bytes.")
    body = json.dumps(plain, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    iv = os.urandom(IV_BYTES)
    slots = [make_slot(code, content_key, iterations) for code in codes]
    # Slot order says nothing about which code is which.
    slots.sort(key=lambda s: s["salt"])
    return {
        "id": plain["id"],
        "version": int(version),
        "title": plain["title"],
        "recipeCount": len(plain["recipes"]),
        "cipher": CIPHER,
        "kdf": KDF,
        "iterations": int(iterations),
        "keySlots": slots,
        "iv": b64(iv),
        "ciphertext": b64(AESGCM(content_key).encrypt(iv, body, None)),
    }
