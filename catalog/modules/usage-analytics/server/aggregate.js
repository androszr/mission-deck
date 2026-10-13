'use strict';
// modules/usage-analytics/server/aggregate.js
// PURE aggregation of normalized events (see amplitude.normalizeEvent) into the
// aggregated.json the client renders. No fs, no network, no clock (opts.now).
//
// Metric rules (written into meta.rules so the numbers explain themselves):
//   page view   = one 'View Viewed'
//   active day  = a CET day with >= 1 page view for that user
//   session     = a distinct non-null session_id of a user with >= 1 page view
//   view time   = 'View Exited'.duration_ms, null/negative dropped, each value
//                 CAPPED at VIEW_DURATION_CAP_MS (a tab left open overnight),
//                 reported as the MEDIAN
// Windows end on the last FULL day (today - 1); today is partial and ignored.
// Trend = the same metric over the equal-length window right before `from`.

const { resolveModule, CORE_ID, CORE_NAME } = require('./modules-map.js');
const { buildResolver } = require('./identity.js');

const VIEW_DURATION_CAP_MS = 30 * 60 * 1000;
const PERIODS = [7, 30, 90];
const PAGE_VIEW = 'View Viewed';
const EXITED = 'View Exited';
const RENDER_FAILED = 'View Render Failed';
const MAX_ERRORS = 20;
const TOP_MODULES = 5;

function addDays(dayIso, n) {
  const [y, m, d] = dayIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.getUTCFullYear().toString().padStart(4, '0') + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
}

function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** -1 / 0 / 1; null when either side is malformed. */
function cmpSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function deltaPct(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

function mostFrequent(counter) {
  let best = null;
  let bestN = 0;
  for (const [k, n] of counter) {
    if (n > bestN || (n === bestN && best !== null && k < best)) { best = k; bestN = n; }
  }
  return best;
}

function bump(map, key, by) {
  map.set(key, (map.get(key) || 0) + (by === undefined ? 1 : by));
}

function setOf(map, key) {
  let s = map.get(key);
  if (!s) { s = new Set(); map.set(key, s); }
  return s;
}

function listOf(map, key) {
  let s = map.get(key);
  if (!s) { s = []; map.set(key, s); }
  return s;
}

function humanizeSlug(slug) {
  return String(slug).split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || String(slug);
}

function clampDuration(v) {
  const n = Number(v);
  if (v === null || v === undefined || !Number.isFinite(n) || n < 0) return null;
  return Math.min(n, VIEW_DURATION_CAP_MS);
}

/** Cheap summary of a window - used for the previous window and as the KPI source. */
function summarize(evs) {
  const users = new Set();
  const sessions = new Set();
  const mods = new Set();
  const durations = [];
  let pageViews = 0;
  const modPv = new Map();
  for (const e of evs) {
    if (e.e === PAGE_VIEW) {
      pageViews += 1;
      users.add(e.u);
      if (e.s !== null) sessions.add(e.u + '|' + e.s);
      mods.add(e.m);
      bump(modPv, e.m);
    } else if (e.e === EXITED && e.d !== null) {
      durations.push(e.d);
    }
  }
  return { activeUsers: users.size, sessions: sessions.size, pageViews, modules: mods.size, durations, modPv };
}

function buildPeriod(all, n, to, ctx) {
  const from = addDays(to, -(n - 1));
  const prevFrom = addDays(from, -n);
  const prevTo = addDays(from, -1);
  const cur = [];
  const prev = [];
  for (const e of all) {
    if (e.day >= from && e.day <= to) cur.push(e);
    else if (e.day >= prevFrom && e.day <= prevTo) prev.push(e);
  }
  const sum = summarize(cur);
  const psum = summarize(prev);

  // daily
  const dailyUsers = new Map();
  const dailyPv = new Map();
  for (const e of cur) {
    if (e.e !== PAGE_VIEW) continue;
    setOf(dailyUsers, e.day).add(e.u);
    bump(dailyPv, e.day);
  }
  const days = [];
  for (let i = 0; i < n; i++) days.push(addDays(from, i));
  const daily = days.map((date) => ({ date, active_users: (dailyUsers.get(date) || new Set()).size, page_views: dailyPv.get(date) || 0 }));

  // modules
  const mod = new Map();
  const getMod = (id) => {
    let m = mod.get(id);
    if (!m) {
      m = { pv: 0, users: new Set(), days: new Set(), durations: [], views: new Map(), byUser: new Map() };
      mod.set(id, m);
    }
    return m;
  };
  const getView = (m, id) => {
    let v = m.views.get(id);
    if (!v) { v = { pv: 0, users: new Set(), durations: [], titles: new Map() }; m.views.set(id, v); }
    return v;
  };
  for (const e of cur) {
    if (e.e === PAGE_VIEW) {
      const m = getMod(e.m);
      m.pv += 1;
      m.users.add(e.u);
      m.days.add(e.day);
      const v = getView(m, e.bv);
      v.pv += 1;
      v.users.add(e.u);
      if (e.p.view_title) bump(v.titles, String(e.p.view_title));
      let bu = m.byUser.get(e.u);
      if (!bu) { bu = { pv: 0, days: new Set(), sessions: new Set() }; m.byUser.set(e.u, bu); }
      bu.pv += 1;
      bu.days.add(e.day);
      if (e.s !== null) bu.sessions.add(e.s);
    } else if (e.e === EXITED && e.d !== null) {
      const m = getMod(e.m);
      m.durations.push(e.d);
      getView(m, e.bv).durations.push(e.d);
    }
  }
  const modules = [];
  for (const [id, m] of mod) {
    if (!m.pv) continue;
    const dictEntry = ctx.dict[id];
    const viewLabels = new Map();
    for (const v of (dictEntry && dictEntry.views) || []) if (v && v.id) viewLabels.set(v.id, v.label);
    modules.push({
      id,
      name: id === CORE_ID ? CORE_NAME : (dictEntry && dictEntry.name) || id,
      page_views: m.pv,
      users: m.users.size,
      active_days: m.days.size,
      median_view_ms: median(m.durations),
      time_capped_ms: m.durations.reduce((a, b) => a + b, 0),
      delta_page_views_pct: deltaPct(m.pv, psum.modPv.get(id) || 0),
      views: [...m.views.entries()].filter(([, v]) => v.pv > 0).map(([vid, v]) => ({
        id: vid,
        label: mostFrequent(v.titles) || viewLabels.get(vid) || vid,
        page_views: v.pv,
        users: v.users.size,
        median_view_ms: median(v.durations),
      })).sort((a, b) => b.page_views - a.page_views || (a.id < b.id ? -1 : 1)),
      by_user: [...m.byUser.entries()].map(([uid, bu]) => ({
        user_id: uid, page_views: bu.pv, active_days: bu.days.size, sessions: bu.sessions.size,
      })).sort((a, b) => b.active_days - a.active_days || b.sessions - a.sessions || b.page_views - a.page_views || (a.user_id < b.user_id ? -1 : 1)),
    });
  }
  modules.sort((a, b) => b.page_views - a.page_views || (a.id < b.id ? -1 : 1));

  // users
  const byU = new Map();
  for (const e of cur) listOf(byU, e.u).push(e);
  const users = [];
  for (const [uid, uevs] of byU) {
    const pvs = uevs.filter((e) => e.e === PAGE_VIEW);
    if (!pvs.length) continue;
    const sessions = new Set();
    const activeDays = new Set();
    const names = new Map();
    const modCount = new Map();
    const dayPv = new Map();
    const durations = [];
    const errors = new Map();
    let lastSeen = '';
    let verEvent = null;
    for (const e of uevs) {
      if (e.t > lastSeen) lastSeen = e.t;
      if (e.fn) bump(names, e.fn);
      if (e.p.app_version && parseSemver(e.p.app_version) && (!verEvent || e.t >= verEvent.t)) verEvent = e;
      if (e.e === PAGE_VIEW) {
        activeDays.add(e.day);
        if (e.s !== null) sessions.add(e.s);
        bump(modCount, e.m);
        bump(dayPv, e.day);
      } else if (e.e === EXITED && e.d !== null) {
        durations.push(e.d);
      } else if (e.e === RENDER_FAILED) {
        const key = (e.bv || '') + '\u0000' + String(e.p.message || '').slice(0, 200);
        bump(errors, key);
      }
    }
    let hashEvent = null;
    for (const e of uevs) if (e.p.app_hash && (!hashEvent || e.t >= hashEvent.t)) hashEvent = e;
    const hashLast = hashEvent ? String(hashEvent.p.app_hash) : null;
    const appVersionLast = verEvent ? String(verEvent.p.app_version) : null;
    const outdated = !!(appVersionLast && ctx.latestVersion && cmpSemver(appVersionLast, ctx.latestVersion) === -1);
    users.push({
      user_id: uid,
      aliases: [...(ctx.aliases.get(uid) || [])].sort(),
      matched: ctx.matched.has(uid),
      display_name: ctx.directoryName.get(uid) || mostFrequent(names) || humanizeSlug(uid),
      last_seen: lastSeen,
      first_seen: ctx.firstSeen.get(uid) || lastSeen,
      active_days: activeDays.size,
      sessions: sessions.size,
      page_views: pvs.length,
      events: uevs.length,
      median_view_ms: median(durations),
      app_version_last: appVersionLast,
      app_version_outdated: outdated,
      app_hash_last: hashLast,
      app_hash_short: hashLast ? hashLast.slice(0, 8) : null,
      app_outdated: !!(hashLast && ctx.newestHash && hashLast !== ctx.newestHash && ctx.newestHashSettled),
      top_modules: [...modCount.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_MODULES).map(([id, c]) => ({
        id, name: id === CORE_ID ? CORE_NAME : (ctx.dict[id] && ctx.dict[id].name) || id, page_views: c,
      })),
      daily: days.map((date) => ({ date, page_views: dayPv.get(date) || 0 })),
      errors: [...errors.entries()].map(([k, c]) => {
        const i = k.indexOf('\u0000');
        return { view: k.slice(0, i), message: k.slice(i + 1), count: c };
      }).sort((a, b) => b.count - a.count || (a.view < b.view ? -1 : 1)).slice(0, MAX_ERRORS),
    });
  }
  users.sort((a, b) => b.active_days - a.active_days || b.sessions - a.sessions || b.page_views - a.page_views || (a.user_id < b.user_id ? -1 : 1));

  return {
    from,
    to,
    kpi: {
      active_users: sum.activeUsers,
      sessions: sum.sessions,
      page_views: sum.pageViews,
      modules_in_use: sum.modules,
      median_view_ms: median(sum.durations),
      delta: {
        active_users_pct: deltaPct(sum.activeUsers, psum.activeUsers),
        sessions_pct: deltaPct(sum.sessions, psum.sessions),
        page_views_pct: deltaPct(sum.pageViews, psum.pageViews),
      },
    },
    daily,
    modules,
    users,
  };
}

/**
 * @param {object[]} events normalized events {t,e,u,s,p,up}
 * @param {{today: string, modulesDict?: object, now?: string}} opts
 */
function aggregate(events, opts) {
  const today = opts.today;
  const dict = opts.modulesDict || {};
  const to = addDays(today, -1);
  const resolve = buildResolver(opts.members, opts.aliases);
  const aliases = new Map();
  const matched = new Set();
  const directoryName = new Map();
  const unmatched = new Set();
  const hashFirst = new Map();
  let maxT = '';
  let dropped = 0;
  const all = [];
  const firstSeen = new Map();
  let minDay = null;
  let maxDay = null;
  for (const raw of events || []) {
    if (!raw || typeof raw.e !== 'string' || typeof raw.t !== 'string') continue;
    if (!raw.u) { dropped += 1; continue; }
    const day = raw.t.slice(0, 10);
    if (day > to) continue; // today is partial
    const p = raw.p || {};
    const who = resolve(raw.u);
    if (who.matched) { matched.add(who.key); if (who.display_name) directoryName.set(who.key, who.display_name); } else unmatched.add(raw.u);
    let al = aliases.get(who.key);
    if (!al) { al = new Set(); aliases.set(who.key, al); }
    al.add(raw.u);
    if (raw.t > maxT) maxT = raw.t;
    if (p.app_hash && (!hashFirst.has(p.app_hash) || raw.t < hashFirst.get(p.app_hash))) hashFirst.set(p.app_hash, raw.t);
    const bv = p.base_view || p.view || '';
    all.push({
      t: raw.t, day, e: raw.e, u: who.key, s: raw.s === undefined ? null : raw.s, p,
      bv, m: resolveModule(bv, dict),
      d: raw.e === EXITED ? clampDuration(p.duration_ms) : null,
      fn: raw.up && raw.up.full_name ? raw.up.full_name : null,
    });
    if (!firstSeen.has(who.key) || raw.t < firstSeen.get(who.key)) firstSeen.set(who.key, raw.t);
    if (minDay === null || day < minDay) minDay = day;
    if (maxDay === null || day > maxDay) maxDay = day;
  }

  // newest app version seen on any event of the longest window
  const from90 = addDays(to, -(PERIODS[PERIODS.length - 1] - 1));
  let latest = null;
  for (const e of all) {
    if (e.day < from90 || !e.p.app_version || !parseSemver(e.p.app_version)) continue;
    if (latest === null || cmpSemver(latest, e.p.app_version) === -1) latest = String(e.p.app_version);
  }

  let newestHash = null;
  for (const [h, t] of hashFirst) if (newestHash === null || t > hashFirst.get(newestHash)) newestHash = h;
  const newestFirst = newestHash ? hashFirst.get(newestHash) : null;
  // a build counts as "the" newest only after it has been around for a day
  const newestHashSettled = !!(newestFirst && Date.parse(maxT.replace(' ', 'T') + 'Z') - Date.parse(newestFirst.replace(' ', 'T') + 'Z') >= 24 * 3600 * 1000);
  const ctx = { dict, latestVersion: latest, firstSeen, aliases, matched, directoryName, newestHash, newestHashSettled };
  const periods = {};
  for (const n of PERIODS) periods[String(n)] = buildPeriod(all, n, to, ctx);

  return {
    schemaVersion: 1,
    generated_at: opts.now || new Date().toISOString(),
    range: { from: minDay, to: maxDay },
    last_full_day: to,
    meta: {
      rules: {
        view_duration_cap_ms: VIEW_DURATION_CAP_MS,
        page_view_event: PAGE_VIEW,
        session_source: 'session_id',
      },
      dropped_anonymous: dropped,
      dropped_other_cockpit: null,
      unmatched_ids: [...unmatched].sort(),
      events_kept: all.length,
    },
    modules: dict,
    latest_app_version: latest,
    latest_app_hash: newestHash,
    latest_app_hash_short: newestHash ? newestHash.slice(0, 8) : null,
    latest_app_hash_first_seen: newestFirst,
    periods,
  };
}

module.exports = { VIEW_DURATION_CAP_MS, PERIODS, aggregate, median, cmpSemver, parseSemver };
