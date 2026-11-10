import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, parseSetTokens, formatText } from '../public/js/parser.js';
import { parseCSV, toCSV } from '../public/js/csv.js';
import { convertWeight } from '../public/js/units.js';
import { customId } from '../public/js/program.js';
import { session, entry, sets, rep, clone, canonical, richSessions } from './_helpers.js';

const TODAY = '2026-11-10';
const ps = (str, unit = 'kg') => parseSetTokens(str, { unit });
const imp = (text, opts = {}) => parseImport(text, { unit: 'kg', today: TODAY, ...opts });
const lines = (...l) => l.join('\n');
const W = (...pairs) => sets(...pairs);

function assertSets(str, expected, unit = 'kg') {
  const r = ps(str, unit);
  assert.deepEqual(r.sets, expected, JSON.stringify(str));
  assert.deepEqual(r.errors, [], `no errors for ${JSON.stringify(str)}`);
}

// ---------------------------------------------------------------- parseSetTokens

describe('parseSetTokens', () => {
  test('WxR with x / X / × / * and optional spaces', () => {
    for (const s of ['100x5', '100 x 5', '100×5', '100 × 5', '100*5', '100X5']) assertSets(s, W([100, 5]));
    assertSets('62.5x5', W([62.5, 5]));
    assertSets('56.25x8', W([56.25, 8]));
  });

  test('several sets; whitespace , ; | are separators', () => {
    assertSets('100x5 100x5 100x7', W([100, 5], [100, 5], [100, 7]));
    assertSets('100x5, 100x5; 100x7 | 100x6', W([100, 5], [100, 5], [100, 7], [100, 6]));
    assertSets('100x5,100x6', W([100, 5], [100, 6]));
  });

  test('unit suffix on the weight converts to the target unit', () => {
    assertSets('100kg x 5', W([100, 5]), 'kg');
    assertSets('100kg x 5', W([convertWeight(100, 'kg', 'lb'), 5]), 'lb');
    assertSets('225lbx5', W([convertWeight(225, 'lb', 'kg'), 5]), 'kg');
    assertSets('225 lbs x 5', W([convertWeight(225, 'lb', 'kg'), 5]), 'kg');
    assertSets('225lb x 5', W([225, 5]), 'lb');
    assertSets('225 lbs x 5', W([225, 5]), 'lb');
  });

  test('bodyweight: bw = 0, BW+N = added weight N', () => {
    assertSets('bw x 8', W([0, 8]));
    assertSets('bwx8', W([0, 8]));
    assertSets('BW x 8', W([0, 8]));
    assertSets('BW+10x8', W([10, 8]));
    assertSets('bw+2.5x6', W([2.5, 6]));
    assertSets('bwx8 x3', rep(3, 0, 8));
  });

  test('lone xN repeats the previous set until there are N in a row', () => {
    assertSets('45x12 x3', rep(3, 45, 12));
    assertSets('20x20 x5', rep(5, 20, 20));
    assertSets('100x5 ×3', rep(3, 100, 5));
    assertSets('100x5 100x5 x3', rep(3, 100, 5));
    assertSets('100x5 x1', W([100, 5]));
    assertSets('100x3 100x5 x2', W([100, 3], [100, 5], [100, 5]));
    assertSets('45x12 x3 45x10', [...rep(3, 45, 12), { weight: 45, reps: 10 }]);
    assertSets('50x12 x3 55x10 50x12 x3', [...rep(3, 50, 12), { weight: 55, reps: 10 }, ...rep(3, 50, 12)]);
  });

  test('SxR@W: S sets of R reps at W (only with @)', () => {
    assertSets('3x12@45', rep(3, 45, 12));
    assertSets('3 x 12 @ 45', rep(3, 45, 12));
    assertSets('5x5 @ 100kg', rep(5, 100, 5), 'kg');
    assertSets('5x5 @ 100kg', rep(5, convertWeight(100, 'kg', 'lb'), 5), 'lb');
    assertSets('3x12@45, 1x10@40', [...rep(3, 45, 12), { weight: 40, reps: 10 }]);
    assertSets('3x12', W([3, 12])); // without @ it is weight × reps
  });

  test('bare integers after a set: same weight, new reps; slash lists too', () => {
    assertSets('100x5, 5, 7', W([100, 5], [100, 5], [100, 7]));
    assertSets('100x5 5 7', W([100, 5], [100, 5], [100, 7]));
    assertSets('100x5/5/7', W([100, 5], [100, 5], [100, 7]));
    assertSets('45x12/12/10', W([45, 12], [45, 12], [45, 10]));
    assertSets('100x5 x3, 7', [...rep(3, 100, 5), { weight: 100, reps: 7 }]);
  });

  test('commas are never decimal points', () => {
    assertSets('100x5,5', W([100, 5], [100, 5]));
    const r = ps('62,5x5');
    assert.ok(r.sets.every((s) => s.weight !== 62.5), 'no 62.5 from "62,5"');
    assert.ok(r.sets.every((s) => Number.isInteger(s.reps)), 'reps are integers');
  });

  test('unparseable tokens become errors; parseable sets are kept', () => {
    const r = ps('100x5 foo 100x6');
    assert.deepEqual(r.sets, W([100, 5], [100, 6]));
    assert.equal(r.errors.length, 1);
    assert.equal(typeof r.errors[0], 'string');

    const bad = ps('abc');
    assert.deepEqual(bad.sets, []);
    assert.ok(bad.errors.length >= 1);
    assert.ok(bad.errors.every((e) => typeof e === 'string'));
  });

  test('empty input → no sets, no errors', () => {
    assert.deepEqual(ps(''), { sets: [], errors: [] });
  });
});

// ---------------------------------------------------------------- parseImport (text)

describe('parseImport: text mode', () => {
  const MULTI = lines(
    '07/11/2026 Pull A',
    'Deadlift 100x7',
    'Lat pulldown 45x12 45x12 45x10',
    'Face pull 20x20 x5',
    'Note: slept badly',
    '',
    '10/11/2026 Push A (off day)',
    'Bench press 60x5 x4, 60x8',
    'Overhead press 3x10@30',
    'Lateral raise 10x15 x3',
    'Triceps pushdown 25x12 x3',
    'Lateral raise 10x15, 14, 12',
  );

  test('multi-session text', () => {
    const { sessions, warnings } = imp(MULTI);
    assert.deepEqual(warnings, []);
    assert.deepEqual(canonical(sessions), [
      {
        date: '2026-11-07', day: 'pullA', offDay: false, note: 'slept badly',
        entries: [
          { exerciseId: 'deadlift', sets: W([100, 7]) },
          { exerciseId: 'latPulldown', sets: W([45, 12], [45, 12], [45, 10]) },
          { exerciseId: 'facePull', sets: rep(5, 20, 20) },
        ],
      },
      {
        date: '2026-11-10', day: 'pushA', offDay: true, note: '',
        entries: [
          { exerciseId: 'bench', sets: [...rep(4, 60, 5), { weight: 60, reps: 8 }] },
          { exerciseId: 'ohp', sets: rep(3, 30, 10) },
          { exerciseId: 'lateralRaise', sets: rep(3, 10, 15) },
          { exerciseId: 'tricepsPushdown', sets: rep(3, 25, 12) },
          { exerciseId: 'lateralRaise', sets: W([10, 15], [10, 14], [10, 12]) },
        ],
      },
    ]);
  });

  test('sessions have no id; CRLF and surrounding spaces are tolerated', () => {
    const { sessions, warnings } = imp('  10/11/2026 Pull A  \r\n  Deadlift 100x7  \r\n');
    assert.equal(warnings.length, 0);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, undefined);
    assert.deepEqual(canonical(sessions)[0].entries, [{ exerciseId: 'deadlift', sets: W([100, 7]) }]);
  });

  test('a session continues across blank lines until the next header', () => {
    const { sessions } = imp(lines('10/11/2026 Pull A', '', 'Deadlift 100x7', '', '', 'Lat pulldown 45x12 x3'));
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].entries.map((e) => e.exerciseId), ['deadlift', 'latPulldown']);
  });

  test('header with a weekday, ordinal or relative date', () => {
    const { sessions } = imp(lines(
      'Tue 03/11/2026 Pull A', 'Deadlift 100x5',
      '5th Nov 2026 Push A', 'Bench press 60x5 x5',
      'yesterday Legs', 'Squat 100x5 x3',
    ));
    assert.deepEqual(sessions.map((s) => [s.date, s.day]).sort(), [
      ['2026-11-03', 'pullA'], ['2026-11-05', 'pushA'], ['2026-11-09', 'legs'],
    ]);
  });

  test('name: trailing ":" / "-" stripped, aliases and plurals resolved', () => {
    const { sessions, warnings } = imp(lines(
      '10/11/2026 Pull A',
      'Deadlift: 100x7',
      'Lat pulldown - 45x12 x3',
      'face pulls 20x20 x5',
      'Hammers 12.5x10 x4',
    ));
    assert.deepEqual(warnings, []);
    assert.deepEqual(sessions[0].entries.map((e) => e.exerciseId), ['deadlift', 'latPulldown', 'facePull', 'hammerCurl']);
  });

  test('bodyweight and unit-suffixed sets', () => {
    const { sessions } = imp(lines('10/11/2026 Pull A', 'Pull-ups bw x 8, bwx8, BW+10x6', 'Deadlift 225lbx5'));
    assert.deepEqual(sessions[0].entries[0].sets, W([0, 8], [0, 8], [10, 6]));
    assert.deepEqual(sessions[0].entries[1].sets, W([convertWeight(225, 'lb', 'kg'), 5]));
  });

  test('weights convert to the target unit', () => {
    const { sessions } = imp(lines('10/11/2026 Pull A', 'Deadlift 100kg x 5'), { unit: 'lb' });
    assert.deepEqual(sessions[0].entries[0].sets, W([convertWeight(100, 'kg', 'lb'), 5]));
  });
});

describe('parseImport: day resolution', () => {
  const dayOf = (text) => {
    const { sessions } = imp(text);
    assert.equal(sessions.length, 1, text);
    return [sessions[0].day, Boolean(sessions[0].offDay)];
  };

  test('no day text: inferred from the exercises', () => {
    assert.deepEqual(dayOf(lines('10/11/2026', 'Deadlift 100x5', 'Lat pulldown 45x12 x3')), ['pullA', false]);
    assert.deepEqual(dayOf(lines('10/11/2026', 'Barbell row 60x5 x5', 'Lat pulldown 45x12 x3')), ['pullB', false]);
    assert.deepEqual(dayOf(lines('10/11/2026', 'Squat 100x5 x3', 'Leg press 100x10 x3')), ['legs', false]);
    assert.deepEqual(dayOf(lines('10/11/2026', 'Overhead press 40x5 x5', 'Bench press 50x10 x3')), ['pushB', false]);
  });

  test('type without variant: main lift decides', () => {
    assert.deepEqual(dayOf(lines('10/11/2026 Push', 'Overhead press 40x5 x5', 'Lateral raise 10x15 x3')), ['pushB', false]);
    assert.deepEqual(dayOf(lines('10/11/2026 Push', 'Bench press 60x5 x5')), ['pushA', false]);
    assert.deepEqual(dayOf(lines('10/11/2026 Pull', 'Barbell row 60x5 x5')), ['pullB', false]);
    assert.deepEqual(dayOf(lines('10/11/2026 Leg day', 'Squat 100x5 x3')), ['legs', false]);
  });

  test('explicit variant wins over the exercises', () => {
    assert.deepEqual(dayOf(lines('10/11/2026 Pull B', 'Deadlift 100x5')), ['pullB', false]);
  });

  test('off day / bad day', () => {
    assert.deepEqual(dayOf(lines('10/11/2026 Pull A (off day)', 'Deadlift 100x4')), ['pullA', true]);
    assert.deepEqual(dayOf(lines('10/11/2026 bad day', 'Deadlift 100x4')), ['pullA', true]);
  });

  test('unresolvable day → warning, session skipped, later sessions still parse', () => {
    const { sessions, warnings } = parseImport(lines(
      '10/11/2026',
      'Zercher squat 60x8',
      '',
      '11/11/2026 Legs',
      'Squat 100x5 x3',
    ), { unit: 'kg', today: '2026-11-12' });
    assert.deepEqual(sessions.map((s) => [s.date, s.day]), [['2026-11-11', 'legs']]);
    assert.ok(warnings.length >= 1);
    assert.ok(warnings.every((w) => w.line >= 1 && w.line <= 2), JSON.stringify(warnings.map((w) => w.line)));
  });
});

describe('parseImport: warnings and recovery', () => {
  test('unknown exercise → custom entry (name as typed) + one warning on that line', () => {
    const { sessions, warnings } = imp(lines('10/11/2026 Pull A', 'Deadlift 100x5', '  Zercher squat: 60x8 60x8  '));
    assert.deepEqual(canonical(sessions)[0].entries, [
      { exerciseId: 'deadlift', sets: W([100, 5]) },
      { exerciseId: customId('Zercher squat'), name: 'Zercher squat', sets: rep(2, 60, 8) },
    ]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].line, 3);
  });

  test('warnings carry line, text and message', () => {
    const { warnings } = imp(lines('10/11/2026 Pull A', 'Zercher squat 60x8'));
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].line, 2);
    assert.equal(typeof warnings[0].text, 'string');
    assert.equal(typeof warnings[0].message, 'string');
  });

  test('invalid date → warning; lines skipped until the next header', () => {
    const { sessions, warnings } = imp(lines(
      '31/02/2026 Pull A', // 1
      'Deadlift 100x5', // 2
      'Lat pulldown 45x12 x3', // 3
      '', // 4
      '10/11/2026 Push A', // 5
      'Bench press 60x5 x5', // 6
    ));
    assert.deepEqual(sessions.map((s) => [s.date, s.day]), [['2026-11-10', 'pushA']]);
    assert.deepEqual(sessions[0].entries.map((e) => e.exerciseId), ['bench']);
    assert.ok(warnings.some((w) => w.line === 1));
    assert.ok(warnings.every((w) => w.line < 5));
  });

  test('exercise lines before any header → a session dated today + one warning', () => {
    const { sessions, warnings } = imp(lines('Deadlift 100x5', 'Lat pulldown 45x12 x3'));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].date, TODAY);
    assert.equal(sessions[0].day, 'pullA');
    assert.deepEqual(sessions[0].entries.map((e) => e.exerciseId), ['deadlift', 'latPulldown']);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].line, 1);
  });

  test('headerless lines then a header → two sessions', () => {
    const { sessions } = parseImport(lines('Deadlift 100x5', '10/11/2026 Push A', 'Bench press 60x5 x5'), { unit: 'kg', today: '2026-11-12' });
    assert.deepEqual(sessions.map((s) => [s.date, s.day]).sort(), [['2026-11-10', 'pushA'], ['2026-11-12', 'pullA']]);
  });

  test('a bad token: the good sets are kept, warning on that line', () => {
    const { sessions, warnings } = imp(lines('10/11/2026 Pull A', 'Deadlift 100x7 oops', 'Lat pulldown 45x12 x3'));
    assert.equal(sessions[0].entries[0].exerciseId, 'deadlift');
    assert.deepEqual(sessions[0].entries[0].sets, W([100, 7]));
    assert.equal(sessions[0].entries.length, 2);
    assert.ok(warnings.length >= 1);
    assert.ok(warnings.every((w) => w.line === 2));
  });

  test('a line with zero parseable sets → entry skipped, warning on that line', () => {
    const { sessions, warnings } = imp(lines('10/11/2026 Pull A', 'Deadlift 100x7', 'Lat pulldown 45xx', 'Face pull 20x20 x5'));
    assert.deepEqual(sessions[0].entries.map((e) => e.exerciseId), ['deadlift', 'facePull']);
    assert.ok(warnings.length >= 1);
    assert.ok(warnings.every((w) => w.line === 3));
  });

  test('a header with ":" after the date starts a new session, not more lines of the previous one (review fix)', () => {
    const { sessions, warnings } = imp(lines(
      '07/11/2026 Pull A',
      'Deadlift 100x7',
      '',
      '10/11/2026: Push A',
      'Bench press 60x5 x5',
      'Tuesday,03/11/2026 Legs',
      'Squat 100x5 x3',
    ));
    assert.deepEqual(warnings, []);
    assert.deepEqual(sessions.map((s) => [s.date, s.day, s.entries.map((e) => e.exerciseId)]).sort(), [
      ['2026-11-03', 'legs', ['squat']],
      ['2026-11-07', 'pullA', ['deadlift']],
      ['2026-11-10', 'pushA', ['bench']],
    ]);
  });
});

describe('parseImport: custom names containing numbers (review fix)', () => {
  const NAMES = ['21s', 'Incline 45 press', '1-arm cable row', '45° back extension', 'BW dips', 'Cable fly 2', 'x2 curl'];

  test('the sets start at the first word that begins a set; earlier number words stay in the name', () => {
    const { sessions } = imp(lines('10/11/2026 Pull A', '21s 10x21 x3', 'Incline 45 press 30x10', 'BW dips bwx10 x2'));
    assert.deepEqual(canonical(sessions)[0].entries, [
      { exerciseId: customId('21s'), name: '21s', sets: rep(3, 10, 21) },
      { exerciseId: customId('Incline 45 press'), name: 'Incline 45 press', sets: W([30, 10]) },
      { exerciseId: customId('BW dips'), name: 'BW dips', sets: rep(2, 0, 10) },
    ]);
  });

  test('round trip keeps such custom exercises', () => {
    for (const unit of ['kg', 'lb']) {
      const data = [session('2026-11-10', 'pushA', [
        entry('bench', rep(5, 60, 5)),
        ...NAMES.map((n, i) => entry(customId(n), sets([10 + i, 12], [10 + i, 10]), n)),
      ])];
      const { sessions } = parseImport(formatText(data, unit), { unit, today: TODAY });
      assert.deepEqual(canonical(sessions), canonical(data), unit);
    }
  });

  test('when no word begins a set, the first number word is still where the sets start', () => {
    const { sessions, warnings } = imp(lines('10/11/2026 Legs', 'Squat 100 5 5 5', 'Leg press 100x10 x3'));
    assert.deepEqual(sessions[0].entries.map((e) => e.exerciseId), ['legPress']);
    assert.ok(warnings.length >= 1);
    assert.ok(warnings.every((w) => w.line === 2));
  });
});

describe('parseImport: CSV detection', () => {
  const csvSessions = [
    session('2026-11-07', 'pullA', [entry('deadlift', W([100, 7])), entry('latPulldown', rep(3, 45, 12))], { note: 'ok' }),
    session('2026-11-10', 'pushA', [entry('bench', rep(5, 60, 5))], { offDay: true }),
  ];

  test('a CSV header line delegates to parseCSV', () => {
    const text = toCSV(csvSessions, 'kg');
    const viaImport = parseImport(text, { unit: 'kg', today: TODAY });
    assert.deepEqual(viaImport, parseCSV(text, { unit: 'kg' }));
    assert.deepEqual(canonical(viaImport.sessions), canonical(csvSessions));
  });

  test('BOM before the header, and unit passed through', () => {
    const text = '\uFEFF' + toCSV(csvSessions, 'kg');
    const viaImport = parseImport(text, { unit: 'lb', today: TODAY });
    assert.deepEqual(viaImport, parseCSV(text, { unit: 'lb' }));
    assert.equal(viaImport.sessions.length, 2);
  });

  test('tab-separated header with only some columns', () => {
    const text = 'date\tday\texercise\tweight\treps\n10/11/2026\tPull A\tDeadlift\t100\t7\n';
    const viaImport = parseImport(text, { unit: 'kg', today: TODAY });
    assert.deepEqual(viaImport, parseCSV(text, { unit: 'kg' }));
    assert.deepEqual(canonical(viaImport.sessions), [
      { date: '2026-11-10', day: 'pullA', offDay: false, note: '', entries: [{ exerciseId: 'deadlift', sets: W([100, 7]) }] },
    ]);
  });
});

// ---------------------------------------------------------------- formatText

describe('formatText', () => {
  test('exact output: date-ascending, blank line between sessions, off-day header, note last', () => {
    const data = [
      session('2026-11-10', 'pullA', [
        entry('deadlift', W([100, 7])),
        entry('latPulldown', W([45, 12], [45, 10], [45, 8])),
        entry('facePull', rep(5, 20, 20)),
      ], { note: 'slept badly' }),
      session('2026-11-07', 'pushA', [
        entry('bench', W([62.5, 5])),
        entry(customId('Zercher squat'), W([60, 8], [56.25, 10]), 'Zercher squat'),
      ], { offDay: true }),
    ];
    const expected = lines(
      '07/11/2026 Push A (off day)',
      'Bench press 62.5x5',
      'Zercher squat 60x8 56.25x10',
      '',
      '10/11/2026 Pull A',
      'Deadlift 100x7',
      'Lat pulldown 45x12 45x10 45x8',
      'Face pull 20x20 x5',
      'Note: slept badly',
    );
    assert.equal(formatText(data, 'kg').replace(/\n+$/, ''), expected);
  });

  test('day display names', () => {
    const out = formatText([
      session('2026-11-01', 'legs', [entry('squat', W([100, 5]))]),
      session('2026-11-02', 'pullB', [entry('barbellRow', W([60, 5]))]),
      session('2026-11-03', 'pushB', [entry('ohp', W([40, 5]))]),
    ], 'kg');
    const headers = out.split('\n').filter((l) => /^\d\d\/\d\d\/\d{4}/.test(l));
    assert.deepEqual(headers, ['01/11/2026 Legs', '02/11/2026 Pull B', '03/11/2026 Push B']);
  });

  test('does not mutate its input', () => {
    const data = richSessions();
    const before = clone(data);
    formatText(data, 'kg');
    assert.deepEqual(data, before);
  });

  test('round trip (kg): parseImport(formatText(s)).sessions equals s, ignoring id', () => {
    const data = richSessions();
    const { sessions } = parseImport(formatText(data, 'kg'), { unit: 'kg', today: TODAY });
    assert.deepEqual(canonical(sessions), canonical(data));
  });

  test('round trip (lb)', () => {
    const data = richSessions();
    const { sessions } = parseImport(formatText(data, 'lb'), { unit: 'lb', today: TODAY });
    assert.deepEqual(canonical(sessions), canonical(data));
  });

  test('round trip keeps identical consecutive sets and runs split by another set', () => {
    const data = [session('2026-11-10', 'pushA', [
      entry('bench', [...rep(2, 60, 5), { weight: 60, reps: 8 }]),
      entry('ohp', [...rep(3, 30, 10), { weight: 32.5, reps: 8 }, ...rep(3, 30, 10)]),
      entry('lateralRaise', rep(2, 10, 15)),
    ])];
    const { sessions } = imp(formatText(data, 'kg'));
    assert.deepEqual(canonical(sessions), canonical(data));
  });
});
