// Unit tests for js/sync-center-helpers.js's pure functions: the per-module
// status badge, module row sorting, the repo-expand default/override, file
// status/remote labels, the log-copy formatter, the in-row progress bar math
// and the prerequisite callout predicate.
// Run: node --test tests/test_sync_center_helpers.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_GROUP_NAME,
  moduleStateBadge,
  repoStateBadge,
  sortModuleRows,
  isRepoExpanded,
  moduleHasFileList,
  fileStatusLabel,
  fileRemoteLabel,
  formatSyncLogText,
  syncProgress,
  syncPrereqCallout,
  moduleSyncBarState,
  pluralFiles,
  uncheckedRepos,
  notClonedRepoIds, noTokenRepoIds, gitPhaseProgress,} from '../js/sync-center-helpers.js';

describe('moduleStateBadge', () => {
  it('renders a neutral badge for an unknown row, regardless of pendingPush', () => {
    const badge = moduleStateBadge({ id: 'demo-hub', unknown: true, pendingPush: true, pendingFiles: null });
    assert.equal(badge.cls, 'ds-badge--gray');
    assert.equal(badge.label, 'No data');
  });

  it('renders "Do wyslania" with no count when pendingPush is true - the module row has its own counts column', () => {
    const badge = moduleStateBadge({ id: 'demo-hub', unknown: false, pendingPush: true, pendingFiles: 3 });
    assert.equal(badge.cls, 'ds-badge--yellow');
    assert.equal(badge.label, 'To send');
    assert.ok(!/\d/.test(badge.label));
  });

  it('renders "Aktualne" when nothing is pending', () => {
    const badge = moduleStateBadge({ id: 'demo-hub', unknown: false, pendingPush: false, pendingFiles: 0 });
    assert.equal(badge.cls, 'ds-badge--green');
    assert.equal(badge.label, 'Up to date');
  });

  it('falls back to "no connection" for a null row', () => {
    assert.equal(moduleStateBadge(null).label, 'No data');
  });

  it('says so when the module has files waiting on the server', () => {
    // The fetch direction used to have no branch here at all: a module the
    // team had pushed to painted a green "Aktualne".
    assert.equal(moduleStateBadge({ id: 'urlopy', pendingPush: false, filesToFetch: 4 }).label, 'To fetch');
    assert.equal(moduleStateBadge({ id: 'urlopy', pendingPush: false, filesToFetch: 4 }).cls, 'ds-badge--yellow');
  });

  it('names both directions when the module has something to send AND something to fetch', () => {
    assert.equal(moduleStateBadge({ id: 'urlopy', pendingPush: true, filesToFetch: 4 }).label, 'To send and fetch');
  });
});

describe('repoStateBadge', () => {
  const ready = {
    repo: 'data-tier-0', status: 'ready', hasToken: true, bitwardenLocked: false,
    decrypted: true, encryptionReady: true, ahead: 0, behind: 0, localDirty: false,
    filesToSend: 0, filesToFetch: 0,
  };

  it('is green only when neither direction has anything', () => {
    const badge = repoStateBadge(ready);
    assert.equal(badge.cls, 'ds-badge--green');
    assert.equal(badge.label, 'up to date');
  });

  it('says "do pobrania" when the remote is ahead - the bug this branch exists for', () => {
    // Before: no fetch branch at all, so a source a teammate had pushed to
    // rendered a confident green "aktualne" while the table's own counts
    // column showed files to fetch.
    assert.equal(repoStateBadge({ ...ready, filesToFetch: 3 }).label, 'to fetch');
    assert.equal(repoStateBadge({ ...ready, filesToFetch: 3 }).cls, 'ds-badge--yellow');
    // `behind` counts commits and is still in the payload; either signal counts.
    assert.equal(repoStateBadge({ ...ready, behind: 2 }).label, 'to fetch');
  });

  it('names BOTH directions rather than only the local one', () => {
    // The row in the report: 7 files to send and something to fetch. A fetch
    // branch appended after the dirty branch would have kept saying only
    // "lokalne zmiany" here - the same defect one level down.
    assert.equal(repoStateBadge({ ...ready, localDirty: true, filesToSend: 7, filesToFetch: 3 }).label, 'to send and fetch');
    assert.equal(repoStateBadge({ ...ready, ahead: 1, filesToFetch: 3 }).label, 'to send and fetch');
  });

  it('keeps the send-only labels it always had', () => {
    assert.equal(repoStateBadge({ ...ready, ahead: 1 }).label, 'to send');
    assert.equal(repoStateBadge({ ...ready, localDirty: true }).label, 'local changes');
  });

  it('never claims a direction for a row whose counts are unknown', () => {
    const badge = repoStateBadge({ ...ready, filesToSend: null, filesToFetch: null, ahead: null, behind: null });
    assert.equal(badge.label, 'up to date');
  });

  it('keeps every prerequisite state ahead of the two directions', () => {
    assert.equal(repoStateBadge(null).label, 'no connection');
    assert.equal(repoStateBadge({ ...ready, hasToken: false, filesToFetch: 9 }).label, 'no token');
    assert.equal(repoStateBadge({ ...ready, bitwardenLocked: true, filesToFetch: 9 }).label, 'vault locked');
    assert.equal(repoStateBadge({ ...ready, status: 'not-configured' }).label, 'not downloaded');
    assert.equal(repoStateBadge({ ...ready, status: 'dir-exists' }).label, 'not downloaded');
    assert.equal(repoStateBadge({ ...ready, status: 'no-access' }).cls, 'ds-badge--red');
    assert.equal(repoStateBadge({ ...ready, status: 'network' }).cls, 'ds-badge--red');
    assert.equal(repoStateBadge({ ...ready, decrypted: false, filesToFetch: 9 }).label, 'not decrypted');
    assert.equal(repoStateBadge({ ...ready, decrypted: false, encryptionReady: false }).label, 'no key');
  });

  it('shows "po zakonczeniu dnia" for a wrapped-up row rather than "nieodszyfrowane"', () => {
    assert.equal(repoStateBadge({ ...ready, decrypted: false, wrappedUpAt: '2026-09-08T20:00:00.000Z' }).label, 'after end of day');
    assert.equal(repoStateBadge({ ...ready, decrypted: false, wrappedUpAt: '2026-09-08T20:00:00.000Z' }).cls, 'ds-badge--yellow');
  });

  it('keeps the wrapped-up badge even when decrypted reads true again - one stray write into the emptied tree makes _repoDecryptedState report true, and reading it here would paint "aktualne" over an empty source', () => {
    assert.equal(repoStateBadge({ ...ready, decrypted: true, wrappedUpAt: '2026-09-08T20:00:00.000Z' }).label, 'after end of day');
  });

  it('drops the wrapped-up badge only when the marker is gone - a successful decrypt is what clears it server-side', () => {
    assert.equal(repoStateBadge({ ...ready, decrypted: true, wrappedUpAt: null }).label, 'up to date');
  });
});

describe('sortModuleRows', () => {
  it('always sorts _core last, even when it is pending and others are not', () => {
    const rows = [
      { id: '_core', pendingPush: true },
      { id: 'alpha', pendingPush: false },
    ];
    const sorted = sortModuleRows(rows);
    assert.equal(sorted[sorted.length - 1].id, '_core');
  });

  it('sorts pending modules before non-pending ones, _core still last', () => {
    const rows = [
      { id: 'clean', pendingPush: false },
      { id: '_core', pendingPush: false },
      { id: 'pending', pendingPush: true },
    ];
    const sorted = sortModuleRows(rows);
    assert.deepEqual(sorted.map((r) => r.id), ['pending', 'clean', '_core']);
  });

  it('does not mutate the input array', () => {
    const rows = [{ id: 'b', pendingPush: false }, { id: 'a', pendingPush: true }];
    const copy = rows.slice();
    sortModuleRows(rows);
    assert.deepEqual(rows, copy);
  });
});

describe('isRepoExpanded', () => {
  const row = { repo: 'data-tier-0', filesToSend: 2, pendingPush: true };

  it('is always false when the repo has no modules, regardless of pending files', () => {
    assert.equal(isRepoExpanded({}, row, false), false);
  });

  it('defaults to expanded when the repo has something pending', () => {
    assert.equal(isRepoExpanded({}, row, true), true);
  });

  it('defaults to collapsed when the repo is clean', () => {
    const clean = { repo: 'data-finance', filesToSend: 0, pendingPush: false };
    assert.equal(isRepoExpanded({}, clean, true), false);
  });

  it('an explicit override always wins over the default', () => {
    assert.equal(isRepoExpanded({ 'data-tier-0': false }, row, true), false);
    const clean = { repo: 'data-finance', filesToSend: 0, pendingPush: false };
    assert.equal(isRepoExpanded({ 'data-finance': true }, clean, true), true);
  });
});

describe('fileStatusLabel', () => {
  it('maps A/M/D to their Polish labels', () => {
    assert.equal(fileStatusLabel('A'), 'new');
    assert.equal(fileStatusLabel('M'), 'changed');
    assert.equal(fileStatusLabel('D'), 'deleted');
  });

  it('says "na serwerze" for a fetch-direction row - the same letter means the other side', () => {
    assert.equal(fileStatusLabel('A', 'fetch'), 'new on the server');
    assert.equal(fileStatusLabel('M', 'fetch'), 'changed on the server');
    assert.equal(fileStatusLabel('D', 'fetch'), 'deleted on the server');
    // An explicit 'send' and an omitted direction are the same thing.
    assert.equal(fileStatusLabel('A', 'send'), fileStatusLabel('A'));
  });
});

describe('moduleHasFileList', () => {
  it('opens for a row with only files to FETCH - the case that had no way in at all', () => {
    assert.equal(moduleHasFileList({ pendingPush: false, filesToSend: 0, filesToFetch: 2 }), true);
  });

  it('opens for a row with something to send, in either direction', () => {
    assert.equal(moduleHasFileList({ pendingPush: true, filesToFetch: 0 }), true);
    assert.equal(moduleHasFileList({ pendingPush: true, filesToFetch: 3 }), true);
  });

  it('stays shut on a clean row, an unknown row and no row at all', () => {
    assert.equal(moduleHasFileList({ pendingPush: false, filesToSend: 0, filesToFetch: 0 }), false);
    assert.equal(moduleHasFileList({ unknown: true, pendingPush: true, filesToFetch: 5 }), false);
    assert.equal(moduleHasFileList(null), false);
  });

  it('counts `behind` commits too, the same fallback moduleStateBadge reads', () => {
    assert.equal(moduleHasFileList({ pendingPush: false, filesToFetch: null, behind: 1 }), true);
  });
});

describe('fileRemoteLabel', () => {
  it('never says "none" - an unresolved remote state is honestly "do not know"-shaped', () => {
    const label = fileRemoteLabel({ onRemote: false, remoteAt: null });
    assert.ok(!label.includes('none'));
    assert.match(label, /not there at the last fetch/);
  });

  it('renders the remote date when onRemote and remoteAt are both set', () => {
    const label = fileRemoteLabel({ onRemote: true, remoteAt: '2026-09-06T10:15:00.000Z' });
    assert.notEqual(label, 'present');
    assert.ok(!label.includes('none'));
  });

  it('renders "present" when onRemote is true but remoteAt was not computed (beyond the first 50)', () => {
    assert.equal(fileRemoteLabel({ onRemote: true, remoteAt: null }), 'present');
  });
});

describe('CORE_GROUP_NAME', () => {
  it('is the ASCII own-name "Cockpit Core"', () => {
    assert.equal(CORE_GROUP_NAME, 'Cockpit Core');
  });
});

describe('syncProgress', () => {
  it('reports 0% at the start', () => {
    assert.deepEqual(syncProgress('pull', 0, false), { pct: 0, counter: '0 / 3' });
  });

  it('reports 75% for 3/4 push steps seen', () => {
    assert.deepEqual(syncProgress('push', 3, false), { pct: 75, counter: '3 / 4' });
  });

  it('reports 100% once done, regardless of the running count', () => {
    const result = syncProgress('push', 4, true);
    assert.equal(result.pct, 100);
    assert.equal(result.counter, '4 / 4');
  });

  it('clamps to 95% while still running, even past the nominal step total', () => {
    const result = syncProgress('clone', 9, false);
    assert.equal(result.pct, 95);
    assert.equal(result.counter, '2 / 2');
  });
});

describe('syncPrereqCallout', () => {
  it('returns null for an empty registry', () => {
    assert.equal(syncPrereqCallout([]), null);
  });

  it('returns null when at least one row is ready', () => {
    const rows = [{ status: 'not-configured' }, { status: 'ready' }];
    assert.equal(syncPrereqCallout(rows), null);
  });

  it('names the vault when every row is blocked and bitwardenLocked is set', () => {
    const rows = [{ status: 'not-configured', bitwardenLocked: true }, { status: 'not-configured', bitwardenLocked: true }];
    const result = syncPrereqCallout(rows);
    assert.equal(result.kind, 'vault');
    assert.match(result.text, /Bitwarden/);
  });

  it('names the network when every row reports status network', () => {
    const rows = [{ status: 'network' }];
    const result = syncPrereqCallout(rows);
    assert.equal(result.kind, 'network');
    assert.match(result.text, /VPN/);
  });

  it('names both when the registry has one of each', () => {
    const rows = [{ status: 'network' }, { status: 'not-configured', bitwardenLocked: true }];
    const result = syncPrereqCallout(rows);
    assert.equal(result.kind, 'both');
    assert.match(result.text, /Bitwarden/);
    assert.match(result.text, /VPN/);
  });

  it('falls back to unknown, naming both requirements, when neither signal is set', () => {
    const rows = [{ status: 'not-configured' }];
    const result = syncPrereqCallout(rows);
    assert.equal(result.kind, 'unknown');
    assert.match(result.text, /Bitwarden/);
    assert.match(result.text, /VPN/);
  });
});

describe('formatSyncLogText', () => {
  it('says the log is empty rather than returning an empty string (a no-op sync writes no entry)', () => {
    const text = formatSyncLogText([]);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0);
  });

  it('renders one line per entry plus indented file paths, and names the module of a scoped push', () => {
    const events = [
      {
        timestamp: '2026-09-06T10:15:00.000Z',
        action: 'push',
        trigger: 'manual',
        repo: 'data-tier-0',
        user: 'robert',
        module: 'demo-hub',
        files_added: 2,
        files_removed: 0,
        files: [{ path: 'demo-hub/notatka.md', status: 'M' }],
      },
      {
        // Retention strips files/commits for entries older than 14 days -
        // this must not throw and must still produce a summary line.
        timestamp: '2026-01-01T00:00:00.000Z',
        action: 'pull',
        trigger: 'auto',
        repo: 'data-tier-0',
        user: 'robert',
        files_added: 0,
        files_removed: 1,
      },
    ];
    const text = formatSyncLogText(events);
    const lines = text.split('\n');
    assert.equal(lines.filter((l) => l.includes('[push/manual · demo-hub]')).length, 1);
    assert.equal(lines.filter((l) => l.includes('[pull/auto]')).length, 1);
    assert.ok(lines.some((l) => l.includes('demo-hub/notatka.md')));
  });
});

describe('pluralFiles', () => {
  it('renders the Polish plural forms, including the 12-14 exception', () => {
    assert.equal(pluralFiles(1), '1 file');
    assert.equal(pluralFiles(3), '3 files');
    assert.equal(pluralFiles(5), '5 files');
    assert.equal(pluralFiles(12), '12 files');
  });
});

// A date-shaped fragment, timezone-independent: exact digits are not
// asserted (they depend on the local zone), only that a DD.MM HH:MM token
// is present where the sentence promises one.
const DATE_RE = /\d{2}\.\d{2} \d{2}:\d{2}/;

describe('moduleSyncBarState', () => {
  it('renders neutral with no rows', () => {
    const state = moduleSyncBarState([], [], {});
    assert.equal(state.variant, 'neutral');
    assert.match(state.text, /No sync data/);
  });

  it('renders neutral when every row is unknown', () => {
    const state = moduleSyncBarState([{ id: 'urlopy', repo: 'data-tier-0', unknown: true }], [], {});
    assert.equal(state.variant, 'neutral');
    assert.match(state.text, /No sync data/);
  });

  it('a module that declared no paths for a source says so, never "server not fetched"', () => {
    // sample-app / data-reports, measured 2026-09-16: the module only READS
    // orders-hub/hub-data.json, so under the ownership rule it declares no paths;
    // the scope falls back to the assumed `sample-app/` directory, which does
    // not exist in data-reports, and every count and date comes back empty. The
    // bar used to read that through the generic no-remote-date clause and blame a
    // missing fetch - a state the person cannot act on, for a source that was in
    // fact fetched minutes earlier.
    const row = {
      id: 'sample-app', repo: 'data-reports', declaredPaths: false,
      filesToSend: 0, filesToFetch: 0, localAt: null, remoteAt: null, unknown: false,
    };
    const state = moduleSyncBarState([row], [{ repo: 'data-reports', ok: true }], {});
    assert.match(state.text, /it only reads this data/);
    assert.ok(!/has not been fetched yet/.test(state.text), 'must not blame a missing fetch');
    assert.ok(!/has no data for this module yet/.test(state.text));
  });

  it('an empty scope is NOT claimed for a row that carries real numbers or dates', () => {
    // The flag alone must not silence a row: declaredPaths false plus anything
    // actually found means the assumed `<id>/` directory DOES exist and the row
    // is a normal one. Only the all-empty combination is the reader case.
    const withFiles = {
      id: 'm', repo: 'data-reports', declaredPaths: false,
      filesToSend: 2, filesToFetch: 0, localAt: '2026-09-10T16:05:00.000Z', remoteAt: null, unknown: false,
    };
    assert.ok(!/it only reads this data/.test(moduleSyncBarState([withFiles], [{ repo: 'data-reports', ok: true }], {}).text));
    const withDate = {
      id: 'm', repo: 'data-reports', declaredPaths: false,
      filesToSend: 0, filesToFetch: 0, localAt: '2026-09-10T16:05:00.000Z', remoteAt: null, unknown: false,
    };
    assert.ok(!/it only reads this data/.test(moduleSyncBarState([withDate], [{ repo: 'data-reports', ok: true }], {}).text));
  });

  it('a row with declaredPaths true and no remote date still blames the fetch', () => {
    // The old sentence keeps its job: a module that DOES own paths here and has
    // no known remote commit really may be waiting on a fetch.
    const row = {
      id: 'm', repo: 'data-reports', declaredPaths: true,
      filesToSend: 0, filesToFetch: 0, localAt: '2026-09-10T16:05:00.000Z', remoteAt: null, unknown: false,
    };
    assert.match(moduleSyncBarState([row], [{ repo: 'data-reports', ok: true }], {}).text, /has no data for this module yet/);
  });

  it('renders warning with the local date when there are only unsent local changes', () => {
    const row = {
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 2, filesToFetch: 0,
      localAt: '2026-09-10T16:05:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z',
    };
    const state = moduleSyncBarState([row], [], {});
    assert.equal(state.variant, 'warning');
    assert.match(state.text, /You have local changes \(2 files/);
    assert.match(state.text, DATE_RE);
    assert.ok(!/has newer data/.test(state.text));
  });

  it('renders info with the server date when there are only remote-ahead files', () => {
    const row = {
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 3,
      localAt: '2026-09-10T14:02:00.000Z', remoteAt: '2026-09-10T15:40:00.000Z',
    };
    const state = moduleSyncBarState([row], [], {});
    assert.equal(state.variant, 'info');
    assert.match(state.text, /The server has newer data \(3 files/);
    assert.match(state.text, DATE_RE);
  });

  it('renders warning with both counts when local changes and remote-ahead files coexist', () => {
    const row = {
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 2, filesToFetch: 3,
      localAt: '2026-09-10T16:05:00.000Z', remoteAt: '2026-09-10T15:40:00.000Z',
    };
    const state = moduleSyncBarState([row], [], {});
    assert.equal(state.variant, 'warning');
    assert.match(state.text, /2 files/);
    assert.match(state.text, /3 files/);
  });

  it('caps a clean row at info and says the server check is still running when `checking` is set', () => {
    const clean = {
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 0,
      localAt: '2026-09-10T14:02:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z',
    };
    const checking = moduleSyncBarState([clean], [], {}, { checking: true });
    assert.equal(checking.variant, 'info', 'a confident success cannot stand before the remote answered');
    assert.match(checking.text, /^Checking the server… Data up to date/);

    const settled = moduleSyncBarState([clean], [], {}, { checking: false });
    assert.equal(settled.variant, 'success');
    assert.ok(!/Checking the server/.test(settled.text));

    // A real finding outranks the cap: a warning stays a warning, prefixed.
    const dirty = { ...clean, filesToSend: 2, localAt: '2026-09-10T16:05:00.000Z' };
    const dirtyChecking = moduleSyncBarState([dirty], [], {}, { checking: true });
    assert.equal(dirtyChecking.variant, 'warning');
    assert.match(dirtyChecking.text, /^Checking the server… You have local changes/);

    // A failed check is the stronger sentence and wins over "checking".
    const failed = moduleSyncBarState([clean], [{ repo: 'data-tier-0', ok: false }], {}, { checking: true });
    assert.match(failed.text, /^Could not check the server/);
    assert.ok(!/Checking the server/.test(failed.text));
  });

  it('renders success when nothing is pending; a null remoteAt (no upstream commit touched this module) says so instead of a guessed date', () => {
    const known = moduleSyncBarState([{
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 0,
      localAt: '2026-09-10T14:02:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z',
    }], [], {});
    assert.equal(known.variant, 'success');
    assert.match(known.text, /Data up to date/);

    const neverPulled = moduleSyncBarState([{
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 0,
      localAt: '2026-09-10T14:02:00.000Z', remoteAt: null,
    }], [], {});
    assert.match(neverPulled.text, /the server has no data for this module yet/);
    assert.doesNotMatch(neverPulled.text, /serwer -|stan z brak|null/);

    // Sprint Review on 13.09: four new files here, nothing of the module on the server yet
    const neverPushed = moduleSyncBarState([{
      id: 'sprint-review', repo: 'data-tier-0', filesToSend: 4, filesToFetch: 0,
      localAt: '2026-09-13T18:44:35.306Z', remoteAt: null,
    }], [], {});
    assert.equal(neverPushed.variant, 'warning');
    assert.match(neverPushed.text, /You have local changes \(4 files/);
    assert.match(neverPushed.text, /the server has no data for this module yet/);
    assert.doesNotMatch(neverPushed.text, /stan z brak|stan z null/);
  });

  it('prefixes each sentence with its repo label and lets the strongest variant win across several rows', () => {
    const rows = [
      { id: 'demo-hub', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 0, localAt: '2026-09-10T14:02:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z' },
      { id: 'demo-hub', repo: 'ds-data-tier-0', filesToSend: 1, filesToFetch: 0, localAt: '2026-09-10T16:05:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z' },
    ];
    const labels = { 'data-tier-0': 'Team data', 'ds-data-tier-0': 'Second store' };
    const state = moduleSyncBarState(rows, [], labels);
    assert.equal(state.variant, 'warning');
    assert.match(state.text, /^Team data: Data up to date/);
    assert.match(state.text, /Second store: You have local changes/);
  });

  it('never adds a repo-label prefix for a single row', () => {
    const state = moduleSyncBarState([{
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 0,
      localAt: '2026-09-10T14:02:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z',
    }], [], { 'data-tier-0': 'Urlopy' });
    assert.ok(!state.text.startsWith('Urlopy:'));
  });

  it('prepends the "could not check the server" sentence on a failed refresh, without dropping the row sentence', () => {
    const row = {
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 0,
      localAt: '2026-09-10T14:02:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z',
    };
    const refreshed = [{ repo: 'data-tier-0', ok: false, error: 'network' }];
    const state = moduleSyncBarState([row], refreshed, {});
    assert.match(state.text, /^Could not check the server/);
    assert.match(state.text, /Data up to date/);
    // A confident "success" would contradict the "could not check" sentence,
    // so it is bumped to "info" instead of staying "success".
    assert.equal(state.variant, 'info');
  });

  it('a refresh failure on a DIFFERENT repo does not touch this row\'s sentence', () => {
    const row = {
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 0,
      localAt: '2026-09-10T14:02:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z',
    };
    const refreshed = [{ repo: 'some-other-repo', ok: false, error: 'network' }];
    const state = moduleSyncBarState([row], refreshed, {});
    assert.equal(state.variant, 'success');
    assert.ok(!state.text.includes('Could not'));
  });

  it('a skipped (TTL, not yet due) refresh entry is not treated as a failure', () => {
    const row = {
      id: 'urlopy', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 0,
      localAt: '2026-09-10T14:02:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z',
    };
    const refreshed = [{ repo: 'data-tier-0', ok: false, skipped: true }];
    const state = moduleSyncBarState([row], refreshed, {});
    assert.equal(state.variant, 'success');
  });

  it('never paints success for a not-cloned repo, even when the row itself is all zeros', () => {
    // _syncModulesForRepo answers plain zeros for a repo that is not cloned
    // (see server.js), which _rowSentence alone would read as "Dane aktualne".
    const row = {
      id: 'urlopy', repo: 'ds-data-leads', filesToSend: 0, filesToFetch: 0,
      localAt: null, remoteAt: null,
    };
    const labels = { 'ds-data-leads': 'PO data' };
    const state = moduleSyncBarState([row], [], labels, { notClonedRepos: ['ds-data-leads'] });
    assert.equal(state.variant, 'warning');
    assert.match(state.text, /PO data/);
    assert.match(state.text, /is not downloaded to this machine yet/);
    assert.ok(!/Data up to date/.test(state.text), 'a not-cloned source must never read as up to date');
  });

  it('accepts notClonedRepos as a Set as well as an array', () => {
    const row = { id: 'urlopy', repo: 'ds-data-leads', filesToSend: 0, filesToFetch: 0 };
    const state = moduleSyncBarState([row], [], {}, { notClonedRepos: new Set(['ds-data-leads']) });
    assert.equal(state.variant, 'warning');
    assert.match(state.text, /is not downloaded to this machine yet/);
  });

  it('names an unknown row instead of silently dropping it from a multi-repo sentence', () => {
    // Before the fix, moduleSyncBarState filtered unknown rows out entirely
    // and gated the label prefix on known.length > 1, so a spanned source
    // whose classification timed out vanished from the sentence with no
    // mention - and the module still read as a clean "success".
    const rows = [
      {
        id: 'urlopy', repo: 'data-tier-0', filesToSend: 0, filesToFetch: 0,
        localAt: '2026-09-10T14:02:00.000Z', remoteAt: '2026-09-10T14:02:00.000Z',
      },
      { id: 'urlopy', repo: 'ds-data-leads', unknown: true },
    ];
    const labels = { 'data-tier-0': 'Team data', 'ds-data-leads': 'PO data' };
    const state = moduleSyncBarState(rows, [], labels);
    assert.match(state.text, /Team data: Data up to date/);
    assert.match(state.text, /PO data/);
    assert.match(state.text, /unknown/);
    assert.notEqual(state.variant, 'success');
  });
});

describe('uncheckedRepos', () => {
  it('synthesizes an unchecked entry for a repo with no write token', () => {
    const overview = [
      { repo: 'data-tier-0', hasToken: false },
      { repo: 'ds-data-leads', hasToken: true },
    ];
    const result = uncheckedRepos(overview, { ok: true }, [{ repo: 'ds-data-leads', ok: true }]);
    assert.deepEqual(result, [{ repo: 'data-tier-0', ok: false }]);
  });

  it('marks every repo unchecked when the whole refresh call failed', () => {
    const overview = [
      { repo: 'data-tier-0', hasToken: true },
      { repo: 'ds-data-leads', hasToken: true },
    ];
    const result = uncheckedRepos(overview, { ok: false }, []);
    assert.deepEqual(result.map((x) => x.repo).sort(), ['data-tier-0', 'ds-data-leads']);
    assert.ok(result.every((x) => x.ok === false));
  });

  it('does not duplicate a repo the refreshed list already names', () => {
    const overview = [{ repo: 'data-tier-0', hasToken: false }];
    const result = uncheckedRepos(overview, { ok: true }, [{ repo: 'data-tier-0', ok: false, skipped: true }]);
    assert.deepEqual(result, []);
  });

  it('returns nothing for an empty overview', () => {
    assert.deepEqual(uncheckedRepos([], { ok: false }, []), []);
  });
});

describe('notClonedRepoIds', () => {
  it('names a never-cloned and a leftover-directory repo, not a ready one', () => {
    const overview = [
      { repo: 'data-tier-0', status: 'ready' },
      { repo: 'ds-data-leads', status: 'not-configured' },
      { repo: 'ds-data-store', status: 'dir-exists' },
    ];
    assert.deepEqual(notClonedRepoIds(overview), ['ds-data-leads', 'ds-data-store']);
  });

  it('returns an empty array for an empty or missing list', () => {
    assert.deepEqual(notClonedRepoIds([]), []);
    assert.deepEqual(notClonedRepoIds(undefined), []);
  });
});

// ── gitPhaseProgress: git's own clone progress, mapped onto one bar ──────────
describe('gitPhaseProgress', () => {

  it('gitPhaseProgress keeps the bar monotonic across every phase', () => {
  // Each git phase runs 0->100% on its own, so painting pct raw snapped the bar
  // back to zero four times per clone. Bands must therefore never overlap and
  // never go backwards as the clone walks counting -> compressing -> receiving
  // -> resolving -> checkout.
  const walk = [
    ['counting', 0], ['counting', 100],
    ['compressing', 0], ['compressing', 100],
    ['receiving', 0], ['receiving', 50], ['receiving', 100],
    ['resolving', 0], ['resolving', 100],
    ['checkout', 0], ['checkout', 100],
  ];
  let prev = -1;
  for (const [key, pct] of walk) {
    const g = gitPhaseProgress({ key, phase: 'x', pct });
    assert.ok(g, `nierozpoznana faza: ${key}`);
    assert.ok(g.pct >= prev, `the bar went back at ${key} ${pct}%: ${g.pct} < ${prev}`);
    prev = g.pct;
  }
  assert.strictEqual(prev, 100, 'the last phase must end at 100%');
  });

  it('gitPhaseProgress prefers git object counts over a bare percentage', () => {
  assert.strictEqual(gitPhaseProgress({ key: 'receiving', phase: 'x', pct: 50, current: 600, total: 1200 }).counter, '600 / 1200');
  // Phases that report no counts still get a readable counter.
  assert.strictEqual(gitPhaseProgress({ key: 'receiving', phase: 'x', pct: 7, current: null, total: null }).counter, '7%');
  // A zero total must not produce "5 / 0".
  assert.strictEqual(gitPhaseProgress({ key: 'receiving', phase: 'x', pct: 7, current: 5, total: 0 }).counter, '7%');
  });

  it('gitPhaseProgress returns null rather than painting a wrong bar', () => {
  // An unknown key means the server added a phase the client does not know;
  // the caller must keep what it was showing, not jump to zero.
  assert.strictEqual(gitPhaseProgress({ key: 'nieznana', pct: 50 }), null);
  assert.strictEqual(gitPhaseProgress({ key: 'receiving', pct: 142 }), null);
  assert.strictEqual(gitPhaseProgress({ key: 'receiving', pct: -1 }), null);
  assert.strictEqual(gitPhaseProgress({ key: 'receiving' }), null);
  assert.strictEqual(gitPhaseProgress(null), null);
  assert.strictEqual(gitPhaseProgress({}), null);
  });

  it('gitPhaseProgress passes the server label through untouched', () => {
  // The copy lives on the server next to git's own prefix; the
  // client keys on the ASCII id and must never invent a label of its own.
  assert.strictEqual(gitPhaseProgress({ key: 'receiving', phase: 'Receiving objects', pct: 10 }).step, 'Receiving objects');
  });
});

describe('noTokenRepoIds', () => {
  it('names a source without a token while the vault is open, not one with a token', () => {
    const overview = [
      { repo: 'data-tier-0', hasToken: true, bitwardenLocked: false },
      { repo: 'data-extra', hasToken: false, bitwardenLocked: false },
      { repo: 'data-apps', hasToken: false },
    ];
    assert.deepEqual(noTokenRepoIds(overview), ['data-extra', 'data-apps']);
  });

  it('names nothing while the vault is closed - every row lacks a token then, and that is not missing access', () => {
    const overview = [
      { repo: 'data-tier-0', hasToken: false, bitwardenLocked: true },
      { repo: 'data-extra', hasToken: false, bitwardenLocked: true },
    ];
    assert.deepEqual(noTokenRepoIds(overview), []);
  });

  it('returns an empty array for an empty or missing list', () => {
    assert.deepEqual(noTokenRepoIds([]), []);
    assert.deepEqual(noTokenRepoIds(undefined), []);
  });
});

describe('moduleSyncBarState - source without a token (feedback report !5)', () => {
  const clean = {
    id: 'experiments', repo: 'data-extra', filesToSend: 0, filesToFetch: 0,
    localAt: '2026-10-09T07:00:00.000Z', remoteAt: '2026-10-09T07:00:00.000Z',
  };
  const labels = { 'data-extra': 'Extra: extra team data' };

  it('a not-cloned source with no token says there is no access instead of urging a download', () => {
    const state = moduleSyncBarState([clean], [{ repo: 'data-extra', ok: false }], labels, {
      notClonedRepos: ['data-extra'], noTokenRepos: ['data-extra'],
    });
    assert.equal(state.variant, 'info');
    assert.match(state.text, /You have no access to data source "Extra: extra team data"/);
    assert.ok(!/open Sync/.test(state.text));
    assert.ok(!/Could not check the server/.test(state.text), 'a never-attempted check is not a failed one');
  });

  it('a not-cloned source WITH a token keeps the download hint', () => {
    const state = moduleSyncBarState([clean], [], labels, { notClonedRepos: ['data-extra'], noTokenRepos: [] });
    assert.equal(state.variant, 'warning');
    assert.match(state.text, /open Sync to download it/);
  });

  it('a cloned source with no token names the skipped check without blaming the connection', () => {
    const state = moduleSyncBarState([clean], [{ repo: 'data-extra', ok: false }], labels, {
      notClonedRepos: [], noTokenRepos: new Set(['data-extra']),
    });
    assert.equal(state.variant, 'info', 'an unchecked server cannot read as a confident success');
    assert.match(state.text, /Without a token in the vault the server is not checked for "Extra: extra team data"/);
    assert.ok(!/Could not check the server/.test(state.text));
  });

  it('a genuinely failed check on another source of the same module still says so', () => {
    const other = { ...clean, repo: 'data-tier-0' };
    const state = moduleSyncBarState([clean, other], [{ repo: 'data-extra', ok: false }, { repo: 'data-tier-0', ok: false }], labels, {
      notClonedRepos: ['data-extra'], noTokenRepos: ['data-extra'],
    });
    assert.match(state.text, /^Could not check the server/);
  });
});
