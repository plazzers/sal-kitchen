#!/usr/bin/env python3
"""Check that an access code opens a recipe pack.

    python3 tools/verify_pack.py --pack packs/italian.pack.json --code SAL-XXXX-XXXX

Prints the number of recipes and their titles. Exit code 1 when the code doesn't open the pack.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import packlib  # noqa: E402


def main(argv=None):
    p = argparse.ArgumentParser(description="Decrypt a pack with one access code and list its recipes.")
    p.add_argument("--pack", required=True, help="the .pack.json file")
    p.add_argument("--code", required=True, help="an access code")
    args = p.parse_args(argv)
    try:
        with open(args.pack, encoding="utf-8") as f:
            pack = json.load(f)
        packlib.check_pack_file(pack)
        key = packlib.unwrap_with_code(pack, args.code)
        if not key:
            print(f"That code does not open {args.pack}.", file=sys.stderr)
            return 1
        doc = packlib.decrypt_pack(pack, key)
        packlib.validate_plain_pack(doc)
        print(f"OK: '{pack['id']}' ({doc['title']}), version {pack['version']}, "
              f"{len(doc['recipes'])} recipes in {len(doc['chapters'])} chapters, {len(pack['keySlots'])} access codes.")
        if len(doc["recipes"]) != pack["recipeCount"]:
            print(f"Warning: the file says {pack['recipeCount']} recipes but holds {len(doc['recipes'])}.")
        chapters = {c["num"]: c["title"] for c in doc["chapters"]}
        for r in doc["recipes"]:
            print(f"  {r['num']:>3}  {r['title']}  [{chapters.get(r['chapter'], '?')}]")
        return 0
    except (packlib.PackError, OSError, ValueError, KeyError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
