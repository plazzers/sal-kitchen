// Recipe references: before v3 a recipe was saved by its number (5). Since v3 there are
// several recipe packs, so a recipe is saved as "<pack>:<number>" ("copycat:5").
// These helpers turn anything the older app saved into the new form. They never drop data,
// and running them twice changes nothing.

export const LEGACY_PACK = 'copycat';

const RID_RE = /^[a-z][a-z0-9-]*:\d+$/;

export function isRid(x) {
  return typeof x === 'string' && RID_RE.test(x);
}

// 5 → "copycat:5", "5" → "copycat:5", "italian:3" stays. Anything else → null.
export function toRid(x) {
  if (typeof x === 'number' && Number.isInteger(x) && x > 0) return `${LEGACY_PACK}:${x}`;
  if (typeof x === 'string') {
    const s = x.trim();
    if (/^\d+$/.test(s) && Number(s) > 0) return `${LEGACY_PACK}:${Number(s)}`;
    if (isRid(s)) return s;
  }
  return null;
}

export function ridParts(rid) {
  const i = String(rid).lastIndexOf(':');
  return { pack: rid.slice(0, i), num: Number(rid.slice(i + 1)) };
}

export function migrateFavorites(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((x) => {
    const rid = toRid(x);
    if (rid && !out.includes(rid)) out.push(rid);
  });
  return out;
}

export function migrateShopping(s) {
  if (!s || !Array.isArray(s.groups) || !Array.isArray(s.custom)) return s;
  return {
    ...s,
    groups: s.groups.map((g) => {
      if (!g || typeof g !== 'object') return g;
      const out = { ...g };
      const rid = toRid(g.rid != null ? g.rid : g.recipeNum);
      if (rid) out.rid = rid;
      delete out.recipeNum;
      return out;
    }),
  };
}

// { num: 5, ticks, done, factor } → { rid: "copycat:5", ticks, done, factor }. null when unusable.
export function migrateProgress(p) {
  if (!p || typeof p !== 'object') return null;
  const rid = toRid(p.rid != null ? p.rid : p.num);
  if (!rid) return null;
  const out = { rid, ...p };
  out.rid = rid;
  delete out.num;
  return out;
}

function migrateSlot(slot) {
  if (!slot || typeof slot !== 'object') return slot;
  const rid = toRid(slot.rid != null ? slot.rid : slot.num);
  if (!rid) return slot;
  const out = { ...slot, rid };
  delete out.num;
  return out;
}

export function migratePlanWeek(w) {
  if (!w || !w.days || typeof w.days !== 'object') return w;
  const days = {};
  Object.keys(w.days).forEach((date) => {
    const day = w.days[date];
    if (!day || typeof day !== 'object') { days[date] = day; return; }
    const out = {};
    Object.keys(day).forEach((meal) => { out[meal] = migrateSlot(day[meal]); });
    days[date] = out;
  });
  return { ...w, days };
}

export function migrateSaving(x) {
  if (!x || typeof x !== 'object') return x;
  const rid = toRid(x.rid != null ? x.rid : x.num);
  if (!rid) return x;
  const out = { ...x, rid };
  delete out.num;
  return out;
}

// A whole backup file (any format) → the current shape. Doesn't change `format`.
export function migrateBackup(data) {
  return {
    ...data,
    favorites: migrateFavorites(data.favorites || []),
    shopping: data.shopping ? migrateShopping(data.shopping) : data.shopping,
    progress: (data.progress || []).map(migrateProgress).filter(Boolean),
    plans: Array.isArray(data.plans) ? data.plans.map(migratePlanWeek) : data.plans,
    savings: Array.isArray(data.savings) ? data.savings.map(migrateSaving) : data.savings,
  };
}
