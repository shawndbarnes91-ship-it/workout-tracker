-- 2026-11-16: body fat and RENPHO scale readings on the bodyweight table.
-- Paste into the Supabase SQL editor and run. Additive and idempotent: safe to run more
-- than once, removes nothing, and changes no other table or policy.
--
-- What it does
--   1. Adds body_fat_pct (numeric, nullable) and source (text, nullable: 'renpho' or
--      'manual') to public.bodyweight.
--   2. Gives id a server default (gen_random_uuid()) so a row posted without an id is
--      still valid. The app and the Shortcut both send an id, so this is a fallback.
--   3. Adds a trigger for scale rows (source = 'renpho'): it stamps updated_at with the
--      server time and turns a fraction (0.21) into a percent (21). Every change the app
--      makes to a row (edit, delete) marks it source = 'manual', so the trigger only ever
--      touches what the Shortcut sends.
--      updated_at matters: the app pulls rows whose updated_at is newer than its last
--      pull, and last write wins on updated_at, so a scale reading must carry a fresh one.
--
-- One row per day, without a unique key on date
--   The app keys every row by id (upsert on id; last write wins on updated_at; deletes
--   are soft, deleted = true). The Shortcut and the app both use the id built from the
--   date, b0d1e000-0000-4000-8000-0000YYYYMMDD, so a second reading on the same day
--   updates the same row (upsert on the primary key) instead of adding one.
--   A unique key on date is NOT added on purpose: a soft-deleted row keeps its date and
--   would block a new reading that day, and a phone holding an older second row for a
--   date would then fail every sync. Rows from before this change keep their random ids;
--   when two rows share a date, the app shows the newest.
--
-- Access
--   schema.sql already grants the anon role select, insert, update and delete on
--   bodyweight with RLS policies using (true) / with check (true). That is all a
--   PostgREST upsert ("Prefer: resolution=merge-duplicates") needs, so no policy changes.

alter table public.bodyweight add column if not exists body_fat_pct numeric;
alter table public.bodyweight add column if not exists source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bodyweight_source_check' and conrelid = 'public.bodyweight'::regclass
  ) then
    alter table public.bodyweight
      add constraint bodyweight_source_check check (source is null or source in ('renpho', 'manual'));
  end if;
end
$$;

alter table public.bodyweight alter column id set default gen_random_uuid();

create or replace function public.bodyweight_scale_reading()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'renpho' then
    new.updated_at := now();
    if new.body_fat_pct is not null and new.body_fat_pct > 0 and new.body_fat_pct < 1 then
      new.body_fat_pct := round(new.body_fat_pct * 100, 1);
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists bodyweight_scale_reading on public.bodyweight;
create trigger bodyweight_scale_reading
  before insert or update on public.bodyweight
  for each row execute function public.bodyweight_scale_reading();

-- PostgREST caches the schema; tell it about the new columns now.
notify pgrst, 'reload schema';
