// Progress section (inside Stats): weekly check-in with front, side and back photos
// plus bodyweight, bodyweight (and optional body fat %) on its own any day, the body
// profile, and a side-by-side compare view. Progress photos are compressed and kept
// permanently. Scale readings from the RENPHO Shortcut arrive as bodyweight rows.

import { all, get, save, saveMany, getMeta, setMeta } from './db.js';
import {
  h, add, clear, toast, openSheet, field, confirmSheet, pickImage, uuid, todayStr, fmtDay, fmtLb, sortBy, emptyNote,
  icon, daysBetween,
} from './util.js';
import { oneBodyweightPerDay, bodyweightIdFor, normBodyFat, latestReading } from './body.js';
import { compressImage, storePhoto, progressPhotoPath, photoImg, deletePhoto } from './photos.js';

const ANGLES = ['front', 'side', 'back'];
const angleLabel = (a) => a.charAt(0).toUpperCase() + a.slice(1);

// Compare picker labels stay short so two fit side by side on a small phone: "Nov 16",
// with a short year only for an earlier year ("Nov 16 '25").
function compareDay(d) {
  const [y, m, day] = String(d).split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  const md = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return y === new Date().getFullYear() ? md : `${md} '${String(y).slice(2)}`;
}
let compareA = null;
let compareB = null;

const PROFILE_KEY = 'body_profile'; // { height_in } (this device only)

export async function loadProgress() {
  const [bodyweight, photos, profile] = await Promise.all([all('bodyweight'), all('progress_photos'), getMeta(PROFILE_KEY, null)]);
  return { bodyweight: oneBodyweightPerDay(bodyweight), photos, profile: profile || {} };
}

function checkinDates(photos) {
  return [...new Set(photos.map((p) => p.checkin_date))].sort().reverse();
}

const weightOn = (bw, date) => {
  const b = bw.find((x) => x.date === date);
  return b ? Number(b.weight_lb) : null;
};

/**
 * Saves the day's reading on that day's row: an older row for the date if one is live,
 * else the row whose id comes from the date (the one the RENPHO Shortcut writes), even if
 * it was deleted before. Body fat is kept when the entry leaves it empty.
 */
async function upsertBodyweight(bodyweight, date, weight, bodyFat) {
  const live = bodyweight.find((b) => b.date === date);
  const existing = live || (await get('bodyweight', bodyweightIdFor(date)));
  const base = existing || { id: bodyweightIdFor(date), date };
  const bf = bodyFat === undefined ? base.body_fat_pct ?? null : bodyFat;
  return save('bodyweight', { ...base, date, weight_lb: weight, body_fat_pct: bf, source: 'manual', deleted: false });
}

const bfInput = (value) => h('input', {
  class: 'input', type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'Optional',
  'aria-label': 'Body fat percent', value: value == null ? '' : value,
});

/** Body fat from an input: null when empty; undefined when out of range (caller warns). */
function readBf(input) {
  if (!input.value.trim()) return null;
  const v = normBodyFat(input.value);
  return v == null ? undefined : v;
}

const sourceTag = (b) => (b.source === 'renpho' ? h('span', { class: 'tag tag-source' }, 'RENPHO') : null);

/** Renders the Progress section into container; onChange re-renders the whole Stats tab. */
export async function renderProgress(container, onChange) {
  const data = await loadProgress();
  clear(container);
  const dates = checkinDates(data.photos);
  const latestBw = data.bodyweight[0];
  const latestBf = data.bodyweight.find((b) => normBodyFat(b.body_fat_pct) != null);
  const sinceCheckin = dates.length ? daysBetween(dates[0], todayStr()) : null;

  add(container,
    sinceCheckin == null || sinceCheckin >= 7
      ? h('div', { class: 'card due-card', role: 'note' },
        h('span', { class: 'hint-icon' }, icon('camera')),
        h('p', { class: 'grow' }, sinceCheckin == null ? 'Check-in due: photos + weight. Your first one sets the baseline.' : `Check-in due: photos + weight. Last one was ${sinceCheckin} days ago.`))
      : null,
    latestBw ? h('div', { class: 'two-col' },
      h('div', null,
        h('div', { class: 'stat-label' }, 'Latest bodyweight'),
        h('div', { class: 'big-stat' }, `${fmtLb(latestBw.weight_lb)} lb`),
        h('div', { class: 'muted small' }, fmtDay(latestBw.date), sourceTag(latestBw))),
      h('div', null,
        h('div', { class: 'stat-label' }, 'Body fat'),
        h('div', { class: 'big-stat' }, latestBf ? `${normBodyFat(latestBf.body_fat_pct)}%` : '-'),
        h('div', { class: 'muted small' }, latestBf ? fmtDay(latestBf.date) : 'Not logged yet'))) : h('p', { class: 'muted small' }, 'No bodyweight yet. Log it any day, or with a weekly check-in.'),
    h('button', { type: 'button', class: 'btn btn-primary block', onclick: () => openCheckin(data, onChange) }, icon('camera'), 'Weekly check-in'),
    h('div', { class: 'row gap' },
      h('button', { type: 'button', class: 'btn btn-secondary grow btn-stack', onclick: () => openBodyweight(data, onChange) }, icon('scale'), 'Log weight'),
      h('button', { type: 'button', class: 'btn btn-secondary grow btn-stack', onclick: () => openProfile(data, onChange) }, icon('ruler'), 'Body profile')
    )
  );

  // Compare view.
  if (dates.length >= 1) {
    if (!dates.includes(compareA)) compareA = dates[dates.length - 1];
    if (!dates.includes(compareB)) compareB = dates[0];
    const sel = (value, onPick) => {
      const s = h('select', { class: 'input', value, 'aria-label': 'Check-in date' }, dates.map((d) => h('option', { value: d }, compareDay(d))));
      s.addEventListener('change', () => { onPick(s.value); onChange(); });
      return s;
    };
    const grid = h('div', { class: 'compare-grid' });
    for (const angle of ANGLES) {
      const pa = data.photos.find((p) => p.checkin_date === compareA && p.angle === angle);
      const pb = data.photos.find((p) => p.checkin_date === compareB && p.angle === angle);
      if (!pa && !pb) continue;
      grid.append(
        h('div', { class: 'compare-label' }, angleLabel(angle)),
        h('div', { class: 'compare-row' },
          pa ? photoImg(pa.photo_path, 'compare-photo', `${angle} ${compareA}`) : h('div', { class: 'compare-photo photo-missing' }, 'None'),
          pb ? photoImg(pb.photo_path, 'compare-photo', `${angle} ${compareB}`) : h('div', { class: 'compare-photo photo-missing' }, 'None'))
      );
    }
    const wa = weightOn(data.bodyweight, compareA);
    const wb = weightOn(data.bodyweight, compareB);
    container.append(
      h('div', { class: 'section-label' }, 'Compare'),
      h('div', { class: 'compare-row' }, sel(compareA, (v) => { compareA = v; }), sel(compareB, (v) => { compareB = v; })),
      h('div', { class: 'compare-row muted small num' },
        h('span', { class: 'center' }, wa != null ? `${fmtLb(wa)} lb` : 'No weight'),
        h('span', { class: 'center' }, wb != null ? `${fmtLb(wb)} lb` : 'No weight')),
      grid
    );
  }

  // Check-in list.
  container.append(h('div', { class: 'section-label' }, 'Check-ins'));
  if (!dates.length) container.append(emptyNote('No progress photos yet.'));
  for (const d of dates) {
    const ps = data.photos.filter((p) => p.checkin_date === d);
    const w = weightOn(data.bodyweight, d);
    container.append(
      h('div', { class: 'day-head' }, h('span', { class: 'grow' }, fmtDay(d)), h('span', { class: 'muted small' }, w != null ? `${fmtLb(w)} lb` : '')),
      h('div', { class: 'meal-grid' }, sortBy(ps, (p) => ANGLES.indexOf(p.angle)).map((p) =>
        h('button', { type: 'button', class: 'meal-tile', 'aria-label': `${angleLabel(p.angle)} photo, ${fmtDay(d)}`, onclick: () => openPhoto(p, onChange) },
          photoImg(p.photo_path, 'meal-thumb', `${p.angle} photo`),
          h('div', { class: 'meal-meta' }, h('span', null, angleLabel(p.angle))))))
    );
  }

  // Bodyweight entries.
  container.append(h('div', { class: 'section-label' }, 'Bodyweight log'));
  if (!data.bodyweight.length) container.append(emptyNote('No bodyweight entries yet.'));
  else {
    container.append(h('div', { class: 'card list' }, data.bodyweight.slice(0, 20).map((b) =>
      h('button', { type: 'button', class: 'list-row nav', onclick: () => openBodyweight(data, onChange, b) },
        h('span', { class: 'grow' },
          h('span', { class: 'row-title' }, fmtDay(b.date)),
          normBodyFat(b.body_fat_pct) != null || b.source === 'renpho'
            ? h('span', { class: 'row-sub' }, normBodyFat(b.body_fat_pct) != null ? h('span', null, `${normBodyFat(b.body_fat_pct)}% body fat`) : null, sourceTag(b))
            : null),
        h('span', { class: 'trail strong' }, `${fmtLb(b.weight_lb)} lb`)))));
  }
}

function openBodyweight(data, onChange, entry = null) {
  openSheet(entry ? 'Edit bodyweight' : 'Log bodyweight', (body, api) => {
    const date = h('input', { class: 'input', type: 'date', value: entry ? entry.date : todayStr() });
    const w = h('input', { class: 'input big-input', type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'lb', 'aria-label': 'Bodyweight in pounds', value: entry ? entry.weight_lb : '' });
    const bf = bfInput(entry ? normBodyFat(entry.body_fat_pct) : null);
    add(body,
      field('Date', date),
      h('div', { class: 'two-col' }, field('Weight (lb)', w), field('Body fat %', bf)),
      entry && entry.source === 'renpho' ? h('p', { class: 'muted small' }, 'From your RENPHO scale. Saving here makes it a manual entry.') : null,
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          const val = parseFloat(w.value);
          if (!date.value) return toast('Pick a date.');
          if (!(val > 0)) return toast('Enter your weight.');
          const pct = readBf(bf);
          if (pct === undefined) return toast('Body fat should be between 2 and 75 percent.');
          if (entry && entry.date !== date.value) {
            // Moving a reading to another day: that day's row takes it; this one is removed.
            await save('bodyweight', { ...entry, source: 'manual', deleted: true });
            await upsertBodyweight(data.bodyweight.filter((b) => b.id !== entry.id), date.value, val, pct);
          } else await upsertBodyweight(data.bodyweight, date.value, val, pct);
          api.close();
          toast('Bodyweight saved');
          onChange();
        },
      }, 'Save'),
      entry ? h('button', {
        type: 'button',
        class: 'btn btn-danger block',
        onclick: async () => {
          if (!(await confirmSheet('Delete this bodyweight entry?'))) return;
          await save('bodyweight', { ...entry, source: 'manual', deleted: true });
          api.close();
          onChange();
        },
      }, 'Delete') : null
    );
  });
}

function openCheckin(data, onChange) {
  const picked = {}; // angle -> { blob, url }
  openSheet('Weekly check-in', (body, api) => {
    const date = h('input', { class: 'input', type: 'date', value: todayStr() });
    const w = h('input', { class: 'input big-input', type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'lb', 'aria-label': 'Bodyweight in pounds' });
    // Prefill from the latest reading (scale or manual).
    const latest = latestReading(data.bodyweight);
    if (latest) w.value = latest.weight_lb;
    const latestBf = data.bodyweight.find((b) => normBodyFat(b.body_fat_pct) != null);
    const bf = bfInput(latestBf ? normBodyFat(latestBf.body_fat_pct) : null);
    const slotsWrap = h('div', { class: 'checkin-grid' });
    const drawSlots = () => {
      clear(slotsWrap);
      for (const angle of ANGLES) {
        const p = picked[angle];
        slotsWrap.append(h('div', { class: 'checkin-slot' },
          h('div', { class: 'strong' }, angleLabel(angle)),
          p ? h('img', { class: 'meal-thumb', src: p.url, alt: `${angle} preview` }) : h('div', { class: 'meal-thumb photo-missing' }, 'No photo'),
          h('button', { type: 'button', class: 'btn btn-secondary block small-btn', 'aria-label': `Take ${angle} photo`, onclick: () => pick(angle, true) }, 'Take'),
          h('button', { type: 'button', class: 'btn btn-secondary block small-btn', 'aria-label': `Choose ${angle} photo`, onclick: () => pick(angle, false) }, 'Choose')
        ));
      }
    };
    const pick = async (angle, camera) => {
      const f = await pickImage({ camera });
      if (!f) return;
      try {
        const blob = await compressImage(f);
        if (picked[angle]) URL.revokeObjectURL(picked[angle].url);
        picked[angle] = { blob, url: URL.createObjectURL(blob) };
        drawSlots();
      } catch (e) {
        toast(e.message || 'Could not use that photo.');
      }
    };
    drawSlots();
    body.append(
      h('div', { class: 'two-col' }, field('Date', date), field('Bodyweight (lb)', w)),
      field('Body fat %', bf),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Photos (one or more)'), slotsWrap),
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          const day = date.value || todayStr();
          const val = parseFloat(w.value);
          const angles = Object.keys(picked);
          if (!(val > 0)) return toast('Enter your bodyweight.');
          if (!angles.length) return toast('Add at least one photo.');
          const pct = readBf(bf);
          if (pct === undefined) return toast('Body fat should be between 2 and 75 percent.');
          await upsertBodyweight(data.bodyweight, day, val, pct);
          const rows = [];
          for (const angle of angles) {
            const id = uuid();
            const path = progressPhotoPath(id);
            await storePhoto(path, picked[angle].blob);
            rows.push({ id, checkin_date: day, angle, photo_path: path });
            URL.revokeObjectURL(picked[angle].url);
          }
          await saveMany('progress_photos', rows);
          api.close();
          toast('Check-in saved');
          onChange();
        },
      }, 'Save check-in')
    );
  });
}

function openPhoto(p, onChange) {
  openSheet(`${angleLabel(p.angle)} photo`, (body, api) => {
    body.append(
      photoImg(p.photo_path, 'photo photo-preview', `${p.angle} photo`),
      h('button', {
        type: 'button',
        class: 'btn btn-danger block',
        onclick: async () => {
          if (!(await confirmSheet('Delete this progress photo?'))) return;
          await deletePhoto(p.photo_path);
          await save('progress_photos', { ...p, deleted: true });
          api.close();
          onChange();
        },
      }, 'Delete photo')
    );
  }, { subtitle: fmtDay(p.checkin_date) });
}

/** Height (this device) and the latest body fat. Body fat is saved on a bodyweight reading. */
function openProfile(data, onChange) {
  openSheet('Body profile', (body, api) => {
    const hIn = Number(data.profile.height_in) || 0;
    const ft = h('input', { class: 'input big-input', type: 'number', inputmode: 'numeric', placeholder: 'ft', 'aria-label': 'Height feet', value: hIn ? Math.floor(hIn / 12) : '' });
    const inch = h('input', { class: 'input big-input', type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'in', 'aria-label': 'Height inches', value: hIn ? Math.round((hIn % 12) * 10) / 10 : '' });
    const latest = data.bodyweight[0];
    const bf = bfInput(latest ? normBodyFat(latest.body_fat_pct) : null);
    add(body,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Height (ft : in)'), h('div', { class: 'duration-row' }, ft, h('span', { class: 'duration-sep', 'aria-hidden': 'true' }, ':'), inch)),
      latest
        ? field('Body fat %', bf, `Saved with your ${fmtDay(latest.date)} weigh-in. Each weigh-in can carry its own.`)
        : h('p', { class: 'muted small' }, 'Log bodyweight first. Body fat % is saved with a weigh-in.'),
      h('p', { class: 'muted small' }, 'Used for the calories estimate on this screen. The latest weight and body fat on or before each day count, so it keeps up as you change.'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          const f = parseInt(ft.value, 10) || 0;
          const i = parseFloat(inch.value) || 0;
          const total = f * 12 + i;
          if (ft.value || inch.value) {
            if (!(total >= 36 && total <= 96)) return toast('Enter a height between 3 and 8 feet.');
          }
          const pct = latest ? readBf(bf) : null;
          if (pct === undefined) return toast('Body fat should be between 2 and 75 percent.');
          await setMeta(PROFILE_KEY, { ...data.profile, height_in: total || null });
          if (latest && pct !== (normBodyFat(latest.body_fat_pct) ?? null)) {
            await save('bodyweight', { ...latest, body_fat_pct: pct, source: 'manual' });
          }
          api.close();
          toast('Body profile saved');
          onChange();
        },
      }, 'Save')
    );
  });
}
