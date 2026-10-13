// modules/meeting-transcripts/client/widget.js
// Dashboard widget "Transcription queue" (contract: modules-template/README.md,
// "Dashboard widget"). Reads GET <apiBase>/queue and uses COUNTS only: no
// recording names, no log lines, no people. `current` is null after a server
// restart, so progress is shown only when it exists. Read-only: never touches
// the queue. No static import from the core's /js/: the kit arrives as ctx.kit.

function _num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function _plural(n, one, many) {
  return n === 1 ? one : many;
}

function _two(n) {
  return String(n).padStart(2, '0');
}

/** "today 07:00" / "tomorrow 07:00" / "13.10, 07:00" in local time, '' if unparsable. */
export function formatNext(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const ref = now instanceof Date ? now : new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(ref)) / 86400000);
  const hm = _two(d.getHours()) + ':' + _two(d.getMinutes());
  if (diff === 0) return 'today ' + hm;
  if (diff === 1) return 'tomorrow ' + hm;
  return _two(d.getDate()) + '.' + _two(d.getMonth() + 1) + ', ' + hm;
}

/**
 * @param {object} queue GET /queue body
 * @param {Date} [now]
 * @returns {{blocks: Object<string, object>, empty: string|null}}
 */
export function buildBlocks(queue, now) {
  if (!queue || typeof queue !== 'object' || !Array.isArray(queue.items)) {
    return { blocks: {}, empty: 'Could not read the transcription queue. Try again in a moment.' };
  }
  const items = queue.items.filter((i) => i && typeof i === 'object');
  const c = { queued: 0, processing: 0, failed: 0, done: 0 };
  items.forEach((i) => { if (c[i.status] !== undefined) c[i.status] += 1; });
  const open = c.queued + c.processing;
  const cur = queue.current && typeof queue.current === 'object' ? queue.current : null;
  const percent = cur ? Math.max(0, Math.min(100, Math.round(_num(cur.percent)))) : null;
  const next = queue.nextRunAt ? formatNext(queue.nextRunAt, now) : '';
  const nextText = next ? 'next run ' + next : '';
  const noun = (n) => n + ' ' + _plural(n, 'recording', 'recordings');
  // The last cycle's OneDrive scan: an expired Microsoft session or scan errors
  // mean NOTHING new is downloaded, so an empty queue must not read as "all fine".
  const scan = queue.lastRun && queue.lastRun.scan && typeof queue.lastRun.scan === 'object' ? queue.lastRun.scan : null;
  const scanErrors = scan && Array.isArray(scan.errors) ? scan.errors.length : 0;

  let pill;
  if (c.failed > 0) {
    pill = { tone: 'error', text: noun(c.failed) + ' failed', sub: [open ? open + ' queued' : '', nextText].filter(Boolean).join(' · ') };
  } else if (queue.blocked) {
    pill = { tone: 'warn', text: 'Queue on hold', sub: open ? open + ' queued' : 'Module requirements are missing' };
  } else if (queue.paused) {
    pill = { tone: 'warn', text: 'Queue paused by hand', sub: open ? open + ' queued' : '' };
  } else if (scan && scan.expired) {
    pill = { tone: 'warn', text: 'Microsoft session expired', sub: [open ? open + ' queued' : 'New recordings are not being fetched', 'sign in on the Meeting Transcripts page'].join(' · ') };
  } else if (scanErrors > 0) {
    pill = { tone: 'warn', text: 'OneDrive download errors: ' + scanErrors, sub: [open ? open + ' queued' : '', nextText].filter(Boolean).join(' · ') };
  } else if (c.processing > 0) {
    pill = { tone: 'info', text: 'Processing' + (percent !== null ? ' (' + percent + '%)' : ''), sub: [open + ' queued', nextText].filter(Boolean).join(' · ') };
  } else if (c.queued > 0) {
    pill = { tone: 'warn', text: noun(c.queued) + ' queued', sub: nextText };
  } else {
    pill = { tone: 'ok', text: 'Queue empty', sub: nextText || 'No new recordings' };
  }

  const segs = [
    { label: 'Done', value: c.done, tone: 'ok' },
    { label: 'In progress', value: c.processing, tone: 'info' },
    { label: 'Queued', value: c.queued, tone: 'neutral' },
    { label: 'Error', value: c.failed, tone: 'error' },
  ].filter((x) => x.value > 0);

  const blocks = { pill: { type: 'pill', ...pill } };
  if (percent !== null) {
    blocks.donut = { type: 'donut', value: percent, max: 100, center: percent + '%', label: cur.step ? String(cur.step) : 'Current recording', tone: 'info' };
  }
  if (segs.length) blocks.segments = { type: 'segments', label: 'Queue (recent items)', segments: segs };
  return { blocks, empty: null };
}

/** The ring needs a running item; without one the wider variants fall back to the segment bar. */
export function variantKeys(variantId, blocks) {
  const want = {
    s: ['pill'],
    m: ['pill', blocks.donut ? 'donut' : 'segments'],
    m2: ['pill', blocks.donut ? 'donut' : null, 'segments'],
  }[variantId] || ['pill', 'segments'];
  return want.filter((k) => k && blocks[k]);
}

/** @returns {string} HTML */
export function paint(queue, variantId, size, kit, now) {
  const { blocks, empty } = buildBlocks(queue, now);
  if (empty) return kit.empty(empty);
  return kit.blocks(variantKeys(variantId, blocks).map((k) => blocks[k]), size);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const res = await fetch(ctx.apiBase + '/queue', { signal: ctx.signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = paint(await res.json(), ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) el.innerHTML = html;
  return () => { disposed = true; };
}
