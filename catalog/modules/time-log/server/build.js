'use strict';
// modules/time-log/server/build.js
// Aggregates Tempo worklogs + the team roster into the on-disk shape this
// module writes. Pure: no fs,
// no clock read beyond the `now` passed in by the caller.
//
// TEAMS is a COPY of the same constant in client/time-log-lib.js (CJS
// server code cannot import the ESM client) - tests/test_time_log.mjs
// asserts the two stay identical.

const { isPlHoliday } = require('./calendar.js');
const { buildAuthorIndex, matchAuthor, personSlug, displayShort } = require('./match.js');

const TEAMS = ['Atlas', 'Borealis', 'Comet', 'Delta', 'Echo', 'Falcon'];

// People tracked regardless of team (e.g. incident managers who log time but
// belong to none of the six teams). Empty by default; config.json may list
// mailboxes under `trackedEmails`. Matched by mailbox, the same key the roster
// and Tempo authors are matched on. Server-only: the client reads team off
// each shard, so this list needs no client copy.
const ALWAYS_TRACKED_EMAILS = Object.freeze([]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

/** Pure: validates the `trackedEmails` list of config.json (lower-cased). */
function readTrackedEmails(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.trackedEmails)) return ALWAYS_TRACKED_EMAILS.slice();
  return raw.trackedEmails
    .filter((e) => typeof e === 'string' && EMAIL_RE.test(e.trim()))
    .map((e) => e.trim().toLowerCase());
}

const LOGGED_AT_KEYS = ['dateCreated', 'createdAt', 'created'];
const UPDATED_AT_KEYS = ['dateUpdated', 'updatedAt', 'updated'];

function resolveTs(wl, keys) {
  for (const k of keys) {
    const v = wl && wl[k];
    if (v) return v;
  }
  return null;
}

// "Latest wins" comparison: a space between
// date and time is normalised to 'T' so the two Tempo timestamp shapes
// compare the same way as plain ISO strings.
function cmpTs(a, b) {
  const na = String(a || '').replace(' ', 'T');
  const nb = String(b || '').replace(' ', 'T');
  return na > nb;
}

function isWeekendIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * @param {Array} worklogs Tempo worklog records.
 * @param {Array} members roster records (team/team-members.json team_members[]).
 * @param {Array<string>} dates window dates, newest first (calendar.js windowDates()).
 * @param {{now?: () => Date, trackedEmails?: string[]}} [opts]
 * @returns {{ index: object, shards: object[], unmatched: Array }}
 */
function isTracked(m, trackedEmails) {
  if (!m) return false;
  if (TEAMS.includes(m.team)) return true;
  return (trackedEmails || ALWAYS_TRACKED_EMAILS).includes(String(m.email || '').trim().toLowerCase());
}

function buildTimeLog(worklogs, members, dates, opts) {
  const now = (opts && opts.now) || (() => new Date());
  const datesSet = new Set(dates);
  const tracked = (opts && Array.isArray(opts.trackedEmails)) ? opts.trackedEmails : ALWAYS_TRACKED_EMAILS;
  const filtered = (members || []).filter((m) => isTracked(m, tracked));

  const taken = new Set();
  const enriched = filtered.map((m) => ({ member: m, slug: personSlug(m, taken) }));
  const idx = buildAuthorIndex(filtered);

  // Per-slug, per-date accumulator: seconds per (date, issue), issue first-
  // seen order, and the latest logged_at/updated_at per (date, issue).
  const bySlug = new Map(enriched.map((e) => [e.slug, {
    member: e.member,
    slug: e.slug,
    perDate: new Map(dates.map((d) => [d, { order: [], seconds: new Map(), logged: new Map(), updated: new Map(), totalSeconds: 0 }])),
  }]));
  // Reverse lookup by member reference - avoids scanning bySlug per worklog.
  const entryByMember = new Map([...bySlug.values()].map((e) => [e.member, e]));

  const unmatchedByKey = new Map();
  // Tempo ships issue.summary inline (no second request for titles is
  // needed) - kept per issue key,
  // first non-empty title wins, so the tooltip always has a title even if
  // one worklog record happened to carry an empty summary.
  const summaries = new Map();

  for (const wl of worklogs || []) {
    const wlDate = String((wl && wl.dateStarted) || '').slice(0, 10);
    if (!datesSet.has(wlDate)) continue;
    const author = (wl && wl.author) || {};
    const member = matchAuthor(author, idx);
    const issueKey = (wl && wl.issue && wl.issue.key) || (wl && wl.issueKey) || '';
    const seconds = Number((wl && wl.timeSpentSeconds) || 0) || 0;

    if (!member) {
      const key = author.name || author.displayName || '';
      if (!unmatchedByKey.has(key)) unmatchedByKey.set(key, { name: author.name || '', displayName: author.displayName || '', worklogs: 0 });
      unmatchedByKey.get(key).worklogs += 1;
      continue;
    }

    const slugEntry = entryByMember.get(member);
    if (!slugEntry) continue;
    const day = slugEntry.perDate.get(wlDate);
    if (!day) continue;

    day.totalSeconds += seconds;
    if (issueKey) {
      if (!day.seconds.has(issueKey)) { day.order.push(issueKey); day.seconds.set(issueKey, 0); }
      day.seconds.set(issueKey, day.seconds.get(issueKey) + seconds);
      const summary = (wl.issue && wl.issue.summary) || '';
      if (summary && !summaries.get(issueKey)) summaries.set(issueKey, summary);

      const loggedAt = resolveTs(wl, LOGGED_AT_KEYS);
      if (loggedAt !== null) {
        const existing = day.logged.get(issueKey);
        if (existing === undefined || cmpTs(loggedAt, existing)) day.logged.set(issueKey, loggedAt);
      }
      const updatedAt = resolveTs(wl, UPDATED_AT_KEYS);
      if (updatedAt !== null) {
        const existing = day.updated.get(issueKey);
        if (existing === undefined || cmpTs(updatedAt, existing)) day.updated.set(issueKey, updatedAt);
      }
    }
  }

  const shards = [];
  const indexPersons = {};

  for (const e of bySlug.values()) {
    const member = e.member;
    const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
    const days = [];
    let loggedDaysCount = 0;
    let missDaysCount = 0;

    for (const iso of dates) {
      const day = e.perDate.get(iso);
      const isWeekend = isWeekendIso(iso);
      const isHoliday = !isWeekend && isPlHoliday(iso);
      const hasLog = day.order.length > 0;
      const hours = Math.round((day.totalSeconds / 3600) * 10) / 10;

      const issues = day.order.map((key) => ({
        key,
        summary: summaries.get(key) || '',
        hours: Math.round((day.seconds.get(key) / 3600) * 10) / 10,
        logged_at: day.logged.has(key) ? day.logged.get(key) : null,
        updated_at: day.updated.has(key) ? day.updated.get(key) : null,
      }));

      days.push({ date: iso, is_weekend: isWeekend, is_holiday: isHoliday, has_log: hasLog, hours, issues });

      if (!isWeekend && !isHoliday) { if (hasLog) loggedDaysCount += 1; else missDaysCount += 1; }
    }

    shards.push({
      slug: e.slug,
      name,
      display_short: displayShort(name),
      email: member.email || '',
      team: member.team || '',
      logged_days_count: loggedDaysCount,
      miss_days_count: missDaysCount,
      days,
    });
  }

  shards.sort((a, b) => (b.miss_days_count - a.miss_days_count) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const s of shards) {
    indexPersons[s.slug] = { name: s.name, team: s.team, logged_days_count: s.logged_days_count, miss_days_count: s.miss_days_count };
  }

  const index = {
    generated_at: now().toISOString(),
    window_days: dates.length,
    dates,
    persons: indexPersons,
    unmatched_authors: [...unmatchedByKey.values()],
  };

  return { index, shards, unmatched: [...unmatchedByKey.values()] };
}

// Builds the /data payload: persons[] taken from the shards, in shard order
// (miss-count desc, then name) - the index alone carries no day detail.
function mergeShards(index, shards) {
  return {
    available: true,
    storage: 'ok',
    generated_at: index ? index.generated_at : null,
    window_days: index ? index.window_days : shards.length ? shards[0].days.length : 0,
    dates: index ? index.dates : [],
    persons: shards,
  };
}

module.exports = { TEAMS, ALWAYS_TRACKED_EMAILS, readTrackedEmails, resolveTs, buildTimeLog, mergeShards };
