// tests/test_proto_kinds.mjs
// Kinds of prototype (desktop, mobile, briefing, blank): the pure reader, the
// starter staged per kind and the frame written into spec.json. A kind is
// stored in the registry ONLY when the request named one; a missing kind reads
// as desktop and is never written back.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../server.js');
const SERVER_PATH = fileURLToPath(new URL('../server.js', import.meta.url));

function inChild(tmp, code) {
  const script = `'use strict';
const srv = require(${JSON.stringify(SERVER_PATH)});
(async () => { const out = await (async () => { ${code} })(); process.stdout.write(JSON.stringify(out === undefined ? null : out)); })()
  .catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });`;
  return JSON.parse(cp.execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      IS_TEST_MODE: '1',
      AUTO_SYNC_ENABLED: '0',
      DATA_SUB_REPOS_DIR: tmp,
      DATA_TIER_0_DIR: path.join(tmp, 'ds-data'),
      POC_PAGES_DATA_DIR: path.join(tmp, 'shell'),
    },
  }));
}

test('_protoKindOf: a missing, empty or unknown kind reads as desktop; a known one as itself', () => {
  assert.strictEqual(srv._protoKindOf({}), 'desktop');
  assert.strictEqual(srv._protoKindOf(null), 'desktop');
  assert.strictEqual(srv._protoKindOf(undefined), 'desktop');
  assert.strictEqual(srv._protoKindOf({ kind: '' }), 'desktop');
  assert.strictEqual(srv._protoKindOf({ kind: 'tablet' }), 'desktop');
  assert.strictEqual(srv._protoKindOf({ kind: 7 }), 'desktop');
  for (const kind of ['desktop', 'mobile', 'briefing', 'blank']) assert.strictEqual(srv._protoKindOf({ kind }), kind);
});

test('PROTO_KINDS and the frame of each kind', () => {
  assert.deepStrictEqual([...srv.PROTO_KINDS], ['desktop', 'mobile', 'briefing', 'blank']);
  assert.deepStrictEqual({ ...srv.PROTO_KIND_FRAME }, { desktop: 'app', mobile: 'phone', briefing: 'none', blank: 'none' });
  assert.ok(Object.isFrozen(srv.PROTO_KINDS));
});

test('_protoGenerateStarterSpec: the frame follows the kind; a call without a kind carries none (as before)', () => {
  const tsx = "export const demoStates = [{ id: 'a', label: 'A', group: 'G' }];\ncase 'a':\n";
  assert.strictEqual(srv._protoGenerateStarterSpec('X', tsx, '').frame, undefined);
  for (const [kind, frame] of Object.entries(srv.PROTO_KIND_FRAME)) {
    const spec = srv._protoGenerateStarterSpec('X', tsx, '', { kind });
    assert.strictEqual(spec.frame, frame, kind);
    assert.match(spec.summary, new RegExp('templates/prototype/starter/' + kind));
  }
});

test('_protoStageStarter copies every file of the kind except README.md, with the frame in spec.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-kinds-'));
  try {
    const out = inChild(tmp, `
      const fs = require('fs'); const path = require('path');
      const res = {};
      for (const kind of srv.PROTO_KINDS) {
        const id = 'proto-' + kind.slice(0, 4).padEnd(4, '0') + '0000b1';
        const r = srv._protoStageStarter({ id, name: 'Kind "' + kind + '"', kind });
        const dir = path.join(process.env.DATA_TIER_0_DIR, 'prototypes', id);
        res[kind] = { ok: r.ok, files: r.ok ? fs.readdirSync(dir).sort() : r.error,
          frame: r.ok ? JSON.parse(fs.readFileSync(path.join(dir, 'spec.json'), 'utf8')).frame : null,
          named: r.ok ? fs.readFileSync(path.join(dir, 'index.tsx'), 'utf8').includes(JSON.stringify('Kind "' + kind + '"')) : false,
          leftover: r.ok ? /\\{\\{[A-Z_]+\\}\\}/.test(fs.readFileSync(path.join(dir, 'index.tsx'), 'utf8')) : null };
      }
      res.bad = srv._protoStageStarter({ id: 'proto-bad000000', name: 'x', kind: 'tablet' });
      return res;
    `);
    const base = ['index.tsx', 'spec.json', 'styles.css'];
    assert.deepStrictEqual(out.desktop.files, base);
    assert.deepStrictEqual(out.mobile.files, base);
    assert.deepStrictEqual(out.blank.files, base);
    assert.deepStrictEqual(out.briefing.files, ['content.json', 'index.tsx', 'recording.json', 'spec.json', 'styles.css']);
    assert.deepStrictEqual([out.desktop.frame, out.mobile.frame, out.briefing.frame, out.blank.frame], ['app', 'phone', 'none', 'none']);
    for (const kind of ['desktop', 'mobile', 'briefing', 'blank']) {
      assert.strictEqual(out[kind].named, true, kind + ': the name goes in as a JSON literal');
      assert.strictEqual(out[kind].leftover, false, kind + ': no token left behind');
    }
    assert.strictEqual(out.bad.ok, false);
    assert.match(out.bad.error, /Unknown prototype kind/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('_protoCreateEntry: no kind -> the desktop starter and an entry WITHOUT kind; a kind -> stored; an unknown kind -> 400 invalid-kind', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-kinds-create-'));
  try {
    const out = inChild(tmp, `
      const fs = require('fs'); const path = require('path');
      const dirOf = (it) => path.join(process.env.DATA_TIER_0_DIR, 'prototypes', it.id);
      const plain = await srv._protoCreateEntry({ name: 'Plain' });
      const brief = await srv._protoCreateEntry({ name: 'Brief', kind: 'briefing' });
      const bad = await srv._protoCreateEntry({ name: 'Bad', kind: 'tablet' });
      const registry = JSON.parse(fs.readFileSync(path.join(process.env.DATA_TIER_0_DIR, 'prototypes', 'prototypes.json'), 'utf8'));
      return {
        plain: { code: plain.code, hasKind: 'kind' in plain.body.item, files: fs.readdirSync(dirOf(plain.body.item)).sort(),
          frame: JSON.parse(fs.readFileSync(path.join(dirOf(plain.body.item), 'spec.json'), 'utf8')).frame },
        brief: { code: brief.code, kind: brief.body.item.kind, files: fs.readdirSync(dirOf(brief.body.item)).sort() },
        bad: { code: bad.code, error: bad.body.error },
        registryKinds: registry.items.map((i) => (('kind' in i) ? i.kind : null)),
      };
    `);
    assert.deepStrictEqual(out.plain, { code: 200, hasKind: false, files: ['index.tsx', 'spec.json', 'styles.css'], frame: 'app' });
    assert.deepStrictEqual(out.brief, { code: 200, kind: 'briefing', files: ['content.json', 'index.tsx', 'recording.json', 'spec.json', 'styles.css'] });
    assert.deepStrictEqual(out.bad, { code: 400, error: 'invalid-kind' });
    assert.deepStrictEqual(out.registryKinds, [null, 'briefing'], 'only the chosen kind is written; the refused one left no entry');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the starter templates exist for every kind, README.md included, and PROTOTYPE_STARTER_DIR names their parent', () => {
  const parent = srv.PROTO_STARTER_DIR;
  for (const kind of srv.PROTO_KINDS) {
    for (const f of ['index.tsx', 'styles.css', 'README.md']) assert.ok(fs.existsSync(path.join(parent, kind, f)), kind + '/' + f);
  }
  assert.ok(!fs.existsSync(path.join(parent, 'index.tsx')), 'no starter sits directly in the parent any more');
});
