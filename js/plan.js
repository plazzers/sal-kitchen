// Planner rules that don't touch the screen: what "Surprise me" may pick, and how.

// Recipes "Surprise me" never picks for dinner. They can still be added by hand.
//   desserts, sides, starters, breakfast — and the whole Sal's Sauces chapter.
export const SAUCES_CHAPTER = 6;
export const DESSERTS = new Set([7, 29]);
export const NOT_A_DINNER = new Set([
  1, 4, 8, 11, 12, // breadsticks, salad, biscuits, dip, rolls
  13, 14, 16,      // salsa, rice, queso
  25, 26,          // coleslaw, pancakes
]);

export const MAX_PER_CHAPTER = 2;

export function canAutoPick(r) {
  return r.chapter !== SAUCES_CHAPTER && !DESSERTS.has(r.num) && !NOT_A_DINNER.has(r.num);
}

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
//   taken      — recipe numbers already in this week (never repeated)
//   recipes    — all recipes
// Returns the picked recipes (may be fewer than asked when the rules run out).
// Rules: no repeats in the week, at most 2 from one chapter (counting what's already planned),
// no desserts, sides or sauces.
export function surprisePicks(emptyCount, taken, recipes, rand = Math.random) {
  const used = new Set(taken);
  const perChapter = new Map();
  for (const r of recipes) if (used.has(r.num)) perChapter.set(r.chapter, (perChapter.get(r.chapter) || 0) + 1);
  const picks = [];
  for (const r of shuffle(recipes.filter(canAutoPick), rand)) {
    if (picks.length >= emptyCount) break;
    if (used.has(r.num)) continue;
    if ((perChapter.get(r.chapter) || 0) >= MAX_PER_CHAPTER) continue;
    picks.push(r);
    used.add(r.num);
    perChapter.set(r.chapter, (perChapter.get(r.chapter) || 0) + 1);
  }
  return shuffle(picks, rand);
}
