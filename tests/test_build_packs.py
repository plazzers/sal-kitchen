"""Tests for tools/build_packs.py, tools/verify_pack.py and the committed test fixtures.

    python3 -m unittest discover -s tests -v
"""

import contextlib
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(REPO, "tools"))

import build_packs  # noqa: E402
import packlib  # noqa: E402
import verify_pack  # noqa: E402

FIX = os.path.join(HERE, "fixtures")


def plain_pack(n=3, title="Secret Lasagna"):
    return {
        "title": "Test Book",
        "chapters": [{"num": 1, "title": "Mains", "intro": "x"}, {"num": 2, "title": "Dolci"}],
        "recipes": [
            {
                "num": i, "chapter": 1 if i < n else 2, "title": f"{title} {i}", "subtitle": "sub",
                "serves": "4", "time": "1 hr", "cost": "about $2 per plate",
                "ingredients": ["2 cloves garlic", "1 lb pasta"], "steps": ["Cook 10 minutes."], "tip": "Taste it.",
            }
            for i in range(1, n + 1)
        ],
    }


def run(main, argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main(argv)
    return code, out.getvalue(), err.getvalue()


class Workspace(unittest.TestCase):
    """Each test gets a temp folder OUTSIDE the repository, like the owner's secrets folder."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.out = os.path.join(self.dir, "packs", "italian.pack.json")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, content):
        path = os.path.join(self.dir, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content if isinstance(content, str) else json.dumps(content))
        return path

    def build(self, *extra, codes=("SAL-IT-0001", "SAL-IT-0002"), pack="italian", doc=None, out=None):
        inp = self.write("italian.plain.json", doc or plain_pack())
        codes_file = self.write("italian-codes.txt", "# my codes\n\n" + "\n".join(codes) + "\n")
        return run(build_packs.main, ["--pack", pack, "--input", inp, "--codes", codes_file, "--out", out or self.out, *extra])

    def load(self, path=None):
        with open(path or self.out, encoding="utf-8") as f:
            return json.load(f)


class BuildTests(Workspace):
    def test_build_and_open(self):
        code, out, err = self.build()
        self.assertEqual(code, 0, err)
        pack = self.load()
        self.assertEqual(
            {k: pack[k] for k in ("id", "version", "title", "recipeCount", "cipher", "kdf", "iterations")},
            {"id": "italian", "version": 1, "title": "Test Book", "recipeCount": 3,
             "cipher": "AES-GCM", "kdf": "PBKDF2-SHA256", "iterations": 250000})
        self.assertEqual(len(pack["keySlots"]), 2)
        for s in pack["keySlots"]:
            self.assertEqual(sorted(s), ["iv", "salt", "wrappedKey"])
            self.assertEqual(len(packlib.unb64(s["salt"])), 16)
            self.assertEqual(len(packlib.unb64(s["iv"])), 12)
            self.assertEqual(len(packlib.unb64(s["wrappedKey"])), 48)  # 32-byte key + 16-byte tag
        self.assertEqual(len(packlib.unb64(pack["iv"])), 12)
        key = packlib.unwrap_with_code(pack, "SAL-IT-0002")
        doc = packlib.decrypt_pack(pack, key)
        self.assertEqual([r["title"] for r in doc["recipes"]], ["Secret Lasagna 1", "Secret Lasagna 2", "Secret Lasagna 3"])
        self.assertEqual(doc["id"], "italian")

    def test_nothing_secret_in_file_or_output(self):
        code, out, err = self.build("--print-hashes")
        self.assertEqual(code, 0, err)
        with open(self.out, encoding="utf-8") as f:
            raw = f.read()
        for secret in ("Secret Lasagna", "garlic", "SAL-IT-0001", "SAL-IT-0002", "sal-it-0001"):
            self.assertNotIn(secret, raw)
            self.assertNotIn(secret, out + err)
        self.assertIn("3 recipes", out)
        self.assertIn("2 access codes", out)

    def test_print_hashes(self):
        code, out, _ = self.build("--print-hashes")
        self.assertEqual(code, 0)
        want = hashlib.sha256(b"SAL-IT-0001").hexdigest()
        self.assertIn(f'  "{want}", // italian code #1', out)
        self.assertEqual(len(re.findall(r'^  "[0-9a-f]{64}", //', out, re.M)), 2)

    def test_warns_about_codes_missing_from_config(self):
        code, out, _ = self.build()
        self.assertEqual(code, 0)
        self.assertIn("2 of these codes are not in config.js", out)
        self.assertIn(hashlib.sha256(b"SAL-IT-0002").hexdigest(), out)
        self.assertNotIn("SAL-IT-0002", out)

    def test_wrong_code_fails(self):
        self.build()
        pack = self.load()
        self.assertIsNone(packlib.unwrap_with_code(pack, "SAL-IT-9999"))
        self.assertIsNone(packlib.unwrap_with_code(pack, "SAL-IT-000"))

    def test_codes_ignore_case_and_spaces(self):
        self.build(codes=("  sal-it-abcd  ",))
        pack = self.load()
        self.assertIsNotNone(packlib.unwrap_with_code(pack, "SAL-IT-ABCD"))
        self.assertIsNotNone(packlib.unwrap_with_code(pack, " sal-it-abcd"))

    def test_duplicate_codes_get_one_slot(self):
        self.build(codes=("SAL-IT-0001", "sal-it-0001", "SAL-IT-0002"))
        self.assertEqual(len(self.load()["keySlots"]), 2)

    def test_bundle_code_opens_both_packs(self):
        inp = self.write("p.plain.json", plain_pack())
        own_cc = self.write("copycat-codes.txt", "SAL-CC-0001\n")
        own_it = self.write("italian-codes.txt", "SAL-IT-0001\n")
        bundle = self.write("bundle-codes.txt", "SAL-BOTH-0001\n")
        cc_out = os.path.join(self.dir, "copycat.pack.json")
        self.assertEqual(run(build_packs.main, ["--pack", "copycat", "--input", inp, "--codes", own_cc, "--codes-extra", bundle, "--out", cc_out])[0], 0)
        self.assertEqual(run(build_packs.main, ["--pack", "italian", "--input", inp, "--codes", own_it, "--codes-extra", bundle, "--out", self.out])[0], 0)
        cc, it = self.load(cc_out), self.load()
        self.assertIsNotNone(packlib.unwrap_with_code(cc, "SAL-BOTH-0001"))
        self.assertIsNotNone(packlib.unwrap_with_code(it, "SAL-BOTH-0001"))
        self.assertIsNone(packlib.unwrap_with_code(cc, "SAL-IT-0001"))
        self.assertIsNone(packlib.unwrap_with_code(it, "SAL-CC-0001"))
        # Each pack has its own key.
        self.assertNotEqual(packlib.unwrap_with_code(cc, "SAL-BOTH-0001"), packlib.unwrap_with_code(it, "SAL-BOTH-0001"))

    def test_rebuild_keeps_key_so_nobody_reenters_a_code(self):
        self.build(codes=("SAL-IT-0001",))
        first = self.load()
        old_key = packlib.unwrap_with_code(first, "SAL-IT-0001")
        code, out, err = self.build(codes=("SAL-IT-0001", "SAL-IT-NEW1"), doc=plain_pack(4))
        self.assertEqual(code, 0, err)
        self.assertIn("same key as before", out)
        second = self.load()
        self.assertEqual(second["version"], 2)
        self.assertEqual(second["recipeCount"], 4)
        # A phone that saved the old key opens the new file without a code.
        self.assertEqual(len(packlib.decrypt_pack(second, old_key)["recipes"]), 4)
        self.assertEqual(packlib.unwrap_with_code(second, "SAL-IT-NEW1"), old_key)
        self.assertNotEqual(first["iv"], second["iv"])

    def test_removing_a_code(self):
        self.build(codes=("SAL-IT-0001", "SAL-IT-0002"))
        self.build(codes=("SAL-IT-0001",))
        pack = self.load()
        self.assertIsNone(packlib.unwrap_with_code(pack, "SAL-IT-0002"))
        self.assertEqual(len(pack["keySlots"]), 1)

    def test_rebuild_with_unrelated_codes_needs_new_key(self):
        self.build(codes=("SAL-IT-0001",))
        code, _, err = self.build(codes=("SAL-IT-OTHER",))
        self.assertEqual(code, 1)
        self.assertIn("--new-key", err)
        code, out, err = self.build("--new-key", codes=("SAL-IT-OTHER",))
        self.assertEqual(code, 0, err)
        self.assertIn("new key", out)
        self.assertIsNone(packlib.unwrap_with_code(self.load(), "SAL-IT-0001"))

    def test_refuses_plaintext_inside_the_repository(self):
        inside = os.path.join(REPO, "tests", "fixtures", "italian-fake.json")
        codes = self.write("c-codes.txt", "SAL-IT-0001\n")
        code, _, err = run(build_packs.main, ["--pack", "italian", "--input", inside, "--codes", codes, "--out", self.out])
        self.assertEqual(code, 1)
        self.assertIn("inside the repository", err)
        self.assertFalse(os.path.exists(self.out))

    def test_secrets_folder_is_ignored_by_git(self):
        self.assertFalse(build_packs.is_committable(os.path.join(REPO, "secrets", "italian.json")))
        self.assertFalse(build_packs.is_committable(os.path.join(REPO, "italian.plain.json")))
        self.assertFalse(build_packs.is_committable(os.path.join(REPO, "italian-codes.txt")))
        self.assertTrue(build_packs.is_committable(os.path.join(REPO, "italian.json")))

    def test_old_recipes_js_input(self):
        doc = plain_pack(2)
        js = ("// header\nexport const CHAPTERS = " + json.dumps(doc["chapters"], indent=2)
              + ";\n\nexport const RECIPES = " + json.dumps(doc["recipes"], indent=2) + ";\n")
        inp = self.write("copycat-recipes.js", js)
        codes = self.write("c-codes.txt", "SAL-CC-0001\n")
        out = os.path.join(self.dir, "copycat.pack.json")
        code, msg, err = run(build_packs.main, ["--pack", "copycat", "--input", inp, "--codes", codes, "--out", out])
        self.assertEqual(code, 0, err)
        pack = self.load(out)
        self.assertEqual(pack["title"], "Sal's Kitchen")
        self.assertEqual(len(packlib.decrypt_pack(pack, packlib.unwrap_with_code(pack, "SAL-CC-0001"))["recipes"]), 2)

    def test_bad_input_is_explained(self):
        cases = [
            ({**plain_pack(), "recipes": plain_pack()["recipes"] + [plain_pack()["recipes"][0]]}, "used twice"),
            ({**plain_pack(), "recipes": [{**plain_pack()["recipes"][0], "chapter": 9}]}, "isn't in the chapters list"),
            ({**plain_pack(), "recipes": [{**plain_pack()["recipes"][0], "steps": []}]}, "'steps'"),
            ({**plain_pack(), "id": "copycat"}, "not 'italian'"),
        ]
        for doc, msg in cases:
            code, _, err = self.build(doc=doc)
            self.assertEqual(code, 1)
            self.assertIn(msg, err)
        code, _, err = self.build(codes=())
        self.assertEqual(code, 1)
        self.assertIn("empty", err)

    def test_verify_pack(self):
        self.build()
        code, out, _ = run(verify_pack.main, ["--pack", self.out, "--code", "sal-it-0001"])
        self.assertEqual(code, 0)
        self.assertIn("3 recipes", out)
        self.assertIn("Secret Lasagna 2", out)
        code, _, err = run(verify_pack.main, ["--pack", self.out, "--code", "SAL-NOPE"])
        self.assertEqual(code, 1)
        self.assertIn("does not open", err)


class FixtureTests(unittest.TestCase):
    """The committed TEST packs: the browser tests decrypt the same files (tests/packs.html)."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(FIX, "copycat.pack.json")) as f:
            cls.copycat = json.load(f)
        with open(os.path.join(FIX, "italian.pack.json")) as f:
            cls.italian = json.load(f)
        with open(os.path.join(FIX, "test-config.json")) as f:
            cls.cfg = json.load(f)

    def opens(self, pack, code):
        return packlib.unwrap_with_code(pack, code) is not None

    def test_copycat_fixture(self):
        doc = packlib.decrypt_pack(self.copycat, packlib.unwrap_with_code(self.copycat, "SAL-TEST-AAAA-1111"))
        self.assertEqual(len(doc["recipes"]), 33)
        self.assertEqual(len(doc["chapters"]), 6)
        packlib.validate_plain_pack(doc)

    def test_italian_fixture_is_fake(self):
        doc = packlib.decrypt_pack(self.italian, packlib.unwrap_with_code(self.italian, "SAL-TEST-ITAL-3333"))
        self.assertEqual((len(doc["recipes"]), len(doc["chapters"])), (10, 7))
        self.assertTrue(all(r["title"].startswith("Test ") for r in doc["recipes"]))

    def test_codes(self):
        self.assertTrue(self.opens(self.copycat, "SAL-TEST-AAAA-2222"))
        self.assertTrue(self.opens(self.copycat, "SAL-TEST-BOTH-4444"))
        self.assertTrue(self.opens(self.italian, "SAL-TEST-BOTH-4444"))
        self.assertFalse(self.opens(self.italian, "SAL-TEST-AAAA-1111"))
        self.assertFalse(self.opens(self.copycat, "SAL-TEST-ITAL-3333"))
        self.assertFalse(self.opens(self.copycat, "SAL-TEST-HASH-9999"))
        self.assertFalse(self.opens(self.italian, "SAL-TEST-HASH-9999"))
        self.assertIn(packlib.code_hash("SAL-TEST-HASH-9999"), self.cfg["accessCodeHashes"])

    def test_fixture_prices_cover_the_fake_pack(self):
        self.assertEqual(sorted(self.cfg["restaurantPrices"]), sorted(f"italian:{n}" for n in range(1, 11)))


class RepositoryHygiene(unittest.TestCase):
    """What must (not) be committed."""

    def test_no_plaintext_recipes_in_the_app(self):
        self.assertFalse(os.path.exists(os.path.join(REPO, "data", "recipes.js")))
        self.assertFalse(os.path.exists(os.path.join(REPO, "recipes.source.json")))

    def test_packs_folder_has_only_encrypted_packs(self):
        for name in os.listdir(os.path.join(REPO, "packs")):
            self.assertTrue(name == "README.md" or name.endswith(".pack.json"), name)
            if name.endswith(".pack.json"):
                with open(os.path.join(REPO, "packs", name)) as f:
                    packlib.check_pack_file(json.load(f))

    def test_config_has_the_real_hashes_and_no_test_hashes(self):
        with open(os.path.join(REPO, "config.js")) as f:
            config = f.read()
        hashes = re.findall(r'^\s*"([0-9a-f]{64})"', config, re.M)
        self.assertGreaterEqual(len(hashes), 10)
        with open(os.path.join(FIX, "test-config.json")) as f:
            test_hashes = set(json.load(f)["accessCodeHashes"])
        self.assertFalse(test_hashes & set(hashes), "a TEST code hash is in config.js")

    def test_test_codes_never_open_real_packs(self):
        folder = os.path.join(REPO, "packs")
        for name in os.listdir(folder):
            if not name.endswith(".pack.json"):
                continue
            with open(os.path.join(folder, name)) as f:
                pack = json.load(f)
            for code in ("SAL-TEST-AAAA-1111", "SAL-TEST-AAAA-2222", "SAL-TEST-ITAL-3333", "SAL-TEST-BOTH-4444"):
                self.assertIsNone(packlib.unwrap_with_code(pack, code), f"{code} opens {name}")


if __name__ == "__main__":
    unittest.main()
