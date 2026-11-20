// App state persistence. The storage object (localStorage in the app) is always passed in.

import { sortByDate } from './dates.js';
import { convertWeight, barWeight, isValidBarWeight, isValidStep } from './units.js';
import { roleOf } from './program.js';
import { baselineKey, isBaselineWeight, occurrencesOf } from './progression.js';

/** localStorage key for the whole app state. */
export const STORAGE_KEY = 'ppl-tracker-v1';

/**
 * A fresh default state. `baselines` holds set weights keyed by `baselineKey(exerciseId, role, occurrence)`;
 * `steps` the user's own weight step per exercise id (§17.2); `settings.barWeight` the empty bar in the
 * user's unit (§17.4).
 * @returns {{version: 1,
 *   settings: {unit: 'kg'|'lb', goal: string, abs: boolean, lastBackupAt: string|null, setupDone: boolean, barWeight: number},
 *   choices: Object<string,string>, sessions: Array<object>, draft: object|null,
 *   baselines: Object<string, {weight: number, setOn: string}>, steps: Object<string, number>}}
 */
export function defaultState() {
  return {
    version: 1,
    settings: { unit: 'kg', goal: 'standard', abs: false, lastBackupAt: null, setupDone: false, barWeight: barWeight('kg') },
    choices: {},
    sessions: [],
    draft: null,
    baselines: {},
    steps: {},
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

/** Stored steps that are usable (finite > 0), copied; anything else → {}. */
const validSteps = (raw) => (isObject(raw)
  ? Object.fromEntries(Object.entries(raw).filter(([, v]) => isValidStep(v)))
  : {});

/**
 * Fill a partially stored state with defaults (give id-less sessions an id, drop unusable baselines and steps;
 * a missing or unusable bar weight becomes the empty bar of the stored unit, 20 kg / 45 lb).
 * @param {unknown} raw
 * @returns {ReturnType<typeof defaultState>}
 */
export function migrate(raw) {
  const d = defaultState();
  if (!isObject(raw)) return d;
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.filter(isObject).map((s) => (s.id ? s : { ...s, id: newId() }))
    : [];
  const stored = isObject(raw.settings) ? raw.settings : {};
  const settings = { ...d.settings, ...stored };
  settings.barWeight = isValidBarWeight(stored.barWeight) ? stored.barWeight : barWeight(settings.unit);
  return {
    version: 1,
    settings,
    choices: isObject(raw.choices) ? { ...raw.choices } : {},
    sessions,
    draft: isObject(raw.draft) ? raw.draft : null,
    baselines: validBaselines(raw.baselines),
    steps: validSteps(raw.steps),
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
 * `baselineKey(exerciseId, role, occurrence)`. Invalid weight (not a finite number ≥ 0) → an equal copy of `state`.
 * @param {object} state
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @param {number} weight
 * @param {string} today ISO date, stored as `setOn`
 * @param {number} [occurrence] which track (0 = the first entry of the exercise in a workout)
 * @returns {object} new state
 */
export function setBaseline(state, exerciseId, role, weight, today, occurrence = 0) {
  if (!isBaselineWeight(weight)) return { ...state };
  const baselines = { ...(isObject(state.baselines) ? state.baselines : {}), [baselineKey(exerciseId, role, occurrence)]: { weight, setOn: today } };
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
 * @param {number} [occurrence]
 * @returns {object} new state
 */
export function clearBaseline(state, exerciseId, role, occurrence = 0) {
  return withoutBaselines(state, [baselineKey(exerciseId, role, occurrence)]);
}

/**
 * Use up the set weights of a just-saved workout: every entry with at least one set of `reps > 0`
 * removes the baseline of its track (role from `roleOf(session.day, exerciseId)`, occurrence from the entry's
 * place among the session's entries of that exercise). Other baselines stay.
 * @param {object} state
 * @param {{day: string, entries: Array<{exerciseId: string, sets: Array<{reps: number}>}>}} session
 * @returns {object} new state
 */
export function consumeBaselines(state, session) {
  const entries = session.entries || [];
  const occ = occurrencesOf(entries);
  const keys = entries.flatMap((e, i) => ((e.sets || []).some((st) => st.reps > 0)
    ? [baselineKey(e.exerciseId, roleOf(session.day, e.exerciseId), occ[i])] : []));
  return withoutBaselines(state, keys);
}

/**
 * Set the user's own weight step for an exercise (both roles; §17.2). Invalid step (not a finite number > 0)
 * → an equal copy of `state`.
 * @param {object} state
 * @param {string} exerciseId
 * @param {number} step in the user's unit
 * @returns {object} new state
 */
export function setStep(state, exerciseId, step) {
  if (!isValidStep(step)) return { ...state };
  return { ...state, steps: { ...(isObject(state.steps) ? state.steps : {}), [exerciseId]: step } };
}

/**
 * Remove the user's step for an exercise, so the default applies again (an equal copy when none is set).
 * @param {object} state
 * @param {string} exerciseId
 * @returns {object} new state
 */
export function clearStep(state, exerciseId) {
  if (!isObject(state.steps) || !Object.hasOwn(state.steps, exerciseId)) return { ...state };
  const steps = { ...state.steps };
  delete steps[exerciseId];
  return { ...state, steps };
}

const convertSets = (sets, from, to) => (sets || []).map((st) => (
  typeof st.weight === 'number' ? { ...st, weight: convertWeight(st.weight, from, to) } : { ...st }
));

const convertBaselines = (baselines, from, to) => Object.fromEntries(
  Object.entries(baselines).map(([key, b]) => [key, { ...b, weight: convertWeight(b.weight, from, to) }]),
);

const convertSteps = (steps, from, to) => Object.fromEntries(
  Object.entries(steps).map(([id, step]) => [id, convertWeight(step, from, to)]),
);

/**
 * Convert every saved weight (sessions, the in-progress draft, set weights, the user's steps and the bar weight)
 * to `toUnit` and switch the unit setting. A state without `baselines`, `steps` or `settings.barWeight` gets
 * none added.
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
  const settings = { ...state.settings, unit: toUnit };
  if (typeof state.settings.barWeight === 'number') settings.barWeight = convertWeight(state.settings.barWeight, from, toUnit);
  const out = { ...state, settings, sessions, draft };
  if (isObject(state.baselines)) out.baselines = convertBaselines(state.baselines, from, toUnit);
  if (isObject(state.steps)) out.steps = convertSteps(state.steps, from, toUnit);
  return out;
}
