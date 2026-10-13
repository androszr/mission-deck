// modules/devops-stats/scripts/devops_etl.mjs
// ETL child: pulls DEVOPS issues with their changelog from Jira and writes
// ONE compact file (--out). I/O only; all shaping lives in _extract.mjs.
//
// Protocol: ONE JSON line on stdin {token, jira_url} (never printed, never
// in argv or env); progress as "@@PROGRESS:{...}" lines on stdout; one ASCII
// log line on stderr on failure. Exit 0 on success.

import fs from 'node:fs';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import {
  resolveFieldIds, statusTable, mergeStatuses, issueToFact, markEpics, buildJql, CONSTANTS,
} from './_extract.mjs';

const DEFAULT_JIRA_URL = 'https://jira.example.com';
const PAGE_SIZE = 100;
const TIMEOUT_MS = 60000;
const ATTEMPTS = 3;

export function parseArgs(argv) {
  const out = { out: null, mode: null, since: null };
  const allowed = new Set(['--out', '--mode', '--since']);
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!allowed.has(flag) || i + 1 >= argv.length) throw new Error('bad arguments');
    out[flag.slice(2)] = argv[i + 1];
  }
  if (!out.out) throw new Error('--out is required');
  if (out.mode !== 'full' && out.mode !== 'incremental') throw new Error('--mode must be full or incremental');
  if (out.mode === 'incremental' && !Number.isFinite(Date.parse(out.since))) throw new Error('--since must be a date');
  return out;
}

function progress(step, total, pct, msg) {
  process.stdout.write('@@PROGRESS:' + JSON.stringify({ step, total, pct, msg }) + '\n');
}

function readHandoff() {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin });
    let done = false;
    rl.once('line', (line) => {
      done = true;
      rl.close();
      try {
        const data = JSON.parse(line);
        if (!data || typeof data.token !== 'string' || !data.token) throw new Error('no token');
        resolve({ token: data.token, jira_url: String(data.jira_url || DEFAULT_JIRA_URL).replace(/\/$/, '') });
      } catch {
        reject(new Error('bad handoff line'));
      }
    });
    rl.once('close', () => { if (!done) reject(new Error('no handoff line')); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeJiraGet(handoff) {
  return async function jiraGet(pathname, params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    const url = handoff.jira_url + pathname + qs;
    let lastErr = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: 'Bearer ' + handoff.token, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status >= 500) throw new Error('HTTP ' + res.status);
        if (!res.ok) {
          const err = new Error('HTTP ' + res.status + ' for ' + pathname);
          err.fatal = true;
          throw err;
        }
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (e && e.fatal) break;
        if (attempt < ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
      }
    }
    throw lastErr || new Error('request failed');
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const handoff = await readHandoff();
  const jiraGet = makeJiraGet(handoff);

  progress(0, 1, 1, 'Pobieranie metadanych Jiry');
  const fieldIds = resolveFieldIds(await jiraGet('/rest/api/2/field'));
  if (!fieldIds.flagged) console.log('warning: Flagged field not found, flagged intervals stay empty');
  const projectStatuses = statusTable(await jiraGet('/rest/api/2/project/' + CONSTANTS.PROJECT + '/statuses'));
  let globalStatuses = [];
  try {
    globalStatuses = await jiraGet('/rest/api/2/status');
  } catch (e) {
    console.log('warning: global status list unavailable, historic statuses stay unknown: ' + e.message);
  }
  const allStatuses = mergeStatuses(projectStatuses, globalStatuses);
  const categoryById = new Map(allStatuses.map((s) => [s.id, s.category]));

  const wanted = ['summary', 'issuetype', 'status', 'created', 'assignee', 'parent', 'timespent', 'aggregatetimespent', 'worklog',
    fieldIds.epic_link, fieldIds.epic_name, fieldIds.flagged].filter(Boolean);
  const jql = buildJql(args.mode, args.since);

  const facts = [];
  const unknownStatuses = new Set();
  let startAt = 0;
  let total = null;
  for (;;) {
    const page = await jiraGet('/rest/api/2/search', {
      jql, startAt: String(startAt), maxResults: String(PAGE_SIZE), expand: 'changelog', fields: wanted.join(','),
    });
    const issues = Array.isArray(page.issues) ? page.issues : [];
    total = Number.isFinite(page.total) ? page.total : startAt + issues.length;
    for (const raw of issues) {
      let issue = raw;
      const cl = raw.changelog;
      if (cl && Number.isFinite(cl.total) && Array.isArray(cl.histories) && cl.total > cl.histories.length) {
        try {
          issue = await jiraGet('/rest/api/2/issue/' + encodeURIComponent(raw.key), { expand: 'changelog', fields: 'status' });
          issue = { ...raw, changelog: issue.changelog };
        } catch (e) {
          console.log('warning: changelog re-read failed for ' + raw.key + ': ' + e.message);
        }
      }
      // /search embeds at most 20 worklogs per issue: re-read the full list when it was cut.
      const wl = issue.fields && issue.fields.worklog;
      if (wl && Number.isFinite(wl.total) && Array.isArray(wl.worklogs) && wl.total > wl.worklogs.length) {
        try {
          const full = await jiraGet('/rest/api/2/issue/' + encodeURIComponent(raw.key) + '/worklog', { maxResults: '5000' });
          const list = Array.isArray(full.worklogs) ? full.worklogs : [];
          if (list.length < wl.total) console.log('warning: worklog of ' + raw.key + ' still cut: ' + list.length + ' of ' + wl.total);
          issue = { ...issue, fields: { ...issue.fields, worklog: { ...wl, worklogs: list } } };
        } catch (e) {
          console.log('warning: worklog re-read failed for ' + raw.key + ': ' + e.message);
        }
      }
      const fact = issueToFact(issue, { fieldIds, categoryById });
      if (!fact) continue;
      for (const iv of fact.intervals) if (iv.s !== null && !categoryById.has(iv.s)) unknownStatuses.add(iv.s);
      facts.push(fact);
    }
    startAt += issues.length;
    const pct = total > 0 ? Math.min(99, Math.round((startAt / total) * 100)) : 99;
    progress(startAt, total, pct, 'Fetched ' + startAt + ' of ' + total + ' issues');
    if (issues.length === 0 || startAt >= total) break;
  }
  if (unknownStatuses.size) console.log('warning: statuses missing from the project status list: ' + [...unknownStatuses].join(','));

  const usedIds = new Set();
  for (const f of facts) for (const iv of f.intervals) if (iv.s !== null && iv.s !== undefined) usedIds.add(String(iv.s));
  const statuses = mergeStatuses(projectStatuses, globalStatuses, usedIds);

  facts.sort((a, b) => Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]));
  const payload = {
    project: CONSTANTS.PROJECT,
    generated_at: new Date().toISOString(),
    mode: args.mode,
    lookback_days: CONSTANTS.LOOKBACK_DAYS,
    fields: fieldIds,
    statuses,
    issues: markEpics(facts),
  };
  const tmp = args.out + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(payload) + '\n', 'utf8');
  fs.renameSync(tmp, args.out);
  progress(facts.length, facts.length, 100, 'Done');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run().catch((e) => {
    process.stderr.write('devops_etl failed: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  });
}
