import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_MENU_GROUP,
  OWN_ENTRY_GROUP,
  groupRowsByMenu,
  menuGroupBodyId,
  menuGroupKey,
  menuGroupLabel,
  menuGroupState,
  renderMenuGroup,
} from '../js/module-menu-groups.mjs';
import { CORE_HUBS } from '../js/core-hubs.mjs';

const page = (hub, views = 1) => ({ sidebar: { kind: 'page', hub }, views: Array.from({ length: views }, (_, i) => ({ id: 'v' + i })) });

describe('module menu groups', () => {
  it('puts a page module in its core hub and everything else in the two fallback groups', () => {
    assert.equal(menuGroupKey(page('knowledge')), 'knowledge');
    assert.equal(menuGroupKey(page('no-such-id')), NO_MENU_GROUP, 'an unknown hub gets no menu entry, so no hub group');
    assert.equal(menuGroupKey({ sidebar: { kind: 'item' }, views: [{}] }), OWN_ENTRY_GROUP);
    assert.equal(menuGroupKey({ sidebar: { kind: 'hub' }, views: [{}, {}] }), OWN_ENTRY_GROUP);
    assert.equal(menuGroupKey({}), NO_MENU_GROUP);
    assert.equal(menuGroupKey(null), NO_MENU_GROUP);
  });

  it('labels groups in English', () => {
    assert.equal(menuGroupLabel('team'), 'Team');
    assert.equal(menuGroupLabel(OWN_ENTRY_GROUP), 'Own menu entry');
    assert.equal(menuGroupLabel(NO_MENU_GROUP), 'Outside the menu');
  });

  it('orders groups like the rail, keeps row order inside a group and drops empty groups', () => {
    const rows = [
      { id: 'a', m: page('knowledge') },
      { id: 'b', m: {} },
      { id: 'c', m: page('team') },
      { id: 'd', m: { sidebar: { kind: 'item' }, views: [{}] } },
      { id: 'e', m: page('knowledge') },
    ];
    const groups = groupRowsByMenu(rows, r => r.m);
    assert.deepEqual(groups.map(g => g.key), ['team', 'knowledge', OWN_ENTRY_GROUP, NO_MENU_GROUP]);
    assert.deepEqual(groups[1].rows.map(r => r.id), ['a', 'e']);
    const railOrder = CORE_HUBS.map(h => h.id);
    const hubKeys = groups.map(g => g.key).filter(k => railOrder.includes(k));
    assert.deepEqual(hubKeys, [...hubKeys].sort((x, y) => railOrder.indexOf(x) - railOrder.indexOf(y)));
  });

  it('starts collapsed, opens on request and opens every matching group while filtering', () => {
    assert.deepEqual(menuGroupState({ visible: 3, total: 3, filtering: false, open: false }),
      { hidden: false, expanded: false, countText: '3' });
    assert.equal(menuGroupState({ visible: 3, total: 3, filtering: false, open: true }).expanded, true);
    assert.deepEqual(menuGroupState({ visible: 1, total: 3, filtering: true, open: false }),
      { hidden: false, expanded: true, countText: '1 z 3' });
    assert.deepEqual(menuGroupState({ visible: 0, total: 3, filtering: true, open: true }),
      { hidden: true, expanded: false, countText: '0 z 3' });
  });

  it('renders a collapsed group with an accessible toggle bound to its rows tbody', () => {
    const html = renderMenuGroup({ key: 'knowledge', label: 'Knowledge', rows: [1, 2] },
      { scope: 'moduly', colspan: 6, renderRow: n => `<tr data-n="${n}"></tr>` });
    const id = menuGroupBodyId('moduly', 'knowledge');
    assert.match(html, /<button type="button" class="ds-row-toggle moduly-group-toggle" aria-expanded="false"/);
    assert.ok(html.includes(`aria-controls="${id}"`));
    assert.ok(html.includes(`<tbody class="moduly-group-body" id="${id}" data-menu-group-body="knowledge" hidden>`));
    assert.ok(html.includes('<td colspan="6">'));
    assert.equal((html.match(/<tr data-n=/g) || []).length, 2);
    assert.ok(html.includes('data-menu-group-count>2<'));
  });

  it('escapes the label and keeps ids to safe characters', () => {
    const html = renderMenuGroup({ key: '__own__', label: '<img src=x>', rows: [] },
      { scope: 'katalog', colspan: 6, renderRow: () => '' });
    assert.ok(!html.includes('<img'));
    assert.equal(menuGroupBodyId('katalog', 'a"b<c'), 'katalog-group-abc');
  });
});
