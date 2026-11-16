// Rest timer. Starts automatically after a logged set. Uses an end timestamp so it
// keeps correct time while the app is in the background.

import { h, pad2 } from './util.js';

let el = null;
let endAt = 0;
let total = 0;
let tick = null;
let audio = null;
let doneTimeout = null;

export function initTimer() {
  el = document.getElementById('rest-timer');
}

/** Call at the very start of a tap handler so iPhone allows the end-of-rest beep. */
export function primeAudio() {
  ensureAudio();
}

function ensureAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) audio = new AC();
    if (audio.state === 'suspended') audio.resume();
  } catch (e) {
    audio = null;
  }
}

function beep() {
  if (!audio) return;
  try {
    const t0 = audio.currentTime;
    [0, 0.25, 0.5].forEach((d) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.2);
    });
  } catch (e) {
    /* sound is optional */
  }
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
}

const fmt = (s) => `${Math.floor(s / 60)}:${pad2(s % 60)}`;

function render() {
  if (!el) return;
  const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  const pct = total > 0 ? Math.min(100, ((total - left) / total) * 100) : 100;
  el.replaceChildren(
    h('div', { class: 'timer-bar', style: { width: pct + '%' } }),
    h('div', { class: 'timer-row' },
      h('div', { class: 'timer-time', 'aria-live': 'off' }, h('span', { class: 'timer-label' }, 'Rest'), fmt(left)),
      h('button', { type: 'button', class: 'timer-btn', onclick: () => adjust(-15), 'aria-label': 'Fifteen seconds less' }, '−15'),
      h('button', { type: 'button', class: 'timer-btn', onclick: () => adjust(15), 'aria-label': 'Fifteen seconds more' }, '+15'),
      h('button', { type: 'button', class: 'timer-btn', onclick: stop }, 'Skip')
    )
  );
  if (left <= 0) finish();
}

function finish() {
  clearInterval(tick);
  tick = null;
  beep();
  el.replaceChildren(h('div', { class: 'timer-row' }, h('div', { class: 'timer-time timer-done' }, 'Rest done. Next set.')));
  clearTimeout(doneTimeout);
  doneTimeout = setTimeout(stop, 4000);
}

/** Starts or restarts the rest timer. Call from a tap so sound is allowed on iPhone. */
export function startRest(seconds) {
  if (!el) initTimer();
  ensureAudio();
  clearTimeout(doneTimeout);
  total = Math.max(5, Math.round(seconds || 90));
  endAt = Date.now() + total * 1000;
  el.hidden = false;
  document.body.classList.add('timer-on');
  clearInterval(tick);
  tick = setInterval(render, 250);
  render();
}

export function adjust(delta) {
  if (!tick) return;
  endAt += delta * 1000;
  total = Math.max(5, total + delta);
  render();
}

export function stop() {
  clearInterval(tick);
  clearTimeout(doneTimeout);
  tick = null;
  if (el) {
    el.hidden = true;
    el.replaceChildren();
  }
  document.body.classList.remove('timer-on');
}

export const isRunning = () => !!tick;
