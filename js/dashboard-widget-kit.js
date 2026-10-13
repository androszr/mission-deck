// ── Mission Deck — js/dashboard-widget-kit.js ─────────────────────────────
// The widget kit: visual block builders shared by every module widget on the
// dashboard. Handed to modules as `ctx.kit` by js/dashboard-widgets.js.
//
// Every builder is PURE: a plain object in, an escaped HTML string out - no document,
// no fetch, so it imports in plain Node (tests/test_dashboard_widget_kit.mjs).
// The one impure function is hydrateAvatars(root), which swaps the initials of
// `.dash-kit-av[data-person]` for a photo from the team directory.
//
// Rules the builders keep:
//   - every string from data goes through esc(), `title=` attributes included;
//   - only clamped Numbers reach a `style=""` attribute, never a string;
//   - `tone` is a closed set (ok|warn|error|info|neutral), unknown -> neutral;
//   - colours live in styles.css (`.dash-kit-*`) on DS tokens, never here.

import { loadTeamDirectory, memberByName, memberAvatarUrl, memberInitials } from './team-directory.js';

export const TONES = ['ok', 'warn', 'error', 'info', 'neutral'];

/** @param {unknown} s @returns {string} HTML-escaped text (quotes included) */
export function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** @param {unknown} t @returns {string} a member of TONES */
export function tone(t) {
  return TONES.includes(t) ? t : 'neutral';
}

/** @param {unknown} v @returns {number} finite number, 0 for anything else ("12,5 d" -> 12.5) */
export function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v === null || v === undefined ? '' : v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Initials used before the directory answers: first + last word. */
export function kitInitials(name) {
  const parts = String(name === null || name === undefined ? '' : name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * One avatar placeholder. The photo is swapped in later by hydrateAvatars().
 * @param {string} name @param {string} [t] tone @param {string} [cls] extra class
 */
function av(name, t, cls) {
  return '<span class="dash-kit-av dash-kit-t-' + tone(t || 'neutral') + (cls ? ' ' + cls : '')
    + '" data-person="' + esc(name) + '" title="' + esc(name) + '">' + esc(kitInitials(name)) + '</span>';
}

/** Small avatar next to a label. */
function avXs(name) {
  return av(name, 'neutral', 'dash-kit-av--xs');
}

// ── builders ─────────────────────────────────────────────────────────────────

/** Coloured KPI boxes. @param {{tiles?: Array}} b @param {{compact?: boolean}} [o] */
export function tiles(b, o = {}) {
  const t = ((b && b.tiles) || []).slice(0, o.compact ? 2 : 4);
  return '<div class="dash-kit-tiles">' + t.map((x) => {
    const d = x.delta ? String(x.delta) : '';
    return '<div class="dash-kit-tile dash-kit-t-' + tone(x.tone) + '">'
      + '<div class="dash-kit-tile-v">' + esc(x.value) + '</div>'
      + '<div class="dash-kit-tile-l">' + (x.person ? avXs(x.person) : '') + esc(x.label) + '</div>'
      + (d ? '<div class="dash-kit-tile-d">' + esc(d) + '</div>' : '')
      + '</div>';
  }).join('') + '</div>';
}

/** Progress ring (inline SVG). @param {{value,max,center,label,tone}} b */
export function donut(b, o = {}) {
  const max = num(b.max) || 100;
  const v = clamp(num(b.value), 0, max);
  const r = 30;
  const c = 2 * Math.PI * r;
  const f = (v / max) * c;
  const size = o.compact ? 74 : 92;
  const center = b.center !== null && b.center !== undefined ? b.center : Math.round((v / max) * 100) + '%';
  return '<div class="dash-kit-donut"><svg viewBox="0 0 80 80" width="' + size + '" height="' + size + '" aria-hidden="true">'
    + '<circle cx="40" cy="40" r="' + r + '" class="dash-kit-ring-bg"/>'
    + '<circle cx="40" cy="40" r="' + r + '" class="dash-kit-ring dash-kit-t-' + tone(b.tone) + '" stroke-dasharray="'
    + f.toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 40 40)"/>'
    + '<text x="40" y="45" text-anchor="middle" class="dash-kit-ring-t">' + esc(center) + '</text></svg>'
    + '<div class="dash-kit-tile-l">' + esc(b.label) + '</div></div>';
}

/** One big number. @param {{value,unit,label,tone}} b */
export function big(b) {
  return '<div class="dash-kit-big"><div class="dash-kit-big-v dash-kit-t-' + tone(b.tone) + '">' + esc(b.value)
    + (b.unit ? '<span class="dash-kit-big-u">' + esc(b.unit) + '</span>' : '') + '</div>'
    + '<div class="dash-kit-tile-l">' + esc(b.label) + '</div></div>';
}

/** Stacked bar with a legend. @param {{label,segments:[{label,value,tone}]}} b */
export function segments(b) {
  const s = (b.segments || []);
  const tot = s.reduce((a, x) => a + Math.max(0, num(x.value)), 0) || 1;
  return '<div class="dash-kit-seg">' + (b.label ? '<div class="dash-kit-cap">' + esc(b.label) + '</div>' : '')
    + '<div class="dash-kit-seg-bar">' + s.map((x) => '<span class="dash-kit-t-' + tone(x.tone)
      + '" style="flex-grow:' + (Math.max(0, num(x.value)) / tot).toFixed(4) + '" title="' + esc(x.label) + '"></span>').join('')
    + '</div><div class="dash-kit-legend">' + s.map((x) => '<span><i class="dash-kit-dot dash-kit-t-' + tone(x.tone)
      + '"></i>' + esc(x.label) + ' <b>' + esc(x.value) + '</b></span>').join('') + '</div></div>';
}

/** Horizontal progress bars. @param {{rows:[{label,value,max,display,tone,person}]}} b */
export function progress(b, o = {}) {
  const rows = (b.rows || []).slice(0, o.rows === 2 ? 6 : 3);
  return '<div class="dash-kit-prog">' + rows.map((x) => {
    const p = clamp((num(x.value) / (num(x.max) || 100)) * 100, 0, 100);
    const shown = x.display !== null && x.display !== undefined ? x.display : (x.max ? x.value + ' / ' + x.max : x.value);
    return '<div class="dash-kit-prow"><div class="dash-kit-prow-h"><span class="dash-kit-lbl">'
      + (x.person ? avXs(x.person) : '') + esc(x.label) + '</span><b>' + esc(shown) + '</b></div>'
      + '<div class="dash-kit-pbar"><span class="dash-kit-t-' + tone(x.tone) + '" style="width:' + p.toFixed(1) + '%"></span></div></div>';
  }).join('') + '</div>';
}

/** Vertical bars. @param {{labels,values,tone,highlightLast,label}} b */
export function bars(b, o = {}) {
  const v = (b.values || []).map(num);
  const max = Math.max(...v, 1);
  const lb = b.labels || [];
  const h = clamp(num(o.barH) || 56, 24, 200);
  const hl = b.highlightLast !== undefined ? b.highlightLast : b.highlight_last;
  return '<div class="dash-kit-bars">' + (b.label ? '<div class="dash-kit-cap">' + esc(b.label) + '</div>' : '')
    + '<div class="dash-kit-bars-row" style="height:' + h + 'px">' + v.map((x, i) => '<span class="dash-kit-t-' + tone(b.tone)
      + (hl && i === v.length - 1 ? ' dash-kit-hl' : '') + '" style="height:' + clamp((x / max) * 100, 4, 100).toFixed(1)
      + '%" title="' + esc(lb[i]) + ': ' + esc(x) + '"></span>').join('') + '</div>'
    + (lb.length && !o.compact ? '<div class="dash-kit-bars-l">' + lb.map((l) => '<span>' + esc(l) + '</span>').join('') + '</div>' : '')
    + '</div>';
}

/** Trend line with an area fill. @param {{values,tone,label}} b */
export function spark(b, o = {}) {
  const s = (b.values || []).map(num);
  if (s.length < 2) return '';
  const h = clamp((num(o.barH) || 56) - 10, 20, 70);
  const min = Math.min(...s);
  const span = (Math.max(...s) - min) || 1;
  // Same geometry as line(): slot-centred points, the stretched SVG carries
  // strokes only, the end dot is HTML so it stays round.
  const pts = s.map((v, i) => [((i + 0.5) / s.length) * 100, 100 - 6 - ((v - min) / span) * 88]);
  const ptsStr = pts.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
  const first = pts[0];
  const last = pts[pts.length - 1];
  return '<div class="dash-kit-spark dash-kit-t-' + tone(b.tone) + '">' + (b.label ? '<div class="dash-kit-cap">' + esc(b.label) + '</div>' : '')
    + '<div class="dash-kit-lc-plot" style="height:' + h + 'px">'
    + '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'
    + '<polygon points="' + first[0].toFixed(2) + ',100 ' + ptsStr + ' ' + last[0].toFixed(2) + ',100" class="dash-kit-area"/>'
    + '<polyline points="' + ptsStr + '" class="dash-kit-lc-ln" vector-effect="non-scaling-stroke"/></svg>'
    + '<i class="dash-kit-lc-dot" style="left:' + last[0].toFixed(2) + '%;top:' + last[1].toFixed(2) + '%"></i></div></div>';
}

/** Heat map. @param {{rows:string[],cols:string[],values:number[][]}} b */
export function heatmap(b) {
  const vals = b.values || [];
  const max = Math.max(1, ...vals.flat().map(num));
  return '<div class="dash-kit-heat"><table><thead><tr><th></th>' + (b.cols || []).map((c) => '<th>' + esc(c) + '</th>').join('')
    + '</tr></thead><tbody>' + vals.map((row, i) => '<tr><th>' + esc((b.rows || [])[i]) + '</th>' + row.map((v) =>
      '<td><span style="opacity:' + (0.12 + clamp(num(v) / max, 0, 1) * 0.88).toFixed(2) + '" title="' + esc(v) + '"></span></td>').join('')
    + '</tr>').join('') + '</tbody></table></div>';
}

/** People list with avatars. @param {{people:[{name,sub,tone}]}} b @param {{limit?:number,cols?:number}} [o] */
export function people(b, o = {}) {
  const all = b.people || [];
  const p = all.slice(0, o.limit || 3);
  const more = all.length - p.length;
  return '<div class="dash-kit-people' + (o.cols === 6 ? ' dash-kit-people--two' : '') + '">' + p.map((x) =>
    '<div class="dash-kit-person">' + av(x.name, x.tone) + '<span class="dash-kit-pp"><span class="dash-kit-pn">' + esc(x.name)
    + '</span><span class="dash-kit-ps">' + esc(x.sub) + '</span></span></div>').join('')
    + (more > 0 ? '<div class="dash-kit-more">+' + more + ' more</div>' : '') + '</div>';
}

/** Overlapping avatar stack with "+N". @param {{label,people:[{name,tone}],max}} b */
export function avatars(b) {
  const all = b.people || [];
  const max = clamp(Math.floor(num(b.max)) || 6, 1, 12);
  const p = all.slice(0, max);
  const more = all.length - p.length;
  return '<div class="dash-kit-avs">' + (b.label ? '<div class="dash-kit-cap">' + esc(b.label) + '</div>' : '')
    + '<div class="dash-kit-stack">' + p.map((x) => av(x.name, x.tone)).join('')
    + (more > 0 ? '<span class="dash-kit-av dash-kit-av--more">+' + more + '</span>' : '') + '</div></div>';
}

/** Timeline. @param {{events:[{date,label,tone,person}]}} b @param {{limit?:number,cols?:number}} [o] */
export function timeline(b, o = {}) {
  const e = (b.events || []).slice(0, o.limit || 3);
  return '<div class="dash-kit-tl' + (o.cols === 6 ? ' dash-kit-tl--h' : '') + '">' + e.map((x) =>
    '<div class="dash-kit-ev"><i class="dash-kit-dot dash-kit-t-' + tone(x.tone) + '"></i><span class="dash-kit-ev-d">' + esc(x.date)
    + '</span><span class="dash-kit-ev-l">' + (x.person ? avXs(x.person) : '') + esc(x.label) + '</span></div>').join('') + '</div>';
}

/** Status pill. @param {{tone,text,sub}} b */
export function pill(b) {
  return '<div class="dash-kit-pillbox"><span class="dash-kit-pill dash-kit-t-' + tone(b.tone) + '">' + esc(b.text) + '</span>'
    + (b.sub ? '<div class="dash-kit-ps">' + esc(b.sub) + '</div>' : '') + '</div>';
}

/** A short sentence for "no data" states, in the kit's own look. */
export function empty(text) {
  return '<div class="dash-kit-empty">' + esc(text) + '</div>';
}

// ── chart builders, round 2 ───────────────────────────────────────────────────

const SERIES_TONES = ['info', 'ok', 'warn', 'error', 'neutral'];
const serTone = (x, i) => tone(x && x.tone ? x.tone : SERIES_TONES[i % SERIES_TONES.length]);
const has = (v) => v !== null && v !== undefined;

/** Line chart, 1-3 series, optional dashed series and target line; y range from the data, not from zero. */
/**
 * "Nice" axis maximum and ticks: 0, step, 2*step... with step from 1/2/2.5/5 x 10^k.
 * Pure. @returns {{max:number, ticks:number[]}}
 */
export function niceScale(hi, count = 3) {
  const top = hi > 0 ? hi : 1;
  const raw = top / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((st) => st >= raw) || 10 * pow;
  const max = Math.ceil(top / step) * step;
  const ticks = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { max, ticks };
}

/**
 * Line chart: category slots with the point at the slot CENTRE, a dot on every
 * point, gridlines with a y-axis column, the last value at the line's end and
 * week labels under their own slot. The kit has no measured width, so only the
 * strokes live in a stretched SVG (non-scaling stroke keeps them even); dots,
 * labels and gridlines are HTML positioned in percent, which keeps every circle
 * round and every label under its point at any frame width.
 * @param {{label?, labels?, series:[{label,values,tone?,last?,dashed?}], target?, zero?, format?}} b
 */
export function line(b, o = {}) {
  const series = (b.series || []).slice(0, 3);
  const all = series.flatMap((x) => (x.values || []).filter((v) => has(v)).map(num));
  if (all.length < 2) return '';
  const n = Math.max(...series.map((x) => (x.values || []).length));
  const tgtV = has(b.target) ? num(b.target) : null;
  const hiRaw = Math.max(...all, tgtV === null ? -Infinity : tgtV);
  const loRaw = Math.min(...all, tgtV === null ? Infinity : tgtV);
  // Counts start at zero like the AR/Zam axis; only negative data moves the floor.
  // `zero: false` (a score that lives near its ceiling) starts at a nice step below the data.
  const tickCount = o.rows === 2 ? 4 : 2;
  let min = Math.min(0, loRaw);
  if (b.zero === false && loRaw > 0) {
    const st = niceScale(hiRaw - loRaw || hiRaw, tickCount).ticks[1] || 1;
    min = Math.floor(loRaw / st) * st;
  }
  const { max, ticks } = niceScale(hiRaw - min, tickCount);
  const top = max + min;
  const span = (top - min) || 1;
  const X = (i) => ((i + 0.5) / n) * 100;
  const Y = (v) => clamp(100 - ((v - min) / span) * 100, 0, 100);
  const h = clamp(Math.max(56, (num(o.barH) || 56) + (o.rows === 2 ? 30 : 0)), 48, 180);
  const fmt = (v) => esc(String(Math.round(v * 10) / 10).replace('.', ','));
  const grid = ticks.map((t) => '<i class="dash-kit-lc-grid" style="top:' + Y(t + min).toFixed(2) + '%"></i>').join('');
  const yLab = o.compact ? '' : ticks.map((t) => '<span style="top:' + Y(t + min).toFixed(2) + '%">' + fmt(t + min) + '</span>').join('');
  const tgt = tgtV === null ? '' : '<i class="dash-kit-lc-tgt" style="top:' + Y(tgtV).toFixed(2) + '%"></i>';
  let strokes = '';
  let dots = '';
  let ends = '';
  const endList = [];
  series.forEach((x, si) => {
    const t = serTone(x, si);
    const vals = x.values || [];
    const pts = [];
    vals.forEach((v, i) => { if (has(v)) pts.push([X(i), Y(num(v)), i, num(v)]); });
    if (pts.length === 0) return;
    strokes += '<polyline class="dash-kit-lc-ln dash-kit-t-' + t + (x.dashed ? ' dash-kit-dash' : '') + '" points="'
      + pts.map((p) => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ') + '" vector-effect="non-scaling-stroke"/>';
    if (!x.dashed) {
      const showAll = !o.compact && n <= 16;
      pts.forEach((p, k) => {
        if (!showAll && k !== pts.length - 1) return;
        dots += '<i class="dash-kit-lc-dot dash-kit-t-' + t + '" style="left:' + p[0].toFixed(2) + '%;top:' + p[1].toFixed(2) + '%" title="'
          + esc((b.labels || [])[p[2]] || '') + ' ' + esc(x.label || '') + ': ' + fmt(p[3]) + '"></i>';
      });
    }
    const last = pts[pts.length - 1];
    if (!o.compact) endList.push({ y: last[1], t, text: has(x.last) ? esc(x.last) : fmt(last[3]) });
  });
  // End labels never overlap: walk them top to bottom and keep a 12px gap,
  // then pull the stack back up if it ran past the bottom edge.
  const gap = (12 / h) * 100;
  endList.sort((a, c) => a.y - c.y);
  for (let k = 1; k < endList.length; k += 1) endList[k].y = Math.max(endList[k].y, endList[k - 1].y + gap);
  for (let k = endList.length - 1; k >= 0; k -= 1) {
    const limit = k === endList.length - 1 ? 100 : endList[k + 1].y - gap;
    endList[k].y = Math.min(endList[k].y, limit);
  }
  ends = endList.map((e) => '<span class="dash-kit-t-' + e.t + '" style="top:' + e.y.toFixed(2) + '%">' + e.text + '</span>').join('');
  const lb = b.labels || [];
  const step = n > 12 ? 3 : n > 8 ? 2 : 1;
  const xl = lb.length && !o.compact
    ? '<div class="dash-kit-lc-x" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr))">'
      + Array.from({ length: n }, (_, i) => '<span>' + ((i % step === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= step) ? esc(lb[i] || '') : '') + '</span>').join('') + '</div>'
    : '';
  const legend = series.length > 1 && !o.compact
    ? '<div class="dash-kit-legend">' + series.map((x, si) => '<span><i class="dash-kit-dot dash-kit-t-' + serTone(x, si) + '"></i>' + esc(x.label) + (has(x.last) ? ' <b>' + esc(x.last) + '</b>' : '') + '</span>').join('') + '</div>' : '';
  return '<div class="dash-kit-linebox' + (o.compact ? ' dash-kit-lc--compact' : '') + '">' + (b.label ? '<div class="dash-kit-cap">' + esc(b.label) + '</div>' : '')
    + '<div class="dash-kit-lc">'
    + '<div class="dash-kit-lc-y" style="height:' + h + 'px">' + yLab + '</div>'
    + '<div class="dash-kit-lc-plot" style="height:' + h + 'px">' + grid + tgt
    + '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + strokes + '</svg>' + dots + '</div>'
    + '<div class="dash-kit-lc-end" style="height:' + h + 'px">' + ends + '</div>'
    + '</div>' + (xl ? '<div class="dash-kit-lc-xrow">' + xl + '</div>' : '') + legend + '</div>';
}
export function area(b, o = {}) {
  const series = (b.series || []).slice(0, 5);
  if (series.length === 0) return '';
  const n = Math.max(...series.map((x) => (x.values || []).length));
  if (n < 2) return '';
  const w = 300;
  const h = Math.max(48, num(o.barH) || 56);
  const sums = Array.from({ length: n }, (_, i) => series.reduce((a, x) => a + Math.max(0, num((x.values || [])[i])), 0));
  const max = Math.max(...sums, 1);
  const X = (i) => (i / Math.max(1, n - 1)) * w;
  let base = Array(n).fill(0);
  const layers = series.map((x, si) => {
    const top = base.map((b0, i) => b0 + Math.max(0, num((x.values || [])[i])));
    const up = top.map((v, i) => X(i).toFixed(1) + ',' + (h - (v / max) * h).toFixed(1));
    const down = base.map((v, i) => X(i).toFixed(1) + ',' + (h - (v / max) * h).toFixed(1)).reverse();
    base = top;
    return '<polygon class="dash-kit-ar dash-kit-t-' + serTone(x, si) + '" points="' + up.concat(down).join(' ') + '"/>';
  }).join('');
  return '<div class="dash-kit-area-box">' + (b.label ? '<div class="dash-kit-cap">' + esc(b.label) + '</div>' : '')
    + '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" aria-hidden="true">' + layers + '</svg>'
    + (o.compact ? '' : '<div class="dash-kit-legend">' + series.map((x, si) => '<span><i class="dash-kit-dot dash-kit-t-' + serTone(x, si) + '"></i>' + esc(x.label) + '</span>').join('') + '</div>') + '</div>';
}

/** Half-circle gauge with tone zones and a needle. */
export function gauge(b) {
  const min = num(b.min);
  const max = num(b.max) || 100;
  const range = (max - min) || 1;
  const v = clamp(num(b.value), min, max);
  const f = (v - min) / range;
  const c = Math.PI * 40;
  const arc = 'M10 50 A40 40 0 0 1 90 50';
  const zones = (b.zones || []).map((z) => {
    const a = clamp((num(z.from) - min) / range, 0, 1);
    const e = clamp((num(z.to) - min) / range, 0, 1);
    return '<path d="' + arc + '" class="dash-kit-gz dash-kit-t-' + tone(z.tone) + '" stroke-dasharray="0 ' + (a * c).toFixed(1) + ' ' + (Math.max(0, e - a) * c).toFixed(1) + ' ' + c.toFixed(1) + '"/>';
  }).join('');
  const ang = Math.PI * (1 - f);
  const nx = 50 + 34 * Math.cos(ang);
  const ny = 50 - 34 * Math.sin(ang);
  return '<div class="dash-kit-gauge"><svg viewBox="0 0 100 60" width="120" height="72" aria-hidden="true"><path d="' + arc + '" class="dash-kit-gbg"/>'
    + (zones || '<path d="' + arc + '" class="dash-kit-gz dash-kit-t-' + tone(b.tone) + '" stroke-dasharray="' + (f * c).toFixed(1) + ' ' + c.toFixed(1) + '"/>')
    + '<line x1="50" y1="50" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" class="dash-kit-needle"/><circle cx="50" cy="50" r="3" class="dash-kit-hub"/></svg>'
    + '<div><div class="dash-kit-big-v dash-kit-sm">' + esc(has(b.center) ? b.center : b.value) + '</div><div class="dash-kit-tile-l">' + esc(b.label) + '</div></div></div>';
}

/** Value against a target marker. @param {{rows:[{label,value,target,max,display,tone}]}} b */
export function bullet(b) {
  const rows = b.rows || [b];
  return '<div class="dash-kit-bullet">' + rows.map((x) => {
    const max = num(x.max) || Math.max(num(x.value), num(x.target)) * 1.2 || 1;
    const p = clamp((num(x.value) / max) * 100, 0, 100);
    const t = clamp((num(x.target) / max) * 100, 0, 100);
    return '<div class="dash-kit-bl"><div class="dash-kit-prow-h"><span>' + esc(x.label) + '</span><b>' + esc(has(x.display) ? x.display : x.value)
      + (has(x.target) ? ' <span class="dash-kit-sub">cel ' + esc(x.target) + '</span>' : '') + '</b></div>'
      + '<div class="dash-kit-bl-track"><span class="dash-kit-bl-bar dash-kit-t-' + tone(x.tone) + '" style="width:' + p.toFixed(1) + '%"></span>'
      + (has(x.target) ? '<i class="dash-kit-bl-tgt" style="left:' + t.toFixed(1) + '%"></i>' : '') + '</div></div>';
  }).join('') + '</div>';
}

/** Funnel with step-to-step conversion %. */
export function funnel(b) {
  const st = b.steps || [];
  const max = Math.max(1, ...st.map((x) => num(x.value)));
  return '<div class="dash-kit-funnel">' + (b.label ? '<div class="dash-kit-cap">' + esc(b.label) + '</div>' : '') + st.map((x, i) => {
    const p = (num(x.value) / max) * 100;
    const conv = i ? Math.round((num(x.value) / (num(st[i - 1].value) || 1)) * 100) : null;
    return '<div class="dash-kit-fn"><span class="dash-kit-fn-bar dash-kit-t-' + tone(x.tone || 'info') + '" style="width:' + clamp(p, 8, 100).toFixed(1) + '%">' + esc(x.value)
      + '</span><span class="dash-kit-fn-l">' + esc(x.label) + (conv !== null ? ' <span class="dash-kit-sub">' + conv + '%</span>' : '') + '</span></div>';
  }).join('') + '</div>';
}

/** 10x10 share grid. */
export function waffle(b) {
  const parts = b.parts || [{ value: num(b.value), tone: b.tone || 'ok', label: b.label }];
  const cells = [];
  parts.forEach((x) => { for (let i = 0; i < Math.round(clamp(num(x.value), 0, 100)); i += 1) cells.push(tone(x.tone)); });
  while (cells.length < 100) cells.push('empty');
  const first = parts[0] || {};
  return '<div class="dash-kit-waffle"><div class="dash-kit-wf">' + cells.slice(0, 100).map((t) => (t === 'empty' ? '<i class="dash-kit-e"></i>' : '<i class="dash-kit-t-' + t + '"></i>')).join('')
    + '</div><div><div class="dash-kit-big-v dash-kit-sm">' + esc(has(b.center) ? b.center : num(first.value) + '%') + '</div><div class="dash-kit-tile-l">' + esc(b.caption || first.label || '') + '</div></div></div>';
}

/** Multi-segment ring with a legend. */
export function pie(b, o = {}) {
  const s = b.segments || [];
  const tot = s.reduce((a, x) => a + Math.max(0, num(x.value)), 0) || 1;
  const r = 30;
  const c = 2 * Math.PI * r;
  let off = 0;
  const arcs = s.map((x) => {
    const len = (Math.max(0, num(x.value)) / tot) * c;
    const el = '<circle cx="40" cy="40" r="' + r + '" class="dash-kit-ring dash-kit-butt dash-kit-t-' + tone(x.tone) + '" stroke-dasharray="' + len.toFixed(1) + ' ' + (c - len).toFixed(1)
      + '" stroke-dashoffset="' + (-off).toFixed(1) + '" transform="rotate(-90 40 40)"/>';
    off += len;
    return el;
  }).join('');
  const size = o.compact ? 74 : 92;
  return '<div class="dash-kit-donut"><svg viewBox="0 0 80 80" width="' + size + '" height="' + size + '" aria-hidden="true"><circle cx="40" cy="40" r="' + r + '" class="dash-kit-ring-bg"/>' + arcs
    + '<text x="40" y="45" text-anchor="middle" class="dash-kit-ring-t">' + esc(has(b.center) ? b.center : tot) + '</text></svg>'
    + (o.compact ? '' : '<div class="dash-kit-legend dash-kit-col">' + s.map((x) => '<span><i class="dash-kit-dot dash-kit-t-' + tone(x.tone) + '"></i>' + esc(x.label) + ' <b>' + esc(x.value) + '</b></span>').join('') + '</div>') + '</div>';
}

/** Month grid with an intensity per day; null = no data. */
export function calendar(b) {
  const days = b.days || [];
  const first = clamp(Math.floor(num(b.firstWeekday) || 1) - 1, 0, 6);
  const max = Math.max(1, ...days.map((v) => (v === null ? 0 : num(v))));
  const cells = Array(first).fill('<i class="dash-kit-e"></i>').concat(days.map((v, i) =>
    '<i style="opacity:' + (v === null ? '0.08' : (0.15 + (clamp(num(v), 0, max) / max) * 0.85).toFixed(2)) + '" title="' + (i + 1) + ': ' + esc(v === null ? '-' : v) + '"></i>'));
  return '<div class="dash-kit-cal-box">' + (b.label ? '<div class="dash-kit-cap">' + esc(b.label) + '</div>' : '')
    + '<div class="dash-kit-cal-h">' + ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => '<span>' + d + '</span>').join('') + '</div>'
    + '<div class="dash-kit-cal">' + cells.join('') + '</div></div>';
}

/** Before/after with an arrow; higherIsBetter decides the tone. */
export function compare(b) {
  const a = b.before || {};
  const c = b.after || {};
  const d = num(c.value) - num(a.value);
  const up = d >= 0;
  const good = b.higherIsBetter === false ? !up : up;
  return '<div class="dash-kit-cmp"><div class="dash-kit-cmp-c"><div class="dash-kit-tile-l">' + esc(a.label) + '</div><div class="dash-kit-cmp-v dash-kit-muted">' + esc(a.value) + '</div></div>'
    + '<div class="dash-kit-cmp-arrow dash-kit-t-' + (good ? 'ok' : 'error') + '">' + (up ? '▲' : '▼') + ' ' + esc(has(b.delta) ? b.delta : (up ? '+' : '') + d) + '</div>'
    + '<div class="dash-kit-cmp-c"><div class="dash-kit-tile-l">' + esc(c.label) + '</div><div class="dash-kit-cmp-v">' + esc(c.value) + '</div></div></div>';
}

/** Ordered rows with bars and optional avatars. */
export function rank(b, o = {}) {
  const it = (b.items || []).slice(0, o.limit > 1 ? o.limit : 3);
  const max = Math.max(1, ...it.map((x) => num(x.value)));
  return '<div class="dash-kit-rank">' + (b.label ? '<div class="dash-kit-cap">' + esc(b.label) + '</div>' : '') + it.map((x, i) =>
    '<div class="dash-kit-rk"><span class="dash-kit-rk-n">' + (i + 1) + '</span><span class="dash-kit-rk-l">' + (x.person ? avXs(x.person) : '') + esc(x.label)
    + '</span><span class="dash-kit-rk-bar"><span class="dash-kit-t-' + tone(x.tone || 'info') + '" style="width:' + clamp((num(x.value) / max) * 100, 0, 100).toFixed(1) + '%"></span></span><b>'
    + esc(has(x.display) ? x.display : x.value) + '</b></div>').join('') + '</div>';
}

/** Big value + delta arrow + sparkline. */
export function trend(b) {
  const d = String(has(b.delta) ? b.delta : '');
  // No change ('', '0', '+0', '0 pp', '-0,0') is flat and neutral, never a red arrow.
  const flat = !/[1-9]/.test(d);
  const up = !d.startsWith('-') && !d.startsWith('−');
  const good = b.higherIsBetter === false ? !up : up;
  const t = flat ? 'neutral' : (good ? 'ok' : 'error');
  return '<div class="dash-kit-trend"><div class="dash-kit-big-v dash-kit-t-neutral">' + esc(b.value) + (b.unit ? '<span class="dash-kit-big-u">' + esc(b.unit) + '</span>' : '') + '</div>'
    + '<div class="dash-kit-tr-d dash-kit-t-' + t + '">' + (flat ? '→' : (up ? '↗' : '↘')) + ' ' + esc(d) + ' <span class="dash-kit-sub">' + esc(b.period || '') + '</span></div>'
    + '<div class="dash-kit-tile-l">' + esc(b.label) + '</div>' + (b.values ? spark({ values: b.values, tone: t === 'neutral' ? 'info' : t }, { barH: 40 }) : '') + '</div>';
}

const RENDERERS = { line, area, gauge, bullet, funnel, waffle, pie, calendar, compare, rank, trend, tiles, donut, big, segments, progress, bars, spark, heatmap, people, avatars, timeline, pill };

/**
 * Lay a list of blocks out for a frame size: stacked in narrow/tall frames,
 * side by side in 6-column ones. Limits (rows of a list, bar height) follow the
 * frame so a tall frame shows MORE, not the same thing bigger.
 * @param {Array<{type: string}>} list
 * @param {{cols?: number, rows?: number}} [size]
 * @returns {string}
 */
export function blocks(list, size = {}) {
  const cols = size.cols || 3;
  const rows = size.rows || 1;
  const picked = (Array.isArray(list) ? list : []).filter((b) => b && Object.prototype.hasOwnProperty.call(RENDERERS, b.type));
  if (picked.length === 0) return '';
  const compact = cols === 2 && rows === 1;
  const multi = picked.length > 1 && cols !== 6;
  const limit = rows === 2
    ? (cols === 6 ? 6 : multi ? (cols === 3 ? 4 : 3) : 6)
    : (cols === 6 ? 4 : cols === 3 ? 2 : 1);
  const barH = rows === 2 ? (multi ? 64 : 120) : 56;
  const o = { compact, rows, cols, limit, barH };
  const dir = cols === 6 ? 'row' : 'col';
  return '<div class="dash-kit-blocks dash-kit-blocks--' + dir + ' dash-kit-n' + Math.min(picked.length, 4) + '">'
    + picked.map((b) => RENDERERS[b.type](b, o)).join('') + '</div>';
}

/**
 * Swap the initials of every `[data-person]` avatar under `root` for the team
 * photo. Waits for the directory first - memberByName() answers null while the
 * cache is empty. A missing photo, a broken image or a detached root all leave
 * the initials in place.
 * @param {ParentNode} root
 * @returns {Promise<void>}
 */
export async function hydrateAvatars(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  try { await loadTeamDirectory(); } catch { /* initials are the fallback */ }
  if (root.isConnected === false) return;
  root.querySelectorAll('.dash-kit-av[data-person]').forEach((el) => {
    if (el.dataset.hydrated === '1' || el.isConnected === false) return;
    el.dataset.hydrated = '1';
    const name = el.dataset.person;
    const member = memberByName(name);
    if (!member) return;
    const url = memberAvatarUrl(member);
    if (!url) {
      el.textContent = memberInitials(name);
      return;
    }
    const initials = el.textContent;
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    img.className = 'dash-kit-av-img';
    img.addEventListener('error', () => { el.textContent = initials; });
    el.textContent = '';
    el.appendChild(img);
  });
}

/** The object handed to module widgets as `ctx.kit`. */
export const kit = {
  tiles, donut, big, segments, progress, bars, spark, heatmap, people, avatars, timeline, pill, line, area, gauge, bullet, funnel, waffle, pie, calendar, compare, rank, trend, empty, blocks, hydrateAvatars, esc,
};
