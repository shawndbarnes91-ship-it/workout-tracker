// Exercise library and categories: browse, add, edit, archive. Also the exercise
// picker used by "Add Exercise" during a session.

import { save, saveMany, remove } from './db.js';
import { h, clear, openSheet, field, toast, confirmSheet, emptyNote } from './util.js';
import { loadLifting, LOAD_TYPES } from './lifting-data.js';
import { MUSCLE_GROUPS } from './seed.js';

let showArchived = false;
let search = '';

export async function renderLibrary(root, onBack) {
  const d = await loadLifting();
  clear(root);
  const rerender = () => renderLibrary(root, onBack);

  const listWrap = h('div', { class: 'stack' });
  const drawList = () => {
    clear(listWrap);
    const q = search.trim().toLowerCase();
    let any = false;
    for (const cat of d.categories) {
      const exs = (d.exsByCat.get(cat.id) || []).filter((e) => (showArchived || !e.archived) && (!q || e.name.toLowerCase().includes(q)));
      if (q && !exs.length) continue;
      any = true;
      listWrap.append(
        h('details', { class: 'card cat-card', open: q ? true : null },
          h('summary', { class: 'cat-summary' },
            h('span', { class: 'grow' }, cat.name, h('span', { class: 'muted small' }, ` · ${cat.muscle_group || 'No group'} · ${exs.length}`))
          ),
          h('div', { class: 'list' },
            exs.length ? exs.map((ex) =>
              h('button', {
                type: 'button',
                class: 'list-row',
                onclick: () => openExerciseEditor({ exercise: ex, data: d, onSaved: rerender }),
              },
              h('span', { class: 'grow' }, ex.name, ex.archived ? h('span', { class: 'muted small' }, ' (archived)') : null),
              h('span', { class: 'muted small' }, ex.load_type))
            ) : emptyNote('No exercises yet.'),
            h('div', { class: 'row gap' },
              h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => openExerciseEditor({ presetCategoryId: cat.id, data: d, onSaved: rerender }) }, 'Add exercise here'),
              h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => openCategoryEditor({ category: cat, data: d, onSaved: rerender }) }, 'Edit category')
            )
          )
        )
      );
    }
    if (!any) listWrap.append(emptyNote('Nothing matches.'));
  };

  const searchInput = h('input', { type: 'search', class: 'input', placeholder: 'Search exercises', value: search });
  searchInput.addEventListener('input', () => { search = searchInput.value; drawList(); });

  root.append(
    h('header', { class: 'page-head' },
      h('button', { type: 'button', class: 'btn-text back', onclick: onBack }, '‹ Back'),
      h('h1', null, 'Exercises')
    ),
    h('div', { class: 'row gap' },
      h('button', { type: 'button', class: 'btn btn-primary grow', onclick: () => openExerciseEditor({ data: d, onSaved: rerender }) }, 'Add exercise'),
      h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => openCategoryEditor({ data: d, onSaved: rerender }) }, 'Add category')
    ),
    searchInput,
    h('label', { class: 'check-row' },
      h('input', { type: 'checkbox', checked: showArchived, onchange: (e) => { showArchived = e.target.checked; drawList(); } }),
      h('span', null, 'Show archived exercises')
    ),
    listWrap
  );
  drawList();
}

/** Add or edit an exercise. onSaved(exercise) runs after saving. */
export async function openExerciseEditor({ exercise = null, presetCategoryId = null, data = null, onSaved }) {
  const d = data || (await loadLifting());
  const ex = exercise || { name: '', load_type: 'machine', default_rest_sec: 90, setup_note: '', bar_lb: 45, archived: false };
  const currentCats = new Set(exercise ? d.catsByEx.get(exercise.id) || [] : presetCategoryId ? [presetCategoryId] : []);

  openSheet(exercise ? 'Edit exercise' : 'New exercise', (body, api) => {
    const name = h('input', { class: 'input', type: 'text', value: ex.name, placeholder: 'Exercise name', autocomplete: 'off' });
    const load = h('select', { class: 'input', value: ex.load_type }, LOAD_TYPES.map((t) => h('option', { value: t.value }, t.label)));
    const bar = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: ex.bar_lb ?? 45 });
    const barField = field('Bar or sled weight (lb)', bar, 'Used by the plate calculator.');
    const rest = h('input', { class: 'input', type: 'number', inputmode: 'numeric', value: ex.default_rest_sec ?? 90 });
    const note = h('textarea', { class: 'input', rows: '2', placeholder: 'Seat height, pin position, grip' }, ex.setup_note || '');
    const syncBar = () => { barField.hidden = load.value !== 'plates'; };
    load.addEventListener('change', syncBar);
    syncBar();

    const catChecks = d.categories.map((c) => {
      const cb = h('input', { type: 'checkbox', value: c.id, checked: currentCats.has(c.id) });
      return { cb, row: h('label', { class: 'check-row' }, cb, h('span', null, c.name)) };
    });

    body.append(
      field('Name', name),
      field('Load type', load),
      barField,
      field('Default rest (seconds)', rest),
      field('Setup note', note),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Categories'), h('div', { class: 'check-list' }, catChecks.map((c) => c.row))),
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          const nm = name.value.trim();
          const cats = catChecks.filter((c) => c.cb.checked).map((c) => c.cb.value);
          if (!nm) return toast('Give it a name.');
          if (!cats.length) return toast('Pick at least one category.');
          const saved = await save('exercises', {
            ...ex,
            name: nm,
            load_type: load.value,
            bar_lb: load.value === 'plates' ? parseFloat(bar.value) || 0 : ex.bar_lb ?? null,
            default_rest_sec: Math.max(0, parseInt(rest.value, 10) || 0),
            setup_note: note.value.trim(),
            archived: !!ex.archived,
          });
          const existing = d.links.filter((l) => l.exercise_id === saved.id);
          const add = cats.filter((c) => !existing.some((l) => l.category_id === c)).map((c) => ({ exercise_id: saved.id, category_id: c }));
          const drop = existing.filter((l) => !cats.includes(l.category_id)).map((l) => ({ ...l, deleted: true }));
          await saveMany('exercise_categories', [...add, ...drop]);
          api.close();
          toast(exercise ? 'Exercise saved' : 'Exercise added');
          if (onSaved) onSaved(saved);
        },
      }, exercise ? 'Save' : 'Add exercise'),
      exercise ? h('button', {
        type: 'button',
        class: 'btn btn-secondary block',
        onclick: async () => {
          await save('exercises', { ...ex, archived: !ex.archived });
          api.close();
          toast(ex.archived ? 'Exercise restored' : 'Exercise archived; its history stays');
          if (onSaved) onSaved(ex);
        },
      }, ex.archived ? 'Unarchive' : 'Archive') : null
    );
  });
}

/** Add or edit a category. */
export async function openCategoryEditor({ category = null, data = null, onSaved }) {
  const d = data || (await loadLifting());
  const cat = category || { name: '', muscle_group: '', sort_order: (d.categories.length ? Math.max(...d.categories.map((c) => c.sort_order || 0)) : 0) + 1 };
  openSheet(category ? 'Edit category' : 'New category', (body, api) => {
    const name = h('input', { class: 'input', type: 'text', value: cat.name, placeholder: 'Category name', autocomplete: 'off' });
    const listId = 'muscle-groups-list';
    const group = h('input', { class: 'input', type: 'text', value: cat.muscle_group || '', list: listId, placeholder: 'Muscle group' });
    const dl = h('datalist', { id: listId }, MUSCLE_GROUPS.map((g) => h('option', { value: g })));
    const inUse = category ? d.slots.some((s) => s.category_id === category.id) : false;
    body.append(
      field('Name', name),
      field('Muscle group', group, 'Used for weekly sets per muscle group in Stats.'),
      dl,
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          const nm = name.value.trim();
          if (!nm) return toast('Give it a name.');
          const saved = await save('categories', { ...cat, name: nm, muscle_group: group.value.trim() || 'Other' });
          api.close();
          toast(category ? 'Category saved' : 'Category added');
          if (onSaved) onSaved(saved);
        },
      }, category ? 'Save' : 'Add category'),
      category ? h('button', {
        type: 'button',
        class: 'btn btn-danger block',
        disabled: inUse,
        onclick: async () => {
          if (!(await confirmSheet(`Delete the category "${cat.name}"? Exercises and history stay.`))) return;
          await remove('categories', cat.id);
          const links = d.links.filter((l) => l.category_id === cat.id);
          await saveMany('exercise_categories', links.map((l) => ({ ...l, deleted: true })));
          api.close();
          toast('Category deleted');
          if (onSaved) onSaved(null);
        },
      }, 'Delete category') : null,
      inUse ? h('p', { class: 'muted small' }, 'This category is used in a template, so it cannot be deleted. Remove it from the templates first.') : null
    );
  });
}

/** Pick any exercise from the library, or create one on the spot. */
export async function openExercisePicker({ title = 'Add exercise', onPick }) {
  const d = await loadLifting();
  let q = '';
  openSheet(title, (body, api) => {
    const list = h('div', { class: 'stack' });
    const input = h('input', { type: 'search', class: 'input', placeholder: 'Search exercises' });
    const draw = () => {
      clear(list);
      const ql = q.trim().toLowerCase();
      let shown = 0;
      for (const cat of d.categories) {
        const exs = (d.exsByCat.get(cat.id) || []).filter((e) => !e.archived && (!ql || e.name.toLowerCase().includes(ql)));
        if (!exs.length) continue;
        list.append(h('div', { class: 'section-label' }, cat.name));
        for (const ex of exs) {
          shown += 1;
          list.append(h('button', { type: 'button', class: 'list-row', onclick: () => { api.close(); onPick(ex); } }, h('span', { class: 'grow' }, ex.name), h('span', { class: 'muted small' }, ex.load_type)));
        }
      }
      if (!shown) list.append(emptyNote('No match. Create it below.'));
    };
    input.addEventListener('input', () => { q = input.value; draw(); });
    body.append(
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: () => {
          api.close();
          openExerciseEditor({ data: d, onSaved: (ex) => ex && onPick(ex) });
        },
      }, 'Create new exercise'),
      input,
      list
    );
    draw();
  });
}
