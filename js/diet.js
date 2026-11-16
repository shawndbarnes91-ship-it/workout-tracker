// Diet tab. Deliberately minimal: take or choose a photo, tap On Plan or Off Plan.
// Shows today's on-plan percentage and the current on-plan streak.

import { all, save } from './db.js';
import { h, clear, toast, openSheet, confirmSheet, pickImage, uuid, nowISO, dateStr, fmtDay, fmtTime, sortBy, ts, emptyNote } from './util.js';
import { compressImage, storePhoto, mealPhotoPath, photoImg, deletePhoto } from './photos.js';

let rootEl = null;
let pending = null; // { blob, url } waiting for On Plan / Off Plan

export async function render(root) {
  rootEl = root;
  const meals = sortBy(await all('meals'), (m) => ts(m.logged_at), true);
  clear(root);

  const today = dateStr();
  const todays = meals.filter((m) => dateStr(new Date(m.logged_at)) === today);
  const onToday = todays.filter((m) => m.on_plan).length;
  const pct = todays.length ? Math.round((onToday / todays.length) * 100) : null;
  let streak = 0;
  for (const m of meals) {
    if (m.on_plan) streak += 1;
    else break;
  }

  root.append(
    h('header', { class: 'page-head' }, h('h1', null, 'Diet')),
    h('div', { class: 'card two-col' },
      h('div', null,
        h('div', { class: 'muted small' }, 'Today on plan'),
        h('div', { class: 'big-stat' }, pct == null ? '-' : `${pct}%`),
        h('div', { class: 'muted small' }, todays.length ? `${onToday} of ${todays.length} meals` : 'No meals yet today')),
      h('div', null,
        h('div', { class: 'muted small' }, 'On-plan streak'),
        h('div', { class: 'big-stat' }, String(streak)),
        h('div', { class: 'muted small' }, streak === 1 ? 'meal in a row' : 'meals in a row'))
    )
  );

  if (pending) {
    root.append(
      h('div', { class: 'card stack' },
        pending.url ? h('img', { class: 'photo photo-preview', src: pending.url, alt: 'Meal photo' }) : h('div', { class: 'photo photo-missing' }, 'No photo'),
        h('div', { class: 'row gap' },
          h('button', { type: 'button', class: 'btn btn-primary grow btn-tall', onclick: () => logMeal(true) }, 'On Plan'),
          h('button', { type: 'button', class: 'btn btn-secondary grow btn-tall', onclick: () => logMeal(false) }, 'Off Plan')
        ),
        h('button', { type: 'button', class: 'btn-text block', onclick: () => { dropPending(); render(root); } }, 'Cancel')
      )
    );
  } else {
    root.append(
      h('div', { class: 'card stack' },
        h('button', { type: 'button', class: 'btn btn-primary block btn-tall', onclick: () => choose(true) }, 'Take photo'),
        h('button', { type: 'button', class: 'btn btn-secondary block', onclick: () => choose(false) }, 'Choose photo'),
        h('button', { type: 'button', class: 'btn-text block', onclick: () => { pending = { blob: null, url: null }; render(root); } }, 'Log without a photo')
      )
    );
  }

  root.append(h('div', { class: 'section-label' }, 'Recent meals'));
  if (!meals.length) {
    root.append(emptyNote('No meals logged yet.'));
    return;
  }
  const byDay = new Map();
  for (const m of meals.slice(0, 60)) {
    const k = dateStr(new Date(m.logged_at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(m);
  }
  for (const [day, list] of byDay) {
    const on = list.filter((m) => m.on_plan).length;
    root.append(
      h('div', { class: 'day-head' }, h('span', { class: 'grow' }, fmtDay(day)), h('span', { class: 'muted small' }, `${Math.round((on / list.length) * 100)}% on plan`)),
      h('div', { class: 'meal-grid' }, list.map((m) => mealTile(m)))
    );
  }
}

function mealTile(m) {
  const hasPhoto = m.photo_path && !m.photo_deleted_at;
  return h('button', { type: 'button', class: 'meal-tile', onclick: () => openMeal(m) },
    hasPhoto ? photoImg(m.photo_path, 'meal-thumb', 'Meal photo') : h('div', { class: 'meal-thumb photo-missing' }, m.photo_deleted_at ? 'Photo removed after 30 days' : 'No photo'),
    h('div', { class: 'meal-meta' }, h('span', null, fmtTime(m.logged_at)), h('span', { class: m.on_plan ? 'tag tag-on' : 'tag tag-off' }, m.on_plan ? 'On plan' : 'Off plan'))
  );
}

function dropPending() {
  if (pending && pending.url) URL.revokeObjectURL(pending.url);
  pending = null;
}

async function choose(camera) {
  const file = await pickImage({ camera });
  if (!file) return;
  try {
    const blob = await compressImage(file);
    dropPending();
    pending = { blob, url: URL.createObjectURL(blob) };
  } catch (e) {
    toast(e.message || 'Could not use that photo.');
    return;
  }
  render(rootEl);
}

async function logMeal(onPlan) {
  const id = uuid();
  let photoPath = null;
  if (pending && pending.blob) {
    photoPath = mealPhotoPath(id);
    await storePhoto(photoPath, pending.blob);
  }
  await save('meals', { id, logged_at: nowISO(), on_plan: onPlan, photo_path: photoPath, photo_deleted_at: null });
  dropPending();
  toast(onPlan ? 'Logged: on plan' : 'Logged: off plan');
  render(rootEl);
}

function openMeal(m) {
  openSheet(`${fmtDay(m.logged_at)} · ${fmtTime(m.logged_at)}`, (body, api) => {
    const hasPhoto = m.photo_path && !m.photo_deleted_at;
    body.append(
      hasPhoto ? photoImg(m.photo_path, 'photo photo-preview', 'Meal photo') : h('p', { class: 'muted' }, m.photo_deleted_at ? 'The photo was removed after 30 days. The record stays.' : 'No photo.'),
      h('div', { class: 'row gap' },
        h('button', {
          type: 'button',
          class: m.on_plan ? 'btn btn-primary grow' : 'btn btn-secondary grow',
          onclick: async () => { await save('meals', { ...m, on_plan: true }); api.close(); render(rootEl); },
        }, 'On Plan'),
        h('button', {
          type: 'button',
          class: !m.on_plan ? 'btn btn-primary grow' : 'btn btn-secondary grow',
          onclick: async () => { await save('meals', { ...m, on_plan: false }); api.close(); render(rootEl); },
        }, 'Off Plan')
      ),
      h('button', {
        type: 'button',
        class: 'btn btn-danger block',
        onclick: async () => {
          if (!(await confirmSheet('Delete this meal?'))) return;
          if (hasPhoto) await deletePhoto(m.photo_path);
          await save('meals', { ...m, deleted: true });
          api.close();
          toast('Meal deleted');
          render(rootEl);
        },
      }, 'Delete meal')
    );
  });
}
