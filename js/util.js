// Shared helpers: ids, dates, formatting, DOM building, sheets and toasts.

export const ACCENT = '#4ADE80';

/* ---------- event bus ---------- */
export const bus = new EventTarget();
export function emit(name, detail) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}
export function on(name, fn) {
  bus.addEventListener(name, (e) => fn(e.detail));
}

/* ---------- ids and time ---------- */
export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hx = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}`;
}

export const nowISO = () => new Date().toISOString();
export const DAY_MS = 86400000;

export const pad2 = (n) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export const todayStr = () => dateStr(new Date());

/** YYYY-MM-DD to a local Date at midnight. */
export function parseDay(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const dayStartMs = (s) => parseDay(s).getTime();
export const dayEndMs = (s) => parseDay(s).getTime() + DAY_MS - 1;

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday 00:00 of the week holding d. */
export function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

export function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / DAY_MS);
}

/** A Date for a YYYY-MM-DD day, an ISO time or epoch ms; null when missing or invalid. */
function toDate(v) {
  if (v == null || v === '') return null;
  const d = typeof v === 'string' && v.length === 10 ? parseDay(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function fmtDay(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date';
}
export function fmtShortDay(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No date';
}
export function fmtTime(iso) {
  const d = toDate(iso);
  return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

/** "1 set", "3 sets". */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Seconds per mile to "m:ss /mi". */
export function fmtPace(secPerMile) {
  if (!secPerMile || !isFinite(secPerMile)) return '-';
  const t = Math.round(secPerMile);
  return `${Math.floor(t / 60)}:${pad2(t % 60)} /mi`;
}

export const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Pounds without trailing zeros. */
export function fmtLb(n) {
  const v = round2(n);
  return String(v);
}

/** Epley estimated one-rep max. */
export function e1rm(w, r) {
  w = Number(w) || 0;
  r = Number(r) || 0;
  if (w <= 0 || r <= 0) return 0;
  return w * (1 + r / 30);
}

export function sortBy(arr, fn, desc = false) {
  return [...arr].sort((a, b) => {
    const x = fn(a);
    const y = fn(b);
    if (x < y) return desc ? 1 : -1;
    if (x > y) return desc ? -1 : 1;
    return 0;
  });
}

export const ts = (iso) => (iso ? Date.parse(iso) : 0);

/* ---------- DOM ---------- */
const PROP_KEYS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'multiple', 'readOnly']);

/** Small hyperscript helper. Props are applied after children so select values stick. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (PROP_KEYS.has(k)) el[k] = v;
    else if (v === false) continue;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return el;
}

/** Like el.append, but skips null, undefined and false (native append prints them). */
export function add(el, ...kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function isEditing() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
}

export function anySheetOpen() {
  return !!document.querySelector('.sheet-backdrop');
}

/* ---------- toast ---------- */
export function toast(msg, { pr = false, ms = 2600 } = {}) {
  const root = document.getElementById('toast-root') || document.body;
  const t = h('div', { class: 'toast' + (pr ? ' toast-pr' : ''), role: 'status' }, msg);
  root.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

/* ---------- bottom sheet ---------- */
/**
 * Opens a bottom sheet. build(body, api) fills it; api.close() closes it,
 * api.rebuild() rebuilds the body. Tapping outside the sheet closes it.
 */
export function openSheet(title, build, { onClose } = {}) {
  const body = h('div', { class: 'sheet-body' });
  let closed = false;
  const api = {
    body,
    close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      if (!anySheetOpen()) document.body.classList.remove('sheet-open');
      if (onClose) onClose();
    },
    rebuild() {
      clear(body);
      build(body, api);
    },
  };
  const panel = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'btn-text', type: 'button', onclick: () => api.close() }, 'Close')),
    body
  );
  const backdrop = h('div', { class: 'sheet-backdrop' }, panel);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) api.close();
  });
  document.body.append(backdrop);
  document.body.classList.add('sheet-open');
  build(body, api);
  return api;
}

/** Yes/no question in a sheet. Resolves true only on the confirm button. */
export function confirmSheet(message, okLabel = 'Delete', title = 'Are you sure?') {
  return new Promise((resolve) => {
    let answered = false;
    openSheet(
      title,
      (body, api) => {
        body.append(
          h('p', { class: 'muted' }, message),
          h('div', { class: 'row gap' },
            h('button', { class: 'btn btn-secondary grow', type: 'button', onclick: () => api.close() }, 'Cancel'),
            h('button', {
              class: 'btn btn-danger grow',
              type: 'button',
              onclick: () => {
                answered = true;
                resolve(true);
                api.close();
              },
            }, okLabel)
          )
        );
      },
      { onClose: () => { if (!answered) resolve(false); } }
    );
  });
}

/** Segmented control. options: [{value,label}] */
export function segmented(options, value, onChange, cls = '') {
  return h(
    'div',
    { class: 'segmented ' + cls, role: 'tablist' },
    options.map((o) =>
      h('button', {
        type: 'button',
        role: 'tab',
        class: 'seg' + (o.value === value ? ' active' : ''),
        'aria-selected': o.value === value ? 'true' : 'false',
        onclick: () => onChange(o.value),
      }, o.label)
    )
  );
}

/** Number input with big minus and plus buttons. */
export function stepper({ value, step = 1, min = 0, decimals = true, label, onInput, placeholder }) {
  const input = h('input', {
    type: 'number',
    inputmode: decimals ? 'decimal' : 'numeric',
    step: 'any',
    min: String(min),
    class: 'stepper-input',
    placeholder: placeholder || '0',
    'aria-label': label,
    value: value == null || value === '' ? '' : String(value),
  });
  const bump = (dir) => {
    const cur = parseFloat(input.value) || 0;
    let next = Math.max(min, round2(cur + dir * step));
    input.value = String(next);
    if (onInput) onInput(next, true);
  };
  input.addEventListener('input', () => onInput && onInput(parseFloat(input.value) || 0, false));
  const wrap = h('div', { class: 'stepper' },
    h('button', { type: 'button', class: 'step-btn', 'aria-label': `Less ${label}`, onclick: () => bump(-1) }, '−'),
    input,
    h('button', { type: 'button', class: 'step-btn', 'aria-label': `More ${label}`, onclick: () => bump(1) }, '+')
  );
  wrap.input = input;
  return wrap;
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function emptyNote(text) {
  return h('p', { class: 'empty' }, text);
}

/** Hidden file input that opens the camera or the photo library. */
export function pickImage({ camera }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    if (camera) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      resolve(f || null);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}
