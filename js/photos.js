// Photos: client-side compression, local blob storage until upload, display, and
// the 30-day meal photo cleanup that runs on every app open.

import { putBlob, getBlob, deleteBlob, all, saveMany } from './db.js';
import { configured, publicPhotoUrl, queueStorageDelete } from './sync.js';
import { h, emit, nowISO, ts, DAY_MS } from './util.js';

const MAX_EDGE = 1080;
const QUALITY = 0.7;
const MEAL_PHOTO_DAYS = 30;

/** Shrinks any image file to a JPEG with a long edge of at most 1080 px at quality 0.7. */
export async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image.'));
      i.src = url;
    });
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const hgt = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress the photo.'))), 'image/jpeg', QUALITY)
    );
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const mealPhotoPath = (id) => `meals/${id}.jpg`;
export const progressPhotoPath = (id) => `progress/${id}.jpg`;

/** Keeps the compressed blob in IndexedDB until the sync engine uploads it. */
export async function storePhoto(path, blob) {
  await putBlob({ path, blob, uploaded: false, created_at: nowISO() });
  emit('local-write', { table: 'blobs' });
}

const objectUrls = new Map();

/** Best source for a photo: the local blob, else the public bucket URL, else null. */
export async function photoSrc(path) {
  if (!path) return null;
  if (objectUrls.has(path)) return objectUrls.get(path);
  const rec = await getBlob(path);
  if (rec && rec.blob) {
    const u = URL.createObjectURL(rec.blob);
    objectUrls.set(path, u);
    return u;
  }
  if (configured) return publicPhotoUrl(path);
  return null;
}

function forgetObjectUrl(path) {
  const u = objectUrls.get(path);
  if (u) {
    URL.revokeObjectURL(u);
    objectUrls.delete(path);
  }
}

/** An <img> that fills itself in; shows a plain placeholder when the photo is unavailable. */
export function photoImg(path, cls = 'photo', alt = 'Photo') {
  const img = h('img', { class: cls, alt, loading: 'lazy', decoding: 'async' });
  img.crossOrigin = 'anonymous';
  photoSrc(path).then((src) => {
    if (src) img.src = src;
    else img.replaceWith(h('div', { class: cls + ' photo-missing' }, 'No photo'));
  });
  img.addEventListener('error', () => {
    img.replaceWith(h('div', { class: cls + ' photo-missing' }, 'Photo not available offline'));
  });
  return img;
}

/** Deletes a photo locally and, when syncing, from storage on the next sync. */
export async function deletePhoto(path) {
  if (!path) return;
  forgetObjectUrl(path);
  await deleteBlob(path);
  await queueStorageDelete(path);
}

/** Runs on every app open: meal photos older than 30 days are deleted; the meal record stays. */
export async function cleanupOldMealPhotos() {
  const cutoff = Date.now() - MEAL_PHOTO_DAYS * DAY_MS;
  const meals = await all('meals');
  const expired = meals.filter((m) => m.photo_path && !m.photo_deleted_at && ts(m.logged_at) < cutoff);
  if (!expired.length) return 0;
  for (const m of expired) await deletePhoto(m.photo_path);
  const now = nowISO();
  await saveMany('meals', expired.map((m) => ({ ...m, photo_deleted_at: now })));
  return expired.length;
}
