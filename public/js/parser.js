// Free-text workout import/export ("10/11/2026 Pull A" / "Deadlift 100x7" / "Note: …").

import {
  todayISO, formatDate, parseDatePrefix, sortByDate, isValidLocalTime, formatTime, localDate, parseWallClock, clockAfter, parseLocalTime,
  formatClock, parseClock,
} from './dates.js';
import {
  DAYS, matchExercise, customId, exerciseName, parseDayText, resolveDay, isRecordedRest, isRecordedDuration, recordedTimes,
} from './program.js';
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
const TIME_RE = /^time\s*:\s*(.*)$/i;

// ---------------------------------------------------------------- workout times ("Time: 18:42–19:34", §18.3)
// A side is a clock time on the workout's date (the finish: the first such time after the start, so 23:30–00:20 ends
// the next day), or a full "DD/MM/YYYY HH:MM" when that would be wrong. Either side may be missing.

const TIME_SIDE = '(?:(\\S+)\\s+)?(\\d{1,2}[:.]\\d{2})';
const TIME_RANGE_RE = new RegExp(`^(?:${TIME_SIDE})?\\s*[–—-]\\s*(?:${TIME_SIDE})?$`);

/** One side of a Time line → local time, or null when unreadable. `anchor(clock)` places a bare clock time. */
function readSide(dateText, clockText, anchor, today) {
  if (dateText != null) return parseLocalTime(`${dateText} ${clockText}`, { today });
  const clock = parseWallClock(clockText);
  return clock ? anchor(clock) : null;
}

/**
 * The text of a Time line for a session's times ("18:42–19:34"), or '' when it has none.
 * @param {{date: string, startedAt?: string, finishedAt?: string}} s
 * @returns {string}
 */
function formatTimeRange(s) {
  const start = isValidLocalTime(s.startedAt) ? s.startedAt : null;
  const end = isValidLocalTime(s.finishedAt) ? s.finishedAt : null;
  if (!start && !end) return '';
  const full = (local) => `${formatDate(localDate(local))} ${formatTime(local)}`;
  const startText = !start ? '' : localDate(start) === s.date ? formatTime(start) : full(start);
  const endShort = end && (start ? clockAfter(start, formatTime(end)) === end : localDate(end) === s.date);
  const endText = !end ? '' : endShort ? formatTime(end) : full(end);
  const long = startText.includes(' ') || endText.includes(' ');
  return long ? `${startText} – ${endText}`.trim() : `${startText}–${endText}`;
}

/**
 * Read a Time line's text for a workout on `date` → {startedAt?, finishedAt?}, or null when unreadable.
 * @param {string} text e.g. "18:42–19:34", "23:30-00:20", "10/11/2026 09:00 – 11/11/2026 09:00"
 * @param {string} date ISO date of the workout
 * @param {string} today
 * @returns {{startedAt?: string, finishedAt?: string}|null}
 */
function parseTimeRange(text, date, today) {
  const m = TIME_RANGE_RE.exec(String(text).trim());
  if (!m || (!m[2] && !m[4])) return null;
  const out = {};
  if (m[2]) {
    const start = readSide(m[1], m[2], (clock) => `${date}T${clock}`, today);
    if (!start) return null;
    out.startedAt = start;
  }
  if (m[4]) {
    const end = readSide(m[3], m[4], (clock) => (out.startedAt ? clockAfter(out.startedAt, clock) : `${date}T${clock}`), today);
    if (!end) return null;
    out.finishedAt = end;
  }
  return out;
}

// ---------------------------------------------------------------- rest / set times ("  rest - 2:41 3:05 · sets 0:38 0:40 0:52", §19.1)
// An optional line right under an exercise line: the recorded rest before each set and each set's time, by position
// from set 1 ("-" = not recorded). Either part may be missing.

const TIME_TOKEN = '(?:\\d{1,4}:\\d{2}|[-–—])';
const TIMES_RE = new RegExp(`^(?:rest((?:\\s+${TIME_TOKEN})+))?\\s*[·|]?\\s*(?:sets?((?:\\s+${TIME_TOKEN})+))?$`, 'i');

/**
 * The rest / set times line of an entry's sets ("rest - 2:41 3:05 · sets 0:38 0:40 0:52"), or '' when none is
 * recorded. One value per set, so the line lines up with the sets however they are compressed above it.
 * @param {Array<object>} sets
 * @returns {string}
 */
function timesText(sets) {
  const { rests, durations } = recordedTimes(sets);
  const part = (word, values) => (values ? `${word} ${values.map((v) => (v == null ? '-' : formatClock(v))).join(' ')}` : '');
  return [part('rest', rests), part('sets', durations)].filter(Boolean).join(' · ');
}

/** A rest / set times line → {rests, durations}: the raw tokens of each part (null when absent); not one → null. */
function readTimesLine(line) {
  const m = TIMES_RE.exec(line);
  if (!m || (!m[1] && !m[2])) return null;
  const tokens = (part) => (part ? part.trim().split(/\s+/) : null);
  return { rests: tokens(m[1]), durations: tokens(m[2]) };
}

/**
 * Put the times of a rest / set times line on the entry's sets (by position). Unreadable or out-of-range values and
 * values past the last set are skipped, each with a message.
 * @returns {string[]} messages for the line's warnings
 */
function applyTimes(entry, { rests, durations }) {
  const errors = [];
  const put = (tokens, key, valid, word) => {
    if (!tokens) return;
    if (tokens.length > entry.sets.length) errors.push(`More ${word} times than sets — the extra ones are ignored`);
    tokens.slice(0, entry.sets.length).forEach((tok, i) => {
      if (/^[-–—]$/.test(tok)) return;
      const v = parseClock(tok);
      if (valid(v)) entry.sets[i][key] = v;
      else errors.push(`Couldn't use the ${word} time "${tok}" — ${word === 'rest' ? 'rests go from 0:00' : 'set times go from 0:01'} to 60:00`);
    });
  };
  put(rests, 'rest', isRecordedRest, 'rest');
  put(durations, 'duration', isRecordedDuration, 'set');
  return errors;
}

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
    if (c.timeText != null) {
      const times = parseTimeRange(c.timeText, c.date, today);
      if (times) Object.assign(session, times);
      else warnings.push({ line: c.timeLine, text: `Time: ${c.timeText}`, message: "Can't read the time — write it like Time: 18:42–19:34" });
    }
    const earlier = sessions.findIndex((s) => sessionKey(s) === sessionKey(session));
    if (earlier >= 0) {
      sessions.splice(earlier, 1);
      warnings.push({ line: c.line, text: c.text, message: 'Same date and workout as an earlier block — only this later one is kept' });
    }
    sessions.push(session);
  };

  const lines = noBom.split('\n');
  let lastEntry = null; // the entry of the exercise line just above (its rest / set times line may follow)
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.replace(/\r/g, '').trim();
    if (!line) return;
    const warn = (message) => warnings.push({ line: lineNo, text: line, message });
    const under = lastEntry;
    lastEntry = null;

    const times = readTimesLine(line);
    if (times) {
      if (skipping) return;
      if (!under) { warn('Rest / set times go right under their exercise line — ignored'); return; }
      for (const e of applyTimes(under, times)) warn(e);
      return;
    }

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

    const time = TIME_RE.exec(line);
    if (time) {
      if (current) { current.timeText = time[1].trim(); current.timeLine = lineNo; } else warn('Time outside a workout — ignored');
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
    lastEntry = current.entries[current.entries.length - 1];
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
    const time = formatTimeRange(s);
    if (time) lines.push(`Time: ${time}`);
    for (const e of s.entries || []) {
      if (!e.sets || !e.sets.length) continue;
      lines.push(`${exerciseName(e.exerciseId, e.name)} ${formatSetText(e.sets)}`);
      const times = timesText(e.sets);
      if (times) lines.push(`  ${times}`); // §19.1: indented, right under its exercise
    }
    if (s.note) for (const n of String(s.note).split('\n')) lines.push(`Note: ${n}`);
    return lines.join('\n');
  });
  return blocks.length ? blocks.join('\n\n') + '\n' : '';
}
