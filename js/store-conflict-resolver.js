// ── Mission Deck — js/store-conflict-resolver.js ──────────────────────
// Conflict-preview UI for the sync-log modal (#sync-log-modal), used from the
// conflict-markers branch of js/sub-repo-sync-stream.js. Two pieces:
//  - renderConflictDiff(handle, repoId): per-file preview of the local
//    changes that "Accept remote" would discard (POST /api/data/<repoId>/conflict-diff,
//    or the legacy /api/data-tier-0/conflict-diff when repoId is the default).
//    The backend returns the raw `ours`/`theirs` plaintext, not a ready-made
//    diff, so the line-level diff below runs entirely client-side.
//  - a manual, hand-edited resolution path that writes the result back
//    through .../write-resolved for the same repoId - no assistant of any
//    kind reviews or proposes the merged content; the human writes it.

import { escHtml } from './utils.js';
import { setSyncLogExtra } from './sync-log-modal.js';
import { fetchConflictDiff, writeResolved } from './data-tier-0-sync.js';

// ── Diff preview ─────────────────────────────────────────────────────────────

export function _diffLineClass(line) {
  if (line.startsWith('+++ ') || line.startsWith('--- ')) return 'slm-diff-meta';
  if (line.startsWith('+')) return 'slm-diff-add';
  if (line.startsWith('-')) return 'slm-diff-del';
  return 'slm-diff-ctx';
}

export function renderDiffPre(diffText) {
  return String(diffText || '').split('\n')
    .map(line => `<span class="slm-diff-line ${_diffLineClass(line)}">${escHtml(line) || '&nbsp;'}</span>`)
    .join('');
}

// A single conflict file is small enough that a full O(n*m) longest-common-
// subsequence diff is instant; the size guard below only protects against a
// pathological huge file falling into this path by accident.
const _MAX_DIFF_CELLS = 500000;

function _lcsDiffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push(' ' + a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push('-' + a[i]); i++; }
    else { lines.push('+' + b[j]); j++; }
  }
  while (i < n) { lines.push('-' + a[i]); i++; }
  while (j < m) { lines.push('+' + b[j]); j++; }
  return lines;
}

// Builds a small unified-diff-shaped text from the two plaintext sides the
// server sends (`ours` = local working copy, `theirs` = HEAD/incoming). Too
// large a pair falls back to two plain panes instead of a line diff.
function _buildDiffText(path, ours, theirs) {
  const oursLines = String(ours || '').split('\n');
  const theirsLines = String(theirs || '').split('\n');
  const header = [`--- ${path} (local)`, `+++ ${path} (remote)`];
  if (oursLines.length * theirsLines.length > _MAX_DIFF_CELLS) {
    return header.concat(
      ['--- local ---'],
      oursLines.map(l => '-' + l),
      ['--- remote ---'],
      theirsLines.map(l => '+' + l),
    ).join('\n');
  }
  return header.concat(_lcsDiffLines(oursLines, theirsLines)).join('\n');
}

// Fetches the per-file ours/theirs preview and renders it into #slm-extra as
// a collapsible <details> per file, plus a hand-edit box that writes the
// result back through write-resolved. Called right after the step log is
// rendered so the diff is visible before the user clicks any resolve action.
export async function renderConflictDiff(handle, repoId) {
  const wrap = document.createElement('div');
  wrap.className = 'slm-conflict-diff';
  wrap.innerHTML = '<p class="ds-hint">Loading the diff preview...</p>';
  setSyncLogExtra(handle, wrap);

  let data;
  try {
    data = await fetchConflictDiff(repoId);
  } catch {
    wrap.innerHTML = '<div class="ds-callout ds-callout--warning"><div>Could not fetch the diff preview.</div></div>';
    return;
  }
  if (!data.ok) {
    wrap.innerHTML = `<div class="ds-callout ds-callout--warning"><div>${escHtml(data.message || 'Could not fetch the diff preview.')}</div></div>`;
    return;
  }

  const files = Array.isArray(data.files) ? data.files : [];
  if (!files.length) {
    wrap.innerHTML = '<p class="ds-hint">No conflicted files to show.</p>';
    return;
  }

  wrap.innerHTML = '';
  for (const f of files) {
    const details = document.createElement('details');
    details.className = 'slm-diff-file';
    const summary = document.createElement('summary');
    summary.textContent = `${f.path} - local changes that would be lost`;
    details.appendChild(summary);

    if (f.error) {
      const note = document.createElement('div');
      note.className = 'ds-callout ds-callout--warning';
      note.innerHTML = `<div>${escHtml(f.error === 'decrypt-failed'
        ? 'Could not decrypt this file.'
        : 'Could not load this file.')}</div>`;
      details.appendChild(note);
    } else {
      const pre = document.createElement('pre');
      pre.className = 'slm-diff';
      pre.innerHTML = renderDiffPre(_buildDiffText(f.path, f.ours, f.theirs));
      details.appendChild(pre);
      details.appendChild(_buildManualResolveBox(f, repoId, details));
    }
    wrap.appendChild(details);
  }
}

// ── Manual resolution (no AI) ────────────────────────────────────────────────
// Lets the user edit the file content by hand and write it back through
// write-resolved for the given repoId. This is the entire "resolve" surface
// for a conflicted file besides "Accept remote" - there is deliberately no
// proposal-review step.
function _buildManualResolveBox(file, repoId, detailsEl) {
  const box = document.createElement('div');

  const label = document.createElement('label');
  label.className = 'ds-hint';
  label.textContent = 'Resolve by hand: edit the content below and save.';
  label.style.display = 'block';
  label.style.marginTop = '8px';

  const textarea = document.createElement('textarea');
  textarea.className = 'ds-textarea';
  textarea.rows = 8;
  textarea.style.width = '100%';
  textarea.style.marginTop = '4px';
  textarea.value = file.theirs !== null && file.theirs !== undefined ? file.theirs : (file.ours || '');

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'ds-btn ds-btn--secondary ds-btn--sm';
  saveBtn.textContent = 'Save the hand-resolved file';
  saveBtn.style.marginTop = '8px';

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const orig = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    try {
      const data = await writeResolved([{ path: file.path, content: textarea.value }], repoId);
      if (data.ok) {
        detailsEl.open = false;
        const done = document.createElement('div');
        done.className = 'ds-callout ds-callout--success';
        done.innerHTML = '<div>Saved. Click "Send" again to finish the sync.</div>';
        box.replaceChildren(done);
      } else {
        const errText = Array.isArray(data.errors) && data.errors.length
          ? data.errors.map(e => `${e.path}: ${e.error}`).join(', ')
          : (data.message || 'Saving failed.');
        const errEl = document.createElement('div');
        errEl.className = 'ds-callout ds-callout--warning';
        errEl.innerHTML = `<div>${escHtml(errText)}</div>`;
        box.appendChild(errEl);
      }
    } catch {
      const errEl = document.createElement('div');
      errEl.className = 'ds-callout ds-callout--warning';
      errEl.innerHTML = '<div>Could not connect to the server.</div>';
      box.appendChild(errEl);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = orig;
    }
  });

  box.appendChild(label);
  box.appendChild(textarea);
  box.appendChild(saveBtn);
  return box;
}
