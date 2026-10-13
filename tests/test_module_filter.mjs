import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { areaOptions, filterRows, nextFilterState } from '../js/module-filter.mjs';
import { moduleSearchText } from '../js/module-card.mjs';

// Mirror the shared table contract, including unrelated row data.
function row(id, area, name) {
  return Object.freeze({
    id, area, search: moduleSearchText({ id, area, name }),
    meta: Object.freeze({ installed: true }),
  });
}

const rows = Object.freeze([
  row('network-report', 'Crème Network', 'Über reports'),
  row('network-leave', 'creme network', 'Leave'),
  row('ar-report', 'AR', 'Über reports'),
  row('legacy-report', undefined, 'Über reports'),
  row('legacy-leave', '   ', 'Leave'),
]);

describe('module filters: AC5d', () => {
  it('combines independent text and area predicates with accurate counts and intact rows', () => {
    const snapshot = structuredClone(rows);
    const cases = [
      ['all areas', { query: '', area: '' }, rows],
      ['text alone', { query: 'uber REPORTS', area: '' }, [rows[0], rows[2], rows[3]]],
      ['area alone', { query: '', area: 'creme network' }, [rows[0], rows[1]]],
      ['conjunction', { query: 'uber reports', area: 'creme network' }, [rows[0]]],
      ['accent and case normalization', { query: ' REPORTS  ÜBER ', area: ' CRÈME  NETWORK ' }, [rows[0]]],
      ['missing area', { query: '', area: '__unspecified__' }, [rows[3], rows[4]]],
      ['missing area and text', { query: 'reports', area: '__unspecified__' }, [rows[3]]],
      ['every query word required', { query: 'reports leave', area: '' }, []],
      ['area is exact, not a substring', { query: '', area: 'creme' }, []],
    ];
    for (const [label, state, expected] of cases) {
      Object.freeze(state);
      const result = filterRows(rows, state);
      assert.deepEqual(result, { rows: expected, visible: expected.length, total: 5 }, label);
      result.rows.forEach((item, index) => assert.strictEqual(item, expected[index], label));
    }
    assert.deepEqual(rows, snapshot, 'filtering must not rewrite rows or their order');
  });

  it('derives sorted, normalized unique options and adds the missing option only when needed', () => {
    const named = Object.freeze([
      row('z', 'Zürich', 'Z'),
      row('l', '  Crème  Network ', 'L'),
      row('a', 'AR', 'A'),
      row('duplicate', 'CREME NETWORK', 'Duplicate'),
      row('c', 'Commerce', 'C'),
    ]);
    const snapshot = structuredClone(named);
    const expected = [
      { value: '', label: 'All areas' },
      { value: 'ar', label: 'AR' },
      { value: 'commerce', label: 'Commerce' },
      { value: 'creme network', label: 'Crème Network' },
      { value: 'zurich', label: 'Zürich' },
    ];
    assert.deepEqual(areaOptions(named), expected);
    const withMissing = Object.freeze([...named, rows[3], rows[4]]);
    assert.deepEqual(areaOptions(withMissing), [
      ...expected, { value: '__unspecified__', label: 'Not set' },
    ]);
    assert.deepEqual(areaOptions(named), expected, 'missing option disappears with missing rows');
    assert.deepEqual(areaOptions([]), [expected[0]], 'no stale or hard-coded area options');
    assert.deepEqual(named, snapshot, 'sorting options must not sort or normalize source rows');
  });

  it('preserves query and available area across repaint, resetting only an unavailable area', () => {
    const previous = Object.freeze({ query: '  ÜBER reports  ', area: 'creme network' });
    const snapshot = structuredClone(previous);
    const repainted = Object.freeze([...rows].reverse().map(item => Object.freeze({ ...item })));
    const preserved = nextFilterState(previous, repainted);
    assert.deepEqual(preserved, previous);
    assert.deepEqual(filterRows(repainted, preserved), { rows: [rows[0]], visible: 1, total: 5 });

    const noTextMatch = Object.freeze([rows[1]]);
    const stillAvailable = nextFilterState(previous, noTextMatch);
    assert.deepEqual(stillAvailable, previous, 'zero text matches must not clear an available area');
    assert.deepEqual(filterRows(noTextMatch, stillAvailable), { rows: [], visible: 0, total: 1 });

    const remaining = Object.freeze([rows[2], rows[3]]);
    const reset = nextFilterState(previous, remaining);
    assert.deepEqual(reset, { query: previous.query, area: '' });
    assert.deepEqual(filterRows(remaining, reset), { rows: remaining, visible: 2, total: 2 });
    assert.deepEqual(nextFilterState(previous, []), { query: previous.query, area: '' });

    const missing = Object.freeze({ query: previous.query, area: '__unspecified__' });
    assert.deepEqual(nextFilterState(missing, repainted), missing);
    assert.deepEqual(nextFilterState(missing, [rows[0], rows[1]]), { query: missing.query, area: '' });
    assert.deepEqual(previous, snapshot, 'repaint must not mutate saved filter state');
  });
});
