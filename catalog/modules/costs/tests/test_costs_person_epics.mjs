import test from 'node:test';
import assert from 'node:assert';
import { personEpics } from '../client/costs-lib.js';

const c = (h, cost) => ({ hours: h, days: h / 8, cost, noRateHours: 0 });

test('personEpics inverts epic -> issue -> person into person -> epic -> issue', () => {
  const epics = [
    { key: 'E-1', name: 'Epic 1', issues: [
      { key: 'T-1', summary: 'a', persons: [{ id: 'p1', months: { '2026-09': c(8, 100) }, total: c(8, 100) }, { id: 'p2', months: { '2026-09': c(4, 50) }, total: c(4, 50) }] },
      { key: 'T-2', summary: 'b', persons: [{ id: 'p1', months: { '2026-09': c(2, 25) }, total: c(2, 25) }] },
    ] },
    { key: 'E-2', name: 'Epic 2', issues: [{ key: 'T-3', summary: 'c', persons: [{ id: 'p1', months: { '2026-09': c(1, 10) }, total: c(1, 10) }] }] },
  ];
  const m = personEpics(epics, ['2026-09']);
  const p1 = m.get('p1');
  assert.strictEqual(p1.length, 2);
  const e1 = p1.find((e) => e.key === 'E-1');
  assert.strictEqual(e1.total.hours, 10);
  assert.strictEqual(e1.total.cost, 125);
  assert.strictEqual(e1.issues.length, 2);
  assert.strictEqual(e1.months['2026-09'].hours, 10);
  assert.strictEqual(m.get('p2')[0].issues[0].key, 'T-1');
  assert.strictEqual(m.get('p2')[0].total.cost, 50);
});
