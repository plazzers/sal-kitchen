# Sal's Kitchen — Chef Sal Romano

A phone-friendly recipe app with Chef Sal's recipe books: **Sal's Kitchen** (33 restaurant-style copycat recipes) and **Sal's Italian Kitchen** (60 Italian recipes, sold separately). People can search recipes and filter them by chapter, save favorites, and make more or less of a recipe (the ingredient amounts change automatically). They can tick off ingredients and steps, cook step by step with big text and kitchen timers, and build a shopping list they can share or print.

**New in version 2:** a weekly meal planner (with "Surprise me", leftovers and a shopping list for the whole week) and a "money saved" counter that compares cooking at home with a typical restaurant price.

**New in version 3:** the recipes are **locked**. They're stored only in encrypted files ("recipe packs") that open with a real access code, so nobody can read the cookbook on GitHub any more. There's a second pack, Sal's Italian Kitchen. A code can open one pack or both (a "bundle" code). On the Recipes screen people switch between **Copycat**, **Italian Kitchen** and **All**. A pack someone hasn't bought shows a "locked" card with a **Get it** link.

- Works on iPhone, Android and computers. Can be installed to the Home Screen like a regular app.
- Works **without internet** after the first visit.
- No accounts, no tracking, no cookies, no server. Everything people save stays on **their own** device.
- Opens with an access code that buyers find in the PDF from Payhip.

This guide is written for non-programmers. Most of it you can do in your web browser on github.com. The one exception is **building the recipe packs** (section 2): that runs a small Python program on a computer, once at the start and again whenever you add codes or change recipes.

---

## 1. Put the app online (GitHub Pages)

You only do this once.

1. Create a repository on github.com called **`sal-kitchen`** and upload every file and folder from this folder into it (**Add file → Upload files**, then drag everything in, including the `assets`, `data`, `js` and `tools` folders and the empty `.nojekyll` file).
2. In the repository, click **Settings** (the gear tab along the top of the repository, not your account settings).
3. In the left-hand menu, click **Pages**.
4. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
5. Under **Branch**, choose **main** and the folder **/ (root)**. Click **Save**.
6. Wait 1–2 minutes and refresh the page. A box at the top shows **"Your site is live at …"**:
   `https://plazzers.github.io/sal-kitchen/`
7. Open that link. You should see "Welcome to Sal's Kitchen" and a box for the access code.

That link is what you give your buyers (put it in the PDF together with their access code).

> **Note:** on a free GitHub account, Pages only works when the repository is **Public**. That's fine. The access codes are stored scrambled (see below). This is meant as a simple "soft lock", not bank-level security.

---

## 2. Recipe packs and access codes

### How it works (the short version)

- Each recipe book is one **encrypted file** in the `packs/` folder: `packs/copycat.pack.json` (Sal's Kitchen, 33 recipes) and `packs/italian.pack.json` (Sal's Italian Kitchen, 60 recipes). Anyone can download these files, but without a code they're just scrambled letters.
- Every access code has its own "key slot" inside the pack(s) it opens. When someone types their code, their phone tries it on the packs. If it fits, the pack opens and the phone **remembers the pack's key**. After that it works offline and never asks again.
- A code can be in one pack or in both (a **bundle code**).
- `config.js` also keeps a scrambled copy ("hash") of every code. That's only a fast first check so typos get an instant answer. **What really opens the recipes is the code itself.** So every code needs both: a line in `config.js`, and a place in the pack(s).
- The plain recipes and the list of codes **never go into the repository**. Keep them in a folder on your computer, outside the `sal-kitchen` folder (below we call it `~/sal-secrets`). Make a backup of that folder: if you lose it, you can't add codes any more.

> **Until both pack files are in `packs/`, the app shows "Recipes are updating, please reload in a minute."** Nothing is lost while that screen shows. It goes away by itself once the packs are published.

### What you need (one time)

- A computer with **Python 3** and the **cryptography** package: `pip install cryptography`
- A copy of this repository on that computer: `git clone https://github.com/plazzers/sal-kitchen.git`
- The folder `~/sal-secrets` with these files (plain text, **never** inside `sal-kitchen`):

| File | What's in it |
|---|---|
| `copycat-recipes.js` | The 33 copycat recipes. Get them from the old app version (see below). |
| `italian.json` | The 60 Italian recipes, in the same shape as the copycat ones (see "Recipe file format" below) |
| `copycat-codes.txt` | The codes sold with Sal's Kitchen, **one per line** (the 10 codes you already have) |
| `italian-codes.txt` | The codes sold with Sal's Italian Kitchen, one per line |
| `bundle-codes.txt` | Codes that open **both** books, one per line (can be empty) |

Lines that start with `#` and empty lines in the code files are ignored, so you can write notes. Upper/lower case and extra spaces don't matter.

The copycat recipes were removed from the repository in version 3, but the old version still has them:

```
cd sal-kitchen
git show 6fddb65:data/recipes.js > ~/sal-secrets/copycat-recipes.js
```

### Build the packs

Run these from inside the `sal-kitchen` folder:

```
python3 tools/build_packs.py --pack copycat --input ~/sal-secrets/copycat-recipes.js --codes ~/sal-secrets/copycat-codes.txt --codes-extra ~/sal-secrets/bundle-codes.txt
python3 tools/build_packs.py --pack italian --input ~/sal-secrets/italian.json --codes ~/sal-secrets/italian-codes.txt --codes-extra ~/sal-secrets/bundle-codes.txt --print-hashes
```

Each command writes the pack into `packs/` and prints a short summary (number of recipes and codes). It never prints a code or a recipe. `--print-hashes` prints one line per code for `config.js`.

Check that a code works before you publish (the code you type here stays on your computer):

```
python3 tools/verify_pack.py --pack packs/copycat.pack.json --code ONE-OF-YOUR-COPYCAT-CODES
python3 tools/verify_pack.py --pack packs/italian.pack.json --code ONE-OF-YOUR-ITALIAN-CODES
```

Then paste the printed hash lines that aren't in `config.js` yet into `ACCESS_CODE_HASHES` (one line per code, each ending with a comma), and publish:

```
git add packs/copycat.pack.json packs/italian.pack.json config.js
git commit -m "Update recipe packs"
git push
```

`git status` must **not** show your `~/sal-secrets` files. They're outside the folder, and the repository also ignores `*.plain.json`, `*-codes.txt` and `secrets/` just in case. The build tool refuses to read recipes or codes from a place where they could get committed.

### Add a new code

1. Add the code to the right file in `~/sal-secrets`: `copycat-codes.txt`, `italian-codes.txt` or `bundle-codes.txt` (for both books).
2. Run the build command(s) above again for the pack(s) it should open, with `--print-hashes`.
3. Paste the new hash line into `config.js`. You can also make that line with `https://plazzers.github.io/sal-kitchen/tools/make-code-hash.html`.
4. Commit and push the pack file(s) and `config.js` (see above). The new code works within a few minutes.
5. Put the code itself (not the hash) into the PDF buyers download from Payhip.

**Rebuilding keeps the pack's key**, so people who already unlocked the app are not asked again. (The tool finds the key using one of the codes you give it.) If none of the given codes opens the current pack, the tool stops and explains. `--new-key` would make a brand-new key, but then **everyone** has to type their code once more, so only use it if a key was leaked.

### Remove a code

Delete it from the codes file, rebuild, and remove its line from `config.js`. New phones can't use it any more. Phones that already unlocked the app keep working (they already have the pack's key).

### Recipe file format

`italian.json` (and any future pack) looks like this. It's the same shape the copycat recipes always had:

```json
{
  "title": "Sal's Italian Kitchen",
  "chapters": [
    { "num": 1, "title": "Antipasti", "intro": "One short line from Sal." }
  ],
  "recipes": [
    {
      "num": 1,
      "chapter": 1,
      "title": "Bruschetta",
      "subtitle": "One short line under the title",
      "serves": "4",
      "time": "15 min",
      "cost": "about $1 per serving",
      "ingredients": ["4 slices crusty bread", "2 ripe tomatoes, diced"],
      "steps": ["Toast the bread.", "Top it and serve."],
      "tip": "The Sal says box."
    }
  ]
}
```

The build tool checks the file and tells you exactly what's wrong (for example "Recipe 12: 'steps' must be a list of lines"). In the app, a recipe is known as `<pack>:<num>` (`italian:12`), so the same rules as section 4 apply: never change or reuse a `num`.

When the real Italian pack is built, also:
- add a **typical restaurant price** for each Italian recipe to `data/restaurant-prices.js` (`'italian:1': 9,`, see section 4). Until a recipe has one, it's simply left out of the money numbers, with a short note.
- optionally tell "Surprise me" which Italian chapters aren't dinners, in `js/plan.js` (`AUTO_PICK_RULES`). Without that, it skips chapters whose name says dessert/dolci, sauce/sughi, side/contorni, antipasti, bread, breakfast or drinks.

### Good to know

- **Older versions of the repository still contain the plain copycat recipes** (`data/recipes.js` and `recipes.source.json` before version 3). We accept that. The history is not rewritten.
- `tests/fixtures/` holds **test** packs with **test** codes (like `SAL-TEST-AAAA-1111`). They're only used by the self-tests, and the app only reads them on the developer's own computer (`localhost` with `?packs=test`). The test codes never open the real packs. Note: the copycat test pack is the real 33 recipes, locked with a test code that's written in the repository.
- This is still a "good lock" for a cookbook, not bank-level security: anyone with a valid code can read the recipes on their own device.

---

## 3. Change the links, email and app name

Open **`config.js`** → pencil icon, and change the text between the quotes:

| Setting | What it is |
|---|---|
| `APP_NAME` | Full name shown under Settings → About |
| `YOUTUBE_URL` | Link to Sal's YouTube channel |
| `STORE_URL` | Link to the Payhip store |
| `SUPPORT_EMAIL` | Email address shown for help (on the code screen and in Settings) |

Keep the quotes `" "` and the semicolons. Then **Commit changes**.

---

## 4. Edit the recipes

The recipe text is **no longer in the repository**. It's in your plain recipe files in `~/sal-secrets` (`copycat-recipes.js` and `italian.json`). The wording matches Sal's cookbooks exactly.

To fix a typo or change a line:

1. Open the recipe file in a text editor and find the text.
2. Change the words **between the quotes**. Don't remove quotes, commas or brackets. If you need a double quote inside the text, write `\"`.
3. Rebuild that pack (section 2, "Build the packs"), then commit and push the new `.pack.json` file. People see the change the next time they open the app (their key keeps working).

Each recipe looks like this:

```js
{
  "num": 2,
  "chapter": 1,
  "title": "Real Fettuccine Alfredo",
  "subtitle": "Like the alfredo every Italian chain puts on the menu",
  "serves": "4",
  "time": "20 min",
  "cost": "about $2.50 per plate",
  "ingredients": [ "1 lb fettuccine", "6 tbsp butter", ... ],
  "steps": [ "Cook the pasta ...", ... ],
  "tip": "Grate the cheese yourself. ..."
},
```

- **`num`** must be unique inside its pack. Never change or reuse a number. People's favorites, ticks and plans are saved by pack and number (`copycat:5`). To add a recipe, copy a whole `{ … },` block, give it the next free number (34, 35, …), and paste it before the closing `]`.
- **`chapter`** is the chapter number (the chapters are listed at the top of the file).
- **`serves`** is shown as "Serves 4" when it's just a number, otherwise as "Makes 12 breadsticks".
- **`tip`** is the "Sal says" box.
- Inside one recipe, **add new ingredients at the end** of the list. Ticks are saved by position, so inserting one in the middle would move people's ticks to the wrong line. (Rewording is always safe.)


### How the "make more / less" buttons read amounts

The app multiplies the amounts at the start of each ingredient line. It also catches amounts after a label like `Topping:` or `Sauce:`, after a comma, and after `+`, `and`, `with`, `into`, `Juice of`, or `(` / `(about` / `(or`. It changes the wording to match (1 clove / 2 cloves, 1/8 cup → 2 tbsp, 8 tbsp → 1/2 cup). It never changes temperatures (110°F), sizes (1/4 inch, 7-inch), times or "pinch". Can sizes stay the same and only the number of cans changes ("2 × 28 oz cans").

When you write new ingredient lines, start them with the amount (`2 cloves garlic`, not `Garlic, 2 cloves`) and they will scale correctly. Amounts inside the **steps** are not changed. The app tells people this when they scale a recipe.

---

### Costs and restaurant prices (money saved)

The planner shows "This week at home: ~$X. At a restaurant: ~$Y. You keep ~$Z." Here's where those numbers come from:

- **Cost at home** comes from each recipe's `cost` text when it says *per plate / per serving / per bowl / per steak / per burger / per sandwich / per piece / per cake*. If you change a cost there, the app picks it up.
- Recipes priced "each", "per pancake" or "for the whole batch" get a hand-written cost per serving in **`data/costs.js`**. Lines there start with the recipe, like `'copycat:13': 0.25,`. That file also says how many servings a batch makes when `serves` isn't a plain number (for example 12 breadsticks = 6 servings).
- **`data/restaurant-prices.js`** holds a typical restaurant price per serving for every recipe, written as `'copycat:5': 18,` or `'italian:12': 16,`. These are conservative estimates, and the app always labels them "typical restaurant price, estimate". Never put a restaurant's name in this file. A recipe without a line isn't counted in the money numbers (the planner says so). It's never a made-up number.

If you add a recipe 34, give it a line in `data/restaurant-prices.js`, and a line in `data/costs.js` if its cost isn't written per serving.

---

## 5. Change Sal's picture or the app icons

The round picture in the header, on the welcome screen and in the "Sal says" box is `assets/sal-avatar.png` (256 × 256, round, transparent corners).

To replace it: make a square PNG, name it exactly **`sal-avatar.png`**, then on github.com open the **`assets`** folder → **Add file** → **Upload files** → drop in the file → **Commit changes**.

The Home Screen icons are in `assets/icons/`: `icon-192.png`, `icon-512.png`, `maskable-512.png` (extra empty space around the picture for Android), `apple-touch-icon.png` (180 × 180) and `favicon-32.png`. Replace them the same way, keeping the same names and sizes.

---

## 6. How updates reach people's phones

After you commit a change, GitHub Pages publishes it within a few minutes. The app keeps a saved copy so it works offline. It quietly downloads the new version in the background, and people see it the **next time** they open the app (sometimes the time after that).

To force everyone to get a fresh copy right away, open **`sw.js`**, raise the number in `const VERSION = '3';` by one (`'4'`, then `'5'` next time, and so on) and commit. A new or rebuilt pack file doesn't need this: it's picked up on the next visit or two. **If you add a new file to the app** (not just edit one), also add its name to the `FILES` list in `sw.js`.

---

## 7. Test it

1. Open your app link and enter one of your access codes. If you have a bundle or Italian code, check that **Italian Kitchen** opens too. With a copycat-only code, the Italian tab should show the locked card.
2. Search for "garlic", tap a chapter, open a recipe, tap **×2** and check the amounts.
3. Tick a few ingredients, tap the heart, tap **Add to shopping list**.
4. Tap **Start cooking mode**, go through the steps, start a timer.
5. Open the **List** (cart icon), tick an item, tap **Share list**.
6. Open **Plan** (calendar icon). Tap **Surprise me**, then **Make shopping list for this week**. On the list, try **Combined**.
7. In **Settings**, make a backup, then restore it.

**Self-test pages** (they use the test packs and their own test storage, so they never touch anything saved in the app). Each should say **"All … checks passed."**:

- `https://plazzers.github.io/sal-kitchen/tests/planner.html`: shopping-list merging, the costs for every recipe, the "Surprise me" rules, the week dates and backups.
- `https://plazzers.github.io/sal-kitchen/tests/packs.html`: the locked recipe packs (right codes open them, wrong codes don't, bundle codes open both), the move from old saved data to version 3, backups, and planner/money/shopping across both packs. It takes a few seconds.

**For developers** (on a computer with the repository):

```
python3 -m unittest discover -s tests -v      # build tool, verify tool, test packs, nothing secret committed
node tests/browser/run.cjs                     # full app in Chromium at phone (390×844) and computer (1280×800) size
```

`run.cjs` needs Playwright with Chromium. It starts its own little web server and uses the test packs, so it never needs real codes. To try the app by hand with the test packs, serve the folder (`python3 -m http.server 8000`) and open `http://localhost:8000/?packs=test`, then use a test code from `tests/fixtures/README.md`.

To start over as a brand-new user (see the access-code screen again): in Chrome, open the app, click the icon to the left of the address → **Site settings** → **Delete data**. On iPhone: Settings → Safari → Advanced → Website Data → find `github.io` → Delete.

**Offline test on a phone:** open the app once with internet (wait a few seconds), install it to the Home Screen, turn on **Airplane Mode**, and open it from the Home Screen icon. Everything should still work.

---

## 8. The week planner

- **Plan** (calendar icon in the header) shows one week, Monday to Sunday. People can switch to Sunday-first and turn on a lunch slot under Settings → Week plan.
- **+ Add a recipe** opens a searchable recipe picker. From any recipe page, **Add to plan** lets people choose a day. Each meal has its own amount (×½ ×1 ×2 ×3), which uses the same make-more/less logic as the recipe page.
- On a computer, meals can be dragged to another day. On a phone, they use **Move to…**. Moving onto a day that already has a meal swaps the two.
- **Leftovers** marks a meal as leftovers from an earlier day. It adds nothing to the shopping list or the money numbers.
- **Surprise me** fills the empty dinners: no repeats in the week, at most 2 from the same chapter, and only main dishes. It never picks desserts, sides or Sal's Sauces (people can still add those by hand). The list of what it skips is at the top of `js/plan.js`.
- **Make shopping list for this week** adds every planned recipe (with its amount) to the shopping list, grouped by recipe as before. **Combined** adds up identical ingredients across recipes when the units match or convert (2 cloves garlic + 3 cloves garlic → 5 cloves garlic; tbsp/tsp/cups; oz/lb). Anything it can't add up safely stays as written.
- **Pantry staples** (Settings) are things people always have, like salt, butter or oil. On the list they move into a closed **"You probably have these"** box.
- **We made it** (on today's and past meals), or finishing cooking mode for a recipe planned today, adds that meal's savings to the counter on the Home screen. People can reset the counter, or hide all money numbers, in Settings.
- **Share this week's menu** sends a plain-text menu, or copies it when the device has no share button.

---

## 9. Where people's data lives

Favorites, ticks, the chosen amount for each recipe, week plans, pantry staples, savings and the shopping list are stored in the browser on each person's own device. Nothing is uploaded, not to you and not to GitHub. **Settings → Backup** saves one small file that people can keep and restore later or on a new phone. Backups made with version 1 (before the planner) still restore. They bring back favorites, ticks and the shopping list, and leave the planner as it is.

Version 2 adds two new storage areas for plans and savings. Everything people saved with version 1 stays exactly as it was. If someone still has the old version open in another browser tab, the new one asks them to close it and then carries on by itself.

Version 3 adds one more storage area for the pack keys (so the app opens offline without the code). It also changes how recipes are saved: the old number `5` becomes `copycat:5` in favorites, ticks, the shopping list, plans and savings. That happens automatically, all at once, the first time version 3 opens. Older backups (version 1 and 2) still restore and get the same treatment. Backups never contain codes or pack keys.

**One-time step for people who already use the app:** earlier versions never saved the code itself, so on the first visit after the update, people who were already unlocked see a friendly **"Welcome back!"** screen: *"Quick one-time step: enter your access code again to load your recipes (it's in your Payhip PDF)."* It tells them their favorites, plans and shopping list are safe, and their shopping list stays open meanwhile. After that they're never asked again on that device. Expect a few support emails from people who lost their PDF. Payhip lets them download it again from their purchase email.

On iPhone, Safari may clear website data if the site isn't used for a while. Installing the app to the Home Screen prevents that, and the app explains this to iPhone users.

---

## What's in this folder

| File / folder | What it does |
|---|---|
| `index.html`, `styles.css` | The app's page and its look (colors, sizes, light/dark mode, print layout) |
| `config.js` | **Your settings:** access code hashes, links, email |
| `packs/` | **The recipes**, as encrypted recipe packs (made with `tools/build_packs.py`) |
| `data/costs.js` | Cost per serving for recipes not priced per serving, and servings per batch |
| `data/restaurant-prices.js` | Typical restaurant price per serving (estimates) for the money-saved numbers |
| `js/` | The app's code (`packs.js` = recipe packs and unlocking, `packcrypto.js` = opening the encrypted packs, `migrate.js` = moving old saved data to version 3, `scale.js` = make more/less, `timers.js` = kitchen timers, `plan.js` = Surprise me rules, `merge.js` = Combined list and pantry staples, `money.js` = money saved, `weeks.js` = dates) |
| `tests/` | Self-test pages (`planner.html`, `packs.html`), Python tests, browser tests (`browser/run.cjs`) and **test** packs with **test** codes (`fixtures/`) |
| `assets/` | Sal's picture and the app icons |
| `tools/build_packs.py`, `tools/verify_pack.py` | Build the encrypted packs from your plain recipes and codes, and check a code (section 2) |
| `tools/make-code-hash.html` | Turns a new access code into a hash for `config.js` |
| `sw.js`, `manifest.webmanifest` | Make the app installable and work offline |
| `.nojekyll` | Tells GitHub Pages to publish the files exactly as they are |

---

*Recipes are inspired by popular restaurant dishes. Not affiliated with or endorsed by any restaurant.*
