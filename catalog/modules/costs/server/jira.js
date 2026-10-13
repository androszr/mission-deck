'use strict';
// modules/costs/server/jira.js
// Issue details for the epic view: summary, type, epic. Same Bearer token and
// http helper as tempo.js (issue details -> missing parents -> epic summaries).
// Fields relied on: summary, issuetype.name, parent.key,
// customfield_10001 (Epic Link - a key string, or an object with `key`).
// A failed batch never throws: it becomes a warning and the rest carries on,
// so hours are never lost to a Jira problem.

const BATCH = 100;
const FIELDS = 'summary,issuetype,parent,customfield_10001';
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const TIMEOUT_MS = 60000;

function _epicLink(v) {
  if (typeof v === 'string') return v.trim().toUpperCase();
  if (v && typeof v === 'object' && typeof v.key === 'string') return v.key.trim().toUpperCase();
  return '';
}

async function _search({ http, cfg, keys, fields }) {
  const headers = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/json' };
  const url = cfg.jiraUrl + '/rest/api/2/search?jql=' + encodeURIComponent('issueKey in (' + keys.join(',') + ')')
    + '&fields=' + encodeURIComponent(fields) + '&maxResults=' + BATCH;
  const body = await http.fetchJson(url, { headers, timeoutMs: TIMEOUT_MS });
  if (!body || !Array.isArray(body.issues)) throw new Error('Unexpected Jira response.');
  return body.issues;
}

async function _fetchRaw({ http, cfg, keys, fields, raw, warnings }) {
  const todo = [...new Set(keys)].filter((k) => KEY_RE.test(k));
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    try {
      for (const it of await _search({ http, cfg, keys: batch, fields })) {
        const f = (it && it.fields) || {};
        const parent = f.parent && typeof f.parent.key === 'string' ? f.parent.key.trim().toUpperCase() : '';
        raw.set(String(it.key).toUpperCase(), {
          summary: typeof f.summary === 'string' ? f.summary : '',
          type: (f.issuetype && f.issuetype.name) || '',
          parentKey: parent,
          epicLink: _epicLink(f.customfield_10001),
        });
      }
    } catch (e) {
      warnings.push('Jira: details of issues ' + (i + 1) + '-' + (i + batch.length) + ' were not fetched (' + String((e && e.message) || e) + ').');
    }
  }
}

/**
 * keys -> { issues: { KEY: { summary, type, epicKey, epicName } }, warnings: [] }
 * Sub-tasks inherit the epic through their parent; a parent that is itself an
 * Epic is the epic; an Epic is its own epic.
 */
async function resolveIssueDetails({ http, cfg, keys }) {
  const warnings = [];
  const raw = new Map();
  const wanted = [...new Set(keys || [])].filter((k) => KEY_RE.test(k));
  if (!wanted.length) return { issues: {}, warnings };
  await _fetchRaw({ http, cfg, keys: wanted, fields: FIELDS, raw, warnings });

  const parents = [];
  for (const d of raw.values()) if (d.parentKey && !raw.has(d.parentKey)) parents.push(d.parentKey);
  if (parents.length) await _fetchRaw({ http, cfg, keys: parents, fields: FIELDS, raw, warnings });

  const epicOf = (key, d) => {
    if (d.type === 'Epic') return key;
    if (d.epicLink) return d.epicLink;
    const p = d.parentKey ? raw.get(d.parentKey) : null;
    if (p) {
      if (p.type === 'Epic') return d.parentKey;
      if (p.epicLink) return p.epicLink;
    }
    return '';
  };
  const epicKeys = new Map();
  for (const k of wanted) {
    const d = raw.get(k);
    if (d) epicKeys.set(k, epicOf(k, d));
  }
  const needEpics = [...new Set(epicKeys.values())].filter((k) => k && !raw.has(k));
  if (needEpics.length) await _fetchRaw({ http, cfg, keys: needEpics, fields: 'summary,issuetype', raw, warnings });

  const issues = {};
  for (const k of wanted) {
    const d = raw.get(k);
    if (!d) continue;
    const ek = epicKeys.get(k) || '';
    const e = ek ? raw.get(ek) : null;
    issues[k] = { summary: d.summary, type: d.type, epicKey: ek, epicName: ek ? (e && e.summary) || ek : '' };
  }
  return { issues, warnings };
}

module.exports = { BATCH, KEY_RE, resolveIssueDetails };
