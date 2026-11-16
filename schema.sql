-- Workout Tracker: Supabase schema.
-- Paste into the Supabase SQL editor and run. Safe to run more than once.
--
-- Single user, no sign-in: the app uses the public anon key only, and every
-- device shares the same data. Row level security stays ENABLED, with explicit
-- policies that give the anon role full access (the owner accepted this).
--
-- Every row has a client-generated uuid id, updated_at (set by the client; the
-- sync engine uses it for last-write-wins) and deleted (soft delete).
-- No foreign keys on purpose: offline devices push rows in any order.
-- Seed rows (categories, exercises, Templates A and B) are created by the app
-- itself with fixed uuids, not by this script.

-- ---------- tables ----------

create table if not exists public.categories (
  id uuid primary key,
  name text not null,
  muscle_group text,
  sort_order integer,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.exercises (
  id uuid primary key,
  name text not null,
  load_type text not null default 'machine'
    check (load_type in ('plates', 'machine', 'dumbbell', 'cable', 'bodyweight')),
  default_rest_sec integer,
  setup_note text,
  bar_lb numeric,                -- bar or sled weight for plate-loaded exercises
  archived boolean default false,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.exercise_categories (
  id uuid primary key,
  exercise_id uuid not null,
  category_id uuid not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.templates (
  id uuid primary key,
  name text not null,            -- "A" or "B"
  sort_order integer,            -- the spec's "order" (a reserved word in SQL)
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.template_slots (
  id uuid primary key,
  template_id uuid not null,
  position integer not null,
  category_id uuid not null,
  default_exercise_id uuid,      -- e.g. wide-grip row, hanging leg raise
  sets integer not null default 3,
  target_reps integer,
  superset_group integer,        -- consecutive slots with the same number form a superset
  note text,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.sessions (
  id uuid primary key,
  template_id uuid,              -- null for Freestyle
  started_at timestamptz not null,
  ended_at timestamptz,
  extras_json jsonb default '[]'::jsonb,  -- off-plan exercises added to this session only
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.sets (
  id uuid primary key,
  session_id uuid not null,
  slot_id uuid,                  -- null for off-plan exercises
  exercise_id uuid not null,
  set_number integer not null,
  weight_lb numeric not null default 0,
  plates_json jsonb,             -- { "bar": 45, "per_side": { "45": 2, "10": 1 } }
  reps integer not null,
  logged_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.runs (
  id uuid primary key,
  date date not null,
  type text not null default 'run' check (type in ('run', 'walking_pad')),
  duration_sec integer,          -- null for walking pad
  distance_mi numeric not null,
  notes text,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.meals (
  id uuid primary key,
  logged_at timestamptz not null,
  on_plan boolean not null,
  photo_path text,               -- meals/<id>.jpg in the photos bucket
  photo_deleted_at timestamptz,  -- set when the photo is removed after 30 days
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.supplements (
  id uuid primary key,
  name text not null,
  unit text,
  paused boolean default false,
  archived boolean default false,
  sort_order integer,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.supplement_versions (
  id uuid primary key,
  supplement_id uuid not null,
  dose text not null,
  schedule_json jsonb not null,  -- {"type":"daily"} | {"type":"every_n","n":2,"start":"2026-11-15"} | {"type":"weekdays","days":[1,3,5]}
  slots jsonb not null,          -- ["Morning","Night","Pre-workout","Post-workout"]
  effective_from timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.supplement_logs (
  id uuid primary key,
  supplement_id uuid not null,
  slot text not null,
  date date not null,
  taken_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.bodyweight (
  id uuid primary key,
  date date not null,
  weight_lb numeric not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists public.progress_photos (
  id uuid primary key,
  checkin_date date not null,
  angle text not null check (angle in ('front', 'side', 'back')),
  photo_path text not null,      -- progress/<id>.jpg in the photos bucket
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

-- ---------- indexes for incremental pulls ----------

create index if not exists categories_updated_at_idx on public.categories (updated_at);
create index if not exists exercises_updated_at_idx on public.exercises (updated_at);
create index if not exists exercise_categories_updated_at_idx on public.exercise_categories (updated_at);
create index if not exists templates_updated_at_idx on public.templates (updated_at);
create index if not exists template_slots_updated_at_idx on public.template_slots (updated_at);
create index if not exists sessions_updated_at_idx on public.sessions (updated_at);
create index if not exists sets_updated_at_idx on public.sets (updated_at);
create index if not exists runs_updated_at_idx on public.runs (updated_at);
create index if not exists meals_updated_at_idx on public.meals (updated_at);
create index if not exists supplements_updated_at_idx on public.supplements (updated_at);
create index if not exists supplement_versions_updated_at_idx on public.supplement_versions (updated_at);
create index if not exists supplement_logs_updated_at_idx on public.supplement_logs (updated_at);
create index if not exists bodyweight_updated_at_idx on public.bodyweight (updated_at);
create index if not exists progress_photos_updated_at_idx on public.progress_photos (updated_at);

-- ---------- row level security: enabled, anon has full access ----------

do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'exercises', 'exercise_categories', 'templates', 'template_slots',
    'sessions', 'sets', 'runs', 'meals', 'supplements', 'supplement_versions',
    'supplement_logs', 'bodyweight', 'progress_photos'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to anon', t);

    execute format('drop policy if exists %I on public.%I', 'anon_select_' || t, t);
    execute format('create policy %I on public.%I for select to anon using (true)', 'anon_select_' || t, t);

    execute format('drop policy if exists %I on public.%I', 'anon_insert_' || t, t);
    execute format('create policy %I on public.%I for insert to anon with check (true)', 'anon_insert_' || t, t);

    execute format('drop policy if exists %I on public.%I', 'anon_update_' || t, t);
    execute format('create policy %I on public.%I for update to anon using (true) with check (true)', 'anon_update_' || t, t);

    execute format('drop policy if exists %I on public.%I', 'anon_delete_' || t, t);
    execute format('create policy %I on public.%I for delete to anon using (true)', 'anon_delete_' || t, t);
  end loop;
end
$$;

-- ---------- storage: public "photos" bucket ----------

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists "photos_anon_select" on storage.objects;
create policy "photos_anon_select" on storage.objects
  for select to anon using (bucket_id = 'photos');

drop policy if exists "photos_anon_insert" on storage.objects;
create policy "photos_anon_insert" on storage.objects
  for insert to anon with check (bucket_id = 'photos');

drop policy if exists "photos_anon_update" on storage.objects;
create policy "photos_anon_update" on storage.objects
  for update to anon using (bucket_id = 'photos') with check (bucket_id = 'photos');

drop policy if exists "photos_anon_delete" on storage.objects;
create policy "photos_anon_delete" on storage.objects
  for delete to anon using (bucket_id = 'photos');
