// Recipe scaling: finds the amounts in an ingredient line and multiplies them.
//
// Amounts are looked for only in sensible places:
//   - at the start of the line                "1 1/2 cups warm water"
//   - after a label                           "Topping: 4 tbsp melted butter"
//   - after ", "  " + "  " and "  " with "    "..., 1/2 tsp salt" / "4 tbsp butter + 2 tbsp olive oil"
//   - after "into", "juice of", "zest of"     "halved into 4 cutlets" / "Juice of 1 lemon"
//   - after "(" "(about " "(or "              "(1 packet)" / "(or 1 tsp dried)"
// Never scaled: temperatures (110°F), sizes (1/4 inch, 7-inch, 9x13), times, "pinch".
// Can sizes stay the same; the number of cans changes ("2 × 28 oz cans").

const UNICODE_FRACTIONS = { '½': 1 / 2, '¼': 1 / 4, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };
const UF = '½¼¾⅓⅔⅛⅜⅝⅞';

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const NUMBER_WORDS = Object.fromEntries(Object.entries(WORD_NUMBERS).map(([w, n]) => [n, w]));

// One number: "1 1/2", "1/4", "2", "1.5", "1½", "1 ½", "½"
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?(?:\\s?[${UF}])?|[${UF}])`;
// A number or a range: "2-3", "2 – 3", "2 to 3"
const QTY_RE = new RegExp(`(${NUM})(?:(\\s*(?:-|–|—|\\bto\\b)\\s*)(${NUM}))?`, 'y');
const WORD_QTY_RE = new RegExp(`(${Object.keys(WORD_NUMBERS).join('|')})\\b`, 'iy');

// Places where an amount may start.
const LABEL_RE = /^\s*[A-Z][A-Za-z ]{0,24}:\s+/;
const ABOUT_RE = /^\s*about\s+/i;
const SPLIT_RE = /(, |\s\+\s|\sand\s|\swith\s|\binto\s|\bjuice of\s|\bzest of\s|\((?:about\s|or\s)?)/gi;

// Things right after a number that mean "don't scale this".
const NO_SCALE_AFTER = /^(?:\s*(?:°|º|degrees?\b|%|x\s*\d|×\s*\d|"|inch(?:es)?\b|in\.|-inch|-in\b|-oz\b|minutes?\b|mins?\b|hours?\b|hrs?\b|seconds?\b|secs?\b))/i;
const CAN_AFTER = /^\s*(?:oz|ounce|-ounce|-oz)\.?\s+(cans?)\b/i;

// Words that change between one and many. Units first: when the first word is a unit, only it changes.
const UNITS = {
  cup: 'cups', clove: 'cloves', slice: 'slices', can: 'cans', head: 'heads', heart: 'hearts', stalk: 'stalks',
  sprig: 'sprigs', packet: 'packets', stick: 'sticks', quart: 'quarts', pint: 'pints', jar: 'jars', bunch: 'bunches',
  handful: 'handfuls', package: 'packages', box: 'boxes', bag: 'bags', piece: 'pieces',
};
const INVARIANT_UNITS = new Set(['tbsp', 'tsp', 'oz', 'lb', 'lbs', 'g', 'kg', 'ml', 'l', 'tablespoons', 'teaspoons', 'tablespoon', 'teaspoon', 'pound', 'pounds', 'ounce', 'ounces', 'pinch', 'dash']);
const NOUNS = {
  egg: 'eggs', yolk: 'yolks', white: 'whites', breast: 'breasts', thigh: 'thighs', steak: 'steaks', bun: 'buns', tortilla: 'tortillas',
  lemon: 'lemons', lime: 'limes', orange: 'oranges', onion: 'onions', 'jalapeño': 'jalapeños', jalapeno: 'jalapenos',
  pepper: 'peppers', potato: 'potatoes', tomato: 'tomatoes', leaf: 'leaves', ladyfinger: 'ladyfingers', cutlet: 'cutlets',
  ball: 'balls', carrot: 'carrots', shallot: 'shallots', strip: 'strips', wing: 'wings', roll: 'rolls', biscuit: 'biscuits',
  burger: 'burgers', patty: 'patties', apple: 'apples', banana: 'bananas', avocado: 'avocados', chile: 'chiles', chili: 'chilies',
  ...UNITS,
};
const SINGULAR = Object.fromEntries(Object.entries(NOUNS).map(([s, p]) => [p, s]));

// ---------- Numbers ----------

export function parseNumber(s) {
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + +m[2] / +m[3];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return +m[1] / +m[2];
  if ((m = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s?([${UF}])$`)))) return +m[1] + UNICODE_FRACTIONS[m[2]];
  if (UNICODE_FRACTIONS[s] != null) return UNICODE_FRACTIONS[s];
  if (/^\d+(?:\.\d+)?$/.test(s)) return +s;
  const w = WORD_NUMBERS[s.toLowerCase()];
  return w == null ? NaN : w;
}

const FRACTIONS = [
  [0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4'], [1, ''],
];

// Round to a kitchen-friendly amount. Returns { value, text }.
export function kitchenNumber(x) {
  if (!(x > 0)) return { value: 0, text: '0' };
  if (x >= 10) {
    // Big numbers: whole numbers, or a half when it really is one.
    const half = Math.round(x * 2) / 2;
    const whole = Math.round(x);
    const v = Math.abs(x - whole) < 0.15 ? whole : half;
    const w = Math.floor(v);
    return { value: v, text: v === w ? String(w) : `${w} 1/2` };
  }
  let whole = Math.floor(x);
  const frac = x - whole;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
  let fracText = best[1];
  let value = whole + best[0];
  if (best[0] === 1) { whole += 1; fracText = ''; value = whole; }
  if (whole === 0 && !fracText) { fracText = '1/8'; value = 1 / 8; } // never round a real amount down to nothing
  const text = whole && fracText ? `${whole} ${fracText}` : whole ? String(whole) : fracText;
  return { value, text };
}

// ---------- Words ----------

function matchCase(word, like) {
  if (like === like.toUpperCase() && like !== like.toLowerCase()) return word.toUpperCase();
  if (like[0] === like[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

// Change "cups"→"cup" or "clove"→"cloves" in the words after an amount, when needed.
function inflectAfter(rest, plural) {
  let offset = 0;
  // Skip a size like "28 oz " (as in "Two 28 oz cans").
  const size = rest.match(/^\s*\d+(?:\.\d+)?\s*(?:oz|ounce|-ounce|-oz)\.?(?=\s)/i);
  if (size) offset = size[0].length;
  const words = [];
  const wordRe = /\s*([A-Za-zÀ-ÿñ]+)/y;
  wordRe.lastIndex = offset;
  let m;
  while (words.length < 4 && (m = wordRe.exec(rest))) {
    const w = m[1];
    if (/^(and|or|with|of|in|for|to|plus)$/i.test(w)) break;
    words.push({ word: w, start: m.index + m[0].length - w.length });
    const next = rest.slice(wordRe.lastIndex, wordRe.lastIndex + 1);
    if (next && !/\s/.test(next)) break; // stop at a comma, bracket, hyphen…
  }
  if (!words.length) return rest;

  const lower = (w) => w.toLowerCase();
  const isNoun = (w) => NOUNS[lower(w)] != null || SINGULAR[lower(w)] != null;
  let target = -1;
  const first = lower(words[0].word);
  if (INVARIANT_UNITS.has(first)) return rest;
  if (UNITS[first] != null || SINGULAR[first] && UNITS[SINGULAR[first]] != null) target = 0;
  else {
    for (let i = 0; i < Math.min(3, words.length); i++) {
      if (isNoun(words[i].word)) {
        target = i;
        while (target + 1 < words.length && isNoun(words[target + 1].word)) target++; // "egg yolks", "potato buns"
        break;
      }
    }
  }
  if (target < 0) return rest;
  const { word, start } = words[target];
  const lw = lower(word);
  let replacement = null;
  if (plural && NOUNS[lw] != null) replacement = NOUNS[lw];
  else if (!plural && SINGULAR[lw] != null) replacement = SINGULAR[lw];
  if (!replacement) return rest;
  return rest.slice(0, start) + matchCase(replacement, word) + rest.slice(start + word.length);
}

// ---------- Spoons and cups ----------

const near = (x, y) => Math.abs(x - y) < 1e-6;

// Returns { text, unit } when a different unit reads better, otherwise null.
function convertUnit(v, unit) {
  const out = (val, u) => {
    const k = kitchenNumber(val);
    const word = u === 'cup' ? (k.value > 1 ? 'cups' : 'cup') : u;
    return { text: k.text, unit: word };
  };
  if (unit === 'cup' && v < 0.25 - 1e-6) {
    const tbsp = v * 16;
    return tbsp < 1 - 1e-6 ? out(tbsp * 3, 'tsp') : out(tbsp, 'tbsp');
  }
  if (unit === 'tbsp') {
    if (v < 1 - 1e-6) return out(v * 3, 'tsp');
    if (v >= 4 - 1e-6 && near(v / 4, Math.round(v / 4))) return out(v / 16, 'cup');
    if (v > 8 + 1e-6) {
      // 18 tbsp → "1 cup + 2 tbsp"
      const quarters = Math.floor(v / 4 + 1e-6);
      const cups = out(quarters / 4, 'cup');
      const rest = kitchenNumber(v - quarters * 4);
      return { text: `${cups.text} ${cups.unit} + ${rest.text}`, unit: 'tbsp' };
    }
  }
  if (unit === 'tsp' && v >= 3 - 1e-6 && near(v / 3, Math.round(v / 3))) return out(v / 3, 'tbsp');
  return null;
}

// ---------- Main ----------

function startPositions(line) {
  const pos = new Set([0]);
  let m = line.match(LABEL_RE);
  if (m) pos.add(m[0].length);
  m = line.match(ABOUT_RE);
  if (m) pos.add(m[0].length);
  SPLIT_RE.lastIndex = 0;
  while ((m = SPLIT_RE.exec(line))) pos.add(m.index + m[0].length);
  return [...pos].sort((a, b) => a - b);
}

// Returns an array of parts: { text, scaled } — "scaled" parts are the changed amounts.
export function scaleLineParts(line, factor) {
  line = String(line);
  if (!factor || Math.abs(factor - 1) < 1e-9) return [{ text: line, scaled: false }];

  const edits = []; // { start, end, text, wordEnd? }
  let blockedUntil = -1;
  for (const p of startPositions(line)) {
    if (p < blockedUntil) continue;
    // Amount written as a word: "Two 28 oz cans"
    WORD_QTY_RE.lastIndex = p;
    let m = p === 0 || line[p - 1] === ' ' ? WORD_QTY_RE.exec(line) : null;
    if (m && p === 0 || m && LABEL_RE.test(line) && p === line.match(LABEL_RE)[0].length) {
      const base = WORD_NUMBERS[m[1].toLowerCase()];
      const k = kitchenNumber(base * factor);
      const asWord = Number.isInteger(k.value) && NUMBER_WORDS[k.value];
      const text = asWord ? matchCase(asWord, m[1]) : k.text;
      edits.push({ start: p, end: p + m[0].length, text, plural: k.value > 1 });
      blockedUntil = p + m[0].length;
      continue;
    }
    QTY_RE.lastIndex = p;
    m = QTY_RE.exec(line);
    if (!m) continue;
    const end = p + m[0].length;
    // Don't grab the start of a bigger token like "80/20" or "9x13"
    if (/^[\d/]/.test(line.slice(end, end + 1))) continue;
    const after = line.slice(end);
    if (NO_SCALE_AFTER.test(after)) continue;
    if (/^\s*pinch/i.test(after)) continue;

    const can = after.match(CAN_AFTER);
    if (can) {
      // "28 oz can whole tomatoes" → keep the can size, change how many cans.
      const k = kitchenNumber(factor);
      const sizeText = line.slice(p, end + can[0].length - can[1].length).trimEnd();
      const article = /^(8|11|18|80)\b/.test(sizeText) ? 'an' : 'a';
      const text = k.value > 1 ? `${k.text} × ${sizeText} cans` : `${k.text} of ${article} ${sizeText} can`;
      edits.push({ start: p, end: end + can[0].length, text, plural: null });
      blockedUntil = end + can[0].length;
      continue;
    }

    const a = parseNumber(m[1]);
    if (!(a > 0)) continue;

    // Single amounts in cups / tbsp / tsp: switch to an easier spoon or cup when it helps.
    const unit = !m[3] && after.match(/^(\s*)(cups?|tbsp|tsp)\b/i);
    if (unit) {
      const conv = convertUnit(a * factor, unit[2].toLowerCase().startsWith('cup') ? 'cup' : unit[2].toLowerCase());
      if (conv) {
        edits.push({ start: p, end: end + unit[0].length, text: `${conv.text}${unit[1] || ' '}${conv.unit}`, plural: null });
        blockedUntil = end + unit[0].length;
        continue;
      }
    }

    const ka = kitchenNumber(a * factor);
    let text = ka.text;
    let top = ka.value;
    if (m[3]) {
      const b = parseNumber(m[3]);
      if (!(b > 0)) continue;
      const kb = kitchenNumber(b * factor);
      text = ka.text === kb.text ? ka.text : `${ka.text}${m[2]}${kb.text}`;
      top = kb.value;
    }
    edits.push({ start: p, end, text, plural: top > 1 });
    blockedUntil = end;
  }

  if (!edits.length) return [{ text: line, scaled: false }];

  // Build the result, fixing "cup/cups" etc. in the text after each changed amount.
  const parts = [];
  let cursor = 0;
  edits.forEach((e, i) => {
    if (e.start > cursor) parts.push({ text: line.slice(cursor, e.start), scaled: false });
    parts.push({ text: e.text, scaled: true });
    const nextStart = i + 1 < edits.length ? edits[i + 1].start : line.length;
    let rest = line.slice(e.end, nextStart);
    if (e.plural !== null) rest = inflectAfter(rest, e.plural);
    parts.push({ text: rest, scaled: false });
    cursor = nextStart;
  });
  if (cursor < line.length) parts.push({ text: line.slice(cursor), scaled: false });
  return parts.filter((x) => x.text !== '');
}

export function scaleLine(line, factor) {
  return scaleLineParts(line, factor).map((p) => p.text).join('');
}

// "×2", "×1/2", "×1 1/2"
export function factorLabel(f) {
  return '×' + kitchenNumber(f).text;
}
