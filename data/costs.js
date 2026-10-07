// =====================================================================
//  Cost at home — used by the planner's "money saved" numbers.
//
//  Most recipes already say their cost "per plate", "per serving", "per bowl"…
//  in the recipe itself, and the app reads that number by itself.
//  The recipes below say "each", "per pancake" or "for the whole batch",
//  so their cost per serving is written here by hand (rounded UP, to stay conservative).
//  Each line starts with the recipe: 'copycat:13' is recipe Nº 13 of the copycat pack,
//  'italian:4' would be Nº 4 of the Italian Kitchen pack.
//  Change the number after the colon. Keep the quotes and commas.
// =====================================================================

// Dollars per serving, for recipes whose cost isn't written per serving.
export const COST_PER_SERVING = {
  'copycat:1': 0.5,   // Garlic Butter Breadsticks — $0.25 each, 2 per serving
  'copycat:8': 0.4,   // Cheddar Garlic Biscuits — $0.20 each, 2 per serving
  'copycat:12': 0.4,  // Honey Butter Dinner Rolls — $0.20 each, 2 per serving
  'copycat:13': 0.25, // Blender Salsa — $2 a batch, about 12 servings of 1/4 cup
  'copycat:26': 0.7,  // Diner Pancakes — $0.20 each, 3 per serving (+ syrup)
  'copycat:30': 0.4,  // Sunday Marinara — $4 a pot, about 12 servings of 1/2 cup
  'copycat:31': 0.4,  // Garlic Butter Sauce — $1.50 a batch, about 4 servings
  'copycat:32': 0.4,  // Steak Sauce — $1.50 a batch, about 4 servings
  'copycat:33': 0.3,  // Buttermilk Ranch — $1.50 a batch, about 6 servings
};

// How many servings one batch makes, for recipes where "serves" isn't a plain number.
export const SERVINGS = {
  'copycat:1': 6,   // 12 breadsticks
  'copycat:8': 6,   // 12 biscuits
  'copycat:12': 6,  // 12 rolls
  'copycat:13': 12, // about 3 cups salsa
  'copycat:22': 4,  // 4 double burgers
  'copycat:26': 3,  // 10 pancakes
  'copycat:30': 12, // about 6 cups marinara
  'copycat:31': 4,  // about 1 cup
  'copycat:32': 4,  // about 1 cup
  'copycat:33': 6,  // about 1 1/2 cups
};
