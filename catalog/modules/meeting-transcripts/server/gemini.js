'use strict';
// modules/meeting-transcripts/server/gemini.js
// One function, generateJson, over Node's fetch. The API key travels ONLY in
// the x-goog-api-key header: never in a URL (an earlier tool passed it as a
// URL query parameter in a child-process argv, visible to anyone running
// `ps`), never in a log line, never in an error message - errors are rebuilt
// from the HTTP status and Google's own error text, not from the request.
//
// Model: FLASH ONLY, by decision (2026-10-03) - Pro is slower and dearer with
// no visible gain for meeting notes, so there is no choice on the page. The
// newest Flash the key can use is read from models.list (below); gemini-3.8-flash (GA
// 2026-09-02) is the fallback. thinkingLevel 'low' is the lowest the 3.x
// Flash accepts ('minimal' -> 400).

const DEFAULT_MODEL = 'gemini-3.8-flash';
const MODELS_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 300000;

function baseUrl() {
  return (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
}

function apiKey() {
  return (process.env.GEMINI_PERSONAL_TOKEN || '').trim();
}

class GeminiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 0;
    this.transient = code === 'gemini-network' || status === 429 || status >= 500;
  }
}

async function _once({ model, parts, schema, maxOutputTokens, thinkingLevel, signal }) {
  const key = apiKey();
  if (!key) throw new GeminiError('no-token', 'No Gemini key - unlock the vault (Bitwarden).');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  let resp;
  try {
    resp = await fetch(baseUrl() + '/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          maxOutputTokens,
          thinkingConfig: { thinkingLevel },
        },
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (signal && signal.aborted) throw new GeminiError('aborted', 'Cancelled.');
    throw new GeminiError('gemini-network', 'No connection to Gemini (' + (e && e.name === 'AbortError' ? 'timed out' : 'network') + ').');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
  let payload = null;
  try { payload = await resp.json(); } catch { payload = null; }
  if (!resp.ok) {
    const msg = payload && payload.error && payload.error.message ? String(payload.error.message).slice(0, 300) : resp.statusText;
    throw new GeminiError('gemini-http', 'Gemini HTTP ' + resp.status + ': ' + msg, resp.status);
  }
  const cand = payload && payload.candidates && payload.candidates[0];
  if (!cand) throw new GeminiError('gemini-empty', 'Gemini returned no answer.');
  if (cand.finishReason === 'MAX_TOKENS') {
    throw new GeminiError('max-tokens', 'Gemini answer cut off (limit of ' + maxOutputTokens + ' tokens).');
  }
  const text = cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || '').join('');
  if (!text) throw new GeminiError('gemini-empty', 'Gemini returned an empty answer (' + (cand.finishReason || '?') + ').');
  try { return JSON.parse(text); } catch {
    throw new GeminiError('gemini-json', 'Gemini returned invalid JSON.');
  }
}

// -- which model to use --------------------------------------------------------
// Instead of a hand-kept id per release, the module asks models.list with the
// person's own key and uses the HIGHEST Flash that supports generateContent.
// Plain ids only: gemini-<major>.<minor>-flash with an optional -preview;
// variants (-lite, -tts, -image, -exp, dated snapshots) are not
// meeting-transcription models and are skipped. At the same version a GA id
// beats its -preview. pickLatestModels still reports the Pro it sees - the
// module does not use it.

const MODEL_ID_RE = /^gemini-(\d+)(?:\.(\d+))?-(flash|pro)(-preview)?$/;

/** Pure: names from models.list -> { flash, pro } (either may be null). */
function pickLatestModels(entries) {
  const best = { flash: null, pro: null };
  for (const e of entries || []) {
    const id = String((e && e.name) || '').replace(/^models\//, '');
    const methods = (e && e.supportedGenerationMethods) || [];
    if (methods.length && !methods.includes('generateContent')) continue;
    const m = MODEL_ID_RE.exec(id);
    if (!m) continue;
    const cand = { id, major: Number(m[1]), minor: Number(m[2] || 0), ga: !m[4] };
    const cur = best[m[3]];
    const better = !cur || cand.major > cur.major || (cand.major === cur.major && (cand.minor > cur.minor
      || (cand.minor === cur.minor && cand.ga && !cur.ga)));
    if (better) best[m[3]] = cand;
  }
  return { flash: best.flash ? best.flash.id : null, pro: best.pro ? best.pro.id : null };
}

let _modelsCache = null; // { at, keyTag, value: { model, source } }

/**
 * The one model every call uses: the newest Flash from the live list, cached
 * for an hour per key; DEFAULT_MODEL when there is no key or the list fails.
 */
async function currentModel({ refresh } = {}) {
  const key = apiKey();
  const fallback = { model: DEFAULT_MODEL, source: 'fallback' };
  if (!key) return fallback;
  const keyTag = key.slice(-6);
  if (!refresh && _modelsCache && _modelsCache.keyTag === keyTag && Date.now() - _modelsCache.at < MODELS_TTL_MS) {
    return _modelsCache.value;
  }
  try {
    const entries = [];
    let pageToken = '';
    for (let i = 0; i < 10; i++) {
      const resp = await fetch(baseUrl() + '/v1beta/models?pageSize=1000' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), {
        headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      entries.push(...(data.models || []));
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    const picked = pickLatestModels(entries);
    const value = { model: picked.flash || DEFAULT_MODEL, source: picked.flash ? 'api' : 'fallback' };
    _modelsCache = { at: Date.now(), keyTag, value };
    return value;
  } catch {
    return fallback;
  }
}

/** generateContent with a JSON responseSchema; one retry with backoff on a transient failure. */
async function generateJson(opts) {
  const o = { maxOutputTokens: 8192, thinkingLevel: 'low', ...opts };
  try {
    return await _once(o);
  } catch (e) {
    if (!(e instanceof GeminiError) || !e.transient || (o.signal && o.signal.aborted)) throw e;
    await new Promise((r) => setTimeout(r, e.status === 429 ? 5000 : 1500));
    return _once(o);
  }
}

module.exports = {
  DEFAULT_MODEL, generateJson, GeminiError, hasKey: () => !!apiKey(),
  pickLatestModels, currentModel,
};
