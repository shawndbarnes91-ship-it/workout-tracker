// Personal records. Lifting: heaviest weight, most reps at a given weight, best
// estimated one-rep max (Epley). Runs: longest distance and best pace.

import { e1rm, ts, sortBy, fmtLb, round1, fmtPace } from './util.js';

const chrono = (sets) => sortBy(sets, (s) => ts(s.logged_at));

function emptyBests() {
  return { maxW: -Infinity, repsAt: new Map(), maxE1: 0, count: 0 };
}

function addToBests(b, s) {
  const w = Number(s.weight_lb) || 0;
  const r = Number(s.reps) || 0;
  b.maxW = Math.max(b.maxW, w);
  b.repsAt.set(w, Math.max(b.repsAt.get(w) || 0, r));
  b.maxE1 = Math.max(b.maxE1, e1rm(w, r));
  b.count += 1;
}

/** Which records a new set would break, compared with all earlier sets of that exercise. */
export function detectPRs(priorSets, weight, reps) {
  const b = emptyBests();
  for (const s of priorSets) addToBests(b, s);
  return compare(b, Number(weight) || 0, Number(reps) || 0);
}

function compare(b, w, r) {
  if (b.count === 0 || r <= 0) return [];
  const out = [];
  if (w > b.maxW && w > 0) out.push({ kind: 'weight', text: `Heaviest weight: ${fmtLb(w)} lb` });
  if (b.repsAt.has(w) && r > b.repsAt.get(w)) out.push({ kind: 'reps', text: `Most reps at ${fmtLb(w)} lb: ${r}` });
  const e = e1rm(w, r);
  if (e > 0 && e > b.maxE1 + 1e-9) out.push({ kind: 'e1rm', text: `Best e1RM: ${round1(e)} lb` });
  return out;
}

/** Ids of sets that set any record at the moment they were logged. */
export function prSetIds(sets) {
  const byEx = new Map();
  for (const s of sets) {
    if (!byEx.has(s.exercise_id)) byEx.set(s.exercise_id, []);
    byEx.get(s.exercise_id).push(s);
  }
  const ids = new Set();
  for (const list of byEx.values()) {
    const b = emptyBests();
    for (const s of chrono(list)) {
      if (compare(b, Number(s.weight_lb) || 0, Number(s.reps) || 0).length) ids.add(s.id);
      addToBests(b, s);
    }
  }
  return ids;
}

/** Current records for one exercise. */
export function exerciseRecords(sets) {
  if (!sets.length) return null;
  let heaviest = null;
  let best = null;
  for (const s of sets) {
    const w = Number(s.weight_lb) || 0;
    const e = e1rm(w, s.reps);
    if (!heaviest || w > heaviest.weight_lb || (w === heaviest.weight_lb && s.reps > heaviest.reps)) heaviest = s;
    if (!best || e > best.e1) best = { set: s, e1: e };
  }
  return { heaviest, bestE1: best };
}

/* ---------- runs ---------- */

export const runPace = (r) => (r.distance_mi > 0 && r.duration_sec > 0 ? r.duration_sec / r.distance_mi : null);

export function runRecords(runs) {
  let longest = null;
  let fastest = null;
  for (const r of runs) {
    if (r.type !== 'run') continue;
    if (r.distance_mi > 0 && (!longest || r.distance_mi > longest.distance_mi)) longest = r;
    const p = runPace(r);
    if (p && (!fastest || p < runPace(fastest))) fastest = r;
  }
  return { longest, fastest };
}

/** Records a new run breaks compared with earlier runs. */
export function detectRunPRs(priorRuns, run) {
  const prior = priorRuns.filter((r) => r.type === 'run');
  if (!prior.length || run.type !== 'run') return [];
  const { longest, fastest } = runRecords(prior);
  const out = [];
  if (run.distance_mi > 0 && (!longest || run.distance_mi > longest.distance_mi)) {
    out.push({ kind: 'distance', text: `Longest run: ${round1(run.distance_mi)} mi` });
  }
  const p = runPace(run);
  if (p && (!fastest || p < runPace(fastest))) out.push({ kind: 'pace', text: `Best pace: ${fmtPace(p)}` });
  return out;
}

/** Ids of runs that were a record when logged (for chart markers). */
export function runPrIds(runs) {
  const ids = new Set();
  const seen = [];
  for (const r of sortBy(runs.filter((x) => x.type === 'run'), (x) => x.date + (x.updated_at || ''))) {
    if (detectRunPRs(seen, r).length) ids.add(r.id);
    seen.push(r);
  }
  return ids;
}
