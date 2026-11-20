// Batch 1, §17.4 — weights are the total on the bar, bar included. settings.barWeight (default 20 kg / 45 lb),
// warmupSets taking the bar as a parameter, and the plate helper platesText(total, bar, unit).
// Written from SPEC.md §17.4 before the code.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as units from '../public/js/units.js';
import * as program from '../public/js/program.js';
import { warmupSets } from '../public/js/progression.js';
import { defaultState, migrate, load, save, convertAllWeights } from '../public/js/store.js';
import { clone } from './_helpers.js';

const { platesText, barWeight, convertWeight } = units;
const ramp = (list) => list.map((s) => [s.weight, s.reps]);

function fakeStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); } };
}

describe('settings.barWeight', () => {
  test('default 20 (kg is the default unit); units.barWeight stays as the default by unit', () => {
    assert.equal(defaultState().settings.barWeight, 20);
    assert.equal(barWeight('kg'), 20);
    assert.equal(barWeight('lb'), 45);
  });

  test('migrate: missing → the default in the stored unit (20 kg / 45 lb)', () => {
    assert.equal(migrate({}).settings.barWeight, 20);
    assert.equal(migrate({ settings: {} }).settings.barWeight, 20);
    assert.equal(migrate({ settings: { unit: 'kg' } }).settings.barWeight, 20);
    assert.equal(migrate({ settings: { unit: 'lb' } }).settings.barWeight, 45);
  });

  test('migrate keeps a stored bar weight', () => {
    assert.equal(migrate({ settings: { unit: 'kg', barWeight: 15 } }).settings.barWeight, 15);
    assert.equal(migrate({ settings: { unit: 'lb', barWeight: 35 } }).settings.barWeight, 35);
  });

  test('migrate: an unusable bar weight falls back to the default', () => {
    for (const bad of ['heavy', -20, null]) {
      assert.equal(migrate({ settings: { unit: 'kg', barWeight: bad } }).settings.barWeight, 20, String(bad));
      assert.equal(migrate({ settings: { unit: 'lb', barWeight: bad } }).settings.barWeight, 45, String(bad));
    }
  });

  test('save → load keeps it', () => {
    const storage = fakeStorage();
    save({ ...defaultState(), settings: { ...defaultState().settings, barWeight: 15 } }, storage);
    assert.equal(load(storage).settings.barWeight, 15);
  });

  test('convertAllWeights converts it with convertWeight rounding (kg → lb → kg); same unit → unchanged', () => {
    const state = { ...defaultState(), settings: { ...defaultState().settings, barWeight: 20 } };
    const before = clone(state);
    const lb = convertAllWeights(state, 'lb');
    assert.equal(lb.settings.unit, 'lb');
    assert.equal(lb.settings.barWeight, convertWeight(20, 'kg', 'lb'));
    assert.deepEqual(state, before, 'input not mutated');
    const back = convertAllWeights(lb, 'kg');
    assert.equal(back.settings.barWeight, convertWeight(convertWeight(20, 'kg', 'lb'), 'lb', 'kg'));
    const fifteen = { ...defaultState(), settings: { ...defaultState().settings, barWeight: 15 } };
    assert.equal(convertAllWeights(fifteen, 'kg').settings.barWeight, 15);
    assert.equal(convertAllWeights(fifteen, 'lb').settings.barWeight, convertWeight(15, 'kg', 'lb'));
  });
});

describe('warmupSets(workWeight, unit, bar)', () => {
  test('no bar given → units.barWeight(unit), as before', () => {
    assert.deepEqual(ramp(warmupSets(100, 'kg')), [[20, 10], [50, 10], [70, 5], [90, 3]]);
    assert.deepEqual(ramp(warmupSets(200, 'lb')), [[45, 10], [100, 10], [140, 5], [180, 3]]);
  });

  test('the bar given is the first set', () => {
    assert.deepEqual(ramp(warmupSets(100, 'kg', 15)), [[15, 10], [50, 10], [70, 5], [90, 3]]);
    assert.deepEqual(ramp(warmupSets(100, 'kg', 20)), [[20, 10], [50, 10], [70, 5], [90, 3]]);
    assert.deepEqual(ramp(warmupSets(100, 'lb', 35)), [[35, 10], [50, 10], [70, 5], [90, 3]]);
  });

  test('ramp sets at or below the given bar are dropped (and kept when above it)', () => {
    assert.deepEqual(ramp(warmupSets(30, 'kg')), [[20, 10], [27.5, 3]]);
    assert.deepEqual(ramp(warmupSets(30, 'kg', 15)), [[15, 10], [20, 5], [27.5, 3]]);
    assert.deepEqual(ramp(warmupSets(60, 'kg', 25)), [[25, 10], [30, 10], [42.5, 5], [55, 3]]);
  });

  test('work weight at or below the given bar → just the bar × 10; null → []', () => {
    assert.deepEqual(ramp(warmupSets(15, 'kg', 15)), [[15, 10]]);
    assert.deepEqual(ramp(warmupSets(10, 'kg', 15)), [[15, 10]]);
    assert.deepEqual(warmupSets(null, 'kg', 15), []);
  });
});

describe('platesText(total, bar, unit)', () => {
  test('the spec example: 62.5 kg on a 20 kg bar', () => {
    assert.equal(platesText(62.5, 20, 'kg'), '= 20 kg bar + 21.25 kg each side');
  });

  test('more totals, numbers printed without a trailing .0', () => {
    assert.equal(platesText(100, 20, 'kg'), '= 20 kg bar + 40 kg each side');
    assert.equal(platesText(25, 20, 'kg'), '= 20 kg bar + 2.5 kg each side');
    assert.equal(platesText(62.5, 15, 'kg'), '= 15 kg bar + 23.75 kg each side');
  });

  test('lb', () => {
    assert.equal(platesText(135, 45, 'lb'), '= 45 lb bar + 45 lb each side');
    assert.equal(platesText(225, 45, 'lb'), '= 45 lb bar + 90 lb each side');
    assert.equal(platesText(95, 35, 'lb'), '= 35 lb bar + 30 lb each side');
  });

  test('equal to the bar → "Empty bar"', () => {
    assert.equal(platesText(20, 20, 'kg'), 'Empty bar');
    assert.equal(platesText(45, 45, 'lb'), 'Empty bar');
    assert.equal(platesText(15, 15, 'kg'), 'Empty bar');
  });

  test('below the bar → "Lighter than the bar — use a lighter bar or dumbbells"', () => {
    assert.equal(platesText(15, 20, 'kg'), 'Lighter than the bar — use a lighter bar or dumbbells');
    assert.equal(platesText(17.5, 20, 'kg'), 'Lighter than the bar — use a lighter bar or dumbbells');
    assert.equal(platesText(40, 45, 'lb'), 'Lighter than the bar — use a lighter bar or dumbbells');
  });

  test('empty → no line', () => {
    assert.ok(!platesText(null, 20, 'kg'), 'null total');
    assert.ok(!platesText(undefined, 20, 'kg'), 'undefined total');
  });
});

// ------------------------------------------------------------------ added by the independent review (Batch 1)

describe('hasPlateLine (review fix): the plate line needs a standard bar loaded on both ends', () => {
  const { hasPlateLine } = program;

  test('standard barbell lifts get the plate line', () => {
    for (const id of ['squat', 'bench', 'deadlift', 'ohp', 'barbellRow', 'rdl', 'frontSquat', 'barbellCurl']) {
      assert.equal(hasPlateLine(id), true, id);
    }
  });

  test('EZ-bar curl and skullcrusher (an EZ bar, not 20 kg) and landmine press (one end loaded) get none, though they stay barbell equipment', () => {
    for (const id of ['ezCurl', 'skullcrusher', 'landminePress']) {
      assert.equal(program.EXERCISES[id].equipment, 'barbell', `${id} keeps its §17.2 equipment`);
      assert.equal(hasPlateLine(id), false, id);
    }
  });

  test('anything that is not a barbell gets none (machines, dumbbells, bodyweight, custom)', () => {
    for (const id of ['latPulldown', 'legPress', 'hammerCurl', 'lateralRaise', 'pullUp', 'plank', 'bandPullApart', program.customId('Shrugs')]) {
      assert.equal(hasPlateLine(id), false, id);
    }
  });
});
