// Workout tab: pick A, B or Freestyle, log sets slot by slot with last-time
// display, progression cue, PRs, rest timer and supersets. Also links to
// cardio logging, the exercise library and the template editor.

import { save, saveMany, getMeta, setMeta } from './db.js';
import {
  h, clear, toast, openSheet, confirmSheet, segmented, stepper, field, nowISO, fmtDay, fmtTime,
  fmtLb, sortBy, ts, emptyNote,
} from './util.js';
import {
  loadLifting, exercisesFor, suggestedTemplateId, templateLabel, lastTime, topSet,
  lastExerciseForSlot, loadLabel, loadStep, sessionsWithSets,
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
let cursor = null; // { sessionId, block, member: {blockIndex: memberIndex}, choice: {memberKey: exerciseId}, focusKey }

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
    preview.append(h('p', { class: 'muted' }, 'No template. Add any exercises as you go.'));
  } else {
    blocksForTemplate(d, choice).forEach((b, i) => {
      const names = b.slots.map((s) => (d.catById.get(s.category_id) || {}).name || 'Slot').join(' + ');
      const s0 = b.slots[0];
      const detail = b.slots.length > 1 ? `${s0.sets} rounds` : `${s0.sets} sets${s0.target_reps ? ` × ${s0.target_reps}` : ''}`;
      preview.append(h('div', { class: 'preview-row' }, h('span', { class: 'slot-num' }, String(i + 1)), h('span', { class: 'grow' }, names), h('span', { class: 'muted small' }, detail)));
    });
  }

  const recent = sortBy(sessionsWithSets(d), (s) => ts(s.started_at), true).slice(0, 8);

  root.append(
    h('header', { class: 'page-head' }, h('h1', null, 'Workout')),
    h('div', { class: 'card' },
      h('div', { class: 'section-label' }, 'Next up'),
      segmented(options, choice, (v) => {
        override = v === suggested ? null : v;
        rerender();
      }, 'seg-big'),
      h('p', { class: 'muted small' },
        lastAB ? `Last: ${templateLabel(d, lastAB.template_id)} on ${fmtDay(lastAB.started_at)}. Tap to override.` : 'No workouts yet. Starting with A.'),
      preview,
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: () => startSession(choice === 'free' ? null : choice),
      }, `Start ${choice === 'free' ? 'Freestyle' : templateLabel(d, choice)}`)
    ),
    h('div', { class: 'card' },
      h('div', { class: 'section-label' }, 'Cardio'),
      h('div', { class: 'row gap' },
        h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => { view = 'run'; rerender(); } }, 'Log run'),
        h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => { view = 'walking_pad'; rerender(); } }, 'Log walking pad')
      )
    ),
    h('div', { class: 'section-label' }, 'Recent workouts'),
    recent.length
      ? h('div', { class: 'list card' }, recent.map((s) => {
        const n = d.sets.filter((x) => x.session_id === s.id).length;
        return h('button', { type: 'button', class: 'list-row', onclick: () => openSessionDetail(d, s) },
          h('span', { class: 'grow' }, fmtDay(s.started_at), h('span', { class: 'muted small' }, ` · ${templateLabel(d, s.template_id)}`)),
          h('span', { class: 'muted small' }, `${n} sets`));
      }))
      : emptyNote('No workouts logged yet.'),
    h('div', { class: 'row gap' },
      h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => { view = 'library'; rerender(); } }, 'Exercises'),
      h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => { view = 'templates'; rerender(); } }, 'Templates')
    )
  );
}

async function startSession(templateId) {
  const s = await save('sessions', { template_id: templateId, started_at: nowISO(), ended_at: null, extras_json: [] });
  cursor = { sessionId: s.id, block: 0, member: {}, choice: {} };
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
  openSheet(`${templateLabel(d, session.template_id)} · ${fmtDay(session.started_at)}`, (body, api) => {
    body.append(
      h('p', { class: 'muted small' }, `${fmtTime(session.started_at)}${session.ended_at ? ` to ${fmtTime(session.ended_at)}` : ''}`),
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
  });
}

/* ---------------- active session ---------------- */

async function loadCursor(sessionId) {
  if (cursor && cursor.sessionId === sessionId) return cursor;
  const saved = await getMeta(CURSOR_KEY);
  cursor = saved && saved.sessionId === sessionId ? saved : { sessionId, block: 0, member: {}, choice: {} };
  cursor.member = cursor.member || {};
  cursor.choice = cursor.choice || {};
  return cursor;
}

const persistCursor = () => setMeta(CURSOR_KEY, cursor);

const extrasOf = (session) => (Array.isArray(session.extras_json) ? session.extras_json : []);

function buildBlocks(d, session) {
  const blocks = groupSlots(session.template_id ? d.slotsByTpl.get(session.template_id) || [] : []).map((b) => ({
    members: b.slots.map((slot) => ({
      key: slot.id, kind: 'slot', slot, catId: slot.category_id, target: slot.sets || 1, targetReps: slot.target_reps || null,
    })),
  }));
  for (const exId of extrasOf(session)) {
    if (!d.exById.has(exId)) continue;
    blocks.push({
      members: [{ key: `x:${exId}`, kind: 'extra', exerciseId: exId, catId: (d.catsByEx.get(exId) || [])[0], target: 3, targetReps: null }],
    });
  }
  return blocks;
}

function memberSets(m, sSets) {
  const list = m.kind === 'slot'
    ? sSets.filter((x) => x.slot_id === m.slot.id)
    : sSets.filter((x) => !x.slot_id && x.exercise_id === m.exerciseId);
  return list.sort((a, b) => (a.set_number - b.set_number) || (ts(a.logged_at) - ts(b.logged_at)));
}

function chosenExercise(d, m, session, sSets) {
  if (m.kind === 'extra') return m.exerciseId;
  const pick = cursor.choice[m.key];
  if (pick && d.exById.has(pick)) return pick;
  const mine = memberSets(m, sSets);
  if (mine.length) return mine[mine.length - 1].exercise_id;
  const last = lastExerciseForSlot(d, m.slot.id, session.id);
  if (last) return last;
  const def = m.slot.default_exercise_id && d.exById.get(m.slot.default_exercise_id);
  if (def && !def.archived) return def.id;
  const list = exercisesFor(d, m.catId);
  return list[0] ? list[0].id : null;
}

function blockDone(block, sSets) {
  return block.members.every((m) => memberSets(m, sSets).length >= m.target);
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
  const allDone = blocks.length > 0 && blocks.every((b) => blockDone(b, sSets));
  clear(root);

  root.append(
    h('header', { class: 'page-head' },
      h('div', { class: 'grow' },
        h('h1', null, templateLabel(d, session.template_id)),
        h('div', { class: 'muted small' }, `Started ${fmtTime(session.started_at)} · ${sSets.length} sets`)
      )
    ),
    h('div', { class: 'row gap' },
      h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => addExercise(session) }, 'Add Exercise'),
      h('button', { type: 'button', class: allDone ? 'btn btn-primary grow' : 'btn btn-secondary grow', onclick: () => finishSession(session, sSets) }, 'Finish')
    )
  );

  if (!blocks.length) {
    root.append(
      h('div', { class: 'card' },
        h('p', null, session.template_id ? 'This template has no slots. Add exercises or edit the template.' : 'Freestyle. Tap Add Exercise to pick the first one.'),
        h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => addExercise(session) }, 'Add Exercise')
      ),
      discardButton(session, sSets)
    );
    return;
  }

  // Slot navigation.
  const strip = h('div', { class: 'slot-strip' }, blocks.map((b, i) => {
    const done = blockDone(b, sSets);
    return h('button', {
      type: 'button',
      class: 'slot-dot' + (i === cursor.block ? ' current' : '') + (done ? ' done' : ''),
      'aria-label': `Slot ${i + 1}${done ? ', done' : ''}`,
      onclick: () => { cursor.block = i; cursor.member = {}; persistCursor(); rerender(); },
    }, done ? '✓' : String(i + 1));
  }));
  root.append(
    h('div', { class: 'slot-nav' },
      h('button', { type: 'button', class: 'nav-btn', disabled: cursor.block === 0, 'aria-label': 'Previous slot', onclick: () => { cursor.block -= 1; persistCursor(); rerender(); } }, '‹'),
      h('div', { class: 'grow center' }, `Slot ${cursor.block + 1} of ${blocks.length}`),
      h('button', { type: 'button', class: 'nav-btn', disabled: cursor.block >= blocks.length - 1, 'aria-label': 'Next slot', onclick: () => { cursor.block += 1; persistCursor(); rerender(); } }, '›')
    ),
    strip
  );
  requestAnimationFrame(() => {
    const cur = strip.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  });

  if (allDone) {
    root.append(h('div', { class: 'card' },
      h('div', { class: 'big-stat' }, 'All slots done.'),
      h('p', { class: 'muted' }, 'Add an exercise, log extra sets, or finish.'),
      h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => finishSession(session, sSets) }, 'Finish workout')
    ));
  }

  const bIdx = cursor.block;
  const block = blocks[bIdx];
  const mIdx = currentMemberIndex(block, bIdx, sSets);
  const card = h('div', { class: 'card block-card' });
  if (block.members.length > 1) {
    const minCount = Math.min(...block.members.map((m) => memberSets(m, sSets).length));
    const rounds = block.members[0].target;
    card.append(
      h('div', { class: 'section-label' }, `Superset · round ${Math.min(minCount + 1, rounds)} of ${rounds}`),
      h('div', { class: 'member-tabs' }, block.members.map((m, i) => {
        const exId = chosenExercise(d, m, session, sSets);
        const ex = d.exById.get(exId);
        return h('button', {
          type: 'button',
          class: 'member-tab' + (i === mIdx ? ' active' : ''),
          onclick: () => { cursor.member[bIdx] = i; persistCursor(); rerender(); },
        }, h('span', { class: 'member-name' }, ex ? ex.name : (d.catById.get(m.catId) || {}).name || 'Exercise'), h('span', { class: 'muted small' }, `${memberSets(m, sSets).length}/${m.target}`));
      }))
    );
  }
  card.append(memberPanel(d, session, sSets, blocks, bIdx, mIdx));
  root.append(card, discardButton(session, sSets));
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

async function finishSession(session, sSets) {
  if (!sSets.length) {
    if (await confirmSheet('No sets were logged. Discard this workout?', 'Discard')) await discardSession(session, sSets);
    return;
  }
  await save('sessions', { ...session, ended_at: nowISO() });
  stopRest();
  cursor = null;
  await setMeta(CURSOR_KEY, null);
  toast(`Workout saved: ${sSets.length} sets`);
  rerender();
}

async function addExercise(session) {
  await openExercisePicker({
    title: 'Add Exercise',
    onPick: async (ex) => {
      const extras = extrasOf(session);
      if (!extras.includes(ex.id)) await save('sessions', { ...session, extras_json: [...extras, ex.id] });
      cursor.focusKey = `x:${ex.id}`;
      cursor.member = {};
      await persistCursor();
      toast(`${ex.name} added to this session`);
      rerender();
    },
  });
}

function memberPanel(d, session, sSets, blocks, bIdx, mIdx) {
  const block = blocks[bIdx];
  const m = block.members[mIdx];
  const exId = chosenExercise(d, m, session, sSets);
  const ex = exId ? d.exById.get(exId) : null;
  const cat = d.catById.get(m.catId);
  const mine = memberSets(m, sSets);
  const panel = h('div', { class: 'stack' });

  panel.append(h('div', { class: 'section-label' }, (m.kind === 'extra' ? 'Added exercise · ' : '') + (cat ? cat.name : 'Exercise')));
  if (m.kind === 'slot' && m.slot.note) panel.append(h('div', { class: 'muted small' }, m.slot.note));

  // Exercise choice for this slot.
  if (m.kind === 'slot') {
    const opts = exercisesFor(d, m.catId, exId);
    const sel = h('select', { class: 'input select-big', 'aria-label': 'Exercise' },
      opts.map((e) => h('option', { value: e.id }, e.name)),
      h('option', { value: '__new' }, '+ New exercise…'));
    if (exId) sel.value = exId;
    sel.addEventListener('change', () => {
      if (sel.value === '__new') {
        sel.value = exId || '';
        openExerciseEditor({
          presetCategoryId: m.catId,
          data: d,
          onSaved: (nex) => {
            if (!nex) return;
            cursor.choice[m.key] = nex.id;
            persistCursor();
            rerender();
          },
        });
        return;
      }
      cursor.choice[m.key] = sel.value;
      persistCursor();
      rerender();
    });
    panel.append(sel);
  } else if (ex) {
    panel.append(h('div', { class: 'ex-title' }, ex.name));
  }

  if (!ex) {
    panel.append(
      emptyNote('No exercises in this category yet.'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: () => openExerciseEditor({ presetCategoryId: m.catId, data: d, onSaved: (nex) => { if (nex) { cursor.choice[m.key] = nex.id; persistCursor(); } rerender(); } }),
      }, 'Add an exercise')
    );
    return panel;
  }

  // Setup note and rest.
  panel.append(h('div', { class: 'row gap wrap' },
    h('button', { type: 'button', class: 'chip-btn grow', onclick: () => editSetupNote(ex) }, ex.setup_note ? `Setup: ${ex.setup_note}` : 'Add setup note'),
    h('button', { type: 'button', class: 'chip-btn', onclick: () => editRest(ex) }, `Rest ${ex.default_rest_sec || 90} s`)
  ));

  // Last time and the progression cue (based on the top set).
  const lt = lastTime(d, ex.id, session.id, m.kind === 'slot' ? m.slot.id : null);
  const top = lt ? topSet(lt.sets) : null;
  const targetReps = m.targetReps;
  let cue;
  if (!lt) cue = h('div', { class: 'cue' }, 'First time logging this exercise. Start light and ramp up.');
  else if (targetReps && top && top.reps >= targetReps) cue = h('div', { class: 'cue cue-up' }, 'Add weight today.');
  else cue = h('div', { class: 'cue' }, `Beat last time: ${fmtLb(top.weight_lb)} lb × ${top.reps}`);
  panel.append(cue);
  if (lt) {
    panel.append(h('div', { class: 'last-time' },
      h('div', { class: 'muted small' }, `Last time · ${fmtDay(lt.when)}${targetReps ? ` · target ${targetReps} reps` : ''}`),
      h('div', { class: 'chips' }, lt.sets.map((s, i) => h('span', { class: 'chip' + (s === top ? ' chip-top' : '') }, `${i + 1}: ${fmtLb(s.weight_lb)} × ${s.reps}`)))
    ));
  }

  // Sets logged in this session for this slot.
  const prIds = prSetIds(d.sets);
  if (mine.length) {
    panel.append(h('div', { class: 'this-session' },
      h('div', { class: 'muted small' }, 'Today (tap to edit)'),
      h('div', { class: 'chips' }, mine.map((s) => {
        const other = s.exercise_id !== ex.id ? ` ${(d.exById.get(s.exercise_id) || {}).name || ''}` : '';
        return h('button', { type: 'button', class: 'chip chip-btn-inline' + (prIds.has(s.id) ? ' chip-pr' : ''), onclick: () => editSet(s, ex) }, `${s.set_number}: ${fmtLb(s.weight_lb)} × ${s.reps}${other}`);
      }))
    ));
  }

  // Entry, pre-filled from last time.
  const setNo = mine.length + 1;
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
      h('div', { class: 'entry-col' }, h('div', { class: 'entry-label' }, `Weight (${loadLabel(ex.load_type)})`), weight),
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

  const isExtraSet = setNo > m.target;
  panel.append(h('button', {
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
        set_number: setNo,
        weight_lb: w,
        plates_json: ex.load_type === 'plates' ? plates : null,
        reps: r,
        logged_at: nowISO(),
      });
      const after = [...sSets, saved];
      if (prs.length) toast(`PR! ${prs.map((p) => p.text).join(' · ')}`, { pr: true, ms: 4000 });

      // Rest after a single set, or after the last exercise of a superset round.
      const myCount = memberSets(m, after).length;
      const roundDone = block.members.every((mm) => memberSets(mm, after).length >= myCount);
      if (block.members.length === 1 || roundDone) startRest(ex.default_rest_sec || 90);

      delete cursor.member[bIdx];
      if (!wasDone && blockDone(block, after)) {
        let next = blocks.findIndex((b, i) => i > bIdx && !blockDone(b, after));
        if (next < 0) next = blocks.findIndex((b) => !blockDone(b, after));
        if (next >= 0) {
          cursor.block = next;
          if (!prs.length) toast(`Slot done. Next: slot ${next + 1}`);
        } else if (!prs.length) toast('Every slot is done. Tap Finish when ready.');
      }
      await persistCursor();
      rerender();
    },
  }, isExtraSet ? `Log extra set ${setNo}` : `Log set ${setNo} of ${m.target}`));

  // Off-plan exercise controls.
  if (m.kind === 'extra') {
    const tpl = session.template_id ? d.tplById.get(session.template_id) : null;
    panel.append(h('div', { class: 'row gap' },
      tpl ? h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => addToTemplate(d, session, ex, sSets) }, `Add to template ${tpl.name}`) : null,
      !mine.length ? h('button', {
        type: 'button',
        class: 'btn btn-secondary grow',
        onclick: async () => {
          await save('sessions', { ...session, extras_json: extrasOf(session).filter((id) => id !== ex.id) });
          rerender();
        },
      }, 'Remove from session') : null
    ));
  }
  return panel;
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
  await save('sessions', { ...session, extras_json: extrasOf(session).filter((id) => id !== ex.id) });
  cursor.focusKey = slot.id;
  await persistCursor();
  toast(`Added to ${templateLabel(d, session.template_id)}. Edit sets and reps in Templates.`);
  rerender();
}

function editSet(set, ex) {
  openSheet(`Set ${set.set_number}`, (body, api) => {
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
  openSheet(`Rest for ${ex.name}`, (body, api) => {
    const setRest = async (sec) => {
      await save('exercises', { ...ex, default_rest_sec: sec });
      api.close();
      toast(`Rest set to ${sec} s`);
      rerender();
    };
    const custom = h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: ex.default_rest_sec || 90 });
    body.append(
      h('div', { class: 'row gap wrap' }, [45, 60, 90, 120, 150, 180, 240].map((s) =>
        h('button', { type: 'button', class: 'btn btn-secondary small-btn' + (s === ex.default_rest_sec ? ' selected' : ''), onclick: () => setRest(s) }, `${s} s`))),
      field('Custom (seconds)', custom),
      h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => setRest(Math.max(5, parseInt(custom.value, 10) || 90)) }, 'Save')
    );
  });
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
      const change = (dlt) => {
        st.per_side[p] = Math.max(0, (st.per_side[p] || 0) + dlt);
        count.textContent = String(st.per_side[p]);
        showTotal();
      };
      body.append(h('div', { class: 'plate-row' },
        h('span', { class: 'grow strong' }, `${p} lb`),
        h('button', { type: 'button', class: 'step-btn', 'aria-label': `Remove a ${p} lb plate`, onclick: () => change(-1) }, '−'),
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
