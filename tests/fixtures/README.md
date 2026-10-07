# Test fixtures (TEST DATA ONLY)

Everything here is for the self-test pages and the automated tests. The app only
reads these files when it runs on `localhost` with `?packs=test` in the address.

| File | What it is |
|---|---|
| `copycat.pack.json` | The 33 copycat recipes, encrypted with the **test** codes below |
| `italian.pack.json` | A **fake** Italian pack (10 placeholder recipes), encrypted with the test codes below |
| `italian-fake.json` | The fake Italian recipes in plain text (not from the book) |
| `test-config.json` | Test code hashes and fake restaurant prices, used in test mode only |
| `v2-database.json` | What the v2 app saved in IndexedDB, for the migration tests |

Test codes (they open the fixture packs only, never the real `packs/`):

| Code | Opens |
|---|---|
| `SAL-TEST-AAAA-1111` | copycat |
| `SAL-TEST-AAAA-2222` | copycat |
| `SAL-TEST-ITAL-3333` | italian |
| `SAL-TEST-BOTH-4444` | copycat and italian (bundle code) |
| `SAL-TEST-HASH-9999` | nothing — its hash passes the quick pre-check, but it has no key slot |

To rebuild the fixtures (needs the copycat recipes from git history):

    git show 6fddb65:data/recipes.js > /tmp/copycat-recipes.js
    python3 tests/make_fixtures.py --copycat /tmp/copycat-recipes.js
