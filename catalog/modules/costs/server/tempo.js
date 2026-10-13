'use strict';
// modules/costs/server/tempo.js (own copy of the time-log client - modules never require each other)
// Talks to Tempo v3 (GET <JIRA_URL>/rest/tempo-timesheets/3/worklogs). Only
// author, day, issue and seconds are used downstream.

const JIRA_URL_DEFAULT = 'https://jira.example.com';
// Jira projects whose worklogs are fetched; override with "projects" in costs/config.json.
const DEFAULT_PROJECTS = ['APP', 'WEB', 'PLAT', 'OPS'];
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const PAGE_LIMIT = 1000;
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 60000;

/** Pure: validates and normalises a projects override from config.json. */
function readProjects(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) return DEFAULT_PROJECTS;
  const valid = raw.projects.filter((p) => typeof p === 'string' && PROJECT_KEY_RE.test(p));
  return valid.length > 0 ? valid : DEFAULT_PROJECTS;
}

/** A usable token value, or '' for a missing one or a `your_*_here` placeholder. */
function _tokenValue(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v && !/^your_.*_here$/.test(v) ? v : '';
}

/** Pure: what the module needs from process.env. The personal token first,
 * the technical account as the fallback - the same order the core's Jira
 * handlers and modules/sprint-stats pickJiraToken use, so a person whose
 * vault holds only the technical token is not told "no token" here alone. */
function tempoConfig(env) {
  const missing = [];
  const token = _tokenValue(env.JIRA_TOKEN) || _tokenValue(env.JIRA_TECH_TOKEN);
  if (!token) missing.push('JIRA_TOKEN');
  const jiraUrl = (typeof env.JIRA_URL === 'string' && env.JIRA_URL.trim() ? env.JIRA_URL.trim() : JIRA_URL_DEFAULT).replace(/\/$/, '');
  return { ok: missing.length === 0, missing, token, jiraUrl };
}

/**
 * One project, paginated. A plain array response is a single page (no more
 * to fetch); an object with `worklogs` or `results` pages by offset until a
 * short page is seen. MAX_PAGES protects against a broken server answering
 * a full page forever.
 */
async function fetchProjectWorklogs({ http, cfg, projectKey, dateFrom, dateTo, signal }) {
  const headers = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/json' };
  const collected = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = cfg.jiraUrl + '/rest/tempo-timesheets/3/worklogs'
      + '?projectKey=' + encodeURIComponent(projectKey)
      + '&dateFrom=' + encodeURIComponent(dateFrom)
      + '&dateTo=' + encodeURIComponent(dateTo)
      + '&offset=' + offset
      + '&limit=' + PAGE_LIMIT;
    const body = await http.fetchJson(url, { headers, timeoutMs: REQUEST_TIMEOUT_MS, signal });
    if (Array.isArray(body)) { collected.push(...body); return collected; }
    const batch = body && typeof body === 'object' && (Array.isArray(body.worklogs) ? body.worklogs : (Array.isArray(body.results) ? body.results : null));
    if (!batch) {
      const bad = new Error('Unexpected Tempo response for project ' + projectKey + ' - nothing was written.');
      bad.code = 'bad-response';
      throw bad;
    }
    collected.push(...batch);
    if (batch.length < PAGE_LIMIT) return collected;
    offset += PAGE_LIMIT;
  }
  const err = new Error('Too many Tempo response pages for project ' + projectKey + ' (limit ' + MAX_PAGES + ').');
  err.code = 'too-many-pages';
  throw err;
}

/** Sequential over projects (never parallel - one slow project should not
 * hide progress on the rest), reports onProgress(i, total, projectKey)
 * before each project starts. */
async function fetchAllWorklogs({ http, cfg, projects, dateFrom, dateTo, signal, onProgress }) {
  const all = [];
  for (let i = 0; i < projects.length; i += 1) {
    const projectKey = projects[i];
    if (typeof onProgress === 'function') onProgress(i, projects.length, projectKey);
    const worklogs = await fetchProjectWorklogs({ http, cfg, projectKey, dateFrom, dateTo, signal });
    all.push(...worklogs);
  }
  return all;
}

/** Default HTTP client: global fetch (Node 24) with a timeout; tests inject a fake. */
function defaultHttp() {
  return {
    async fetchJson(url, { headers, timeoutMs, signal } = {}) {
      const signals = [AbortSignal.timeout(timeoutMs || REQUEST_TIMEOUT_MS)];
      if (signal) signals.push(signal);
      const r = await fetch(url, { headers, signal: AbortSignal.any(signals) });
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
      return r.json();
    },
  };
}

module.exports = {
  JIRA_URL_DEFAULT, DEFAULT_PROJECTS, PROJECT_KEY_RE,
  readProjects, tempoConfig, fetchProjectWorklogs, fetchAllWorklogs, defaultHttp,
};
