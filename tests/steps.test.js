// Batch 1, §17.2 — weight step per exercise (machines). Catalog `equipment`, the one rule `stepFor`,
// every increase / decrease / deload using the step, and the `steps` state. Written from SPEC.md §17.2.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES } from '../public/js/program.js';
import * as units from '../public/js/units.js';
import { suggestMain, suggestAccessory } from '../public/js/progression.js';
import { defaultState, migrate, load, save, convertAllWeights } from '../public/js/store.js';
import { session, entry, at, clone } from './_helpers.js';

const { stepFor, convertWeight } = units;

const SLOT_8_12 = { sets: 3, repsMin: 8, repsMax: 12 };
const SLOT_15_20 = { sets: 3, repsMin: 15, repsMax: 20 };
const pickAcc = (r) => ({ weight: r.weight, action: r.action });
const pick = (r) => ({ weight: r.weight, action: r.action, failStreak: r.failStreak });
const one = (date, day, exerciseId, weight, repsList, opts) => session(date, day, [entry(exerciseId, at(weight, repsList))], opts);

// Exactly as listed in §17.2. The spec groups "Machine/cable" together, so either value is accepted there.
const MACHINE_OR_CABLE = ['latPulldown', 'cableRow', 'facePull', 'tricepsPushdown', 'cableCurl', 'legPress', 'legCurl', 'calfRaise', 'seatedCalfRaise', 'legPressCalfRaise'];
const BARBELL = ['deadlift', 'barbellRow', 'bench', 'ohp', 'squat', 'rdl', 'frontSquat', 'barbellCurl', 'ezCurl', 'skullcrusher', 'landminePress'];
const BODYWEIGHT = ['pullUp', 'chinUp', 'ghr', 'plank', 'abWheel', 'hangingLegRaise'];
const BAND = ['bandPullApart'];
const DUMBBELL = ['dbRow', 'hammerCurl', 'dbCurl', 'inclineCurl', 'concentrationCurl', 'preacherCurl', 'inclineDbPress', 'ohTricepsExt', 'lyingTricepsExt', 'dbTricepsExt', 'lateralRaise', 'frontRaise', 'rearDeltFly', 'chestSupportedRow', 'tbarRow'];
const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'band'];

// ---------------------------------------------------------------- catalog

describe('EXERCISES[id].equipment', () => {
  test('the five lists cover the whole catalog exactly once', () => {
    const listed = [...MACHINE_OR_CABLE, ...BARBELL, ...BODYWEIGHT, ...BAND, ...DUMBBELL];
    assert.equal(new Set(listed).size, listed.length, 'no id listed twice');
    assert.deepEqual([...listed].sort(), Object.keys(EXERCISES).sort());
  });

  test('every catalog exercise has one of the six equipment values', () => {
    for (const ex of Object.values(EXERCISES)) assert.ok(EQUIPMENT.includes(ex.equipment), `${ex.id}: ${JSON.stringify(ex.equipment)}`);
  });

  test('machine / cable', () => {
    for (const id of MACHINE_OR_CABLE) assert.ok(['machine', 'cable'].includes(EXERCISES[id].equipment), `${id}: ${EXERCISES[id].equipment}`);
  });

  test('barbell', () => {
    for (const id of BARBELL) assert.equal(EXERCISES[id].equipment, 'barbell', id);
  });

  test('bodyweight and band', () => {
    for (const id of BODYWEIGHT) assert.equal(EXERCISES[id].equipment, 'bodyweight', id);
    for (const id of BAND) assert.equal(EXERCISES[id].equipment, 'band', id);
  });

  test('dumbbell: the rest', () => {
    for (const id of DUMBBELL) assert.equal(EXERCISES[id].equipment, 'dumbbell', id);
  });
});

// ---------------------------------------------------------------- stepFor

describe('stepFor: defaults', () => {
  test('machine / cable accessories: 5 kg / 10 lb', () => {
    for (const id of MACHINE_OR_CABLE) {
      assert.equal(stepFor(id, 'accessory', 'kg', {}), 5, `${id} kg`);
      assert.equal(stepFor(id, 'accessory', 'lb', {}), 10, `${id} lb`);
    }
  });

  test('every other accessory (dumbbell, barbell, bodyweight, band): 2.5 kg / 5 lb', () => {
    for (const id of [...DUMBBELL, ...BARBELL, ...BODYWEIGHT, ...BAND]) {
      assert.equal(stepFor(id, 'accessory', 'kg', {}), 2.5, `${id} kg`);
      assert.equal(stepFor(id, 'accessory', 'lb', {}), 5, `${id} lb`);
    }
  });

  test('custom exercises (no equipment) are free weights: 2.5 kg / 5 lb', () => {
    assert.equal(stepFor('custom:zercher squat', 'accessory', 'kg', {}), 2.5);
    assert.equal(stepFor('custom:zercher squat', 'accessory', 'lb', {}), 5);
  });

  test('main lifts by category: squat / bench / OHP / row 2.5 kg (5 lb), deadlift 5 kg (10 lb)', () => {
    for (const id of ['squat', 'bench', 'ohp', 'barbellRow']) {
      assert.equal(stepFor(id, 'main', 'kg', {}), 2.5, `${id} kg`);
      assert.equal(stepFor(id, 'main', 'lb', {}), 5, `${id} lb`);
    }
    assert.equal(stepFor('deadlift', 'main', 'kg', {}), 5);
    assert.equal(stepFor('deadlift', 'main', 'lb', {}), 10);
  });

  test('by role: a main lift used as an accessory takes the accessory default', () => {
    assert.equal(stepFor('deadlift', 'accessory', 'kg', {}), 2.5);
    assert.equal(stepFor('deadlift', 'accessory', 'lb', {}), 5);
    assert.equal(stepFor('bench', 'accessory', 'kg', {}), 2.5);
  });
});

describe('stepFor: the user\'s own step', () => {
  test('a valid step (finite > 0) wins, for any equipment and role', () => {
    assert.equal(stepFor('squat', 'main', 'kg', { squat: 5 }), 5); // a gym without 1.25 kg plates
    assert.equal(stepFor('deadlift', 'main', 'kg', { deadlift: 2.5 }), 2.5);
    assert.equal(stepFor('lateralRaise', 'accessory', 'kg', { lateralRaise: 1 }), 1);
    assert.equal(stepFor('latPulldown', 'accessory', 'kg', { latPulldown: 2.5 }), 2.5); // smaller than the machine default
    assert.equal(stepFor('latPulldown', 'accessory', 'lb', { latPulldown: 7.5 }), 7.5);
    assert.equal(stepFor('custom:zercher squat', 'accessory', 'kg', { 'custom:zercher squat': 5 }), 5);
  });

  test('keyed by exercise: one step covers the lift in both roles', () => {
    assert.equal(stepFor('bench', 'main', 'kg', { bench: 5 }), 5);
    assert.equal(stepFor('bench', 'accessory', 'kg', { bench: 5 }), 5);
  });

  test('another exercise\'s step does not apply', () => {
    assert.equal(stepFor('squat', 'main', 'kg', { deadlift: 10 }), 2.5);
    assert.equal(stepFor('legPress', 'accessory', 'kg', { latPulldown: 2.5 }), 5);
  });

  test('an invalid step falls back to the default', () => {
    for (const bad of [0, -2.5, NaN, Infinity, -Infinity, null, undefined, 'abc', {}, []]) {
      assert.equal(stepFor('squat', 'main', 'kg', { squat: bad }), 2.5, `squat ${String(bad)}`);
      assert.equal(stepFor('latPulldown', 'accessory', 'kg', { latPulldown: bad }), 5, `latPulldown ${String(bad)}`);
    }
  });
});

// ---------------------------------------------------------------- suggestions use the step

describe('suggestAccessory uses the step', () => {
  const lp = (w, reps, opts) => [one('2026-11-10', 'pullA', 'latPulldown', w, reps, opts)];

  test('machine default: increase 5 kg / 10 lb', () => {
    assert.deepEqual(pickAcc(suggestAccessory(lp(45, [12, 12, 12]), 'latPulldown', SLOT_8_12, 'kg')), { weight: 50, action: 'increase' });
    assert.deepEqual(pickAcc(suggestAccessory(lp(100, [12, 12, 12]), 'latPulldown', SLOT_8_12, 'lb')), { weight: 110, action: 'increase' });
    const legPress = [one('2026-11-10', 'legs', 'legPress', 140, [12, 12, 12])];
    assert.deepEqual(pickAcc(suggestAccessory(legPress, 'legPress', SLOT_8_12, 'kg')), { weight: 145, action: 'increase' });
  });

  test('machine default: decrease 5 kg / 10 lb, never below 0', () => {
    assert.deepEqual(pickAcc(suggestAccessory(lp(45, [10, 8, 7]), 'latPulldown', SLOT_8_12, 'kg')), { weight: 40, action: 'decrease' });
    assert.deepEqual(pickAcc(suggestAccessory(lp(100, [9, 7, 6]), 'latPulldown', SLOT_8_12, 'lb')), { weight: 90, action: 'decrease' });
    assert.deepEqual(pickAcc(suggestAccessory(lp(2.5, [6, 6, 6]), 'latPulldown', SLOT_8_12, 'kg')), { weight: 0, action: 'decrease' });
  });

  test('free weights keep 2.5 kg / 5 lb', () => {
    const lr = [one('2026-11-10', 'pushA', 'lateralRaise', 8, [20, 20, 20])];
    assert.deepEqual(pickAcc(suggestAccessory(lr, 'lateralRaise', SLOT_15_20, 'kg')), { weight: 10.5, action: 'increase' });
    const lrLb = [one('2026-11-10', 'pushA', 'lateralRaise', 20, [20, 20, 20])];
    assert.deepEqual(pickAcc(suggestAccessory(lrLb, 'lateralRaise', SLOT_15_20, 'lb')), { weight: 25, action: 'increase' });
  });

  test('the user\'s step, passed as { steps }', () => {
    const lr = [one('2026-11-10', 'pushA', 'lateralRaise', 8, [20, 20, 20])];
    assert.deepEqual(pickAcc(suggestAccessory(lr, 'lateralRaise', SLOT_15_20, 'kg', { steps: { lateralRaise: 1 } })), { weight: 9, action: 'increase' });
    const low = [one('2026-11-10', 'pushA', 'lateralRaise', 8, [15, 14, 12])];
    assert.deepEqual(pickAcc(suggestAccessory(low, 'lateralRaise', SLOT_15_20, 'kg', { steps: { lateralRaise: 1 } })), { weight: 7, action: 'decrease' });
    assert.deepEqual(pickAcc(suggestAccessory(lp(45, [12, 12, 12]), 'latPulldown', SLOT_8_12, 'kg', { steps: { latPulldown: 2.5 } })), { weight: 47.5, action: 'increase' });
    assert.deepEqual(pickAcc(suggestAccessory(lp(45, [12, 12, 12]), 'latPulldown', SLOT_8_12, 'kg', { steps: {} })), { weight: 50, action: 'increase' });
  });

  test('keep is untouched by the step', () => {
    assert.deepEqual(pickAcc(suggestAccessory(lp(45, [12, 11, 10]), 'latPulldown', SLOT_8_12, 'kg', { steps: { latPulldown: 2.5 } })), { weight: 45, action: 'keep' });
  });
});

describe('suggestMain uses the step (increase, and deload floors to the step)', () => {
  const squatOk = (date, w) => one(date, 'legs', 'squat', w, [5, 5, 6]);
  const squatFail = (date, w) => one(date, 'legs', 'squat', w, [5, 5, 3]);
  const benchFail = (date, w) => one(date, 'pushA', 'bench', w, [5, 5, 5, 4, 3]);
  const three = (mk, w) => [mk('2026-11-01', w), mk('2026-11-04', w), mk('2026-11-07', w)];

  test('defaults are unchanged (squat 2.5, deadlift 5)', () => {
    assert.deepEqual(pick(suggestMain([squatOk('2026-11-10', 100)], 'squat', 'kg')), { weight: 102.5, action: 'increase', failStreak: 0 });
    assert.equal(suggestMain([one('2026-11-10', 'pullA', 'deadlift', 140, [7])], 'deadlift', 'kg').weight, 145);
  });

  test('increase by the user\'s step (kg and lb)', () => {
    assert.deepEqual(pick(suggestMain([squatOk('2026-11-10', 100)], 'squat', 'kg', { steps: { squat: 5 } })), { weight: 105, action: 'increase', failStreak: 0 });
    assert.equal(suggestMain([squatOk('2026-11-10', 225)], 'squat', 'lb', { steps: { squat: 10 } }).weight, 235);
    assert.equal(suggestMain([one('2026-11-10', 'pullA', 'deadlift', 140, [7])], 'deadlift', 'kg', { steps: { deadlift: 2.5 } }).weight, 142.5);
  });

  test('deload floors to the step', () => {
    // 77.5 × 0.9 = 69.75 → 67.5 on a 2.5 grid, 65 on a 5 grid
    assert.deepEqual(pick(suggestMain(three(squatFail, 77.5), 'squat', 'kg')), { weight: 67.5, action: 'deload', failStreak: 3 });
    assert.deepEqual(pick(suggestMain(three(squatFail, 77.5), 'squat', 'kg', { steps: { squat: 5 } })), { weight: 65, action: 'deload', failStreak: 3 });
    // 62.5 × 0.9 = 56.25 → 55 on a 2.5 grid, 56 on a 1 grid
    assert.equal(suggestMain(three(benchFail, 62.5), 'bench', 'kg').weight, 55);
    assert.equal(suggestMain(three(benchFail, 62.5), 'bench', 'kg', { steps: { bench: 1 } }).weight, 56);
    // lb: 255 × 0.9 = 229.5 → 225 on a 5 grid, 220 on a 10 grid
    assert.equal(suggestMain(three(squatFail, 255), 'squat', 'lb').weight, 225);
    assert.equal(suggestMain(three(squatFail, 255), 'squat', 'lb', { steps: { squat: 10 } }).weight, 220);
  });

  test('repeat is untouched by the step', () => {
    assert.deepEqual(pick(suggestMain([squatFail('2026-11-10', 100)], 'squat', 'kg', { steps: { squat: 5 } })), { weight: 100, action: 'repeat', failStreak: 1 });
  });

  test('does not mutate the steps object or the sessions', () => {
    const steps = { squat: 5 };
    const data = three(squatFail, 77.5);
    const before = clone({ steps, data });
    suggestMain(data, 'squat', 'kg', { steps });
    suggestAccessory([one('2026-11-10', 'pullA', 'latPulldown', 45, [12, 12, 12])], 'latPulldown', SLOT_8_12, 'kg', { steps });
    assert.deepEqual({ steps, data }, before);
  });
});

// ---------------------------------------------------------------- state

/** In-memory stand-in for localStorage. */
function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); } };
}

describe('state.steps', () => {
  test('defaultState().steps = {}', () => {
    assert.deepEqual(defaultState().steps, {});
    const a = defaultState();
    a.steps.squat = 5;
    assert.deepEqual(defaultState().steps, {}, 'a fresh object each time');
  });

  test('migrate keeps valid entries (finite > 0) and drops the rest', () => {
    const out = migrate({ steps: { latPulldown: 2.5, squat: 5, legPress: 10, zero: 0, neg: -1, text: 'x', nil: null, obj: {} } });
    assert.deepEqual(out.steps, { latPulldown: 2.5, squat: 5, legPress: 10 });
  });

  test('migrate: missing or non-object steps → {}', () => {
    assert.deepEqual(migrate({}).steps, {});
    assert.deepEqual(migrate({ steps: [5, 2.5] }).steps, {});
    assert.deepEqual(migrate({ steps: 'x' }).steps, {});
    assert.deepEqual(migrate({ steps: null }).steps, {});
  });

  test('save → load keeps steps', () => {
    const storage = fakeStorage();
    const state = { ...defaultState(), steps: { latPulldown: 2.5, squat: 5 } };
    save(state, storage);
    assert.deepEqual(load(storage).steps, { latPulldown: 2.5, squat: 5 });
  });

  test('convertAllWeights converts steps with convertWeight rounding (kg → lb → kg)', () => {
    const state = { ...defaultState(), steps: { latPulldown: 5, squat: 2.5, deadlift: 10 } };
    const before = clone(state);
    const lb = convertAllWeights(state, 'lb');
    assert.deepEqual(lb.steps, {
      latPulldown: convertWeight(5, 'kg', 'lb'),
      squat: convertWeight(2.5, 'kg', 'lb'),
      deadlift: convertWeight(10, 'kg', 'lb'),
    });
    assert.deepEqual(state, before, 'input not mutated');
    const back = convertAllWeights(lb, 'kg');
    assert.deepEqual(back.steps, {
      latPulldown: convertWeight(convertWeight(5, 'kg', 'lb'), 'lb', 'kg'),
      squat: convertWeight(convertWeight(2.5, 'kg', 'lb'), 'lb', 'kg'),
      deadlift: convertWeight(convertWeight(10, 'kg', 'lb'), 'lb', 'kg'),
    });
  });

  test('convertAllWeights to the same unit leaves steps alone', () => {
    const state = { ...defaultState(), steps: { latPulldown: 5 } };
    assert.deepEqual(convertAllWeights(state, 'kg').steps, { latPulldown: 5 });
  });
});
