// Run log and walking pad log. Runs: date, duration, distance, notes; pace is
// calculated. Walking pad: miles only (no duration, no pace).

import { all, save, remove } from './db.js';
import {
  h, clear, field, toast, openSheet, confirmSheet, todayStr, fmtDay, fmtDuration, fmtPace,
  round2, startOfWeek, addDays, dateStr, sortBy, emptyNote, pageHead,
} from './util.js';
import { runPace, runRecords, detectRunPRs } from './prs.js';

export async function loadCardio() {
  const runs = await all('runs');
  return sortBy(runs, (r) => r.date + 'T' + (r.updated_at || ''), true);
}

/** Miles of one type between two local dates (inclusive start, exclusive end). */
function milesBetween(entries, type, start, end) {
  const s = dateStr(start);
  const e = dateStr(end);
  return entries.filter((r) => r.type === type && r.date >= s && r.date < e).reduce((a, r) => a + (Number(r.distance_mi) || 0), 0);
}

export function padWeeks(entries) {
  const thisWeek = startOfWeek(new Date());
  const lastWeek = addDays(thisWeek, -7);
  return {
    thisWeek: milesBetween(entries, 'walking_pad', thisWeek, addDays(thisWeek, 7)),
    lastWeek: milesBetween(entries, 'walking_pad', lastWeek, thisWeek),
  };
}

function cardioForm(type, entry, onSubmit, submitLabel) {
  const date = h('input', { class: 'input', type: 'date', value: entry.date || todayStr() });
  const dist = h('input', { class: 'input big-input', type: 'number', inputmode: 'decimal', step: 'any', placeholder: '0.0', 'aria-label': 'Distance in miles', value: entry.distance_mi ?? '' });
  const notes = h('input', { class: 'input', type: 'text', placeholder: 'Optional notes', value: entry.notes || '' });
  const form = h('div', { class: 'stack' });
  let min = null;
  let sec = null;
  const paceOut = h('div', { class: 'pace-out' });
  const updatePace = () => {
    if (type !== 'run') return;
    const total = (parseInt(min.value, 10) || 0) * 60 + (parseInt(sec.value, 10) || 0);
    const d = parseFloat(dist.value) || 0;
    paceOut.textContent = total > 0 && d > 0 ? `Pace ${fmtPace(total / d)}` : 'Pace shows when time and distance are in';
  };
  form.append(field('Date', date));
  if (type === 'run') {
    const dur = Number(entry.duration_sec) || 0;
    min = h('input', { class: 'input big-input', type: 'number', inputmode: 'numeric', placeholder: 'min', 'aria-label': 'Minutes', value: dur ? Math.floor(dur / 60) : '' });
    sec = h('input', { class: 'input big-input', type: 'number', inputmode: 'numeric', placeholder: 'sec', 'aria-label': 'Seconds', value: dur ? dur % 60 : '' });
    form.append(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Duration (min : sec)'), h('div', { class: 'duration-row' }, min, h('span', { class: 'duration-sep', 'aria-hidden': 'true' }, ':'), sec)));
    [min, sec, dist].forEach((x) => x.addEventListener('input', updatePace));
  }
  form.append(field('Distance (miles)', dist));
  if (type === 'run') form.append(paceOut);
  form.append(field('Notes', notes));
  updatePace();
  form.append(h('button', {
    type: 'button',
    class: 'btn btn-primary block',
    onclick: () => {
      const distance = parseFloat(dist.value);
      if (!(distance > 0)) return toast('Enter the distance.');
      const row = { ...entry, type, date: date.value || todayStr(), distance_mi: round2(distance), notes: notes.value.trim() };
      if (type === 'run') {
        const total = (parseInt(min.value, 10) || 0) * 60 + (parseInt(sec.value, 10) || 0);
        if (!(total > 0)) return toast('Enter the duration.');
        row.duration_sec = total;
      } else {
        row.duration_sec = null;
      }
      onSubmit(row);
    },
  }, submitLabel));
  return form;
}

function entryRow(r, onEdit) {
  const p = runPace(r);
  return h('button', { type: 'button', class: 'list-row nav', 'data-multiline': '', onclick: () => onEdit(r) },
    h('span', { class: 'grow' },
      h('span', { class: 'row-title' }, fmtDay(r.date)),
      r.type === 'run' ? h('span', { class: 'row-sub num' }, `${fmtDuration(r.duration_sec)} · ${fmtPace(p)}`) : null,
      r.notes ? h('span', { class: 'row-sub' }, r.notes) : null),
    h('span', { class: 'trail' }, `${round2(r.distance_mi)} mi`)
  );
}

export function openCardioEditor(entry, onDone) {
  openSheet(entry.type === 'run' ? 'Edit run' : 'Edit walking pad', (body, api) => {
    body.append(
      cardioForm(entry.type, entry, async (row) => {
        await save('runs', row);
        api.close();
        toast('Saved');
        onDone();
      }, 'Save'),
      h('button', {
        type: 'button',
        class: 'btn btn-danger block',
        onclick: async () => {
          if (!(await confirmSheet('Delete this entry?'))) return;
          await remove('runs', entry.id);
          api.close();
          toast('Deleted');
          onDone();
        },
      }, 'Delete')
    );
  });
}

/** Full-screen log view for 'run' or 'walking_pad'. */
export async function renderCardio(root, type, onBack) {
  const entries = await loadCardio();
  const rerender = () => renderCardio(root, type, onBack);
  const mine = entries.filter((r) => r.type === type);
  clear(root);
  root.append(
    pageHead({ title: type === 'run' ? 'Run' : 'Walking pad', back: onBack, backLabel: 'Workout' })
  );

  if (type === 'run') {
    const last = mine[0];
    const { longest, fastest } = runRecords(entries);
    root.append(
      h('div', { class: 'card' },
        last
          ? [
            h('div', { class: 'section-label' }, `Last run · ${fmtDay(last.date)}`),
            h('div', { class: 'two-col three' },
              h('div', null, h('div', { class: 'stat-label' }, 'Distance'), h('div', { class: 'big-stat' }, `${round2(last.distance_mi)} mi`)),
              h('div', null, h('div', { class: 'stat-label' }, 'Time'), h('div', { class: 'big-stat' }, fmtDuration(last.duration_sec))),
              h('div', null, h('div', { class: 'stat-label' }, 'Pace'), h('div', { class: 'big-stat' }, fmtPace(runPace(last)).replace(' /mi', '')))),
            h('div', { class: 'cue' }, 'Go a little farther or a little faster than last time.'),
          ]
          : h('div', { class: 'cue' }, 'First run logged here. Any distance counts.'),
        longest || fastest
          ? h('div', { class: 'pr-line' },
            longest ? h('span', { class: 'pr-text' }, `Longest ${round2(longest.distance_mi)} mi`) : null,
            fastest ? h('span', { class: 'pr-text' }, `Best pace ${fmtPace(runPace(fastest))}`) : null)
          : null
      )
    );
  } else {
    const last = mine[0];
    const w = padWeeks(entries);
    const beat = w.thisWeek >= w.lastWeek && w.lastWeek > 0;
    root.append(
      h('div', { class: 'card' },
        h('div', { class: 'section-label' }, last ? `Last entry · ${fmtDay(last.date)}` : 'No walking pad entries yet'),
        last ? h('div', { class: 'big-stat' }, `${round2(last.distance_mi)} mi`) : null,
        h('div', { class: 'two-col' },
          h('div', null, h('div', { class: 'stat-label' }, 'This week'), h('div', { class: 'big-stat' }, `${round2(w.thisWeek)} mi`)),
          h('div', null, h('div', { class: 'stat-label' }, 'Last week'), h('div', { class: 'big-stat' }, `${round2(w.lastWeek)} mi`))
        ),
        h('div', { class: 'cue' + (beat ? ' cue-good' : '') },
          w.lastWeek > 0
            ? (beat ? 'You matched or beat last week. Keep going.' : `Match or beat last week: ${round2(w.lastWeek - w.thisWeek)} mi to go.`)
            : 'Set a baseline this week, then match or beat it next week.')
      )
    );
  }

  root.append(
    h('div', { class: 'section-label' }, type === 'run' ? 'New run' : 'New entry'),
    h('div', { class: 'card' },
      cardioForm(type, {}, async (row) => {
        const prs = detectRunPRs(entries, row);
        await save('runs', row);
        if (prs.length) toast(`PR! ${prs.map((p) => p.text).join(' · ')}`, { pr: true, ms: 4000 });
        else toast(type === 'run' ? 'Run saved' : 'Walking pad saved');
        onBack();
      }, type === 'run' ? 'Save run' : 'Save walking pad')
    ),
    h('div', { class: 'section-label' }, 'Recent'),
    mine.length ? h('div', { class: 'list card' }, mine.slice(0, 15).map((r) => entryRow(r, (e) => openCardioEditor(e, rerender)))) : h('div', { class: 'card' }, emptyNote('Nothing logged yet.'))
  );
}
