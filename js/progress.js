// Progress section (inside Stats): weekly check-in with front, side and back photos
// plus bodyweight, bodyweight on its own any day, and a side-by-side compare view.
// Progress photos are compressed and kept permanently.

import { all, save, saveMany } from './db.js';
import {
  h, clear, toast, openSheet, field, confirmSheet, pickImage, uuid, todayStr, fmtDay, fmtLb, sortBy, emptyNote,
} from './util.js';
import { compressImage, storePhoto, progressPhotoPath, photoImg, deletePhoto } from './photos.js';

const ANGLES = ['front', 'side', 'back'];
const angleLabel = (a) => a.charAt(0).toUpperCase() + a.slice(1);

let compareA = null;
let compareB = null;

export async function loadProgress() {
  const [bodyweight, photos] = await Promise.all([all('bodyweight'), all('progress_photos')]);
  return { bodyweight: sortBy(bodyweight, (b) => b.date + (b.updated_at || ''), true), photos };
}

function checkinDates(photos) {
  return [...new Set(photos.map((p) => p.checkin_date))].sort().reverse();
}

const weightOn = (bw, date) => {
  const b = bw.find((x) => x.date === date);
  return b ? Number(b.weight_lb) : null;
};

async function upsertBodyweight(bodyweight, date, weight) {
  const existing = bodyweight.find((b) => b.date === date);
  return save('bodyweight', existing ? { ...existing, weight_lb: weight } : { date, weight_lb: weight });
}

/** Renders the Progress section into container; onChange re-renders the whole Stats tab. */
export async function renderProgress(container, onChange) {
  const data = await loadProgress();
  clear(container);
  const dates = checkinDates(data.photos);
  const latestBw = data.bodyweight[0];

  container.append(
    h('div', { class: 'row gap' },
      h('button', { type: 'button', class: 'btn btn-primary grow', onclick: () => openCheckin(data, onChange) }, 'Weekly check-in'),
      h('button', { type: 'button', class: 'btn btn-secondary grow', onclick: () => openBodyweight(data, onChange) }, 'Log bodyweight')
    ),
    latestBw ? h('p', { class: 'muted small' }, `Latest bodyweight: ${fmtLb(latestBw.weight_lb)} lb on ${fmtDay(latestBw.date)}`) : null
  );

  // Compare view.
  if (dates.length >= 1) {
    if (!dates.includes(compareA)) compareA = dates[dates.length - 1];
    if (!dates.includes(compareB)) compareB = dates[0];
    const sel = (value, onPick) => {
      const s = h('select', { class: 'input', value }, dates.map((d) => h('option', { value: d }, fmtDay(d))));
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
      h('div', { class: 'row gap' }, h('div', { class: 'grow' }, sel(compareA, (v) => { compareA = v; })), h('div', { class: 'grow' }, sel(compareB, (v) => { compareB = v; }))),
      h('div', { class: 'row gap muted small' },
        h('span', { class: 'grow center' }, wa != null ? `${fmtLb(wa)} lb` : 'No weight'),
        h('span', { class: 'grow center' }, wb != null ? `${fmtLb(wb)} lb` : 'No weight')),
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
        h('button', { type: 'button', class: 'meal-tile', onclick: () => openPhoto(p, onChange) },
          photoImg(p.photo_path, 'meal-thumb', `${p.angle} photo`),
          h('div', { class: 'meal-meta' }, h('span', null, angleLabel(p.angle))))))
    );
  }

  // Bodyweight entries.
  container.append(h('div', { class: 'section-label' }, 'Bodyweight log'));
  if (!data.bodyweight.length) container.append(emptyNote('No bodyweight entries yet.'));
  else {
    container.append(h('div', { class: 'card list' }, data.bodyweight.slice(0, 20).map((b) =>
      h('button', { type: 'button', class: 'list-row', onclick: () => openBodyweight(data, onChange, b) },
        h('span', { class: 'grow' }, fmtDay(b.date)), h('span', { class: 'strong' }, `${fmtLb(b.weight_lb)} lb`)))));
  }
}

function openBodyweight(data, onChange, entry = null) {
  openSheet(entry ? 'Edit bodyweight' : 'Log bodyweight', (body, api) => {
    const date = h('input', { class: 'input', type: 'date', value: entry ? entry.date : todayStr() });
    const w = h('input', { class: 'input big-input', type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'lb', value: entry ? entry.weight_lb : '' });
    body.append(
      field('Date', date),
      field('Weight (lb)', w),
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          const val = parseFloat(w.value);
          if (!(val > 0)) return toast('Enter your weight.');
          if (entry && entry.date !== date.value) await save('bodyweight', { ...entry, date: date.value, weight_lb: val });
          else await upsertBodyweight(data.bodyweight, date.value || todayStr(), val);
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
          await save('bodyweight', { ...entry, deleted: true });
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
    const w = h('input', { class: 'input big-input', type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'lb' });
    const existing = data.bodyweight.find((b) => b.date === todayStr());
    if (existing) w.value = existing.weight_lb;
    const slotsWrap = h('div', { class: 'checkin-grid' });
    const drawSlots = () => {
      clear(slotsWrap);
      for (const angle of ANGLES) {
        const p = picked[angle];
        slotsWrap.append(h('div', { class: 'checkin-slot' },
          h('div', { class: 'strong' }, angleLabel(angle)),
          p ? h('img', { class: 'meal-thumb', src: p.url, alt: `${angle} preview` }) : h('div', { class: 'meal-thumb photo-missing' }, 'No photo'),
          h('button', { type: 'button', class: 'btn btn-secondary block small-btn', onclick: () => pick(angle, true) }, 'Take'),
          h('button', { type: 'button', class: 'btn btn-secondary block small-btn', onclick: () => pick(angle, false) }, 'Choose')
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
      field('Date', date),
      field('Bodyweight (lb)', w),
      h('div', { class: 'field-label' }, 'Photos (one or more)'),
      slotsWrap,
      h('button', {
        type: 'button',
        class: 'btn btn-primary block',
        onclick: async () => {
          const day = date.value || todayStr();
          const val = parseFloat(w.value);
          const angles = Object.keys(picked);
          if (!(val > 0)) return toast('Enter your bodyweight.');
          if (!angles.length) return toast('Add at least one photo.');
          await upsertBodyweight(data.bodyweight, day, val);
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
  openSheet(`${angleLabel(p.angle)} · ${fmtDay(p.checkin_date)}`, (body, api) => {
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
  });
}
