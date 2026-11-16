// App shell: boots the database and seed data, runs the meal photo cleanup,
// starts sync, and switches between the four bottom tabs.

import { openDB } from './db.js';
import { seedIfNeeded } from './seed.js';
import { start as startSync, mountStatus } from './sync.js';
import { cleanupOldMealPhotos } from './photos.js';
import { initTimer } from './timer.js';
import { on, isEditing, anySheetOpen, h } from './util.js';
import * as workout from './workout.js';
import * as diet from './diet.js';
import * as supplements from './supplements.js';
import * as stats from './stats.js';

const TABS = { workout, diet, supplements, stats };
const TAB_KEY = 'wt-tab';
let current = 'workout';
let rendering = false;

function savedTab() {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS[t] ? t : 'workout';
  } catch (e) {
    return 'workout';
  }
}

async function show(tab, { resetScroll = true } = {}) {
  current = tab;
  try { localStorage.setItem(TAB_KEY, tab); } catch (e) { /* private mode */ }
  document.querySelectorAll('.tab').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-current', active ? 'page' : 'false');
  });
  const view = document.getElementById('view');
  const y = window.scrollY;
  rendering = true;
  try {
    await TABS[tab].render(view);
  } catch (err) {
    console.error(err);
    view.replaceChildren(h('div', { class: 'card' }, h('p', null, 'Something went wrong on this screen.'), h('p', { class: 'muted small' }, String(err && err.message ? err.message : err))));
  } finally {
    rendering = false;
  }
  window.scrollTo(0, resetScroll ? 0 : y);
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => show(b.dataset.tab));
  });
}

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // The phone often resumes the app instead of relaunching it, so check for a new
      // version each time it comes back to the front.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch((e) => console.warn('Service worker not registered', e));
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  await openDB();
  await seedIfNeeded();
  initTimer();
  mountStatus(document.getElementById('sync-status'));
  bindTabs();

  // Pulled changes from another device refresh the screen unless the user is mid-edit.
  on('remote-change', () => {
    if (rendering || isEditing() || anySheetOpen()) return;
    show(current, { resetScroll: false });
  });

  await show(savedTab());

  try {
    const removed = await cleanupOldMealPhotos();
    if (removed && current === 'diet') show('diet', { resetScroll: false });
  } catch (e) {
    console.warn('Meal photo cleanup failed', e);
  }
  startSync();
}

boot().catch((err) => {
  console.error(err);
  const view = document.getElementById('view');
  view.replaceChildren(h('div', { class: 'card' }, h('h1', null, 'Could not start'), h('p', { class: 'muted' }, String(err && err.message ? err.message : err))));
});
