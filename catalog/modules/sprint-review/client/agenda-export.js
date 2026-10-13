// modules/sprint-review/client/agenda-export.js
// Builds a self-contained "visual agenda" .html file. Dynamically imported
// from client/index.js's "Download visual agenda" handler ONLY, never imported at the top of
// index.js: this file calls `fetch`/`FileReader` at call time, which the
// bare-Node contract test for client/index.js must never see reached from
// module scope.
//
// The exported document inlines /css/ds-tokens.css (the LIGHT sheet only -
// no data-theme attribute is written on the exported <html>, so every
// var(--...) here resolves against that sheet's :root values) and every
// image as a data: URI, so the downloaded file opens and looks right with
// no network and no reference back to this server. Zero hex literals: the
// hex-color gate scans .js too.

import { esc, FORMAT_LABELS, isDualSectionTeam, topicsOf } from './sprint-review-lib.mjs';

let _tokensCssPromise = null;

function _loadTokensCss() {
  if (!_tokensCssPromise) {
    _tokensCssPromise = fetch('/css/ds-tokens.css').then((r) => (r.ok ? r.text() : '')).catch(() => '');
  }
  return _tokensCssPromise;
}

const _dataUriCache = new Map();

/**
 * Drops the photo cache. A sibling of the entry file is never re-imported on a
 * data reload (modules-template/README.md), so a teammate's new photo under an
 * unchanged avatar URL would otherwise ride into every later export in this tab;
 * the entry calls this from onDataChanged(). The tokens sheet is core CSS and
 * does not change on a data pull, so it stays.
 */
export function clearAgendaExportCache() {
  _dataUriCache.clear();
}

/**
 * Fetches `url` and resolves to a `data:` URI, deduped by URL. A failed
 * fetch resolves to '' rather than throwing - the caller drops the <img>
 * rather than aborting the whole export over one missing photo.
 * @param {string} url
 * @returns {Promise<string>}
 */
function _toDataUri(url) {
  if (!url) return Promise.resolve('');
  if (_dataUriCache.has(url)) return _dataUriCache.get(url);
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return '';
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  })();
  _dataUriCache.set(url, p);
  return p;
}

function _topicsListHtml(topics, avatarMap) {
  return '<ol class="va-topics">' + topics.map((t) => {
    const presenters = (t.presenters || []).map((name) => {
      const avatar = avatarMap.get(name) || '';
      const img = avatar ? '<img class="va-presenter-avatar" src="' + esc(avatar) + '" alt="">' : '';
      return '<span class="va-presenter">' + img + '<span>' + esc(name) + '</span></span>';
    }).join('');
    const formatLabel = FORMAT_LABELS[t.format] || '';
    return '<li class="va-topic"><span class="va-topic-title">' + esc(t.title || '') + '</span>'
      + (formatLabel ? '<span class="va-topic-format">' + esc(formatLabel) + '</span>' : '')
      + '<span class="va-topic-presenters">' + presenters + '</span></li>';
  }).join('') + '</ol>';
}

/**
 * One team's section: header (logo or, when the asset is missing, its name
 * as text), goal line and either one topics list or, for a dual-section
 * team, two labelled sub-blocks (each shown only when it holds a topic).
 */
function _teamSectionHtml(session, team, avatarMap, logoDataUri, dualSectionTeams) {
  const sub = (session.submissions && session.submissions[team]) || {};
  const goal = Array.isArray(session.teamGoals) ? session.teamGoals.find((g) => g && g.team === team) : null;
  const goalHtml = goal && goal.goal
    ? '<p class="va-goal">' + esc(goal.goal) + '</p>'
    : '<p class="va-goal va-goal--empty">No sprint goal</p>';
  const logoHtml = logoDataUri
    ? '<img class="va-team-logo" src="' + esc(logoDataUri) + '" alt="">'
    : '<span class="va-team-logo-text">' + esc(team) + '</span>';

  let bodyHtml;
  if (isDualSectionTeam(team, dualSectionTeams)) {
    const ps = topicsOf(sub, 'topicsProblemSpace');
    const ss = topicsOf(sub, 'topicsSolutionSpace');
    if (!ps.length && !ss.length) {
      bodyHtml = '<p class="va-empty">No topics submitted.</p>';
    } else {
      bodyHtml = (ps.length ? '<div class="va-section-label">Problem Space</div>' + _topicsListHtml(ps, avatarMap) : '')
        + (ss.length ? '<div class="va-section-label">Solution Space</div>' + _topicsListHtml(ss, avatarMap) : '');
    }
  } else {
    const topics = topicsOf(sub, 'topics');
    bodyHtml = topics.length ? _topicsListHtml(topics, avatarMap) : '<p class="va-empty">No topics submitted.</p>';
  }

  return '<section class="va-team">'
    + '<div class="va-team-header">' + logoHtml + '<h2>' + esc(team) + '</h2></div>'
    + goalHtml + bodyHtml + '</section>';
}

function _visualAgendaCss() {
  return '.va-page{font-family:system-ui,sans-serif;background:var(--body-primary-bg);'
    + 'color:var(--body-primary-text);padding:var(--space-32, 32px);max-width:900px;margin:0 auto}'
    + '.va-header{margin-bottom:var(--space-32, 32px)}'
    + '.va-header h1{margin:0;font-size:var(--text-2xl, 24px)}'
    + '.va-team{margin-bottom:var(--space-24, 24px);padding:var(--space-16, 16px);'
    + 'border:1px solid var(--body-tertiary-border);border-radius:var(--radius-m, 8px)}'
    + '.va-team-header{display:flex;align-items:center;gap:var(--space-8, 8px);margin-bottom:var(--space-8, 8px)}'
    + '.va-team-logo{height:32px}'
    + '.va-team-logo-text{font-weight:700}'
    + '.va-team-header h2{margin:0}'
    + '.va-goal{font-weight:600}'
    + '.va-goal--empty{color:var(--text-secondary)}'
    + '.va-section-label{font-weight:700;margin:var(--space-12, 12px) 0 var(--space-4, 4px)}'
    + '.va-topics{margin:var(--space-8, 8px) 0 0;padding-left:var(--space-20, 20px)}'
    + '.va-topic{margin-bottom:var(--space-8, 8px)}'
    + '.va-topic-title{font-weight:600;margin-right:var(--space-8, 8px)}'
    + '.va-topic-format{color:var(--text-secondary);margin-right:var(--space-8, 8px)}'
    + '.va-presenter{display:inline-flex;align-items:center;gap:var(--space-4, 4px);margin-right:var(--space-8, 8px)}'
    + '.va-presenter-avatar{width:20px;height:20px;border-radius:50%;object-fit:cover}'
    + '.va-empty{color:var(--text-secondary)}';
}

/**
 * Builds a self-contained visual agenda .html covering ALL of `teams`, in
 * page order, with per-team logos and a Problem Space / Solution Space
 * sub-split for any team in `dualSectionTeams`
 * (status.meeting.dualSectionTeams - never hardcoded here).
 * @param {{session: object, teams: string[], dualSectionTeams?: string[],
 *   meetingLabel: string, avatarUrlFor: (name: string) => string,
 *   logoUrlFor?: (team: string) => string}} args
 * @returns {Promise<string>}
 */
export async function buildVisualAgendaHtml({ session, teams, dualSectionTeams, meetingLabel, avatarUrlFor, logoUrlFor }) {
  const tokensCss = await _loadTokensCss();

  const avatarMap = new Map();
  for (const team of teams) {
    const sub = (session.submissions && session.submissions[team]) || {};
    const sections = isDualSectionTeam(team, dualSectionTeams) ? ['topicsProblemSpace', 'topicsSolutionSpace'] : ['topics'];
    for (const sec of sections) {
      for (const t of topicsOf(sub, sec)) {
        for (const name of (t.presenters || [])) {
          if (avatarMap.has(name)) continue;
          const url = typeof avatarUrlFor === 'function' ? avatarUrlFor(name) : '';
          avatarMap.set(name, url ? await _toDataUri(url) : '');
        }
      }
    }
  }

  const teamSectionsHtml = [];
  for (const team of teams) {
    const logoUrl = typeof logoUrlFor === 'function' ? logoUrlFor(team) : '';
    // A 404 for a team with no shipped logo asset resolves to '' inside
    // _toDataUri - never an exception - and _teamSectionHtml falls back to
    // the team name as text.
    const logoDataUri = logoUrl ? await _toDataUri(logoUrl) : '';
    teamSectionsHtml.push(_teamSectionHtml(session, team, avatarMap, logoDataUri, dualSectionTeams));
  }

  const title = session.sprintName || meetingLabel || 'Sprint Review';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<title>' + esc(title) + '</title>'
    + '<style>' + tokensCss + _visualAgendaCss() + '</style></head>'
    + '<body><div class="va-page"><header class="va-header">'
    + '<h1>' + esc(title) + '</h1></header>'
    + '<main class="va-main">' + teamSectionsHtml.join('') + '</main></div></body></html>';
}
