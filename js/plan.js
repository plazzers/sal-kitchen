// Planner rules that don't touch the screen: what "Surprise me" may pick, and how.
// Recipes are identified as "<pack>:<number>" (r.rid); r.pack is the pack, r.chapter its chapter number.

// Recipes "Surprise me" never picks for dinner. They can still be added by hand.
// Per pack: whole chapters to skip, and single recipes to skip.
export const AUTO_PICK_RULES = {
  copycat: {
    chapters: [6],           // Sal's Sauces
    recipes: [
      7, 29,                 // desserts: tiramisu, lava cake
      1, 4, 8, 11, 12,       // breadsticks, salad, biscuits, dip, rolls
      13, 14, 16,            // salsa, rice, queso
      25, 26,                // coleslaw, pancakes
    ],
  },
  // Sal's Italian Kitchen: until chapters/recipes are listed here, chapters whose name says
  // dessert, sauce, side, starter, bread, breakfast or drink are skipped (see NOT_DINNER_CHAPTER).
  // Example once the real pack is built:  italian: { chapters: [1, 6, 7], recipes: [12] },
};

// Fallback for packs without rules above, by chapter name (English or Italian).
export const NOT_DINNER_CHAPTER = /\b(dessert|desserts|dolci|dolce|sweets?|sauces?|sughi|sugo|salse|sides?|contorni|antipast[oi]|starters?|appetizers?|breads?|pane|breakfast|colazione|drinks?|bevande|cocktails?)\b/i;

// Older name, still used by the self-tests.
export const SAUCES_CHAPTER = 6;
export const DESSERTS = new Set([7, 29]);

export const MAX_PER_CHAPTER = 2;

// chapterTitle(r) → the title of r's chapter (only needed for packs without rules).
export function canAutoPick(r, chapterTitle = () => '') {
  const rules = AUTO_PICK_RULES[r.pack];
  if (rules) return !rules.chapters.includes(r.chapter) && !rules.recipes.includes(r.num);
  return !NOT_DINNER_CHAPTER.test(chapterTitle(r) || '');
}

const chapterKey = (r) => `${r.pack}:${r.chapter}`;

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Fill empty dinners.
//   emptyCount — how many dinners to fill
//   taken      — recipe ids already in this week (never repeated)
//   recipes    — all recipes the person has unlocked (any pack)
// Returns the picked recipes (may be fewer than asked when the rules run out).
// Rules: no repeats in the week, at most 2 from one chapter (counting what's already planned),
// no desserts, sides or sauces.
export function surprisePicks(emptyCount, taken, recipes, rand = Math.random, chapterTitle) {
  const used = new Set(taken);
  const perChapter = new Map();
  for (const r of recipes) if (used.has(r.rid)) perChapter.set(chapterKey(r), (perChapter.get(chapterKey(r)) || 0) + 1);
  const picks = [];
  for (const r of shuffle(recipes.filter((x) => canAutoPick(x, chapterTitle)), rand)) {
    if (picks.length >= emptyCount) break;
    if (used.has(r.rid)) continue;
    if ((perChapter.get(chapterKey(r)) || 0) >= MAX_PER_CHAPTER) continue;
    picks.push(r);
    used.add(r.rid);
    perChapter.set(chapterKey(r), (perChapter.get(chapterKey(r)) || 0) + 1);
  }
  return shuffle(picks, rand);
}
