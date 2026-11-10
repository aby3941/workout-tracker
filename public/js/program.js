// The Metallicadpa PPL program: catalog, days, slots, goals, rotation and day detection.
// Single source of truth for program rules.

import { sortByDate } from './dates.js';

// ---------------------------------------------------------------- catalog

/** [id, display name, group, category, aliases] */
const CATALOG = [
  ['deadlift', 'Deadlift', 'pull', 'deadlift', ['dl', 'deads', 'conventional deadlift']],
  ['barbellRow', 'Barbell row', 'pull', 'upper', ['row', 'bb row', 'bent over row', 'bor', 'pendlay row', 'barbell bent over row']],
  ['bench', 'Bench press', 'push', 'upper', ['bench', 'bp', 'flat bench', 'flat bench press', 'barbell bench press']],
  ['ohp', 'Overhead press', 'push', 'upper', ['press', 'military press', 'shoulder press', 'standing press', 'ohp']],
  ['squat', 'Squat', 'legs', 'lower', ['sq', 'back squat', 'barbell squat']],
  ['latPulldown', 'Lat pulldown', 'pull', 'accessory', ['pulldown', 'pull down', 'lat pull down', 'lpd']],
  ['pullUp', 'Pull-up', 'pull', 'accessory', ['pullup', 'pull up']],
  ['chinUp', 'Chin-up', 'pull', 'accessory', ['chinup', 'chin up']],
  ['cableRow', 'Seated cable row', 'pull', 'accessory', ['cable row', 'seated row']],
  ['chestSupportedRow', 'Chest-supported row', 'pull', 'accessory', ['chest supported row', 'cs row']],
  ['dbRow', 'Dumbbell row', 'pull', 'accessory', ['db row', 'one arm row']],
  ['tbarRow', 'T-bar row', 'pull', 'accessory', ['t bar row', 'tbar row']],
  ['facePull', 'Face pull', 'pull', 'accessory', ['facepull', 'fp']],
  ['rearDeltFly', 'Rear delt fly', 'pull', 'accessory', ['rear delt flye', 'reverse fly']],
  ['bandPullApart', 'Band pull-apart', 'pull', 'accessory', ['pull apart']],
  ['hammerCurl', 'Hammer curl', 'pull', 'accessory', ['hammers']],
  ['dbCurl', 'Dumbbell curl', 'pull', 'accessory', ['db curl', 'curl', 'bicep curl', 'biceps curl']],
  ['barbellCurl', 'Barbell curl', 'pull', 'accessory', ['bb curl']],
  ['ezCurl', 'EZ-bar curl', 'pull', 'accessory', ['ez curl', 'ez bar curl']],
  ['cableCurl', 'Cable curl', 'pull', 'accessory', []],
  ['preacherCurl', 'Preacher curl', 'pull', 'accessory', []],
  ['inclineCurl', 'Incline dumbbell curl', 'pull', 'accessory', ['incline curl', 'incline db curl']],
  ['concentrationCurl', 'Concentration curl', 'pull', 'accessory', []],
  ['inclineDbPress', 'Incline dumbbell press', 'push', 'accessory', ['incline db press', 'incline press', 'incline']],
  ['landminePress', 'Landmine press', 'push', 'accessory', ['landmine']],
  ['tricepsPushdown', 'Triceps pushdown', 'push', 'accessory', ['pushdown', 'push down', 'tricep pushdown', 'rope pushdown']],
  ['ohTricepsExt', 'Overhead triceps extension', 'push', 'accessory', ['overhead tricep extension', 'overhead extension', 'oh extension', 'oh ext']],
  ['skullcrusher', 'Skullcrusher', 'push', 'accessory', ['skull crusher']],
  ['lyingTricepsExt', 'Lying triceps extension', 'push', 'accessory', ['lying tricep extension']],
  ['dbTricepsExt', 'Dumbbell triceps extension', 'push', 'accessory', ['db triceps extension', 'db tricep extension']],
  ['lateralRaise', 'Lateral raise', 'push', 'accessory', ['lat raise', 'laterals', 'side raise']],
  ['frontRaise', 'Front raise', 'push', 'accessory', ['front raises']],
  ['rdl', 'Romanian deadlift', 'legs', 'accessory', ['rdl', 'romanian']],
  ['legPress', 'Leg press', 'legs', 'accessory', ['lp']],
  ['frontSquat', 'Front squat', 'legs', 'accessory', ['fs']],
  ['legCurl', 'Leg curl', 'legs', 'accessory', ['hamstring curl', 'lying leg curl', 'seated leg curl']],
  ['ghr', 'Glute-ham raise', 'legs', 'accessory', ['ghr', 'glute ham raise']],
  ['calfRaise', 'Calf raise', 'legs', 'accessory', ['calves', 'calf', 'standing calf raise']],
  ['seatedCalfRaise', 'Seated calf raise', 'legs', 'accessory', []],
  ['legPressCalfRaise', 'Leg press calf raise', 'legs', 'accessory', []],
  ['abWheel', 'Ab wheel rollout', 'abs', 'accessory', ['ab wheel', 'rollout', 'ab rollout']],
  ['plank', 'Plank', 'abs', 'accessory', []],
  ['hangingLegRaise', 'Hanging leg raise', 'abs', 'accessory', ['hlr', 'leg raise', 'leg raises']],
];

/** Exercise catalog keyed by id → {id, name, group, category, aliases}. */
export const EXERCISES = Object.freeze(Object.fromEntries(
  CATALOG.map(([id, name, group, category, aliases]) => [id, Object.freeze({ id, name, group, category, aliases: Object.freeze([...aliases]) })]),
));

// ---------------------------------------------------------------- program rules

/** Target reps on every main-lift set (the last set is AMRAP, "5+"). */
export const MAIN_REPS = 5;

/** Rest guidance by role. */
export const REST = Object.freeze({ main: '3–5 min', accessory: '1–3 min' });

/** Consecutive misses at the same weight before a deload. */
export const MISSES_BEFORE_DELOAD = 3;

/** Deload multiplier (take 10% off). */
export const DELOAD_FACTOR = 0.9;

/** Warm-up ramp from the post: after the empty bar × 10, these fractions of the work weight. */
export const WARMUP_RAMP = Object.freeze([
  { fraction: 0.5, reps: 10 },
  { fraction: 0.7, reps: 5 },
  { fraction: 0.9, reps: 3 },
]);

/** Reps on the empty-bar warm-up set. */
export const WARMUP_BAR_REPS = 10;

/** Main lifts in the order the Progress tab shows them. */
export const MAIN_LIFTS = Object.freeze(['squat', 'bench', 'deadlift', 'ohp', 'barbellRow']);

// ---------------------------------------------------------------- days and slots

/** Day ids in program order. */
export const DAY_ORDER = Object.freeze(['pullA', 'pushA', 'legs', 'pullB', 'pushB']);

/** The 6-workout cycle (legs twice). */
export const ROTATION = Object.freeze(['pullA', 'pushA', 'legs', 'pullB', 'pushB', 'legs']);

const PULL_SLOTS = ['pull.vertical', 'pull.row', 'pull.rear', 'pull.curl1', 'pull.curl2'];
const PUSH_TAIL = ['push.incline', 'push.tri1', 'push.side1', 'push.tri2', 'push.side2'];
const LEGS_SLOTS = ['legs.hinge', 'legs.quad', 'legs.ham', 'legs.calf'];

/** The abs add-on slots (appended when the Plan's abs toggle is on). */
export const ABS_SLOTS = Object.freeze(['abs.1', 'abs.2']);

/** Days that get the abs add-on ("ab work on your deadlift days and your squat days"). */
export const ABS_DAYS = Object.freeze(['pullA', 'legs']);

/** Workout days: {id, name, type, main, mainSets, slots}. Abs add-on slots are not listed here. */
export const DAYS = Object.freeze({
  pullA: Object.freeze({ id: 'pullA', name: 'Pull A', type: 'pull', main: 'deadlift', mainSets: 1, slots: Object.freeze([...PULL_SLOTS]) }),
  pushA: Object.freeze({ id: 'pushA', name: 'Push A', type: 'push', main: 'bench', mainSets: 5, slots: Object.freeze(['pushA.press', ...PUSH_TAIL]) }),
  legs: Object.freeze({ id: 'legs', name: 'Legs', type: 'legs', main: 'squat', mainSets: 3, slots: Object.freeze([...LEGS_SLOTS]) }),
  pullB: Object.freeze({ id: 'pullB', name: 'Pull B', type: 'pull', main: 'barbellRow', mainSets: 5, slots: Object.freeze([...PULL_SLOTS]) }),
  pushB: Object.freeze({ id: 'pushB', name: 'Push B', type: 'push', main: 'ohp', mainSets: 5, slots: Object.freeze(['pushB.press', ...PUSH_TAIL]) }),
});

/** Single-exercise options from a list of exercise ids (default first). */
const singles = (ids) => ids.map((id) => ({ id, label: EXERCISES[id].name, exercises: [id] }));

const CURLS = ['hammerCurl', 'dbCurl', 'barbellCurl', 'ezCurl', 'cableCurl', 'preacherCurl', 'inclineCurl', 'concentrationCurl'];
const TRICEPS = ['tricepsPushdown', 'ohTricepsExt', 'skullcrusher', 'lyingTricepsExt', 'dbTricepsExt'];
const SIDE_DELTS = ['lateralRaise', 'frontRaise'];

/** `ids` with `first` moved to the front. */
const withFirst = (first, ids) => [first, ...ids.filter((id) => id !== first)];

function slot(key, label, sets, repsMin, repsMax, compound, swappable, optionList, supersetWith = null) {
  return Object.freeze({
    key, label, sets, repsMin, repsMax, compound, swappable,
    options: Object.freeze(optionList.map((o) => Object.freeze({ ...o, exercises: Object.freeze([...o.exercises]) }))),
    supersetWith,
  });
}

/** Accessory slots keyed by slotKey. */
export const SLOTS = Object.freeze({
  'pull.vertical': slot('pull.vertical', 'Vertical pull', 3, 8, 12, true, true, singles(['latPulldown', 'pullUp', 'chinUp'])),
  'pull.row': slot('pull.row', 'Row', 3, 8, 12, true, true, singles(['cableRow', 'chestSupportedRow', 'dbRow', 'tbarRow'])),
  'pull.rear': slot('pull.rear', 'Rear delts', 5, 15, 20, false, true, [
    ...singles(['facePull']),
    { id: 'rearDeltFly+bandPullApart', label: 'Rear delt fly + Band pull-apart', exercises: ['rearDeltFly', 'bandPullApart'] },
  ]),
  'pull.curl1': slot('pull.curl1', 'Curl', 4, 8, 12, false, true, singles(CURLS)),
  'pull.curl2': slot('pull.curl2', 'Curl', 4, 8, 12, false, true, singles(withFirst('dbCurl', CURLS))),
  'pushA.press': slot('pushA.press', 'Overhead press', 3, 8, 12, true, false, singles(['ohp'])),
  'pushB.press': slot('pushB.press', 'Bench press', 3, 8, 12, true, false, singles(['bench'])),
  'push.incline': slot('push.incline', 'Incline press', 3, 8, 12, true, true, singles(['inclineDbPress', 'landminePress'])),
  'push.tri1': slot('push.tri1', 'Triceps', 3, 8, 12, false, true, singles(TRICEPS), 'push.side1'),
  'push.side1': slot('push.side1', 'Side delts', 3, 15, 20, false, true, singles(SIDE_DELTS), 'push.tri1'),
  'push.tri2': slot('push.tri2', 'Triceps', 3, 8, 12, false, true, singles(withFirst('ohTricepsExt', TRICEPS)), 'push.side2'),
  'push.side2': slot('push.side2', 'Side delts', 3, 15, 20, false, true, singles(SIDE_DELTS), 'push.tri2'),
  'legs.hinge': slot('legs.hinge', 'Hinge', 3, 8, 12, true, true, singles(['rdl'])),
  'legs.quad': slot('legs.quad', 'Quads', 3, 8, 12, true, true, singles(['legPress', 'frontSquat'])),
  'legs.ham': slot('legs.ham', 'Hamstrings', 3, 8, 12, false, true, singles(['legCurl', 'ghr'])),
  'legs.calf': slot('legs.calf', 'Calves', 5, 8, 12, false, true, singles(['calfRaise', 'seatedCalfRaise', 'legPressCalfRaise'])),
  'abs.1': slot('abs.1', 'Abs', 3, null, null, false, true, singles(['abWheel', 'plank'])),
  'abs.2': slot('abs.2', 'Abs', 3, null, null, false, true, singles(['hangingLegRaise', 'plank', 'abWheel'])),
});

/** Training goals, applied to accessory slots only. */
export const GOALS = Object.freeze([
  { id: 'standard', label: 'Standard', description: 'The program as written.' },
  { id: 'strength', label: 'Strength', description: 'Compound accessories become 3×4–6; isolation work unchanged.' },
  { id: 'endurance', label: 'Endurance', description: 'Every accessory becomes 15–20 reps; sets unchanged.' },
  { id: 'cut', label: 'Cutting', description: 'One set fewer on every accessory with 3 or more sets.' },
]);

// ---------------------------------------------------------------- names

/**
 * Lowercase, every run of non-alphanumerics → one space, trimmed. Letters and digits of any
 * script count as alphanumerics (with their combining marks), so "Жим гантелей" keeps its own id.
 * @param {string} str
 * @returns {string}
 */
export function normalizeName(str) {
  return String(str ?? '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
}

const NAME_INDEX = (() => {
  const map = new Map();
  for (const ex of Object.values(EXERCISES)) {
    for (const n of [ex.name, ...ex.aliases]) {
      const key = normalizeName(n);
      if (!map.has(key)) map.set(key, ex.id);
    }
  }
  return map;
})();

/**
 * Catalog id for a typed name (display name or alias, whole-string after normalisation),
 * retrying once with a trailing "s" removed from the last word. Unknown → null.
 * @param {string} name
 * @returns {string|null}
 */
export function matchExercise(name) {
  const n = normalizeName(name);
  if (!n) return null;
  if (NAME_INDEX.has(n)) return NAME_INDEX.get(n);
  if (n.length > 1 && n.endsWith('s')) {
    const single = n.slice(0, -1);
    if (NAME_INDEX.has(single)) return NAME_INDEX.get(single);
  }
  return null;
}

/**
 * Id for a custom (non-catalog) exercise.
 * @param {string} name
 * @returns {string}
 */
export function customId(name) {
  return 'custom:' + normalizeName(name);
}

/**
 * True for custom exercise ids.
 * @param {string} id
 * @returns {boolean}
 */
export function isCustom(id) {
  return String(id ?? '').startsWith('custom:');
}

/**
 * Display name: the catalog name, or `fallbackName` for custom ids.
 * @param {string} exerciseId
 * @param {string} [fallbackName]
 * @returns {string}
 */
export function exerciseName(exerciseId, fallbackName) {
  const ex = EXERCISES[exerciseId];
  if (ex) return ex.name;
  if (fallbackName) return fallbackName;
  return isCustom(exerciseId) ? String(exerciseId).slice('custom:'.length) : String(exerciseId ?? '');
}

// ---------------------------------------------------------------- roles

/**
 * 'main' when the exercise is that day's main lift, else 'accessory'.
 * @param {string} dayId
 * @param {string} exerciseId
 * @returns {'main'|'accessory'}
 */
export function roleOf(dayId, exerciseId) {
  return DAYS[dayId] && DAYS[dayId].main === exerciseId ? 'main' : 'accessory';
}

/**
 * Planned main-lift sets for a main lift (1 deadlift, 3 squat, 5 others), else null.
 * @param {string} exerciseId
 * @returns {number|null}
 */
export function mainSetsFor(exerciseId) {
  const day = Object.values(DAYS).find((d) => d.main === exerciseId);
  return day ? day.mainSets : null;
}

/**
 * Increment category by role: a main-role entry uses its lift's category; anything else is 'accessory'.
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @returns {string}
 */
export function incrementCategory(exerciseId, role) {
  return role === 'main' && EXERCISES[exerciseId] ? EXERCISES[exerciseId].category : 'accessory';
}

// ---------------------------------------------------------------- prescriptions (display)

/**
 * Main-lift prescription text: 1 → "1×5+", 3 → "2×5, 1×5+", 5 → "4×5, 1×5+".
 * @param {number} sets
 * @returns {string}
 */
export function mainPrescription(sets) {
  return sets > 1 ? `${sets - 1}×${MAIN_REPS}, 1×${MAIN_REPS}+` : `1×${MAIN_REPS}+`;
}

/**
 * Accessory prescription text: "3×8–12", or "3 sets" when there is no rep target.
 * @param {{sets: number, repsMin: number|null, repsMax: number|null}} rx
 * @returns {string}
 */
export function accessoryPrescription(rx) {
  if (rx.repsMin == null) return `${rx.sets} sets`;
  return rx.repsMin === rx.repsMax ? `${rx.sets}×${rx.repsMin}` : `${rx.sets}×${rx.repsMin}–${rx.repsMax}`;
}

// ---------------------------------------------------------------- day plan

function applyGoal(s, goal) {
  const rx = { sets: s.sets, repsMin: s.repsMin, repsMax: s.repsMax };
  if (ABS_SLOTS.includes(s.key)) return rx;
  if (goal === 'strength' && s.compound) return { sets: 3, repsMin: 4, repsMax: 6 };
  if (goal === 'endurance') return { ...rx, repsMin: 15, repsMax: 20 };
  if (goal === 'cut' && rx.sets >= 3) return { ...rx, sets: rx.sets - 1 };
  return rx;
}

/**
 * Resolve a slot choice to [{exerciseId, name}] (one, or two for a combo option). A custom name that
 * matches a catalog exercise other than a main lift becomes that exercise (one history per real exercise);
 * a main-lift name or an unknown name stays custom, so an accessory swap never counts as a main-lift session.
 */
function resolveSlot(s, choice) {
  if (s.swappable && typeof choice === 'string' && isCustom(choice)) {
    const name = choice.slice('custom:'.length).trim();
    if (name) {
      const id = matchExercise(name);
      if (id && !MAIN_LIFTS.includes(id)) return [{ exerciseId: id, name: EXERCISES[id].name }];
      return [{ exerciseId: customId(name), name }];
    }
  }
  const option = (s.swappable && s.options.find((o) => o.id === choice)) || s.options[0];
  return option.exercises.map((id) => ({ exerciseId: id, name: EXERCISES[id].name }));
}

/**
 * Slot keys used on a day, including the abs add-on when enabled.
 * @param {string} dayId
 * @param {boolean} [abs]
 * @returns {string[]}
 */
export function daySlotKeys(dayId, abs = false) {
  const day = DAYS[dayId];
  if (!day) return [];
  return [...day.slots, ...(abs && ABS_DAYS.includes(dayId) ? ABS_SLOTS : [])];
}

/**
 * The resolved plan for a day after swaps, goal and the abs add-on.
 * @param {string} dayId
 * @param {{choices?: Object<string,string>, goal?: string, abs?: boolean}} [opts]
 * @returns {{day: string, main: {exerciseId: string, sets: number, reps: number},
 *   items: Array<{slotKey: string, exerciseId: string, name: string, sets: number, repsMin: number|null,
 *   repsMax: number|null, compound: boolean, swappable: boolean, supersetWith: string|null}>}}
 */
export function getDayPlan(dayId, { choices = {}, goal = 'standard', abs = false } = {}) {
  const day = DAYS[dayId];
  if (!day) throw new Error(`Unknown day: ${dayId}`);
  const keys = daySlotKeys(dayId, abs);
  const resolved = Object.fromEntries(keys.map((k) => [k, resolveSlot(SLOTS[k], (choices || {})[k])]));
  const items = [];
  for (const key of keys) {
    const s = SLOTS[key];
    const rx = applyGoal(s, goal);
    const exercises = resolved[key];
    exercises.forEach((ex, i) => {
      let supersetWith = null;
      if (exercises.length > 1) supersetWith = exercises[(i + 1) % exercises.length].exerciseId;
      else if (s.supersetWith && resolved[s.supersetWith]) supersetWith = resolved[s.supersetWith][0].exerciseId;
      items.push({
        slotKey: key, exerciseId: ex.exerciseId, name: ex.name,
        sets: rx.sets, repsMin: rx.repsMin, repsMax: rx.repsMax,
        compound: s.compound, swappable: s.swappable, supersetWith,
      });
    });
  }
  return { day: dayId, main: { exerciseId: day.main, sets: day.mainSets, reps: MAIN_REPS }, items };
}

// ---------------------------------------------------------------- rotation

const latestNonLegs = (sorted) => {
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].day !== 'legs') return sorted[i].day;
  return null;
};

const FIRST_HALF = ['pullA', 'pushA'];
const SECOND_HALF = ['pullB', 'pushB'];

/**
 * The next workout after the last logged one (driven by the log, never the calendar).
 * @param {Array<{date: string, day: string}>} sessions
 * @returns {string} dayId
 */
export function nextDay(sessions) {
  const sorted = sortByDate(sessions);
  if (!sorted.length) return 'pullA';
  const last = sorted[sorted.length - 1].day;
  if (last === 'pullA') return 'pushA';
  if (last === 'pushA') return 'legs';
  if (last === 'pullB') return 'pushB';
  if (last === 'pushB') return 'legs';
  if (last === 'legs') return FIRST_HALF.includes(latestNonLegs(sorted)) ? 'pullB' : 'pullA';
  return 'pullA';
}

/**
 * Day number 1–6 of a workout in the cycle, given the sessions logged before it.
 * Legs is Day 3 after pullA/pushA (or with nothing before), Day 6 after pullB/pushB.
 * @param {string} dayId
 * @param {Array<{date: string, day: string}>} sessionsBefore
 * @returns {number}
 */
export function cyclePosition(dayId, sessionsBefore) {
  if (dayId !== 'legs') return ROTATION.indexOf(dayId) + 1;
  return SECOND_HALF.includes(latestNonLegs(sortByDate(sessionsBefore))) ? 6 : 3;
}

/**
 * Next workout and its Day number.
 * @param {Array<{date: string, day: string}>} sessions
 * @returns {{dayId: string, position: number}}
 */
export function nextWorkout(sessions) {
  const dayId = nextDay(sessions);
  return { dayId, position: cyclePosition(dayId, sessions) };
}

// ---------------------------------------------------------------- day detection

/**
 * Read a workout type/variant and the off-day flag from free text ("Pull A", "push b (off)", "Leg day").
 * @param {string} text
 * @returns {{type: 'pull'|'push'|'legs'|null, variant: 'A'|'B'|null, offDay: boolean}}
 */
export function parseDayText(text) {
  const t = String(text ?? '').toLowerCase();
  const offRe = /\(\s*off(?:\s*day)?\s*\)|\boff\s*day\b|\bbad\s*day\b/;
  const offDay = offRe.test(t);
  const cleaned = t.replace(new RegExp(offRe.source, 'g'), ' ');
  const withVariant = /\b(pull|push)\s*-?\s*([ab])\b/.exec(cleaned);
  if (withVariant) return { type: withVariant[1], variant: withVariant[2].toUpperCase(), offDay };
  if (/\bpull/.test(cleaned)) return { type: 'pull', variant: null, offDay };
  if (/\bpush/.test(cleaned)) return { type: 'push', variant: null, offDay };
  if (/\blegs?\b/.test(cleaned)) return { type: 'legs', variant: null, offDay };
  return { type: null, variant: null, offDay };
}

/**
 * Day id from a stored day value: id or display name, any case ("pullA", "PULL A"). Unknown → null.
 * @param {string} text
 * @returns {string|null}
 */
export function dayFromName(text) {
  const n = normalizeName(text).replace(/ /g, '');
  const day = Object.values(DAYS).find((d) => d.id.toLowerCase() === n || normalizeName(d.name).replace(/ /g, '') === n);
  return day ? day.id : null;
}

/**
 * Decide the workout day from the header type/variant and the exercises logged.
 * @param {'pull'|'push'|'legs'|null} type
 * @param {'A'|'B'|null} variant
 * @param {string[]} exerciseIds
 * @returns {string|null}
 */
export function resolveDay(type, variant, exerciseIds) {
  const ids = exerciseIds || [];
  const v = variant ? String(variant).toUpperCase() : null;
  if (type === 'legs') return 'legs';
  if (type === 'pull') {
    if (v === 'A' || v === 'B') return 'pull' + v;
    if (ids.includes('deadlift')) return 'pullA';
    if (ids.includes('barbellRow')) return 'pullB';
    return 'pullA';
  }
  if (type === 'push') {
    if (v === 'A' || v === 'B') return 'push' + v;
    const b = ids.indexOf('bench');
    const o = ids.indexOf('ohp');
    if (b >= 0 && o >= 0) return b < o ? 'pushA' : 'pushB';
    if (o >= 0) return 'pushB';
    return 'pushA';
  }
  const groups = ids.map((id) => EXERCISES[id]?.group).filter((g) => g && g !== 'abs');
  if (!groups.length) return null;
  const counts = new Map();
  for (const g of groups) counts.set(g, (counts.get(g) || 0) + 1);
  const best = Math.max(...counts.values());
  const winner = groups.find((g) => counts.get(g) === best);
  return resolveDay(winner, null, ids);
}
