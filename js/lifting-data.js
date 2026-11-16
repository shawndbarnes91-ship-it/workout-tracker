// Shared lifting data: loads the workout tables and answers the questions the
// screens ask (exercises in a category, last time for an exercise, next template).

import { all } from './db.js';
import { sortBy, ts } from './util.js';
import { TEMPLATE_A, TEMPLATE_B } from './seed.js';

export const LOAD_TYPES = [
  { value: 'plates', label: 'Plates (bar or sled + plates)' },
  { value: 'machine', label: 'Machine stack (lb)' },
  { value: 'dumbbell', label: 'Dumbbells (lb per dumbbell)' },
  { value: 'cable', label: 'Cable (lb)' },
  { value: 'bodyweight', label: 'Bodyweight (added lb)' },
];

export const loadLabel = (t) => ({ plates: 'lb total', machine: 'lb', dumbbell: 'lb each', cable: 'lb', bodyweight: 'added lb' }[t] || 'lb');
export const loadStep = (t) => (t === 'cable' ? 2.5 : 5);

export async function loadLifting() {
  const [categories, exercises, links, templates, slots, sessions, sets] = await Promise.all([
    all('categories'), all('exercises'), all('exercise_categories'), all('templates'),
    all('template_slots'), all('sessions'), all('sets'),
  ]);
  const d = {
    categories: [...categories].sort((a, b) =>
      (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.name.localeCompare(b.name)),
    exercises,
    links,
    templates: [...templates].sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99)),
    slots,
    sessions,
    sets,
  };
  d.exById = new Map(exercises.map((e) => [e.id, e]));
  d.catById = new Map(categories.map((c) => [c.id, c]));
  d.tplById = new Map(templates.map((t) => [t.id, t]));
  d.sessionById = new Map(sessions.map((s) => [s.id, s]));
  d.catsByEx = new Map();
  d.exsByCat = new Map();
  for (const l of links) {
    const ex = d.exById.get(l.exercise_id);
    if (!ex || !d.catById.has(l.category_id)) continue;
    if (!d.catsByEx.has(ex.id)) d.catsByEx.set(ex.id, []);
    if (!d.catsByEx.get(ex.id).includes(l.category_id)) d.catsByEx.get(ex.id).push(l.category_id);
    if (!d.exsByCat.has(l.category_id)) d.exsByCat.set(l.category_id, []);
    if (!d.exsByCat.get(l.category_id).includes(ex)) d.exsByCat.get(l.category_id).push(ex);
  }
  for (const [k, list] of d.exsByCat) d.exsByCat.set(k, [...list].sort((a, b) => a.name.localeCompare(b.name)));
  d.slotsByTpl = new Map();
  for (const s of slots) {
    if (!d.slotsByTpl.has(s.template_id)) d.slotsByTpl.set(s.template_id, []);
    d.slotsByTpl.get(s.template_id).push(s);
  }
  for (const [k, list] of d.slotsByTpl) d.slotsByTpl.set(k, [...list].sort((a, b) => a.position - b.position));
  return d;
}

/** Non-archived exercises in a category, plus the given one even if archived. */
export function exercisesFor(d, categoryId, keepId) {
  const list = (d.exsByCat.get(categoryId) || []).filter((e) => !e.archived || e.id === keepId);
  if (keepId && !list.some((e) => e.id === keepId) && d.exById.has(keepId)) list.push(d.exById.get(keepId));
  return list;
}

/** Sessions that have at least one logged set. */
export function sessionsWithSets(d) {
  const has = new Set(d.sets.map((s) => s.session_id));
  return d.sessions.filter((s) => has.has(s.id));
}

/** A or B: whichever was not done last. Freestyle sessions do not count. */
export function suggestedTemplateId(d) {
  const ab = sortBy(
    d.sessions.filter((s) => s.template_id === TEMPLATE_A || s.template_id === TEMPLATE_B),
    (s) => ts(s.started_at),
    true
  );
  const last = ab[0];
  if (!last) return TEMPLATE_A;
  return last.template_id === TEMPLATE_A ? TEMPLATE_B : TEMPLATE_A;
}

export function templateLabel(d, templateId) {
  if (!templateId) return 'Freestyle';
  const t = d.tplById.get(templateId);
  return t ? `Workout ${t.name}` : 'Workout';
}

/**
 * Sets from the last earlier session that used this exercise. If that session used it in
 * the same slot, only those sets are returned, so two slots with one exercise stay apart.
 */
export function lastTime(d, exerciseId, currentSessionId, slotId) {
  const prior = d.sets.filter((s) => s.exercise_id === exerciseId && s.session_id !== currentSessionId);
  if (!prior.length) return null;
  const latest = prior.reduce((a, b) => (ts(b.logged_at) > ts(a.logged_at) ? b : a));
  const sessionSets = prior.filter((s) => s.session_id === latest.session_id);
  const sameSlot = slotId ? sessionSets.filter((s) => s.slot_id === slotId) : [];
  const list = (sameSlot.length ? sameSlot : sessionSets).sort((a, b) => (a.set_number - b.set_number) || (ts(a.logged_at) - ts(b.logged_at)));
  const session = d.sessionById.get(latest.session_id);
  return { sets: list, when: session ? session.started_at : latest.logged_at };
}

/** Heaviest set; ties go to more reps. */
export function topSet(sets) {
  let top = null;
  for (const s of sets) {
    const w = Number(s.weight_lb) || 0;
    if (!top || w > top.weight_lb || (w === top.weight_lb && s.reps > top.reps)) top = s;
  }
  return top;
}

/**
 * A session's extras_json holds two kinds of entries: plain exercise ids (exercises
 * added to that session) and today-only changes to a slot, stored as objects:
 * { slot: <slot id or "x:<exercise id>">, swap?: <exercise id>, skip?: true, sets?: <n> }.
 * Older builds read only the plain ids and ignore the objects, so sync stays compatible.
 */
export function sessionPlan(session) {
  let raw = session ? session.extras_json : null;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (e) { raw = []; }
  }
  if (!Array.isArray(raw)) raw = [];
  const plan = { extras: [], tweaks: new Map() };
  for (const x of raw) {
    if (typeof x === 'string') {
      if (!plan.extras.includes(x)) plan.extras.push(x);
    } else if (x && typeof x === 'object' && typeof x.slot === 'string') {
      plan.tweaks.set(x.slot, { ...(plan.tweaks.get(x.slot) || {}), ...x });
    }
  }
  return plan;
}

/** The plan back to its extras_json form; empty changes are dropped. */
export function planJson(plan) {
  const tweaks = [];
  for (const [slot, t] of plan.tweaks) {
    const o = { slot };
    if (t.swap) o.swap = t.swap;
    if (t.skip) o.skip = true;
    if (t.sets) o.sets = t.sets;
    if (o.swap || o.skip || o.sets) tweaks.push(o);
  }
  return [...plan.extras, ...tweaks];
}

/**
 * The exercise most recently used in this slot in an earlier session. Sessions where the
 * slot was swapped are ignored, so a swap lasts that day only.
 */
export function lastExerciseForSlot(d, slotId, currentSessionId) {
  const swapped = new Set();
  for (const s of d.sessions) {
    const t = sessionPlan(s).tweaks.get(slotId);
    if (t && t.swap) swapped.add(s.id);
  }
  const prior = d.sets.filter((s) => s.slot_id === slotId && s.session_id !== currentSessionId && !swapped.has(s.session_id));
  if (!prior.length) return null;
  const latest = prior.reduce((a, b) => (ts(b.logged_at) > ts(a.logged_at) ? b : a));
  const ex = d.exById.get(latest.exercise_id);
  return ex && !ex.archived ? ex.id : null;
}

/** Muscle group of a set: the slot's category, else the exercise's first category. */
export function muscleGroupOfSet(d, set) {
  let catId = null;
  if (set.slot_id) {
    const slot = d.slots.find((s) => s.id === set.slot_id);
    if (slot) catId = slot.category_id;
  }
  if (!catId) {
    const cats = d.catsByEx.get(set.exercise_id) || [];
    catId = cats[0];
  }
  const cat = d.catById.get(catId);
  return (cat && (cat.muscle_group || cat.name)) || 'Other';
}
