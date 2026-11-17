# Manual test plan

One section per line of the spec's acceptance checklist. Run them in order on a
deployed copy (GitHub Pages) with `config.js` filled in, using an iPhone (Safari) and
a desktop browser. Mark each step pass or fail.

Before starting: generate the icons (`make-icons.ps1`), run `schema.sql` in Supabase,
fill in `config.js`, push, and wait for GitHub Pages to publish.

## 1. Installs to iPhone home screen and opens full screen

1. On the iPhone, open the site in Safari.
2. Share > Add to Home Screen. Check the icon preview is the green dumbbell on black and
   the name is "Workout". Tap Add.
3. Open it from the home screen. Expect: no Safari address bar or toolbar, black status
   bar area with white clock, content not hidden under the notch or the home indicator.
4. Check the four bottom tabs (Workout, Diet, Supplements, Stats) sit above the home
   indicator and each is easy to hit with one thumb.
5. Scroll a long screen (Stats). Expect: it scrolls, and no scrollbar is visible.
6. Close the app fully, turn on airplane mode, open it again. Expect: it opens and
   shows the Workout tab (offline shell works).

## 2. Logging a set works with airplane mode on and syncs later

1. Online, open the app once and wait for the indicator to say "Synced".
2. Turn on airplane mode. Expect indicator: "Offline (0 pending)".
3. Start a workout and log two sets. Expect indicator: "Offline (n pending)" with n > 0.
4. Close and reopen the app (still offline). Expect: the session and both sets are still
   there.
5. Turn airplane mode off. Within a few seconds expect "Syncing", then "Synced".
6. In Supabase Table Editor, open `sets`: both rows are present with the right weight
   and reps. On the desktop browser, reload: the active session and sets appear.

## 3. A or B auto-selected from last session, with one-tap override

1. Fresh data: Workout tab says "Next up" with A selected and "No workouts yet".
2. Start Workout A, log one set, Finish.
3. Back on the Workout tab expect B selected and "Last: Workout A on <today>".
4. Tap A in the selector. Expect: the preview switches to A's slots and the button says
   "Start Workout A". Tap Freestyle: the button says "Start Freestyle".
5. Start B, log a set, Finish. Expect A suggested next.
6. Start Freestyle, log a set, Finish. Expect the suggestion is still A (Freestyle does
   not count).

## 4. Last session shown for the selected exercise; progression cue appears correctly

1. Start Workout A. Slot 1 is Squat or Leg Press, Back Squat preselected (first time).
   Expect the cue "First time logging this exercise".
2. Log 3 sets: 135 x 10, 155 x 10, 175 x 10 (target is 10). Rest timer appears after
   each set. After the third set the app moves to slot 2 automatically.
3. Finish. Start Workout B and finish it with one set, then start Workout A again.
4. Slot 1 expect: Back Squat preselected (used last time), "Last time" shows
   1: 135 x 10, 2: 155 x 10, 3: 175 x 10 with 175 x 10 marked as top set, and the cue
   "Add weight today." Weight and reps are pre-filled 135 / 10 for set 1.
5. Log 185 x 7, 185 x 7, 195 x 6. Finish, and next time on A expect the cue
   "Beat last time: 195 lb x 6".
6. Switch the exercise dropdown to Leg Press. Expect last time for Leg Press (or the
   first-time cue) and the plate calculator button. Open it, set sled 0 and two 45s per
   side: total 180 lb. Tap Use: the weight field shows 180.
7. Dumbbell exercise (Incline Dumbbell Press): label reads "lb each".
8. PRs: log a set heavier than ever before. Expect a green toast "PR! Heaviest weight..."
   and the set chip highlighted in green. Log more reps at an already-used weight: toast
   "Most reps at ...". A higher Epley e1RM shows "Best e1RM ...".
9. Supersets: on slot 5 (Lateral Raise + Rear Delt) expect "Superset, round 1 of 3".
   After logging Lateral Raise the panel switches to Rear Delt; no rest timer between
   them; the rest timer starts after Rear Delt. Rounds alternate until 3 of each.
10. Rest timer: +15 and -15 change the remaining time; Skip hides it; tap "Rest 60 s"
    and choose 90: the next rest uses 90 s.
11. Add Exercise during the session: pick Face Pull. It appears as a new slot with last
    time, cue and PR handling. Tap "Add to template A": it becomes a template slot, and
    Templates shows it at the end of A.
12. Run log: Workout tab > Log run. Expect last run distance, duration and pace and the
    cue "Go a little farther or a little faster than last time." Save a longer run:
    green "PR! Longest run" toast.
13. Walking pad: Log walking pad shows only date, miles and notes (no duration or pace),
    the last entry's miles, this week vs last week, and the match-or-beat cue.

## 5. Custom exercises and categories can be added and appear in dropdowns

1. Workout tab > Exercises > Add category: "Calves", muscle group "Calves". Save.
2. Add exercise: "Standing Calf Raise", load type Machine, rest 60, setup note
   "Pin 4", category Calves and also Squat or Leg Press. Save.
3. Templates > A > Add slot: category Calves. Expect "Standing Calf Raise" in the
   default exercise list.
4. Start Workout A, go to slot 1. Open the exercise dropdown: "Standing Calf Raise" is
   listed. Choose "+ New exercise" from the dropdown, create "Sissy Squat"
   (bodyweight): it is selected at once.
5. Archive an exercise in Exercises: it disappears from dropdowns but its history stays
   in Stats.

## 6. Templates editable in app

1. Workout tab > Templates > Workout A.
2. Move slot 3 up: it becomes slot 2. Move it back.
3. Edit slot 2: sets 3, target reps 15. Save. The list shows "3 sets x 15 reps".
4. Tap "Superset with next" on slot 3: slots 3 and 4 show as a superset. Tap
   "Ungroup next": they are separate again.
5. Remove a slot (confirm). Add a slot. Start Workout A: the session follows the edited
   order, sets and supersets with no reload or rebuild.
6. Check Workouts A and B as seeded match the spec: A = Squat or Leg Press 3 x 10
   (ramping), Back Extension 2, Incline Press 3, Horizontal Row 3 (Wide-Grip Row),
   superset Lateral Raise + Rear Delt 3, superset Triceps Pressdown + Biceps 3,
   Triceps Pressdown 2 (Single-Arm Cross-Body Cable Pressdown), Abs 2 (Hanging Leg
   Raise). B = Hip Hinge 3 (Romanian Deadlift), Hamstring Curl 3, Vertical Press 3,
   Vertical Pull 3, then the same two supersets, Triceps Pressdown 2, Abs 2. No
   overhead triceps extension anywhere in the library.

## 7. Diet, supplements, runs, bodyweight and progress photos all log and sync

1. Diet: Take photo, tap On Plan. Choose photo, tap Off Plan. Log without a photo, On
   Plan. Expect "Today on plan 67% (2 of 3)" and streak 1.
2. Supplements > Manage > Add: Creatine, 5, g, Daily, Morning. Add Fish oil, 2,
   capsules, specific weekdays (today included), Morning and Night. Today view shows
   them under Morning and Night; tap to check; tap again to uncheck.
3. Edit Creatine dose to 10. Expect "Saved with today's date"; History lists both
   entries with dates; today's log shows 10 g.
4. Pause Fish oil: gone from Today, listed under Paused. Archive it: listed under
   Archived; History still there.
5. Every N days: an item every 2 days starting today shows today, not tomorrow.
6. Stats > Progress > Log weight 200. Weekly check-in: weight 199, take front and
   side photos, Save. The check-in shows both photos and 199 lb.
7. Sync: wait for "Synced". In Supabase check rows in meals, supplements,
   supplement_versions, supplement_logs, runs, bodyweight, progress_photos, and files
   under photos/meals and photos/progress in Storage.
8. On the desktop browser, reload: all of the above appear, photos included.

## 8. Time-range picker updates every stat

1. Have data across more than 30 days (enter older dates for runs and bodyweight, and
   use an older check-in date).
2. Stats: tap 24h, 7d, 30d, 90d, All. For each, the date line under the picker changes,
   and the Consistency card (diet % and sessions vs target), Strength chart, weekly sets
   chart, Runs chart, Weekly miles chart and Bodyweight chart all change to that range.
3. Custom: pick From and To dates; every chart and percentage follows them.
4. Priority groups (Triceps, Rear delts, Upper back, Hamstrings and glutes, Upper
   chest) show as white bars marked "(priority)", even at zero.
5. Bodyweight chart shows a dashed marker on the date Creatine's dose changed.
6. Strength chart points that were PRs are green.

## 9. Meal photos auto-delete after 30 days; records remain

1. Desktop browser, developer tools, Application > IndexedDB > workout-tracker > meals.
   Edit one meal with a photo: set `logged_at` to 31 days ago. (Or set the device date
   forward 31 days.)
2. Reload the app. Expect on the Diet tab: that meal shows "Photo removed after 30 days",
   still counts in the on-plan percentage and streak.
3. After sync, the file is gone from Storage `photos/meals/`, and the row in Supabase
   has `photo_deleted_at` set and is otherwise unchanged.
4. Progress photos older than 30 days are untouched.

## 10. Export to JSON and CSV works

1. Stats > Data > Export all data.
2. Desktop: a zip downloads. iPhone (installed): the share sheet opens; Save to Files.
3. Open the zip: `data.json` plus one CSV per table (14 files). Open `sets.csv` and
   `data.json`: values match what was logged; jsonb columns are JSON text in the CSV.
4. Turn on airplane mode and export again: still works (zip library cached).

## 11. Runs entirely on free tiers: GitHub Pages and Supabase

1. GitHub: the repository's Pages settings show a public site on the free plan; no
   Actions or paid features are needed (static files only).
2. Supabase: the project is on the Free plan; Billing shows no charges. Database size
   and storage stay small because photos are compressed and meal photos expire.
3. Confirm the app makes no other network calls: in desktop developer tools > Network,
   only GitHub Pages, cdn.jsdelivr.net, cdnjs.cloudflare.com and the Supabase project
   appear.
4. Local only mode: empty both values in `config.js`, deploy to a test copy, and confirm
   everything logs on one device with the indicator showing "Local only".
