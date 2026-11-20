// Batch 1, §17.1 — repeated exercises are separate tracks (exerciseId, role, occurrence).
// Nothing is combined any more: the first Lateral raise of a Push day is occurrence 0 (with pushdowns),
// the second is occurrence 1 (with extensions). Written from SPEC.md §17.1 before the code.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getDayPlan, SLOTS } from '../public/js/program.js';
import * as progression from '../public/js/progression.js';
import * as analysis from '../public/js/analysis.js';
import { defaultState, setBaseline, consumeBaselines } from '../public/js/store.js';
import { session, entry, sets, rep, at, clone } from './_helpers.js';

const { entriesFor, suggestAccessory, suggestMain, baselineKey } = progression;
const { series, personalBests, exercisesInData, watchList } = analysis;

const SIDE = { sets: 3, repsMin: 15, repsMax: 20 }; // push.side1 / push.side2: 3×15–20
const pickAcc = (r) => ({ weight: r.weight, action: r.action });
const view = (p) => ({ date: p.date, topWeight: p.topWeight, bestE1rm: p.bestE1rm, volume: p.volume });

/** The spec's example Push day: #1 8 kg × 15,15,14 (with pushdowns), #2 6 kg × 20,20,20 (with extensions). */
const PUSH_EXAMPLE = (date = '2026-11-17', day = 'pushA') => session(date, day, [
  entry(day === 'pushA' ? 'bench' : 'ohp', rep(5, 50, 5)),
  entry(day === 'pushA' ? 'ohp' : 'bench', rep(3, 30, 10)),
  entry('inclineDbPress', rep(3, 20, 10)),
  entry('tricepsPushdown', rep(3, 25, 12)),
  entry('lateralRaise', at(8, [15, 15, 14])),
  entry('ohTricepsExt', rep(3, 15, 12)),
  entry('lateralRaise', at(6, [20, 20, 20])),
]);

/** Option id of a single-exercise option in a slot. */
const opt = (slotKey, exerciseId) => SLOTS[slotKey].options.find((o) => o.exercises.length === 1 && o.exercises[0] === exerciseId).id;

// ---------------------------------------------------------------- getDayPlan occurrence

describe('getDayPlan: items carry their occurrence', () => {
  test('Push A / Push B: push.side1 → 0, push.side2 → 1, everything else → 0', () => {
    for (const day of ['pushA', 'pushB']) {
      const plan = getDayPlan(day);
      const bySlot = Object.fromEntries(plan.items.map((i) => [i.slotKey, i]));
      assert.equal(bySlot['push.side1'].exerciseId, 'lateralRaise', day);
      assert.equal(bySlot['push.side2'].exerciseId, 'lateralRaise', day);
      assert.equal(bySlot['push.side1'].occurrence, 0, `${day} push.side1`);
      assert.equal(bySlot['push.side2'].occurrence, 1, `${day} push.side2`);
      for (const it of plan.items.filter((i) => !['push.side1', 'push.side2'].includes(i.slotKey))) {
        assert.equal(it.occurrence, 0, `${day} ${it.slotKey}`);
      }
    }
  });

  test('pull and legs days (abs on or off, every goal): every item is occurrence 0', () => {
    for (const day of ['pullA', 'pullB', 'legs']) {
      for (const abs of [false, true]) {
        for (const goal of ['standard', 'strength', 'endurance', 'cut']) {
          for (const it of getDayPlan(day, { abs, goal }).items) assert.equal(it.occurrence, 0, `${day} abs=${abs} ${goal} ${it.slotKey}`);
        }
      }
    }
  });

  test('the combo option (two different exercises in one slot) is occurrence 0 for both', () => {
    const plan = getDayPlan('pullA', { choices: { 'pull.rear': 'rearDeltFly+bandPullApart' } });
    const rear = plan.items.filter((i) => i.slotKey === 'pull.rear');
    assert.equal(rear.length, 2);
    assert.deepEqual(rear.map((i) => i.occurrence), [0, 0]);
  });

  test('occurrence counts items with the same exerciseId: swapping side1 to Front raise makes side2 Lateral raise occurrence 0', () => {
    const plan = getDayPlan('pushA', { choices: { 'push.side1': opt('push.side1', 'frontRaise') } });
    const s1 = plan.items.find((i) => i.slotKey === 'push.side1');
    const s2 = plan.items.find((i) => i.slotKey === 'push.side2');
    assert.deepEqual([s1.exerciseId, s1.occurrence], ['frontRaise', 0]);
    assert.deepEqual([s2.exerciseId, s2.occurrence], ['lateralRaise', 0]);
  });

  test('the same pick on two slots: 0 then 1, in plan order (Front raise twice, Overhead triceps extension twice)', () => {
    const plan = getDayPlan('pushB', {
      choices: {
        'push.side1': opt('push.side1', 'frontRaise'), 'push.side2': opt('push.side2', 'frontRaise'),
        'push.tri1': opt('push.tri1', 'ohTricepsExt'),
      },
    });
    const occ = (slotKey) => plan.items.find((i) => i.slotKey === slotKey);
    assert.deepEqual([occ('push.side1').exerciseId, occ('push.side1').occurrence], ['frontRaise', 0]);
    assert.deepEqual([occ('push.side2').exerciseId, occ('push.side2').occurrence], ['frontRaise', 1]);
    assert.deepEqual([occ('push.tri1').exerciseId, occ('push.tri1').occurrence], ['ohTricepsExt', 0]);
    assert.deepEqual([occ('push.tri2').exerciseId, occ('push.tri2').occurrence], ['ohTricepsExt', 1]);
  });

  test('Plank picked on both abs slots: 0 and 1; the same custom name on both side slots: 0 and 1', () => {
    const abs = getDayPlan('legs', { abs: true, choices: { 'abs.1': opt('abs.1', 'plank'), 'abs.2': opt('abs.2', 'plank') } });
    assert.deepEqual(abs.items.filter((i) => i.exerciseId === 'plank').map((i) => [i.slotKey, i.occurrence]), [['abs.1', 0], ['abs.2', 1]]);
    const custom = getDayPlan('pushA', { choices: { 'push.side1': 'custom:Cable Y-raise', 'push.side2': 'custom:Cable Y-raise' } });
    const ys = custom.items.filter((i) => i.name === 'Cable Y-raise');
    assert.equal(ys.length, 2);
    assert.equal(ys[0].exerciseId, ys[1].exerciseId);
    assert.deepEqual(ys.map((i) => [i.slotKey, i.occurrence]), [['push.side1', 0], ['push.side2', 1]]);
  });

  test('the main lift is its own role: Push A\'s accessory Overhead press and Push B\'s accessory Bench press are occurrence 0', () => {
    assert.equal(getDayPlan('pushA').items.find((i) => i.slotKey === 'pushA.press').occurrence, 0);
    assert.equal(getDayPlan('pushB').items.find((i) => i.slotKey === 'pushB.press').occurrence, 0);
  });
});

// ---------------------------------------------------------------- entriesFor

describe('entriesFor per occurrence (nothing is combined)', () => {
  const older = session('2026-11-10', 'pushB', [entry('ohp', rep(5, 40, 5)), entry('lateralRaise', at(7.5, [16, 16, 16]))]);
  const data = [PUSH_EXAMPLE('2026-11-17'), older];

  test('default occurrence 0: only the first entry of each session', () => {
    const items = entriesFor(data, 'lateralRaise', 'accessory');
    assert.deepEqual(items.map((i) => [i.date, i.sets]), [
      ['2026-11-10', at(7.5, [16, 16, 16])],
      ['2026-11-17', at(8, [15, 15, 14])],
    ]);
    assert.deepEqual(entriesFor(data, 'lateralRaise', 'accessory', 0), items);
  });

  test('occurrence 1: the second entry; sessions without one are skipped', () => {
    const items = entriesFor(data, 'lateralRaise', 'accessory', 1);
    assert.deepEqual(items.map((i) => ({ date: i.date, day: i.day, offDay: i.offDay, sets: i.sets })), [
      { date: '2026-11-17', day: 'pushA', offDay: false, sets: at(6, [20, 20, 20]) },
    ]);
  });

  test('an occurrence that was never logged → []', () => {
    assert.deepEqual(entriesFor(data, 'lateralRaise', 'accessory', 2), []);
    assert.deepEqual(entriesFor(data, 'tricepsPushdown', 'accessory', 1), []);
  });

  test('occurrence is counted within the role: bench as Push B accessory is occurrence 0 there', () => {
    const d = [session('2026-11-05', 'pushB', [entry('ohp', rep(5, 40, 5)), entry('bench', rep(3, 50, 10))])];
    assert.deepEqual(entriesFor(d, 'bench', 'accessory', 0).map((i) => i.sets), [rep(3, 50, 10)]);
    assert.deepEqual(entriesFor(d, 'bench', 'main', 0), []);
  });

  test('a main lift logged twice in one session: two main tracks', () => {
    const d = [session('2026-11-05', 'pushA', [entry('bench', rep(5, 60, 5)), entry('bench', sets([70, 3]))])];
    assert.deepEqual(entriesFor(d, 'bench', 'main').map((i) => i.sets), [rep(5, 60, 5)]);
    assert.deepEqual(entriesFor(d, 'bench', 'main', 1).map((i) => i.sets), [sets([70, 3])]);
  });

  test('does not mutate its input', () => {
    const before = clone(data);
    entriesFor(data, 'lateralRaise', 'accessory', 1);
    assert.deepEqual(data, before);
  });
});

// ---------------------------------------------------------------- suggestions per occurrence

describe('suggestAccessory per occurrence — the spec\'s lateral-raise example', () => {
  const data = [PUSH_EXAMPLE()];

  test('#1 8 kg × 15,15,14 → go lighter → 5.5 (a set fell under 15, the §5 rule; default occurrence 0)', () => {
    assert.deepEqual(pickAcc(suggestAccessory(data, 'lateralRaise', SIDE, 'kg')), { weight: 5.5, action: 'decrease' });
    assert.deepEqual(pickAcc(suggestAccessory(data, 'lateralRaise', SIDE, 'kg', { occurrence: 0 })), { weight: 5.5, action: 'decrease' });
  });

  test('#2 6 kg × 20,20,20 → add 2.5 → 8.5 (occurrence 1)', () => {
    const r = suggestAccessory(data, 'lateralRaise', SIDE, 'kg', { occurrence: 1 });
    assert.deepEqual(pickAcc(r), { weight: 8.5, action: 'increase' });
    assert.deepEqual(r.last.sets, at(6, [20, 20, 20]));
  });

  test('the old bug is gone: the two cards get their own, different advice (#2 no longer copies #1)', () => {
    const r0 = suggestAccessory(data, 'lateralRaise', SIDE, 'kg', { occurrence: 0 });
    const r1 = suggestAccessory(data, 'lateralRaise', SIDE, 'kg', { occurrence: 1 });
    assert.deepEqual(pickAcc(r0), { weight: 5.5, action: 'decrease' });
    assert.deepEqual(pickAcc(r1), { weight: 8.5, action: 'increase' });
    assert.notDeepEqual(pickAcc(r0), pickAcc(r1));
  });

  test('each track uses its own latest session: a later session with only one lateral raise does not touch #2', () => {
    const later = session('2026-11-24', 'pushB', [entry('ohp', rep(5, 40, 5)), entry('lateralRaise', at(8, [20, 20, 20]))]);
    const both = [later, PUSH_EXAMPLE('2026-11-17')];
    assert.deepEqual(pickAcc(suggestAccessory(both, 'lateralRaise', SIDE, 'kg', { occurrence: 0 })), { weight: 10.5, action: 'increase' });
    const r1 = suggestAccessory(both, 'lateralRaise', SIDE, 'kg', { occurrence: 1 });
    assert.deepEqual(pickAcc(r1), { weight: 8.5, action: 'increase' });
    assert.equal(r1.last.date, '2026-11-17');
  });

  test('an occurrence with no history → start', () => {
    const one = [session('2026-11-17', 'pushA', [entry('lateralRaise', at(8, [15, 15, 14]))])];
    assert.deepEqual(suggestAccessory(one, 'lateralRaise', SIDE, 'kg', { occurrence: 1 }), { weight: null, action: 'start', last: null });
  });

  test('lb works per occurrence too', () => {
    const lb = [session('2026-11-17', 'pushA', [entry('lateralRaise', at(17.5, [15, 15, 14])), entry('lateralRaise', at(12.5, [20, 20, 20]))])];
    assert.deepEqual(pickAcc(suggestAccessory(lb, 'lateralRaise', SIDE, 'lb', { occurrence: 0 })), { weight: 12.5, action: 'decrease' });
    assert.deepEqual(pickAcc(suggestAccessory(lb, 'lateralRaise', SIDE, 'lb', { occurrence: 1 })), { weight: 17.5, action: 'increase' });
  });

  test('does not mutate its input', () => {
    const before = clone(data);
    suggestAccessory(data, 'lateralRaise', SIDE, 'kg', { occurrence: 1 });
    assert.deepEqual(data, before);
  });
});

describe('suggestMain per occurrence', () => {
  // A back-off or heavy single logged as a second entry is its own track; it no longer changes the main one.
  const data = [session('2026-11-05', 'pushA', [entry('bench', rep(5, 60, 5)), entry('bench', sets([70, 3]))])];

  test('occurrence 0 (default) looks only at the first entry', () => {
    const r = suggestMain(data, 'bench', 'kg');
    assert.deepEqual({ weight: r.weight, action: r.action, failStreak: r.failStreak }, { weight: 62.5, action: 'increase', failStreak: 0 });
    assert.deepEqual(r.last.sets, rep(5, 60, 5));
    assert.equal(suggestMain(data, 'bench', 'kg', { occurrence: 0 }).weight, 62.5);
  });

  test('occurrence 1 is a track of its own', () => {
    const r = suggestMain(data, 'bench', 'kg', { occurrence: 1 });
    assert.deepEqual({ weight: r.weight, action: r.action, failStreak: r.failStreak }, { weight: 70, action: 'repeat', failStreak: 1 });
  });
});

// ---------------------------------------------------------------- baselines per occurrence

describe('baselineKey per occurrence (backward compatible)', () => {
  test('occurrence 0 (or omitted) keeps the existing "id|role" format', () => {
    assert.equal(baselineKey('lateralRaise', 'accessory'), 'lateralRaise|accessory');
    assert.equal(baselineKey('lateralRaise', 'accessory', 0), 'lateralRaise|accessory');
    assert.equal(baselineKey('squat', 'main', 0), 'squat|main');
  });

  test('occurrence n > 0 → "id|role|n"', () => {
    assert.equal(baselineKey('lateralRaise', 'accessory', 1), 'lateralRaise|accessory|1');
    assert.equal(baselineKey('plank', 'accessory', 2), 'plank|accessory|2');
    assert.notEqual(baselineKey('lateralRaise', 'accessory', 1), baselineKey('lateralRaise', 'accessory', 0));
  });

  test('a set weight stored before Batch 1 is still found for occurrence 0', () => {
    const state = setBaseline(defaultState(), 'lateralRaise', 'accessory', 9, '2026-11-01');
    assert.deepEqual(state.baselines[baselineKey('lateralRaise', 'accessory', 0)], { weight: 9, setOn: '2026-11-01' });
    assert.equal(state.baselines[baselineKey('lateralRaise', 'accessory', 1)], undefined);
  });
});

describe('consumeBaselines uses each saved entry\'s occurrence', () => {
  const withBoth = () => ({
    ...defaultState(),
    baselines: {
      'lateralRaise|accessory': { weight: 8, setOn: '2026-11-16' },
      'lateralRaise|accessory|1': { weight: 6, setOn: '2026-11-16' },
      'bench|main': { weight: 52.5, setOn: '2026-11-16' },
    },
  });

  test('one lateral raise saved → only occurrence 0 is used up', () => {
    const s = session('2026-11-17', 'pushA', [entry('lateralRaise', at(8, [15, 15, 14]))]);
    const state = withBoth();
    const before = clone(state);
    const out = consumeBaselines(state, s);
    assert.deepEqual(Object.keys(out.baselines).sort(), ['bench|main', 'lateralRaise|accessory|1']);
    assert.deepEqual(state, before, 'state not mutated');
  });

  test('both lateral raises saved → both used up; other baselines stay', () => {
    const out = consumeBaselines(withBoth(), PUSH_EXAMPLE('2026-11-17', 'pushB'));
    assert.deepEqual(Object.keys(out.baselines).sort(), ['bench|main']);
  });

  test('the main lift saved → its occurrence-0 key ("bench|main") is used up', () => {
    const out = consumeBaselines(withBoth(), session('2026-11-17', 'pushA', [entry('bench', rep(5, 52.5, 5))]));
    assert.deepEqual(Object.keys(out.baselines).sort(), ['lateralRaise|accessory', 'lateralRaise|accessory|1']);
  });
});

// ---------------------------------------------------------------- analysis per track

describe('analysis: one row per track', () => {
  const DATA = [
    session('2026-11-07', 'pushA', [
      entry('bench', rep(5, 62.5, 5)),
      entry('lateralRaise', rep(3, 10, 15)),
      entry('lateralRaise', rep(3, 12.5, 12)),
    ]),
    session('2026-11-03', 'pushA', [entry('bench', [...rep(4, 60, 5), { weight: 60, reps: 8 }])]),
    session('2026-11-05', 'pushB', [entry('ohp', rep(5, 40, 5)), entry('bench', rep(3, 50, 10))]),
  ];
  const key = (x) => `${x.exerciseId}|${x.role}|${x.occurrence}`;

  test('series per occurrence (default 0)', () => {
    assert.deepEqual(series(DATA, 'lateralRaise', 'accessory').map(view), [{ date: '2026-11-07', topWeight: 10, bestE1rm: 15, volume: 450 }]);
    assert.deepEqual(series(DATA, 'lateralRaise', 'accessory', 0).map(view), [{ date: '2026-11-07', topWeight: 10, bestE1rm: 15, volume: 450 }]);
    assert.deepEqual(series(DATA, 'lateralRaise', 'accessory', 1).map(view), [{ date: '2026-11-07', topWeight: 12.5, bestE1rm: 17.5, volume: 450 }]);
    assert.deepEqual(series(DATA, 'lateralRaise', 'accessory', 2), []);
  });

  test('exercisesInData: one row per (exerciseId, role, occurrence), each with its occurrence', () => {
    const rows = exercisesInData(DATA);
    assert.deepEqual(rows.map(key).sort(), [
      'bench|accessory|0', 'bench|main|0', 'lateralRaise|accessory|0', 'lateralRaise|accessory|1', 'ohp|main|0',
    ]);
    const lr0 = rows.find((r) => key(r) === 'lateralRaise|accessory|0');
    assert.equal(lr0.name, 'Lateral raise');
  });

  test('personalBests: one row per track, with occurrence, from that track only', () => {
    const pbs = personalBests(DATA);
    assert.equal(pbs.length, 5);
    const find = (k) => {
      const hit = pbs.filter((p) => key(p) === k);
      assert.equal(hit.length, 1, k);
      return hit[0];
    };
    const lr0 = find('lateralRaise|accessory|0');
    const lr1 = find('lateralRaise|accessory|1');
    assert.deepEqual([lr0.bestWeight, lr0.bestWeightDate, lr0.bestE1rm], [10, '2026-11-07', 15]);
    assert.deepEqual([lr1.bestWeight, lr1.bestWeightDate, lr1.bestE1rm], [12.5, '2026-11-07', 17.5]);
    assert.equal(find('bench|main|0').bestWeight, 62.5);
  });

  test('watchList: rows include occurrence; a second main-lift entry is its own track', () => {
    const missRows = [
      session('2026-11-01', 'legs', [entry('squat', at(100, [5, 5, 3]))]),
      session('2026-11-04', 'legs', [entry('squat', at(100, [5, 5, 4]))]),
    ];
    assert.deepEqual(watchList(missRows, 'kg').map((w) => ({ exerciseId: w.exerciseId, occurrence: w.occurrence, failStreak: w.failStreak, action: w.action })), [
      { exerciseId: 'squat', occurrence: 0, failStreak: 2, action: 'repeat' },
    ]);
    // First bench entry a success; a second bench entry (2 sets) is a miss on its own track.
    const twoBench = [session('2026-11-02', 'pushA', [entry('bench', rep(5, 60, 5)), entry('bench', at(40, [5, 4]))])];
    assert.deepEqual(watchList(twoBench, 'kg').map((w) => ({ exerciseId: w.exerciseId, occurrence: w.occurrence, weight: w.weight, failStreak: w.failStreak, action: w.action })), [
      { exerciseId: 'bench', occurrence: 1, weight: 40, failStreak: 1, action: 'repeat' },
    ]);
  });
});
