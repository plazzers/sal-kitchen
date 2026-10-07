# Recipe packs (encrypted)

This folder holds the **encrypted** recipe books the app reads:

- `copycat.pack.json` — Sal's Kitchen (the 33 copycat recipes)
- `italian.pack.json` — Sal's Italian Kitchen (60 recipes)

They are made with `tools/build_packs.py` from plain recipe files and code lists that
**stay outside this repository**. Only the encrypted `.pack.json` files are committed here.
Never put plain recipes or code lists in this folder.

While a pack file is missing, people see a friendly "Recipes are updating, please reload
in a minute" screen (never a blank page). See the README, section 2, for the exact
commands to build and update the packs.
