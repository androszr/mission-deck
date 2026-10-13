// Unit tests for the pure decision surface of js/onboarding-wizard.js: the five
// predicates that decide whether a step's badge is green, plus the textarea
// parser behind the key step.
// Run: node --test tests/test_onboarding_wizard.mjs
//
// js/onboarding-wizard.js imports js/settings.js, js/sub-repo-sync-stream.js and
// js/view-lifecycle.js, but none of them touch `document`/`window` at module
// scope - every document access is inside a function body - so importing under plain
// Node is safe as long as no renderer or handler is invoked.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OBW_REQUIRED_TOOLS,
  obwToolsReady,
  obwTokenState,
  obwTokenBadge,
  obwParseKeyLines,
  obwKeysReady,
  obwKeyRowAction,
  obwVisibleKeyRows,
  obwDataReady,
  obwDataCloned,
  obwAllDone,
} from '../js/onboarding-wizard.js';

/** GET /api/tools/status payload with every required tool installed. */
function toolsPayload(overrides = {}) {
  return {
    tools: OBW_REQUIRED_TOOLS.map(id => ({
      id, installed: true, version: '1.0.0', ...(overrides[id] || {}),
    })),
  };
}

describe('obwToolsReady', () => {
  it('is green only when every required tool is installed', () => {
    assert.equal(obwToolsReady(toolsPayload()), true);
    assert.equal(obwToolsReady(toolsPayload({ git: { installed: false } })), false);
  });

  it('treats an unknown probe result as NOT ready', () => {
    // installed:null means the probe itself failed. Reporting green on an
    // unknown answer is the one failure mode a first-run guide must not have.
    assert.equal(obwToolsReady(toolsPayload({ bitwarden: { installed: null } })), false);
  });

  it('is not ready when a required tool is missing from the payload entirely', () => {
    const payload = toolsPayload();
    payload.tools = payload.tools.filter(t => t.id !== 'npm');
    assert.equal(obwToolsReady(payload), false);
  });

  it('survives a failed fetch', () => {
    assert.equal(obwToolsReady(null), false);
    assert.equal(obwToolsReady({}), false);
    assert.equal(obwToolsReady({ tools: 'nie-tablica' }), false);
  });
});

describe('obwTokenState', () => {
  it('reports the app token as loaded and ignores the rest of the vault', () => {
    const st = obwTokenState({ loadedSecrets: ['COCKPIT_APP_TOKEN', 'COCKPIT_DATA_TOKEN', 'JIRA_TOKEN'] });
    assert.equal(st.done, true);
    assert.deepEqual(st.missing, []);
  });

  it('names exactly which token is missing', () => {
    const st = obwTokenState({ loadedSecrets: ['JIRA_TOKEN'] });
    assert.equal(st.done, false);
    assert.deepEqual(st.missing, ['COCKPIT_APP_TOKEN']);
  });

  it('does not gate on the data-repo token - step 5 owns that one', () => {
    // OBW_REQUIRED_TOKENS deliberately holds COCKPIT_APP_TOKEN alone, so the
    // data-repo prerequisites (key, token, clone) stay in one card instead of
    // being split across two steps a newcomer reads minutes apart.
    const st = obwTokenState({ loadedSecrets: ['COCKPIT_APP_TOKEN'] });
    assert.equal(st.done, true);
    assert.equal(st.missing.includes('COCKPIT_DATA_TOKEN'), false);
  });

  it('survives a locked or unavailable vault', () => {
    assert.equal(obwTokenState(null).done, false);
    assert.equal(obwTokenState({ hasSecrets: false }).done, false);
  });
});

describe('obwTokenBadge', () => {
  it('is green when the token is loaded', () => {
    const b = obwTokenBadge({ sessionOpen: true, hasSecrets: true }, true);
    assert.equal(b.text, 'In the vault');
    assert.equal(b.msg, '');
  });

  it('says the vault is closed instead of claiming the token is missing', () => {
    // A locked vault loads nothing, so "Missing" there is a statement the client
    // cannot back up - and it sends a person hunting through GitLab for a
    // token that is sitting in their sejf.
    const b = obwTokenBadge({ sessionOpen: false, hasSecrets: false }, false);
    assert.equal(b.text, 'Vault locked');
    assert.match(b.msg, /step 2/);
  });

  it('says "Missing" only with the vault open', () => {
    const b = obwTokenBadge({ sessionOpen: true, hasSecrets: true }, false);
    assert.equal(b.text, 'Missing');
  });

  it('treats an unanswered status probe as a closed vault', () => {
    assert.equal(obwTokenBadge(null, false).text, 'Vault locked');
  });
});

describe('obwParseKeyLines', () => {
  const allowed = ['ds-data', 'data-leads', 'data-finance'];

  it('parses one entry per line and trims whitespace', () => {
    const { entries, errors } = obwParseKeyLines('  ds-data=AAA \n data-leads=BBB ', allowed);
    assert.deepEqual(entries, [
      { repoId: 'ds-data', key: 'AAA' },
      { repoId: 'data-leads', key: 'BBB' },
    ]);
    assert.deepEqual(errors, []);
  });

  it('skips blank lines and comments', () => {
    const { entries, errors } = obwParseKeyLines('# comment\n\nds-data=AAA\n', allowed);
    assert.equal(entries.length, 1);
    assert.deepEqual(errors, []);
  });

  it('rejects an id the server did not list, and keeps the good lines', () => {
    // Partial validation: one bad line never costs the user the whole paste.
    const { entries, errors } = obwParseKeyLines('nieznane=AAA\nds-data=BBB', allowed);
    assert.deepEqual(entries, [{ repoId: 'ds-data', key: 'BBB' }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Line 1/);
    assert.match(errors[0], /nieznane/);
  });

  it('rejects a line with no separator and a line with an empty key', () => {
    const { entries, errors } = obwParseKeyLines('bezrownosci\nds-data=', allowed);
    assert.deepEqual(entries, []);
    assert.equal(errors.length, 2);
  });

  it('keeps a base64 key containing "=" padding intact', () => {
    // The split is on the FIRST '=' only; base64 padding must survive it.
    const key = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=';
    const { entries, errors } = obwParseKeyLines('ds-data=' + key, allowed);
    assert.deepEqual(entries, [{ repoId: 'ds-data', key }]);
    assert.deepEqual(errors, []);
  });

  it('reports a repo listed twice instead of silently saving the last one', () => {
    const { entries, errors } = obwParseKeyLines('ds-data=AAA\nds-data=BBB', allowed);
    assert.deepEqual(entries, [{ repoId: 'ds-data', key: 'AAA' }]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /given twice/);
  });

  it('rejects everything when the server returned no allowed ids', () => {
    // An empty list means the status call failed. Guessing the ids client-side
    // is exactly the drift this parameter exists to prevent.
    const { entries, errors } = obwParseKeyLines('ds-data=AAA', []);
    assert.deepEqual(entries, []);
    assert.equal(errors.length, 1);
  });
});

describe('obwVisibleKeyRows', () => {
  // The key step lists only the sources the vault opens for this person - a
  // row whose GitLab token Bitwarden never handed over is one they cannot
  // clone, so its key is noise. Eight rows of "No key" hid the one that
  // mattered; the regression this pins is a newcomer seeing only their own.
  const newcomer = {
    keyPresent: false,
    bitwardenLocked: false,
    repos: [
      { id: 'ds-data', repo: 'data-tier-0', keyPresent: false, hasToken: true },
      { id: 'data-leads', repo: 'data-leads', keyPresent: false, hasToken: false },
      { id: 'data-mobile', repo: 'data-mobile', keyPresent: true, hasToken: true },
      { id: 'data-finance', repo: 'data-finance', keyPresent: true, hasToken: false },
    ],
  };

  it('lists only the rows whose token the vault loaded, in server order', () => {
    const { rows, reason } = obwVisibleKeyRows(newcomer);
    assert.equal(reason, 'ok');
    assert.deepEqual(rows.map(r => r.id), ['ds-data', 'data-mobile']);
  });

  it('is a VIEW - the payload it reads stays untouched', () => {
    obwVisibleKeyRows(newcomer);
    assert.equal(newcomer.repos.length, 4);
  });

  it('shows every row when the server does not say which tokens it has', () => {
    // An older server carries no `hasToken`; hiding rows it cannot judge would
    // blank the list for everybody on the first mixed-version day.
    const older = { keyPresent: true, repos: [{ id: 'ds-data', keyPresent: true }, { id: 'data-leads', keyPresent: false }] };
    assert.deepEqual(obwVisibleKeyRows(older).rows.map(r => r.id), ['ds-data', 'data-leads']);
    assert.equal(obwVisibleKeyRows(older).reason, 'ok');
  });

  it('names a locked vault as the reason for an empty list', () => {
    // A closed vault loads NO token, so "no access" there would blame the
    // person for a safe that is merely shut.
    const locked = { ...newcomer, bitwardenLocked: true, repos: newcomer.repos.map(r => ({ ...r, hasToken: false })) };
    assert.deepEqual(obwVisibleKeyRows(locked), { rows: [], reason: 'vault-locked' });
  });

  it('names missing access when the vault is open and holds no data token', () => {
    const noAccess = { ...newcomer, repos: newcomer.repos.map(r => ({ ...r, hasToken: false })) };
    assert.deepEqual(obwVisibleKeyRows(noAccess), { rows: [], reason: 'no-access' });
  });

  it('answers no-data for a missing or empty payload', () => {
    assert.deepEqual(obwVisibleKeyRows(null), { rows: [], reason: 'no-data' });
    assert.deepEqual(obwVisibleKeyRows({ repos: [] }), { rows: [], reason: 'no-data' });
    assert.deepEqual(obwVisibleKeyRows({ keyPresent: true }), { rows: [], reason: 'no-data' });
  });
});

describe('obwKeysReady', () => {
  // The shape a NEWCOMER sees: one key, for the one repo that actually syncs.
  // Everything else is listed for information and carries syncWired:false.
  const newcomer = {
    keyPresent: true,
    repos: [
      { id: 'ds-data', keyPresent: true, syncWired: true },
      { id: 'data-leads', keyPresent: false, syncWired: false },
      { id: 'data-finance', keyPresent: false, syncWired: false },
    ],
  };

  it('is green for a newcomer holding only the key that can sync', () => {
    // The regression this pins: gating on EVERY repo left the data step's
    // button permanently disabled for exactly the person the guide is for,
    // over seven repositories whose sync is not wired at all.
    assert.equal(obwKeysReady(newcomer), true);
  });

  it('is not green when a WIRED repo has no key', () => {
    assert.equal(obwKeysReady({
      keyPresent: true,
      repos: [
        { id: 'ds-data', keyPresent: false, syncWired: true },
        { id: 'data-leads', keyPresent: true, syncWired: false },
      ],
    }), false);
  });

  // The shape the CURRENT server sends: every source syncs (syncWired:true on
  // all eight), and the row carries its ROUTE id. The gate is the one repo the
  // next step clones - anything else would make a newcomer hunt down seven
  // optional keys before the "Download team data" button unlocks.
  const currentServer = {
    keyPresent: true,
    repos: [
      { id: 'ds-data', repo: 'data-tier-0', keyPresent: true, syncWired: true },
      { id: 'data-leads', repo: 'data-leads', keyPresent: false, syncWired: true },
      { id: 'data-finance', repo: 'data-finance', keyPresent: false, syncWired: true },
    ],
  };

  it('gates on the repo the data step clones, not on every wired source', () => {
    assert.equal(obwKeysReady(currentServer), true);
  });

  it('is not green when the data step repo itself has no key', () => {
    assert.equal(obwKeysReady({
      keyPresent: true,
      repos: [
        { id: 'ds-data', repo: 'data-tier-0', keyPresent: false, syncWired: true },
        { id: 'data-leads', repo: 'data-leads', keyPresent: true, syncWired: true },
      ],
    }), false);
  });

  it('matches the data row on its ROUTE id, never on its key id', () => {
    // 'ds-data' is the KEY id of the very row being gated on; matching that
    // string instead of 'data-tier-0' is the drift this pins down.
    assert.equal(obwKeysReady({
      keyPresent: true,
      repos: [{ id: 'ds-data', repo: 'data-tier-0', keyPresent: true, syncWired: true }],
    }), true);
  });

  it('falls back to every repo when the server sends no syncWired flag', () => {
    // An older server: refuse to claim green on a fact we cannot check.
    assert.equal(obwKeysReady({
      keyPresent: true,
      repos: [{ id: 'ds-data', keyPresent: true }, { id: 'data-leads', keyPresent: true }],
    }), true);
    assert.equal(obwKeysReady({
      keyPresent: true,
      repos: [{ id: 'ds-data', keyPresent: true }, { id: 'data-leads', keyPresent: false }],
    }), false);
  });

  it('is not green on an empty repo list or a missing key file', () => {
    assert.equal(obwKeysReady({ keyPresent: true, repos: [] }), false);
    assert.equal(obwKeysReady({ keyPresent: false, repos: [{ id: 'ds-data', keyPresent: true }] }), false);
    assert.equal(obwKeysReady(null), false);
  });
});

describe('obwDataReady', () => {
  it('is green only on status "ready"', () => {
    assert.equal(obwDataReady({ status: 'ready' }), true);
    for (const status of ['not-configured', 'dir-exists', 'no-access', 'network']) {
      assert.equal(obwDataReady({ status }), false, status + ' must not be green');
    }
    assert.equal(obwDataReady(null), false);
  });

  it('is NOT green for a clone that was never decrypted (key arrived after the auto-clone)', () => {
    assert.equal(obwDataReady({ status: 'ready', decrypted: false }), false);
    assert.equal(obwDataReady({ status: 'ready', decrypted: true }), true);
    // null = cannot tell (no key, probe failed): the status alone decides.
    assert.equal(obwDataReady({ status: 'ready', decrypted: null }), true);
    // The clone itself is still recognised, so the button offers a decrypt.
    assert.equal(obwDataCloned({ status: 'ready', decrypted: false }), true);
    assert.equal(obwDataCloned({ status: 'not-configured' }), false);
  });
});

describe('obwAllDone', () => {
  const bw = { hasSecrets: true };
  const enc = { keyPresent: true, repos: [{ id: 'ds-data', keyPresent: true, syncWired: true }] };
  const repo = { status: 'ready' };

  it('unlocks training on vault + keys + data', () => {
    assert.equal(obwAllDone(bw, enc, repo), true);
  });

  it('stays locked when any of the three is not done', () => {
    assert.equal(obwAllDone({ hasSecrets: false }, enc, repo), false);
    assert.equal(obwAllDone(bw, { keyPresent: false, repos: [] }, repo), false);
    // And the newcomer case again, end to end: one key must unlock training.
    assert.equal(obwAllDone(bw, {
      keyPresent: true,
      repos: [
        { id: 'ds-data', keyPresent: true, syncWired: true },
        { id: 'data-leads', keyPresent: false, syncWired: false },
      ],
    }, repo), true);
    assert.equal(obwAllDone(bw, enc, { status: 'not-configured' }), false);
  });

  it('does not depend on the environment or update steps', () => {
    // Steps 1 and 6 are deliberately outside the gate: a missing Playwright or a
    // pending update does not stop anyone from using the cockpit.
    assert.equal(obwAllDone(bw, enc, repo), true);
  });
});

// ── Sidebar entry ────────────────────────────────────────────────────────────
// The wizard is reachable from the dashboard tile, but it is also PINNED to the
// bottom of the rail, above Settings, so it is there on every view. It is a
// core view, not a hub: a HUB_FLYOUT key would make js/app.js redirect
// #onboarding-wizard to the dashboard, so the item lives in static markup only.

describe('sidebar entry', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('pins "Start here" to the rail, right above Settings', () => {
    const spacer = html.indexOf('sidebar-spacer');
    const start = html.indexOf('data-view="onboarding-wizard"');
    const settings = html.indexOf('data-view="settings"');
    assert.ok(start > -1, 'sidebar item for the wizard is missing');
    assert.ok(spacer < start && start < settings,
      'the wizard item must sit between the spacer and Settings');
    assert.match(html.slice(start, settings), /Start here/);
  });

  it('is not a hub - no HUB_FLYOUT key, or app.js would redirect it', () => {
    const flyout = readFileSync(
      new URL('../js/sidebar-flyout-config.js', import.meta.url), 'utf8');
    assert.ok(!flyout.includes('onboarding-wizard'));
  });
});

describe('obwKeyRowAction', () => {
  it('picks generate, copy or nothing', () => {
    assert.equal(obwKeyRowAction({ keyGeneratable: true, keyPresent: false }), 'generate');
    assert.equal(obwKeyRowAction({ keyGeneratable: true }), 'generate');
    assert.equal(obwKeyRowAction({ keyGeneratable: true, keyPresent: true }), null);
    assert.equal(obwKeyRowAction({ keyCopyable: true, keyPresent: true }), 'copy');
    assert.equal(obwKeyRowAction({ keyGeneratable: false, keyCopyable: false }), null);
    assert.equal(obwKeyRowAction({ id: 'data-leads', keyPresent: false }), null);
    assert.equal(obwKeyRowAction(null), null);
  });
});
