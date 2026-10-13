// The team data repository root: register(ctx) hands paths.js the core's
// ctx.dataRepoDir; a ctx without it (older core) falls back to
// DATA_SUB_REPOS_DIR, then rootDir/data-sub-repositories. Every
// registration resets the resolver, so nothing leaks between two ctxs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const paths = require('../server/paths.js');

test('teamDataDir: the core resolver wins, a later ctx without it falls back', () => {
  const prev = process.env.DATA_SUB_REPOS_DIR;
  try {
    delete process.env.DATA_SUB_REPOS_DIR;
    paths.useCoreResolver({ dataRepoDir: (id) => (id === 'data-tier-0' ? '/core/tier0' : null) });
    assert.equal(paths.teamDataDir('/r'), '/core/tier0');
    paths.useCoreResolver({});
    assert.equal(paths.teamDataDir('/r'), path.join('/r', 'data-sub-repositories', 'ds-data'));
    process.env.DATA_SUB_REPOS_DIR = '/subs';
    assert.equal(paths.teamDataDir('/r'), path.join('/subs', 'ds-data'));
  } finally {
    paths.useCoreResolver({});
    if (prev === undefined) delete process.env.DATA_SUB_REPOS_DIR; else process.env.DATA_SUB_REPOS_DIR = prev;
  }
});

test('storageState: ok with data, empty for a fresh clone, unavailable when not cloned', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gantt-roadmap-state-'));
  try {
    const dataDir = path.join(tmp, 'ds-data');
    paths.useCoreResolver({ dataRepoDir: () => dataDir });
    assert.equal(paths.storageState('/r'), 'unavailable');
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, '.DS_Store'), '');
    assert.equal(paths.storageState('/r'), 'empty', 'a fresh clone (junk only) is empty, not unavailable');
    fs.mkdirSync(path.join(dataDir, 'other-module'));
    assert.equal(paths.storageState('/r'), 'ok', 'another module\'s data is enough - gantt-roadmap/ is created on first write');
  } finally {
    paths.useCoreResolver({});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('register(ctx) hands the core resolver to paths.js', () => {
  const register = require('../server/index.js');
  try {
    register({ moduleId: 'gantt-roadmap', dataDir: '/d', rootDir: '/r', log: () => {}, jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true, makeLock: () => (fn) => fn(), dataRepoDir: (id) => (id === 'data-tier-0' ? '/core/tier0' : null) });
    assert.equal(paths.teamDataDir('/r'), '/core/tier0');
  } finally {
    paths.useCoreResolver({});
  }
});
