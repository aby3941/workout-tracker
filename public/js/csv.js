// CSV backup format: one row per set. RFC-4180 quoting, comma or tab delimited on import.

import { formatDate, parseDatePrefix, sortByDate } from './dates.js';
import { DAYS, matchExercise, customId, exerciseName, dayFromName } from './program.js';
import { convertWeight, formatNumber } from './units.js';

/** Exact export header. */
export const CSV_HEADER = 'date,day,exercise,set,weight,reps,unit,off_day,note';

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
    const setNo = /^\d+$/.test(get('set')) ? Number(get('set')) : null;

    const key = `${d.date}|${day}`;
    if (!sessions.has(key)) {
      sessions.set(key, { s: { date: d.date, day, offDay: false, note: '', entries: [] }, lastId: null, lastSet: 0 });
    }
    const g = sessions.get(key);
    if (/^(yes|y|true|1|x)$/i.test(get('off_day'))) g.s.offDay = true;
    if (!g.s.note && get('note') !== '') g.s.note = String(cells[col.note] ?? '');
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
