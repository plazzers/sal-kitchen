# SPEC v3 — Encrypted recipe packs + "Italian Kitchen" premium pack

Read README.md, the existing code, SPEC_V2_MEAL_PLANNER.md first. This is a live paid app — don't break anything; existing users stay unlocked and keep all data.

## Problem
The repo is public (GitHub Pages free plan), so `data/recipes.js` — the full paid cookbook — is readable by anyone on GitHub. We also want to sell a second pack (60 recipes from "Sal's Italian Kitchen", a $39.99 book) inside the same app.

## Solution: content packs encrypted with the access code
1. **Pack format.** Each recipe pack is a JSON document `{ id, title, chapters:[{num,title,intro?}], recipes:[{num,chapter,title,subtitle,serves,time,cost,ingredients[],steps[],tip}] }` (same shape as today's data). Packs are stored in the repo ONLY as encrypted files: `packs/<id>.pack.json` = `{ id, version, title, recipeCount, cipher: "AES-GCM", kdf: "PBKDF2-SHA256", iterations: 250000, keySlots: [ { salt, iv, wrappedKey } ... ], iv, ciphertext }` (base64). A random 256-bit content key encrypts the pack (AES-GCM); for each valid access code we store a key slot: content key wrapped (AES-GCM) with a key derived from `normalizeCode(code)` via PBKDF2 (per-slot random salt). Unwrap succeeds only with a valid code.
2. **Unlock flow.** On unlock (and on app start for already-unlocked users), try the entered/remembered code against each pack's key slots in the browser (WebCrypto). Store, in IndexedDB, the unwrapped content key for each pack the user unlocked (as a non-extractable CryptoKey where supported, else raw key bytes) so the app works offline afterwards without re-entering the code. Keep the existing SHA-256 hash check in `config.js` only as a fast "is this any valid code" pre-check; the real gate is decryption.
   - **Migration for existing users:** they were unlocked with a code but we never stored the code. On first launch of this version, if the user is "unlocked" but has no pack key, show a one-time friendly screen: "Quick one-time step: enter your access code again to load your recipes (it's in your Payhip PDF)." Keep their favorites/planner/shopping data untouched. Design this carefully and kindly; it's the only friction we add.
3. **Packs:**
   - `copycat` — the existing 33 recipes (current `data/recipes.js`), unlocked by the existing 10 access codes (same codes as today; they are NOT in the repo — see build tool).
   - `italian` — 60 recipes, 7 chapters, unlocked by a new set of codes for Italian Kitchen buyers. A buyer may own one or both packs; a code unlocks whichever packs it has slots in. Add one more pack-agnostic concept: a code can be added to several packs (bundle codes).
4. **UI.**
   - Library switcher at the top of Recipes: "Copycat (33)" / "Italian Kitchen (60)" / "All". Locked packs show a tasteful locked card: "Sal's Italian Kitchen — 60 real Italian recipes. Unlock with the code from your Italian Kitchen purchase" + "Get it" link (https://payhip.com/b/Lv425?utm_source=app&utm_medium=locked-pack&utm_campaign=italian) + "I have a code" (enter code → unlock pack).
   - Everything already built (search, chapters, scaling, favorites, ticks, shopping list, planner incl. surprise-me & money saved, cooking mode, timers, backup) must work across packs. Recipe identity becomes `<packId>:<num>`; migrate existing stored references from plain `num` to `copycat:<num>` (favorites, ticks, planner, shopping, savings) — write and test this migration.
   - Money-saved feature: Italian pack recipes get restaurant price estimates too (add to `data/restaurant-prices.js` keyed by packId:num, conservative, labeled estimates). The restaurant-or-home stuff never names real restaurants.
5. **Remove plaintext.** Delete `data/recipes.js` and `recipes.source.json` from the repo (the app reads the decrypted copycat pack instead). Note in README that older git history still contains the old plaintext (we accept that; do not rewrite history).

## Build tool (owner/assistant runs it locally — plaintext never committed)
`tools/build_packs.py`:
- `python3 tools/build_packs.py --pack copycat --input /path/outside/repo/copycat.json --codes /path/outside/repo/copycat-codes.txt [--codes-extra bundle-codes.txt]` → writes `packs/copycat.pack.json`.
- Same for `--pack italian`.
- Uses `cryptography` (AESGCM, PBKDF2HMAC) with parameters matching the browser exactly; prints a summary (recipe count, slot count) but never prints codes or plaintext.
- `tools/verify_pack.py --pack packs/x.pack.json --code CODE` → decrypts and prints recipe count/titles (for checks).
- Also `tools/make-code-hash.html` stays for the config pre-check list; add `--print-hashes` to build_packs.py to output the SHA-256 lines to paste into config.js.
- Add `*.plain.json`, `*-codes.txt`, `secrets/` to `.gitignore`.

## What you (the Claude Code session) should do
- You will NOT receive the real Italian recipes or the real codes (they must not be committed). Build everything against:
  - the existing copycat data (convert it to a pack using TEST codes you generate, e.g. `SAL-TEST-AAAA-1111`), and
  - a small fake `italian` pack you create (7 chapters, ~10 placeholder recipes) with its own test codes.
- Commit the app code, tools, tests and README. Commit the TEST packs only into `tests/fixtures/` (never into `packs/`), and make the app load `packs/*.pack.json` in production. Leave `packs/` containing a `README.md` only — the assistant will run build_packs.py with the real data and commit the real encrypted packs afterwards. The app must show a clear, friendly "Recipes are updating, please reload in a minute" state if a pack file is missing (never a blank screen).
- Remove any test hash from config.js before committing (keep the 10 real hashes that are there).
- Tests (`tests/packs.html` + Python tests): browser↔Python crypto compatibility (encrypt in Python, decrypt in browser via Playwright), wrong code fails, bundle code unlocks both, migration of old references (num → copycat:num) with a fixture of the current IndexedDB shape, re-entry screen for existing unlocked users, offline after unlock, planner/shopping/cooking across packs.
- Playwright (Chromium preinstalled; don't run `playwright install`) at 390x844 and 1280x800 using the fixtures (serve with a flag/query param that points the loader at `tests/fixtures/` — only in test mode).
- Bump the service worker version; precache `packs/*.pack.json` (handle 404 gracefully). Update README (plain language: how to add codes, how to rebuild packs). Commit to main.
