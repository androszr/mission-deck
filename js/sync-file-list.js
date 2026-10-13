// -- Mission Deck - js/sync-file-list.js --------------------------------
// Pure rendering helpers (no document access) for one flat per-file sync list:
// path, "local" / "on the server" dates and the previous app's "newer by X
// h" hint. Shared by js/topbar-sync-preview.js (the topbar quick preview)
// and js/module-sync-bar.js (the in-page module badge), so the two surfaces
// can never drift on date formatting or the newer-by wording. Zero
// dependencies beyond escHtml - no fetch, no Date.now() default, every date
// comparison takes its inputs from the caller.

import { escHtml } from './utils.js';

/** Below this gap between the local and the last-known server date, the two
 * are close enough that highlighting "newer by X h" would be noise. */
export const SYNC_NEWER_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * @param {string|null} iso
 * @returns {string|null}
 */
export function formatSyncDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The previous app's "newer by X h" hint: null whenever there is no
 * server date to compare against, or the local copy is not the newer one.
 * @param {string|null} localAt
 * @param {string|null} remoteAt
 * @returns {string|null}
 */
export function syncNewerByLabel(localAt, remoteAt) {
  if (!localAt || !remoteAt) return null;
  const l = new Date(localAt).getTime();
  const r = new Date(remoteAt).getTime();
  if (isNaN(l) || isNaN(r) || r >= l) return null;
  const diffMs = l - r;
  if (diffMs < SYNC_NEWER_THRESHOLD_MS) return null;
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  return hours < 24 ? `newer by ${hours} h` : `newer by ${Math.round(hours / 24)} ${Math.round(hours / 24) === 1 ? 'day' : 'days'}`;
}

/**
 * One file row: path plus the local/on the server pair and the newer-by hint.
 * Same markup class names (`tsp-*`) both callers style, so one CSS block in
 * styles.css covers both surfaces.
 * @param {{path: string|null, localAt: string|null, onRemote?: boolean, remoteAt: string|null}} f
 * @returns {string}
 */
export function syncFileRowHtml(f) {
  const local = formatSyncDate(f.localAt);
  const remote = f.onRemote === false ? 'none (new file)' : (formatSyncDate(f.remoteAt) || '-');
  const newer = f.onRemote === false ? null : syncNewerByLabel(f.localAt, f.remoteAt);
  return `<div class="tsp-item">
    <div class="tsp-path">${escHtml(f.path || '(unknown path)')}</div>
    <div class="tsp-meta">
      <span class="tsp-meta-cell"><span class="tsp-meta-label">local</span> ${escHtml(local || '-')}</span>
      <span class="tsp-meta-cell"><span class="tsp-meta-label">on the server</span> ${escHtml(remote)}</span>
    </div>
    ${newer ? `<div class="tsp-newer">${escHtml(newer)}</div>` : ''}
  </div>`;
}
