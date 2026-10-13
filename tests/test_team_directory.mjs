// Unit tests for the team directory: the build script's name/photo rules
// (scripts/build-team-directory.js) and the runtime resolver (js/team-directory.js).
// Run: node --test tests/test_team_directory.mjs
//
// js/team-directory.js touches the network only inside loadTeamDirectory(), so
// the module imports under plain Node; __testSetMembers() fills the cache.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  fullName,
  memberByName,
  memberByEmail,
  memberById,
  memberAvatarUrl,
  avatarUrlForName,
  memberInitials,
  getTeamMembers,
  loadTeamDirectory,
  __testSetMembers,
} from '../js/team-directory.js';

const require = createRequire(import.meta.url);
const {
  slugifyName,
  surnameKeyFromEmail,
  splitName,
  avatarSlugCandidates,
} = require('../scripts/build-team-directory.js');

// ── slugifyName ───────────────────────────────────────────────────────────────

describe('slugifyName - one ASCII key per person name', () => {
  it('folds diacritics, including l with stroke', () => {
    assert.equal(slugifyName('Renée Ångström'), 'reneeangstrom');
    assert.equal(slugifyName('Łana Brooks'), 'lanabrooks');
    assert.equal(slugifyName('Casey Ölmez'), 'caseyolmez');
  });

  it('drops spaces, hyphens and dots', () => {
    assert.equal(slugifyName('Alex Morgan-Rivera'), 'alexmorganrivera');
    assert.equal(slugifyName('  Sam   Rivera  '), 'samrivera');
  });

  it('is empty for empty input', () => {
    assert.equal(slugifyName(''), '');
    assert.equal(slugifyName(null), '');
  });
});

// ── surnameKeyFromEmail ───────────────────────────────────────────────────────

describe('surnameKeyFromEmail - the surname the mailbox spells', () => {
  it('reads surname.firstname', () => {
    assert.equal(surnameKeyFromEmail('angstrom.renee@example.com'), 'angstrom');
    assert.equal(surnameKeyFromEmail('rivera.sam@example.com'), 'rivera');
  });

  it('drops the disambiguating digit', () => {
    assert.equal(surnameKeyFromEmail('lee2.jordan@example.com'), 'lee');
    assert.equal(surnameKeyFromEmail('Kim2.Taylor@example.com'), 'kim');
  });

  it('skips a contract code and reads <initial>.<surname>', () => {
    assert.equal(surnameKeyFromEmail('bs.a.morgan@example.com'), 'morgan');
    assert.equal(surnameKeyFromEmail('7n.c.novak@example.com'), 'novak');
    assert.equal(surnameKeyFromEmail('i2s.p.brooks@example.com'), 'brooks');
  });

  it('handles a hyphenated surname and a bare local part', () => {
    assert.equal(surnameKeyFromEmail('morgan-rivera.alex@example.com'), 'morganrivera');
    assert.equal(surnameKeyFromEmail('novak@example.com'), 'novak');
  });

  it('says nothing about an empty mailbox', () => {
    assert.equal(surnameKeyFromEmail(''), '');
    assert.equal(surnameKeyFromEmail(null), '');
  });
});

// ── splitName ─────────────────────────────────────────────────────────────────

describe('splitName - first and last name out of one string', () => {
  it('keeps the usual order when the mailbox confirms it', () => {
    const r = splitName('Renée Ångström', 'angstrom.renee@example.com');
    assert.equal(r.first_name, 'Renée');
    assert.equal(r.last_name, 'Ångström');
    assert.equal(r.source, 'email');
  });

  it('swaps a record written surname-first', () => {
    const r = splitName('Novak Casey', 'novak.casey@example.com');
    assert.equal(r.first_name, 'Casey');
    assert.equal(r.last_name, 'Novak');
    assert.equal(r.source, 'email-reversed');
  });

  it('keeps a hyphenated surname whole', () => {
    const r = splitName('Alex Morgan-Rivera', 'morgan-rivera.alex@example.com');
    assert.equal(r.first_name, 'Alex');
    assert.equal(r.last_name, 'Morgan-Rivera');
  });

  it('keeps a multi-token surname whole', () => {
    const r = splitName('Taylor Jo Kim', 'kim.taylor@example.com');
    assert.equal(r.first_name, 'Taylor');
    assert.equal(r.last_name, 'Jo Kim');
  });

  it('falls back to "first last" with no mailbox and says so', () => {
    const r = splitName('Sam Rivera', '');
    assert.equal(r.first_name, 'Sam');
    assert.equal(r.last_name, 'Rivera');
    assert.equal(r.source, 'order');
  });

  it('handles a one-token and an empty name', () => {
    assert.deepEqual(splitName('Cher', ''), { first_name: '', last_name: 'Cher', source: 'single' });
    assert.deepEqual(splitName('', ''), { first_name: '', last_name: '', source: 'empty' });
  });
});

// ── avatarSlugCandidates ──────────────────────────────────────────────────────

describe('avatarSlugCandidates - every file name worth trying', () => {
  it('offers both orders, most likely first', () => {
    const c = avatarSlugCandidates('Jordan', 'Lee');
    assert.equal(c[0], 'jordanlee');
    assert.ok(c.includes('leejordan'));
  });

  it('offers the first segment of a hyphenated surname', () => {
    const c = avatarSlugCandidates('Casey', 'Novak-Ångström');
    assert.ok(c.includes('caseynovakangstrom'));
    assert.ok(c.includes('caseynovak'));
  });

  it('offers the last token of a multi-token surname', () => {
    const c = avatarSlugCandidates('Taylor', 'Jo Kim');
    assert.ok(c.includes('taylorkim'));
  });

  it('never repeats a candidate', () => {
    const c = avatarSlugCandidates('Sam', 'Rivera');
    assert.equal(new Set(c).size, c.length);
  });
});

// ── runtime resolver ──────────────────────────────────────────────────────────

const FIXTURE = [
  {
    id: 'tm-1', first_name: 'Renée', last_name: 'Ångström',
    role: 'Manager', team: 'Guests', email: 'angstrom.renee@example.com',
    avatar: 'reneeangstrom.png',
  },
  {
    id: 'tm-2', first_name: 'Alex', last_name: 'Morgan-Rivera',
    role: 'Product Manager', team: 'Borealis', email: 'morgan-rivera.alex@example.com',
    avatar: 'alex morgan.png',
  },
  {
    id: 'tm-3', first_name: 'Jordan', last_name: 'Lee',
    role: 'Developer', team: 'Atlas', email: 'lee.jordan@example.com', avatar: '',
  },
];

describe('memberByName - every spelling a person reaches this app under', () => {
  it('matches the exact name', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberByName('Renée Ångström').id, 'tm-1');
  });

  it('matches without diacritics and regardless of case', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberByName('renee angstrom').id, 'tm-1');
    assert.equal(memberByName('RENEE ANGSTROM').id, 'tm-1');
  });

  it('matches the surname-first spelling', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberByName('Ångström Renée').id, 'tm-1');
    assert.equal(memberByName('Lee Jordan').id, 'tm-3');
  });

  it('strips a contract code, in front and behind', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberByName('BS Jordan Lee').id, 'tm-3');
    assert.equal(memberByName('Jordan Lee CTR').id, 'tm-3');
    assert.equal(memberByName('I2S Jordan Lee').id, 'tm-3');
  });

  it('strips a parenthesised suffix', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberByName('Jordan Lee (Atlas)').id, 'tm-3');
  });

  it('matches a hyphenated surname both ways round', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberByName('Alex Morgan-Rivera').id, 'tm-2');
    assert.equal(memberByName('Morgan-Rivera Alex').id, 'tm-2');
  });

  // A git identity may read "Alex Morgan Rivera": a space, not the hyphen
  // the directory carries. The top bar's "Active" list showed
  // initials for such a person until the comparison stopped caring about the separator.
  it('matches a double surname spelled with a space or a dash instead of the hyphen', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberByName('Alex Morgan Rivera').id, 'tm-2');
    assert.equal(memberByName('alex morgan rivera').id, 'tm-2');
    assert.equal(memberByName('Morgan Rivera Alex').id, 'tm-2');
    assert.equal(memberByName('Alex Morgan \u2013 Rivera').id, 'tm-2');
    assert.equal(memberByName('BS Alex Morgan Rivera').id, 'tm-2');
    assert.equal(memberInitials('Alex Morgan Rivera'), memberInitials('Alex Morgan-Rivera'));
    assert.ok(avatarUrlForName('Alex Morgan Rivera'));
  });

  it('returns null for an unknown name and for empty input', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberByName('Some Stranger'), null);
    assert.equal(memberByName(''), null);
    assert.equal(memberByName(null), null);
  });

  it('returns null on an empty directory instead of throwing', () => {
    __testSetMembers([]);
    assert.equal(memberByName('Jordan Lee'), null);
    assert.deepEqual(getTeamMembers(), []);
  });
});

describe('memberByEmail / memberById', () => {
  it('matches a mailbox case-insensitively', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberByEmail('LEE.JORDAN@example.com').id, 'tm-3');
    assert.equal(memberByEmail('nobody@example.com'), null);
  });

  it('matches the directory id', () => {
    __testSetMembers(FIXTURE);
    assert.equal(fullName(memberById('tm-1')), 'Renée Ångström');
    assert.equal(memberById('tm-999'), null);
  });
});

describe('avatar URLs and initials', () => {
  it('builds the data-repo URL and encodes the file name', () => {
    __testSetMembers(FIXTURE);
    assert.equal(
      memberAvatarUrl(FIXTURE[0]),
      '/data-sub-repositories/ds-data/team/avatars/reneeangstrom.png',
    );
    assert.equal(
      memberAvatarUrl(FIXTURE[1]),
      '/data-sub-repositories/ds-data/team/avatars/alex%20morgan.png',
    );
  });

  it('is empty for a member with no photo and for no member at all', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberAvatarUrl(FIXTURE[2]), '');
    assert.equal(memberAvatarUrl(null), '');
    assert.equal(avatarUrlForName('Some Stranger'), '');
  });

  it('resolves a photo straight from a messy name', () => {
    __testSetMembers(FIXTURE);
    assert.equal(
      avatarUrlForName('BS angstrom renee'),
      '/data-sub-repositories/ds-data/team/avatars/reneeangstrom.png',
    );
  });

  it('prefers the directory spelling for initials', () => {
    __testSetMembers(FIXTURE);
    assert.equal(memberInitials('BS jordan lee'), 'JL');
    assert.equal(memberInitials('Some Stranger'), 'SS');
  });
});

// ── loadTeamDirectory: a miss is not cached ──────────────────────────────────
// The top bar asks for the roster the moment the page opens; on a fresh install
// that is before the data repo is cloned or decrypted. Remembering that 404 for
// the whole session left the leave calendar on initials until an F5.
describe('loadTeamDirectory - a 404 is asked again, a hit is cached', () => {
  it('refetches after a miss without force, and stops fetching once it has an answer', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    let answer = { ok: false, json: async () => null };
    globalThis.fetch = async () => { calls++; return answer; };
    try {
      __testSetMembers([], false); // never answered yet
      const miss = await loadTeamDirectory(true);
      assert.deepEqual(miss, []);
      assert.equal(calls, 1);

      const again = await loadTeamDirectory();
      assert.deepEqual(again, []);
      assert.equal(calls, 2, 'a miss must not be cached');

      answer = { ok: true, json: async () => ({ team_members: [{ id: 'sam-rivera', first_name: 'Sam', last_name: 'Rivera' }] }) };
      const hit = await loadTeamDirectory();
      assert.equal(hit.length, 1);
      assert.equal(calls, 3);

      await loadTeamDirectory();
      assert.equal(calls, 3, 'a hit is cached');
      assert.equal(getTeamMembers().length, 1);

      // A forced reload that fails (network blip, 404 mid-sync) must not wipe
      // the roster the session already has - avatars would vanish until the
      // next successful load.
      answer = { ok: false, json: async () => null };
      const kept = await loadTeamDirectory(true);
      assert.equal(calls, 4);
      assert.equal(kept.length, 1, 'a miss after a hit keeps the members');
      await loadTeamDirectory();
      assert.equal(calls, 4, 'and the hit stays cached');
    } finally {
      globalThis.fetch = realFetch;
      __testSetMembers([]);
    }
  });
});
