// State-derived helpers shared by the screens. No rules live here: everything is a thin combination of the
// logic modules (program.js decides plans and cycle positions, progression.js decides suggestions).

import { DAYS, DAY_ORDER, ROTATION, EXERCISES, MAIN_LIFTS, getDayPlan, daySlotKeys, cyclePosition, roleOf } from '../program.js';
import { sortByDate } from '../dates.js';

/** The plan options from the saved settings. */
function planOpts(state) {
  return { choices: state.choices, goal: state.settings.goal, abs: state.settings.abs };
}

/**
 * Resolved plan for a day with the user's swaps, goal and abs setting.
 * @param {object} state
 * @param {string} dayId
 */
export function dayPlan(state, dayId) {
  return getDayPlan(dayId, planOpts(state));
}

/**
 * Cycle positions (1–6) of a day: pullA → [1], legs → [3, 6].
 * @param {string} dayId
 * @returns {number[]}
 */
export function positionsOf(dayId) {
  return ROTATION.map((d, i) => (d === dayId ? i + 1 : 0)).filter(Boolean);
}

/**
 * "Day 1 and Day 4" / "Day 1, Day 3 and Day 6".
 * @param {number[]} positions
 */
export function dayList(positions) {
  const names = positions.map((p) => `Day ${p}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '';
}

/**
 * "Days 1 & 4" for a set of days.
 * @param {string[]} dayIds
 */
export function daysShort(dayIds) {
  const pos = [...new Set(dayIds.flatMap(positionsOf))].sort((a, b) => a - b);
  return pos.length > 1 ? `Days ${pos.slice(0, -1).join(', ')} & ${pos[pos.length - 1]}` : `Day ${pos[0]}`;
}

/**
 * Cycle positions of the days that use a slot ("applies to Day 1 and Day 4").
 * @param {string} slotKey
 * @param {boolean} abs
 * @returns {number[]}
 */
export function slotPositions(slotKey, abs) {
  return ROTATION.map((d, i) => (daySlotKeys(d, abs).includes(slotKey) ? i + 1 : 0)).filter(Boolean);
}

/**
 * Day number of every logged session (id → 1–6), from the sessions before it in date order.
 * @param {Array<object>} sessions
 * @returns {Map<string, number>}
 */
export function historyPositions(sessions) {
  const sorted = sortByDate(sessions);
  const out = new Map();
  sorted.forEach((s, i) => out.set(s.id, cyclePosition(s.day, sorted.slice(0, i))));
  return out;
}

/**
 * Rep-range tag for an accessory that is also a main lift elsewhere ("Overhead press (8–12 reps)").
 * @param {{repsMin: number|null, repsMax: number|null}} rx
 */
export function repsTag(rx) {
  if (rx.repsMin == null) return '';
  return rx.repsMin === rx.repsMax ? `${rx.repsMin} reps` : `${rx.repsMin}–${rx.repsMax} reps`;
}

/**
 * Display name that keeps a main lift's accessory use apart from the main lift.
 * @param {string} exerciseId
 * @param {string} name
 * @param {'main'|'accessory'} role
 * @param {{repsMin: number|null, repsMax: number|null}|null} rx
 */
export function roleName(exerciseId, name, role, rx) {
  if (role === 'accessory' && MAIN_LIFTS.includes(exerciseId) && rx && repsTag(rx)) return `${name} (${repsTag(rx)})`;
  return name;
}

/**
 * The 5 main lifts and every current accessory pick (unique by exercise + role), program order.
 * @param {object} state
 * @returns {{mains: Array<{exerciseId: string, name: string, role: 'main'}>,
 *   accessories: Array<{exerciseId: string, name: string, role: 'accessory'}>}}
 */
export function weightTargets(state) {
  const mains = MAIN_LIFTS.map((id) => ({ exerciseId: id, name: EXERCISES[id].name, role: 'main' }));
  const seen = new Set();
  const accessories = [];
  for (const day of DAY_ORDER) {
    for (const it of dayPlan(state, day).items) {
      if (roleOf(day, it.exerciseId) !== 'accessory' || seen.has(it.exerciseId)) continue;
      seen.add(it.exerciseId);
      accessories.push({ exerciseId: it.exerciseId, name: roleName(it.exerciseId, it.name, 'accessory', it), role: 'accessory' });
    }
  }
  return { mains, accessories };
}

/** Day display name. */
export const dayName = (dayId) => (DAYS[dayId] ? DAYS[dayId].name : String(dayId));
