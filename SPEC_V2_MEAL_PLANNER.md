# SPEC v2 — Weekly meal planner + "money saved" (add to the existing Sal's Kitchen app)

Read README.md and the existing code first. This is an ADDITION to the live, paid app sold on Payhip. Do not break: unlock (config.js hashes), recipes, scaling, favorites, ingredient ticks, shopping list, cooking mode + timers, backup/restore, offline service worker. Existing IndexedDB data must survive (version upgrade that only adds stores).

Same tech rules as the existing app: static, vanilla JS, no build step, no network at runtime, offline PWA, relative paths, Sal's brand look and voice (short punchy lines, warm, never mean; max 1 Italian word per screen), accessible, light/dark. Never use real restaurant brand names.

## 1. Planner ("This week")
- New nav item **Plan** (between Recipes and Shopping list).
- 7-day view (week starts Monday; user can switch to Sunday in Settings). Each day has Dinner by default; optional Lunch slot toggle in Settings.
- Add a recipe to a day from: the planner ("+" → searchable recipe picker with chapter chips), or from any recipe page ("Add to plan" → choose day). Per-slot servings multiplier (reuses existing scaling, ×½ ×1 ×2 ×3).
- Drag to move between days on desktop; "Move to…" on phone. Clear day / clear week.
- "Surprise me" button: fills empty dinners with a balanced random pick (no repeats in the week, at most 2 from the same chapter, never two desserts/sauces as dinner — exclude Sal's Sauces chapter and desserts from auto-pick; sauces can still be added manually).
- Leftovers helper: a slot can be marked "Leftovers from <day>" (no shopping).
- Navigate weeks (previous/next); plans saved per ISO week.

## 2. Shopping list from the plan
- "Make shopping list for this week" → adds all planned recipes (with their multipliers) to the existing shopping list, grouped by recipe like today, PLUS a new optional "Combined" view that merges identical simple ingredients across recipes when units match (e.g. "2 cloves garlic" + "3 cloves garlic" → "5 cloves garlic"; cups+cups; tbsp+tsp converted). Lines that can't be safely merged stay separate. Keep the existing per-recipe view as default; toggle remembered.
- Pantry staples toggle: user marks items they always have (salt, pepper, olive oil, butter, flour, sugar, garlic powder…) in Settings → they're hidden from the list (shown collapsed under "You probably have these").

## 3. Money saved
- Each recipe already has "cost at home" text (e.g. "about $2.50 per plate", "about $0.25 each", "about $2 per bowl"). Parse a per-serving number where possible; when the text is per batch or unclear, store a manual per-serving estimate in `data/costs.js` (you write it, conservative).
- Add `data/restaurant-prices.js`: a typical US casual-dining restaurant price per serving for each of the 33 dishes (your best conservative estimate, round numbers, labeled everywhere as "typical restaurant price, estimate"). Never mention specific chains.
- Planner footer: "This week at home: ~$X. At a restaurant: ~$Y. You keep ~$Z." (servings × prices).
- "Saved so far" counter: each time a planned meal's day passes and the user taps "We made it" (or completes Cooking mode for that recipe), add to a running total. Show on Home: "You've kept ~$123 in your pocket since you started cooking with Sal." with a small Sal line.
- Settings: reset counter; option to hide money features.

## 4. Share
- "Share this week's menu" → nice plain-text menu (and Web Share API), e.g. "Monday — Chicken Parmigiana (×2) …" ending with "Cooked with Sal's Kitchen". Fallback copy to clipboard.

## 5. Backup
- Planner, pantry staples, savings history included in backup/restore (format version bump; old backups still import).

## 6. Testing & delivery
- Bump service worker VERSION; precache new files.
- Browser self-tests `tests/planner.html`: ingredient merge rules (match units, convert tbsp/tsp/cup, refuse unsafe merges), cost parsing for all 33 recipes (each must yield a number), surprise-me constraints over 200 random runs, ISO week math across year boundary, backup round-trip incl. old format.
- Playwright (Chromium preinstalled; don't run `playwright install`) at 390x844 and 1280x800 with a TEMPORARY test code hash (add, then REMOVE before committing; never commit a plain code): plan a week, surprise me, leftovers, make shopping list, combined view, pantry hiding, money footer numbers, mark "we made it", share fallback, backup/restore, offline reload, and confirm existing recipe → scale → cooking mode → timers flow still works.
- Update README. Commit to main.
