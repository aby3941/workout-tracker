// The one rest / set timer of a workout, what comes next after a set (§19.2) and whether the screen stays on while it
// runs (§20.2): pure rules, no DOM.
// The timer lives in the draft: `draft.timer = {kind: 'rest', uid, set, startedAt (ms), extra (s)}` or
// `{kind: 'set', uid, set, startedAt}`, where `set` is the 0-based index of the set it sits under. The order sets are
// done in works on Today's form entries ({uid, sets: [{reps}]}) and the superset pairs on the form as [aUid, bUid]
// (`program.supersetPairs`). The limits (4-hour sitting, recorded times) come from program.js.

import { MAX_WORKOUT_MINUTES, isRecordedRest, isRecordedDuration } from './program.js';

/** A timer started longer ago than one sitting (§18.3's 4 hours) belongs to an earlier one and is dropped. */
const TIMER_MAX_MS = MAX_WORKOUT_MINUTES * 60 * 1000;

/**
 * A stored timer that can run: the right shape and, when `nowMs` is given, started within the last 4 hours (an older
 * one is from an earlier sitting). Anything else → null.
 * @param {unknown} timer
 * @param {number} [nowMs]
 * @returns {{kind: 'rest'|'set', uid: string, set: number, startedAt: number, extra?: number}|null}
 */
export function usableTimer(timer, nowMs) {
  if (!timer || typeof timer !== 'object') return null;
  const { kind, uid, set, startedAt, extra = 0 } = timer;
  if (kind !== 'rest' && kind !== 'set') return null;
  if (typeof uid !== 'string' || !Number.isInteger(set) || set < 0 || !Number.isFinite(startedAt)) return null;
  if (kind === 'rest' && (!Number.isFinite(extra) || extra < 0)) return null;
  if (nowMs != null && Math.abs(nowMs - startedAt) > TIMER_MAX_MS) return null;
  return timer;
}

/**
 * The timer of a stored draft that is running at `nowMs`: none while the draft edits a saved workout (no timers there,
 * §19.2) or when `usableTimer` drops it.
 * @param {unknown} draft
 * @param {number} nowMs
 * @returns {ReturnType<typeof usableTimer>}
 */
export function draftTimer(draft, nowMs) {
  if (!draft || typeof draft !== 'object' || draft.editingId) return null;
  return usableTimer(draft.timer, nowMs);
}

/**
 * Whether the screen should stay on (§20.2): while a rest or set timer runs, unless "Keep screen on during timers" is
 * switched off (`settings.keepAwake`; missing = on).
 * @param {object|null|undefined} timer the running timer (`draftTimer`), or null
 * @param {{keepAwake?: boolean}|null|undefined} settings
 * @returns {boolean}
 */
export function needsWakeLock(timer, settings) {
  return Boolean(timer) && !(settings && settings.keepAwake === false);
}

/**
 * Whole seconds a timer has run at `nowMs` (never below 0).
 * @param {{startedAt: number}} timer
 * @param {number} nowMs
 * @returns {number}
 */
export function timerSeconds(timer, nowMs) {
  return Math.max(0, Math.floor((nowMs - timer.startedAt) / 1000));
}

/**
 * The rest to record when Start is tapped (§19.1): the rest timer's whole seconds, or null past the 60-minute limit.
 * @param {{startedAt: number}} timer
 * @param {number} nowMs
 * @returns {number|null}
 */
export function restTaken(timer, nowMs) {
  const v = timerSeconds(timer, nowMs);
  return isRecordedRest(v) ? v : null;
}

/**
 * The set time to record when the reps are committed (§19.1): the set timer's whole seconds, at least 1, or null past
 * the 60-minute limit.
 * @param {{startedAt: number}} timer
 * @param {number} nowMs
 * @returns {number|null}
 */
export function setTaken(timer, nowMs) {
  const v = Math.max(1, timerSeconds(timer, nowMs));
  return isRecordedDuration(v) ? v : null;
}

// ---------------------------------------------------------------- what comes next (§19.2)

const isDone = (set) => Boolean(set) && set.reps > 0;

/**
 * The superset pair [aUid, bUid] holding this entry, or null.
 * @param {Array<[string, string]>} pairs
 * @param {string} uid
 * @returns {[string, string]|null}
 */
export function pairWith(pairs, uid) {
  return (pairs || []).find(([a, b]) => a === uid || b === uid) || null;
}

/**
 * Every set of the workout in the order it is done: card by card, set by set — a superset pair as one, round by
 * round (a's set 1, b's set 1, a's set 2 …).
 * @param {Array<{uid: string, sets: Array<object>}>} entries
 * @param {Array<[string, string]>} pairs
 * @returns {Array<{uid: string, set: number}>}
 */
export function setOrder(entries, pairs) {
  const byUid = new Map(entries.map((e) => [e.uid, e]));
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (seen.has(e.uid)) continue;
    const pair = pairWith(pairs, e.uid);
    const group = pair && byUid.has(pair[0]) && byUid.has(pair[1]) ? pair.map((u) => byUid.get(u)) : [e];
    for (const g of group) seen.add(g.uid);
    const rounds = Math.max(...group.map((g) => g.sets.length));
    for (let k = 0; k < rounds; k++) for (const g of group) if (k < g.sets.length) out.push({ uid: g.uid, set: k });
  }
  return out;
}

/**
 * The next set to do while no timer runs (§19.2): the first empty set in `setOrder` — set 1 of the workout at the
 * start — or null when every set has reps. `from` ({uid, set}: where the last timer was, Skip / Cancel) makes it the
 * first empty set at or after that one, wrapping round to sets left earlier — the same order as the rest box's Start
 * (`nextAfter`), so a Skip does not send the button back to a set skipped in an earlier card. Without `from`, or with
 * one no longer on the form, it counts from the top.
 * @param {Array<{uid: string, sets: Array<object>}>} entries
 * @param {Array<[string, string]>} pairs
 * @param {{uid: string, set: number}|null} [from]
 * @returns {{uid: string, set: number}|null}
 */
export function nextToDo(entries, pairs, from = null) {
  const byUid = new Map(entries.map((e) => [e.uid, e]));
  const order = setOrder(entries, pairs);
  const at = from ? order.findIndex((p) => p.uid === from.uid && p.set === from.set) : -1;
  const list = at < 0 ? order : [...order.slice(at), ...order.slice(0, at)];
  return list.find((p) => !isDone(byUid.get(p.uid).sets[p.set])) || null;
}

/**
 * What follows committing set `i` of entry `uid` (§19.2):
 * - `auto`: the entry is a superset's a and b's set i is still to do — b's set timer starts by itself (no rest);
 * - otherwise `start`, the target of the rest box's Start button: the next empty set in `setOrder` after this one
 *   (wrapping round to sets left earlier) — `kind` 'set' in this card ("Start set N+1"), 'round' for b's next round
 *   on a ("Start round N+1 · <a>"), 'next' in another card ("Start next exercise"); null when everything is done.
 *   `recordsRest`: whether tapping it saves the rest on the target — never on a superset's b (§19.1: the pair's one
 *   rest is on a; b gets there without one, e.g. b's extra set after the last round).
 * @param {Array<{uid: string, sets: Array<object>}>} entries
 * @param {Array<[string, string]>} pairs
 * @param {string} uid
 * @param {number} i
 * @param {{auto?: boolean}} [opts] auto: false asks only for the Start target (a rest box already drawn)
 * @returns {{auto?: {uid: string, set: number},
 *   start?: {uid: string, set: number, kind: 'set'|'round'|'next', recordsRest: boolean}|null}}
 */
export function nextAfter(entries, pairs, uid, i, { auto = true } = {}) {
  const byUid = new Map(entries.map((e) => [e.uid, e]));
  if (!byUid.has(uid)) return { start: null };
  const pair = pairWith(pairs, uid);
  if (auto && pair && pair[0] === uid && byUid.has(pair[1])) {
    const partnerSet = byUid.get(pair[1]).sets[i];
    if (partnerSet && !isDone(partnerSet)) return { auto: { uid: pair[1], set: i } };
  }
  const order = setOrder(entries, pairs);
  const at = order.findIndex((p) => p.uid === uid && p.set === i);
  const after = at < 0 ? order : [...order.slice(at + 1), ...order.slice(0, at)];
  const t = after.find((p) => !isDone(byUid.get(p.uid).sets[p.set]));
  if (!t) return { start: null };
  const recordsRest = !(pairs || []).some(([a, b]) => b === t.uid && byUid.has(a));
  if (t.uid === uid) return { start: { ...t, kind: 'set', recordsRest } };
  if (pair && pair[1] === uid && t.uid === pair[0]) return { start: { ...t, kind: 'round', recordsRest } };
  return { start: { ...t, kind: 'next', recordsRest } };
}
