// CSV backup format: one row per set. RFC-4180 quoting, comma or tab delimited on import.

import { formatDate, parseDatePrefix, sortByDate, parseLocalTime } from './dates.js';
import { DAYS, matchExercise, customId, exerciseName, dayFromName, isRecordedRest, isRecordedDuration } from './program.js';
import { convertWeight, formatNumber } from './units.js';

/**
 * Exact export header. `started_at` / `finished_at` (§18.3) hold the workout times, repeated on every row like `note`;
 * `rest_s` / `set_s` (§19.1) the set's recorded rest and set time in whole seconds (empty = not recorded).
 */
export const CSV_HEADER = 'date,day,exercise,set,weight,reps,unit,off_day,note,started_at,finished_at,rest_s,set_s';

/** Workout time columns → session fields. Optional on import (older backups have none). */
const TIME_COLUMNS = [['started_at', 'startedAt', 'start'], ['finished_at', 'finishedAt', 'finish']];

/** Recorded set time columns → set fields (§19.1). Optional on import (older backups have none). */
const SET_TIME_COLUMNS = [['rest_s', 'rest', isRecordedRest, 'rest'], ['set_s', 'duration', isRecordedDuration, 'set']];

const REQUIRED = ['date', 'day', 'exercise', 'weight', 'reps'];

/** Quote a field when it contains a comma, quote or line break. */
function field(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Sessions → CSV text (header + one row per set, "\n" line endings, trailing newline).
 * @param {Array<object>} sessions
 * @param {'kg'|'lb'} unit
 * @returns {string}
 */
export function toCSV(sessions, unit) {
  const lines = [CSV_HEADER];
  for (const s of sortByDate(sessions)) {
    const dayName = DAYS[s.day] ? DAYS[s.day].name : s.day;
    for (const e of s.entries || []) {
      (e.sets || []).forEach((set, i) => {
        lines.push([
          formatDate(s.date), dayName, exerciseName(e.exerciseId, e.name), i + 1,
          formatNumber(set.weight), set.reps, unit, s.offDay ? 'yes' : '', s.note || '',
          s.startedAt || '', s.finishedAt || '',
          isRecordedRest(set.rest) ? set.rest : '', isRecordedDuration(set.duration) ? set.duration : '',
        ].map(field).join(','));
      });
    }
  }
  return lines.join('\n') + '\n';
}

/** Split CSV text into records with their 1-based starting line numbers. */
function readRecords(text, delimiter) {
  const records = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else {
        if (c === '\n') line++;
        cell += c;
      }
    } else if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (c === '\n') {
      cells.push(cell);
      records.push({ cells, line: recordLine });
      cells = [];
      cell = '';
      line++;
      recordLine = line;
    } else {
      cell += c;
    }
  }
  if (cell !== '' || cells.length) {
    cells.push(cell);
    records.push({ cells, line: recordLine });
  }
  return records;
}

const headerKey = (h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Comma or tab, whichever the header line (the first non-blank line) uses more. */
function detectDelimiter(text) {
  const first = text.split('\n').find((l) => l.trim() !== '') || '';
  const tabs = (first.match(/\t/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}

const UNIT_ALIASES = { kg: 'kg', kgs: 'kg', lb: 'lb', lbs: 'lb' };

/**
 * CSV text → sessions (no ids). Header columns in any order; date, day, exercise, weight, reps required.
 * Workout times (`started_at`, `finished_at`) are read once per workout; an unreadable one is skipped with a warning.
 * Dates on these lines are read with the date column's rules (day-first), so a hand-edited "10/11/2026 18:42" works.
 * A set's recorded rest and set time (`rest_s`, `set_s`, whole seconds) are kept when usable; an unreadable one is
 * skipped with a warning and the set is kept.
 * @param {string} text
 * @param {{unit?: 'kg'|'lb'}} [opts]
 * @returns {{sessions: Array<object>, warnings: Array<{line: number, text: string, message: string}>}}
 */
export function parseCSV(text, { unit = 'kg' } = {}) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const warnings = [];
  const records = readRecords(clean, detectDelimiter(clean)).filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (!records.length) return { sessions: [], warnings };

  const [head, ...rows] = records;
  const col = {};
  head.cells.forEach((h, i) => { const k = headerKey(h); if (!(k in col)) col[k] = i; });
  const missing = REQUIRED.filter((k) => !(k in col));
  if (missing.length) {
    warnings.push({ line: head.line, text: head.cells.join(','), message: `Missing column(s): ${missing.join(', ')}` });
    return { sessions: [], warnings };
  }

  const sessions = new Map();
  for (const { cells, line } of rows) {
    const get = (k) => (k in col ? String(cells[col[k]] ?? '').trim() : '');
    const raw = cells.join(',');
    const warn = (message) => warnings.push({ line, text: raw, message });

    const d = parseDatePrefix(get('date'));
    if (!d || d.invalid || d.rest !== '') { warn(`Can't read the date "${get('date')}"`); continue; }
    const day = dayFromName(get('day'));
    if (!day) { warn(`Unknown day "${get('day')}"`); continue; }
    const name = get('exercise');
    if (!name) { warn('Missing exercise name'); continue; }
    const weightText = get('weight').toLowerCase();
    if (!/^(\d+(\.\d+)?|bw)$/.test(weightText)) { warn(`Can't read the weight "${get('weight')}"`); continue; }
    const repsText = get('reps');
    if (!/^\d+$/.test(repsText)) { warn(`Can't read the reps "${repsText}"`); continue; }
    const rowUnitText = get('unit').toLowerCase();
    const rowUnit = rowUnitText ? UNIT_ALIASES[rowUnitText] : unit;
    if (!rowUnit) { warn(`Unknown unit "${get('unit')}"`); continue; }

    const known = matchExercise(name);
    const exerciseId = known || customId(name);
    const rawWeight = weightText === 'bw' ? 0 : Number(weightText);
    const set = { weight: convertWeight(rawWeight, rowUnit, unit), reps: Number(repsText) };
    for (const [column, prop, valid, word] of SET_TIME_COLUMNS) {
      const text = get(column);
      if (!text) continue;
      const v = /^\d+$/.test(text) ? Number(text) : NaN;
      if (valid(v)) set[prop] = v;
      else warn(`Can't read the ${word} time "${text}" — the set is kept without it`);
    }
    const setNo = /^\d+$/.test(get('set')) ? Number(get('set')) : null;

    const key = `${d.date}|${day}`;
    if (!sessions.has(key)) {
      sessions.set(key, { s: { date: d.date, day, offDay: false, note: '', entries: [] }, lastId: null, lastSet: 0, timeRead: {} });
    }
    const g = sessions.get(key);
    if (/^(yes|y|true|1|x)$/i.test(get('off_day'))) g.s.offDay = true;
    if (!g.s.note && get('note') !== '') g.s.note = String(cells[col.note] ?? '');
    for (const [column, prop, word] of TIME_COLUMNS) {
      const text = get(column);
      if (!text || g.timeRead[column]) continue;
      g.timeRead[column] = true;
      const local = parseLocalTime(text, { today: d.date });
      if (local) g.s[prop] = local;
      else warn(`Can't read the ${word} time "${text}" — the workout is kept without it`);
    }
    const thisSet = setNo ?? g.lastSet + 1;
    if (g.lastId !== exerciseId || thisSet <= g.lastSet || !g.s.entries.length) {
      g.s.entries.push(known ? { exerciseId, sets: [] } : { exerciseId, name, sets: [] });
    }
    g.s.entries[g.s.entries.length - 1].sets.push(set);
    g.lastId = exerciseId;
    g.lastSet = thisSet;
  }
  return { sessions: sortByDate([...sessions.values()].map((g) => g.s)), warnings };
}
