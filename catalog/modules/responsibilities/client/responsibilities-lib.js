// modules/responsibilities/client/responsibilities-lib.js
// Pure helpers without document access. `now` is always a parameter. Holds no team data (a sibling
// file is ONE shared instance across reload generations).

export const PROJECTS = [
  { id: 'main', label: 'Main' },
  { id: 'web', label: 'Web' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'platform', label: 'Platform' },
];

export const STATUS_LABELS = {
  green: 'Running smoothly',
  amber: 'Has challenges',
  red: 'Needs action',
};

export function isValidProject(p) {
  return typeof p === 'string' && PROJECTS.some((x) => x.id === p);
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' -> 'Oct 26' */
export function monthLabel(m) {
  const parts = String(m).split('-');
  return MONTH_LABELS[parseInt(parts[1], 10) - 1] + ' ' + parts[0].slice(2);
}

function ymOf(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
}

/** In April show March; January -> previous year's December. */
export function previousClosedMonthKey(now) {
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  return y + '-' + String(m).padStart(2, '0');
}

/** Previous closed month if present, else the latest earlier one, else the first. */
export function defaultMonth(months, now) {
  const list = Array.isArray(months) ? months : [];
  if (list.length === 0) return '';
  const prev = previousClosedMonthKey(now);
  if (list.includes(prev)) return prev;
  const earlier = list.filter((m) => m <= prev);
  if (earlier.length > 0) return earlier[earlier.length - 1];
  return list[0];
}

/** Selected month plus three earlier ones (all when showAll). */
export function monthWindow(months, selected, showAll) {
  const all = Array.isArray(months) ? months : [];
  const selIdx = all.indexOf(selected);
  const windowStart = Math.max(0, selIdx - 3);
  const visible = showAll ? all : all.slice(windowStart);
  return {
    visible,
    hiddenCount: showAll ? 0 : windowStart,
    canCollapse: !!showAll && windowStart === 0,
  };
}

/** 7 closed months + the current one (8 keys, last = current). */
export function timelineMonths(now) {
  const out = [];
  for (let i = 7; i >= 1; i--) {
    out.push(ymOf(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  out.push(ymOf(now));
  return out;
}

/** RAG counts for a month over a whole project; an unset rating counts as unset. */
export function countsForMonth(data, month) {
  let green = 0; let amber = 0; let red = 0; let unset = 0;
  const groups = data && Array.isArray(data.groups) ? data.groups : [];
  groups.forEach((g) => (g.areas || []).forEach((a) => {
    const r = a.ratings && a.ratings[month];
    if (!r || !r.status) unset++;
    else if (r.status === 'green') green++;
    else if (r.status === 'amber') amber++;
    else if (r.status === 'red') red++;
  }));
  return { green, amber, red, unset, total: green + amber + red + unset };
}

/** RAG counts for one group (unset areas are not counted). */
export function groupCounts(group, month) {
  const gc = { green: 0, amber: 0, red: 0 };
  ((group && group.areas) || []).forEach((a) => {
    const r = a.ratings && a.ratings[month];
    if (r && r.status && gc[r.status] !== undefined) gc[r.status]++;
  });
  return gc;
}
