// ── Mission Deck — js/gitlab-activity.js ──────────────────────────────
// "GitLab activity" view: per-repo, per-person last activity derived from
// GitLab project access tokens (GET /api/gitlab-activity/data). Read-only —
// this view never mints, revokes or edits a token; that stays in
// Settings > Keys. Sub-page of Settings, reached from the topbar badge
// (js/topbar.js _renderActivityBadge) and from the "Team activity" card
// in Settings > Keys (js/settings.js _renderActivityLinkCard).

import { escHtml, initials } from './utils.js';
import { showToast } from './toast.js';
import { onSecretsChanged } from './secrets-events.js';
import { hasSkeleton } from './skeleton.js';

// ── module-local state ────────────────────────────────────────────────────────

let _activeRepoKey = null;
let _lastData = null;
let _loading = false;

// ── formatting helpers ────────────────────────────────────────────────────────

/** "DD.MM.YYYY HH:MM" in local time, or a dash. */
function _fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "DD.MM.YYYY", or a dash. */
function _fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Relative time: "just now" / "N min ago" / "N h ago" / "N days ago". */
function _relTime(iso) {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + ' min ago';
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return diffH + ' h ago';
  const diffD = Math.floor(diffH / 24);
  return diffD + ' days ago';
}

// ── status badges ─────────────────────────────────────────────────────────────

/**
 * A person's tokens are all dead when every one of them is either revoked or
 * already past its own `expires_at`. `person.revoked` (from the backend's
 * `_activityGroupPeople`) only AND-reduces the `revoked` flag, so the expiry
 * half of "expired or revoked" is checked here against `person.tokens`.
 * @param {object[]} tokens
 * @returns {boolean}
 */
function _allTokensDead(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return false;
  const now = Date.now();
  return tokens.every(t => {
    if (t.revoked) return true;
    const expMs = t.expires_at ? Date.parse(t.expires_at) : NaN;
    return Number.isFinite(expMs) && expMs <= now;
  });
}

/** @returns {{cls: string, label: string}} */
function _personStatus(person) {
  if (_allTokensDead(person.tokens)) return { cls: 'ds-badge--red', label: 'expired/revoked' };
  if (person.expiring_soon) return { cls: 'ds-badge--yellow', label: 'expires soon' };
  const lastMs = person.last_activity ? Date.parse(person.last_activity) : NaN;
  if (Number.isFinite(lastMs) && (Date.now() - lastMs) < 24 * 60 * 60 * 1000) {
    return { cls: 'ds-badge--green', label: 'active' };
  }
  return { cls: 'ds-badge--gray', label: 'inactive' };
}

// ── markup builders ────────────────────────────────────────────────────────────

function _buildScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return '<span class="ds-badge ds-badge--gray ds-badge--sm">none</span>';
  return scopes.map(s => `<span class="ds-badge ds-badge--gray ds-badge--sm">${escHtml(String(s))}</span>`).join(' ');
}

// Matches plan step 11's expandable-row spec exactly: name, created, expires,
// last used, scopes - no per-token status column (that judgment lives one
// level up, on the person row, via _personStatus).
function _buildTokenRows(person) {
  const tokens = Array.isArray(person.tokens) ? person.tokens : [];
  if (tokens.length === 0) {
    return '<tr><td colspan="5">No tokens</td></tr>';
  }
  return tokens.map(t => `<tr>
      <td>${escHtml(t.name || '')}</td>
      <td>${_fmtDate(t.created_at)}</td>
      <td>${t.expires_at ? _fmtDate(t.expires_at) : 'no expiry'}</td>
      <td>${t.last_used_at ? _fmtDateTime(t.last_used_at) : '—'}</td>
      <td>${_buildScopes(t.scopes)}</td>
    </tr>`).join('');
}

function _buildPersonRows(people) {
  if (!Array.isArray(people) || people.length === 0) {
    return '<tr><td colspan="4">Nobody has an access token in this repository</td></tr>';
  }
  return people.map(person => {
    const slug = escHtml(person.person_slug || '');
    const name = escHtml(person.display_name || person.person_slug || '?');
    const ini = escHtml(initials(person.display_name || person.person_slug || ''));
    const status = _personStatus(person);
    const lastTitle = person.last_activity ? escHtml(_fmtDateTime(person.last_activity)) : '';
    return `
      <tr>
        <td>
          <button type="button" class="ds-icon-btn ds-icon-btn--sm" data-ga-expand="${slug}" aria-label="Show tokens" title="Show/hide this person's tokens" style="vertical-align:middle;margin-right:6px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <span class="ds-badge ds-badge--gray ds-badge--sm" style="margin-right:6px">${ini}</span>${name}
        </td>
        <td title="${lastTitle}">${person.last_activity ? _relTime(person.last_activity) : 'no activity'}</td>
        <td>${person.token_count || 0}</td>
        <td><span class="ds-badge ${status.cls}">${escHtml(status.label)}</span></td>
      </tr>
      <tr data-ga-detail="${slug}" hidden>
        <td colspan="4">
          <div class="ds-table-wrap">
            <table class="ds-table">
              <thead>
                <tr>
                  <th>Token name</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Last used</th>
                  <th>Scopes</th>
                </tr>
              </thead>
              <tbody>${_buildTokenRows(person)}</tbody>
            </table>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function _buildRepoPanel(repo, active) {
  let body;
  if (repo.error) {
    body = `<div class="ds-callout ds-callout--warning">Could not read this repository from GitLab.</div>`;
  } else {
    body = `<div class="ds-table-wrap">
      <table class="ds-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Last activity</th>
            <th>Tokens</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${_buildPersonRows(repo.people)}</tbody>
      </table>
    </div>`;
  }
  return `<div class="ds-tab-panel" data-ga-panel="${escHtml(repo.key)}"${active ? '' : ' hidden'}>${body}</div>`;
}

function _buildTabs(repos, activeKey) {
  return repos.map(r => `<button type="button" class="ds-tab${r.key === activeKey ? ' active' : ''}" role="tab" aria-selected="${r.key === activeKey}" data-ga-tab="${escHtml(r.key)}">${escHtml(r.label || r.key)}</button>`).join('');
}

function _buildStateCallout(data) {
  if (data.token_available === false) {
    return `<div class="ds-callout ds-callout--info" style="margin-bottom:12px">
      This view needs a personal GitLab token (<code>GITLAB-PERSONAL</code> in the Bitwarden vault) - set it in Settings &gt; Keys.
    </div>`;
  }
  if (data.stale) {
    return `<div class="ds-callout ds-callout--warning" style="margin-bottom:12px">
      GitLab is not answering - showing data from the last successful read (${escHtml(_fmtDateTime(data.generated_at))}).
    </div>`;
  }
  if (data.error === 'gitlab_error') {
    return `<div class="ds-callout ds-callout--warning" style="margin-bottom:12px">
      GitLab is not answering and no earlier data snapshot has been saved yet.
    </div>`;
  }
  return '';
}

// ── paint ────────────────────────────────────────────────────────────────────

function _paint(root, data) {
  const repos = Array.isArray(data.repos) ? data.repos : [];
  if (!repos.find(r => r.key === _activeRepoKey)) {
    _activeRepoKey = repos.length ? repos[0].key : null;
  }

  const toolbar = `<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
    <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ga-refresh>Refresh</button>
  </div>`;

  const callout = _buildStateCallout(data);

  const tabsBar = repos.length
    ? `<nav class="ds-tabs-list ds-framed-tabs" role="tablist" style="margin-bottom:12px">${_buildTabs(repos, _activeRepoKey)}</nav>`
    : '';

  const panels = repos.map(r => _buildRepoPanel(r, r.key === _activeRepoKey)).join('');

  root.innerHTML = toolbar + callout + tabsBar + panels;
}

function _activateRepoTab(root, key) {
  _activeRepoKey = key;
  root.querySelectorAll('[data-ga-tab]').forEach(btn => {
    const active = btn.dataset.gaTab === key;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  root.querySelectorAll('[data-ga-panel]').forEach(panel => {
    panel.hidden = panel.dataset.gaPanel !== key;
  });
}

async function _load(root, force) {
  if (_loading) return;
  _loading = true;
  // A refresh can take ~16 s when GitLab is unreachable (the server spends two
  // sequential 8 s timeouts, one per target) and the route always answers 200.
  // Without this the button looks dead for that whole time and people click it
  // again, so say out loud that a refresh is in flight.
  const btn = root.querySelector('[data-ga-refresh]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
  }
  try {
    const res = await fetch('/api/gitlab-activity/data' + (force ? '?force=1' : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _lastData = data;
    _paint(root, data);
  } catch (e) {
    showToast('danger', 'Could not load GitLab activity', (e && e.message) || '');
    // The toast alone used to be the whole failure path. With a skeleton in the
    // root that leaves it pulsing for good, so say on the page what happened -
    // but only while nothing has been painted yet; a failed REFRESH must not
    // wipe the table that is already on screen.
    if (!_lastData) {
      root.innerHTML = `<div class="ds-callout ds-callout--warning">
        Could not load GitLab activity. Check your connection and try again.
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ga-refresh>Refresh</button>
      </div>`;
    }
  } finally {
    _loading = false;
    // _paint() replaces root.innerHTML, so the button captured above may already
    // be a detached node - re-query rather than reusing the stale reference.
    const active = root.querySelector('[data-ga-refresh]');
    if (active) {
      active.disabled = false;
      active.textContent = 'Refresh';
    }
  }
}

function _wireRootClicks(root) {
  if (root.dataset.gaWired) return;
  root.dataset.gaWired = '1';
  root.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-ga-tab]');
    if (tabBtn) { _activateRepoTab(root, tabBtn.dataset.gaTab); return; }

    const expandBtn = e.target.closest('[data-ga-expand]');
    if (expandBtn) {
      const slug = expandBtn.dataset.gaExpand;
      const detail = root.querySelector(`[data-ga-detail="${CSS.escape(slug)}"]`);
      if (detail) detail.hidden = !detail.hidden;
      return;
    }

    const refreshBtn = e.target.closest('[data-ga-refresh]');
    if (refreshBtn) { _load(root, true); }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Paint whatever data has already been loaded (or a loading placeholder). */
export function renderGitlabActivityView() {
  const root = document.getElementById('gitlab-activity-root');
  if (!root) return;
  _wireRootClicks(root);
  if (_lastData) { _paint(root, _lastData); return; }
  // No data yet. js/app.js calls this renderer WITHOUT awaiting initGitlabActivity(),
  // so on a first entry it always runs before the fetch settles. The static
  // skeleton in index.html is what stands in until then: writing a one-line
  // "Loading..." over it would be shorter than both the skeleton and the
  // table, so the page would jump twice instead of once.
  if (hasSkeleton(root)) return;
  // No skeleton and no data means we have been here before and the load
  // failed: js/app.js skips runInit on a second entry (_initedViews), so
  // nothing would refetch and the view would dead-end. _load() is guarded by
  // its own _loading flag, so asking again is free.
  _load(root, false);
}

let _secretsWired = false;

/** Fetch and paint the activity data. Called each time the view is entered. */
export function initGitlabActivity() {
  const root = document.getElementById('gitlab-activity-root');
  if (!root) return;
  _wireRootClicks(root);
  _load(root, false);

  if (!_secretsWired) {
    _secretsWired = true;
    // This view fetches at init and then repaints from `_lastData`, so without
    // this a vault unlocked after the first entry would leave "no token" on
    // screen for the rest of the session - re-entering the view would not
    // refetch. Reloads whether or not the view is visible, for the same reason.
    onSecretsChanged(() => {
      const el = document.getElementById('gitlab-activity-root');
      if (el && _lastData) _load(el, false);
    });
  }
}
