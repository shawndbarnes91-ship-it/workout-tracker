# Workout Tracker

A personal, single-user fitness tracker for iPhone, built as a Progressive Web App
you add to the home screen from Safari. It covers strength training (Workouts A and B
plus Freestyle), runs and walking pad, a minimal on-plan / off-plan diet log, a
supplement checklist, progress photos with bodyweight, and stats. It costs nothing
to run: static files on GitHub Pages, data in the Supabase free tier.

- Plain HTML, CSS and vanilla ES modules. No build step.
- Offline first: IndexedDB on the device is the source of truth. Every change is
  queued and synced to Supabase when there is a connection.
- No sign-in. The app talks to Supabase with the public anon key, and every device
  shares the same data.
- Pounds everywhere. Estimated one-rep max uses Epley: weight x (1 + reps / 30).

## Files

| Path | What it is |
| --- | --- |
| `index.html` | App page, iPhone install tags, tab bar |
| `styles.css` | Dark look, big tap targets, safe areas, hidden scrollbars |
| `config.js` | Supabase URL and anon key (empty = local only) |
| `manifest.webmanifest` | Install settings (standalone, black, relative paths) |
| `sw.js` | Service worker: caches the app and the CDN libraries for offline use |
| `schema.sql` | Supabase tables, row level security policies and the photos bucket |
| `icon.svg`, `make-icons.ps1` | App icon and the script that renders the PNG icons |
| `js/app.js` | Boot, tab switching |
| `js/db.js` | IndexedDB layer and the sync outbox |
| `js/sync.js` | Sync engine and the sync indicator |
| `js/seed.js` | Default categories, exercise library, Workouts A and B (fixed ids) |
| `js/photos.js` | Photo compression, local storage, 30-day meal photo cleanup |
| `js/workout.js` | Workout tab: session logging, supersets, plates, rest timer hookup |
| `js/lifting-data.js` | Shared lifting queries (last time, next template, muscle groups) |
| `js/library.js` | Exercise library, categories, exercise picker |
| `js/templates.js` | Template editor |
| `js/cardio.js` | Run and walking pad logs |
| `js/prs.js` | Personal records for lifts and runs |
| `js/timer.js` | Rest timer |
| `js/diet.js` | Diet tab |
| `js/supplements.js` | Supplements tab |
| `js/stats.js` | Stats tab and charts |
| `js/progress.js` | Progress photos, bodyweight, compare view (inside Stats) |
| `js/export.js` | Export to one zip (data.json plus one CSV per table) |
| `js/icons.js` | Every icon (Lucide-style outline SVGs) |
| `js/calories.js` | Calorie estimates: lifting, runs, walking pad, resting (Katch-McArdle) |
| `js/body.js` | Bodyweight helpers: one row per day, body fat by date, RENPHO row ids |
| `js/install-hint.js` | One-time Safari hint to add the app to the Home Screen |
| `tests/calories.test.mjs` | Unit checks for calories and the RENPHO merge (`node tests/calories.test.mjs`) |
| `migrations/` | Additive SQL changes to run in the Supabase SQL Editor |
| `docs/SETUP-RENPHO.md` | How to send RENPHO scale readings to the app every morning |

Libraries load from CDNs at pinned versions and are cached by the service worker:
`@supabase/supabase-js@2.45.4` (jsDelivr, ES module), Chart.js 4.4.1 and JSZip 3.10.1 (cdnjs).

## 1. Make the icons (once)

On a Windows PC, in this folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\make-icons.ps1
```

This writes `icon-180.png`, `icon-192.png` and `icon-512.png`. Commit them with the rest.

## 2. Set up Supabase (free tier)

1. Create a free project at supabase.com.
2. Open **SQL Editor**, paste all of `schema.sql`, and run it. It creates the tables,
   turns on row level security with policies for the anon role, and creates the public
   `photos` storage bucket with its policies. Running it again is safe.
3. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key.
4. Put them in `config.js`:

```js
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

With both left empty the app still works fully on one device and the sync indicator
says "Local only".

Note: there is no sign-in, and the anon key is readable in the published `config.js`,
so anyone who finds the site can read and change this data and the photos. Keep the
site URL to yourself. Free Supabase projects pause after a week with
no activity; open the project dashboard to resume it if sync starts showing Error.

## 3. Deploy to GitHub Pages

1. Create a GitHub repository (for example `workout-tracker`) and push this folder's
   contents to the `main` branch, including the generated PNG icons.
2. In the repository: **Settings > Pages > Build and deployment**, choose
   **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
3. After a minute the app is live at `https://<your-user>.github.io/<repo>/`.
   Every path in the app is relative, so the project subpath works as is.

When you change app files later, bump `VERSION` in `sw.js` so installed copies pick up
the new files (they update on the next open after that).

## 4. Add it to the iPhone home screen

1. Open `https://<your-user>.github.io/<repo>/` in **Safari** on the iPhone.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open it from the home screen icon. It runs full screen with a black status bar.
4. Open it once while online so the chart, zip and Supabase libraries are cached for
   offline use.

On a desktop browser, open the same URL; it shares the same data through Supabase.

## How sync works

- Every row has a client uuid, `updated_at` and a `deleted` flag (soft delete).
- Writes go to IndexedDB and to an outbox. The sync engine runs on load, when the
  device comes back online, every 60 seconds while online, and shortly after changes.
- Each pass pushes the outbox (upsert by id, skipping rows another device changed more
  recently), uploads queued photos to the `photos` bucket, deletes expired photos, then
  pulls rows changed since the last pull. Last write wins on `updated_at`.
- The indicator at the top right shows Synced, Syncing, Offline (n pending),
  Local only or Error. Tap it to sync now.

## Photos

- Compressed on the device: long edge 1080 px, JPEG quality 0.7.
- Kept in IndexedDB until uploaded to `photos/meals/<id>.jpg` or `photos/progress/<id>.jpg`,
  then shown from the public bucket URL (a copy is kept in the offline photo cache).
- On every app open, meal photos older than 30 days are deleted from storage and the
  device, and `photo_deleted_at` is set. The on-plan or off-plan record stays, so
  percentages are unaffected. Progress photos are kept permanently.

## Export

Stats > Data > **Export all data** downloads `workout-tracker-export-<date>.zip` with
`data.json` (every table) and one CSV per table. On an installed iPhone app it opens
the share sheet; choose **Save to Files**.
