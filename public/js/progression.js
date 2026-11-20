// Linear progression: history per track (exercise + role + occurrence), main-lift, accessory and timed suggestions,
// set weights and warm-ups. Pure: inputs are sorted internally and never mutated.

import { sortByDate } from './dates.js';
import {
  MAIN_REPS, MISSES_BEFORE_DELOAD, DELOAD_FACTOR, WARMUP_RAMP, WARMUP_BAR_REPS,
  HOLD_GOAL_SECONDS, HOLD_START_SECONDS, HOLD_STEP_SECONDS,
  roleOf, mainSetsFor,
} from './program.js';
import { floorTo, roundTo, cleanNumber, barWeight, isValidBarWeight, smallestIncrement, stepFor } from './units.js';

/**
 * Occurrence of each entry (§17.1): its 0-based index among the entries before it with the same exercise, in saved
 * order. Within one session an exercise has one role (`roleOf(day, exerciseId)`), so counting by exercise is
 * counting by exercise + role. Works on saved entries and on Today's form entries alike.
 * @param {Array<{exerciseId: string}>} entries
 * @returns {number[]} one occurrence per entry, same order
 */
export function occurrencesOf(entries) {
  const seen = new Map();
  return (entries || []).map((e) => {
    const n = seen.get(e.exerciseId) || 0;
    seen.set(e.exerciseId, n + 1);
    return n;
  });
}

/**
 * Logged history of one track, oldest first: per session, only the entry at `occurrence` among that session's
 * entries of this exercise in this role (sessions without it are skipped). Nothing is combined (§17.1).
 * @param {Array<object>} sessions
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @param {number} [occurrence] 0 = the first entry of the exercise in a session, 1 = the second, …
 * @returns {Array<{date: string, day: string, offDay: boolean, sets: Array<{weight: number, reps: number}>}>}
 */
export function entriesFor(sessions, exerciseId, role, occurrence = 0) {
  const out = [];
  for (const s of sortByDate(sessions)) {
    if (roleOf(s.day, exerciseId) !== role) continue;
    const entries = s.entries || [];
    const occ = occurrencesOf(entries);
    const e = entries.find((x, i) => x.exerciseId === exerciseId && occ[i] === occurrence);
    if (!e || !e.sets || !e.sets.length) continue;
    out.push({ date: s.date, day: s.day, offDay: Boolean(s.offDay), sets: e.sets.map(({ weight, reps }) => ({ weight, reps })) });
  }
  return out;
}

/**
 * Heaviest weight in a history item.
 * @param {{sets: Array<{weight: number}>}} item
 * @returns {number}
 */
export function maxWeight(item) {
  return item.sets.length ? Math.max(...item.sets.map((s) => Number(s.weight) || 0)) : 0;
}

/**
 * A main-lift session succeeds when all planned sets exist and each has at least 5 reps.
 * @param {{sets: Array<{reps: number}>}} item
 * @param {number} plannedSets
 * @returns {boolean}
 */
export function isMainSuccess(item, plannedSets) {
  return item.sets.length >= plannedSets && item.sets.slice(0, plannedSets).every((s) => s.reps >= MAIN_REPS);
}

/**
 * 10% deload rounded down to the lift's weight step (`stepFor`: its category, or the user's own step).
 * @param {number} w
 * @param {string} exerciseId
 * @param {'kg'|'lb'} unit
 * @param {Object<string, number>} [steps] the user's steps (`state.steps`)
 * @returns {number}
 */
export function deloadWeight(w, exerciseId, unit, steps = {}) {
  return floorTo(w * DELOAD_FACTOR, stepFor(exerciseId, 'main', unit, steps));
}

/**
 * Next main-lift weight from the main-role history of one track.
 * @param {Array<object>} sessions
 * @param {string} exerciseId
 * @param {'kg'|'lb'} unit
 * @param {{occurrence?: number, steps?: Object<string, number>}} [opts] the track (default 0) and the user's steps
 * @returns {{weight: number|null, action: 'start'|'increase'|'repeat'|'deload', failStreak: number, last: object|null}}
 */
export function suggestMain(sessions, exerciseId, unit, { occurrence = 0, steps = {} } = {}) {
  const items = entriesFor(sessions, exerciseId, 'main', occurrence);
  if (!items.length) return { weight: null, action: 'start', failStreak: 0, last: null };
  const planned = mainSetsFor(exerciseId) ?? 1;
  const last = items[items.length - 1];
  const w = maxWeight(last);
  if (isMainSuccess(last, planned)) {
    return { weight: cleanNumber(w + stepFor(exerciseId, 'main', unit, steps)), action: 'increase', failStreak: 0, last };
  }
  let failStreak = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const ok = isMainSuccess(item, planned);
    if (item.offDay && !ok) continue;
    if (ok || maxWeight(item) !== w) break;
    failStreak++;
  }
  if (failStreak >= MISSES_BEFORE_DELOAD) {
    return { weight: deloadWeight(w, exerciseId, unit, steps), action: 'deload', failStreak, last };
  }
  return { weight: w, action: 'repeat', failStreak, last };
}

/**
 * Next accessory weight from the accessory-role history of one track (double progression within the rep range).
 * Increases and decreases move by the exercise's step (`stepFor`: 5 kg on machines and cables, or the user's own).
 * @param {Array<object>} sessions
 * @param {string} exerciseId
 * @param {{sets: number, repsMin: number|null, repsMax: number|null}} slot
 * @param {'kg'|'lb'} unit
 * @param {{occurrence?: number, steps?: Object<string, number>}} [opts] the track (default 0) and the user's steps
 * @returns {{weight: number|null, action: 'start'|'none'|'increase'|'decrease'|'keep', last: object|null}}
 */
export function suggestAccessory(sessions, exerciseId, slot, unit, { occurrence = 0, steps = {} } = {}) {
  const items = entriesFor(sessions, exerciseId, 'accessory', occurrence);
  if (!items.length) return { weight: null, action: 'start', last: null };
  const last = items[items.length - 1];
  const w = maxWeight(last);
  if (slot.repsMin == null) return { weight: w, action: 'none', last };
  const inc = stepFor(exerciseId, 'accessory', unit, steps);
  if (last.sets.length >= slot.sets && last.sets.every((s) => s.reps >= slot.repsMax)) {
    return { weight: cleanNumber(w + inc), action: 'increase', last };
  }
  if (!last.offDay && last.sets.some((s) => s.reps < slot.repsMin)) {
    return { weight: cleanNumber(Math.max(0, w - inc)), action: 'decrease', last };
  }
  return { weight: w, action: 'keep', last };
}

/**
 * Next hold for a timed exercise (plank; the reps field holds seconds, §17.3), from one accessory track.
 * The session that decides is the latest one, unless it was an off day that missed the goal — then the latest
 * normal session (off days don't count, as with accessories). From it:
 * - every planned set held ≥ 60 s → 'increase': weight + step (a plate on the back), target back to 30 s;
 * - otherwise → 'keep' the weight, target = shortest hold + 5 s, at most 60 s.
 * No history → 'start' with a 30 s target. `last` is the deciding session; `offDayIgnored` is true when that is not
 * the latest one (the latest was an off day that was passed over), so a screen never calls it "last time".
 * @param {Array<object>} sessions
 * @param {string} exerciseId
 * @param {{sets: number}} slot planned sets
 * @param {'kg'|'lb'} unit
 * @param {{occurrence?: number, steps?: Object<string, number>}} [opts] the track (default 0) and the user's steps
 * @returns {{weight: number|null, action: 'start'|'increase'|'keep', targetSeconds: number, last: object|null,
 *   offDayIgnored: boolean}}
 */
export function suggestTimed(sessions, exerciseId, slot, unit, { occurrence = 0, steps = {} } = {}) {
  const items = entriesFor(sessions, exerciseId, 'accessory', occurrence);
  if (!items.length) return { weight: null, action: 'start', targetSeconds: HOLD_START_SECONDS, last: null, offDayIgnored: false };
  const held = (item) => item.sets.length >= slot.sets && item.sets.every((s) => s.reps >= HOLD_GOAL_SECONDS);
  const latest = items[items.length - 1];
  const last = latest.offDay && !held(latest) ? ([...items].reverse().find((i) => !i.offDay) || latest) : latest;
  const offDayIgnored = last !== latest;
  const w = maxWeight(last);
  if (held(last)) {
    return { weight: cleanNumber(w + stepFor(exerciseId, 'accessory', unit, steps)), action: 'increase', targetSeconds: HOLD_START_SECONDS, last, offDayIgnored };
  }
  const shortest = Math.min(...last.sets.map((s) => Number(s.reps) || 0));
  return { weight: w, action: 'keep', targetSeconds: Math.min(HOLD_GOAL_SECONDS, shortest + HOLD_STEP_SECONDS), last, offDayIgnored };
}

/**
 * Reps still missing before an accessory's weight goes up (the 'increase' rule of `suggestAccessory`):
 * for every planned or logged set, how far it fell short of the top of the range; a planned set that was
 * not done counts in full. 0 exactly when the next suggestion is an increase. No rep target → null.
 * @param {{sets: Array<{reps: number}>}|null} item a history item (e.g. `suggestAccessory(...).last`)
 * @param {{sets: number, repsMax: number|null}} slot
 * @returns {number|null}
 */
export function repsToGo(item, slot) {
  if (!item || !slot || slot.repsMax == null) return null;
  const count = Math.max(slot.sets, item.sets.length);
  let missing = 0;
  for (let i = 0; i < count; i++) missing += Math.max(0, slot.repsMax - (item.sets[i] ? Number(item.sets[i].reps) || 0 : 0));
  return missing;
}

/**
 * Key of a set weight ("baseline") in `state.baselines`, one per track: exercise and role together (bench as a
 * main lift and bench as an accessory are separate), plus the occurrence when it is not the first —
 * "lateralRaise|accessory" (stored before §17.1, still the first) and "lateralRaise|accessory|1" (the second).
 * The UI uses the same key to name a track.
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @param {number} [occurrence]
 * @returns {string}
 */
export function baselineKey(exerciseId, role, occurrence = 0) {
  return occurrence > 0 ? `${exerciseId}|${role}|${occurrence}` : `${exerciseId}|${role}`;
}

/**
 * A usable set weight: a finite number ≥ 0 (0 means bodyweight).
 * @param {unknown} weight
 * @returns {boolean}
 */
export function isBaselineWeight(weight) {
  return Number.isFinite(weight) && weight >= 0;
}

/**
 * Use a set weight for the next session: replaces the suggestion's weight (action 'set', fail streak
 * reset when the suggestion has one, `last` kept). Missing or invalid baseline → `suggestion` unchanged.
 * Works on `suggestMain` and `suggestAccessory` results; never mutates its inputs.
 * @template {{weight: number|null, action: string, last: object|null, failStreak?: number}} S
 * @param {S} suggestion
 * @param {{weight: number, setOn?: string}|null|undefined} baseline
 * @returns {S|(S & {action: 'set'})}
 */
export function applyBaseline(suggestion, baseline) {
  if (!baseline || !isBaselineWeight(baseline.weight)) return suggestion;
  const out = { ...suggestion, weight: baseline.weight, action: 'set' };
  if (Object.hasOwn(suggestion, 'failStreak')) out.failStreak = 0;
  return out;
}

/**
 * Display-only warm-up ramp: bar × 10, then 50% × 10, 70% × 5, 90% × 3 of the work weight,
 * rounded to the nearest 2.5 kg / 5 lb; sets at/below the bar, at/above the work weight, or repeated are dropped.
 * @param {number|null} workWeight
 * @param {'kg'|'lb'} unit
 * @param {number} [bar] the user's bar (`settings.barWeight`); missing or unusable → `barWeight(unit)`
 * @returns {Array<{weight: number, reps: number}>}
 */
export function warmupSets(workWeight, unit, bar) {
  if (workWeight == null || !Number.isFinite(workWeight)) return [];
  if (!isValidBarWeight(bar)) bar = barWeight(unit);
  const out = [{ weight: bar, reps: WARMUP_BAR_REPS }];
  if (workWeight <= bar) return out;
  const step = smallestIncrement(unit);
  for (const { fraction, reps } of WARMUP_RAMP) {
    const weight = roundTo(workWeight * fraction, step);
    if (weight <= bar || weight >= workWeight || out.some((s) => s.weight === weight)) continue;
    out.push({ weight, reps });
  }
  return out;
}
