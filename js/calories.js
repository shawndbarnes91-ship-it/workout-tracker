// Calorie estimates. Pure functions, no DOM, so node can test them (tests/calories.test.mjs).
//
// Active (from logged training), using the latest bodyweight on or before the day:
//   lifting      = MET 5.0 x kg x hours (start to finish, capped at 3 h; with no finish
//                  time, 2.5 min per logged set: about 1 min of work plus 1.5 min rest)
//   run          = 1.0 kcal per kg per km
//   walking pad  = 0.5 kcal per kg per km, or MET 3.5 x kg x hours when a duration exists
// Resting (Katch-McArdle), using the latest body fat % on or before the day:
//   BMR          = 370 + 21.6 x lean mass kg, lean mass = kg x (1 - body fat)
// Daily total ("Estimated burn") = BMR x NEAT_FACTOR + active.

export const KG_PER_LB = 0.45359237;
export const KM_PER_MI = 1.609344;
export const LIFT_MET = 5.0;
export const PAD_MET = 3.5;
export const RUN_KCAL_PER_KG_KM = 1.0;
export const PAD_KCAL_PER_KG_KM = 0.5;
export const SESSION_CAP_HOURS = 3;
export const MIN_PER_SET_ESTIMATE = 2.5;
/** Light daily movement on top of resting burn (sedentary multiplier). */
export const NEAT_FACTOR = 1.2;

const p2 = (n) => String(n).padStart(2, '0');
/** Local calendar day (YYYY-MM-DD) of an ISO time. */
export function localDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export const lbToKg = (lb) => (Number(lb) || 0) * KG_PER_LB;
export const miToKm = (mi) => (Number(mi) || 0) * KM_PER_MI;

/** Latest bodyweight (lb) logged on or before day, or null. */
export function weightOn(bodyweight, day) {
  let best = null;
  for (const b of bodyweight || []) {
    if (b.deleted || !(Number(b.weight_lb) > 0) || !b.date || b.date > day) continue;
    if (!best || b.date > best.date) best = b;
  }
  return best ? Number(best.weight_lb) : null;
}

/** Latest body fat % on or before day from a { 'YYYY-MM-DD': pct } map, or null. */
export function bodyFatOn(bfByDate, day) {
  let bestDay = null;
  for (const [d, v] of Object.entries(bfByDate || {})) {
    if (d > day || !(Number(v) > 0 && Number(v) < 75)) continue;
    if (!bestDay || d > bestDay) bestDay = d;
  }
  return bestDay ? Number(bfByDate[bestDay]) : null;
}

/** Katch-McArdle resting burn in kcal per day. */
export function bmrKatch(weightLb, bodyFatPct) {
  const lean = lbToKg(weightLb) * (1 - bodyFatPct / 100);
  return 370 + 21.6 * lean;
}

/** Hours of one lifting session. */
export function sessionHours(session, setCount) {
  const start = Date.parse(session && session.started_at);
  const end = Date.parse(session && session.ended_at);
  let hours;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) hours = (end - start) / 3600e3;
  else hours = ((Number(setCount) || 0) * MIN_PER_SET_ESTIMATE) / 60;
  return Math.min(SESSION_CAP_HOURS, Math.max(0, hours));
}

export const liftKcal = (weightLb, hours) => LIFT_MET * lbToKg(weightLb) * hours;

export function cardioKcal(weightLb, entry) {
  const kg = lbToKg(weightLb);
  const km = miToKm(entry.distance_mi);
  if (entry.type === 'run') return RUN_KCAL_PER_KG_KM * kg * km;
  const sec = Number(entry.duration_sec) || 0;
  if (sec > 0) return PAD_MET * kg * (sec / 3600);
  return PAD_KCAL_PER_KG_KM * kg * km;
}

/**
 * Burn for one day. sessions: lifting sessions with { started_at, ended_at, setCount }.
 * Returns { weightLb, bodyFat, active, lift, run, pad, resting, total }. Numbers are kcal;
 * weightLb null means no bodyweight yet (nothing can be estimated); resting and total are
 * null without body fat on file.
 */
export function dailyBurn({ day, bodyweight, bodyFat, sessions = [], runs = [] }) {
  const weightLb = weightOn(bodyweight, day);
  const bf = bodyFatOn(bodyFat, day);
  const out = { day, weightLb, bodyFat: bf, lift: 0, run: 0, pad: 0, active: 0, resting: null, total: null };
  if (weightLb == null) return out;
  for (const s of sessions) {
    if (s.deleted || !s.setCount || localDay(s.started_at) !== day) continue;
    out.lift += liftKcal(weightLb, sessionHours(s, s.setCount));
  }
  for (const r of runs) {
    if (r.deleted || r.date !== day) continue;
    if (r.type === 'run') out.run += cardioKcal(weightLb, r);
    else out.pad += cardioKcal(weightLb, r);
  }
  out.active = out.lift + out.run + out.pad;
  if (bf != null) {
    out.resting = bmrKatch(weightLb, bf) * NEAT_FACTOR;
    out.total = out.resting + out.active;
  }
  return out;
}

/** Sessions with their set counts, ready for dailyBurn. */
export function sessionsForBurn(sessions, sets) {
  const n = new Map();
  for (const s of sets || []) if (!s.deleted) n.set(s.session_id, (n.get(s.session_id) || 0) + 1);
  return (sessions || []).filter((s) => !s.deleted).map((s) => ({ started_at: s.started_at, ended_at: s.ended_at, setCount: n.get(s.id) || 0 }));
}

/** "1,234" */
export const fmtKcal = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
