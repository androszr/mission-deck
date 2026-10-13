'use strict';
// modules/costs/server/index.js
// register(ctx) mounted under /api/m/costs/. Seven routes:
//   GET  /status          token / storage / years / months / job probe, no network
//   GET  /data?from=&to=  costs of a day range (or ?year=), computed at read time
//   GET  /config          roster joined with config and rates
//   POST /config          who is "in costs" and in which areas
//   GET  /epics?from=&to=&area=  epic > issue > person tree of one area
//   POST /rate            daily rate of one person (null clears), in costs/team-rates.json
//   POST /refresh         detached Tempo fetch, rewrites only the months of the range
// createRoutes(ctx, { http, now, env }) is the testable core; register(ctx) wires
// the real client behind a per-request test-mode read.

const fs = require('fs');
const path = require('path');
const { tempoConfig, readProjects, fetchAllWorklogs, defaultHttp } = require('./tempo.js');
const {
  AREAS, roundCents, monthsOfRange, lastDayOfMonth,
  aggregateWorklogs, splitByMonth, clipShard, mergeShards, buildIndex, buildCosts, buildEpicTree,
} = require('./compute.js');
const { memberName, nameTokens, asciiLower } = require('./match.js');
const { resolveIssueDetails } = require('./jira.js');
const { mapRates, applyRate } = require('./rates.js');
const store = require('./store.js');

const RUN_DEADLINE_MS = 5 * 60 * 1000;
const MAX_RANGE_MONTHS = 12;
const RATE_MAX = 1000000;
const DATA_MISSING_MESSAGE = 'The "Team data" source is not fetched and decrypted on this computer - fetch it in the Sync window on the top bar (the data-tier-0 key is needed).';

function isTestMode() {
  return process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';
}

function isoLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function validIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD, or ?year=YYYY, or nothing (the current year).
 * { from, to, year } or { error }.
 */
function rangeFromQuery(url, today) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const yearRaw = url.searchParams.get('year');
  if (from !== null || to !== null) {
    if (!validIsoDate(from) || !validIsoDate(to) || from > to) return { error: { error: 'bad-range', message: 'Invalid date range.' } };
    return { from, to, year: from.slice(0, 4) };
  }
  if (yearRaw !== null && !/^\d{4}$/.test(yearRaw)) return { error: { error: 'bad-year', message: 'Invalid year.' } };
  const year = yearRaw || today.slice(0, 4);
  return { from: year + '-01-01', to: year + '-12-31', year };
}

/** Index entries and shards of a range, each shard cut at day granularity. */
function shardsOfRange(r, idx, range) {
  const lo = range.from.slice(0, 7);
  const hi = range.to.slice(0, 7);
  const entries = idx.months.filter((m) => m.month >= lo && m.month <= hi);
  const months = entries.map((m) => m.month);
  const shardMap = store.readShards(r, months);
  const shards = [];
  const info = entries.map((m) => {
    const c = clipShard(shardMap[m.month], range.from, range.to);
    if (c.shard) shards.push(c.shard);
    return { month: m.month, fetchedAt: m.fetchedAt, partial: !!m.partial, dateTo: m.dateTo, clipped: c.clipped, noDaily: c.noDaily };
  });
  return { months, shards, info };
}

function emptySummary() {
  const z = () => ({ cost: 0, hours: 0, personsNoRate: 0, hoursNoRate: 0, persons: 0 });
  const byArea = {};
  for (const a of AREAS) byArea[a] = z();
  return { byArea, all: z() };
}

function createRoutes(ctx, deps) {
  const resolveHttp = () => (typeof deps?.http === 'function' ? deps.http() : (deps && deps.http) || null);
  const now = (deps && deps.now) || (() => new Date());
  const getEnv = () => (deps && deps.env) || process.env;
  const deadlineMs = () => (deps && Number.isFinite(deps.runDeadlineMs) && deps.runDeadlineMs > 0 ? deps.runDeadlineMs : RUN_DEADLINE_MS);

  const rosterFile = () => path.join(ctx.dataTier0Dir || store.privateRoot(ctx) || '', 'team', 'team-members.json');
  const withLock = ctx.makeLock();
  let job = { running: false, startedAt: null, progress: null, months: [] };
  let idle = Promise.resolve();

  const send = (res, status, body) => ctx.jsonResponse(res, status, body);
  const dataMissing = (res) => send(res, 409, { error: 'data-missing', message: DATA_MISSING_MESSAGE });
  const root = () => store.privateRoot(ctx);

  function loadRoster() {
    const obj = store.readJsonOrNull(rosterFile());
    return obj && Array.isArray(obj.team_members) ? obj.team_members : [];
  }
  const codeErr = (code) => Object.assign(new Error(code), { code });
  /** Parsed JSON of an EXISTING file; null when absent; throws read-failed when present but unusable. */
  function readExisting(file) {
    if (!fs.existsSync(file)) return null;
    const c = store.readJsonOrNull(file);
    if (c === null || typeof c !== 'object') throw codeErr('read-failed');
    return c;
  }
  function loadConfig(r) {
    const c = readExisting(path.join(r, store.CONFIG_REL));
    if (c === null) return { schemaVersion: 1, members: [] };
    if (!Array.isArray(c.members)) throw codeErr('read-failed');
    return c;
  }
  /**
   * The raw costs/team-rates.json document. Missing: an empty one (the first
   * rate written creates the file); unparsable: read-failed.
   */
  function loadRatesDoc(r) {
    const c = readExisting(path.join(r, store.TEAM_RATES_REL));
    if (c === null) return { team_rates: [] };
    if (!Array.isArray(c.team_rates)) throw codeErr('read-failed');
    return c;
  }
  /** Everyone who can carry a rate: the roster plus every config member outside it. */
  function peopleOf(cfg) {
    const roster = loadRoster();
    const ids = new Set(roster.map((m) => m.id));
    const out = roster.map((m) => ({ id: m.id, name: memberName(m) }));
    for (const c of cfg.members) if (c && !ids.has(c.id)) out.push({ id: c.id, name: c.name || c.id });
    return out;
  }
  /** { rates: [{ id, daily_rate }], unmatched } mapped by name. */
  function loadRates(r, cfg) {
    return mapRates(loadRatesDoc(r), peopleOf(cfg || loadConfig(r)));
  }
  function lastRun() {
    return store.readJsonOrNull(path.join(ctx.dataDir, 'last-run.json'));
  }
  async function body(req, res) {
    try {
      const b = await ctx.readBody(req, 16 * 1024);
      return b && typeof b === 'object' ? b : {};
    } catch {
      send(res, 400, { error: 'bad-body', message: 'Invalid request body.' });
      return null;
    }
  }

  // -- GET /status ----------------------------------------------------------
  function handleStatus(_req, res) {
    const tc = tempoConfig(getEnv());
    const ready = store.privateReady(ctx);
    let years = [];
    let months = [];
    let dateMin = null;
    let dateMax = null;
    if (ready) {
      const idx = store.readIndexOrRebuild(root());
      months = idx.months.map((m) => ({ month: m.month, fetchedAt: m.fetchedAt, partial: !!m.partial, dateFrom: m.dateFrom, dateTo: m.dateTo, authors: m.authors, worklogs: m.worklogs }));
      years = [...new Set(months.map((m) => m.month.slice(0, 4)))].sort();
      dateMin = months.map((m) => m.dateFrom || m.month + '-01').sort()[0] || null;
      dateMax = months.map((m) => m.dateTo || lastDayOfMonth(m.month)).sort().slice(-1)[0] || null;
    }
    send(res, 200, {
      token: tc.ok,
      jiraUrl: tc.jiraUrl,
      storage: ready ? 'ok' : 'unavailable',
      roster: loadRoster().length > 0,
      years,
      dateMin,
      dateMax,
      months,
      job: { running: job.running, startedAt: job.startedAt, progress: job.progress, months: job.months },
      lastRun: lastRun(),
    });
  }

  // -- GET /data ------------------------------------------------------------
  function handleData(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const range = rangeFromQuery(url, isoLocal(now()));
    if (range.error) { send(res, 400, range.error); return; }
    const { year } = range;
    if (!store.privateReady(ctx)) {
      send(res, 200, { storage: 'unavailable', year, from: range.from, to: range.to, months: [], available: false, persons: [], unassigned: [], summary: emptySummary(), lastRun: lastRun() });
      return;
    }
    const r = root();
    const idx = store.readIndexOrRebuild(r);
    const { months, shards, info } = shardsOfRange(r, idx, range);
    const costs = buildCosts({
      aggregated: mergeShards(shards), config: loadConfig(r), rates: loadRates(r), roster: loadRoster(), months,
    });
    send(res, 200, {
      storage: 'ok',
      year,
      from: range.from,
      to: range.to,
      months,
      monthInfo: info,
      available: months.length > 0,
      ...costs,
      lastRun: lastRun(),
    });
  }

  // -- GET /epics ------------------------------------------------------------
  function handleEpics(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const area = url.searchParams.get('area');
    const range = rangeFromQuery(url, isoLocal(now()));
    if (range.error) { send(res, 400, range.error); return; }
    if (!AREAS.includes(area)) { send(res, 400, { error: 'bad-area', message: 'Invalid area.' }); return; }
    const { year } = range;
    if (!store.privateReady(ctx)) {
      send(res, 200, { storage: 'unavailable', year, from: range.from, to: range.to, area, months: [], epics: [], legacyMonths: [] });
      return;
    }
    const r = root();
    const idx = store.readIndexOrRebuild(r);
    const { months, shards, info } = shardsOfRange(r, idx, range);
    const cfg = loadConfig(r);
    const tree = buildEpicTree({
      shards, config: cfg, rates: loadRates(r, cfg), roster: loadRoster(), months, area,
    });
    send(res, 200, {
      storage: 'ok', year, from: range.from, to: range.to, ...tree,
      monthInfo: info.map((m) => ({ month: m.month, partial: m.partial, dateTo: m.dateTo, clipped: m.clipped, noDaily: m.noDaily })),
    });
  }

  // -- /config ---------------------------------------------------------------
  function handleConfigGet(_req, res) {
    const roster = loadRoster();
    const ready = store.privateReady(ctx);
    const r = ready ? root() : null;
    const cfg = ready ? loadConfig(r) : { members: [] };
    const rates = ready ? loadRates(r, cfg) : { rates: [], unmatched: [] };
    const cById = new Map(cfg.members.map((m) => [m.id, m]));
    const rById = new Map(rates.rates.map((x) => [x.id, x.daily_rate]));
    const members = roster.map((m) => {
      const c = cById.get(m.id);
      return {
        id: m.id, name: memberName(m), role: m.role || '', team: m.team || '', email: m.email || '',
        included: !!(c && c.included), areas: c && Array.isArray(c.areas) ? c.areas : [],
        rate: rById.has(m.id) ? rById.get(m.id) : null, external: false, endDate: (c && c.endDate) || null, company: (c && c.company) || '',
      };
    });
    const inRoster = new Set(roster.map((m) => m.id));
    const orphans = [];
    for (const c of cfg.members.filter((x) => !inRoster.has(x.id))) {
      const row = {
        id: c.id, name: c.name || c.id, role: '', team: '', email: c.email || '', included: !!c.included,
        areas: Array.isArray(c.areas) ? c.areas : [], rate: rById.has(c.id) ? rById.get(c.id) : null, external: true,
        endDate: c.endDate || null, company: c.company || '',
      };
      members.push(row);
      if (!c.external) orphans.push(row);
    }
    members.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    send(res, 200, { storage: ready ? 'ok' : 'unavailable', members, orphans, ratesUnmatched: rates.unmatched });
  }

  function slugOf(text) {
    return asciiLower(text).replace(/[^a-z0-9@.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  /** "Works until": YYYY-MM-DD, or null to clear. Returns undefined when absent, false when invalid. */
  function parseEndDate(v) {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? false : v;
  }

  /** Creates an external member (a person outside the team directory). */
  function createExternal(cfg, b, res) {
    const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (name.length < 2 || name.length > 100) { send(res, 400, { error: 'bad-name', message: 'Enter a full name (2-100 characters).' }); return null; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { send(res, 400, { error: 'bad-email', message: 'Invalid e-mail address.' }); return null; }
    if (b.included !== undefined && typeof b.included !== 'boolean') { send(res, 400, { error: 'bad-included', message: 'The "In costs" field must be true or false.' }); return null; }
    if (b.areas !== undefined && (!Array.isArray(b.areas) || !b.areas.every((x) => AREAS.includes(x)))) { send(res, 400, { error: 'bad-areas', message: 'Invalid areas.' }); return null; }
    const slug = slugOf(email || name);
    if (!slug) { send(res, 400, { error: 'bad-name', message: 'Enter a full name.' }); return null; }
    const id = 'ext:' + slug;
    const want = nameTokens(name);
    const sameName = (other) => {
      const t = nameTokens(other);
      return t.size > 0 && t.size === want.size && [...want].every((x) => t.has(x));
    };
    const others = [
      ...loadRoster().map((m) => ({ id: m.id, name: memberName(m), email: m.email })),
      ...cfg.members.map((m) => ({ id: m.id, name: m.name, email: m.email })),
    ];
    const dup = others.find((o) => o.id === id || (email && String(o.email || '').toLowerCase() === email) || sameName(o.name));
    if (dup) { send(res, 409, { error: 'duplicate-member', message: 'This person already exists: ' + (dup.name || dup.id) + '.' }); return null; }
    const entry = { id, name, external: true, included: b.included === undefined ? true : b.included, areas: AREAS.filter((x) => (b.areas || []).includes(x)) };
    if (email) entry.email = email;
    cfg.members.push(entry);
    return entry;
  }

  async function handleConfigPost(req, res) {
    const b = await body(req, res);
    if (!b) return;
    if (!store.privateReady(ctx)) { dataMissing(res); return; }
    const roster = loadRoster();
    const member = roster.find((m) => m.id === b.id);
    await withLock(() => {
      const r = root();
      if (!store.privateReady(ctx)) { dataMissing(res); return; }
      const cfg = loadConfig(r);
      if (b.external === true) {
        const entry = createExternal(cfg, b, res);
        if (!entry) return;
        store.writeJsonPrivate(r, store.CONFIG_REL, cfg);
        send(res, 200, { ok: true, member: entry });
        return;
      }
      if (b.remove === true) {
        const known = cfg.members.some((m) => m.id === b.id);
        if (!known) { send(res, 400, { error: 'unknown-member', message: 'No such person in the configuration.' }); return; }
        cfg.members = cfg.members.filter((m) => m.id !== b.id);
        store.writeJsonPrivate(r, store.CONFIG_REL, cfg);
        // the rate entry stays in costs/team-rates.json (it is listed as "rates without a person")
        send(res, 200, { ok: true, removed: b.id });
        return;
      }
      const ext = !member ? cfg.members.find((m) => m.id === b.id && m.external === true) : null;
      if (!member && !ext) { send(res, 400, { error: 'unknown-member', message: 'No such person in the team directory.' }); return; }
      if (b.included !== undefined && typeof b.included !== 'boolean') { send(res, 400, { error: 'bad-included', message: 'The "In costs" field must be true or false.' }); return; }
      if (b.areas !== undefined && (!Array.isArray(b.areas) || !b.areas.every((a) => AREAS.includes(a)))) {
        send(res, 400, { error: 'bad-areas', message: 'Invalid areas.' });
        return;
      }
      if (b.company !== undefined && b.company !== null && (typeof b.company !== 'string' || b.company.trim().length > 60)) {
        send(res, 400, { error: 'bad-company', message: 'The company name can have at most 60 characters.' });
        return;
      }
      const endDate = parseEndDate(b.endDate);
      if (endDate === false) { send(res, 400, { error: 'bad-end-date', message: 'The "works until" date must use the YYYY-MM-DD format.' }); return; }
      let entry = cfg.members.find((m) => m.id === b.id);
      if (!entry) { entry = { id: b.id, name: memberName(member), included: false, areas: [] }; cfg.members.push(entry); }
      if (endDate === null) delete entry.endDate; else if (endDate !== undefined) entry.endDate = endDate;
      if (b.company !== undefined) {
        const company = typeof b.company === 'string' ? b.company.trim().replace(/\s+/g, ' ') : '';
        if (company) entry.company = company; else delete entry.company;
      }
      if (member) entry.name = memberName(member);
      if (b.included !== undefined) entry.included = b.included;
      if (b.areas !== undefined) entry.areas = AREAS.filter((a) => b.areas.includes(a));
      store.writeJsonPrivate(r, store.CONFIG_REL, cfg);
      send(res, 200, { ok: true, member: entry });
    });
  }

  async function handleRate(req, res) {
    const b = await body(req, res);
    if (!b) return;
    if (!store.privateReady(ctx)) { dataMissing(res); return; }
    const dr = b.daily_rate;
    if (dr !== null && (typeof dr !== 'number' || !Number.isFinite(dr) || dr < 0 || dr > RATE_MAX)) {
      send(res, 400, { error: 'bad-rate', message: 'The daily rate must be a number from 0 to 1,000,000 or empty.' });
      return;
    }
    await withLock(() => {
      const r = root();
      if (!store.privateReady(ctx)) { dataMissing(res); return; }
      const person = peopleOf(loadConfig(r)).find((p) => p.id === b.id);
      if (!person) { send(res, 400, { error: 'unknown-member', message: 'No such person in the team directory or in the configuration.' }); return; }
      const value = dr === null ? null : roundCents(dr);
      const out = applyRate(loadRatesDoc(r), person.name, value);
      if (!out.ok) {
        send(res, 409, { error: 'rate-ambiguous', message: 'Several entries in team-rates.json match this person: ' + out.candidates.join(' / ') + '.' });
        return;
      }
      store.writeJsonPrivate(r, store.TEAM_RATES_REL, out.doc);
      send(res, 200, { ok: true, id: b.id, daily_rate: value });
    });
  }

  // -- POST /refresh --------------------------------------------------------
  async function runJob({ http, tc, projects, dateFrom, dateTo, months }) {
    const startedAt = now().toISOString();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deadlineMs());
    if (timer.unref) timer.unref();
    let summary = { at: startedAt, ok: false, dateFrom, dateTo, months };
    const skippedMonths = [];
    try {
      const worklogs = await fetchAllWorklogs({
        http, cfg: tc, projects, dateFrom, dateTo, signal: ac.signal,
        onProgress: (i, total, projectKey) => { job.progress = { i, total, projectKey }; },
      });
      const agg = aggregateWorklogs(worklogs);
      let details = {};
      const warnings = [];
      try {
        const keys = new Set();
        for (const a of agg.authors) for (const mm of Object.values(a.issues)) for (const k of Object.keys(mm)) keys.add(k);
        const got = await resolveIssueDetails({ http, cfg: tc, keys: [...keys] });
        details = got.issues;
        warnings.push(...got.warnings);
      } catch (e) {
        warnings.push('Jira: issue details were not fetched (' + String((e && e.message) || e) + ').');
      }
      const split = splitByMonth(agg, months);
      const fetchedAt = now().toISOString();
      const byMonth = {};
      const entries = [];
      for (const m of months) {
        const mFrom = m + '-01' > dateFrom ? m + '-01' : dateFrom;
        const mEnd = lastDayOfMonth(m);
        const mTo = mEnd < dateTo ? mEnd : dateTo;
        const partial = mTo < mEnd;
        const mIssues = {};
        for (const au of split[m].authors) for (const k of Object.keys(au.issues || {})) if (details[k]) mIssues[k] = details[k];
        byMonth[m] = {
          schemaVersion: 3, month: m, fetchedAt, dateFrom: mFrom, dateTo: mTo, partial, projects, skipped: agg.skipped, authors: split[m].authors, issues: mIssues,
        };
        entries.push({
          month: m, fetchedAt, dateFrom: mFrom, dateTo: mTo, partial, authors: split[m].authors.length, worklogs: agg.counts[m] || 0, skipped: agg.skipped,
        });
      }
      await withLock(() => {
        if (!store.privateReady(ctx)) throw Object.assign(new Error('data-missing'), { code: 'data-missing' });
        const r = root();
        const old = store.readShards(r, months);
        for (const m of months) {
          const had = old[m] && Array.isArray(old[m].authors) && old[m].authors.length > 0;
          if (had && byMonth[m].authors.length === 0) {
            skippedMonths.push(m);
            delete byMonth[m];
          }
        }
        for (let i = entries.length - 1; i >= 0; i -= 1) if (skippedMonths.includes(entries[i].month)) entries.splice(i, 1);
        // Jira details that failed this time are kept from the shard being replaced.
        for (const m of Object.keys(byMonth)) {
          const oldIssues = old[m] && old[m].issues && typeof old[m].issues === 'object' ? old[m].issues : {};
          for (const au of byMonth[m].authors) {
            for (const k of Object.keys(au.issues || {})) if (!byMonth[m].issues[k] && oldIssues[k]) byMonth[m].issues[k] = oldIssues[k];
          }
        }
        store.writeShards(r, byMonth);
        const prev = store.readIndexOrRebuild(r);
        const seen = agg.authors.map((a) => ({ key: a.key, displayName: a.displayName, months: Object.keys(a.months).filter((mo) => months.includes(mo)) }));
        const rosterEmails = new Set(loadRoster().map((x) => String(x.email || '').toLowerCase()).filter(Boolean));
        const unmatched = agg.authors.filter((a) => !rosterEmails.has(a.key)).map((a) => ({ key: a.key, displayName: a.displayName }));
        const next = buildIndex(prev, entries, {
          now: fetchedAt, projects, seen, unmatchedByEmail: unmatched,
        });
        store.writeIndex(r, next);
      });
      summary = { ...summary, ok: true, authors: agg.authors.length, worklogs: worklogs.length };
      if (warnings.length) summary.warnings = warnings;
      if (skippedMonths.length) {
        summary.skippedMonths = skippedMonths;
        summary.note = 'Months skipped (Tempo returned 0 hours): ' + skippedMonths.join(', ') + '.';
      }
    } catch (e) {
      const code = ac.signal.aborted ? 'timeout' : (e && e.code) || 'error';
      summary = { ...summary, ok: false, error: code, message: code === 'timeout' ? 'Fetching data from Tempo took longer than 5 minutes.' : String((e && e.message) || e) };
      ctx.log('refresh failed:', code);
    } finally {
      clearTimeout(timer);
      try { store.writeAppCache(ctx.dataDir, 'last-run.json', summary); } catch { /* cache only */ }
      job = { running: false, startedAt: null, progress: null, months: [] };
    }
  }

  async function handleRefresh(req, res) {
    const b = await body(req, res);
    if (!b) return;
    const today = isoLocal(now());
    // No range given (e.g. a scheduler): the previous and the current month.
    const prev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
    const dateFrom = b.dateFrom === undefined ? prev : b.dateFrom;
    const dateTo = b.dateTo === undefined ? today : b.dateTo;
    const badRange = (message) => send(res, 400, { error: 'bad-range', message });
    if (!validIsoDate(dateFrom) || !validIsoDate(dateTo)) { badRange('Invalid date range.'); return; }
    if (dateFrom.slice(8) !== '01') { badRange('The range must start on the first day of a month.'); return; }
    if (dateTo < dateFrom) { badRange('The end date is earlier than the start date.'); return; }
    if (dateTo > today) { badRange('The end date cannot be in the future.'); return; }
    const months = monthsOfRange(dateFrom, dateTo);
    if (months.length > MAX_RANGE_MONTHS) { badRange('The range can cover at most 12 months.'); return; }

    const http = resolveHttp();
    if (!http) { send(res, 409, { error: 'test-mode', message: 'Fetching from Tempo is disabled in test mode.' }); return; }
    const tc = tempoConfig(getEnv());
    if (!tc.ok) { send(res, 409, { error: 'no-token', message: 'No Jira token - unlock the Bitwarden vault on the top bar.' }); return; }
    if (!store.privateReady(ctx)) { dataMissing(res); return; }
    if (!loadRoster().length) { send(res, 409, { error: 'roster-missing', message: 'The team directory (team/team-members.json) is not available on this computer.' }); return; }

    const started = await withLock(() => {
      if (job.running) return false;
      job = { running: true, startedAt: now().toISOString(), progress: null, months };
      return true;
    });
    if (!started) { send(res, 409, { error: 'job-running', message: 'A fetch is already running.' }); return; }

    const projects = readProjects(loadConfig(root()));
    idle = runJob({ http, tc, projects, dateFrom, dateTo, months });
    send(res, 202, { started: true, dateFrom, dateTo, months });
  }

  /** Maps data-missing / read-failed raised while loading to 409 / 500; nothing is written then. */
  const guard = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (res.headersSent || res.writableEnded) throw e;
      if (e && e.code === 'data-missing') { dataMissing(res); return; }
      if (e && e.code === 'read-failed') { send(res, 500, { error: 'read-failed', message: 'A data file could not be read - it is corrupt. Nothing was written.' }); return; }
      throw e;
    }
  };

  return {
    routes: [
      { method: 'GET', path: '/status', handler: guard(handleStatus) },
      { method: 'GET', path: '/data', handler: guard(handleData) },
      { method: 'GET', path: '/epics', handler: guard(handleEpics) },
      { method: 'GET', path: '/config', handler: guard(handleConfigGet) },
      { method: 'POST', path: '/config', handler: guard(handleConfigPost) },
      { method: 'POST', path: '/rate', handler: guard(handleRate) },
      { method: 'POST', path: '/refresh', handler: guard(handleRefresh) },
    ],
    idle: () => idle,
  };
}

function register(ctx) {
  const http = defaultHttp();
  return createRoutes(ctx, { http: () => (isTestMode() ? null : http), now: () => new Date() });
}

module.exports = register;
module.exports.createRoutes = createRoutes;
