// Batch 2 (SPEC.md §18, owner approved 20/11/2026) — unit tests written from the spec before the code.
// New exports are reached through namespace imports, so a missing function fails its own tests only.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as program from '../public/js/program.js';
import * as analysis from '../public/js/analysis.js';
import * as store from '../public/js/store.js';
import * as csv from '../public/js/csv.js';
import * as parser from '../public/js/parser.js';
import { session, entry, sets, rep, clone, canonical } from './_helpers.js';

const W = (...pairs) => sets(...pairs);
const TODAY = '2026-11-20';
const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: expected ${expected}, got ${actual}`);

/** A session with workout times (§18.3: local wall-clock strings "YYYY-MM-DDTHH:MM"). */
const timed = (s, startedAt, finishedAt) => ({ ...s, startedAt, finishedAt });

/** date|day → [startedAt, finishedAt] (null when absent), for comparing times across a round trip. */
const timesOf = (list) => Object.fromEntries(list.map((s) => [`${s.date}|${s.day}`, [s.startedAt ?? null, s.finishedAt ?? null]]));

// ---------------------------------------------------------------------------------------------
// §18.1 Rest timer — REST_SECONDS, REST, restPhase (program.js)
// ---------------------------------------------------------------------------------------------

describe('REST_SECONDS and REST (§18.1)', () => {
  test('rest ranges are numbers in seconds: main 3–5 min, accessory 1–3 min', () => {
    assert.deepEqual(program.REST_SECONDS, { main: { min: 180, max: 300 }, accessory: { min: 60, max: 180 } });
  });

  test('the REST strings stay "3–5 min" / "1–3 min" and are derived from REST_SECONDS', () => {
    assert.equal(program.REST.main, '3–5 min');
    assert.equal(program.REST.accessory, '1–3 min');
    for (const role of ['main', 'accessory']) {
      const { min, max } = program.REST_SECONDS[role];
      assert.equal(program.REST[role], `${min / 60}–${max / 60} min`, role);
    }
  });
});

describe('restPhase(elapsedSeconds, role, extraSeconds = 0) (§18.1)', () => {
  const rp = (...args) => program.restPhase(...args);

  test('main: resting below the 3-minute target; target = min; progress = elapsed / target', () => {
    const r0 = rp(0, 'main');
    assert.equal(r0.phase, 'resting');
    assert.equal(r0.target, 180);
    near(r0.progress, 0, 'progress at 0 s');
    const r = rp(90, 'main');
    assert.equal(r.phase, 'resting');
    assert.equal(r.target, 180);
    near(r.progress, 0.5, 'progress at 90 s');
    assert.equal(rp(179, 'main').phase, 'resting');
    near(rp(179, 'main').progress, 179 / 180, 'progress at 179 s');
  });

  test('main: ready from the target (3 min) through the max (5 min)', () => {
    for (const s of [180, 240, 299, 300]) {
      const r = rp(s, 'main');
      assert.equal(r.phase, 'ready', `${s} s`);
      assert.equal(r.target, 180, `${s} s`);
      near(r.progress, 1, `progress at ${s} s`);
    }
  });

  test('main: over after the max (5 min)', () => {
    for (const s of [301, 400, 3600]) {
      const r = rp(s, 'main');
      assert.equal(r.phase, 'over', `${s} s`);
      assert.equal(r.target, 180, `${s} s`);
    }
  });

  test('accessory: target 60 s; resting below it, ready from 60 s through 180 s, over after 180 s', () => {
    const r = rp(30, 'accessory');
    assert.equal(r.phase, 'resting');
    assert.equal(r.target, 60);
    near(r.progress, 0.5, 'progress at 30 s');
    assert.equal(rp(59, 'accessory').phase, 'resting');
    for (const s of [60, 120, 180]) assert.equal(rp(s, 'accessory').phase, 'ready', `${s} s`);
    for (const s of [181, 600]) assert.equal(rp(s, 'accessory').phase, 'over', `${s} s`);
  });

  test('extraSeconds (+30 s) pushes both the target and the "over" point', () => {
    const r = rp(200, 'main', 30);
    assert.equal(r.phase, 'resting');
    assert.equal(r.target, 210);
    near(r.progress, 200 / 210, 'progress at 200 s with +30');
    assert.equal(rp(209, 'main', 30).phase, 'resting');
    assert.equal(rp(210, 'main', 30).phase, 'ready');
    assert.equal(rp(330, 'main', 30).phase, 'ready');
    assert.equal(rp(331, 'main', 30).phase, 'over');

    const a = rp(70, 'accessory', 30);
    assert.equal(a.phase, 'resting');
    assert.equal(a.target, 90);
    near(a.progress, 70 / 90, 'accessory progress at 70 s with +30');
    assert.equal(rp(90, 'accessory', 30).phase, 'ready');
    assert.equal(rp(210, 'accessory', 30).phase, 'ready');
    assert.equal(rp(211, 'accessory', 30).phase, 'over');

    const twice = rp(230, 'main', 60);
    assert.equal(twice.target, 240);
    assert.equal(twice.phase, 'resting');
  });

  test('extraSeconds defaults to 0', () => {
    for (const [s, role] of [[100, 'accessory'], [100, 'main'], [250, 'main'], [500, 'main']]) {
      const a = rp(s, role);
      const b = rp(s, role, 0);
      assert.deepEqual({ phase: a.phase, target: a.target, progress: a.progress }, { phase: b.phase, target: b.target, progress: b.progress }, `${s} s ${role}`);
    }
  });

  test('progress is capped at 1', () => {
    for (const s of [180, 250, 301, 5000]) near(rp(s, 'main').progress, 1, `main ${s} s`);
    for (const s of [60, 181, 3600]) near(rp(s, 'accessory').progress, 1, `accessory ${s} s`);
    near(rp(1000, 'main', 30).progress, 1, 'main 1000 s with +30');
  });

  test('the result carries phase, target and progress', () => {
    const r = rp(45, 'accessory');
    for (const k of ['phase', 'target', 'progress']) assert.ok(Object.hasOwn(r, k), `restPhase result needs "${k}"`);
    assert.equal(typeof r.progress, 'number');
  });
});

// ---------------------------------------------------------------------------------------------
// §18.3 Workout times — store.migrate
// ---------------------------------------------------------------------------------------------

describe('store.migrate keeps valid workout times and drops invalid ones (§18.3)', () => {
  const base = () => session('2026-11-10', 'legs', [entry('squat', rep(3, 100, 5))], { id: 'a' });

  test('valid startedAt / finishedAt are kept with the rest of the workout', () => {
    const out = store.migrate({ sessions: [timed(base(), '2026-11-10T18:42', '2026-11-10T19:34')] });
    assert.equal(out.sessions.length, 1);
    const s = out.sessions[0];
    assert.equal(s.startedAt, '2026-11-10T18:42');
    assert.equal(s.finishedAt, '2026-11-10T19:34');
    assert.equal(s.id, 'a');
    assert.deepEqual(s.entries, base().entries);
  });

  test('a workout that ends after midnight keeps both times', () => {
    const s = store.migrate({ sessions: [timed(base(), '2026-11-10T23:30', '2026-11-11T00:20')] }).sessions[0];
    assert.equal(s.startedAt, '2026-11-10T23:30');
    assert.equal(s.finishedAt, '2026-11-11T00:20');
  });

  test('invalid time values are dropped; the workout itself is kept', () => {
    const BAD = ['18:42', '2026-11-10', '2026-11-10 18:42', '2026-11-10T18:42:00.000Z', '2026-02-30T10:00',
      '2026-11-10T25:00', '2026-11-10T18:60', '10/11/2026 18:42', 'yesterday', '', 1731259320000, null, {}, true];
    for (const bad of BAD) {
      const out = store.migrate({ sessions: [timed(base(), bad, bad)] });
      assert.equal(out.sessions.length, 1, `workout kept with ${JSON.stringify(bad)}`);
      assert.equal(out.sessions[0].startedAt, undefined, `startedAt ${JSON.stringify(bad)} should be dropped`);
      assert.equal(out.sessions[0].finishedAt, undefined, `finishedAt ${JSON.stringify(bad)} should be dropped`);
      assert.deepEqual(out.sessions[0].entries, base().entries);
      assert.equal(out.sessions[0].id, 'a');
    }
  });

  test('each time is checked on its own: a valid one stays when the other is invalid', () => {
    const a = store.migrate({ sessions: [timed(base(), 'garbage', '2026-11-10T19:34')] }).sessions[0];
    assert.equal(a.startedAt, undefined);
    assert.equal(a.finishedAt, '2026-11-10T19:34');
    const b = store.migrate({ sessions: [timed(base(), '2026-11-10T18:42', '19:34')] }).sessions[0];
    assert.equal(b.startedAt, '2026-11-10T18:42');
    assert.equal(b.finishedAt, undefined);
  });

  test('workouts without times stay without times', () => {
    const out = store.migrate({ sessions: [base(), timed(session('2026-11-11', 'pullA', [entry('deadlift', W([140, 5]))], { id: 'b' }), '2026-11-11T07:05', '2026-11-11T08:10')] });
    assert.equal(out.sessions[0].startedAt, undefined);
    assert.equal(out.sessions[0].finishedAt, undefined);
    assert.equal(out.sessions[1].startedAt, '2026-11-11T07:05');
    assert.equal(out.sessions[1].finishedAt, '2026-11-11T08:10');
  });

  test('load() applies the same rule to stored state', () => {
    const data = new Map([[store.STORAGE_KEY, JSON.stringify({
      version: 1,
      sessions: [timed(base(), '2026-11-10T18:42', '2026-11-10T19:34'), timed({ ...base(), id: 'c', date: '2026-11-12' }, 'bad', 42)],
    })]]);
    const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
    const out = store.load(storage);
    assert.equal(out.sessions.length, 2);
    assert.equal(out.sessions.find((s) => s.id === 'a').startedAt, '2026-11-10T18:42');
    assert.equal(out.sessions.find((s) => s.id === 'a').finishedAt, '2026-11-10T19:34');
    assert.equal(out.sessions.find((s) => s.id === 'c').startedAt, undefined);
    assert.equal(out.sessions.find((s) => s.id === 'c').finishedAt, undefined);
  });
});

// ---------------------------------------------------------------------------------------------
// §18.3 Workout times — CSV backups
// ---------------------------------------------------------------------------------------------

/** Two timed workouts (one crossing midnight) and one logged before times existed. */
const timedSessions = () => [
  timed(session('2026-11-10', 'legs', [entry('squat', W([100, 5], [100, 5], [100, 7])), entry('rdl', rep(3, 80, 10))]), '2026-11-10T18:42', '2026-11-10T19:34'),
  timed(session('2026-11-07', 'pushA', [entry('bench', rep(5, 62.5, 5)), entry('lateralRaise', rep(3, 10, 15))], { note: 'late one, "tired"' }), '2026-11-07T23:30', '2026-11-08T00:20'),
  session('2026-11-05', 'pullA', [entry('deadlift', W([140, 5])), entry('latPulldown', rep(3, 45, 12))], { offDay: true }),
];

describe('CSV backups keep workout times (§18.3)', () => {
  test('the header gains started_at and finished_at', () => {
    const header = csv.toCSV(timedSessions(), 'kg').split('\n')[0].split(',');
    assert.ok(header.includes('started_at'), `header: ${header.join(',')}`);
    assert.ok(header.includes('finished_at'), `header: ${header.join(',')}`);
    for (const col of ['date', 'day', 'exercise', 'set', 'weight', 'reps', 'unit', 'off_day', 'note']) assert.ok(header.includes(col), col);
  });

  test('the times are repeated on every row of a workout (like note); empty for a workout without times', () => {
    const data = [
      timed(session('2026-11-10', 'legs', [entry('squat', rep(3, 100, 5)), entry('rdl', rep(2, 80, 10))]), '2026-11-10T18:42', '2026-11-10T19:34'),
      session('2026-11-05', 'pullA', [entry('deadlift', W([140, 5]))]),
    ];
    const [head, ...rows] = csv.toCSV(data, 'kg').trim().split('\n').map((l) => l.split(','));
    const iDate = head.indexOf('date');
    const iStart = head.indexOf('started_at');
    const iEnd = head.indexOf('finished_at');
    assert.ok(iStart >= 0 && iEnd >= 0, `header: ${head.join(',')}`);
    const legsRows = rows.filter((r) => r[iDate] === '10/11/2026');
    const pullRows = rows.filter((r) => r[iDate] === '05/11/2026');
    assert.equal(legsRows.length, 5);
    assert.equal(pullRows.length, 1);
    const starts = new Set(legsRows.map((r) => r[iStart]));
    const ends = new Set(legsRows.map((r) => r[iEnd]));
    assert.equal(starts.size, 1, 'same started_at on every row of the workout');
    assert.equal(ends.size, 1, 'same finished_at on every row of the workout');
    assert.notEqual([...starts][0], '', 'started_at filled');
    assert.notEqual([...ends][0], '', 'finished_at filled');
    assert.equal(pullRows[0][iStart] ?? '', '', 'no started_at for a workout without times');
    assert.equal(pullRows[0][iEnd] ?? '', '', 'no finished_at for a workout without times');
  });

  test('round trip parseCSV(toCSV(s)) keeps the times (kg and lb), including one that ends after midnight', () => {
    for (const unit of ['kg', 'lb']) {
      const data = timedSessions();
      const { sessions, warnings } = csv.parseCSV(csv.toCSV(data, unit), { unit });
      assert.deepEqual(warnings, [], unit);
      assert.deepEqual(canonical(sessions), canonical(data), unit);
      assert.deepEqual(timesOf(sessions), timesOf(data), unit);
    }
  });

  test('a workout without times comes back without times', () => {
    const { sessions } = csv.parseCSV(csv.toCSV(timedSessions(), 'kg'), { unit: 'kg' });
    const old = sessions.find((s) => s.date === '2026-11-05');
    assert.equal(old.startedAt, undefined);
    assert.equal(old.finishedAt, undefined);
  });

  test('an old backup without the time columns still imports, with no times and no warnings', () => {
    const text = [
      'date,day,exercise,set,weight,reps,unit,off_day,note',
      '07/11/2026,Push A,Bench press,1,62.5,5,kg,,',
      '07/11/2026,Push A,Bench press,2,62.5,5,kg,,',
      '10/11/2026,Legs,Squat,1,100,5,kg,yes,"slept badly, ""tired"""',
      '',
    ].join('\n');
    const { sessions, warnings } = csv.parseCSV(text, { unit: 'kg' });
    assert.deepEqual(warnings, []);
    assert.deepEqual(canonical(sessions), canonical([
      session('2026-11-07', 'pushA', [entry('bench', rep(2, 62.5, 5))]),
      session('2026-11-10', 'legs', [entry('squat', W([100, 5]))], { offDay: true, note: 'slept badly, "tired"' }),
    ]));
    for (const s of sessions) {
      assert.equal(s.startedAt, undefined);
      assert.equal(s.finishedAt, undefined);
    }
  });

  test('parseImport (CSV pasted into Import) keeps the times too', () => {
    const data = timedSessions();
    const { sessions } = parser.parseImport(csv.toCSV(data, 'kg'), { unit: 'kg', today: TODAY });
    assert.deepEqual(timesOf(sessions), timesOf(data));
  });

  test('toCSV does not mutate its input', () => {
    const data = timedSessions();
    const before = clone(data);
    csv.toCSV(data, 'kg');
    assert.deepEqual(data, before);
  });
});

// ---------------------------------------------------------------------------------------------
// §18.3 Workout times — text backups ("Time: 18:42–19:34")
// ---------------------------------------------------------------------------------------------

/** The text block of the workout whose header line starts with `header`. */
const blockOf = (text, header) => text.split(/\n\s*\n/).find((b) => b.startsWith(header)) || '';

describe('Text backups keep workout times (§18.3)', () => {
  test('formatText writes a "Time: 18:42–19:34" line in that workout\'s block', () => {
    const out = parser.formatText(timedSessions(), 'kg');
    const lines = blockOf(out, '10/11/2026 Legs').split('\n');
    assert.ok(lines.includes('Time: 18:42–19:34'), `Legs block: ${JSON.stringify(lines)}`);
  });

  test('a workout that ends after midnight still prints both clock times', () => {
    const out = parser.formatText(timedSessions(), 'kg');
    const lines = blockOf(out, '07/11/2026 Push A').split('\n');
    assert.ok(lines.includes('Time: 23:30–00:20'), `Push A block: ${JSON.stringify(lines)}`);
  });

  test('no Time line for a workout without times', () => {
    const out = parser.formatText(timedSessions(), 'kg');
    const block = blockOf(out, '05/11/2026 Pull A');
    assert.ok(block, 'the Pull A block exists');
    assert.ok(!/^Time:/m.test(block), `Pull A block should have no Time line: ${JSON.stringify(block)}`);
  });

  test('round trip parseImport(formatText(s)) keeps the times (kg and lb), with no warnings', () => {
    for (const unit of ['kg', 'lb']) {
      const data = timedSessions();
      const { sessions, warnings } = parser.parseImport(parser.formatText(data, unit), { unit, today: TODAY });
      assert.deepEqual(warnings, [], unit);
      assert.deepEqual(canonical(sessions), canonical(data), unit);
      assert.deepEqual(timesOf(sessions), timesOf(data), unit);
    }
  });

  test('a hand-written Time line under the date line is read back (not as an exercise)', () => {
    const text = ['10/11/2026 Legs', 'Time: 18:42–19:34', 'Squat 100x5 x3', 'Note: felt good'].join('\n');
    const { sessions, warnings } = parser.parseImport(text, { unit: 'kg', today: TODAY });
    assert.deepEqual(warnings, []);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].startedAt, '2026-11-10T18:42');
    assert.equal(sessions[0].finishedAt, '2026-11-10T19:34');
    assert.deepEqual(canonical(sessions), canonical([session('2026-11-10', 'legs', [entry('squat', rep(3, 100, 5))], { note: 'felt good' })]));
  });

  test('no Time line → no times', () => {
    const { sessions } = parser.parseImport(['10/11/2026 Legs', 'Squat 100x5 x3'].join('\n'), { unit: 'kg', today: TODAY });
    assert.equal(sessions[0].startedAt, undefined);
    assert.equal(sessions[0].finishedAt, undefined);
  });

  test('formatText does not mutate its input', () => {
    const data = timedSessions();
    const before = clone(data);
    parser.formatText(data, 'kg');
    assert.deepEqual(data, before);
  });
});

// ---------------------------------------------------------------------------------------------
// §18.5 New bests — analysis.newBests(previousSessions, session)
// ---------------------------------------------------------------------------------------------

const KEYS = ['exerciseId', 'role', 'occurrence', 'kind', 'value', 'previous'];
const pick = (b) => Object.fromEntries(KEYS.map((k) => [k, b[k]]));
const order = (a, b) => (`${a.exerciseId}|${a.role}|${a.occurrence}` < `${b.exerciseId}|${b.role}|${b.occurrence}` ? -1 : 1);
/** newBests reduced to the spec's fields, in a stable order (the spec fixes no order). */
const bests = (prev, s) => analysis.newBests(prev, s).map(pick).sort(order);
const best = (exerciseId, role, occurrence, kind, value, previous) => ({ exerciseId, role, occurrence, kind, value, previous });

describe('analysis.newBests (§18.5)', () => {
  const legs = (date, squatSets, more = [], opts) => session(date, 'legs', [entry('squat', squatSets), ...more], opts);

  test('kind "weight": the heaviest weight beats every earlier session of the track', () => {
    const prev = [legs('2026-11-03', rep(3, 80, 5))];
    assert.deepEqual(bests(prev, legs('2026-11-10', W([82.5, 5], [82.5, 5], [82.5, 7]))), [best('squat', 'main', 0, 'weight', 82.5, 80)]);
  });

  test('previous = the best of ALL earlier sessions, not only the last one', () => {
    const prev = [legs('2026-11-01', rep(3, 85, 5)), legs('2026-11-03', rep(3, 80, 5))];
    assert.deepEqual(bests(prev, legs('2026-11-10', rep(3, 82.5, 5))), [], '82.5 does not beat 85');
    assert.deepEqual(bests(prev, legs('2026-11-10', rep(3, 87.5, 5))), [best('squat', 'main', 0, 'weight', 87.5, 85)]);
  });

  test('equal to the previous best is not a new best', () => {
    const prev = [legs('2026-11-03', rep(3, 80, 5))];
    assert.deepEqual(bests(prev, legs('2026-11-10', rep(3, 80, 5))), []);
  });

  test('only sets with reps ≥ 1 count, before and now', () => {
    const prev = [legs('2026-11-03', W([85, 0], [80, 5], [80, 5]))];
    assert.deepEqual(bests(prev, legs('2026-11-10', W([90, 0], [82.5, 5], [82.5, 5]))), [best('squat', 'main', 0, 'weight', 82.5, 80)]);
    assert.deepEqual(bests(prev, legs('2026-11-10', W([90, 0], [80, 5], [80, 5]))), []);
  });

  test('a track\'s first-ever session is never a new best', () => {
    const now = legs('2026-11-10', rep(3, 100, 5), [entry('rdl', rep(3, 60, 10))]);
    assert.deepEqual(bests([], now), []);
    assert.deepEqual(bests([session('2026-11-03', 'pullA', [entry('deadlift', W([140, 5]))])], now), []);
    const prev = [legs('2026-11-03', rep(3, 80, 5))];
    assert.deepEqual(bests(prev, now), [best('squat', 'main', 0, 'weight', 100, 80)], 'Romanian deadlift is new: no best for it');
  });

  test('per occurrence: each Lateral raise of a Push day is its own track', () => {
    const push = (date, lr1, lr2) => session(date, 'pushA', [
      entry('bench', rep(5, 60, 5)), entry('tricepsPushdown', rep(3, 25, 12)), entry('lateralRaise', lr1),
      entry('ohTricepsExt', rep(3, 15, 12)), entry('lateralRaise', lr2),
    ]);
    const prev = [push('2026-11-03', rep(3, 10, 15), rep(3, 6, 20))];
    assert.deepEqual(bests(prev, push('2026-11-10', rep(3, 9, 15), rep(3, 8, 20))), [best('lateralRaise', 'accessory', 1, 'weight', 8, 6)],
      'the second track beat 6 kg; 8 kg is lighter than the first track\'s 10 kg but that is another track');
    assert.deepEqual(bests(prev, push('2026-11-10', rep(3, 12.5, 15), rep(3, 6, 20))), [best('lateralRaise', 'accessory', 0, 'weight', 12.5, 10)]);
  });

  test('per role: Bench press as the main lift and as an accessory are different tracks', () => {
    const prev = [
      session('2026-11-02', 'pushA', [entry('bench', rep(5, 60, 5))]),
      session('2026-11-05', 'pushB', [entry('ohp', rep(5, 40, 5)), entry('bench', rep(3, 50, 10))]),
    ];
    assert.deepEqual(bests(prev, session('2026-11-10', 'pushA', [entry('bench', rep(5, 55, 5))])), [], 'main bench 55 < 60');
    assert.deepEqual(bests(prev, session('2026-11-10', 'pushB', [entry('ohp', rep(5, 40, 5)), entry('bench', rep(3, 55, 10))])),
      [best('bench', 'accessory', 0, 'weight', 55, 50)], 'accessory bench 55 > 50, even though main bench was 60');
  });

  test('kind "hold" for plank (timed): the longest hold beats every earlier one', () => {
    const pull = (date, plankSets) => session(date, 'pullA', [entry('deadlift', W([140, 5])), entry('plank', plankSets)]);
    const prev = [pull('2026-11-03', W([0, 45], [0, 50], [0, 40]))];
    assert.deepEqual(bests(prev, pull('2026-11-10', W([0, 55], [0, 50], [0, 50]))), [best('plank', 'accessory', 0, 'hold', 55, 50)]);
    assert.deepEqual(bests(prev, pull('2026-11-10', W([0, 50], [0, 50], [0, 50]))), [], 'an equal hold is not a best');
  });

  test('plank: a heavier plate with shorter holds is not a hold best', () => {
    const pull = (date, plankSets) => session(date, 'pullA', [entry('plank', plankSets)]);
    const prev = [pull('2026-11-03', W([0, 60], [0, 60], [0, 60]))];
    assert.deepEqual(bests(prev, pull('2026-11-10', W([2.5, 35], [2.5, 30], [2.5, 30]))), []);
  });

  test('off-day sessions count normally, earlier and now', () => {
    const prev = [legs('2026-11-01', rep(3, 85, 5), [], { offDay: true }), legs('2026-11-03', rep(3, 80, 5))];
    assert.deepEqual(bests(prev, legs('2026-11-10', rep(3, 82.5, 5))), [], 'the off-day 85 still counts as the best');
    assert.deepEqual(bests(prev, legs('2026-11-10', W([90, 3], [90, 2], [85, 1]), [], { offDay: true })),
      [best('squat', 'main', 0, 'weight', 90, 85)], 'an off-day session can set a new best');
  });

  test('several bests in one workout, custom exercises included; bodyweight 0 → 0 is no best', () => {
    const prev = [session('2026-11-03', 'pullA', [
      entry('deadlift', W([140, 5])), entry('pullUp', rep(3, 0, 10)),
      entry('custom:zercher squat', rep(2, 60, 8), 'Zercher squat'),
    ])];
    const now = session('2026-11-10', 'pullA', [
      entry('deadlift', W([145, 5])), entry('pullUp', rep(3, 0, 12)),
      entry('custom:zercher squat', rep(2, 65, 8), 'Zercher squat'),
    ]);
    assert.deepEqual(bests(prev, now), [
      best('custom:zercher squat', 'accessory', 0, 'weight', 65, 60),
      best('deadlift', 'main', 0, 'weight', 145, 140),
    ]);
  });

  test('earlier sessions in any order; inputs are not mutated', () => {
    const prev = [legs('2026-11-03', rep(3, 80, 5)), legs('2026-10-20', rep(3, 70, 5)), legs('2026-10-27', rep(3, 75, 5))];
    const now = legs('2026-11-10', rep(3, 82.5, 5));
    const before = clone({ prev, now });
    assert.deepEqual(bests(prev, now), [best('squat', 'main', 0, 'weight', 82.5, 80)]);
    assert.deepEqual({ prev, now }, before);
  });
});
