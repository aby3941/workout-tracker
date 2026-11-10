// "Set weight" (baselines): a weight the user sets for an exercise, used once for its next session.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineKey, applyBaseline, suggestMain, suggestAccessory } from '../public/js/progression.js';
import {
  defaultState, migrate, setBaseline, clearBaseline, consumeBaselines, convertAllWeights,
} from '../public/js/store.js';
import { convertWeight } from '../public/js/units.js';
import { session, entry, at, clone } from './_helpers.js';

const squat = (date, w, reps = [5, 5, 6]) => session(date, 'legs', [entry('squat', at(w, reps))]);
const SLOT_3x8_12 = { sets: 3, repsMin: 8, repsMax: 12 };

describe('baselineKey', () => {
  test('exercise and role together', () => {
    assert.equal(baselineKey('squat', 'main'), 'squat|main');
    assert.equal(baselineKey('bench', 'accessory'), 'bench|accessory');
    assert.notEqual(baselineKey('bench', 'main'), baselineKey('bench', 'accessory'));
  });
});

describe('applyBaseline', () => {
  test('no baseline → the suggestion is unchanged', () => {
    const s = suggestMain([squat('2026-11-02', 60)], 'squat', 'kg');
    assert.deepEqual(applyBaseline(s, undefined), s);
    assert.deepEqual(applyBaseline(s, null), s);
  });

  test('main lift: set weight replaces the planned increase, once', () => {
    const history = [squat('2026-11-02', 60)];
    const planned = suggestMain(history, 'squat', 'kg');
    assert.equal(planned.weight, 62.5);
    const before = clone(planned);
    const out = applyBaseline(planned, { weight: 70, setOn: '2026-11-03' });
    assert.equal(out.weight, 70);
    assert.equal(out.action, 'set');
    assert.equal(out.failStreak, 0);
    assert.deepEqual(out.last, planned.last);
    assert.deepEqual(planned, before, 'input not mutated');
    assert.notEqual(out, planned);
  });

  test('main lift: a set weight clears a fail streak and a pending deload', () => {
    const history = [squat('2026-10-20', 100, [5, 5, 3]), squat('2026-10-23', 100, [5, 4, 3]), squat('2026-10-26', 100, [4, 4, 3])];
    const planned = suggestMain(history, 'squat', 'kg');
    assert.equal(planned.action, 'deload');
    const out = applyBaseline(planned, { weight: 95, setOn: '2026-10-27' });
    assert.equal(out.weight, 95);
    assert.equal(out.action, 'set');
    assert.equal(out.failStreak, 0);
  });

  test('first time (no history): a set weight becomes the start', () => {
    const planned = suggestMain([], 'deadlift', 'kg');
    assert.equal(planned.action, 'start');
    const out = applyBaseline(planned, { weight: 80, setOn: '2026-11-10' });
    assert.equal(out.weight, 80);
    assert.equal(out.action, 'set');
  });

  test('accessory: works on suggestAccessory results too (no failStreak key added)', () => {
    const history = [session('2026-11-03', 'pullA', [entry('latPulldown', at(45, [10, 9, 9]))])];
    const planned = suggestAccessory(history, 'latPulldown', SLOT_3x8_12, 'kg');
    const out = applyBaseline(planned, { weight: 40, setOn: '2026-11-04' });
    assert.equal(out.weight, 40);
    assert.equal(out.action, 'set');
    assert.equal('failStreak' in out, 'failStreak' in planned);
  });

  test('bodyweight 0 is a valid set weight', () => {
    const out = applyBaseline(suggestAccessory([], 'pullUp', SLOT_3x8_12, 'kg'), { weight: 0, setOn: '2026-11-10' });
    assert.equal(out.weight, 0);
    assert.equal(out.action, 'set');
  });

  test('invalid baseline weights are ignored', () => {
    const planned = suggestMain([squat('2026-11-02', 60)], 'squat', 'kg');
    for (const weight of [-5, NaN, Infinity, '70', null, undefined]) {
      assert.deepEqual(applyBaseline(planned, { weight, setOn: '2026-11-03' }), planned, String(weight));
    }
  });
});

describe('state: defaults and migrate', () => {
  test('defaultState has empty baselines and setupDone false', () => {
    const d = defaultState();
    assert.deepEqual(d.baselines, {});
    assert.equal(d.settings.setupDone, false);
  });

  test('migrate keeps valid baselines and drops invalid ones', () => {
    const out = migrate({
      baselines: {
        'squat|main': { weight: 70, setOn: '2026-11-03' },
        'pullUp|accessory': { weight: 0, setOn: '2026-11-03' },
        'bench|main': { weight: -1, setOn: '2026-11-03' },
        'ohp|main': { weight: 'heavy' },
        'row|main': null,
      },
    });
    assert.deepEqual(out.baselines, {
      'squat|main': { weight: 70, setOn: '2026-11-03' },
      'pullUp|accessory': { weight: 0, setOn: '2026-11-03' },
    });
  });

  test('migrate: missing or non-object baselines → {}', () => {
    assert.deepEqual(migrate({}).baselines, {});
    assert.deepEqual(migrate({ baselines: [1, 2] }).baselines, {});
    assert.deepEqual(migrate({ baselines: 'x' }).baselines, {});
  });

  test('migrate keeps setupDone true once set', () => {
    assert.equal(migrate({ settings: { setupDone: true } }).settings.setupDone, true);
    assert.equal(migrate({ settings: {} }).settings.setupDone, false);
  });
});

describe('setBaseline / clearBaseline', () => {
  test('set, replace, clear — never mutating', () => {
    const s0 = defaultState();
    const before = clone(s0);
    const s1 = setBaseline(s0, 'squat', 'main', 70, '2026-11-03');
    assert.deepEqual(s0, before);
    assert.deepEqual(s1.baselines, { 'squat|main': { weight: 70, setOn: '2026-11-03' } });

    const s2 = setBaseline(s1, 'squat', 'main', 72.5, '2026-11-04');
    assert.deepEqual(s2.baselines, { 'squat|main': { weight: 72.5, setOn: '2026-11-04' } });
    assert.deepEqual(s1.baselines, { 'squat|main': { weight: 70, setOn: '2026-11-03' } }, 's1 not mutated');

    const s3 = setBaseline(s2, 'bench', 'accessory', 40, '2026-11-04');
    assert.deepEqual(Object.keys(s3.baselines).sort(), ['bench|accessory', 'squat|main']);

    const s4 = clearBaseline(s3, 'squat', 'main');
    assert.deepEqual(s4.baselines, { 'bench|accessory': { weight: 40, setOn: '2026-11-04' } });
    assert.ok(s3.baselines['squat|main'], 's3 not mutated');
  });

  test('clearing a baseline that does not exist returns an equal copy', () => {
    const s = setBaseline(defaultState(), 'squat', 'main', 70, '2026-11-03');
    assert.deepEqual(clearBaseline(s, 'deadlift', 'main'), s);
  });

  test('invalid weight → equal copy, no throw', () => {
    const s = setBaseline(defaultState(), 'squat', 'main', 70, '2026-11-03');
    for (const w of [-2.5, NaN, Infinity, '80']) assert.deepEqual(setBaseline(s, 'squat', 'main', w, '2026-11-04'), s, String(w));
  });

  test('works on a state from before this feature (no baselines key)', () => {
    const old = defaultState(); delete old.baselines;
    assert.deepEqual(setBaseline(old, 'squat', 'main', 70, '2026-11-03').baselines, { 'squat|main': { weight: 70, setOn: '2026-11-03' } });
    assert.doesNotThrow(() => clearBaseline(old, 'squat', 'main'));
  });
});

describe('consumeBaselines', () => {
  const withSome = () => {
    let s = defaultState();
    s = setBaseline(s, 'squat', 'main', 70, '2026-11-03');
    s = setBaseline(s, 'rdl', 'accessory', 55, '2026-11-03');
    s = setBaseline(s, 'bench', 'main', 65, '2026-11-03');
    s = setBaseline(s, 'bench', 'accessory', 42.5, '2026-11-03');
    return s;
  };

  test('saving a workout uses up the baselines of the exercises in it', () => {
    const state = withSome();
    const before = clone(state);
    const legs = session('2026-11-05', 'legs', [entry('squat', at(70, [5, 5, 5])), entry('rdl', at(55, [10, 10, 9]))]);
    const out = consumeBaselines(state, legs);
    assert.deepEqual(state, before, 'state not mutated');
    assert.deepEqual(Object.keys(out.baselines).sort(), ['bench|accessory', 'bench|main']);
  });

  test('role comes from the day: bench on Push B consumes only the accessory baseline', () => {
    const pushB = session('2026-11-06', 'pushB', [entry('ohp', at(40, [5, 5, 5, 5, 5])), entry('bench', at(42.5, [10, 10, 10]))]);
    const out = consumeBaselines(withSome(), pushB);
    assert.ok(out.baselines['bench|main'], 'main bench baseline kept');
    assert.equal(out.baselines['bench|accessory'], undefined, 'accessory bench baseline used up');
  });

  test('an entry with no reps logged does not use up its baseline', () => {
    const legs = session('2026-11-05', 'legs', [entry('squat', at(70, [0, 0, 0])), entry('rdl', [])]);
    const out = consumeBaselines(withSome(), legs);
    assert.ok(out.baselines['squat|main']);
    assert.ok(out.baselines['rdl|accessory']);
  });

  test('no baselines → equal state', () => {
    const s = defaultState();
    assert.deepEqual(consumeBaselines(s, squat('2026-11-05', 60)), s);
  });
});

describe('convertAllWeights converts baselines too', () => {
  test('kg → lb and back', () => {
    let s = setBaseline(defaultState(), 'squat', 'main', 70, '2026-11-03');
    s = setBaseline(s, 'pullUp', 'accessory', 0, '2026-11-03');
    const lb = convertAllWeights(s, 'lb');
    assert.deepEqual(lb.baselines, {
      'squat|main': { weight: convertWeight(70, 'kg', 'lb'), setOn: '2026-11-03' },
      'pullUp|accessory': { weight: 0, setOn: '2026-11-03' },
    });
    assert.equal(s.baselines['squat|main'].weight, 70, 'input not mutated');
    const back = convertAllWeights(lb, 'kg');
    assert.equal(back.baselines['squat|main'].weight, convertWeight(convertWeight(70, 'kg', 'lb'), 'lb', 'kg'));
  });

  test('a state without a baselines key gets none added', () => {
    const old = defaultState(); delete old.baselines;
    assert.equal('baselines' in convertAllWeights(old, 'lb'), false);
  });
});
