// modules/meeting-archive/client/widget.js
// Dashboard widget "Recent meetings" (contract: modules-template/README.md,
// "Dashboard widget"). Reads GET <apiBase>/widget?limit=5 - the newest
// meetings (folder, title, date, status, participant count), aggregates and the
// participant names of the newest meeting only. A 404 means the server has not
// been restarted since the route was added: say so, never fall back to the
// heavy /list (it reads every folder).
// No static import from the core's /js/: the kit arrives as ctx.kit.

const UNAVAILABLE_TEXT = 'No meeting archive data. Pull the data in the Sync window.';
const EMPTY_TEXT = 'No meetings in the archive.';
const RESTART_TEXT = 'This tile needs a server restart: Settings > Restart server.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function _num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Noun form of "meeting" for a count. */
export function meetingsLabel(n) {
  return n === 1 ? 'meeting' : 'meetings';
}

/** "2026-10-09" -> "09.10"; anything else -> "-". */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? m[3] + '.' + m[2] : '-';
}

function _clip(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** @returns {{blocks: Object<string, object>, empty: string|null}} */
export function buildBlocks(data) {
  if (!data || data.storage !== 'ok') return { blocks: {}, empty: UNAVAILABLE_TEXT };
  if (_num(data.total) === 0 || !Array.isArray(data.meetings) || data.meetings.length === 0) {
    return { blocks: {}, empty: EMPTY_TEXT };
  }
  const last30 = _num(data.last30);
  const blocks = {
    big: {
      type: 'big', value: String(last30), unit: meetingsLabel(last30),
      label: 'in the last 30 days · ' + _num(data.total) + ' in the archive', tone: 'info',
    },
    timeline: {
      type: 'timeline',
      events: data.meetings.map((m) => ({ date: shortDate(m.date), label: _clip(m.title, 60), tone: m.status === 'error' ? 'error' : 'ok' })),
    },
  };
  const people = Array.isArray(data.participants) ? data.participants : [];
  if (people.length > 0) {
    const newest = data.meetings[0];
    const n = _num(newest.participantCount) || people.length;
    blocks.avatars = {
      type: 'avatars', label: 'Participants: ' + _clip(newest.title, 40) + ' (' + n + ')',
      people: people.map((p) => ({ name: p.name, tone: 'info' })), max: 5,
    };
  }
  const sc = data.statusCounts;
  if (sc && (_num(sc.ok) > 0 || _num(sc.error) > 0)) {
    blocks.segments = {
      type: 'segments', label: 'Processed',
      segments: [
        { label: 'Ready', value: _num(sc.ok), tone: 'ok' },
        { label: 'Processing error', value: _num(sc.error), tone: 'error' },
      ],
    };
  }
  const mo = data.month;
  if (mo && Array.isArray(mo.days) && mo.days.length > 0) {
    blocks.calendar = {
      type: 'calendar', label: 'Meetings in ' + (MONTHS[(_num(mo.month) + 11) % 12]) + ' ' + _num(mo.year),
      firstWeekday: _num(mo.firstWeekday) || 1,
      days: mo.days.map((d) => (d === null ? null : _num(d))),
    };
  }
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['big'],
  s2: ['big', 'timeline'],
  m: ['timeline', 'avatars'],
  m2: ['avatars', 'calendar', 'segments'],
  l: ['big', 'calendar', 'timeline'],
  xl: ['big', 'calendar', 'timeline', 'avatars'],
};

/** @returns {string} HTML for a variant */
export function paint(data, variantId, size, kit) {
  const { blocks, empty } = buildBlocks(data);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m2;
  const html = kit.blocks(keys.map((k) => blocks[k]).filter(Boolean), size);
  return html || kit.empty(EMPTY_TEXT);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const res = await fetch(ctx.apiBase + '/widget?limit=5', { signal: ctx.signal });
  if (res.status === 404) {
    if (!(ctx.signal && ctx.signal.aborted)) el.innerHTML = ctx.kit.empty(RESTART_TEXT);
    return () => { disposed = true; };
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) {
    el.innerHTML = paint(data, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  }
  return () => { disposed = true; };
}
