// Batch 3 (SPEC.md §19, owner approved 24/11/2026) — unit tests written from the spec before the code.
// Recorded rest and set times on sets, superset pairs, the CSV / text backup formats, formatClock / parseClock,
// restSummary and the storage meter. New exports are reached through namespace imports, so a missing function fails
// its own tests only.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as program from '../public/js/program.js';
import * as analysis from '../public/js/analysis.js';
import * as store from '../public/js/store.js';
import * as csv from '../public/js/csv.js';
import * as parser from '../public/js/parser.js';
import * as dates from '../public/js/dates.js';
import { session, entry, rep, clone } from './_helpers.js';

const TODAY = '2026-11-24';

/** One set; `rest` / `duration` (whole seconds, §19.1) only when given. */
const T = (weight, reps, rest, duration) => ({
  weight, reps, ...(rest != null ? { rest } : {}), ...(duration != null ? { duration } : {}),
});

const byDateDay = (a, b) => (`${a.date}|${a.day}` < `${b.date}|${b.day}` ? -1 : `${a.date}|${a.day}` > `${b.date}|${b.day}` ? 1 : 0);

/**
 * Comparable form of sessions that keeps the recorded rest / set time of every set (absent and null both mean
 * "not recorded"), workout times, note and off day; ids dropped; `name` only for custom exercises.
 */
const withTimers = (list) => [...list].map((s) => ({
  date: s.date,
  day: s.day,
  offDay: Boolean(s.offDay),
  note: s.note ?? '',
  ...(s.startedAt ? { startedAt: s.startedAt } : {}),
  ...(s.finishedAt ? { finishedAt: s.finishedAt } : {}),
  entries: s.entries.map((e) => ({
    exerciseId: e.exerciseId,
    ...(String(e.exerciseId).startsWith('custom:') ? { name: e.name } : {}),
    sets: e.sets.map((st) => T(st.weight, st.reps, st.rest, st.duration)),
  })),
})).sort(byDateDay);

/** [[rest, duration], …] per set (null = not recorded). */
const timing = (setList) => setList.map((st) => [st.rest ?? null, st.duration ?? null]);

/** Is this a value §19.1 allows? rest 0–3600, duration 1–3600, whole seconds. */
const validRest = (v) => Number.isInteger(v) && v >= 0 && v <= 3600;
const validDuration = (v) => Number.isInteger(v) && v >= 1 && v <= 3600;

/** Workouts with recorded rests and set times: gaps, edge values, a superset pair, the face-pull combo, a custom
 *  exercise, a timed plank, one entry with nothing recorded, and a workout logged before Batch 3. */
const timerSessions = () => [
  {
    ...session('2026-11-10', 'legs', [
      entry('squat', [T(82.5, 5, null, 38), T(82.5, 5, 161, 40), T(82.5, 7, 185, 52)]),
      entry('rdl', [T(55, 12, 130, 45), T(55, 11, 95, 44), T(55, 11, 110, 47)]),
      entry('legPress', [T(110, 10, 125, 40), T(110, 10), T(110, 9, 141, 42)]),
      entry('legCurl', rep(3, 40, 12)),
      entry('calfRaise', [T(50, 12, 0, 20), T(50, 12, 3600, 3600), T(50, 12, 60, 1), T(50, 11), T(50, 10, null, 30)]),
    ], { note: 'good one' }),
    startedAt: '2026-11-10T18:42',
    finishedAt: '2026-11-10T19:34',
  },
  session('2026-11-09', 'pushA', [
    entry('bench', [T(62.5, 5, null, 25), ...rep(3, 62.5, 5), T(62.5, 7, 240, 41)]),
    entry('tricepsPushdown', [T(25, 12, 120, 31), T(25, 11, 65, 29), T(25, 10, 85, 33)]),
    entry('lateralRaise', [T(8, 16, null, 42), T(8, 15, null, 40), T(8, 15, null, 41)]),
    entry('ohTricepsExt', [T(15, 12, 100), T(15, 12, 110), T(15, 9, 120)]),
    entry('lateralRaise', [T(6, 20, null, 35), T(6, 20, null, 36), T(6, 18, null, 37)]),
  ], { offDay: true }),
  session('2026-11-08', 'pullA', [
    entry('deadlift', [T(140, 5, null, 25)]),
    entry('rearDeltFly', [T(7.5, 20, 90, 40), ...rep(4, 7.5, 20)]),
    entry('bandPullApart', [T(0, 20, null, 30), T(0, 20, null, 31), ...rep(3, 0, 20)]),
    entry('custom:zercher squat', [T(60, 8, 100), T(60, 8, 110)], 'Zercher squat'),
    entry('plank', [T(0, 60, 60, 61), T(0, 55, 45, 56), T(0, 50)]),
  ], { note: 'slept badly, "tired"' }),
  session('2026-11-05', 'legs', [entry('squat', rep(3, 80, 5))]),
];

// ---------------------------------------------------------------------------------------------
// §19.1 dates.formatClock / dates.parseClock
// ---------------------------------------------------------------------------------------------

describe('dates.formatClock(seconds) (§19.1)', () => {
  test('the spec examples: "2:41", "0:05", "61:40"', () => {
    assert.equal(dates.formatClock(161), '2:41');
    assert.equal(dates.formatClock(5), '0:05');
    assert.equal(dates.formatClock(3700), '61:40');
  });

  test('minutes unpadded, seconds always two digits', () => {
    assert.equal(dates.formatClock(0), '0:00');
    assert.equal(dates.formatClock(59), '0:59');
    assert.equal(dates.formatClock(60), '1:00');
    assert.equal(dates.formatClock(600), '10:00');
    assert.equal(dates.formatClock(3600), '60:00');
  });
});

describe('dates.parseClock(text) (§19.1)', () => {
  test('"2:41" → 161 and the other spec examples', () => {
    assert.equal(dates.parseClock('2:41'), 161);
    assert.equal(dates.parseClock('0:05'), 5);
    assert.equal(dates.parseClock('61:40'), 3700);
    assert.equal(dates.parseClock('0:00'), 0);
    assert.equal(dates.parseClock('60:00'), 3600);
  });

  test('unreadable → null', () => {
    for (const bad of ['', '   ', 'abc', '-', ':41', '2:', '2:4x', 'x2:41', null, undefined]) {
      assert.equal(dates.parseClock(bad), null, JSON.stringify(bad));
    }
  });

  test('parseClock(formatClock(n)) === n for every whole second 0–3600', () => {
    for (let n = 0; n <= 3600; n++) assert.equal(dates.parseClock(dates.formatClock(n)), n, String(n));
  });
});

// ---------------------------------------------------------------------------------------------
// §19.1 program.supersetPairs(plan)
// ---------------------------------------------------------------------------------------------

/** "slotKey:exerciseId" of each item of each pair. */
const pairKeys = (pairs) => pairs.map((pair) => pair.map((it) => `${it.slotKey}:${it.exerciseId}`));

describe('program.supersetPairs(plan) (§19.1)', () => {
  test('Push A: [pushdown, lateral raise #1] and [overhead extension, lateral raise #2], in plan order', () => {
    const plan = program.getDayPlan('pushA');
    const pairs = program.supersetPairs(plan);
    assert.deepEqual(pairKeys(pairs), [
      ['push.tri1:tricepsPushdown', 'push.side1:lateralRaise'],
      ['push.tri2:ohTricepsExt', 'push.side2:lateralRaise'],
    ]);
    // a = the earlier item; the second Lateral raise is the second track (§17.1)
    for (const [a, b] of pairs) assert.ok(plan.items.findIndex((it) => it.slotKey === a.slotKey) < plan.items.findIndex((it) => it.slotKey === b.slotKey));
    assert.equal(pairs[0][1].occurrence, 0);
    assert.equal(pairs[1][1].occurrence, 1);
  });

  test('Push B has the same two pairs', () => {
    assert.deepEqual(pairKeys(program.supersetPairs(program.getDayPlan('pushB'))), [
      ['push.tri1:tricepsPushdown', 'push.side1:lateralRaise'],
      ['push.tri2:ohTricepsExt', 'push.side2:lateralRaise'],
    ]);
  });

  test('pull days with face pulls (the default) and legs have no pairs', () => {
    for (const day of ['pullA', 'pullB', 'legs']) assert.deepEqual(program.supersetPairs(program.getDayPlan(day)), [], day);
    assert.deepEqual(program.supersetPairs(program.getDayPlan('pullA', { abs: true })), [], 'pullA with abs');
    assert.deepEqual(program.supersetPairs(program.getDayPlan('legs', { abs: true })), [], 'legs with abs');
  });

  test('pull days with the face-pull combo: [rear delt fly, band pull-apart]', () => {
    const choices = { 'pull.rear': 'rearDeltFly+bandPullApart' };
    for (const day of ['pullA', 'pullB']) {
      assert.deepEqual(pairKeys(program.supersetPairs(program.getDayPlan(day, { choices }))), [
        ['pull.rear:rearDeltFly', 'pull.rear:bandPullApart'],
      ], day);
    }
  });

  test('swaps keep the pairs: front raise, a custom triceps exercise, the same triceps exercise twice', () => {
    assert.deepEqual(pairKeys(program.supersetPairs(program.getDayPlan('pushA', { choices: { 'push.side1': 'frontRaise' } }))), [
      ['push.tri1:tricepsPushdown', 'push.side1:frontRaise'],
      ['push.tri2:ohTricepsExt', 'push.side2:lateralRaise'],
    ]);
    const custom = program.getDayPlan('pushA', { choices: { 'push.tri1': 'custom:Cable kickback' } });
    assert.deepEqual(pairKeys(program.supersetPairs(custom)), [
      [`push.tri1:${program.customId('Cable kickback')}`, 'push.side1:lateralRaise'],
      ['push.tri2:ohTricepsExt', 'push.side2:lateralRaise'],
    ]);
    // Both triceps slots on pushdowns and both side slots on lateral raises: still one pair per slot pair.
    assert.deepEqual(pairKeys(program.supersetPairs(program.getDayPlan('pushB', { choices: { 'push.tri2': 'tricepsPushdown' } }))), [
      ['push.tri1:tricepsPushdown', 'push.side1:lateralRaise'],
      ['push.tri2:tricepsPushdown', 'push.side2:lateralRaise'],
    ]);
  });

  test('goals change sets, not pairs', () => {
    for (const goal of ['strength', 'endurance', 'cut']) {
      assert.deepEqual(pairKeys(program.supersetPairs(program.getDayPlan('pushA', { goal }))), [
        ['push.tri1:tricepsPushdown', 'push.side1:lateralRaise'],
        ['push.tri2:ohTricepsExt', 'push.side2:lateralRaise'],
      ], goal);
    }
  });

  test('pairs hold the plan items themselves (slotKey, exerciseId, name, sets …) and the plan is not mutated', () => {
    const plan = program.getDayPlan('pushA');
    const before = clone(plan);
    const [[a, b]] = program.supersetPairs(plan);
    assert.equal(a.name, 'Triceps pushdown');
    assert.equal(b.name, 'Lateral raise');
    assert.equal(a.supersetWith, b.exerciseId);
    assert.equal(b.supersetWith, a.exerciseId);
    assert.equal(a.sets, 3);
    assert.deepEqual(plan, before);
  });
});

// ---------------------------------------------------------------------------------------------
// §19.1 store.migrate — rest / duration on sets, draft.rest → draft.timer
// ---------------------------------------------------------------------------------------------

describe('store.migrate keeps valid rest / duration and drops invalid ones (§19.1)', () => {
  const raw = (setList) => ({ version: 1, sessions: [{ ...session('2026-11-10', 'legs', [entry('squat', setList)]), id: 's1' }] });
  const setsOf = (state) => state.sessions[0].entries[0].sets;

  test('valid values are kept, including the edges (rest 0 and 3600, duration 1 and 3600)', () => {
    const list = [T(100, 5, null, 38), T(100, 5, 161, 40), T(100, 5, 0, 1), T(100, 5, 3600, 3600), T(100, 5)];
    assert.deepEqual(setsOf(store.migrate(raw(clone(list)))), list);
  });

  test('invalid rest values are dropped; the set and its other numbers stay', () => {
    for (const bad of [-1, 3601, 1.5, '60', Infinity, NaN, true, {}]) {
      const [st] = setsOf(store.migrate(raw([{ weight: 100, reps: 5, rest: bad, duration: 40 }])));
      assert.ok(!('rest' in st), `rest ${String(bad)} should be dropped: ${JSON.stringify(st)}`);
      assert.equal(st.weight, 100);
      assert.equal(st.reps, 5);
      assert.equal(st.duration, 40);
    }
  });

  test('invalid durations are dropped (0 too: a set time is 1–3600 s); the set and its rest stay', () => {
    for (const bad of [0, -5, 3601, 2.5, '40', Infinity, NaN, false]) {
      const [st] = setsOf(store.migrate(raw([{ weight: 100, reps: 5, rest: 120, duration: bad }])));
      assert.ok(!('duration' in st), `duration ${String(bad)} should be dropped: ${JSON.stringify(st)}`);
      assert.equal(st.weight, 100);
      assert.equal(st.reps, 5);
      assert.equal(st.rest, 120);
    }
  });

  test('sessions without any rest / duration are unchanged', () => {
    const list = rep(3, 100, 5);
    assert.deepEqual(setsOf(store.migrate(raw(clone(list)))), list);
  });

  test('migrate does not mutate its input', () => {
    const input = raw([{ weight: 100, reps: 5, rest: -1, duration: 0 }, T(100, 5, 161, 40)]);
    const before = clone(input);
    store.migrate(input);
    assert.deepEqual(input, before);
  });
});

describe('store.migrate: Batch 2 draft.rest becomes draft.timer (§19.1, §19.2)', () => {
  const draftWith = (extra) => ({
    date: '2026-11-24', day: 'legs', offDay: false, note: '', dateChosen: false, editingId: null, extraCount: 0,
    startedAt: '2026-11-24T18:42', warmup: { main: [0, 1] },
    entries: [{ uid: 'main', slotKey: null, exerciseId: 'squat', name: 'Squat', sets: [{ weight: 62.5, reps: 5, touched: false }, { weight: 62.5, reps: null, touched: false }] }],
    ...extra,
  });

  test('{uid, set, startedAt, extra} → {kind: "rest", uid, set, startedAt, extra}; draft.rest is gone', () => {
    const rest = { uid: 'main', set: 0, startedAt: 1795000000000, extra: 30 };
    const d = store.migrate({ version: 1, draft: draftWith({ rest }) }).draft;
    assert.deepEqual(d.timer, { kind: 'rest', uid: 'main', set: 0, startedAt: 1795000000000, extra: 30 });
    assert.ok(!('rest' in d), `draft.rest should be migrated away: ${JSON.stringify(d)}`);
  });

  test('the rest of the draft is kept as it was', () => {
    const base = draftWith({});
    const d = store.migrate({ version: 1, draft: draftWith({ rest: { uid: 'main', set: 1, startedAt: 1795000000000, extra: 0 } }) }).draft;
    const { timer, ...others } = d;
    assert.deepEqual(others, base);
    assert.equal(timer.kind, 'rest');
    assert.equal(timer.set, 1);
  });

  test('an old timer without "extra" migrates with no extra time', () => {
    const d = store.migrate({ version: 1, draft: draftWith({ rest: { uid: 'main', set: 0, startedAt: 1795000000000 } }) }).draft;
    assert.equal(d.timer.kind, 'rest');
    assert.equal(d.timer.uid, 'main');
    assert.equal(d.timer.set, 0);
    assert.equal(d.timer.startedAt, 1795000000000);
    assert.equal(d.timer.extra ?? 0, 0);
  });

  test('a draft.timer (rest or set) is kept; a draft without a timer gets none', () => {
    const restTimer = { kind: 'rest', uid: 'main', set: 0, startedAt: 1795000000000, extra: 30 };
    const setTimer = { kind: 'set', uid: 'main', set: 1, startedAt: 1795000100000 };
    assert.deepEqual(store.migrate({ version: 1, draft: draftWith({ timer: restTimer }) }).draft.timer, restTimer);
    assert.deepEqual(store.migrate({ version: 1, draft: draftWith({ timer: setTimer }) }).draft.timer, setTimer);
    const none = store.migrate({ version: 1, draft: draftWith({}) }).draft;
    assert.ok(!('timer' in none) || none.timer == null, JSON.stringify(none.timer));
    assert.equal(store.migrate({ version: 1, draft: null }).draft, null);
  });

  test('load() runs the same migration on a stored Batch 2 state', () => {
    const data = new Map([[store.STORAGE_KEY, JSON.stringify({ version: 1, draft: draftWith({ rest: { uid: 'main', set: 0, startedAt: 1795000000000, extra: 0 } }) })]]);
    const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
    const d = store.load(storage).draft;
    assert.equal(d.timer.kind, 'rest');
    assert.ok(!('rest' in d));
  });
});

describe('convertAllWeights keeps rest / duration (they are seconds, not weights)', () => {
  test('kg → lb converts weights only', () => {
    const state = { ...store.defaultState(), sessions: [{ ...session('2026-11-10', 'legs', [entry('squat', [T(100, 5, null, 38), T(100, 5, 161, 40)])]), id: 'a' }] };
    const out = store.convertAllWeights(state, 'lb');
    assert.deepEqual(timing(out.sessions[0].entries[0].sets), [[null, 38], [161, 40]]);
    assert.notEqual(out.sessions[0].entries[0].sets[0].weight, 100);
  });
});

// ---------------------------------------------------------------------------------------------
// §19.1 CSV: rest_s, set_s
// ---------------------------------------------------------------------------------------------

const csvRows = (...l) => l.join('\n') + '\n';

describe('CSV backups keep rest and set times (§19.1)', () => {
  test('the header gains rest_s, set_s after finished_at', () => {
    assert.equal(csv.CSV_HEADER, 'date,day,exercise,set,weight,reps,unit,off_day,note,started_at,finished_at,rest_s,set_s');
    assert.equal(csv.toCSV([], 'kg'), csv.CSV_HEADER + '\n');
  });

  test('exact rows: whole seconds per set, empty = not recorded, rest 0 is written as 0', () => {
    const data = [
      { ...session('2026-11-10', 'legs', [entry('squat', [T(100, 5, null, 38), T(100, 5, 161, 40), T(100, 7, 0)])]), startedAt: '2026-11-10T18:42', finishedAt: '2026-11-10T19:34' },
      session('2026-11-07', 'pushA', [entry('bench', rep(2, 62.5, 5))], { note: 'a, "b"' }),
    ];
    assert.equal(csv.toCSV(data, 'kg'), csvRows(
      'date,day,exercise,set,weight,reps,unit,off_day,note,started_at,finished_at,rest_s,set_s',
      '07/11/2026,Push A,Bench press,1,62.5,5,kg,,"a, ""b""",,,,',
      '07/11/2026,Push A,Bench press,2,62.5,5,kg,,"a, ""b""",,,,',
      '10/11/2026,Legs,Squat,1,100,5,kg,,,2026-11-10T18:42,2026-11-10T19:34,,38',
      '10/11/2026,Legs,Squat,2,100,5,kg,,,2026-11-10T18:42,2026-11-10T19:34,161,40',
      '10/11/2026,Legs,Squat,3,100,7,kg,,,2026-11-10T18:42,2026-11-10T19:34,0,',
    ));
  });

  test('round trip parseCSV(toCSV(s)) keeps every rest and set time, no warnings (kg and lb)', () => {
    for (const unit of ['kg', 'lb']) {
      const data = timerSessions();
      const { sessions, warnings } = csv.parseCSV(csv.toCSV(data, unit), { unit });
      assert.deepEqual(warnings, [], unit);
      assert.deepEqual(withTimers(sessions), withTimers(data), unit);
    }
  });

  test('importing a kg backup into lb converts the weights but keeps the seconds', () => {
    const data = timerSessions();
    const { sessions } = csv.parseCSV(csv.toCSV(data, 'kg'), { unit: 'lb' });
    const flat = (list) => withTimers(list).flatMap((s) => s.entries.flatMap((e) => timing(e.sets)));
    assert.deepEqual(flat(sessions), flat(data));
  });

  test('parseImport (a CSV pasted into Import) keeps them too', () => {
    const data = timerSessions();
    const { sessions } = parser.parseImport(csv.toCSV(data, 'kg'), { unit: 'kg', today: TODAY });
    assert.deepEqual(withTimers(sessions), withTimers(data));
  });

  test('columns are found by name: set_s before rest_s, tab-delimited', () => {
    const text = [
      'date\tday\texercise\tset\tweight\treps\tset_s\trest_s',
      '10/11/2026\tLegs\tSquat\t1\t100\t5\t38\t',
      '10/11/2026\tLegs\tSquat\t2\t100\t5\t40\t161',
      '',
    ].join('\n');
    const { sessions, warnings } = csv.parseCSV(text, { unit: 'kg' });
    assert.deepEqual(warnings, []);
    assert.deepEqual(timing(sessions[0].entries[0].sets), [[null, 38], [161, 40]]);
  });

  test('old backups still import: no rest / set columns → no rest / set times, no warnings', () => {
    const v1 = csvRows(
      'date,day,exercise,set,weight,reps,unit,off_day,note',
      '07/11/2026,Push A,Bench press,1,62.5,5,kg,,',
      '10/11/2026,Legs,Squat,1,100,5,kg,yes,"slept badly, ""tired"""',
    );
    const v2 = csvRows(
      'date,day,exercise,set,weight,reps,unit,off_day,note,started_at,finished_at',
      '07/11/2026,Push A,Bench press,1,62.5,5,kg,,,2026-11-07T18:00,2026-11-07T19:00',
      '07/11/2026,Push A,Bench press,2,62.5,5,kg,,,2026-11-07T18:00,2026-11-07T19:00',
    );
    for (const [name, text, count] of [['9 columns', v1, 2], ['Batch 2 (11 columns)', v2, 1]]) {
      const { sessions, warnings } = csv.parseCSV(text, { unit: 'kg' });
      assert.deepEqual(warnings, [], name);
      assert.equal(sessions.length, count, name);
      for (const s of sessions) for (const e of s.entries) assert.deepEqual(timing(e.sets), e.sets.map(() => [null, null]), name);
    }
  });

  test('values outside the allowed ranges never end up on a set', () => {
    const text = csvRows(
      'date,day,exercise,set,weight,reps,unit,off_day,note,started_at,finished_at,rest_s,set_s',
      '10/11/2026,Legs,Squat,1,100,5,kg,,,,,-5,0',
      '10/11/2026,Legs,Squat,2,100,5,kg,,,,,3601,3601',
      '10/11/2026,Legs,Squat,3,100,5,kg,,,,,abc,x',
      '10/11/2026,Legs,Squat,4,100,5,kg,,,,,1.5,2.5',
    );
    const { sessions } = csv.parseCSV(text, { unit: 'kg' });
    for (const s of sessions) {
      for (const e of s.entries) {
        for (const st of e.sets) {
          assert.ok(st.rest == null || validRest(st.rest), `rest ${JSON.stringify(st.rest)}`);
          assert.ok(st.duration == null || validDuration(st.duration), `duration ${JSON.stringify(st.duration)}`);
        }
      }
    }
  });

  test('toCSV does not mutate its input', () => {
    const data = timerSessions();
    const before = clone(data);
    csv.toCSV(data, 'kg');
    assert.deepEqual(data, before);
  });
});

// ---------------------------------------------------------------------------------------------
// §19.1 Text backups: "  rest 2:41 3:05 · sets 0:35 0:40 0:52"
// ---------------------------------------------------------------------------------------------

/** The line right after the exercise line that starts with `start` in a formatted text. */
function lineAfter(text, start) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(start));
  assert.ok(i >= 0, `no line starting with ${JSON.stringify(start)} in:\n${text}`);
  return lines[i + 1];
}

describe('formatText writes the rest / set times line (§19.1)', () => {
  const one = (entries) => parser.formatText([session('2026-11-10', 'legs', entries)], 'kg');

  test('every set recorded: "  rest 2:10 1:35 1:50 · sets 0:45 0:44 0:47"', () => {
    const out = one([entry('rdl', [T(55, 12, 130, 45), T(55, 11, 95, 44), T(55, 11, 110, 47)])]);
    assert.equal(lineAfter(out, 'Romanian deadlift '), '  rest 2:10 1:35 1:50 · sets 0:45 0:44 0:47');
  });

  test('a set without a rest is "-" (the first set of the workout)', () => {
    const out = one([entry('squat', [T(100, 5, null, 38), T(100, 5, 161, 40), T(100, 7, 185, 52)])]);
    assert.equal(lineAfter(out, 'Squat '), '  rest - 2:41 3:05 · sets 0:38 0:40 0:52');
  });

  test('gaps in the middle of both parts', () => {
    const out = one([entry('legPress', [T(110, 10, 125, 40), T(110, 10), T(110, 9, 140, 42)])]);
    assert.equal(lineAfter(out, 'Leg press '), '  rest 2:05 - 2:20 · sets 0:40 - 0:42');
  });

  test('only set times → "  sets …" (the rest part is absent)', () => {
    const out = one([entry('lateralRaise', [T(8, 16, null, 42), T(8, 15, null, 40), T(8, 15, null, 41)])]);
    assert.equal(lineAfter(out, 'Lateral raise '), '  sets 0:42 0:40 0:41');
  });

  test('only rests → "  rest …" (the sets part is absent)', () => {
    const out = one([entry('legCurl', [T(40, 12), T(40, 12, 100), T(40, 10, 110)])]);
    assert.equal(lineAfter(out, 'Leg curl '), '  rest - 1:40 1:50');
  });

  test('edge values: rest 0 → "0:00", 3600 → "60:00"', () => {
    const out = one([entry('calfRaise', [T(50, 12, 0, 1), T(50, 12, 3600, 3600)])]);
    assert.equal(lineAfter(out, 'Calf raise '), '  rest 0:00 60:00 · sets 0:01 60:00');
  });

  test('nothing recorded → no extra line (old workouts are written exactly as before)', () => {
    const out = one([entry('squat', rep(3, 100, 5)), entry('rdl', rep(3, 60, 10))]);
    assert.equal(out.replace(/\n+$/, ''), ['10/11/2026 Legs', 'Squat 100x5 x3', 'Romanian deadlift 60x10 x3'].join('\n'));
  });

  test('the line sits directly under its exercise line, before the next exercise', () => {
    const out = parser.formatText([{
      ...session('2026-11-10', 'legs', [
        entry('squat', [T(100, 5, null, 38), T(100, 5, 161, 40)]),
        entry('rdl', rep(2, 60, 10)),
        entry('legPress', [T(110, 10, 125, 40)]),
      ], { note: 'ok' }),
      startedAt: '2026-11-10T18:42',
      finishedAt: '2026-11-10T19:34',
    }], 'kg');
    assert.deepEqual(out.replace(/\n+$/, '').split('\n'), [
      '10/11/2026 Legs',
      'Time: 18:42–19:34',
      'Squat 100x5 x2',
      '  rest - 2:41 · sets 0:38 0:40',
      'Romanian deadlift 60x10 x2',
      'Leg press 110x10',
      '  rest 2:05 · sets 0:40',
      'Note: ok',
    ]);
  });
});

describe('parseImport reads the rest / set times line back (§19.1)', () => {
  const imp = (text) => parser.parseImport(text, { unit: 'kg', today: TODAY });

  test('hand-written lines: both parts, only sets, only rests, "-" gaps; no warnings, no extra exercises', () => {
    const { sessions, warnings } = imp([
      '10/11/2026 Legs',
      'Squat 100x5 100x5 100x7',
      '  rest - 2:41 3:05 · sets 0:38 0:40 0:52',
      'Romanian deadlift 60x10 x3',
      '  sets 0:45 0:44 0:47',
      'Leg press 110x10 x3',
      '  rest 2:05 - 2:20',
      'Leg curl 40x12 x3',
    ].join('\n'));
    assert.deepEqual(warnings, []);
    assert.equal(sessions.length, 1);
    const [squat, rdl, legPress, legCurl, ...more] = sessions[0].entries;
    assert.deepEqual(more, [], 'the rest / sets lines are not exercises');
    assert.equal(squat.exerciseId, 'squat');
    assert.deepEqual(squat.sets.map((s) => [s.weight, s.reps]), [[100, 5], [100, 5], [100, 7]]);
    assert.deepEqual(timing(squat.sets), [[null, 38], [161, 40], [185, 52]]);
    assert.deepEqual(timing(rdl.sets), [[null, 45], [null, 44], [null, 47]]);
    assert.deepEqual(timing(legPress.sets), [[125, null], [null, null], [140, null]]);
    assert.deepEqual(timing(legCurl.sets), [[null, null], [null, null], [null, null]]);
  });

  test('Windows line endings', () => {
    const { sessions, warnings } = imp('10/11/2026 Legs\r\nSquat 100x5 x2\r\n  rest - 2:41 · sets 0:38 0:40\r\n');
    assert.deepEqual(warnings, []);
    assert.deepEqual(timing(sessions[0].entries[0].sets), [[null, 38], [161, 40]]);
  });

  test('round trip parseImport(formatText(s)) keeps everything (kg and lb): gaps, trailing gaps, edge values, supersets, plank, custom, times, notes, off days', () => {
    for (const unit of ['kg', 'lb']) {
      const data = timerSessions();
      const { sessions } = parser.parseImport(parser.formatText(data, unit), { unit, today: TODAY });
      assert.deepEqual(withTimers(sessions), withTimers(data), unit);
    }
  });

  test('round trip of workouts without custom exercises has no warnings', () => {
    const data = timerSessions().filter((s) => !s.entries.some((e) => String(e.exerciseId).startsWith('custom:')));
    const { warnings } = parser.parseImport(parser.formatText(data, 'kg'), { unit: 'kg', today: TODAY });
    assert.deepEqual(warnings, []);
  });

  test('round trip: only-rest and only-sets lines, a rest on the last set only, a set time on the first set only', () => {
    const data = [session('2026-11-10', 'legs', [
      entry('squat', [T(100, 5), T(100, 5), T(100, 5, 200)]),
      entry('rdl', [T(60, 10, null, 50), T(60, 10), T(60, 10)]),
      entry('legPress', [T(110, 10, 90), T(110, 10, 95), T(110, 10, 100)]),
      entry('legCurl', [T(40, 12, null, 30), T(40, 12, null, 31), T(40, 12, null, 32)]),
    ])];
    const { sessions, warnings } = imp(parser.formatText(data, 'kg'));
    assert.deepEqual(warnings, []);
    assert.deepEqual(withTimers(sessions), withTimers(data));
  });

  test('formatText does not mutate its input', () => {
    const data = timerSessions();
    const before = clone(data);
    parser.formatText(data, 'kg');
    assert.deepEqual(data, before);
  });
});

// ---------------------------------------------------------------------------------------------
// §19.1 analysis.restSummary(session)
// ---------------------------------------------------------------------------------------------

describe('analysis.restSummary(session) (§19.1)', () => {
  test('the average of the recorded rests in seconds, and how many there are', () => {
    const s = session('2026-11-10', 'legs', [
      entry('squat', [T(82.5, 5, null, 38), T(82.5, 5, 161, 40), T(82.5, 7, 185, 52)]),
      entry('rdl', [T(55, 12, null, 45), T(55, 11, null, 44)]),
      entry('legPress', [T(110, 10, 125, 40), T(110, 10), T(110, 9, 141, 42)]),
    ]);
    assert.deepEqual(analysis.restSummary(s), { average: 153, count: 4 });
  });

  test('set times are not rests', () => {
    const s = session('2026-11-10', 'pushA', [
      entry('tricepsPushdown', [T(25, 12, 120, 31), T(25, 11, 60, 29)]),
      entry('lateralRaise', [T(8, 16, null, 42), T(8, 15, null, 40)]),
    ]);
    assert.deepEqual(analysis.restSummary(s), { average: 90, count: 2 });
  });

  test('a recorded rest of 0 s counts', () => {
    assert.deepEqual(analysis.restSummary(session('2026-11-10', 'legs', [entry('squat', [T(100, 5, 0), T(100, 5, 120)])])), { average: 60, count: 2 });
  });

  test('no recorded rest → { average: null, count: 0 }', () => {
    assert.deepEqual(analysis.restSummary(session('2026-11-10', 'legs', [entry('squat', [T(100, 5, null, 38), T(100, 5)])])), { average: null, count: 0 });
    assert.deepEqual(analysis.restSummary(session('2026-11-10', 'legs', [])), { average: null, count: 0 });
  });

  test('does not mutate the session', () => {
    const s = timerSessions()[0];
    const before = clone(s);
    analysis.restSummary(s);
    assert.deepEqual(s, before);
  });
});

// ---------------------------------------------------------------------------------------------
// §19.4 store.storageUse(storage)
// ---------------------------------------------------------------------------------------------

/** In-memory stand-in for localStorage. */
function memStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
}

const QUOTA = 5 * 1024 * 1024;

describe('store.storageUse(storage) (§19.4)', () => {
  test('used = key + stored JSON length in characters; quota = 5 × 1024 × 1024; ratio = used / quota', () => {
    const value = '{"version":1,"sessions":[]}';
    const r = store.storageUse(memStorage({ [store.STORAGE_KEY]: value }));
    assert.equal(r.used, store.STORAGE_KEY.length + value.length);
    assert.equal(r.quota, QUOTA);
    assert.equal(r.ratio, r.used / QUOTA);
  });

  test('a saved state: the length of what save() wrote', () => {
    const storage = memStorage();
    const state = { ...store.defaultState(), sessions: timerSessions().map((s, i) => ({ ...s, id: `s${i}` })) };
    assert.equal(store.save(state, storage), true);
    const r = store.storageUse(storage);
    assert.equal(r.used, store.STORAGE_KEY.length + JSON.stringify(state).length);
    assert.equal(r.ratio, r.used / QUOTA);
  });

  test('characters, not bytes: "é" counts once', () => {
    const value = JSON.stringify({ note: 'é'.repeat(100) });
    assert.equal(store.storageUse(memStorage({ [store.STORAGE_KEY]: value })).used, store.STORAGE_KEY.length + value.length);
  });

  test('nothing stored → (next to) nothing used', () => {
    const r = store.storageUse(memStorage());
    assert.ok(r.used >= 0 && r.used <= store.STORAGE_KEY.length, `used ${r.used}`);
    assert.equal(r.quota, QUOTA);
    assert.equal(r.ratio, r.used / QUOTA);
  });

  test('about 4.3 MB stored → ratio above 0.8', () => {
    const value = JSON.stringify({ version: 1, sessions: [{ note: 'x'.repeat(Math.round(4.3 * 1024 * 1024)) }] });
    const r = store.storageUse(memStorage({ [store.STORAGE_KEY]: value }));
    assert.ok(r.ratio > 0.8 && r.ratio < 1, `ratio ${r.ratio}`);
  });
});
