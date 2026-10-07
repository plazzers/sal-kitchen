// Shopping list helpers: the "Combined" view and pantry staples.
//
// Combined view: identical simple ingredients from different recipes are added up
// ("2 cloves garlic, minced" + "3 cloves garlic, sliced" → "5 cloves garlic").
// Only when it's safe: one amount at the start, a unit that matches or converts
// (tsp/tbsp/cup, oz/lb), and the same ingredient name. Everything else stays as it is.
import { parseNumber, kitchenNumber, scaleLine } from './scale.js';

const UNIT_ALIASES = {
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice', stalk: 'stalk', stalks: 'stalk',
  sprig: 'sprig', sprigs: 'sprig', stick: 'stick', sticks: 'stick', head: 'head', heads: 'head',
  bunch: 'bunch', bunches: 'bunch', can: 'can', cans: 'can', jar: 'jar', jars: 'jar',
  package: 'package', packages: 'package', pint: 'pint', pints: 'pint', quart: 'quart', quarts: 'quart',
};
const UNIT_PLURAL = { clove: 'cloves', slice: 'slices', stalk: 'stalks', sprig: 'sprigs', stick: 'sticks', head: 'heads', bunch: 'bunches', can: 'cans', jar: 'jars', package: 'packages', pint: 'pints', quart: 'quarts' };
// In teaspoons / ounces.
const VOLUME = { tsp: 1, tbsp: 3, cup: 48 };
const WEIGHT = { oz: 1, lb: 16 };

// Words allowed after the comma ("garlic, finely minced"). Anything else → not merged.
const PREP_WORDS = new Set(`minced diced sliced chopped grated shredded cubed crushed smashed torn halved quartered
  finely roughly thinly thin thick very coarsely freshly lightly
  peeled seeded cored trimmed rinsed drained squeezed dry thawed warmed softened melted cooled beaten divided packed
  removed stems stem casings seeds skin skins room temperature at and cut into pieces small large bite-size
  cold warm`.split(/\s+/).filter(Boolean));

const NUM_RE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?=\s)/;

function singular(word) {
  const w = word.toLowerCase();
  if (/(?:ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/oes$/.test(w)) return w.slice(0, -2);
  if (/ves$/.test(w)) return w.slice(0, -3) + 'f';
  if (/(?:ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

// "3 cloves garlic, minced" → { qty: 3, unit: 'clove', name: 'garlic', key: 'clove|garlic' }
// Returns null when the line isn't simple enough to add up safely.
export function parseSimple(line) {
  const text = String(line).trim();
  if (/[()+:×;]/.test(text)) return null;
  const m = text.match(NUM_RE);
  if (!m) return null;
  const qty = parseNumber(m[1]);
  if (!(qty > 0)) return null;
  let rest = text.slice(m[0].length).trim();
  if (/^(?:-|–|to\b|or\b)/i.test(rest)) return null; // a range, "2 to 3"

  let unit = null;
  const u = rest.match(/^([A-Za-z]+)\.?\s+/);
  if (u && UNIT_ALIASES[u[1].toLowerCase()]) {
    unit = UNIT_ALIASES[u[1].toLowerCase()];
    rest = rest.slice(u[0].length);
  }

  const parts = rest.split(',');
  if (parts.length > 2) return null;
  if (parts.length === 2) {
    const prep = parts[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!prep.length || !prep.every((w) => PREP_WORDS.has(w))) return null;
  }
  const name = parts[0].trim();
  if (!name || /\d/.test(name)) return null;
  if (/^(?:of\b|pinch|dash|can\b|cans\b|jar\b)/i.test(name)) return null;
  if (/\b(?:to taste|optional|for |to serve|to finish)\b/i.test(name)) return null;
  if (/\bor\b/i.test(name) && !unit) return null;

  const words = name.toLowerCase().split(/\s+/);
  // Counted things ("2 eggs", "1 egg") compare in the singular.
  if (!unit) words[words.length - 1] = singular(words[words.length - 1]);
  const family = VOLUME[unit] ? 'vol' : WEIGHT[unit] ? 'wt' : unit || 'count';
  return { qty, unit, name, family, key: `${family}|${words.join(' ')}` };
}

const close = (a, b) => Math.abs(a - b) < 1e-6;

// Cups measure in quarters and thirds.
const niceCup = (v) => [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4].some((f) => close(v - Math.floor(v), f));

function formatVolume(tsp) {
  // Whole cups / quarter cups when they come out even, else cups + tbsp, tbsp + tsp.
  if (tsp >= 12 - 1e-6) {
    const cups = tsp / 48;
    const k = kitchenNumber(cups);
    if (close(k.value * 48, tsp) && niceCup(k.value)) return `${k.text} ${k.value > 1 ? 'cups' : 'cup'}`;
    const quarters = Math.floor(tsp / 12 + 1e-6);
    const c = kitchenNumber(quarters / 4);
    return `${c.text} ${c.value > 1 ? 'cups' : 'cup'} + ${formatVolume(tsp - quarters * 12)}`;
  }
  if (tsp >= 3 - 1e-6) {
    const tbsp = tsp / 3;
    const k = kitchenNumber(tbsp);
    if (close(k.value * 3, tsp) && close(k.value * 2, Math.round(k.value * 2))) return `${k.text} tbsp`;
    const whole = Math.floor(tbsp + 1e-6);
    return `${whole} tbsp + ${formatVolume(tsp - whole * 3)}`;
  }
  return `${kitchenNumber(tsp).text} tsp`;
}

function formatWeight(oz, units) {
  if (units.every((u) => u === 'lb') || oz >= 16 - 1e-6) {
    const k = kitchenNumber(oz / 16);
    if (close(k.value * 16, oz)) return `${k.text} lb`;
    if (oz >= 16) {
      const lb = Math.floor(oz / 16 + 1e-6);
      return `${lb} lb + ${kitchenNumber(oz - lb * 16).text} oz`;
    }
  }
  return `${kitchenNumber(oz).text} oz`;
}

// lines: [{ text, ref }] → [{ text, refs: [ref…], merged: bool }] in first-seen order.
export function combineLines(lines) {
  const out = [];
  const byKey = new Map();
  for (const l of lines) {
    const p = parseSimple(l.text);
    const entry = p && byKey.get(p.key);
    if (entry) {
      entry.parts.push(p);
      entry.refs.push(l.ref);
      continue;
    }
    const e = { text: l.text, refs: [l.ref], parts: p ? [p] : null };
    out.push(e);
    if (p) byKey.set(p.key, e);
  }
  return out.map((e) => {
    if (!e.parts || e.parts.length < 2) return { text: e.text, refs: e.refs, merged: false };
    return { text: mergedText(e.parts), refs: e.refs, merged: true };
  });
}

function mergedText(parts) {
  const first = parts[0];
  if (first.family === 'vol') {
    const tsp = parts.reduce((s, p) => s + p.qty * VOLUME[p.unit], 0);
    return `${formatVolume(tsp)} ${first.name}`;
  }
  if (first.family === 'wt') {
    const oz = parts.reduce((s, p) => s + p.qty * WEIGHT[p.unit], 0);
    return `${formatWeight(oz, parts.map((p) => p.unit))} ${first.name}`;
  }
  const total = parts.reduce((s, p) => s + p.qty, 0);
  const k = kitchenNumber(total);
  if (first.unit) return `${k.text} ${k.value > 1 ? UNIT_PLURAL[first.unit] || first.unit : first.unit} ${first.name}`;
  // Counted things: let the scaler pick "onion" / "onions".
  return scaleLine(`${first.qty} ${first.name}`, total / first.qty);
}

// Convenience for tests: merge plain strings.
export function mergeTexts(texts) {
  return combineLines(texts.map((text, i) => ({ text, ref: i }))).map((x) => x.text);
}

// ---------- Pantry staples ----------

export const PANTRY_OPTIONS = [
  { id: 'salt', label: 'Salt', names: ['salt'] },
  { id: 'pepper', label: 'Black pepper', names: ['pepper', 'black pepper'] },
  { id: 'olive-oil', label: 'Olive oil', names: ['olive oil'] },
  { id: 'oil', label: 'Cooking oil', names: ['oil', 'vegetable oil', 'canola oil', 'high-heat oil'] },
  { id: 'butter', label: 'Butter', names: ['butter'] },
  { id: 'flour', label: 'Flour', names: ['flour'] },
  { id: 'sugar', label: 'Sugar', names: ['sugar'] },
  { id: 'garlic-powder', label: 'Garlic powder', names: ['garlic powder'] },
  { id: 'onion-powder', label: 'Onion powder', names: ['onion powder'] },
  { id: 'oregano', label: 'Dried oregano', names: ['oregano'] },
  { id: 'red-pepper-flakes', label: 'Red pepper flakes', names: ['red pepper flakes'] },
  { id: 'cumin', label: 'Cumin', names: ['cumin'] },
  { id: 'paprika', label: 'Paprika', names: ['paprika', 'smoked paprika'] },
  { id: 'baking-powder', label: 'Baking powder', names: ['baking powder'] },
  { id: 'baking-soda', label: 'Baking soda', names: ['baking soda'] },
  { id: 'vanilla', label: 'Vanilla', names: ['vanilla'] },
  { id: 'soy-sauce', label: 'Soy sauce', names: ['soy sauce'] },
  { id: 'water', label: 'Water', names: ['water'] },
];

const DESCRIPTORS = /^(?:kosher|sea|table|fine|coarse|freshly|fresh|ground|cracked|black|unsalted|salted|softened|soft|melted|cold|warm|hot|all-purpose|granulated|extra-virgin|extra|virgin|dried|pure|plain)\s+/i;
const TAILS = /\s+(?:for frying|for the pan|for greasing|to taste|to serve|to finish|for the ramekins)$/i;

function bareName(s) {
  let n = s.toLowerCase().trim();
  let prev;
  do { prev = n; n = n.replace(DESCRIPTORS, ''); } while (n !== prev);
  return n.replace(TAILS, '').trim();
}

// The staple names to hide, from the chosen option ids plus the user's own words.
export function pantryNames(ids = [], custom = []) {
  const names = new Set();
  PANTRY_OPTIONS.forEach((o) => { if (ids.includes(o.id)) o.names.forEach((n) => names.add(n)); });
  custom.forEach((c) => { const n = bareName(String(c)); if (n) names.add(n); });
  return names;
}

// True when every ingredient on the line is a staple ("2 tsp salt", "Kosher salt and black pepper").
const AMOUNT = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)';
// "3/4 cup + 2 tbsp + 1 tsp " at the start of a line (two or more parts joined by +).
const COMBINED_AMOUNT_RE = new RegExp(`^${AMOUNT}\\s+[A-Za-z]+\\.?(?:\\s*\\+\\s*${AMOUNT}\\s+[A-Za-z]+\\.?)+\\s+`);
const isCombinedAmount = (s) => (s.match(/[A-Za-z]+/g) || []).every((w) => UNIT_ALIASES[w.toLowerCase()]);

export function isPantryLine(line, names) {
  if (!names || !names.size) return false;
  let text = String(line).trim();
  // A Combined-view amount ("3/4 cup + 2 tbsp butter") is still one ingredient.
  const sum = text.match(COMBINED_AMOUNT_RE);
  if (sum && isCombinedAmount(sum[0])) text = text.slice(sum[0].length);
  if (/[():+]/.test(text)) return false;
  // Drop a leading amount and unit.
  text = text.replace(/^(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+/, '');
  const u = text.match(/^([A-Za-z]+)\.?\s+/);
  if (u && UNIT_ALIASES[u[1].toLowerCase()] && !['can', 'cans', 'jar', 'jars'].includes(u[1].toLowerCase())) text = text.slice(u[0].length);
  if (/\d/.test(text)) return false;
  const pieces = text.split(/\s*,\s*|\s+and\s+/i).filter(Boolean);
  if (!pieces.length) return false;
  // A single trailing prep word ("butter, softened") is fine.
  const items = pieces.filter((p, i) => !(i > 0 && PREP_WORDS.has(p.toLowerCase())));
  return items.every((p) => names.has(bareName(p)));
}
