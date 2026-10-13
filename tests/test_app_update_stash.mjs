// tests/test_app_update_stash.mjs
// Pure helpers behind the two-step "stash and update" path
// (js/app-update-stash.mjs): the decisions AND the callout markup both the
// System tab and the wizard's step 6 paint. Real ESM import, no server, no
// document - the builders return HTML strings. The wiring in js/settings.js and
// js/onboarding-wizard.js is deliberately untested, like the rest of those files.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  DIRTY_TREE_LIST_LIMIT,
  STASH_NOTE_KEY,
  STASH_UPDATE_BTN_SELECTOR,
  STASH_NOTE_DISMISS_SELECTOR,
  pluralFiles,
  canOfferStash,
  dirtyTreeRows,
  stashNoteFromResponse,
  parseStashNote,
  stashNoteSentences,
  unstashableAdvice,
  dirtyTreeCalloutHtml,
  stashNoteHtml,
  stashConfirmText,
} from '../js/app-update-stash.mjs';
import { mapAppUpdateError, mapCheckUpdateError } from '../js/app-update-errors.js';

// ── constants ────────────────────────────────────────────────────────────────

test('STASH_NOTE_KEY: the one localStorage key both surfaces read and the dismiss removes', () => {
  assert.strictEqual(STASH_NOTE_KEY, 'cockpit.updateStashNote');
  // ASCII, dotted like the other cockpit.* keys (js/theme-boot.js, js/update-banner.js).
  assert.match(STASH_NOTE_KEY, /^cockpit\.[A-Za-z]+$/);
});

test('button selectors are data attributes, so two hosts can carry the same callout', () => {
  assert.strictEqual(STASH_UPDATE_BTN_SELECTOR, '[data-stash-update]');
  assert.strictEqual(STASH_NOTE_DISMISS_SELECTOR, '[data-stash-note-dismiss]');
});

// ── pluralFiles ──────────────────────────────────────────────────────────────

test('pluralFiles: English plural forms', () => {
  assert.strictEqual(pluralFiles(0), '0 files');
  assert.strictEqual(pluralFiles(1), '1 file');
  assert.strictEqual(pluralFiles(2), '2 files');
  assert.strictEqual(pluralFiles(5), '5 files');
  assert.strictEqual(pluralFiles(112), '112 files');
  assert.strictEqual(pluralFiles(undefined), '0 files');
});

// ── canOfferStash ────────────────────────────────────────────────────────────

const dirty = (over) => ({
  ok: false,
  error: 'dirty-tree',
  changed: 2,
  files: ['a.js', 'b.js'],
  stashable: ['a.js', 'b.js'],
  unstashable: [],
  canStash: true,
  message: 'x',
  ...over,
});

test('canOfferStash: true only for dirty-tree with canStash and nothing unstashable', () => {
  assert.strictEqual(canOfferStash(dirty()), true);
  assert.strictEqual(canOfferStash(dirty({ canStash: false })), false);
  assert.strictEqual(canOfferStash(dirty({ canStash: 'true' })), false, 'only the literal true');
  assert.strictEqual(canOfferStash(dirty({ unstashable: ['"x y.txt"'] })), false, 'a quoted path left over refuses');
  assert.strictEqual(canOfferStash(dirty({ stashable: [] })), false, 'nothing to stash refuses');
  assert.strictEqual(canOfferStash(dirty({ error: 'stash-failed' })), false);
  assert.strictEqual(canOfferStash(null), false);
  assert.strictEqual(canOfferStash({}), false);
});

// ── dirtyTreeRows ────────────────────────────────────────────────────────────

test('dirtyTreeRows: unstashable paths first, marked, server order kept within groups', () => {
  const body = dirty({
    files: ['a.js', 'junk.txt', 'b.js', 'other.txt'],
    stashable: ['a.js', 'b.js'],
    unstashable: ['junk.txt', 'other.txt'],
    canStash: false,
  });
  const r = dirtyTreeRows(body);
  assert.deepStrictEqual(r.rows.map((x) => x.path), ['junk.txt', 'other.txt', 'a.js', 'b.js']);
  assert.deepStrictEqual(r.rows.map((x) => x.unstashable), [true, true, false, false]);
  assert.strictEqual(r.hidden, 0);
  assert.strictEqual(r.total, 4);
  assert.strictEqual(r.unstashableCount, 2);
});

test('dirtyTreeRows: long list is cut at the limit and the remainder counted', () => {
  const files = Array.from({ length: 30 }, (_, i) => `f${i}.js`);
  const r = dirtyTreeRows(dirty({ files, stashable: files, changed: 30 }));
  assert.strictEqual(r.rows.length, DIRTY_TREE_LIST_LIMIT);
  assert.strictEqual(r.hidden, 30 - DIRTY_TREE_LIST_LIMIT);
  assert.strictEqual(r.total, 30);
  assert.strictEqual(r.rows[0].path, 'f0.js');
});

test('dirtyTreeRows: an unstashable path stays visible even when the list is cut', () => {
  const files = Array.from({ length: 30 }, (_, i) => `f${i}.js`);
  files.push('untracked.bin');
  const r = dirtyTreeRows(dirty({ files, stashable: files.slice(0, 30), unstashable: ['untracked.bin'], canStash: false }), 3);
  assert.strictEqual(r.rows.length, 3);
  assert.strictEqual(r.rows[0].path, 'untracked.bin');
  assert.strictEqual(r.rows[0].unstashable, true);
  assert.strictEqual(r.hidden, 28);
});

test('dirtyTreeRows: tolerates a malformed payload', () => {
  assert.deepStrictEqual(dirtyTreeRows(null), { rows: [], hidden: 0, total: 0, unstashableCount: 0 });
  assert.deepStrictEqual(dirtyTreeRows({ files: 'nope' }), { rows: [], hidden: 0, total: 0, unstashableCount: 0 });
  const r = dirtyTreeRows({ files: ['a', '', null, 'b'] });
  assert.deepStrictEqual(r.rows.map((x) => x.path), ['a', 'b']);
});

// ── stashNoteFromResponse / parseStashNote ───────────────────────────────────

test('stashNoteFromResponse: null when the call stashed nothing', () => {
  assert.strictEqual(stashNoteFromResponse({ ok: true, stashed: null }), null);
  assert.strictEqual(stashNoteFromResponse({ ok: true }), null);
  assert.strictEqual(stashNoteFromResponse(null), null);
});

test('stashNoteFromResponse: carries ref, message and the file COUNT, never the paths', () => {
  const note = stashNoteFromResponse({
    ok: true, restarting: true, installing: false,
    stashed: { ref: 'stash@{0}', message: 'cockpit-update 2026-09-10T08:00:00.000Z v1.2.3', files: ['a.js', 'b.js', 'c.js'] },
  }, '2026-09-10T08:00:01.000Z');
  assert.deepStrictEqual(note, {
    ref: 'stash@{0}',
    message: 'cockpit-update 2026-09-10T08:00:00.000Z v1.2.3',
    count: 3,
    at: '2026-09-10T08:00:01.000Z',
  });
  assert.strictEqual('files' in note, false);
});

test('parseStashNote: round-trips a stored note and rejects garbage', () => {
  const note = stashNoteFromResponse({ stashed: { ref: 'stash@{0}', message: 'm', files: ['x'] } }, 't');
  assert.deepStrictEqual(parseStashNote(JSON.stringify(note)), note);
  assert.strictEqual(parseStashNote(null), null);
  assert.strictEqual(parseStashNote(''), null);
  assert.strictEqual(parseStashNote('{not json'), null);
  assert.strictEqual(parseStashNote('[]'), null);
  assert.strictEqual(parseStashNote(JSON.stringify({ ref: '', count: 1 })), null);
  assert.strictEqual(parseStashNote(JSON.stringify({ ref: 'stash@{0}', count: 'abc' })), null);
  assert.strictEqual(parseStashNote(JSON.stringify({ ref: 'stash@{0}', count: -1 })), null);
});

// ── stashNoteSentences ───────────────────────────────────────────────────────

test('stashNoteSentences: names the ref, the count, no pop, the reset caveat, the generated edits and git stash list', () => {
  const s = stashNoteSentences({ ref: 'stash@{0}', count: 3 });
  assert.strictEqual(s.length, 5);
  assert.match(s[0], /3 files/);
  assert.match(s[0], /stash@\{0\}/);
  assert.match(s[1], /never runs git stash pop/);
  assert.match(s[2], /reset --hard/);
  assert.match(s[2], /conflict/);
  assert.match(s[3], /model:/);
  assert.match(s[3], /GitNexus/);
  // The note is per-browser state; the reliable trace is git itself.
  assert.match(s[4], /git stash list/);
  assert.match(s[4], /browser/);
  assert.match(s[4], /convenience/);
});

test('stashNoteSentences: tolerates a missing note and a custom ref', () => {
  const s = stashNoteSentences(null);
  assert.match(s[0], /0 files/);
  assert.match(s[0], /stash@\{0\}/);
  const t = stashNoteSentences({ ref: 'stash@{2}', count: 1 });
  assert.match(t[0], /1 file\) are on the stash as stash@\{2\}/);
  assert.match(t[1], /git stash show -p stash@\{2\}/);
});

// ── unstashableAdvice ────────────────────────────────────────────────────────

test('unstashableAdvice: says what to DO, not only what is blocked', () => {
  const a = unstashableAdvice(2);
  assert.strictEqual(a.length, 3);
  assert.match(a[0], /2 files/);
  assert.match(a[0], /not stashable/);
  assert.match(a[0], /quote/);
  // The two ways out plus the one that keeps the file.
  assert.match(a[1], /rename/i);
  assert.match(a[1], /move it/);
  assert.match(a[1], /git add/);
  // And what happens once it is done: the button appears.
  assert.match(a[2], /try again/);
  assert.match(a[2], /button/);
  assert.match(unstashableAdvice(1)[0], /1 file on the list/);
});

// ── dirtyTreeCalloutHtml ─────────────────────────────────────────────────────

test('dirtyTreeCalloutHtml: stashable tree - headline, every path, the button, no advice', () => {
  const html = dirtyTreeCalloutHtml(dirty(), 'Update error: x');
  assert.ok(html.startsWith('<div class="upd-dirty">'));
  assert.match(html, /<p class="upd-dirty__headline">Update error: x<\/p>/);
  assert.match(html, /<code>a\.js<\/code>/);
  assert.match(html, /<code>b\.js<\/code>/);
  assert.match(html, /<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-stash-update>Stash changes and update<\/button>/);
  assert.match(html, /git stash pop/);
  assert.ok(!html.includes('not stashable'));
  assert.ok(!html.includes('upd-dirty__why'));
});

test('dirtyTreeCalloutHtml: unstashable tree - blocked paths first and badged, advice, NO button', () => {
  const body = dirty({
    files: ['a.js', 'junk.txt'],
    stashable: ['a.js'],
    unstashable: ['junk.txt'],
    canStash: false,
  });
  const html = dirtyTreeCalloutHtml(body, 'h');
  assert.ok(!html.includes('data-stash-update'));
  assert.ok(html.indexOf('junk.txt') < html.indexOf('a.js'), 'unstashable first');
  assert.match(html, /upd-dirty__file--blocked"><code>junk\.txt<\/code> <span class="ds-badge ds-badge--yellow ds-badge--sm">not stashable<\/span>/);
  const why = html.match(/<p class="upd-dirty__why">/g) || [];
  assert.strictEqual(why.length, 3, 'all three advice sentences');
  assert.match(html, /git add &lt;file&gt;/, 'the advice is escaped too');
});

test('dirtyTreeCalloutHtml: escapes paths and the headline, counts the hidden rest', () => {
  const files = Array.from({ length: 12 }, (_, i) => `f${i}.js`);
  files[0] = '<img src=x onerror=alert(1)>.js';
  const html = dirtyTreeCalloutHtml(dirty({ files, stashable: files, changed: 12 }), '<b>h</b>');
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;\.js/);
  assert.match(html, /upd-dirty__headline">&lt;b&gt;h&lt;\/b&gt;</);
  assert.match(html, /… and 4 files more/);
});

test('dirtyTreeCalloutHtml: a payload with no files still paints the headline alone', () => {
  const html = dirtyTreeCalloutHtml({ error: 'dirty-tree' }, 'h');
  assert.ok(!html.includes('<ul'));
  assert.ok(!html.includes('data-stash-update'));
  assert.match(html, /upd-dirty__headline">h</);
});

// ── stashNoteHtml ────────────────────────────────────────────────────────────

test('stashNoteHtml: headline, the sentences, the stash entry, trailing line and dismiss on request', () => {
  const note = { ref: 'stash@{0}', message: 'cockpit-update <t> v1', count: 2, at: 'x' };
  const plain = stashNoteHtml('Updated.', note);
  assert.match(plain, /upd-dirty__headline">Updated\.</);
  assert.strictEqual((plain.match(/upd-dirty__line/g) || []).length, stashNoteSentences(note).length + 1, 'sentences plus the entry line');
  assert.match(plain, /Stash entry: <code>cockpit-update &lt;t&gt; v1<\/code>/);
  assert.ok(!plain.includes('data-stash-note-dismiss'));

  const full = stashNoteHtml('h', note, { trailing: 'Stays <here>.', dismiss: true });
  assert.match(full, /Stays &lt;here&gt;\./);
  assert.match(full, /<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-stash-note-dismiss>Got it, hide<\/button>/);

  const noMsg = stashNoteHtml('h', { ref: 'stash@{0}', message: '', count: 0, at: '' });
  assert.ok(!noMsg.includes('Stash entry'));
});

// ── mapAppUpdateError: the four callers ─────────────────────────────────────

test('mapAppUpdateError: dirty-tree points at the two surfaces with the button unless the caller IS one', () => {
  const body = dirty({ message: 'The working tree has uncommitted changes (2): a.js, b.js.' });
  const banner = mapAppUpdateError(body, 200);
  assert.strictEqual(typeof banner, 'string');
  assert.ok(banner.startsWith('Update error: The working tree has uncommitted changes (2): a.js, b.js.'));
  assert.match(banner, /Settings > System/);

  const here = mapAppUpdateError(body, 200, { stashActionHere: true });
  assert.strictEqual(here, 'Update error: The working tree has uncommitted changes (2): a.js, b.js.');
  assert.ok(!here.includes('Settings > System'));

  // Only the literal true opts out.
  assert.match(mapAppUpdateError(body, 200, { stashActionHere: 'true' }), /Settings > System/);
  // No server message: the fallback sentence still gets the pointer.
  assert.match(mapAppUpdateError({ error: 'dirty-tree' }, 200), /uncommitted changes\. You can stash them and update from the update window or from Settings > System\./);
});

test('mapAppUpdateError: the option changes nothing for other codes', () => {
  assert.strictEqual(mapAppUpdateError({ error: 'stash-failed' }, 200, { stashActionHere: true }),
    mapAppUpdateError({ error: 'stash-failed' }, 200));
  assert.strictEqual(mapAppUpdateError({ error: 'network' }, 200, { stashActionHere: true }), 'Update error: Network error - turn on the VPN and check the connection to GitLab.');
  assert.strictEqual(mapAppUpdateError(null, 500), 'Update error: 500');
});

// A missing VPN is the most common cause of all four, and two of them ('network'
// and 'timeout' aside) read as a token problem: GitLab answers 401/404 for a
// repository this caller may not see, so the message must name the VPN before
// the token. Pinned on BOTH entry points, because the check-update path reads
// COMMON_MAP directly and never goes through mapAppUpdateError.
test('update errors: every code a missing VPN can produce names the VPN', () => {
  for (const code of ['network', 'timeout', 'auth-expired', 'no-access']) {
    assert.match(mapAppUpdateError({ error: code }, 200), /VPN/, code);
    assert.match(mapCheckUpdateError({ error: code }), /VPN/, code);
  }
  // The ambiguous pair keeps the token remedy as the SECOND thing to try: the
  // sentence may open with the symptom, but the VPN is named before the person
  // is sent after a token that is probably fine.
  for (const code of ['auth-expired', 'no-access']) {
    const text = mapCheckUpdateError({ error: code });
    const remedy = text.search(/(renew|check) the token/);
    assert.ok(remedy > -1, code + ': keeps the token remedy');
    assert.ok(text.indexOf('VPN') < remedy, code + ': VPN before the token remedy');
  }
  // A locked safe is not a VPN story - the vault half must not send people there.
  assert.doesNotMatch(mapCheckUpdateError({ error: 'no-token' }), /VPN/);
});

// ── stashConfirmText ─────────────────────────────────────────────────────────

test('stashConfirmText: one question for all four surfaces - count, first paths, no pop', () => {
  const files = Array.from({ length: 9 }, (_v, i) => `f${i}.js`);
  const t = stashConfirmText(dirty({ files }));
  assert.match(t, /^Stash 9 files and update Mission Deck\?/);
  assert.ok(t.includes('• f0.js'));
  assert.ok(t.includes('• f5.js'));
  assert.ok(!t.includes('f6.js'), 'six shown');
  assert.match(t, /and 3 files more/);
  assert.match(t, /new, unadded files/);
  assert.match(t, /does not run git stash pop/);
  assert.match(t, /Stash/);
});

test('stashConfirmText: a short list has no "more" line and a bad payload still asks', () => {
  assert.ok(!stashConfirmText(dirty({ files: ['a.js'] })).includes('more'));
  assert.match(stashConfirmText(null), /0 files/);
});
