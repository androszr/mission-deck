// tests/test_server_helpers.mjs
// Pure-helper unit tests. Requiring server.js from a non-main module exports the
// helpers and never starts the HTTP server.

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const srv = require('../server.js');

test('classifyGitError prefers connection failures over embedded status digits', () => {
  // git embeds a millisecond duration ("after 21401 ms") that a bare /401/ test
  // would misread as an expired token - the single most misleading label here.
  assert.strictEqual(srv.classifyGitError('fatal: unable to access: Failed to connect after 40123 ms', 128), 'network');
  assert.strictEqual(srv.classifyGitError('remote: HTTP Basic: Access denied', 128), 'auth-expired');
  assert.strictEqual(srv.classifyGitError('remote: Permission denied', 128), 'no-access');
  assert.strictEqual(srv.classifyGitError('CONFLICT (content): merge conflict', 1), 'conflict');
  assert.strictEqual(srv.classifyGitError('refusing to merge unrelated histories', 128), 'history-diverged');
  assert.strictEqual(srv.classifyGitError('something odd', 1), 'error');
  assert.strictEqual(srv.classifyGitError('anything', 1, { killed: true }), 'timeout');
});

test('classifyGitError reads a missing credential as an auth problem', () => {
  // What git prints once _gitNoPromptEnv has removed every askpass channel.
  // Must NOT fall through to the generic 'error' - the Settings UI would then
  // show a bare code instead of "configure the token".
  assert.strictEqual(srv.classifyGitError("fatal: could not read Username for 'https://gitlab.com': terminal prompts disabled", 128), 'auth-expired');
  // The similar-looking string that belongs to 'no-access' must keep its label.
  assert.strictEqual(srv.classifyGitError('fatal: Could not read from remote repository.', 128), 'no-access');
});

test('_gitNoPromptEnv closes every credential-prompt channel', () => {
  const prev = { ...process.env };
  try {
    process.env.GIT_ASKPASS = '/Applications/Visual Studio Code.app/askpass.sh';
    process.env.SSH_ASKPASS = '/usr/bin/ssh-askpass';
    process.env.VSCODE_GIT_ASKPASS_NODE = '/node';
    process.env.VSCODE_GIT_ASKPASS_MAIN = '/main.js';
    process.env.VSCODE_GIT_ASKPASS_EXTRA_ARGS = '';
    process.env.VSCODE_GIT_IPC_HANDLE = '/tmp/vscode-git.sock';
    const env = srv._gitNoPromptEnv({ HUSKY: '0' });
    for (const key of ['GIT_ASKPASS', 'SSH_ASKPASS', 'VSCODE_GIT_ASKPASS_NODE',
      'VSCODE_GIT_ASKPASS_MAIN', 'VSCODE_GIT_ASKPASS_EXTRA_ARGS', 'VSCODE_GIT_IPC_HANDLE']) {
      assert.ok(!(key in env), key + ' must not reach a spawned git');
    }
    assert.strictEqual(env.GIT_TERMINAL_PROMPT, '0');
    assert.strictEqual(env.SSH_ASKPASS_REQUIRE, 'never');
    // core.askpass from the user's global config is unreachable by env deletion.
    assert.strictEqual(env.GIT_CONFIG_COUNT, '1');
    assert.strictEqual(env.GIT_CONFIG_KEY_0, 'core.askpass');
    assert.strictEqual(env.GIT_CONFIG_VALUE_0, '');
    // Caller extras survive; the base of the ambient env (PATH, HOME) and
    // every GIT_* / SSH_* key are inherited - the person's ssh agent and
    // GIT_SSH_COMMAND keep working - while a vault token is NOT: git is
    // spawned with an allowlist (_childEnvAllowlist), never a copy of
    // process.env, because `ps eww` shows a child's envp to the account.
    assert.strictEqual(env.HUSKY, '0');
    assert.strictEqual(env.PATH, process.env.PATH);
    process.env.SSH_AUTH_SOCK = '/tmp/agent.sock';
    process.env.GIT_CONFIG_GLOBAL = '/Users/example/.gitconfig';
    process.env.JIRA_TOKEN = 'must-not-leak';
    process.env.GITLAB_PRODUCT_TOKEN = 'must-not-leak-either';
    const env2 = srv._gitNoPromptEnv();
    assert.strictEqual(env2.SSH_AUTH_SOCK, '/tmp/agent.sock');
    assert.strictEqual(env2.GIT_CONFIG_GLOBAL, '/Users/example/.gitconfig');
    assert.ok(!('JIRA_TOKEN' in env2), 'a vault token must not reach a spawned git');
    assert.ok(!('GITLAB_PRODUCT_TOKEN' in env2), 'GITLAB_ is not a GIT_ prefix - it must not pass');
    // The real process env is never mutated.
    assert.ok(process.env.GIT_ASKPASS);
  } finally {
    for (const key of ['GIT_ASKPASS', 'SSH_ASKPASS', 'VSCODE_GIT_ASKPASS_NODE',
      'VSCODE_GIT_ASKPASS_MAIN', 'VSCODE_GIT_ASKPASS_EXTRA_ARGS', 'VSCODE_GIT_IPC_HANDLE',
      'SSH_AUTH_SOCK', 'GIT_CONFIG_GLOBAL', 'JIRA_TOKEN', 'GITLAB_PRODUCT_TOKEN']) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
});

test('_childEnvAllowlist: base keys, opt-in prefixes and explicit extras - nothing else', () => {
  const source = {
    PATH: '/usr/bin', HOME: '/h', LANG: 'C', EMPTY: '',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', SSH_AUTH_SOCK: '/s', GITLAB_MINI_TOKEN: 'g',
    JIRA_TOKEN: 'j', CONFLUENCE_TOKEN: 'c', BW_SESSION: 'b', PROTO_DEPLOY_TOKEN: 'a', AMPLITUDE_COCKPIT_API_KEY: 'k', npm_config_omit: 'dev',
  };
  const plain = srv._childEnvAllowlist(source);
  assert.deepStrictEqual(Object.keys(plain).sort(), ['HOME', 'LANG', 'PATH']);
  const git = srv._childEnvAllowlist(source, { prefixes: ['GIT_', 'SSH_'], extra: { GIT_TERMINAL_PROMPT: '0', SKIP: undefined } });
  assert.deepStrictEqual(Object.keys(git).sort(), ['GIT_SSH_COMMAND', 'GIT_TERMINAL_PROMPT', 'HOME', 'LANG', 'PATH', 'SSH_AUTH_SOCK']);
  assert.ok(!('GITLAB_MINI_TOKEN' in git), 'GITLAB_ must not ride on the GIT_ prefix');
  assert.ok(srv.CHILD_ENV_BASE_KEYS.includes('PATH') && srv.CHILD_ENV_BASE_KEYS.includes('SYSTEMROOT'));
  assert.ok(!srv.CHILD_ENV_BASE_KEYS.some((k) => /TOKEN|SECRET|KEY|SESSION/.test(k)), 'the base list names no credential');
  // git reads ~/.config/git/config through XDG_CONFIG_HOME and its CA bundle
  // through curl: a person with a non-default XDG lost their credential
  // helper on every server-spawned git when these were missing.
  const xdg = srv._childEnvAllowlist({ PATH: '/usr/bin', XDG_CONFIG_HOME: '/cfg', XDG_CACHE_HOME: '/cache', CURL_CA_BUNDLE: '/ca.pem', XDG_SECRET_THING: 'no' });
  assert.deepStrictEqual(Object.keys(xdg).sort(), ['CURL_CA_BUNDLE', 'PATH', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'], 'named XDG keys pass, an unknown XDG_ key does not');
});

test('_bwSecretsFromEnv reports vault secrets the process kept across a restart', () => {
  // A self-restart hands the child { ...process.env }: the tokens survive, the
  // vault session does not. Without this the pill went red on a cockpit that
  // was fully authenticated.
  const tmp = path.join(os.tmpdir(), `cockpit-env-${process.pid}-${Date.now()}`);
  const prevFile = process.env.TEST_ENV_FILE;
  const prevApp = process.env.COCKPIT_APP_TOKEN;
  const prevData = process.env.COCKPIT_DATA_TOKEN;
  try {
    fs.writeFileSync(tmp, 'COCKPIT_DATA_TOKEN=from-the-file\n', 'utf8');
    process.env.TEST_ENV_FILE = tmp;
    process.env.COCKPIT_APP_TOKEN = 'glpat-inherited-value';
    process.env.COCKPIT_DATA_TOKEN = 'from-the-file';
    const found = srv._bwSecretsFromEnv();
    // Injected by an unlock, no .env line -> counts as loaded.
    assert.ok(found.includes('COCKPIT_APP_TOKEN'));
    // Declared in .env -> configuration, not a vault secret.
    assert.ok(!found.includes('COCKPIT_DATA_TOKEN'));
    // Absent -> not loaded.
    assert.ok(!found.includes('COCKPIT_JIRA_TOKEN'));
    // A placeholder is not a secret (resolveToken filters it).
    process.env.COCKPIT_APP_TOKEN = 'your_token_here';
    assert.ok(!srv._bwSecretsFromEnv().includes('COCKPIT_APP_TOKEN'));
  } finally {
    if (prevFile === undefined) delete process.env.TEST_ENV_FILE; else process.env.TEST_ENV_FILE = prevFile;
    if (prevApp === undefined) delete process.env.COCKPIT_APP_TOKEN; else process.env.COCKPIT_APP_TOKEN = prevApp;
    if (prevData === undefined) delete process.env.COCKPIT_DATA_TOKEN; else process.env.COCKPIT_DATA_TOKEN = prevData;
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
});

test('token redaction never leaks credentials', () => {
  assert.strictEqual(srv._scrubGitTokens('https://oauth2:glpat-secret@gitlab.example.com/x.git'), 'https://[REDACTED]@gitlab.example.com/x.git');
  assert.match(srv._redactGitStderr('fatal: https://oauth2:abc@host/x'), /\[REDACTED\]/);
  assert.ok(!srv._redactGitStderr('token glpat-ABCdef-123 here').includes('glpat-ABCdef-123'));
  assert.strictEqual(srv._stripUrlCredentials('https://user:pw@gitlab.example.com/x.git'), 'https://gitlab.example.com/x.git');
});

test('resolveToken drops .env.example placeholders', () => {
  assert.strictEqual(srv.resolveToken('  real-token  '), 'real-token');
  assert.strictEqual(srv.resolveToken('your_token_here'), '');
  assert.strictEqual(srv.resolveToken(''), '');
  assert.strictEqual(srv.resolveToken(undefined), '');
});

test('previewToken masks all but the last four characters', () => {
  assert.strictEqual(srv.previewToken('abcdefgh'), '****efgh');
  assert.strictEqual(srv.previewToken('abc'), '****');
  assert.strictEqual(srv.previewToken('your_token_here'), '');
  assert.strictEqual(srv.previewToken(''), '');
});

test('remote-url helpers normalize SSH and derive the repo name', () => {
  assert.strictEqual(srv._sshToHttps('git@gitlab.example.com:group/proj.git'), 'https://gitlab.example.com/group/proj.git');
  assert.strictEqual(srv._sshToHttps('https://gitlab.example.com/group/proj.git'), 'https://gitlab.example.com/group/proj.git');
  assert.strictEqual(srv._isSshRemoteUrl('git@gitlab.example.com:g/p.git'), true);
  assert.strictEqual(srv._isSshRemoteUrl('https://gitlab.example.com/g/p.git'), false);
  assert.strictEqual(srv._repoNameFromUrl('https://gitlab.example.com/group/data-tier-0.git'), 'data-tier-0');
  assert.strictEqual(srv._repoNameFromUrl(null), null);
});

test('_shouldAutoUpdateOnStartup only fires on a clean main with a fresh token', () => {
  const base = { hasToken: true, stateHash: null, branch: 'main', isDirty: false };
  assert.strictEqual(srv._shouldAutoUpdateOnStartup(base), true);
  assert.strictEqual(srv._shouldAutoUpdateOnStartup({ ...base, hasToken: false }), false);
  assert.strictEqual(srv._shouldAutoUpdateOnStartup({ ...base, stateHash: 'abc123' }), false);
  assert.strictEqual(srv._shouldAutoUpdateOnStartup({ ...base, branch: 'sandbox/x' }), false);
  assert.strictEqual(srv._shouldAutoUpdateOnStartup({ ...base, isDirty: true }), false);
});

test('cachePolicy revalidates data and code, freezes assets', () => {
  assert.match(srv.cachePolicy('.woff2', '/fonts/x.woff2'), /immutable/);
  assert.match(srv.cachePolicy('.png', '/assets/logo.png'), /immutable/);
  assert.strictEqual(srv.cachePolicy('.json', '/data/app-update.json'), 'no-cache');
  assert.strictEqual(srv.cachePolicy('.json', '/data-sub-repositories/data-tier-0/x.json'), 'no-cache');
  assert.strictEqual(srv.cachePolicy('.js', '/js/app.js'), 'no-cache');
  assert.match(srv.cachePolicy('.css', '/styles.css'), /must-revalidate/);
});

test('emptyJsonStubFor covers only the two gitignored data roots', () => {
  // Derive the data root from the server's own constant instead of spelling the
  // folder name here. The checkout is named after the remote (`ds-data`) while
  // the logical id stays `data-tier-0`, and a hardcoded copy of either one turns
  // a deliberate rename into a red test that says nothing about the behaviour.
  const dataRoot = srv.DATA_TIER_0_URL_PATH;
  assert.match(dataRoot, /^\/data-sub-repositories\/[^/]+\/$/, 'data root must be a single folder under the sub-repo parent');

  assert.deepStrictEqual(srv.emptyJsonStubFor('/data/anything.json'), { _missing: true });
  assert.deepStrictEqual(srv.emptyJsonStubFor(dataRoot + 'a/b.json'), { _missing: true });
  assert.strictEqual(srv.emptyJsonStubFor('/data/report.csv'), null);
  assert.strictEqual(srv.emptyJsonStubFor(dataRoot + 'a/b.csv'), null, 'only .json gets a stub');
  assert.strictEqual(srv.emptyJsonStubFor('/js/app.js'), null);
  assert.strictEqual(srv.emptyJsonStubFor('/data-sub-repositories/other-repo/a.json'), null,
    'a sibling sub-repo must NOT get a stub');
});

test('sync-log parsers count files, lines and commits', () => {
  const porcelain = '?? new.json\n M edited.json\n D gone.json\nR  old.json -> new-name.json\n';
  assert.deepStrictEqual(srv._syncLogFileCount(porcelain), { files_added: 3, files_removed: 1 });
  assert.deepStrictEqual(srv._syncLogParseNumstat('3\t1\ta.json\n-\t-\tbin.png\n10\t0\tb.json\n'), { lines_added: 13, lines_removed: 1 });
  const commits = srv._syncLogParseCommits('abcdef1234\0Ala\0first\x002026-01-01T00:00:00Z\n');
  assert.strictEqual(commits.length, 1);
  assert.strictEqual(commits[0].hash, 'abcdef12');
  assert.strictEqual(commits[0].author, 'Ala');
});

test('_syncLogApplyRetention strips detail at 14 days and drops at 90', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  const mk = (iso) => ({ timestamp: iso, files_added: 1, files_removed: 0, files: [{ path: 'a' }], commits: [{ hash: 'x' }] });
  const out = srv._syncLogApplyRetention([
    mk('2026-05-30T00:00:00Z'), // fresh -> full detail
    mk('2026-05-01T00:00:00Z'), // 31 days -> stripped
    mk('2025-01-01T00:00:00Z'), // > 90 days -> dropped
  ], now);
  assert.strictEqual(out.length, 2);
  assert.ok(Array.isArray(out[0].files));
  assert.strictEqual('files' in out[1], false);
  assert.strictEqual(out[1].files_added, 1);
});

test('_syncLogApplyRetention never mutates its input', () => {
  const events = [{ timestamp: '2020-01-01T00:00:00Z', files_added: 1, files_removed: 0, files: [{ path: 'a' }] }];
  srv._syncLogApplyRetention(events, Date.parse('2026-06-01T00:00:00Z'));
  assert.strictEqual(events.length, 1);
  assert.ok(Array.isArray(events[0].files));
});

test('_isCorruptJson flags conflict markers and parse errors', () => {
  assert.strictEqual(srv._isCorruptJson('{"a":1}'), null);
  assert.strictEqual(srv._isCorruptJson('{"a":'), 'parse-error');
  assert.strictEqual(srv._isCorruptJson('{\n<<<<<<< HEAD\n"a":1\n=======\n"a":2\n>>>>>>> other\n}'), 'conflict-markers');
});

test('ENV_SCHEMA covers every key the Settings UI must be able to save', () => {
  const ids = srv.ENV_SCHEMA.map(g => g.id);
  assert.deepStrictEqual(ids, ['app', 'bitwarden', 'data-tier-0', 'modules', 'prototypes', 'jira', 'integrations', 'amplitude', 'sync']);
  for (const key of [
    'COCKPIT_APP_TOKEN', 'BW_COLLECTION_NAME', 'COCKPIT_DATA_TOKEN', 'DATA_TIER_0_REPO_URL',
    'COCKPIT_MODULES_TOKEN', 'MODULES_CATALOG_REPO_URL',
    'JIRA_TOKEN', 'JIRA_TECH_TOKEN', 'JIRA_URL', 'JIRA_PROJECT_KEY', 'CONFLUENCE_TOKEN', 'CONFLUENCE_BASE_URL', 'VERIFY_SSL',
    'AUTO_SYNC_ENABLED', 'AUTO_SYNC_INTERVAL_MIN', 'VERSION_AUTOBUMP',
    'ANALYTICS_ENABLED', 'ANALYTICS_KEY', 'PROTO_DEPLOY_TOKEN',
  ]) {
    assert.ok(srv.ENV_SCHEMA_KEYS.has(key), `${key} missing from ENV_SCHEMA`);
  }
  // Project tokens are namespaced; the PERSONAL and analytics credentials are
  // the deliberate exception and are listed here one by one. The list stays
  // explicit: a new token silently joining it is exactly the regression this
  // guards.
  const SHARED_PERSONAL_SECRETS = [
    'JIRA_TOKEN', 'JIRA_TECH_TOKEN', 'CONFLUENCE_TOKEN',
    'FIGMA_TOKEN', 'PROTO_DEPLOY_TOKEN', 'GEMINI_PERSONAL_TOKEN',
    'AMPLITUDE_COCKPIT_API_KEY', 'AMPLITUDE_COCKPIT_SECRET_KEY',
  ];
  // Additional data sources (DATA_REPO_DEFS) name their own token. Derived,
  // not retyped: a new data source joins this list only by being declared.
  const SHARED_DATA_REPO_SECRETS = srv.DATA_REPOS
    .map((d) => d.tokenEnvVar)
    .filter(Boolean);
  for (const k of srv.ENV_SCHEMA.flatMap(g => g.keys)) {
    if (k.type !== 'token') continue;
    assert.ok(k.key.startsWith('COCKPIT_')
      || SHARED_PERSONAL_SECRETS.includes(k.key)
      || SHARED_DATA_REPO_SECRETS.includes(k.key),
      `${k.key} is neither COCKPIT_-namespaced, a declared shared personal credential, nor a shared data-repo token`);
  }
  // The Amplitude keys share one card on purpose - separate boxes made the
  // Keys tab unreadable.
  const secrets = srv.ENV_SCHEMA.flatMap(g => g.keys).filter(k => k.kind === 'secret');
  assert.deepStrictEqual([...new Set(secrets.map(k => k.category))],
    ['Application tokens', 'Data tokens', 'Tools', 'Analytics']);
  assert.strictEqual(secrets.filter(k => k.card === 'Amplitude').length, 2);
  // Both AUTO_SYNC keys must be hot-applied or a saved interval needs a restart.
  const syncGroup = srv.ENV_SCHEMA.find(g => g.id === 'sync');
  assert.ok(syncGroup.keys.every(k => k.hotApply === true));
});

test('every ENV_SCHEMA key carries the metadata the Settings tabs need', () => {
  for (const group of srv.ENV_SCHEMA) {
    for (const k of group.keys) {
      assert.ok(['secret', 'config', 'system'].includes(k.kind), `${k.key} has no valid kind`);
      assert.strictEqual(typeof k.hint, 'string', `${k.key} has no hint`);
      assert.ok(k.hint.length > 0, `${k.key} has an empty hint`);
      if (k.kind === 'secret') {
        assert.strictEqual(k.type, 'token', `${k.key} is a secret but not typed as a token`);
        assert.ok(k.bwItem, `${k.key} does not name its Bitwarden item`);
        // Without both, the Keys grid falls back to a card of its own under
        // an "Inne" heading - visible, but outside the section split.
        assert.ok(k.category, `${k.key} has no Keys category`);
        assert.ok(k.card, `${k.key} has no Keys card name`);
      }
      if (k.kind === 'config') assert.ok(k.configGroup, `${k.key} has no configGroup`);
    }
  }
  // The interval is 10/30/60 minutes, so it must not be typed as a boolean flag.
  const interval = srv.ENV_SCHEMA.flatMap(g => g.keys).find(k => k.key === 'AUTO_SYNC_INTERVAL_MIN');
  assert.strictEqual(interval.type, 'choice');
  assert.deepStrictEqual(interval.allowedValues, ['10', '30', '60']);
});

test('_bwMatchItem prefers an exact name, then the longest prefix', () => {
  assert.strictEqual(srv._bwMatchItem('COCKPIT-DATA').envVar, 'COCKPIT_DATA_TOKEN');
  // The longest prefix wins: AMPLITUDE-COCKPIT-SECRET must not land in the
  // API-key slot of the shorter AMPLITUDE-COCKPIT row.
  assert.strictEqual(srv._bwMatchItem('AMPLITUDE-COCKPIT-SECRET').envVar, 'AMPLITUDE_COCKPIT_SECRET_KEY');
  assert.strictEqual(srv._bwMatchItem('cockpit-app').envVar, 'COCKPIT_APP_TOKEN');
  assert.strictEqual(srv._bwMatchItem('COCKPIT-APP app read').envVar, 'COCKPIT_APP_TOKEN');
  assert.strictEqual(srv._bwMatchItem('something-else'), null);
  // Personal credentials: an item ending in -jira, and the exact
  // technical-account item.
  assert.strictEqual(srv._bwMatchItem('alex-morgan-jira').envVar, 'JIRA_TOKEN');
  assert.strictEqual(srv._bwMatchItem('jira_tech_cockpit').envVar, 'JIRA_TECH_TOKEN');
  // Items of repositories this app does not open stay unmatched.
  assert.strictEqual(srv._bwMatchItem('DATA-TIER-0'), null);
  assert.strictEqual(srv._bwMatchItem('PRODUCT-COCKPIT'), null);
  // 'CONFLUENCE' as a prefix row would also swallow CONFLUENCE_BASE_URL, so the
  // token is accepted only as an exact note key, never as an item prefix.
  assert.strictEqual(srv._bwMatchItem('CONFLUENCE'), null);
  assert.strictEqual(srv._bwMatchItem('CONFLUENCE_BASE_URL'), null);
});

test('_normalizeName folds Polish diacritics NFD cannot decompose', () => {
  assert.strictEqual(srv._normalizeName('Rafal'), 'rafal');
  assert.strictEqual(srv._normalizeName('  Anna_Maria  '), 'anna maria');
  assert.strictEqual(srv._normalizeName('\u0141ukasz \u0104dam'), 'lukasz adam');
});

test('formatStartedISOServer builds a Jira-compatible timestamp', () => {
  assert.strictEqual(srv.formatStartedISOServer('2026-03-15'), '2026-03-15T09:00:00.000+0200');
});

test('_isWave2Route matches the deferred onboarding surface only', () => {
  // /api/cocreate/* shipped ahead of the onboarding wizard (plans/2026-09-06-
  // academy-modul.md, step 10 / AC4) - it must NOT still 501 here.
  assert.strictEqual(srv._isWave2Route('/api/cocreate/progress'), false);
  assert.strictEqual(srv._isWave2Route('/api/onboarding-wizard/status'), true);
  assert.strictEqual(srv._isWave2Route('/api/settings/env'), false);
});

test('autoSyncIntervalMs clamps a hand-edited interval to the allowed choices', () => {
  const prev = process.env.AUTO_SYNC_INTERVAL_MIN;
  try {
    process.env.AUTO_SYNC_INTERVAL_MIN = '30';
    assert.strictEqual(srv.autoSyncIntervalMs(), 30 * 60 * 1000);
    // A zero would turn the loop's setTimeout into a git-hammering spin loop.
    process.env.AUTO_SYNC_INTERVAL_MIN = '0';
    assert.strictEqual(srv.autoSyncIntervalMs(), 10 * 60 * 1000);
    delete process.env.AUTO_SYNC_INTERVAL_MIN;
    assert.strictEqual(srv.autoSyncIntervalMs(), 10 * 60 * 1000);
  } finally {
    if (prev === undefined) delete process.env.AUTO_SYNC_INTERVAL_MIN;
    else process.env.AUTO_SYNC_INTERVAL_MIN = prev;
  }
});

test('the compressed static-body cache evicts by total bytes', () => {
  srv._resetCompressedBodyCache();
  srv._setCachedCompressedBody('a|1', Buffer.alloc(16));
  assert.strictEqual(srv._compressedBodyCacheStats().entries, 1);
  assert.strictEqual(srv._compressedBodyCacheStats().bytes, 16);
  // Re-setting the same key must not double-count its bytes.
  srv._setCachedCompressedBody('a|1', Buffer.alloc(32));
  assert.strictEqual(srv._compressedBodyCacheStats().bytes, 32);
  assert.strictEqual(srv._getCachedCompressedBody('a|1').length, 32);
  srv._resetCompressedBodyCache();
  assert.strictEqual(srv._compressedBodyCacheStats().entries, 0);
});

// ── _restartChildEnv: a restart must lock the safe ──────────────────────────
// The regression these three tests pin: a restart child used to inherit
// process.env whole, so a vault token that had never been written to .env
// survived into a process whose Bitwarden session was empty. The cockpit then
// reported the safe as `locked` while every git call still authenticated.

test('_restartChildEnv drops every vault-backed secret', () => {
  const child = srv._restartChildEnv({
    COCKPIT_APP_TOKEN: 'glpat-app',
    COCKPIT_DATA_TOKEN: 'glpat-data',
    COCKPIT_OWNER_TOKEN: 'glpat-owner',
    JIRA_TOKEN: 'jira',
    JIRA_TECH_TOKEN: 'jira-tech',
    CONFLUENCE_TOKEN: 'conf',
    BW_SESSION: 'session-handle',
    PATH: '/usr/bin',
  });
  for (const key of ['COCKPIT_APP_TOKEN', 'COCKPIT_DATA_TOKEN', 'COCKPIT_OWNER_TOKEN',
    'JIRA_TOKEN', 'JIRA_TECH_TOKEN', 'CONFLUENCE_TOKEN', 'BW_SESSION']) {
    assert.ok(!(key in child), `${key} must not reach the restart child`);
  }
  // Everything outside ENV_SCHEMA is the operator's environment and is kept:
  // stripping PATH or PORT would respawn a server that cannot run or rebinds.
  assert.strictEqual(child.PATH, '/usr/bin');
});

test('_restartChildEnv strips config keys too so the child re-reads .env', () => {
  const child = srv._restartChildEnv({ JIRA_URL: 'https://stale.example', PORT: '3005' });
  assert.ok(!('JIRA_URL' in child));
  assert.strictEqual(child.PORT, '3005', 'PORT is not an ENV_SCHEMA key - the port must survive');
});

test('_restartChildEnv never mutates the environment it was handed', () => {
  // Two call sites pass `process.env` itself; deleting in place would blank the
  // live process's own config in the 100 ms before it exits.
  const source = { COCKPIT_APP_TOKEN: 'glpat-app', PATH: '/usr/bin' };
  srv._restartChildEnv(source);
  assert.strictEqual(source.COCKPIT_APP_TOKEN, 'glpat-app');
});

// BW_COLLECTION_NAME is the one ENV_SCHEMA key a Bitwarden unlock sets that is
// NOT a secret, and _restartChildEnv strips it along with the rest. So the only
// thing that can carry it across a restart is a line in .env - which is why
// handleBitwardenUnlock persists it. This test pins that pair: the strip takes
// it from the environment, and the file is what brings it back.
test('BW_COLLECTION_NAME survives a restart only through .env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-env-'));
  const envPath = path.join(dir, '.env');
  const prevEnvFile = process.env.TEST_ENV_FILE;
  const prevName = process.env.BW_COLLECTION_NAME;
  process.env.TEST_ENV_FILE = envPath;
  try {
    // Stripped from the child, exactly like every other schema key.
    assert.ok(!('BW_COLLECTION_NAME' in srv._restartChildEnv({ BW_COLLECTION_NAME: 'alex-morgan' })));

    // What the unlock handler writes, and what the restarted child reads back.
    delete process.env.BW_COLLECTION_NAME;
    srv.writeEnvFile({ BW_COLLECTION_NAME: 'alex-morgan' });
    assert.match(fs.readFileSync(envPath, 'utf8'), /^BW_COLLECTION_NAME=alex-morgan$/m);
    assert.strictEqual(srv.readEnvFile().values.get('BW_COLLECTION_NAME'), 'alex-morgan');
  } finally {
    if (prevEnvFile === undefined) delete process.env.TEST_ENV_FILE;
    else process.env.TEST_ENV_FILE = prevEnvFile;
    if (prevName === undefined) delete process.env.BW_COLLECTION_NAME;
    else process.env.BW_COLLECTION_NAME = prevName;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Stage B: /api/data/<repoId>/<op> path parser and DATA_REPOS lookup. Appended
// rather than edited in place - tests/test_new_module.mjs is being touched by
// a parallel session and this file is adjacent work in the same area.
test('_parseDataRepoPath reads exactly two segments after /api/data/', () => {
  assert.deepStrictEqual(srv._parseDataRepoPath('/api/data/data-tier-0/status'), { repoId: 'data-tier-0', op: 'status' });
  assert.deepStrictEqual(srv._parseDataRepoPath('/api/data/data-tier-0/pull-overwrite-stream'), { repoId: 'data-tier-0', op: 'pull-overwrite-stream' });
});

test('_parseDataRepoPath refuses a shape that is not exactly repoId/op', () => {
  assert.strictEqual(srv._parseDataRepoPath('/api/data/data-tier-0'), null);
  assert.strictEqual(srv._parseDataRepoPath('/api/data/data-tier-0/status/extra'), null);
  assert.strictEqual(srv._parseDataRepoPath('/api/data-tier-0/status'), null);
  assert.strictEqual(srv._parseDataRepoPath('/api/data/'), null);
});

// CLAUDE.md's rule for a user-visible string is "proper Polish with the nine
// diacritic letters", and the registry labels used to assert it the blunt way:
// every label must CONTAIN one. That is a proxy, and it is wrong in the one
// direction that matters - it blocks correct copy. "Dane Salesforce
// (wsparcie)" is proper Polish and carries no diacritic at all, so the blunt
// rule would force the copy to be bent around the test.
//
// The bug the rule exists to catch is the opposite: ASCII-ised Polish, someone
// typing "Dane zespolu" or "wdrozenia" because the source around it is ASCII.
// So the check is a denylist of stripped forms, folded through the same
// mapping scripts/_report.js uses. A label with no Polish word in it passes; a
// label with a Polish word spelled without its diacritics fails.
// Whole words only. A substring test fails on the legitimate copy it is meant
// to protect: 'produktow' sits inside the correct "produktowe", and the first
// version of this list also flagged "ograniczony", which is proper Polish that
// simply has no diacritic. The list holds ONLY forms that are a Polish word
// with its diacritics stripped.
const _ASCII_ISED_POLISH = [
  'zespolu', 'zespol', 'dostep', 'wlasciciela', 'wewnetrzne', 'wdrozenia',
  'wdrozenie', 'sprzedaz', 'sprzedazy', 'produktow', 'uzytkownik', 'uzytkownicy',
  'srodowisko', 'ksiazka',
];

function _assertPolishCopy(text, what) {
  assert.strictEqual(typeof text, 'string');
  assert.ok(text.trim().length > 0, `${what}: empty label`);
  const lower = text.toLowerCase();
  for (const bad of _ASCII_ISED_POLISH) {
    assert.doesNotMatch(lower, new RegExp(`(^|[^a-z\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c])${bad}($|[^a-z\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c])`),
      `${what}: "${text}" contains a Polish word without diacritics ("${bad}")`);
  }
}

test('DATA_REPOS[0] (data-tier-0) is fully wired', () => {
  // Phase D appended seven more rows (see the test below) - this test now
  // pins down data-tier-0 specifically rather than the registry length.
  const d = srv.DATA_REPOS[0];
  assert.strictEqual(d.id, 'data-tier-0');
  _assertPolishCopy(d.label, 'data-tier-0 label');
  for (const fn of ['existsFn', 'gitExecFn', 'resetCheckCache', 'writeToken', 'encryptFn', 'decryptFn', 'keyFn']) {
    assert.strictEqual(typeof d[fn], 'function', `descriptor.${fn} must be a function`);
  }
  assert.strictEqual(typeof d.dir, 'string');
  assert.strictEqual(typeof d.plainDir, 'string');
  assert.strictEqual(typeof d.urlEnvVar, 'string');
  assert.strictEqual(typeof d.canonicalUrl, 'string');
  assert.strictEqual(typeof d.tokenEnvVar, 'string');
});

test('a repoId lookup against DATA_REPOS finds data-tier-0 and rejects an unknown id', () => {
  assert.strictEqual(srv._findDataRepo('data-tier-0'), srv.DATA_REPOS[0]);
  assert.strictEqual(srv._findDataRepo('no-such-repo'), null);
});

test('DATA_REPO_OPERATIONS is the closed list backing the 19 legacy arms plus decrypt, clear-plaintext and resolve-autostash', () => {
  const expectedOps = [
    'status', 'check-update', 'pull-stream', 'clone-stream', 'clone', 'decrypt', 'pull', 'push',
    'push-stream', 'pull-overwrite-stream', 'pull-overwrite', 'local-changes', 'conflict-diff',
    'resolve-conflicts', 'write-resolved', 'discard-local-changes', 'rebase-abort',
    'recover-rebase', 'repair-detached-head', 'clear-dir', 'clear-plaintext', 'resolve-autostash',
  ];
  const actualOps = Object.keys(srv.DATA_REPO_OPERATIONS).sort();
  assert.deepStrictEqual(actualOps, expectedOps.slice().sort());
  // An autostash conflict only arises where the pull pre-encrypts, i.e. where
  // push is served - so the way out is opened exactly there and nowhere else.
  const ra = srv.DATA_REPO_OPERATIONS['resolve-autostash'];
  assert.strictEqual(ra.writable, true);
  assert.ok(!ra.generic, 'resolve-autostash must not be generic');
  for (const d of srv.DATA_REPOS) {
    assert.strictEqual(srv._repoServesOperation(d, 'resolve-autostash'), srv._repoServesOperation(d, 'push-stream'), d.id);
  }
  for (const op of expectedOps) {
    const entry = srv.DATA_REPO_OPERATIONS[op];
    assert.ok(entry.method === 'GET' || entry.method === 'POST', `operation "${op}" needs a GET/POST method`);
    assert.strictEqual(typeof entry.handler, 'function', `operation "${op}" needs a handler function`);
  }
});

// The core ships ONE data source (data-tier-0); DATA_REPO_DEFS is the place
// to declare more and is empty by default.
test('DATA_REPOS carries only the data-tier-0 row and DATA_REPO_DEFS is empty', () => {
  assert.deepStrictEqual(srv.DATA_REPOS.map((d) => d.id), ['data-tier-0']);
  assert.deepStrictEqual(srv.DATA_REPO_DEFS, []);
  for (const d of srv.DATA_REPOS) {
    for (const fn of ['existsFn', 'gitExecFn', 'resetCheckCache', 'writeToken', 'encryptFn', 'decryptFn', 'keyFn']) {
      assert.strictEqual(typeof d[fn], 'function', `descriptor "${d.id}".${fn} must be a function`);
    }
    assert.strictEqual(typeof d.dir, 'string');
    assert.strictEqual(typeof d.plainDir, 'string');
    assert.strictEqual(typeof d.urlEnvVar, 'string');
    assert.strictEqual(typeof d.canonicalUrl, 'string');
    assert.strictEqual(typeof d.tokenEnvVar, 'string');
    assert.strictEqual(d.encrypted, true);
  }
});

// ctx.dataRepoDir: the core hands a module the plaintext dir of a repo it
// DECLARES, by route id or remote name, and nothing else.
test('_moduleDataRepoDir answers only for repos the manifest declares', () => {
  const manifest = { dataRepos: [{ name: 'data-tier-0', paths: ['gantt-roadmap/'] }] };
  assert.strictEqual(srv._moduleDataRepoDir(manifest, 'data-tier-0'), srv._findDataRepo('data-tier-0').plainDir);
  assert.strictEqual(srv._moduleDataRepoDir(manifest, 'data-other'), null, 'unknown repo');
  assert.strictEqual(srv._moduleDataRepoDir(manifest, 'nope'), null, 'unknown repo');
  assert.strictEqual(srv._moduleDataRepoDir(manifest, '../ds-data'), null);
  assert.strictEqual(srv._moduleDataRepoDir({}, 'data-tier-0'), null, 'no dataRepos at all');
  assert.strictEqual(srv._moduleDataRepoDir({ dataRepos: ['data-tier-0'] }, 'data-tier-0'), srv._findDataRepo('data-tier-0').plainDir, 'a bare string entry counts');
  assert.strictEqual(srv._moduleDataRepoDir(manifest, undefined), null);
});

// push/push-stream open for an additional row ONLY when it carries
// pushEnabled === true. A row without the flag stays closed even for a
// writable op, and a row WITH the flag stays closed for a non-writable op.
test('_repoServesOperation opens a writable op only for a row with pushEnabled, and never widens a non-writable op', () => {
  const withPush = { id: 'data-example', pushEnabled: true };
  const withoutPush = { id: 'data-example' };
  assert.strictEqual(srv._repoServesOperation(withPush, 'push'), true);
  assert.strictEqual(srv._repoServesOperation(withPush, 'push-stream'), true);
  assert.strictEqual(srv._repoServesOperation(withoutPush, 'push'), false);
  assert.strictEqual(srv._repoServesOperation(withoutPush, 'push-stream'), false);
  assert.strictEqual(srv._repoServesOperation(withoutPush, 'pull'), true, 'generic ops are open to every row');
  assert.strictEqual(srv._repoServesOperation(withPush, 'local-changes'), false);
  assert.strictEqual(srv._repoServesOperation(withPush, 'no-such-op'), false);
  // data-tier-0 keeps every op regardless of pushEnabled/generic.
  assert.strictEqual(srv._repoServesOperation(srv.DATA_REPOS[0], 'local-changes'), true);
});

test('crypto-sync knows exactly the data-tier-0 key id and no own-line-only source', () => {
  const crypto = require('../scripts/crypto-sync.js');
  assert.deepStrictEqual([...crypto.KNOWN_REPO_IDS], ['ds-data']);
  assert.deepStrictEqual([...crypto.OWN_LINE_ONLY_IDS], []);
});

// Consistency test (AC19): every descriptor with a tokenEnvVar must have a
// matching BW_ITEM_MAP row, an assignment in _reloadBitwardenTokens(), and a
// key in ENV_SCHEMA - skipping (b), the assignment, is what the comment above
// BW_ITEM_MAP calls the worst possible symptom: the vault reports success and
// loads nothing.
test('every DATA_REPOS descriptor with a tokenEnvVar is wired in BW_ITEM_MAP, _reloadBitwardenTokens() and ENV_SCHEMA', () => {
  const reloadSrc = srv._reloadBitwardenTokens.toString();
  const allEnvSchemaKeys = new Set(
    srv.ENV_SCHEMA.flatMap((group) => group.keys.map((k) => k.key))
  );
  for (const d of srv.DATA_REPOS) {
    if (!d.tokenEnvVar) continue;
    const bwRow = srv.BW_ITEM_MAP.find((m) => m.envVar === d.tokenEnvVar);
    assert.ok(bwRow, `BW_ITEM_MAP is missing a row for ${d.tokenEnvVar} (descriptor "${d.id}")`);
    assert.match(
      reloadSrc, new RegExp(`process\\.env\\.${d.tokenEnvVar}\\b`),
      `_reloadBitwardenTokens() never re-reads process.env.${d.tokenEnvVar} (descriptor "${d.id}") - the vault would report success and load nothing`
    );
    assert.ok(allEnvSchemaKeys.has(d.tokenEnvVar), `ENV_SCHEMA is missing a key for ${d.tokenEnvVar} (descriptor "${d.id}")`);
  }
});

// ── Restart handoff ─────────────────────────────────────────────────────────
// The property under test is the one the comment above _restartChildEnv states:
// no secret ever travels in the child's ENVIRONMENT, because a process
// environment is readable with `ps eww` by anyone on the same account. The
// values move over the stdin pipe instead, which is what the parse/apply pair
// below covers.

test('_restartChildEnv strips every secret and the vault session from the child environment', () => {
  const child = srv._restartChildEnv({
    PATH: '/usr/bin',
    HOME: '/home/x',
    COCKPIT_APP_TOKEN: 'glpat-secret',
    JIRA_TOKEN: 'jira-other',
    BW_SESSION: 'session-key',
    BW_COLLECTION_NAME: 'kolekcja',
  });
  assert.strictEqual(child.COCKPIT_APP_TOKEN, undefined);
  assert.strictEqual(child.JIRA_TOKEN, undefined);
  assert.strictEqual(child.BW_SESSION, undefined);
  // Not a secret and not stripped: BW_COLLECTION_NAME is an ENV_SCHEMA key, so
  // it goes too - the child re-reads it from .env (see _persistBwCollectionName).
  assert.strictEqual(child.BW_COLLECTION_NAME, undefined);
  assert.strictEqual(child.PATH, '/usr/bin');
  assert.strictEqual(child.HOME, '/home/x');
});

test('_restartChildEnv does not mutate the environment it was handed', () => {
  const base = { COCKPIT_APP_TOKEN: 'glpat-secret', BW_SESSION: 'session-key' };
  srv._restartChildEnv(base);
  // Two callers pass process.env itself - mutating in place would blank the
  // live process's own config in the 100 ms before it exits.
  assert.strictEqual(base.COCKPIT_APP_TOKEN, 'glpat-secret');
  assert.strictEqual(base.BW_SESSION, 'session-key');
});

test('_parseRestartHandoff accepts a well-formed payload and keeps only allowlisted keys', () => {
  const parsed = srv._parseRestartHandoff(JSON.stringify({
    v: srv.RESTART_HANDOFF_VERSION,
    bwSession: 'abc123==',
    loadedSecrets: ['FIGMA_TOKEN', 'NIE_MOJA_ZMIENNA'],
    lastLoad: { at: '2026-09-06T10:00:00.000Z', itemsSeen: ['FIGMA'], matched: [{ item: 'FIGMA', key: null, envVar: 'FIGMA_TOKEN' }] },
    secrets: { FIGMA_TOKEN: 'figd-x', NIE_MOJA_ZMIENNA: 'x', PATH: '/evil' },
  }));
  assert.ok(parsed);
  assert.strictEqual(parsed.bwSession, 'abc123==');
  // A stream must never be able to name an arbitrary environment variable.
  assert.deepStrictEqual(Object.keys(parsed.secrets), ['FIGMA_TOKEN']);
  assert.deepStrictEqual(parsed.loadedSecrets, ['FIGMA_TOKEN']);
  assert.strictEqual(parsed.lastLoad.at, '2026-09-06T10:00:00.000Z');
});

test('_parseRestartHandoff returns null for anything it cannot vouch for', () => {
  for (const raw of ['', '   ', 'not json', '[]', 'null', JSON.stringify({ v: 999, bwSession: 'x' })]) {
    assert.strictEqual(srv._parseRestartHandoff(raw), null, `should reject: ${JSON.stringify(raw)}`);
  }
  // Nothing to hand over is not a payload.
  assert.strictEqual(srv._parseRestartHandoff(JSON.stringify({
    v: srv.RESTART_HANDOFF_VERSION, bwSession: null, secrets: { PATH: '/evil' },
  })), null);
  // A session key with whitespace is not a session key.
  assert.strictEqual(srv._parseRestartHandoff(JSON.stringify({
    v: srv.RESTART_HANDOFF_VERSION, bwSession: 'abc def', secrets: {},
  })), null);
});

test('_parseRestartHandoff accepts a session with no secrets and secrets with no session', () => {
  const sessionOnly = srv._parseRestartHandoff(JSON.stringify({
    v: srv.RESTART_HANDOFF_VERSION, bwSession: 'abc', secrets: {},
  }));
  assert.strictEqual(sessionOnly.bwSession, 'abc');
  const secretsOnly = srv._parseRestartHandoff(JSON.stringify({
    v: srv.RESTART_HANDOFF_VERSION, secrets: { FIGMA_TOKEN: 'figd-x' },
  }));
  assert.strictEqual(secretsOnly.bwSession, null);
  assert.strictEqual(secretsOnly.secrets.FIGMA_TOKEN, 'figd-x');
});

test('_sanitizeHandoffLastLoad keeps names and drops everything else', () => {
  const out = srv._sanitizeHandoffLastLoad({
    at: 12345,
    itemsSeen: ['FIGMA', 7, null],
    matched: [{ item: 'FIGMA', key: 'FIGMA_TOKEN', envVar: 'FIGMA_TOKEN' }, 'junk'],
    skippedItems: 'not an array',
    skippedKeys: [{ item: 'OBCE', key: 'OBCY_KLUCZ' }],
    value: 'figd-should-not-survive',
  });
  assert.strictEqual(out.at, null);
  assert.deepStrictEqual(out.itemsSeen, ['FIGMA']);
  assert.strictEqual(out.matched.length, 1);
  assert.deepStrictEqual(out.skippedItems, []);
  assert.strictEqual(out.skippedKeys[0].key, 'OBCY_KLUCZ');
  assert.strictEqual('value' in out, false);
  assert.strictEqual(srv._sanitizeHandoffLastLoad(null), null);
  assert.strictEqual(srv._sanitizeHandoffLastLoad('x'), null);
});

test('_applyRestartHandoff assigns allowlisted secrets and reports what it adopted', () => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FIGMA_TOKEN');
  const before = process.env.FIGMA_TOKEN;
  try {
    delete process.env.FIGMA_TOKEN;
    const result = srv._applyRestartHandoff(srv._parseRestartHandoff(JSON.stringify({
      v: srv.RESTART_HANDOFF_VERSION,
      bwSession: 'abc',
      loadedSecrets: ['FIGMA_TOKEN'],
      secrets: { FIGMA_TOKEN: 'figd-handoff' },
    })));
    assert.strictEqual(process.env.FIGMA_TOKEN, 'figd-handoff');
    assert.strictEqual(result.session, true);
    assert.deepStrictEqual(result.secrets, ['FIGMA_TOKEN']);
  } finally {
    if (had) process.env.FIGMA_TOKEN = before; else delete process.env.FIGMA_TOKEN;
  }
  assert.deepStrictEqual(srv._applyRestartHandoff(null), { session: false, secrets: [], lastLoadAdopted: false });
});

test('an adopted diagnostics record is stamped, so it cannot pass as this process reading the vault', () => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FIGMA_TOKEN');
  const before = process.env.FIGMA_TOKEN;
  try {
    const payload = {
      v: srv.RESTART_HANDOFF_VERSION,
      bwSession: 'abc',
      loadedSecrets: ['FIGMA_TOKEN'],
      lastLoad: { at: '2026-09-06T10:00:00.000Z', itemsSeen: ['FIGMA'] },
      secrets: { FIGMA_TOKEN: 'figd-handoff' },
    };
    // The stamp is applied here and never carried on the wire, so a payload
    // cannot claim a first-hand read it did not make.
    assert.strictEqual(srv._parseRestartHandoff(JSON.stringify(payload)).lastLoad.adopted, undefined);
    assert.strictEqual(srv._applyRestartHandoff(srv._parseRestartHandoff(JSON.stringify(payload))).lastLoadAdopted, true);
    // No inherited record, nothing to stamp.
    const noRecord = { ...payload, lastLoad: undefined };
    assert.strictEqual(srv._applyRestartHandoff(srv._parseRestartHandoff(JSON.stringify(noRecord))).lastLoadAdopted, false);
  } finally {
    if (had) process.env.FIGMA_TOKEN = before; else delete process.env.FIGMA_TOKEN;
  }
});

// The dividing line between what any of the eight data sources may do and what
// only data-tier-0 may do is NOT read-vs-write: it is "does the op call
// encryptFn". encryptTree unlinks every .enc it finds no plaintext for, so
// running it against a source whose plaintext tree is empty wipes that mirror.
// `generic: true` therefore marks EXACTLY the non-encrypting ops; this test is
// what stops a future `generic: true` on push or local-changes from landing.
test('DATA_REPO_OPERATIONS: generic ops are exactly the non-encrypting ones', () => {
  const ops = srv.DATA_REPO_OPERATIONS;
  const generic = Object.keys(ops).filter((k) => ops[k].generic).sort();
  // decrypt is mirror -> plaintext only: it touches no git state and can
  // destroy nothing the mirror holds, so every source may run it - it is the
  // way in for a source cloned before its key existed.
  assert.deepStrictEqual(generic, ['clear-dir', 'clear-plaintext', 'clone', 'clone-stream', 'decrypt', 'pull', 'pull-stream']);
  for (const k of generic) {
    assert.strictEqual(typeof ops[k].repoHandler, 'function', k + ' needs a descriptor-taking driver');
    assert.doesNotMatch(String(ops[k].repoHandler), /\bencryptTree\b|\b_repoEncrypt\b|\bencryptFn\b|\bdataTier0Encrypt\b/,
      k + ' is generic and must never reach encryptFn');
  }
  // push/push-stream DO encrypt, so they are never `generic` - but Phase A
  // opens them for a row with `pushEnabled: true` (today only data-mobile)
  // through `writable: true` + a repoHandler, a SEPARATE widening from
  // `generic` (see _repoServesOperation). Neither carries `generic`.
  const writable = ['push', 'push-stream'];
  for (const k of writable) {
    assert.ok(ops[k], k + ' must exist');
    assert.ok(!ops[k].generic, k + ' must not be generic - it encrypts');
    assert.strictEqual(ops[k].writable, true, k + ' must be marked writable for _repoServesOperation');
    assert.strictEqual(typeof ops[k].repoHandler, 'function', k + ' needs a descriptor-taking driver for the pushEnabled row');
  }
  const tier0Only = [
    'pull-overwrite', 'pull-overwrite-stream', 'local-changes',
    'conflict-diff', 'resolve-conflicts', 'write-resolved', 'discard-local-changes',
    'rebase-abort', 'recover-rebase', 'repair-detached-head',
  ];
  for (const k of tier0Only) {
    assert.ok(ops[k], k + ' must exist');
    assert.ok(!ops[k].generic, k + ' encrypts (or re-encrypts) and must stay data-tier-0 only');
    assert.strictEqual(ops[k].repoHandler, undefined, k + ' must have no descriptor-taking driver');
  }
});

// Settings > Agents patches the `model:` line of committed .claude/agents/*.md,
// so a machine where somebody picked a model has a permanently dirty tree and
// the app update refused forever. The exemption must stay razor thin: every
// case below that is NOT purely the model line has to keep blocking, because
// the update hard-resets the tree.
const AGENT_HEAD = [
  '---',
  'name: idea-planner',
  'description: Plans a change.',
  'model: claude-opus-4-6',
  'tools: Read, Write',
  '---',
  '',
  'Brief body.',
  '',
].join('\n');

test('_isModelOnlyAgentDiff exempts a brief dirty only on the model line', () => {
  const work = AGENT_HEAD.replace('model: claude-opus-4-6', 'model: claude-sonnet-4-5');
  assert.strictEqual(srv._isModelOnlyAgentDiff(work, AGENT_HEAD), true);
});

test('_isModelOnlyAgentDiff tolerates CRLF on one side (core.autocrlf)', () => {
  const work = AGENT_HEAD.replace('model: claude-opus-4-6', 'model: claude-sonnet-4-5').replace(/\n/g, '\r\n');
  assert.strictEqual(srv._isModelOnlyAgentDiff(work, AGENT_HEAD), true);
});

test('_isModelOnlyAgentDiff blocks every diff that is not just the model line', () => {
  // Body edited, model line untouched - real work.
  assert.strictEqual(srv._isModelOnlyAgentDiff(AGENT_HEAD.replace('Brief body.', 'Rewritten body.'), AGENT_HEAD), false);
  // Body AND model edited - still real work.
  const both = AGENT_HEAD.replace('model: claude-opus-4-6', 'model: claude-sonnet-4-5').replace('Brief body.', 'Rewritten body.');
  assert.strictEqual(srv._isModelOnlyAgentDiff(both, AGENT_HEAD), false);
  // Another frontmatter key edited.
  assert.strictEqual(srv._isModelOnlyAgentDiff(AGENT_HEAD.replace('tools: Read, Write', 'tools: Read'), AGENT_HEAD), false);
  // Identical - not dirty, so nothing to exempt.
  assert.strictEqual(srv._isModelOnlyAgentDiff(AGENT_HEAD, AGENT_HEAD), false);
  // No frontmatter, or no model line in HEAD: ambiguous, so it blocks.
  assert.strictEqual(srv._isModelOnlyAgentDiff('plain\n', 'other\n'), false);
  const noModel = AGENT_HEAD.replace('model: claude-opus-4-6\n', '');
  assert.strictEqual(srv._isModelOnlyAgentDiff(AGENT_HEAD, noModel), false);
  // Not strings at all (an unreadable blob).
  assert.strictEqual(srv._isModelOnlyAgentDiff(null, AGENT_HEAD), false);
});

// `gitnexus analyze` rewrites the fenced GitNexus block of AGENTS.md and
// CLAUDE.md (the older CLI one counts line, the newer one the whole block), so
// reindexing after a pull dirties two files nobody edited. Same thinness as
// the model line, one size up: ONLY the fenced block may differ.
const BANNER_HEAD = [
  '# Project',
  '',
  '<!-- gitnexus:start -->',
  'This project is indexed by GitNexus as **mission-deck** (3655 symbols, 10355 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.',
  '<!-- gitnexus:end -->',
  '',
  'Body paragraph.',
  '',
].join('\n');
const BANNER_REINDEXED = BANNER_HEAD.replace('3655 symbols, 10355 relationships, 300 execution flows', '2735 symbols, 7028 relationships, 232 execution flows');

test('_isGitnexusBannerOnlyDiff exempts a document dirty only inside the fenced block', () => {
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_REINDEXED, BANNER_HEAD), true);
  // CRLF on one side (core.autocrlf).
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_REINDEXED.replace(/\n/g, '\r\n'), BANNER_HEAD), true);
  // The newer CLI rewrites the WHOLE block, wording, headings, tables and all.
  const rewritten = BANNER_HEAD.replace(/<!-- gitnexus:start -->[\s\S]*<!-- gitnexus:end -->/,
    '<!-- gitnexus:start -->\n# GitNexus\n\nIndexed as **mission-deck**.\n\n| a | b |\n|---|---|\n<!-- gitnexus:end -->');
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(rewritten, BANNER_HEAD), true);
});

test('_isGitnexusBannerOnlyDiff blocks every diff that reaches outside the fenced block', () => {
  // Body edited, block untouched - real work.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_HEAD.replace('Body paragraph.', 'Rewritten.'), BANNER_HEAD), false);
  // Body AND block edited - still real work.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_REINDEXED.replace('Body paragraph.', 'Rewritten.'), BANNER_HEAD), false);
  // Identical - not dirty.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_HEAD, BANNER_HEAD), false);
  // No fence in HEAD, or the fence removed from the worktree: ambiguous, so it blocks.
  const noFence = BANNER_HEAD.replace('<!-- gitnexus:start -->\n', '').replace('<!-- gitnexus:end -->\n', '');
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_REINDEXED, noFence), false);
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(noFence, BANNER_HEAD), false);
  // Not strings at all.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(null, BANNER_HEAD), false);
});

test('_isGitnexusBannerOnlyDiff blocks every malformed fence rather than guessing', () => {
  // Missing end marker on the worktree side.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_REINDEXED.replace('<!-- gitnexus:end -->\n', ''), BANNER_HEAD), false);
  // Missing end marker on the HEAD side.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_REINDEXED, BANNER_HEAD.replace('<!-- gitnexus:end -->\n', '')), false);
  // Two start markers.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_REINDEXED.replace('# Project', '# Project\n<!-- gitnexus:start -->'), BANNER_HEAD), false);
  // Two end markers.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(BANNER_REINDEXED + '<!-- gitnexus:end -->\n', BANNER_HEAD), false);
  // End before start.
  const swapped = BANNER_REINDEXED.replace('<!-- gitnexus:start -->', '@@S@@').replace('<!-- gitnexus:end -->', '<!-- gitnexus:start -->').replace('@@S@@', '<!-- gitnexus:end -->');
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(swapped, BANNER_HEAD), false);
  // A start marker moved to another place: the text before it now differs.
  const moved = BANNER_REINDEXED.replace('<!-- gitnexus:start -->\n', '').replace('# Project\n', '# Project\n<!-- gitnexus:start -->\n');
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(moved, BANNER_HEAD), false);
});

test('_appUpdateDirtEntries only ever considers modified agent paths', async () => {
  // Nothing here is a real agent file in this repo's HEAD except by accident,
  // so the point of the assertion is the ROUTING: an untracked or added agent
  // file, and any non-agent path, must land in `blocking` without a git call.
  const porcelain = [
    '?? .claude/agents/brand-new.md',
    'A  .claude/agents/staged-new.md',
    ' D .claude/agents/deleted.md',
    ' M server.js',
    '?? plans/notatka.md',
    '?? AGENTS.md',
    ' M docs/CLAUDE.md',
  ].join('\n');
  const { blocking, exempt } = await srv._appUpdateDirtEntries(porcelain);
  assert.deepStrictEqual(exempt, []);
  assert.deepStrictEqual(blocking, [
    '.claude/agents/brand-new.md',
    '.claude/agents/staged-new.md',
    '.claude/agents/deleted.md',
    'server.js',
    'plans/notatka.md',
    'AGENTS.md',
    'docs/CLAUDE.md',
  ]);
});

test('_appUpdateDirtEntries on a clean tree reports nothing', async () => {
  const { blocking, exempt } = await srv._appUpdateDirtEntries('');
  assert.deepStrictEqual(blocking, []);
  assert.deepStrictEqual(exempt, []);
});

// The git half of the exemption, against a throwaway repo: everything above
// this point feeds _appUpdateDirtEntries lines that route to blocking without
// a `git show`, so the read-HEAD-and-compare path needs a real commit.
test('_appUpdateDirtEntries exempts a model-line edit and blocks a body edit, on a real repo', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dirt-entries-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  try {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
    const brief = (model, body) => `---\nname: idea-planner\nmodel: ${model}\n---\n\n${body}\n`;
    const patched = path.join(repo, '.claude', 'agents', 'idea-planner.md');
    const edited = path.join(repo, '.claude', 'agents', 'reviewer.md');
    fs.writeFileSync(patched, brief('claude-opus-4-6', 'Brief body.'));
    fs.writeFileSync(edited, brief('claude-opus-4-6', 'Brief body.'));
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), BANNER_HEAD);
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), BANNER_HEAD);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'seed']);

    fs.writeFileSync(patched, brief('claude-sonnet-4-5', 'Brief body.'));   // the patcher
    fs.writeFileSync(edited, brief('claude-opus-4-6', 'Rewritten body.'));  // a person
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), BANNER_REINDEXED);        // gitnexus analyze
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), BANNER_REINDEXED.replace('Body paragraph.', 'Rewritten.')); // reindex AND a person

    const porcelain = git(['status', '--porcelain']);
    const { blocking, exempt } = await srv._appUpdateDirtEntries(porcelain, repo);
    assert.deepStrictEqual(exempt.sort(), ['.claude/agents/idea-planner.md', 'AGENTS.md']);
    assert.deepStrictEqual(blocking.sort(), ['.claude/agents/reviewer.md', 'CLAUDE.md']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// The older GitNexus CLI, run by `npm run setup` on a fresh archive, rewrites
// the tracked .claude/skills/gitnexus/ files wholesale and drops flat
// `.claude/skills/gitnexus-<sub>/` and `.claude/skills/generated/` directories
// next to them. Both exemptions are ROUTING decisions that never cost a git
// call, so they are asserted on synthetic porcelain against the real ROOT.
test('_appUpdateDirtEntries exempts the generated GitNexus skill files without reading them', async () => {
  const porcelain = [
    ' M .claude/skills/gitnexus/SKILL.md',
    'MM .claude/skills/gitnexus/gitnexus-cli/SKILL.md',
    ' M .claude/skills/new-idea/SKILL.md',       // a real skill, hand-written
    'A  .claude/skills/gitnexus/brand-new.md',   // added, not modified - never a generator's doing
  ].join('\n');
  const { blocking, exempt, untracked } = await srv._appUpdateDirtEntries(porcelain);
  assert.deepStrictEqual(exempt, ['.claude/skills/gitnexus/SKILL.md', '.claude/skills/gitnexus/gitnexus-cli/SKILL.md']);
  assert.deepStrictEqual(blocking, ['.claude/skills/new-idea/SKILL.md', '.claude/skills/gitnexus/brand-new.md']);
  assert.deepStrictEqual(untracked, []);
});

test('_appUpdateDirtEntries exempts exactly the two untracked generator prefixes', async () => {
  const porcelain = [
    '?? .claude/skills/gitnexus-cli/',            // directory form, trailing slash
    '?? .claude/skills/gitnexus-guide/',
    '?? .claude/skills/gitnexus-cli/plik.md',     // file form
    '?? .claude/skills/generated/',
    '?? .claude/skills/generated/x/y.md',
    '?? something-else.md',
    '?? .claude/skills/gitnexus/nowy.md',         // inside the TRACKED skill: not on the list
    '?? .claude/skills/gitnexusowy/',             // prefix must match literally
    '?? "path with \\"quote\\".md"',           // quoted by porcelain: no unquoting, so it blocks
  ].join('\n');
  const { blocking, exempt, untracked } = await srv._appUpdateDirtEntries(porcelain);
  assert.deepStrictEqual(exempt, [
    '.claude/skills/gitnexus-cli/',
    '.claude/skills/gitnexus-guide/',
    '.claude/skills/gitnexus-cli/plik.md',
    '.claude/skills/generated/',
    '.claude/skills/generated/x/y.md',
  ]);
  assert.deepStrictEqual(blocking, [
    'something-else.md',
    '.claude/skills/gitnexus/nowy.md',
    '.claude/skills/gitnexusowy/',
    '"path with \\"quote\\".md"',
  ]);
  // Every blocking `??` is also reported as untracked - the set a stash without -u leaves behind.
  assert.deepStrictEqual(untracked, blocking);
});

// The stash escape hatch and the `??` routing, on a real repo. One fixture
// with everything the "fresh archive after npm run setup" tree has: a
// hand-edited tracked file, a rewritten tracked skill file, the CLI's flat
// directories - and one untracked stranger to prove the refusal.
function _makeDirtyRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'stash-dirty-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(repo, '.claude', 'skills', 'gitnexus'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'js'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'skills', 'gitnexus', 'SKILL.md'), '# committed skill\n');
  fs.writeFileSync(path.join(repo, 'js', 'app.js'), 'export const v = 1;\n');
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), BANNER_HEAD);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'seed']);
  // What the tree looks like after `npm run setup` with the older CLI ...
  fs.writeFileSync(path.join(repo, '.claude', 'skills', 'gitnexus', 'SKILL.md'), '# regenerated skill, entirely different\n');
  fs.mkdirSync(path.join(repo, '.claude', 'skills', 'gitnexus-cli'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'skills', 'gitnexus-cli', 'SKILL.md'), 'cli\n');
  fs.mkdirSync(path.join(repo, '.claude', 'skills', 'generated'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'skills', 'generated', 'index.md'), 'gen\n');
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), BANNER_REINDEXED);
  // ... plus one tracked edit a person made.
  fs.writeFileSync(path.join(repo, 'js', 'app.js'), 'export const v = 2;\n');
  return { repo, git };
}

test('_appUpdateDirtEntries on a real repo: generated skill files and directories are exempt, a tracked edit blocks', async () => {
  const { repo, git } = _makeDirtyRepo();
  try {
    const { blocking, exempt, untracked } = await srv._appUpdateDirtEntries(git(['status', '--porcelain']), repo);
    assert.deepStrictEqual(exempt.sort(), ['.claude/skills/generated/', '.claude/skills/gitnexus-cli/', '.claude/skills/gitnexus/SKILL.md', 'AGENTS.md']);
    assert.deepStrictEqual(blocking, ['js/app.js']);
    assert.deepStrictEqual(untracked, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('_appUpdateStashDirty parks the tracked work, verifies the tree is clean and never pops', async () => {
  const { repo, git } = _makeDirtyRepo();
  try {
    const message = 'cockpit-update 2026-09-10T10:00:00.000Z v1.2.3';
    const r = await srv._appUpdateStashDirty(repo, message);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.ref, 'stash@{0}');
    assert.strictEqual(r.message, message);
    // The stash took exactly the BLOCKING list - the person's edit - by
    // explicit pathspec, and the entry carries our message. The generated
    // edits (the regenerated skill file, the banner) are exempt, so they
    // stay in the tree for the hard reset to drop, as they always did.
    assert.deepStrictEqual(r.files, ['js/app.js']);
    assert.ok(git(['stash', 'list', '-1', '--format=%s']).trim().endsWith(message));
    assert.strictEqual(fs.readFileSync(path.join(repo, 'js', 'app.js'), 'utf8'), 'export const v = 1;\n', 'the worktree is back at HEAD');
    // What is left is exactly the exempt set - nothing blocks any more.
    const after = await srv._appUpdateDirtEntries(git(['status', '--porcelain']), repo);
    assert.deepStrictEqual(after.blocking, []);
    assert.deepStrictEqual(after.exempt.sort(), ['.claude/skills/generated/', '.claude/skills/gitnexus-cli/', '.claude/skills/gitnexus/SKILL.md', 'AGENTS.md']);
    // Never popped: the entry is still there.
    assert.strictEqual(git(['stash', 'list']).trim().split('\n').length, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('_appUpdateStashDirty takes an untracked new file along - a module author tree is nothing but those', async () => {
  const { repo, git } = _makeDirtyRepo();
  try {
    fs.writeFileSync(path.join(repo, 'something-else.md'), 'mine\n');
    fs.mkdirSync(path.join(repo, 'new-dir', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'new-dir', 'sub', 'file.js'), 'x\n');
    // An IGNORED file must never travel: it is exactly what -a would take.
    fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n.gitignore\n');
    fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
    const r = await srv._appUpdateStashDirty(repo, 'cockpit-update x v0.0.0');
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(r.files.sort(), ['js/app.js', 'new-dir/sub/file.js', 'something-else.md']);
    assert.ok(!fs.existsSync(path.join(repo, 'something-else.md')), 'the new file is on the stash, not in the tree');
    assert.ok(!fs.existsSync(path.join(repo, 'new-dir')), 'and so is the new directory');
    assert.strictEqual(fs.readFileSync(path.join(repo, '.env'), 'utf8'), 'SECRET=1\n', 'ignored files stay on disk');
    const after = await srv._appUpdateDirtEntries(git(['status', '--porcelain']), repo);
    assert.deepStrictEqual(after.blocking, []);
    // And apply brings the new file back, untracked again.
    git(['stash', 'apply', '-q']);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'something-else.md'), 'utf8'), 'mine\n');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('_appUpdateStashDirty refuses BEFORE stashing a path git had to quote - the one shape a pathspec cannot name', async () => {
  const { repo, git } = _makeDirtyRepo();
  try {
    fs.writeFileSync(path.join(repo, 'with space.md'), 'mine\n');
    const r = await srv._appUpdateStashDirty(repo, 'cockpit-update x v0.0.0');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'dirty-tree');
    assert.deepStrictEqual(r.untracked, ['"with space.md"']);
    assert.match(r.message, /quote/);
    assert.strictEqual(git(['stash', 'list']).trim(), '', 'no stash was created');
    assert.strictEqual(fs.readFileSync(path.join(repo, 'js', 'app.js'), 'utf8'), 'export const v = 2;\n', 'the edit is untouched');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('_appUpdateStashSplit: pure - only a quoted path is unstashable', () => {
  const r = srv._appUpdateStashSplit(['js/app.js', 'new.md', '"with space.md"', 'dir/', '']);
  assert.deepStrictEqual(r.stashable, ['js/app.js', 'new.md', 'dir/']);
  assert.deepStrictEqual(r.unstashable, ['"with space.md"', '']);
  assert.deepStrictEqual(srv._appUpdateStashSplit(null), { stashable: [], unstashable: [] });
});

test('_appUpdateStashDirty on a tree with nothing blocking reports stash-missing and touches nothing', async () => {
  const { repo, git } = _makeDirtyRepo();
  try {
    fs.writeFileSync(path.join(repo, 'js', 'app.js'), 'export const v = 1;\n'); // undo the person's edit
    const r = await srv._appUpdateStashDirty(repo, 'cockpit-update x v0.0.0');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'stash-missing');
    assert.strictEqual(git(['stash', 'list']).trim(), '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// -- Bitwarden: collection name from the request body --------------------------
// The persisting branch (collection found -> writeEnvFile) is NOT exercised
// here, because it writes the real .env of the checkout; these cases cover the
// pointing and the revert, which is where a typo used to overwrite a working
// name.
test('_bwApplyCollectionName points process.env at the body name and reports the change', () => {
  const before = process.env.BW_COLLECTION_NAME;
  try {
    process.env.BW_COLLECTION_NAME = 'old';
    const applied = srv._bwApplyCollectionName({ collectionName: '  new ' });
    assert.deepStrictEqual(applied, { collectionName: 'new', previous: 'old', changed: true });
    assert.strictEqual(process.env.BW_COLLECTION_NAME, 'new');

    const same = srv._bwApplyCollectionName({ collectionName: 'new' });
    assert.strictEqual(same.changed, false);

    const none = srv._bwApplyCollectionName({});
    assert.deepStrictEqual(none, { collectionName: 'new', previous: 'new', changed: false });

    const empty = srv._bwApplyCollectionName({ collectionName: '   ' });
    assert.strictEqual(empty.changed, false);
    assert.strictEqual(empty.collectionName, 'new');
  } finally {
    if (before === undefined) delete process.env.BW_COLLECTION_NAME; else process.env.BW_COLLECTION_NAME = before;
  }
});

test('_bwSettleCollectionName puts the previous name back when the collection was not found', () => {
  const before = process.env.BW_COLLECTION_NAME;
  try {
    process.env.BW_COLLECTION_NAME = 'old';
    const applied = srv._bwApplyCollectionName({ collectionName: 'literowka' });
    srv._bwSettleCollectionName(applied, false);
    assert.strictEqual(process.env.BW_COLLECTION_NAME, 'old');

    delete process.env.BW_COLLECTION_NAME;
    const fresh = srv._bwApplyCollectionName({ collectionName: 'literowka' });
    assert.strictEqual(process.env.BW_COLLECTION_NAME, 'literowka');
    srv._bwSettleCollectionName(fresh, false);
    assert.strictEqual(process.env.BW_COLLECTION_NAME, undefined);

    // An unchanged name is never touched, found or not.
    process.env.BW_COLLECTION_NAME = 'old';
    srv._bwSettleCollectionName(srv._bwApplyCollectionName({}), false);
    assert.strictEqual(process.env.BW_COLLECTION_NAME, 'old');
  } finally {
    if (before === undefined) delete process.env.BW_COLLECTION_NAME; else process.env.BW_COLLECTION_NAME = before;
  }
});

test('_bwOutputSaysLocked recognises the master-password prompt a stale session triggers', () => {
  assert.strictEqual(srv._bwOutputSaysLocked({ stdout: '? Master password: [input is hidden]', stderr: 'node:internal/readline ERR_USE_AFTER_CLOSE' }), true);
  assert.strictEqual(srv._bwOutputSaysLocked({ stdout: '', stderr: 'Vault is locked.' }), true);
  assert.strictEqual(srv._bwOutputSaysLocked({ stdout: '', stderr: 'You are not logged in.' }), true);
  assert.strictEqual(srv._bwOutputSaysLocked({ stdout: '', stderr: 'getaddrinfo ENOTFOUND vault.bitwarden.com' }), false);
  assert.strictEqual(srv._bwOutputSaysLocked({}), false);
});

// ── Odswiezenie stanu zdalnego (POST /api/sync-overview/refresh) ────────────
// The two pure decisions behind the batch fetch. The bug they close: every
// "server" number in a sync row (filesToFetch, behind, remoteAt) is read off
// `@{upstream}` - a LOCAL ref git only moves on fetch/pull/push - so with
// nothing in the read path fetching, a teammate's push stayed invisible in
// the sync table until somebody pulled by hand.

test('remoteRefreshDue: force always wins, a never-tried source is due, the TTL holds the rest', () => {
  // `lastAt` is the last ATTEMPT, not the last success - a failing source is
  // gated the same way, or every modal open re-runs its 45 s timeout.
  const now = 1_000_000;
  assert.strictEqual(srv.remoteRefreshDue(null, now, false, 60_000), true, 'never tried -> due');
  assert.strictEqual(srv.remoteRefreshDue(0, now, false, 60_000), true, 'a falsy timestamp is "never", not "just now"');
  assert.strictEqual(srv.remoteRefreshDue(now - 1_000, now, false, 60_000), false, 'inside the TTL -> skip');
  // The button's whole purpose: "I know somebody just pushed".
  assert.strictEqual(srv.remoteRefreshDue(now - 1_000, now, true, 60_000), true);
  assert.strictEqual(srv.remoteRefreshDue(now - 60_000, now, false, 60_000), true, 'exactly the TTL -> due');
  assert.strictEqual(srv.remoteRefreshDue(now - 120_000, now, false, 60_000), true);
});

test('remoteRefreshTargets: only a cloned source holding a token is fetched', () => {
  const row = (id, exists, token) => ({ id, existsFn: () => exists, writeToken: () => token });
  const rows = [
    row('cloned-with-token', true, 'glpat-x'),
    row('cloned-no-token', true, ''),      // fetch would be a guaranteed 401
    row('not-cloned', false, 'glpat-x'),   // no .git to write refs into
    row('neither', false, null),
  ];
  assert.deepStrictEqual(srv.remoteRefreshTargets(rows).map(d => d.id), ['cloned-with-token']);
  assert.deepStrictEqual(srv.remoteRefreshTargets([]), []);
  assert.deepStrictEqual(srv.remoteRefreshTargets(null), []);
});

test('every DATA_REPOS row exposes what a remote refresh needs', () => {
  // The batch reads these four off the descriptor; a new row missing one would
  // throw inside Promise.allSettled and report as a bare 'error'.
  for (const d of srv.DATA_REPOS) {
    assert.strictEqual(typeof d.existsFn, 'function', d.id);
    assert.strictEqual(typeof d.writeToken, 'function', d.id);
    assert.strictEqual(typeof d.resetCheckCache, 'function', d.id);
    assert.strictEqual(typeof d.dir, 'string', d.id);
  }
});

// ── Nazwane zakresy core w oknie synchronizacji (SYNC_CORE_SCOPES) ─────────
// The sync window grouped pending files by installed modules' dataRepos[].paths
// alone, so data the CORE writes into the team repo (Academy's progress
// and mural, the team directory) had no row of its own - it fell into the
// "Cockpit Core" complement, which is the one row a person cannot act on.

test('SYNC_CORE_SCOPES ids can never collide with an installed module id', () => {
  // The whole safety of adding these rows next to module rows: MODULE_ID_RE
  // cannot produce a leading underscore, the same property '_core' relies on.
  for (const scope of srv.SYNC_CORE_SCOPES) {
    assert.ok(scope.id.startsWith('_'), scope.id);
    assert.strictEqual(srv.MODULE_ID_RE.test(scope.id), false, scope.id + ' must not be a valid module id');
    assert.notStrictEqual(scope.id, srv.SYNC_CORE_ID, 'must not shadow the complement row');
    assert.ok(Array.isArray(scope.entries) && scope.entries.length > 0, scope.id);
    assert.ok(typeof scope.label === 'string' && scope.label.length > 0, scope.id);
    // Every scope must name a repo the registry actually has.
    assert.ok(srv.DATA_REPOS.some((d) => d.id === scope.repo), scope.repo);
  }
  const ids = srv.SYNC_CORE_SCOPES.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate ids');
});

test('_syncModuleScopes marks a scope that was ASSUMED, not declared', () => {
  // The flag the module sync bar reads to tell "this module owns nothing here"
  // apart from "this source was never fetched". Synthetic manifests, so the
  // test never depends on which modules happen to be installed here.
  const mk = (id, dataRepos) => ({ id, manifest: { name: id, dataRepos } });
  const scopes = srv._buildSyncScopes([
    mk('bare', ['data-tier-0']),
    mk('assumed', [{ name: 'data-tier-0', description: 'x' }]),
    mk('declared', [{ name: 'data-tier-0', paths: ['declared/'] }]),
    mk('reader', [{ name: 'data-tier-0', access: 'read', paths: ['team/'] }]),
  ])['data-tier-0'];
  const row = (id) => scopes.find((r) => r.id === id);
  assert.strictEqual(row('bare').declaredPaths, false);
  assert.deepStrictEqual(row('bare').entries, ['bare/']);
  assert.strictEqual(row('assumed').declaredPaths, false);
  assert.strictEqual(row('declared').declaredPaths, true);
  // A read entry always names its paths, so it always counts as declared.
  assert.strictEqual(row('reader').declaredPaths, true);
  for (const r of scopes) {
    if (r.id.startsWith('_')) assert.strictEqual(r.declaredPaths, true, 'core scopes always declare their paths');
  }
});

test('_syncModuleScopes splits a manifest into entries (write) and reads, with access', () => {
  const mk = (id, dataRepos) => ({ id, manifest: { name: id, dataRepos } });
  const scopes = srv._buildSyncScopes([
    mk('writer', [{ name: 'data-tier-0', paths: ['writer/'] }]),
    mk('reader', [{ name: 'data-tier-0', access: 'read', paths: ['team/'] }]),
    mk('mixed', [
      { name: 'data-tier-0', paths: ['mixed/'] },
      { name: 'mission-deck-data', access: 'read', paths: ['team/'] },
    ]),
  ])['data-tier-0'];
  const row = (id) => scopes.find((r) => r.id === id);
  assert.deepStrictEqual([row('writer').entries, row('writer').reads, row('writer').access], [['writer/'], [], 'write']);
  assert.deepStrictEqual([row('reader').entries, row('reader').reads, row('reader').access], [[], ['team/'], 'read']);
  assert.deepStrictEqual([row('mixed').entries, row('mixed').reads, row('mixed').access], [['mixed/'], ['team/'], 'mixed']);
  // Ownership of team/ stays with the core scope: readers never enter entries.
  assert.strictEqual(srv._matchScopeId('team/x.json', scopes), '_team');
  for (const core of scopes.filter((r) => r.id.startsWith('_'))) {
    assert.deepStrictEqual(core.reads, []);
    assert.strictEqual(core.access, 'write');
  }
});

test('_syncModuleScopes appends the core scopes AFTER the module ones', () => {
  const all = srv._syncModuleScopes({ force: true });
  for (const scope of srv.SYNC_CORE_SCOPES) {
    const ids = (all[scope.repo] || []).map((s) => s.id);
    assert.ok(ids.includes(scope.id), scope.id + ' missing from ' + scope.repo + ': ' + ids.join(','));
  }
  for (const [repoId, rows] of Object.entries(all)) {
    const ids = rows.map((s) => s.id);
    // Order IS the match precedence (_matchScopeId returns the first hit), so
    // every core scope must sit behind every module scope.
    const firstCore = ids.findIndex((id) => id.startsWith('_'));
    const lastModule = ids.reduce((acc, id, i) => (id.startsWith('_') ? acc : i), -1);
    if (firstCore !== -1 && lastModule !== -1) {
      assert.ok(firstCore > lastModule, repoId + ': a core scope must never precede a module scope: ' + ids.join(','));
    }
  }
});

test('a core scope owns the paths it declares, and a module still wins over it', () => {
  const core = srv.SYNC_CORE_SCOPES.find((s) => s.id === '_academy');
  const scopes = [core];
  assert.strictEqual(srv._matchScopeId('academy/progress/alex-morgan.json', scopes), '_academy');
  assert.strictEqual(srv._matchScopeId('academy/mural/alex-morgan.md', scopes), '_academy');
  // Anything outside stays in the complement (null -> "Cockpit Core").
  assert.strictEqual(srv._matchScopeId('moduly/pip-demo-1.0.0.zip', scopes), null);
  assert.strictEqual(srv._matchScopeId('academy-inne/x.json', scopes), null);

  // Precedence: a module declaring the same prefix keeps its files, because
  // _syncModuleScopes puts module scopes first.
  const withModule = [{ id: 'szkolenie', label: 'Academy', entries: ['academy/'] }, core];
  assert.strictEqual(srv._matchScopeId('academy/progress/x.json', withModule), 'szkolenie');
});

test('_prototypes owns the prototypes/ tree of the team data', () => {
  const core = srv.SYNC_CORE_SCOPES.find((s) => s.id === '_prototypes');
  assert.ok(core, '_prototypes must be declared');
  assert.strictEqual(core.repo, 'data-tier-0');
  const scopes = [core];
  assert.strictEqual(srv._matchScopeId('prototypes/prototypes.json', scopes), '_prototypes');
  assert.strictEqual(srv._matchScopeId('prototypes/proto-abc/index.tsx', scopes), '_prototypes');
  assert.strictEqual(srv._matchScopeId('prototypes/_shared/demo-state.ts', scopes), '_prototypes');
  assert.strictEqual(srv._matchScopeId('activity.json', scopes), null);
});

test('SYNC_CORE_SCOPES names only what the core itself writes', () => {
  // A per-module row here is the list the manifest declaration replaced.
  assert.deepStrictEqual(srv.SYNC_CORE_SCOPES.map((s) => s.id), ['_academy', '_team', '_prototypes']);
  for (const scope of srv.SYNC_CORE_SCOPES) assert.strictEqual(scope.repo, 'data-tier-0', scope.id);
});

// ── A read (dataRepos[].access 'read') is a view, not ownership ─────────
const READ_SCOPES = [
  { id: 'a', label: 'A', entries: ['a/'], reads: ['team/'] },
  { id: 'b', label: 'B', entries: [], reads: ['team/', 'discovery-tasks/'] },
  { id: '_team', label: 'Team', entries: ['team/'], reads: [] },
];

test('_matchReaderIds lists every reader in scope order and never decides ownership', () => {
  assert.strictEqual(srv._matchScopeId('team/x.json', READ_SCOPES), '_team');
  assert.deepStrictEqual(srv._matchReaderIds('team/x.json', READ_SCOPES), ['a', 'b']);
  assert.strictEqual(srv._matchScopeId('discovery-tasks/x.json', READ_SCOPES), null);
  assert.deepStrictEqual(srv._matchReaderIds('discovery-tasks/x.json', READ_SCOPES), ['b']);
  assert.deepStrictEqual(srv._matchReaderIds('other.json', READ_SCOPES), []);
  // Scopes without a `reads` field (older shape) are simply not readers.
  assert.deepStrictEqual(srv._matchReaderIds('team/x.json', [{ id: 'z', entries: ['team/'] }]), []);
});

test('the reads option adds reader views and never changes ownership or core', () => {
  const pending = new Map([
    ['1.enc', { relPath: 'team/x.json', status: 'M' }],
    ['2.enc', { relPath: 'discovery-tasks/d.json', status: 'A' }],
    ['3.enc', { relPath: 'a/f.json', status: 'M' }],
  ]);
  const plain = srv._classifySyncPending(pending, READ_SCOPES);
  const viewed = srv._classifySyncPending(pending, READ_SCOPES, { reads: true });
  assert.deepStrictEqual(viewed.core, plain.core);
  assert.deepStrictEqual(plain.core.map((i) => i.relPath), ['discovery-tasks/d.json']);
  assert.strictEqual(plain.byModule.get('b'), undefined);
  assert.deepStrictEqual(viewed.byModule.get('b').map((i) => i.relPath).sort(), ['discovery-tasks/d.json', 'team/x.json']);
  assert.deepStrictEqual(viewed.byModule.get('_team').map((i) => i.relPath), ['team/x.json']);
  // The owner's own file is not duplicated on its own row.
  assert.deepStrictEqual(viewed.byModule.get('a').map((i) => i.relPath).sort(), ['a/f.json', 'team/x.json']);

  const nameMap = new Map([['1.enc', 'team/x.json'], ['2.enc', 'discovery-tasks/d.json']]);
  const rPlain = srv._classifyRemoteAheadFiles(['1.enc', '2.enc'], nameMap, READ_SCOPES);
  const rView = srv._classifyRemoteAheadFiles(['1.enc', '2.enc'], nameMap, READ_SCOPES, { reads: true });
  assert.deepStrictEqual(rView.core, rPlain.core);
  assert.strictEqual(rPlain.byModule.get('b'), undefined);
  assert.strictEqual(rView.byModule.get('b').length, 2);
  assert.strictEqual(srv._classifyRemoteAhead(['1.enc', '2.enc'], nameMap, READ_SCOPES, { reads: true }).byModule.get('b'), 2);

  const mt = new Map([['team/x.json', 50], ['discovery-tasks/d.json', 70]]);
  const mPlain = srv._classifyMtimesByScope(mt, READ_SCOPES);
  const mView = srv._classifyMtimesByScope(mt, READ_SCOPES, { reads: true });
  assert.strictEqual(mPlain.maxCore, mView.maxCore);
  assert.strictEqual(mPlain.maxByModule.get('b'), undefined);
  assert.strictEqual(mView.maxByModule.get('b'), 70);

  const dates = new Map([['1.enc', '2026-10-01T10:00:00Z'], ['2.enc', '2026-10-02T10:00:00Z']]);
  const dPlain = srv._classifyCommitDatesByScope(dates, nameMap, READ_SCOPES);
  const dView = srv._classifyCommitDatesByScope(dates, nameMap, READ_SCOPES, { reads: true });
  assert.strictEqual(dPlain.core, dView.core);
  assert.strictEqual(dPlain.byModule.get('b'), undefined);
  assert.strictEqual(dView.byModule.get('b'), '2026-10-02T10:00:00Z');
  assert.strictEqual(dView.byModule.get('a'), '2026-10-01T10:00:00Z');
});

test('_readOnlyScopeRefusal refuses only a scope with no write entries', () => {
  const refusal = srv._readOnlyScopeRefusal(READ_SCOPES, 'b');
  assert.strictEqual(refusal.ok, false);
  assert.strictEqual(refusal.error, 'read-only-scope');
  assert.strictEqual(refusal.message, 'This module only reads this data - send it from the owner row.');
  assert.strictEqual(srv._readOnlyScopeRefusal(READ_SCOPES, 'a'), null);
  assert.strictEqual(srv._readOnlyScopeRefusal(READ_SCOPES, '_team'), null);
  assert.strictEqual(srv._readOnlyScopeRefusal(READ_SCOPES, srv.SYNC_CORE_ID), null);
  assert.strictEqual(srv._readOnlyScopeRefusal(READ_SCOPES, 'nope'), null);
});

// ── "Koniec dnia" wrap-up clear gate (wrapUpClearEligibility) ───────────────
// Pure predicate: no filesystem, no crypto - just the decision the real op
// (_repoClearPlaintextOp) delegates to after doing its own I/O. Every case a
// wrap-up clear must refuse, and the two shapes of "safe to clear" it must
// not confuse with a refusal, live here.

test('wrapUpClearEligibility refuses a source that is not cloned on this machine', () => {
  const r = srv.wrapUpClearEligibility({ exists: false, encryptionReady: true, probe: null });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'not-configured');
  assert.ok(typeof r.message === 'string' && r.message.length > 0);
});

test('wrapUpClearEligibility refuses with no override when the key is missing', () => {
  const r = srv.wrapUpClearEligibility({ exists: true, encryptionReady: false, probe: null });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'key-missing');
});

test('wrapUpClearEligibility refuses when the mirror is missing added files', () => {
  const r = srv.wrapUpClearEligibility({
    exists: true, encryptionReady: true,
    probe: { added: 2, changed: 0, removed: 0, checked: 5 },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'plaintext-ahead');
});

test('wrapUpClearEligibility refuses when the mirror is missing changed files', () => {
  const r = srv.wrapUpClearEligibility({
    exists: true, encryptionReady: true,
    probe: { added: 0, changed: 3, removed: 0, checked: 5 },
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'plaintext-ahead');
});

test('wrapUpClearEligibility allows a clear when only files were removed', () => {
  const r = srv.wrapUpClearEligibility({
    exists: true, encryptionReady: true,
    probe: { added: 0, changed: 0, removed: 4, checked: 5 },
  });
  assert.strictEqual(r.ok, true);
});

test('wrapUpClearEligibility allows a clear on a legacy (v1) source', () => {
  const r = srv.wrapUpClearEligibility({
    exists: true, encryptionReady: true,
    probe: { added: 0, changed: 0, removed: 0, checked: 5, legacy: 5 },
  });
  assert.strictEqual(r.ok, true);
});

test('wrapUpClearEligibility refuses when the probe could not run', () => {
  const r = srv.wrapUpClearEligibility({ exists: true, encryptionReady: true, probe: { unavailable: true } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'probe-failed');
});
// _isGitnexusBannerOnlyDiff: the app-update dirt exemption for the one line
// `gitnexus analyze` rewrites in AGENTS.md / CLAUDE.md. Both files carry a
// `<!-- gitnexus:keep -->` marker, so the analyzer rewrites this line ALONE -
// and rewords it while doing so. Get the wording wrong and both files stay
// permanently un-exempt, which blocks every app update over changes nobody
// typed. Everything else in the file must still block.
const _bannerDoc = (line) => [
  '<!-- gitnexus:start -->',
  '<!-- gitnexus:keep -->',
  '# GitNexus - Code Intelligence',
  '',
  line,
  '',
  '> Index stale? Run `node scripts/bootstrap-gitnexus.js`.',
  '<!-- gitnexus:end -->',
  '',
].join('\n');

const _VERBOSE = 'This project is indexed by GitNexus as **mission-deck** (3933 symbols, 11335 relationships, 300 execution flows). Use the GitNexus MCP tools.';
const _VERBOSE_NEW = 'This project is indexed by GitNexus as **mission-deck** (4002 symbols, 11521 relationships, 300 execution flows). Use the GitNexus MCP tools.';
const _KEPT = 'Indexed as **mission-deck** (4002 symbols, 11521 relationships, 300 execution flows). Use the GitNexus MCP tools.';

test('_isGitnexusBannerOnlyDiff exempts a recount in either phrasing', () => {
  const head = _bannerDoc(_VERBOSE);
  // Same wording, new counts - the pre-keep case.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(_bannerDoc(_VERBOSE_NEW), head), true);
  // The keep path rewords the line to "Indexed as **name**" as it recounts.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(_bannerDoc(_KEPT), head), true);
  // And once a kept line is what got committed, a later recount still matches.
  assert.strictEqual(
    srv._isGitnexusBannerOnlyDiff(_bannerDoc(_KEPT.replace('4002', '4100')), _bannerDoc(_KEPT)),
    true,
  );
});

test('_isGitnexusBannerOnlyDiff blocks anything but that line', () => {
  const head = _bannerDoc(_VERBOSE);
  // An identical file is not a dirt entry at all.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(head, head), false);
  // A real edit next to the banner blocks, banner recount or not.
  assert.strictEqual(
    srv._isGitnexusBannerOnlyDiff(_bannerDoc(_VERBOSE_NEW) + '\nHand-written paragraph.\n', head),
    false,
  );
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(head + '\nHand-written paragraph.\n', head), false);
  // A file with no banner at all can never be exempt.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff('a\n', 'b\n'), false);
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(null, head), false);
});

test('_isGitnexusBannerOnlyDiff is fenced by the markers, not by the wording of the line', () => {
  // The predicate used to require the three counts on the one line, because
  // that was what told a generated line from hand-written prose. A newer CLI
  // rewrites the WHOLE fenced block, so the fence is the contract now: any
  // wording inside the block is exempt, and the same words placed OUTSIDE
  // the fence block, because the text around the block is compared verbatim.
  const head = _bannerDoc(_VERBOSE);
  for (const prose of [
    'Indexed as **the team data repo** and served statically.',
    'Indexed as **mission-deck**',
    'Indexed as **mission-deck** - see the section below.',
  ]) {
    assert.strictEqual(srv._isGitnexusBannerOnlyDiff(_bannerDoc(prose), head), true, prose);
    assert.strictEqual(srv._isGitnexusBannerOnlyDiff(_bannerDoc(_VERBOSE) + prose + '\n', head), false, prose);
  }
});

test('cachePolicy never hands a data-repo file the immutable week', () => {
  // A data repo is full of .png - team/avatars/ and team/logos/ - and the
  // extension branch used to run FIRST, so every one of them was served
  // `immutable` for a week. A person's photo URL is derived from their slug
  // and does not change when the photo does, so replacing an avatar left
  // every machine that had seen the old one showing it, with no revalidation
  // to correct it. Ordering is the whole fix, so this test pins the ordering
  // and not just the strings.
  for (const p of [
    '/data-sub-repositories/ds-data/team/avatars/alexmorgan.png',
    '/data-sub-repositories/ds-data/team/logos/giewont_dark.png',
    '/data-sub-repositories/ds-data-leads/whatever.png',
    '/data/some-cache.png',
  ]) {
    assert.strictEqual(srv.cachePolicy('.png', p), 'no-cache', p);
  }
  // The app's own assets are versioned with the app and keep the long cache.
  assert.strictEqual(srv.cachePolicy('.png', '/assets/mascot/pip.png'), 'public, max-age=604800, immutable');
  assert.strictEqual(srv.cachePolicy('.woff2', '/fonts/inter.woff2'), 'public, max-age=604800, immutable');
  // Module client assets still win over everything.
  assert.strictEqual(srv.cachePolicy('.png', '/modules/team-directory/client/x.png'), 'no-cache');
});

// --- The startup path must not honour an exemption that verifies nothing ----
// handleAppUpdate is a click with a file list in front of a person;
// _autoUpdateAppOnStartup is a hard reset with nobody watching. The table
// says per row which of the two may honour it, and the helper enforces it
// through `unattended`.

test('_APP_UPDATE_DIRT_EXEMPTIONS: every row states unattended, and only the model line earns true', () => {
  const rows = srv._APP_UPDATE_DIRT_EXEMPTIONS;
  assert.strictEqual(rows.length, 3);
  for (const r of rows) assert.strictEqual(typeof r.unattended, 'boolean', r.fileRe.source);
  const unattended = rows.filter((r) => r.unattended).map((r) => r.onlyDiff);
  assert.deepStrictEqual(unattended, [srv._isModelOnlyAgentDiff]);
  // The two rows that cannot be honoured without a person: the fence (spans a
  // whole chapter people edit) and the skills directory (verifies nothing).
  const attendedOnly = rows.filter((r) => !r.unattended);
  assert.deepStrictEqual(attendedOnly.map((r) => r.onlyDiff), [srv._isGitnexusBannerOnlyDiff, null]);
});

test('_appUpdateDirtEntries unattended: the non-verifying skills row blocks, the untracked prefixes stay exempt', async () => {
  const porcelain = [
    ' M .claude/skills/gitnexus/SKILL.md',
    '?? .claude/skills/gitnexus-cli/',
    '?? .claude/skills/generated/',
    ' M js/app.js',
  ].join('\n');
  const normal = await srv._appUpdateDirtEntries(porcelain);
  assert.deepStrictEqual(normal.exempt, ['.claude/skills/gitnexus/SKILL.md', '.claude/skills/gitnexus-cli/', '.claude/skills/generated/']);
  assert.deepStrictEqual(normal.blocking, ['js/app.js']);
  assert.deepStrictEqual(normal.attendedOnly, []);

  const startup = await srv._appUpdateDirtEntries(porcelain, undefined, { unattended: true });
  assert.deepStrictEqual(startup.exempt, ['.claude/skills/gitnexus-cli/', '.claude/skills/generated/']);
  assert.deepStrictEqual(startup.blocking, ['.claude/skills/gitnexus/SKILL.md', 'js/app.js']);
  assert.deepStrictEqual(startup.attendedOnly, ['.claude/skills/gitnexus/SKILL.md']);
  assert.deepStrictEqual(startup.untracked, []);
  // `unattended: false` and no opts are the same manual path.
  assert.deepStrictEqual(await srv._appUpdateDirtEntries(porcelain, undefined, { unattended: false }), normal);
});

test('_appUpdateDirtEntries unattended, on a real repo: the model line stays exempt, the fenced GitNexus block blocks', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dirt-unattended-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  try {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.claude', 'skills', 'gitnexus'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'js'), { recursive: true });
    const brief = (model) => `---\nname: idea-planner\nmodel: ${model}\n---\n\nBrief body.\n`;
    fs.writeFileSync(path.join(repo, '.claude', 'agents', 'idea-planner.md'), brief('claude-opus-4-6'));
    fs.writeFileSync(path.join(repo, '.claude', 'skills', 'gitnexus', 'SKILL.md'), '# committed skill\n');
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), BANNER_HEAD);
    fs.writeFileSync(path.join(repo, 'js', 'app.js'), 'export const v = 1;\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'seed']);

    fs.writeFileSync(path.join(repo, '.claude', 'agents', 'idea-planner.md'), brief('claude-sonnet-4-5')); // the model patcher
    fs.writeFileSync(path.join(repo, '.claude', 'skills', 'gitnexus', 'SKILL.md'), '# hand-edited skill\n'); // could be anyone
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), BANNER_REINDEXED);                                       // inside the fence
    fs.mkdirSync(path.join(repo, '.claude', 'skills', 'gitnexus-cli'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'skills', 'gitnexus-cli', 'SKILL.md'), 'cli\n');            // untracked prefix
    fs.writeFileSync(path.join(repo, 'js', 'app.js'), 'export const v = 2;\n');                             // a person

    const porcelain = git(['status', '--porcelain']);
    const normal = await srv._appUpdateDirtEntries(porcelain, repo);
    assert.deepStrictEqual(normal.exempt.sort(), ['.claude/agents/idea-planner.md', '.claude/skills/gitnexus-cli/', '.claude/skills/gitnexus/SKILL.md', 'AGENTS.md']);
    assert.deepStrictEqual(normal.blocking, ['js/app.js']);
    assert.deepStrictEqual(normal.attendedOnly, []);

    const startup = await srv._appUpdateDirtEntries(porcelain, repo, { unattended: true });
    assert.deepStrictEqual(startup.exempt.sort(), ['.claude/agents/idea-planner.md', '.claude/skills/gitnexus-cli/']);
    assert.deepStrictEqual(startup.blocking.sort(), ['.claude/skills/gitnexus/SKILL.md', 'AGENTS.md', 'js/app.js']);
    assert.deepStrictEqual(startup.attendedOnly.sort(), ['.claude/skills/gitnexus/SKILL.md', 'AGENTS.md']);
    // attendedOnly is a subset of blocking: a caller reading `blocking` alone
    // (which is what _autoUpdateAppOnStartup does) decides correctly.
    for (const f of startup.attendedOnly) assert.ok(startup.blocking.includes(f), f);
    assert.deepStrictEqual(startup.untracked, []);
    // A brief edited beyond its model line blocks in both modes - the flag
    // widens nothing.
    fs.writeFileSync(path.join(repo, '.claude', 'agents', 'idea-planner.md'), brief('claude-sonnet-4-5').replace('Brief body.', 'Rewritten.'));
    const edited = await srv._appUpdateDirtEntries(git(['status', '--porcelain']), repo, { unattended: true });
    assert.ok(edited.blocking.includes('.claude/agents/idea-planner.md'));
    assert.ok(!edited.attendedOnly.includes('.claude/agents/idea-planner.md'), 'a real edit is not "the manual path would exempt it"');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- The body of POST /api/app/update -----------------------------------------
// Four clients send `{}`; a fifth may send nothing at all. Only the literal
// boolean `true` opens the stash door, and nothing here may throw - an
// exception on this path would turn an update into a 500.

test('_appUpdateParseBody opts in on the literal boolean true and on nothing else', () => {
  assert.deepStrictEqual(srv._appUpdateParseBody('{"stashDirty":true}'), { stashDirty: true });
  assert.deepStrictEqual(srv._appUpdateParseBody('{"stashDirty":true,"other":1}'), { stashDirty: true });
  for (const raw of [
    undefined, null, '', '   ',               // no body
    '{}',                                     // what every client sends today
    'null', 'true', '1', '"x"', '[]', '[true]', // JSON that is not an object
    '{',                                      // not JSON at all
    'stashDirty=true', '<html>',
    '{"stashDirty":"true"}',                  // a string, not a boolean
    '{"stashDirty":1}',
    '{"stashDirty":false}',
    '{"stashDirty":null}',
    '{"stashdirty":true}',                    // wrong case
  ]) {
    assert.deepStrictEqual(srv._appUpdateParseBody(raw), { stashDirty: false }, JSON.stringify(raw));
  }
});

// --- Two views of one concept: "a generated line" -----------------------------
// scripts/_core-scope.js sees a DIFF and names the counts line; server.js sees
// two full texts and compares around the `<!-- gitnexus:start -->` fence. They
// cannot share a predicate, so they are pinned to each other here: same file
// patterns, and the line one side accepts sits inside the fence the other
// side compares around, in the real documents of this repository.

test('core-scope generated-line rules and the app-update exemptions describe the same two regions', () => {
  const CS = require('../scripts/_core-scope.js');
  const byId = Object.fromEntries(CS.GENERATED_LINE_RULES.map((r) => [r.id, r]));
  assert.ok(byId['agent-model'] && byId['gitnexus-banner'], 'both core-scope rules exist');
  const verifying = srv._APP_UPDATE_DIRT_EXEMPTIONS.filter((r) => typeof r.onlyDiff === 'function');
  assert.deepStrictEqual(
    verifying.map((r) => r.fileRe.source).sort(),
    [byId['agent-model'].fileRe.source, byId['gitnexus-banner'].fileRe.source].sort(),
    'the file patterns of the two tables must agree',
  );

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const lines = fs.readFileSync(path.join(repoRoot, name), 'utf8').split(/\r?\n/);
    const start = lines.indexOf(srv._GITNEXUS_BLOCK_START);
    const end = lines.indexOf(srv._GITNEXUS_BLOCK_END);
    assert.ok(start >= 0 && end > start, `${name} carries one well-formed GitNexus fence`);
    assert.strictEqual(lines.indexOf(srv._GITNEXUS_BLOCK_START, start + 1), -1, `${name}: one start marker`);
    assert.strictEqual(lines.indexOf(srv._GITNEXUS_BLOCK_END, end + 1), -1, `${name}: one end marker`);
    const hits = lines.map((l, i) => (byId['gitnexus-banner'].lineRe.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
    assert.strictEqual(hits.length, 1, `${name} has exactly one GitNexus counts line`);
    assert.ok(hits[0] > start && hits[0] < end, `${name}: the counts line core-scope accepts sits inside the fence server.js compares around`);
  }

  // The same recount, judged by both sides, is generated on both.
  const oldLine = 'This project is indexed by GitNexus as **mission-deck** (1 symbols, 2 relationships, 3 execution flows). Use the tools.';
  const newLine = oldLine.replace('1 symbols', '9 symbols');
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(_bannerDoc(newLine), _bannerDoc(oldLine)), true);
  assert.ok(CS.generatedOnlyChange({ path: 'AGENTS.md', status: 'M', added: [{ text: newLine }], removed: [{ text: oldLine }] }));
  const oldModel = 'model: claude-opus-4-6';
  const newModel = 'model: claude-sonnet-4-5';
  assert.strictEqual(srv._isModelOnlyAgentDiff(AGENT_HEAD.replace(oldModel, newModel), AGENT_HEAD), true);
  assert.ok(CS.generatedOnlyChange({ path: '.claude/agents/idea-planner.md', status: 'M', added: [{ text: newModel }], removed: [{ text: oldModel }] }));
  // And the same prose edit is a person's work on both.
  assert.strictEqual(srv._isGitnexusBannerOnlyDiff(_bannerDoc(oldLine) + 'Hand-written.\n', _bannerDoc(oldLine)), false);
  assert.strictEqual(CS.generatedOnlyChange({ path: 'AGENTS.md', status: 'M', added: [{ text: 'Hand-written.' }], removed: [] }), null);
});

test('CLONE_TIMEOUT_MS is big enough for the heaviest data source', () => {
  // data-reports (data-tier-1) is ~731 MB of .enc over 2088 files and its pack
  // is ~1.1 GB, because AES-GCM output does not delta-compress - git stores
  // every rewrite of a 30 MB dump almost in full. The old five-minute budget
  // killed that clone at ~1.5 of 1.6 GB on an ordinary connection, so the one
  // source that most needs cloning was the one that could not be cloned.
  assert.ok(srv.CLONE_TIMEOUT_MS > 5 * 60 * 1000, 'must exceed the old five-minute budget');
  assert.ok(srv.CLONE_TIMEOUT_MS <= 60 * 60 * 1000, 'still an upper bound, not "forever"');
});

test('_cloneTimeoutMessage explains the timeout instead of saying "try again"', () => {
  const msg = srv._cloneTimeoutMessage({ id: 'data-reports', label: 'Product team data' });
  // Names the source and the budget - the generic 'timeout' copy in
  // js/sub-repo-sync-stream.js says "try again", which is wrong advice
  // here: the same clone runs out of the same budget again.
  assert.match(msg, /Product team data/);
  assert.match(msg, new RegExp(String(Math.round(srv.CLONE_TIMEOUT_MS / 60000)) + ' min'));
  assert.doesNotMatch(msg, /try again/i);
  // User-facing copy is plain English.
  assert.match(msg, /^[\x20-\x7e]+$/);
});

test('_parseGitProgressLine reads every phase a clone walks', () => {
  // Real `git clone --progress` stderr. The percentage can be padded with
  // spaces and the counts are optional on some phases, so both shapes parse.
  assert.deepStrictEqual(srv._parseGitProgressLine('Receiving objects:  42% (500/1200), 12.34 MiB | 2.50 MiB/s'),
    { key: 'receiving', phase: 'Receiving objects', pct: 42, current: 500, total: 1200 });
  assert.deepStrictEqual(srv._parseGitProgressLine('remote: Counting objects: 45% (100/220)'),
    { key: 'counting', phase: 'Counting objects', pct: 45, current: 100, total: 220 });
  assert.deepStrictEqual(srv._parseGitProgressLine('Updating files:  73% (1500/2088)'),
    { key: 'checkout', phase: 'Writing files', pct: 73, current: 1500, total: 2088 });
  assert.strictEqual(srv._parseGitProgressLine('Resolving deltas: 100% (900/900), done.').pct, 100);
  // Phase without counts still drives the bar.
  assert.deepStrictEqual(srv._parseGitProgressLine('Receiving objects:  7%'),
    { key: 'receiving', phase: 'Receiving objects', pct: 7, current: null, total: null });
});

test('_parseGitProgressLine keys every phase on a stable ASCII id', () => {
  // The client bands its progress bar on `key`, never on the human label -
  // a copy edit here must not silently flatten the bar (js/sync-center-helpers.js).
  const keys = ['remote: Counting objects: 1% (1/2)', 'remote: Compressing objects: 1% (1/2)',
    'Receiving objects: 1% (1/2)', 'Resolving deltas: 1% (1/2)', 'Updating files: 1% (1/2)',
    'Checking out files: 1% (1/2)'].map((l) => srv._parseGitProgressLine(l).key);
  assert.deepStrictEqual(keys, ['counting', 'compressing', 'receiving', 'resolving', 'checkout', 'checkout']);
  for (const k of keys) assert.match(k, /^[a-z]+$/, `the key must be ASCII: ${k}`);
});

test('_parseGitProgressLine returns null for anything that is not progress', () => {
  // The caller must read null as "not progress", never as "zero" - a bar that
  // jumped back to 0% on every ordinary git message would be worse than none.
  for (const line of [
    "Cloning into '.'...",
    'warning: redirecting to https://gitlab.example.com/x.git',
    'fatal: repository not found',
    '',
    '   ',
    'Receiving objects: 142% (5/5)', // out of range - never trust it into a bar
  ]) {
    assert.strictEqual(srv._parseGitProgressLine(line), null, `powinno byc null: ${JSON.stringify(line)}`);
  }
  assert.strictEqual(srv._parseGitProgressLine(null), null);
  assert.strictEqual(srv._parseGitProgressLine(undefined), null);
});

test('_parseGitProgressLine gives every phase a readable label', () => {
  // Every mapped phase renders straight into the modal, so all six must carry
  // a non-empty human label made of words, never a raw key.
  const lines = ['remote: Counting objects: 1% (1/2)', 'remote: Compressing objects: 1% (1/2)',
    'Receiving objects: 1% (1/2)', 'Resolving deltas: 1% (1/2)', 'Updating files: 1% (1/2)',
    'Checking out files: 1% (1/2)'];
  for (const line of lines) {
    const p = srv._parseGitProgressLine(line);
    assert.ok(p, `unrecognized phase: ${line}`);
    assert.match(p.phase, /^[A-Z][a-z]+ [a-z]+$/, `readable phase label: ${p.phase}`);
  }
});

// -- frameOptionsFor: X-Frame-Options scope -------------------------------
// A blanket DENY blocked a module's own built app from ever painting inside
// the cockpit (sample-app's phone frame): the frame request died as
// ERR_BLOCKED_BY_RESPONSE and the screen stayed blank. /modules-data/ is the
// ONE root that may be framed - this pins that it stays exactly one root.
test('frameOptionsFor lets a built module app be framed same-origin', () => {
  assert.equal(srv.frameOptionsFor('/modules-data/sample-app/public/app-cockpit/index.html'), 'SAMEORIGIN');
  assert.equal(srv.frameOptionsFor('/modules-data/'), 'SAMEORIGIN');
});

test('frameOptionsFor keeps DENY everywhere else', () => {
  for (const p of [
    '/', '/index.html', '/api/whoami', '/modules/sample-app/client/phone.js',
    '/data-sub-repositories/ds-data/prototypes/x/index.html', '/docs/design-system/x.json',
  ]) assert.equal(srv.frameOptionsFor(p), 'DENY', p);
});

test('frameOptionsFor never matches a lookalike prefix or a missing path', () => {
  assert.equal(srv.frameOptionsFor('/modules-database/x'), 'DENY');
  assert.equal(srv.frameOptionsFor('/x/modules-data/y'), 'DENY');
  assert.equal(srv.frameOptionsFor(undefined), 'DENY');
  assert.equal(srv.frameOptionsFor(''), 'DENY');
});

// -- cspFor: the framed module app's own policy ----------------------------
// A Vite index.html carries an inline theme-boot <script>; the cockpit's own
// `script-src 'self'` blocked it inside the phone frame. The frameable root
// gets the policy the original app used for /mini-cockpit/: inline scripts
// allowed, connect-src and frame-src TIGHTER than the default.
test('cspFor gives the frameable root inline scripts, no outbound connections and no nested frames', () => {
  const csp = srv.cspFor('/modules-data/sample-app/public/app-cockpit/index.html');
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.match(csp, /connect-src 'self'(;|$)/);
  assert.match(csp, /frame-src 'none'/);
  assert.doesNotMatch(csp, /amplitude/);
  assert.equal(srv.cspFor('/modules-data/'), csp);
});

test('cspFor keeps the cockpit policy everywhere else, including lookalike prefixes', () => {
  const def = srv.cspFor('/');
  assert.match(def, /script-src 'self';/);
  assert.match(def, /api\.eu\.amplitude\.com/);
  for (const p of ['/index.html', '/api/whoami', '/modules/sample-app/client/phone.js', '/modules-database/x', '/x/modules-data/y', undefined, '']) {
    assert.equal(srv.cspFor(p), def, String(p));
  }
});

// -- Python script runner (Figma reference) ----------------------------------
test('_pythonParseLine turns @@PROGRESS lines into progress and everything else into log', () => {
  assert.deepStrictEqual(
    srv._pythonParseLine('@@PROGRESS:{"step": 0, "total": 1, "pct": 42, "msg": "2026-09-12 - fetching"}'),
    { kind: 'progress', pct: 42, msg: '2026-09-12 - fetching' },
  );
  assert.deepStrictEqual(srv._pythonParseLine('@@PROGRESS:{"pct": 250}'), { kind: 'progress', pct: 100, msg: '' });
  assert.deepStrictEqual(srv._pythonParseLine('@@PROGRESS:not json'), { kind: 'log', text: '@@PROGRESS:not json' });
  assert.deepStrictEqual(srv._pythonParseLine('  2026-09-12: 39 events\r'), { kind: 'log', text: '  2026-09-12: 39 events' });
  assert.strictEqual(srv._pythonParseLine('   '), null);
  assert.strictEqual(srv._pythonParseLine(''), null);
});

test('_pythonScalePct maps a script percent into the step range and clamps', () => {
  assert.strictEqual(srv._pythonScalePct(0, 0, 70), 0);
  assert.strictEqual(srv._pythonScalePct(100, 0, 70), 70);
  assert.strictEqual(srv._pythonScalePct(50, 70, 100), 85);
  assert.strictEqual(srv._pythonScalePct(-5, 70, 100), 70);
  assert.strictEqual(srv._pythonScalePct('abc', 70, 100), 70);
  assert.strictEqual(srv._pythonScalePct(999, 0, 70), 70);
});

// -- Static file server: module data exposure guard ---------------------------
// (docs/architecture/modules.md, step 17)

test('_staticDenyReason refuses the /data/modules/ alias, a nested .git segment and a private basename under the gate', () => {
  assert.strictEqual(srv._staticDenyReason('/data/modules/sample-app/public/app-cockpit/allowed-users.json'), 'modules-data-alias');
  assert.strictEqual(srv._staticDenyReason('/data/modules/sample-app/deploy/cockpit/.git/config'), 'modules-data-alias');
  assert.strictEqual(srv._staticDenyReason('/data/modules'), 'modules-data-alias');
  assert.strictEqual(srv._staticDenyReason('/anything/.git/config'), 'git-segment');
  assert.strictEqual(srv._staticDenyReason('/modules-data/sample-app/public/app-cockpit/allowed-users.json'), 'private-basename');
  assert.strictEqual(srv._staticDenyReason('/modules-data/sample-app/public/app-cockpit/index.html'), null);
  assert.strictEqual(srv._staticDenyReason('/data/refresh-timestamps.json'), null);
  assert.strictEqual(srv._staticDenyReason('/data-sub-repositories/ds-data/team/team-members.json'), null);
  assert.ok(srv.STATIC_PRIVATE_BASENAMES.has('allowed-users.json'));
});

test('_staticResolvedDeny sees through a symlink into MODULES_DATA_DIR and a relocated directory', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'static-guard-'));
  try {
    const root = path.join(tmp, 'root');
    const modulesData = path.join(tmp, 'elsewhere', 'modules');
    fs.mkdirSync(path.join(modulesData, 'mini', 'public'), { recursive: true });
    fs.mkdirSync(path.join(modulesData, 'mini', 'deploy'), { recursive: true });
    fs.writeFileSync(path.join(modulesData, 'mini', 'deploy', 'secret.txt'), 'x');
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(modulesData, path.join(root, 'link'));
    // ROOT branch: a path that REALLY lives under the (relocated) modules data dir is refused.
    assert.strictEqual(srv._staticResolvedDeny({ candidate: path.join(root, 'link', 'mini', 'deploy', 'secret.txt'), modulesDataDir: modulesData }), 'protected-dir');
    // ROOT branch: a file that does not exist yet but would resolve there is refused too.
    assert.strictEqual(srv._staticResolvedDeny({ candidate: path.join(root, 'link', 'mini', 'public', 'missing.json'), modulesDataDir: modulesData }), 'protected-dir');
    // ROOT branch: an ordinary root file passes.
    assert.strictEqual(srv._staticResolvedDeny({ candidate: path.join(root, 'index.html'), modulesDataDir: modulesData }), null);
    // Gate branch: a symlink inside public/ pointing at deploy/ is refused.
    fs.symlinkSync(path.join(modulesData, 'mini', 'deploy'), path.join(modulesData, 'mini', 'public', 'escape'));
    const gateDir = path.join(modulesData, 'mini', 'public');
    assert.strictEqual(srv._staticResolvedDeny({ candidate: path.join(gateDir, 'escape', 'secret.txt'), modulesDataDir: modulesData, gateDir }), 'outside-gate');
    assert.strictEqual(srv._staticResolvedDeny({ candidate: path.join(gateDir, 'index.html'), modulesDataDir: modulesData, gateDir }), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_snapshotSelectionSafe refuses absolute paths and traversal', () => {
  assert.strictEqual(srv._snapshotSelectionSafe('team/team-members.json'), true);
  assert.strictEqual(srv._snapshotSelectionSafe('jira/sprint-stats'), true);
  assert.strictEqual(srv._snapshotSelectionSafe('.'), true, 'the whole tree');
  assert.strictEqual(srv._snapshotSelectionSafe('../secret'), false);
  assert.strictEqual(srv._snapshotSelectionSafe('a/../../b'), false);
  assert.strictEqual(srv._snapshotSelectionSafe('/etc/passwd'), false);
  assert.strictEqual(srv._snapshotSelectionSafe(''), false);
  assert.strictEqual(srv._snapshotSelectionSafe(42), false);
});

// ── parseOpenMergeRequestCount (GET /api/merge-requests/counts) ──────────────

test('parseOpenMergeRequestCount reads x-total and ignores the one-item body', () => {
  const headers = new Map([['x-total', '7']]);
  const r = { ok: true, status: 200, text: '[{"iid":1}]', headers };
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount(r), { count: 7 });
  // Zero is an answer, not an absence.
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: true, status: 200, text: '[]', headers: new Map([['x-total', '0']]) }), { count: 0 });
});

test('parseOpenMergeRequestCount falls back to the body length without the header', () => {
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: true, status: 200, text: '[]' }), { count: 0 });
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: true, status: 200, text: '[{"iid":1}]', headers: new Map() }), { count: 1 });
  // A blank header is "no header", not "zero".
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: true, status: 200, text: '[{"iid":1}]', headers: new Map([['x-total', '  ']]) }), { count: 1 });
});

test('parseOpenMergeRequestCount collapses every failure to one shape', () => {
  const fail = { count: null, error: 'gitlab_error' };
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount(null), fail);
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: false, status: 0, text: '' }), fail);
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: false, status: 404, text: '{"message":"404"}' }), fail);
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: true, status: 200, text: '{"id":1}' }), fail);
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: true, status: 200, text: 'not json' }), fail);
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: true, status: 200, text: '[]', headers: new Map([['x-total', 'many']]) }), fail);
  assert.deepStrictEqual(srv.parseOpenMergeRequestCount({ ok: true, status: 200, text: '[]', headers: new Map([['x-total', '-1']]) }), fail);
});

// -- module file-count limits ------------------------------------------------
// The catalog and the installer share ONE file-count limit on purpose: a module
// the catalog accepts must be one every machine can install, and the two
// constants diverging (publish 400, install 200) would publish modules nobody
// can pull. Source pin, because neither constant is exported and the API suite
// cannot afford a 250-file fixture module.
test('MODULES_PUBLISH_MAX_FILES is the install limit itself, and catalog writes get their own timeout', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js'), 'utf8');
  assert.ok(/^const MODULES_PUBLISH_MAX_FILES = MODULES_INSTALL_MAX_FILES;$/m.test(src));
  const install = /^const MODULES_INSTALL_MAX_FILES = (\d+);$/m.exec(src);
  assert.ok(install && Number(install[1]) >= 400, 'sample-app ships 216 files (135 test fixtures) and must stay installable');
  const write = /^const MODULES_CATALOG_WRITE_TIMEOUT_MS = (\d+);$/m.exec(src);
  const read = /^const MODULES_CATALOG_TIMEOUT_MS = (\d+);$/m.exec(src);
  assert.ok(write && read && Number(write[1]) > Number(read[1]), 'a 200-file commit needs more than the 8 s read budget');
  assert.ok(/AbortSignal\.timeout\(MODULES_CATALOG_WRITE_TIMEOUT_MS\)/.test(src), '_modulesCatalogPostJson uses the write timeout');
});

// ── claude-terminal upgrade: the socket must never take the server down ──────
// The upgrade handler is inline in server.on('upgrade') and needs a PTY, so
// the property is pinned in the source. Three lines hold it up: an 'error'
// listener on every ws (a WebSocket is an EventEmitter - an 'error' with no
// listener is ERR_UNHANDLED_ERROR, which lands in uncaughtException and took
// the whole cockpit down with every open PTY and SSE stream, measured on a
// laptop going to sleep mid-stream), the old socket closed explicitly when a
// second tab revives the same session, and a 'close' from a socket that no
// longer owns the session arming no grace timer.
test('claude-terminal: every ws has an error listener, a replaced socket is closed and cannot kill the PTY on its way out', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js'), 'utf8');
  const upgrade = src.slice(src.indexOf("server.on('upgrade'"));
  assert.ok(upgrade.length > 0, 'upgrade handler found');
  const errorListener = /ws\.on\('error', \(e\) => \{\s*\n\s*console\.warn\(`\[claude-terminal\] ws error on session \$\{sessionId\}/;
  assert.match(upgrade, errorListener, "an 'error' listener on the session socket");
  const messageIdx = upgrade.search(/ws\.on\('message'/);
  assert.ok(upgrade.search(errorListener) > -1 && upgrade.search(errorListener) < messageIdx, "the error listener is bound before 'message', so no frame can arrive on an unguarded socket");
  assert.match(upgrade, /if \(session\.ws && session\.ws !== ws\) \{\s*\n\s*try \{ session\.ws\.close\(4000, 'replaced'\); \}/, 'a reconnect closes the socket it replaces');
  assert.match(upgrade, /ws\.on\('close', \(\) => \{\s*\n(?:\s*\/\/.*\n)*\s*if \(session\.ws !== ws\) return;/, "a replaced socket's close arms no grace timer");
  // The Node semantic the listener exists for.
  assert.throws(() => new EventEmitter().emit('error', new Error('frame')), /frame/, "an EventEmitter 'error' with no listener throws");
});

// ── _bwExec / _bwStatusProbe (P1: bw off the event loop) ─────────────────────
// A fake `bw` on PATH, because the real one costs 1.3 s and needs a vault.
// Skipped on Windows: the fake is a POSIX shell script.
const _bwFakeSkip = process.platform === 'win32';

function _bwFakeDir(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-bw-fake-'));
  const bin = path.join(dir, 'bw');
  fs.writeFileSync(bin, '#!/bin/sh\n' + script + '\n');
  fs.chmodSync(bin, 0o755);
  return dir;
}

test('_bwExec keeps the spawnSync result shape: exit code, stdout, stderr', { skip: _bwFakeSkip }, async () => {
  const dir = _bwFakeDir('echo "{\\"status\\":\\"unlocked\\"}"; echo warn 1>&2; exit 0');
  const r = await srv._bwExec(['status'], { PATH: dir }, 5000);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.error, null);
  assert.match(r.stdout, /unlocked/);
  assert.match(r.stderr, /warn/);
  const bad = await srv._bwExec(['status'], { PATH: dir + ':' + _bwFakeDir('exit 3') }, 5000);
  assert.strictEqual(bad.status, 0, 'first PATH entry wins');
  const nonzero = await srv._bwExec(['status'], { PATH: _bwFakeDir('echo nope 1>&2; exit 3') }, 5000);
  assert.strictEqual(nonzero.status, 3);
  assert.strictEqual(nonzero.error, null);
  assert.match(nonzero.stderr, /nope/);
});

test('_bwExec reports a missing CLI as error.code ENOENT and never rejects', { skip: _bwFakeSkip }, async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-bw-empty-'));
  const r = await srv._bwExec(['status'], { PATH: empty }, 5000);
  assert.ok(r.error, 'error is set');
  assert.strictEqual(r.error.code, 'ENOENT');
});

test('_bwExec feeds stdin and maps a timeout to error.code ETIMEDOUT', { skip: _bwFakeSkip }, async () => {
  const echo = _bwFakeDir('read pw; echo "got:$pw"');
  const r = await srv._bwExec(['unlock', '--raw'], { PATH: echo }, 5000, 'secret\n');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /got:secret/);
  const slow = _bwFakeDir('/bin/sleep 5');
  const t0 = Date.now();
  const t = await srv._bwExec(['sync'], { PATH: slow }, 300);
  assert.ok(t.error && t.error.code === 'ETIMEDOUT', 'timeout maps to ETIMEDOUT, got ' + JSON.stringify(t));
  assert.ok(Date.now() - t0 < 4000, 'the deadline, not the sleep, decided');
});

test('_bwStatusProbe shares one bw process between concurrent callers and expires', { skip: _bwFakeSkip }, async () => {
  const counter = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-bw-count-')), 'n');
  const dir = _bwFakeDir(`echo x >> "${counter}"; echo "{\\"status\\":\\"unauthenticated\\"}"`);
  const savedPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    srv._bwStatusInvalidate();
    const a = srv._bwStatusProbe();
    const b = srv._bwStatusProbe();
    assert.strictEqual(a, b, 'the second caller gets the in-flight promise');
    const [ra, rb] = await Promise.all([a, b]);
    assert.strictEqual(ra, rb);
    assert.match(ra.stdout, /unauthenticated/);
    const c = await srv._bwStatusProbe();
    assert.strictEqual(c, ra, 'a call inside the TTL is served from the memo');
    assert.strictEqual(fs.readFileSync(counter, 'utf8').trim().split('\n').length, 1, 'one bw process for three calls');
    srv._bwStatusInvalidate();
    await srv._bwStatusProbe();
    assert.strictEqual(fs.readFileSync(counter, 'utf8').trim().split('\n').length, 2, 'invalidate forces a new process');
  } finally {
    process.env.PATH = savedPath;
    srv._bwStatusInvalidate();
  }
});

// ── _createSwrMemo: the stale-while-revalidate memo behind bw status and the
// sync overview ───────────────────────────────────────────────────────────────
const _tick = () => new Promise((r) => setImmediate(r));

test('_createSwrMemo shares a first compute, serves inside the TTL, and answers a stale value at once while recomputing behind it', async () => {
  let n = 0;
  let now = 1000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const memo = srv._createSwrMemo({ ttlMs: 100, staleMs: 1000, compute: async () => ({ n: ++n }) });
    const a = memo.get();
    const b = memo.get();
    assert.strictEqual(a, b, 'concurrent first callers share the one promise');
    assert.deepStrictEqual(await a, { n: 1 });
    assert.strictEqual(n, 1);
    assert.ok(memo.has());

    now += 50;
    assert.deepStrictEqual(await memo.get(), { n: 1 }, 'inside the TTL: the memo');
    assert.strictEqual(n, 1);

    now += 100; // age 150 - past the TTL, inside the stale window
    const stale = await memo.get();
    assert.deepStrictEqual(stale, { n: 1 }, 'a stale value is answered at once');
    assert.strictEqual(n, 2, 'and exactly one recompute started behind it');
    await memo.get();
    assert.strictEqual(n, 2, 'a second stale caller does not start a second recompute');
    await _tick(); await _tick();
    assert.deepStrictEqual(await memo.get(), { n: 2 }, 'the recompute replaced the value');
    assert.strictEqual(n, 2, 'a fresh value inside its TTL starts nothing');

    now += 5000; // past the stale window: compute and wait
    assert.deepStrictEqual(await memo.get(), { n: 3 });
    assert.strictEqual(n, 3);

    memo.invalidate();
    assert.ok(!memo.has());
    assert.deepStrictEqual(await memo.get(), { n: 4 }, 'invalidate forces a full compute');
  } finally {
    Date.now = realNow;
  }
});

test('_createSwrMemo drops a recompute whose entry was invalidated meanwhile, keeps the stale value over a failed recompute, and keys entries', async () => {
  let now = 1000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    let resolveSlow = null;
    let calls = 0;
    const memo = srv._createSwrMemo({
      ttlMs: 10, staleMs: 1000,
      compute: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve('v1');
        if (calls === 2) return new Promise((r) => { resolveSlow = r; });
        if (calls === 3) return Promise.reject(new Error('boom'));
        return Promise.resolve('v' + calls);
      },
    });
    assert.strictEqual(await memo.get(), 'v1');
    now += 50;
    assert.strictEqual(await memo.get(), 'v1', 'stale, recompute #2 started');
    memo.invalidate(); // a mutation while the recompute is in flight
    // Compute #3 rejects; the handler is attached before any tick so the
    // rejection is never unhandled.
    const afterInvalidate = assert.rejects(memo.get(), /boom/);
    resolveSlow('v2-from-before-the-mutation');
    await _tick(); await _tick();
    await afterInvalidate;
    assert.ok(!memo.has(), 'the pre-mutation result did not come back after the invalidate, and the failure remembered nothing');
    assert.strictEqual(await memo.get(), 'v4', 'the next caller computes afresh');

    // A failed RECOMPUTE keeps the stale value for the next caller.
    now += 50;
    let fail = true;
    const memo2 = srv._createSwrMemo({ ttlMs: 10, staleMs: 1000, compute: async () => { if (fail) throw new Error('nope'); return 'ok'; } });
    fail = false;
    assert.strictEqual(await memo2.get(), 'ok');
    now += 50;
    fail = true;
    assert.strictEqual(await memo2.get(), 'ok', 'stale value answered');
    await _tick(); await _tick();
    assert.strictEqual(await memo2.get(), 'ok', 'the failed recompute left the stale value in place');
    fail = false;
    await _tick(); await _tick();
    assert.strictEqual(await memo2.get(), 'ok');

    // Keyed: a different key is a miss, never the other key's value.
    let key = 'a';
    const memo3 = srv._createSwrMemo({ ttlMs: 1000, staleMs: 5000, keyFn: () => key, compute: async (k) => 'for-' + k });
    assert.strictEqual(await memo3.get(), 'for-a');
    key = 'b';
    assert.ok(!memo3.has(), 'has() answers for the CURRENT key');
    assert.strictEqual(await memo3.get(), 'for-b');
    key = 'a';
    assert.strictEqual(await memo3.get(), 'for-a', 'a key change is a miss both ways');
  } finally {
    Date.now = realNow;
  }
});

test('_createSwrMemo with both windows at zero (test mode) keeps only the in-flight sharing', async () => {
  let n = 0;
  const memo = srv._createSwrMemo({ ttlMs: 0, staleMs: 0, compute: async () => ++n });
  const a = memo.get();
  assert.strictEqual(memo.get(), a, 'in flight: shared');
  assert.strictEqual(await a, 1);
  assert.strictEqual(await memo.get(), 2, 'settled: never served again');
  assert.strictEqual(await memo.get(), 3);
});

test('_bwParseStatus reads the JSON object off bw stdout and answers {} for anything else', () => {
  assert.deepStrictEqual(srv._bwParseStatus({ stdout: 'Some banner\n{"status":"unlocked","serverUrl":"https://v"}' }), { status: 'unlocked', serverUrl: 'https://v' });
  assert.deepStrictEqual(srv._bwParseStatus({ stdout: 'not json' }), {});
  assert.deepStrictEqual(srv._bwParseStatus({ stdout: '' }), {});
  assert.deepStrictEqual(srv._bwParseStatus(null), {});
  assert.deepStrictEqual(srv._bwParseStatus({ stdout: '[1,2]' }), {}, 'a non-object JSON is not a status');
});

// -- _protoNpmEnv: an allowlist for the prototype shell's npm children --------

test('_protoNpmEnv hands npm an allowlist - never the cockpit secrets or the parent npm config', () => {
  const source = {
    PATH: '/usr/bin', HOME: '/Users/example', LANG: 'en_US.UTF-8', NODE_EXTRA_CA_CERTS: '/ca.pem', HTTPS_PROXY: 'http://proxy:3128',
    npm_config_omit: 'dev', npm_package_name: 'mission-deck', npm_lifecycle_event: 'start',
    JIRA_TOKEN: 'j', CONFLUENCE_TOKEN: 'c', FIGMA_TOKEN: 'f', AMPLITUDE_COCKPIT_API_KEY: 'a',
    COCKPIT_APP_TOKEN: 's', BW_SESSION: 'b', PROTO_DEPLOY_TOKEN: 'deploy-in-parent', EMPTY: '',
  };
  const env = srv._protoNpmEnv(source);
  const allowed = new Set(srv.PROTO_NPM_ENV_ALLOW);
  for (const key of Object.keys(env)) assert.ok(allowed.has(key), 'leaked into the npm child: ' + key);
  for (const key of ['JIRA_TOKEN', 'CONFLUENCE_TOKEN', 'FIGMA_TOKEN', 'AMPLITUDE_COCKPIT_API_KEY', 'COCKPIT_APP_TOKEN', 'BW_SESSION', 'PROTO_DEPLOY_TOKEN', 'npm_config_omit', 'npm_package_name', 'npm_lifecycle_event', 'EMPTY']) {
    assert.strictEqual(key in env, false, key + ' must not reach npm');
  }
  assert.strictEqual(env.PATH, '/usr/bin');
  assert.strictEqual(env.NODE_EXTRA_CA_CERTS, '/ca.pem');
  assert.strictEqual(env.HTTPS_PROXY, 'http://proxy:3128');
});

// ── Infrastructure reachability register (the strip under the top bar) ───────
// The register itself is process state; what is testable is the two pure
// pieces it is built from: the verdict over the register shape and the fetch
// error classifier.

// _warmBootMemos fires the bw probe at boot, and since _bwProbeCacheable
// landed that probe REJECTS on a spawn that did not answer. A bare
// `try { _bwStatusProbe(); } catch {}` catches only a synchronous throw, so
// the rejection would escape as an unhandled rejection on every cold boot
// that hits a slow `bw` - the exact boot this whole fix is about. A source
// pin rather than a behavioural test: _warmBootMemos is not exported, returns
// early under IS_TEST_MODE, and the thing worth guarding is one line.
test('_warmBootMemos attaches a real .catch to the bw probe, not only a sync belt', () => {
  const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function _warmBootMemos()'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /_bwStatusProbe\(\)\.catch\(/,
    'the boot warm-up must handle a rejecting probe, or a cold boot logs an unhandled rejection');
});

// _bwProbeCacheable: what may enter the `bw status` memo. The split exists
// because _bwExec RESOLVES on a timeout instead of rejecting, so before it a
// single slow spawn was memoised as a good answer carrying `error`, the
// status route turned that into `installed: false`, and the top bar's
// Bitwarden pill - which paints nothing for that and has no poll - vanished
// for the whole 10-minute stale window after an `npm start`.
test('_bwProbeCacheable: an answer is cacheable, an unanswered probe is not', () => {
  // Answers, all cacheable - including a non-zero exit and a locked vault.
  assert.strictEqual(srv._bwProbeCacheable({ status: 0, stdout: '{"status":"unlocked"}', error: null }), true);
  assert.strictEqual(srv._bwProbeCacheable({ status: 1, stdout: '', stderr: 'not logged in', error: null }), true);
  // No CLI on this machine is a FACT, and the most expensive one to re-learn.
  assert.strictEqual(srv._bwProbeCacheable({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }), true);
  // A probe that did not answer is a missing fact, never a cached one.
  assert.strictEqual(srv._bwProbeCacheable({ error: Object.assign(new Error('bw timed out'), { code: 'ETIMEDOUT' }) }), false);
  assert.strictEqual(srv._bwProbeCacheable({ error: Object.assign(new Error('x'), { code: 'EACCES' }) }), false);
  assert.strictEqual(srv._bwProbeCacheable({ error: new Error('no code at all') }), false);
  // Defensive: nothing at all is treated as an answer-shaped empty result,
  // which is what _bwParseStatus already tolerates.
  assert.strictEqual(srv._bwProbeCacheable(null), true);
});

// The 'feedback' source (POST /api/feedback/submit -> _appRepoPostJson /
// _appRepoGet) reads the SAME APP_UPDATE_TOKEN as 'identity' and the 'app:*'
// git sources, so _infraSourceIsAppCredential counts it on the refusal axis.
// That predicate is private, and the point worth pinning is not its boolean
// but its CONSEQUENCE: a 401/403 on a feedback submit flips a MACHINE-WIDE
// register and paints the infrastructure strip on every view. So this drives
// the real transition through _infraNoteFetch rather than asserting on the
// text of server.js the way tests/test_infra_banner.mjs has to.
test('_infraNoteFetch: a refusal from the feedback source counts as an app-credential refusal', () => {
  const before = { ...srv._infraNet };
  try {
    // 403 on the app's own credential -> refused, attributed to 'feedback'.
    srv._infraNoteFetch(null, 'feedback', 403);
    const refused = srv.infraNetworkState(srv._infraNet);
    assert.strictEqual(refused.state, 'refused');
    assert.strictEqual(refused.source, 'feedback');

    // A 2xx from the same source proves the host answered and clears it.
    srv._infraNoteFetch(null, 'feedback', 200);
    assert.strictEqual(srv.infraNetworkState(srv._infraNet).state, 'reachable');

    // A status that is neither refused nor 2xx says NOTHING: GitLab answering
    // "branch already exists" (400) or 404/429/5xx is not a credential story,
    // and must not move the strip either way.
    const quiet = { ...srv._infraNet };
    srv._infraNoteFetch(null, 'feedback', 400);
    assert.deepStrictEqual({ ...srv._infraNet }, quiet, '400 must leave the register untouched');
  } finally {
    Object.assign(srv._infraNet, before);
  }
});

test('infraNetworkState: a refusal is its own state - answered, and we are locked out', () => {
  // On this network a missing VPN does NOT silence gitlab.com; the group's IP
  // allowlist answers 401, so "the host answered" had to stop meaning "fine".
  const refused = srv.infraNetworkState({ okAt: 0, failAt: 0, refusedAt: 5000, refusedSeq: 3, refusedSource: 'git:push' });
  assert.strictEqual(refused.state, 'refused');
  assert.strictEqual(refused.source, 'git:push');
  assert.strictEqual(refused.since, new Date(5000).toISOString());
  // The newest of the THREE wins, by sequence, not by wall clock.
  assert.strictEqual(srv.infraNetworkState({ okAt: 1, okSeq: 1, failAt: 1, failSeq: 2, refusedAt: 1, refusedSeq: 3 }).state, 'refused');
  assert.strictEqual(srv.infraNetworkState({ okAt: 1, okSeq: 3, failAt: 1, failSeq: 2, refusedAt: 1, refusedSeq: 1 }).state, 'reachable');
  assert.strictEqual(srv.infraNetworkState({ okAt: 1, okSeq: 1, failAt: 1, failSeq: 3, refusedAt: 1, refusedSeq: 2 }).state, 'unreachable');
  // A register written by the two-axis shape still reads: the missing axis is
  // never the newest, and a refusal older than a success does not resurface.
  assert.strictEqual(srv.infraNetworkState({ okAt: 2000, okSeq: 2, failAt: 0, failSeq: 0 }).state, 'reachable');
  assert.strictEqual(srv.infraNetworkState({ okAt: 1, okSeq: 2, failAt: 0, failSeq: 0, refusedAt: 1, refusedSeq: 1 }).state, 'reachable');
});

test('infraNetworkState: nothing tried yet is unknown, the newest outcome wins', () => {
  assert.deepStrictEqual(srv.infraNetworkState({ okAt: 0, failAt: 0 }), { state: 'unknown', since: null, source: null });
  assert.deepStrictEqual(srv.infraNetworkState(null).state, 'unknown');
  const r1 = srv.infraNetworkState({ okAt: 1000, okSource: 'identity', failAt: 0, failSource: null });
  assert.strictEqual(r1.state, 'reachable');
  assert.strictEqual(r1.source, 'identity');
  assert.strictEqual(r1.since, new Date(1000).toISOString());
  const r2 = srv.infraNetworkState({ okAt: 1000, okSource: 'identity', failAt: 2000, failSource: 'git:fetch' });
  assert.strictEqual(r2.state, 'unreachable');
  assert.strictEqual(r2.source, 'git:fetch');
  // A success after the failure flips it back; without sequence numbers a
  // wall-clock tie reads as reachable.
  assert.strictEqual(srv.infraNetworkState({ okAt: 3000, failAt: 2000 }).state, 'reachable');
  assert.strictEqual(srv.infraNetworkState({ okAt: 2000, failAt: 2000 }).state, 'reachable');
  // The sequence counters decide, not the clock: two outcomes stamped in the
  // same millisecond (parallel fetches) still report the one that came last.
  assert.strictEqual(srv.infraNetworkState({ okAt: 2000, okSeq: 1, failAt: 2000, failSeq: 2 }).state, 'unreachable');
  assert.strictEqual(srv.infraNetworkState({ okAt: 2000, okSeq: 2, failAt: 2000, failSeq: 1 }).state, 'reachable');
});

test('isNetworkFetchError: undici causes, timeouts and "fetch failed" are network; the rest is not', () => {
  const withCause = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) {
    assert.strictEqual(srv.isNetworkFetchError(withCause(code)), true, code);
  }
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  assert.strictEqual(srv.isNetworkFetchError(timeout), true);
  assert.strictEqual(srv.isNetworkFetchError(new TypeError('fetch failed')), true);
  // A JSON that did not parse, a bug, a bare string: not the network's fault.
  assert.strictEqual(srv.isNetworkFetchError(new SyntaxError('Unexpected token <')), false);
  assert.strictEqual(srv.isNetworkFetchError(new Error('boom')), false);
  assert.strictEqual(srv.isNetworkFetchError('ENOTFOUND'), false);
  assert.strictEqual(srv.isNetworkFetchError(null), false);
});

test('classifyGitError: what the register counts as the host not answering', () => {
  // The register moves on `network` only - a killed transfer is a budget, not
  // a dead host, and an auth error proves the host answered.
  assert.strictEqual(srv.classifyGitError('fatal: unable to access \'https://gitlab.example/x.git/\': Could not resolve host: gitlab.example', 128), 'network');
  assert.strictEqual(srv.classifyGitError('fatal: unable to access \'https://gitlab.example/x.git/\': Failed to connect to gitlab.example port 443 after 21043 ms: Couldn\'t connect to server', 128), 'network');
  assert.strictEqual(srv.classifyGitError('', 1, { killed: true }), 'timeout');
  assert.strictEqual(srv.classifyGitError('remote: HTTP Basic: Access denied. The provided password or token is incorrect', 128), 'auth-expired');
});

test('the register itself: git and fetch outcomes move it by the documented rules, a recovery drops the outage caches', () => {
  const reg = srv._infraNet;
  const reset = () => {
    reg.okAt = 0; reg.okSeq = 0; reg.okSource = null;
    reg.failAt = 0; reg.failSeq = 0; reg.failSource = null;
    reg.refusedAt = 0; reg.refusedSeq = 0; reg.refusedSource = null;
  };
  reset();
  try {
    // A killed transfer is a budget, not a dead host: untouched.
    srv._infraNoteGitResult({ code: 1, stderr: '', killed: true }, 'git:clone');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'unknown');
    // A killed STATUS op (ls-remote, the 45 s fetch --prune) is the only
    // trace a packet-dropping VPN leaves in git: unreachable.
    srv._infraNoteGitResult({ code: 1, stderr: '', killed: true }, 'app:ls-remote', { statusOp: true });
    assert.strictEqual(srv.infraNetworkState(reg).state, 'unreachable');
    reset();
    // A conflict says nothing about the host either.
    srv._infraNoteGitResult({ code: 1, stderr: 'CONFLICT (content): Merge conflict in x' }, 'git:pull');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'unknown');
    // DNS failure: unreachable, stamped with its source.
    srv._infraNoteGitResult({ code: 128, stderr: "fatal: unable to access 'https://gitlab.example/x.git/': Could not resolve host: gitlab.example" }, 'git:fetch');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'unreachable');
    assert.strictEqual(srv.infraNetworkState(reg).source, 'git:fetch');
    // An auth or access error on the APP repository proves the host ANSWERED
    // and turned us away - `refused`, never `reachable`. This is the whole
    // point of the third axis: it used to land on `reachable` and the strip
    // stayed hidden for a machine that could not do a single thing with GitLab.
    srv._infraNoteGitResult({ code: 128, stderr: 'remote: HTTP Basic: Access denied' }, 'app:ls-remote');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'refused');
    assert.strictEqual(srv.infraNetworkState(reg).source, 'app:ls-remote');
    srv._infraNoteGitResult({ code: 128, stderr: 'fatal: Could not read from remote repository' }, 'app:fetch');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'refused');
    // The same error on a DATA source says nothing either way: seven sources
    // carry seven other tokens, and a machine-wide strip pinned by one stale
    // data token - or flapped by eight parallel fetches - is the wrong tool.
    srv._infraNoteNetwork(true, 'git:pull');
    srv._infraNoteGitResult({ code: 128, stderr: 'remote: HTTP Basic: Access denied' }, 'git:push');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'reachable', 'a data-source refusal moves nothing');
    assert.strictEqual(srv.infraNetworkState(reg).source, 'git:pull');
    // A fetch that threw on the socket: unreachable.
    srv._infraNoteFetch(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 'identity');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'unreachable');
    srv._infraNoteFetch(new SyntaxError('Unexpected token <'), 'catalog');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'unreachable', 'a parse error is not a network verdict');
    // A response with no status handed over keeps the old meaning.
    srv._infraNoteFetch(null, 'catalog');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'reachable');
    // 401/403 with the app credential is a refusal.
    srv._infraNoteFetch(null, 'identity', 401);
    assert.strictEqual(srv.infraNetworkState(reg).state, 'refused');
    assert.strictEqual(srv.infraNetworkState(reg).source, 'identity');
    // A 2xx from /user proves NOTHING: the endpoint is user-scoped and the
    // group's IP allowlist does not cover it, so a locked-out machine gets a
    // 200 there. Writing `ok` from it flapped the strip on every load.
    srv._infraNoteFetch(null, 'identity', 200);
    assert.strictEqual(srv.infraNetworkState(reg).state, 'refused', 'GET /user 200 does not clear a refusal');
    // A project-scoped 2xx does prove access.
    srv._infraNoteFetch(null, 'catalog', 200);
    assert.strictEqual(srv.infraNetworkState(reg).state, 'reachable');
    // 401/403 with ANOTHER credential (the modules token, a personal token)
    // says nothing about this machine's access.
    srv._infraNoteFetch(null, 'catalog', 403);
    assert.strictEqual(srv.infraNetworkState(reg).state, 'reachable', 'a catalog-token refusal moves nothing');
    srv._infraNoteFetch(null, 'activity', 401);
    assert.strictEqual(srv.infraNetworkState(reg).state, 'reachable');
    // A 404 is never a refusal - GitLab answers it both for an invisible
    // project and for a resource that is simply absent, and classifyGitlab404
    // owns that resolution - and it is not proof of access either. Blaming
    // the VPN for an empty catalog.json is exactly what must not happen, and
    // so is clearing a refusal from a hidden project's 404.
    srv._infraNoteRefused('app:ls-remote');
    srv._infraNoteFetch(null, 'catalog', 404);
    assert.strictEqual(srv.infraNetworkState(reg).state, 'refused', 'a 404 moves nothing');
    srv._infraNoteFetch(null, 'catalog', 503);
    assert.strictEqual(srv.infraNetworkState(reg).state, 'refused', 'a 5xx moves nothing');
    // The dedicated entry point, for callers that mean it directly.
    srv._infraNoteNetwork(true, 'catalog');
    srv._infraNoteRefused('app:ls-remote');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'refused');
    assert.strictEqual(srv.infraNetworkState(reg).source, 'app:ls-remote');
    // The recovery edge (the cache drops it performs are pinned by source in
    // tests/test_infra_banner.mjs; here only the verdict and its source).
    srv._infraNoteNetwork(false, 'git:fetch');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'unreachable');
    srv._infraNoteNetwork(true, 'identity');
    assert.strictEqual(srv.infraNetworkState(reg).state, 'reachable');
    assert.strictEqual(reg.okSource, 'identity');
  } finally {
    reset();
  }
});

// -- _refererPathname: the /ds-icons/ dev shim's only input -----------------------
// The shim in serveStatic serves a root-absolute DS icon out of the framed module
// app the REFERER points at, because the shared app shells (cs-shell) build
// `url('/ds-icons/<slug>.svg')` - right on Cloudflare Pages, 404 under
// /modules-data/<id>/public/<app>/. Everything the shim trusts comes from here, so
// a referer from another origin, or none at all, must never resolve to a path.
test('_refererPathname: same-origin referer yields its pathname', () => {
  const req = { headers: { host: 'localhost:3001', referer: 'http://localhost:3001/modules-data/m/public/app/zam-ar/' } };
  assert.strictEqual(srv._refererPathname(req), '/modules-data/m/public/app/zam-ar/');
});

test('_refererPathname: no referer, a foreign origin and a missing header yield null', () => {
  assert.strictEqual(srv._refererPathname({ headers: { host: 'localhost:3001' } }), null);
  assert.strictEqual(srv._refererPathname({ headers: { host: 'localhost:3001', referer: 'http://evil.example/modules-data/m/public/app/' } }), null);
  assert.strictEqual(srv._refererPathname({ headers: {} }), null);
  assert.strictEqual(srv._refererPathname(null), null);
});

test('_refererPathname: posix separators on every OS, an encoded backslash yields null', () => {
  // win32's path.normalize would answer '\\modules-data\\m\\...', which no prefix test matches.
  const req = { headers: { host: 'localhost:3001', referer: 'http://localhost:3001/modules-data/m/public/./app/x/../zam-ar/' } };
  assert.strictEqual(srv._refererPathname(req), '/modules-data/m/public/app/zam-ar/');
  const bs = { headers: { host: 'localhost:3001', referer: 'http://localhost:3001/modules-data%5Cm%5Cpublic%5Capp/' } };
  assert.strictEqual(srv._refererPathname(bs), null);
});

test('_refererPathname: garbage never yields a path the shim would act on', () => {
  // The property that matters is NOT "returns null" - a junk referer parses as a
  // RELATIVE url against our own origin ('::::' -> '/::::'), which is harmless.
  // What must hold is that nothing unparseable resolves under the frameable
  // prefix, because that prefix is the shim's only authorisation to leave ROOT.
  for (const referer of ['::::', 'not a url', '//', 'javascript:alert(1)', '?x=1']) {
    const out = srv._refererPathname({ headers: { host: 'localhost:3001', referer } });
    if (out !== null) {
      assert.ok(!out.startsWith('/modules-data/'), `a junk referer must not land under the prefix: ${referer} -> ${out}`);
    }
  }
});

test('_refererPathname: a traversal in the referer is normalized, never left raw', () => {
  const req = { headers: { host: 'localhost:3001', referer: 'http://localhost:3001/modules-data/../../etc/' } };
  const out = srv._refererPathname(req);
  assert.ok(!String(out).includes('..'), 'a normalised path must not contain ..');
});

test('_protoGenerateStarterSpec describes the starter and carries no frame', () => {
  const tsx = "export const demoStates = [{ id: 'a', label: 'A', group: 'G' }];\ncase 'a':\n";
  const spec = srv._protoGenerateStarterSpec('X', tsx, '');
  assert.strictEqual(spec.frame, undefined);
  assert.match(spec.summary, /templates\/prototype\/starter\./);
  assert.deepStrictEqual(spec.customElements, []);
});

// ── parsePendingModulePublishes (GET /api/modules/pending-publishes) ─────────

test('parsePendingModulePublishes keeps only publish branches, newest per module', () => {
  const body = [
    { source_branch: 'module/time-off-20261001-101500', web_url: 'https://g/mr/1', title: 'Update: time-off', created_at: '2026-10-01' },
    { source_branch: 'module/time-off-20261003-090000', web_url: 'https://g/mr/2', title: 'Update: time-off', created_at: '2026-10-03' },
    { source_branch: 'module/orders-hub-20261002-120000', web_url: 'https://g/mr/3' },
    { source_branch: 'katalog/obszary-20261002-120000', web_url: 'https://g/mr/4' },
    { source_branch: 'module/bez-daty', web_url: 'https://g/mr/5' },
    null,
  ];
  const out = srv.parsePendingModulePublishes({ ok: true, status: 200, text: JSON.stringify(body) });
  assert.strictEqual(out.error, undefined);
  assert.deepStrictEqual(out.items.map(i => [i.id, i.mrUrl]), [['orders-hub', 'https://g/mr/3'], ['time-off', 'https://g/mr/2']]);
  assert.strictEqual(out.items[0].title, '');
});

test('parsePendingModulePublishes reports gitlab_error on a failed or malformed answer', () => {
  for (const r of [null, { ok: false, status: 401, text: '' }, { ok: true, status: 200, text: '{' }, { ok: true, status: 200, text: '{}' }]) {
    assert.deepStrictEqual(srv.parsePendingModulePublishes(r), { items: [], error: 'gitlab_error' });
  }
});

test('parseMergedModulePublishes keeps publish branches merged after the snapshot', () => {
  const since = Date.parse('2026-10-06T15:50:00Z');
  const body = [
    { source_branch: 'module/costs-20261006-155246', merged_at: '2026-10-06T15:54:10Z' },
    { source_branch: 'module/time-off-20261006-100000', merged_at: '2026-10-06T10:05:00Z' },
    { source_branch: 'katalog/obszary-20261006-155000', merged_at: '2026-10-06T15:55:00Z' },
    { source_branch: 'module/bez-scalenia-20261006-155000', merged_at: null },
    null,
  ];
  const out = srv.parseMergedModulePublishes({ ok: true, status: 200, text: JSON.stringify(body) }, since);
  assert.deepStrictEqual(out, [{ id: 'costs', mergedAt: Date.parse('2026-10-06T15:54:10Z') }]);
  for (const r of [null, { ok: false, text: '' }, { ok: true, text: '{' }, { ok: true, text: '{}' }]) {
    assert.deepStrictEqual(srv.parseMergedModulePublishes(r, since), []);
  }
});

test('catalogStaleAfterMerges: a merge after the snapshot makes the catalog stale', () => {
  // 2026-10-06: three modules published and merged within minutes stayed on
  // "Need publishing" - the MRs had left the open list, the catalog cache
  // still held the pre-merge versions.
  assert.strictEqual(srv.catalogStaleAfterMerges([{ id: 'a', mergedAt: 2000 }], 1000), true);
  assert.strictEqual(srv.catalogStaleAfterMerges([{ id: 'a', mergedAt: 500 }], 1000), false);
  assert.strictEqual(srv.catalogStaleAfterMerges([{ id: 'a', mergedAt: 2000 }], 0), false, 'no snapshot, nothing stale');
  assert.strictEqual(srv.catalogStaleAfterMerges([], 1000), false);
  assert.strictEqual(srv.catalogStaleAfterMerges(undefined, 1000), false);
});

// ── publish drift + bump (GET /api/modules/publish-drift, POST /api/modules/bump-version)

test('gitBlobSha is git\'s blob id', () => {
  assert.strictEqual(srv.gitBlobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('modulePublishDrift counts added, changed and removed files against the catalog tree', () => {
  const same = Buffer.from('same');
  const tree = [
    { type: 'blob', path: 'modules/m/module.json', id: srv.gitBlobSha(same) },
    { type: 'blob', path: 'modules/m/client/old.js', id: 'x' },
    { type: 'blob', path: 'modules/m/client/gone.js', id: 'y' },
    { type: 'tree', path: 'modules/m/client', id: 'z' },
    { type: 'blob', path: 'modules/other/a.js', id: 'q' },
  ];
  const files = [
    { path: 'module.json', data: same },
    { path: 'client/old.js', data: Buffer.from('new body') },
    { path: 'client/new.js', data: Buffer.from('x') },
  ];
  assert.deepStrictEqual(srv.modulePublishDrift(files, 'm', tree),
    { added: 1, changed: 1, removed: 1, paths: ['client/old.js', 'client/new.js', 'client/gone.js'], changedPaths: ['client/old.js'] });
  assert.deepStrictEqual(srv.modulePublishDrift([{ path: 'module.json', data: same }], 'm', tree.slice(0, 1)),
    { added: 0, changed: 0, removed: 0, paths: [], changedPaths: [] });
});

test('manifestsEquivalentForPublish ignores the install-written area, key order and formatting', () => {
  const remote = '{"id":"m","version":"0.1.0","views":[{"id":"a","label":"A"}]}';
  assert.strictEqual(srv.manifestsEquivalentForPublish(
    '{\n  "version": "0.1.0",\n  "id": "m",\n  "area": "AR",\n  "views": [{ "label": "A", "id": "a" }]\n}\n', remote), true);
  assert.strictEqual(srv.manifestsEquivalentForPublish(Buffer.from('{"id":"m","version":"0.1.0","views":[{"id":"a","label":"B"}]}'), remote), false);
  assert.strictEqual(srv.manifestsEquivalentForPublish('{"id":"m","version":"0.1.0","views":[{"id":"a","label":"A"}],"status":"beta"}', remote), false);
  assert.strictEqual(srv.manifestsEquivalentForPublish('not json', remote), false);
});

test('bumpManifestPatch raises the patch number and keeps every other byte', () => {
  const text = '{\n    "id": "x",\n    "version": "1.4.9",\n    "deps": { "version": "1.4.9" }\n}\n';
  const out = srv.bumpManifestPatch(text);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.to, '1.4.10');
  assert.strictEqual(JSON.parse(out.text).version, '1.4.10');
  assert.strictEqual(JSON.parse(out.text).deps.version, '1.4.9', 'only the top-level literal moves');
  assert.strictEqual(srv.bumpManifestPatch('{"version":"v2.0.9"}').to, 'v2.0.10');
  for (const bad of ['{"version":"1.0"}', '{"version":"1.0.0-beta"}', '{}', 'not json', '[]']) {
    assert.strictEqual(srv.bumpManifestPatch(bad).ok, false, bad);
  }
});

// ── supersededPublishMrs (POST /api/modules/publish closes older MRs) ────────
// A module published as !96 (0.3.1) then !98 (0.3.2) from the same machine
// before !96 merged; after !98 merged, !96 conflicted forever.

const _desc = (v) => 'Published from Mission Deck.\n\n- module: `x`\n- version: `' + v + '`\n- files: 47';
const ME = 7;

test('supersededPublishMrs closes an older MR of the same module, same author, version this tree published', () => {
  const open = [
    { iid: 96, author: { id: ME }, source_branch: 'module/sprint-stats-20261007-065709', description: _desc('0.3.1') },
    { iid: 98, author: { id: ME }, source_branch: 'module/sprint-stats-20261007-074948', description: _desc('0.3.2') },
    { iid: 97, author: { id: ME }, source_branch: 'module/time-log-20261007-065713', description: _desc('0.5.2') },
  ];
  const versions = srv.publishedVersionsFromLog([
    { subject: 'publish 0.3.2' }, { subject: 'publish 0.3.1' }, { subject: 'install from catalog 0.1.1' },
  ]);
  assert.deepStrictEqual(srv.supersededPublishMrs(open, 'sprint-stats', 98, ME, versions),
    [{ iid: 96, branch: 'module/sprint-stats-20261007-065709', version: '0.3.1' }]);
  // An MR opened before the English rename still names its version.
  const legacy = [{ iid: 80, author: { id: ME }, source_branch: 'module/sprint-stats-20261001-065709', description: '- wersja: `0.3.1`' }];
  assert.deepStrictEqual(srv.supersededPublishMrs(legacy, 'sprint-stats', 98, ME, versions).map((m) => m.iid), [80]);
});

test('supersededPublishMrs never closes an MR it cannot prove is in this tree', () => {
  const versions = srv.publishedVersionsFromLog([{ subject: 'publish 0.3.1' }, { subject: 'publish 0.3.2' }]);
  const open = [
    { iid: 90, author: { id: 99 }, source_branch: 'module/sprint-stats-20261006-100000', description: _desc('0.3.1') }, // same version, other person
    { iid: 91, author: { id: ME }, source_branch: 'module/sprint-stats-20261006-110000', description: 'hand-written description' },
    { iid: 92, author: { id: ME }, source_branch: 'feature/sprint-stats', description: _desc('0.3.2') },
    { iid: 93, author: { id: ME }, source_branch: 'module/sprint-stats-extra-20261006-120000', description: _desc('0.3.2') },
    { iid: 94, source_branch: 'module/sprint-stats-20261006-130000', description: _desc('0.3.1') }, // no author
    { iid: 95, author: { id: ME }, source_branch: 'module/sprint-stats-20261006-140000', description: _desc('0.2.9') }, // not published here
  ];
  assert.deepStrictEqual(srv.supersededPublishMrs(open, 'sprint-stats', 98, ME, versions), []);
  assert.deepStrictEqual(srv.supersededPublishMrs(open, 'sprint-stats', 98, null, versions), [], 'unknown author closes nothing');
  assert.deepStrictEqual(srv.supersededPublishMrs(null, 'sprint-stats', 98, ME, versions), []);
});

test('publishedVersionsFromLog stops at the newest commit that replaced the tree', () => {
  const v = (subjects) => [...srv.publishedVersionsFromLog(subjects.map((subject) => ({ subject })))].sort();
  // reinstall from the catalog after publishing 0.3.1: its changes are gone from the tree
  assert.deepStrictEqual(v(['publish 0.3.3', 'install from catalog 0.3.0', 'publish 0.3.1']), ['0.3.3']);
  assert.deepStrictEqual(v(['import from zip file', 'publish 0.3.1']), []);
  assert.deepStrictEqual(v(['publish 0.4.0 (reconciled with catalog)', 'publish 0.3.1']), []);
  // hand commits in between do not break the chain
  assert.deepStrictEqual(v(['publish 0.3.2', 'fix chart', 'publish 0.3.1']), ['0.3.1', '0.3.2']);
  // history written before the English rename reads the same way
  assert.deepStrictEqual(v(['publikacja 0.3.3', 'instalacja z katalogu 0.3.0', 'publikacja 0.3.1']), ['0.3.3']);
  assert.deepStrictEqual(v(['publikacja 0.4.0 (uzgodnione z katalogiem)', 'publish 0.3.1']), []);
  assert.strictEqual(srv.publishedVersionsFromLog(undefined).size, 0);
});

// 2026-10-09: a deletion that reached a v1 mirror's working tree (porcelain
// ` D`) carried no path, fell under "Cockpit Core" and a module's scoped push
// never sent it. A v1 name spells its path out, so it resolves without a decrypt.
test('_v1MirrorRelPath reads the path a v1 mirror name spells out, never a v2 HMAC name', () => {
  const v1 = { mirrorFormat: 'v1' };
  assert.strictEqual(srv._v1MirrorRelPath(v1, 'meetings/2026-06-25_x/summary.md.enc'), 'meetings/2026-06-25_x/summary.md');
  assert.strictEqual(srv._v1MirrorRelPath(v1, 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90.enc'), null);
  assert.strictEqual(srv._v1MirrorRelPath(v1, 'meetings/../x.enc'), null);
  assert.strictEqual(srv._v1MirrorRelPath(v1, 'meetings/x/summary.md'), null);
  assert.strictEqual(srv._v1MirrorRelPath({ mirrorFormat: 'v2' }, 'meetings/x/summary.md.enc'), null);
  assert.strictEqual(srv._v1MirrorRelPath(null, 'meetings/x/summary.md.enc'), null);
});
