// tests/test_module_card.mjs
// Unit tests for js/module-card.mjs - the ONE renderer behind both module
// cards (Settings > Modules and its Katalog section). DOM-free, so this file
// imports the module directly.
//
// Two things are checked here. That every section really comes from the
// manifest - the invariant modules-template/README.md states - and that every
// manifest string reaching innerHTML is escaped: a manifest is a file the
// module's AUTHOR writes, and a module arrives as a zip or from the shared
// catalog, so its strings are untrusted input exactly like the view labels
// tests/test_module_host_escaping.mjs guards.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARD_URL = pathToFileURL(path.join(ROOT, 'js', 'module-card.mjs')).href;

const card = await import(CARD_URL);

const MANIFEST = {
  id: 'demo-hub',
  name: 'Demo Hub',
  version: '0.3.0',
  icon: '24-ic-reports',
  sidebar: { label: 'Demo Hub', kind: 'hub' },
  views: [
    { id: 'demo-hub-note', label: 'Note', title: 'Note in ds-data', subtitle: 'Test field' },
    { id: 'demo-hub-files', label: 'Files' },
  ],
  client: { entry: 'client/index.js', style: 'client/style.css' },
  server: { entry: 'server/index.js' },
  dataRepos: [{ name: 'ds-data-tier-0', description: 'Team data', paths: ['demo-hub/'] }],
  envKeys: ['JIRA_TOKEN'],
};

const XSS = '"><img src=x onerror=alert(1)>';
// Local HH:MM of an ISO stamp - the card formats in the viewer's zone, so an
// assertion must derive the clock the same way rather than hardcode "10:00".
function localHm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Shape ─────────────────────────────────────────────────────────────────────

test('isHubShape follows sidebar.kind alone, view count included', () => {
  assert.strictEqual(card.isHubShape(MANIFEST), true);
  // A hub that starts with ONE view is a hub - modules/time-off ships exactly
  // that shape (rail item "Support", one flyout item "Urlopy").
  assert.strictEqual(card.isHubShape({ ...MANIFEST, views: [MANIFEST.views[0]] }), true);
  assert.strictEqual(card.isHubShape({ ...MANIFEST, sidebar: { kind: 'item' } }), false);
  assert.strictEqual(card.isHubShape({ ...MANIFEST, views: [] }), false);
  assert.strictEqual(card.isHubShape({}), false);
});

// The guardrail behind the rule above: js/module-host.js must not carry a
// SECOND copy of it. It used to, kept in sync by a comment, and the manifest of
// a single-view hub was silently downgraded to a plain rail item in the sidebar
// while the card still called it a hub.
test('js/module-host.js imports the predicate instead of repeating the rule', () => {
  const host = fs.readFileSync(path.join(ROOT, 'js', 'module-host.js'), 'utf8');
  assert.match(host, /import \{ isHubShape \} from '\.\/module-card\.mjs'/);
  assert.match(host, /const isHub = isHubShape\(manifest\)/);
  assert.ok(!/kind === 'hub'/.test(host), 'the hub rule lives in module-card.mjs only');
});

test('hubPageTarget answers only for kind "page" naming a real core hub', () => {
  const page = { ...MANIFEST, sidebar: { label: 'Urlopy', kind: 'page', hub: 'support' } };
  assert.strictEqual(card.hubPageTarget(page), 'support');
  assert.strictEqual(card.hubPageTarget({ ...page, sidebar: { kind: 'page', hub: 'missing' } }), null);
  assert.strictEqual(card.hubPageTarget({ ...page, sidebar: { kind: 'page' } }), null);
  assert.strictEqual(card.hubPageTarget(MANIFEST), null, 'a hub module owns its rail entry');
  assert.strictEqual(card.hubPageTarget({}), null);
});

test('a page module is not a hub - the two shapes cannot both be true', () => {
  const page = { ...MANIFEST, sidebar: { label: 'Urlopy', kind: 'page', hub: 'support' } };
  assert.strictEqual(card.isHubShape(page), false);
});

test('shape badge names the hub a page module lands in, by its LABEL', () => {
  // "assets" is the id, "Design" is what the rail says - a card naming the id
  // would send the reader looking for a menu entry that reads differently.
  const one = { ...MANIFEST, sidebar: { kind: 'page', hub: 'assets' }, views: [MANIFEST.views[0]] };
  assert.match(card.renderShapeBadge(one), />Design \(1\)<\/span>/);
  const two = { ...MANIFEST, sidebar: { kind: 'page', hub: 'support' } };
  assert.match(card.renderShapeBadge(two), />Support \(2\)<\/span>/);
  // An unknown hub gets no menu entry from js/module-host.js, and the badge
  // says that rather than naming a shape.
  const broken = { ...MANIFEST, sidebar: { kind: 'page', hub: 'no-such-id' } };
  assert.match(card.renderShapeBadge(broken), />No menu entry<\/span>/);
  assert.match(card.renderShapeBadge(broken), /ds-badge--red/);
});

test('shape badge uses the displayed module label for owned hubs and items', () => {
  assert.match(card.renderShapeBadge(MANIFEST), />Demo Hub \(2\)<\/span>/);
  assert.match(card.renderShapeBadge({ ...MANIFEST, sidebar: { kind: 'hub', label: 'Hub Testowy' } }), />Hub Testowy \(2\)<\/span>/);
  assert.match(card.renderShapeBadge({ ...MANIFEST, sidebar: { kind: 'item', label: 'Etykieta' }, views: [1] }), />Etykieta \(1\)<\/span>/);
  assert.match(card.renderShapeBadge({ id: 'demo', sidebar: { kind: 'hub' }, views: [1] }), />demo \(1\)<\/span>/);
});

test('core hub menu badges stay concise and independent of business area', () => {
  for (const [hub, label, count] of [['initiatives', 'Initiatives', 1], ['apps', 'Apps', 5]]) {
    const html = card.renderShapeBadge({ area: 'AR', sidebar: { kind: 'page', hub }, views: Array(count).fill({}) });
    assert.ok(html.includes(`>${label} (${count})</span>`));
    assert.doesNotMatch(html, /AR|w hubie|strona|strony|widokami/);
  }
});

test('incomplete menu data is safe, while an unknown hub remains a red warning', () => {
  for (const manifest of [{}, { sidebar: { kind: 'hub' }, views: [1] }, { ...MANIFEST, views: null }]) {
    const html = card.renderShapeBadge(manifest);
    assert.match(html, /ds-badge--gray">No menu data/);
    assert.doesNotMatch(html, /undefined|NaN/);
  }
  assert.match(card.renderShapeBadge({ sidebar: { kind: 'page', hub: 'missing' }, views: [1] }),
    /ds-badge--red">No menu entry/);
  const escaped = card.renderShapeBadge({ ...MANIFEST, sidebar: { kind: 'hub', label: XSS } });
  assert.ok(escaped.includes('&lt;img'));
  assert.ok(!escaped.includes('<img'));
});

test('area badges escape names and never invent a missing area', () => {
  assert.match(card.renderAreaBadge('AR'), /ds-badge--blue">AR</);
  assert.match(card.renderAreaBadge(' '), /ds-badge--yellow">Area not set</);
  assert.match(card.renderAreaBadge(undefined), /Area not set/);
  assert.ok(card.renderAreaBadge(XSS).includes('&lt;img'));
  assert.ok(!card.renderAreaBadge(XSS).includes('<img'));
});

test('curated area wins in search and details, with manifest fallback', () => {
  const manifest = { ...MANIFEST, area: 'Product' };
  assert.equal(card.moduleArea(manifest, { area: '  AR  ' }), 'AR');
  assert.equal(card.moduleArea(manifest, { area: 42 }), 'Product');
  assert.equal(card.moduleArea({}, {}), '');
  assert.equal(card.areaFilterKey('  Łączność  Sklepów '), 'lacznosc sklepow');
  assert.ok(card.matchesSearch(card.moduleSearchText(manifest), 'product'));
  assert.ok(card.matchesSearch(card.moduleSearchText(manifest, { area: 'AR' }), 'AR'));
  assert.match(card.renderModuleDetailsBody(manifest, { area: 'AR' }), /Area: .*?>AR</);
});

test('area input validation agrees with backend boundaries and suggestions stay open', () => {
  for (const value of [undefined, '', 'a', 'a'.repeat(41), 'Cyber\tstore', 'Cyber\nstore', 'AR\u007f', '<AR>']) {
    assert.notEqual(card.areaInputError(value), '', String(value));
  }
  for (const value of [' AR ', 'Field  Operations', 'Łączność & Sklepy + AR/2.0', 'a'.repeat(40)]) {
    assert.equal(card.areaInputError(value), '', value);
  }
  const values = card.areaSuggestions(['  New  Area ', 'AR', XSS, null]);
  assert.ok(values.includes('New Area'));
  assert.ok(values.includes('Product'));
  assert.equal(values.filter(value => value === 'AR').length, 1);
  assert.ok(!values.includes(XSS));
});

// The status badge is the one section that is NOT from the manifest: it is
// per-installation state from data/modules-registry.json.
test('status badge uses DS colour modifiers that exist in css/ds.css', () => {
  assert.match(card.renderStatusBadge(true), /ds-badge--green/);
  assert.match(card.renderStatusBadge(false), /ds-badge--gray/);
});

// ── Icon ──────────────────────────────────────────────────────────────────────

test('a "module:" icon resolves inside the module only when it is installed', () => {
  const m = { ...MANIFEST, icon: 'module:ikona.svg' };
  assert.strictEqual(card.moduleIconPath(m, 'demo-hub'), '/modules/demo-hub/client/ikona.svg');
  // No module id = the catalog card, where modules/<id>/ does not exist yet.
  assert.match(card.moduleIconPath(m, null), /icons\/ds\/24-ic-folder\.svg$/);
});

test('a missing icon falls back to the DS default', () => {
  assert.match(card.moduleIconPath({}, 'demo-hub'), /24-ic-folder\.svg$/);
});

// ── Declarations ──────────────────────────────────────────────────────────────

test('declaration badges carry the repo and the env key, with the prose in the tip', () => {
  const html = card.renderDeclarationBlock(MANIFEST);
  assert.ok(html.includes('>ds-data-tier-0</span>'), 'repo name is the badge text');
  assert.ok(html.includes('>JIRA_TOKEN</span>'), 'env key name is the badge text');
  assert.ok(html.includes('title="Team data · '), 'description goes to the hover tip');
  assert.ok(html.includes('demo-hub/'), 'paths go to the hover tip');
  assert.ok(html.includes('moduly-badge-ico--repo') && html.includes('moduly-badge-ico--key'));
});

test('a read-only data repo entry says so in the badge text and the tip; a write entry is unchanged', () => {
  const read = card.renderDeclarationBlock({ dataRepos: [{ name: 'ds-data-tier-0', description: 'Team data', paths: ['team/'], access: 'read' }] });
  assert.ok(read.includes('>ds-data-tier-0 (read)</span>'), 'badge text names the read access');
  assert.ok(read.includes('title="Read only · Team data · '), 'tip is prefixed with Read only');
  const write = card.renderDeclarationBlock({ dataRepos: [{ name: 'ds-data-tier-0', description: 'Team data', paths: ['x/'], access: 'write' }] });
  assert.ok(write.includes('>ds-data-tier-0</span>') && !write.includes('(read)') && !write.includes('Read only'));
});

test('a bare-string declaration entry renders too', () => {
  const html = card.renderDeclarationBlock({ dataRepos: ['data-tier-0'], envKeys: ['A_B'] });
  assert.ok(html.includes('>data-tier-0</span>'));
  assert.ok(html.includes('>A_B</span>'));
});

test('nothing declared renders no block at all', () => {
  assert.strictEqual(card.renderDeclarationBlock({ dataRepos: [], envKeys: [] }), '');
  assert.strictEqual(card.renderDeclarationBlock({}), '');
});

// ── Capabilities ──────────────────────────────────────────────────────────────

test('capability badges follow the client and server entries', () => {
  const html = card.renderCapabilityBadges(MANIFEST, 'demo-hub');
  assert.ok(html.includes('Frontend') && html.includes('Style') && html.includes('Backend'));
  assert.ok(html.includes('/api/m/demo-hub/'), 'the backend badge names the route prefix');
  const noServer = card.renderCapabilityBadges({ client: { entry: 'client/index.js' } }, 'x');
  assert.ok(noServer.includes('Frontend'));
  assert.ok(!noServer.includes('Backend'));
  assert.ok(!noServer.includes('Style'));
});

// ── Maturity (module.json status) ─────────────────────────────────────────────
// One renderer for the installed card and the catalog card, so a module wears
// the same badge before and after the install.

test('the maturity badge maps each status to a label and a colour', () => {
  assert.match(card.renderMaturityBadge('stable'), /ds-badge--green[^>]*>stable</);
  assert.match(card.renderMaturityBadge('beta'), /ds-badge--yellow[^>]*>beta</);
  assert.match(card.renderMaturityBadge('deprecated'), /ds-badge--gray[^>]*>deprecated</);
});

test('the maturity badge claims nothing for a missing or unknown status', () => {
  assert.strictEqual(card.renderMaturityBadge(undefined), '');
  assert.strictEqual(card.renderMaturityBadge('alpha'), '');
  assert.strictEqual(card.renderMaturityBadge(XSS), '');
});

// ── Views, menu label, tags ───────────────────────────────────────────────────

test('the views block carries label, title and subtitle', () => {
  const html = card.renderViewsBlock(MANIFEST);
  assert.ok(html.includes('>Note</span>'));
  // Three separate elements, never one joined string: two adjacent inline
  // spans read as one word ("NoteNote in ds-data").
  assert.ok(html.includes('moduly-view-title">Note in ds-data<'), 'the page title is its own element');
  assert.ok(html.includes('moduly-view-meta'), 'the subtitle is its own element');
  assert.ok(html.includes('>Test field</span>'), 'the subtitle is not glued to the title');
  assert.ok(html.includes('>Files</span>'), 'a view with neither still renders');
  assert.ok(html.includes('Views (2)'), 'the heading counts the pages');
});

test('a title equal to the label is not repeated', () => {
  const html = card.renderViewsBlock({ views: [{ id: 'a-b', label: 'Lista', title: 'Lista' }] });
  assert.ok(!html.includes('moduly-view-title'));
  assert.ok(!html.includes('moduly-view-meta'));
});

test('the menu label shows only when sidebar.label differs from the name', () => {
  assert.strictEqual(card.renderMenuLabel(MANIFEST), '');
  const html = card.renderMenuLabel({ name: 'Demo Hub', sidebar: { label: 'Demo' } });
  assert.ok(html.includes('W menu: Demo'));
});

// ── renderOriginLine ─────────────────────────────────────────────────────────
// data/modules-origin.json -> GET /api/modules/installed `origin` field.
// Shared by the card meta row and the publish modal.

test('renderOriginLine: null or a missing/unknown source draws nothing', () => {
  assert.strictEqual(card.renderOriginLine(null), '');
  assert.strictEqual(card.renderOriginLine(undefined), '');
  assert.strictEqual(card.renderOriginLine({ source: 'nieznane', version: '0.1.0', at: '2026-09-05T12:00:00+02:00' }), '');
});

test('renderOriginLine: catalog, zip and publish each get their own label', () => {
  const at = '2026-09-05T12:00:00+02:00';
  assert.match(card.renderOriginLine({ source: 'catalog', version: '0.1.0', at }), /From the catalog: 0\.1\.0, 05\.09\.2026/);
  assert.match(card.renderOriginLine({ source: 'zip', version: '0.1.0', at }), /From a zip file: 0\.1\.0, 05\.09\.2026/);
  assert.match(card.renderOriginLine({ source: 'publish', version: '0.1.0', at }), /Published: 0\.1\.0, 05\.09\.2026/);
});

test('renderOriginLine: an unparsable date renders the line without a dangling comma', () => {
  const html = card.renderOriginLine({ source: 'catalog', version: '0.1.0', at: 'not-a-date' });
  assert.match(html, /From the catalog: 0\.1\.0</);
  assert.ok(!html.includes(','));
});

test('renderOriginLine escapes hostile version text', () => {
  const html = card.renderOriginLine({ source: 'catalog', version: XSS, at: '2026-09-05T12:00:00+02:00' });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes(XSS));
});

test('tags render as badges, an empty list as nothing', () => {
  assert.ok(card.renderTagBadges(['demo', 'ds-data']).includes('>demo</span>'));
  assert.strictEqual(card.renderTagBadges([]), '');
  assert.strictEqual(card.renderTagBadges(undefined), '');
});

// ── Escaping ──────────────────────────────────────────────────────────────────
// Every string below comes out of a module.json somebody else wrote.

test('a crafted manifest cannot inject markup into any section', () => {
  const hostile = {
    id: XSS,
    name: XSS,
    sidebar: { label: XSS, kind: 'hub' },
    views: [{ id: 'a-b', label: XSS, title: XSS, subtitle: XSS }, { id: 'a-c', label: 'x' }],
    client: { entry: XSS, style: XSS },
    server: { entry: XSS },
    dataRepos: [{ name: XSS, description: XSS, paths: [XSS] }],
    envKeys: [{ name: 'A_B', description: XSS }],
  };
  const html = [
    card.renderShapeBadge(hostile),
    card.renderMenuLabel({ ...hostile, name: 'inne' }),
    card.renderTagBadges([XSS]),
    card.renderViewsBlock(hostile),
    card.renderDeclarationBlock(hostile),
    card.renderCapabilityBadges(hostile, XSS),
  ].join('');
  assert.ok(!html.includes('<img'), 'no raw tag survived');
  // The quote is what would end a title="" early and start an attribute of
  // its own, so the whole payload must not appear verbatim anywhere.
  assert.ok(!html.includes(XSS), 'the payload never appears unescaped');
  assert.ok(html.includes('&lt;img'), 'the payload is present, escaped');
});

// ── Search haystack ───────────────────────────────────────────────────────────

test('moduleSearchText folds every card field into one diacritic-free haystack', () => {
  const text = card.moduleSearchText(
    { ...MANIFEST, description: 'Module for crème brûlée reports', author: 'Łukasz', tags: ['Reports'] },
    { summary: 'Résumé from the catalog', tags: ['Analytics'], author: 'Zoë' },
  );
  for (const needle of ['demo hub', 'demo-hub', 'module for creme brulee reports', 'lukasz', 'reports', 'resume from the catalog', 'analytics', 'zoe', 'note', 'files']) {
    assert.ok(text.includes(needle), `haystack misses "${needle}": ${text}`);
  }
  assert.equal(text, text.toLowerCase());
  assert.equal(card.moduleSearchText(null), '');
});

test('matchesSearch needs every word of the query, ignores case and diacritics, and passes an empty query', () => {
  const hay = card.moduleSearchText(MANIFEST, { summary: 'Résumé from the catalog' });
  assert.equal(card.matchesSearch(hay, ''), true);
  assert.equal(card.matchesSearch(hay, '   '), true);
  assert.equal(card.matchesSearch(hay, 'DEMO'), true);
  assert.equal(card.matchesSearch(hay, 'résumé catalog'), true);
  assert.equal(card.matchesSearch(hay, 'demo missing'), false);
  assert.equal(card.matchesSearch('', 'demo'), false);
});

// ── Local module repository (scripts/_module-git.js) ─────────────────────────

test('pluralZmiany follows English plural rules', () => {
  assert.equal(card.pluralZmiany(0), '0 changes');
  assert.equal(card.pluralZmiany(1), '1 change');
  assert.equal(card.pluralZmiany(2), '2 changes');
  assert.equal(card.pluralZmiany(4), '4 changes');
  assert.equal(card.pluralZmiany(5), '5 changes');
  assert.equal(card.pluralZmiany(12), '12 changes');
  assert.equal(card.pluralZmiany(14), '14 changes');
  assert.equal(card.pluralZmiany(22), '22 changes');
});

test('formatGitDate renders DD.MM.YYYY and blanks an unparsable value', () => {
  assert.equal(card.formatGitDate('2026-09-06T10:00:00+02:00'), '06.09.2026');
  assert.equal(card.formatGitDate(''), '');
  assert.equal(card.formatGitDate(null), '');
  assert.equal(card.formatGitDate('not-a-date'), '');
});

test('formatGitDateTime appends the local HH:MM so two versions on one day stay apart', () => {
  const iso = '2026-09-06T10:00:00+02:00';
  assert.equal(card.formatGitDateTime(iso), `06.09.2026 ${localHm(iso)}`);
  assert.match(card.formatGitDateTime('2026-09-06T00:05:00Z'), /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
  assert.equal(card.formatGitDateTime(''), '');
  assert.equal(card.formatGitDateTime('not-a-date'), '');
});

test('renderGitRow: gitAvailable false renders one badge and nothing else', () => {
  const html = card.renderGitRow('demo-hub', { present: false }, false);
  assert.match(html, /ds-badge/);
  assert.match(html, /Git unavailable/);
  assert.ok(!html.includes('ds-btn'), 'no action button when git itself is unavailable');
});

test('renderGitRow: no .git yet offers "Initialize repository" carrying the id', () => {
  const html = card.renderGitRow('demo-hub', { present: false }, true);
  assert.match(html, /ds-btn ds-btn--secondary ds-btn--sm/);
  assert.match(html, /data-moduly-git-init="demo-hub"/);
  assert.match(html, /Initialize repository/);
});

test('renderGitRow: a git failure renders the error badge with the message in the tip', () => {
  const html = card.renderGitRow('demo-hub', { present: true, error: 'fatal: not a repository' }, true);
  assert.match(html, /ds-badge--red/);
  assert.match(html, /Repository read error/);
  assert.match(html, /title="fatal: not a repository"/);
});

test('renderGitRow: dirty with an unborn branch (fresh init, no commit yet) offers "Save version"', () => {
  const html = card.renderGitRow('time-off', {
    present: true, branch: 'main', dirty: true, changedFiles: 7, lastCommit: null,
  }, true);
  assert.match(html, /ds-badge--gray">main</);
  assert.match(html, /7 changes/);
  assert.match(html, /no saved versions/);
  assert.match(html, /ds-btn ds-btn--secondary ds-btn--sm/);
  assert.match(html, /data-moduly-git-commit="time-off"/);
});

test('renderGitRow: clean with a commit shows the date and subject, no button', () => {
  const html = card.renderGitRow('demo-hub', {
    present: true,
    branch: 'main',
    dirty: false,
    changedFiles: 0,
    lastCommit: { sha7: 'abc1234', date: '2026-09-06T10:00:00+02:00', subject: 'initial state (scaffold)' },
  }, true);
  assert.match(html, /no changes/);
  assert.ok(html.includes(`last save 06.09.2026 ${localHm('2026-09-06T10:00:00+02:00')} · initial state (scaffold)`), html);
  assert.ok(!html.includes('data-moduly-git-commit'), 'a clean repo offers no commit button');
});

test('renderGitRow escapes a hostile branch name and commit subject', () => {
  const html = card.renderGitRow(XSS, {
    present: true, branch: XSS, dirty: false, changedFiles: 0,
    lastCommit: { sha7: 'abc1234', date: '2026-09-06T10:00:00+02:00', subject: XSS },
  }, true);
  assert.ok(!html.includes('<img'), 'no raw tag survived');
  assert.ok(!html.includes(XSS), 'the payload never appears unescaped');
});

// -- "Historia": the earlier-commits list under the last-commit line --------

test('renderGitRow: a commit adds the "History" toggle carrying the id and the sha7, plus a hidden list container', () => {
  const html = card.renderGitRow('demo-hub', {
    present: true, branch: 'main', dirty: false, changedFiles: 0,
    lastCommit: { sha7: 'abc1234', date: '2026-09-06T10:00:00+02:00', subject: 'initial state' },
  }, true);
  assert.match(html, /data-moduly-git-log="demo-hub"/);
  assert.match(html, /data-moduly-git-last-sha="abc1234"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />History</);
  assert.match(html, /data-moduly-git-history="demo-hub" hidden/);
  assert.match(html, /class="moduly-card-git-last-text"/, 'the text sits in its own span so it can ellipsize inside the flex row');
});

test('renderGitRow: no toggle without a commit to list (unborn branch, no repo, git unavailable, error)', () => {
  const unborn = card.renderGitRow('time-off', { present: true, branch: 'main', dirty: true, changedFiles: 7, lastCommit: null }, true);
  const none = card.renderGitRow('time-off', { present: false }, true);
  const noGit = card.renderGitRow('time-off', { present: false }, false);
  const err = card.renderGitRow('time-off', { present: true, error: 'fatal' }, true);
  for (const html of [unborn, none, noGit, err]) {
    assert.ok(!html.includes('data-moduly-git-log'), 'no toggle');
    assert.ok(!html.includes('data-moduly-git-history'), 'no container');
  }
});

test('renderGitHistory lists the earlier commits in the "DD.MM.YYYY HH:MM · subject" form and skips the one the card already shows', () => {
  const html = card.renderGitHistory([
    { sha7: 'ccc3333', date: '2026-09-07T12:00:00+02:00', subject: 'rename the module' },
    { sha7: 'bbb2222', date: '2026-09-06T10:00:00+02:00', subject: 'dodaje notatke' },
    { sha7: 'aaa1111', date: '2026-09-05T09:30:00+02:00', subject: 'initial state' },
  ], { skipSha7: 'ccc3333' });
  assert.match(html, /<ul class="moduly-card-git-history-list">/);
  assert.ok(!html.includes('rename the module'), 'the last commit is the line above, not a list entry');
  const t2 = `06.09.2026 ${localHm('2026-09-06T10:00:00+02:00')} · dodaje notatke`;
  const t1 = `05.09.2026 ${localHm('2026-09-05T09:30:00+02:00')} · initial state`;
  assert.ok(html.includes(`<li title="${t2}">${t2}</li>`), html);
  assert.ok(html.includes(`<li title="${t1}">${t1}</li>`), html);
  assert.ok(html.indexOf('06.09.2026') < html.indexOf('05.09.2026'), 'newest first, the order git gave');
});

test('renderGitHistory: only the shown commit, an empty list or garbage answers the empty state', () => {
  const only = card.renderGitHistory([{ sha7: 'abc1234', date: '2026-09-06T10:00:00+02:00', subject: 'x' }], { skipSha7: 'abc1234' });
  assert.match(only, /No earlier versions/);
  assert.match(card.renderGitHistory([]), /No earlier versions/);
  assert.match(card.renderGitHistory(null), /No earlier versions/);
  assert.match(card.renderGitHistory([null, 42]), /No earlier versions/);
});

test('renderGitHistory without skipSha7 lists everything and an unparsable date still keeps the subject', () => {
  const html = card.renderGitHistory([{ sha7: 'a', date: 'not-a-date', subject: 'no date' }]);
  assert.match(html, /<li title="no date">no date<\/li>/);
});

test('renderGitHistory and renderGitHistoryError escape hostile text', () => {
  const list = card.renderGitHistory([{ sha7: 'a', date: '2026-09-06T10:00:00+02:00', subject: XSS }]);
  assert.ok(!list.includes('<img'), 'no raw tag survived in the list');
  assert.ok(!list.includes(XSS));
  const err = card.renderGitHistoryError(XSS);
  assert.ok(!err.includes('<img'), 'no raw tag survived in the error');
  assert.match(err, /Could not load the history/);
  assert.match(card.renderGitHistoryError(''), /title="Unknown error"/);
});

// ── Table row and details modal ──────────────────────────────────────────────

test('the name cell carries the icon, the name and the id', () => {
  const html = card.renderModuleNameCell(MANIFEST, { id: 'demo-hub', iconModuleId: 'demo-hub' });
  assert.match(html, /moduly-row-icon/);
  assert.match(html, /24-ic-reports\.svg/, 'the manifest icon, resolved by the shared resolver');
  assert.match(html, /Demo Hub/);
  assert.match(html, /demo-hub<\/code>/);
});

test('a catalog name cell falls back to the DS icon - the module is not on disk', () => {
  const own = { ...MANIFEST, icon: 'module:icon.svg' };
  assert.match(card.renderModuleNameCell(own, { id: 'demo-hub', iconModuleId: 'demo-hub' }),
    /\/modules\/demo-hub\/client\/icon\.svg/);
  const html = card.renderModuleNameCell(own, { id: 'demo-hub', iconModuleId: null });
  assert.match(html, /icons\/ds\//);
  assert.ok(!html.includes('/modules/demo-hub/'), 'never links into a directory that does not exist');
});

test('the details button carries the id under the attribute its list delegates on', () => {
  assert.match(card.renderDetailsButton('demo-hub', 'moduly-details'), /data-moduly-details="demo-hub"/);
  assert.match(card.renderDetailsButton('demo-hub', 'katalog-details'), /data-katalog-details="demo-hub"/);
  assert.match(card.renderDetailsButton('demo-hub', 'moduly-details'), /data-tip="Details"/);
});

test('the details body carries every section the row leaves out', () => {
  const html = card.renderModuleDetailsBody(MANIFEST, {
    id: 'demo-hub',
    iconModuleId: 'demo-hub',
    description: 'Test module',
    author: 'Team DS',
  });
  assert.match(html, /Test module/, 'description');
  assert.match(html, /Author: Team DS/, 'author');
  assert.match(html, /Version 0\.3\.0/, 'version');
  assert.match(html, /Frontend/, 'capabilities');
  assert.match(html, /Views \(2\)/, 'views');
  assert.match(html, /ds-data-tier-0/, 'declarations');
});

test('the details body has no git block unless the caller passes one', () => {
  const without = card.renderModuleDetailsBody(MANIFEST, { id: 'demo-hub' });
  assert.ok(!without.includes('moduly-card-git'), 'a catalog entry has no local repository');
  const withGit = card.renderModuleDetailsBody(MANIFEST, {
    id: 'demo-hub',
    git: { present: false },
    gitAvailable: true,
  });
  assert.match(withGit, /data-moduly-git-init="demo-hub"/,
    'the git buttons keep the attributes js/settings-moduly.js delegates on');
});

test('curated catalog fields win over the manifest, and a missing one falls back to it', () => {
  const html = card.renderModuleDetailsBody(MANIFEST, {
    id: 'demo-hub',
    description: 'Opis z katalogu',
    tags: ['kurowany'],
  });
  assert.match(html, /Opis z katalogu/);
  assert.match(html, /kurowany/);
  const fallback = card.renderModuleDetailsBody(
    { ...MANIFEST, description: 'Opis z manifestu', author: 'Autor z manifestu' }, { id: 'demo-hub' },
  );
  assert.match(fallback, /Opis z manifestu/);
  assert.match(fallback, /Autor z manifestu/);
});

test('a crafted manifest cannot inject markup into the row cell or the details modal', () => {
  const hostile = {
    ...MANIFEST,
    id: XSS,
    name: XSS,
    version: XSS,
    description: XSS,
    author: XSS,
  };
  for (const html of [
    card.renderModuleNameCell(hostile, { id: XSS, iconModuleId: null }),
    card.renderModuleDetailsBody(hostile, { id: XSS, description: XSS, author: XSS, tags: [XSS] }),
    card.renderDetailsButton(XSS, 'moduly-details'),
  ]) {
    assert.ok(!html.includes('<img src=x'), 'raw markup reached the output');
    assert.ok(html.includes('&lt;img src=x'), 'the payload is escaped, not dropped');
  }
});

