// modules/usage-analytics/client/lib/charts.js
// Pure HTML/SVG string builders - no document/window. Colours are tokens only.

import { esc, fmtInt, fmtDayShort, fmtDay } from './format.js';

/** Daily bars (page_views) with a polyline (active_users) over them. */
export function dailyBarsSvg(daily, opts) {
  const rows = Array.isArray(daily) ? daily : [];
  const height = (opts && opts.height) || 220;
  if (!rows.length) return '';
  const W = 1000;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const maxV = Math.max(1, ...rows.map((r) => Math.max(r.page_views || 0, r.active_users || 0)));
  const step = innerW / rows.length;
  const barW = Math.max(2, step * 0.7);
  const y = (v) => padT + innerH - (v / maxV) * innerH;
  let out = '<svg viewBox="0 0 ' + W + ' ' + height + '" width="100%" height="' + height
    + '" preserveAspectRatio="none" role="img" aria-label="Daily activity: page views and active users">';
  for (let i = 0; i <= 4; i++) {
    const v = (maxV / 4) * i;
    const yy = y(v);
    out += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy
      + '" stroke="var(--body-tertiary-border)" stroke-width="1" vector-effect="non-scaling-stroke"/>'
      + '<text x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="var(--text-tertiary)">'
      + fmtInt(v) + '</text>';
  }
  const labelEvery = Math.max(1, Math.ceil(rows.length / 10));
  const pts = [];
  rows.forEach((r, i) => {
    const x = padL + i * step + (step - barW) / 2;
    const h = ((r.page_views || 0) / maxV) * innerH;
    out += '<rect x="' + x.toFixed(1) + '" y="' + (padT + innerH - h).toFixed(1) + '" width="' + barW.toFixed(1)
      + '" height="' + h.toFixed(1) + '" fill="var(--body-brand-icon)" opacity="0.85"><title>'
      + esc(fmtDay(r.date)) + ': ' + fmtInt(r.page_views) + ' page views, ' + fmtInt(r.active_users) + ' people</title></rect>';
    pts.push((padL + i * step + step / 2).toFixed(1) + ',' + y(r.active_users || 0).toFixed(1));
    if (i % labelEvery === 0) {
      out += '<text x="' + (padL + i * step + step / 2).toFixed(1) + '" y="' + (height - 8)
        + '" text-anchor="middle" font-size="11" fill="var(--text-tertiary)">' + esc(fmtDayShort(r.date)) + '</text>';
    }
  });
  out += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--state-warning-icon)" stroke-width="2"'
    + ' vector-effect="non-scaling-stroke"/></svg>';
  return out;
}

/** Label + percentage track rows. rows: [{ name|label, page_views|value }]. */
export function barListHtml(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '<p class="usage-analytics-note">No data.</p>';
  const val = (r) => (typeof r.value === 'number' ? r.value : (r.page_views || 0));
  const maxV = Math.max(1, ...list.map(val));
  return '<div class="usage-analytics-bars">' + list.map((r) => {
    const pct = Math.round((val(r) / maxV) * 100);
    return '<div class="usage-analytics-bar-row"><span class="usage-analytics-bar-label">'
      + esc(r.name || r.label || r.id) + '</span>'
      + '<span class="usage-analytics-bar-track"><span class="usage-analytics-bar-fill" style="width:' + pct + '%"></span></span>'
      + '<span class="usage-analytics-bar-value">' + fmtInt(val(r)) + '</span></div>';
  }).join('') + '</div>';
}

function tone(v) {
  if (!v) return 0;
  if (v < 5) return 1;
  if (v < 20) return 2;
  return 3;
}

/** One cell per day of the period; tone by page_views (4 token steps). */
export function activityStripHtml(daily, days) {
  const map = new Map((Array.isArray(daily) ? daily : []).map((d) => [d.date, d.page_views || 0]));
  const dates = [];
  const rows = Array.isArray(daily) ? daily : [];
  if (days && rows.length) {
    const last = new Date(rows[rows.length - 1].date + 'T12:00:00Z');
    for (let i = days - 1; i >= 0; i--) {
      dates.push(new Date(last.getTime() - i * 86400000).toISOString().slice(0, 10));
    }
  } else {
    rows.forEach((r) => dates.push(r.date));
  }
  if (!dates.length) return '<p class="usage-analytics-note">No activity.</p>';
  return '<div class="usage-analytics-strip" role="img" aria-label="Activity on each day of the period">'
    + dates.map((d) => {
      const v = map.get(d) || 0;
      return '<span class="usage-analytics-strip-cell usage-analytics-strip-cell--' + tone(v)
        + '" title="' + esc(fmtDay(d)) + ': ' + fmtInt(v) + ' page views"></span>';
    }).join('') + '</div>';
}

/** Trend badge; null -> "no comparison". */
export function deltaBadgeHtml(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) {
    return '<span class="ds-badge ds-badge--gray">no comparison</span>';
  }
  const r = Math.round(pct);
  if (r === 0) return '<span class="ds-badge ds-badge--gray">→ 0%</span>';
  if (r > 0) return '<span class="ds-badge ds-badge--green">↑ ' + r + '%</span>';
  return '<span class="ds-badge ds-badge--red">↓ ' + Math.abs(r) + '%</span>';
}
