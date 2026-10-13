'use strict';
// modules/time-log/server/calendar.js
// Pure calendar helpers (easterSunday, the public-holiday calendar this
// module uses, isPlHoliday) plus the 14-day window this module needs. No I/O, no Date.now() call outside windowDates's caller -
// everything here takes the "today" ISO string explicitly so tests never
// depend on the clock.

// Gaussian algorithm for the date of Easter Sunday (Western/Gregorian).
// Month/day come out as
// UTC calendar components, never a Date built from local time.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function isoFromComponents({ year, month, day }) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return year + '-' + mm + '-' + dd;
}

// Date.UTC avoids DST shifting the calendar day when adding offsets, unlike
// building a Date from local-time components.
function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  const dt = new Date(t);
  return isoFromComponents({ year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() });
}

const _holidayCache = new Map();

// Nine fixed public holidays plus Easter Sunday, Easter Monday (+1),
// Pentecost (+49) and Corpus Christi (+60) - the Polish public-holiday calendar.
function plHolidays(year) {
  if (_holidayCache.has(year)) return _holidayCache.get(year);
  const fixed = [
    year + '-01-01', year + '-01-06',
    year + '-05-01', year + '-05-03',
    year + '-08-15',
    year + '-11-01', year + '-11-11',
    year + '-12-25', year + '-12-26',
  ];
  const easterIso = isoFromComponents(easterSunday(year));
  const movable = [
    easterIso,
    addDaysIso(easterIso, 1),
    addDaysIso(easterIso, 49),
    addDaysIso(easterIso, 60),
  ];
  const set = new Set([...fixed, ...movable]);
  _holidayCache.set(year, set);
  return set;
}

function isPlHoliday(iso) {
  const year = Number(String(iso).slice(0, 4));
  if (!Number.isInteger(year)) return false;
  return plHolidays(year).has(iso);
}

// dates[0] = yesterday (newest), dates[days - 1] = oldest. todayIso is the
// caller's "today" (local calendar day of the server); the window
// deliberately excludes it (today is still being logged).
function windowDates(todayIso, days) {
  const out = [];
  for (let i = 1; i <= days; i += 1) out.push(addDaysIso(todayIso, -i));
  return out;
}

module.exports = { easterSunday, plHolidays, isPlHoliday, windowDates, addDaysIso };
