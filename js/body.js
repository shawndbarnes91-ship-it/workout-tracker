// Body data helpers (pure, no DOM; tested in tests/calories.test.mjs).
//
// One bodyweight row per day. New rows use an id built from the date, so two entries
// for the same day land on the same row and last write wins. Older rows keep their
// random ids; when two rows share a date, the newest one (updated_at) counts.

/** Id for a day's bodyweight row: b0d1e000-0000-4000-8000-0000YYYYMMDD. */
export function bodyweightIdFor(date) {
  const d = String(date || '').slice(0, 10).replace(/-/g, '');
  if (!/^\d{8}$/.test(d)) throw new Error(`Bad date: ${date}`);
  return `b0d1e000-0000-4000-8000-0000${d}`;
}

/** Body fat as a percent; a fraction (0.2) from Apple Health becomes 20. Null when unusable. */
export function normBodyFat(v) {
  if (v == null || v === '') return null;
  let n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1) n *= 100;
  return n >= 2 && n <= 75 ? Math.round(n * 10) / 10 : null;
}

const stamp = (r) => Date.parse(r.updated_at || '') || 0;

/** Live rows, one per date (the newest wins), newest date first. */
export function oneBodyweightPerDay(rows) {
  const byDate = new Map();
  for (const r of rows || []) {
    if (!r || r.deleted || !r.date || !(Number(r.weight_lb) > 0)) continue;
    const cur = byDate.get(r.date);
    if (!cur || stamp(r) > stamp(cur)) byDate.set(r.date, r);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** { 'YYYY-MM-DD': percent } from the rows that carry body fat. */
export function bodyFatByDate(rows) {
  const out = {};
  for (const r of oneBodyweightPerDay(rows)) {
    const bf = normBodyFat(r.body_fat_pct);
    if (bf != null) out[r.date] = bf;
  }
  return out;
}

/** Newest row on or before day, or null. */
export function latestReading(rows, day = '9999-12-31') {
  return oneBodyweightPerDay(rows).find((r) => r.date <= day) || null;
}
