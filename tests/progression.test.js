import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entriesFor, isMainSuccess, suggestMain, deloadWeight, suggestAccessory, warmupSets,
} from '../public/js/progression.js';
import { session, entry, sets, rep, at, clone } from './_helpers.js';

/** One session with a single exercise: weight × each reps value. */
const one = (date, day, exerciseId, weight, repsList, opts) =>
  session(date, day, [entry(exerciseId, at(weight, repsList))], opts);

// main-lift sessions
const benchOk = (date, w, opts) => one(date, 'pushA', 'bench', w, [5, 5, 5, 5, 7], opts);
const benchFail = (date, w, opts) => one(date, 'pushA', 'bench', w, [5, 5, 5, 4, 3], opts);
const squatOk = (date, w, opts) => one(date, 'legs', 'squat', w, [5, 5, 6], opts);
const squatFail = (date, w, opts) => one(date, 'legs', 'squat', w, [5, 5, 3], opts);
const deadOk = (date, w, opts) => one(date, 'pullA', 'deadlift', w, [7], opts);
const deadFail = (date, w, opts) => one(date, 'pullA', 'deadlift', w, [4], opts);

const pick = (r) => ({ weight: r.weight, action: r.action, failStreak: r.failStreak });
const pickAcc = (r) => ({ weight: r.weight, action: r.action });
const itemView = (i) => ({ date: i.date, day: i.day, offDay: i.offDay, sets: i.sets });

const SLOT_8_12 = { sets: 3, repsMin: 8, repsMax: 12 };
const SLOT_15_20 = { sets: 3, repsMin: 15, repsMax: 20 };
const SLOT_ABS = { sets: 3, repsMin: null, repsMax: null };

// ---------------------------------------------------------------- entriesFor

describe('entriesFor', () => {
  const data = [
    session('2026-11-07', 'pushA', [
      entry('bench', rep(5, 62.5, 5)),
      entry('lateralRaise', rep(3, 10, 15)),
      entry('tricepsPushdown', rep(3, 25, 12)),
      entry('lateralRaise', sets([12.5, 12], [12.5, 11], [12.5, 10])),
    ], { offDay: true }),
    session('2026-11-03', 'pushA', [entry('bench', rep(5, 60, 5))]),
    session('2026-11-05', 'pushB', [entry('ohp', rep(5, 40, 5)), entry('bench', rep(3, 50, 10))]),
    session('2026-11-04', 'legs', [entry('squat', rep(3, 100, 5))]),
  ];

  test('returns {date, day, offDay, sets} ascending, filtered by role', () => {
    assert.deepEqual(entriesFor(data, 'bench', 'main').map(itemView), [
      { date: '2026-11-03', day: 'pushA', offDay: false, sets: rep(5, 60, 5) },
      { date: '2026-11-07', day: 'pushA', offDay: true, sets: rep(5, 62.5, 5) },
    ]);
    assert.deepEqual(entriesFor(data, 'bench', 'accessory').map(itemView), [
      { date: '2026-11-05', day: 'pushB', offDay: false, sets: rep(3, 50, 10) },
    ]);
  });

  test('combines repeated entries of the same exercise+role in one session', () => {
    const items = entriesFor(data, 'lateralRaise', 'accessory');
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].sets, [...rep(3, 10, 15), ...sets([12.5, 12], [12.5, 11], [12.5, 10])]);
  });

  test('no matching history → []', () => {
    assert.deepEqual(entriesFor(data, 'deadlift', 'main'), []);
    assert.deepEqual(entriesFor(data, 'squat', 'accessory'), []);
    assert.deepEqual(entriesFor([], 'squat', 'main'), []);
  });

  test('does not mutate its input', () => {
    const before = clone(data);
    entriesFor(data, 'lateralRaise', 'accessory');
    entriesFor(data, 'bench', 'main');
    assert.deepEqual(data, before);
  });
});

// ---------------------------------------------------------------- isMainSuccess

describe('isMainSuccess', () => {
  const item = (repsList) => ({ date: '2026-11-10', day: 'pushA', offDay: false, sets: at(100, repsList) });

  test('all planned sets with ≥5 reps', () => {
    assert.equal(isMainSuccess(item([5, 5, 5, 5, 5]), 5), true);
    assert.equal(isMainSuccess(item([5, 5, 5, 5, 9]), 5), true);
    assert.equal(isMainSuccess(item([6, 6, 6]), 3), true);
    assert.equal(isMainSuccess(item([7]), 1), true);
  });

  test('a planned set under 5 fails', () => {
    assert.equal(isMainSuccess(item([5, 5, 5, 4, 8]), 5), false);
    assert.equal(isMainSuccess(item([4]), 1), false);
    assert.equal(isMainSuccess(item([5, 4, 5]), 3), false);
  });

  test('too few sets fails', () => {
    assert.equal(isMainSuccess(item([5, 5, 5, 5]), 5), false);
    assert.equal(isMainSuccess(item([]), 1), false);
  });

  test('extra sets beyond the plan are ignored', () => {
    assert.equal(isMainSuccess(item([5, 5, 5, 5, 5, 2]), 5), true);
    assert.equal(isMainSuccess(item([5, 3]), 1), true);
  });
});

// ---------------------------------------------------------------- suggestMain

describe('suggestMain: start and increase', () => {
  test('no history → start', () => {
    assert.deepEqual(suggestMain([], 'bench', 'kg'), { weight: null, action: 'start', failStreak: 0, last: null });
  });

  test('history only in an accessory role does not count (bench on pushB)', () => {
    const data = [one('2026-11-05', 'pushB', 'bench', 50, [10, 10, 10])];
    assert.deepEqual(suggestMain(data, 'bench', 'kg'), { weight: null, action: 'start', failStreak: 0, last: null });
  });

  test('success → add the lift\'s increment (kg)', () => {
    assert.deepEqual(pick(suggestMain([benchOk('2026-11-10', 60)], 'bench', 'kg')), { weight: 62.5, action: 'increase', failStreak: 0 });
    assert.deepEqual(pick(suggestMain([squatOk('2026-11-10', 100)], 'squat', 'kg')), { weight: 102.5, action: 'increase', failStreak: 0 });
    assert.deepEqual(pick(suggestMain([deadOk('2026-11-10', 140)], 'deadlift', 'kg')), { weight: 145, action: 'increase', failStreak: 0 });
    assert.deepEqual(pick(suggestMain([one('2026-11-10', 'pushB', 'ohp', 40, [5, 5, 5, 5, 6])], 'ohp', 'kg')), { weight: 42.5, action: 'increase', failStreak: 0 });
    assert.deepEqual(pick(suggestMain([one('2026-11-10', 'pullB', 'barbellRow', 60, [5, 5, 5, 5, 5])], 'barbellRow', 'kg')), { weight: 62.5, action: 'increase', failStreak: 0 });
  });

  test('success → add the lift\'s increment (lb)', () => {
    assert.equal(suggestMain([benchOk('2026-11-10', 135)], 'bench', 'lb').weight, 140);
    assert.equal(suggestMain([squatOk('2026-11-10', 225)], 'squat', 'lb').weight, 230);
    assert.equal(suggestMain([deadOk('2026-11-10', 315)], 'deadlift', 'lb').weight, 325);
  });

  test('w is the max weight of the latest item', () => {
    const ok = session('2026-11-10', 'legs', [entry('squat', sets([100, 5], [100, 5], [102.5, 5]))]);
    assert.equal(suggestMain([ok], 'squat', 'kg').weight, 105);
    const fail = session('2026-11-10', 'legs', [entry('squat', sets([100, 5], [100, 5], [102.5, 3]))]);
    assert.deepEqual(pick(suggestMain([fail], 'squat', 'kg')), { weight: 102.5, action: 'repeat', failStreak: 1 });
  });

  test('uses the latest item: last is that item', () => {
    const data = [benchFail('2026-11-10', 62.5), benchOk('2026-11-03', 60), benchOk('2026-11-07', 60)];
    const r = suggestMain(data, 'bench', 'kg');
    assert.equal(r.last.date, '2026-11-10');
    assert.deepEqual(r.last.sets, at(62.5, [5, 5, 5, 4, 3]));
  });

  test('too few sets is not a success', () => {
    const data = [one('2026-11-10', 'pushA', 'bench', 60, [5, 5, 5, 5])];
    assert.deepEqual(pick(suggestMain(data, 'bench', 'kg')), { weight: 60, action: 'repeat', failStreak: 1 });
  });

  test('an off-day success still counts as a success', () => {
    assert.deepEqual(pick(suggestMain([benchOk('2026-11-10', 60, { offDay: true })], 'bench', 'kg')), { weight: 62.5, action: 'increase', failStreak: 0 });
  });
});

describe('suggestMain: fail streak, repeat, deload', () => {
  test('one and two misses → repeat with the streak count', () => {
    assert.deepEqual(pick(suggestMain([squatFail('2026-11-10', 100)], 'squat', 'kg')), { weight: 100, action: 'repeat', failStreak: 1 });
    assert.deepEqual(
      pick(suggestMain([squatFail('2026-11-07', 100), squatFail('2026-11-10', 100)], 'squat', 'kg')),
      { weight: 100, action: 'repeat', failStreak: 2 },
    );
  });

  test('three misses in a row → deload 10% (spec examples)', () => {
    const three = (mk, w) => [mk('2026-11-01', w), mk('2026-11-04', w), mk('2026-11-07', w)];
    assert.deepEqual(pick(suggestMain(three(squatFail, 100), 'squat', 'kg')), { weight: 90, action: 'deload', failStreak: 3 });
    assert.deepEqual(pick(suggestMain(three(benchFail, 62.5), 'bench', 'kg')), { weight: 55, action: 'deload', failStreak: 3 });
    assert.deepEqual(pick(suggestMain(three(deadFail, 140), 'deadlift', 'kg')), { weight: 125, action: 'deload', failStreak: 3 });
  });

  test('three misses in lb', () => {
    const three = (mk, w) => [mk('2026-11-01', w), mk('2026-11-04', w), mk('2026-11-07', w)];
    assert.equal(suggestMain(three(squatFail, 225), 'squat', 'lb').weight, 200);
    assert.equal(suggestMain(three(benchFail, 135), 'bench', 'lb').weight, 120);
    assert.equal(suggestMain(three(deadFail, 315), 'deadlift', 'lb').weight, 280);
  });

  test('four misses → still deload, streak 4', () => {
    const data = ['2026-11-01', '2026-11-03', '2026-11-05', '2026-11-07'].map((d) => squatFail(d, 100));
    assert.deepEqual(pick(suggestMain(data, 'squat', 'kg')), { weight: 90, action: 'deload', failStreak: 4 });
  });

  test('a success breaks the streak', () => {
    const data = [squatFail('2026-11-01', 100), squatFail('2026-11-03', 100), squatOk('2026-11-05', 100), squatFail('2026-11-07', 100)];
    assert.deepEqual(pick(suggestMain(data, 'squat', 'kg')), { weight: 100, action: 'repeat', failStreak: 1 });
  });

  test('misses at a new weight after a success', () => {
    const data = [squatOk('2026-11-01', 100), squatFail('2026-11-03', 102.5), squatFail('2026-11-05', 102.5)];
    assert.deepEqual(pick(suggestMain(data, 'squat', 'kg')), { weight: 102.5, action: 'repeat', failStreak: 2 });
  });

  test('a different weight breaks the streak', () => {
    const data = [squatFail('2026-11-01', 97.5), squatFail('2026-11-03', 97.5), squatFail('2026-11-05', 100)];
    assert.deepEqual(pick(suggestMain(data, 'squat', 'kg')), { weight: 100, action: 'repeat', failStreak: 1 });
  });

  test('off-day misses are skipped (neither counted nor breaking)', () => {
    const two = [squatFail('2026-11-01', 100), squatFail('2026-11-03', 100, { offDay: true }), squatFail('2026-11-05', 100)];
    assert.deepEqual(pick(suggestMain(two, 'squat', 'kg')), { weight: 100, action: 'repeat', failStreak: 2 });
    const three = [...two, squatFail('2026-11-07', 100)];
    assert.deepEqual(pick(suggestMain(three, 'squat', 'kg')), { weight: 90, action: 'deload', failStreak: 3 });
  });

  test('latest session is an off-day miss → repeat', () => {
    assert.deepEqual(
      pick(suggestMain([squatFail('2026-11-05', 100, { offDay: true })], 'squat', 'kg')),
      { weight: 100, action: 'repeat', failStreak: 0 },
    );
    assert.deepEqual(
      pick(suggestMain([squatFail('2026-11-03', 100), squatFail('2026-11-05', 100, { offDay: true })], 'squat', 'kg')),
      { weight: 100, action: 'repeat', failStreak: 1 },
    );
  });

  test('an off-day success in between breaks the streak', () => {
    const data = [squatFail('2026-11-01', 100), squatOk('2026-11-03', 100, { offDay: true }), squatFail('2026-11-05', 100)];
    assert.deepEqual(pick(suggestMain(data, 'squat', 'kg')), { weight: 100, action: 'repeat', failStreak: 1 });
  });

  test('accessory-role sessions of the same lift do not touch the main streak', () => {
    const data = [
      benchFail('2026-11-01', 100),
      one('2026-11-03', 'pushB', 'bench', 70, [12, 12, 12]),
      benchFail('2026-11-05', 100),
      one('2026-11-07', 'pushB', 'bench', 70, [12, 12, 12]),
      benchFail('2026-11-09', 100),
    ];
    assert.deepEqual(pick(suggestMain(data, 'bench', 'kg')), { weight: 90, action: 'deload', failStreak: 3 });
  });

  test('sorts unsorted input itself and does not mutate it', () => {
    const data = [squatFail('2026-11-07', 100), squatOk('2026-11-01', 97.5), squatFail('2026-11-05', 100), squatFail('2026-11-03', 100)];
    const before = clone(data);
    assert.deepEqual(pick(suggestMain(data, 'squat', 'kg')), { weight: 90, action: 'deload', failStreak: 3 });
    assert.deepEqual(data, before);
    const reordered = [squatFail('2026-11-03', 100), squatOk('2026-11-07', 100), squatFail('2026-11-05', 100)];
    assert.deepEqual(pick(suggestMain(reordered, 'squat', 'kg')), { weight: 102.5, action: 'increase', failStreak: 0 });
  });
});

describe('deloadWeight', () => {
  test('spec examples (kg)', () => {
    assert.equal(deloadWeight(100, 'squat', 'kg'), 90);
    assert.equal(deloadWeight(62.5, 'bench', 'kg'), 55);
    assert.equal(deloadWeight(140, 'deadlift', 'kg'), 125);
  });

  test('more kg cases', () => {
    assert.equal(deloadWeight(40, 'ohp', 'kg'), 35);
    assert.equal(deloadWeight(50, 'barbellRow', 'kg'), 45);
    assert.equal(deloadWeight(102.5, 'squat', 'kg'), 90);
    assert.equal(deloadWeight(150, 'deadlift', 'kg'), 135);
  });

  test('lb uses lb increments', () => {
    assert.equal(deloadWeight(135, 'bench', 'lb'), 120);
    assert.equal(deloadWeight(225, 'squat', 'lb'), 200);
    assert.equal(deloadWeight(315, 'deadlift', 'lb'), 280);
  });
});

// ---------------------------------------------------------------- suggestAccessory

describe('suggestAccessory', () => {
  const lp = (date, w, repsList, opts) => one(date, 'pullA', 'latPulldown', w, repsList, opts);

  test('no history → start', () => {
    assert.deepEqual(suggestAccessory([], 'latPulldown', SLOT_8_12, 'kg'), { weight: null, action: 'start', last: null });
    assert.deepEqual(suggestAccessory([], 'abWheel', SLOT_ABS, 'kg'), { weight: null, action: 'start', last: null });
  });

  test('all prescribed sets at the top of the range → add the accessory increment', () => {
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 45, [12, 12, 12])], 'latPulldown', SLOT_8_12, 'kg')), { weight: 47.5, action: 'increase' });
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 45, [12, 13, 14])], 'latPulldown', SLOT_8_12, 'kg')), { weight: 47.5, action: 'increase' });
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 45, [12, 12, 12, 12])], 'latPulldown', SLOT_8_12, 'kg')), { weight: 47.5, action: 'increase' });
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 100, [12, 12, 12])], 'latPulldown', SLOT_8_12, 'lb')), { weight: 105, action: 'increase' });
  });

  test('not enough sets, or a set below the top → keep', () => {
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 45, [12, 12])], 'latPulldown', SLOT_8_12, 'kg')), { weight: 45, action: 'keep' });
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 45, [12, 12, 11])], 'latPulldown', SLOT_8_12, 'kg')), { weight: 45, action: 'keep' });
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 45, [8, 8, 8])], 'latPulldown', SLOT_8_12, 'kg')), { weight: 45, action: 'keep' });
  });

  test('any set below the bottom → drop the accessory increment', () => {
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 45, [10, 8, 7])], 'latPulldown', SLOT_8_12, 'kg')), { weight: 42.5, action: 'decrease' });
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 100, [9, 7, 6])], 'latPulldown', SLOT_8_12, 'lb')), { weight: 95, action: 'decrease' });
  });

  test('off day: no decrease', () => {
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 45, [7, 7, 7], { offDay: true })], 'latPulldown', SLOT_8_12, 'kg')), { weight: 45, action: 'keep' });
  });

  test('off day with every set at the top still increases', () => {
    assert.deepEqual(pickAcc(suggestAccessory([lp('2026-11-10', 45, [12, 12, 12], { offDay: true })], 'latPulldown', SLOT_8_12, 'kg')), { weight: 47.5, action: 'increase' });
  });

  test('no rep target (abs) → none, weight w', () => {
    const data = [one('2026-11-10', 'pullA', 'plank', 0, [60, 60, 45])];
    assert.deepEqual(pickAcc(suggestAccessory(data, 'plank', SLOT_ABS, 'kg')), { weight: 0, action: 'none' });
    const wheel = [one('2026-11-10', 'legs', 'abWheel', 5, [10, 10, 10])];
    assert.deepEqual(pickAcc(suggestAccessory(wheel, 'abWheel', SLOT_ABS, 'kg')), { weight: 5, action: 'none' });
  });

  test('bodyweight (0): increase suggests added weight; decrease floors at 0', () => {
    const up = [one('2026-11-10', 'pullA', 'pullUp', 0, [12, 12, 12])];
    assert.deepEqual(pickAcc(suggestAccessory(up, 'pullUp', SLOT_8_12, 'kg')), { weight: 2.5, action: 'increase' });
    const down = [one('2026-11-10', 'pullA', 'pullUp', 0, [6, 5, 5])];
    assert.deepEqual(pickAcc(suggestAccessory(down, 'pullUp', SLOT_8_12, 'kg')), { weight: 0, action: 'decrease' });
  });

  test('w is the max weight in the latest item', () => {
    const data = [session('2026-11-10', 'pullA', [entry('latPulldown', sets([45, 12], [47.5, 12], [45, 12]))])];
    assert.deepEqual(pickAcc(suggestAccessory(data, 'latPulldown', SLOT_8_12, 'kg')), { weight: 50, action: 'increase' });
  });

  test('only the latest item decides; last is that item', () => {
    const data = [lp('2026-11-10', 45, [11, 10, 10]), lp('2026-11-03', 45, [12, 12, 12])];
    const r = suggestAccessory(data, 'latPulldown', SLOT_8_12, 'kg');
    assert.deepEqual(pickAcc(r), { weight: 45, action: 'keep' });
    assert.equal(r.last.date, '2026-11-10');
  });

  test('accessory role only: bench on pushB ignores pushA main-lift history', () => {
    const data = [
      benchOk('2026-11-03', 80),
      one('2026-11-05', 'pushB', 'bench', 50, [12, 12, 12]),
      benchOk('2026-11-07', 82.5),
    ];
    assert.deepEqual(pickAcc(suggestAccessory(data, 'bench', SLOT_8_12, 'kg')), { weight: 52.5, action: 'increase' });
    assert.equal(suggestAccessory([benchOk('2026-11-03', 80)], 'bench', SLOT_8_12, 'kg').action, 'start');
  });

  test('increment by role: a deadlift logged as an accessory uses the accessory increment', () => {
    const kg = [one('2026-11-10', 'pullB', 'deadlift', 100, [12, 12, 12])];
    assert.equal(suggestAccessory(kg, 'deadlift', SLOT_8_12, 'kg').weight, 102.5);
    const lb = [one('2026-11-10', 'pullB', 'deadlift', 225, [12, 12, 12])];
    assert.equal(suggestAccessory(lb, 'deadlift', SLOT_8_12, 'lb').weight, 230);
  });

  test('combined entries in one session (side1 + side2 lateral raises)', () => {
    const allTop = [session('2026-11-10', 'pushA', [
      entry('lateralRaise', rep(3, 10, 20)),
      entry('tricepsPushdown', rep(3, 25, 12)),
      entry('lateralRaise', rep(3, 10, 20)),
    ])];
    assert.deepEqual(pickAcc(suggestAccessory(allTop, 'lateralRaise', SLOT_15_20, 'kg')), { weight: 12.5, action: 'increase' });
    const oneLow = [session('2026-11-10', 'pushA', [
      entry('lateralRaise', rep(3, 10, 20)),
      entry('lateralRaise', sets([10, 16], [10, 15], [10, 12])),
    ])];
    assert.deepEqual(pickAcc(suggestAccessory(oneLow, 'lateralRaise', SLOT_15_20, 'kg')), { weight: 7.5, action: 'decrease' });
  });

  test('sorts unsorted input itself and does not mutate it', () => {
    const data = [lp('2026-11-10', 47.5, [12, 12, 12]), lp('2026-11-01', 40, [6, 6, 6]), lp('2026-11-05', 45, [12, 12, 12])];
    const before = clone(data);
    assert.deepEqual(pickAcc(suggestAccessory(data, 'latPulldown', SLOT_8_12, 'kg')), { weight: 50, action: 'increase' });
    assert.deepEqual(data, before);
  });
});

// ---------------------------------------------------------------- warmupSets

describe('warmupSets', () => {
  const ramp = (list) => list.map((s) => [s.weight, s.reps]);

  test('spec example: 100 kg', () => {
    assert.deepEqual(ramp(warmupSets(100, 'kg')), [[20, 10], [50, 10], [70, 5], [90, 3]]);
  });

  test('ramp sets are rounded to the nearest 2.5 kg', () => {
    assert.deepEqual(ramp(warmupSets(60, 'kg')), [[20, 10], [30, 10], [42.5, 5], [55, 3]]);
    assert.deepEqual(ramp(warmupSets(80, 'kg')), [[20, 10], [40, 10], [55, 5], [72.5, 3]]);
  });

  test('ramp sets at or below the bar are dropped', () => {
    assert.deepEqual(ramp(warmupSets(40, 'kg')), [[20, 10], [27.5, 5], [35, 3]]);
    assert.deepEqual(ramp(warmupSets(25, 'kg')), [[20, 10], [22.5, 3]]);
    assert.deepEqual(ramp(warmupSets(22.5, 'kg')), [[20, 10]]);
  });

  test('work weight at or below the bar → just the bar × 10', () => {
    assert.deepEqual(ramp(warmupSets(20, 'kg')), [[20, 10]]);
    assert.deepEqual(ramp(warmupSets(15, 'kg')), [[20, 10]]);
    assert.deepEqual(ramp(warmupSets(45, 'lb')), [[45, 10]]);
  });

  test('null work weight → []', () => {
    assert.deepEqual(warmupSets(null, 'kg'), []);
    assert.deepEqual(warmupSets(null, 'lb'), []);
  });

  test('lb: 45 lb bar, rounded to the nearest 5 lb', () => {
    assert.deepEqual(ramp(warmupSets(200, 'lb')), [[45, 10], [100, 10], [140, 5], [180, 3]]);
    assert.deepEqual(ramp(warmupSets(100, 'lb')), [[45, 10], [50, 10], [70, 5], [90, 3]]);
    assert.deepEqual(ramp(warmupSets(60, 'lb')), [[45, 10], [55, 3]]);
  });

  test('sweep: bar first, then strictly increasing on-grid weights between bar and work weight', () => {
    for (const [unit, bar, step, max] of [['kg', 20, 2.5, 300], ['lb', 45, 5, 660]]) {
      for (let w = bar + step; w <= max; w += step) {
        const r = warmupSets(w, unit);
        assert.deepEqual([r[0].weight, r[0].reps], [bar, 10], `${w} ${unit}`);
        for (let i = 1; i < r.length; i++) {
          assert.ok(r[i].weight > r[i - 1].weight, `${w} ${unit}: increasing, no duplicates`);
          assert.ok(r[i].weight > bar && r[i].weight < w, `${w} ${unit}: between bar and work`);
          assert.equal(r[i].weight % step, 0, `${w} ${unit}: on the ${step} grid`);
          assert.ok([10, 5, 3].includes(r[i].reps), `${w} ${unit}: ramp reps`);
        }
        assert.ok(r.length <= 4);
      }
    }
  });
});
