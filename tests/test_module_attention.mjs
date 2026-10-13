import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { moduleAttention, nextPatchVersion } from '../js/module-attention.mjs';

const inst = (id, version, name = id) => ({ id, manifest: { id, name, version } });
const cat = (id, version) => ({ id, manifest: { id, version } });

describe('module attention lists', () => {
  it('classifies nothing when the catalog could not be read', () => {
    assert.deepEqual(moduleAttention([inst('a', '1.0.0')], null), { catalogKnown: false, publish: [], update: [] });
  });

  it('puts unpublished and locally-ahead modules on the publish list and newer catalog versions on the update list', () => {
    const installed = [inst('local-only', '0.1.0', 'Yearbook'), inst('ahead-mod', '0.2.1', 'Workspace'), inst('behind-mod', '0.1.0', 'On-call'), inst('equal-mod', '0.3.0')];
    const entries = [cat('ahead-mod', '0.1.1'), cat('behind-mod', '0.2.0'), cat('equal-mod', '0.3.0'), cat('catalog-only', '1.0.0')];
    const att = moduleAttention(installed, entries);
    assert.equal(att.catalogKnown, true);
    assert.deepEqual(att.publish.map(r => [r.id, r.reason, r.catalogVersion, r.mrUrl]),
      [['ahead-mod', 'ahead', '0.1.1', null], ['local-only', 'local', null, null]]);
    assert.deepEqual(att.update.map(r => [r.id, r.localVersion, r.catalogVersion]), [['behind-mod', '0.1.0', '0.2.0']]);
  });

  it('waits on an open merge request only while it carries the local version', () => {
    const installed = [inst('a', '0.2.0'), inst('b', '0.2.1'), inst('c', '0.3.0')];
    const entries = [cat('a', '0.1.0'), cat('b', '0.1.0'), cat('c', '0.1.0')];
    const pending = [
      { id: 'a', mrUrl: 'https://g/mr/1', version: '0.2.0' },
      { id: 'b', mrUrl: 'https://g/mr/2', version: '0.2.0' },
      { id: 'c', mrUrl: 'https://g/mr/3', version: null },
      { id: 'other', mrUrl: 'x' },
    ];
    const rows = Object.fromEntries(moduleAttention(installed, entries, pending).publish.map(r => [r.id, r]));
    assert.deepEqual([rows.a.waiting, rows.a.mrUrl], [true, 'https://g/mr/1']);
    assert.deepEqual([rows.b.waiting, rows.b.mrVersion], [false, '0.2.0'], 'bumped past its MR: publish again');
    assert.equal(rows.c.waiting, true, 'an unreadable MR version still counts as waiting');
  });

  it('never proposes anything for an unparsable version and skips malformed rows', () => {
    const att = moduleAttention([inst('a', 'abc'), null, { manifest: {} }], [cat('a', '0.1.0'), null]);
    assert.deepEqual(att, { catalogKnown: true, publish: [], update: [] });
  });

  it('lists a module with changed files at the catalog version, with the bump it needs', () => {
    const drift = [{ id: 'a', changed: 2, added: 0, removed: 0 }, { id: 'nowszy', changed: 1 }];
    const att = moduleAttention([inst('a', '0.1.9'), inst('b', '0.1.0'), inst('nowszy', '0.3.0')],
      [cat('a', '0.1.9'), cat('b', '0.1.0'), cat('nowszy', '0.2.0')], [], drift);
    assert.deepEqual(att.publish.map(r => [r.id, r.reason, r.nextVersion]),
      [['a', 'same-version', '0.1.10'], ['nowszy', 'ahead', undefined]]);
    assert.equal(att.publish[0].drift.changed, 2);
  });

  it('offers a patch bump only for plain X.Y.Z versions', () => {
    assert.equal(nextPatchVersion('1.2.3'), '1.2.4');
    assert.equal(nextPatchVersion('0.0.9'), '0.0.10');
    assert.equal(nextPatchVersion('v1.2.3'), 'v1.2.4', 'a leading v is kept, as compareSemver accepts it');
    for (const v of ['1.2', '1.2.3-beta', '', null, undefined, 7]) assert.equal(nextPatchVersion(v), null);
  });
});
