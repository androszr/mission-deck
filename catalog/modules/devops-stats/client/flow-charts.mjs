// modules/devops-stats/client/flow-charts.mjs
// Pure SVG builders, free of document access, adapted from sprint-stats/client/sprint-charts.mjs.
// Colours are DS tokens (var(--legend-*)) or currentColor; never a hex.
// Hover detail is a native SVG <title>. The current (incomplete) bucket is
// drawn dashed (line) or hollow (bar).

export const LINE_COLORS = {
  primary: 'var(--legend-1st-primary)',
  secondary: 'var(--legend-3rd-primary)',
  tertiary: 'var(--legend-5th-primary)',
};

const W = 400;
const H = 220;
const PAD = { top: 20, right: 20, bottom: 35, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _has(v) { return v !== null && v !== undefined && Number.isFinite(v); }

function _emptyHtml() {
  return '<div class="devops-stats-chart-empty">No data in the selected period</div>';
}

function _niceMax(values) {
  const max = Math.max(...values.filter(_has), 0);
  if (max <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  return Math.ceil((max * 1.1) / step) * step;
}

function _frame(points, yMax, ariaLabel, unit, slotted) {
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" class="devops-stats-chart-svg" role="img" aria-label="' + _esc(ariaLabel) + '">';
  const GRID = 4;
  for (let i = 0; i <= GRID; i++) {
    const val = (yMax / GRID) * i;
    const y = PAD.top + (1 - val / yMax) * PLOT_H;
    svg += '<line x1="' + PAD.left + '" y1="' + y.toFixed(1) + '" x2="' + (W - PAD.right) + '" y2="' + y.toFixed(1) + '" stroke="currentColor" stroke-opacity="0.15"/>';
    svg += '<text x="' + (PAD.left - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="devops-stats-axis-text">' + _esc(Math.round(val * 10) / 10) + '</text>';
  }
  if (unit) svg += '<text x="' + PAD.left + '" y="12" class="devops-stats-axis-text">' + _esc(unit) + '</text>';
  const n = points.length;
  points.forEach((p, i) => {
    const x = slotted ? PAD.left + (PLOT_W / n) * (i + 0.5) : PAD.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
    // Skip every other label on dense axes so they stay legible.
    if (n > 8 && i % 2 !== (n - 1) % 2) return;
    svg += '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="devops-stats-axis-text">' + _esc(p.label) + '</text>';
  });
  return svg;
}

/**
 * Line chart, one line per `lines[]` entry; null values break the line.
 * @param {Array<{label:string,current?:boolean,[k:string]:any}>} points
 * @param {{lines:Array<{key:string,label:string,color:string}>,ariaLabel:string,unit?:string}} opts
 */
export function buildLineChart(points, opts) {
  const lines = opts.lines || [];
  const vals = (points || []).flatMap((p) => lines.map((l) => p[l.key]));
  if (!points || !points.length || !vals.some(_has)) return _emptyHtml();
  const yMax = _niceMax(vals);
  const n = points.length;
  const xOf = (i) => PAD.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const yOf = (v) => PAD.top + (1 - v / yMax) * PLOT_H;
  let svg = _frame(points, yMax, opts.ariaLabel, opts.unit);

  lines.forEach((l) => {
    let d = '';
    let prevIdx = -2;
    points.forEach((p, i) => {
      if (!_has(p[l.key]) || p.current) { prevIdx = -2; return; }
      d += (prevIdx === i - 1 ? ' L' : ' M') + xOf(i).toFixed(1) + ',' + yOf(p[l.key]).toFixed(1);
      prevIdx = i;
    });
    if (d) svg += '<path d="' + d.trim() + '" fill="none" stroke="' + l.color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
    // Dashed bridge to the current bucket.
    const ci = points.findIndex((p) => p.current && _has(p[l.key]));
    if (ci > 0) {
      let li = ci - 1;
      while (li >= 0 && !_has(points[li][l.key])) li--;
      if (li >= 0) {
        svg += '<path d="M' + xOf(li).toFixed(1) + ',' + yOf(points[li][l.key]).toFixed(1) + ' L' + xOf(ci).toFixed(1) + ',' + yOf(points[ci][l.key]).toFixed(1)
          + '" fill="none" stroke="' + l.color + '" stroke-width="2.5" stroke-dasharray="6,4" stroke-linecap="round"/>';
      }
    }
    points.forEach((p, i) => {
      if (!_has(p[l.key])) return;
      const title = '<title>' + _esc(l.label + ' (' + p.label + (p.current ? ', current' : '') + '): ' + p[l.key]) + '</title>';
      svg += p.current
        ? '<circle cx="' + xOf(i).toFixed(1) + '" cy="' + yOf(p[l.key]).toFixed(1) + '" r="4" fill="var(--body-primary-bg)" stroke="' + l.color + '" stroke-width="2.5">' + title + '</circle>'
        : '<circle cx="' + xOf(i).toFixed(1) + '" cy="' + yOf(p[l.key]).toFixed(1) + '" r="4" fill="' + l.color + '">' + title + '</circle>';
    });
  });
  return svg + '</svg>';
}

/**
 * Bar chart of one series (`opts.key`); the current bucket is hollow.
 * @param {Array<{label:string,current?:boolean,[k:string]:any}>} points
 * @param {{key:string,label:string,color:string,ariaLabel:string,unit?:string}} opts
 */
export function buildBarChart(points, opts) {
  const vals = (points || []).map((p) => p[opts.key]);
  if (!points || !points.length || !vals.some(_has)) return _emptyHtml();
  const yMax = _niceMax(vals);
  const n = points.length;
  const slot = PLOT_W / n;
  const barW = Math.min(28, slot * 0.6);
  let svg = _frame(points, yMax, opts.ariaLabel, opts.unit, true);
  points.forEach((p, i) => {
    const v = p[opts.key];
    if (!_has(v)) return;
    const h = (v / yMax) * PLOT_H;
    const x = PAD.left + slot * i + (slot - barW) / 2;
    const y = PAD.top + PLOT_H - h;
    const title = '<title>' + _esc(opts.label + ' (' + p.label + (p.current ? ', current' : '') + '): ' + v) + '</title>';
    svg += p.current
      ? '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="none" stroke="' + opts.color + '" stroke-width="2" stroke-dasharray="4,3">' + title + '</rect>'
      : '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + opts.color + '">' + title + '</rect>';
  });
  return svg + '</svg>';
}

/** Legend row HTML for a list of { label, color }. */
export function legendHtml(items, dashedLabel) {
  return items.map((m) => '<span class="devops-stats-legend-item"><span class="devops-stats-legend-swatch" style="background:' + m.color + '"></span>' + _esc(m.label) + '</span>').join('')
    + (dashedLabel ? '<span class="devops-stats-legend-item"><span class="devops-stats-legend-line"></span>' + _esc(dashedLabel) + '</span>' : '');
}
