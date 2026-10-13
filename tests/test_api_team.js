// API tests for the team directory routes behind Settings > Users.
// Run: npm run test:api  (or: npm run test:api:one tests/test_api_team.js)
//
// The handlers write into <DATA_TIER_0_DIR>/team/, so the helper points the
// server at a throwaway directory: nothing here touches the real data repo.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');

// Ports are hand-picked per suite so two suites never collide; see the others.
const PORT = 3512;
let child;

const api = (method, p, payload) => (method === 'GET' ? getJson(PORT, p) : postJson(PORT, p, payload));

// A 1x1 PNG, so the magic-byte check has something real to accept.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let DATA_DIR;

test.before(async () => {
  DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-team-'));
  child = startServer(PORT, { DATA_TIER_0_DIR: DATA_DIR });
  await waitForServer(PORT);
});

test.after(async () => {
  await stopServer(child);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('GET /api/team/members answers 200 with a roster and a team list', async () => {
  const r = await api('GET', '/api/team/members');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.members));
  assert.ok(Array.isArray(r.body.teams));
});

test('POST /api/team/member creates a person and assigns an id', async () => {
  const r = await api('POST', '/api/team/member', {
    first_name: 'Renee', last_name: 'Angstrom',
    role: 'Manager', team: 'Guests', email: 'angstrom.renee@example.com',
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
  assert.match(r.body.member.id, /^tm-[0-9a-f]{8}$/);
  // A brand-new record never carries a photo, whatever the request said.
  assert.equal(r.body.member.avatar, '');

  // Asserted by identity, not by count: the suite must not depend on how many
  // other tests have already written into the same throwaway directory.
  const list = await api('GET', '/api/team/members');
  const stored = list.body.members.find(m => m.id === r.body.member.id);
  assert.ok(stored, 'the new person is in the roster');
  assert.equal(stored.first_name, 'Renee');
  assert.ok(list.body.teams.includes('Guests'));
});

test('POST /api/team/member validates the name and the e-mail', async () => {
  const noName = await api('POST', '/api/team/member', { first_name: '  ', last_name: '' });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.error, 'name-required');

  const badMail = await api('POST', '/api/team/member', { first_name: 'Jordan', email: 'not-an-address' });
  assert.equal(badMail.status, 400);
  assert.equal(badMail.body.error, 'invalid-email');

  const unknown = await api('POST', '/api/team/member', { id: 'tm-00000000', first_name: 'Jordan' });
  assert.equal(unknown.status, 404);
});

test('POST /api/team/member updates in place and keeps the id and the photo', async () => {
  const created = await api('POST', '/api/team/member', { first_name: 'Jordan', last_name: 'Lee', role: 'Dev' });
  const id = created.body.member.id;

  const up = await api('POST', '/api/team/avatar', { id, data: PNG_B64 });
  assert.equal(up.status, 200);
  assert.equal(up.body.avatar, 'jordanlee.png');

  const edited = await api('POST', '/api/team/member', { id, first_name: 'Jordan', last_name: 'Lee', role: 'Lead' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.member.id, id);
  assert.equal(edited.body.member.role, 'Lead');
  // The photo is not part of the form payload, so an edit must not drop it.
  assert.equal(edited.body.member.avatar, 'jordanlee.png');
});

test('POST /api/team/avatar names the file itself and refuses a non-image', async () => {
  const created = await api('POST', '/api/team/member', { first_name: 'Taylor', last_name: 'Kim' });
  const id = created.body.member.id;

  // The client sends no file name at all - the server derives it from the person.
  const ok = await api('POST', '/api/team/avatar', { id, data: PNG_B64, filename: '../../../etc/passwd' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.avatar, 'taylorkim.png');
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'team', 'avatars', 'taylorkim.png')));
  assert.ok(!fs.existsSync(path.join(DATA_DIR, 'team', 'avatars', 'passwd')));

  const notImage = await api('POST', '/api/team/avatar', { id, data: Buffer.from('<?php ?>').toString('base64') });
  assert.equal(notImage.status, 400);
  assert.equal(notImage.body.error, 'unsupported-format');

  const noId = await api('POST', '/api/team/avatar', { data: PNG_B64 });
  assert.equal(noId.status, 400);

  const unknown = await api('POST', '/api/team/avatar', { id: 'tm-00000000', data: PNG_B64 });
  assert.equal(unknown.status, 404);
});

test('POST /api/team/member/delete drops the record and its photo', async () => {
  const created = await api('POST', '/api/team/member', { first_name: 'Sam', last_name: 'Rivera' });
  const id = created.body.member.id;
  await api('POST', '/api/team/avatar', { id, data: PNG_B64 });
  const photo = path.join(DATA_DIR, 'team', 'avatars', 'samrivera.png');
  assert.ok(fs.existsSync(photo));

  const del = await api('POST', '/api/team/member/delete', { id });
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(photo), 'the photo goes with the person');

  const list = await api('GET', '/api/team/members');
  assert.ok(!list.body.members.some(m => m.id === id));

  assert.equal((await api('POST', '/api/team/member/delete', { id })).status, 404);
  assert.equal((await api('POST', '/api/team/member/delete', {})).status, 400);
});

test('the file on disk is the shape js/team-directory.js reads', async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'team', 'team-members.json'), 'utf8'));
  assert.ok(Array.isArray(raw.team_members));
  assert.match(raw.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  for (const m of raw.team_members) {
    assert.deepEqual(
      Object.keys(m).sort(),
      ['avatar', 'email', 'first_name', 'id', 'last_name', 'role', 'team'],
    );
  }
  // Sorted by surname, so the grid order does not depend on insertion order.
  const surnames = raw.team_members.map(m => m.last_name);
  assert.deepEqual(surnames, surnames.slice().sort((a, b) => a.localeCompare(b, 'pl')));
});
