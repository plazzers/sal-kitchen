#!/usr/bin/env python3
"""Rebuild the TEST packs in tests/fixtures/ (never the real ones in packs/).

    git show 6fddb65:data/recipes.js > /tmp/copycat-recipes.js
    python3 tests/make_fixtures.py --copycat /tmp/copycat-recipes.js
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FIX = os.path.join(HERE, "fixtures")
sys.path.insert(0, os.path.join(REPO, "tools"))
import packlib  # noqa: E402

CODES = {
    "copycat": ["SAL-TEST-AAAA-1111", "SAL-TEST-AAAA-2222"],
    "italian": ["SAL-TEST-ITAL-3333"],
    "bundle": ["SAL-TEST-BOTH-4444"],
    "hash_only": ["SAL-TEST-HASH-9999"],
}

# Fake "typical restaurant price, estimate" for the fake Italian recipes (test mode only).
ITALIAN_TEST_PRICES = {1: 9, 2: 15, 3: 15, 4: 17, 5: 19, 6: 22, 7: 14, 8: 5, 9: 2, 10: 8}
ITALIAN_TEST_COSTS = {9: 0.4}  # "about $3 for the whole pot", about 8 servings
ITALIAN_TEST_SERVINGS = {9: 8}


def build(pack, input_path, code_lists, tmp):
    paths = []
    for name in code_lists:
        p = os.path.join(tmp, f"{name}-codes.txt")
        with open(p, "w") as f:
            f.write("\n".join(CODES[name]) + "\n")
        paths.append(p)
    args = [sys.executable, os.path.join(REPO, "tools", "build_packs.py"), "--pack", pack, "--input", input_path,
            "--codes", paths[0], "--out", os.path.join(FIX, f"{pack}.pack.json"), "--new-key", "--allow-tracked-input"]
    for p in paths[1:]:
        args += ["--codes-extra", p]
    subprocess.run(args, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--copycat", required=True, help="the old data/recipes.js (from git history)")
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        build("copycat", a.copycat, ["copycat", "bundle"], tmp)
        build("italian", os.path.join(FIX, "italian-fake.json"), ["italian", "bundle"], tmp)
    all_codes = [c for v in CODES.values() for c in v]
    cfg = {
        "note": "TEST MODE ONLY (localhost + ?packs=test). Never used by the real app.",
        "accessCodeHashes": [packlib.code_hash(c) for c in all_codes],
        "restaurantPrices": {f"italian:{n}": p for n, p in ITALIAN_TEST_PRICES.items()},
        "costPerServing": {f"italian:{n}": p for n, p in ITALIAN_TEST_COSTS.items()},
        "servings": {f"italian:{n}": p for n, p in ITALIAN_TEST_SERVINGS.items()},
    }
    with open(os.path.join(FIX, "test-config.json"), "w") as f:
        json.dump(cfg, f, indent=1)
        f.write("\n")
    print("Fixtures written to tests/fixtures/.")


if __name__ == "__main__":
    main()
