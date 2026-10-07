// =====================================================================
//  Cost at home — used by the planner's "money saved" numbers.
//
//  Most recipes already say their cost "per plate", "per serving", "per bowl"…
//  in data/recipes.js, and the app reads that number by itself.
//  The recipes below say "each", "per pancake" or "for the whole batch",
//  so their cost per serving is written here by hand (rounded UP, to stay conservative).
//  Change the number after the colon. Keep the commas.
// =====================================================================

// Dollars per serving, for recipes whose cost isn't written per serving.
export const COST_PER_SERVING = {
  1: 0.5,   // Garlic Butter Breadsticks — $0.25 each, 2 per serving
  8: 0.4,   // Cheddar Garlic Biscuits — $0.20 each, 2 per serving
  12: 0.4,  // Honey Butter Dinner Rolls — $0.20 each, 2 per serving
  13: 0.25, // Blender Salsa — $2 a batch, about 12 servings of 1/4 cup
  26: 0.7,  // Diner Pancakes — $0.20 each, 3 per serving (+ syrup)
  30: 0.4,  // Sunday Marinara — $4 a pot, about 12 servings of 1/2 cup
  31: 0.4,  // Garlic Butter Sauce — $1.50 a batch, about 4 servings
  32: 0.4,  // Steak Sauce — $1.50 a batch, about 4 servings
  33: 0.3,  // Buttermilk Ranch — $1.50 a batch, about 6 servings
};

// How many servings one batch makes, for recipes where "serves" isn't a plain number.
export const SERVINGS = {
  1: 6,   // 12 breadsticks
  8: 6,   // 12 biscuits
  12: 6,  // 12 rolls
  13: 12, // about 3 cups salsa
  22: 4,  // 4 double burgers
  26: 3,  // 10 pancakes
  30: 12, // about 6 cups marinara
  31: 4,  // about 1 cup
  32: 4,  // about 1 cup
  33: 6,  // about 1 1/2 cups
};
