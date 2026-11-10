import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXERCISES, DAYS, DAY_ORDER, ROTATION, SLOTS, GOALS,
  normalizeName, matchExercise, customId, isCustom, exerciseName, roleOf, mainSetsFor,
  getDayPlan, nextDay, cyclePosition, nextWorkout, parseDayText, resolveDay,
} from '../public/js/program.js';
import { session, clone } from './_helpers.js';

// ---------------------------------------------------------------- fixtures from the spec

const CATALOG = [
  // id, display name, group, category
  ['deadlift', 'Deadlift', 'pull', 'deadlift'],
  ['barbellRow', 'Barbell row', 'pull', 'upper'],
  ['bench', 'Bench press', 'push', 'upper'],
  ['ohp', 'Overhead press', 'push', 'upper'],
  ['squat', 'Squat', 'legs', 'lower'],
  ['latPulldown', 'Lat pulldown', 'pull', 'accessory'],
  ['pullUp', 'Pull-up', 'pull', 'accessory'],
  ['chinUp', 'Chin-up', 'pull', 'accessory'],
  ['cableRow', 'Seated cable row', 'pull', 'accessory'],
  ['chestSupportedRow', 'Chest-supported row', 'pull', 'accessory'],
  ['dbRow', 'Dumbbell row', 'pull', 'accessory'],
  ['tbarRow', 'T-bar row', 'pull', 'accessory'],
  ['facePull', 'Face pull', 'pull', 'accessory'],
  ['rearDeltFly', 'Rear delt fly', 'pull', 'accessory'],
  ['bandPullApart', 'Band pull-apart', 'pull', 'accessory'],
  ['hammerCurl', 'Hammer curl', 'pull', 'accessory'],
  ['dbCurl', 'Dumbbell curl', 'pull', 'accessory'],
  ['barbellCurl', 'Barbell curl', 'pull', 'accessory'],
  ['ezCurl', 'EZ-bar curl', 'pull', 'accessory'],
  ['cableCurl', 'Cable curl', 'pull', 'accessory'],
  ['preacherCurl', 'Preacher curl', 'pull', 'accessory'],
  ['inclineCurl', 'Incline dumbbell curl', 'pull', 'accessory'],
  ['concentrationCurl', 'Concentration curl', 'pull', 'accessory'],
  ['inclineDbPress', 'Incline dumbbell press', 'push', 'accessory'],
  ['landminePress', 'Landmine press', 'push', 'accessory'],
  ['tricepsPushdown', 'Triceps pushdown', 'push', 'accessory'],
  ['ohTricepsExt', 'Overhead triceps extension', 'push', 'accessory'],
  ['skullcrusher', 'Skullcrusher', 'push', 'accessory'],
  ['lyingTricepsExt', 'Lying triceps extension', 'push', 'accessory'],
  ['dbTricepsExt', 'Dumbbell triceps extension', 'push', 'accessory'],
  ['lateralRaise', 'Lateral raise', 'push', 'accessory'],
  ['frontRaise', 'Front raise', 'push', 'accessory'],
  ['rdl', 'Romanian deadlift', 'legs', 'accessory'],
  ['legPress', 'Leg press', 'legs', 'accessory'],
  ['frontSquat', 'Front squat', 'legs', 'accessory'],
  ['legCurl', 'Leg curl', 'legs', 'accessory'],
  ['ghr', 'Glute-ham raise', 'legs', 'accessory'],
  ['calfRaise', 'Calf raise', 'legs', 'accessory'],
  ['seatedCalfRaise', 'Seated calf raise', 'legs', 'accessory'],
  ['legPressCalfRaise', 'Leg press calf raise', 'legs', 'accessory'],
  ['abWheel', 'Ab wheel rollout', 'abs', 'accessory'],
  ['plank', 'Plank', 'abs', 'accessory'],
  ['hangingLegRaise', 'Hanging leg raise', 'abs', 'accessory'],
];

const ALIASES = {
  deadlift: ['dl', 'deads', 'conventional deadlift'],
  barbellRow: ['row', 'bb row', 'bent over row', 'bor', 'pendlay row'],
  bench: ['bench', 'bp', 'flat bench'],
  ohp: ['press', 'military press', 'shoulder press', 'standing press'],
  squat: ['sq', 'back squat'],
  latPulldown: ['pulldown', 'pull down', 'lat pull down', 'lpd'],
  pullUp: ['pullup', 'pull up'],
  chinUp: ['chinup', 'chin up'],
  cableRow: ['cable row', 'seated row'],
  chestSupportedRow: ['chest supported row', 'cs row'],
  dbRow: ['db row', 'one arm row'],
  tbarRow: ['t bar row', 'tbar row'],
  facePull: ['facepull', 'fp'],
  rearDeltFly: ['rear delt flye', 'reverse fly'],
  bandPullApart: ['pull apart'],
  hammerCurl: ['hammers'],
  dbCurl: ['db curl', 'curl', 'bicep curl', 'biceps curl'],
  ezCurl: ['ez curl', 'ez bar curl'],
  inclineCurl: ['incline curl', 'incline db curl'],
  inclineDbPress: ['incline db press', 'incline press', 'incline'],
  landminePress: ['landmine'],
  tricepsPushdown: ['pushdown', 'push down', 'tricep pushdown', 'rope pushdown'],
  ohTricepsExt: ['overhead tricep extension', 'overhead extension', 'oh extension', 'oh ext'],
  skullcrusher: ['skull crusher'],
  lyingTricepsExt: ['lying tricep extension'],
  dbTricepsExt: ['db triceps extension', 'db tricep extension'],
  lateralRaise: ['lat raise', 'laterals', 'side raise'],
  frontRaise: ['front raises'],
  rdl: ['rdl', 'romanian'],
  legPress: ['lp'],
  frontSquat: ['fs'],
  legCurl: ['hamstring curl', 'lying leg curl', 'seated leg curl'],
  ghr: ['ghr', 'glute ham raise'],
  calfRaise: ['calves', 'calf', 'standing calf raise'],
  abWheel: ['ab wheel', 'rollout', 'ab rollout'],
  hangingLegRaise: ['hlr', 'leg raise', 'leg raises'],
};

const CURLS = ['hammerCurl', 'dbCurl', 'barbellCurl', 'ezCurl', 'cableCurl', 'preacherCurl', 'inclineCurl', 'concentrationCurl'];
const TRICEPS = ['tricepsPushdown', 'ohTricepsExt', 'skullcrusher', 'lyingTricepsExt', 'dbTricepsExt'];

// slotKey → expected definition. `options` = exact single-exercise option order;
// `first` + `all` = default first, remaining order unspecified.
const SLOT_SPEC = {
  'pull.vertical': { label: 'Vertical pull', sets: 3, repsMin: 8, repsMax: 12, compound: true, swappable: true, options: ['latPulldown', 'pullUp', 'chinUp'] },
  'pull.row': { label: 'Row', sets: 3, repsMin: 8, repsMax: 12, compound: true, swappable: true, options: ['cableRow', 'chestSupportedRow', 'dbRow', 'tbarRow'] },
  'pull.rear': { label: 'Rear delts', sets: 5, repsMin: 15, repsMax: 20, compound: false, swappable: true },
  'pull.curl1': { label: 'Curl', sets: 4, repsMin: 8, repsMax: 12, compound: false, swappable: true, options: CURLS },
  'pull.curl2': { label: 'Curl', sets: 4, repsMin: 8, repsMax: 12, compound: false, swappable: true, first: 'dbCurl', all: CURLS },
  'pushA.press': { label: 'Overhead press', sets: 3, repsMin: 8, repsMax: 12, compound: true, swappable: false, options: ['ohp'] },
  'pushB.press': { label: 'Bench press', sets: 3, repsMin: 8, repsMax: 12, compound: true, swappable: false, options: ['bench'] },
  'push.incline': { label: 'Incline press', sets: 3, repsMin: 8, repsMax: 12, compound: true, swappable: true, options: ['inclineDbPress', 'landminePress'] },
  'push.tri1': { label: 'Triceps', sets: 3, repsMin: 8, repsMax: 12, compound: false, swappable: true, options: TRICEPS, supersetWith: 'push.side1' },
  'push.side1': { label: 'Side delts', sets: 3, repsMin: 15, repsMax: 20, compound: false, swappable: true, options: ['lateralRaise', 'frontRaise'], supersetWith: 'push.tri1' },
  'push.tri2': { label: 'Triceps', sets: 3, repsMin: 8, repsMax: 12, compound: false, swappable: true, first: 'ohTricepsExt', all: TRICEPS, supersetWith: 'push.side2' },
  'push.side2': { label: 'Side delts', sets: 3, repsMin: 15, repsMax: 20, compound: false, swappable: true, options: ['lateralRaise', 'frontRaise'], supersetWith: 'push.tri2' },
  'legs.hinge': { label: 'Hinge', sets: 3, repsMin: 8, repsMax: 12, compound: true, swappable: true, options: ['rdl'] },
  'legs.quad': { label: 'Quads', sets: 3, repsMin: 8, repsMax: 12, compound: true, swappable: true, options: ['legPress', 'frontSquat'] },
  'legs.ham': { label: 'Hamstrings', sets: 3, repsMin: 8, repsMax: 12, compound: false, swappable: true, options: ['legCurl', 'ghr'] },
  'legs.calf': { label: 'Calves', sets: 5, repsMin: 8, repsMax: 12, compound: false, swappable: true, options: ['calfRaise', 'seatedCalfRaise', 'legPressCalfRaise'] },
  'abs.1': { sets: 3, repsMin: null, repsMax: null, options: ['abWheel', 'plank'] },
  'abs.2': { sets: 3, repsMin: null, repsMax: null, options: ['hangingLegRaise', 'plank', 'abWheel'] },
};

const PULL_SLOTS = ['pull.vertical', 'pull.row', 'pull.rear', 'pull.curl1', 'pull.curl2'];
const PUSH_TAIL = ['push.incline', 'push.tri1', 'push.side1', 'push.tri2', 'push.side2'];
const LEGS_SLOTS = ['legs.hinge', 'legs.quad', 'legs.ham', 'legs.calf'];

// ---------------------------------------------------------------- helpers

/** Options that name catalog exercises (ignores any "Custom…" placeholder the UI may add). */
const realOptions = (slotKey) =>
  SLOTS[slotKey].options.filter((o) => Array.isArray(o.exercises) && o.exercises.length > 0);

/** The option id whose exercises are exactly `exercises`. */
function optionId(slotKey, exercises) {
  const o = realOptions(slotKey).find((x) => JSON.stringify(x.exercises) === JSON.stringify(exercises));
  assert.ok(o, `no option ${exercises.join('+')} in ${slotKey}`);
  return o.id;
}

const planDayId = (plan) => (typeof plan.day === 'string' ? plan.day : plan.day && plan.day.id);
const itemOf = (plan, slotKey) => plan.items.find((i) => i.slotKey === slotKey);
const shape = (plan) => plan.items.map((i) => [i.slotKey, i.exerciseId, i.sets, i.repsMin, i.repsMax]);

const S = (date, day) => session(date, day);

// ---------------------------------------------------------------- catalog

describe('EXERCISES', () => {
  test('contains exactly the spec ids', () => {
    assert.deepEqual(Object.keys(EXERCISES).sort(), CATALOG.map(([id]) => id).sort());
  });

  test('each entry has id, display name, group, category and an aliases array', () => {
    for (const [id, name, group, category] of CATALOG) {
      const ex = EXERCISES[id];
      assert.equal(ex.id, id);
      assert.equal(ex.name, name, `${id} name`);
      assert.equal(ex.group, group, `${id} group`);
      assert.equal(ex.category, category, `${id} category`);
      assert.ok(Array.isArray(ex.aliases), `${id} aliases`);
    }
  });
});

describe('DAY_ORDER, ROTATION, DAYS, GOALS', () => {
  test('DAY_ORDER and ROTATION', () => {
    assert.deepEqual(DAY_ORDER, ['pullA', 'pushA', 'legs', 'pullB', 'pushB']);
    assert.deepEqual(ROTATION, ['pullA', 'pushA', 'legs', 'pullB', 'pushB', 'legs']);
  });

  test('DAYS: names, types, main lifts, planned main sets', () => {
    const expected = {
      pullA: ['Pull A', 'pull', 'deadlift', 1],
      pushA: ['Push A', 'push', 'bench', 5],
      legs: ['Legs', 'legs', 'squat', 3],
      pullB: ['Pull B', 'pull', 'barbellRow', 5],
      pushB: ['Push B', 'push', 'ohp', 5],
    };
    assert.deepEqual(Object.keys(DAYS).sort(), Object.keys(expected).sort());
    for (const [id, [name, type, main, mainSets]] of Object.entries(expected)) {
      assert.equal(DAYS[id].id, id);
      assert.equal(DAYS[id].name, name);
      assert.equal(DAYS[id].type, type);
      assert.equal(DAYS[id].main, main);
      assert.equal(DAYS[id].mainSets, mainSets);
    }
  });

  test('DAYS: accessory slot order (abs add-on slots, if listed, ignored here)', () => {
    const nonAbs = (id) => DAYS[id].slots.filter((k) => !k.startsWith('abs.'));
    assert.deepEqual(nonAbs('pullA'), PULL_SLOTS);
    assert.deepEqual(nonAbs('pullB'), PULL_SLOTS);
    assert.deepEqual(nonAbs('pushA'), ['pushA.press', ...PUSH_TAIL]);
    assert.deepEqual(nonAbs('pushB'), ['pushB.press', ...PUSH_TAIL]);
    assert.deepEqual(nonAbs('legs'), LEGS_SLOTS);
  });

  test('GOALS: ids in order, each with label and description', () => {
    assert.deepEqual(GOALS.map((g) => g.id), ['standard', 'strength', 'endurance', 'cut']);
    for (const g of GOALS) {
      assert.equal(typeof g.label, 'string');
      assert.ok(g.label.length > 0);
      assert.equal(typeof g.description, 'string');
      assert.ok(g.description.length > 0);
    }
  });
});

describe('SLOTS', () => {
  test('every spec slot exists with the right prescription', () => {
    for (const [key, spec] of Object.entries(SLOT_SPEC)) {
      const s = SLOTS[key];
      assert.ok(s, `slot ${key}`);
      assert.equal(s.key, key);
      for (const f of ['label', 'sets', 'repsMin', 'repsMax', 'compound', 'swappable']) {
        if (f in spec) assert.equal(s[f], spec[f], `${key}.${f}`);
      }
    }
  });

  test('options: default first, listed order, unique ids and labels', () => {
    for (const [key, spec] of Object.entries(SLOT_SPEC)) {
      const opts = realOptions(key);
      for (const o of opts) {
        assert.equal(typeof o.id, 'string');
        assert.equal(typeof o.label, 'string');
      }
      assert.equal(new Set(opts.map((o) => o.id)).size, opts.length, `${key} option ids unique`);
      if (spec.options) {
        assert.deepEqual(opts.map((o) => o.exercises), spec.options.map((id) => [id]), `${key} options`);
      }
      if (spec.first) {
        assert.deepEqual(opts[0].exercises, [spec.first], `${key} default`);
        assert.deepEqual(opts.map((o) => o.exercises[0]).sort(), [...spec.all].sort(), `${key} option set`);
      }
    }
  });

  test('pull.rear: Face pull default plus the Rear delt fly + Band pull-apart combo', () => {
    const opts = realOptions('pull.rear');
    assert.deepEqual(opts[0].exercises, ['facePull']);
    assert.ok(opts.some((o) => JSON.stringify(o.exercises) === JSON.stringify(['rearDeltFly', 'bandPullApart'])));
  });

  test('supersetWith pairs the triceps and side-delt slots', () => {
    assert.equal(SLOTS['push.tri1'].supersetWith, 'push.side1');
    assert.equal(SLOTS['push.side1'].supersetWith, 'push.tri1');
    assert.equal(SLOTS['push.tri2'].supersetWith, 'push.side2');
    assert.equal(SLOTS['push.side2'].supersetWith, 'push.tri2');
    for (const key of ['pull.vertical', 'pull.row', 'pull.curl1', 'pull.curl2', 'pushA.press', 'pushB.press', 'push.incline', ...LEGS_SLOTS]) {
      assert.equal(SLOTS[key].supersetWith, null, key);
    }
  });
});

// ---------------------------------------------------------------- names

describe('normalizeName', () => {
  test('lowercases, collapses non-alphanumerics to one space, trims', () => {
    assert.equal(normalizeName('T-Bar  Row!'), 't bar row');
    assert.equal(normalizeName('  Lat   Pulldown '), 'lat pulldown');
    assert.equal(normalizeName('EZ-Bar Curl'), 'ez bar curl');
    assert.equal(normalizeName('Pull-up'), 'pull up');
    assert.equal(normalizeName('face_pull'), 'face pull');
    assert.equal(normalizeName('45° Incline'), '45 incline');
    assert.equal(normalizeName('--Squat--'), 'squat');
    assert.equal(normalizeName(''), '');
  });

  test('non-ASCII letters are alphanumerics too, so different custom names get different ids (review fix)', () => {
    assert.equal(normalizeName('Жим гантелей'), 'жим гантелей');
    assert.equal(normalizeName('Rückenstrecker!'), 'rückenstrecker');
    assert.equal(normalizeName('डिप्स'), 'डिप्स');
    assert.equal(normalizeName('Café–curl'), 'café curl');
    assert.notEqual(customId('Жим гантелей'), customId('Тяга блока'));
    assert.notEqual(customId('Rücken'), customId('R cken'));
    assert.equal(matchExercise('Жим гантелей'), null);
  });
});

describe('matchExercise', () => {
  test('every display name matches its own id (any case/punctuation)', () => {
    for (const [id, name] of CATALOG) {
      assert.equal(matchExercise(name), id, name);
      assert.equal(matchExercise(name.toUpperCase()), id, name.toUpperCase());
    }
  });

  test('every spec alias matches', () => {
    for (const [id, aliases] of Object.entries(ALIASES)) {
      for (const a of aliases) assert.equal(matchExercise(a), id, a);
    }
    assert.equal(matchExercise('Bent-over row'), 'barbellRow');
    assert.equal(matchExercise('T bar row'), 'tbarRow');
    assert.equal(matchExercise('BENCH PRESS!'), 'bench');
    assert.equal(matchExercise('Chest supported row'), 'chestSupportedRow');
  });

  test('whole-string exact: no prefix/substring matching', () => {
    assert.equal(matchExercise('lat raise'), 'lateralRaise');
    assert.equal(matchExercise('lat pulldown'), 'latPulldown');
    assert.equal(matchExercise('dl'), 'deadlift');
    assert.equal(matchExercise('rdl'), 'rdl');
    assert.equal(matchExercise('romanian deadlift'), 'rdl');
    assert.equal(matchExercise('press'), 'ohp');
    assert.equal(matchExercise('leg press'), 'legPress');
    assert.equal(matchExercise('curl'), 'dbCurl');
    assert.equal(matchExercise('lat'), null);
    assert.equal(matchExercise('zercher squat'), null);
    assert.equal(matchExercise('shrugs'), null);
    assert.equal(matchExercise(''), null);
  });

  test('plural retry strips a trailing s from the last word', () => {
    assert.equal(matchExercise('face pulls'), 'facePull');
    assert.equal(matchExercise('rdls'), 'rdl');
    assert.equal(matchExercise('deadlifts'), 'deadlift');
    assert.equal(matchExercise('dls'), 'deadlift');
    assert.equal(matchExercise('Squats'), 'squat');
    assert.equal(matchExercise('Pull-ups'), 'pullUp');
    assert.equal(matchExercise('chin ups'), 'chinUp');
    assert.equal(matchExercise('Lat pulldowns'), 'latPulldown');
    assert.equal(matchExercise('Hammer curls'), 'hammerCurl');
    assert.equal(matchExercise('curls'), 'dbCurl');
    assert.equal(matchExercise('skullcrushers'), 'skullcrusher');
    assert.equal(matchExercise('Lateral raises'), 'lateralRaise');
    assert.equal(matchExercise('calf raises'), 'calfRaise');
    assert.equal(matchExercise('rows'), 'barbellRow');
    assert.equal(matchExercise('Ab wheel rollouts'), 'abWheel');
  });
});

describe('customId / isCustom / exerciseName', () => {
  test('customId normalises the name', () => {
    assert.equal(customId('Zercher Squat'), 'custom:zercher squat');
    assert.equal(customId('  Hip-Thrust! '), 'custom:hip thrust');
  });

  test('isCustom', () => {
    assert.equal(isCustom('custom:zercher squat'), true);
    assert.equal(isCustom(customId('Anything')), true);
    assert.equal(isCustom('bench'), false);
    assert.equal(isCustom('deadlift'), false);
  });

  test('exerciseName: catalog display name, fallback for custom ids', () => {
    assert.equal(exerciseName('bench'), 'Bench press');
    assert.equal(exerciseName('ezCurl'), 'EZ-bar curl');
    assert.equal(exerciseName('bench', 'whatever'), 'Bench press');
    assert.equal(exerciseName('custom:zercher squat', 'Zercher Squat'), 'Zercher Squat');
  });
});

// ---------------------------------------------------------------- roles

describe('roleOf / mainSetsFor', () => {
  test('main only on the day whose main lift it is', () => {
    assert.equal(roleOf('pushA', 'bench'), 'main');
    assert.equal(roleOf('pushB', 'bench'), 'accessory');
    assert.equal(roleOf('pushB', 'ohp'), 'main');
    assert.equal(roleOf('pushA', 'ohp'), 'accessory');
    assert.equal(roleOf('pullA', 'deadlift'), 'main');
    assert.equal(roleOf('pullB', 'deadlift'), 'accessory');
    assert.equal(roleOf('pullB', 'barbellRow'), 'main');
    assert.equal(roleOf('pullA', 'barbellRow'), 'accessory');
    assert.equal(roleOf('legs', 'squat'), 'main');
    assert.equal(roleOf('legs', 'rdl'), 'accessory');
    assert.equal(roleOf('pullA', 'latPulldown'), 'accessory');
    assert.equal(roleOf('pushA', 'custom:zercher squat'), 'accessory');
  });

  test('mainSetsFor', () => {
    assert.equal(mainSetsFor('deadlift'), 1);
    assert.equal(mainSetsFor('squat'), 3);
    assert.equal(mainSetsFor('bench'), 5);
    assert.equal(mainSetsFor('ohp'), 5);
    assert.equal(mainSetsFor('barbellRow'), 5);
    assert.equal(mainSetsFor('latPulldown'), null);
    assert.equal(mainSetsFor('custom:zercher squat'), null);
  });
});

// ---------------------------------------------------------------- getDayPlan

describe('getDayPlan: defaults', () => {
  test('pullA: deadlift 1×5, pull slots in order with default exercises', () => {
    const plan = getDayPlan('pullA');
    assert.equal(planDayId(plan), 'pullA');
    assert.equal(plan.main.exerciseId, 'deadlift');
    assert.equal(plan.main.sets, 1);
    assert.equal(plan.main.reps, 5);
    assert.deepEqual(shape(plan), [
      ['pull.vertical', 'latPulldown', 3, 8, 12],
      ['pull.row', 'cableRow', 3, 8, 12],
      ['pull.rear', 'facePull', 5, 15, 20],
      ['pull.curl1', 'hammerCurl', 4, 8, 12],
      ['pull.curl2', 'dbCurl', 4, 8, 12],
    ]);
    assert.deepEqual(plan.items.map((i) => i.name), ['Lat pulldown', 'Seated cable row', 'Face pull', 'Hammer curl', 'Dumbbell curl']);
    assert.deepEqual(plan.items.map((i) => i.compound), [true, true, false, false, false]);
    assert.ok(plan.items.every((i) => i.swappable === true));
    assert.ok(plan.items.every((i) => i.supersetWith === null));
  });

  test('pullB: barbell row 5×5, same pull slots', () => {
    const plan = getDayPlan('pullB');
    assert.equal(planDayId(plan), 'pullB');
    assert.equal(plan.main.exerciseId, 'barbellRow');
    assert.equal(plan.main.sets, 5);
    assert.equal(plan.main.reps, 5);
    assert.deepEqual(plan.items.map((i) => i.exerciseId), ['latPulldown', 'cableRow', 'facePull', 'hammerCurl', 'dbCurl']);
  });

  test('pushA: bench main, then OHP 3×8–12 (fixed), incline, triceps/side-delt supersets', () => {
    const plan = getDayPlan('pushA');
    assert.equal(plan.main.exerciseId, 'bench');
    assert.equal(plan.main.sets, 5);
    assert.deepEqual(shape(plan), [
      ['pushA.press', 'ohp', 3, 8, 12],
      ['push.incline', 'inclineDbPress', 3, 8, 12],
      ['push.tri1', 'tricepsPushdown', 3, 8, 12],
      ['push.side1', 'lateralRaise', 3, 15, 20],
      ['push.tri2', 'ohTricepsExt', 3, 8, 12],
      ['push.side2', 'lateralRaise', 3, 15, 20],
    ]);
    assert.deepEqual(plan.items.map((i) => i.swappable), [false, true, true, true, true, true]);
    assert.deepEqual(plan.items.map((i) => i.compound), [true, true, false, false, false, false]);
    assert.deepEqual(plan.items.map((i) => i.supersetWith), [null, null, 'lateralRaise', 'tricepsPushdown', 'lateralRaise', 'ohTricepsExt']);
  });

  test('pushB: OHP main, then bench 3×8–12 (fixed), then the same push slots', () => {
    const plan = getDayPlan('pushB');
    assert.equal(plan.main.exerciseId, 'ohp');
    assert.equal(plan.main.sets, 5);
    assert.deepEqual(plan.items.map((i) => i.slotKey), ['pushB.press', ...PUSH_TAIL]);
    assert.deepEqual(plan.items.map((i) => i.exerciseId), ['bench', 'inclineDbPress', 'tricepsPushdown', 'lateralRaise', 'ohTricepsExt', 'lateralRaise']);
    assert.equal(plan.items[0].swappable, false);
  });

  test('legs: squat 3×5, hinge/quad/ham/calf', () => {
    const plan = getDayPlan('legs');
    assert.equal(plan.main.exerciseId, 'squat');
    assert.equal(plan.main.sets, 3);
    assert.equal(plan.main.reps, 5);
    assert.deepEqual(shape(plan), [
      ['legs.hinge', 'rdl', 3, 8, 12],
      ['legs.quad', 'legPress', 3, 8, 12],
      ['legs.ham', 'legCurl', 3, 8, 12],
      ['legs.calf', 'calfRaise', 5, 8, 12],
    ]);
    assert.deepEqual(plan.items.map((i) => i.compound), [true, true, false, false]);
  });
});

describe('getDayPlan: choices', () => {
  test('an option id swaps the exercise; display name follows', () => {
    const plan = getDayPlan('pullA', { choices: { 'pull.vertical': optionId('pull.vertical', ['chinUp']) } });
    const item = itemOf(plan, 'pull.vertical');
    assert.equal(item.exerciseId, 'chinUp');
    assert.equal(item.name, 'Chin-up');
    assert.equal(item.sets, 3);
  });

  test('missing or unknown choice → default option', () => {
    assert.equal(itemOf(getDayPlan('pullA', { choices: {} }), 'pull.vertical').exerciseId, 'latPulldown');
    assert.equal(itemOf(getDayPlan('pullA', { choices: { 'pull.vertical': 'no-such-option' } }), 'pull.vertical').exerciseId, 'latPulldown');
  });

  test('shared slot keys: a pull choice applies to pullA and pullB, a push choice to pushA and pushB', () => {
    const choices = {
      'pull.row': optionId('pull.row', ['tbarRow']),
      'push.incline': optionId('push.incline', ['landminePress']),
    };
    assert.equal(itemOf(getDayPlan('pullA', { choices }), 'pull.row').exerciseId, 'tbarRow');
    assert.equal(itemOf(getDayPlan('pullB', { choices }), 'pull.row').exerciseId, 'tbarRow');
    assert.equal(itemOf(getDayPlan('pushA', { choices }), 'push.incline').exerciseId, 'landminePress');
    assert.equal(itemOf(getDayPlan('pushB', { choices }), 'push.incline').exerciseId, 'landminePress');
  });

  test('swapping a superset partner updates the other item\'s supersetWith', () => {
    const plan = getDayPlan('pushA', { choices: { 'push.side1': optionId('push.side1', ['frontRaise']) } });
    assert.equal(itemOf(plan, 'push.side1').exerciseId, 'frontRaise');
    assert.equal(itemOf(plan, 'push.tri1').supersetWith, 'frontRaise');
    assert.equal(itemOf(plan, 'push.side1').supersetWith, 'tricepsPushdown');
    assert.equal(itemOf(plan, 'push.tri2').supersetWith, 'lateralRaise');
  });

  test('combo option → two items in the same slot, supersetted with each other', () => {
    const combo = optionId('pull.rear', ['rearDeltFly', 'bandPullApart']);
    const plan = getDayPlan('pullA', { choices: { 'pull.rear': combo } });
    assert.deepEqual(plan.items.map((i) => i.slotKey), ['pull.vertical', 'pull.row', 'pull.rear', 'pull.rear', 'pull.curl1', 'pull.curl2']);
    const rear = plan.items.filter((i) => i.slotKey === 'pull.rear');
    assert.deepEqual(rear.map((i) => i.exerciseId).sort(), ['bandPullApart', 'rearDeltFly']);
    const [a, b] = rear;
    assert.equal(a.supersetWith, b.exerciseId);
    assert.equal(b.supersetWith, a.exerciseId);
    for (const i of rear) {
      assert.equal(i.sets, 5);
      assert.equal(i.repsMin, 15);
      assert.equal(i.repsMax, 20);
    }
    assert.deepEqual(rear.map((i) => i.name).sort(), ['Band pull-apart', 'Rear delt fly']);
  });

  test('custom choice → customId(displayName) and the display name', () => {
    const plan = getDayPlan('pullA', { choices: { 'pull.vertical': 'custom:Assisted Pull-up' } });
    const item = itemOf(plan, 'pull.vertical');
    assert.equal(item.exerciseId, 'custom:assisted pull up');
    assert.equal(item.exerciseId, customId('Assisted Pull-up'));
    assert.equal(item.name, 'Assisted Pull-up');
    assert.equal(item.sets, 3);
    assert.equal(item.repsMin, 8);
    assert.equal(item.repsMax, 12);
  });

  test('custom choice in a superset slot is what the partner points at', () => {
    const plan = getDayPlan('pushA', { choices: { 'push.side2': 'custom:Cable Y-raise' } });
    assert.equal(itemOf(plan, 'push.side2').exerciseId, 'custom:cable y raise');
    assert.equal(itemOf(plan, 'push.tri2').supersetWith, 'custom:cable y raise');
  });
});

describe('getDayPlan: goals', () => {
  test('standard is the default', () => {
    assert.deepEqual(shape(getDayPlan('pullA', { goal: 'standard' })), shape(getDayPlan('pullA')));
  });

  test('strength: compound slots become 3×4–6; isolation and main unchanged', () => {
    const pull = getDayPlan('pullA', { goal: 'strength' });
    assert.deepEqual(shape(pull), [
      ['pull.vertical', 'latPulldown', 3, 4, 6],
      ['pull.row', 'cableRow', 3, 4, 6],
      ['pull.rear', 'facePull', 5, 15, 20],
      ['pull.curl1', 'hammerCurl', 4, 8, 12],
      ['pull.curl2', 'dbCurl', 4, 8, 12],
    ]);
    assert.equal(pull.main.sets, 1);
    assert.equal(pull.main.reps, 5);

    const push = getDayPlan('pushA', { goal: 'strength' });
    assert.deepEqual(shape(push).slice(0, 3), [
      ['pushA.press', 'ohp', 3, 4, 6],
      ['push.incline', 'inclineDbPress', 3, 4, 6],
      ['push.tri1', 'tricepsPushdown', 3, 8, 12],
    ]);
    assert.equal(push.main.sets, 5);

    assert.deepEqual(shape(getDayPlan('legs', { goal: 'strength' })), [
      ['legs.hinge', 'rdl', 3, 4, 6],
      ['legs.quad', 'legPress', 3, 4, 6],
      ['legs.ham', 'legCurl', 3, 8, 12],
      ['legs.calf', 'calfRaise', 5, 8, 12],
    ]);
  });

  test('endurance: every accessory slot 15–20 reps, sets unchanged', () => {
    assert.deepEqual(shape(getDayPlan('pullA', { goal: 'endurance' })), [
      ['pull.vertical', 'latPulldown', 3, 15, 20],
      ['pull.row', 'cableRow', 3, 15, 20],
      ['pull.rear', 'facePull', 5, 15, 20],
      ['pull.curl1', 'hammerCurl', 4, 15, 20],
      ['pull.curl2', 'dbCurl', 4, 15, 20],
    ]);
    assert.deepEqual(shape(getDayPlan('legs', { goal: 'endurance' })).map((r) => r.slice(2)), [
      [3, 15, 20], [3, 15, 20], [3, 15, 20], [5, 15, 20],
    ]);
    const plan = getDayPlan('pushB', { goal: 'endurance' });
    assert.equal(plan.main.sets, 5);
    assert.equal(plan.main.reps, 5);
  });

  test('cut: slots with 3+ sets lose one set; reps and main unchanged', () => {
    assert.deepEqual(shape(getDayPlan('pullA', { goal: 'cut' })), [
      ['pull.vertical', 'latPulldown', 2, 8, 12],
      ['pull.row', 'cableRow', 2, 8, 12],
      ['pull.rear', 'facePull', 4, 15, 20],
      ['pull.curl1', 'hammerCurl', 3, 8, 12],
      ['pull.curl2', 'dbCurl', 3, 8, 12],
    ]);
    const push = getDayPlan('pushA', { goal: 'cut' });
    assert.ok(push.items.every((i) => i.sets === 2));
    assert.equal(push.main.sets, 5);
    assert.deepEqual(getDayPlan('legs', { goal: 'cut' }).items.map((i) => i.sets), [2, 2, 2, 4]);
  });
});

describe('getDayPlan: abs add-on', () => {
  test('off by default', () => {
    for (const d of DAY_ORDER) {
      assert.ok(getDayPlan(d).items.every((i) => !i.slotKey.startsWith('abs.')), d);
    }
  });

  test('on: pullA and legs get abs.1 + abs.2 at the end, 3 sets, no rep target', () => {
    for (const d of ['pullA', 'legs']) {
      const items = getDayPlan(d, { abs: true }).items;
      const tail = items.slice(-2);
      assert.deepEqual(tail.map((i) => i.slotKey), ['abs.1', 'abs.2'], d);
      assert.deepEqual(tail.map((i) => i.exerciseId), ['abWheel', 'hangingLegRaise'], d);
      assert.deepEqual(tail.map((i) => i.name), ['Ab wheel rollout', 'Hanging leg raise'], d);
      for (const i of tail) {
        assert.equal(i.sets, 3);
        assert.equal(i.repsMin, null);
        assert.equal(i.repsMax, null);
      }
      assert.equal(items.length, getDayPlan(d).items.length + 2);
    }
  });

  test('on: pushA, pullB, pushB unchanged', () => {
    for (const d of ['pushA', 'pullB', 'pushB']) {
      assert.deepEqual(shape(getDayPlan(d, { abs: true })), shape(getDayPlan(d)), d);
    }
  });

  test('goals never change abs', () => {
    for (const goal of ['strength', 'endurance', 'cut']) {
      const tail = getDayPlan('legs', { abs: true, goal }).items.slice(-2);
      for (const i of tail) {
        assert.equal(i.sets, 3, goal);
        assert.equal(i.repsMin, null, goal);
        assert.equal(i.repsMax, null, goal);
      }
    }
  });

  test('abs slots are swappable via choices', () => {
    const plan = getDayPlan('pullA', { abs: true, choices: { 'abs.1': optionId('abs.1', ['plank']) } });
    assert.equal(itemOf(plan, 'abs.1').exerciseId, 'plank');
  });
});

// ---------------------------------------------------------------- rotation

describe('nextDay', () => {
  test('no sessions → pullA', () => {
    assert.equal(nextDay([]), 'pullA');
  });

  test('simple successors', () => {
    assert.equal(nextDay([S('2026-11-10', 'pullA')]), 'pushA');
    assert.equal(nextDay([S('2026-11-10', 'pushA')]), 'legs');
    assert.equal(nextDay([S('2026-11-10', 'pullB')]), 'pushB');
    assert.equal(nextDay([S('2026-11-10', 'pushB')]), 'legs');
  });

  test('after legs: look at the latest non-legs session', () => {
    assert.equal(nextDay([S('2026-11-08', 'pullA'), S('2026-11-10', 'legs')]), 'pullB');
    assert.equal(nextDay([S('2026-11-08', 'pushA'), S('2026-11-10', 'legs')]), 'pullB');
    assert.equal(nextDay([S('2026-11-08', 'pullB'), S('2026-11-10', 'legs')]), 'pullA');
    assert.equal(nextDay([S('2026-11-08', 'pushB'), S('2026-11-10', 'legs')]), 'pullA');
    assert.equal(nextDay([S('2026-11-10', 'legs')]), 'pullA');
    assert.equal(nextDay([S('2026-11-08', 'legs'), S('2026-11-10', 'legs')]), 'pullA');
    assert.equal(nextDay([S('2026-11-06', 'pushB'), S('2026-11-08', 'legs'), S('2026-11-10', 'legs')]), 'pullA');
  });

  test('sorts by date itself; same-date order is stable', () => {
    assert.equal(nextDay([S('2026-11-08', 'pushA'), S('2026-11-05', 'pullA')]), 'legs');
    assert.equal(nextDay([S('2026-11-10', 'legs'), S('2026-11-03', 'pushB'), S('2026-11-06', 'pushA')]), 'pullB');
    assert.equal(nextDay([S('2026-11-10', 'pullA'), S('2026-11-10', 'pushA')]), 'legs');
    assert.equal(nextDay([S('2026-11-10', 'pushA'), S('2026-11-10', 'pullA')]), 'pushA');
  });

  test('does not mutate its input', () => {
    const input = [S('2026-11-10', 'legs'), S('2026-11-03', 'pushB'), S('2026-11-06', 'pushA')];
    const before = clone(input);
    nextDay(input);
    assert.deepEqual(input, before);
  });

  test('walking the rotation twice', () => {
    const log = [];
    const days = [];
    for (let i = 0; i < 12; i++) {
      const d = nextDay(log);
      days.push(d);
      log.push(S(`2026-10-${String(i + 1).padStart(2, '0')}`, d));
    }
    assert.deepEqual(days, [...ROTATION, ...ROTATION]);
  });
});

describe('cyclePosition', () => {
  test('non-legs days have fixed positions regardless of history', () => {
    const histories = [
      [],
      [S('2026-11-01', 'pullB')],
      [S('2026-11-01', 'pushA'), S('2026-11-02', 'legs')],
      [S('2026-11-01', 'pushB'), S('2026-11-02', 'legs')],
    ];
    for (const h of histories) {
      assert.equal(cyclePosition('pullA', h), 1);
      assert.equal(cyclePosition('pushA', h), 2);
      assert.equal(cyclePosition('pullB', h), 4);
      assert.equal(cyclePosition('pushB', h), 5);
    }
  });

  test('legs is Day 3 after pullA/pushA, Day 6 after pullB/pushB', () => {
    assert.equal(cyclePosition('legs', [S('2026-11-08', 'pullA')]), 3);
    assert.equal(cyclePosition('legs', [S('2026-11-07', 'pullA'), S('2026-11-08', 'pushA')]), 3);
    assert.equal(cyclePosition('legs', [S('2026-11-08', 'pullB')]), 6);
    assert.equal(cyclePosition('legs', [S('2026-11-07', 'pullB'), S('2026-11-08', 'pushB')]), 6);
  });

  test('legs with no earlier non-legs session is Day 3', () => {
    assert.equal(cyclePosition('legs', []), 3);
    assert.equal(cyclePosition('legs', [S('2026-11-08', 'legs')]), 3);
  });

  test('legs sessions in between are skipped when looking back', () => {
    assert.equal(cyclePosition('legs', [S('2026-11-06', 'pushB'), S('2026-11-08', 'legs')]), 6);
    assert.equal(cyclePosition('legs', [S('2026-11-06', 'pushA'), S('2026-11-08', 'legs')]), 3);
  });

  test('sorts its input by date (stable)', () => {
    assert.equal(cyclePosition('legs', [S('2026-11-08', 'pushB'), S('2026-11-02', 'pushA')]), 6);
    assert.equal(cyclePosition('legs', [S('2026-11-08', 'pushA'), S('2026-11-02', 'pushB')]), 3);
    assert.equal(cyclePosition('legs', [S('2026-11-05', 'pushA'), S('2026-11-05', 'pullB')]), 6);
    assert.equal(cyclePosition('legs', [S('2026-11-05', 'pullB'), S('2026-11-05', 'pushA')]), 3);
  });

  test('does not mutate its input', () => {
    const input = [S('2026-11-08', 'pushB'), S('2026-11-02', 'pushA'), S('2026-11-05', 'legs')];
    const before = clone(input);
    cyclePosition('legs', input);
    assert.deepEqual(input, before);
  });
});

describe('nextWorkout', () => {
  test('spec examples', () => {
    assert.deepEqual(nextWorkout([]), { dayId: 'pullA', position: 1 });
    assert.deepEqual(nextWorkout([S('2026-11-09', 'pullA'), S('2026-11-10', 'pushA')]), { dayId: 'legs', position: 3 });
    assert.deepEqual(nextWorkout([S('2026-11-09', 'pullB'), S('2026-11-10', 'pushB')]), { dayId: 'legs', position: 6 });
    assert.deepEqual(
      nextWorkout([S('2026-11-08', 'pullB'), S('2026-11-09', 'pushB'), S('2026-11-10', 'legs')]),
      { dayId: 'pullA', position: 1 },
    );
  });

  test('last logged legs at Day 3 → pullB, Day 4', () => {
    assert.deepEqual(
      nextWorkout([S('2026-11-08', 'pullA'), S('2026-11-09', 'pushA'), S('2026-11-10', 'legs')]),
      { dayId: 'pullB', position: 4 },
    );
  });

  test('skipped calendar days change nothing', () => {
    const consecutive = [S('2026-11-06', 'pullA'), S('2026-11-07', 'pushA'), S('2026-11-08', 'legs')];
    const withGap = [S('2026-11-06', 'pullA'), S('2026-11-07', 'pushA'), S('2026-11-11', 'legs')];
    assert.deepEqual(nextWorkout(withGap), { dayId: 'pullB', position: 4 });
    assert.deepEqual(nextWorkout(withGap), nextWorkout(consecutive));
    // a long break after Day 2 still offers Day 3
    assert.deepEqual(nextWorkout([S('2026-09-01', 'pullA'), S('2026-09-02', 'pushA')]), { dayId: 'legs', position: 3 });
  });

  test('a different workout than offered: the cycle carries on from what was logged', () => {
    const log = [S('2026-11-05', 'pullA')];
    assert.deepEqual(nextWorkout(log), { dayId: 'pushA', position: 2 });
    log.push(S('2026-11-06', 'legs')); // user did legs instead of pushA
    assert.deepEqual(nextWorkout(log), { dayId: 'pullB', position: 4 });
  });

  test('walking the rotation twice gives Day 1–6 twice', () => {
    const log = [];
    const seen = [];
    for (let i = 0; i < 12; i++) {
      const next = nextWorkout(log);
      seen.push([next.dayId, next.position]);
      log.push(S(`2026-10-${String(i + 1).padStart(2, '0')}`, next.dayId));
    }
    const cycle = ROTATION.map((d, i) => [d, i + 1]);
    assert.deepEqual(seen, [...cycle, ...cycle]);
  });

  test('unsorted input, not mutated', () => {
    const input = [S('2026-11-10', 'pushB'), S('2026-11-08', 'pullB'), S('2026-11-06', 'legs')];
    const before = clone(input);
    assert.deepEqual(nextWorkout(input), { dayId: 'legs', position: 6 });
    assert.deepEqual(input, before);
  });
});

// ---------------------------------------------------------------- text → day

describe('parseDayText', () => {
  const cases = [
    ['Pull A', 'pull', 'A', false],
    ['pull b', 'pull', 'B', false],
    ['PULL A', 'pull', 'A', false],
    ['push b', 'push', 'B', false],
    ['PushA', 'push', 'A', false],
    ['Push', 'push', null, false],
    ['Push day', 'push', null, false],
    ['Pull', 'pull', null, false],
    ['Leg day', 'legs', null, false],
    ['legs', 'legs', null, false],
    ['Legs', 'legs', null, false],
    ['pull (off day)', 'pull', null, true],
    ['Pull A (off day)', 'pull', 'A', true],
    ['Push B (off)', 'push', 'B', true],
    ['Legs off day', 'legs', null, true],
    ['bad day', null, null, true],
    ['', null, null, false],
  ];
  for (const [text, type, variant, offDay] of cases) {
    test(JSON.stringify(text), () => {
      assert.deepEqual(parseDayText(text), { type, variant, offDay });
    });
  }
});

describe('resolveDay', () => {
  test('type + variant → that day; legs ignores variant', () => {
    assert.equal(resolveDay('pull', 'A', []), 'pullA');
    assert.equal(resolveDay('pull', 'B', ['deadlift']), 'pullB');
    assert.equal(resolveDay('push', 'A', ['ohp']), 'pushA');
    assert.equal(resolveDay('push', 'B', ['bench']), 'pushB');
    assert.equal(resolveDay('legs', null, []), 'legs');
    assert.equal(resolveDay('legs', 'A', ['squat']), 'legs');
    assert.equal(resolveDay('legs', 'B', []), 'legs');
  });

  test('pull without variant', () => {
    assert.equal(resolveDay('pull', null, ['latPulldown', 'deadlift']), 'pullA');
    assert.equal(resolveDay('pull', null, ['deadlift', 'barbellRow']), 'pullA');
    assert.equal(resolveDay('pull', null, ['barbellRow', 'latPulldown']), 'pullB');
    assert.equal(resolveDay('pull', null, ['latPulldown', 'facePull']), 'pullA');
    assert.equal(resolveDay('pull', null, []), 'pullA');
  });

  test('push without variant: whichever of bench/ohp comes first is main', () => {
    assert.equal(resolveDay('push', null, ['bench', 'ohp']), 'pushA');
    assert.equal(resolveDay('push', null, ['ohp', 'bench']), 'pushB');
    assert.equal(resolveDay('push', null, ['inclineDbPress', 'bench']), 'pushA');
    assert.equal(resolveDay('push', null, ['lateralRaise', 'ohp']), 'pushB');
    assert.equal(resolveDay('push', null, ['lateralRaise']), 'pushA');
    assert.equal(resolveDay('push', null, []), 'pushA');
  });

  test('no type: majority group of known exercises, then the rules above', () => {
    assert.equal(resolveDay(null, null, ['deadlift', 'latPulldown', 'facePull']), 'pullA');
    assert.equal(resolveDay(null, null, ['barbellRow', 'latPulldown']), 'pullB');
    assert.equal(resolveDay(null, null, ['bench', 'ohp', 'inclineDbPress']), 'pushA');
    assert.equal(resolveDay(null, null, ['ohp', 'bench', 'lateralRaise']), 'pushB');
    assert.equal(resolveDay(null, null, ['squat', 'rdl', 'legPress']), 'legs');
    assert.equal(resolveDay(null, null, ['latPulldown', 'bench', 'inclineDbPress']), 'pushA');
    assert.equal(resolveDay(null, null, ['rdl', 'deadlift', 'latPulldown']), 'pullA');
  });

  test('no type: abs and custom exercises are ignored in the vote', () => {
    assert.equal(resolveDay(null, null, ['abWheel', 'plank', 'hangingLegRaise', 'bench']), 'pushA');
    assert.equal(resolveDay(null, null, ['custom:a', 'custom:b', 'ohp']), 'pushB');
  });

  test('no type: ties go to the first exercise\'s group', () => {
    assert.equal(resolveDay(null, null, ['latPulldown', 'bench']), 'pullA');
    assert.equal(resolveDay(null, null, ['bench', 'latPulldown']), 'pushA');
    assert.equal(resolveDay(null, null, ['squat', 'bench']), 'legs');
  });

  test('no type and no known exercises → null', () => {
    assert.equal(resolveDay(null, null, []), null);
    assert.equal(resolveDay(null, null, ['custom:zercher squat']), null);
  });
});
