// locations/tests/test_locations_lib.mjs
// Pure client helpers - no browser document.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, fmtInt, statusBadgeClass, addressLine, buildDirectoryQuery, mapsUrl, formatDate,
  fullCardSections, locationErrorMessage, importErrorMessage,
} from '../client/locations-lib.js';

test('esc and fmtInt', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(fmtInt(16574), '16,574');
  assert.equal(fmtInt('x'), '0');
});

test('statusBadgeClass', () => {
  assert.equal(statusBadgeClass('Open'), 'ds-badge--green');
  assert.equal(statusBadgeClass('Closed temporarily'), 'ds-badge--red');
  assert.equal(statusBadgeClass('Under construction'), 'ds-badge--yellow');
  assert.equal(statusBadgeClass(''), 'ds-badge--gray');
});

test('addressLine skips empty parts', () => {
  assert.equal(addressLine({ street: '1 River Road', postal_code: '00-001', city: 'Springfield' }), '1 River Road, 00-001 Springfield');
  assert.equal(addressLine({ city: 'Springfield' }), 'Springfield');
});

test('buildDirectoryQuery leaves out empty filters', () => {
  assert.equal(buildDirectoryQuery({ q: ' old town ', status: '', group: 'Pilot' }, 60, 60), 'q=old+town&group=Pilot&offset=60&limit=60');
});

test('mapsUrl rejects missing or out-of-range coordinates', () => {
  assert.match(mapsUrl(52.2, 21.0), /openstreetmap\.org\/\?mlat=52\.2&mlon=21/);
  assert.equal(mapsUrl(null, 21), '');
  assert.equal(mapsUrl(0, 0), '');
  assert.equal(mapsUrl(95, 21), '');
});

test('formatDate', () => {
  assert.equal(formatDate('2021-03-15T00:00:00'), '2021-03-15');
  assert.equal(formatDate(''), '');
});

test('fullCardSections drops empty rows and empty sections', () => {
  const sections = fullCardSections({ code: 'A', name: 'One', city: 'Springfield', groups: [] });
  assert.deepEqual(sections.map((s) => s.title), ['Location', 'Address']);
  assert.deepEqual(sections[0].rows.map((r) => r.label), ['Code', 'Name']);
});

test('error messages', () => {
  assert.equal(locationErrorMessage(404, { error: 'location-not-found' }), 'This location was not found.');
  assert.equal(importErrorMessage(400, { error: 'missing-columns', missing: ['city'] }), 'Required columns are missing: city.');
  assert.equal(importErrorMessage(500, {}), 'The server answered 500.');
});
