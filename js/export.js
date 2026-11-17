// Export: one zip holding data.json (every table) plus one CSV per table.

import { all, TABLES, COLUMNS, getMeta } from './db.js';
import { toast, todayStr } from './util.js';

function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, columns) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export async function buildExport() {
  if (!window.JSZip) throw new Error('The zip library has not loaded. Open the app once while online, then try again.');
  const zip = new window.JSZip();
  const data = { app: 'workout-tracker', exported_at: new Date().toISOString(), units: 'lb', tables: {} };
  for (const t of TABLES) {
    const rows = await all(t, { includeDeleted: true });
    data.tables[t] = rows;
    zip.file(`${t}.csv`, toCSV(rows, COLUMNS[t]));
  }
  // Settings kept on this device only (height for the body profile).
  data.local = { body_profile: await getMeta('body_profile', null) };
  zip.file('data.json', JSON.stringify(data, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function exportAll() {
  let blob;
  try {
    blob = await buildExport();
  } catch (e) {
    toast(e.message || 'Export failed.');
    return;
  }
  const name = `workout-tracker-export-${todayStr()}.zip`;
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/zip' }) : null;
  // On an installed iPhone app the share sheet is the reliable way to save a file.
  const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (standalone && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('Export downloaded');
}
