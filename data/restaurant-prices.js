// =====================================================================
//  Typical restaurant price, estimate — dollars per serving.
//
//  A rough, conservative guess at what one serving of a similar dish costs
//  at a typical US casual-dining restaurant (before tip and tax).
//  The app always labels these as estimates. No specific restaurant is meant.
//  Each line starts with the recipe: 'copycat:5' is recipe Nº 5 of the copycat pack,
//  'italian:12' is Nº 12 of the Italian Kitchen pack.
//  Change the number after the colon. Keep the quotes and commas.
//  A recipe with no line here still works; it just isn't counted in the money numbers.
// =====================================================================

export const RESTAURANT_PRICES = {
  'copycat:1': 2,    // breadsticks (2)
  'copycat:2': 16,   // fettuccine alfredo
  'copycat:3': 7,    // bowl of sausage, potato & kale soup
  'copycat:4': 6,    // house salad
  'copycat:5': 18,   // chicken parmigiana
  'copycat:6': 19,   // shrimp scampi
  'copycat:7': 8,    // slice of tiramisu
  'copycat:8': 2,    // biscuits (2)
  'copycat:9': 24,   // sirloin steak with garlic butter
  'copycat:10': 7,   // bowl of loaded potato soup
  'copycat:11': 3,   // spinach artichoke dip (shared appetizer, per person)
  'copycat:12': 2,   // dinner rolls (2)
  'copycat:13': 1,   // side of salsa
  'copycat:14': 3,   // side of rice
  'copycat:15': 17,  // chicken fajitas
  'copycat:16': 2,   // queso dip (shared appetizer, per person)
  'copycat:17': 11,  // burrito bowl
  'copycat:18': 11,  // orange chicken
  'copycat:19': 10,  // chow mein
  'copycat:20': 9,   // fried rice
  'copycat:21': 11,  // chicken lettuce wraps
  'copycat:22': 12,  // double smash burger
  'copycat:23': 11,  // crispy chicken sandwich
  'copycat:24': 6,   // bowl of chili
  'copycat:25': 3,   // side of coleslaw
  'copycat:26': 9,   // short stack of pancakes
  'copycat:27': 5,   // side of mac and cheese
  'copycat:28': 15,  // order of wings
  'copycat:29': 8,   // chocolate lava cake
  'copycat:30': 1.5, // side of marinara
  'copycat:31': 1,   // side of garlic butter
  'copycat:32': 1,   // side of steak sauce
  'copycat:33': 0.75, // side of ranch

  // ----- Sal's Italian Kitchen -----
  // Add one line per Italian recipe once the pack is built (the self-test page lists the
  // ones still missing). Conservative, round numbers, per serving. For example:
  // 'italian:1': 9,  // a starter
  // 'italian:2': 16, // a plate of pasta
};
