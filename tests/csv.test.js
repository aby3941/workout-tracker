import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_HEADER, toCSV, parseCSV } from '../public/js/csv.js';
import { convertWeight } from '../public/js/units.js';
import { customId } from '../public/js/program.js';
import { session, entry, sets, rep, clone, canonical, richSessions } from './_helpers.js';

const W = (...pairs) => sets(...pairs);
const rows = (...l) => l.join('\n') + '\n';

/** Sessions with catalog exercises only (no custom names → no reason for any warning). */
const plainSessions = () => [
  session('2026-11-07', 'pushA', [entry('bench', rep(5, 62.5, 5)), entry('lateralRaise', rep(3, 10, 15))], { offDay: true }),
  session('2026-11-03', 'pullA', [entry('deadlift', W([140, 7])), entry('latPulldown', W([45, 12], [45, 10]))], { note: 'good' }),
  session('2026-11-05', 'legs', [entry('squat', rep(3, 100, 5))]),
];

describe('CSV_HEADER', () => {
  test('exact header', () => {
    assert.equal(CSV_HEADER, 'date,day,exercise,set,weight,reps,unit,off_day,note');
  });
});

describe('toCSV', () => {
  test('exact output: header, sorted sessions, set numbering, quoting, off_day, note on every row', () => {
    const data = [
      session('2026-11-10', 'pullA', [
        entry('deadlift', W([100, 7])),
        entry(customId('Zercher, squat'), W([60, 8], [62.5, 6]), 'Zercher, squat'),
      ], { offDay: true, note: 'slept badly, "tired"' }),
      session('2026-11-07', 'pushA', [entry('bench', W([56.25, 5], [56.25, 5]))]),
    ];
    assert.equal(toCSV(data, 'kg'), rows(
      'date,day,exercise,set,weight,reps,unit,off_day,note',
      '07/11/2026,Push A,Bench press,1,56.25,5,kg,,',
      '07/11/2026,Push A,Bench press,2,56.25,5,kg,,',
      '10/11/2026,Pull A,Deadlift,1,100,7,kg,yes,"slept badly, ""tired"""',
      '10/11/2026,Pull A,"Zercher, squat",1,60,8,kg,yes,"slept badly, ""tired"""',
      '10/11/2026,Pull A,"Zercher, squat",2,62.5,6,kg,yes,"slept badly, ""tired"""',
    ));
  });

  test('set numbers restart for each entry, even for the same exercise', () => {
    const data = [session('2026-11-10', 'pushA', [
      entry('lateralRaise', rep(2, 10, 15)),
      entry('lateralRaise', rep(2, 10, 12)),
    ])];
    const setCol = toCSV(data, 'kg').trim().split('\n').slice(1).map((r) => r.split(',')[3]);
    assert.deepEqual(setCol, ['1', '2', '1', '2']);
  });

  test('unit column, day display names, weights without trailing .0', () => {
    const data = [
      session('2026-11-01', 'legs', [entry('squat', W([225, 5]))]),
      session('2026-11-02', 'pullB', [entry('barbellRow', W([135.5, 5]))]),
      session('2026-11-03', 'pushB', [entry('ohp', W([95, 5]))]),
    ];
    assert.equal(toCSV(data, 'lb'), rows(
      CSV_HEADER,
      '01/11/2026,Legs,Squat,1,225,5,lb,,',
      '02/11/2026,Pull B,Barbell row,1,135.5,5,lb,,',
      '03/11/2026,Push B,Overhead press,1,95,5,lb,,',
    ));
  });

  test('a note with a newline is quoted', () => {
    const out = toCSV([session('2026-11-10', 'legs', [entry('squat', W([100, 5]))], { note: 'line one\nline two' })], 'kg');
    assert.ok(out.includes('"line one\nline two"'));
    assert.ok(out.endsWith('\n'));
    assert.ok(!out.includes('\r'));
  });

  test('no sessions → header line only', () => {
    assert.equal(toCSV([], 'kg'), CSV_HEADER + '\n');
  });

  test('does not mutate its input', () => {
    const data = richSessions();
    const before = clone(data);
    toCSV(data, 'kg');
    assert.deepEqual(data, before);
  });
});

describe('parseCSV round trip', () => {
  test('kg: parseCSV(toCSV(s)) equals s, no warnings', () => {
    const data = plainSessions();
    const { sessions, warnings } = parseCSV(toCSV(data, 'kg'), { unit: 'kg' });
    assert.deepEqual(warnings, []);
    assert.deepEqual(canonical(sessions), canonical(data));
    assert.ok(sessions.every((s) => s.id === undefined));
  });

  test('rich sessions (custom, bodyweight, same date twice, repeated exercise) in kg and lb', () => {
    for (const unit of ['kg', 'lb']) {
      const data = richSessions();
      const { sessions } = parseCSV(toCSV(data, unit), { unit });
      assert.deepEqual(canonical(sessions), canonical(data), unit);
    }
  });

  test('notes with commas, quotes and newlines survive', () => {
    const data = [
      session('2026-11-10', 'legs', [entry('squat', rep(3, 100, 5)), entry('rdl', rep(3, 80, 10))], { note: 'line one\nline "two", end' }),
      session('2026-11-11', 'pullA', [entry('deadlift', W([140, 5]))], { note: 'a,b' }),
    ];
    const { sessions } = parseCSV(toCSV(data, 'kg'), { unit: 'kg' });
    assert.deepEqual(canonical(sessions), canonical(data));
  });

  test('custom exercise names come back with the custom id and stored name', () => {
    const data = [session('2026-11-10', 'pushA', [entry(customId('Cable Y-raise, slow'), W([5, 15]), 'Cable Y-raise, slow')])];
    const { sessions } = parseCSV(toCSV(data, 'kg'), { unit: 'kg' });
    assert.deepEqual(canonical(sessions)[0].entries, [{ exerciseId: 'custom:cable y raise slow', name: 'Cable Y-raise, slow', sets: W([5, 15]) }]);
  });
});

describe('parseCSV input formats', () => {
  test('BOM + tab delimiter + CRLF + columns in any order, header case-insensitive', () => {
    const text = '\uFEFF' + [
      'Reps\tExercise\tSet\tWeight\tDATE\tDay\tUnit\tOff_Day\tNote',
      '7\tDeadlift\t1\t100\t10/11/2026\tPull A\tkg\tyes\tgood',
      '12\tLat pulldown\t1\t45\t10/11/2026\tPull A\tkg\tyes\tgood',
      '10\tLat pulldown\t2\t45\t10/11/2026\tPull A\tkg\tyes\tgood',
    ].join('\r\n') + '\r\n';
    const { sessions, warnings } = parseCSV(text, { unit: 'kg' });
    assert.deepEqual(warnings, []);
    assert.deepEqual(canonical(sessions), [{
      date: '2026-11-10', day: 'pullA', offDay: true, note: 'good',
      entries: [
        { exerciseId: 'deadlift', sets: W([100, 7]) },
        { exerciseId: 'latPulldown', sets: W([45, 12], [45, 10]) },
      ],
    }]);
  });

  test('the delimiter is detected from the header line even after blank lines (review fix)', () => {
    const tsv = 'date\tday\texercise\tweight\treps\n10/11/2026\tPull A\tDeadlift\t100\t7\n';
    for (const text of ['\n' + tsv, '\r\n  \r\n' + tsv, '\uFEFF\n' + tsv]) {
      const { sessions, warnings } = parseCSV(text, { unit: 'kg' });
      assert.deepEqual(warnings, [], JSON.stringify(text.slice(0, 6)));
      assert.deepEqual(canonical(sessions), [
        { date: '2026-11-10', day: 'pullA', offDay: false, note: '', entries: [{ exerciseId: 'deadlift', sets: W([100, 7]) }] },
      ]);
    }
  });

  test('only date, day, exercise, weight, reps required; ISO dates; day by id or name, any case', () => {
    const text = rows(
      'date,day,exercise,weight,reps',
      '2026-11-10,pulla,Deadlift,100,7',
      '2026-11-10,PULL A,Lat pulldown,45,12',
      '10/11/2026,Pull A,Face pull,20,20',
    );
    const { sessions, warnings } = parseCSV(text, { unit: 'kg' });
    assert.deepEqual(warnings, []);
    assert.deepEqual(canonical(sessions), [{
      date: '2026-11-10', day: 'pullA', offDay: false, note: '',
      entries: [
        { exerciseId: 'deadlift', sets: W([100, 7]) },
        { exerciseId: 'latPulldown', sets: W([45, 12]) },
        { exerciseId: 'facePull', sets: W([20, 20]) },
      ],
    }]);
  });

  test('rows group into sessions by (date, day)', () => {
    const text = rows(
      'date,day,exercise,set,weight,reps',
      '07/11/2026,Push B,Overhead press,1,40,5',
      '07/11/2026,Pull B,Barbell row,1,60,5',
      '10/11/2026,Push B,Overhead press,1,42.5,5',
    );
    const { sessions } = parseCSV(text, { unit: 'kg' });
    assert.deepEqual(sessions.map((s) => [s.date, s.day]).sort(), [
      ['2026-11-07', 'pullB'], ['2026-11-07', 'pushB'], ['2026-11-10', 'pushB'],
    ]);
  });

  test('new entry when the exercise changes or the set number does not increase', () => {
    const text = rows(
      'date,day,exercise,set,weight,reps',
      '10/11/2026,Push A,Lateral raise,1,10,15',
      '10/11/2026,Push A,Lateral raise,2,10,15',
      '10/11/2026,Push A,Lateral raise,1,10,15',
      '10/11/2026,Push A,Lateral raise,2,10,14',
      '10/11/2026,Push A,Triceps pushdown,1,25,12',
      '10/11/2026,Push A,Triceps pushdown,2,25,12',
      '10/11/2026,Push A,Front raise,1,7.5,15',
      '10/11/2026,Push A,Front raise,1,7.5,12',
    );
    const { sessions } = parseCSV(text, { unit: 'kg' });
    assert.equal(sessions.length, 1);
    assert.deepEqual(canonical(sessions)[0].entries, [
      { exerciseId: 'lateralRaise', sets: W([10, 15], [10, 15]) },
      { exerciseId: 'lateralRaise', sets: W([10, 15], [10, 14]) },
      { exerciseId: 'tricepsPushdown', sets: W([25, 12], [25, 12]) },
      { exerciseId: 'frontRaise', sets: W([7.5, 15]) },
      { exerciseId: 'frontRaise', sets: W([7.5, 12]) },
    ]);
  });

  test('row unit different from the target unit → converted', () => {
    const text = rows(
      'date,day,exercise,set,weight,reps,unit',
      '10/11/2026,Pull A,Deadlift,1,225,5,lb',
      '10/11/2026,Pull A,Lat pulldown,1,45,12,kg',
    );
    const kg = parseCSV(text, { unit: 'kg' }).sessions[0].entries.map((e) => e.sets[0].weight);
    assert.deepEqual(kg, [convertWeight(225, 'lb', 'kg'), 45]);
    const lb = parseCSV(text, { unit: 'lb' }).sessions[0].entries.map((e) => e.sets[0].weight);
    assert.deepEqual(lb, [225, convertWeight(45, 'kg', 'lb')]);
  });

  test('bad rows → one warning each with the 1-based line number; row skipped', () => {
    const text = rows(
      'date,day,exercise,set,weight,reps,unit,off_day,note', // 1
      '10/11/2026,Pull A,Deadlift,1,100,7,kg,,', // 2
      '10/11/2026,Pull A,Lat pulldown,1,heavy,12,kg,,', // 3 bad weight
      '31/02/2026,Pull A,Lat pulldown,1,45,12,kg,,', // 4 impossible date
      '10/11/2026,Funday,Lat pulldown,1,45,12,kg,,', // 5 unknown day
      '10/11/2026,Pull A,Lat pulldown,1,45,,kg,,', // 6 missing reps
      '10/11/2026,Pull A,Face pull,1,20,20,kg,,', // 7
    );
    const { sessions, warnings } = parseCSV(text, { unit: 'kg' });
    assert.deepEqual(warnings.map((w) => w.line).sort((a, b) => a - b), [3, 4, 5, 6]);
    assert.deepEqual(canonical(sessions), [{
      date: '2026-11-10', day: 'pullA', offDay: false, note: '',
      entries: [
        { exerciseId: 'deadlift', sets: W([100, 7]) },
        { exerciseId: 'facePull', sets: W([20, 20]) },
      ],
    }]);
  });

  test('default unit is kg', () => {
    const text = rows('date,day,exercise,set,weight,reps,unit', '10/11/2026,Pull A,Deadlift,1,225,5,lb');
    assert.equal(parseCSV(text, {}).sessions[0].entries[0].sets[0].weight, convertWeight(225, 'lb', 'kg'));
  });
});
