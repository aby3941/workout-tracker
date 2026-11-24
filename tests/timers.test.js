// The timer rules and "what comes next" (SPEC.md §19.2), moved out of ui/rest.js into the pure timers.js at the
// Batch 3 review (24/11/2026). Entries are Today's form entries ({uid, sets: [{reps}]}); the superset pairs are built
// from the real day plans the way Today does it (`program.supersetPairs`, uids "<slotKey>#<n>").
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as timers from '../public/js/timers.js';
import { getDayPlan, supersetPairs, MAX_WORKOUT_MINUTES } from '../public/js/program.js';

const { usableTimer, timerSeconds, restTaken, setTaken, pairWith, setOrder, nextToDo, nextAfter } = timers;

const S = 1000;
const H = 3600 * S;
const T0 = Date.UTC(2026, 10, 24, 18, 0, 0);

/**
 * A Today form for a day plan: the main lift ('main') then one entry per plan item (uid "<slotKey>#<n>"), `done`
 * reps per uid (an array of set reps, null = empty; missing = all empty), and the superset pairs as [aUid, bUid].
 */
function form(dayId, { choices = {}, goal = 'standard', abs = false, done = {}, extra = [] } = {}) {
  const plan = getDayPlan(dayId, { choices, goal, abs });
  const seen = {};
  const uidOf = new Map();
  const entries = [{ uid: 'main', sets: Array.from({ length: plan.main.sets }, () => ({ reps: null })) }];
  for (const it of plan.items) {
    seen[it.slotKey] = (seen[it.slotKey] ?? -1) + 1;
    const uid = `${it.slotKey}#${seen[it.slotKey]}`;
    uidOf.set(it, uid);
    entries.push({ uid, exerciseId: it.exerciseId, sets: Array.from({ length: it.sets }, () => ({ reps: null })) });
  }
  for (const x of extra) entries.push({ uid: x.uid, exerciseId: x.exerciseId, sets: Array.from({ length: x.sets }, () => ({ reps: null })) });
  for (const [uid, list] of Object.entries(done)) {
    const e = entries.find((x) => x.uid === uid);
    assert.ok(e, `no entry ${uid}`);
    e.sets = list.map((r) => ({ reps: r }));
  }
  const pairs = supersetPairs(plan).map(([a, b]) => [uidOf.get(a), uidOf.get(b)]);
  return { entries, pairs };
}

const all = (n, r = 10) => Array.from({ length: n }, () => r);
const at = (uid, set) => ({ uid, set });

// ---------------------------------------------------------------------------------------------

describe('usableTimer(timer, nowMs)', () => {
  const rest = { kind: 'rest', uid: 'main', set: 0, startedAt: T0, extra: 0 };
  const set = { kind: 'set', uid: 'legs.hinge#0', set: 2, startedAt: T0 };

  test('a rest or set timer of the right shape is returned as is', () => {
    assert.equal(usableTimer(rest), rest);
    assert.equal(usableTimer(set), set);
    assert.ok(usableTimer({ kind: 'rest', uid: 'main', set: 0, startedAt: T0 }, T0), 'a rest timer without extra is usable');
  });

  test('wrong shapes → null', () => {
    for (const bad of [null, undefined, 0, 'x', [], {}, { ...rest, kind: 'pause' }, { ...rest, kind: undefined }, { ...rest, uid: 3 },
      { ...rest, set: -1 }, { ...rest, set: 1.5 }, { ...rest, set: '0' }, { ...rest, startedAt: NaN }, { ...rest, startedAt: '1' },
      { ...rest, extra: -30 }, { ...rest, extra: Infinity }]) {
      assert.equal(usableTimer(bad, T0), null, JSON.stringify(bad));
    }
  });

  test('a set timer ignores "extra" (only rests have it)', () => {
    assert.ok(usableTimer({ ...set, extra: -5 }, T0));
  });

  test('4-hour sitting: exactly 4 h old still runs, a millisecond more is dropped; so is one from the future', () => {
    const limit = MAX_WORKOUT_MINUTES * 60 * S;
    assert.equal(limit, 4 * H);
    assert.ok(usableTimer(rest, T0 + limit));
    assert.equal(usableTimer(rest, T0 + limit + 1), null);
    assert.ok(usableTimer(rest, T0 - limit));
    assert.equal(usableTimer(rest, T0 - limit - 1), null);
    assert.ok(usableTimer(rest), 'no now → shape only');
  });
});

describe('timerSeconds / restTaken / setTaken (§19.1)', () => {
  const tm = { startedAt: T0 };
  test('whole seconds, never below 0', () => {
    assert.equal(timerSeconds(tm, T0), 0);
    assert.equal(timerSeconds(tm, T0 + 999), 0);
    assert.equal(timerSeconds(tm, T0 + 161 * S + 999), 161);
    assert.equal(timerSeconds(tm, T0 - 5 * S), 0);
  });
  test('restTaken: 0–3600 s recorded, more → null', () => {
    assert.equal(restTaken(tm, T0 + 400), 0);
    assert.equal(restTaken(tm, T0 + 161 * S), 161);
    assert.equal(restTaken(tm, T0 + 3600 * S + 999), 3600);
    assert.equal(restTaken(tm, T0 + 3601 * S), null);
  });
  test('setTaken: at least 1 s, up to 3600 s, more → null', () => {
    assert.equal(setTaken(tm, T0), 1);
    assert.equal(setTaken(tm, T0 + 38 * S), 38);
    assert.equal(setTaken(tm, T0 + 3600 * S), 3600);
    assert.equal(setTaken(tm, T0 + 3601 * S), null);
  });
});

describe('pairWith / setOrder: the order sets are done in', () => {
  test('the superset pairs on a Push A form, and pairWith finds either side', () => {
    const { pairs } = form('pushA');
    assert.deepEqual(pairs, [['push.tri1#0', 'push.side1#0'], ['push.tri2#0', 'push.side2#0']]);
    assert.deepEqual(pairWith(pairs, 'push.side1#0'), ['push.tri1#0', 'push.side1#0']);
    assert.deepEqual(pairWith(pairs, 'push.tri2#0'), ['push.tri2#0', 'push.side2#0']);
    assert.equal(pairWith(pairs, 'main'), null);
    assert.equal(pairWith(undefined, 'main'), null);
  });

  test('card by card, set by set; a superset round by round', () => {
    const { entries, pairs } = form('pushA');
    const order = setOrder(entries, pairs).map((p) => `${p.uid}:${p.set + 1}`);
    assert.deepEqual(order, [
      'main:1', 'main:2', 'main:3', 'main:4', 'main:5',
      'pushA.press#0:1', 'pushA.press#0:2', 'pushA.press#0:3',
      'push.incline#0:1', 'push.incline#0:2', 'push.incline#0:3',
      'push.tri1#0:1', 'push.side1#0:1', 'push.tri1#0:2', 'push.side1#0:2', 'push.tri1#0:3', 'push.side1#0:3',
      'push.tri2#0:1', 'push.side2#0:1', 'push.tri2#0:2', 'push.side2#0:2', 'push.tri2#0:3', 'push.side2#0:3',
    ]);
  });

  test('uneven superset: the longer side carries on alone after the last full round', () => {
    const { entries, pairs } = form('pushA', { done: { 'push.side1#0': [null, null, null, null], 'push.tri2#0': [null, null, null, null, null] } });
    const order = setOrder(entries, pairs).map((p) => `${p.uid}:${p.set + 1}`).filter((x) => x.startsWith('push.'));
    assert.deepEqual(order.slice(3), [
      'push.tri1#0:1', 'push.side1#0:1', 'push.tri1#0:2', 'push.side1#0:2', 'push.tri1#0:3', 'push.side1#0:3', 'push.side1#0:4',
      'push.tri2#0:1', 'push.side2#0:1', 'push.tri2#0:2', 'push.side2#0:2', 'push.tri2#0:3', 'push.side2#0:3', 'push.tri2#0:4', 'push.tri2#0:5',
    ]);
  });

  test('the face-pull combo on pull days is one pair; a pair with a card missing is ordered like plain cards', () => {
    const { entries, pairs } = form('pullA', { choices: { 'pull.rear': 'rearDeltFly+bandPullApart' } });
    assert.deepEqual(pairs, [['pull.rear#0', 'pull.rear#1']]);
    const rear = setOrder(entries, pairs).filter((p) => p.uid.startsWith('pull.rear')).map((p) => `${p.uid}:${p.set + 1}`);
    assert.deepEqual(rear.slice(0, 4), ['pull.rear#0:1', 'pull.rear#1:1', 'pull.rear#0:2', 'pull.rear#1:2']);
    const without = entries.filter((e) => e.uid !== 'pull.rear#1');
    const alone = setOrder(without, pairs).filter((p) => p.uid.startsWith('pull.rear')).map((p) => p.set);
    assert.deepEqual(alone, [0, 1, 2, 3, 4]);
  });

  test('every set appears exactly once (goals, abs, extra exercises)', () => {
    for (const day of ['pullA', 'pushA', 'legs', 'pullB', 'pushB']) {
      for (const goal of ['standard', 'strength', 'endurance', 'cut']) {
        const { entries, pairs } = form(day, { goal, abs: true, extra: [{ uid: 'x1', exerciseId: 'custom:zercher squat', sets: 3 }] });
        const order = setOrder(entries, pairs);
        const total = entries.reduce((n, e) => n + e.sets.length, 0);
        assert.equal(order.length, total, `${day}/${goal}`);
        assert.equal(new Set(order.map((p) => `${p.uid}:${p.set}`)).size, total, `${day}/${goal}`);
      }
    }
  });
});

describe('nextToDo: the set that gets the row button "Start set N" (no timer running)', () => {
  test('set 1 of the workout at the start', () => {
    const { entries, pairs } = form('legs');
    assert.deepEqual(nextToDo(entries, pairs), at('main', 0));
  });
  test('the next empty set in order; after a superset a, its b (a cancelled b set timer)', () => {
    let f = form('legs', { done: { main: [5, null, null] } });
    assert.deepEqual(nextToDo(f.entries, f.pairs), at('main', 1));
    f = form('pushA', { done: { main: all(5, 5), 'pushA.press#0': all(3), 'push.incline#0': all(3), 'push.tri1#0': [12, null, null] } });
    assert.deepEqual(nextToDo(f.entries, f.pairs), at('push.side1#0', 0));
  });
  test('nothing left → null', () => {
    const f = form('legs', { done: { main: [5, 5, 7], 'legs.hinge#0': all(3), 'legs.quad#0': all(3), 'legs.ham#0': all(3), 'legs.calf#0': all(5) } });
    assert.equal(nextToDo(f.entries, f.pairs), null);
  });
});

describe('nextAfter: what follows committing a set (§19.2)', () => {
  test('a plain exercise: the next set of the card ("Start set N+1"), then the next card ("Start next exercise")', () => {
    let f = form('legs', { done: { main: [5, null, null] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'main', 0).start, { uid: 'main', set: 1, kind: 'set', recordsRest: true });
    f = form('legs', { done: { main: [5, 5, 7] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'main', 2).start, { uid: 'legs.hinge#0', set: 0, kind: 'next', recordsRest: true });
  });

  test('superset a → b\'s set starts by itself; b → "Start round N+1" on a; the last round → the next exercise', () => {
    const base = { main: all(5, 5), 'pushA.press#0': all(3), 'push.incline#0': all(3) };
    let f = form('pushA', { done: { ...base, 'push.tri1#0': [12, null, null] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'push.tri1#0', 0), { auto: at('push.side1#0', 0) });
    f = form('pushA', { done: { ...base, 'push.tri1#0': [12, null, null], 'push.side1#0': [16, null, null] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'push.side1#0', 0).start, { uid: 'push.tri1#0', set: 1, kind: 'round', recordsRest: true });
    f = form('pushA', { done: { ...base, 'push.tri1#0': all(3), 'push.side1#0': all(3) } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'push.side1#0', 2).start, { uid: 'push.tri2#0', set: 0, kind: 'next', recordsRest: true });
  });

  test('superset a whose b set is already done → the Start target instead (no automatic start)', () => {
    const f = form('pushA', { done: { main: all(5, 5), 'push.tri1#0': [12, null, null], 'push.side1#0': [16, 15, null] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'push.tri1#0', 0).start.uid, 'push.tri1#0');
    assert.equal(nextAfter(f.entries, f.pairs, 'push.tri1#0', 0).auto, undefined);
  });

  test('auto: false asks only for the Start target', () => {
    const f = form('pushA', { done: { 'push.tri1#0': [12, null, null] } });
    const r = nextAfter(f.entries, f.pairs, 'push.tri1#0', 0, { auto: false });
    assert.equal(r.auto, undefined);
    assert.deepEqual(r.start, { uid: 'push.side1#0', set: 0, kind: 'next', recordsRest: false }); // b: no rest (review fix)
  });

  test('the face-pull combo: rear delt fly → band pull-apart by itself; band → "Start round" on rear delt fly', () => {
    const choices = { 'pull.rear': 'rearDeltFly+bandPullApart' };
    let f = form('pullA', { choices, done: { 'pull.rear#0': [20, null, null, null, null] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'pull.rear#0', 0), { auto: at('pull.rear#1', 0) });
    f = form('pullA', { choices, done: { 'pull.rear#0': [20, null, null, null, null], 'pull.rear#1': [20, null, null, null, null] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'pull.rear#1', 0).start, { uid: 'pull.rear#0', set: 1, kind: 'round', recordsRest: true });
  });

  test('wrap-around: after the last card, back to a set left earlier', () => {
    const f = form('legs', { done: { main: [5, null, 7], 'legs.hinge#0': all(3), 'legs.quad#0': all(3), 'legs.ham#0': all(3), 'legs.calf#0': all(5) } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'legs.calf#0', 4).start, { uid: 'main', set: 1, kind: 'next', recordsRest: true });
  });

  test('nothing left → start null; an entry not on the form → start null', () => {
    const f = form('legs', { done: { main: [5, 5, 7], 'legs.hinge#0': all(3), 'legs.quad#0': all(3), 'legs.ham#0': all(3), 'legs.calf#0': all(5) } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'legs.calf#0', 4), { start: null });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'gone#0', 0), { start: null });
  });

  test('after Skip / Cancel nothing is stored, so the target is the same as before', () => {
    const f = form('legs', { done: { main: [5, null, null] } });
    const before = nextAfter(f.entries, f.pairs, 'main', 0);
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'main', 0), before);
  });

  test('swaps keep the pairs: front raise, a custom triceps exercise, the same triceps exercise twice', () => {
    for (const choices of [{ 'push.side1': 'frontRaise' }, { 'push.tri1': 'custom:Cable kickback' }, { 'push.tri1': 'ohTricepsExt' }]) {
      const f = form('pushB', { choices, done: { 'push.tri1#0': [12, null, null] } });
      assert.deepEqual(f.pairs, [['push.tri1#0', 'push.side1#0'], ['push.tri2#0', 'push.side2#0']], JSON.stringify(choices));
      assert.deepEqual(nextAfter(f.entries, f.pairs, 'push.tri1#0', 0), { auto: at('push.side1#0', 0) }, JSON.stringify(choices));
    }
  });

  test('a custom exercise added at the end is a plain card: its sets follow the plan, then wrap', () => {
    const f = form('legs', {
      extra: [{ uid: 'x1', exerciseId: 'custom:zercher squat', sets: 2 }],
      done: { main: [5, 5, 7], 'legs.hinge#0': all(3), 'legs.quad#0': all(3), 'legs.ham#0': all(3), 'legs.calf#0': all(5) },
    });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'legs.calf#0', 4).start, { uid: 'x1', set: 0, kind: 'next', recordsRest: true });
    f.entries.find((e) => e.uid === 'x1').sets[0].reps = 8;
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'x1', 0).start, { uid: 'x1', set: 1, kind: 'set', recordsRest: true });
  });

  test('does not mutate its input', () => {
    const f = form('pushA', { done: { 'push.tri1#0': [12, null, null] } });
    const copy = structuredClone(f);
    nextAfter(f.entries, f.pairs, 'push.tri1#0', 0);
    nextToDo(f.entries, f.pairs);
    setOrder(f.entries, f.pairs);
    assert.deepEqual(f, copy);
  });
});

// ---------------------------------------------------------------------------------------------
// Review fixes (24/11/2026). Each failed before its fix.

describe('a superset\'s second exercise (b) never carries a rest (§19.1): the Start target says whether the rest is recorded', () => {
  const base = { main: all(5, 5), 'pushA.press#0': all(3), 'push.incline#0': all(3) };

  test('round, next set and next exercise targets record the rest', () => {
    let f = form('pushA', { done: { ...base, 'push.tri1#0': [12, null, null], 'push.side1#0': [16, null, null] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'push.side1#0', 0).start, { uid: 'push.tri1#0', set: 1, kind: 'round', recordsRest: true });
    f = form('legs', { done: { main: [5, null, null] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'main', 0).start, { uid: 'main', set: 1, kind: 'set', recordsRest: true });
    f = form('legs', { done: { main: [5, 5, 7] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'main', 2).start, { uid: 'legs.hinge#0', set: 0, kind: 'next', recordsRest: true });
  });

  test('uneven pair: b\'s extra set after the last round starts without a rest ("Start set 4" on Lateral raise)', () => {
    const f = form('pushA', { done: { ...base, 'push.tri1#0': all(3), 'push.side1#0': [16, 15, 15, null] } });
    assert.deepEqual(nextAfter(f.entries, f.pairs, 'push.side1#0', 2).start, { uid: 'push.side1#0', set: 3, kind: 'set', recordsRest: false });
  });

  test('a rest box under a\'s set whose b set is still empty (a Batch 2 rest timer migrated under a pushdown set, §19.1): b starts without a rest', () => {
    const f = form('pushA', { done: { ...base, 'push.tri1#0': [12, null, null] } });
    const { start } = nextAfter(f.entries, f.pairs, 'push.tri1#0', 0, { auto: false });
    assert.equal(start.uid, 'push.side1#0');
    assert.equal(start.recordsRest, false);
  });

  test('"Start next exercise" that lands on b (its a set done earlier, b\'s cancelled): no rest on b', () => {
    const f = form('pushA', { done: { main: all(5, 5), 'pushA.press#0': all(3), 'push.incline#0': [10, 10, null], 'push.tri1#0': [12, null, null] } });
    f.entries.find((e) => e.uid === 'push.incline#0').sets[2].reps = 10;
    const { start } = nextAfter(f.entries, f.pairs, 'push.incline#0', 2);
    assert.deepEqual(start, { uid: 'push.side1#0', set: 0, kind: 'next', recordsRest: false });
  });
});

describe('nextToDo(entries, pairs, from): after Skip / Cancel the row button stays where the workout is (DECISIONS: sets left earlier come at the end)', () => {
  test('a Skip on the rest after Romanian deadlift set 1, with Squat set 2 left earlier → Romanian deadlift set 2, not back to Squat', () => {
    const f = form('legs', { done: { main: [5, null, 7], 'legs.hinge#0': [10, null, null] } });
    assert.deepEqual(nextToDo(f.entries, f.pairs, at('legs.hinge#0', 0)), at('legs.hinge#0', 1));
  });

  test('a cancelled set timer → that same set', () => {
    const f = form('legs', { done: { main: [5, null, 7], 'legs.hinge#0': [10, null, null] } });
    assert.deepEqual(nextToDo(f.entries, f.pairs, at('legs.hinge#0', 1)), at('legs.hinge#0', 1));
  });

  test('everything after it done → wraps round to the set left earlier', () => {
    const f = form('legs', { done: { main: [5, null, 7], 'legs.hinge#0': all(3), 'legs.quad#0': all(3), 'legs.ham#0': all(3), 'legs.calf#0': all(5) } });
    assert.deepEqual(nextToDo(f.entries, f.pairs, at('legs.calf#0', 4)), at('main', 1));
  });

  test('superset: a cancelled b set timer → b\'s set (round by round)', () => {
    const f = form('pushA', { done: { 'push.tri1#0': [12, null, null] } });
    assert.deepEqual(nextToDo(f.entries, f.pairs, at('push.side1#0', 0)), at('push.side1#0', 0));
  });

  test('no position (a fresh form, a reload) or one no longer on the form → from the top, as before', () => {
    const f = form('legs', { done: { main: [5, null, 7], 'legs.hinge#0': [10, null, null] } });
    assert.deepEqual(nextToDo(f.entries, f.pairs), at('main', 1));
    assert.deepEqual(nextToDo(f.entries, f.pairs, null), at('main', 1));
    assert.deepEqual(nextToDo(f.entries, f.pairs, at('gone#0', 0)), at('main', 1));
    assert.deepEqual(nextToDo(f.entries, f.pairs, at('main', 9)), at('main', 1));
  });

  test('nothing left → null, from anywhere', () => {
    const f = form('legs', { done: { main: [5, 5, 7], 'legs.hinge#0': all(3), 'legs.quad#0': all(3), 'legs.ham#0': all(3), 'legs.calf#0': all(5) } });
    assert.equal(nextToDo(f.entries, f.pairs, at('legs.hinge#0', 0)), null);
  });
});
