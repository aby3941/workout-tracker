// Linear progression: history per exercise+role, main-lift and accessory suggestions, warm-ups.
// Pure: inputs are sorted internally and never mutated.

import { sortByDate } from './dates.js';
import {
  MAIN_REPS, MISSES_BEFORE_DELOAD, DELOAD_FACTOR, WARMUP_RAMP, WARMUP_BAR_REPS,
  roleOf, mainSetsFor, incrementCategory,
} from './program.js';
import { incrementFor, floorTo, roundTo, cleanNumber, barWeight, smallestIncrement } from './units.js';

/**
 * Logged history of one exercise in one role, oldest first. Several entries of the same
 * exercise+role in one session are combined (sets concatenated).
 * @param {Array<object>} sessions
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @returns {Array<{date: string, day: string, offDay: boolean, sets: Array<{weight: number, reps: number}>}>}
 */
export function entriesFor(sessions, exerciseId, role) {
  const out = [];
  for (const s of sortByDate(sessions)) {
    if (roleOf(s.day, exerciseId) !== role) continue;
    const matches = (s.entries || []).filter((e) => e.exerciseId === exerciseId);
    if (!matches.length) continue;
    const sets = matches.flatMap((e) => (e.sets || []).map(({ weight, reps }) => ({ weight, reps })));
    if (!sets.length) continue;
    out.push({ date: s.date, day: s.day, offDay: Boolean(s.offDay), sets });
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
 * 10% deload rounded down to the lift's increment.
 * @param {number} w
 * @param {string} exerciseId
 * @param {'kg'|'lb'} unit
 * @returns {number}
 */
export function deloadWeight(w, exerciseId, unit) {
  return floorTo(w * DELOAD_FACTOR, incrementFor(incrementCategory(exerciseId, 'main'), unit));
}

/**
 * Next main-lift weight from the main-role history.
 * @param {Array<object>} sessions
 * @param {string} exerciseId
 * @param {'kg'|'lb'} unit
 * @returns {{weight: number|null, action: 'start'|'increase'|'repeat'|'deload', failStreak: number, last: object|null}}
 */
export function suggestMain(sessions, exerciseId, unit) {
  const items = entriesFor(sessions, exerciseId, 'main');
  if (!items.length) return { weight: null, action: 'start', failStreak: 0, last: null };
  const planned = mainSetsFor(exerciseId) ?? 1;
  const last = items[items.length - 1];
  const w = maxWeight(last);
  if (isMainSuccess(last, planned)) {
    const inc = incrementFor(incrementCategory(exerciseId, 'main'), unit);
    return { weight: cleanNumber(w + inc), action: 'increase', failStreak: 0, last };
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
    return { weight: deloadWeight(w, exerciseId, unit), action: 'deload', failStreak, last };
  }
  return { weight: w, action: 'repeat', failStreak, last };
}

/**
 * Next accessory weight from the accessory-role history (double progression within the rep range).
 * @param {Array<object>} sessions
 * @param {string} exerciseId
 * @param {{sets: number, repsMin: number|null, repsMax: number|null}} slot
 * @param {'kg'|'lb'} unit
 * @returns {{weight: number|null, action: 'start'|'none'|'increase'|'decrease'|'keep', last: object|null}}
 */
export function suggestAccessory(sessions, exerciseId, slot, unit) {
  const items = entriesFor(sessions, exerciseId, 'accessory');
  if (!items.length) return { weight: null, action: 'start', last: null };
  const last = items[items.length - 1];
  const w = maxWeight(last);
  if (slot.repsMin == null) return { weight: w, action: 'none', last };
  const inc = incrementFor('accessory', unit);
  if (last.sets.length >= slot.sets && last.sets.every((s) => s.reps >= slot.repsMax)) {
    return { weight: cleanNumber(w + inc), action: 'increase', last };
  }
  if (!last.offDay && last.sets.some((s) => s.reps < slot.repsMin)) {
    return { weight: cleanNumber(Math.max(0, w - inc)), action: 'decrease', last };
  }
  return { weight: w, action: 'keep', last };
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
 * Key of a set weight ("baseline") in `state.baselines`: exercise and role together,
 * so bench as a main lift and bench as an accessory are separate.
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @returns {string}
 */
export function baselineKey(exerciseId, role) {
  return `${exerciseId}|${role}`;
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
 * @returns {Array<{weight: number, reps: number}>}
 */
export function warmupSets(workWeight, unit) {
  if (workWeight == null || !Number.isFinite(workWeight)) return [];
  const bar = barWeight(unit);
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
