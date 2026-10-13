// modules/gantt-roadmap/client/export-html.js
// Builds a standalone HTML file from current roadmap data.
// Avatars: initials only (embedding photos as data-URI would require
// fetching potentially 26 images; the initials fallback keeps the export
// fast and always reproducible without network access).
//
// Usage:
//   import { buildExportHtml } from './export-html.js';
//   const html = await buildExportHtml({ quarter, areas, tasks, backlog, teamDir });
//   // html is a self-contained UTF-8 string with all data embedded inline.

import { monthSegsByDay, sprintSegs, dayPct, phaseLanes, weekLabel, AREA_COLORS } from './gantt.js';

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _pad2(n) { return String(n).padStart(2, '0'); }

function _displayN(task) { return 'T' + _pad2(task.n || 0); }

function _initials(person) {
  if (!person) return '?';
  const n = person.n || person.id || '?';
  const parts = n.split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return n[0].toUpperCase();
}

function _avatarSvg(person) {
  const ini = _initials(person);
  return '<span class="gr-av" title="' + _esc((person && person.n) || '') + '">'
    + '<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">'
    + '<circle cx="14" cy="14" r="14" style="fill:var(--gr-av-bg)"/>'
    + '<text x="14" y="19" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="700" style="fill:var(--gr-av-fg)">'
    + _esc(ini) + '</text></svg>'
    + '</span>';
}

function _barPct(s, l, weeksN) {
  const pct = 100 / weeksN;
  return { left: (s - 1) * pct, width: l * pct };
}

function _areaColorClass(color) {
  return 'gr-exp-area-' + (AREA_COLORS.includes(color) ? color : 'gray');
}

function _weekMondayLabel(mondayFirst, weekIndex) {
  const d = new Date(mondayFirst + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + weekIndex * 7);
  return (d.getUTCDate()) + '.' + _pad2(d.getUTCMonth() + 1);
}

// Day-precise today percentage within gantt area (for today line).
function _todayLinePct(mondayFirst, weeksN) {
  const daysN = weeksN * 7;
  const now = Date.now();
  const base = new Date(mondayFirst + 'T00:00:00Z').getTime();
  const dayOff = (now - base) / (24 * 3600 * 1000);
  if (dayOff < 0 || dayOff >= daysN) return -1;
  return dayPct(dayOff, daysN);
}

// Week index for header column tint only.
function _todayWeek(mondayFirst, weeksN) {
  const now = Date.now();
  const base = new Date(mondayFirst + 'T00:00:00Z').getTime();
  const weekIdx = Math.floor((now - base) / (7 * 24 * 3600 * 1000));
  if (weekIdx < 0 || weekIdx >= weeksN) return -1;
  return weekIdx;
}

function _buildStyles(weeksN) {
  return `
<style>
:root{
--gr-av-bg:#e5e5e5;--gr-av-fg:#595959;
--gr-c-text:#262626;--gr-c-muted:#8c8c8c;--gr-c-faint:#bfbfbf;--gr-c-border:#e5e5e5;--gr-c-divider:#f2f2f2;--gr-c-today-line:rgba(0,176,90,0.9);--gr-c-xmas:rgba(252,232,232,0.5);--gr-c-sprint:#b04f14;
--gr-exp-area-blue-fg:#316ee8;--gr-exp-area-blue-bg:#e8effc;
--gr-exp-area-green-fg:#0d732f;--gr-exp-area-green-bg:#e8fcef;
--gr-exp-area-teal-fg:#12a141;--gr-exp-area-teal-bg:#d1fadf;
--gr-exp-area-yellow-fg:#b28500;--gr-exp-area-yellow-bg:#fff9e5;
--gr-exp-area-orange-fg:#cc6600;--gr-exp-area-orange-bg:#fff2e5;
--gr-exp-area-red-fg:#b81414;--gr-exp-area-red-bg:#fce8e8;
--gr-exp-area-gray-fg:#595959;--gr-exp-area-gray-bg:#f2f2f2;
--gr-exp-area-violet-fg:#3d14b8;--gr-exp-area-violet-bg:#ede8fc;
--gr-exp-area-magenta-fg:#b814b8;--gr-exp-area-magenta-bg:#fce8fc;
--gr-exp-area-cyan-fg:#0d6b73;--gr-exp-area-cyan-bg:#e8fbfc;
--gr-exp-area-brand-fg:#8c4213;--gr-exp-area-brand-bg:#fffaf4;
--gr-exp-area-navy-fg:#0d2f73;--gr-exp-area-navy-bg:#d1dffa;
}
.gr-exp-area-blue{--gr-exp-fg:var(--gr-exp-area-blue-fg);--gr-exp-bg:var(--gr-exp-area-blue-bg)}
.gr-exp-area-green{--gr-exp-fg:var(--gr-exp-area-green-fg);--gr-exp-bg:var(--gr-exp-area-green-bg)}
.gr-exp-area-teal{--gr-exp-fg:var(--gr-exp-area-teal-fg);--gr-exp-bg:var(--gr-exp-area-teal-bg)}
.gr-exp-area-yellow{--gr-exp-fg:var(--gr-exp-area-yellow-fg);--gr-exp-bg:var(--gr-exp-area-yellow-bg)}
.gr-exp-area-orange{--gr-exp-fg:var(--gr-exp-area-orange-fg);--gr-exp-bg:var(--gr-exp-area-orange-bg)}
.gr-exp-area-red{--gr-exp-fg:var(--gr-exp-area-red-fg);--gr-exp-bg:var(--gr-exp-area-red-bg)}
.gr-exp-area-gray{--gr-exp-fg:var(--gr-exp-area-gray-fg);--gr-exp-bg:var(--gr-exp-area-gray-bg)}
.gr-exp-area-violet{--gr-exp-fg:var(--gr-exp-area-violet-fg);--gr-exp-bg:var(--gr-exp-area-violet-bg)}
.gr-exp-area-magenta{--gr-exp-fg:var(--gr-exp-area-magenta-fg);--gr-exp-bg:var(--gr-exp-area-magenta-bg)}
.gr-exp-area-cyan{--gr-exp-fg:var(--gr-exp-area-cyan-fg);--gr-exp-bg:var(--gr-exp-area-cyan-bg)}
.gr-exp-area-brand{--gr-exp-fg:var(--gr-exp-area-brand-fg);--gr-exp-bg:var(--gr-exp-area-brand-bg)}
.gr-exp-area-navy{--gr-exp-fg:var(--gr-exp-area-navy-fg);--gr-exp-bg:var(--gr-exp-area-navy-bg)}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:var(--gr-c-text);background:#fff}
h1{font-size:20px;font-weight:700;margin:0 0 4px}
.meta{color:var(--gr-c-muted);font-size:12px;margin-bottom:24px}
.gr-gantt-wrap{overflow-x:auto;border:1px solid var(--gr-c-border);border-radius:8px}
.gr-gantt{width:100%}
.gr-row{display:grid;grid-template-columns:310px minmax(0,1fr);align-items:stretch}
.gr-weeks-inner{display:grid;grid-template-columns:repeat(${weeksN},1fr);align-items:stretch}
.gr-month-row{display:grid;grid-template-columns:var(--gr-label-w,310px) minmax(0,1fr);align-items:stretch}
.gr-month-band{flex:1;display:flex;min-width:0;overflow:hidden}
.gr-sprint-band{flex:1;position:relative;height:20px;overflow:hidden;background:#ede8fc}
.gr-sprint-abs{position:absolute;top:0;bottom:0;display:flex;align-items:center;justify-content:center;padding:0 4px;font-size:9px;font-weight:600;color:#3d14b8;border-left:2px solid #9d8dda;overflow:hidden}
.gr-head-cell{padding:4px 6px;font-size:11px;color:var(--gr-c-muted);border-right:1px solid var(--gr-c-divider);border-bottom:1px solid var(--gr-c-border);background:#fff;position:sticky;top:0;z-index:2}
.gr-label-cell{padding:4px 8px;border-right:1px solid var(--gr-c-border);background:#fff;position:sticky;left:0;z-index:1;font-size:13.5px;overflow:hidden;display:flex;align-items:center;gap:4px;min-height:44px}
.gr-month-cell{background:#fff;border-right:1px solid var(--gr-c-divider);font-weight:600;font-size:11px;color:var(--gr-c-muted);height:24px;display:flex;align-items:center;padding:0 4px;flex-shrink:0;overflow:hidden}
.gr-week-cell{background:#fff;border-right:1px solid var(--gr-c-divider);height:36px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;color:var(--gr-c-muted)}
.gr-week-no{font-weight:600;color:var(--gr-c-text);font-size:10px}
.gr-week-date{font-size:9px;color:var(--gr-c-faint)}
.gr-group-header{background:var(--gr-exp-bg,var(--gr-c-divider));border-top:2px solid var(--gr-c-border);border-bottom:1px solid var(--gr-c-border);padding:6px 8px;font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;position:sticky;left:0;z-index:1}
.gr-color-dot{width:10px;height:10px;border-radius:50%;background:var(--gr-exp-fg,var(--gr-c-muted))}
.gr-group-note{padding:2px 8px 6px;font-size:11px;color:var(--gr-c-muted);position:sticky;left:0;background:#fff}
.gr-task-row{border-bottom:1px solid var(--gr-c-divider);min-height:44px;display:grid;grid-template-columns:310px minmax(0,1fr)}
.gr-task-n{font-size:10px;font-weight:600;color:var(--gr-c-muted);min-width:36px}
.gr-task-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13.5px}
.gr-avatars{display:flex;gap:0;flex-shrink:0}
.gr-avatars .gr-av{margin-left:-5px;box-shadow:0 0 0 2px #fff}
.gr-avatars .gr-av:first-child{margin-left:0}
.gr-av{width:28px;height:28px;border-radius:50%;background:var(--gr-av-bg);color:var(--gr-av-fg);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
.gr-av img{width:100%;height:100%;object-fit:cover}
.gr-lane{position:relative;min-height:44px}
.gr-lane-bg{position:absolute;inset:0;display:grid;grid-template-columns:repeat(${weeksN},1fr)}
.gr-lane-bg-cell{border-right:1px solid var(--gr-c-divider)}
.gr-lane-bg-cell.gr-xmas{background:var(--gr-c-xmas)}
.gr-today-line{position:absolute;top:0;bottom:0;width:2px;background:var(--gr-c-today-line);z-index:2;pointer-events:none}
.gr-bar{position:absolute;top:9px;height:26px;border-radius:4px;display:flex;align-items:center;overflow:hidden;box-sizing:border-box;background:var(--gr-exp-bg);border:1px solid var(--gr-exp-fg)}
.gr-bar-label{font-size:13px;padding:0 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--gr-exp-fg)}
.gr-phase-bar{position:absolute;height:26px;border-radius:4px;display:flex;align-items:center;overflow:hidden;box-sizing:border-box;background:var(--gr-exp-bg);border:1px solid var(--gr-exp-fg)}
.gr-phase-label{font-size:13px;padding:0 12px;color:var(--gr-exp-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gr-milestone{width:16px!important;height:16px;top:14px;transform:rotate(45deg);border-radius:3px;background:var(--gr-exp-bg);border:2px solid var(--gr-exp-fg)}
.gr-today-head{background:rgba(176,79,20,0.06)}
.gr-xmas-head{background:var(--gr-c-xmas)}
.gr-section-head{margin-top:32px;border-top:2px solid var(--gr-c-border);padding-top:16px}
.gr-section-head h2{font-size:16px;font-weight:700;margin:0 0 8px}
.gr-bl-item{padding:8px;border-bottom:1px solid var(--gr-c-divider);font-size:13px}
.gr-footer{margin-top:32px;font-size:11px;color:var(--gr-c-faint);text-align:center}
.gr-ms-badge{font-size:9px;background:var(--gr-c-divider);color:var(--gr-c-muted);border-radius:3px;padding:1px 4px;margin-left:4px}
.gr-group-note-inline{font-size:11px;font-weight:400;color:var(--gr-c-muted);margin-left:6px}
</style>`;
}

export async function buildExportHtml({ quarter, areas, tasks, backlog }) {
  const mondayFirst = quarter.mondayFirst || '2026-09-21';
  const weeksN = quarter.weeksN || 14;
  const daysN = weeksN * 7;
  const weekFirstNo = quarter.weekFirstNo || 39;
  const xmasWeek = quarter.xmasWeek || null;
  const sprints = quarter.sprints || [];
  const roster = quarter.roster || [];
  const todayLinePct = _todayLinePct(mondayFirst, weeksN);
  const todayWeekIdx = _todayWeek(mondayFirst, weeksN);

  const sortedAreas = [...(areas || [])].sort((a, b) => (a.o || 0) - (b.o || 0));
  const sortedTasks = [...(tasks || [])];

  // Build roster map
  const rosterById = Object.fromEntries(roster.map((p) => [p.id, p]));

  // --- Header section ---
  const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const qLabel = quarter.label || (quarter.id || 'Q4 2026');

  let headerHtml = _buildStyles(weeksN)
    + '<h1>Gantt roadmap - ' + _esc(qLabel) + '</h1>'
    + '<div class="meta">Generated: ' + now + ' · ' + tasks.length + ' tasks · ' + sortedAreas.length + ' areas</div>';

  // --- Month row (day-precision widths, item 1) ---
  const monthSegsDay = monthSegsByDay(mondayFirst, daysN);
  let monthRowHtml = '<div class="gr-month-row">';
  monthRowHtml += '<div class="gr-month-cell gr-head-cell" style="width:310px;flex-shrink:0">Task</div>';
  monthRowHtml += '<div class="gr-month-band">';
  monthSegsDay.forEach((seg) => {
    const widthPct = (seg.days / daysN * 100).toFixed(4);
    monthRowHtml += '<div class="gr-month-cell gr-head-cell" style="flex:0 0 ' + widthPct + '%;overflow:hidden">' + _esc(seg.label) + '</div>';
  });
  monthRowHtml += '</div></div>';

  // --- Week row — label cell + inner grid wrapper (aligns with body rows) ---
  let weekRowHtml = '<div class="gr-row">';
  weekRowHtml += '<div class="gr-week-cell gr-head-cell">Week</div>';
  weekRowHtml += '<div class="gr-weeks-inner">';
  for (let i = 0; i < weeksN; i++) {
    const wNo = weekFirstNo + i;
    const isToday = i === todayWeekIdx;
    const isXmas = xmasWeek && (i + 1) === xmasWeek;
    const cls = 'gr-week-cell gr-head-cell' + (isToday ? ' gr-today-head' : '') + (isXmas ? ' gr-xmas-head' : '');
    weekRowHtml += '<div class="' + cls + '">'
      + '<span class="gr-week-no">' + weekLabel(wNo) + '</span>'
      + '<span class="gr-week-date">' + _weekMondayLabel(mondayFirst, i) + '</span>'
      + '</div>';
  }
  weekRowHtml += '</div></div>';

  // --- Sprint row (day-precision, item 1) ---
  let sprintRowHtml = '';
  if (sprints.length) {
    const spSegs = sprintSegs(mondayFirst, daysN, sprints);
    if (spSegs.length) {
      sprintRowHtml = '<div class="gr-month-row">';
      sprintRowHtml += '<div class="gr-head-cell" style="width:310px;flex-shrink:0;font-size:9px;display:flex;align-items:center;padding:0 6px;">Sprint</div>';
      sprintRowHtml += '<div class="gr-sprint-band">';
      spSegs.forEach((seg) => {
        const leftPct = (seg.startDay / daysN * 100).toFixed(4);
        const widthPct = (seg.days / daysN * 100).toFixed(4);
        sprintRowHtml += '<div class="gr-sprint-abs" style="left:' + leftPct + '%;width:' + widthPct + '%">' + _esc(seg.label) + '</div>';
      });
      sprintRowHtml += '</div></div>';
    }
  }

  // --- Task rows grouped by area ---
  let bodyHtml = '';
  for (const area of sortedAreas) {
    const areaTasks = sortedTasks
      .filter((t) => t.a === area.id)
      .sort((a, b) => (a.o || 0) - (b.o || 0));
    if (!areaTasks.length) continue;

    const areaCls = _areaColorClass(area.color);
    bodyHtml += '<div class="gr-group-header ' + areaCls + '" style="grid-column:1/-1">'
      + '<div class="gr-color-dot"></div>'
      + _esc(area.name)
      + (area.note ? '<span class="gr-group-note-inline">' + _esc(area.note) + '</span>' : '')
      + '</div>';

    for (const task of areaTasks) {
      const GAP_PX = 3;

      // Lane height: taller bars (26px each, item 4)
      let laneH = 44;
      if (task.ph && task.ph.length) {
        const lanes = phaseLanes(task.ph);
        const maxLane = Math.max(...lanes);
        laneH = Math.max(44, (maxLane + 1) * 26 + maxLane * 3 + 18);
      }

      // Avatars — use .gr-av class (overlap handled by CSS), title on the span
      const avatarsHtml = (task.who || []).slice(0, 3).map((id) => {
        const p = rosterById[id];
        return _avatarSvg(p || { id });
      }).join('');

      // Lane background — xmas only; today is a line (item 2)
      let laneBgHtml = '<div class="gr-lane-bg">';
      for (let i = 0; i < weeksN; i++) {
        const isXmas = xmasWeek && (i + 1) === xmasWeek;
        laneBgHtml += '<div class="gr-lane-bg-cell' + (isXmas ? ' gr-xmas' : '') + '"></div>';
      }
      laneBgHtml += '</div>';
      // Today line at exact day position (item 2)
      if (todayLinePct >= 0) {
        laneBgHtml += '<div class="gr-today-line" style="left:' + todayLinePct.toFixed(2) + '%"></div>';
      }

      // Bar HTML: no envelope, phase bars same style as single bars, gap, label-only tooltip (items 7, 8, 11)
      let barHtml = '';
      if (task.ms) {
        const { left } = _barPct(task.s, 0, weeksN);
        barHtml = '<div class="gr-bar gr-milestone ' + areaCls + '" title="' + _esc(task.t || '') + '" style="left:' + left + '%"></div>';
      } else if (task.ph && task.ph.length) {
        const lanes = phaseLanes(task.ph);
        task.ph.forEach((ph, i) => {
          const lane = lanes[i];
          const top = 9 + lane * 29;
          const { left: pLeft, width: pWidth } = _barPct(ph.s, ph.l, weeksN);
          // calc() gap (item 8)
          barHtml += '<div class="gr-phase-bar ' + areaCls + '" '
            + 'title="' + _esc(ph.n || task.t || '') + '" '
            + 'style="left:calc(' + pLeft.toFixed(4) + '% + ' + GAP_PX + 'px);'
            + 'width:calc(' + pWidth.toFixed(4) + '% - ' + (GAP_PX * 2) + 'px);'
            + 'top:' + top + 'px">'
            + '<span class="gr-phase-label">' + _esc(ph.n || '') + '</span></div>';
        });
      } else {
        const { left, width } = _barPct(task.s, task.l, weeksN);
        // label and tooltip: task title only — no ARxx (item 11)
        barHtml = '<div class="gr-bar ' + areaCls + '" title="' + _esc(task.t || '') + '" style="left:' + left + '%;width:' + width + '%">'
          + '<span class="gr-bar-label">' + _esc(task.t || '') + '</span></div>';
      }

      bodyHtml += '<div class="gr-task-row">'
        + '<div class="gr-label-cell">'
        + '<span class="gr-task-n">' + _esc(_displayN(task)) + '</span>'
        + '<span class="gr-task-title">' + _esc(task.t || '') + '</span>'
        + (task.ms ? '<span class="gr-ms-badge">Milestone</span>' : '')
        + '<span class="gr-avatars">' + avatarsHtml + '</span>'
        + '</div>'
        + '<div class="gr-lane" style="min-height:' + laneH + 'px;position:relative">'
        + laneBgHtml
        + barHtml
        + '</div>'
        + '</div>';
    }
  }

  // --- Backlog ---
  let backlogHtml = '';
  if (backlog && backlog.length) {
    backlogHtml = '<div class="gr-section-head"><h2>Backlog (' + backlog.length + ' items)</h2></div>';
    backlog.forEach((item) => {
      backlogHtml += '<div class="gr-bl-item">' + _esc(item.t || '') + '</div>';
    });
  }

  // --- Full HTML ---
  return '<!DOCTYPE html>\n'
    + '<html lang="en">\n'
    + '<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>Gantt roadmap - ' + _esc(qLabel) + '</title>\n'
    + headerHtml + '\n'
    + '</head>\n'
    + '<body>\n'
    + '<div class="gr-gantt-wrap"><div class="gr-gantt">\n'
    + monthRowHtml + '\n'
    + weekRowHtml + '\n'
    + sprintRowHtml + '\n'
    + bodyHtml + '\n'
    + '</div></div>\n'
    + backlogHtml + '\n'
    + '<div class="gr-footer">Gantt roadmap · Mission Deck · ' + now + '</div>\n'
    + '</body>\n'
    + '</html>';
}
