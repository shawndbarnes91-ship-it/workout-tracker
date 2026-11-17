// Supplements tab. Today: a checklist grouped by time slot; tap to mark taken.
// Dose, schedule and slots are versioned with their date so history shows what
// was taken when. Items can be paused or archived without losing history.
// No push notifications or reminders.

import { all, save, saveMany } from './db.js';
import {
  h, add, clear, toast, openSheet, field, todayStr, parseDay, daysBetween, fmtDay, fmtTime,
  nowISO, sortBy, ts, dayEndMs, emptyNote, confirmSheet, pageHead, icon,
} from './util.js';

export const SLOTS = ['Morning', 'Night', 'Pre-workout', 'Post-workout'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let view = 'today'; // today | manage
let rootEl = null;

export async function loadSupplements() {
  const [supps, versions, logs] = await Promise.all([all('supplements'), all('supplement_versions'), all('supplement_logs')]);
  const vBySupp = new Map();
  for (const v of versions) {
    if (!vBySupp.has(v.supplement_id)) vBySupp.set(v.supplement_id, []);
    vBySupp.get(v.supplement_id).push(v);
  }
  for (const [k, list] of vBySupp) vBySupp.set(k, sortBy(list, (v) => ts(v.effective_from)));
  const ordered = [...supps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  return { supps: ordered, versions, logs, vBySupp };
}

/** The version in force at the end of a given day. */
export function versionOn(data, suppId, day) {
  const list = data.vBySupp.get(suppId) || [];
  const end = dayEndMs(day);
  let cur = null;
  for (const v of list) if (ts(v.effective_from) <= end) cur = v;
  return cur || null;
}

const slotsOf = (v) => (Array.isArray(v && v.slots) ? v.slots : []);
const schedOf = (v) => (v && v.schedule_json && typeof v.schedule_json === 'object' ? v.schedule_json : { type: 'daily' });

export function isDue(version, day) {
  const s = schedOf(version);
  if (s.type === 'every_n') {
    const n = Math.max(1, parseInt(s.n, 10) || 1);
    const start = s.start || String(version.effective_from).slice(0, 10);
    const diff = daysBetween(start, day);
    return diff >= 0 && diff % n === 0;
  }
  if (s.type === 'weekdays') {
    const days = Array.isArray(s.days) ? s.days : [];
    return days.includes(parseDay(day).getDay());
  }
  return true;
}

/** "5 mg"; rows synced with a missing dose read "No dose". */
export function doseText(version, supp) {
  const dose = version && version.dose != null && String(version.dose).trim() !== '' ? String(version.dose).trim() : '';
  const unit = supp && supp.unit ? supp.unit : '';
  return dose ? `${dose}${unit ? ` ${unit}` : ''}` : 'No dose';
}

export function scheduleText(version) {
  const s = schedOf(version);
  if (s.type === 'every_n') {
    const n = Math.max(1, parseInt(s.n, 10) || 1);
    const start = s.start || (version && version.effective_from ? String(version.effective_from).slice(0, 10) : null);
    const every = n === 1 ? 'Every day' : `Every ${n} days`;
    return start ? `${every} from ${fmtDay(start)}` : every;
  }
  if (s.type === 'weekdays') return (s.days || []).slice().sort().map((d) => WEEKDAYS[d]).join(', ') || 'No days picked';
  return 'Daily';
}

export async function render(root) {
  rootEl = root;
  const data = await loadSupplements();
  clear(root);
  if (view === 'manage') return renderManage(root, data);
  renderToday(root, data);
}

const rerender = () => rootEl && render(rootEl);

function renderToday(root, data) {
  const day = todayStr();
  root.append(
    pageHead({
      title: 'Supplements',
      sub: fmtDay(day),
      // Edit opens the full list (edit, pause, archive). Nothing to edit until one exists.
      actions: data.supps.length ? [h('button', { type: 'button', class: 'btn btn-secondary btn-head', onclick: () => { view = 'manage'; rerender(); } }, icon('pencil'), 'Edit')] : [],
    })
  );
  const active = data.supps.filter((s) => !s.archived && !s.paused);
  if (!active.length) {
    root.append(
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'No active supplements'),
        h('p', { class: 'muted small' }, 'Add what you take and when. Tap each one as you take it; history keeps every dose change.'),
        h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => openEditor(data, null) }, icon('plus'), 'Add supplement'))
    );
    return;
  }
  const todaysLogs = data.logs.filter((l) => l.date === day);
  let shown = 0;
  let taken = 0;
  for (const slot of SLOTS) {
    const items = active.filter((s) => {
      const v = versionOn(data, s.id, day);
      return v && slotsOf(v).includes(slot) && isDue(v, day);
    });
    if (!items.length) continue;
    root.append(h('div', { class: 'section-label' }, slot));
    const list = h('div', { class: 'card list' });
    for (const s of items) {
      const v = versionOn(data, s.id, day);
      const logs = todaysLogs.filter((l) => l.supplement_id === s.id && l.slot === slot);
      const isTaken = logs.length > 0;
      shown += 1;
      if (isTaken) taken += 1;
      list.append(h('button', {
        type: 'button',
        class: 'check-item' + (isTaken ? ' taken' : ''),
        'data-multiline': '',
        'aria-pressed': isTaken ? 'true' : 'false',
        onclick: async () => {
          if (isTaken) await saveMany('supplement_logs', logs.map((l) => ({ ...l, deleted: true })));
          else await save('supplement_logs', { supplement_id: s.id, slot, date: day, taken_at: nowISO() });
          rerender();
        },
      },
      h('span', { class: 'check-box' }, isTaken ? icon('check') : null),
      h('span', { class: 'grow' }, h('span', { class: 'row-title strong' }, s.name), h('span', { class: 'row-sub' }, doseText(v, s))),
      isTaken ? h('span', { class: 'trail' }, fmtTime(logs[0].taken_at)) : null));
    }
    root.append(list);
  }
  const addRow = () => h('button', { type: 'button', class: 'list-row add-row', onclick: () => openEditor(data, null) }, icon('plus'), h('span', { class: 'grow' }, 'Add'));
  if (!shown) root.append(h('div', { class: 'card list' }, h('div', { class: 'list-row static' }, emptyNote('Nothing scheduled today.')), addRow()));
  else {
    root.lastElementChild.append(addRow());
    root.insertBefore(h('div', { class: 'progress-line' },
      h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill', style: { width: `${Math.round((taken / shown) * 100)}%` } })),
      h('span', { class: 'muted small num' }, `${taken} of ${shown} taken`)), root.children[1]);
  }
}

function renderManage(root, data) {
  root.append(
    pageHead({ title: 'Edit', back: () => { view = 'today'; rerender(); }, backLabel: 'Today' }),
    h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => openEditor(data, null) }, icon('plus'), 'Add supplement')
  );
  const groups = [
    ['Active', data.supps.filter((s) => !s.archived && !s.paused)],
    ['Paused', data.supps.filter((s) => !s.archived && s.paused)],
    ['Archived', data.supps.filter((s) => s.archived)],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    root.append(h('div', { class: 'section-label' }, label));
    root.append(h('div', { class: 'card list' }, list.map((s) => {
      const v = versionOn(data, s.id, todayStr()) || (data.vBySupp.get(s.id) || [])[0];
      return h('button', { type: 'button', class: 'list-row nav', 'data-multiline': '', onclick: () => openEditor(data, s) },
        h('span', { class: 'grow' }, h('span', { class: 'row-title strong' }, s.name),
          v ? h('span', { class: 'row-sub' }, `${doseText(v, s)} · ${scheduleText(v)} · ${slotsOf(v).join(', ')}`) : null));
    })));
  }
  if (!data.supps.length) root.append(h('div', { class: 'card' }, emptyNote('No supplements yet.')));
}

function openEditor(data, supp) {
  const isNew = !supp;
  const current = supp ? versionOn(data, supp.id, todayStr()) || (data.vBySupp.get(supp.id) || []).slice(-1)[0] : null;
  const sched = { type: 'daily', n: 2, start: todayStr(), days: [], ...(current ? schedOf(current) : {}) };
  const chosenSlots = new Set(current ? slotsOf(current) : ['Morning']);

  openSheet(isNew ? 'Add supplement' : 'Edit supplement', (body, api) => {
    const name = h('input', { class: 'input', type: 'text', value: supp ? supp.name : '', placeholder: 'Name', autocomplete: 'off', maxlength: '40' });
    const dose = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: current ? current.dose : '', placeholder: 'Dose' });
    const unit = h('input', { class: 'input', type: 'text', value: supp ? supp.unit || '' : '', placeholder: 'mg, IU', list: 'unit-list' });
    const unitList = h('datalist', { id: 'unit-list' }, ['mg', 'mcg', 'g', 'IU', 'capsules', 'tablets', 'scoops', 'ml'].map((u) => h('option', { value: u })));

    const typeSel = h('select', { class: 'input', value: sched.type },
      h('option', { value: 'daily' }, 'Daily'),
      h('option', { value: 'every_n' }, 'Every N days'),
      h('option', { value: 'weekdays' }, 'Specific weekdays'));
    const nInput = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: '2', value: sched.n || 2 });
    const startInput = h('input', { class: 'input', type: 'date', value: sched.start || todayStr() });
    const everyN = h('div', { class: 'stack' }, field('Every how many days', nInput), field('Starting', startInput));
    const dayBtns = WEEKDAYS.map((label, i) => {
      const b = h('button', { type: 'button', class: 'day-btn' + (sched.days.includes(i) ? ' active' : ''), 'aria-pressed': sched.days.includes(i) ? 'true' : 'false' }, label);
      b.addEventListener('click', () => {
        const on = !b.classList.contains('active');
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      return b;
    });
    const weekdays = h('div', { class: 'day-row' }, dayBtns);
    const syncType = () => {
      everyN.hidden = typeSel.value !== 'every_n';
      weekdays.hidden = typeSel.value !== 'weekdays';
    };
    typeSel.addEventListener('change', syncType);
    syncType();

    const slotChecks = SLOTS.map((s) => {
      const cb = h('input', { type: 'checkbox', value: s, checked: chosenSlots.has(s) });
      return { cb, row: h('label', { class: 'check-row' }, cb, h('span', null, s)) };
    });

    add(body,
      field('Name', name),
      h('div', { class: 'two-col' }, field('Dose', dose), field('Unit', unit)),
      unitList,
      field('Schedule', typeSel),
      everyN,
      weekdays,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Time slots'), h('div', { class: 'check-list' }, slotChecks.map((c) => c.row))),
      !isNew ? h('p', { class: 'muted small' }, 'Changing dose, schedule or slots starts a new dated entry; earlier history keeps the old values.') : null,
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          const nm = name.value.trim();
          const doseVal = dose.value.trim();
          const slots = slotChecks.filter((c) => c.cb.checked).map((c) => c.cb.value);
          if (!nm) return toast('Give it a name.');
          if (!doseVal) return toast('Enter the dose.');
          if (!slots.length) return toast('Pick at least one time slot.');
          const type = typeSel.value;
          const schedule = type === 'every_n'
            ? { type, n: Math.max(2, parseInt(nInput.value, 10) || 2), start: startInput.value || todayStr() }
            : type === 'weekdays'
              ? { type, days: dayBtns.map((b, i) => (b.classList.contains('active') ? i : -1)).filter((i) => i >= 0) }
              : { type: 'daily' };
          if (type === 'weekdays' && !schedule.days.length) return toast('Pick at least one weekday.');
          const saved = await save('supplements', {
            ...(supp || { paused: false, archived: false, sort_order: data.supps.length + 1 }),
            name: nm,
            unit: unit.value.trim(),
          });
          const changed = !current
            || String(current.dose) !== doseVal
            || JSON.stringify(schedOf(current)) !== JSON.stringify(schedule)
            || JSON.stringify(slotsOf(current)) !== JSON.stringify(slots);
          if (changed) {
            await save('supplement_versions', { supplement_id: saved.id, dose: doseVal, schedule_json: schedule, slots, effective_from: nowISO() });
          }
          api.close();
          toast(isNew ? 'Supplement added' : changed ? 'Saved with today’s date' : 'Saved');
          rerender();
        },
      }, isNew ? 'Add supplement' : 'Save'),
      !isNew ? h('div', { class: 'row gap' },
        h('button', {
          type: 'button',
          class: 'btn btn-secondary grow',
          onclick: async () => {
            await save('supplements', { ...supp, paused: !supp.paused });
            api.close();
            toast(supp.paused ? 'Resumed' : 'Paused');
            rerender();
          },
        }, supp.paused ? 'Resume' : 'Pause'),
        h('button', {
          type: 'button',
          class: 'btn btn-secondary grow',
          onclick: async () => {
            if (!supp.archived && !(await confirmSheet(`Archive ${supp.name}? History stays.`, 'Archive'))) return;
            await save('supplements', { ...supp, archived: !supp.archived });
            api.close();
            toast(supp.archived ? 'Unarchived' : 'Archived');
            rerender();
          },
        }, supp.archived ? 'Unarchive' : 'Archive')
      ) : null,
      !isNew ? h('button', { type: 'button', class: 'btn btn-secondary block', onclick: () => { api.close(); openHistory(data, supp); } }, 'History') : null
    );
  });
}

function openHistory(data, supp) {
  const versions = [...(data.vBySupp.get(supp.id) || [])].reverse();
  const logs = sortBy(data.logs.filter((l) => l.supplement_id === supp.id), (l) => l.date + (l.taken_at || ''), true).slice(0, 90);
  openSheet('History', (body) => {
    body.append(
      h('div', { class: 'section-label' }, 'Dose and schedule changes'),
      versions.length
        ? h('div', { class: 'list card' }, versions.map((v) => h('div', { class: 'list-row static' },
          h('span', { class: 'grow' }, h('span', { class: 'row-title' }, fmtDay(v.effective_from)),
            h('span', { class: 'row-sub' }, `${doseText(v, supp)} · ${scheduleText(v)} · ${slotsOf(v).join(', ')}`)))))
        : emptyNote('No entries.'),
      h('div', { class: 'section-label' }, 'Taken'),
      logs.length
        ? h('div', { class: 'list card' }, logs.map((l) => {
          const v = versionOn(data, supp.id, l.date);
          return h('div', { class: 'list-row static' },
            h('span', { class: 'grow' }, h('span', { class: 'row-title' }, fmtDay(l.date)), h('span', { class: 'row-sub' }, l.slot)),
            h('span', { class: 'trail' }, `${v ? doseText(v, supp) : 'Dose unknown'}${l.taken_at ? ` · ${fmtTime(l.taken_at)}` : ''}`));
        }))
        : emptyNote('Nothing logged yet.')
    );
  }, { subtitle: supp.name });
}
