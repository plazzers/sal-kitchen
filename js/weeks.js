// Dates for the planner. A day is a plain "YYYY-MM-DD" string in the device's local time.
// Plans are saved per ISO week ("2026-W41": weeks start on Monday, week 1 holds the year's first Thursday).

const pad = (n) => String(n).padStart(2, '0');

export function toDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Noon avoids daylight-saving surprises when adding days.
export function fromDay(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function today() {
  return toDay(new Date());
}

export function addDays(s, n) {
  const d = fromDay(s);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

// 0 = Monday … 6 = Sunday
export function weekdayIndex(s) {
  return (fromDay(s).getDay() + 6) % 7;
}

export function isoWeekKey(s) {
  const d = fromDay(s);
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7), 12);
  const year = thursday.getFullYear();
  const jan1 = new Date(year, 0, 1, 12);
  const dayOfYear = Math.round((thursday - jan1) / 86400000); // 0-based
  return `${year}-W${pad(Math.floor(dayOfYear / 7) + 1)}`;
}

// First day of the week holding `s`. weekStart: 'mon' or 'sun'.
export function startOfWeek(s, weekStart = 'mon') {
  if (weekStart === 'sun') return addDays(s, -(fromDay(s).getDay()));
  return addDays(s, -weekdayIndex(s));
}

export function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function dayName(s) {
  return fromDay(s).toLocaleDateString('en-US', { weekday: 'long' });
}

export function shortDate(s) {
  return fromDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// "Oct 5 – 11" or "Sep 28 – Oct 4"
export function rangeLabel(start) {
  const end = addDays(start, 6);
  const a = fromDay(start);
  const b = fromDay(end);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = shortDate(start);
  const right = sameMonth ? String(b.getDate()) : shortDate(end);
  const year = b.getFullYear() !== new Date().getFullYear() ? `, ${b.getFullYear()}` : '';
  return `${left} – ${right}${year}`;
}
