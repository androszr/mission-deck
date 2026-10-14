import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(SRC).filter((f) => /\.(ts|tsx|css)$/.test(f) && !f.endsWith('policy.test.ts'));

describe('source policy', () => {
  it('has no hex colour outside the tokens files', () => {
    for (const f of files.filter((x) => !/ds-tokens[^/]*\.css$/.test(x))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
  it('is ASCII', () => {
    for (const f of files) {
      const bad = [...readFileSync(f, 'utf8')].filter((c) => c.charCodeAt(0) > 127);
      expect(bad, f).toEqual([]);
    }
  });
});
