// Sync engine. Runs on load, when the device comes back online, every 60 s while
// online, and shortly after local writes. Order: push the outbox (upsert by id,
// last write wins on updated_at), upload queued photos, delete expired photos
// from storage, then pull rows changed since the last pull for each table.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import {
  TABLES, OPTIONAL_COLUMNS, pick, getMany, outboxAll, outboxAck, outboxCount, applyRemote,
  getMeta, setMeta, allBlobs, deleteBlob,
} from './db.js';
import { on, emit, h, ts } from './util.js';

export const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const PHOTO_BUCKET = 'photos';
export const PHOTO_CACHE = 'wt-photos';

const CHUNK = 100; // ids per request; keeps the query URL short
const PAGE = 1000;
const PULL_OVERLAP_MS = 5 * 60 * 1000;
const STORAGE_DELETES_KEY = 'storage_deletes';

let client = null;
let running = null;
let rerun = false;
let debounce = null;
let state = { status: configured ? 'idle' : 'local', pending: 0, error: '', lastSync: null };
let statusEl = null;

export function publicPhotoUrl(path) {
  return `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

export async function getClient() {
  if (!configured) return null;
  if (!client) {
    const mod = await import(SUPABASE_JS_URL);
    client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

/* ---------- status indicator ---------- */

export function getState() {
  return { ...state };
}

/** A sync error in plain words. */
export function plainError(msg) {
  const m = String(msg || '');
  if (!m) return '';
  if (/failed to fetch|networkerror|load failed|network|timed? ?out|offline/i.test(m)) return 'Could not reach the server. Check your connection and try again.';
  if (/jwt|api ?key|invalid key|401|403|permission denied|row-level security/i.test(m)) return 'The server refused the request. Check the Supabase key in config.js.';
  if (/does not exist|could not find|schema cache/i.test(m)) return 'The server is missing a table or column. Run schema.sql and the files in migrations/ in Supabase.';
  return `Something went wrong: ${m}`;
}

function setState(patch) {
  state = { ...state, ...patch };
  renderStatus();
  emit('sync-state', getState());
}

async function pendingCount() {
  const n = await outboxCount();
  if (!configured) return n;
  const blobs = await allBlobs();
  const deletes = (await getMeta(STORAGE_DELETES_KEY, [])) || [];
  return n + blobs.filter((b) => !b.uploaded).length + deletes.length;
}

export async function refreshPending() {
  setState({ pending: await pendingCount() });
}

function label() {
  const s = state.status;
  if (s === 'local') return 'Local only';
  if (!navigator.onLine) return `Offline (${state.pending} pending)`;
  if (s === 'syncing') return 'Syncing';
  if (s === 'error') return 'Error';
  if (state.pending > 0) return `${state.pending} pending`;
  return 'Synced';
}

function dotClass() {
  const s = state.status;
  if (s === 'local') return 'dot-local';
  if (!navigator.onLine) return 'dot-offline';
  if (s === 'syncing') return 'dot-syncing';
  if (s === 'error') return 'dot-error';
  return state.pending > 0 ? 'dot-offline' : 'dot-synced';
}

function renderStatus() {
  if (!statusEl) return;
  // The dot alone means all is well; anything that needs attention also shows its words.
  const quiet = state.status === 'local' || (navigator.onLine && state.status !== 'error' && state.pending === 0);
  statusEl.classList.add('sync-status');
  statusEl.classList.toggle('show-label', !quiet);
  statusEl.replaceChildren(h('span', { class: 'dot ' + dotClass() }), h('span', { class: 'sync-label' }, label()));
  statusEl.title = state.error ? `Sync error: ${state.error}` : label();
  statusEl.setAttribute('aria-label', `Sync: ${label()}`);
}

export function mountStatus(el) {
  statusEl = el;
  statusEl.addEventListener('click', () => {
    if (configured && navigator.onLine) syncNow();
  });
  renderStatus();
}

/* ---------- engine ---------- */

export function start() {
  on('local-write', () => {
    refreshPending();
    if (!configured) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => { if (navigator.onLine) syncNow(); }, 1500);
  });
  window.addEventListener('online', () => { renderStatus(); syncNow(); });
  window.addEventListener('offline', () => renderStatus());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) syncNow();
  });
  setInterval(() => { if (navigator.onLine) syncNow(); }, 60000);
  getMeta('last_sync').then((t) => { if (t && !state.lastSync) setState({ lastSync: t }); }).catch(() => {});
  refreshPending().then(() => syncNow());
}

/** Runs one sync pass. Concurrent calls share the running pass and schedule one more. */
export async function syncNow() {
  if (!configured) {
    await refreshPending();
    return;
  }
  if (!navigator.onLine) {
    await refreshPending();
    return;
  }
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    setState({ status: 'syncing', error: '' });
    try {
      const sb = await getClient();
      await pushOutbox(sb);
      await uploadPhotos(sb);
      await purgeStorage(sb);
      const changed = await pullAll(sb);
      const lastSync = new Date().toISOString();
      setState({ status: 'idle', lastSync, pending: await pendingCount() });
      setMeta('last_sync', lastSync).catch(() => {});
      if (changed) emit('remote-change', { changed });
    } catch (err) {
      console.warn('Sync failed', err);
      setState({ status: navigator.onLine ? 'error' : 'idle', error: err && err.message ? err.message : String(err), pending: await pendingCount() });
    }
  })();
  try {
    await running;
  } finally {
    running = null;
    if (rerun) {
      rerun = false;
      setTimeout(() => syncNow(), 0);
    }
  }
}

/** Tables whose optional columns the server does not have (this visit). */
const missingCols = new Set();

function missingOptional(table, error) {
  const cols = OPTIONAL_COLUMNS[table] || [];
  const msg = `${error.message || ''} ${error.details || ''}`;
  return cols.some((c) => msg.includes(c)) && /column|schema cache/i.test(msg);
}

function withoutMissing(table, row) {
  if (!missingCols.has(table)) return row;
  const o = { ...row };
  for (const c of OPTIONAL_COLUMNS[table] || []) delete o[c];
  return o;
}

async function pushOutbox(sb) {
  const entries = await outboxAll();
  if (!entries.length) return;
  const byTable = new Map();
  for (const e of entries) {
    if (!byTable.has(e.table)) byTable.set(e.table, []);
    byTable.get(e.table).push(e);
  }
  for (const table of TABLES) {
    const list = byTable.get(table);
    if (!list) continue;
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      const ids = chunk.map((e) => e.id);
      const rows = await getMany(table, ids);
      if (rows.length) {
        // Last write wins: never overwrite a newer row that another device already pushed.
        const { data: remote, error: selErr } = await sb.from(table).select('id,updated_at').in('id', ids);
        if (selErr) throw new Error(`${table}: ${selErr.message}`);
        const remoteTs = new Map((remote || []).map((r) => [r.id, ts(r.updated_at)]));
        const toSend = rows
          .filter((r) => !remoteTs.has(r.id) || remoteTs.get(r.id) < ts(r.updated_at))
          .map((r) => withoutMissing(table, pick(table, r)));
        if (toSend.length) {
          let { error } = await sb.from(table).upsert(toSend, { onConflict: 'id' });
          if (error && missingOptional(table, error)) {
            // The server has not run the migration yet: push without the new columns.
            missingCols.add(table);
            ({ error } = await sb.from(table).upsert(toSend.map((r) => withoutMissing(table, r)), { onConflict: 'id' }));
          }
          if (error) throw new Error(`${table}: ${error.message}`);
        }
      }
      await outboxAck(chunk);
    }
  }
}

async function uploadPhotos(sb) {
  const blobs = (await allBlobs()).filter((b) => !b.uploaded);
  for (const rec of blobs) {
    const { error } = await sb.storage.from(PHOTO_BUCKET).upload(rec.path, rec.blob, {
      upsert: true,
      contentType: 'image/jpeg',
      cacheControl: '31536000',
    });
    if (error) throw new Error(`Photo upload: ${error.message}`);
    // Keep an offline copy in the photo cache, then drop the IndexedDB blob.
    try {
      const cache = await caches.open(PHOTO_CACHE);
      await cache.put(publicPhotoUrl(rec.path), new Response(rec.blob, { headers: { 'Content-Type': 'image/jpeg' } }));
    } catch (e) {
      /* the photo still loads from the bucket URL */
    }
    await deleteBlob(rec.path);
    emit('photo-uploaded', { path: rec.path });
  }
}

/** Queue a storage path for deletion on the next sync. */
export async function queueStorageDelete(path) {
  if (!configured || !path) return;
  const list = (await getMeta(STORAGE_DELETES_KEY, [])) || [];
  if (!list.includes(path)) list.push(path);
  await setMeta(STORAGE_DELETES_KEY, list);
  try {
    const cache = await caches.open(PHOTO_CACHE);
    await cache.delete(publicPhotoUrl(path));
  } catch (e) {
    /* nothing cached */
  }
}

async function purgeStorage(sb) {
  const list = (await getMeta(STORAGE_DELETES_KEY, [])) || [];
  if (!list.length) return;
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const { error } = await sb.storage.from(PHOTO_BUCKET).remove(chunk);
    if (error) throw new Error(`Photo delete: ${error.message}`);
  }
  const now = (await getMeta(STORAGE_DELETES_KEY, [])) || [];
  await setMeta(STORAGE_DELETES_KEY, now.filter((p) => !list.includes(p)));
}

const ISO_TS = /^\d{4}-\d{2}-\d{2}T/;

/** Postgres returns "+00:00" and microseconds; store the same ISO shape the app writes. */
function normalize(row) {
  const o = { ...row };
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && ISO_TS.test(v)) {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) o[k] = new Date(t).toISOString();
    }
  }
  return o;
}

async function pullAll(sb) {
  let changed = 0;
  for (const table of TABLES) {
    let cursor = await getMeta(`pull:${table}`, '1970-01-01T00:00:00.000Z');
    // The first page looks back a little: rows stamped by the server (the RENPHO Shortcut)
    // can carry a time slightly behind this phone's clock. Re-pulled rows change nothing.
    let since = new Date(Math.max(0, ts(cursor) - PULL_OVERLAP_MS)).toISOString();
    for (;;) {
      const { data, error } = await sb
        .from(table)
        .select('*')
        .gt('updated_at', since)
        .order('updated_at', { ascending: true })
        .limit(PAGE);
      if (error) throw new Error(`${table}: ${error.message}`);
      if (!data || !data.length) break;
      const rows = data.map(normalize);
      changed += await applyRemote(table, rows);
      cursor = rows[rows.length - 1].updated_at;
      since = cursor;
      await setMeta(`pull:${table}`, cursor);
      if (data.length < PAGE) break;
    }
  }
  return changed;
}
