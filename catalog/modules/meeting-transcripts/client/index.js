// modules/meeting-transcripts/client/index.js
// One view, four cards:
//   Queue          the server's persistent queue (uploads + OneDrive), the job
//                  running now with its progress and log, the next scheduled run
//   New recording  pick a file, upload it in 6 MB JSON slices, enqueue it
//   Transcripts    results in user-data/transcripts/, each with a "send to the
//                  Meeting Archive" button (or the badge linking the meeting)
//   Automatic fetching  OneDrive folders, schedule, filters, Microsoft
//                  session, run history
// The server does all the work; this page only polls GET /queue (fast while
// something runs, slow otherwise) and repaints. The upload state (_upload)
// lives at module level ON PURPOSE: leaving the view does not stop an upload.
//
// Every non-GET fetch sends Content-Type: application/json - the host answers
// 415 otherwise.

const VIEW_ID = 'meeting-transcripts-main';
const ICONS = '/assets/icons/ds/';
const ILLUSTRATIONS = '/assets/mascot/';
const icon = (slug) => '<img class="nav-icon meeting-transcripts-icon" src="' + ICONS + slug + '.svg" alt="" aria-hidden="true">';
const POLL_FAST_MS = 3000;
const POLL_SLOW_MS = 30000;

let _deps = null;
let _status = null;
let _items = null;
let _archive = null;
let _listError = '';
let _queue = null;
let _cfg = null;
let _runs = null;
let _file = null;
let _participants = '';
let _upload = null; // { percent, step, error }
let _showLog = false;
let _pollTimer = null;
let _publishing = new Set();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i ? 1 : 0) + ' ' + u[i];
}

function fmtDuration(sec) {
  const t = Math.round(Number(sec) || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h ? h + ' h ' + m + ' min' : m + ' min ' + (t % 60) + ' s';
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "gemini-3.8-flash" -> "Gemini 3.8 Flash", "-preview" -> " (preview)"; anything else verbatim. */
function modelLabel(id) {
  const m = /^gemini-(\d+(?:\.\d+)?)-(flash|pro)(-preview)?$/.exec(id || '');
  if (!m) return id;
  return 'Gemini ' + m[1] + ' ' + (m[2] === 'pro' ? 'Pro' : 'Flash') + (m[3] ? ' (preview)' : '');
}

function uploading() { return !!_upload && !_upload.error && _upload.percent < 100; }

async function getJson(path) {
  const res = await fetch(_deps.apiBase + path);
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
  return data;
}

async function postJson(path, body) {
  const res = await fetch(_deps.apiBase + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const e = new Error((data && data.message) || ('HTTP ' + res.status));
    e.code = data && data.error;
    throw e;
  }
  return data;
}

function readSliceBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });
}

// -- data -------------------------------------------------------------------

async function loadStatus() {
  try { _status = await getJson('/status'); } catch { _status = { error: true }; }
}

async function loadList() {
  try {
    const data = await getJson('/list');
    _items = Array.isArray(data.items) ? data.items : [];
    _archive = data.archive || null;
    _listError = '';
  } catch {
    _items = [];
    _listError = 'Could not load the transcript list.';
  }
}

async function loadQueue() {
  try { _queue = await getJson('/queue'); } catch { _queue = _queue || { items: [], error: true }; }
}

async function loadSettings() {
  try { _cfg = await getJson('/settings'); } catch { _cfg = { error: true }; }
  try { _runs = (await getJson('/runs')).runs || []; } catch { _runs = []; }
}

// -- upload -------------------------------------------------------------------

async function startUpload() {
  if (uploading() || !_file) return;
  const file = _file;
  _upload = { percent: 0, step: 'Uploading the file...', error: null };
  paintAll();
  let uploadId = null;
  try {
    const start = await postJson('/upload-start', { name: file.name, size: file.size, lastModified: file.lastModified });
    uploadId = start.uploadId;
    const step = start.chunkBytes;
    const total = Math.ceil(file.size / step);
    for (let i = 0; i < total; i++) {
      const data = await readSliceBase64(file.slice(i * step, Math.min(file.size, (i + 1) * step)));
      await postJson('/upload-chunk', { uploadId, index: i, dataBase64: data });
      _upload.percent = Math.round(((i + 1) / total) * 99);
      _upload.step = 'Uploading the file: ' + fmtBytes(Math.min(file.size, (i + 1) * step)) + ' of ' + fmtBytes(file.size);
      paintUpload();
    }
    await postJson('/upload-finish', { uploadId });
    await postJson('/enqueue', { uploadId, participants: _participants || '' });
  } catch (e) {
    if (uploadId) postJson('/upload-cancel', { uploadId }).catch(() => {});
    _upload = { percent: 0, step: '', error: e.message || 'The upload failed.' };
    if (_deps) _deps.showToast('danger', 'Upload failed', _upload.error);
    paintAll();
    return;
  }
  _upload = null;
  _file = null;
  _participants = '';
  if (_deps) _deps.showToast('success', 'Recording queued', file.name + ' - transcription will start automatically.');
  await loadQueue();
  paintAll();
  schedulePoll();
}

// -- painting: shared -------------------------------------------------------------

function statusCalloutsHtml() {
  if (!_status) return '';
  if (_status.error) return '<div class="ds-callout ds-callout--danger">Could not check the module state.</div>';
  const out = [];
  if (!_status.hasToken) {
    out.push('<div class="ds-callout ds-callout--warning">No Gemini key. Open the vault (Bitwarden) - the key loads by itself and the queue starts without a page refresh.</div>');
  }
  if (!_status.hasFfmpeg) {
    const cmd = _status.platform === 'win32' ? 'winget install Gyan.FFmpeg' : 'brew install ffmpeg';
    out.push('<div class="ds-callout ds-callout--warning">ffmpeg, which extracts the audio from a recording, is missing. Install it with <code>' + esc(cmd) + '</code> and restart Mission Deck.</div>');
  }
  return out.join('');
}

function card(title, bodyHtml, headerExtra) {
  return '<div class="ds-card"><div class="ds-card-header meeting-transcripts-card-head"><h3 class="ds-card-title">' + esc(title) + '</h3>'
    + (headerExtra || '') + '</div><div class="ds-card-body">' + bodyHtml + '</div></div>';
}

function progressHtml(percent, step, variant, label) {
  return '<div class="ds-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '" aria-label="' + esc(label) + '">'
    + '<div class="ds-progress-labels"><span>' + esc(step || '') + '</span><span>' + percent + '%</span></div>'
    + '<div class="ds-progress-track"><div class="ds-progress-fill ' + variant + '" style="width:' + percent + '%"></div></div></div>';
}

// -- painting: queue -------------------------------------------------------------

const QUEUE_BADGE = {
  queued: ['gray', 'Queued'],
  processing: ['blue', 'Processing'],
  done: ['green', 'Done'],
  failed: ['red', 'Error'],
};

function blockedText(code) {
  if (code === 'paused') return 'The queue is paused - recordings wait, and so does automatic fetching. Resume with the "Resume" button at the top of the page.';
  if (code === 'no-token') return 'The queue is waiting for the Gemini key - open the vault (Bitwarden).';
  if (code === 'no-ffmpeg') return 'The queue is waiting for ffmpeg - install it and restart Mission Deck.';
  return '';
}

function originLabel(i) {
  if (i.origin === 'onedrive') return 'OneDrive' + (i.folderLabel ? ': ' + i.folderLabel : '');
  return 'Uploaded by hand';
}

function queueHtml() {
  const q = _queue;
  if (!q) {
    return '<div class="meeting-transcripts-skel" aria-busy="true" aria-label="Loading the queue"><span class="ds-skeleton ds-skeleton--text"></span><span class="ds-skeleton ds-skeleton--text"></span></div>';
  }
  const parts = [];
  const info = [];
  if (q.cycle) info.push('<b>Cycle running</b> (' + (q.cycle.trigger === 'schedule' ? 'schedule' : 'manual') + '): ' + esc(q.cycle.phase || ''));
  if (q.extraScan) info.push('<b>' + esc(q.extraScan.phase || 'Extra download from OneDrive') + '</b>');
  if (q.nextRunAt) info.push('Next automatic fetch: <b>' + esc(fmtDate(q.nextRunAt)) + '</b>');
  else info.push('Automatic fetching is off.');
  if (q.lastRun) info.push('Last cycle: ' + esc(fmtDate(q.lastRun.startedAt)) + ' - ' + esc(runSummary(q.lastRun)));
  parts.push('<div class="meeting-transcripts-meta meeting-transcripts-info">' + info.map((x) => '<div>' + x + '</div>').join('') + '</div>');
  if (q.blocked) parts.push('<div class="ds-callout ds-callout--warning">' + esc(blockedText(q.blocked)) + '</div>');

  const items = q.items || [];
  if (!items.length) {
    parts.push('<div class="meeting-transcripts-meta">The queue is empty.</div>');
    return parts.join('');
  }
  const rows = items.map((i) => {
    const [color, label] = QUEUE_BADGE[i.status] || ['gray', i.status];
    let detail = '';
    if (q.current && q.current.id === i.id) {
      detail = progressHtml(q.current.percent, q.current.step, 'ds-progress-fill--brand', 'Transcription progress')
        + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-log>' + (_showLog ? 'Hide log' : 'Show log') + '</button>'
        + (_showLog && q.current.log.length
          ? '<div class="meeting-transcripts-log" role="log" aria-live="polite">' + q.current.log.map((l) => '<div>' + esc(l) + '</div>').join('') + '</div>' : '');
    } else if (i.status === 'failed') {
      detail = '<div class="meeting-transcripts-sub meeting-transcripts-error">' + esc(i.message || i.error || '') + ' (attempts: ' + (i.attempts || 0) + ')</div>';
    } else if (i.message) {
      detail = '<div class="meeting-transcripts-sub">' + esc(i.message) + '</div>';
    }
    if (i.status === 'done' && i.published) {
      detail += '<div class="meeting-transcripts-sub">In the Meeting Archive' + (i.published.pushOk ? '' : ' (saved locally, waiting to be sent)') + '</div>';
    }
    const acts = [];
    if (i.status === 'processing') acts.push('<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-cancel="' + esc(i.id) + '">Cancel</button>');
    if (i.status === 'failed' && i.hasInput) acts.push('<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ts-retry="' + esc(i.id) + '">Retry</button>');
    if ((i.status === 'done' || i.status === 'failed') && !(q.current && q.current.id === i.id)) {
      acts.push('<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-itemlog="' + esc(i.id) + '">Log</button>');
    }
    if (i.status === 'done' && i.origin === 'onedrive' && !i.published) {
      acts.push('<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-redo="' + esc(i.id) + '" title="Downloads the recording from OneDrive again and processes it from scratch">Process again</button>');
    }
    if (i.status !== 'processing' && i.status !== 'done') acts.push('<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-remove="' + esc(i.id) + '">Remove</button>');
    return '<tr>'
      + '<td><b>' + esc(i.status === 'done' && i.message ? i.message : i.sourceName) + '</b>'
      + '<div class="meeting-transcripts-sub">' + esc(i.sourceName) + ' · ' + esc(fmtBytes(i.sourceBytes)) + ' · ' + esc(originLabel(i)) + '</div>' + detail + '</td>'
      + '<td>' + esc(fmtDate(i.recordedAt || i.createdAt)) + '</td>'
      + '<td><span class="ds-badge ds-badge--md ds-badge--' + color + '">' + esc(label) + '</span></td>'
      + '<td class="right"><div class="meeting-transcripts-row-actions">' + acts.join('') + '</div></td>'
      + '</tr>';
  }).join('');
  parts.push('<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Recording</th><th>Date</th><th>Status</th><th class="right">Actions</th></tr></thead><tbody>'
    + rows + '</tbody></table></div>');
  return parts.join('');
}

function runSummary(r) {
  if (!r) return '';
  const bits = [];
  if (r.scan) {
    bits.push('downloaded ' + r.scan.downloaded);
    if (r.scan.expired) bits.push('Microsoft session expired');
    if (r.scan.errors && r.scan.errors.length) bits.push('OneDrive errors: ' + r.scan.errors.length);
  }
  bits.push('processed ' + (r.processed || 0));
  if (r.failed) bits.push('failed ' + r.failed);
  if (r.published) bits.push('sent to the archive ' + r.published);
  if (r.publishErrors && r.publishErrors.length) bits.push('not sent ' + r.publishErrors.length);
  for (const n of r.notes || []) {
    if (n === 'no-folders') bits.push('no OneDrive folders');
    else if (n === 'no-token') bits.push('no Gemini key');
    else if (n === 'no-ffmpeg') bits.push('no ffmpeg');
    else if (n === 'sso-busy') bits.push('browser busy');
  }
  return bits.join(', ');
}

// -- painting: upload form ------------------------------------------------------------

function filePickerHtml() {
  const dis = uploading() ? ' disabled' : '';
  const accept = ((_status && _status.extensions) || []).join(',') + ',audio/*,video/*';
  const input = '<input type="file" id="meeting-transcripts-file" accept="' + esc(accept) + '" hidden data-ts-file>';
  if (!_file) {
    return input + '<div><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ts-pick'
      + ' aria-describedby="meeting-transcripts-file-hint"' + dis + '>' + icon('16-ic-upload') + 'Choose a file</button></div>';
  }
  return input + '<div class="meeting-transcripts-file-picker">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ts-pick'
    + ' aria-label="' + esc('Change file: ' + _file.name) + '" aria-describedby="meeting-transcripts-file-hint"' + dis + '>'
    + icon('16-ic-file-movie') + '<span class="meeting-transcripts-file-name">' + esc(_file.name) + '</span>'
    + '<span class="meeting-transcripts-file-size">' + esc(fmtBytes(_file.size)) + '</span></button>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm ds-icon-btn--secondary" data-ts-clear aria-label="Remove the chosen file"' + dis + '>'
    + icon('16-ic-cross') + '</button></div>';
}

function uploadHtml() {
  if (!_upload) return '';
  if (_upload.error) return '<div class="ds-callout ds-callout--danger">' + esc(_upload.error) + '</div>';
  return progressHtml(_upload.percent, _upload.step, 'ds-progress-fill--brand', 'Upload');
}

function formHtml() {
  const dis = uploading() ? ' disabled' : '';
  const canAdd = !!_file && !uploading();
  return '<div class="meeting-transcripts-form">'
    + '<div class="ds-input-wrap"><span class="ds-label" id="meeting-transcripts-file-label">Recording file</span>'
    + filePickerHtml()
    + '<div class="ds-hint" id="meeting-transcripts-file-hint">An audio or video recording of a meeting (e.g. from Teams), up to 2 GB: '
    + esc(((_status && _status.extensions) || []).map((e) => e.slice(1)).join(', ')) + '. It joins the queue and is processed in the background.</div></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="meeting-transcripts-participants">Participants (optional)</label>'
    + '<input id="meeting-transcripts-participants" class="ds-input" type="text" data-ts-participants value="' + esc(_participants) + '"'
    + ' placeholder="e.g. Alex Morgan, Sam Rivera" aria-describedby="meeting-transcripts-participants-hint"' + dis + '>'
    + '<div class="ds-hint" id="meeting-transcripts-participants-hint">Comma-separated names help recognise who is speaking.</div></div>'
    + (_status && _status.model
      ? '<div class="ds-hint">Transcription and summary: ' + esc(modelLabel(_status.model)) + ' - always the newest Flash version available to your Gemini key.</div>'
      : '')
    + '<div id="meeting-transcripts-upload">' + uploadHtml() + '</div>'
    + '<div><button type="button" class="ds-btn ds-btn--primary" data-ts-start' + (canAdd ? '' : ' disabled') + (uploading() ? ' aria-busy="true"' : '') + '>Add to queue</button></div>'
    + '</div>';
}

// -- painting: transcripts ---------------------------------------------------------------

function reportLinkHtml(name, variant) {
  return '<a class="ds-btn ' + variant + '" href="' + esc(_deps.apiBase + '/report?name=' + encodeURIComponent(name)) + '"'
    + ' target="_blank" rel="noopener noreferrer" aria-label="HTML report (opens in a new tab)">'
    + 'HTML report' + icon('16-ic-external-link') + '</a>';
}

function statusBadge(s) {
  if (s === 'ok') return '<span class="ds-badge ds-badge--md ds-badge--green">Done</span>';
  if (s === 'partial') return '<span class="ds-badge ds-badge--md ds-badge--yellow">Partial</span>';
  return '<span class="ds-badge ds-badge--md ds-badge--gray">' + esc(s || '-') + '</span>';
}

function archiveCellHtml(r) {
  if (r.published) {
    return '<a class="ds-badge ds-badge--md ds-badge--green meeting-transcripts-badge-link" href="#meeting-archive-main/' + encodeURIComponent(r.published.folder) + '"'
      + ' title="Open in the Meeting Archive">Sent</a>'
      + ' <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-publish="' + esc(r.name) + '" title="Send again (overwrites the content, keeps categories and folder)">Send again</button>';
  }
  const disabled = !_archive || !_archive.available || _archive.storage !== 'ok' || !r.segments || _publishing.has(r.name);
  const why = !_archive || !_archive.available ? 'Install the Meeting Archive module'
    : _archive.storage !== 'ok' ? 'Pull the "Team data" source in the Sync window' : '';
  return '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ts-publish="' + esc(r.name) + '"'
    + (disabled ? ' disabled' : '') + (why ? ' title="' + esc(why) + '"' : '')
    + (_publishing.has(r.name) ? ' aria-busy="true"' : '') + '>Send to archive</button>';
}

function listHtml() {
  if (_items === null) {
    return '<div class="meeting-transcripts-skel" aria-busy="true" aria-label="Loading the list">'
      + '<span class="ds-skeleton ds-skeleton--text"></span><span class="ds-skeleton ds-skeleton--text"></span>'
      + '<span class="ds-skeleton ds-skeleton--text"></span></div>';
  }
  if (_listError) return '<div class="ds-callout ds-callout--danger">' + esc(_listError) + '</div>';
  if (!_items.length) {
    return '<div class="ds-empty"><div class="ds-empty-icon"><img class="meeting-transcripts-illustration" src="' + ILLUSTRATIONS + 'pip-idle.svg" alt="" aria-hidden="true"></div>'
      + '<div class="ds-empty-title">No transcripts</div>'
      + '<div class="ds-empty-desc">Add a recording above or wait for the automatic OneDrive fetch. The result is saved in the user-data/transcripts/ folder.</div></div>';
  }
  const note = _archive && _archive.available && _archive.storage !== 'ok'
    ? '<div class="ds-callout ds-callout--info">The Meeting Archive is not available on this computer - pull the "Team data" source in the Sync window to send meetings.</div>' : '';
  return note + '<div class="ds-table-wrap"><table class="ds-table"><thead><tr>'
    + '<th>Meeting</th><th>Date</th><th>Duration</th><th>Status</th><th>Meeting Archive</th><th class="right">Actions</th></tr></thead><tbody>'
    + _items.map((r) => '<tr>'
      + '<td><b>' + esc(r.title || r.source_file || r.name) + '</b><div class="meeting-transcripts-sub">' + esc(r.source_file) + '</div></td>'
      + '<td>' + esc(fmtDate(r.recorded_at || r.processed_at)) + '</td>'
      + '<td>' + esc(fmtDuration(r.duration_sec)) + '</td>'
      + '<td>' + statusBadge(r.status) + '</td>'
      + '<td><div class="meeting-transcripts-row-actions">' + archiveCellHtml(r) + '</div></td>'
      + '<td class="right"><div class="meeting-transcripts-row-actions">'
      + (r.hasReport
        ? reportLinkHtml(r.name, 'ds-btn--tertiary ds-btn--sm')
        : '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-build="' + esc(r.name) + '">Build report</button>')
      + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ts-open="' + esc(r.name) + '">Open</button>'
      + '</div></td>'
      + '</tr>').join('')
    + '</tbody></table></div>';
}

// -- painting: OneDrive settings ------------------------------------------------------------

function sessionHtml(s) {
  if (!s) return '';
  let text;
  let kind;
  if (s.running === 'login') { text = 'Sign-in in progress - finish it in the open browser window.'; kind = 'info'; }
  else if (s.running === 'keepalive') { text = 'Checking the session in every folder...'; kind = 'info'; }
  else if (s.expiredAt && (!s.loggedInAt || s.expiredAt > s.loggedInAt)) { text = 'The Microsoft session expired ' + fmtDate(s.expiredAt) + '. Sign in again so fetching works.'; kind = 'warning'; }
  else if (s.present) { text = 'Signed in to Microsoft ' + fmtDate(s.loggedInAt) + (s.stale ? ' - the session may be out of date.' : '.'); kind = s.stale ? 'warning' : 'success'; }
  else if (s.seedPresent) { text = 'No session of its own - fetching will try the shared Microsoft session from other modules. If that fails, sign in.'; kind = 'info'; }
  else { text = 'No Microsoft session. Sign in to fetch recordings from OneDrive.'; kind = 'warning'; }
  if (s.lastLogin && s.lastLogin.ok === false && s.lastLogin.error) text += ' Last sign-in: ' + s.lastLogin.error + '.';
  if (s.keepaliveAt) text += ' Last session keep-alive: ' + fmtDate(s.keepaliveAt) + '.';
  return '<div class="ds-callout ds-callout--' + kind + ' meeting-transcripts-session"><div>' + esc(text) + '</div>'
    + '<div class="meeting-transcripts-row-actions">'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-keepalive' + (s.running ? ' disabled' : '') + '>Check session</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ts-login' + (s.running ? ' disabled' : '') + '>Sign in to Microsoft</button></div></div>';
}

function settingsHtml() {
  if (!_cfg) return '<div class="meeting-transcripts-skel" aria-busy="true" aria-label="Loading settings"><span class="ds-skeleton ds-skeleton--text"></span></div>';
  if (_cfg.error) return '<div class="ds-callout ds-callout--danger">Could not load the settings.</div>';
  const s = _cfg.settings;
  return '<div id="meeting-transcripts-session">' + sessionHtml(_cfg.session) + '</div>'
    + settingsFormHtml(s) + '<div id="meeting-transcripts-runs">' + runsHtml() + '</div>';
}

function runsHtml() {
  const runs = (_runs || []).slice(0, 8).map((r) => '<tr><td>' + esc(fmtDate(r.startedAt)) + '</td><td>' + (r.trigger === 'schedule' ? 'Schedule' : 'Manual') + '</td>'
    + '<td>' + esc(runSummary(r)) + (r.scan && r.scan.errors && r.scan.errors.length
      ? '<div class="meeting-transcripts-sub">' + r.scan.errors.slice(0, 5).map((e) => esc((e.folder ? e.folder + ': ' : '') + odErrorText(e.code) + (e.message ? ' ' + e.message : ''))).join('<br>') + '</div>' : '')
    + '</td></tr>').join('');
  return runs ? '<h4 class="meeting-transcripts-h">Recent cycles</h4><div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Start</th><th>Trigger</th><th>Result</th></tr></thead><tbody>' + runs + '</tbody></table></div>' : '';
}

/** Session state of one personal site, from the last login / scan / keepalive. */
function siteChip(siteUrl) {
  const st = _cfg && _cfg.session && _cfg.session.sites ? _cfg.session.sites[siteUrl] : null;
  if (!st) return '<span class="ds-badge ds-badge--sm ds-badge--gray">session unknown</span>';
  return st.ok
    ? '<span class="ds-badge ds-badge--sm ds-badge--green" title="' + esc(fmtDate(st.at)) + '">session active</span>'
    : '<span class="ds-badge ds-badge--sm ds-badge--red" title="' + esc(fmtDate(st.at)) + '">sign-in required</span>';
}

function settingsFormHtml(s) {
  const folders = s.folders.map((f, idx) => '<tr>'
    + '<td><label class="ds-checkbox-label"><input type="checkbox" data-ts-folder-enabled="' + idx + '"' + (f.enabled ? ' checked' : '') + '><span>' + esc(f.label) + '</span></label>'
    + '<div class="meeting-transcripts-sub">' + esc(f.serverRelativePath) + '</div></td>'
    + '<td>' + siteChip(f.siteUrl) + '</td>'
    + '<td class="right"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-folder-remove="' + idx + '">Remove</button></td></tr>').join('');
  return '<form class="meeting-transcripts-settings" data-ts-settings novalidate>'
    + '<div class="meeting-transcripts-grid">'
    + '<label class="ds-checkbox-label"><input type="checkbox" name="schedEnabled"' + (s.schedule.enabled ? ' checked' : '') + '><span>Fetch and process every day</span></label>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="ts-sched-time">Time</label><input class="ds-input" type="time" id="ts-sched-time" name="time" value="' + esc(s.schedule.time) + '"></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="ts-min-size">Minimum size (MB)</label><input class="ds-input" type="number" min="0" max="5000" id="ts-min-size" name="minSizeMb" value="' + esc(s.minSizeMb) + '"></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="ts-since">Recordings since</label><input class="ds-input" type="date" id="ts-since" name="sinceDate" value="' + esc(s.sinceDate || '') + '"></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="ts-max">Most recordings per cycle</label><input class="ds-input" type="number" min="1" max="100" id="ts-max" name="maxFilesPerRun" value="' + esc(s.maxFilesPerRun) + '"></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="ts-keepalive">Keep the Microsoft session alive</label><select class="ds-input" id="ts-keepalive" name="keepaliveHours">'
    + [[0, 'do not keep alive'], [1, 'every hour'], [2, 'every 2 hours'], [4, 'every 4 hours'], [8, 'every 8 hours'], [12, 'every 12 hours']]
      .map(([v, l]) => '<option value="' + v + '"' + (s.keepaliveHours === v ? ' selected' : '') + '>' + l + '</option>').join('')
    + '</select></div>'
    + '</div>'
    + '<label class="ds-checkbox-label"><input type="checkbox" name="autoPublish"' + (s.autoPublish ? ' checked' : '') + '><span>Send to the Meeting Archive (and the team) right after processing</span></label>'
    + '<div class="ds-hint">The computer must be on and the vault open (Gemini key). If the computer is asleep at that time, the cycle runs after it wakes the same day. '
    + 'Recordings already in the Meeting Archive are not downloaded again.</div>'
    + '<h4 class="meeting-transcripts-h">OneDrive folders</h4>'
    + (folders ? '<div class="ds-table-wrap"><table class="ds-table"><tbody>' + folders + '</tbody></table></div>' : '<div class="meeting-transcripts-meta">No folders.</div>')
    + '<div class="meeting-transcripts-add">'
    + '<input class="ds-input" id="ts-new-url" placeholder="Folder address from the browser bar (OneDrive, with the id= parameter)" aria-label="OneDrive folder address">'
    + '<input class="ds-input" id="ts-new-label" placeholder="Name (optional)" aria-label="Folder name" maxlength="80">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ts-folder-add>Add folder</button></div>'
    + '<h4 class="meeting-transcripts-h">Teams name assignments</h4>'
    + '<div class="ds-hint">Teams labels that are not in the team directory or that Teams cuts short. A label with a prefix (EXT, CTR…) is matched by itself: the first word is the surname, e.g. "EXT Morg" → Alex Morgan.</div>'
    + ((s.aliases || []).length
      ? '<div class="ds-table-wrap"><table class="ds-table"><tbody>' + s.aliases.map((a, idx) => '<tr><td>' + esc(a.label) + '</td><td>→ ' + esc(a.name) + '</td>'
        + '<td class="right"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ts-alias-remove="' + idx + '">Remove</button></td></tr>').join('') + '</tbody></table></div>'
      : '<div class="meeting-transcripts-meta">No assignments.</div>')
    + '<div class="meeting-transcripts-add">'
    + '<input class="ds-input" id="ts-alias-label" maxlength="80" placeholder="Teams label, e.g. EXT Riv" aria-label="Teams label">'
    + '<input class="ds-input" id="ts-alias-name" maxlength="80" placeholder="Full name" aria-label="Full name">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ts-alias-add>Add assignment</button></div>'
    + '<div><button type="button" class="ds-btn ds-btn--secondary" data-ts-save>Save settings</button></div>'
    + '</form>';
}

function odErrorText(code) {
  return ({
    'no-access': 'no access to the folder',
    missing: 'the folder does not exist',
    offline: 'no network (VPN?)',
    download: 'download failed',
    'browser-missing': 'no Chrome/Edge browser',
    'playwright-unavailable': 'Playwright library missing',
    timeout: 'timed out',
  })[code] || code;
}

function paintActions() {
  const actions = document.getElementById(VIEW_ID + '-actions');
  if (!actions) return;
  const busy = !!(_queue && (_queue.extraScan || (_queue.cycle && /^Downloading|^Checking/.test(_queue.cycle.phase || ''))));
  const paused = !!(_queue && _queue.paused);
  actions.innerHTML = '<button type="button" class="ds-btn ds-btn--tertiary" data-ts-pause="' + (paused ? '0' : '1') + '">'
    + icon(paused ? '16-ic-play' : '16-ic-pause') + (paused ? 'Resume' : 'Pause') + '</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-ts-run' + (busy ? ' disabled aria-busy="true"' : '') + '>'
    + icon('16-ic-download') + 'Check OneDrive now</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-ts-refresh>' + icon('16-ic-refresh') + 'Refresh</button>';
}

function paintUpload() {
  const el = document.getElementById('meeting-transcripts-upload');
  if (el) el.innerHTML = uploadHtml();
}

function paintQueue() {
  const el = document.getElementById('meeting-transcripts-queue');
  if (!el) return;
  const log = el.querySelector('.meeting-transcripts-log');
  const atBottom = !log || log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  el.innerHTML = queueHtml();
  const nlog = el.querySelector('.meeting-transcripts-log');
  if (nlog && atBottom) nlog.scrollTop = nlog.scrollHeight;
  paintActions();
}

function paintList() {
  const el = document.getElementById('meeting-transcripts-list');
  if (el) el.innerHTML = listHtml();
}

/** Session line and run history only - never the settings form a person may be editing. */
function paintSettingsStatus() {
  const s = document.getElementById('meeting-transcripts-session');
  if (s && _cfg && _cfg.session) s.innerHTML = sessionHtml(_cfg.session);
  const r = document.getElementById('meeting-transcripts-runs');
  if (r) r.innerHTML = runsHtml();
}

function paintAll() {
  const root = document.getElementById(VIEW_ID + '-root');
  if (!root) return;
  root.innerHTML = '<div class="meeting-transcripts-layout">'
    + statusCalloutsHtml()
    + card('Queue', '<div id="meeting-transcripts-queue">' + queueHtml() + '</div>')
    + card('New recording', formHtml())
    + card('Transcripts', '<div id="meeting-transcripts-list">' + listHtml() + '</div>')
    + card('Automatic fetching from OneDrive', settingsHtml())
    + '</div>';
  paintActions();
}

// -- polling --------------------------------------------------------------------------------

function schedulePoll() {
  clearTimeout(_pollTimer);
  if (!document.getElementById(VIEW_ID + '-root')) return;
  const active = _queue && (_queue.current || _queue.cycle || (_queue.items || []).some((i) => i.status === 'queued' || i.status === 'processing'));
  _pollTimer = setTimeout(pollOnce, active ? POLL_FAST_MS : POLL_SLOW_MS);
}

async function pollOnce() {
  if (!document.getElementById(VIEW_ID + '-root')) return;
  const before = _queue ? JSON.stringify((_queue.items || []).map((i) => [i.id, i.status, i.published && i.published.folder])) : '';
  const wasCycle = !!(_queue && _queue.cycle);
  await loadQueue();
  const after = JSON.stringify((_queue.items || []).map((i) => [i.id, i.status, i.published && i.published.folder]));
  if (before !== after || wasCycle !== !!_queue.cycle) {
    // Something finished: the transcript list and the run history moved too.
    await Promise.all([loadList(), wasCycle && !_queue.cycle ? loadSettings() : null]);
    paintQueue();
    paintList();
    paintSettingsStatus();
  } else {
    paintQueue();
  }
  schedulePoll();
}

/** DS confirm dialog; falls back to "no" when the core helper is missing. */
async function ask(title, body, okLabel, danger) {
  try {
    const m = await import('/js/ds-modal.js');
    return await m.confirmDsModal({ title, body, okLabel, danger: !!danger });
  } catch {
    return false;
  }
}

// -- actions ----------------------------------------------------------------------------------

async function publish(name, btn) {
  if (_publishing.has(name)) return;
  _publishing.add(name);
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    const r = await postJson('/publish', { name });
    if (r.push && r.push.ok) {
      _deps.showToast('success', r.republished ? 'Updated in the Meeting Archive' : 'Sent to the Meeting Archive', 'The team already has the changes.');
    } else {
      const why = r.push && r.push.error === 'unknown-operation'
        ? 'Pushing to the "Team data" source is not enabled in this Mission Deck yet.'
        : ((r.push && r.push.message) || 'Sending to the team failed.');
      _deps.showToast('warning', 'Saved in the Meeting Archive on this computer only', why + ' Send it later in the Sync window.');
    }
  } catch (e) {
    _deps.showToast('danger', 'Could not send to the Meeting Archive', e.message || '');
  } finally {
    _publishing.delete(name);
  }
  await Promise.all([loadList(), loadQueue()]);
  paintList();
  paintQueue();
}

async function buildReport(name, btn) {
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    await postJson('/report-build', { name });
    _deps.showToast('success', 'HTML report ready', name.replace(/\.json$/, '.html'));
    await loadList();
    paintList();
  } catch (e) {
    _deps.showToast('danger', 'Could not build the report', (e && e.message) || '');
    if (btn && btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  }
}

async function queueAction(action, id) {
  try {
    await postJson('/queue/' + action, { id });
  } catch (e) {
    _deps.showToast('danger', 'Something went wrong', e.message || '');
  }
  await loadQueue();
  paintQueue();
  schedulePoll();
}

/** Read the settings form into the shape POST /settings takes. */
function readSettingsForm(root) {
  const f = root.querySelector('[data-ts-settings]');
  const s = _cfg.settings;
  return {
    schedule: { enabled: f.elements.schedEnabled.checked, time: f.elements.time.value || s.schedule.time },
    minSizeMb: Number(f.elements.minSizeMb.value),
    sinceDate: f.elements.sinceDate.value || null,
    maxFilesPerRun: Number(f.elements.maxFilesPerRun.value),
    autoPublish: f.elements.autoPublish.checked,
    keepaliveHours: Number(f.elements.keepaliveHours.value),
    aliases: (s.aliases || []).map((a) => ({ label: a.label, name: a.name })),
    folders: s.folders.map((x, idx) => {
      const cb = f.querySelector('[data-ts-folder-enabled="' + idx + '"]');
      return { label: x.label, url: x.url, enabled: cb ? cb.checked : x.enabled };
    }),
  };
}

async function saveSettings(root, patch, okText) {
  try {
    const body = { ...readSettingsForm(root), ...(patch || {}) };
    _cfg = await postJson('/settings', body);
    _deps.showToast('success', okText || 'Settings saved');
    await loadQueue();
    paintAll();
    return true;
  } catch (e) {
    _deps.showToast('danger', 'Could not save the settings', e.message || '');
    return false;
  }
}

async function login() {
  try {
    await postJson('/onedrive/login', {});
    _deps.showToast('info', 'Signing in to Microsoft', 'A browser window is opening - sign in there. If the session is still valid, no window appears.');
  } catch (e) {
    _deps.showToast('danger', 'Could not start the sign-in', e.message || '');
  }
  const until = Date.now() + 10 * 60 * 1000;
  const poll = async () => {
    if (!document.getElementById(VIEW_ID + '-root')) return;
    await loadSettings();
    paintSettingsStatus();
    if (_cfg && _cfg.session && _cfg.session.running === 'login' && Date.now() < until) setTimeout(poll, 4000);
  };
  setTimeout(poll, 1500);
}

async function keepaliveNow(btn) {
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    const r = await postJson('/onedrive/keepalive', {});
    if (r.error) _deps.showToast('warning', 'Could not check the session', r.error);
    else if (r.expired) _deps.showToast('warning', 'The session needs a sign-in', 'Folders without an active session: ' + r.expired + '. Click "Sign in to Microsoft".');
    else _deps.showToast('success', 'Session active', 'Refreshed access to folders: ' + r.ok + '.');
  } catch (e) {
    _deps.showToast('danger', 'Could not check the session', e.message || '');
  }
  await loadSettings();
  paintSettingsStatus();
  const form = document.querySelector('[data-ts-settings]');
  if (form && _cfg && _cfg.settings) form.outerHTML = settingsFormHtml(_cfg.settings);
}

async function runNow() {
  try {
    await postJson('/run-now', {});
    _deps.showToast('info', 'Checking OneDrive', 'New recordings will join the queue and be processed.');
  } catch (e) {
    _deps.showToast('danger', 'Could not start', e.message || '');
  }
  await loadQueue();
  paintQueue();
  schedulePoll();
}

// -- detail modal ---------------------------------------------------------------

async function openDetail(name, trigger) {
  let data;
  try {
    data = await getJson('/file?name=' + encodeURIComponent(name));
  } catch (e) {
    _deps.showToast('danger', 'Could not open the file', (e && e.message) || '');
    return;
  }
  const doc = data.doc || {};
  let md = null; let dsModal = null;
  try { md = await import('/js/md-render.js'); } catch { md = null; }
  try { dsModal = await import('/js/ds-modal.js'); } catch { dsModal = null; }
  const summaryMd = (doc.summary && doc.summary.summary_md) || '';
  const summaryHtml = summaryMd
    ? (md ? md.renderMarkdown(summaryMd) : '<pre class="meeting-transcripts-pre">' + esc(summaryMd) + '</pre>')
    : '<div class="ds-callout ds-callout--neutral">This file has no summary.</div>';
  const people = (doc.participants || []).map((p) => esc(p.name)).join(', ') || '-';
  const row = (_items || []).find((r) => r.name === name);
  const overlay = document.createElement('div');
  document.querySelectorAll('[data-ts-detail]').forEach((el) => el.remove());
  overlay.className = 'ds-modal-overlay';
  overlay.setAttribute('data-ts-detail', '1');
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--xl" role="dialog" aria-modal="true" aria-labelledby="meeting-transcripts-detail-title">'
    + '<div class="ds-modal-header"><h2 class="ds-modal-title" id="meeting-transcripts-detail-title">' + esc(doc.title || doc.source_file || name) + '</h2>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-ts-close aria-label="Close">' + icon('16-ic-cross') + '</button></div>'
    + '<div class="ds-modal-body meeting-transcripts-detail">'
    + '<div class="meeting-transcripts-meta">' + esc(doc.source_file || '') + ' &middot; ' + esc(fmtDuration(doc.duration_sec)) + ' &middot; ' + esc(doc.model || '')
    + (doc.summary && doc.summary.chosen_template ? ' &middot; template: ' + esc(doc.summary.chosen_template) : '') + '</div>'
    + '<div class="meeting-transcripts-meta">Participants: ' + people + '</div>'
    + (doc.brief ? '<div class="ds-callout ds-callout--info">' + esc(doc.brief) + '</div>' : '')
    + '<div class="ds-tabs-list ds-framed-tabs meeting-transcripts-tabs" role="tablist">'
    + '<button type="button" class="ds-tab active" data-ts-tab="summary" role="tab" aria-selected="true" aria-controls="meeting-transcripts-pane-summary" id="meeting-transcripts-tab-summary">Summary</button>'
    + '<button type="button" class="ds-tab" data-ts-tab="transcript" role="tab" aria-selected="false" aria-controls="meeting-transcripts-pane-transcript" id="meeting-transcripts-tab-transcript">Transcript</button></div>'
    + '<div class="meeting-transcripts-pane md-body" data-ts-pane="summary" role="tabpanel" id="meeting-transcripts-pane-summary" aria-labelledby="meeting-transcripts-tab-summary">' + summaryHtml + '</div>'
    + '<div class="meeting-transcripts-pane" data-ts-pane="transcript" role="tabpanel" id="meeting-transcripts-pane-transcript" aria-labelledby="meeting-transcripts-tab-transcript" hidden><pre class="meeting-transcripts-pre">' + esc(doc.transcript_txt || '') + '</pre></div>'
    + '</div>'
    + '<div class="ds-modal-footer">'
    + (row && !row.published && _archive && _archive.available && _archive.storage === 'ok'
      ? '<button type="button" class="ds-btn ds-btn--primary" data-ts-modal-publish>Send to the Meeting Archive</button>' : '')
    + (doc.report_file ? reportLinkHtml(name, 'ds-btn--secondary') : '')
    + '<button type="button" class="ds-btn ds-btn--secondary" data-ts-download>Download JSON</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-ts-close>Close</button></div></div>';
  document.body.appendChild(overlay);
  const shut = () => {
    if (dsModal) dsModal.closeDsModal(overlay);
    overlay.remove();
  };
  overlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-ts-close]')) { shut(); return; }
    if (t.closest('[data-ts-modal-publish]')) { shut(); publish(name, null); return; }
    const tab = t.closest('[data-ts-tab]');
    if (tab) {
      overlay.querySelectorAll('[data-ts-tab]').forEach((b) => { b.classList.toggle('active', b === tab); b.setAttribute('aria-selected', String(b === tab)); });
      overlay.querySelectorAll('[data-ts-pane]').forEach((p) => { p.hidden = p.getAttribute('data-ts-pane') !== tab.getAttribute('data-ts-tab'); });
      return;
    }
    if (t.closest('[data-ts-download]')) {
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  });
  _deps.registerViewCleanup(() => { if (overlay.isConnected) shut(); });
  if (dsModal) dsModal.openDsModal(overlay, { trigger });
  else { overlay.hidden = false; overlay.classList.add('open'); }
}

// -- view -------------------------------------------------------------------------

export const views = {
  [VIEW_ID]: {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;
    },

    async render() {
      const root = document.getElementById(VIEW_ID + '-root');
      if (!root) return;
      paintAll();
      await Promise.all([loadStatus(), loadList(), loadQueue(), loadSettings()]);
      paintAll();
      schedulePoll();

      const onClick = (e) => {
        const t = e.target;
        if (t.closest('[data-ts-start]')) { startUpload(); return; }
        if (t.closest('[data-ts-pick]')) { const inp = root.querySelector('[data-ts-file]'); if (inp) inp.click(); return; }
        if (t.closest('[data-ts-clear]')) { _file = null; if (_upload && _upload.error) _upload = null; paintAll(); return; }
        if (t.closest('[data-ts-refresh]')) { Promise.all([loadStatus(), loadList(), loadQueue(), loadSettings()]).then(paintAll); return; }
        if (t.closest('[data-ts-run]')) { runNow(); return; }
        if (t.closest('[data-ts-login]')) { login(); return; }
        if (t.closest('[data-ts-keepalive]')) { keepaliveNow(t.closest('[data-ts-keepalive]')); return; }
        if (t.closest('[data-ts-log]')) { _showLog = !_showLog; paintQueue(); return; }
        if (t.closest('[data-ts-save]')) { saveSettings(root); return; }
        if (t.closest('[data-ts-folder-add]')) {
          const url = root.querySelector('#ts-new-url').value.trim();
          const label = root.querySelector('#ts-new-label').value.trim();
          if (!url) return;
          const form = readSettingsForm(root);
          saveSettings(root, { folders: [...form.folders, { url, label, enabled: true }] }, 'Folder added');
          return;
        }
        if (t.closest('[data-ts-alias-add]')) {
          const label = root.querySelector('#ts-alias-label').value.trim();
          const name = root.querySelector('#ts-alias-name').value.trim();
          if (!label || !name) return;
          const form = readSettingsForm(root);
          saveSettings(root, { aliases: [...form.aliases, { label, name }] }, 'Assignment added');
          return;
        }
        const arm = t.closest('[data-ts-alias-remove]');
        if (arm) {
          const idx = Number(arm.getAttribute('data-ts-alias-remove'));
          const form = readSettingsForm(root);
          saveSettings(root, { aliases: form.aliases.filter((_, i) => i !== idx) }, 'Assignment removed');
          return;
        }
        const rm = t.closest('[data-ts-folder-remove]');
        if (rm) {
          const idx = Number(rm.getAttribute('data-ts-folder-remove'));
          const f = _cfg.settings.folders[idx];
          if (!f) return;
          const form = readSettingsForm(root);
          ask('Remove the folder?', 'Folder "' + f.label + '" will no longer be checked by automatic fetching.', 'Remove', true)
            .then((yes) => { if (yes) saveSettings(root, { folders: form.folders.filter((_, i) => i !== idx) }, 'Folder removed'); });
          return;
        }
        const pause = t.closest('[data-ts-pause]');
        if (pause) {
          postJson('/pause', { paused: pause.getAttribute('data-ts-pause') === '1' })
            .then((r) => _deps.showToast('info', r.paused ? 'Queue paused' : 'Queue resumed'))
            .catch((err) => _deps.showToast('danger', 'Something went wrong', err.message || ''))
            .then(loadQueue).then(() => { paintQueue(); schedulePoll(); });
          return;
        }
        const itemLog = t.closest('[data-ts-itemlog]');
        if (itemLog) {
          getJson('/queue/log?id=' + encodeURIComponent(itemLog.getAttribute('data-ts-itemlog')))
            .then(async (r) => {
              const m = await import('/js/ds-modal.js');
              await m.confirmDsModal({
                title: 'Processing log',
                bodyHtml: '<div class="meeting-transcripts-log meeting-transcripts-log--modal">'
                  + (r.log.length ? r.log.map((l) => '<div>' + esc(l) + '</div>').join('') : 'No saved log (items from before version 0.2.0).') + '</div>',
                okLabel: 'Close', cancelLabel: 'Cancel',
              });
            })
            .catch((err) => _deps.showToast('danger', 'Could not load the log', err.message || ''));
          return;
        }
        const redo = t.closest('[data-ts-redo]');
        if (redo) {
          ask('Process again?', 'The current transcript and report will be deleted, and the recording will be downloaded from OneDrive on the next check and go through the whole pipeline again.', 'Process again', false)
            .then((yes) => { if (yes) queueAction('redo', redo.getAttribute('data-ts-redo')).then(loadList).then(paintList); });
          return;
        }
        const retry = t.closest('[data-ts-retry]');
        if (retry) { queueAction('retry', retry.getAttribute('data-ts-retry')); return; }
        const cancel = t.closest('[data-ts-cancel]');
        if (cancel) {
          ask('Cancel processing?', 'The recording stays in the queue as failed - you can retry it.', 'Cancel processing', true)
            .then((yes) => { if (yes) queueAction('cancel', cancel.getAttribute('data-ts-cancel')); });
          return;
        }
        const remove = t.closest('[data-ts-remove]');
        if (remove) {
          ask('Remove from the queue?', 'The recording file will be deleted from this computer (it stays on OneDrive).', 'Remove', true)
            .then((yes) => { if (yes) queueAction('remove', remove.getAttribute('data-ts-remove')); });
          return;
        }
        const pub = t.closest('[data-ts-publish]');
        if (pub && !pub.disabled) { publish(pub.getAttribute('data-ts-publish'), pub); return; }
        const open = t.closest('[data-ts-open]');
        if (open) { openDetail(open.getAttribute('data-ts-open'), open); return; }
        const build = t.closest('[data-ts-build]');
        if (build && !build.disabled) buildReport(build.getAttribute('data-ts-build'), build);
      };
      const onChange = (e) => {
        if (e.target.matches('[data-ts-file]')) {
          _file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
          if (_upload && _upload.error) _upload = null;
          paintAll();
        }
      };
      const onInput = (e) => {
        if (e.target.matches('[data-ts-participants]')) _participants = e.target.value;
      };
      const actions = document.getElementById(VIEW_ID + '-actions');
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.addEventListener('input', onInput);
      if (actions) actions.addEventListener('click', onClick);

      let offSecrets = null;
      try {
        const ev = await import('/js/secrets-events.js');
        offSecrets = ev.onSecretsChanged(() => { Promise.all([loadStatus(), loadQueue()]).then(paintAll); });
      } catch { offSecrets = null; }

      _deps.registerViewCleanup(() => {
        clearTimeout(_pollTimer);
        root.removeEventListener('click', onClick);
        root.removeEventListener('change', onChange);
        root.removeEventListener('input', onInput);
        if (actions) actions.removeEventListener('click', onClick);
        if (offSecrets) offSecrets();
      });
    },
  },
};
