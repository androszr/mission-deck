#!/usr/bin/env node
'use strict';
// scripts/build-team-directory.js
// Builds the team directory of the data repo: one simple JSON plus the folder
// of photos next to it.
//
//   <out>/team-members.json   { generated_at, source, team_members: [...] }
//   <out>/avatars/<file>      one image per member that has one
//
// A member record carries exactly what a person needs to be shown:
//   id, first_name, last_name, role, team, email, avatar
//
// The two hard parts are both here, so no consumer has to repeat them:
//
//   1. Splitting one `name` string into imie + nazwisko. Plain "first token is
//      the first name" is wrong for the records written surname-first. The
//      corporate mailbox settles it: the local part is nazwisko.imie, or
//      <role>.<initial>.nazwisko, so the surname can be read out of the e-mail
//      and matched against the tokens of the name whatever their order.
//   2. Matching a person to a photo file. The file names are the slugified
//      name with no separators, sometimes in the reverse order, sometimes only
//      the first segment of a hyphenated surname.
//
// Names the two rules cannot settle live in NAME_EXCEPTIONS / AVATAR_EXCEPTIONS
// below - that is the one place to add a person by hand.
//
// The output directory is inside the data repo (a separate git repository):
// this script only writes files there, it never runs git.
//
// Exit: 0 clean, 1 blocking findings, 2 usage or internal error.
//
// ASCII-only source: the Polish letters this file folds are written as \uXXXX.

const fs = require('fs');
const path = require('path');
const R = require('./_report');

const HELP = `
build-team-directory.js - build the team directory (JSON + avatars) of the data repo

Usage:
  node scripts/build-team-directory.js --source <dir> [--out <dir>]
                                       [--include-ended] [--dry-run] [--json]

  --source        directory holding team-members.json and the photo folder
                  (default: $TEAM_SOURCE_DIR)
  --avatars-dir   photo folder name inside --source (default: team_avatars)
  --out           target directory (default: data-sub-repositories/ds-data/team)
  --include-ended keep members flagged as no longer on the team
  --dry-run       report only, write nothing

Exit codes: 0 clean, 1 blocking findings, 2 usage or internal error.
`;

const DEFAULT_OUT = path.join('data-sub-repositories', 'ds-data', 'team');
const DEFAULT_AVATARS_DIR = 'team_avatars';
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];

// Mailbox prefixes that carry a contract or unit code rather than a name.
// Same vocabulary the runtime resolver strips from a display name.
const ROLE_CODES = new Set([
  'bs', 'bd', 'ctr', '7n', 'i2s', 'bri', 'awa', 'dt', 'lg',
]);

// People the e-mail rule cannot settle (no mailbox, or a mailbox that does not
// contain the surname). Keyed by the `name` field exactly as the source spells
// it. This is the escape hatch - add a row rather than bending the rules.
const NAME_EXCEPTIONS = {
  // 'Jordan Lee': { first_name: 'Jordan', last_name: 'Lee' },
};

// People whose photo file cannot be derived from the name.
const AVATAR_EXCEPTIONS = {
  // 'Jordan Lee': 'jordanlee.png',
};

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

/**
 * Lowercase ASCII slug of a person name: no spaces, no hyphens, no diacritics.
 * l-with-stroke has no decomposed form, so it is folded before NFD.
 * @param {string} s
 * @returns {string}
 */
function slugifyName(s) {
  if (!s) return '';
  return String(s)
    .replace(/\u0142/g, 'l')   // l with stroke, lowercase
    .replace(/\u0141/g, 'l')   // L with stroke, uppercase
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// imie / nazwisko
// ---------------------------------------------------------------------------

/**
 * The surname as the mailbox spells it, or '' when the mailbox says nothing.
 * Handles nazwisko.imie, nazwisko2.imie, <role>.<initial>.nazwisko and a bare
 * surname.
 * @param {string} email
 * @returns {string}
 */
function surnameKeyFromEmail(email) {
  if (!email) return '';
  const local = String(email).split('@')[0].toLowerCase();
  const segments = local
    .split('.')
    .map((s) => s.replace(/[0-9]+$/, ''))
    .filter((s) => s && !ROLE_CODES.has(s))
    .map((s) => slugifyName(s));
  if (segments.length === 0) return '';
  if (segments.length === 1) return segments[0];
  // "<initial>.<nazwisko>" puts the surname last, everything else puts it first.
  return segments[0].length === 1 ? segments[1] : segments[0];
}

/** True when two slugs name the same surname (one may be truncated). */
function sameSurname(a, b) {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Split one display name into imie + nazwisko.
 * @param {string} name
 * @param {string} email
 * @returns {{first_name: string, last_name: string, source: string}}
 */
function splitName(name, email) {
  const raw = String(name || '').trim();
  const exception = NAME_EXCEPTIONS[raw];
  if (exception) {
    return { first_name: exception.first_name, last_name: exception.last_name, source: 'exception' };
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { first_name: '', last_name: '', source: 'empty' };
  if (tokens.length === 1) return { first_name: '', last_name: tokens[0], source: 'single' };

  const forward = { first_name: tokens[0], last_name: tokens.slice(1).join(' ') };
  const reversed = { first_name: tokens[tokens.length - 1], last_name: tokens.slice(0, -1).join(' ') };

  const key = surnameKeyFromEmail(email);
  if (key) {
    if (sameSurname(slugifyName(forward.last_name), key)) {
      return Object.assign({ source: 'email' }, forward);
    }
    if (sameSurname(slugifyName(reversed.last_name), key)) {
      return Object.assign({ source: 'email-reversed' }, reversed);
    }
  }
  // No mailbox, or a mailbox that names neither token: assume "imie nazwisko".
  return Object.assign({ source: 'order' }, forward);
}

// ---------------------------------------------------------------------------
// Avatar file
// ---------------------------------------------------------------------------

/**
 * Every file-name slug worth trying for one person, most likely first.
 * @param {string} firstName
 * @param {string} lastName
 * @returns {string[]}
 */
function avatarSlugCandidates(firstName, lastName) {
  const out = [];
  const push = (v) => { if (v && !out.includes(v)) out.push(v); };
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();

  push(slugifyName(first + last));
  push(slugifyName(last + first));

  // Hyphenated compound surname stored under its first segment only.
  if (last.includes('-')) {
    const head = last.split('-')[0];
    push(slugifyName(first + head));
    push(slugifyName(head + first));
  }
  // Multi-token surname stored under its last token only.
  const lastTokens = last.split(/\s+/).filter(Boolean);
  if (lastTokens.length > 1) {
    const tail = lastTokens[lastTokens.length - 1];
    push(slugifyName(first + tail));
    push(slugifyName(tail + first));
  }
  return out;
}

/**
 * Index the photo folder by slug: <slug> -> file name.
 * @param {string} dir
 * @returns {Map<string, string>}
 */
function indexAvatars(dir) {
  const index = new Map();
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_e) { return index; }
  for (const file of entries) {
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXT.includes(ext)) continue;
    const slug = slugifyName(path.basename(file, ext));
    if (!index.has(slug)) index.set(slug, file);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function writeJsonAtomic(target, value) {
  const tmp = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, target);
}

function main() {
  const { flags } = R.parseArgs(process.argv.slice(2), {
    booleans: ['dry-run', 'include-ended'],
  });
  if (flags.help) R.showHelp(HELP);

  const source = flags.source || process.env.TEAM_SOURCE_DIR;
  if (!source) R.usageError('--source <dir> is required (or set TEAM_SOURCE_DIR)');

  const sourceDir = path.resolve(String(source));
  const membersPath = path.join(sourceDir, 'team-members.json');
  const avatarsDirName = flags['avatars-dir'] ? String(flags['avatars-dir']) : DEFAULT_AVATARS_DIR;
  const sourceAvatars = path.join(sourceDir, avatarsDirName);
  const outDir = path.resolve(R.ROOT, flags.out ? String(flags.out) : DEFAULT_OUT);
  const outAvatars = path.join(outDir, 'avatars');
  const dryRun = Boolean(flags['dry-run']);

  let source_json;
  try {
    source_json = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
  } catch (e) {
    R.usageError('cannot read ' + membersPath + ': ' + e.message);
  }
  const sourceMembers = Array.isArray(source_json)
    ? source_json
    : (source_json.team_members || source_json.members || []);
  if (!Array.isArray(sourceMembers) || sourceMembers.length === 0) {
    R.usageError('no members found in ' + membersPath);
  }

  const report = new R.Report('build-team-directory', {
    source: path.relative(R.ROOT, membersPath) || membersPath,
    out: path.relative(R.ROOT, outDir) || outDir,
    dry_run: dryRun,
  });

  const avatarIndex = indexAvatars(sourceAvatars);
  if (avatarIndex.size === 0) {
    report.warn({
      rule: 'avatars',
      file: sourceAvatars,
      message: 'photo folder is empty or missing - every member will be written without an avatar',
      fix: 'point --avatars-dir at the folder that holds the photos',
    });
  }

  const members = [];
  const usedFiles = new Set();
  let skippedEnded = 0;
  const noAvatar = [];
  const guessedOrder = [];
  const oddAvatar = [];

  for (const src of sourceMembers) {
    const name = String(src.name || '').trim();
    if (!name) continue;
    if (src.ended && !flags['include-ended']) { skippedEnded++; continue; }

    const email = String(src.email || '').trim();
    const split = splitName(name, email);
    if (split.source === 'order' && !email) guessedOrder.push(name);

    let avatarFile = AVATAR_EXCEPTIONS[name] || '';
    if (avatarFile && !avatarIndex.has(slugifyName(path.basename(avatarFile, path.extname(avatarFile))))) {
      report.warn({
        rule: 'avatar-exception',
        message: 'AVATAR_EXCEPTIONS names a file that does not exist: ' + name + ' -> ' + avatarFile,
        fix: 'fix the entry in AVATAR_EXCEPTIONS or drop it',
      });
      avatarFile = '';
    }
    if (!avatarFile && src.avatar) {
      const ext = path.extname(String(src.avatar));
      const known = avatarIndex.get(slugifyName(path.basename(String(src.avatar), ext)));
      if (known) avatarFile = known;
    }
    if (!avatarFile) {
      for (const slug of avatarSlugCandidates(split.first_name, split.last_name)) {
        const hit = avatarIndex.get(slug);
        if (hit) { avatarFile = hit; break; }
      }
    }
    if (!avatarFile) {
      noAvatar.push(name);
    } else {
      usedFiles.add(avatarFile);
      // A file whose slug does not carry both halves of the name is either a
      // typo in the source or somebody else's photo. Never silent.
      const fileSlug = slugifyName(path.basename(avatarFile, path.extname(avatarFile)));
      const firstSlug = slugifyName(split.first_name);
      const lastSlug = slugifyName(String(split.last_name).split(/[\s-]+/)[0]);
      if ((firstSlug && !fileSlug.includes(firstSlug)) || (lastSlug && !fileSlug.includes(lastSlug))) {
        oddAvatar.push(name + ' -> ' + avatarFile);
      }
    }

    members.push({
      id: String(src.id || 'tm-' + slugifyName(name)),
      first_name: split.first_name,
      last_name: split.last_name,
      role: String(src.role || '').trim(),
      team: String(src.team || '').trim(),
      email,
      avatar: avatarFile,
    });
  }

  members.sort((a, b) => {
    const l = a.last_name.localeCompare(b.last_name, 'pl');
    return l !== 0 ? l : a.first_name.localeCompare(b.first_name, 'pl');
  });

  const payload = {
    generated_at: new Date().toISOString(),
    source: path.basename(membersPath),
    team_members: members,
  };

  if (!dryRun) {
    try {
      fs.mkdirSync(outAvatars, { recursive: true });
      for (const file of usedFiles) {
        fs.copyFileSync(path.join(sourceAvatars, file), path.join(outAvatars, file));
      }
      writeJsonAtomic(path.join(outDir, 'team-members.json'), payload);
    } catch (e) {
      R.fail('cannot write the directory: ' + e.message);
    }
  }

  report.meta.members = members.length;
  report.meta.avatars = usedFiles.size;
  report.meta.skipped_ended = skippedEnded;
  report.info('members written: ' + members.length + ', photos copied: ' + usedFiles.size);
  if (skippedEnded > 0) {
    report.info('skipped ' + skippedEnded + ' member(s) flagged as no longer on the team (--include-ended keeps them)');
  }
  if (guessedOrder.length > 0) {
    report.warn({
      rule: 'name-order',
      message: 'no e-mail to confirm the name order, assumed "imie nazwisko": ' + guessedOrder.join(', '),
      fix: 'add a row to NAME_EXCEPTIONS when one of these is written surname-first',
    });
  }
  if (oddAvatar.length > 0) {
    report.warn({
      rule: 'avatar-mismatch',
      message: 'photo file name does not match the person, check by hand: ' + oddAvatar.join(', '),
      fix: 'confirm the photo, then pin it with a row in AVATAR_EXCEPTIONS',
    });
  }
  if (noAvatar.length > 0) {
    report.note({
      rule: 'no-avatar',
      message: 'no photo found for ' + noAvatar.length + ' member(s): ' + noAvatar.join(', '),
      fix: 'drop the file into the source photo folder, or add a row to AVATAR_EXCEPTIONS',
    });
  }

  report.emit(flags, 'BUILD TEAM DIRECTORY');
}

if (require.main === module) main();

module.exports = { slugifyName, surnameKeyFromEmail, splitName, avatarSlugCandidates, indexAvatars };
