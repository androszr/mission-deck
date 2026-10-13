// modules/prod-bugs/client/prod-bugs-charts.mjs
// Pure SVG builder, DOM-free. Port of _buildBarSvg in the original prod-bugs view.
// Every colour is a var(--...) token; no hex anywhere.

export const BAR_GROUP_W = 80;
export const CHART_H = 200;
export const CHART_PAD = { top: 16, right: 12, bottom: 32, left: 48 };
export const VISIBLE_SPRINTS = 5;

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function seriesValue(sprint, areaKey, metricKey) {
  const area = sprint && sprint.areas && sprint.areas[areaKey];
  if (!area) return null;
  const v = area[metricKey];
  return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}

/**
 * @param {object[]} sprints ascending
 * @param {string} metricKey 'bugs' | 'bugFixTime'
 * @param {(v:number)=>string} fmtY
 * @param {{key:string,label:string,color:string}[]} areaConfig
 */
export function buildBarSvg(sprints, metricKey, fmtY, areaConfig) {
  const n = sprints.length;
  const chartW = CHART_PAD.left + n * BAR_GROUP_W + CHART_PAD.right;
  const plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const barGap = 3;
  const barW = Math.max(6, (BAR_GROUP_W - (areaConfig.length + 1) * barGap) / areaConfig.length);

  const vals = [];
  for (const cfg of areaConfig) {
    for (const s of sprints) {
      const v = seriesValue(s, cfg.key, metricKey);
      if (v !== null) vals.push(v);
    }
  }
  const maxVal = vals.length ? Math.max(...vals) : 1;
  const yMax = Math.max(1, Math.ceil(maxVal * 1.15));
  const yScale = (v) => CHART_PAD.top + (1 - v / yMax) * plotH;
  const yBase = CHART_PAD.top + plotH;

  let svg = '<svg width="' + chartW + '" height="' + CHART_H + '" viewBox="0 0 ' + chartW + ' ' + CHART_H
    + '" class="prod-bugs-svg" role="img" aria-label="Bar chart per sprint">';

  const GRID = 4;
  for (let i = 0; i <= GRID; i++) {
    const val = (yMax / GRID) * i;
    const y = yScale(val);
    svg += '<line x1="' + CHART_PAD.left + '" y1="' + y + '" x2="' + (chartW - CHART_PAD.right) + '" y2="' + y
      + '" stroke="var(--border-light)" stroke-width="1"/>';
    svg += '<text x="' + (CHART_PAD.left - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="prod-bugs-axis-text" font-size="9">'
      + _esc(fmtY(val)) + '</text>';
  }

  sprints.forEach((s, idx) => {
    const groupX = CHART_PAD.left + idx * BAR_GROUP_W;
    svg += '<text x="' + (groupX + BAR_GROUP_W / 2).toFixed(1) + '" y="' + (CHART_H - 6)
      + '" text-anchor="middle" class="prod-bugs-axis-text" font-size="9">S' + _esc(String(s.sprint)) + '</text>';
    areaConfig.forEach((cfg, bi) => {
      const v = seriesValue(s, cfg.key, metricKey);
      if (v === null || v <= 0) return;
      const barX = groupX + barGap + bi * (barW + barGap);
      const barH = Math.max(2, (v / yMax) * plotH);
      svg += '<rect x="' + barX.toFixed(1) + '" y="' + (yBase - barH).toFixed(1) + '" width="' + barW.toFixed(1)
        + '" height="' + barH.toFixed(1) + '" rx="2" fill="' + cfg.color + '" opacity="0.85"><title>'
        + _esc(cfg.label) + ': ' + _esc(fmtY(v)) + '</title></rect>';
    });
    svg += '<rect x="' + groupX.toFixed(1) + '" y="' + CHART_PAD.top + '" width="' + BAR_GROUP_W
      + '" height="' + plotH + '" fill="transparent" class="prod-bugs-hover-zone" data-hover-idx="' + idx + '"/>';
  });

  return svg + '</svg>';
}

/** scrollLeft that shows the last VISIBLE_SPRINTS groups. */
export function scrollLeftForLast(count) {
  if (count <= VISIBLE_SPRINTS) return 0;
  return CHART_PAD.left + (count - VISIBLE_SPRINTS) * BAR_GROUP_W;
}
