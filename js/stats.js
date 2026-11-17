// Stats tab. Opens with the Progress section (check-in, bodyweight, photos), then
// one time-range picker that drives every chart and percentage below it:
// 7 days, 30 days, All time, or a custom date range. Data (sync, export) is last.

import { all } from './db.js';
import {
  h, clear, segmented, field, GOLD, DAY_MS, icon, dateStr, todayStr, addDays, startOfWeek, dayStartMs, dayEndMs,
  fmtShortDay, fmtDay, fmtTime, fmtPace, round1, round2, e1rm, ts, sortBy, emptyNote, pad2, plural, pageHead,
} from './util.js';
import { loadLifting, muscleGroupOfSet, sessionsWithSets } from './lifting-data.js';
import { loadSupplements, doseText } from './supplements.js';
import { runPace, runPrIds } from './prs.js';
import { PRIORITY_GROUPS } from './seed.js';
import { renderProgress } from './progress.js';
import { exportAll } from './export.js';
import { configured, getState, syncNow, plainError } from './sync.js';
import { dailyBurn, sessionsForBurn, fmtKcal, NEAT_FACTOR } from './calories.js';
import { oneBodyweightPerDay, bodyFatByDate } from './body.js';

const RANGES = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
];
const DEFAULT_RANGE = '30d';
const TARGET_PER_WEEK = 3;
const GREY = '#6b6b6b';
const ACCENT_BAR = '#0A84FF';

let rangeKey = DEFAULT_RANGE;
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
  C.defaults.color = '#a1a1a6';
  C.defaults.borderColor = '#232327';
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
    case '7d': return { start: now - 7 * DAY_MS, end: now };
    case '30d': return { start: now - 30 * DAY_MS, end: now };
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

/** Draws supplement dose-change markers as dashed vertical lines, one per day. The
 * names are listed under the chart (rotated labels on the lines collided). */
const doseMarkers = {
  id: 'doseMarkers',
  afterDatasetsDraw(chart, _args, opts) {
    const items = (opts && opts.items) || [];
    if (!items.length) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    ctx.save();
    ctx.strokeStyle = '#8a8a8a';
    ctx.setLineDash([4, 4]);
    const seen = new Set();
    for (const m of items) {
      const px = Math.round(x.getPixelForValue(m.x));
      if (px < chartArea.left || px > chartArea.right || seen.has(px)) continue;
      seen.add(px);
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
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

// A newer render started while this one was waiting: stop, so the page is never drawn twice.
let renderGen = 0;

export async function render(root) {
  const gen = ++renderGen;
  rootEl = root;
  // Older builds offered 24h and 90d; anything not on the picker falls back to 30 days.
  if (!RANGES.some((x) => x.value === rangeKey)) rangeKey = DEFAULT_RANGE;
  charts.forEach((c) => c.destroy());
  charts = [];
  setChartDefaults();

  const [d, runs, meals, bodyweightRows, supp] = await Promise.all([
    loadLifting(), all('runs'), all('meals'), all('bodyweight'), loadSupplements(),
  ]);
  const bodyweight = oneBodyweightPerDay(bodyweightRows);
  if (gen !== renderGen) return;
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
  root.append(pageHead({ title: 'Stats' }));

  /* ----- Progress (check-in first) ----- */
  const progress = h('div', { class: 'stack' });
  root.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Progress'), progress));
  await renderProgress(progress, rerender);
  if (gen !== renderGen) return;

  // Range picker (sticky).
  const picker = h('div', { class: 'range-picker' },
    segmented(RANGES, rangeKey, (v) => { rangeKey = v; rerender(); }, 'seg-small'));
  if (rangeKey === 'custom') {
    const from = h('input', { class: 'input', type: 'date', 'aria-label': 'From', value: customFrom || dateStr(addDays(new Date(), -30)) });
    const to = h('input', { class: 'input', type: 'date', 'aria-label': 'To', value: customTo || todayStr() });
    from.addEventListener('change', () => { customFrom = from.value; rerender(); });
    to.addEventListener('change', () => { customTo = to.value; rerender(); });
    picker.append(h('div', { class: 'two-col' }, field('From', from), field('To', to)));
  }
  root.append(picker, h('p', { class: 'muted small center range-text' }, `${fmtDay(r.start)} to ${fmtDay(r.end)}`));

  /* ----- Estimated burn (calories) ----- */
  root.append(burnCard(r, d, runs, bodyweight));

  /* ----- Consistency ----- */
  const mealsIn = meals.filter((m) => inTs(r, m.logged_at));
  const onPlan = mealsIn.filter((m) => m.on_plan).length;
  const dietPct = mealsIn.length ? Math.round((onPlan / mealsIn.length) * 100) : null;
  const sessionsIn = sessionsWithSets(d).filter((s) => inTs(r, s.started_at));
  const expected = Math.max(1, Math.round(TARGET_PER_WEEK * weeks));
  root.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Consistency'),
      h('div', { class: 'two-col' },
        h('div', null,
          h('div', { class: 'stat-label' }, 'Diet on plan'),
          h('div', { class: 'big-stat' }, dietPct == null ? '-' : `${dietPct}%`),
          h('div', { class: 'muted small' }, mealsIn.length ? `${onPlan} of ${plural(mealsIn.length, 'meal')}` : 'No meals in range')),
        h('div', null,
          h('div', { class: 'stat-label' }, 'Training'),
          h('div', { class: 'big-stat' }, plural(sessionsIn.length, 'session')),
          h('div', { class: 'muted small' }, `Goal ${TARGET_PER_WEEK} a week, so ${expected} in this range`))
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
    const sel = h('select', { class: 'input', value: strengthEx, 'aria-label': 'Exercise' }, exList.map((id) => h('option', { value: id }, d.exById.get(id).name)));
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
          pointBackgroundColor: (c) => (c.raw && c.raw.pr ? GOLD : '#ffffff'),
          pointBorderColor: (c) => (c.raw && c.raw.pr ? GOLD : '#ffffff'),
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
            pointBackgroundColor: (c) => (c.raw && c.raw.pr ? GOLD : '#ffffff'),
            pointBorderColor: (c) => (c.raw && c.raw.pr ? GOLD : '#ffffff'),
            pointRadius: (c) => (c.raw && c.raw.pr ? 6 : 3),
          },
          {
            label: 'Pace (min/mi)',
            data: runsIn.filter((x) => runPace(x)).map((x) => ({ x: at(x), y: Math.round(runPace(x)), pr: runPRs.has(x.id) })),
            borderColor: GREY,
            borderDash: [5, 4],
            yAxisID: 'y1',
            pointBackgroundColor: (c) => (c.raw && c.raw.pr ? GOLD : GREY),
            pointBorderColor: (c) => (c.raw && c.raw.pr ? GOLD : GREY),
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
        // One line per day: same-day changes share one marker and one list line.
        return { x: dayStartMs(dateStr(new Date(ts(v.effective_from)))), label: `${s.name} ${doseText(v, s)}`, when: v.effective_from };
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
      const byDay = new Map();
      for (const m of markers) {
        if (!byDay.has(m.x)) byDay.set(m.x, { when: m.when, labels: [] });
        byDay.get(m.x).labels.push(m.label);
      }
      card.append(h('div', { class: 'marker-list' }, [...byDay.values()].map((g) => h('div', { class: 'muted small' }, `${fmtShortDay(g.when)}: ${g.labels.join(', ')}`))));
    }
  }));

  /* ----- Data ----- */
  root.append(dataCard());
}

/* ---------- calories ---------- */

function burnCard(r, d, runs, bodyweight) {
  const bf = bodyFatByDate(bodyweight);
  const sessions = sessionsForBurn(d.sessions, d.sets);
  const burnOn = (day) => dailyBurn({ day, bodyweight, bodyFat: bf, sessions, runs });
  const today = burnOn(todayStr());
  const card = h('div', { class: 'card' }, h('div', { class: 'card-title with-icon' }, icon('flame'), 'Estimated burn'));
  if (today.weightLb == null) {
    card.append(h('p', { class: 'muted small' }, 'Log bodyweight to estimate the calories you burn each day.'));
    return card;
  }
  const kcal = (n) => [fmtKcal(n), h('span', { class: 'burn-unit' }, 'kcal')];
  if (today.total != null) {
    card.append(
      h('div', null, h('div', { class: 'stat-label' }, 'Today'), h('div', { class: 'burn-total' }, kcal(today.total))),
      h('div', { class: 'burn-parts' },
        h('div', null, h('div', { class: 'stat-label' }, 'Resting'), h('div', { class: 'big-stat' }, fmtKcal(today.resting))),
        h('div', null, h('div', { class: 'stat-label' }, 'Active'), h('div', { class: 'big-stat' }, fmtKcal(today.active))))
    );
  } else {
    card.append(
      h('div', null, h('div', { class: 'stat-label' }, 'Active today'), h('div', { class: 'burn-total' }, kcal(today.active))),
      h('p', { class: 'burn-hint' }, 'Add body fat % for your full daily total.')
    );
  }

  // One bar per day in the range (resting and active stacked).
  const days = [];
  const last = new Date(Math.min(r.end, Date.now()));
  for (let t = new Date(r.start); dateStr(t) <= dateStr(last) && days.length < 400; t = addDays(t, 1)) days.push(dateStr(t));
  const rows = days.map(burnOn);
  const hasResting = rows.some((x) => x.resting != null);
  if (window.Chart && rows.some((x) => x.weightLb != null)) {
    const canvas = h('canvas');
    card.append(h('div', { class: 'chart-wrap', style: { height: '200px' } }, canvas));
    const datasets = [];
    if (hasResting) datasets.push({ label: 'Resting', data: rows.map((x) => (x.resting == null ? null : Math.round(x.resting))), backgroundColor: '#3a3a40', stack: 'k', borderRadius: 2 });
    datasets.push({ label: 'Active', data: rows.map((x) => (x.weightLb == null ? null : Math.round(x.active))), backgroundColor: ACCENT_BAR, stack: 'k', borderRadius: 2 });
    makeChart(canvas, {
      type: 'bar',
      data: { labels: days.map((x) => fmtShortDay(x)), datasets },
      options: {
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
          y: { stacked: true, beginAtZero: true, grid: { color: '#161616' } },
        },
        plugins: {
          legend: { display: hasResting },
          tooltip: { callbacks: { title: (items) => fmtDay(days[items[0].dataIndex]), label: (c) => `${c.dataset.label}: ${fmtKcal(c.raw)} kcal` } },
        },
      },
    });
  }
  card.append(h('p', { class: 'muted small' },
    `An estimate from your latest bodyweight${hasResting ? ' and body fat' : ''} and the training you log. ${hasResting ? `Resting uses Katch-McArdle times ${NEAT_FACTOR} for light daily movement. ` : ''}Active counts lifting time, runs and walking pad.`));
  return card;
}

/* ---------- data and sync ---------- */

function syncLine(st) {
  if (!navigator.onLine) return { text: `You are offline. ${st.pending ? `${plural(st.pending, 'change')} will sync when you are back online.` : 'Everything is saved on this phone.'}`, cls: '' };
  if (st.status === 'error') return { text: `Sync failed. ${plainError(st.error)}`, cls: 'err' };
  if (st.status === 'syncing') return { text: 'Syncing now.', cls: '' };
  const when = st.lastSync ? ` Last sync ${fmtWhen(st.lastSync)}.` : '';
  return st.pending ? { text: `${plural(st.pending, 'change')} waiting to sync.${when}`, cls: '' } : { text: `Up to date.${when}`, cls: 'ok' };
}

function fmtWhen(iso) {
  const t = ts(iso);
  if (Date.now() - t < 60e3) return 'just now';
  return t >= dayStartMs(todayStr()) ? `today at ${fmtTime(iso)}` : `${fmtShortDay(iso)} at ${fmtTime(iso)}`;
}

function dataCard() {
  const card = h('div', { class: 'card stack' }, h('div', { class: 'card-title' }, 'Data'));
  if (!configured) {
    card.append(h('p', { class: 'muted small' }, 'Local only. Data stays on this device until Supabase settings are added to config.js.'));
  } else {
    const line = h('p', { class: 'muted small sync-line', role: 'status', 'aria-live': 'polite' });
    const showLine = () => {
      const l = syncLine(getState());
      line.textContent = l.text;
      line.className = `small sync-line ${l.cls || 'muted'}`;
    };
    showLine();
    const label = h('span', null, 'Sync now');
    const btn = h('button', { type: 'button', class: 'btn btn-secondary block' }, icon('refresh'), label);
    let resetTimer = null;
    const setBtn = (state, text) => {
      btn.classList.toggle('is-syncing', state === 'busy');
      btn.classList.toggle('is-synced', state === 'done');
      btn.disabled = state === 'busy';
      btn.replaceChildren(icon(state === 'done' ? 'check' : 'refresh'), h('span', null, text));
    };
    btn.addEventListener('click', async () => {
      clearTimeout(resetTimer);
      if (!navigator.onLine) {
        showLine();
        setBtn('idle', 'Offline, try again later');
        resetTimer = setTimeout(() => setBtn('idle', 'Sync now'), 4000);
        return;
      }
      setBtn('busy', 'Syncing…');
      line.textContent = 'Syncing now.';
      line.className = 'small sync-line muted';
      const started = Date.now();
      try { await syncNow(); } catch (e) { /* the state carries the error */ }
      // Keep the spinner up long enough to be seen.
      const wait = 700 - (Date.now() - started);
      if (wait > 0) await new Promise((res) => setTimeout(res, wait));
      const st = getState();
      showLine();
      if (st.status === 'error') setBtn('idle', 'Try again');
      else {
        setBtn('done', 'Synced just now');
        resetTimer = setTimeout(() => { if (btn.isConnected) { setBtn('idle', 'Sync now'); showLine(); } }, 4000);
      }
    });
    card.append(line, btn);
  }
  card.append(
    h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => exportAll() }, icon('download'), 'Export all data'),
    h('p', { class: 'muted small' }, 'Downloads a zip with JSON and CSV files.'));
  return card;
}
