// Progress analysis: e1RM, per-exercise series, PBs, weekly volume, summary, watch list.

import { sortByDate, weekStart, addDays, compareISO, isValidISO } from './dates.js';
import { MAIN_LIFTS, roleOf, exerciseName } from './program.js';
import { entriesFor, maxWeight, suggestMain } from './progression.js';
import { roundTo, cleanNumber } from './units.js';

/**
 * Estimated one-rep max (Epley), rounded to 0.1. reps ≤ 0 → 0; 1 rep → the weight.
 * @param {number} weight
 * @param {number} reps
 * @returns {number}
 */
export function e1rm(weight, reps) {
  if (!(reps > 0)) return 0;
  if (reps === 1) return weight;
  return roundTo(weight * (1 + reps / 30), 0.1);
}

const volumeOf = (sets) => cleanNumber(sets.reduce((sum, s) => sum + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0));

/**
 * One point per session for an exercise in a role, oldest first.
 * @param {Array<object>} sessions
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @returns {Array<{date: string, topWeight: number, bestE1rm: number, volume: number, sets: Array, offDay: boolean}>}
 */
export function series(sessions, exerciseId, role) {
  return entriesFor(sessions, exerciseId, role).map((item) => ({
    date: item.date,
    topWeight: maxWeight(item),
    bestE1rm: Math.max(...item.sets.map((s) => e1rm(s.weight, s.reps))),
    volume: volumeOf(item.sets),
    sets: item.sets,
    offDay: item.offDay,
  }));
}

/**
 * Unique (exerciseId, role) pairs in the data with display names, in order of first appearance.
 * @param {Array<object>} sessions
 * @returns {Array<{exerciseId: string, name: string, role: 'main'|'accessory'}>}
 */
export function exercisesInData(sessions) {
  const seen = new Map();
  for (const s of sortByDate(sessions)) {
    for (const e of s.entries || []) {
      if (!e.sets || !e.sets.length) continue; // no sets = no data (entriesFor skips these too)
      const role = roleOf(s.day, e.exerciseId);
      const key = `${e.exerciseId}|${role}`;
      if (!seen.has(key)) seen.set(key, { exerciseId: e.exerciseId, name: exerciseName(e.exerciseId, e.name), role });
    }
  }
  return [...seen.values()];
}

/**
 * Best weight and best e1RM per (exerciseId, role); the earliest date wins ties.
 * @param {Array<object>} sessions
 * @returns {Array<{exerciseId: string, name: string, role: string, bestWeight: number, bestWeightDate: string, bestE1rm: number, bestE1rmDate: string}>}
 */
export function personalBests(sessions) {
  return exercisesInData(sessions).map(({ exerciseId, name, role }) => {
    const pb = { exerciseId, name, role, bestWeight: -Infinity, bestWeightDate: null, bestE1rm: -Infinity, bestE1rmDate: null };
    for (const p of series(sessions, exerciseId, role)) {
      if (p.topWeight > pb.bestWeight) { pb.bestWeight = p.topWeight; pb.bestWeightDate = p.date; }
      if (p.bestE1rm > pb.bestE1rm) { pb.bestE1rm = p.bestE1rm; pb.bestE1rmDate = p.date; }
    }
    return pb;
  });
}

/**
 * Total volume (Σ weight × reps) and session count per Monday-week, oldest first, gaps zero-filled.
 * @param {Array<object>} sessions
 * @returns {Array<{weekStart: string, volume: number, count: number}>}
 */
export function weeklyVolume(sessions) {
  // A non-ISO date would make the zero-fill walk below never reach the last week.
  const sorted = sortByDate(sessions).filter((s) => isValidISO(s.date));
  if (!sorted.length) return [];
  const byWeek = new Map();
  for (const s of sorted) {
    const wk = weekStart(s.date);
    const cur = byWeek.get(wk) || { volume: 0, count: 0 };
    cur.volume += (s.entries || []).reduce((sum, e) => sum + volumeOf(e.sets || []), 0);
    cur.count += 1;
    byWeek.set(wk, cur);
  }
  const out = [];
  const last = weekStart(sorted[sorted.length - 1].date);
  for (let wk = weekStart(sorted[0].date); compareISO(wk, last) <= 0; wk = addDays(wk, 7)) {
    const cur = byWeek.get(wk) || { volume: 0, count: 0 };
    out.push({ weekStart: wk, volume: cleanNumber(cur.volume), count: cur.count });
  }
  return out;
}

/**
 * Headline counts: total, this calendar month, the last 7 days (today−7, today], first/last dates.
 * @param {Array<object>} sessions
 * @param {string} today ISO date
 * @returns {{total: number, thisMonth: number, last7: number, firstDate: string|null, lastDate: string|null}}
 */
export function summary(sessions, today) {
  const sorted = sortByDate(sessions);
  const month = today.slice(0, 7);
  const weekAgo = addDays(today, -7);
  return {
    total: sorted.length,
    thisMonth: sorted.filter((s) => s.date.slice(0, 7) === month).length,
    last7: sorted.filter((s) => compareISO(s.date, weekAgo) > 0 && compareISO(s.date, today) <= 0).length,
    firstDate: sorted.length ? sorted[0].date : null,
    lastDate: sorted.length ? sorted[sorted.length - 1].date : null,
  };
}

/**
 * Main lifts currently missing (fail streak ≥ 1) or due a deload.
 * @param {Array<object>} sessions
 * @param {'kg'|'lb'} unit
 * @returns {Array<{exerciseId: string, weight: number, failStreak: number, action: string}>}
 */
export function watchList(sessions, unit) {
  const out = [];
  for (const id of MAIN_LIFTS) {
    const r = suggestMain(sessions, id, unit);
    if (r.action === 'start') continue;
    if (r.failStreak >= 1 || r.action === 'deload') out.push({ exerciseId: id, weight: r.weight, failStreak: r.failStreak, action: r.action });
  }
  return out;
}
