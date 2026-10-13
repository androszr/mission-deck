// modules/sprint-stats/client/widget.js
// Dashboard widget "Latest sprint" (contract: modules-template/README.md,
// "Dashboard widget"). Reads GET <apiBase>/overview - the trimmed index with
// every team summary - and, only for the variants that draw the burndown line,
// GET <apiBase>/sprint?main=N (one shard); paints kit blocks for the frame size.
// No static import from the core's /js/: the kit arrives as ctx.kit.
//
// SP (MAIN teams) and MD (Delta) are never summed: the donut, tiles and
// segments are MAIN in SP, Delta appears only as its own percentage row.

import { effectiveDropped, teamLabel, PHASE_LABELS } from './sprint-model.mjs';

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function _fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function _pct(done, committed) {
  return committed > 0 ? Math.max(0, Math.min(100, Math.round((done / committed) * 100))) : 0;
}

/** Tone of a completion percentage once the sprint is over; mid-sprint it is just information. */
function _tone(pct, phase) {
  if (phase !== 'END') return 'info';
  return pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'error';
}

/** Sums the MAIN teams of one index entry (all SP). */
function _sumMain(entry) {
  const sum = { committed: 0, done: 0, wip: 0, todo: 0, dropped: 0 };
  for (const t of entry.teams || []) {
    const s = t.summary || {};
    sum.committed += _num(s.committed);
    sum.done += _num(s.done);
    sum.wip += _num(s.wip);
    sum.todo += _num(s.todo);
    sum.dropped += effectiveDropped(s, entry.phase, 'SP');
  }
  return sum;
}

/**
 * Which sprint the widget shows: the board's active MAIN sprint when the index
 * has it, else the newest MAIN entry.
 * @param {object} index sprint-stats/index.json as /overview answers it
 * @returns {{entry: object, entries: object[]}|null}
 */
export function pickSprint(index) {
  const entries = ((index && index.sprints) || []).filter((e) => e.src === 'main').sort((a, b) => a.sprint_n - b.sprint_n);
  if (entries.length === 0) return null;
  const active = index.boards && index.boards.main ? index.boards.main.active_sprint_n : null;
  const entry = entries.find((e) => e.sprint_n === active) || entries[entries.length - 1];
  return { entry, entries };
}

/** "as of 11.10" from an ISO timestamp, in local time; '' when absent. */
export function asOfLabel(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return 'as of ' + String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * Burndown of the whole MAIN board (SP). Teams are summed per CALENDAR DATE and
 * only on dates every team with a burndown reports: summing by day_n would add
 * one team's September to another's October, and a date only some teams have
 * would show a fake drop. The ideal line follows the module's own rule
 * (sprint-charts.mjs): committed at day 0 down to 0 at max(last day, 9).
 * @returns {object|null} a `line` block, or null with fewer than two shared dates
 */
export function burndownBlock(shard, entry) {
  const teams = ((shard && shard.main && shard.main.teams) || []).filter((t) => Array.isArray(t.burndown) && t.burndown.length);
  if (teams.length === 0) return null;
  const perTeam = teams.map((t) => {
    const m = new Map();
    for (const p of t.burndown) if (p && p.date) m.set(p.date, _num(p.remaining));
    return m;
  });
  const dates = [...perTeam[0].keys()].filter((d) => perTeam.every((m) => m.has(d))).sort();
  if (dates.length < 2) return null;
  const remaining = dates.map((d) => perTeam.reduce((sum, m) => sum + m.get(d), 0));
  const committedOf = (t) => {
    if (t.summary && Number.isFinite(Number(t.summary.committed))) return _num(t.summary.committed);
    const e = (entry.teams || []).find((x) => x.team === t.team);
    return e && e.summary ? _num(e.summary.committed) : null;
  };
  const parts = teams.map(committedOf);
  const committed = parts.every((v) => v !== null) ? parts.reduce((a, b) => a + b, 0) : remaining[0];
  const end = Math.max(dates.length - 1, 9);
  const slots = end + 1;
  const ideal = Array.from({ length: slots }, (_, i) => Math.round(committed * (1 - i / end)));
  const values = Array.from({ length: slots }, (_, i) => (i < remaining.length ? remaining[i] : null));
  const labels = Array.from({ length: slots }, (_, i) => (i < dates.length ? dates[i].slice(8, 10) + '.' + dates[i].slice(5, 7) : ''));
  return {
    type: 'line',
    label: 'Burndown (SP) · Sprint ' + entry.sprint_n,
    labels,
    series: [
      { label: 'Remaining', values, tone: 'info', last: String(remaining[remaining.length - 1]) },
      { label: 'Ideal', values: ideal, tone: 'neutral', dashed: true },
    ],
  };
}

/**
 * The block catalogue for one answer; variants pick from it by key.
 * @param {object} data GET /overview
 * @param {object} [shard] GET /sprint?main=N, only when a variant needs the burndown
 * @returns {{blocks: Object<string, object>, empty: string|null}}
 */
export function buildBlocks(data, shard) {
  if (!data || data.storage === 'unavailable') {
    return { blocks: {}, empty: 'No sprint data. Fetch the team data in the Sync window.' };
  }
  const picked = pickSprint(data.index);
  if (!picked) return { blocks: {}, empty: 'No sprint data - refresh it in the module view.' };
  const { entry, entries } = picked;
  const prev = entries.filter((e) => e.sprint_n < entry.sprint_n).pop() || null;
  const sum = _sumMain(entry);
  const pct = _pct(sum.done, sum.committed);
  const phaseLabel = PHASE_LABELS[entry.phase] || '';
  const remaining = sum.wip + sum.todo;
  const asOf = asOfLabel(data.index.boards && data.index.boards.main ? data.index.boards.main.generated_at : null);
  const prevPct = prev ? (() => { const s = _sumMain(prev); return _pct(s.done, s.committed); })() : null;

  // One bullet row per team; the marker is the same team's result in the previous sprint.
  const prevOf = (name) => {
    const t = prev && (prev.teams || []).find((x) => x.team === name);
    return t ? _num(t.summary && t.summary.completion_pct) : null;
  };
  const rows = (entry.teams || []).map((t) => {
    const p = _num(t.summary && t.summary.completion_pct);
    const before = prevOf(t.team);
    // Mid-sprint a marker at last sprint's FINAL result reads as falling short: only once it ended.
    const marker = before !== null && entry.phase === 'END' ? { target: before } : {};
    return { label: teamLabel(t.team), value: p, max: 100, display: p + '%', tone: _tone(p, entry.phase), ...marker };
  });
  const cyb = ((data.index.sprints || []).filter((e) => e.src === 'platform').sort((a, b) => a.sprint_n - b.sprint_n)).pop();
  const cybTeam = cyb && (cyb.teams || [])[0];
  if (cybTeam) {
    const p = _num(cybTeam.summary && cybTeam.summary.completion_pct);
    rows.push({ label: teamLabel('Delta') + ' (MD)', value: p, max: 100, display: p + '%', tone: _tone(p, cyb.phase) });
  }

  const blocks = {
    donut: { type: 'donut', value: pct, max: 100, center: pct + '%', label: 'Done · Sprint ' + entry.sprint_n + (asOf ? ' · ' + asOf : '') + (phaseLabel ? ' · ' + phaseLabel : ''), tone: _tone(pct, entry.phase) },
    tiles: { type: 'tiles', tiles: [
      { label: 'Committed', value: _fmt(sum.committed) + ' SP', tone: 'neutral' },
      { label: 'Remaining', value: _fmt(remaining) + ' SP', tone: remaining > 0 ? 'warn' : 'ok' },
      { label: 'Spillover', value: _fmt(sum.dropped) + ' SP', tone: sum.dropped > 0 ? 'error' : 'neutral' },
    ] },
    bullet: { type: 'bullet', rows },
    segments: { type: 'segments', label: 'Points by status (SP)', segments: [
      { label: 'Done', value: sum.done, tone: 'ok' },
      { label: 'In progress', value: sum.wip, tone: 'info' },
      { label: 'To do', value: sum.todo, tone: 'neutral' },
      { label: 'Spillover', value: sum.dropped, tone: 'error' },
    ] },
  };
  // A running sprint against a finished one is not a comparison: only after the sprint ended.
  if (prevPct !== null && entry.phase === 'END') {
    const d = pct - prevPct;
    blocks.compare = {
      type: 'compare',
      before: { label: 'Sprint ' + prev.sprint_n, value: prevPct + '%' },
      after: { label: 'Sprint ' + entry.sprint_n, value: pct + '%' },
      delta: (d > 0 ? '+' : '') + d + ' pp',
      higherIsBetter: true,
    };
  }
  const burn = shard ? burndownBlock(shard, entry) : null;
  if (burn) blocks.line = burn;
  return { blocks, empty: null };
}

/** Which catalogue blocks each variant shows (a missing block, e.g. no burndown shard, is skipped). */
export const VARIANT_BLOCKS = {
  s: ['donut'],
  m: ['donut', 'compare', 'tiles'],
  l: ['donut', 'line', 'bullet'],
  s2: ['donut', 'compare', 'tiles'], // two blocks at most, see paint()
  m2: ['donut', 'line', 'compare', 'tiles'],
  xl: ['donut', 'tiles', 'line', 'bullet'],
};

/** @returns {string} HTML for a variant id */
export function paint(data, variantId, size, kit, shard) {
  const { blocks, empty } = buildBlocks(data, shard);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m;
  // Narrow frames (one-row, or the two-column tall one) take the first two available blocks, the 3x2 one three; a missing one
  // (no compare mid-sprint) hands its place on. Three stacked blocks do not fit two columns.
  const list = keys.map((k) => blocks[k]).filter(Boolean);
  const narrow = size.cols === 2 || (size.cols !== 6 && size.rows !== 2);
  return kit.blocks(list.slice(0, narrow ? 2 : size.cols === 6 ? 4 : 3), size);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const res = await fetch(ctx.apiBase + '/overview', { signal: ctx.signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  let shard = null;
  const wantsBurndown = (VARIANT_BLOCKS[ctx.variant.id] || []).includes('line');
  const picked = wantsBurndown ? pickSprint(data && data.index) : null;
  if (picked) {
    try {
      const sres = await fetch(ctx.apiBase + '/sprint?main=' + encodeURIComponent(picked.entry.sprint_n), { signal: ctx.signal });
      if (sres.ok) shard = await sres.json();
    } catch (e) {
      if (ctx.signal && ctx.signal.aborted) throw e;
      // The burndown is optional: the rest of the widget still paints.
    }
  }
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) {
    el.innerHTML = paint(data, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit, shard);
  }
  return () => { disposed = true; };
}
