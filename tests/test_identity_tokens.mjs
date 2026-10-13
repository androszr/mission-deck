// Unit tests for the pure helpers behind GET /api/whoami,
// GET /api/gitlab/ssh-access and POST /api/gitlab-tokens/create.
// Run: node --test tests/test_identity_tokens.mjs
//
// server.js exports these only when it is required rather than run, so this
// file never starts an HTTP server.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  _resolveIdentity,
  _bwMergeNoteKey,
  _maskSecret,
  _gitlabPathFromRemote,
  _gitlabSlug,
  _expiryPlus12Months,
  _redactGlpat,
  _activityPersonName,
  _sshUrlFromRemote,
  _bwNoteAssignments,
  _bwNormalizeItemName,
  _bwMatchItem,
  _resolveJiraToken,
  BW_ITEM_MAP,
  BW_DIRECT_ENV_KEYS,
  GITLAB_TOKEN_TARGET,
  GITLAB_TOKEN_TARGETS,
  _gitlabTargetById,
  _stripTokenNameSuffix,
  DATA_TIER_0_CANONICAL_URL,
  _isCleanHttpsRemote,
  _sshToHttps,
  DATA_REPOS,
} = require('../server.js');

describe('_activityPersonName - the person behind a GitLab token name', () => {
  it('strips the COCKPIT-APP tier suffix and title-cases the rest', () => {
    assert.deepEqual(_activityPersonName('alex-morgan-COCKPIT-APP'), {
      person_slug: 'alex-morgan', display_name: 'Alex Morgan',
    });
  });

  it('is case-insensitive about the suffix', () => {
    assert.equal(_activityPersonName('jordan-lee-cockpit-app').person_slug, 'jordan-lee');
  });

  it('pops trailing scope words a legacy token name may carry', () => {
    assert.equal(_activityPersonName('rafal-gajcy-app-write').person_slug, 'rafal-gajcy');
    assert.equal(_activityPersonName('rafal-gajcy-app-read-access').person_slug, 'rafal-gajcy');
  });

  it('never pops below two parts, so a genuine two-part name survives', () => {
    assert.equal(_activityPersonName('anna-data').person_slug, 'anna-data');
    assert.equal(_activityPersonName('read-write').person_slug, 'read-write');
  });

  it('falls back to the raw name when the shape is unrecognised', () => {
    assert.deepEqual(_activityPersonName('project_1234_bot_abc'), {
      person_slug: 'project_1234_bot_abc', display_name: 'Project_1234_bot_abc',
    });
  });

  it('never throws on an empty name', () => {
    assert.deepEqual(_activityPersonName(''), { person_slug: '', display_name: '' });
    assert.deepEqual(_activityPersonName(null), { person_slug: '', display_name: '' });
  });
});

describe('_resolveIdentity - precedence: gitlab token name > git config > OS', () => {
  const GITLAB = {
    source: 'gitlab', person_slug: 'alex-morgan', display_name: 'Alex Morgan',
    gitlab_username: 'project_1_bot_x', avatar_url: 'https://gitlab.example.com/a.png',
  };

  it('takes the GitLab token identity when one resolved', () => {
    const id = _resolveIdentity({ gitlab: GITLAB, gitName: 'Git Name', osUser: 'osuser' });
    assert.equal(id.source, 'gitlab');
    assert.equal(id.display_name, 'Alex Morgan');
    assert.equal(id.person_slug, 'alex-morgan');
    assert.equal(id.gitlab_username, 'project_1_bot_x');
    assert.equal(id.avatar_url, 'https://gitlab.example.com/a.png');
  });

  it('falls back to git config when no token resolved', () => {
    const id = _resolveIdentity({ gitlab: null, gitName: 'Git Name', osUser: 'osuser' });
    assert.equal(id.source, 'git');
    assert.equal(id.display_name, 'Git Name');
    assert.equal(id.person_slug, 'git-name');
    // A local fallback must never invent a GitLab handle or avatar.
    assert.equal(id.gitlab_username, null);
    assert.equal(id.avatar_url, null);
  });

  it('falls back to the OS account when neither answers', () => {
    const id = _resolveIdentity({ osUser: 'osuser' });
    assert.equal(id.source, 'os');
    assert.equal(id.display_name, 'osuser');
  });

  it('returns null when nothing resolves (the anonymous state)', () => {
    assert.equal(_resolveIdentity({}), null);
    assert.equal(_resolveIdentity(null), null);
    assert.equal(_resolveIdentity({ gitlab: null, gitName: '  ', osUser: '' }), null);
  });

  it('slugifies Polish diacritics, including the stroked L', () => {
    assert.equal(_resolveIdentity({ gitName: 'Lukasz Zrodlo' }).person_slug, 'lukasz-zrodlo');
  });

  it('never carries an email - this repo has no email source', () => {
    const id = _resolveIdentity({ gitlab: GITLAB });
    assert.ok(!('email' in id));
  });
});

describe('_maskSecret - a preview that is never the value', () => {
  it('keeps the recognisable prefix and the last four characters', () => {
    assert.equal(_maskSecret('glpat-ABCDEFGHIJKLMNOPqrst'), 'glpat-...qrst');
  });
  it('masks a value with no prefix', () => {
    assert.equal(_maskSecret('abcdefghijkl'), '...ijkl');
  });
  it('never leaks a short value', () => {
    assert.equal(_maskSecret('abcd'), '****');
    assert.equal(_maskSecret(''), '****');
  });
  it('is ASCII only', () => {
    assert.match(_maskSecret('glpat-ABCDEFGHIJKLMNOPqrst'), /^[\x20-\x7e]+$/);
  });
});

describe('_bwNoteAssignments - a shared collection must not leak into this process', () => {
  it('accepts the keys this cockpit declares', () => {
    const note = [
      'COCKPIT_APP_TOKEN=glpat-app',
      'COCKPIT_DATA_TOKEN=glpat-data',
      'COCKPIT_OWNER_TOKEN=glpat-owner',
    ].join('\n');
    assert.deepEqual(_bwNoteAssignments(note), [
      { key: 'COCKPIT_APP_TOKEN', value: 'glpat-app', envVar: 'COCKPIT_APP_TOKEN' },
      { key: 'COCKPIT_DATA_TOKEN', value: 'glpat-data', envVar: 'COCKPIT_DATA_TOKEN' },
      { key: 'COCKPIT_OWNER_TOKEN', value: 'glpat-owner', envVar: 'COCKPIT_OWNER_TOKEN' },
    ]);
  });

  it('REJECTS keys this cockpit does not declare - the collection is shared', () => {
    // GITLAB_PO_TOKEN is deliberately NOT in this list any more: the seven data
    // sources are the upstream cockpit's own repositories, so this cockpit
    // now declares that cockpit's key names for them (see DATA_REPO_DEFS). The
    // app repo is the one that stayed separate, so its key stays foreign.
    const note = [
      'COCKPIT_APP_TOKEN=glpat-mine',
      'DATA_ENCRYPTION_KEY=deadbeef',
      'GITLAB_APP_UPDATE_TOKEN=glpat-alsoforeign',
    ].join('\n');
    const decided = _bwNoteAssignments(note);
    assert.equal(decided.filter(a => a.envVar).length, 1, 'only the declared key may be applied');
    assert.equal(decided[0].envVar, 'COCKPIT_APP_TOKEN');
    for (const foreign of ['DATA_ENCRYPTION_KEY', 'GITLAB_APP_UPDATE_TOKEN']) {
      const row = decided.find(a => a.key === foreign);
      assert.ok(row, foreign + ' must be seen');
      assert.equal(row.envVar, null, foreign + ' must never reach process.env');
    }
  });

  it('resolves a vault ITEM name used as a key through BW_ITEM_MAP', () => {
    const decided = _bwNoteAssignments('GITLAB-PERSONAL=glpat-personal');
    assert.deepEqual(decided, [
      { key: 'GITLAB-PERSONAL', value: 'glpat-personal', envVar: 'COCKPIT_OWNER_TOKEN' },
    ]);
  });

  it('skips comments, blank lines and empty values', () => {
    assert.deepEqual(_bwNoteAssignments('# comment\n\nCOCKPIT_APP_TOKEN=\nplain text'), []);
    assert.deepEqual(_bwNoteAssignments(''), []);
    assert.deepEqual(_bwNoteAssignments(null), []);
  });
});

describe('BW_ITEM_MAP / BW_DIRECT_ENV_KEYS - the borrowed personal credentials', () => {
  it('maps GITLAB-PERSONAL onto COCKPIT_OWNER_TOKEN', () => {
    const row = BW_ITEM_MAP.find(m => m.prefix === 'GITLAB-PERSONAL');
    assert.ok(row, 'the borrowed personal-token row must exist');
    assert.equal(row.envVar, 'COCKPIT_OWNER_TOKEN');
  });

  it('keeps COCKPIT-APP as this repo\'s own project token', () => {
    const row = BW_ITEM_MAP.find(m => m.prefix === 'COCKPIT-APP');
    assert.ok(row);
    assert.equal(row.envVar, 'COCKPIT_APP_TOKEN');
  });

  // The invariant worth protecting is the CLOSED SET, not any relation to
  // BW_ITEM_MAP: JIRA_TOKEN and CONFLUENCE_TOKEN are accepted without a map row
  // (suffix- and note-key-matched), so an identity assertion against the map
  // would be permanently false. Spelled out as a literal on purpose - the
  // collection is shared, and this list is what keeps another tool's variables
  // out of this process.
  it('accepts exactly these env vars from a vault note and nothing more', () => {
    assert.deepEqual([...BW_DIRECT_ENV_KEYS].sort(), [
      'AMPLITUDE_COCKPIT_API_KEY',
      'AMPLITUDE_COCKPIT_SECRET_KEY',
      'COCKPIT_APP_TOKEN',
      'COCKPIT_DATA_TOKEN',
      'COCKPIT_MODULES_TOKEN',
      'COCKPIT_OWNER_TOKEN',
      'CONFLUENCE_TOKEN',
      'FIGMA_TOKEN',
      'GEMINI_PERSONAL_TOKEN',
      'JIRA_TECH_TOKEN',
      'JIRA_TOKEN',
      'PROTO_DEPLOY_TOKEN',
    ]);
  });

  // The API-key / secret-key pairs share a stem, so the -SECRET row is a
  // strictly longer prefix of the same name. _bwMatchItem sorts by prefix
  // length; without that, an item named AMPLITUDE-COCKPIT-SECRET would land in
  // the API-key variable and every Amplitude call would silently use the wrong
  // credential.
  it('routes an Amplitude -SECRET item to the secret key, not the API key', () => {
    assert.equal(_bwMatchItem('AMPLITUDE-COCKPIT').envVar, 'AMPLITUDE_COCKPIT_API_KEY');
    assert.equal(_bwMatchItem('AMPLITUDE-COCKPIT-SECRET').envVar, 'AMPLITUDE_COCKPIT_SECRET_KEY');
  });

  it('maps the borrowed integration items onto their env vars', () => {
    assert.equal(_bwMatchItem('FIGMA').envVar, 'FIGMA_TOKEN');
    assert.equal(_bwMatchItem('COCKPIT-PROTO-DEPLOY').envVar, 'PROTO_DEPLOY_TOKEN');
    assert.equal(_bwMatchItem('GEMINI').envVar, 'GEMINI_PERSONAL_TOKEN');
  });

  it('carries no COCKPIT- name for a personal credential', () => {
    for (const key of [...BW_DIRECT_ENV_KEYS]) {
      if (/JIRA|CONFLUENCE/.test(key)) {
        assert.ok(!key.startsWith('COCKPIT_'),
          key + ' must keep its shared personal name - no COCKPIT- namespace');
      }
    }
  });

  it('matches the Jira technical account by EXACT item name only', () => {
    const row = BW_ITEM_MAP.find(m => m.envVar === 'JIRA_TECH_TOKEN');
    assert.ok(row, 'the technical-account row must exist');
    assert.equal(row.exact, true, 'a prefix row would claim any future jira-tech-* item');
    assert.equal(_bwMatchItem('jira_tech_cockpit').envVar, 'JIRA_TECH_TOKEN');
    assert.equal(_bwMatchItem('jira-tech-cockpit-old'), null);
  });

  it('has no CONFLUENCE prefix row - it would swallow CONFLUENCE_BASE_URL', () => {
    assert.equal(BW_ITEM_MAP.find(m => m.prefix.toUpperCase().startsWith('CONFLUENCE')), undefined);
    const out = _bwNoteAssignments('CONFLUENCE_BASE_URL=https://kb.example.com');
    assert.equal(out.length, 1);
    assert.equal(out[0].envVar, null, 'a base URL must never land in a token variable');
  });
});

describe('_resolveJiraToken - personal first, technical account as the fallback', () => {
  // The order is the whole point of keeping a shared account around. Personal
  // first means every Jira write lands under the person's own name; the
  // technical token only ever fills the gap for someone who has not minted one.
  const envMap = (obj) => new Map(Object.entries(obj));

  it('prefers the personal token when both are present', () => {
    assert.equal(_resolveJiraToken(envMap({ JIRA_TOKEN: 'mine', JIRA_TECH_TOKEN: 'shared' })), 'mine');
  });

  it('falls back to the technical account when no personal token is set', () => {
    assert.equal(_resolveJiraToken(envMap({ JIRA_TECH_TOKEN: 'shared' })), 'shared');
  });

  it('falls back when the personal token is present but empty', () => {
    assert.equal(_resolveJiraToken(envMap({ JIRA_TOKEN: '', JIRA_TECH_TOKEN: 'shared' })), 'shared');
  });

  it('returns an empty string when neither is set', () => {
    assert.equal(_resolveJiraToken(envMap({})), '');
    assert.equal(_resolveJiraToken(null), '');
  });
});

describe('personal Jira token - matched by the -jira item-name suffix', () => {
  it('claims an item named after the person', () => {
    assert.equal(_bwMatchItem('alex-morgan-jira').envVar, 'JIRA_TOKEN');
    assert.equal(_bwMatchItem('Alex Morgan Jira').envVar, 'JIRA_TOKEN');
  });

  it('claims a bare "jira" item too', () => {
    assert.equal(_bwMatchItem('jira').envVar, 'JIRA_TOKEN');
  });

  it('resolves the same suffix used as a note key', () => {
    const out = _bwNoteAssignments('alex-morgan-jira=abc123');
    assert.deepEqual(out, [{ key: 'alex-morgan-jira', value: 'abc123', envVar: 'JIRA_TOKEN' }]);
  });

  it('accepts the plain JIRA_TOKEN and JIRA_TECH_TOKEN note keys', () => {
    const out = _bwNoteAssignments('JIRA_TOKEN=personal\nJIRA_TECH_TOKEN=tech\nCONFLUENCE_TOKEN=conf');
    assert.deepEqual(out.map(a => a.envVar), ['JIRA_TOKEN', 'JIRA_TECH_TOKEN', 'CONFLUENCE_TOKEN']);
  });

  it('does not mistake a project token for a Jira item', () => {
    assert.equal(_bwMatchItem('COCKPIT-APP').envVar, 'COCKPIT_APP_TOKEN');
    assert.equal(_bwMatchItem('jira-board-export'), null);
  });
});

describe('_gitlabPathFromRemote - namespace/project out of any remote form', () => {
  it('handles https, ssh and credential-bearing URLs alike', () => {
    const expected = 'your-group/mission-deck';
    assert.equal(_gitlabPathFromRemote('https://gitlab.example.com/your-group/mission-deck.git'), expected);
    assert.equal(_gitlabPathFromRemote('git@gitlab.example.com:your-group/mission-deck.git'), expected);
    assert.equal(_gitlabPathFromRemote('https://oauth2:glpat-secret@gitlab.example.com/your-group/mission-deck.git'), expected);
  });
  it('returns an empty string for an empty remote', () => {
    assert.equal(_gitlabPathFromRemote(''), '');
    assert.equal(_gitlabPathFromRemote(null), '');
  });
});

describe('_sshUrlFromRemote - the SSH form of the project remote', () => {
  it('converts an HTTPS remote, with or without the .git suffix', () => {
    const expected = 'git@gitlab.example.com:your-group/mission-deck.git';
    assert.equal(_sshUrlFromRemote('https://gitlab.example.com/your-group/mission-deck.git'), expected);
    assert.equal(_sshUrlFromRemote('https://gitlab.example.com/your-group/mission-deck'), expected);
  });
  it('strips embedded credentials rather than probing with them', () => {
    assert.equal(
      _sshUrlFromRemote('https://oauth2:glpat-secret@gitlab.example.com/group/proj.git'),
      'git@gitlab.example.com:group/proj.git',
    );
  });
  it('passes an already-SSH remote through untouched', () => {
    const ssh = 'git@gitlab.example.com:group/proj.git';
    assert.equal(_sshUrlFromRemote(ssh), ssh);
  });
  it('returns an empty string for anything unusable', () => {
    assert.equal(_sshUrlFromRemote(''), '');
    assert.equal(_sshUrlFromRemote(null), '');
    assert.equal(_sshUrlFromRemote('not a url'), '');
  });
});

describe('_gitlabSlug - ASCII slug for the token name', () => {
  it('transliterates Polish diacritics', () => {
    assert.equal(_gitlabSlug('Łukasz', 'Żródło'), 'lukasz-zrodlo');
    assert.equal(_gitlabSlug('Łucja', 'Kółko'), 'lucja-kolko');
  });
  it('collapses punctuation and drops an empty half', () => {
    assert.equal(_gitlabSlug('Anna-Maria', 'Nowak'), 'anna-maria-nowak');
    assert.equal(_gitlabSlug('Jan', ''), 'jan');
    assert.equal(_gitlabSlug('', ''), '');
  });
});

describe('_expiryPlus12Months', () => {
  it('is a YYYY-MM-DD date roughly a year out', () => {
    const out = _expiryPlus12Months();
    assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
    const days = (Date.parse(out) - Date.now()) / 86400000;
    assert.ok(days > 330 && days < 400, `expected ~12 months, got ${days} days`);
  });
});

describe('_redactGlpat - no token fragment ever reaches a response or a log', () => {
  it('replaces every glpat- run', () => {
    assert.equal(
      _redactGlpat('fetch to https://oauth2:glpat-AAAA_bbb-1@gitlab.example.com failed (glpat-XYZ)'),
      'fetch to https://oauth2:[REDACTED]@gitlab.example.com failed ([REDACTED])',
    );
  });
  it('leaves clean text untouched', () => {
    assert.equal(_redactGlpat('HTTP 404: Project Not Found'), 'HTTP 404: Project Not Found');
  });
});

describe('GITLAB_TOKEN_TARGETS.modules - the catalog repo works through merge requests', () => {
  const modulesTarget = () => GITLAB_TOKEN_TARGETS.find((t) => t.id === 'modules');

  it('is present and points at the catalog repo, never at the app repo', () => {
    const t = modulesTarget();
    assert.ok(t, 'the modules target must exist');
    assert.equal(t.envVar, 'COCKPIT_MODULES_TOKEN');
    // dir: '.' would make the project path resolve from the APP repo's origin
    // and mint the token against mission-deck instead of cockpit-modules.
    assert.notEqual(t.dir, '.');
  });

  // `api` is the scope that actually permits POST /repository/branches and
  // POST /merge_requests. read_api is read-only; write_repository covers
  // git-over-HTTPS only and does NOT reach the REST API. Dropping `api` would
  // leave the token able to read the catalog and silently unable to open an MR.
  it('carries the scopes a branch and a merge request need', () => {
    const t = modulesTarget();
    assert.ok(t.scopes.includes('api'), 'creating a merge request needs the api scope');
    assert.ok(t.scopes.includes('write_repository'),
      'pushing a branch to an HTTPS remote needs write_repository');
    assert.ok(t.scopes.includes('read_api'), 'reading /repository/tree needs read_api');
    assert.ok(t.scopes.includes('read_repository'), 'reading raw files needs read_repository');
  });

  // Developer, not Maintainer, on purpose: with main protected a Developer can
  // open a merge request but cannot push to main, so the review step is
  // enforced by the platform rather than by convention.
  it('stays at Developer so protected main still forces a merge request', () => {
    assert.equal(modulesTarget().defaultAccessLevel, 30);
  });

  // The activity loops fail the whole badge on the first unreachable target,
  // and the catalog repo is not reachable for everyone.
  it('stays out of the GitLab activity loops', () => {
    assert.equal(modulesTarget().activity, false);
  });
});

describe('GITLAB_TOKEN_TARGET - one repo, the scopes an HTTPS origin needs', () => {
  // Regression guard. `origin` here is HTTPS and pushes go through
  // oauth2:<token>@, which write_repository governs and `api` does NOT cover.
  // Drop the scope and the token verifies fine, fetches fine, opens merge
  // requests fine, and fails only at push - so only a test can hold it.
  it('includes write_repository - the HTTPS push scope', () => {
    assert.ok(GITLAB_TOKEN_TARGET.scopes.includes('write_repository'),
      'an HTTPS origin cannot push without write_repository');
  });

  it('carries the scopes and the env var the spec fixes', () => {
    assert.deepEqual(GITLAB_TOKEN_TARGET.scopes, ['api', 'read_api', 'read_repository', 'write_repository']);
    assert.equal(GITLAB_TOKEN_TARGET.envVar, 'COCKPIT_APP_TOKEN');
    assert.equal(GITLAB_TOKEN_TARGET.nameSuffix, 'COCKPIT-APP');
    assert.equal(GITLAB_TOKEN_TARGET.bwItem, 'COCKPIT-APP');
  });
});

describe('GITLAB_TOKEN_TARGETS - the app repo, the team data repo and the modules catalog', () => {
  it('offers exactly the app repo, the data repo and the modules catalog, app first', () => {
    // App FIRST is load-bearing: it is what a create with no `target` resolves
    // to, and what the Keys tab paints as the primary card. An additional data
    // source declared in DATA_REPO_DEFS appends its own row after these three.
    assert.deepEqual(GITLAB_TOKEN_TARGETS.map(t => t.id), ['app', 'data', 'modules']);
    assert.equal(GITLAB_TOKEN_TARGET, GITLAB_TOKEN_TARGETS[0]);
  });

  it('gives the data repo the narrower scope set - it never calls REST', () => {
    // Every data-repo operation is git-over-HTTPS (clone, fetch, ls-remote,
    // pull, push). Copying the app target's `api`/`read_api` across would hand
    // out reach nothing uses.
    const data = GITLAB_TOKEN_TARGETS.find(t => t.id === 'data');
    assert.deepEqual(data.scopes, ['read_repository', 'write_repository']);
    assert.equal(data.envVar, 'COCKPIT_DATA_TOKEN');
    assert.equal(data.bwItem, 'COCKPIT-DATA');
    assert.equal(data.nameSuffix, 'COCKPIT-DATA');
  });

  it('defaults the data repo to Maintainer and the app repo to Developer', () => {
    // Sync pushes to the data repo's DEFAULT branch, which a protected branch
    // refuses a Developer - and only at push time. The app repo needs no such
    // thing: it pushes work branches and opens MRs.
    assert.equal(GITLAB_TOKEN_TARGETS.find(t => t.id === 'app').defaultAccessLevel, 30);
    assert.equal(GITLAB_TOKEN_TARGETS.find(t => t.id === 'data').defaultAccessLevel, 40);
  });

  it('names each target after its vault item', () => {
    for (const t of GITLAB_TOKEN_TARGETS) {
      assert.match(t.envVar, /^COCKPIT_/, t.id);
      assert.match(t.bwItem, /^COCKPIT-/, t.id);
      // The item name is what the token is minted under, so the two must
      // never drift apart.
      assert.equal(t.nameSuffix, t.bwItem, t.id + ': token name must follow the vault item');
    }
  });

  it('resolves the data repo URL to the canonical remote by default', () => {
    // The env var may be unset; the target must still name a real project.
    const data = GITLAB_TOKEN_TARGETS.find(t => t.id === 'data');
    assert.equal(data.resolveUrl(), DATA_TIER_0_CANONICAL_URL);
    assert.match(DATA_TIER_0_CANONICAL_URL, /\/mission-deck-data\.git$/);
  });
});

describe('_gitlabTargetById - an omitted target means the app repo', () => {
  it('falls back to the app repo for an empty id', () => {
    assert.equal(_gitlabTargetById('').id, 'app');
    assert.equal(_gitlabTargetById(undefined).id, 'app');
  });
  it('resolves a named target', () => {
    assert.equal(_gitlabTargetById('data').envVar, 'COCKPIT_DATA_TOKEN');
  });
  it('returns null for an unknown id rather than guessing', () => {
    // Guessing here would mint a token against the wrong project.
    assert.equal(_gitlabTargetById('nope'), null);
  });
});

describe('_stripTokenNameSuffix - one person, whichever token they hold', () => {
  it('strips every tier suffix the cockpit mints', () => {
    assert.equal(_stripTokenNameSuffix('jordan-lee-COCKPIT-APP'), 'jordan-lee');
    assert.equal(_stripTokenNameSuffix('jordan-lee-COCKPIT-DATA'), 'jordan-lee');
  });
  it('is case-insensitive, because a token can be renamed in GitLab', () => {
    assert.equal(_stripTokenNameSuffix('jordan-lee-cockpit-data'), 'jordan-lee');
  });
  it('leaves an unrecognised name alone', () => {
    assert.equal(_stripTokenNameSuffix('anna-data'), 'anna-data');
    assert.equal(_stripTokenNameSuffix(''), '');
  });
});

// ── Bitwarden item matching: separator-insensitive ──────────────────────────
// The documented item names use hyphens, but a person may well type
// COCKPIT_APP. A miss there produces the worst symptom available: an unlock
// that reports success and loads nothing.
describe('_bwNormalizeItemName', () => {
  it('treats -, _ and space as the same separator', () => {
    assert.equal(_bwNormalizeItemName('COCKPIT-APP'), _bwNormalizeItemName('COCKPIT_APP'));
    assert.equal(_bwNormalizeItemName('COCKPIT-APP'), _bwNormalizeItemName('cockpit app'));
    assert.equal(_bwNormalizeItemName(' Cockpit__App '), 'cockpit-app');
  });

  it('keeps distinct names distinct (the DATA-TIER-1 vs -10 trap)', () => {
    assert.notEqual(_bwNormalizeItemName('DATA-TIER-1'), _bwNormalizeItemName('DATA-TIER-10'));
  });
});

describe('vault note keys survive an underscore spelling', () => {
  it('COCKPIT_APP= resolves to the app token', () => {
    const out = _bwNoteAssignments('COCKPIT_APP=glpat-abc');
    assert.equal(out.length, 1);
    assert.equal(out[0].envVar, 'COCKPIT_APP_TOKEN');
  });

  it('GITLAB_PERSONAL_TOKEN= resolves to the owner token', () => {
    const out = _bwNoteAssignments('GITLAB_PERSONAL_TOKEN=glpat-xyz');
    assert.equal(out[0].envVar, 'COCKPIT_OWNER_TOKEN');
  });

  it('a foreign key still resolves to nothing', () => {
    // The upstream cockpit's APP-repo token: a different repository, so it
    // must never reach this process. Its DATA-repo keys are a different story -
    // those repositories are shared, and this cockpit declares them.
    const out = _bwNoteAssignments('GITLAB_APP_UPDATE_TOKEN=glpat-nope');
    assert.equal(out[0].envVar, null);
  });
});

// Regression guard for the whole point of this cockpit's sync: every git
// operation authenticates with a project token this application was given, and
// with nothing else. The only place a token can be injected is an HTTPS remote
// with no userinfo of its own, so that shape IS the policy - and it has to be
// checked against what git actually resolves, because the failure mode is
// silent success rather than an error. An SSH origin does not refuse a push, it
// signs it with the person's own key; an origin carrying an embedded credential
// signs it with that credential. Neither shows up in a log.
describe('_isCleanHttpsRemote - the only remote shape a cockpit token can ride', () => {
  it('accepts an HTTPS remote with no userinfo', () => {
    assert.equal(_isCleanHttpsRemote('https://gitlab.example.com/group/proj.git'), true);
  });

  it('rejects every SSH form - it would authenticate with the person own key', () => {
    assert.equal(_isCleanHttpsRemote('git@gitlab.example.com:group/proj.git'), false);
    assert.equal(_isCleanHttpsRemote('ssh://git@gitlab.example.com/group/proj.git'), false);
  });

  it('rejects an embedded credential - it would authenticate with that one', () => {
    assert.equal(_isCleanHttpsRemote('https://oauth2:glpat-secret@gitlab.example.com/group/proj.git'), false);
    assert.equal(_isCleanHttpsRemote('https://someone@gitlab.example.com/group/proj.git'), false);
  });

  it('rejects anything that is not HTTPS at all', () => {
    assert.equal(_isCleanHttpsRemote('git://gitlab.example.com/group/proj.git'), false);
    assert.equal(_isCleanHttpsRemote('http://gitlab.example.com/group/proj.git'), false);
    assert.equal(_isCleanHttpsRemote('/tmp/local-clone'), false);
    assert.equal(_isCleanHttpsRemote(''), false);
    assert.equal(_isCleanHttpsRemote(null), false);
  });

  // The configured URL is what _sanitizeSubRepoOrigin repairs a bad origin TO,
  // so a descriptor whose own URL failed this check would make the repair a
  // no-op and leave the refusal as the only outcome.
  it('accepts the canonical URL of every data source, so the repair can land', () => {
    for (const d of DATA_REPOS) {
      assert.equal(_isCleanHttpsRemote(d.canonicalUrl), true, d.id + ': ' + d.canonicalUrl);
    }
  });

  // _repoRemoteUrl runs a configured DATA_*_REPO_URL through _sshToHttps, so an
  // operator who pastes an SSH address into .env still gets an HTTPS remote
  // rather than a source that silently syncs over their key.
  it('accepts what _sshToHttps makes of an SSH address pasted into .env', () => {
    for (const d of DATA_REPOS) {
      const ssh = d.canonicalUrl.replace(/^https:\/\/([^/]+)\//, 'git@$1:');
      assert.equal(_isCleanHttpsRemote(_sshToHttps(ssh)), true, d.id);
    }
  });
});
