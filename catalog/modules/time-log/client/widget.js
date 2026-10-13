// modules/time-log/client/widget.js
// Dashboard widget "Days without a time entry" (contract: modules-template/README.md,
// "Dashboard widget"). Reads GET <apiBase>/data. IMPORTANT: miss_days_count
// skips weekends and holidays but NOT leave, so the tile never ranks people and
// never says "gaps": it counts people with days without an entry, lists them
// as a plain (alphabetical, count-free) avatar stack and only aggregates the
// rest per team. No static import from the core's /js/: the kit is ctx.kit.

const HEAT_COLS = 10;
const HEAT_TEAMS = 6;
const NO_TEAM = 'No team';

function _num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Local day of the payload's timestamp: generated_at is a UTC instant ("...Z"),
// so slicing its date would show the previous day shortly after midnight.
function _asOf(generatedAt) {
  const raw = String(generatedAt || '');
  const t = Date.parse(raw);
  if (Number.isFinite(t) && /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(t);
    return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return m ? m[3] + '.' + m[2] : '';
}

/** "person" / "people" for n. */
export function peopleWord(n) {
  return n === 1 ? 'person' : 'people';
}

export const NO_STORAGE = 'No time-log data. Pull the data in the Sync window.';
export const NO_DATA = 'No time-log data - refresh it on the Time Log page (needs a Tempo token).';

/** @returns {{blocks: Object<string, object>, empty: string|null}} */
export function buildBlocks(data) {
  // Order matters: no data repo (wiped after "End of day") is not "no export yet".
  if (!data || data.storage !== 'ok') return { blocks: {}, empty: NO_STORAGE };
  if (data.available !== true || !Array.isArray(data.persons) || data.persons.length === 0) {
    return { blocks: {}, empty: NO_DATA };
  }
  const persons = data.persons;
  const asOf = _asOf(data.generated_at);
  const label = 'time off is not subtracted' + (asOf ? ' · as of ' + asOf : '');
  // Alphabetical on purpose: never ordered by the number of days.
  const without = persons.filter((p) => _num(p.miss_days_count) > 0).map((p) => String(p.name || '')).filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'en'));
  const logged = persons.reduce((s, p) => s + _num(p.logged_days_count), 0);
  const missing = persons.reduce((s, p) => s + _num(p.miss_days_count), 0);
  const blocks = {
    big: { type: 'big', value: String(without.length), unit: peopleWord(without.length) + ' with days without an entry', label, tone: without.length > 0 ? 'warn' : 'ok' },
    segments: { type: 'segments', label: 'Working days in the window (whole team)', segments: [
      { label: 'With an entry', value: logged, tone: 'ok' },
      { label: 'Without an entry', value: missing, tone: 'warn' },
    ] },
  };
  if (without.length === 0) {
    blocks.pill = { type: 'pill', tone: 'ok', text: 'Everyone has an entry on every working day', sub: data.window_days ? data.window_days + '-day window' : '' };
  } else {
    blocks.avatars = { type: 'avatars', label: 'Have days without an entry (alphabetical)', people: without.map((name) => ({ name, tone: 'warn' })), max: 6 };
  }
  // Heatmap per TEAM (share of members with an entry), never per person.
  // /data lists dates newest first; the heatmap reads left to right, oldest first.
  const dates = (data.dates || []).slice().sort().filter((d) => persons.some((p) => (p.days || []).some((x) => x.date === d && !x.is_weekend && !x.is_holiday)));
  const cols = dates.slice(-HEAT_COLS);
  const byTeam = new Map();
  for (const p of persons) {
    const t = p.team || NO_TEAM;
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t).push(p);
  }
  const teams = [...byTeam.entries()].sort((a, b) => (b[1].length - a[1].length) || a[0].localeCompare(b[0], 'en')).slice(0, HEAT_TEAMS);
  if (cols.length && teams.length) {
    blocks.heatmap = {
      type: 'heatmap',
      rows: teams.map(([t]) => t),
      cols: cols.map((d) => d.slice(8, 10)),
      values: teams.map(([, members]) => cols.map((d) => {
        const have = members.filter((p) => (p.days || []).some((x) => x.date === d && x.has_log)).length;
        return Math.round((have / members.length) * 100);
      })),
    };
  }
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['big'],
  m: ['big', 'segments'],
  l: ['big', 'avatars', 'segments'],
  s2: ['big', 'avatars'],
  m2: ['big', 'avatars', 'segments'],
  xl: ['big', 'segments', 'heatmap'],
};

/** @returns {string} HTML for a variant */
export function paint(data, variantId, size, kit) {
  const { blocks, empty } = buildBlocks(data);
  if (empty) return kit.empty(empty);
  const keys = (VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m2).map((k) => (k === 'avatars' && !blocks.avatars ? 'pill' : k));
  return kit.blocks(keys.map((k) => blocks[k]).filter(Boolean), size);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const res = await fetch(ctx.apiBase + '/data', { signal: ctx.signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) {
    el.innerHTML = paint(data, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  }
  return () => { disposed = true; };
}
