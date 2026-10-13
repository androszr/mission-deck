'use strict';
// tests/test_api_integrations.js
// Jira / Confluence / Claude terminal. All of them must fail fast and locally
// when no token is configured - never hang on an unreachable corporate host.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson, postJson } = require('./_api_helper');

const PORT = 3503;
let child;

test.before(async () => {
  // Blank every integration token so this suite can never reach a live API.
  child = startServer(PORT, { JIRA_TOKEN: '', JIRA_TECH_TOKEN: '', CONFLUENCE_TOKEN: '', TEST_ENV_FILE: '/nonexistent/.env' });
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

test('GET /api/jira/whoami answers 4xx JSON without a token and without a network call', async () => {
  const started = Date.now();
  const { status, body } = await getJson(PORT, '/api/jira/whoami');
  assert.ok(status >= 400 && status < 500, `expected 4xx, got ${status}`);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.error, 'token_missing');
  assert.strictEqual(typeof body.url, 'string');
  // A short-circuit, not a timed-out fetch.
  assert.ok(Date.now() - started < 5000, 'whoami must not attempt a network call without a token');
});

test('GET /api/jira/issue-title validates the key before anything else', async () => {
  const bad = await getJson(PORT, '/api/jira/issue-title?key=nope');
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.error, 'invalid_key');

  const noToken = await getJson(PORT, '/api/jira/issue-title?key=ABC-1');
  assert.strictEqual(noToken.status, 503);
  assert.strictEqual(noToken.body.error, 'token_missing');
});

test('GET /api/jira/issue-detail validates the key and reports the missing token', async () => {
  const bad = await getJson(PORT, '/api/jira/issue-detail?key=1-ABC');
  assert.strictEqual(bad.status, 400);

  const noToken = await getJson(PORT, '/api/jira/issue-detail?key=ABC-42');
  assert.strictEqual(noToken.status, 503);
  assert.strictEqual(noToken.body.error, 'token_missing');
});

test('Jira write endpoints validate their payloads', async () => {
  const badKey = await postJson(PORT, '/api/jira/comment', { key: 'nope', body: 'x' });
  assert.strictEqual(badKey.status, 400);
  assert.strictEqual(badKey.body.error, 'invalid_key');

  const badWorklog = await postJson(PORT, '/api/jira/worklog', { entries: [] });
  assert.strictEqual(badWorklog.status, 400);

  const badType = await postJson(PORT, '/api/jira/create-issue-poc', { title: 't', body: 'b', issueType: 'nope' });
  assert.strictEqual(badType.status, 400);
  assert.strictEqual(badType.body.error, 'invalid_issue_type');

  const badField = await postJson(PORT, '/api/jira/update-fields', { key: 'ABC-1', fields: { evil: 1 } });
  assert.strictEqual(badField.status, 400);
  assert.strictEqual(badField.body.error, 'field_not_allowed');
});

test('Confluence endpoints report the missing token', async () => {
  const configured = await getJson(PORT, '/api/knowledge-base/confluence-configured');
  assert.strictEqual(configured.status, 200);
  assert.strictEqual(configured.body.configured, false);

  const check = await postJson(PORT, '/api/knowledge-base/confluence-check', { pages: ['123'] });
  assert.strictEqual(check.status, 200);
  assert.strictEqual(check.body.error, 'no-confluence-token');

  const create = await postJson(PORT, '/api/confluence/page', { spaceKey: 'DS', title: 'T', body: '<p>x</p>' });
  assert.strictEqual(create.status, 503);
  assert.strictEqual(create.body.error, 'token_missing');
});

test('PUT /api/confluence/page/:id parses the path parameter', async () => {
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/confluence/page/not-a-number`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: '<p>x</p>' }),
  });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await bad.json()).error, 'invalid_page_id');

  const ok = await fetch(`http://127.0.0.1:${PORT}/api/confluence/page/12345`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: '<p>x</p>' }),
  });
  assert.strictEqual(ok.status, 503);
  assert.strictEqual((await ok.json()).error, 'token_missing');
});

test('GET /api/claude-terminal/status degrades gracefully', async () => {
  const noSession = await getJson(PORT, '/api/claude-terminal/status');
  assert.strictEqual(noSession.status, 200);
  assert.strictEqual(noSession.body.alive, false);
  assert.strictEqual(noSession.body.bufferedBytes, 0);

  const unknown = await getJson(PORT, '/api/claude-terminal/status?sessionId=does-not-exist');
  assert.strictEqual(unknown.status, 200);
  assert.strictEqual(unknown.body.alive, false);
});

test('GET /api/bitwarden/status never throws, whatever the CLI state', async () => {
  const { status, body } = await getJson(PORT, '/api/bitwarden/status');
  assert.strictEqual(status, 200);
  assert.strictEqual(typeof body.installed, 'boolean');
  assert.strictEqual(typeof body.hasSecrets, 'boolean');
  assert.ok(Array.isArray(body.loadedSecrets));
});
