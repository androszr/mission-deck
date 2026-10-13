// tests/test_api_ports_unique.mjs
// Each api test spawns its own server on a literal port. Two files on the same
// port collide when the previous server is still closing, and the second one's
// waitForServer answers on the WRONG server - a 20 s timeout that looks like a
// broken feature (2026-10-08: test_api_prototypes_jobs.js took 3563 from
// test_api_prototypes.js, test_api_figma_reference.js took 3571 from
// test_api_modules_catalog.js). This pins every literal `const PORT* = <n>`.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = path.dirname(fileURLToPath(import.meta.url));

test('every api test server port is used by exactly one declaration', () => {
  const owners = new Map();
  for (const name of fs.readdirSync(TESTS).filter((n) => /^test_api_.*\.js$/.test(n)).sort()) {
    const src = fs.readFileSync(path.join(TESTS, name), 'utf8');
    for (const m of src.matchAll(/^const (PORT\w*)\s*=\s*(\d{4,5})\s*;/gm)) {
      const list = owners.get(m[2]) || [];
      list.push(`${name}:${m[1]}`);
      owners.set(m[2], list);
    }
  }
  assert.ok(owners.size > 20, 'the scan must actually find the api test ports');
  const dupes = [...owners].filter(([, list]) => list.length > 1).map(([port, list]) => `${port}: ${list.join(', ')}`);
  assert.deepStrictEqual(dupes, [], `pick a free port for:\n${dupes.join('\n')}`);
});
