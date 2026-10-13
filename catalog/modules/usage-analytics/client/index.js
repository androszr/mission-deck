// modules/usage-analytics/client/index.js
// Usage Analytics - Mission Deck traffic from Amplitude: KPI strip,
// daily chart, per-module and per-person tables. Data comes from
// GET /data (aggregated.json); "Refresh" runs the refresh stream.
//
// js/module-host.js imports this file lazily, creates
// #usage-analytics-main-root and #usage-analytics-main-actions and calls
// init() once, render() on every entry and onDataChanged() after a sync.
// Everything here stays importable in bare Node (dynamic imports only).

import { esc, fmtInt, fmtDuration, fmtDay, fmtDayShort, fmtStamp, fmtLocal, initialsOf, fmtHash } from './lib/format.js';
import { dailyBarsSvg, barListHtml, activityStripHtml, deltaBadgeHtml } from './lib/charts.js';
import { openRefreshModal, refreshBlocker } from './refresh-modal.js';

const VIEW_ID = 'usage-analytics-main';
const PERIODS = ['7', '30', '90'];
const HINT_ALIASES = 'An identity outside the team directory. It can be linked to a person in usage-analytics/aliases.json in the team data.';

let _dsModal = null;
let _tdir = null;
let _whoami = null;

// View state - survives re-render and onDataChanged, dropped with the page.
const S = {
  period: '30',
  tab: 'modules',
  skipMe: false,
  agg: null,
  dataError: null,
  status: null,
  slug: null,
  expanded: new Set(),
  refreshing: false,
};

function _initials(name) { return initialsOf(name); }

function personHtml(name) {
  let member = null;
  let url = '';
  if (_tdir) {
    try { member = _tdir.memberByName(name); url = _tdir.memberAvatarUrl(member); } catch { member = null; url = ''; }
  }
  const label = name || '—';
  const face = url
    ? '<img class="usage-analytics-avatar" src="' + esc(url) + '" alt="" loading="lazy">'
    : '<span class="usage-analytics-avatar usage-analytics-initials" aria-hidden="true">' + esc(_initials(label)) + '</span>';
  return '<div class="usage-analytics-person">' + face + '<span class="usage-analytics-person-name">' + esc(label) + '</span></div>';
}

// -- Skip-me: derive the effective period -----------------------------------

function _excludedIds(P) {
  const ex = new Set();
  if (!S.skipMe || !S.slug) return ex;
  for (const u of P.users || []) {
    if (u.user_id === S.slug || (u.aliases || []).includes(S.slug)) ex.add(u.user_id);
  }
  return ex;
}

function _hasMe(P) {
  if (!S.slug) return false;
  return (P.users || []).some((u) => u.user_id === S.slug || (u.aliases || []).includes(S.slug));
}

function effective(P) {
  const ex = _excludedIds(P);
  if (!ex.size) return { P, users: P.users || [], modules: P.modules || [], kpi: P.kpi, skipped: false };
  const users = (P.users || []).filter((u) => !ex.has(u.user_id));
  const modules = (P.modules || []).map((m) => {
    const by = (m.by_user || []).filter((b) => !ex.has(b.user_id));
    return {
      ...m,
      by_user: by,
      page_views: by.reduce((a, b) => a + (b.page_views || 0), 0),
      users: by.length,
      // The union of active days cannot be rebuilt from per-user counts; shown as "-".
      active_days: null,
      delta_page_views_pct: null,
    };
  }).filter((m) => m.page_views > 0);
  const kpi = {
    ...P.kpi,
    active_users: users.length,
    sessions: users.reduce((a, u) => a + (u.sessions || 0), 0),
    page_views: users.reduce((a, u) => a + (u.page_views || 0), 0),
    modules_in_use: modules.length,
    delta: null,
  };
  return { P, users, modules, kpi, skipped: true };
}

// -- Paint -------------------------------------------------------------------

function _freshnessHtml(a) {
  return '<p class="usage-analytics-note">Data up to ' + esc(fmtDay(a.last_full_day))
    + ', refreshed ' + esc(fmtLocal(a.generated_at)) + '. Time is capped at 30 min per page view.</p>';
}

function _filtersHtml(P) {
  const seg = PERIODS.map((p) => '<button type="button" class="ds-segment' + (S.period === p ? ' active' : '')
    + '" data-ac-period="' + p + '" aria-pressed="' + (S.period === p) + '">' + p + ' days</button>').join('');
  const me = _hasMe(P)
    ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ac-skipme aria-pressed="' + S.skipMe + '">'
      + (S.skipMe ? 'Skipping me' : 'Skip me') + '</button>'
    : '';
  return '<div class="usage-analytics-filters"><div class="ds-segmented" role="group" aria-label="Period">' + seg + '</div>' + me + '</div>';
}

function _kpiHtml(E) {
  const P = E.P;
  const k = E.kpi;
  const tile = (value, label, delta) => '<div class="ds-card ds-stat"><div class="ds-stat-value">' + fmtInt(value) + '</div>'
    + '<div class="usage-analytics-delta">' + (E.skipped ? '' : deltaBadgeHtml(delta)) + '</div><div class="ds-stat-label">' + label + '</div></div>';
  const d = k.delta || {};
  return '<div class="ds-stat-row usage-analytics-stats" style="--ds-stat-cols:4">'
    + '<div class="ds-card ds-stat-subject">Period: ' + S.period + ' days, ' + esc(fmtDayShort(P.from)) + ' - ' + esc(fmtDayShort(P.to)) + '</div>'
    + tile(k.active_users, 'Active users', d.active_users_pct)
    + tile(k.sessions, 'Sessions', d.sessions_pct)
    + tile(k.page_views, 'Page views', d.page_views_pct)
    + tile(k.modules_in_use, 'Modules in use', null)
    + '</div>';
}

function _modulesTableHtml(E) {
  if (!E.modules.length) return '<div class="ds-callout ds-callout--info"><div>No module page views in this period.</div></div>';
  const rows = E.modules.map((m) => {
    const sid = 'ac-sub-' + String(m.id).replace(/[^a-z0-9-]/gi, '_');
    const open = S.expanded.has(m.id);
    const sub = (m.views || []).map((v) => '<tr><td>' + esc(v.label || v.id) + '</td><td class="right">' + fmtInt(v.page_views)
      + '</td><td class="right">' + fmtInt(v.users) + '</td><td class="right">' + fmtDuration(v.median_view_ms) + '</td></tr>').join('');
    return '<tr><td><button type="button" class="ds-row-toggle" data-ac-toggle="' + esc(m.id) + '" aria-expanded="' + open
      + '" aria-controls="' + sid + '"><span class="ds-row-toggle-chevron" aria-hidden="true">›</span> ' + esc(m.name) + '</button></td>'
      + '<td class="right">' + fmtInt(m.page_views) + '</td><td class="right">' + fmtInt(m.users) + '</td>'
      + '<td class="right"' + (m.active_days === null ? ' title="Active days of a module cannot be recomputed once you are skipped.">—' : '>' + fmtInt(m.active_days)) + '</td><td class="right">' + fmtDuration(m.median_view_ms) + '</td>'
      + '<td>' + deltaBadgeHtml(m.delta_page_views_pct) + '</td>'
      + '<td><div class="usage-analytics-actions-row"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ac-module-users="'
      + esc(m.id) + '">Users</button></div></td></tr>'
      + '<tr class="ds-table-sub" id="' + sid + '"' + (open ? '' : ' hidden') + '><td colspan="7">'
      + (E.skipped ? '<p class="usage-analytics-note">The per-screen split shows the whole team, including you.</p>' : '')
      + '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Screen</th><th class="right">Page views</th><th class="right">Users</th>'
      + '<th class="right">Median time</th></tr></thead><tbody>' + sub + '</tbody></table></div></td></tr>';
  }).join('');
  return '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Module</th><th class="right">Page views</th>'
    + '<th class="right">Users</th><th class="right">Active days</th><th class="right">Median time</th><th>Trend</th><th>Actions</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<p class="usage-analytics-note">Median time is computed for the whole team' + (E.skipped ? ' (not recomputed after skipping you)' : '')
    + '. Page view time is capped at 30 min.</p>';
}

function _versionCell(u, agg) {
  const hash = u.app_hash_short || fmtHash(u.app_hash_last);
  return '<span class="usage-analytics-hash">' + esc(hash) + '</span> '
    + (u.app_outdated ? '<span class="ds-badge ds-badge--yellow" title="Newest version: ' + esc(agg.latest_app_hash_short || '') + '">Older version</span>' : '');
}

function _usersTableHtml(E, agg) {
  if (!E.users.length) return '<div class="ds-callout ds-callout--info"><div>No active people in this period.</div></div>';
  const rows = E.users.map((u) => {
    const errs = (u.errors || []).reduce((a, e) => a + (e.count || 0), 0);
    return '<tr><td>' + personHtml(u.display_name)
      + (u.matched === false ? ' <span class="ds-badge ds-badge--gray" title="' + esc(HINT_ALIASES) + '">Not in directory</span>' : '') + '</td>'
      + '<td>' + esc(fmtStamp(u.last_seen)) + '</td><td class="right">' + fmtInt(u.active_days) + '</td>'
      + '<td class="right">' + fmtInt(u.sessions) + '</td><td class="right">' + fmtInt(u.page_views) + '</td>'
      + '<td>' + (u.top_modules || []).slice(0, 3).map((m) => esc(m.name)).join(', ') + '</td>'
      + '<td>' + _versionCell(u, agg) + '</td>'
      + '<td class="right">' + fmtInt(errs) + '</td>'
      + '<td><div class="usage-analytics-actions-row"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ac-user="'
      + esc(u.user_id) + '">Details</button></div></td></tr>';
  }).join('');
  const unmatched = (agg.meta && agg.meta.unmatched_ids) || [];
  return '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Person</th><th>Last seen</th><th class="right">Active days</th>'
    + '<th class="right">Sessions</th><th class="right">Page views</th><th>Top modules</th><th>Version</th><th class="right">Errors</th><th>Actions</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<p class="usage-analytics-note">Newest version: ' + esc(agg.latest_app_hash_short || '—')
    + (agg.latest_app_hash_first_seen ? ', first seen ' + esc(fmtStamp(agg.latest_app_hash_first_seen)) : '') + '.</p>'
    + (unmatched.length
      ? '<div class="ds-callout ds-callout--info"><div>Ids outside the team directory: ' + unmatched.map(esc).join(', ')
        + '. ' + esc(HINT_ALIASES) + '</div></div>'
      : '');
}

function _tabsHtml(E, agg) {
  const tab = (id, label) => '<button type="button" class="ds-tab' + (S.tab === id ? ' active' : '') + '" role="tab" id="ac-tab-' + id
    + '" aria-selected="' + (S.tab === id) + '" aria-controls="ac-panel-' + id + '" tabindex="' + (S.tab === id ? 0 : -1)
    + '" data-ac-tab="' + id + '">' + label + '</button>';
  return '<div class="ds-tabs-list ds-framed-tabs" role="tablist" aria-label="Details">' + tab('modules', 'Modules') + tab('users', 'Users') + '</div>'
    + '<div role="tabpanel" id="ac-panel-modules" aria-labelledby="ac-tab-modules"' + (S.tab === 'modules' ? '' : ' hidden') + '>'
    + _modulesTableHtml(E) + '</div>'
    + '<div role="tabpanel" id="ac-panel-users" aria-labelledby="ac-tab-users"' + (S.tab === 'users' ? '' : ' hidden') + '>'
    + _usersTableHtml(E, agg) + '</div>';
}

function _statusCalloutHtml() {
  const b = S.status ? refreshBlocker({ ...S.status, busy: false }) : null;
  return b ? '<div class="ds-callout ds-callout--' + b.kind + '"><div>' + esc(b.text) + '</div></div>' : '';
}

function paint() {
  const root = document.getElementById(VIEW_ID + '-root');
  if (!root) return;
  const agg = S.agg;
  if (!agg) {
    const msg = S.dataError && S.dataError.error === 'storage-unavailable'
      ? '<div class="ds-callout ds-callout--warning"><div>' + esc(S.dataError.message || 'Team data is unavailable - check the Sync panel.') + '</div></div>'
      : '<div class="ds-callout ds-callout--info"><div>' + esc((S.dataError && S.dataError.message) || 'No data yet. Click "Refresh" to fetch events from Amplitude.') + '</div></div>';
    root.innerHTML = '<div class="usage-analytics-root">' + _statusCalloutHtml() + msg + '</div>';
    return;
  }
  const P = agg.periods && agg.periods[S.period];
  if (!P) {
    root.innerHTML = '<div class="usage-analytics-root"><div class="ds-callout ds-callout--warning"><div>No summary for this period.</div></div></div>';
    return;
  }
  const E = effective(P);
  const history = agg.range && agg.range.from
    ? '<p class="usage-analytics-note">History starts on ' + esc(fmtDay(agg.range.from))
      + ' - trends in the first weeks may be inflated, and "—" means there is nothing to compare with.'
      + (E.skipped ? ' The daily chart and trends do not account for skipping you.' : '') + '</p>'
    : '';
  root.innerHTML = '<div class="usage-analytics-root">'
    + _statusCalloutHtml()
    + _freshnessHtml(agg)
    + _filtersHtml(P)
    + _kpiHtml(E)
    + '<div><div class="ds-section-head"><h2 class="ds-section-head-title">Daily activity</h2></div>'
    + '<div class="ds-card usage-analytics-chart">' + dailyBarsSvg(P.daily, { height: 220 }) + '</div>'
    + '<p class="usage-analytics-note">Bars: page views. Line: active users.</p></div>'
    + history
    + '<div><div class="ds-section-head"><h2 class="ds-section-head-title">Details</h2></div>' + _tabsHtml(E, agg) + '</div>'
    + '</div>';
}

function paintActions() {
  const actions = document.getElementById(VIEW_ID + '-actions');
  if (!actions) return;
  const blocked = S.status ? refreshBlocker(S.status) : null;
  const a = S.agg;
  actions.innerHTML = (a && a.last_full_day ? '<span class="ds-badge ds-badge--gray">Data up to ' + esc(fmtDay(a.last_full_day)) + '</span> ' : '')
    + '<button type="button" class="ds-btn ds-btn--secondary" data-ac-refresh' + (blocked ? ' disabled title="' + esc(blocked.text) + '"' : '')
    + (S.refreshing ? ' aria-busy="true"' : '') + '>Refresh</button>';
}

// -- Modals ---------------------------------------------------------------------

function _openOverlay(deps, title, headerHtml, bodyHtml, trigger) {
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay usage-analytics-modal';
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--lg" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">'
    + '<div class="ds-modal-header">' + headerHtml + '</div><div class="ds-modal-body">' + bodyHtml + '</div>'
    + '<div class="ds-modal-footer"><button type="button" class="ds-btn ds-btn--primary" data-ac-close>Close</button></div></div>';
  document.body.appendChild(overlay);
  const close = () => {
    if (_dsModal) { try { _dsModal.closeDsModal(overlay); } catch { /* gone */ } }
    overlay.remove();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-ac-close]')) close();
  });
  deps.registerViewCleanup(close);
  if (_dsModal) _dsModal.openDsModal(overlay, { trigger });
  else overlay.hidden = false;
}

function openModuleUsers(deps, id, trigger) {
  const P = S.agg.periods[S.period];
  const m = effective(P).modules.find((x) => x.id === id);
  if (!m) return;
  const rows = (m.by_user || []).map((b) => {
    const u = (P.users || []).find((x) => x.user_id === b.user_id);
    return '<tr><td>' + personHtml(u ? u.display_name : b.user_id) + '</td><td class="right">' + fmtInt(b.page_views)
      + '</td><td class="right">' + fmtInt(b.active_days) + '</td><td class="right">' + fmtInt(b.sessions) + '</td></tr>';
  }).join('');
  const body = rows
    ? '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Person</th><th class="right">Page views</th><th class="right">Active days</th>'
      + '<th class="right">Sessions</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    : '<p class="usage-analytics-note">No people in this period.</p>';
  _openOverlay(deps, m.name + ' - who uses it', '<span class="ds-modal-title">' + esc(m.name) + ' - who uses it</span>', body, trigger);
}

function openUserDetails(deps, uid, trigger) {
  const agg = S.agg;
  const P = agg.periods[S.period];
  const u = (P.users || []).find((x) => x.user_id === uid);
  if (!u) return;
  const days = Number(S.period);
  const daily = (u.daily || []).slice();
  if (!daily.length || daily[daily.length - 1].date !== P.to) daily.push({ date: P.to, page_views: 0 });
  const errs = (u.errors || []).length
    ? '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Screen</th><th>Message</th><th class="right">Count</th></tr></thead><tbody>'
      + u.errors.map((e) => '<tr><td>' + esc(e.view) + '</td><td>' + esc(e.message) + '</td><td class="right">' + fmtInt(e.count) + '</td></tr>').join('')
      + '</tbody></table></div>'
    : '<p class="usage-analytics-note">No errors in this period.</p>';
  const tile = (v, l) => '<div class="ds-card ds-stat"><div class="ds-stat-value">' + v + '</div><div class="ds-stat-label">' + l + '</div></div>';
  const header = personHtml(u.display_name)
    + '<span class="ds-badge ' + (u.app_outdated ? 'ds-badge--yellow' : 'ds-badge--gray') + '">'
    + esc(u.app_hash_short || fmtHash(u.app_hash_last)) + (u.app_outdated ? ' - older than ' + esc(agg.latest_app_hash_short || '') : '') + '</span>';
  const body = '<div class="ds-stat-row usage-analytics-stats usage-analytics-stats--plain" style="--ds-stat-cols:4">'
    + tile('<span class="usage-analytics-stat-date">' + esc(fmtDay(u.last_seen)) + '</span>', 'Last seen') + tile(fmtInt(u.active_days), 'Active days')
    + tile(fmtInt(u.sessions), 'Sessions') + tile(fmtInt(u.page_views), 'Page views') + '</div>'
    + '<div class="ds-section-head"><h3 class="ds-section-head-title">Most opened</h3></div>' + barListHtml(u.top_modules)
    + '<div class="ds-section-head"><h3 class="ds-section-head-title">Activity in the period</h3></div>' + activityStripHtml(daily, days)
    + '<div class="ds-section-head"><h3 class="ds-section-head-title">Screen errors</h3></div>' + errs
    + ((u.aliases || []).length ? '<p class="usage-analytics-note">Ids: ' + u.aliases.map(esc).join(', ') + '</p>' : '')
    + (u.matched === false ? '<p class="usage-analytics-note">' + esc(HINT_ALIASES) + '</p>' : '');
  _openOverlay(deps, 'Details: ' + u.display_name, header, body, trigger);
}

// -- Data --------------------------------------------------------------------------

async function loadAll(deps) {
  const get = async (p) => {
    try {
      const r = await fetch(deps.apiBase + p, { cache: 'no-store' });
      return await r.json();
    } catch { return null; }
  };
  const [st, data] = await Promise.all([get('/status'), get('/data')]);
  S.status = st && st.ok ? st : null;
  if (data && data.ok && data.aggregate) { S.agg = data.aggregate; S.dataError = null; }
  else {
    S.agg = null;
    S.dataError = data || { error: 'unreachable', message: 'Could not load the analytics data. Try again in a moment.' };
  }
}

async function startRefresh(deps, view) {
  if (S.refreshing) return;
  S.refreshing = true;
  paintActions();
  try {
    const res = await openRefreshModal({ apiBase: deps.apiBase, registerViewCleanup: deps.registerViewCleanup });
    if (res && res.ok) {
      deps.showToast('Analytics data refreshed - send it with Send in the top bar so the team can see it.', 'success');
      await loadAll(deps);
    }
  } catch {
    deps.showToast('Could not refresh the analytics data.', 'error');
  } finally {
    S.refreshing = false;
    paint();
    paintActions();
  }
  void view;
}

export const views = {
  [VIEW_ID]: {
    _wired: false,

    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      this._deps = deps;
      this._ready = (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
        try { _tdir = await import('/js/team-directory.js'); _tdir.loadTeamDirectory().then(() => { if (S.agg) paint(); }).catch(() => {}); } catch { _tdir = null; }
        try { _whoami = await import('/js/whoami.js'); } catch { _whoami = null; }
      })();
    },

    async render(_subPath, _opts) {
      const deps = this._deps;
      const root = document.getElementById(VIEW_ID + '-root');
      if (!root) return;
      const actions = document.getElementById(VIEW_ID + '-actions');
      paintActions();

      // Wire first, so clicks work even while data loads.
      if (!this._wired) {
        this._wired = true;
        const onClick = (e) => {
          const t = e.target.closest('[data-ac-refresh],[data-ac-period],[data-ac-skipme],[data-ac-tab],[data-ac-toggle],[data-ac-module-users],[data-ac-user]');
          if (!t || t.disabled) return;
          if (t.hasAttribute('data-ac-refresh')) { startRefresh(deps, this); return; }
          if (t.dataset.acPeriod) { S.period = t.dataset.acPeriod; paint(); return; }
          if (t.hasAttribute('data-ac-skipme')) { S.skipMe = !S.skipMe; paint(); return; }
          if (t.dataset.acTab) { S.tab = t.dataset.acTab; paint(); return; }
          if (t.dataset.acToggle) {
            const id = t.dataset.acToggle;
            if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id);
            paint();
            return;
          }
          if (t.dataset.acModuleUsers) { openModuleUsers(deps, t.dataset.acModuleUsers, t); return; }
          if (t.dataset.acUser) openUserDetails(deps, t.dataset.acUser, t);
        };
        root.addEventListener('click', onClick);
        if (actions) actions.addEventListener('click', onClick);
        deps.registerViewCleanup(() => {
          root.removeEventListener('click', onClick);
          if (actions) actions.removeEventListener('click', onClick);
          this._wired = false;
        });
      }

      try {
        await loadAll(deps);
        if (this._ready) await this._ready;
        if (_whoami && !S.slug) {
          try { const w = await _whoami.fetchWhoami(); S.slug = (w && w.person_slug) || null; } catch { S.slug = null; }
        }
      } catch {
        S.agg = null;
        S.dataError = { message: 'Could not load the analytics data. Try again in a moment.' };
      }
      paint();
      paintActions();
    },

    /** After a team-data sync: drop the cached aggregate, keep period/tab. */
    async onDataChanged() {
      S.agg = null;
      await this.render();
    },
  },
};
