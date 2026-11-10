// App state persistence. The storage object (localStorage in the app) is always passed in.

import { sortByDate } from './dates.js';
import { convertWeight } from './units.js';
import { roleOf } from './program.js';
import { baselineKey, isBaselineWeight } from './progression.js';

/** localStorage key for the whole app state. */
export const STORAGE_KEY = 'ppl-tracker-v1';

/**
 * A fresh default state. `baselines` holds set weights keyed by `baselineKey(exerciseId, role)`.
 * @returns {{version: 1,
 *   settings: {unit: 'kg'|'lb', goal: string, abs: boolean, lastBackupAt: string|null, setupDone: boolean},
 *   choices: Object<string,string>, sessions: Array<object>, draft: object|null,
 *   baselines: Object<string, {weight: number, setOn: string}>}}
 */
export function defaultState() {
  return {
    version: 1,
    settings: { unit: 'kg', goal: 'standard', abs: false, lastBackupAt: null, setupDone: false },
    choices: {},
    sessions: [],
    draft: null,
    baselines: {},
  };
}

let idCounter = 0;

/**
 * A unique id string.
 * @returns {string}
 */
export function newId() {
  idCounter = (idCounter + 1) % 1e6;
  const rnd = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${rnd}`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Stored baselines with a usable weight (copied); anything else → {}. */
const validBaselines = (raw) => (isObject(raw)
  ? Object.fromEntries(Object.entries(raw)
    .filter(([, b]) => isObject(b) && isBaselineWeight(b.weight))
    .map(([key, b]) => [key, { ...b }]))
  : {});

/**
 * Fill a partially stored state with defaults (give id-less sessions an id, drop unusable baselines).
 * @param {unknown} raw
 * @returns {ReturnType<typeof defaultState>}
 */
export function migrate(raw) {
  const d = defaultState();
  if (!isObject(raw)) return d;
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.filter(isObject).map((s) => (s.id ? s : { ...s, id: newId() }))
    : [];
  return {
    version: 1,
    settings: { ...d.settings, ...(isObject(raw.settings) ? raw.settings : {}) },
    choices: isObject(raw.choices) ? { ...raw.choices } : {},
    sessions,
    draft: isObject(raw.draft) ? raw.draft : null,
    baselines: validBaselines(raw.baselines),
  };
}

/**
 * Load state. Missing → default; corrupt JSON (or JSON that is not a state object) → default, with
 * the raw text kept under a `-corrupt-<timestamp>` key so nothing is lost.
 * @param {Storage} storage
 * @returns {ReturnType<typeof defaultState>}
 */
export function load(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return defaultState();
  }
  if (raw == null) return defaultState();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (isObject(parsed)) return migrate(parsed);
  try { storage.setItem(`${STORAGE_KEY}-corrupt-${Date.now()}`, raw); } catch { /* storage full: nothing more we can do */ }
  return defaultState();
}

/**
 * Save state. Returns false when the browser refuses (e.g. storage full).
 * @param {object} state
 * @param {Storage} storage
 * @returns {boolean}
 */
export function save(state, storage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * Identity of a session for import/replace: date|day.
 * @param {{date: string, day: string}} s
 * @returns {string}
 */
export function sessionKey(s) {
  return `${s.date}|${s.day}`;
}

/**
 * Merge incoming sessions: same key replaces (keeping the existing id), others are added with new ids.
 * Result sorted by date (stable). Inputs not mutated. `replaced` counts existing sessions that get
 * replaced, `added` counts new sessions in the result; if incoming repeats a key, the later one wins.
 * @param {Array<object>} existing
 * @param {Array<object>} incoming
 * @returns {{sessions: Array<object>, added: number, replaced: number}}
 */
export function mergeSessions(existing, incoming) {
  const out = [...(existing || [])];
  const existingCount = out.length;
  const index = new Map(out.map((s, i) => [sessionKey(s), i]));
  const replacedAt = new Set();
  let added = 0;
  for (const s of incoming || []) {
    const key = sessionKey(s);
    if (index.has(key)) {
      const i = index.get(key);
      out[i] = { ...s, id: out[i].id };
      if (i < existingCount) replacedAt.add(i);
    } else {
      out.push({ ...s, id: newId() });
      index.set(key, out.length - 1);
      added++;
    }
  }
  return { sessions: sortByDate(out), added, replaced: replacedAt.size };
}

/**
 * Put an edited session back where the one with `id` was: it keeps that id and its place among
 * sessions on the same date (so editing never reorders a day with two workouts). Another session
 * with the edited one's key (date|day) is removed — the edit replaces it. Unknown id → the session is
 * added with a new id. Result sorted by date (stable). Inputs not mutated.
 * @param {Array<object>} sessions
 * @param {string} id the session being edited
 * @param {object} edited the new content (its own `id`, if any, is ignored)
 * @returns {Array<object>}
 */
export function replaceSession(sessions, id, edited) {
  const key = sessionKey(edited);
  const list = sessions || [];
  const out = [];
  for (const s of list) {
    if (s.id === id) out.push({ ...edited, id });
    else if (sessionKey(s) !== key) out.push(s);
  }
  if (!list.some((s) => s.id === id)) out.push({ ...edited, id: newId() });
  return sortByDate(out);
}

/**
 * Sessions without the one with this id (new array).
 * @param {Array<object>} sessions
 * @param {string} id
 * @returns {Array<object>}
 */
export function deleteSession(sessions, id) {
  return (sessions || []).filter((s) => s.id !== id);
}

/**
 * Set the weight for an exercise's next session (replacing any earlier one) under
 * `baselineKey(exerciseId, role)`. Invalid weight (not a finite number ≥ 0) → an equal copy of `state`.
 * @param {object} state
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @param {number} weight
 * @param {string} today ISO date, stored as `setOn`
 * @returns {object} new state
 */
export function setBaseline(state, exerciseId, role, weight, today) {
  if (!isBaselineWeight(weight)) return { ...state };
  const baselines = { ...(isObject(state.baselines) ? state.baselines : {}), [baselineKey(exerciseId, role)]: { weight, setOn: today } };
  return { ...state, baselines };
}

/** New state without the given baseline keys; a state without baselines is copied as is. */
const withoutBaselines = (state, keys) => {
  if (!isObject(state.baselines)) return { ...state };
  const baselines = { ...state.baselines };
  for (const key of keys) delete baselines[key];
  return { ...state, baselines };
};

/**
 * Remove one set weight (an equal copy when it is not set).
 * @param {object} state
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @returns {object} new state
 */
export function clearBaseline(state, exerciseId, role) {
  return withoutBaselines(state, [baselineKey(exerciseId, role)]);
}

/**
 * Use up the set weights of a just-saved workout: every entry with at least one set of `reps > 0`
 * removes its baseline (role from `roleOf(session.day, exerciseId)`). Other baselines stay.
 * @param {object} state
 * @param {{day: string, entries: Array<{exerciseId: string, sets: Array<{reps: number}>}>}} session
 * @returns {object} new state
 */
export function consumeBaselines(state, session) {
  const done = (session.entries || []).filter((e) => (e.sets || []).some((st) => st.reps > 0));
  return withoutBaselines(state, done.map((e) => baselineKey(e.exerciseId, roleOf(session.day, e.exerciseId))));
}

const convertSets = (sets, from, to) => (sets || []).map((st) => (
  typeof st.weight === 'number' ? { ...st, weight: convertWeight(st.weight, from, to) } : { ...st }
));

const convertBaselines = (baselines, from, to) => Object.fromEntries(
  Object.entries(baselines).map(([key, b]) => [key, { ...b, weight: convertWeight(b.weight, from, to) }]),
);

/**
 * Convert every saved weight (sessions, the in-progress draft and set weights) to `toUnit` and switch
 * the unit setting. A state without `baselines` gets none added.
 * @param {object} state
 * @param {'kg'|'lb'} toUnit
 * @returns {object} new state
 */
export function convertAllWeights(state, toUnit) {
  const from = state.settings.unit;
  if (from === toUnit) return structuredClone(state);
  const sessions = state.sessions.map((s) => ({
    ...s,
    entries: (s.entries || []).map((e) => ({ ...e, sets: convertSets(e.sets, from, toUnit) })),
  }));
  const draft = state.draft && Array.isArray(state.draft.entries)
    ? { ...state.draft, entries: state.draft.entries.map((e) => ({ ...e, sets: convertSets(e.sets, from, toUnit) })) }
    : state.draft;
  const out = { ...state, settings: { ...state.settings, unit: toUnit }, sessions, draft };
  if (isObject(state.baselines)) out.baselines = convertBaselines(state.baselines, from, toUnit);
  return out;
}
