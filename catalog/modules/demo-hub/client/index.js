// demo-hub - client entry. Displayed as "Sync Test Hub"; the id stays
// `demo-hub` because it is the API path, the view ids and the CSS prefix.
//
// Two views over one file in the team data repo:
// data-sub-repositories/ds-data/demo-hub/note.md
//
//   demo-hub-note    - the test field: type, save, see who saved it last and
//                      whether the change has already travelled to the team
//   demo-hub-history - "Sync Test Hub history": every version of that file
//                      that went through a sync, with the author of each
//
// The point of the module is the round trip: save here, then run the sync from
// the top bar and watch the file travel through the encrypted mirror.

let _deps = null;

const ENDPOINT = '/ds-data';
const HISTORY_ENDPOINT = '/history';

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/demo-hub') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtDate(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown date' : d.toLocaleString('en-GB');
}

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' kB';
}

// The author line every table cell and every meta line shares. `null` is a
// version saved before the module stamped a header into the file - a real
// state on this disk, so it gets a word rather than an empty cell.
function authorName(author) {
  if (!author || !author.name) return 'unknown';
  return author.name;
}

function authorHint(author) {
  if (!author) return 'This version has no author header - it was saved before the module started writing one.';
  if (author.source === 'gitlab') return 'Person read from the name of the GitLab token this app connects with.';
  if (author.source === 'git') return 'Person from the local git configuration - no GitLab token.';
  if (author.source === 'os') return 'Operating system account name - no GitLab token and no git configuration.';
  return 'Unknown identity source.';
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('The server answered ' + res.status);
  return res.json();
}

function renderMissingRepo() {
  return `
    <div class="ds-callout ds-callout--warning">
      <div>The <code>ds-data</code> repository is not cloned on this computer, so there is nowhere
      to save the file. Clone it from the sync panel in the top bar and come back here.</div>
    </div>`;
}

function renderError(message) {
  return `
    <div class="ds-callout ds-callout--danger">
      <div>Could not read the module data: ${esc(message)}</div>
    </div>`;
}

// What the module is, in one box, on both views.
function renderIntro(extra) {
  return `
    <div class="ds-callout ds-callout--info demo-hub-intro">
      <div>
        <strong>This module is for testing how sync works.</strong>
        Nothing here is production - the module saves one file in the team data repository
        and shows what happens to it next. ${extra || ''}
      </div>
    </div>`;
}

// ── View: Note ────────────────────────────────────────────────────────────────

function renderSyncMeta(state) {
  const sync = state.lastSync;
  if (!sync) return '';

  const rows = [];

  if (sync.error) {
    rows.push(`<div class="demo-hub-meta-row demo-hub-meta-row--muted">${esc(sync.error)}</div>`);
  } else if (sync.commit) {
    rows.push(`
      <div class="demo-hub-meta-row">
        <span class="demo-hub-meta-key">Author of the previous sync</span>
        <span class="demo-hub-meta-val" title="${esc(authorHint(sync.author))}">
          <strong>${esc(authorName(sync.author))}</strong>
          ${sync.author && sync.author.person_slug ? `<code>${esc(sync.author.person_slug)}</code>` : ''}
        </span>
      </div>
      <div class="demo-hub-meta-row">
        <span class="demo-hub-meta-key">When it reached the team</span>
        <span class="demo-hub-meta-val">${esc(fmtDate(sync.date))} · commit <code>${esc(sync.commit)}</code></span>
      </div>`);
  } else {
    rows.push(`
      <div class="demo-hub-meta-row demo-hub-meta-row--muted">
        This note has not been through a single sync yet - after saving, send it with the sync
        panel in the top bar.
      </div>`);
  }

  if (state.lastSave && state.lastSave.name) {
    rows.push(`
      <div class="demo-hub-meta-row">
        <span class="demo-hub-meta-key">Last save on this computer</span>
        <span class="demo-hub-meta-val" title="${esc(authorHint(state.lastSave))}">
          <strong>${esc(authorName(state.lastSave))}</strong> · ${esc(fmtDate(state.lastSave.date))}
        </span>
      </div>`);
  }

  const pending = sync.pending;
  if (pending) {
    rows.push(`
      <div class="demo-hub-meta-row">
        <span class="demo-hub-meta-key">State</span>
        <span class="demo-hub-meta-val">
          <span class="ds-badge ds-badge--yellow">To send</span>
          The content on this computer differs from what the team sees.
        </span>
      </div>`);
  } else if (sync.commit) {
    rows.push(`
      <div class="demo-hub-meta-row">
        <span class="demo-hub-meta-key">State</span>
        <span class="demo-hub-meta-val">
          <span class="ds-badge ds-badge--green">Synced</span>
          The team sees exactly this content.
        </span>
      </div>`);
  }

  return `<div class="demo-hub-meta-block" data-demo-hub-sync>${rows.join('')}</div>`;
}

function renderNote(root, state) {
  if (!state.available) { root.innerHTML = renderIntro() + renderMissingRepo(); return; }

  root.innerHTML = `
    ${renderIntro('The text typed below <strong>is synced</strong>: once saved it lands in a file in the team data directory, and the sync panel in the top bar sends it to everyone - encrypted, file name included.')}
    <div class="ds-card demo-hub-card">
      <h3 class="demo-hub-section-title">Note</h3>
      <p class="demo-hub-hint">Type anything and save - the text goes to the file
        <code>${esc(state.file)}</code>, and the module adds the name of the person saving it
        to the file header by itself. That way the <strong>History</strong> tab shows who made
        which change.</p>
      <label class="demo-hub-field">
        <span class="demo-hub-label">Note text</span>
        <textarea class="ds-input demo-hub-textarea" rows="8"
          placeholder="Test note - checking a save to ds-data..."
          data-demo-hub-text></textarea>
      </label>
      <div class="ds-actions">
        <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-demo-hub-save>Save to ds-data</button>
        <span class="demo-hub-meta" data-demo-hub-meta>Saved on disk: ${esc(fmtDate(state.updatedAt))}</span>
      </div>
      ${renderSyncMeta(state)}
    </div>
    <div class="ds-card demo-hub-card">
      <h3 class="demo-hub-section-title">How to check it</h3>
      <ol class="demo-hub-steps">
        <li>Save the note here - the file is created at once, before git is involved.</li>
        <li>Open the sync panel in the top bar and send the changes. Mission Deck encrypts
          the data directory and pushes it to the team repository.</li>
        <li>Go back to the <strong>History</strong> tab - a new row with your name appears.</li>
        <li>On another computer, fetch the changes with the same panel and see the same text.</li>
      </ol>
    </div>`;

  const textarea = root.querySelector('[data-demo-hub-text]');
  const saveBtn = root.querySelector('[data-demo-hub-save]');
  const meta = root.querySelector('[data-demo-hub-meta]');
  textarea.value = state.text || '';

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(_api(ENDPOINT), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textarea.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        _toast('danger', 'Save failed', data.message || ('The server answered ' + res.status));
        return;
      }
      meta.textContent = 'Saved on disk: ' + fmtDate(data.updatedAt);
      const block = root.querySelector('[data-demo-hub-sync]');
      if (block) block.outerHTML = renderSyncMeta(data);
      _toast('success', 'Saved to ds-data', data.file + ' - sync to send the change to the team.');
    } catch (e) {
      _toast('danger', 'Save failed', e.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.removeAttribute('aria-busy');
    }
  });
}

// ── View: History ────────────────────────────────────────────────────────────

function historyRowsHtml(state) {
  const rows = [];
  let index = (state.rows || []).length + (state.pending ? 1 : 0);

  if (state.pending) {
    rows.push(`
      <tr class="demo-hub-row--pending">
        <td>${index--}</td>
        <td>${esc(fmtDate(state.pending.author && state.pending.author.date))}</td>
        <td title="${esc(authorHint(state.pending.author))}">${esc(authorName(state.pending.author))}</td>
        <td><span class="ds-badge ds-badge--yellow">To send</span></td>
        <td class="demo-hub-cell-muted">only on this computer</td>
        <td>${esc(state.pending.chars)}</td>
      </tr>`);
  }

  for (const row of (state.rows || [])) {
    rows.push(`
      <tr>
        <td>${index--}</td>
        <td>${esc(fmtDate(row.date))}</td>
        <td title="${esc(authorHint(row.author))}">${esc(authorName(row.author))}</td>
        <td><span class="ds-badge ds-badge--green">Synced</span></td>
        <td><code>${esc(row.commit)}</code></td>
        <td>${row.chars === null ? '?' : esc(row.chars)}</td>
      </tr>`);
  }

  return rows.join('');
}

function renderHistory(root, state) {
  if (!state.available) { root.innerHTML = renderIntro() + renderMissingRepo(); return; }

  const rows = historyRowsHtml(state);
  const files = (state.files || []).map(f => `
    <tr>
      <td><code>${esc(f.name)}</code></td>
      <td>${esc(fmtSize(f.size))}</td>
      <td>${esc(fmtDate(f.mtime))}</td>
    </tr>`).join('');

  root.innerHTML = `
    ${renderIntro('Below is every version of the note that went through a sync - the <strong>Who</strong> column comes from the header the module writes into the file on save.')}
    ${state.error ? `<div class="ds-callout ds-callout--warning"><div>${esc(state.error)}</div></div>` : ''}
    <div class="ds-card demo-hub-card demo-hub-card--wide">
      <h3 class="demo-hub-section-title">Changes to <code>${esc(state.file)}</code></h3>
      ${rows
    ? `<div class="demo-hub-table-wrap">
             <table class="demo-hub-table">
               <thead><tr>
                 <th>#</th><th>When</th><th>Who</th><th>State</th><th>Commit</th><th>Characters</th>
               </tr></thead>
               <tbody>${rows}</tbody>
             </table>
           </div>
           <p class="demo-hub-hint">The history comes from the encrypted mirror of the repository: every
             commit that touched this file is decrypted to read the author header.
             Git alone cannot tell - every sync commit is signed as
             <code>Mission Deck</code>.</p>`
    : '<p class="demo-hub-empty">This file has no change in its history yet. Go to the Note tab, save anything and sync.</p>'}
    </div>
    <div class="ds-card demo-hub-card">
      <h3 class="demo-hub-section-title">Module files in ds-data</h3>
      <p class="demo-hub-hint">The <code>${esc(state.dir)}</code> directory in the team data repository.</p>
      ${files
    ? `<table class="demo-hub-table">
             <thead><tr><th>File</th><th>Size</th><th>Modified</th></tr></thead>
             <tbody>${files}</tbody>
           </table>`
    : '<p class="demo-hub-empty">The module has not saved any file yet.</p>'}
    </div>`;
}

// ── Views ────────────────────────────────────────────────────────────────────

function makeView(rootId, url, paint) {
  return {
    init(deps) { _deps = deps || _deps; },
    async render() {
      const root = document.getElementById(rootId);
      if (!root) return;
      root.innerHTML = '<p class="demo-hub-empty">Loading...</p>';
      try {
        paint(root, await fetchJson(_api(url)));
      } catch (e) {
        root.innerHTML = renderError(e.message);
      }
    },
  };
}

export const views = {
  'demo-hub-note': makeView('demo-hub-note-root', ENDPOINT, renderNote),
  'demo-hub-history': makeView('demo-hub-history-root', HISTORY_ENDPOINT, renderHistory),
};
