// Template editor: add, remove and reorder slots, change sets and target reps,
// set a default exercise, and group or ungroup supersets. Saved at once.

import { save, saveMany } from './db.js';
import { h, clear, openSheet, field, toast, confirmSheet, segmented, emptyNote } from './util.js';
import { loadLifting, exercisesFor } from './lifting-data.js';
import { TEMPLATE_A } from './seed.js';

let selectedTpl = TEMPLATE_A;

export async function renderTemplates(root, onBack) {
  const d = await loadLifting();
  if (!d.tplById.has(selectedTpl) && d.templates[0]) selectedTpl = d.templates[0].id;
  const rerender = () => renderTemplates(root, onBack);
  const slots = d.slotsByTpl.get(selectedTpl) || [];
  clear(root);

  root.append(
    h('header', { class: 'page-head' },
      h('button', { type: 'button', class: 'btn-text back', onclick: onBack }, '‹ Back'),
      h('h1', null, 'Templates')
    ),
    segmented(d.templates.map((t) => ({ value: t.id, label: `Workout ${t.name}` })), selectedTpl, (v) => { selectedTpl = v; rerender(); }),
    h('p', { class: 'muted small' }, 'Changes save immediately and apply to the next session.')
  );

  const list = h('div', { class: 'stack' });
  if (!slots.length) list.append(emptyNote('No slots yet. Add one below.'));
  slots.forEach((slot, i) => {
    const cat = d.catById.get(slot.category_id);
    const def = slot.default_exercise_id ? d.exById.get(slot.default_exercise_id) : null;
    const prev = slots[i - 1];
    const next = slots[i + 1];
    const inGroup = slot.superset_group != null && ((prev && prev.superset_group === slot.superset_group) || (next && next.superset_group === slot.superset_group));
    const groupedWithNext = next && slot.superset_group != null && next.superset_group === slot.superset_group;
    list.append(
      h('div', { class: 'card slot-card' + (inGroup ? ' in-superset' : '') },
        h('div', { class: 'row' },
          h('div', { class: 'slot-num' }, String(i + 1)),
          h('div', { class: 'grow' },
            h('div', { class: 'strong' }, cat ? cat.name : 'Missing category'),
            h('div', { class: 'muted small' },
              `${slot.sets} ${inGroup ? 'rounds' : 'sets'}${slot.target_reps ? ` × ${slot.target_reps} reps` : ''}`,
              def ? ` · default: ${def.name}` : '',
              inGroup ? ' · superset' : ''),
            slot.note ? h('div', { class: 'muted small' }, slot.note) : null
          )
        ),
        h('div', { class: 'row gap wrap' },
          h('button', { type: 'button', class: 'btn btn-secondary small-btn', disabled: i === 0, onclick: () => move(slots, i, -1).then(rerender), 'aria-label': 'Move up' }, '↑'),
          h('button', { type: 'button', class: 'btn btn-secondary small-btn', disabled: i === slots.length - 1, onclick: () => move(slots, i, 1).then(rerender), 'aria-label': 'Move down' }, '↓'),
          h('button', { type: 'button', class: 'btn btn-secondary small-btn', onclick: () => openSlotEditor(d, slot, rerender) }, 'Edit'),
          next ? h('button', {
            type: 'button',
            class: 'btn btn-secondary small-btn',
            onclick: () => (groupedWithNext ? ungroupFromNext(slots, i) : groupWithNext(slots, i)).then(rerender),
          }, groupedWithNext ? 'Ungroup next' : 'Superset with next') : null,
          h('button', {
            type: 'button',
            class: 'btn btn-danger small-btn',
            onclick: async () => {
              if (!(await confirmSheet(`Remove ${cat ? cat.name : 'this slot'} from the template? Logged history stays.`, 'Remove'))) return;
              await save('template_slots', { ...slot, deleted: true });
              await renumber(slots.filter((s) => s.id !== slot.id));
              toast('Slot removed');
              rerender();
            },
          }, 'Remove')
        )
      )
    );
  });
  root.append(
    list,
    h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => openSlotEditor(d, null, rerender) }, 'Add slot')
  );
}

async function renumber(slots) {
  const changed = slots.map((s, i) => ({ ...s, position: i + 1 })).filter((s, i) => slots[i].position !== s.position);
  await saveMany('template_slots', changed);
}

async function move(slots, i, dir) {
  const arr = [...slots];
  const j = i + dir;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  await renumber(arr);
}

async function groupWithNext(slots, i) {
  const a = slots[i];
  const b = slots[i + 1];
  const used = slots.map((s) => s.superset_group).filter((g) => g != null);
  const g = a.superset_group != null ? a.superset_group : (used.length ? Math.max(...used) + 1 : 1);
  const updates = [];
  if (a.superset_group !== g) updates.push({ ...a, superset_group: g });
  // Pull in b and anything grouped with b that follows it.
  const oldB = b.superset_group;
  for (let k = i + 1; k < slots.length; k++) {
    const s = slots[k];
    if (k === i + 1 || (oldB != null && s.superset_group === oldB && slots[k - 1].superset_group === oldB)) {
      updates.push({ ...s, superset_group: g });
    } else break;
  }
  await saveMany('template_slots', updates);
  toast('Grouped as a superset');
}

async function ungroupFromNext(slots, i) {
  // Split the group between slot i and slot i + 1. A side left with one slot is ungrouped.
  const g = slots[i].superset_group;
  let start = i;
  while (start > 0 && slots[start - 1].superset_group === g) start--;
  let end = i + 1;
  while (end + 1 < slots.length && slots[end + 1].superset_group === g) end++;
  const left = slots.slice(start, i + 1);
  const right = slots.slice(i + 1, end + 1);
  const used = slots.map((s) => s.superset_group).filter((x) => x != null);
  const newG = Math.max(...used) + 1;
  const updates = [];
  if (left.length === 1) updates.push({ ...left[0], superset_group: null });
  if (right.length === 1) updates.push({ ...right[0], superset_group: null });
  else right.forEach((s) => updates.push({ ...s, superset_group: newG }));
  await saveMany('template_slots', updates);
  toast('Superset split');
}

function openSlotEditor(d, slot, onDone) {
  const isNew = !slot;
  const tplSlots = d.slotsByTpl.get(selectedTpl) || [];
  const s = slot || { template_id: selectedTpl, position: tplSlots.length + 1, category_id: d.categories[0] && d.categories[0].id, sets: 3, target_reps: 10, superset_group: null, default_exercise_id: null, note: '' };
  openSheet(isNew ? 'Add slot' : 'Edit slot', (body, api) => {
    const cat = h('select', { class: 'input', value: s.category_id }, d.categories.map((c) => h('option', { value: c.id }, c.name)));
    const defEx = h('select', { class: 'input' });
    const fillEx = () => {
      clear(defEx);
      defEx.append(h('option', { value: '' }, 'None (use last time)'));
      for (const e of exercisesFor(d, cat.value, s.default_exercise_id)) defEx.append(h('option', { value: e.id }, e.name));
      defEx.value = [...defEx.options].some((o) => o.value === s.default_exercise_id) ? s.default_exercise_id : '';
    };
    cat.addEventListener('change', () => { s.default_exercise_id = null; fillEx(); });
    fillEx();
    const sets = h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: s.sets ?? 3, min: '1' });
    const reps = h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: s.target_reps ?? '', placeholder: 'Target reps' });
    const note = h('input', { class: 'input', type: 'text', value: s.note || '', placeholder: 'Optional note' });
    body.append(
      field('Category', cat),
      field('Default exercise', defEx, 'Used the first time. After that the last exercise used in this slot is picked.'),
      field('Sets (or rounds in a superset)', sets),
      field('Target reps', reps, 'When the top set reaches this, the cue says "Add weight today."'),
      field('Note', note),
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          await save('template_slots', {
            ...s,
            category_id: cat.value,
            default_exercise_id: defEx.value || null,
            sets: Math.max(1, parseInt(sets.value, 10) || 1),
            target_reps: parseInt(reps.value, 10) || null,
            note: note.value.trim(),
          });
          api.close();
          toast(isNew ? 'Slot added' : 'Slot saved');
          onDone();
        },
      }, isNew ? 'Add slot' : 'Save')
    );
  });
}
