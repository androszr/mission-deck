// modules/sprint-review/client/widget.js
// Dashboard widget "Next Sprint Review" (contract: modules-template/README.md,
// "Dashboard widget"). Reads GET <apiBase>/sessions (the index) and, in the tall
// variant only, GET <apiBase>/session?id= for the facilitator, the presenters and
// the submissions. GET only. No static import from the core's /js/: the kit
// arrives as ctx.kit. The deadline rule is re-implemented here (6 lines) and
// pinned to server/session.js deadlineFromReviewDate by tests.

const DAY_MS = 86400000;

export const NO_STORAGE = 'No Sprint Review data. Fetch the data in the Sync window.';
export const NO_SESSION = 'No Sprint Review planned - create a session in the Sprint Review view.';
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Friday before reviewDate, 10:00 UTC (= 12:00 CEST). Twin of server/session.js. */
export function deadlineFor(reviewDateIso) {
  const d = new Date(reviewDateIso + 'T12:00:00.000Z');
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString();
}

/**
 * The session with the smallest reviewDate >= today, else the newest past one
 * (flagged past: true); null when there is none.
 * @param {Array<{reviewDate: string}>} sessions
 * @param {string} todayIso YYYY-MM-DD
 */
export function pickSession(sessions, todayIso) {
  const list = (sessions || []).filter((s) => s && ISO_DAY_RE.test(String(s.reviewDate || '')));
  const upcoming = list.filter((s) => s.reviewDate >= todayIso).sort((a, b) => (a.reviewDate < b.reviewDate ? -1 : 1));
  if (upcoming.length) return { ...upcoming[0], past: false };
  const past = list.slice().sort((a, b) => (a.reviewDate < b.reviewDate ? 1 : -1));
  return past.length ? { ...past[0], past: true } : null;
}

function _isoOf(date) {
  const p = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
}

function _dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function _short(iso) {
  return iso.slice(8, 10) + '.' + iso.slice(5, 7);
}

function _long(iso) {
  return _short(iso) + '.' + iso.slice(0, 4);
}

function _daysUnit(n) {
  return n === 1 ? 'day' : 'days';
}

/** Distinct presenters over every topic list of every team, in first-seen order. */
export function presentersOf(session) {
  const seen = new Set();
  const out = [];
  for (const sub of Object.values((session && session.submissions) || {})) {
    for (const key of ['topics', 'topicsProblemSpace', 'topicsSolutionSpace']) {
      for (const t of (sub && Array.isArray(sub[key]) ? sub[key] : [])) {
        for (const p of (t && Array.isArray(t.presenters) ? t.presenters : [])) {
          if (p && !seen.has(p)) { seen.add(p); out.push(p); }
        }
      }
    }
  }
  return out;
}

/**
 * Teams expected to submit = teamGoals entries (the page order the session was
 * seeded with); a team counts as submitted when it has at least one topic.
 */
export function submissionCount(session) {
  const goals = Array.isArray(session && session.teamGoals) ? session.teamGoals.map((g) => g.team) : [];
  const orphans = Object.keys((session && session.submissions) || {}).filter((t) => !goals.includes(t));
  const teams = [...goals, ...orphans];
  let done = 0;
  for (const t of teams) {
    const sub = (session.submissions || {})[t] || {};
    const n = ['topics', 'topicsProblemSpace', 'topicsSolutionSpace'].reduce((s, k) => s + (Array.isArray(sub[k]) ? sub[k].length : 0), 0);
    if (n > 0) done += 1;
  }
  return { done, total: teams.length };
}

/**
 * @param {{storage?: string, sessions?: object[], session?: object|null}} data
 * @param {Date} [now]
 * @returns {{blocks: Object<string, object>, empty: string|null}}
 */
export function buildBlocks(data, now = new Date()) {
  // Order matters: a wiped data repo answers sessions: [] too, and must not
  // read as "nobody planned a review".
  if (!data || data.storage !== 'ok') return { blocks: {}, empty: NO_STORAGE };
  const picked = pickSession(data.sessions, _isoOf(now));
  if (!picked) return { blocks: {}, empty: NO_SESSION };
  const today = _isoOf(now);
  const days = _dayNumber(picked.reviewDate) - _dayNumber(today);
  const deadline = new Date(deadlineFor(picked.reviewDate));
  const deadlineIso = _isoOf(deadline);
  const deadlineDays = _dayNumber(deadlineIso) - _dayNumber(today);
  const deadlineOpen = !picked.past && deadline.getTime() > now.getTime();
  const sprint = picked.sprintName || (picked.sprintN ? 'Sprint ' + picked.sprintN : '');
  const session = data.session && data.session.id === picked.id ? data.session : null;
  const person = session && session.facilitatorPo ? session.facilitatorPo : '';

  const blocks = {};
  if (picked.past) {
    blocks.big = { type: 'big', value: _short(picked.reviewDate), unit: '', label: 'the last one took place on ' + _long(picked.reviewDate), tone: 'neutral' };
  } else {
    blocks.big = {
      type: 'big', value: days === 0 ? 'Today' : String(days), unit: days === 0 ? '' : _daysUnit(days),
      label: 'to Sprint Review ' + _short(picked.reviewDate) + (sprint ? ' · ' + sprint : ''),
      tone: deadlineOpen && deadlineDays < 2 ? 'warn' : 'info',
    };
  }
  const events = [];
  if (deadlineOpen) {
    const hh = String(deadline.getHours()).padStart(2, '0') + ':' + String(deadline.getMinutes()).padStart(2, '0');
    events.push({ date: _short(deadlineIso), label: 'Team goals due ' + hh, tone: deadlineDays < 2 ? 'warn' : 'neutral' });
  }
  const review = { date: _short(picked.reviewDate), label: 'Sprint Review', tone: picked.past ? 'neutral' : 'info' };
  if (person) review.person = person;
  events.push(review);
  blocks.timeline = { type: 'timeline', events };

  if (session) {
    const presenters = presentersOf(session);
    const people = [];
    if (person) people.push({ name: person, tone: 'info' });
    for (const p of presenters) if (p !== person) people.push({ name: p, tone: 'neutral' });
    if (people.length) blocks.avatars = { type: 'avatars', label: 'Facilitator and presenters', people, max: 6 };
    const { done, total } = submissionCount(session);
    if (total > 0) {
      blocks.bullet = {
        type: 'bullet',
        rows: [{ label: 'Teams with topics', value: done, target: total, max: total, display: done + ' of ' + total, tone: done >= total ? 'ok' : deadlineOpen && deadlineDays < 2 ? 'warn' : 'info' }],
      };
    }
  }
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['big'],
  m: ['big', 'timeline'],
  m2: ['big', 'timeline', 'avatars', 'bullet'],
};

/** @returns {string} HTML for a variant */
export function paint(data, variantId, size, kit, now = new Date()) {
  const { blocks, empty } = buildBlocks(data, now);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m;
  return kit.blocks(keys.map((k) => blocks[k]).filter(Boolean), size);
}

async function _get(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const data = await _get(ctx.apiBase + '/sessions', ctx.signal);
  if (ctx.variant.id === 'm2') {
    const picked = pickSession(data.sessions, _isoOf(new Date()));
    if (picked) {
      try {
        const found = await _get(ctx.apiBase + '/session?id=' + encodeURIComponent(picked.id), ctx.signal);
        data.session = found && found.session ? found.session : found;
      } catch {
        data.session = null; // the tall extras are optional; the top of the card still paints
      }
    }
  }
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) {
    el.innerHTML = paint(data, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  }
  return () => { disposed = true; };
}
