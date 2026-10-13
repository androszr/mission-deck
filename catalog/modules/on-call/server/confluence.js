'use strict';
// on-call/server/confluence.js
// Talks to Confluence's REST API for exactly one page - the on-call schedule.
// Mirrors the core's Confluence error classification (network throw or an
// HTML body -> confluence-unreachable, a non-2xx -> confluence-http) so a
// person sees the same "check your VPN" message everywhere. This module never
// calls the core's Markdown conversion endpoint: that path reads table cells
// positionally and drops colspan/rowspan, corrupting exactly the tables this
// module needs whole.

const DEFAULT_BASE_URL = 'https://confluence.example.com';
const REQUEST_TIMEOUT_MS = 30000;

function _envString(env, key) {
  return (env && typeof env[key] === 'string') ? env[key].trim() : '';
}

/**
 * Pure: resolves the token, base URL and page id from process.env. A
 * placeholder value ("your_..._here") counts as missing.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ok: boolean, token: string, baseUrl: string, pageId: string, missing: Array<string>}}
 */
function confluenceConfig(env) {
  const raw = _envString(env, 'CONFLUENCE_TOKEN');
  const token = raw && !/^your_.*_here$/i.test(raw) ? raw : '';
  const pageRaw = _envString(env, 'ONCALL_PAGE_ID');
  const pageId = /^\d+$/.test(pageRaw) ? pageRaw : '';
  const missing = [];
  if (!token) missing.push('CONFLUENCE_TOKEN');
  if (!pageId) missing.push('ONCALL_PAGE_ID');
  const baseUrl = (_envString(env, 'CONFLUENCE_BASE_URL') || DEFAULT_BASE_URL).replace(/\/$/, '');
  return { ok: missing.length === 0, token, baseUrl, pageId, missing };
}

/**
 * The page URL shown in the "Open the page" link, or '' when no page id is
 * configured.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function pageUrl(env) {
  const cfg = confluenceConfig(env);
  return cfg.pageId ? cfg.baseUrl + '/pages/viewpage.action?pageId=' + cfg.pageId : '';
}

function _fail(code, status) {
  const err = new Error(code);
  err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

/**
 * Fetches one Confluence page's export_view HTML + version metadata.
 * A network throw or an HTML body (an SSO interstitial when the VPN is off)
 * both surface as 'confluence-unreachable'; a non-2xx JSON error surfaces as
 * 'confluence-http' with the HTTP status attached.
 * @param {{http: Function, baseUrl: string, token: string, pageId: string}} args
 * @returns {Promise<{html: string, version: number, updated: string, title: string, url: string}>}
 */
async function fetchPage({ http, baseUrl, token, pageId }) {
  const url = baseUrl + '/rest/api/content/' + encodeURIComponent(pageId)
    + '?expand=body.export_view,version,history,space';
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

  let resp;
  try {
    resp = await http(url, { headers, timeoutMs: REQUEST_TIMEOUT_MS });
  } catch {
    throw _fail('confluence-unreachable');
  }

  const ctype = (resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get('content-type') : '') || '';
  if (ctype.toLowerCase().includes('text/html')) throw _fail('confluence-unreachable');
  if (!resp.ok) throw _fail('confluence-http', resp.status);

  let body;
  try {
    body = await resp.json();
  } catch {
    throw _fail('confluence-unreachable');
  }

  const html = body && body.body && body.body.export_view && body.body.export_view.value;
  if (typeof html !== 'string') throw _fail('confluence-unreachable');

  const webui = (body._links && body._links.webui) || '';
  return {
    html,
    version: (body.version && body.version.number) || null,
    updated: (body.version && body.version.when) || null,
    title: body.title || '',
    url: baseUrl + webui,
  };
}

/** Default HTTP client: global fetch with a timeout. Tests always inject a fake. */
function defaultHttp() {
  return async function httpFetch(url, { headers, timeoutMs } = {}) {
    return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs || REQUEST_TIMEOUT_MS) });
  };
}

module.exports = { confluenceConfig, pageUrl, fetchPage, defaultHttp, DEFAULT_BASE_URL };
