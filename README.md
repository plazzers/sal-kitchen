# Sal's Kitchen — Chef Sal Romano

A phone-friendly recipe app with Chef Sal's 33 restaurant-style recipes. People can search recipes and filter them by chapter, save favorites, and make more or less of a recipe (the ingredient amounts change automatically). They can tick off ingredients and steps, cook step by step with big text and kitchen timers, and build a shopping list they can share or print.

**New in version 2:** a weekly meal planner (with "Surprise me", leftovers and a shopping list for the whole week) and a "money saved" counter that compares cooking at home with a typical restaurant price.

- Works on iPhone, Android and computers. Can be installed to the Home Screen like a regular app.
- Works **without internet** after the first visit.
- No accounts, no tracking, no cookies, no server. Everything people save stays on **their own** device.
- Opens with an access code that buyers find in the PDF from Payhip.

This guide is written for non-programmers. You can do everything below in your web browser on github.com, and you don't need to install anything.

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

## 2. Access codes

**Right now the list of codes is empty, so no code works yet.** Add at least one before you sell.

The first screen asks for an access code. Codes are **not** stored in plain text. Only a scrambled version, called a "hash", is stored. Upper/lower case and extra spaces don't matter.

### Add a code

1. Open the hash tool in your browser:
   `https://plazzers.github.io/sal-kitchen/tools/make-code-hash.html`
2. Type the new code (for example `SAL-2026-BASIL`). A line appears underneath. Click **Copy line**.
3. On github.com, open the file **`config.js`** and click the **pencil icon** (Edit).
4. Find `ACCESS_CODE_HASHES = [`. Paste the line on a new line inside the square brackets. Every line must end with a comma.
5. Click **Commit changes…** → **Commit changes**.
6. Put the code itself (not the hash) into the PDF buyers download from Payhip.

It should look like this:

```js
export const ACCESS_CODE_HASHES = [
  // "paste-your-hash-here", // code #1
  "4b1c…your hash…", // 2026-10-06
];
```

(Lines starting with `//` are just notes and are ignored.)

You can use one code for everyone, or a few different ones.

**Good to know:** once someone unlocks the app on a device, it stays unlocked on that device. Removing a code later doesn't lock people out.

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

All recipe text is in **`data/recipes.js`**. The wording matches Sal's cookbook exactly.

To fix a typo or change a line:

1. Open `data/recipes.js` → pencil icon.
2. Find the text (use your browser's Find, Ctrl+F / Cmd+F) and change the words **between the quotes**.
3. Don't remove quotes, commas or brackets. If you need a double quote inside the text, write `\"`.
4. **Commit changes.**

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

- **`num`** must be unique. Never change or reuse a number. People's favorites and ticks are saved by number. To add a recipe, copy a whole `{ … },` block, give it the next free number (34, 35, …), and paste it before the final `];`.
- **`chapter`** is the chapter number (the chapters are listed at the top of the file).
- **`serves`** is shown as "Serves 4" when it's just a number, otherwise as "Makes 12 breadsticks".
- **`tip`** is the "Sal says" box.
- Inside one recipe, **add new ingredients at the end** of the list. Ticks are saved by position, so inserting one in the middle would move people's ticks to the wrong line. (Rewording is always safe.)

`recipes.source.json` is the original copy taken from the cookbook. The app doesn't use it. It's only kept for reference.

### How the "make more / less" buttons read amounts

The app multiplies the amounts at the start of each ingredient line. It also catches amounts after a label like `Topping:` or `Sauce:`, after a comma, and after `+`, `and`, `with`, `into`, `Juice of`, or `(` / `(about` / `(or`. It changes the wording to match (1 clove / 2 cloves, 1/8 cup → 2 tbsp, 8 tbsp → 1/2 cup). It never changes temperatures (110°F), sizes (1/4 inch, 7-inch), times or "pinch". Can sizes stay the same and only the number of cans changes ("2 × 28 oz cans").

When you write new ingredient lines, start them with the amount (`2 cloves garlic`, not `Garlic, 2 cloves`) and they will scale correctly. Amounts inside the **steps** are not changed. The app tells people this when they scale a recipe.

---

### Costs and restaurant prices (money saved)

The planner shows "This week at home: ~$X. At a restaurant: ~$Y. You keep ~$Z." Here's where those numbers come from:

- **Cost at home** comes from each recipe's `cost` text in `data/recipes.js` when it says *per plate / per serving / per bowl / per steak / per burger / per sandwich / per piece / per cake*. If you change a cost there, the app picks it up.
- Recipes priced "each", "per pancake" or "for the whole batch" get a hand-written cost per serving in **`data/costs.js`**. That file also says how many servings a batch makes when `serves` isn't a plain number (for example 12 breadsticks = 6 servings).
- **`data/restaurant-prices.js`** holds a typical restaurant price per serving for every recipe. These are conservative estimates, and the app always labels them "typical restaurant price, estimate". Never put a restaurant's name in this file.

If you add a recipe 34, give it a line in `data/restaurant-prices.js`, and a line in `data/costs.js` if its cost isn't written per serving. The self-test page (section 7) tells you if you forgot.

---

## 5. Change Sal's picture or the app icons

The round picture in the header, on the welcome screen and in the "Sal says" box is `assets/sal-avatar.png` (256 × 256, round, transparent corners).

To replace it: make a square PNG, name it exactly **`sal-avatar.png`**, then on github.com open the **`assets`** folder → **Add file** → **Upload files** → drop in the file → **Commit changes**.

The Home Screen icons are in `assets/icons/`: `icon-192.png`, `icon-512.png`, `maskable-512.png` (extra empty space around the picture for Android), `apple-touch-icon.png` (180 × 180) and `favicon-32.png`. Replace them the same way, keeping the same names and sizes.

---

## 6. How updates reach people's phones

After you commit a change, GitHub Pages publishes it within a few minutes. The app keeps a saved copy so it works offline. It quietly downloads the new version in the background, and people see it the **next time** they open the app (sometimes the time after that).

To force everyone to get a fresh copy right away, open **`sw.js`**, raise the number in `const VERSION = '2';` by one (`'3'`, then `'4'` next time, and so on) and commit. **If you add a new file to the app** (not just edit one), also add its name to the `FILES` list in `sw.js`.

---

## 7. Test it

1. Open your app link and enter one of your access codes.
2. Search for "garlic", tap a chapter, open a recipe, tap **×2** and check the amounts.
3. Tick a few ingredients, tap the heart, tap **Add to shopping list**.
4. Tap **Start cooking mode**, go through the steps, start a timer.
5. Open the **List** (cart icon), tick an item, tap **Share list**.
6. Open **Plan** (calendar icon). Tap **Surprise me**, then **Make shopping list for this week**. On the list, try **Combined**.
7. In **Settings**, make a backup, then restore it.

**Self-test page:** open `https://plazzers.github.io/sal-kitchen/tests/planner.html`. It checks the shopping-list merging, the costs for every recipe, the "Surprise me" rules, the week dates and backups, and should say **"All … checks passed."** It uses its own test storage, so it never touches anything saved in the app.

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

On iPhone, Safari may clear website data if the site isn't used for a while. Installing the app to the Home Screen prevents that, and the app explains this to iPhone users.

---

## What's in this folder

| File / folder | What it does |
|---|---|
| `index.html`, `styles.css` | The app's page and its look (colors, sizes, light/dark mode, print layout) |
| `config.js` | **Your settings:** access codes, links, email |
| `data/recipes.js` | **The recipes** the app shows |
| `data/costs.js` | Cost per serving for recipes not priced per serving, and servings per batch |
| `data/restaurant-prices.js` | Typical restaurant price per serving (estimates) for the money-saved numbers |
| `recipes.source.json` | Original copy of the recipes from the cookbook (not used by the app) |
| `js/` | The app's code (`scale.js` = make more/less, `timers.js` = kitchen timers, `plan.js` = Surprise me rules, `merge.js` = Combined list and pantry staples, `money.js` = money saved, `weeks.js` = dates) |
| `tests/planner.html` | Self-test page for the planner (open it in a browser) |
| `assets/` | Sal's picture and the app icons |
| `tools/make-code-hash.html` | Turns a new access code into a hash for `config.js` |
| `sw.js`, `manifest.webmanifest` | Make the app installable and work offline |
| `.nojekyll` | Tells GitHub Pages to publish the files exactly as they are |

---

*Recipes are inspired by popular restaurant dishes. Not affiliated with or endorsed by any restaurant.*
