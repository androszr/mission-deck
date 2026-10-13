// modules/sprint-stats/client/sprint-charts.mjs
// Pure SVG builders, DOM-free (sprint trend, burndown, spillover chart).
// Every colour is a DS token (var(--legend-*)) or
// `currentColor` for grid lines / axis text - never a hex, checked by
// tests/test_sprint_charts.mjs and node scripts/check-conventions.js
// --modules. Hover detail is a native SVG <title> on each point/line rather
// than a floating tooltip div, which would need a node on document.body per
// chart, mouse tracking and its own registerViewCleanup entry for no
// material gain over a browser-native tooltip.
//
// The trend chart reads index.sprints[] summaries alone (via the team model
// from sprint-model.mjs) - no shard needed. The burndown chart needs full
// team-sprint objects (persons/issues/burndown survive only in a shard), so
// it takes a `shardsByKey` Map ("src:sprint_n" -> full shard) that
// client/index.js fills as tabs are visited / "Previous sprints" is
// clicked; a team with nothing cached yet renders its own "No data"
// panel rather than blocking the rest of the section.

import { effectiveDropped, teamLabel } from './sprint-model.mjs';

export const SPRINT_CHART_PAGE = 8;
export const BURNDOWN_SPRINT_COUNT = 4;
export const BURNDOWN_TEAMS = ['Atlas', 'Borealis', 'Comet'];

export const TREND_METRICS = [
  { key: 'committed', label: 'Committed', color: 'var(--legend-4th-primary)' },
  { key: 'done', label: 'Done', color: 'var(--legend-1st-primary)' },
  { key: 'dropped', label: 'Spillover', color: 'var(--legend-5th-primary)' },
];

const TEAM_PALETTES = {
  Atlas: ['var(--legend-2nd-tertiary)', 'var(--legend-2nd-secondary)', 'var(--legend-2nd-primary)'],
  Borealis: ['var(--legend-7th-tertiary)', 'var(--legend-7th-secondary)', 'var(--legend-7th-primary)'],
  Comet: ['var(--legend-3rd-tertiary)', 'var(--legend-3rd-secondary)', 'var(--legend-3rd-primary)'],
};
const TEAM_IDEAL_COLOR = {
  Atlas: 'var(--legend-2nd-primary)',
  Borealis: 'var(--legend-7th-primary)',
  Comet: 'var(--legend-3rd-primary)',
};
const TEAM_COLOR_FALLBACK = ['var(--legend-6th-primary)', 'var(--legend-9th-primary)', 'var(--legend-1st-primary)'];
const _fallbackAssigned = new Map();
export const SPILLOVER_THRESHOLD_COLOR = 'var(--legend-5th-primary)';
export const SPILLOVER_THRESHOLD = 20;
const PLATFORM_PALETTE = ['var(--legend-4th-tertiary)', 'var(--legend-4th-secondary)', 'var(--legend-4th-primary)'];
const PLATFORM_IDEAL_COLOR = 'var(--legend-4th-primary)';

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The visible window of a sorted-ascending sprint-number list: the last
 * `pageSize` entries when `offset` is 0, older windows as `offset` grows.
 * @param {number[]} allNs sorted ascending
 * @param {number} offset 0 = newest window
 * @param {number} [pageSize]
 * @returns {{items: number[], canPrev: boolean, canNext: boolean}}
 */
export function getVisibleWindow(allNs, offset, pageSize) {
  const size = pageSize || SPRINT_CHART_PAGE;
  const total = (allNs || []).length;
  const endIdx = total - offset * size;
  const startIdx = Math.max(endIdx - size, 0);
  return {
    items: (allNs || []).slice(startIdx, endIdx),
    canPrev: startIdx > 0,
    canNext: offset > 0,
  };
}

function _buildTrendSvg(points, xLabelFn, ariaLabel) {
  const W = 400;
  const H = 220;
  const PAD = { top: 20, right: 25, bottom: 35, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const allNs = points.map((p) => p.sprintN);
  const xMin = Math.min(...allNs);
  const xMax = Math.max(...allNs);
  const xRange = xMax - xMin || 1;
  const xScale = (n) => PAD.left + ((n - xMin) / xRange) * plotW;

  const maxVal = Math.max(...points.flatMap((p) => [p.committed, p.done]), 10);
  const yMax = Math.ceil((maxVal * 1.15) / 10) * 10;
  const yScale = (v) => PAD.top + (1 - v / yMax) * plotH;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" class="sprint-stats-chart-svg" role="img" aria-label="' + _esc(ariaLabel || 'Sprint trend') + '">';

  const GRID = 4;
  for (let i = 0; i <= GRID; i++) {
    const val = Math.round((yMax / GRID) * i);
    const y = yScale(val);
    svg += '<line x1="' + PAD.left + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD.right) + '" y2="' + y.toFixed(1) + '" stroke="currentColor" stroke-opacity="0.15"/>';
    svg += '<text x="' + (PAD.left - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="sprint-stats-axis-text">' + val + '</text>';
  }
  allNs.forEach((n) => {
    const x = xScale(n);
    svg += '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="sprint-stats-axis-text">' + _esc(xLabelFn(n)) + '</text>';
  });

  TREND_METRICS.forEach((m) => {
    const validPts = points.filter((p) => p[m.key] !== undefined && p[m.key] !== null);
    if (!validPts.length) return;
    const activePt = validPts.filter((p) => p.isActive).sort((a, b) => a.sprintN - b.sprintN).slice(-1)[0];
    const closedPts = validPts.filter((p) => !p.isActive || (activePt && p.sprintN < activePt.sprintN));

    if (closedPts.length >= 2) {
      const d = closedPts.map((p, i) => (i === 0 ? 'M' : 'L') + xScale(p.sprintN).toFixed(1) + ',' + yScale(p[m.key]).toFixed(1)).join(' ');
      svg += '<path d="' + d + '" fill="none" stroke="' + m.color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    if (activePt && closedPts.length) {
      const last = closedPts[closedPts.length - 1];
      svg += '<path d="M' + xScale(last.sprintN).toFixed(1) + ',' + yScale(last[m.key]).toFixed(1)
        + ' L' + xScale(activePt.sprintN).toFixed(1) + ',' + yScale(activePt[m.key]).toFixed(1)
        + '" fill="none" stroke="' + m.color + '" stroke-width="2.5" stroke-dasharray="6,4" stroke-linecap="round"/>';
    }
    closedPts.forEach((p) => {
      svg += '<circle cx="' + xScale(p.sprintN).toFixed(1) + '" cy="' + yScale(p[m.key]).toFixed(1) + '" r="4" fill="' + m.color + '">'
        + '<title>' + _esc(m.label + ': ' + p[m.key]) + '</title></circle>';
    });
    if (activePt) {
      svg += '<circle cx="' + xScale(activePt.sprintN).toFixed(1) + '" cy="' + yScale(activePt[m.key]).toFixed(1) + '" r="4" fill="var(--body-primary-bg)" stroke="' + m.color + '" stroke-width="2.5">'
        + '<title>' + _esc(m.label + ' (active): ' + activePt[m.key]) + '</title></circle>';
    }
  });

  svg += '</svg>';
  return svg;
}

function _trendLegendHtml() {
  return TREND_METRICS.map((m) => '<span class="sprint-stats-legend-item"><span class="sprint-stats-legend-swatch" style="background:' + m.color + '"></span>' + _esc(m.label) + '</span>').join('')
    + '<span class="sprint-stats-legend-item"><span class="sprint-stats-legend-line sprint-stats-legend-line--dashed"></span>Active sprint</span>';
}

/**
 * Trend section: one panel per MAIN team (window shared across all three)
 * plus one Delta panel (its own window, PLATFORM sprint numbers can differ
 * from MAIN). Reads
 * `teams` from sprint-model.mjs buildTeamsModel() - index summaries only.
 * @param {object[]} teams buildTeamsModel() output
 * @param {number} windowOffset 0 = newest 8 sprints
 * @returns {{html: string, canPrev: boolean, canNext: boolean}}
 */
export function buildTrendSection(teams, windowOffset) {
  const mainTeams = (teams || []).filter((t) => t.unit === 'SP');
  const platformTeam = (teams || []).find((t) => t.unit === 'MD');
  let panels = '';
  let window_ = { items: [], canPrev: false, canNext: false };

  if (mainTeams.length) {
    const allNs = [...new Set(mainTeams.flatMap((t) => t.sprints.map((s) => s.sprint_n)))].sort((a, b) => a - b);
    window_ = getVisibleWindow(allNs, windowOffset);
    mainTeams.forEach((team) => {
      const points = window_.items.map((n) => {
        const sp = team.sprints.find((s) => s.sprint_n === n);
        const t = sp && sp.teamData;
        if (!t) return null;
        return {
          sprintN: n,
          committed: t.summary.committed,
          done: t.summary.done,
          dropped: effectiveDropped(t.summary, sp.phase, 'SP'),
          isActive: sp.phase !== 'END',
        };
      }).filter(Boolean);
      if (!points.length) return;
      panels += '<div class="ds-card sprint-stats-chart-panel"><div class="ds-card-body">'
        + '<div class="sprint-stats-panel-title">' + _esc(team.name) + '</div>'
        + _buildTrendSvg(points, (n) => 'S' + n, 'Sprint trend: ' + team.name)
        + '</div></div>';
    });
  }

  if (platformTeam && platformTeam.sprints.length) {
    const window2 = getVisibleWindow(platformTeam.sprints.map((s) => s.sprint_n), 0);
    const points = window2.items.map((n) => {
      const sp = platformTeam.sprints.find((s) => s.sprint_n === n);
      const t = sp && sp.teamData;
      if (!t) return null;
      return {
        sprintN: n,
        committed: t.summary.committed,
        done: t.summary.done,
        dropped: effectiveDropped(t.summary, sp.phase, 'MD'),
        isActive: sp.phase !== 'END',
      };
    }).filter(Boolean);
    if (points.length) {
      panels += '<div class="ds-card sprint-stats-chart-panel"><div class="ds-card-body">'
        + '<div class="sprint-stats-panel-title">' + _esc(teamLabel('Delta')) + ' [MD]</div>'
        + _buildTrendSvg(points, (n) => 'PL_' + n, 'Sprint trend: ' + teamLabel('Delta') + ' [MD]')
        + '</div></div>';
    }
  }

  return {
    html: panels ? ('<div class="sprint-stats-legend">' + _trendLegendHtml() + '</div><div class="sprint-stats-chart-grid">' + panels + '</div>') : '',
    canPrev: window_.canPrev,
    canNext: window_.canNext,
  };
}

function _buildBurndownSvg(lines, ideals, maxX, yMax, unitLabel, ariaLabel) {
  const W = 440;
  const H = 280;
  const PAD = { top: 16, right: 14, bottom: 38, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const xScale = (x) => PAD.left + (x / Math.max(maxX, 1)) * plotW;
  const yScale = (v) => PAD.top + (1 - v / yMax) * plotH;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" class="sprint-stats-chart-svg sprint-stats-burndown-svg" role="img" aria-label="' + _esc(ariaLabel || 'Burndown chart') + '">';

  const GRID = 5;
  for (let i = 0; i <= GRID; i++) {
    const val = Math.round((yMax / GRID) * i);
    const y = yScale(val);
    svg += '<line x1="' + PAD.left + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD.right) + '" y2="' + y.toFixed(1) + '" stroke="currentColor" stroke-opacity="0.15"/>';
    svg += '<text x="' + (PAD.left - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="sprint-stats-axis-text">' + val + '</text>';
  }
  for (let x = 0; x <= maxX; x++) {
    const px = xScale(x);
    svg += '<text x="' + px.toFixed(1) + '" y="' + (H - 16) + '" text-anchor="middle" class="sprint-stats-axis-text">D' + (x + 1) + '</text>';
  }
  svg += '<text x="' + (PAD.left + plotW / 2).toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle" class="sprint-stats-axis-text sprint-stats-axis-label">Sprint working day</text>';
  svg += '<text x="12" y="' + (PAD.top + plotH / 2).toFixed(1) + '" text-anchor="middle" transform="rotate(-90 12 ' + (PAD.top + plotH / 2).toFixed(1) + ')" class="sprint-stats-axis-text sprint-stats-axis-label">' + _esc(unitLabel) + ' remaining</text>';

  ideals.forEach((ideal) => {
    svg += '<line x1="' + xScale(ideal.start.x).toFixed(1) + '" y1="' + yScale(ideal.start.y).toFixed(1)
      + '" x2="' + xScale(ideal.end.x).toFixed(1) + '" y2="' + yScale(ideal.end.y).toFixed(1)
      + '" stroke="' + ideal.color + '" stroke-width="2" stroke-dasharray="2,4" stroke-opacity="0.75"/>';
  });

  lines.forEach((s, sIdx) => {
    if (!s.points.length) return;
    const d = s.points.map((p, i) => (i === 0 ? 'M' : 'L') + xScale(p.x).toFixed(1) + ',' + yScale(p.y).toFixed(1)).join(' ');
    svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"' + (s.isActive ? ' stroke-dasharray="4,3"' : '') + '/>';
    s.points.forEach((p, pIdx) => {
      const cx = xScale(p.x).toFixed(1);
      const cy = yScale(p.y).toFixed(1);
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="' + s.color + '" data-series="' + sIdx + '" data-point="' + pIdx + '">'
        + '<title>D' + (p.x + 1) + (p.date ? (' (' + _esc(p.date) + ')') : '') + ': ' + _esc(String(p.y)) + ' ' + _esc(unitLabel) + '</title></circle>';
    });
  });

  svg += '</svg>';
  return svg;
}

function _burndownLegendHtml(lines, ideals, labelFn) {
  return lines.map((l) => '<span class="sprint-stats-legend-item"><span class="sprint-stats-legend-line' + (l.isActive ? ' sprint-stats-legend-line--dashed' : '') + '" style="border-color:' + l.color + '"></span>'
    + _esc(labelFn(l.sprintN)) + (l.isActive ? ' (active)' : '') + '</span>').join('')
    + (ideals.length ? '<span class="sprint-stats-legend-item"><span class="sprint-stats-legend-line sprint-stats-legend-line--ideal"></span>Ideal</span>' : '');
}

/**
 * "active sprint" / "last N sprints" - never "last 1 sprints" on entry,
 * when only the active shard is loaded.
 * @param {number} n
 * @returns {string}
 */
export function burndownScopeLabel(n) {
  if (n <= 1) return 'active sprint';
  return 'last ' + n + ' sprints';
}

function _buildOneBurndownPanel(teamName, teamKey, unit, sprints, shardsByKey, palette, idealColor, labelFn, maxSprints) {
  const withData = (sprints || []).filter((sp) => {
    const shard = shardsByKey.get(sp._src + ':' + sp.sprint_n);
    const t = shard && (shard.teams || []).find((tt) => tt.team === teamKey);
    return !!(t && Array.isArray(t.burndown) && t.burndown.length);
  });

  if (!withData.length) {
    return '<div class="ds-card sprint-stats-chart-panel sprint-stats-burndown-panel">'
      + '<div class="ds-card-body"><div class="sprint-stats-panel-title">Burndown ' + _esc(teamName) + '</div>'
      + '<div class="ds-callout ds-callout--neutral"><div>No burndown data - visit a few sprint tabs or click "Show previous sprints".</div></div>'
      + '</div></div>';
  }

  const selected = withData.slice(-Math.max(1, maxSprints || BURNDOWN_SPRINT_COUNT));
  const lines = [];
  const ideals = [];
  selected.forEach((sp, idx) => {
    const shard = shardsByKey.get(sp._src + ':' + sp.sprint_n);
    const t = (shard.teams || []).find((tt) => tt.team === teamKey);
    const color = palette[Math.min(idx, palette.length - 1)];
    const isActive = sp.phase !== 'END';
    lines.push({ sprintN: sp.sprint_n, isActive, color, points: t.burndown.map((p) => ({ x: p.day_n, y: p.remaining, date: p.date })) });
    if (isActive) {
      const committed = t.summary.committed;
      const maxDay = t.burndown[t.burndown.length - 1].day_n;
      ideals.push({ color: idealColor, start: { x: 0, y: committed }, end: { x: Math.max(maxDay, 9), y: 0 } });
    }
  });

  const allY = lines.flatMap((l) => l.points.map((p) => p.y)).concat(ideals.map((i) => i.start.y));
  const maxY = allY.length ? Math.max(...allY, 10) : 10;
  const yMax = Math.ceil((maxY * 1.1) / 10) * 10;
  const allX = lines.flatMap((l) => l.points.map((p) => p.x)).concat(ideals.map((i) => i.end.x));
  const maxX = allX.length ? Math.max(...allX, 9) : 9;

  return '<div class="ds-card sprint-stats-chart-panel sprint-stats-burndown-panel">'
    + '<div class="ds-card-body"><div class="sprint-stats-panel-title">Burndown ' + _esc(teamName) + ' - ' + burndownScopeLabel(selected.length) + '</div>'
    + _buildBurndownSvg(lines, ideals, maxX, yMax, unit, 'Burndown chart: ' + teamName + ', ' + burndownScopeLabel(selected.length))
    + '<div class="sprint-stats-legend">' + _burndownLegendHtml(lines, ideals, labelFn) + '</div>'
    + '</div></div>';
}

/**
 * Burndown section: one panel per MAIN team plus one Delta panel, each up
 * to the last 4 cached sprints (3 closed + 1 active) that carry a burndown
 * array in `shardsByKey`. A team with nothing cached yet gets an explicit
 * "No data" panel, never a blank hole in the grid.
 * @param {object[]} teams buildTeamsModel() output
 * @param {Map<string, object>} shardsByKey "src:sprint_n" -> full shard
 * @param {{maxSprints?: number}} [opts] how many of the newest cached sprints
 *   to draw per panel - 1 while "Previous sprints" is collapsed, the
 *   BURNDOWN_SPRINT_COUNT default when expanded
 * @returns {{html: string}}
 */
export function buildBurndownSection(teams, shardsByKey, opts) {
  const maxSprints = (opts && opts.maxSprints) || BURNDOWN_SPRINT_COUNT;
  const panels = [];
  (teams || []).filter((t) => t.unit === 'SP').forEach((team) => {
    panels.push(_buildOneBurndownPanel(team.name, team.key || team.name, 'SP', team.sprints, shardsByKey, TEAM_PALETTES[team.name] || PLATFORM_PALETTE, TEAM_IDEAL_COLOR[team.name] || PLATFORM_IDEAL_COLOR, (n) => 'S' + n, maxSprints));
  });
  const platform = (teams || []).find((t) => t.unit === 'MD');
  if (platform) {
    panels.push(_buildOneBurndownPanel(platform.name, platform.key || platform.name, 'MD', platform.sprints, shardsByKey, PLATFORM_PALETTE, PLATFORM_IDEAL_COLOR, (n) => 'PL_' + n, maxSprints));
  }
  return { html: panels.length ? ('<div class="sprint-stats-burndown-row">' + panels.join('') + '</div>') : '' };
}

/**
 * Line/bar colour of a team: the known teams keep their palette colour, an
 * unknown team gets the next fallback token in order of first request.
 * @param {string} name
 * @returns {string}
 */
export function teamColor(name) {
  if (TEAM_IDEAL_COLOR[name]) return TEAM_IDEAL_COLOR[name];
  if (!_fallbackAssigned.has(name)) {
    _fallbackAssigned.set(name, TEAM_COLOR_FALLBACK[_fallbackAssigned.size % TEAM_COLOR_FALLBACK.length]);
  }
  return _fallbackAssigned.get(name);
}

function _fmtPct(v) {
  return (Math.round(v * 10) / 10).toFixed(1) + '%';
}

/**
 * Spillover chart: one panel, grouped bars per sprint (one bar per team), Y axis
 * 0-60 % with the 20 % threshold as a dashed line. DOM-free.
 * @param {{team_names?: string[], sprints: object[], teams: object}} aggregate spillover.json shape
 * @param {string} filterTeam 'all' or a team name
 * @returns {string}
 */
/**
 * Top of the % axis: 60 like the old screen, raised to the next 10 when a bar
 * would be taller (a 74% sprint must not be drawn as a 60% bar).
 * @param {{teams?: object}} aggregate
 * @param {string[]} teamNames teams drawn
 * @returns {number}
 */
export function spilloverYMax(aggregate, teamNames) {
  let max = 0;
  for (const n of teamNames || []) {
    const t = aggregate && aggregate.teams ? aggregate.teams[n] : null;
    for (const row of (t && Array.isArray(t.sprints) ? t.sprints : [])) {
      if (typeof row.spillover_pct === 'number' && row.spillover_pct > max) max = row.spillover_pct;
    }
  }
  return Math.max(60, Math.ceil(max / 10) * 10);
}

export function buildSpilloverChart(aggregate, filterTeam) {
  const names = (aggregate.team_names && aggregate.team_names.length ? aggregate.team_names : Object.keys(aggregate.teams || {}));
  const shown = names.filter((n) => filterTeam === 'all' || filterTeam === n);
  const sprintNs = (aggregate.sprints || []).map((s) => s.sprint_n);
  const Y_MAX = spilloverYMax(aggregate, shown);
  const BAR_W = 12;
  const GROUP_W = names.length * (BAR_W + 2) + 14;
  const PAD = { top: 16, right: 12, bottom: 44, left: 52 };
  const plotH = 220;
  const plotW = Math.max(sprintNs.length * GROUP_W, 120);
  const W = PAD.left + plotW + PAD.right;
  const H = PAD.top + plotH + PAD.bottom;
  const yScale = (v) => PAD.top + plotH - (Math.min(v, Y_MAX) / Y_MAX) * plotH;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" class="sprint-stats-chart-svg" role="img" aria-label="Spillover percentage by sprint">';
  for (let v = 0; v <= Y_MAX; v += 10) {
    const y = yScale(v).toFixed(1);
    svg += '<line x1="' + PAD.left + '" y1="' + y + '" x2="' + (W - PAD.right) + '" y2="' + y + '" stroke="currentColor" stroke-opacity="0.15"/>';
    svg += '<text x="' + (PAD.left - 8) + '" y="' + (yScale(v) + 4).toFixed(1) + '" text-anchor="end" class="sprint-stats-axis-text">' + v + '%</text>';
  }
  svg += '<line x1="' + PAD.left + '" y1="' + yScale(SPILLOVER_THRESHOLD).toFixed(1) + '" x2="' + (W - PAD.right) + '" y2="' + yScale(SPILLOVER_THRESHOLD).toFixed(1)
    + '" stroke="' + SPILLOVER_THRESHOLD_COLOR + '" stroke-width="1.5" stroke-dasharray="4,3"/>';
  svg += '<text x="' + (PAD.left + plotW / 2).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" class="sprint-stats-axis-text sprint-stats-axis-label">Sprint</text>';
  svg += '<text x="12" y="' + (PAD.top + plotH / 2).toFixed(1) + '" text-anchor="middle" transform="rotate(-90 12 ' + (PAD.top + plotH / 2).toFixed(1)
    + ')" class="sprint-stats-axis-text sprint-stats-axis-label">Spillover %</text>';

  sprintNs.forEach((n, i) => {
    const gx = PAD.left + i * GROUP_W;
    shown.forEach((name) => {
      const row = ((aggregate.teams[name] || {}).sprints || []).find((r) => r.sprint_n === n);
      if (!row) return;
      const slot = names.indexOf(name);
      const x = gx + 7 + slot * (BAR_W + 2);
      const h = (Math.min(row.spillover_pct, Y_MAX) / Y_MAX) * plotH;
      svg += '<rect class="sprint-stats-spillover-bar" x="' + x.toFixed(1) + '" y="' + (PAD.top + plotH - h).toFixed(1) + '" width="' + BAR_W
        + '" height="' + Math.max(1, h).toFixed(1) + '" fill="' + teamColor(name) + '"><title>' + _esc(name + ' ' + row.label + ': ' + _fmtPct(row.spillover_pct)) + '</title></rect>';
    });
    const sprintRow = (aggregate.sprints || [])[i];
    svg += '<text x="' + (gx + GROUP_W / 2).toFixed(1) + '" y="' + (PAD.top + plotH + 16) + '" text-anchor="middle" class="sprint-stats-axis-text">' + _esc(sprintRow.label) + '</text>';
  });
  svg += '</svg>';

  const legend = shown.map((name) => '<span class="sprint-stats-legend-item"><span class="sprint-stats-legend-swatch" style="background:' + teamColor(name) + '"></span>' + _esc(name) + '</span>').join('')
    + '<span class="sprint-stats-legend-item"><span class="sprint-stats-legend-line sprint-stats-legend-line--dashed" style="border-color:' + SPILLOVER_THRESHOLD_COLOR + '"></span>20% threshold</span>';
  return '<div class="ds-card sprint-stats-chart-panel sprint-stats-spillover-chart"><div class="ds-card-body">'
    + svg + '<div class="sprint-stats-legend">' + legend + '</div></div></div>';
}
