// "Money saved": cost at home vs. a typical restaurant price (estimate), per serving.
// Recipes are looked up by their id, "<pack>:<number>" (r.rid).
import { COST_PER_SERVING, SERVINGS } from '../data/costs.js';
import { RESTAURANT_PRICES } from '../data/restaurant-prices.js';

const costs = { ...COST_PER_SERVING };
const servingsMap = { ...SERVINGS };
const prices = { ...RESTAURANT_PRICES };

// Test mode only (tests/fixtures/test-config.json): estimates for the fake test recipes.
export function addEstimates({ restaurantPrices, costPerServing, servings } = {}) {
  Object.assign(prices, restaurantPrices || {});
  Object.assign(costs, costPerServing || {});
  Object.assign(servingsMap, servings || {});
}

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
  if (costs[r.rid] != null) return Number(costs[r.rid]);
  return parseCostText(r.cost);
}

export function hasManualCost(r) {
  return costs[r.rid] != null;
}

export function restaurantPrice(r) {
  const p = prices[r.rid];
  return p == null ? null : Number(p);
}

// Servings one batch makes at ×1.
export function baseServings(r) {
  if (servingsMap[r.rid] != null) return Number(servingsMap[r.rid]);
  const s = String(r.serves).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

// Money for one planned meal: { servings, home, restaurant, saved, priced } in dollars.
// priced is false when the recipe has no restaurant estimate or home cost yet;
// then it counts as $0 everywhere (never a made-up number).
export function mealMoney(r, factor = 1) {
  const servings = baseServings(r) * factor;
  const h = homeCost(r);
  const p = restaurantPrice(r);
  if (h == null || p == null) return { servings, home: 0, restaurant: 0, saved: 0, priced: false };
  const home = h * servings;
  const restaurant = p * servings;
  return { servings, home, restaurant, saved: Math.max(0, restaurant - home), priced: true };
}

// "$1,234" (whole dollars; the numbers are rough anyway)
export function dollars(x) {
  return '$' + Math.round(x || 0).toLocaleString('en-US');
}
