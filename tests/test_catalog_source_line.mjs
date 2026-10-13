// tests/test_catalog_source_line.mjs
// Settings > Modules > Catalog says where the catalog comes from: the local
// folder (the default) or an opt-in GitLab repository. The line is built by
// catalogSourceLine() from the `catalogSource` field of GET /api/modules/catalog.

import test from 'node:test';
import assert from 'node:assert';
import { catalogSourceLine } from '../js/settings-moduly-katalog.js';

test('a local catalog names its folder and says publishing writes into it', () => {
  const html = catalogSourceLine({ catalogSource: { mode: 'local', location: 'catalog/' } });
  assert.match(html, /data-katalog-source="local"/);
  assert.match(html, /local folder <code>catalog\/<\/code>/);
  assert.match(html, /Publish writes into it/);
});

test('a GitLab catalog names the repository and the merge request', () => {
  const html = catalogSourceLine({ catalogSource: { mode: 'gitlab', location: 'https://gitlab.example.com/team/catalog.git' } });
  assert.match(html, /data-katalog-source="gitlab"/);
  assert.match(html, /GitLab repository <code>https:\/\/gitlab\.example\.com\/team\/catalog\.git<\/code>/);
  assert.match(html, /merge request/);
});

test('the location is escaped and a missing source paints nothing', () => {
  const html = catalogSourceLine({ catalogSource: { mode: 'local', location: '<img src=x>/' } });
  assert.ok(!html.includes('<img'), html);
  assert.strictEqual(catalogSourceLine({}), '');
  assert.strictEqual(catalogSourceLine(null), '');
  assert.strictEqual(catalogSourceLine({ catalogSource: { mode: 'local' } }), '');
});
