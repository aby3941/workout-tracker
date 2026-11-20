// Batch 1, §17.3 — timed exercises (plank). The reps field holds seconds; the hold goal is 60 s.
// suggestTimed(sessions, id, slot, unit, { occurrence, steps }) → { weight, action, targetSeconds, last }.
// Written from SPEC.md §17.3 before the code.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES } from '../public/js/program.js';
import * as progression from '../public/js/progression.js';
import { session, entry, at, clone } from './_helpers.js';

const { suggestTimed } = progression;

const ABS = { sets: 3, repsMin: null, repsMax: null }; // abs slots: 3 sets, no rep target
const plank = (date, weight, seconds, opts, day = 'pullA') => session(date, day, [entry('plank', at(weight, seconds))], opts);
const view = (r) => ({ weight: r.weight, action: r.action, targetSeconds: r.targetSeconds });

describe('catalog: plank is timed', () => {
  test('plank has timed: true; no other catalog exercise is timed', () => {
    assert.equal(EXERCISES.plank.timed, true);
    for (const ex of Object.values(EXERCISES)) if (ex.id !== 'plank') assert.ok(!ex.timed, `${ex.id} should not be timed`);
  });
});

describe('suggestTimed', () => {
  test('no history → start, target 30 s', () => {
    const r = suggestTimed([], 'plank', ABS, 'kg');
    assert.equal(r.action, 'start');
    assert.equal(r.targetSeconds, 30);
    assert.equal(r.last ?? null, null);
  });

  test('every planned set ≥ 60 s → increase: weight + step (a plate on the back), target back to 30 s', () => {
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [60, 60, 60])], 'plank', ABS, 'kg')), { weight: 2.5, action: 'increase', targetSeconds: 30 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [60, 75, 90])], 'plank', ABS, 'kg')), { weight: 2.5, action: 'increase', targetSeconds: 30 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 5, [62, 61, 60])], 'plank', ABS, 'kg')), { weight: 7.5, action: 'increase', targetSeconds: 30 });
  });

  test('increase in lb uses the lb step', () => {
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [60, 60, 60])], 'plank', ABS, 'lb')), { weight: 5, action: 'increase', targetSeconds: 30 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 10, [60, 60, 60])], 'plank', ABS, 'lb')), { weight: 15, action: 'increase', targetSeconds: 30 });
  });

  test('otherwise → keep the weight, target = shortest hold last time + 5, at most 60', () => {
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [50, 45, 42])], 'plank', ABS, 'kg')), { weight: 0, action: 'keep', targetSeconds: 47 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [20, 25, 30])], 'plank', ABS, 'kg')), { weight: 0, action: 'keep', targetSeconds: 25 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 2.5, [50, 45, 40])], 'plank', ABS, 'kg')), { weight: 2.5, action: 'keep', targetSeconds: 45 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [60, 60, 59])], 'plank', ABS, 'kg')), { weight: 0, action: 'keep', targetSeconds: 60 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [58, 59, 57])], 'plank', ABS, 'kg')), { weight: 0, action: 'keep', targetSeconds: 60 });
  });

  test('fewer sets than planned is not an increase, even at 60 s', () => {
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [60, 60])], 'plank', ABS, 'kg')), { weight: 0, action: 'keep', targetSeconds: 60 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [10])], 'plank', ABS, 'kg')), { weight: 0, action: 'keep', targetSeconds: 15 });
  });

  test('the planned set count comes from the slot (Cutting: 2 sets)', () => {
    const cut = { sets: 2, repsMin: null, repsMax: null };
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [60, 60])], 'plank', cut, 'kg')), { weight: 2.5, action: 'increase', targetSeconds: 30 });
  });

  test('only the latest session decides; last is that session', () => {
    const data = [plank('2026-11-10', 2.5, [30, 35, 40]), plank('2026-11-03', 0, [60, 60, 60])];
    const r = suggestTimed(data, 'plank', ABS, 'kg');
    assert.deepEqual(view(r), { weight: 2.5, action: 'keep', targetSeconds: 35 });
    assert.equal(r.last.date, '2026-11-10');
    assert.deepEqual(r.last.sets, at(2.5, [30, 35, 40]));
  });

  test('off days don\'t count: a short off-day hold does not pull the target down', () => {
    const data = [plank('2026-11-03', 0, [50, 45, 40]), plank('2026-11-07', 0, [20, 15, 10], { offDay: true })];
    const r = suggestTimed(data, 'plank', ABS, 'kg');
    assert.equal(r.action, 'keep');
    assert.equal(r.weight, 0);
    assert.equal(r.targetSeconds, 45);
  });

  test('{ steps }: the user\'s step for plank', () => {
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [60, 60, 60])], 'plank', ABS, 'kg', { steps: { plank: 5 } })), { weight: 5, action: 'increase', targetSeconds: 30 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 2.5, [60, 60, 60])], 'plank', ABS, 'kg', { steps: { plank: 1.25 } })), { weight: 3.75, action: 'increase', targetSeconds: 30 });
    assert.deepEqual(view(suggestTimed([plank('2026-11-10', 0, [60, 60, 60])], 'plank', ABS, 'kg', { steps: { abWheel: 10 } })), { weight: 2.5, action: 'increase', targetSeconds: 30 });
  });

  test('{ occurrence }: Plank on both abs slots is two tracks', () => {
    const data = [session('2026-11-10', 'legs', [entry('squat', at(60, [5, 5, 5])), entry('plank', at(0, [60, 60, 60])), entry('plank', at(0, [30, 30, 30]))])];
    assert.deepEqual(view(suggestTimed(data, 'plank', ABS, 'kg')), { weight: 2.5, action: 'increase', targetSeconds: 30 });
    assert.deepEqual(view(suggestTimed(data, 'plank', ABS, 'kg', { occurrence: 0 })), { weight: 2.5, action: 'increase', targetSeconds: 30 });
    assert.deepEqual(view(suggestTimed(data, 'plank', ABS, 'kg', { occurrence: 1 })), { weight: 0, action: 'keep', targetSeconds: 35 });
    assert.equal(suggestTimed(data, 'plank', ABS, 'kg', { occurrence: 2 }).action, 'start');
  });

  test('works on every day the abs add-on appears (pullA and legs)', () => {
    assert.equal(suggestTimed([plank('2026-11-10', 0, [60, 60, 60], {}, 'legs')], 'plank', ABS, 'kg').action, 'increase');
    assert.equal(suggestTimed([plank('2026-11-10', 0, [60, 60, 60], {}, 'pullA')], 'plank', ABS, 'kg').action, 'increase');
  });

  test('sorts unsorted input itself and does not mutate it', () => {
    const data = [plank('2026-11-10', 0, [60, 60, 60]), plank('2026-11-01', 0, [20, 20, 20]), plank('2026-11-05', 0, [40, 40, 40])];
    const before = clone(data);
    assert.deepEqual(view(suggestTimed(data, 'plank', ABS, 'kg')), { weight: 2.5, action: 'increase', targetSeconds: 30 });
    assert.deepEqual(data, before);
  });
});

// ------------------------------------------------------------------ added by the independent review (Batch 1)

describe('suggestTimed: offDayIgnored (review fix)', () => {
  test('true when the latest session was an off day that missed the goal and an earlier session decided, so the screen does not call that one "last time"', () => {
    const data = [plank('2026-11-03', 0, [50, 45, 40]), plank('2026-11-07', 0, [20, 15, 10], { offDay: true })];
    const r = suggestTimed(data, 'plank', ABS, 'kg');
    assert.equal(r.offDayIgnored, true);
    assert.equal(r.last.date, '2026-11-03');
    assert.deepEqual(view(r), { weight: 0, action: 'keep', targetSeconds: 45 });
  });

  test('false when the latest session decides: a normal day, an off day that held 60 s, only off days, or no history', () => {
    assert.equal(suggestTimed([plank('2026-11-03', 0, [50, 45, 40])], 'plank', ABS, 'kg').offDayIgnored, false);
    assert.equal(suggestTimed([plank('2026-11-03', 0, [40, 40, 40]), plank('2026-11-07', 0, [60, 60, 60], { offDay: true })], 'plank', ABS, 'kg').offDayIgnored, false);
    const onlyOff = suggestTimed([plank('2026-11-07', 0, [20, 15, 10], { offDay: true })], 'plank', ABS, 'kg');
    assert.equal(onlyOff.offDayIgnored, false);
    assert.equal(onlyOff.last.date, '2026-11-07');
    assert.equal(suggestTimed([], 'plank', ABS, 'kg').offDayIgnored, false);
  });
});
