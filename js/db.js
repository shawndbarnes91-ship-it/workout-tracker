// IndexedDB layer. IndexedDB is the source of truth on every device.
// Each synced row has a client uuid, updated_at (ISO) and deleted (soft delete).
// Every local write also lands in the outbox so the sync engine can push it.

import { uuid, nowISO, emit, ts } from './util.js';

const DB_NAME = 'workout-tracker';
const DB_VERSION = 1;

/** Synced tables and their columns. Order matters: parents before children when pushing. */
export const COLUMNS = {
  categories: ['id', 'name', 'muscle_group', 'sort_order', 'updated_at', 'deleted'],
  exercises: ['id', 'name', 'load_type', 'default_rest_sec', 'setup_note', 'bar_lb', 'archived', 'updated_at', 'deleted'],
  exercise_categories: ['id', 'exercise_id', 'category_id', 'updated_at', 'deleted'],
  templates: ['id', 'name', 'sort_order', 'updated_at', 'deleted'],
  template_slots: ['id', 'template_id', 'position', 'category_id', 'default_exercise_id', 'sets', 'target_reps', 'superset_group', 'note', 'updated_at', 'deleted'],
  sessions: ['id', 'template_id', 'started_at', 'ended_at', 'extras_json', 'updated_at', 'deleted'],
  sets: ['id', 'session_id', 'slot_id', 'exercise_id', 'set_number', 'weight_lb', 'plates_json', 'reps', 'logged_at', 'updated_at', 'deleted'],
  runs: ['id', 'date', 'type', 'duration_sec', 'distance_mi', 'notes', 'updated_at', 'deleted'],
  meals: ['id', 'logged_at', 'on_plan', 'photo_path', 'photo_deleted_at', 'updated_at', 'deleted'],
  supplements: ['id', 'name', 'unit', 'paused', 'archived', 'sort_order', 'updated_at', 'deleted'],
  supplement_versions: ['id', 'supplement_id', 'dose', 'schedule_json', 'slots', 'effective_from', 'updated_at', 'deleted'],
  supplement_logs: ['id', 'supplement_id', 'slot', 'date', 'taken_at', 'updated_at', 'deleted'],
  bodyweight: ['id', 'date', 'weight_lb', 'updated_at', 'deleted'],
  progress_photos: ['id', 'checkin_date', 'angle', 'photo_path', 'updated_at', 'deleted'],
};
export const TABLES = Object.keys(COLUMNS);

/** Keep only the known columns of a table (missing ones become null). */
export function pick(table, row) {
  const o = {};
  for (const c of COLUMNS[table]) o[c] = row[c] === undefined ? null : row[c];
  o.deleted = row.deleted === true;
  return o;
}

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const t of TABLES) {
        if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'path' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The database is open in another tab. Close it and reload.'));
  });
  return dbPromise;
}

function reqP(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/* ---------- reads ---------- */

export async function all(table, { includeDeleted = false } = {}) {
  const db = await openDB();
  const rows = await reqP(db.transaction(table).objectStore(table).getAll());
  return includeDeleted ? rows : rows.filter((r) => !r.deleted);
}

export async function get(table, id) {
  if (!id) return null;
  const db = await openDB();
  const row = await reqP(db.transaction(table).objectStore(table).get(id));
  return row || null;
}

export async function getMany(table, ids) {
  const db = await openDB();
  const store = db.transaction(table).objectStore(table);
  const out = await Promise.all(ids.map((id) => reqP(store.get(id))));
  return out.filter(Boolean);
}

/* ---------- writes (local, queued for sync) ---------- */

export async function saveMany(table, rows) {
  if (!rows.length) return [];
  const now = nowISO();
  const db = await openDB();
  const tx = db.transaction([table, 'outbox'], 'readwrite');
  const out = rows.map((r) => pick(table, { ...r, id: r.id || uuid(), updated_at: now }));
  for (const r of out) {
    tx.objectStore(table).put(r);
    tx.objectStore('outbox').put({ key: `${table}:${r.id}`, table, id: r.id, queued_at: now });
  }
  await txDone(tx);
  emit('local-write', { table });
  return out;
}

export async function save(table, row) {
  return (await saveMany(table, [row]))[0];
}

export async function remove(table, id) {
  const row = await get(table, id);
  if (!row) return null;
  return save(table, { ...row, deleted: true });
}

export async function removeMany(table, rows) {
  return saveMany(table, rows.map((r) => ({ ...r, deleted: true })));
}

/** Seed rows: inserted only when the id is not present yet, with their fixed updated_at. */
export async function insertSeed(table, rows) {
  const db = await openDB();
  const existing = new Set((await reqP(db.transaction(table).objectStore(table).getAllKeys())) || []);
  const fresh = rows.filter((r) => !existing.has(r.id)).map((r) => pick(table, r));
  if (!fresh.length) return 0;
  const tx = db.transaction([table, 'outbox'], 'readwrite');
  for (const r of fresh) {
    tx.objectStore(table).put(r);
    tx.objectStore('outbox').put({ key: `${table}:${r.id}`, table, id: r.id, queued_at: r.updated_at });
  }
  await txDone(tx);
  return fresh.length;
}

/* ---------- sync support ---------- */

/** Apply pulled rows with last-write-wins on updated_at. Returns how many changed locally. */
export async function applyRemote(table, rows) {
  if (!rows.length) return 0;
  const db = await openDB();
  const rtx = db.transaction([table, 'outbox']);
  const locals = await Promise.all(rows.map((r) => reqP(rtx.objectStore(table).get(r.id))));
  const pending = await Promise.all(rows.map((r) => reqP(rtx.objectStore('outbox').get(`${table}:${r.id}`))));
  const toPut = [];
  const outboxDrop = [];
  rows.forEach((r, i) => {
    const local = locals[i];
    if (!local || ts(r.updated_at) > ts(local.updated_at)) {
      toPut.push(pick(table, r));
      if (pending[i]) outboxDrop.push(pending[i].key);
    }
  });
  if (!toPut.length) return 0;
  const wtx = db.transaction([table, 'outbox'], 'readwrite');
  for (const r of toPut) wtx.objectStore(table).put(r);
  for (const k of outboxDrop) wtx.objectStore('outbox').delete(k);
  await txDone(wtx);
  return toPut.length;
}

export async function outboxAll() {
  const db = await openDB();
  return reqP(db.transaction('outbox').objectStore('outbox').getAll());
}

export async function outboxCount() {
  const db = await openDB();
  return reqP(db.transaction('outbox').objectStore('outbox').count());
}

/** Remove pushed outbox entries, but keep any that were re-queued while the push ran. */
export async function outboxAck(entries) {
  if (!entries.length) return;
  const db = await openDB();
  const rtx = db.transaction('outbox');
  const current = await Promise.all(entries.map((e) => reqP(rtx.objectStore('outbox').get(e.key))));
  const wtx = db.transaction('outbox', 'readwrite');
  entries.forEach((e, i) => {
    const c = current[i];
    if (c && c.queued_at === e.queued_at) wtx.objectStore('outbox').delete(e.key);
  });
  await txDone(wtx);
}

/* ---------- meta (local only) ---------- */

export async function getMeta(key, fallback = null) {
  const db = await openDB();
  const row = await reqP(db.transaction('meta').objectStore('meta').get(key));
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  const db = await openDB();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  await txDone(tx);
}

/* ---------- photo blobs (local only until uploaded) ---------- */

export async function putBlob(rec) {
  const db = await openDB();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put(rec);
  await txDone(tx);
}

export async function getBlob(path) {
  if (!path) return null;
  const db = await openDB();
  return (await reqP(db.transaction('blobs').objectStore('blobs').get(path))) || null;
}

export async function deleteBlob(path) {
  const db = await openDB();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').delete(path);
  await txDone(tx);
}

export async function allBlobs() {
  const db = await openDB();
  return reqP(db.transaction('blobs').objectStore('blobs').getAll());
}
