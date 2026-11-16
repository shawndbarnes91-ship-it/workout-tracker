// Default categories, exercise library and Workouts A and B.
// Seeded into IndexedDB by the app on first run so it works offline.
// Every seed row has a FIXED uuid and an old fixed updated_at, so two devices that
// seed separately produce identical rows, and any later edit always wins.

import { insertSeed, getMeta, setMeta } from './db.js';

const SEED_TS = '2026-01-01T00:00:00.000Z';
const SEED_KEY = 'seeded_v1';

/** Fixed uuid: one hex prefix letter plus a counter. Valid version 4 / variant 8 layout. */
export const fid = (prefix, n) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const TEMPLATE_A = fid('a', 1);
export const TEMPLATE_B = fid('a', 2);

export const PRIORITY_GROUPS = ['Triceps', 'Rear delts', 'Upper back', 'Hamstrings and glutes', 'Upper chest'];
export const MUSCLE_GROUPS = [
  'Quads', 'Hamstrings and glutes', 'Lower back', 'Chest', 'Upper chest', 'Upper back', 'Lats',
  'Front delts', 'Side delts', 'Rear delts', 'Biceps', 'Triceps', 'Abs', 'Calves', 'Forearms', 'Other',
];

// [number, name, muscle group]
const CATEGORIES = [
  [1, 'Squat or Leg Press', 'Quads'],
  [2, 'Hip Hinge', 'Hamstrings and glutes'],
  [3, 'Hamstring Curl', 'Hamstrings and glutes'],
  [4, 'Back Extension or Hyperextension', 'Hamstrings and glutes'],
  [5, 'Horizontal Press', 'Chest'],
  [6, 'Incline Press', 'Upper chest'],
  [7, 'Horizontal Row', 'Upper back'],
  [8, 'Vertical Press', 'Front delts'],
  [9, 'Vertical Pull', 'Lats'],
  [10, 'Lateral Raise', 'Side delts'],
  [11, 'Rear Delt', 'Rear delts'],
  [12, 'Biceps', 'Biceps'],
  [13, 'Triceps Pressdown', 'Triceps'],
  [14, 'Abs', 'Abs'],
];

// [number, name, load type, default rest seconds, category numbers, bar or sled lb, setup note]
// Load types: plates, machine (stack in lb), dumbbell (lb per dumbbell), cable, bodyweight (added lb).
// No overhead triceps extension anywhere in these defaults.
const EXERCISES = [
  [1, 'Back Squat', 'plates', 180, [1], 45, ''],
  [2, 'Front Squat', 'plates', 180, [1], 45, ''],
  [3, 'Leg Press', 'plates', 150, [1], 0, 'Set the sled weight in the plate calculator.'],
  [4, 'Hack Squat', 'plates', 150, [1], 0, 'Set the sled weight in the plate calculator.'],
  [5, 'Smith Machine Squat', 'plates', 150, [1], 20, ''],
  [6, 'Pendulum Squat', 'plates', 150, [1], 0, ''],
  [7, 'Belt Squat', 'plates', 150, [1], 0, ''],
  [8, 'Selectorized Leg Press', 'machine', 120, [1], null, ''],
  [9, 'Goblet Squat', 'dumbbell', 120, [1], null, ''],
  [10, 'Bulgarian Split Squat', 'dumbbell', 120, [1], null, ''],

  [11, 'Romanian Deadlift', 'plates', 180, [2], 45, ''],
  [12, 'Dumbbell Romanian Deadlift', 'dumbbell', 150, [2], null, ''],
  [13, 'Conventional Deadlift', 'plates', 180, [2], 45, ''],
  [14, 'Trap Bar Deadlift', 'plates', 180, [2], 55, ''],
  [15, 'Good Morning', 'plates', 150, [2], 45, ''],
  [16, 'Cable Pull-Through', 'cable', 90, [2], null, ''],
  [17, 'Barbell Hip Thrust', 'plates', 120, [2], 45, ''],

  [18, 'Seated Leg Curl', 'machine', 90, [3], null, ''],
  [19, 'Lying Leg Curl', 'machine', 90, [3], null, ''],
  [20, 'Single-Leg Lying Curl', 'machine', 90, [3], null, ''],
  [21, 'Nordic Curl', 'bodyweight', 120, [3], null, ''],
  [22, 'Stability Ball Leg Curl', 'bodyweight', 90, [3], null, ''],

  [23, '45-Degree Back Extension', 'bodyweight', 90, [4], null, ''],
  [24, '90-Degree Hyperextension', 'bodyweight', 90, [4], null, ''],
  [25, 'Reverse Hyperextension', 'machine', 90, [4], null, ''],
  [26, 'Back Extension Machine', 'machine', 90, [4], null, ''],

  [27, 'Barbell Bench Press', 'plates', 180, [5], 45, ''],
  [28, 'Dumbbell Bench Press', 'dumbbell', 150, [5], null, ''],
  [29, 'Machine Chest Press', 'machine', 120, [5], null, ''],
  [30, 'Smith Machine Bench Press', 'plates', 150, [5], 20, ''],
  [31, 'Plate-Loaded Chest Press', 'plates', 120, [5], 0, ''],
  [32, 'Push-Up', 'bodyweight', 90, [5], null, ''],
  [33, 'Dip', 'bodyweight', 120, [5], null, ''],
  [34, 'Cable Chest Fly', 'cable', 90, [5], null, ''],
  [35, 'Pec Deck', 'machine', 90, [5], null, ''],

  [36, 'Incline Barbell Press', 'plates', 180, [6], 45, ''],
  [37, 'Incline Dumbbell Press', 'dumbbell', 150, [6], null, ''],
  [38, 'Incline Smith Machine Press', 'plates', 150, [6], 20, ''],
  [39, 'Incline Machine Press', 'machine', 120, [6], null, ''],
  [40, 'Plate-Loaded Incline Press', 'plates', 120, [6], 0, ''],
  [41, 'Low-to-High Cable Fly', 'cable', 90, [6], null, ''],

  [42, 'Wide-Grip Row', 'cable', 120, [7], null, 'Wide bar, pull to the upper stomach.'],
  [43, 'Seated Cable Row', 'cable', 120, [7], null, ''],
  [44, 'Chest-Supported Row', 'plates', 120, [7], 0, ''],
  [45, 'Barbell Row', 'plates', 150, [7], 45, ''],
  [46, 'One-Arm Dumbbell Row', 'dumbbell', 120, [7], null, ''],
  [47, 'T-Bar Row', 'plates', 150, [7], 0, ''],
  [48, 'Machine Row', 'machine', 120, [7], null, ''],
  [49, 'Inverted Row', 'bodyweight', 90, [7], null, ''],

  [50, 'Seated Dumbbell Shoulder Press', 'dumbbell', 150, [8], null, ''],
  [51, 'Standing Overhead Press', 'plates', 180, [8], 45, ''],
  [52, 'Machine Shoulder Press', 'machine', 120, [8], null, ''],
  [53, 'Smith Machine Shoulder Press', 'plates', 150, [8], 20, ''],
  [54, 'Arnold Press', 'dumbbell', 120, [8], null, ''],
  [55, 'Landmine Press', 'plates', 120, [8], 0, ''],

  [56, 'Lat Pulldown', 'cable', 120, [9], null, ''],
  [57, 'Close-Grip Pulldown', 'cable', 120, [9], null, ''],
  [58, 'Single-Arm Cable Pulldown', 'cable', 90, [9], null, ''],
  [59, 'Pull-Up', 'bodyweight', 150, [9], null, ''],
  [60, 'Chin-Up', 'bodyweight', 150, [9], null, ''],
  [61, 'Assisted Pull-Up Machine', 'machine', 120, [9], null, 'Weight entered is the assistance.'],
  [62, 'Plate-Loaded Pulldown', 'plates', 120, [9], 0, ''],

  [63, 'Dumbbell Lateral Raise', 'dumbbell', 60, [10], null, ''],
  [64, 'Cable Lateral Raise', 'cable', 60, [10], null, ''],
  [65, 'Machine Lateral Raise', 'machine', 60, [10], null, ''],
  [66, 'Lean-Away Dumbbell Lateral Raise', 'dumbbell', 60, [10], null, ''],

  [67, 'Reverse Pec Deck', 'machine', 60, [11], null, ''],
  [68, 'Cable Rear Delt Fly', 'cable', 60, [11], null, ''],
  [69, 'Dumbbell Rear Delt Fly', 'dumbbell', 60, [11], null, ''],
  [70, 'Face Pull', 'cable', 60, [11], null, ''],

  [71, 'Dumbbell Curl', 'dumbbell', 60, [12], null, ''],
  [72, 'EZ-Bar Curl', 'plates', 75, [12], 25, ''],
  [73, 'Barbell Curl', 'plates', 75, [12], 45, ''],
  [74, 'Hammer Curl', 'dumbbell', 60, [12], null, ''],
  [75, 'Incline Dumbbell Curl', 'dumbbell', 60, [12], null, ''],
  [76, 'Cable Curl', 'cable', 60, [12], null, ''],
  [77, 'Bayesian Cable Curl', 'cable', 60, [12], null, ''],
  [78, 'Preacher Curl Machine', 'machine', 60, [12], null, ''],

  [79, 'Single-Arm Cross-Body Cable Pressdown', 'cable', 60, [13], null, ''],
  [80, 'Rope Pressdown', 'cable', 60, [13], null, ''],
  [81, 'Straight-Bar Pressdown', 'cable', 60, [13], null, ''],
  [82, 'V-Bar Pressdown', 'cable', 60, [13], null, ''],
  [83, 'Reverse-Grip Pressdown', 'cable', 60, [13], null, ''],
  [84, 'Machine Triceps Pressdown', 'machine', 60, [13], null, ''],

  [85, 'Hanging Leg Raise', 'bodyweight', 60, [14], null, ''],
  [86, "Captain's Chair Knee Raise", 'bodyweight', 60, [14], null, ''],
  [87, 'Cable Crunch', 'cable', 60, [14], null, ''],
  [88, 'Ab Wheel Rollout', 'bodyweight', 60, [14], null, ''],
  [89, 'Decline Sit-Up', 'bodyweight', 60, [14], null, ''],
  [90, 'Machine Crunch', 'machine', 60, [14], null, ''],
  [91, 'Pallof Press', 'cable', 60, [14], null, ''],
];

// [slot number, template, position, category, sets, target reps, superset group, default exercise, note]
const SLOTS = [
  // Workout A
  [1, TEMPLATE_A, 1, 1, 3, 10, null, null, 'Ramping weight, warm-ups included'],
  [2, TEMPLATE_A, 2, 4, 2, 12, null, null, ''],
  [3, TEMPLATE_A, 3, 6, 3, 10, null, null, ''],
  [4, TEMPLATE_A, 4, 7, 3, 10, null, 42, ''],
  [5, TEMPLATE_A, 5, 10, 3, 15, 1, null, ''],
  [6, TEMPLATE_A, 6, 11, 3, 15, 1, null, ''],
  [7, TEMPLATE_A, 7, 13, 3, 12, 2, null, ''],
  [8, TEMPLATE_A, 8, 12, 3, 12, 2, null, ''],
  [9, TEMPLATE_A, 9, 13, 2, 12, null, 79, ''],
  [10, TEMPLATE_A, 10, 14, 2, 12, null, 85, ''],
  // Workout B
  [11, TEMPLATE_B, 1, 2, 3, 10, null, 11, ''],
  [12, TEMPLATE_B, 2, 3, 3, 12, null, null, ''],
  [13, TEMPLATE_B, 3, 8, 3, 10, null, null, ''],
  [14, TEMPLATE_B, 4, 9, 3, 10, null, null, ''],
  [15, TEMPLATE_B, 5, 10, 3, 15, 1, null, ''],
  [16, TEMPLATE_B, 6, 11, 3, 15, 1, null, ''],
  [17, TEMPLATE_B, 7, 13, 3, 12, 2, null, ''],
  [18, TEMPLATE_B, 8, 12, 3, 12, 2, null, ''],
  [19, TEMPLATE_B, 9, 13, 2, 12, null, 79, ''],
  [20, TEMPLATE_B, 10, 14, 2, 12, null, 85, ''],
];

export function seedRows() {
  const base = { updated_at: SEED_TS, deleted: false };
  const categories = CATEGORIES.map(([n, name, group]) => ({
    ...base, id: fid('c', n), name, muscle_group: group, sort_order: n,
  }));
  const exercises = EXERCISES.map(([n, name, load, rest, , bar, note]) => ({
    ...base, id: fid('e', n), name, load_type: load, default_rest_sec: rest,
    setup_note: note || '', bar_lb: bar, archived: false,
  }));
  const exercise_categories = [];
  let link = 0;
  for (const [n, , , , cats] of EXERCISES) {
    for (const c of cats) {
      link += 1;
      exercise_categories.push({ ...base, id: fid('d', link), exercise_id: fid('e', n), category_id: fid('c', c) });
    }
  }
  const templates = [
    { ...base, id: TEMPLATE_A, name: 'A', sort_order: 1 },
    { ...base, id: TEMPLATE_B, name: 'B', sort_order: 2 },
  ];
  const template_slots = SLOTS.map(([n, tpl, pos, cat, sets, reps, group, defEx, note]) => ({
    ...base, id: fid('b', n), template_id: tpl, position: pos, category_id: fid('c', cat),
    sets, target_reps: reps, superset_group: group, default_exercise_id: defEx ? fid('e', defEx) : null, note: note || '',
  }));
  return { categories, exercises, exercise_categories, templates, template_slots };
}

export async function seedIfNeeded() {
  if (await getMeta(SEED_KEY)) return false;
  const rows = seedRows();
  for (const table of ['categories', 'exercises', 'exercise_categories', 'templates', 'template_slots']) {
    await insertSeed(table, rows[table]);
  }
  await setMeta(SEED_KEY, new Date().toISOString());
  return true;
}
