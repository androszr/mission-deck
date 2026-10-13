// Shared DOM-free contract: rows carry { area, search, ... }.
// Option values and state.area are normalized keys; '' means all areas.
import { areaFilterKey, matchesSearch, moduleArea } from './module-card.mjs';

export const UNSPECIFIED_AREA = '__unspecified__';

export function areaOptions(rows) {
  const areas = new Map();
  let missing = false;
  for (const row of rows) {
    const label = moduleArea(row);
    if (!label) missing = true;
    else if (!areas.has(areaFilterKey(label))) areas.set(areaFilterKey(label), label);
  }
  return [
    { value: '', label: 'All areas' },
    ...Array.from(areas, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en')),
    ...(missing ? [{ value: UNSPECIFIED_AREA, label: 'Not set' }] : []),
  ];
}

export function filterRows(rows, { query = '', area = '' } = {}) {
  const selected = areaFilterKey(area);
  const filtered = rows.filter(row =>
    (!selected || (areaFilterKey(row.area) || UNSPECIFIED_AREA) === selected)
    && matchesSearch(row.search, query));
  return { rows: filtered, visible: filtered.length, total: rows.length };
}

export function nextFilterState(prev, rows) {
  const area = areaFilterKey(prev?.area);
  return {
    query: prev?.query ?? '',
    area: areaOptions(rows).some(option => option.value === area) ? area : '',
  };
}
