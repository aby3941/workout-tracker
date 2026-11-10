// Spec §15: effort notes + set cap, duplicate blocks in a paste, custom names that match the catalog.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, parseSetTokens } from '../public/js/parser.js';
import { getDayPlan } from '../public/js/program.js';
import { sets } from './_helpers.js';

const TODAY = '2026-11-10';
const ps = (str) => parseSetTokens(str, { unit: 'kg' });
const imp = (text) => parseImport(text, { unit: 'kg', today: TODAY });

describe('effort notes after a set (S > 20 is not a set count)', () => {
  for (const str of ['100x5 @8', '100x5@8', '100 x 5 @ 8', '100x5 @8.5']) {
    test(JSON.stringify(str), () => {
      const r = ps(str);
      assert.deepEqual(r.sets, sets([100, 5]));
      assert.equal(r.errors.length, 1);
    });
  }

  test('S ≤ 20 keeps the sets@weight meaning', () => {
    const r = ps('3x12@45');
    assert.deepEqual(r.sets, sets([45, 12], [45, 12], [45, 12]));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(ps('20x5 @ 10').sets.length, 20);
  });

  test('21 x 5 @ 8 is read as 21 kg × 5 with the note ignored', () => {
    const r = ps('21x5 @8');
    assert.deepEqual(r.sets, sets([21, 5]));
    assert.equal(r.errors.length, 1);
  });

  test('in a full import the set is kept and the note becomes a line warning', () => {
    const { sessions, warnings } = imp(['10/11/2026 Legs', 'Squat 100x5 @8'].join('\n'));
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].entries[0].sets, sets([100, 5]));
    assert.ok(warnings.some((w) => w.line === 2));
  });
});

describe('no line makes more than 20 sets', () => {
  test('a huge repeat is capped with an error', () => {
    const r = ps('20x5 x1000000');
    assert.equal(r.sets.length, 20);
    assert.ok(r.sets.every((s) => s.weight === 20 && s.reps === 5));
    assert.equal(r.errors.length, 1);
  });

  test('25 listed sets are cut to 20 with an error', () => {
    const r = ps(Array.from({ length: 25 }, () => '10x10').join(' '));
    assert.equal(r.sets.length, 20);
    assert.equal(r.errors.length, 1);
  });

  test('exactly 20 sets is fine', () => {
    const r = ps('10x10 x20');
    assert.equal(r.sets.length, 20);
    assert.deepEqual(r.errors, []);
  });
});

describe('the same workout twice in one paste', () => {
  const text = [
    '10/11/2026 Pull A', // line 1
    'Deadlift 100x5',
    '',
    '10/11/2026 Pull A', // line 4
    'Deadlift 105x6',
  ].join('\n');

  test('only the later block is kept, with a warning on its header line', () => {
    const { sessions, warnings } = imp(text);
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].entries[0].sets, sets([105, 6]));
    assert.ok(warnings.some((w) => w.line === 4));
  });

  test('same date but a different day is not a duplicate', () => {
    const { sessions, warnings } = imp(['10/11/2026 Pull A', 'Deadlift 100x5', '10/11/2026 Push A', 'Bench 60x5'].join('\n'));
    assert.equal(sessions.length, 2);
    assert.deepEqual(warnings, []);
  });

  test('day inferred from exercises counts too', () => {
    const { sessions, warnings } = imp(['10/11/2026', 'Deadlift 100x5', '10/11/2026 pull', 'Deadlift 110x5'].join('\n'));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].day, 'pullA');
    assert.deepEqual(sessions[0].entries[0].sets, sets([110, 5]));
    assert.ok(warnings.some((w) => w.line === 3));
  });
});

describe('custom swap names that match a built-in exercise', () => {
  const item = (dayId, slotKey, choice) => getDayPlan(dayId, { choices: { [slotKey]: choice } }).items.find((i) => i.slotKey === slotKey);

  test('a non-main catalog name becomes that exercise', () => {
    const it = item('pullA', 'pull.curl1', 'custom:Barbell curl');
    assert.equal(it.exerciseId, 'barbellCurl');
    assert.equal(it.name, 'Barbell curl');
  });

  test('aliases and plurals match too', () => {
    assert.equal(item('pullA', 'pull.curl2', 'custom:hammer curls').exerciseId, 'hammerCurl');
    assert.equal(item('pushA', 'push.tri1', 'custom:Skull crusher').exerciseId, 'skullcrusher');
    assert.equal(item('legs', 'legs.quad', 'custom:front squats').exerciseId, 'frontSquat');
  });

  test('a main-lift name stays a separate custom exercise', () => {
    const it = item('pullB', 'pull.row', 'custom:Row');
    assert.equal(it.exerciseId, 'custom:row');
    assert.equal(it.name, 'Row');
    assert.equal(item('pushA', 'push.incline', 'custom:Bench').exerciseId, 'custom:bench');
  });

  test('a name that matches nothing stays custom', () => {
    const it = item('legs', 'legs.quad', 'custom:Hack squat');
    assert.equal(it.exerciseId, 'custom:hack squat');
    assert.equal(it.name, 'Hack squat');
  });
});

describe('§15 item 4: only a whole number 1–20 is a set count before "x R @ W"', () => {
  const cases = [
    ['12.5x10 @8', [12.5, 10]],
    ['12.5x10@8', [12.5, 10]],
    ['12.5 x 10 @ 8', [12.5, 10]],
    ['bw x 8 @ 8', [0, 8]],
    ['bwx8@8', [0, 8]],
    ['BW+10x8 @8', [10, 8]],
    ['0x5 @8', [0, 5]],
    ['20kg x 5 @8', [20, 5]], // a weight with a unit is never a set count
    ['3kgx5@8', [3, 5]],
  ];
  for (const [str, set] of cases) {
    test(`${JSON.stringify(str)} → one set ${set[0]}×${set[1]} + an error for the effort note`, () => {
      const r = ps(str);
      assert.deepEqual(r.sets, sets(set));
      assert.equal(r.errors.length, 1);
    });
  }

  test('a unit on the left side still converts', () => {
    const r = parseSetTokens('20kgx5 @8', { unit: 'lb' });
    assert.deepEqual(r.sets, sets([44, 5]));
    assert.equal(r.errors.length, 1);
  });

  test('whole numbers 1..20 keep the sets@weight meaning', () => {
    assert.deepEqual(ps('1x5@100').sets, sets([100, 5]));
    assert.deepEqual(ps('2 x 8 @ bw').sets, sets([0, 8], [0, 8]));
    assert.deepEqual(ps('20x5 @ 10').errors, []);
  });

  test('in a full import the decimal / bodyweight set is kept and the note becomes a line warning', () => {
    const { sessions, warnings } = imp(['10/11/2026 Pull A', 'Deadlift 100x5', 'Hammer curl 12.5x10 @8', 'Pull-up bw x 8 @ 8'].join('\n'));
    assert.equal(sessions.length, 1);
    assert.deepEqual(sessions[0].entries.map((e) => [e.exerciseId, e.sets]), [
      ['deadlift', sets([100, 5])],
      ['hammerCurl', sets([12.5, 10])],
      ['pullUp', sets([0, 8])],
    ]);
    assert.deepEqual(warnings.map((w) => w.line), [3, 4]);
  });
});

describe('an "@N" that does not follow "W x R" is an ignored note, never a set (review fix)', () => {
  for (const [str, expected, nErrors] of [
    ['100x5 x3 @8', [[100, 5], [100, 5], [100, 5]], 1],
    ['100x5, 5 @8', [[100, 5], [100, 5]], 1],
    ['100x5/5/7 @9', [[100, 5], [100, 5], [100, 7]], 1],
    ['100x5 @8 @9', [[100, 5]], 2],
    ['100x5 x3 @ 8.5', [[100, 5], [100, 5], [100, 5]], 1],
  ]) {
    test(JSON.stringify(str), () => {
      const r = ps(str);
      assert.deepEqual(r.sets, sets(...expected));
      assert.equal(r.errors.length, nErrors);
    });
  }
});
