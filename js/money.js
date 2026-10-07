// "Money saved": cost at home vs. a typical restaurant price (estimate), per serving.
import { COST_PER_SERVING, SERVINGS } from '../data/costs.js';
import { RESTAURANT_PRICES } from '../data/restaurant-prices.js';

const PER_SERVING_WORDS = 'plate|serving|bowl|steak|burger|sandwich|piece|cake|portion';
const PER_SERVING_RE = new RegExp(`\\$\\s*(\\d+(?:\\.\\d+)?)\\s*(?:per|a|each)\\s+(?:${PER_SERVING_WORDS})\\b`, 'i');

// "about $2.50 per plate" → 2.5. Returns null when the text isn't per serving
// ("each", "per pancake", "for the whole batch", just "$1.50").
export function parseCostText(text) {
  const m = String(text || '').match(PER_SERVING_RE);
  return m ? Number(m[1]) : null;
}

// Cost at home for one serving. Manual estimates in data/costs.js win.
export function homeCost(r) {
  if (COST_PER_SERVING[r.num] != null) return Number(COST_PER_SERVING[r.num]);
  return parseCostText(r.cost);
}

export function restaurantPrice(r) {
  const p = RESTAURANT_PRICES[r.num];
  return p == null ? null : Number(p);
}

// Servings one batch makes at ×1.
export function baseServings(r) {
  if (SERVINGS[r.num] != null) return Number(SERVINGS[r.num]);
  const s = String(r.serves).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

// Money for one planned meal: { servings, home, restaurant, saved } in dollars.
export function mealMoney(r, factor = 1) {
  const servings = baseServings(r) * factor;
  const home = (homeCost(r) || 0) * servings;
  const restaurant = (restaurantPrice(r) || 0) * servings;
  return { servings, home, restaurant, saved: Math.max(0, restaurant - home) };
}

// "$1,234" (whole dollars; the numbers are rough anyway)
export function dollars(x) {
  return '$' + Math.round(x || 0).toLocaleString('en-US');
}
