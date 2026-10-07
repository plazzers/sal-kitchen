#!/usr/bin/env python3
"""Build an encrypted recipe pack for Sal's Kitchen.

    python3 tools/build_packs.py --pack copycat \\
        --input /path/outside/repo/copycat.json \\
        --codes /path/outside/repo/copycat-codes.txt \\
        [--codes-extra /path/outside/repo/bundle-codes.txt] [--print-hashes]

Writes packs/<pack>.pack.json. Only the encrypted file goes into the repository.
The recipes and the codes stay where they are (outside the repository, or in the
git-ignored secrets/ folder). This tool never prints a code or a recipe.

Rebuilding keeps the pack's content key when one of the given codes opens the
current packs/<pack>.pack.json, so people who already unlocked the app on their
phone stay unlocked. --new-key makes a fresh key (everyone types their code once more).

Needs: pip install cryptography
"""

import argparse
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import packlib  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def is_committable(path):
    """True when `path` is inside this repository and git would pick it up."""
    path = os.path.abspath(path)
    if os.path.commonpath([path, REPO]) != REPO:
        return False
    try:
        r = subprocess.run(["git", "-C", REPO, "check-ignore", "-q", path], capture_output=True)
    except OSError:
        return True  # no git: be careful
    return r.returncode != 0  # 0 = ignored


def config_hashes():
    """The hashes listed in config.js (None if it can't be read)."""
    try:
        with open(os.path.join(REPO, "config.js"), encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return None
    return set(h.lower() for h in re.findall(r'^\s*"([0-9a-fA-F]{64})"', text, re.M))


def main(argv=None):
    p = argparse.ArgumentParser(description="Encrypt a recipe pack with its access codes.")
    p.add_argument("--pack", required=True, help="pack id, e.g. copycat or italian")
    p.add_argument("--input", required=True, help="plaintext recipes (.json, or the old data/recipes.js)")
    p.add_argument("--codes", required=True, help="text file, one access code per line")
    p.add_argument("--codes-extra", action="append", default=[], metavar="FILE",
                   help="more codes, e.g. bundle codes that open several packs (can repeat)")
    p.add_argument("--out", help="output file (default: packs/<pack>.pack.json)")
    p.add_argument("--print-hashes", action="store_true", help="print the SHA-256 lines for config.js")
    p.add_argument("--new-key", action="store_true",
                   help="make a fresh content key (everyone who unlocked before has to type their code again)")
    p.add_argument("--allow-tracked-input", action="store_true", help=argparse.SUPPRESS)  # test fixtures only
    args = p.parse_args(argv)

    try:
        if not packlib.PACK_ID_RE.match(args.pack):
            raise packlib.PackError("The pack id should be short, lower case, like 'copycat' or 'italian'.")
        out = args.out or os.path.join(REPO, "packs", f"{args.pack}.pack.json")

        if not args.allow_tracked_input:
            for f in [args.input, args.codes, *args.codes_extra]:
                if is_committable(f):
                    raise packlib.PackError(
                        f"{f} is inside the repository and not git-ignored, so it could get committed. "
                        "Keep recipes and codes outside the repository (or in the secrets/ folder).")

        plain = packlib.load_plain_pack(args.input, args.pack)

        codes, seen = [], set()
        for f in [args.codes, *args.codes_extra]:
            for c in packlib.read_codes(f):
                if c not in seen:
                    seen.add(c)
                    codes.append(c)
        if not codes:
            raise packlib.PackError("The codes files are empty. Add at least one code (one per line).")

        content_key, version, reused = None, 1, False
        if os.path.exists(out):
            with open(out, encoding="utf-8") as f:
                old = json.load(f)
            packlib.check_pack_file(old)
            version = int(old.get("version", 0)) + 1
            if not args.new_key:
                for c in codes:
                    content_key = packlib.unwrap_with_code(old, c)
                    if content_key:
                        reused = True
                        break
                if not content_key:
                    raise packlib.PackError(
                        f"None of these codes opens the current {out}. Building would give the pack a new key, "
                        "and everyone who already unlocked the app would have to type their code again. "
                        "Check the codes file, or add --new-key if that's really what you want.")

        pack = packlib.build_pack(plain, codes, content_key=content_key, version=version)
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        tmp = out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(pack, f, indent=1)
            f.write("\n")
        os.replace(tmp, out)

        print(f"Built {os.path.relpath(out)}: pack '{pack['id']}' ({pack['title']}), "
              f"{pack['recipeCount']} recipes in {len(plain['chapters'])} chapters, "
              f"{len(pack['keySlots'])} access codes, version {pack['version']}, "
              f"{'same key as before (nobody has to re-enter a code)' if reused else 'new key'}.")

        if args.print_hashes:
            print()
            print("Lines for ACCESS_CODE_HASHES in config.js (paste the ones that aren't there yet):")
            for i, c in enumerate(codes, 1):
                print(f'  "{packlib.code_hash(c)}", // {args.pack} code #{i}')

        # The app first checks a code against config.js. A code missing there is refused
        # before it ever reaches the pack, so say so loudly.
        known = config_hashes()
        if known is not None:
            missing = [(i, c) for i, c in enumerate(codes, 1) if packlib.code_hash(c) not in known]
            if missing:
                print()
                print(f"WARNING: {len(missing)} of these codes are not in config.js yet, so the app would refuse them.")
                print(f"Codes missing there: #{', #'.join(str(i) for i, _ in missing)}.")
                if not args.print_hashes:
                    print("Paste these lines into ACCESS_CODE_HASHES in config.js and commit it together with the pack:")
                    for i, c in missing:
                        print(f'  "{packlib.code_hash(c)}", // {args.pack} code #{i}')
                else:
                    print("Paste their lines (printed above) into ACCESS_CODE_HASHES in config.js and commit it together with the pack.")
        return 0
    except (packlib.PackError, OSError, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
