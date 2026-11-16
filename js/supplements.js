// Supplements tab. Today: a checklist grouped by time slot; tap to mark taken.
// Dose, schedule and slots are versioned with their date so history shows what
// was taken when. Items can be paused or archived without losing history.
// No push notifications or reminders.

import { all, save, saveMany } from './db.js';
import {
  h, clear, toast, openSheet, field, todayStr, parseDay, daysBetween, fmtDay, fmtTime,
  nowISO, sortBy, ts, dayEndMs, emptyNote, confirmSheet,
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

export function scheduleText(version) {
  const s = schedOf(version);
  if (s.type === 'every_n') return `Every ${s.n} days from ${fmtDay(s.start)}`;
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
    h('header', { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', null, 'Supplements'), h('div', { class: 'muted small' }, fmtDay(day))),
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { view = 'manage'; rerender(); } }, 'Manage')
    )
  );
  const active = data.supps.filter((s) => !s.archived && !s.paused);
  if (!active.length) {
    root.append(
      emptyNote('No active supplements yet.'),
      h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => openEditor(data, null) }, 'Add supplement')
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
        'aria-pressed': isTaken ? 'true' : 'false',
        onclick: async () => {
          if (isTaken) await saveMany('supplement_logs', logs.map((l) => ({ ...l, deleted: true })));
          else await save('supplement_logs', { supplement_id: s.id, slot, date: day, taken_at: nowISO() });
          rerender();
        },
      },
      h('span', { class: 'check-box' }, isTaken ? '✓' : ''),
      h('span', { class: 'grow' }, h('span', { class: 'strong' }, s.name), h('span', { class: 'muted' }, ` · ${v.dose} ${s.unit || ''}`)),
      isTaken ? h('span', { class: 'muted small' }, fmtTime(logs[0].taken_at)) : null));
    }
    root.append(list);
  }
  if (!shown) root.append(emptyNote('Nothing scheduled today.'));
  else root.insertBefore(h('p', { class: 'muted small' }, `${taken} of ${shown} taken`), root.children[1]);
}

function renderManage(root, data) {
  root.append(
    h('header', { class: 'page-head' },
      h('button', { type: 'button', class: 'btn-text back', onclick: () => { view = 'today'; rerender(); } }, '‹ Today'),
      h('h1', null, 'Manage')
    ),
    h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => openEditor(data, null) }, 'Add supplement')
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
      return h('button', { type: 'button', class: 'list-row', onclick: () => openEditor(data, s) },
        h('span', { class: 'grow' }, h('span', { class: 'strong' }, s.name),
          v ? h('span', { class: 'muted small block-text' }, `${v.dose} ${s.unit || ''} · ${scheduleText(v)} · ${slotsOf(v).join(', ')}`) : null),
        h('span', { class: 'muted small' }, 'Edit'));
    })));
  }
  if (!data.supps.length) root.append(emptyNote('No supplements yet.'));
}

function openEditor(data, supp) {
  const isNew = !supp;
  const current = supp ? versionOn(data, supp.id, todayStr()) || (data.vBySupp.get(supp.id) || []).slice(-1)[0] : null;
  const sched = { type: 'daily', n: 2, start: todayStr(), days: [], ...(current ? schedOf(current) : {}) };
  const chosenSlots = new Set(current ? slotsOf(current) : ['Morning']);

  openSheet(isNew ? 'Add supplement' : supp.name, (body, api) => {
    const name = h('input', { class: 'input', type: 'text', value: supp ? supp.name : '', placeholder: 'Name', autocomplete: 'off' });
    const dose = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: current ? current.dose : '', placeholder: 'Dose' });
    const unit = h('input', { class: 'input', type: 'text', value: supp ? supp.unit || '' : '', placeholder: 'mg, mcg, IU, capsules', list: 'unit-list' });
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

    body.append(
      field('Name', name),
      h('div', { class: 'row gap' }, h('div', { class: 'grow' }, field('Dose', dose)), h('div', { class: 'grow' }, field('Unit', unit))),
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
  openSheet(`${supp.name} history`, (body) => {
    body.append(
      h('div', { class: 'section-label' }, 'Dose and schedule changes'),
      versions.length
        ? h('div', { class: 'list' }, versions.map((v) => h('div', { class: 'list-row static' },
          h('span', { class: 'grow' }, fmtDay(v.effective_from)),
          h('span', { class: 'muted small right' }, `${v.dose} ${supp.unit || ''} · ${scheduleText(v)} · ${slotsOf(v).join(', ')}`))))
        : emptyNote('No entries.'),
      h('div', { class: 'section-label' }, 'Taken'),
      logs.length
        ? h('div', { class: 'list' }, logs.map((l) => {
          const v = versionOn(data, supp.id, l.date);
          return h('div', { class: 'list-row static' },
            h('span', { class: 'grow' }, `${fmtDay(l.date)} · ${l.slot}`),
            h('span', { class: 'muted small' }, `${v ? v.dose : '?'} ${supp.unit || ''}${l.taken_at ? ` at ${fmtTime(l.taken_at)}` : ''}`));
        }))
        : emptyNote('Nothing logged yet.')
    );
  });
}
