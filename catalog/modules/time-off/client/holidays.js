// time-off/client/holidays.js
// Pure, browser-free: public holidays for the time-off calendar. No
// dependencies - importable straight from node --test without a browser.
//
// The built-in calendar is Poland's (the module's first users); a team in
// another country replaces FIXED_MONTH_DAY and the Easter offsets below.
//
// easterSunday(year)   - Meeus/Jones/Butcher algorithm (Gregorian calendar).
// publicHolidays(year) - fixed holidays plus the four that move with Easter:
//   Easter Sunday, Easter Monday (+1 day), Pentecost (+49 days),
//   Corpus Christi (+60 days).

const FIXED_MONTH_DAY = [
  '01-01', // New Year's Day
  '01-06', // Epiphany
  '05-01', // Labour Day
  '05-03', // Constitution Day
  '08-15', // Assumption Day
  '11-01', // All Saints' Day
  '11-11', // Independence Day
  '12-25', // Christmas Day
  '12-26', // Second day of Christmas
];

// Christmas Eve became a public holiday in 2025.
const CHRISTMAS_EVE_FROM_YEAR = 2025;

/**
 * Easter Sunday for a Gregorian-calendar year.
 * @param {number} year
 * @returns {Date}
 */
export function easterSunday(year) {
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
  const monthDayNum = h + l - 7 * m + 114;
  const month = Math.floor(monthDayNum / 31); // 3 = March, 4 = April
  const day = (monthDayNum % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * ISO date string (YYYY-MM-DD) for a local Date, no timezone conversion.
 * @param {Date} d
 * @returns {string}
 */
function toIso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

/**
 * @param {Date} d
 * @param {number} n
 * @returns {Date}
 */
function addDays(d, n) {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + n);
  return copy;
}

/**
 * All public holidays for one year, as ISO date strings.
 * @param {number} year
 * @returns {Set<string>}
 */
export function publicHolidays(year) {
  const set = new Set();
  for (const md of FIXED_MONTH_DAY) set.add(year + '-' + md);
  if (year >= CHRISTMAS_EVE_FROM_YEAR) set.add(year + '-12-24');

  const easter = easterSunday(year);
  set.add(toIso(easter)); // Easter Sunday
  set.add(toIso(addDays(easter, 1))); // Easter Monday
  set.add(toIso(addDays(easter, 49))); // Pentecost
  set.add(toIso(addDays(easter, 60))); // Corpus Christi

  return set;
}
