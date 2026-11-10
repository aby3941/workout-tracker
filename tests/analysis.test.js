import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  e1rm, series, personalBests, weeklyVolume, summary, watchList, exercisesInData,
} from '../public/js/analysis.js';
import { session, entry, sets, rep, at, clone } from './_helpers.js';

const W = (...pairs) => sets(...pairs);

// Unsorted on purpose.
const DATA = [
  session('2026-11-07', 'pushA', [
    entry('bench', rep(5, 62.5, 5)),
    entry('lateralRaise', rep(3, 10, 15)),
    entry('lateralRaise', rep(3, 12.5, 12)),
  ]),
  session('2026-11-03', 'pushA', [entry('bench', [...rep(4, 60, 5), { weight: 60, reps: 8 }])]),
  session('2026-11-05', 'pushB', [entry('ohp', rep(5, 40, 5)), entry('bench', rep(3, 50, 10))]),
];

const view = (p) => ({ date: p.date, topWeight: p.topWeight, bestE1rm: p.bestE1rm, volume: p.volume });

describe('e1rm (Epley)', () => {
  test('reps ≤ 0 → 0; 1 rep → the weight', () => {
    assert.equal(e1rm(100, 0), 0);
    assert.equal(e1rm(100, -1), 0);
    assert.equal(e1rm(100, 1), 100);
    assert.equal(e1rm(62.5, 1), 62.5);
  });

  test('weight × (1 + reps/30), rounded to 0.1', () => {
    assert.equal(e1rm(100, 5), 116.7);
    assert.equal(e1rm(60, 10), 80);
    assert.equal(e1rm(62.5, 8), 79.2);
    assert.equal(e1rm(60, 8), 76);
    assert.equal(e1rm(100, 7), 123.3);
    assert.equal(e1rm(0, 8), 0);
  });
});

describe('series', () => {
  test('one point per session, ascending, by role', () => {
    assert.deepEqual(series(DATA, 'bench', 'main').map(view), [
      { date: '2026-11-03', topWeight: 60, bestE1rm: 76, volume: 1680 },
      { date: '2026-11-07', topWeight: 62.5, bestE1rm: 72.9, volume: 1562.5 },
    ]);
    assert.deepEqual(series(DATA, 'bench', 'accessory').map(view), [
      { date: '2026-11-05', topWeight: 50, bestE1rm: 66.7, volume: 1500 },
    ]);
  });

  test('repeated entries in a session are combined into one point', () => {
    assert.deepEqual(series(DATA, 'lateralRaise', 'accessory').map(view), [
      { date: '2026-11-07', topWeight: 12.5, bestE1rm: 17.5, volume: 900 },
    ]);
  });

  test('no history → []', () => {
    assert.deepEqual(series(DATA, 'squat', 'main'), []);
    assert.deepEqual(series([], 'bench', 'main'), []);
  });

  test('does not mutate its input', () => {
    const before = clone(DATA);
    series(DATA, 'bench', 'main');
    assert.deepEqual(DATA, before);
  });
});

describe('personalBests', () => {
  const find = (list, exerciseId, role) => {
    const hit = list.filter((p) => p.exerciseId === exerciseId && p.role === role);
    assert.equal(hit.length, 1, `${exerciseId}/${role}`);
    return hit[0];
  };
  const fields = (p) => ({
    name: p.name, bestWeight: p.bestWeight, bestWeightDate: p.bestWeightDate, bestE1rm: p.bestE1rm, bestE1rmDate: p.bestE1rmDate,
  });

  test('one per (exerciseId, role), with names and dates', () => {
    const pbs = personalBests(DATA);
    assert.equal(pbs.length, 4);
    assert.deepEqual(fields(find(pbs, 'bench', 'main')), {
      name: 'Bench press', bestWeight: 62.5, bestWeightDate: '2026-11-07', bestE1rm: 76, bestE1rmDate: '2026-11-03',
    });
    assert.deepEqual(fields(find(pbs, 'bench', 'accessory')), {
      name: 'Bench press', bestWeight: 50, bestWeightDate: '2026-11-05', bestE1rm: 66.7, bestE1rmDate: '2026-11-05',
    });
    assert.deepEqual(fields(find(pbs, 'ohp', 'main')), {
      name: 'Overhead press', bestWeight: 40, bestWeightDate: '2026-11-05', bestE1rm: 46.7, bestE1rmDate: '2026-11-05',
    });
    assert.deepEqual(fields(find(pbs, 'lateralRaise', 'accessory')), {
      name: 'Lateral raise', bestWeight: 12.5, bestWeightDate: '2026-11-07', bestE1rm: 17.5, bestE1rmDate: '2026-11-07',
    });
  });

  test('ties: the earliest date wins (input order irrelevant)', () => {
    const data = [
      session('2026-11-09', 'legs', [entry('squat', at(100, [5, 5, 5]))]),
      session('2026-11-02', 'legs', [entry('squat', at(100, [5, 5, 5]))]),
      session('2026-11-05', 'legs', [entry('squat', at(100, [5, 5, 5]))]),
    ];
    const [pb] = personalBests(data);
    assert.equal(pb.bestWeightDate, '2026-11-02');
    assert.equal(pb.bestE1rmDate, '2026-11-02');
  });

  test('custom exercises use their stored name', () => {
    const data = [session('2026-11-10', 'pushA', [entry('custom:cable y raise', W([5, 15]), 'Cable Y-raise')])];
    const pb = find(personalBests(data), 'custom:cable y raise', 'accessory');
    assert.equal(pb.name, 'Cable Y-raise');
  });

  test('empty → []', () => {
    assert.deepEqual(personalBests([]), []);
  });

  test('entries without sets are not data: no -Infinity rows (review fix)', () => {
    const data = [
      session('2026-11-10', 'legs', [entry('squat', []), { exerciseId: 'rdl' }, entry('legPress', W([140, 12]))]),
    ];
    const pbs = personalBests(data);
    assert.deepEqual(pbs.map((p) => p.exerciseId), ['legPress']);
    assert.ok(pbs.every((p) => Number.isFinite(p.bestWeight) && Number.isFinite(p.bestE1rm)));
    assert.deepEqual(exercisesInData(data).map((x) => x.exerciseId), ['legPress']);
  });
});

describe('weeklyVolume', () => {
  test('Monday weeks, ascending, zero-filled gaps', () => {
    const data = [
      session('2026-11-19', 'pullB', [entry('barbellRow', W([20, 10]))]), // Thu, week of 16/11
      session('2026-11-03', 'pushA', [entry('bench', rep(2, 100, 5))]), // Tue, week of 02/11
      session('2026-11-08', 'legs', [entry('squat', W([50, 10]))]), // Sun, still week of 02/11
    ];
    assert.deepEqual(weeklyVolume(data).map((w) => ({ weekStart: w.weekStart, volume: w.volume, count: w.count })), [
      { weekStart: '2026-11-02', volume: 1500, count: 2 },
      { weekStart: '2026-11-09', volume: 0, count: 0 },
      { weekStart: '2026-11-16', volume: 200, count: 1 },
    ]);
  });

  test('across a year boundary', () => {
    const data = [
      session('2025-12-31', 'legs', [entry('squat', W([100, 5]))]),
      session('2026-01-05', 'pullA', [entry('deadlift', W([100, 5]))]),
    ];
    assert.deepEqual(weeklyVolume(data).map((w) => [w.weekStart, w.volume, w.count]), [
      ['2025-12-29', 500, 1],
      ['2026-01-05', 500, 1],
    ]);
  });

  test('empty → []', () => {
    assert.deepEqual(weeklyVolume([]), []);
  });

  test('a session with a missing or non-ISO date is ignored instead of looping forever (review fix)', () => {
    // Run in a child process: before the fix this never returned, which would freeze the runner.
    const url = new URL('../public/js/analysis.js', import.meta.url).href;
    const code = `const { weeklyVolume } = await import(${JSON.stringify(url)});
      const s = (date, w) => ({ date, day: 'legs', entries: [{ exerciseId: 'squat', sets: [{ weight: w, reps: 5 }] }] });
      const out = [];
      for (const bad of ['', '10/11/2026', undefined, 'garbage', '2026-13-01']) {
        out.push(weeklyVolume([s('2026-11-03', 100), s(bad, 999), s('2026-11-10', 50)]));
      }
      console.log(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
    assert.equal(r.signal, null, 'weeklyVolume did not return (killed after 5 s)');
    assert.equal(r.status, 0, r.stderr);
    const expected = [{ weekStart: '2026-11-02', volume: 500, count: 1 }, { weekStart: '2026-11-09', volume: 250, count: 1 }];
    for (const result of JSON.parse(r.stdout)) assert.deepEqual(result, expected);
  });
});

describe('summary', () => {
  const TODAY = '2026-11-10';
  const dates = ['2026-11-04', '2026-10-01', '2025-11-05', '2026-11-10', '2026-10-31', '2026-11-03', '2026-11-01'];
  const data = dates.map((d) => session(d, 'legs', [entry('squat', W([100, 5]))]));

  test('total, this month, last 7 days (today−7 excluded, today included), first/last dates', () => {
    assert.deepEqual(summary(data, TODAY), {
      total: 7,
      thisMonth: 4, // 01, 03, 04, 10 Nov 2026 (not Nov 2025)
      last7: 2, // 04/11 and 10/11; 03/11 is exactly today−7
      firstDate: '2025-11-05',
      lastDate: '2026-11-10',
    });
  });

  test('empty → zeros and nulls', () => {
    assert.deepEqual(summary([], TODAY), { total: 0, thisMonth: 0, last7: 0, firstDate: null, lastDate: null });
  });
});

describe('watchList', () => {
  const fail = (date, day, exerciseId, w, repsList, opts) => session(date, day, [entry(exerciseId, at(w, repsList))], opts);

  test('main lifts with a fail streak or a deload; successes and empty lifts left out', () => {
    const data = [
      fail('2026-11-01', 'legs', 'squat', 100, [5, 5, 3]),
      fail('2026-11-04', 'legs', 'squat', 100, [5, 5, 4]),
      fail('2026-11-02', 'pushA', 'bench', 62.5, [5, 5, 5, 4, 3]),
      fail('2026-11-05', 'pushA', 'bench', 62.5, [5, 5, 5, 4, 3]),
      fail('2026-11-08', 'pushA', 'bench', 62.5, [5, 5, 5, 5, 4]),
      fail('2026-11-03', 'pullA', 'deadlift', 140, [7]),
      fail('2026-11-06', 'pullB', 'barbellRow', 60, [5, 5, 5, 5, 4]),
    ];
    const list = watchList(data, 'kg');
    const byId = Object.fromEntries(list.map((w) => [w.exerciseId, { weight: w.weight, failStreak: w.failStreak, action: w.action }]));
    assert.equal(list.length, 3);
    assert.deepEqual(byId, {
      squat: { weight: 100, failStreak: 2, action: 'repeat' },
      bench: { weight: 55, failStreak: 3, action: 'deload' },
      barbellRow: { weight: 60, failStreak: 1, action: 'repeat' },
    });
  });

  test('a single off-day miss is not on the list; nor is accessory-role work', () => {
    const data = [
      fail('2026-11-05', 'pushB', 'ohp', 40, [5, 5, 4, 3, 2], { offDay: true }),
      fail('2026-11-06', 'pushB', 'bench', 50, [5, 5, 4]),
    ];
    assert.deepEqual(watchList(data, 'kg'), []);
  });

  test('empty → []', () => {
    assert.deepEqual(watchList([], 'kg'), []);
  });
});

describe('exercisesInData', () => {
  test('unique (exerciseId, role) with names', () => {
    const data = [...DATA, session('2026-11-09', 'pushA', [
      entry('bench', rep(5, 65, 5)),
      entry('custom:cable y raise', W([5, 15]), 'Cable Y-raise'),
    ])];
    const key = (x) => `${x.exerciseId}|${x.role}`;
    const got = exercisesInData(data).map((x) => ({ exerciseId: x.exerciseId, name: x.name, role: x.role })).sort((a, b) => (key(a) < key(b) ? -1 : 1));
    assert.deepEqual(got, [
      { exerciseId: 'bench', name: 'Bench press', role: 'accessory' },
      { exerciseId: 'bench', name: 'Bench press', role: 'main' },
      { exerciseId: 'custom:cable y raise', name: 'Cable Y-raise', role: 'accessory' },
      { exerciseId: 'lateralRaise', name: 'Lateral raise', role: 'accessory' },
      { exerciseId: 'ohp', name: 'Overhead press', role: 'main' },
    ]);
  });

  test('empty → []', () => {
    assert.deepEqual(exercisesInData([]), []);
  });
});
