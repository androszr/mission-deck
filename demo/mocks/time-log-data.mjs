// demo/mocks/time-log-data.mjs
// ONE dataset for the "Time logging" module (modules/time-log), shared by
// every chapter that shows it - `catalog` (the page right after the install),
// `using-a-module` (the page after a pull) and `time-tracking` (the page after
// "Fetch from Jira"). Same people, same teams, same 14 days, so the module
// never shows two different teams across the presentation.
//
// The demo's "today" is Sunday 04.10.2026. Like the module's
// server/calendar.js windowDates(), the window is yesterday back 14 days,
// newest first (03.10 ... 20.09); the "NN% logged time on" badge reads
// the first workday in that order - Friday 02.10. Every person is invented.

export const TEAMS = ['Atlas', 'Borealis', 'Delta', 'Comet'];

/** Newest first: index 0 is yesterday (Saturday 03.10). */
export const DATES = [
  { iso: '2026-10-03', we: true }, { iso: '2026-10-02', we: false }, { iso: '2026-10-01', we: false },
  { iso: '2026-09-30', we: false }, { iso: '2026-09-29', we: false }, { iso: '2026-09-28', we: false },
  { iso: '2026-09-27', we: true }, { iso: '2026-09-26', we: true }, { iso: '2026-09-25', we: false },
  { iso: '2026-09-24', we: false }, { iso: '2026-09-23', we: false }, { iso: '2026-09-22', we: false },
  { iso: '2026-09-21', we: false }, { iso: '2026-09-20', we: true },
];

/** Index of the last workday (Friday 02.10) - what the alert badge reports. */
export const LAST_WORKDAY = 1;

/** The three newest workdays: what a fresh fetch from Tempo fills in. */
export const FRESH_DAYS = [1, 2, 3];

/**
 * Invented people. `h` = hours per DATES index (null = no log, 0 on a weekend)
 * as the data on this computer had them BEFORE the refresh; `fresh` = the
 * three newest workdays (FRESH_DAYS) after it.
 */
export const PEOPLE = [
  { slug: 'alex', name: 'Alex Morgan', team: 'Atlas', h: [0, null, 8, null, 8, 7.5, 0, 0, 8, 8, 6, 8, 8, 0], fresh: [8, 8, 7.5] },
  { slug: 'sam', name: 'Sam Rivera', team: 'Atlas', h: [0, null, null, 8, 8, 8, 0, 0, 8, 7, 8, 8, 6.5, 0], fresh: [6, 8, 8] },
  { slug: 'jordan', name: 'Jordan Lee', team: 'Atlas', h: [0, null, 6, 8, 4, 8, 0, 0, 8, 8, 8, null, 8, 0], fresh: [8, 6, 8] },
  { slug: 'taylor', name: 'Taylor Kim', team: 'Borealis', h: [0, null, null, null, 8, 8, 0, 0, 7.5, 8, 8, 8, 8, 0], fresh: [8, 8, 8] },
  { slug: 'morgan', name: 'Morgan Blake', team: 'Borealis', h: [0, 7, 8, 8, 8, 6, 0, 0, 8, 8, 4, 8, 8, 0], fresh: [7, 8, 8] },
  { slug: 'casey', name: 'Casey Novak', team: 'Borealis', h: [0, null, null, 7, 8, 8, 0, 0, 8, null, 8, 8, 8, 0], fresh: [null, 8, 7] },
  { slug: 'avery', name: 'Avery Quinn', team: 'Delta', h: [0, 8, 8, 8, 8, 8, 0, 0, 8, 8, 8, 8, 7.5, 0], fresh: [8, 8, 8] },
  { slug: 'riley', name: 'Riley Chen', team: 'Delta', h: [0, null, null, 8, 6, 8, 0, 0, 8, 8, 8, 6, 8, 0], fresh: [8, 7.5, 8] },
  { slug: 'emerson', name: 'Emerson Gray', team: 'Delta', h: [0, null, 8, null, 8, 8, 0, 0, 5, 8, 8, 8, 8, 0], fresh: [8, 8, 6] },
  { slug: 'dakota', name: 'Dakota Hale', team: 'Comet', h: [0, null, null, 8, 8, 8, 0, 0, 8, 8, null, 8, 8, 0], fresh: [8, 8, 8] },
  { slug: 'skyler', name: 'Skyler Reed', team: 'Comet', h: [0, 8, 7, 8, 8, 7, 0, 0, 8, 8, 8, 8, 8, 0], fresh: [8, 7, 8] },
];

/**
 * Hours `p` logged on DATES[i]: null = no log; a weekend reads 0.
 * @param {object} p one of PEOPLE
 * @param {number} i DATES index
 * @param {boolean} fresh after the refresh
 * @returns {number|null}
 */
export function hoursOf(p, i, fresh) {
  const k = FRESH_DAYS.indexOf(i);
  if (fresh && k >= 0) return p.fresh[k];
  return p.h[i];
}

/** 'DD.MM' of a DATES entry. */
export const fmtDate = (iso) => iso.slice(8, 10) + '.' + iso.slice(5, 7);

