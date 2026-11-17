# RENPHO scale to the Workout app, every morning

Your RENPHO scale writes weight and body fat to Apple Health. An iPhone Shortcut
automation reads the latest of each every morning and sends it straight to the app's
Supabase database. The app does not need to be open; it shows the reading the next time
it syncs (a small RENPHO tag marks those rows in the bodyweight log). Manual entry keeps
working exactly as before.

You need two values from `config.js` in this project. In the steps below they are written
as placeholders; type your real values in their place:

- `<SUPABASE_URL>`: the project URL, like `https://abcd1234.supabase.co` (no slash at the end)
- `<ANON_KEY>`: the anon public key

## Step 1. Update the database (once)

1. Open supabase.com, sign in, and open the project.
2. Left menu: **SQL Editor**, then **New query**.
3. Paste the whole file `migrations/2026-11-16-bodyweight-renpho.sql` and tap **Run**.
   It should say "Success. No rows returned". Running it again is harmless.

## Step 2. Let RENPHO write to Apple Health (once)

1. Open the **RENPHO** app, go to **Me** (or Settings), then **Apple Health**.
2. Turn on writing for **Weight** and **Body Fat Percentage**.
3. Step on the scale once with the RENPHO app open.
4. Check: **Health** app > **Browse** > **Body Measurements** > **Weight** shows today's
   value from RENPHO. Make sure the unit is **lb** (Health > Weight > Unit).

## Step 3. Build the morning automation (once)

1. Open **Shortcuts**, tap **Automation** at the bottom, then **+** (New Automation).
2. Pick **Time of Day**. Set **7:00 AM**, **Daily**. Choose **Run Immediately** (not
   "Run After Confirmation") and turn off **Notify When Run** if you like. Tap **Next**.
3. Tap **New Blank Automation** and add these actions in order.

   **Action 1: Find Health Samples**
   - Type: **Weight**
   - Sort by: **Start Date**, Order: **Latest First**
   - Limit: on, **1** Health Sample

   **Action 2: Get Details of Health Sample**
   - Detail: **Value**, of: *Health Samples* (from action 1)
   - Long-press this action's output later and rename it **Weight** (Rename).

   **Action 3: Find Health Samples**
   - Type: **Body Fat Percentage**
   - Sort by: **Start Date**, Order: **Latest First**, Limit: **1**

   **Action 4: Get Details of Health Sample**
   - Detail: **Value**, of: *Health Samples* (from action 3). Rename the output **BodyFat**.

   **Action 5: Get Details of Health Sample**
   - Detail: **Start Date**, of: the Weight *Health Samples* (from action 1).

   **Action 6: Format Date**
   - Date: *Start Date* (from action 5)
   - Date Format: **Custom**, format string: `yyyy-MM-dd`. Rename the output **Day**.

   **Action 7: Format Date** (makes the row id)
   - Date: *Start Date* (from action 5)
   - Date Format: **Custom**, format string: `yyyyMMdd`. Rename the output **DayDigits**.

   **Action 8: Text**
   - `b0d1e000-0000-4000-8000-0000` followed directly by *DayDigits* (no space).
     Rename the output **RowId**. Example result: `b0d1e000-0000-4000-8000-000020261116`.

   **Action 9: Get Contents of URL**
   - URL: `<SUPABASE_URL>/rest/v1/bodyweight?on_conflict=id`
   - Method: **POST**
   - Headers (tap Add new header for each):
     - `apikey`: `<ANON_KEY>`
     - `Authorization`: `Bearer <ANON_KEY>` (the word Bearer, one space, the key)
     - `Content-Type`: `application/json`
     - `Prefer`: `resolution=merge-duplicates,return=minimal`
   - Request Body: **JSON**, with these fields:
     - `id` (Text): *RowId*
     - `date` (Text): *Day*
     - `weight_lb` (Number): *Weight*
     - `body_fat_pct` (Number): *BodyFat*
     - `source` (Text): `renpho`
     - `deleted` (Boolean): **false**

4. Tap **Done**.

## Step 4. Test it

1. In the automation, tap the play button (or long-press it and Run).
2. Open the Workout app, go to **Stats**, scroll to **Data**, tap **Sync now**.
3. The bodyweight log shows today's weight and body fat with a **RENPHO** tag, and the
   Estimated burn card uses them.

If it fails: a 401 or 403 means the key or headers are wrong; a 404 means the URL is wrong;
"Could not find the 'body_fat_pct' column" means Step 1 has not been run.

## How it fits the app

- One row per day. The id is made from the date, the same way the app makes it, so a
  second weigh-in the same day replaces the first instead of adding a row, and a manual
  entry for that day edits the same row.
- The database stamps scale rows with the server time, so the app's next sync pulls them.
  Body fat sent as a fraction (0.21) is stored as a percent (21).
- Body fat is optional. If the scale did not measure it, leave the BodyFat field empty or
  remove `body_fat_pct` from the body; the app then keeps the earlier body fat value.
- Progress photos stay manual: Stats > Weekly check-in. The check-in fills in your latest
  weight and body fat for you.
