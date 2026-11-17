// Workout tab: pick A, B or Freestyle, log sets slot by slot with last-time
// display, progression cue, PRs, rest timer and supersets. Also links to
// cardio logging, the exercise library and the template editor.

import { all, save, saveMany, getMeta, setMeta } from './db.js';
import {
  h, add, clear, toast, openSheet, confirmSheet, segmented, stepper, field, nowISO, fmtDay, fmtTime,
  fmtLb, sortBy, ts, emptyNote, plural, pageHead, icon, pad2, recordBanner, fmtDuration,
} from './util.js';
import { installHint } from './install-hint.js';
import { weightOn, sessionHours, liftKcal, fmtKcal, localDay } from './calories.js';
import { oneBodyweightPerDay } from './body.js';
import {
  loadLifting, exercisesFor, suggestedTemplateId, templateLabel, lastTime, topSet,
  lastExerciseForSlot, loadLabel, loadStep, sessionsWithSets, sessionPlan, planJson,
} from './lifting-data.js';
import { detectPRs, prSetIds } from './prs.js';
import { startRest, stop as stopRest, primeAudio } from './timer.js';
import { renderLibrary, openExerciseEditor, openExercisePicker } from './library.js';
import { renderTemplates } from './templates.js';
import { renderCardio } from './cardio.js';

const PLATES = [45, 35, 25, 10, 5, 2.5];
const CURSOR_KEY = 'session_cursor';

let view = 'home'; // home | library | templates | run | walking_pad
let override = null; // template id, or 'free'
let rootEl = null;
let cursor = null; // { sessionId, block, member: {blockIndex: memberIndex}, focusKey }

export async function render(root) {
  rootEl = root;
  const back = () => {
    view = 'home';
    render(root);
  };
  if (view === 'library') return renderLibrary(root, back);
  if (view === 'templates') return renderTemplates(root, back);
  if (view === 'run' || view === 'walking_pad') return renderCardio(root, view, back);
  const d = await loadLifting();
  const active = sortBy(d.sessions.filter((s) => !s.ended_at), (s) => ts(s.started_at), true)[0];
  if (active) return renderSession(root, d, active);
  return renderHome(root, d);
}

const rerender = () => rootEl && render(rootEl);

/* ---------------- home ---------------- */

function blocksForTemplate(d, templateId) {
  return groupSlots(templateId ? d.slotsByTpl.get(templateId) || [] : []);
}

function groupSlots(slots) {
  const blocks = [];
  for (const s of slots) {
    const last = blocks[blocks.length - 1];
    if (s.superset_group != null && last && last.group === s.superset_group) last.slots.push(s);
    else blocks.push({ group: s.superset_group ?? null, slots: [s] });
  }
  return blocks;
}

function renderHome(root, d) {
  const suggested = suggestedTemplateId(d);
  const choice = override || suggested;
  const lastAB = sortBy(d.sessions.filter((s) => s.template_id), (s) => ts(s.started_at), true)[0];
  clear(root);

  const options = d.templates.map((t) => ({ value: t.id, label: t.name }));
  options.push({ value: 'free', label: 'Freestyle' });

  const preview = h('div', { class: 'list' });
  if (choice === 'free') {
    preview.append(h('p', { class: 'muted small' }, 'No template. Add any exercises as you go.'));
  } else {
    blocksForTemplate(d, choice).forEach((b, i) => {
      const names = b.slots.map((s) => (d.catById.get(s.category_id) || {}).name || 'Slot').join(' + ');
      const s0 = b.slots[0];
      const n = Math.max(1, parseInt(s0.sets, 10) || 1);
      const detail = b.slots.length > 1 ? plural(n, 'round') : `${plural(n, 'set')}${s0.target_reps ? ` × ${s0.target_reps}` : ''}`;
      preview.append(h('div', { class: 'preview-row' }, h('span', { class: 'slot-num' }, String(i + 1)), h('span', { class: 'grow' }, names), h('span', { class: 'muted small' }, detail)));
    });
  }

  const recent = sortBy(sessionsWithSets(d), (s) => ts(s.started_at), true).slice(0, 8);

  root.append(
    pageHead({ title: 'Workout' }),
    ...[installHint()].filter(Boolean),
    h('div', { class: 'card' },
      h('div', { class: 'section-label' }, 'Next up'),
      segmented(options, choice, (v) => {
        override = v === suggested ? null : v;
        rerender();
      }, 'seg-big'),
      h('p', { class: 'next-meta' },
        lastAB ? `Last: ${templateLabel(d, lastAB.template_id)} on ${fmtDay(lastAB.started_at)}. Tap to change.` : 'No workouts yet. Starting with A.'),
      preview,
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: () => startSession(choice === 'free' ? null : choice),
      }, `Start ${choice === 'free' ? 'Freestyle' : templateLabel(d, choice)}`)
    ),
    h('div', { class: 'section-label' }, 'Log cardio'),
    h('div', { class: 'row gap' },
      h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => { view = 'run'; rerender(); } }, icon('run'), 'Run'),
      h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => { view = 'walking_pad'; rerender(); } }, icon('walk'), 'Walking pad')
    ),
    h('div', { class: 'section-label' }, 'Recent workouts'),
    recent.length
      ? h('div', { class: 'list card' }, recent.map((s) => {
        const n = d.sets.filter((x) => x.session_id === s.id).length;
        return h('button', { type: 'button', class: 'list-row nav', onclick: () => openSessionDetail(d, s) },
          h('span', { class: 'grow' }, h('span', { class: 'row-title' }, fmtDay(s.started_at)), h('span', { class: 'row-sub' }, templateLabel(d, s.template_id))),
          h('span', { class: 'trail' }, plural(n, 'set')));
      }))
      : h('div', { class: 'card' }, emptyNote('No workouts logged yet. Finished workouts show up here.')),
    h('div', { class: 'section-label' }, 'Library'),
    h('div', { class: 'list card' },
      h('button', { type: 'button', class: 'list-row nav', onclick: () => { view = 'library'; rerender(); } }, icon('dumbbell', 'lead'), h('span', { class: 'grow' }, 'Exercises')),
      h('button', { type: 'button', class: 'list-row nav', onclick: () => { view = 'templates'; rerender(); } }, icon('list', 'lead'), h('span', { class: 'grow' }, 'Templates')))
  );
}

async function startSession(templateId) {
  const s = await save('sessions', { template_id: templateId, started_at: nowISO(), ended_at: null, extras_json: [] });
  cursor = { sessionId: s.id, block: 0, member: {} };
  await setMeta(CURSOR_KEY, cursor);
  override = null;
  rerender();
}

function openSessionDetail(d, session) {
  const prIds = prSetIds(d.sets);
  const sets = sortBy(d.sets.filter((x) => x.session_id === session.id), (x) => ts(x.logged_at));
  const byEx = [];
  for (const s of sets) {
    let g = byEx.find((x) => x.exId === s.exercise_id && x.slotId === s.slot_id);
    if (!g) byEx.push((g = { exId: s.exercise_id, slotId: s.slot_id, sets: [] }));
    g.sets.push(s);
  }
  const when = `${fmtDay(session.started_at)} · ${fmtTime(session.started_at)}${session.ended_at ? ` to ${fmtTime(session.ended_at)}` : ''}`;
  openSheet(templateLabel(d, session.template_id), (body, api) => {
    body.append(
      ...byEx.map((g) => h('div', { class: 'detail-block' },
        h('div', { class: 'strong' }, (d.exById.get(g.exId) || {}).name || 'Exercise'),
        h('div', { class: 'chips' }, g.sets.map((s) => h('span', { class: 'chip' + (prIds.has(s.id) ? ' chip-pr' : '') }, `${fmtLb(s.weight_lb)} × ${s.reps}`)))
      )),
      h('button', {
        type: 'button',
        class: 'btn btn-danger block',
        onclick: async () => {
          if (!(await confirmSheet('Delete this workout and all its sets?'))) return;
          await saveMany('sets', sets.map((s) => ({ ...s, deleted: true })));
          await save('sessions', { ...session, deleted: true });
          api.close();
          toast('Workout deleted');
          rerender();
        },
      }, 'Delete workout')
    );
  }, { subtitle: when });
}

/* ---------------- active session ---------------- */

let plan = null; // sessionPlan() of the active session; changed in place, then saved

async function loadCursor(sessionId) {
  if (cursor && cursor.sessionId === sessionId) return cursor;
  const saved = await getMeta(CURSOR_KEY);
  cursor = saved && saved.sessionId === sessionId ? saved : { sessionId, block: 0, member: {} };
  cursor.member = cursor.member || {};
  return cursor;
}

const persistCursor = () => setMeta(CURSOR_KEY, cursor);

/** Saves today-only changes (swap, skip, set count) on the session row, so they sync. */
async function savePlan(session) {
  await save('sessions', { ...session, extras_json: planJson(plan) });
}

function tweak(key, patch) {
  const t = { ...(plan.tweaks.get(key) || {}), ...patch };
  for (const k of Object.keys(t)) if (t[k] == null || t[k] === false) delete t[k];
  plan.tweaks.set(key, t);
}

function buildBlocks(d, session) {
  const tw = (key) => plan.tweaks.get(key) || {};
  const blocks = groupSlots(session.template_id ? d.slotsByTpl.get(session.template_id) || [] : []).map((b) => ({
    members: b.slots.map((slot) => {
      const t = tw(slot.id);
      const base = Math.max(1, parseInt(slot.sets, 10) || 1);
      return {
        key: slot.id, kind: 'slot', slot, catId: slot.category_id, base, target: t.sets || base,
        targetReps: slot.target_reps || null, swap: t.swap && d.exById.has(t.swap) ? t.swap : null, skipped: !!t.skip,
      };
    }),
  }));
  for (const exId of plan.extras) {
    if (!d.exById.has(exId)) continue;
    const key = `x:${exId}`;
    const t = tw(key);
    blocks.push({
      members: [{ key, kind: 'extra', exerciseId: exId, catId: (d.catsByEx.get(exId) || [])[0], base: 3, target: t.sets || 3, targetReps: null, swap: null, skipped: false }],
    });
  }
  return blocks;
}

function memberSets(m, sSets) {
  const list = m.kind === 'slot'
    ? sSets.filter((x) => x.slot_id === m.slot.id)
    : sSets.filter((x) => !x.slot_id && x.exercise_id === m.exerciseId);
  return list.sort((a, b) => ((a.set_number || 0) - (b.set_number || 0)) || (ts(a.logged_at) - ts(b.logged_at)));
}

/** The exercise a slot starts with: the template default, else the last one used there (swaps do not count). */
function plannedExercise(d, m, session) {
  const def = m.slot.default_exercise_id && d.exById.get(m.slot.default_exercise_id);
  if (def && !def.archived) return def.id;
  const last = lastExerciseForSlot(d, m.slot.id, session.id);
  if (last) return last;
  const list = exercisesFor(d, m.catId);
  return list[0] ? list[0].id : null;
}

function chosenExercise(d, m, session, sSets) {
  if (m.kind === 'extra') return m.exerciseId;
  if (m.swap) return m.swap;
  return plannedExercise(d, m, session);
}

const blockSkipped = (block) => block.members.every((m) => m.skipped);

function blockDone(block, sSets) {
  return !blockSkipped(block) && block.members.every((m) => m.skipped || memberSets(m, sSets).length >= m.target);
}

/** Done or skipped: nothing left to do in this slot today. */
const blockSettled = (block, sSets) => blockSkipped(block) || blockDone(block, sSets);

/** Next slot that still has work, after bIdx first, then from the top. -1 when none. */
function nextOpenBlock(blocks, bIdx, sSets) {
  let next = blocks.findIndex((b, i) => i > bIdx && !blockSettled(b, sSets));
  if (next < 0) next = blocks.findIndex((b, i) => i !== bIdx && !blockSettled(b, sSets));
  return next;
}

function currentMemberIndex(block, bIdx, sSets) {
  const manual = cursor.member[bIdx];
  if (manual != null && block.members[manual]) return manual;
  let best = 0;
  let bestCount = Infinity;
  block.members.forEach((m, i) => {
    const c = memberSets(m, sSets).length;
    if (c < bestCount) {
      best = i;
      bestCount = c;
    }
  });
  return best;
}

async function renderSession(root, d, session) {
  await loadCursor(session.id);
  plan = sessionPlan(session);
  const blocks = buildBlocks(d, session);
  const sSets = d.sets.filter((x) => x.session_id === session.id);
  if (cursor.focusKey) {
    const idx = blocks.findIndex((b) => b.members.some((m) => m.key === cursor.focusKey));
    if (idx >= 0) cursor.block = idx;
    delete cursor.focusKey;
    persistCursor();
  }
  if (cursor.block >= blocks.length) cursor.block = Math.max(0, blocks.length - 1);
  if (cursor.block < 0) cursor.block = 0;
  const allDone = blocks.length > 0 && blocks.every((b) => blockSettled(b, sSets));
  clear(root);

  root.append(
    pageHead({
      title: templateLabel(d, session.template_id),
      sub: `${fmtTime(session.started_at)} · ${plural(sSets.length, 'set')}`,
      actions: [
        h('button', { type: 'button', class: 'btn btn-secondary btn-head icon-only', 'aria-label': 'Add exercise', title: 'Add exercise', onclick: () => addExercise(session) }, icon('plus')),
        h('button', { type: 'button', class: (allDone ? 'btn btn-primary' : 'btn btn-secondary') + ' btn-head', onclick: () => finishSession(d, session, sSets, blocks) }, icon('check'), 'Finish'),
      ],
    })
  );

  if (!blocks.length) {
    root.append(
      h('div', { class: 'card' },
        h('div', { class: 'section-label' }, session.template_id ? 'Empty template' : 'Freestyle'),
        h('p', { class: 'muted' }, session.template_id ? 'This template has no slots. Add exercises here, or edit the template.' : 'Pick your first exercise. Add more any time with Add at the top.'),
        h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => addExercise(session) }, icon('plus'), 'Add exercise')
      ),
      discardButton(session, sSets)
    );
    return;
  }

  // Slot navigation: one tile per slot, all on one line; more than fit scroll sideways.
  const strip = h('div', { class: 'slot-strip', role: 'tablist', 'aria-label': 'Slots' }, blocks.map((b, i) => {
    const skipped = blockSkipped(b);
    const done = !skipped && blockDone(b, sSets);
    const extra = b.members[0].kind === 'extra';
    return h('button', {
      type: 'button',
      role: 'tab',
      class: 'slot-dot' + (i === cursor.block ? ' current' : '') + (done ? ' done' : '') + (skipped ? ' skipped' : '') + (extra ? ' extra' : ''),
      'aria-selected': i === cursor.block ? 'true' : 'false',
      'aria-label': `Slot ${i + 1}${extra ? ', added exercise' : ''}${done ? ', done' : ''}${skipped ? ', skipped today' : ''}`,
      onclick: () => { cursor.block = i; cursor.member = {}; persistCursor(); rerender(); },
    }, done ? icon('check') : String(i + 1));
  }));
  root.append(strip);
  requestAnimationFrame(() => {
    // Scroll only the strip so the current tile is in view; the page itself stays put.
    const cur = strip.querySelector('.current');
    if (!cur || strip.scrollWidth <= strip.clientWidth) return;
    const sr = strip.getBoundingClientRect();
    const cr = cur.getBoundingClientRect();
    strip.scrollLeft += (cr.left + cr.width / 2) - (sr.left + sr.width / 2);
  });

  if (allDone) {
    root.append(h('div', { class: 'card done-card' },
      h('div', { class: 'big-stat' }, 'All slots done'),
      h('p', { class: 'muted small' }, 'Add an exercise, log extra sets, or tap Finish at the top.')
    ));
  }

  const bIdx = cursor.block;
  const block = blocks[bIdx];

  if (blockSkipped(block)) {
    const names = block.members.map((m) => {
      const ex = d.exById.get(chosenExercise(d, m, session, sSets));
      return ex ? ex.name : (d.catById.get(m.catId) || {}).name || 'Exercise';
    }).join(' + ');
    root.append(h('div', { class: 'card block-card' },
      h('div', { class: 'eyebrow' }, h('span', null, `Slot ${bIdx + 1} of ${blocks.length} · skipped today`)),
      h('div', { class: 'ex-title' }, names),
      h('p', { class: 'muted small' }, 'Skipped slots do not count as unfinished. Next session it is back as usual.'),
      h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => setSkip(session, block, false) }, 'Unskip')
    ), discardButton(session, sSets));
    return;
  }

  const mIdx = currentMemberIndex(block, bIdx, sSets);
  const card = h('div', { class: 'card block-card' });
  if (block.members.length > 1) {
    const minCount = Math.min(...block.members.map((m) => memberSets(m, sSets).length));
    const rounds = Math.max(...block.members.map((m) => m.target));
    card.append(
      h('div', { class: 'eyebrow' }, h('span', null, `Slot ${bIdx + 1} of ${blocks.length} · Superset · round ${Math.min(minCount + 1, rounds)} of ${rounds}`)),
      h('div', { class: 'member-tabs' }, block.members.map((m, i) => {
        const exId = chosenExercise(d, m, session, sSets);
        const ex = d.exById.get(exId);
        return h('button', {
          type: 'button',
          class: 'member-tab' + (i === mIdx ? ' active' : ''), 'data-multiline': '',
          'aria-pressed': i === mIdx ? 'true' : 'false',
          onclick: () => { cursor.member[bIdx] = i; persistCursor(); rerender(); },
        }, h('span', { class: 'member-name' }, ex ? ex.name : (d.catById.get(m.catId) || {}).name || 'Exercise'), h('span', { class: 'muted small' }, `${memberSets(m, sSets).length} of ${m.target}`));
      }))
    );
  }
  const { panel, action } = memberPanel(d, session, sSets, blocks, bIdx, mIdx);
  card.append(panel);
  root.append(card, discardButton(session, sSets));
  if (action) root.append(h('div', { class: 'action-bar' }, action));
}

/** Skip (or unskip) every exercise in a slot for this session only. */
async function setSkip(session, block, on) {
  for (const m of block.members) tweak(m.key, { skip: on || null });
  await savePlan(session);
  if (on) {
    const d = await loadLifting();
    const sSets = d.sets.filter((x) => x.session_id === session.id);
    const blocks = buildBlocks(d, session);
    const next = nextOpenBlock(blocks, cursor.block, sSets);
    if (next >= 0) {
      cursor.block = next;
      toast(`Skipped for today. Next: slot ${next + 1}`);
    } else toast('Skipped for today. Every slot is done or skipped.');
  } else toast('Slot is back on for today');
  cursor.member = {};
  await persistCursor();
  rerender();
}

/** Use another exercise in this slot today only. Next session starts with the planned exercise. */
async function swapExercise(d, session, m, exId) {
  tweak(m.key, { swap: exId && exId !== plannedExercise(d, m, session) ? exId : null });
  await savePlan(session);
  rerender();
}

async function undoSwap(session, m) {
  tweak(m.key, { swap: null });
  await savePlan(session);
  rerender();
}

/** Today's set (or round) count for these exercises; the template stays as it is. */
async function setTarget(session, members, n) {
  for (const m of members) tweak(m.key, { sets: n === m.base ? null : n });
  await savePlan(session);
  rerender();
}

function discardButton(session, sSets) {
  return h('button', {
    type: 'button',
    class: 'btn-text danger-text block',
    onclick: async () => {
      if (!(await confirmSheet('Discard this workout and every set logged in it?', 'Discard'))) return;
      await discardSession(session, sSets);
    },
  }, 'Discard workout');
}

async function discardSession(session, sSets) {
  await saveMany('sets', sSets.map((s) => ({ ...s, deleted: true })));
  await save('sessions', { ...session, deleted: true });
  stopRest();
  cursor = null;
  await setMeta(CURSOR_KEY, null);
  toast('Workout discarded');
  rerender();
}

/** Gold banner for a new record. Bodyweight sets with no added load read as reps. */
function celebrate(prs, w, r, ex) {
  const text = w > 0 ? `New record: ${fmtLb(w)} lb × ${r}` : `New record: ${r} reps`;
  recordBanner(text, ex.name);
}

async function finishSession(d, session, sSets, blocks) {
  if (!sSets.length) {
    if (await confirmSheet('No sets were logged. Discard this workout?', 'Discard')) await discardSession(session, sSets);
    return;
  }
  const ended = { ...session, ended_at: nowISO() };
  await save('sessions', ended);
  stopRest();
  cursor = null;
  await setMeta(CURSOR_KEY, null);
  rerender();
  const bodyweight = oneBodyweightPerDay(await all('bodyweight'));
  openSummary(d, ended, sSets, blocks || [], bodyweight);
}

/** After Finish: what the workout added up to. */
function openSummary(d, session, sSets, blocks, bodyweight) {
  const durSec = Math.max(0, (ts(session.ended_at) - ts(session.started_at)) / 1000);
  const volume = sSets.reduce((a, s) => a + (Number(s.weight_lb) || 0) * (Number(s.reps) || 0), 0);
  const exDone = new Set(sSets.map((s) => s.exercise_id)).size;
  const skipped = blocks.reduce((a, b) => a + b.members.filter((m) => m.skipped).length, 0);
  const prIds = prSetIds(d.sets);
  const records = sortBy(sSets.filter((s) => prIds.has(s.id)), (s) => ts(s.logged_at));
  const weight = weightOn(bodyweight, localDay(session.started_at) || session.started_at.slice(0, 10));
  const kcal = weight != null ? liftKcal(weight, sessionHours(session, sSets.length)) : null;
  const tile = (label, value, cls = '') => h('div', { class: 'summary-tile ' + cls }, h('div', { class: 'stat-label' }, label), h('div', { class: 'big-stat' }, value));
  openSheet('Workout saved', (body, api) => {
    add(body,
      h('div', { class: 'summary-grid' },
        tile('Duration', fmtDuration(durSec)),
        tile('Sets', String(sSets.length)),
        tile('Volume', `${Math.round(volume).toLocaleString('en-US')} lb`),
        tile('Exercises', skipped ? `${exDone} done, ${skipped} skipped` : `${exDone} done`),
        tile('Records', String(records.length), records.length ? 'gold' : ''),
        tile('Calories (est.)', kcal != null ? `${fmtKcal(kcal)} kcal` : '-')),
      kcal == null ? h('p', { class: 'muted small' }, 'Log bodyweight on Stats to estimate calories.') : h('p', { class: 'muted small' }, 'Calories are an estimate from your bodyweight and the workout time.'),
      records.length ? h('div', { class: 'summary-records' },
        h('div', { class: 'section-label' }, 'New records'),
        records.map((s) => h('div', { class: 'pr-text' }, icon('trophy'), `${(d.exById.get(s.exercise_id) || {}).name || 'Exercise'}: ${fmtLb(s.weight_lb)} lb × ${s.reps}`))) : null,
      h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => api.close() }, 'Done')
    );
  }, { subtitle: `${templateLabel(d, session.template_id)} · ${fmtDay(session.started_at)}` });
}

async function addExercise(session) {
  await openExercisePicker({
    title: 'Add Exercise',
    onPick: async (ex) => {
      if (!plan.extras.includes(ex.id)) {
        plan.extras.push(ex.id);
        await savePlan(session);
      }
      cursor.focusKey = `x:${ex.id}`;
      cursor.member = {};
      await persistCursor();
      toast(`${ex.name} added to this session`);
      rerender();
    },
  });
}

/** Rest in seconds; 0 means no rest timer. */
const restOf = (ex) => {
  const n = Number(ex.default_rest_sec ?? 90);
  return Number.isFinite(n) && n >= 0 ? n : 90;
};

/** Rest as m:ss, the way the timer shows it. */
const restText = (sec) => `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;

function memberPanel(d, session, sSets, blocks, bIdx, mIdx) {
  const block = blocks[bIdx];
  const m = block.members[mIdx];
  const exId = chosenExercise(d, m, session, sSets);
  const ex = exId ? d.exById.get(exId) : null;
  const cat = d.catById.get(m.catId);
  const mine = memberSets(m, sSets);
  const panel = h('div', { class: 'stack-lg' });
  const single = block.members.length === 1;

  const where = single ? `Slot ${bIdx + 1} of ${blocks.length} · ` : '';
  panel.append(h('div', { class: 'eyebrow' }, h('span', null, where + (m.kind === 'extra' ? 'Added · ' : '') + (cat ? cat.name : 'Exercise'))));
  if (m.kind === 'slot' && m.slot.note) panel.append(h('div', { class: 'slot-note' }, m.slot.note));

  if (!ex) {
    panel.append(
      emptyNote('No exercises in this category yet.'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: () => openExerciseEditor({ presetCategoryId: m.catId, data: d, onSaved: (nex) => { if (nex) swapExercise(d, session, m, nex.id); else rerender(); } }),
      }, 'Add an exercise')
    );
    if (m.kind === 'slot') panel.append(h('button', { type: 'button', class: 'btn btn-secondary block', onclick: () => setSkip(session, block, true) }, 'Skip today'));
    return { panel, action: null };
  }

  // The exercise name is the control: tap it to pick another one for today only.
  if (m.kind === 'slot') {
    const planned = d.exById.get(plannedExercise(d, m, session));
    panel.append(h('button', {
      type: 'button',
      class: 'ex-name-btn',
      'data-multiline': '',
      'aria-label': `${ex.name}. Change exercise for today`,
      onclick: () => openExercisePicker({
        title: 'Choose exercise',
        subtitle: m.swap && planned ? `Today only. Planned: ${planned.name}` : 'Today only. Next time starts as planned.',
        categoryId: m.catId,
        currentId: ex.id,
        onPick: (nex) => swapExercise(d, session, m, nex.id),
      }),
    }, h('span', { class: 'ex-name' }, ex.name), h('span', { class: 'ex-change' }, icon('swap'), 'Change')));
    if (m.swap) {
      panel.append(h('div', { class: 'swap-note' },
        h('span', { class: 'grow' }, 'Swapped for today only'),
        h('button', { type: 'button', class: 'btn-text', onclick: () => undoSwap(session, m) }, 'Undo swap')
      ));
    }
  } else {
    panel.append(h('div', { class: 'ex-title' }, ex.name));
  }

  // Setup note, rest and skip: quiet secondary controls.
  const rest = restOf(ex);
  if (ex.setup_note) panel.append(h('div', { class: 'setup-note' }, h('b', null, 'Setup '), ex.setup_note));
  panel.append(h('div', { class: 'pill-row' },
    h('button', { type: 'button', class: 'pill', 'aria-label': rest > 0 ? `Rest ${rest} seconds. Change` : 'Rest timer off. Change', onclick: () => editRest(ex) }, icon('timer'), rest > 0 ? `Rest ${restText(rest)}` : 'Rest off'),
    h('button', { type: 'button', class: 'pill', onclick: () => editSetupNote(ex) }, icon('note'), ex.setup_note ? 'Edit note' : 'Add note'),
    m.kind === 'slot' ? h('button', { type: 'button', class: 'pill', onclick: () => setSkip(session, block, true) }, icon('skip'), 'Skip today') : null
  ));

  // Last time and the progression cue (based on the top set).
  const lt = lastTime(d, ex.id, session.id, m.kind === 'slot' ? m.slot.id : null);
  const top = lt ? topSet(lt.sets) : null;
  const targetReps = m.targetReps;
  let cue;
  if (!lt || !top) cue = h('div', { class: 'cue' }, 'First time logging this exercise. Start light and ramp up.');
  else if (targetReps && top.reps >= targetReps) cue = h('div', { class: 'cue cue-up' }, 'Add weight today.');
  else cue = h('div', { class: 'cue' }, `Beat last time: ${fmtLb(top.weight_lb)} lb × ${top.reps}`);
  panel.append(cue);
  if (lt) {
    panel.append(h('div', { class: 'last-time' },
      h('div', { class: 'sub-label' }, `Last time · ${fmtDay(lt.when)}${targetReps ? ` · target ${targetReps} reps` : ''}`),
      h('div', { class: 'chips' }, lt.sets.map((s, i) => h('span', { class: 'chip' + (s === top ? ' chip-top' : '') }, `${i + 1}: ${fmtLb(s.weight_lb)} × ${s.reps}`)))
    ));
  }

  // Sets logged in this session for this slot, numbered in order.
  const prIds = prSetIds(d.sets);
  if (mine.length) {
    panel.append(h('div', { class: 'this-session' },
      h('div', { class: 'sub-label' }, 'Today · tap a set to edit'),
      h('div', { class: 'chips' }, mine.map((s, i) => {
        const other = s.exercise_id !== ex.id ? ` ${(d.exById.get(s.exercise_id) || {}).name || ''}` : '';
        return h('button', { type: 'button', class: 'chip chip-btn-inline' + (prIds.has(s.id) ? ' chip-pr' : ''), onclick: () => editSet(s, ex, i + 1) }, `${i + 1}: ${fmtLb(s.weight_lb)} × ${s.reps}${other}`);
      }))
    ));
  }

  // Entry, pre-filled from last time.
  const setNo = mine.length + 1;
  // Stored numbers keep growing after a delete, so no two sets share a number.
  const nextNumber = mine.reduce((a, s) => Math.max(a, Number(s.set_number) || 0), 0) + 1;
  const src = (lt && lt.sets[setNo - 1]) || mine[mine.length - 1] || (lt && lt.sets[lt.sets.length - 1]) || null;
  let plates = ex.load_type === 'plates' && src && src.plates_json ? src.plates_json : null;
  const weight = stepper({
    value: src ? src.weight_lb : '',
    step: loadStep(ex.load_type),
    label: 'weight',
    onInput: () => { plates = null; }, // a hand-edited weight no longer matches the plates
  });
  const reps = stepper({ value: src ? src.reps : '', step: 1, decimals: false, label: 'reps' });
  panel.append(
    h('div', { class: 'entry' },
      h('div', { class: 'entry-col' }, h('div', { class: 'entry-label' }, `Weight · ${loadLabel(ex.load_type)}`), weight),
      h('div', { class: 'entry-col' }, h('div', { class: 'entry-label' }, 'Reps'), reps)
    )
  );
  if (ex.load_type === 'plates') {
    panel.append(h('button', {
      type: 'button',
      class: 'btn btn-secondary block',
      onclick: () => openPlates(ex, plates, (total, st) => {
        weight.input.value = String(total);
        plates = st;
      }),
    }, 'Plates per side'));
  }

  // Today's set count (rounds for a superset), for this session only.
  const targetMembers = block.members.length > 1 ? block.members : [m];
  const shownTarget = Math.max(...targetMembers.map((x) => x.target));
  const changeTarget = (dlt) => {
    const n = Math.min(20, Math.max(1, shownTarget + dlt));
    if (n !== shownTarget) setTarget(session, targetMembers, n);
  };
  const isExtraSet = setNo > m.target;
  panel.append(h('div', { class: 'target-row' },
    h('span', { class: 'label' }, block.members.length > 1 ? 'Rounds today' : 'Sets today'),
    h('button', { type: 'button', class: 'step-btn step-btn-small', 'aria-label': 'One fewer set today', disabled: shownTarget <= 1, onclick: () => changeTarget(-1) }, '−'),
    h('span', { class: 'plate-count' }, String(shownTarget)),
    h('button', { type: 'button', class: 'step-btn step-btn-small', 'aria-label': 'One more set today', disabled: shownTarget >= 20, onclick: () => changeTarget(1) }, '+')
  ));
  const action = h('button', {
    type: 'button',
    class: 'btn btn-primary block btn-log',
    onclick: async (e) => {
      primeAudio();
      const btn = e.currentTarget;
      const w = parseFloat(weight.input.value) || 0;
      const r = parseInt(reps.input.value, 10) || 0;
      if (r <= 0) return toast('Enter reps.');
      if (w < 0) return toast('Weight cannot be negative.');
      btn.disabled = true;
      const wasDone = blockDone(block, sSets);
      const prior = d.sets.filter((s) => s.exercise_id === ex.id);
      const prs = detectPRs(prior, w, r);
      const saved = await save('sets', {
        session_id: session.id,
        slot_id: m.kind === 'slot' ? m.slot.id : null,
        exercise_id: ex.id,
        set_number: nextNumber,
        weight_lb: w,
        plates_json: ex.load_type === 'plates' ? plates : null,
        reps: r,
        logged_at: nowISO(),
      });
      const after = [...sSets, saved];
      if (prs.length) celebrate(prs, w, r, ex);

      // Rest after a single set, or after the last exercise of a superset round. 0 means no timer.
      const myCount = memberSets(m, after).length;
      const roundDone = block.members.every((mm) => mm.skipped || memberSets(mm, after).length >= myCount);
      if ((block.members.length === 1 || roundDone) && rest > 0) startRest(rest);

      delete cursor.member[bIdx];
      if (!wasDone && blockDone(block, after)) {
        const next = nextOpenBlock(blocks, bIdx, after);
        if (next >= 0) {
          cursor.block = next;
          if (!prs.length) toast(`Slot done. Next: slot ${next + 1}`);
        } else if (!prs.length) toast('Every slot is done. Tap Finish when ready.');
      }
      await persistCursor();
      rerender();
    },
  }, isExtraSet ? `Log extra set ${setNo}` : `Log set ${setNo} of ${m.target}`);

  // Off-plan exercise controls.
  if (m.kind === 'extra') {
    const tpl = session.template_id ? d.tplById.get(session.template_id) : null;
    const btns = [
      tpl ? h('button', { type: 'button', class: 'btn btn-secondary fit', onclick: () => addToTemplate(d, session, ex, sSets) }, 'Add to template') : null,
      !mine.length ? h('button', {
        type: 'button',
        class: 'btn btn-secondary fit',
        onclick: async () => {
          plan.extras = plan.extras.filter((id) => id !== ex.id);
          plan.tweaks.delete(m.key);
          await savePlan(session);
          rerender();
        },
      }, 'Remove') : null,
    ].filter(Boolean);
    if (btns.length) panel.append(h('div', { class: 'row gap' }, btns));
  }
  return { panel, action };
}

async function addToTemplate(d, session, ex, sSets) {
  const slots = d.slotsByTpl.get(session.template_id) || [];
  const catId = (d.catsByEx.get(ex.id) || [])[0];
  if (!catId) return toast('Give this exercise a category first.');
  const slot = await save('template_slots', {
    template_id: session.template_id,
    position: slots.length ? Math.max(...slots.map((s) => s.position)) + 1 : 1,
    category_id: catId,
    default_exercise_id: ex.id,
    sets: 3,
    target_reps: 10,
    superset_group: null,
    note: '',
  });
  const moved = sSets.filter((s) => !s.slot_id && s.exercise_id === ex.id).map((s) => ({ ...s, slot_id: slot.id }));
  await saveMany('sets', moved);
  plan.extras = plan.extras.filter((id) => id !== ex.id);
  plan.tweaks.delete(`x:${ex.id}`);
  await savePlan(session);
  cursor.focusKey = slot.id;
  await persistCursor();
  toast(`Added to ${templateLabel(d, session.template_id)}. Edit sets and reps in Templates.`);
  rerender();
}

function editSet(set, ex, shownNumber) {
  openSheet(`Set ${shownNumber}`, (body, api) => {
    const w = stepper({ value: set.weight_lb, step: loadStep(ex.load_type), label: 'weight' });
    const r = stepper({ value: set.reps, step: 1, decimals: false, label: 'reps' });
    body.append(
      field(`Weight (${loadLabel(ex.load_type)})`, w),
      field('Reps', r),
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          const nw = parseFloat(w.input.value) || 0;
          const nr = parseInt(r.input.value, 10) || 0;
          if (nr <= 0) return toast('Enter reps.');
          await save('sets', { ...set, weight_lb: nw, reps: nr, plates_json: nw === set.weight_lb ? set.plates_json : null });
          api.close();
          toast('Set updated');
          rerender();
        },
      }, 'Save'),
      h('button', {
        type: 'button',
        class: 'btn btn-danger block',
        onclick: async () => {
          await save('sets', { ...set, deleted: true });
          api.close();
          toast('Set deleted');
          rerender();
        },
      }, 'Delete set')
    );
  });
}

function editSetupNote(ex) {
  openSheet('Setup note', (body, api) => {
    const t = h('textarea', { class: 'input', rows: '3', placeholder: 'Seat height, pin position, grip' }, ex.setup_note || '');
    body.append(
      t,
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          await save('exercises', { ...ex, setup_note: t.value.trim() });
          api.close();
          rerender();
        },
      }, 'Save')
    );
  });
}

function editRest(ex) {
  openSheet('Rest timer', (body, api) => {
    const setRest = async (sec) => {
      await save('exercises', { ...ex, default_rest_sec: sec });
      api.close();
      toast(sec > 0 ? `Rest set to ${sec} s` : 'Rest timer off');
      rerender();
    };
    const custom = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: '0', value: restOf(ex), 'aria-label': 'Custom rest in seconds' });
    body.append(
      h('div', { class: 'rest-grid' }, [45, 60, 90, 120, 150, 180, 240, 300].map((s) =>
        h('button', { type: 'button', class: 'btn btn-secondary' + (s === ex.default_rest_sec ? ' selected' : ''), 'aria-label': `${s} seconds`, onclick: () => setRest(s) }, restText(s)))),
      field('Custom (seconds)', custom, '0 turns the rest timer off.'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: () => {
          const v = parseInt(custom.value, 10);
          setRest(Number.isNaN(v) ? 90 : v <= 0 ? 0 : Math.max(5, v));
        },
      }, 'Save')
    );
  }, { subtitle: ex.name });
}

/** Plates per side plus bar or sled weight, totalled in pounds. */
function openPlates(ex, initial, onUse) {
  const st = {
    bar: initial && initial.bar != null ? Number(initial.bar) : Number(ex.bar_lb ?? 45),
    per_side: {},
  };
  for (const p of PLATES) st.per_side[p] = initial && initial.per_side ? Number(initial.per_side[p] || 0) : 0;
  const total = () => st.bar + 2 * PLATES.reduce((a, p) => a + p * (st.per_side[p] || 0), 0);

  openSheet('Plates per side', (body, api) => {
    const totalEl = h('div', { class: 'big-stat center' });
    const showTotal = () => { totalEl.textContent = `${fmtLb(total())} lb total`; };
    const bar = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: st.bar });
    bar.addEventListener('input', () => { st.bar = parseFloat(bar.value) || 0; showTotal(); });
    body.append(field('Bar or sled weight (lb)', bar));
    for (const p of PLATES) {
      const count = h('span', { class: 'plate-count' }, String(st.per_side[p]));
      const minus = h('button', { type: 'button', class: 'step-btn', 'aria-label': `Remove a ${p} lb plate`, onclick: () => change(-1) }, '−');
      const change = (dlt) => {
        st.per_side[p] = Math.max(0, (st.per_side[p] || 0) + dlt);
        count.textContent = String(st.per_side[p]);
        minus.disabled = !st.per_side[p];
        showTotal();
      };
      minus.disabled = !st.per_side[p];
      body.append(h('div', { class: 'plate-row' },
        h('span', { class: 'grow strong' }, `${p} lb`),
        minus,
        count,
        h('button', { type: 'button', class: 'step-btn', 'aria-label': `Add a ${p} lb plate`, onclick: () => change(1) }, '+')
      ));
    }
    showTotal();
    body.append(totalEl, h('button', {
      type: 'button',
      class: 'btn btn-primary block',
      onclick: () => {
        const clean = { bar: st.bar, per_side: {} };
        for (const p of PLATES) if (st.per_side[p]) clean.per_side[p] = st.per_side[p];
        onUse(total(), clean);
        api.close();
      },
    }, 'Use this weight'));
  });
}
