// Free-text workout import/export ("10/11/2026 Pull A" / "Deadlift 100x7" / "Note: …").

import { todayISO, formatDate, parseDatePrefix, sortByDate } from './dates.js';
import { DAYS, matchExercise, customId, exerciseName, parseDayText, resolveDay } from './program.js';
import { convertWeight, formatNumber } from './units.js';
import { parseCSV } from './csv.js';
import { sessionKey } from './store.js';

// ---------------------------------------------------------------- set tokens

const UNIT_OF = { kg: 'kg', kgs: 'kg', lb: 'lb', lbs: 'lb' };

/** Split a set string into tokens: num (with optional unit), bw, x, @, +, word. */
function lex(str) {
  const s = String(str ?? '').toLowerCase().replace(/[×*]/g, 'x');
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    let m = /^[\s,;|/]+/.exec(rest);
    if (m) { i += m[0].length; continue; }
    m = /^(\d+(?:\.\d+)?)(?:\s*(kgs?|lbs?)(?![a-wyz]))?/.exec(rest);
    if (m) {
      tokens.push({ t: 'num', v: Number(m[1]), int: !m[1].includes('.'), unit: m[2] ? UNIT_OF[m[2]] : null, raw: m[0] });
      i += m[0].length;
      continue;
    }
    if (rest.startsWith('bw')) { tokens.push({ t: 'bw', raw: 'bw' }); i += 2; continue; }
    if (/^x(?=[\d\s,;|/@]|$)/.test(rest)) { tokens.push({ t: 'x', raw: 'x' }); i += 1; continue; }
    if (rest[0] === '@') { tokens.push({ t: 'at', raw: '@' }); i += 1; continue; }
    if (rest[0] === '+') { tokens.push({ t: 'plus', raw: '+' }); i += 1; continue; }
    m = /^[^\s,;|/]+/.exec(rest);
    tokens.push({ t: 'word', raw: m[0] });
    i += m[0].length;
  }
  return tokens;
}

const sameSet = (a, b) => a.weight === b.weight && a.reps === b.reps;
const isPlainInt = (tok) => tok && tok.t === 'num' && tok.int && !tok.unit;

/**
 * Most sets one line can produce. Also the largest S that `S x R @ W` reads as a set count:
 * any other left side (over 20, a decimal, a unit, bw) is a weight ("100x5 @8" = 100 × 5 with an effort note).
 */
const MAX_SETS_PER_LINE = 20;

/**
 * Parse the sets part of an exercise line ("100x5 100x5 100x7", "45x12 x3", "3x12@45", "bw+10x8", "100x5/5/7").
 * Weights with a unit suffix are converted to `unit`. `S x R @ W` means S sets only when S is a plain whole
 * number 1–20; any other left side ("12.5x10 @8", "bw x 8 @ 8", "100x5 @8") is a weight × reps set and the
 * `@N` effort note is ignored with an error, as is an `@N` anywhere else. At most 20 sets per line
 * (the rest are dropped with one error). Unreadable tokens become error strings.
 * @param {string} str
 * @param {{unit?: 'kg'|'lb'}} [opts]
 * @returns {{sets: Array<{weight: number, reps: number}>, errors: string[]}}
 */
export function parseSetTokens(str, { unit = 'kg' } = {}) {
  const tokens = lex(str);
  const sets = [];
  const errors = [];
  let i = 0;
  let capped = false;
  const conv = (tok) => (tok.unit && tok.unit !== unit ? convertWeight(tok.v, tok.unit, unit) : tok.v);
  const rawOf = (from, to) => tokens.slice(from, to).map((t) => t.raw.trim()).join('');
  const fail = (from, to) => errors.push(`Couldn't read "${rawOf(from, to)}"`);

  /** Append `count` copies of `set`, never past the per-line cap (one error the first time it is hit). */
  const add = (set, count = 1) => {
    const room = MAX_SETS_PER_LINE - sets.length;
    for (let k = 0; k < Math.min(count, room); k++) sets.push({ ...set });
    if (count > room && !capped) {
      capped = true;
      errors.push(`Only the first ${MAX_SETS_PER_LINE} sets on a line are kept`);
    }
  };

  /** Weight term at i: number (with unit) or bw / bw+N. */
  const readWeight = () => {
    const tok = tokens[i];
    if (tok.t === 'num') { i++; return { value: conv(tok), tok }; }
    i++; // bw
    if (tokens[i]?.t === 'plus' && tokens[i + 1]?.t === 'num') {
      const n = tokens[i + 1];
      i += 2;
      return { value: conv(n), bw: true };
    }
    return { value: 0, bw: true };
  };

  /** Is there an "@" followed by a weight term at i? */
  const atNote = () => tokens[i]?.t === 'at' && (tokens[i + 1]?.t === 'num' || tokens[i + 1]?.t === 'bw');
  /** Only a plain whole number 1..20 (no unit, no decimal, not bw) counts as S in `S x R @ W`. */
  const isSetCount = (w) => !w.bw && isPlainInt(w.tok) && w.tok.v >= 1 && w.tok.v <= MAX_SETS_PER_LINE;
  const ignoreEffort = (from) => errors.push(`Ignored "${rawOf(from, i)}" — effort scores (like RPE) aren't saved`);

  while (i < tokens.length) {
    const start = i;
    const tok = tokens[i];
    if (tok.t === 'num' || tok.t === 'bw') {
      const w = readWeight();
      if (tokens[i]?.t === 'x' && tokens[i + 1]?.t === 'num') {
        const repsTok = tokens[i + 1];
        i += 2;
        if (!isPlainInt(repsTok)) { fail(start, i); continue; }
        if (atNote()) {
          const atStart = i;
          i += 1;
          const at = readWeight();
          if (isSetCount(w)) {
            add({ weight: at.value, reps: repsTok.v }, w.tok.v);
          } else { // not a set count: weight × reps + an ignored effort note
            add({ weight: w.value, reps: repsTok.v });
            ignoreEffort(atStart);
          }
          continue;
        }
        add({ weight: w.value, reps: repsTok.v });
        continue;
      }
      if (!w.bw && isPlainInt(w.tok) && sets.length) {
        add({ weight: sets[sets.length - 1].weight, reps: w.tok.v });
        continue;
      }
      fail(start, i);
      continue;
    }
    if (tok.t === 'x' && isPlainInt(tokens[i + 1]) && sets.length) {
      const n = tokens[i + 1].v;
      i += 2;
      const last = sets[sets.length - 1];
      let run = 0;
      for (let k = sets.length - 1; k >= 0 && sameSet(sets[k], last); k--) run++;
      if (n > run) add(last, n - run);
      continue;
    }
    if (atNote()) { // "@8" anywhere else ("100x5 x3 @8") is a note too — its number is never a set
      i += 1;
      readWeight();
      ignoreEffort(start);
      continue;
    }
    i++;
    fail(start, i);
  }
  return { sets, errors };
}

// ---------------------------------------------------------------- import

const NOTE_RE = /^note\s*:\s*(.*)$/i;

/** Does `str` open with a weight × reps set ("100x5", "62.5 kg x 5", "bw x 8", "bw+10x8", "3x12@45")? */
function beginsWithSet(str) {
  const t = lex(str.slice(0, 64)); // a leading set is short; the cap keeps long lines linear
  const afterWeight = t[0]?.t === 'num' ? 1 : t[0]?.t === 'bw' ? (t[1]?.t === 'plus' && t[2]?.t === 'num' ? 3 : 1) : 0;
  return afterWeight > 0 && t[afterWeight]?.t === 'x' && isPlainInt(t[afterWeight + 1]);
}

/**
 * Index where the sets part of an exercise line starts: among the words starting with a digit, bw,
 * or x<digit>, the first one that opens a set — so number words inside a name ("21s", "Incline 45 press",
 * "BW dips") stay in the name. When none opens a set, the first such word (its errors get reported). -1 if none.
 */
function setsStart(line) {
  const re = /(^|[\s:])(?=\d|bw|[x×]\d)/gi;
  let first = -1;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const at = m.index + m[1].length;
    if (first < 0) first = at;
    if (beginsWithSet(line.slice(at))) return at;
    if (m[0] === '') re.lastIndex++;
  }
  return first;
}

/** Is the first non-empty line a CSV header (has both "date" and "exercise" cells)? */
function looksLikeCSV(text) {
  const first = text.split('\n').find((l) => l.trim() !== '');
  if (!first) return false;
  const cells = first.split(/[,\t]/).map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ''));
  return cells.includes('date') && cells.includes('exercise');
}

/**
 * Import pasted text (free-text log or CSV) → sessions (no ids) and line warnings.
 * Text mode: when two blocks have the same date and resolved day, only the later one is returned
 * (with a warning on its header line).
 * @param {string} text
 * @param {{unit?: 'kg'|'lb', today?: string}} [opts]
 * @returns {{sessions: Array<object>, warnings: Array<{line: number, text: string, message: string}>}}
 */
export function parseImport(text, { unit = 'kg', today = todayISO() } = {}) {
  const raw = String(text ?? '');
  const noBom = raw.replace(/^\uFEFF/, '');
  if (looksLikeCSV(noBom)) return parseCSV(raw, { unit });

  const warnings = [];
  const sessions = [];
  let current = null; // {date, dayText, line, offDay, note, entries}
  let skipping = false;

  const finish = () => {
    if (!current) return;
    const c = current;
    current = null;
    if (!c.entries.length) {
      warnings.push({ line: c.line, text: c.text, message: 'No exercises under this date — skipped' });
      return;
    }
    const { type, variant, offDay } = parseDayText(c.dayText);
    const day = resolveDay(type, variant, c.entries.map((e) => e.exerciseId));
    if (!day) {
      warnings.push({ line: c.line, text: c.text, message: "Can't tell which workout this is — add Pull A, Push B, Legs… after the date" });
      return;
    }
    const session = { date: c.date, day, offDay, note: c.notes.join('\n'), entries: c.entries };
    const earlier = sessions.findIndex((s) => sessionKey(s) === sessionKey(session));
    if (earlier >= 0) {
      sessions.splice(earlier, 1);
      warnings.push({ line: c.line, text: c.text, message: 'Same date and workout as an earlier block — only this later one is kept' });
    }
    sessions.push(session);
  };

  const lines = noBom.split('\n');
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.replace(/\r/g, '').trim();
    if (!line) return;
    const warn = (message) => warnings.push({ line: lineNo, text: line, message });

    const header = parseDatePrefix(line, { today });
    if (header) {
      finish();
      if (header.invalid) {
        warn("That date doesn't exist — lines up to the next date were skipped");
        skipping = true;
        return;
      }
      skipping = false;
      current = { date: header.date, dayText: header.rest, line: lineNo, text: line, notes: [], entries: [] };
      return;
    }
    if (skipping) return;

    const note = NOTE_RE.exec(line);
    if (note) {
      if (current) current.notes.push(note[1].trim());
      else warn('Note outside a workout — ignored');
      return;
    }

    const at = setsStart(line);
    if (at < 0) { warn("No sets found (write them like 100x5)"); return; }
    const name = line.slice(0, at).trim().replace(/[\s:\-–—]+$/, '').trim();
    if (!name) { warn('Missing exercise name before the sets'); return; }
    const { sets, errors } = parseSetTokens(line.slice(at), { unit });
    for (const e of errors) warn(e);
    if (!sets.length) { warn('No readable sets — line skipped'); return; }

    if (!current) {
      current = { date: today, dayText: '', line: lineNo, text: line, notes: [], entries: [] };
      warn(`No date line above — logged as today (${formatDate(today)})`);
    }
    const id = matchExercise(name);
    if (id) {
      current.entries.push({ exerciseId: id, sets });
    } else {
      current.entries.push({ exerciseId: customId(name), name, sets });
      warn(`"${name}" isn't in the exercise list — saved as a custom exercise`);
    }
  });
  finish();
  return { sessions, warnings };
}

// ---------------------------------------------------------------- export

/**
 * Sets → "45x12 45x10 20x20 x5": identical consecutive sets are compressed with xN (N = run length).
 * @param {Array<{weight: number, reps: number}>} sets
 * @returns {string}
 */
export function formatSetText(sets) {
  const parts = [];
  for (let i = 0; i < sets.length;) {
    let j = i + 1;
    while (j < sets.length && sameSet(sets[j], sets[i])) j++;
    const one = `${formatNumber(sets[i].weight)}x${sets[i].reps}`;
    parts.push(j - i > 1 ? `${one} x${j - i}` : one);
    i = j;
  }
  return parts.join(' ');
}

/**
 * Sessions → the human text format (date-ascending, blank line between sessions).
 * parseImport(formatText(s)).sessions round-trips to s (ignoring id).
 * @param {Array<object>} sessions
 * @param {'kg'|'lb'} unit weights are printed as stored, without a unit
 * @returns {string}
 */
export function formatText(sessions, unit) {
  const blocks = sortByDate(sessions).map((s) => {
    const dayName = DAYS[s.day] ? DAYS[s.day].name : s.day;
    const lines = [`${formatDate(s.date)} ${dayName}${s.offDay ? ' (off day)' : ''}`];
    for (const e of s.entries || []) {
      if (!e.sets || !e.sets.length) continue;
      lines.push(`${exerciseName(e.exerciseId, e.name)} ${formatSetText(e.sets)}`);
    }
    if (s.note) for (const n of String(s.note).split('\n')) lines.push(`Note: ${n}`);
    return lines.join('\n');
  });
  return blocks.length ? blocks.join('\n\n') + '\n' : '';
}
