// vendor-settlements/tests/test_vs_lib.mjs
// Pure client helpers - no browser document.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmountInput, fmtMoney, fmtMonthLabel, CURRENCY, distributeAmountToPersons, buildPeriodMonthOptions,
  getOrdersForVendor, buildPoGroups, computeAvailableOnPo, vendorNameMatches, canonicalVendor,
  getEpicTotalsForVendor, getPersonTotalsForVendor, sumCostsForSelection, resolvePersonDisplayName, nameTokens,
} from '../client/vs-lib.js';

test('parseAmountInput: European and English groupings, nbsp, sign, suffix', () => {
  assert.equal(parseAmountInput('1 234,56'), 1234.56);
  assert.equal(parseAmountInput('1.234,56'), 1234.56);
  assert.equal(parseAmountInput('1,234.56'), 1234.56);
  assert.equal(parseAmountInput('1\u00a0234.5 EUR'), 1234.5);
  assert.equal(parseAmountInput('-500'), -500);
  assert.equal(parseAmountInput('1,234'), 1.234, 'one comma is a decimal separator');
  assert.equal(parseAmountInput('1,234,567'), 1234567);
});

test('parseAmountInput: garbage and empty answer null, never a guess', () => {
  for (const v of ['', 'abc', '1,2,3.4', '12.', ',5', null, undefined]) assert.equal(parseAmountInput(v), null, String(v));
});

test('formatters: money with the currency label, English month names', () => {
  assert.equal(fmtMoney(1234.5), '1,234.50 ' + CURRENCY);
  assert.equal(fmtMoney(1000), '1,000 ' + CURRENCY);
  assert.equal(fmtMoney(null), '—');
  assert.equal(fmtMonthLabel('2026-09'), 'September 2026');
});

test('distribute: proportional split, equal split when costs are 0, never mutates', () => {
  const persons = [{ name: 'A', total_cost: 300 }, { name: 'B', total_cost: 100 }];
  assert.deepEqual(distributeAmountToPersons(persons, 1000).map((p) => p.amount), [750, 250]);
  assert.deepEqual(distributeAmountToPersons([{ total_cost: 0 }, { total_cost: 0 }], 10).map((p) => p.amount), [5, 5]);
  assert.deepEqual(distributeAmountToPersons(persons, -400).map((p) => p.amount), [-300, -100]);
  assert.equal(persons[0].amount, undefined);
  assert.deepEqual(distributeAmountToPersons([], 10), []);
});

test('period options: data months plus every month of the current year plus the edited month', () => {
  const opts = buildPeriodMonthOptions(['2025-11'], '2024-02', new Date(2026, 0, 15));
  assert.equal(opts[0], '2026-12');
  assert.ok(opts.includes('2025-11') && opts.includes('2024-02'));
  assert.equal(opts.length, 14);
});

test('vendor matching is permissive and canonical names win', () => {
  assert.ok(vendorNameMatches('ACME LTD', 'Acme Ltd'));
  assert.ok(vendorNameMatches('Acme', 'Acme Ltd'));
  assert.ok(!vendorNameMatches('Globex', 'Acme Ltd'));
  assert.equal(canonicalVendor('acme ltd', {}), 'Acme Ltd');
});

const DATA = {
  purchaseOrders: [
    { po_number: 'PO-1', vendor: 'Acme Ltd', title: 'Platform work', amount: 1000, area: 'atlas' },
    { po_number: 'PO-1', vendor: 'Acme Ltd', title: 'Platform work', amount: 500, area: 'atlas' },
    { po_number: 'PO-2', vendor: 'Globex', title: 'Support', amount: 300 },
  ],
  protocolsAll: { protocols: [{ id: 'pr-1', po_number: 'PO-1', amount: 200 }] },
  summary: { assignments: [
    { id: 'st-1', po_number: 'PO-1', amount: 200, protocol_id: 'pr-1' },
    { id: 'st-2', po_number: 'PO-1', amount: '100' },
  ] },
};

test('orders: aggregated per po_number and narrowed to the vendor', () => {
  const rows = getOrdersForVendor(DATA.purchaseOrders, 'Acme Ltd');
  assert.deepEqual(rows.map((r) => [r.po_number, r.order_amount, r.area]), [['PO-1', 1500, 'atlas']]);
  assert.equal(getOrdersForVendor(null, null).length, 0);
});

test('order groups: available = order - settled - assigned (live protocols not counted twice)', () => {
  const [g] = buildPoGroups('Acme Ltd', null, DATA);
  assert.deepEqual([g.order_amount, g.settled_amount, g.assigned_amount, g.available], [1500, 200, 100, 1200]);
  assert.equal(computeAvailableOnPo('PO-1', 'st-2', DATA), 1300, 'the edited settlement does not count');
  assert.equal(computeAvailableOnPo('PO-404', null, DATA), null);
});

const COSTS = {
  persons: { '2026-09': [
    { name: 'ACM Morgan Alex', company: 'Acme Ltd', hours: 10, total_cost: 1000, daily_rate: 800 },
    { name: 'GLX Rivera Sam', company: 'Globex', hours: 5, total_cost: 400 },
  ] },
  epics: [{ key: 'E-1', issues: [{ key: 'I-1', epic_key: 'E-1', epic_name: 'Checkout', persons: [
    { name: 'ACM Morgan Alex', monthly: { '2026-09': 1000 }, hours_monthly: { '2026-09': 10 } },
    { name: 'GLX Rivera Sam', monthly: { '2026-09': 400 }, hours_monthly: { '2026-09': 5 } },
  ] }] }],
};

test('cost totals per epic and per person follow the vendor code', () => {
  const data = { costs: { atlas: COSTS } };
  const epics = getEpicTotalsForVendor('atlas', 'Acme Ltd', '2026-09', '2026-09', data);
  assert.deepEqual([...epics.entries()].map(([k, v]) => [k, v.name, v.amount]), [['E-1', 'Checkout', 1000]]);
  const persons = getPersonTotalsForVendor('atlas', 'Globex', '2026-09', '2026-09', data);
  assert.deepEqual([...persons.keys()], ['GLX Rivera Sam']);
  assert.equal(sumCostsForSelection('atlas', 'Acme Ltd', 'epics', ['E-1'], '2026-09', '2026-09', data), 1000);
  assert.equal(sumCostsForSelection('atlas', 'Globex', 'persons', ['GLX Rivera Sam'], '2026-09', '2026-09', data), 400);
});

test('display names: a unique directory match wins, else the vendor code is stripped', () => {
  assert.equal(resolvePersonDisplayName('ACM Morgan Alex', ['Alex Morgan', 'Sam Rivera']), 'Alex Morgan');
  assert.equal(resolvePersonDisplayName('ACM Unknown Person CTR', []), 'Unknown Person');
  assert.deepEqual([...nameTokens('ACM \u0141ukasz Test')], ['lukasz', 'test']);
});
