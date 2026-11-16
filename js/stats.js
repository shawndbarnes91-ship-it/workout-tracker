// Stats tab. One time-range picker at the top drives every chart and percentage:
// Last 24 hours, 7 days, 30 days, 90 days, All time, or a custom date range.
// Also holds the Progress section (photos and bodyweight) and Export.

import { all } from './db.js';
import {
  h, clear, segmented, field, ACCENT, DAY_MS, dateStr, todayStr, addDays, startOfWeek, dayStartMs, dayEndMs,
  fmtShortDay, fmtDay, fmtTime, fmtPace, round1, round2, e1rm, ts, sortBy, emptyNote, pad2,
} from './util.js';
import { loadLifting, muscleGroupOfSet, sessionsWithSets } from './lifting-data.js';
import { loadSupplements } from './supplements.js';
import { runPace, runPrIds } from './prs.js';
import { PRIORITY_GROUPS } from './seed.js';
import { renderProgress } from './progress.js';
import { exportAll } from './export.js';
import { configured, getState, syncNow } from './sync.js';

const RANGES = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];
const TARGET_PER_WEEK = 3;
const GREY = '#6b6b6b';

let rangeKey = '30d';
let customFrom = null;
let customTo = null;
let strengthEx = null;
let charts = [];
let rootEl = null;
let defaultsSet = false;

const rerender = () => {
  if (!rootEl) return;
  const y = window.scrollY;
  render(rootEl).then(() => window.scrollTo(0, y));
};

function setChartDefaults() {
  if (defaultsSet || !window.Chart) return;
  const C = window.Chart;
  C.defaults.color = '#bdbdbd';
  C.defaults.borderColor = '#1f1f1f';
  C.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  C.defaults.font.size = 12;
  C.defaults.animation = false;
  C.defaults.maintainAspectRatio = false;
  C.defaults.plugins.legend.labels.boxWidth = 12;
  defaultsSet = true;
}

function bounds(earliest) {
  const now = Date.now();
  switch (rangeKey) {
    case '24h': return { start: now - DAY_MS, end: now };
    case '7d': return { start: now - 7 * DAY_MS, end: now };
    case '30d': return { start: now - 30 * DAY_MS, end: now };
    case '90d': return { start: now - 90 * DAY_MS, end: now };
    case 'all': return { start: Math.min(earliest || now, now - DAY_MS), end: now };
    case 'custom': {
      const f = customFrom || dateStr(addDays(new Date(), -30));
      const t = customTo || todayStr();
      const a = dayStartMs(f);
      const b = dayEndMs(t);
      return a <= b ? { start: a, end: b } : { start: dayStartMs(t), end: dayEndMs(f) };
    }
    default: return { start: now - 30 * DAY_MS, end: now };
  }
}

const inTs = (r, iso) => {
  const t = ts(iso);
  return t >= r.start && t <= r.end;
};
/** A date-only value is in range when its day overlaps the range. */
const inDay = (r, day) => day && dayEndMs(day) >= r.start && dayStartMs(day) <= r.end;

const timeScale = (r) => ({
  type: 'linear',
  min: r.start,
  max: r.end,
  ticks: { maxTicksLimit: 5, callback: (v) => fmtShortDay(v) },
  grid: { color: '#161616' },
});

const paceTick = (v) => `${Math.floor(v / 60)}:${pad2(Math.round(v % 60))}`;

/** Draws supplement dose-change markers as dashed vertical lines. */
const doseMarkers = {
  id: 'doseMarkers',
  afterDatasetsDraw(chart, _args, opts) {
    const items = (opts && opts.items) || [];
    if (!items.length) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    ctx.save();
    ctx.strokeStyle = '#8a8a8a';
    ctx.fillStyle = '#cfcfcf';
    ctx.setLineDash([4, 4]);
    ctx.font = '11px -apple-system, sans-serif';
    for (const m of items) {
      const px = x.getPixelForValue(m.x);
      if (px < chartArea.left || px > chartArea.right) continue;
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.save();
      ctx.translate(px + 3, chartArea.top + 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(m.label, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  },
};

function makeChart(canvas, config) {
  const c = new window.Chart(canvas, config);
  charts.push(c);
  return c;
}

function chartCard(title, subtitle, buildFn) {
  const card = h('div', { class: 'card' }, h('div', { class: 'card-title' }, title), subtitle ? h('div', { class: 'muted small' }, subtitle) : null);
  if (!window.Chart) {
    card.append(emptyNote('Charts need the app to be opened once while online to download the chart library.'));
    return card;
  }
  buildFn(card);
  return card;
}

function canvasIn(card, height = 220) {
  const canvas = h('canvas');
  card.append(h('div', { class: 'chart-wrap', style: { height: `${height}px` } }, canvas));
  return canvas;
}

export async function render(root) {
  rootEl = root;
  charts.forEach((c) => c.destroy());
  charts = [];
  setChartDefaults();

  const [d, runs, meals, bodyweight, supp] = await Promise.all([
    loadLifting(), all('runs'), all('meals'), all('bodyweight'), loadSupplements(),
  ]);
  const earliestCandidates = [
    ...d.sessions.map((s) => ts(s.started_at)),
    ...meals.map((m) => ts(m.logged_at)),
    ...runs.map((x) => dayStartMs(x.date)),
    ...bodyweight.map((b) => dayStartMs(b.date)),
  ].filter((x) => x > 0);
  const earliest = earliestCandidates.length ? Math.min(...earliestCandidates) : null;
  const r = bounds(earliest);
  const spanDays = Math.max(1, (r.end - r.start) / DAY_MS);
  const weeks = spanDays / 7;

  clear(root);
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Stats')));

  // Range picker (sticky).
  const picker = h('div', { class: 'range-picker' },
    segmented(RANGES, rangeKey, (v) => { rangeKey = v; rerender(); }, 'seg-small'));
  if (rangeKey === 'custom') {
    const from = h('input', { class: 'input', type: 'date', value: customFrom || dateStr(addDays(new Date(), -30)) });
    const to = h('input', { class: 'input', type: 'date', value: customTo || todayStr() });
    from.addEventListener('change', () => { customFrom = from.value; rerender(); });
    to.addEventListener('change', () => { customTo = to.value; rerender(); });
    picker.append(h('div', { class: 'row gap' }, h('div', { class: 'grow' }, field('From', from)), h('div', { class: 'grow' }, field('To', to))));
  }
  root.append(picker, h('p', { class: 'muted small center' }, `${fmtDay(r.start)} to ${fmtDay(r.end)}`));

  /* ----- Consistency ----- */
  const mealsIn = meals.filter((m) => inTs(r, m.logged_at));
  const onPlan = mealsIn.filter((m) => m.on_plan).length;
  const dietPct = mealsIn.length ? Math.round((onPlan / mealsIn.length) * 100) : null;
  const sessionsIn = sessionsWithSets(d).filter((s) => inTs(r, s.started_at));
  const target = TARGET_PER_WEEK * weeks;
  const trainPct = target > 0 ? Math.round((sessionsIn.length / target) * 100) : 0;
  root.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Consistency'),
      h('div', { class: 'two-col' },
        h('div', null,
          h('div', { class: 'muted small' }, 'Diet on plan'),
          h('div', { class: 'big-stat' }, dietPct == null ? '-' : `${dietPct}%`),
          h('div', { class: 'muted small' }, mealsIn.length ? `${onPlan} of ${mealsIn.length} meals` : 'No meals in range')),
        h('div', null,
          h('div', { class: 'muted small' }, 'Training'),
          h('div', { class: 'big-stat' }, `${sessionsIn.length} / ${round1(target)}`),
          h('div', { class: 'muted small' }, `sessions vs 3 per week (${trainPct}%)`))
      )
    )
  );

  /* ----- Strength (e1RM per exercise, PRs marked) ----- */
  const usedEx = new Map();
  for (const s of d.sets) {
    const t = ts(s.logged_at);
    if (!usedEx.has(s.exercise_id) || usedEx.get(s.exercise_id) < t) usedEx.set(s.exercise_id, t);
  }
  const exList = sortBy([...usedEx.keys()].filter((id) => d.exById.has(id)), (id) => usedEx.get(id), true);
  if (!exList.includes(strengthEx)) strengthEx = exList[0] || null;
  root.append(chartCard('Strength over time', 'Estimated one-rep max (Epley). PRs are highlighted.', (card) => {
    if (!exList.length) return card.append(emptyNote('Log some sets to see strength trends.'));
    const sel = h('select', { class: 'input', value: strengthEx }, exList.map((id) => h('option', { value: id }, d.exById.get(id).name)));
    sel.addEventListener('change', () => { strengthEx = sel.value; rerender(); });
    card.append(sel);
    // Best e1RM per session over all history, so PR marks are true all-time records.
    const bySession = new Map();
    for (const s of d.sets.filter((x) => x.exercise_id === strengthEx)) {
      const e = e1rm(s.weight_lb, s.reps);
      const cur = bySession.get(s.session_id);
      const t = ts(s.logged_at);
      if (!cur) bySession.set(s.session_id, { x: t, y: e, best: s });
      else {
        cur.x = Math.max(cur.x, t);
        if (e > cur.y) { cur.y = e; cur.best = s; }
      }
    }
    let running = 0;
    const pts = sortBy([...bySession.values()], (p) => p.x).map((p) => {
      const pr = p.y > running && p.y > 0;
      if (p.y > running) running = p.y;
      return { x: p.x, y: round1(p.y), pr, label: `${round2(p.best.weight_lb)} × ${p.best.reps}` };
    }).filter((p) => p.x >= r.start && p.x <= r.end);
    if (!pts.length) return card.append(emptyNote('No sets for this exercise in the selected range.'));
    makeChart(canvasIn(card), {
      type: 'line',
      data: {
        datasets: [{
          label: 'e1RM (lb)',
          data: pts,
          borderColor: '#ffffff',
          borderWidth: 2,
          tension: 0.2,
          pointBackgroundColor: (c) => (c.raw && c.raw.pr ? ACCENT : '#ffffff'),
          pointBorderColor: (c) => (c.raw && c.raw.pr ? ACCENT : '#ffffff'),
          pointRadius: (c) => (c.raw && c.raw.pr ? 6 : 3),
        }],
      },
      options: {
        parsing: false,
        scales: { x: timeScale(r), y: { grid: { color: '#161616' } } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => fmtDay(items[0].raw.x),
              label: (c) => `${c.raw.y} lb e1RM (best set ${c.raw.label})${c.raw.pr ? ' PR' : ''}`,
            },
          },
        },
      },
    });
  }));

  /* ----- Weekly working sets per muscle group ----- */
  const setsIn = d.sets.filter((s) => inTs(r, s.logged_at));
  const groupCounts = new Map();
  for (const g of PRIORITY_GROUPS) groupCounts.set(g, 0);
  for (const s of setsIn) {
    const g = muscleGroupOfSet(d, s);
    groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
  }
  const perWeek = spanDays >= 7;
  const groupRows = [...groupCounts.entries()]
    .map(([g, n]) => ({ g, v: perWeek ? round1(n / weeks) : n, priority: PRIORITY_GROUPS.includes(g) }))
    .sort((a, b) => (b.priority - a.priority) || (b.v - a.v));
  root.append(chartCard(
    perWeek ? 'Weekly working sets per muscle group' : 'Working sets per muscle group',
    `${perWeek ? 'Average sets per week in the range' : 'Total sets in the range'}. White bars are priority groups.`,
    (card) => {
      if (!setsIn.length) card.append(emptyNote('No sets in this range yet. Priority groups: ' + PRIORITY_GROUPS.join(', ') + '.'));
      makeChart(canvasIn(card, Math.max(180, groupRows.length * 30)), {
        type: 'bar',
        data: {
          labels: groupRows.map((x) => (x.priority ? `${x.g} (priority)` : x.g)),
          datasets: [{
            label: perWeek ? 'Sets per week' : 'Sets',
            data: groupRows.map((x) => x.v),
            backgroundColor: groupRows.map((x) => (x.priority ? '#ffffff' : GREY)),
            borderRadius: 4,
          }],
        },
        options: {
          indexAxis: 'y',
          scales: { x: { beginAtZero: true, grid: { color: '#161616' } }, y: { grid: { display: false } } },
          plugins: { legend: { display: false } },
        },
      });
    }
  ));

  /* ----- Runs: distance and pace (runs only) ----- */
  const runPRs = runPrIds(runs);
  const runsIn = sortBy(runs.filter((x) => x.type === 'run' && inDay(r, x.date)), (x) => x.date);
  root.append(chartCard('Runs', 'Distance and pace, runs only (walking pad does not affect pace). PRs highlighted.', (card) => {
    if (!runsIn.length) return card.append(emptyNote('No runs in this range.'));
    const at = (x) => dayStartMs(x.date) + DAY_MS / 2;
    makeChart(canvasIn(card), {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Distance (mi)',
            data: runsIn.map((x) => ({ x: at(x), y: round2(x.distance_mi), pr: runPRs.has(x.id) })),
            borderColor: '#ffffff',
            yAxisID: 'y',
            pointBackgroundColor: (c) => (c.raw && c.raw.pr ? ACCENT : '#ffffff'),
            pointBorderColor: (c) => (c.raw && c.raw.pr ? ACCENT : '#ffffff'),
            pointRadius: (c) => (c.raw && c.raw.pr ? 6 : 3),
          },
          {
            label: 'Pace (min/mi)',
            data: runsIn.filter((x) => runPace(x)).map((x) => ({ x: at(x), y: Math.round(runPace(x)), pr: runPRs.has(x.id) })),
            borderColor: GREY,
            borderDash: [5, 4],
            yAxisID: 'y1',
            pointBackgroundColor: (c) => (c.raw && c.raw.pr ? ACCENT : GREY),
            pointBorderColor: (c) => (c.raw && c.raw.pr ? ACCENT : GREY),
            pointRadius: (c) => (c.raw && c.raw.pr ? 6 : 3),
          },
        ],
      },
      options: {
        parsing: false,
        scales: {
          x: timeScale(r),
          y: { position: 'left', beginAtZero: true, title: { display: true, text: 'mi' }, grid: { color: '#161616' } },
          y1: { position: 'right', reverse: true, title: { display: true, text: 'pace' }, ticks: { callback: paceTick }, grid: { display: false } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: (items) => fmtDay(items[0].raw.x),
              label: (c) => (c.dataset.yAxisID === 'y1' ? `Pace ${fmtPace(c.raw.y)}` : `${c.raw.y} mi`) + (c.raw.pr ? ' PR' : ''),
            },
          },
        },
      },
    });
  }));

  /* ----- Total weekly miles (runs + walking pad) ----- */
  root.append(chartCard('Weekly miles', 'Runs and walking pad combined.', (card) => {
    const cardioIn = runs.filter((x) => inDay(r, x.date));
    if (!cardioIn.length) return card.append(emptyNote('No cardio in this range.'));
    const first = startOfWeek(new Date(r.start));
    const weeksList = [];
    for (let w = first; w.getTime() <= r.end && weeksList.length < 160; w = addDays(w, 7)) weeksList.push(w);
    const sum = (type, w) => cardioIn
      .filter((x) => x.type === type && x.date >= dateStr(w) && x.date < dateStr(addDays(w, 7)))
      .reduce((a, x) => a + (Number(x.distance_mi) || 0), 0);
    makeChart(canvasIn(card), {
      type: 'bar',
      data: {
        labels: weeksList.map((w) => fmtShortDay(w)),
        datasets: [
          { label: 'Runs', data: weeksList.map((w) => round2(sum('run', w))), backgroundColor: '#ffffff', stack: 'm' },
          { label: 'Walking pad', data: weeksList.map((w) => round2(sum('walking_pad', w))), backgroundColor: GREY, stack: 'm' },
        ],
      },
      options: {
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: '#161616' } } },
        plugins: { tooltip: { callbacks: { title: (items) => `Week of ${items[0].label}`, label: (c) => `${c.dataset.label}: ${c.raw} mi` } } },
      },
    });
  }));

  /* ----- Bodyweight with supplement dose-change markers ----- */
  root.append(chartCard('Bodyweight', 'Dashed lines mark supplement dose or schedule changes.', (card) => {
    const bwIn = sortBy(bodyweight.filter((b) => inDay(r, b.date)), (b) => b.date);
    const suppById = new Map(supp.supps.map((s) => [s.id, s]));
    const markers = sortBy(supp.versions.filter((v) => inTs(r, v.effective_from) && suppById.has(v.supplement_id)), (v) => ts(v.effective_from))
      .map((v) => {
        const s = suppById.get(v.supplement_id);
        return { x: ts(v.effective_from), label: `${s.name} ${v.dose}${s.unit ? ' ' + s.unit : ''}`, when: v.effective_from };
      });
    if (!bwIn.length) card.append(emptyNote('No bodyweight entries in this range.'));
    else {
      makeChart(canvasIn(card), {
        type: 'line',
        data: {
          datasets: [{
            label: 'Bodyweight (lb)',
            data: bwIn.map((b) => ({ x: dayStartMs(b.date) + DAY_MS / 2, y: round1(b.weight_lb) })),
            borderColor: '#ffffff',
            pointBackgroundColor: '#ffffff',
            pointRadius: 3,
            tension: 0.2,
          }],
        },
        options: {
          parsing: false,
          scales: { x: timeScale(r), y: { grid: { color: '#161616' } } },
          plugins: {
            legend: { display: false },
            doseMarkers: { items: markers },
            tooltip: { callbacks: { title: (items) => fmtDay(items[0].raw.x), label: (c) => `${c.raw.y} lb` } },
          },
        },
        plugins: [doseMarkers],
      });
    }
    if (markers.length) {
      card.append(h('div', { class: 'marker-list' }, markers.map((m) => h('div', { class: 'muted small' }, `${fmtShortDay(m.when)}: ${m.label}`))));
    }
  }));

  /* ----- Progress ----- */
  const progress = h('div', { class: 'stack' });
  root.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Progress'), progress));
  await renderProgress(progress, rerender);

  /* ----- Data ----- */
  const st = getState();
  root.append(
    h('div', { class: 'card stack' },
      h('div', { class: 'card-title' }, 'Data'),
      h('p', { class: 'muted small' },
        configured
          ? `Sync: ${st.status === 'error' ? `error (${st.error})` : st.pending ? `${st.pending} changes waiting` : 'up to date'}${st.lastSync ? `. Last sync ${fmtTime(st.lastSync)}.` : '.'}`
          : 'Local only. Data stays on this device until Supabase settings are added to config.js.'),
      configured ? h('button', { type: 'button', class: 'btn btn-secondary block', onclick: () => syncNow().then(rerender) }, 'Sync now') : null,
      h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => exportAll() }, 'Export all data (JSON + CSV)')
    )
  );
}
