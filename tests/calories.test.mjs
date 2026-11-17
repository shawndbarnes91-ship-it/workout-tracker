// Run with: node tests/calories.test.mjs   (no dependencies)
import assert from 'node:assert/strict';
import {
  bmrKatch, lbToKg, dailyBurn, sessionHours, cardioKcal, weightOn, bodyFatOn, sessionsForBurn, NEAT_FACTOR,
} from '../js/calories.js';
import { detectPRs } from '../js/prs.js';
import { bodyweightIdFor, oneBodyweightPerDay, bodyFatByDate, normBodyFat, latestReading } from '../js/body.js';
import { pick, remoteWins } from '../js/db.js';

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

t('Katch-McArdle sample: 215 lb at 20% body fat', () => {
  const lean = lbToKg(215) * 0.8;
  near(lean, 78.0, 0.05, 'lean mass kg');
  near(bmrKatch(215, 20), 2055, 2, 'BMR');
});

t('session hours: finish time, cap, and set estimate', () => {
  assert.equal(sessionHours({ started_at: '2026-11-10T10:00:00Z', ended_at: '2026-11-10T11:00:00Z' }, 10), 1);
  assert.equal(sessionHours({ started_at: '2026-11-10T10:00:00Z', ended_at: '2026-11-10T16:00:00Z' }, 10), 3);
  assert.equal(sessionHours({ started_at: '2026-11-10T10:00:00Z', ended_at: null }, 12), 0.5);
});

t('cardio formulas', () => {
  const kg = lbToKg(200);
  near(cardioKcal(200, { type: 'run', distance_mi: 1 }), kg * 1.609344, 1e-9, 'run');
  near(cardioKcal(200, { type: 'walking_pad', distance_mi: 2 }), 0.5 * kg * 2 * 1.609344, 1e-9, 'pad by distance');
  near(cardioKcal(200, { type: 'walking_pad', distance_mi: 2, duration_sec: 3600 }), 3.5 * kg, 1e-9, 'pad by duration');
});

t('latest weight and body fat on or before the day', () => {
  const bw = [{ date: '2026-11-01', weight_lb: 210 }, { date: '2026-11-08', weight_lb: 205 }, { date: '2026-11-20', weight_lb: 200 }];
  assert.equal(weightOn(bw, '2026-10-30'), null);
  assert.equal(weightOn(bw, '2026-11-10'), 205);
  assert.equal(bodyFatOn({ '2026-11-01': 22, '2026-11-09': 21 }, '2026-11-08'), 22);
  assert.equal(bodyFatOn({}, '2026-11-08'), null);
});

t('daily burn: total = resting x NEAT + active; no body fat gives active only', () => {
  const day = '2026-11-10';
  const start = new Date(2026, 10, 10, 9, 0).toISOString();
  const end = new Date(2026, 10, 10, 10, 0).toISOString();
  const sessions = sessionsForBurn([{ id: 's', started_at: start, ended_at: end }], [{ session_id: 's' }, { session_id: 's' }]);
  const runs = [{ type: 'run', date: day, distance_mi: 3 }, { type: 'walking_pad', date: day, distance_mi: 2 }];
  const bw = [{ date: '2026-11-01', weight_lb: 215 }];
  const full = dailyBurn({ day, bodyweight: bw, bodyFat: { '2026-11-01': 20 }, sessions, runs });
  const kg = lbToKg(215);
  near(full.lift, 5 * kg, 1e-6, 'lift');
  near(full.active, 5 * kg + kg * 3 * 1.609344 + 0.5 * kg * 2 * 1.609344, 1e-6, 'active');
  near(full.resting, bmrKatch(215, 20) * NEAT_FACTOR, 1e-6, 'resting');
  near(full.total, full.resting + full.active, 1e-6, 'total');
  const noBf = dailyBurn({ day, bodyweight: bw, bodyFat: {}, sessions, runs });
  assert.equal(noBf.total, null);
  assert.equal(noBf.resting, null);
  near(noBf.active, full.active, 1e-9, 'active without bf');
  const noBw = dailyBurn({ day, bodyweight: [], bodyFat: {}, sessions, runs });
  assert.equal(noBw.weightLb, null);
  assert.equal(noBw.active, 0);
});

t('records: bodyweight and first-set edge cases do not false-trigger', () => {
  assert.deepEqual(detectPRs([], 225, 6), []);
  assert.deepEqual(detectPRs([{ weight_lb: 0, reps: 10 }], 0, 10), []);
  assert.deepEqual(detectPRs([{ weight_lb: 0, reps: 10 }], 0, 12).map((p) => p.kind), ['reps']);
  assert.deepEqual(detectPRs([{ weight_lb: 225, reps: 5 }], 135, 8), []);
  assert.ok(detectPRs([{ weight_lb: 215, reps: 6 }], 225, 6).some((p) => p.kind === 'e1rm'));
});

t('RENPHO Shortcut row merges into the app (one row per day, last write wins)', () => {
  const day = '2026-11-16';
  assert.equal(bodyweightIdFor(day), 'b0d1e000-0000-4000-8000-000020261116');
  // Shaped like the Shortcut's POST after the server trigger stamped updated_at.
  const shortcutRow = {
    id: 'b0d1e000-0000-4000-8000-000020261116', date: day, weight_lb: 214.6, body_fat_pct: 0.198,
    source: 'renpho', deleted: false, updated_at: '2026-11-16T13:00:01.123+00:00',
  };
  const stored = pick('bodyweight', shortcutRow);
  assert.equal(stored.body_fat_pct, 0.198);
  assert.equal(stored.source, 'renpho');
  // Same day, entered by hand earlier on the date id: the scale reading is newer and wins.
  const localManual = { id: bodyweightIdFor(day), date: day, weight_lb: 215, body_fat_pct: 20, source: 'manual', deleted: false, updated_at: '2026-11-16T12:00:00.000Z' };
  assert.equal(remoteWins(localManual, shortcutRow), true);
  assert.equal(remoteWins(shortcutRow, localManual), false);
  assert.equal(remoteWins(null, shortcutRow), true);
  // A legacy random-id row for the same date: the newest of the two is shown.
  const legacy = { id: 'x', date: day, weight_lb: 216, deleted: false, updated_at: '2026-11-16T06:00:00.000Z' };
  const rows = oneBodyweightPerDay([legacy, stored, { date: '2026-11-15', weight_lb: 215.2, updated_at: '2026-11-15T13:00:00Z' }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].weight_lb, 214.6);
  assert.equal(latestReading(rows, '2026-11-15').weight_lb, 215.2);
  // Apple Health hands body fat as a fraction; the app reads it as a percent.
  assert.equal(normBodyFat(0.198), 19.8);
  assert.equal(normBodyFat('20'), 20);
  assert.equal(normBodyFat(''), null);
  assert.equal(normBodyFat(90), null);
  assert.deepEqual(bodyFatByDate(rows), { [day]: 19.8 });
  // Deleted rows drop out.
  assert.equal(oneBodyweightPerDay([{ ...stored, deleted: true }]).length, 0);
});

console.log(`${n} checks passed`);
