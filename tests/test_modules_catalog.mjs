// tests/test_modules_catalog.mjs
// Pure-function unit tests for the modules catalog (GitLab API), plan B2:
// parseModulesCatalog, mergeModulesCatalog, sanitizeModuleTreePath from
// server.js (never started - required from a non-main module), and
// compareSemver from js/version-format.js (a real ESM import).

import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { compareSemver } from '../js/version-format.js';

const require = createRequire(import.meta.url);
const srv = require('../server.js');
const { parseModulesCatalog, mergeModulesCatalog, sanitizeModuleTreePath, classifyGitlab404 } = srv;

// ── parseModulesCatalog ──────────────────────────────────────────────────────

test('parseModulesCatalog accepts a valid curation with two entries', () => {
  const result = parseModulesCatalog(JSON.stringify({
    schemaVersion: 1,
    modules: [
      { id: 'raporty', status: 'stable', featured: true, order: 10 },
      { id: 'integracje', status: 'beta' },
    ],
  }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.modules.length, 2);
  assert.strictEqual(result.modules[0].id, 'raporty');
  assert.strictEqual(result.modules[1].status, 'beta');
});

test('parseModulesCatalog rejects an unknown schemaVersion', () => {
  const result = parseModulesCatalog(JSON.stringify({ schemaVersion: 99, modules: [] }));
  assert.strictEqual(result.ok, false);
});

test('parseModulesCatalog rejects invalid JSON without throwing', () => {
  assert.doesNotThrow(() => {
    const result = parseModulesCatalog('{not json');
    assert.strictEqual(result.ok, false);
  });
});

test('parseModulesCatalog defaults a missing status to stable', () => {
  const result = parseModulesCatalog(JSON.stringify({ schemaVersion: 1, modules: [{ id: 'brak-statusu' }] }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.modules[0].status, 'stable');
});

test('parseModulesCatalog keeps an entry with no area, and normalizes a good one', () => {
  const result = parseModulesCatalog(JSON.stringify({
    schemaVersion: 1,
    modules: [{ id: 'brak-obszaru' }, { id: 'z-obszarem', area: '  Product  ' }],
  }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.modules[0].area, '');
  assert.strictEqual(result.modules[1].area, 'Product');
});

test('parseModulesCatalog drops only the field, never the entry, on a bad-typed area', () => {
  const result = parseModulesCatalog(JSON.stringify({
    schemaVersion: 1,
    modules: [{ id: 'zly-typ', area: 42 }],
  }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.modules.length, 1, 'the entry must survive, not be dropped by `continue`');
  assert.strictEqual(result.modules[0].area, '');
});

// ── mergeModulesCatalog ──────────────────────────────────────────────────────

test('mergeModulesCatalog marks a curated entry with a matching directory as curated: true', () => {
  const curated = [{ id: 'raporty', status: 'stable', featured: false, order: 0 }];
  const manifests = { raporty: { ok: true, manifest: { id: 'raporty', version: '1.0.0' } } };
  const { entries, errors } = mergeModulesCatalog(curated, ['raporty'], manifests);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].curated, true);
});

test('mergeModulesCatalog appends an uncurated directory at the end with curated: false', () => {
  const curated = [{ id: 'raporty', status: 'stable', featured: true, order: 0 }];
  const manifests = {
    raporty: { ok: true, manifest: { id: 'raporty', version: '1.0.0' } },
    'poza-kuracja': { ok: true, manifest: { id: 'poza-kuracja', version: '0.1.0' } },
  };
  const { entries, errors } = mergeModulesCatalog(curated, ['raporty', 'poza-kuracja'], manifests);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[entries.length - 1].id, 'poza-kuracja');
  assert.strictEqual(entries[entries.length - 1].curated, false);
});

test('mergeModulesCatalog reports a curated entry with no matching directory as missing-in-modules', () => {
  const curated = [{ id: 'widmo', status: 'stable', featured: false, order: 0 }];
  const { entries, errors } = mergeModulesCatalog(curated, [], {});
  assert.strictEqual(entries.length, 0);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].id, 'widmo');
  assert.strictEqual(errors[0].error, 'missing-in-modules');
});

test('mergeModulesCatalog sorts featured entries first, then by order', () => {
  const curated = [
    { id: 'c', status: 'stable', featured: false, order: 1 },
    { id: 'a', status: 'stable', featured: true, order: 20 },
    { id: 'b', status: 'stable', featured: true, order: 10 },
  ];
  const manifests = {
    a: { ok: true, manifest: { id: 'a', version: '1.0.0' } },
    b: { ok: true, manifest: { id: 'b', version: '1.0.0' } },
    c: { ok: true, manifest: { id: 'c', version: '1.0.0' } },
  };
  const { entries } = mergeModulesCatalog(curated, ['a', 'b', 'c'], manifests);
  assert.deepStrictEqual(entries.map(e => e.id), ['b', 'a', 'c']);
});

// ── sanitizeModuleTreePath ───────────────────────────────────────────────────

test('sanitizeModuleTreePath accepts a normal file under the module prefix', () => {
  const result = sanitizeModuleTreePath(
    { type: 'blob', mode: '100644', path: 'modules/raporty/client/index.js' }, 'raporty'
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.relPath, 'client/index.js');
});

test('sanitizeModuleTreePath rejects a symlink (mode 120000)', () => {
  const result = sanitizeModuleTreePath({ type: 'blob', mode: '120000', path: 'modules/a/link' }, 'a');
  assert.strictEqual(result.ok, false);
});

test('sanitizeModuleTreePath rejects a submodule entry (type: commit)', () => {
  const result = sanitizeModuleTreePath({ type: 'commit', mode: '160000', path: 'modules/a/sub' }, 'a');
  assert.strictEqual(result.ok, false);
});

test('sanitizeModuleTreePath rejects a path that escapes with ..', () => {
  const result = sanitizeModuleTreePath(
    { type: 'blob', mode: '100644', path: 'modules/a/../../evil' }, 'a'
  );
  assert.strictEqual(result.ok, false);
});

test('sanitizeModuleTreePath rejects a path without the modules/<id>/ prefix', () => {
  const result = sanitizeModuleTreePath({ type: 'blob', mode: '100644', path: 'other/a/x' }, 'a');
  assert.strictEqual(result.ok, false);
});

test('sanitizeModuleTreePath rejects an absolute path', () => {
  const result = sanitizeModuleTreePath({ type: 'blob', mode: '100644', path: '/etc/passwd' }, 'a');
  assert.strictEqual(result.ok, false);
});

// ── compareSemver ────────────────────────────────────────────────────────────

test('compareSemver orders a higher version above a lower one', () => {
  assert.strictEqual(compareSemver('1.2.0', '1.1.9'), 1);
});

test('compareSemver treats equal versions as equal', () => {
  assert.strictEqual(compareSemver('1.0.0', '1.0.0'), 0);
});

test('compareSemver returns null when either side is not semver', () => {
  assert.strictEqual(compareSemver('nie-semver', '1.0.0'), null);
});

// ── author / tags fallback: curation wins, the manifest is the default ────────

const MANIFEST_WITH_META = {
  schemaVersion: 1, id: 'raporty', name: 'Raporty', version: '1.0.0',
  author: 'Autor z manifestu', tags: ['manifest'],
  sidebar: { label: 'Raporty', kind: 'item' },
  views: [{ id: 'raporty-main', label: 'Main' }],
};

test('mergeModulesCatalog falls back to the manifest author and tags', () => {
  const curated = parseModulesCatalog(JSON.stringify({
    schemaVersion: 1,
    modules: [{ id: 'raporty', status: 'stable' }],
  })).modules;
  const { entries } = mergeModulesCatalog(curated, ['raporty'], {
    raporty: { ok: true, manifest: MANIFEST_WITH_META },
  });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].author, 'Autor z manifestu');
  assert.deepStrictEqual(entries[0].tags, ['manifest']);
});

test('mergeModulesCatalog takes area from the manifest when the curation has none', () => {
  const curated = parseModulesCatalog(JSON.stringify({
    schemaVersion: 1,
    modules: [{ id: 'raporty', status: 'stable' }],
  })).modules;
  const { entries } = mergeModulesCatalog(curated, ['raporty'], {
    raporty: { ok: true, manifest: { ...MANIFEST_WITH_META, area: 'AR' } },
  });
  assert.strictEqual(entries[0].area, 'AR');
});

test('mergeModulesCatalog lets the curation override the manifest', () => {
  const curated = parseModulesCatalog(JSON.stringify({
    schemaVersion: 1,
    modules: [{ id: 'raporty', status: 'stable', author: 'Autor z katalogu', tags: ['katalog'] }],
  })).modules;
  const { entries } = mergeModulesCatalog(curated, ['raporty'], {
    raporty: { ok: true, manifest: MANIFEST_WITH_META },
  });
  assert.strictEqual(entries[0].author, 'Autor z katalogu');
  assert.deepStrictEqual(entries[0].tags, ['katalog']);
});

test('an uncurated module still shows its manifest author and tags', () => {
  const { entries } = mergeModulesCatalog([], ['raporty'], {
    raporty: { ok: true, manifest: MANIFEST_WITH_META },
  });
  assert.strictEqual(entries[0].curated, false);
  assert.strictEqual(entries[0].author, 'Autor z manifestu');
  assert.deepStrictEqual(entries[0].tags, ['manifest']);
});

// ── classifyGitlab404 ────────────────────────────────────────────────────────
// GitLab answers 404 for a private project the caller may not see (a request
// from outside the group's IP allowlist - no VPN - or a token without access),
// so a 404 on a catalog resource is resolved by probing the project itself.

test('classifyGitlab404: a visible project (200) means the resource is really absent', () => {
  assert.deepStrictEqual(classifyGitlab404(200), { verdict: 'empty' });
});

test('classifyGitlab404: an invisible project (403/404) is no-access, never an empty list', () => {
  assert.deepStrictEqual(classifyGitlab404(404), { verdict: 'no-access' });
  assert.deepStrictEqual(classifyGitlab404(403), { verdict: 'no-access' });
});

test('classifyGitlab404: a probe that did not answer the question is unknown - no VPN promise, no empty list', () => {
  // 401 is "the token was rejected", not a visibility story; 0 is a timeout
  // or a network failure; 429 and 5xx are GitLab not answering.
  for (const status of [401, 0, 500, 429, 502, undefined]) {
    assert.deepStrictEqual(classifyGitlab404(status), { verdict: 'unknown' }, `status ${status}`);
  }
});
