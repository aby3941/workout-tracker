// Calendar-date helpers. Dates are ISO 'YYYY-MM-DD' strings for the LOCAL calendar day.
// Never uses toISOString(); all arithmetic goes through local noon so DST cannot shift a day.

const pad = (n, width = 2) => String(n).padStart(width, '0');

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

const WEEKDAY_PREFIX = /^(?:mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\.?(?:\s*,\s*|\s+)/i;

/** Build an ISO date string from numeric parts (no validation). */
function toISO(y, m, d) {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

/** Split an ISO date into numbers [y, m, d]. */
function parts(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return [y, m, d];
}

/** Local noon Date for an ISO date (DST-safe anchor). */
function noon(iso) {
  const [y, m, d] = parts(iso);
  return new Date(y, m - 1, d, 12);
}

/** ISO date of a Date using local getters. */
function fromLocalDate(dt) {
  return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** True when y/m/d is a real calendar date. */
function isRealDate(y, m, d) {
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)
    && y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/**
 * Today's local calendar date as ISO.
 * @param {Date} [now]
 * @returns {string}
 */
export function todayISO(now = new Date()) {
  return fromLocalDate(now);
}

/**
 * Add (or subtract) whole days to an ISO date.
 * @param {string} iso
 * @param {number} n
 * @returns {string}
 */
export function addDays(iso, n) {
  const [y, m, d] = parts(iso);
  return fromLocalDate(new Date(y, m - 1, d + n, 12));
}

/**
 * Format ISO as DD/MM/YYYY (the only date display format in the app).
 * @param {string} iso
 * @returns {string}
 */
export function formatDate(iso) {
  const [y, m, d] = parts(iso);
  return `${pad(d)}/${pad(m)}/${pad(y, 4)}`;
}

/**
 * Format ISO as DD/MM (chart axis labels).
 * @param {string} iso
 * @returns {string}
 */
export function formatDateShort(iso) {
  const [, m, d] = parts(iso);
  return `${pad(d)}/${pad(m)}`;
}

/**
 * Short English weekday name ("Tue") of an ISO date.
 * @param {string} iso
 * @returns {string}
 */
export function weekdayShort(iso) {
  return WEEKDAYS_SHORT[noon(iso).getDay()];
}

/**
 * English month name ("November") of an ISO date.
 * @param {string} iso
 * @returns {string}
 */
export function monthName(iso) {
  return MONTH_NAMES[parts(iso)[1] - 1] || '';
}

/**
 * Month and year ("November 2026") of an ISO date — History's month headings.
 * @param {string} iso
 * @returns {string}
 */
export function formatMonthYear(iso) {
  return `${monthName(iso)} ${parts(iso)[0]}`;
}

/**
 * Whole calendar days from `a` to `b` (positive when b is later).
 * @param {string} a ISO date
 * @param {string} b ISO date
 * @returns {number}
 */
export function daysBetween(a, b) {
  return dayIndex(b) - dayIndex(a);
}

/**
 * ISO date of the Monday of the week containing `iso`.
 * @param {string} iso
 * @returns {string}
 */
export function weekStart(iso) {
  const dow = noon(iso).getDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

/**
 * True for a well-formed, real 'YYYY-MM-DD' date.
 * @param {string} iso
 * @returns {boolean}
 */
export function isValidISO(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = parts(iso);
  return isRealDate(y, m, d);
}

/**
 * Comparator for ISO dates (works with Array.prototype.sort).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareISO(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A copy of `items` sorted by their `date` ascending (stable; input not mutated).
 * @template {{date: string}} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function sortByDate(items) {
  return [...(items || [])].sort((a, b) => compareISO(a.date, b.date));
}

/**
 * Whole days since 1970-01-01 for an ISO date (pure calendar arithmetic, for chart x scales).
 * @param {string} iso
 * @returns {number}
 */
export function dayIndex(iso) {
  const [y, m, d] = parts(iso);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** Result for a matched date: real → {date, rest}; impossible → {date: null, rest, invalid: true}. */
function result(y, m, d, rest) {
  const cleanRest = rest.replace(/^[\s,:;\-–—]+/, '').trim();
  if (!isRealDate(y, m, d)) return { date: null, rest: cleanRest, invalid: true };
  return { date: toISO(y, m, d), rest: cleanRest };
}

/** Missing year → the year of today, or the previous year when that would be after today. */
function inferYear(m, d, today) {
  const y = parts(today)[0];
  return compareISO(toISO(y, m, d), today) > 0 ? y - 1 : y;
}

// A date ends at whitespace, the end of the line, or a separator ("10/11/2026: Pull A", "10/11 - Legs").
// Same separator set that result() strips from the start of the rest.
const END = '(?=[\\s,:;\\-–—]|$)';
const ORD = '(?:st|nd|rd|th)?';
const RE_RELATIVE = new RegExp(`^(today|yesterday)${END}`, 'i');
const RE_ISO = new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${END}`);
const RE_NUMERIC = new RegExp(`^(\\d{1,2})([/.-])(\\d{1,2})\\2(\\d{4}|\\d{2})${END}`);
const RE_NUMERIC_NO_YEAR = new RegExp(`^(\\d{1,2})/(\\d{1,2})${END}`);
const RE_DAY_MONTH = new RegExp(`^(\\d{1,2})${ORD}\\s+([a-z]+)\\.?(?:,?\\s+(\\d{4}))?${END}`, 'i');
const RE_MONTH_DAY = new RegExp(`^([a-z]+)\\.?\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?${END}`, 'i');

/** Parse a date at the very start of `s` (weekday already removed). */
function parseAtStart(s, today) {
  let m = RE_RELATIVE.exec(s);
  if (m) {
    const iso = m[1].toLowerCase() === 'today' ? today : addDays(today, -1);
    const [y, mo, d] = parts(iso);
    return result(y, mo, d, s.slice(m[0].length));
  }
  m = RE_ISO.exec(s);
  if (m) return result(Number(m[1]), Number(m[2]), Number(m[3]), s.slice(m[0].length));
  m = RE_NUMERIC.exec(s);
  if (m) {
    const year = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
    return result(year, Number(m[3]), Number(m[1]), s.slice(m[0].length));
  }
  m = RE_NUMERIC_NO_YEAR.exec(s);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    return result(inferYear(mo, d, today), mo, d, s.slice(m[0].length));
  }
  m = RE_DAY_MONTH.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2].toLowerCase()];
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, today);
    return result(y, mo, d, s.slice(m[0].length));
  }
  m = RE_MONTH_DAY.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const mo = MONTHS[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, today);
    return result(y, mo, d, s.slice(m[0].length));
  }
  return null;
}

/**
 * Read a date at the start of a line. Numeric dates are always day-first.
 * @param {string} line
 * @param {{today?: string}} [opts] today = ISO date used for relative dates and missing years
 * @returns {null | {date: string, rest: string} | {date: null, rest: string, invalid: true}}
 */
export function parseDatePrefix(line, { today = todayISO() } = {}) {
  const s = String(line ?? '').trim();
  if (!s) return null;
  const direct = parseAtStart(s, today);
  if (direct) return direct;
  const wd = WEEKDAY_PREFIX.exec(s);
  return wd ? parseAtStart(s.slice(wd[0].length), today) : null;
}
