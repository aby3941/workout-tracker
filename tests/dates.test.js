import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO, addDays, formatDate, weekStart, isValidISO, compareISO, parseDatePrefix,
} from '../public/js/dates.js';
import { localISO } from './_helpers.js';

const TODAY = '2026-11-10'; // a Tuesday
const p = (line, today = TODAY) => parseDatePrefix(line, { today });

function assertDate(line, date, rest, today = TODAY) {
  const r = p(line, today);
  assert.ok(r, `expected a date for ${JSON.stringify(line)}`);
  assert.equal(r.date, date, `date for ${JSON.stringify(line)}`);
  assert.equal(r.rest, rest, `rest for ${JSON.stringify(line)}`);
  assert.ok(!r.invalid, `not invalid for ${JSON.stringify(line)}`);
}

function assertInvalid(line, today = TODAY) {
  const r = p(line, today);
  assert.ok(r, `expected an invalid-date result (not null) for ${JSON.stringify(line)}`);
  assert.equal(r.date, null, `date null for ${JSON.stringify(line)}`);
  assert.equal(r.invalid, true, `invalid flag for ${JSON.stringify(line)}`);
}

describe('todayISO', () => {
  test('uses local calendar getters, zero-padded', () => {
    assert.equal(todayISO(new Date(2026, 0, 5, 12, 0)), '2026-01-05');
    assert.equal(todayISO(new Date(2026, 10, 10, 0, 1)), '2026-11-10');
    assert.equal(todayISO(new Date(2026, 10, 10, 23, 59)), '2026-11-10');
    assert.equal(todayISO(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
  });

  test('defaults to now', () => {
    const before = localISO(new Date());
    const got = todayISO();
    const after = localISO(new Date());
    assert.ok(got === before || got === after, `got ${got}`);
  });
});

describe('addDays', () => {
  test('adds and subtracts days, crossing months, years and leap days', () => {
    assert.equal(addDays('2026-11-10', 0), '2026-11-10');
    assert.equal(addDays('2026-11-10', 1), '2026-11-11');
    assert.equal(addDays('2026-11-10', -1), '2026-11-09');
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2027-01-01', -1), '2026-12-31');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2024-02-28', 1), '2024-02-29');
    assert.equal(addDays('2024-03-01', -1), '2024-02-29');
    assert.equal(addDays('2026-01-01', 365), '2027-01-01');
    assert.equal(addDays('2026-11-10', -7), '2026-11-03');
  });
});

describe('formatDate', () => {
  test('formats ISO as DD/MM/YYYY', () => {
    assert.equal(formatDate('2026-11-10'), '10/11/2026');
    assert.equal(formatDate('2026-01-05'), '05/01/2026');
    assert.equal(formatDate('2026-12-31'), '31/12/2026');
  });
});

describe('weekStart', () => {
  test('returns the Monday of the week', () => {
    assert.equal(weekStart('2026-11-09'), '2026-11-09'); // Monday
    assert.equal(weekStart('2026-11-10'), '2026-11-09'); // Tuesday
    assert.equal(weekStart('2026-11-14'), '2026-11-09'); // Saturday
    assert.equal(weekStart('2026-11-08'), '2026-11-02'); // Sunday belongs to the previous Monday
    assert.equal(weekStart('2026-01-01'), '2025-12-29'); // Thursday, across a year boundary
    assert.equal(weekStart('2026-03-01'), '2026-02-23'); // Sunday, across a month boundary
  });
});

describe('isValidISO', () => {
  test('accepts real dates', () => {
    assert.equal(isValidISO('2026-11-10'), true);
    assert.equal(isValidISO('2024-02-29'), true);
    assert.equal(isValidISO('2026-12-31'), true);
  });
  test('rejects impossible or malformed dates', () => {
    assert.equal(isValidISO('2026-02-29'), false);
    assert.equal(isValidISO('2026-02-31'), false);
    assert.equal(isValidISO('2026-11-31'), false);
    assert.equal(isValidISO('2026-13-01'), false);
    assert.equal(isValidISO('2026-00-10'), false);
    assert.equal(isValidISO('10/11/2026'), false);
    assert.equal(isValidISO('hello'), false);
    assert.equal(isValidISO(''), false);
  });
});

describe('compareISO', () => {
  test('orders ISO dates', () => {
    assert.ok(compareISO('2026-11-09', '2026-11-10') < 0);
    assert.ok(compareISO('2026-11-10', '2026-11-09') > 0);
    assert.equal(compareISO('2026-11-10', '2026-11-10'), 0);
    assert.ok(compareISO('2025-12-31', '2026-01-01') < 0);
    assert.deepEqual(['2026-11-10', '2025-01-01', '2026-02-03'].sort(compareISO), ['2025-01-01', '2026-02-03', '2026-11-10']);
  });
});

describe('parseDatePrefix', () => {
  test('D/M/YYYY, D-M-YYYY, D.M.YYYY are day-first', () => {
    assertDate('10/11/2026 Pull A', '2026-11-10', 'Pull A');
    assertDate('1/2/2026', '2026-02-01', '');
    assertDate('01/02/2026 legs', '2026-02-01', 'legs');
    assertDate('12/1/2026 Push B', '2026-01-12', 'Push B');
    assertDate('10-11-2026 Push B', '2026-11-10', 'Push B');
    assertDate('1-2-2026', '2026-02-01', '');
    assertDate('10.11.2026 Legs', '2026-11-10', 'Legs');
    assertDate('29/02/2024', '2024-02-29', '');
  });

  test('D/M/YY means 20YY', () => {
    assertDate('10/11/26 Pull B', '2026-11-10', 'Pull B');
    assertDate('5/1/26', '2026-01-05', '');
  });

  test('D/M without a year uses the year of today, or the previous year if that would be after today', () => {
    assertDate('10/11 Pull A', '2026-11-10', 'Pull A'); // equal to today → this year
    assertDate('9/11', '2026-11-09', '');
    assertDate('1/1 legs', '2026-01-01', 'legs');
    assertDate('11/11 Push A', '2025-11-11', 'Push A'); // tomorrow → previous year
    assertDate('25/12', '2025-12-25', '');
    assertDate('31/12', '2026-12-31', '', '2026-12-31');
    assertDate('2/1', '2025-01-02', '', '2026-01-01');
  });

  test('YYYY-MM-DD', () => {
    assertDate('2026-11-10 Pull A', '2026-11-10', 'Pull A');
    assertDate('2026-01-05', '2026-01-05', '');
  });

  test('D Mon YYYY, D Month YYYY, D Mon (case-insensitive)', () => {
    assertDate('10 Nov 2026 Push A', '2026-11-10', 'Push A');
    assertDate('10 November 2026 Push A', '2026-11-10', 'Push A');
    assertDate('10 nov 2026', '2026-11-10', '');
    assertDate('10 NOV 2026 legs', '2026-11-10', 'legs');
    assertDate('3 Mar 2026 legs', '2026-03-03', 'legs');
    assertDate('10 Nov Pull A', '2026-11-10', 'Pull A');
    assertDate('25 Dec legs', '2025-12-25', 'legs'); // no year, after today → previous year
    assertDate('1 Jan', '2026-01-01', '');
  });

  test('Mon D YYYY and Month D, YYYY', () => {
    assertDate('Nov 10 2026 Pull A', '2026-11-10', 'Pull A');
    assertDate('Sep 1 2026', '2026-09-01', '');
    assertDate('November 10, 2026 Pull A', '2026-11-10', 'Pull A');
    assertDate('march 3, 2026', '2026-03-03', '');
  });

  test('ordinal suffixes', () => {
    assertDate('10th Nov 2026 Pull A', '2026-11-10', 'Pull A');
    assertDate('1st November 2026', '2026-11-01', '');
    assertDate('2nd Nov 2026', '2026-11-02', '');
    assertDate('3rd nov 2026 legs', '2026-11-03', 'legs');
    assertDate('Nov 1st 2026', '2026-11-01', '');
    assertDate('November 10th, 2026 Legs', '2026-11-10', 'Legs');
    assertDate('10th Nov Push A', '2026-11-10', 'Push A');
  });

  test('an optional leading weekday is ignored', () => {
    assertDate('Tue 10/11/2026 Pull A', '2026-11-10', 'Pull A');
    assertDate('Tuesday, 10 November 2026 Legs', '2026-11-10', 'Legs');
    assertDate('tue 10 nov 2026 push a', '2026-11-10', 'push a');
    assertDate('Mon 9/11/2026', '2026-11-09', '');
    assertDate('Monday 9 Nov 2026 Pull B', '2026-11-09', 'Pull B');
  });

  test('today / yesterday are relative to the given today', () => {
    assertDate('today Pull A', TODAY, 'Pull A');
    assertDate('Today', TODAY, '');
    assertDate('TODAY legs', TODAY, 'legs');
    assertDate('yesterday Push B', '2026-11-09', 'Push B');
    assertDate('Yesterday', '2026-11-09', '');
    assertDate('yesterday', '2026-02-28', '', '2026-03-01');
    assertDate('yesterday', '2025-12-31', '', '2026-01-01');
    assertDate('today', '2026-03-29', '', '2026-03-29');
  });

  test('rest is the remainder of the line, trimmed', () => {
    assertDate('10/11/2026    Pull A   ', '2026-11-10', 'Pull A');
    assertDate('10/11/2026 Pull A (off day)', '2026-11-10', 'Pull A (off day)');
    assertDate('Tue 10/11/2026 Pull A (off day)', '2026-11-10', 'Pull A (off day)');
  });

  test('a date followed directly by ":" ";" "-" or a dash still counts (review fix)', () => {
    assertDate('10/11/2026: Pull A', '2026-11-10', 'Pull A');
    assertDate('10/11/2026:Pull A', '2026-11-10', 'Pull A');
    assertDate('10/11/2026; Legs', '2026-11-10', 'Legs');
    assertDate('10/11/2026-Push B', '2026-11-10', 'Push B');
    assertDate('10/11/2026—Push B', '2026-11-10', 'Push B');
    assertDate('2026-11-10: Pull A', '2026-11-10', 'Pull A');
    assertDate('10/11: Pull A', '2026-11-10', 'Pull A');
    assertDate('10 Nov: Push A', '2026-11-10', 'Push A');
    assertDate('Nov 10 2026: Push A', '2026-11-10', 'Push A');
    assertDate('Today: legs', TODAY, 'legs');
    assertDate('Tue 10/11/2026: Pull A', '2026-11-10', 'Pull A');
    assertInvalid('31/02/2026: Pull A');
    assert.equal(p('10/11/2026x'), null);
    assert.equal(p('10/112'), null);
  });

  test('a leading weekday followed by a comma without a space (review fix)', () => {
    assertDate('Tuesday,10/11/2026 Pull A', '2026-11-10', 'Pull A');
    assertDate('Tue,10 Nov 2026', '2026-11-10', '');
    assertDate('Tue , 10/11/2026 legs', '2026-11-10', 'legs');
  });

  test('date-looking but impossible → {date: null, invalid: true}', () => {
    assertInvalid('31/02/2026 Pull A');
    assertInvalid('29/02/2026');
    assertInvalid('31/04/2026 legs');
    assertInvalid('32/01/2026');
    assertInvalid('10/13/2026'); // day-first: month 13 does not exist
    assertInvalid('31 Feb 2026');
    assertInvalid('2026-02-30');
    assertInvalid('2026-13-01');
  });

  test('invalid result keeps the rest of the line', () => {
    const r = p('31/02/2026 Pull A');
    assert.equal(r.rest, 'Pull A');
  });

  test('lines that do not start with a date → null', () => {
    for (const line of [
      'Deadlift 100x7',
      'Pull A',
      'Push A 10/11/2026',
      'Note: slept badly',
      'Lat pulldown 45x12 x3',
      'Face pull 20x20 x5',
      'Decline bench 60x8 x3',
      'bad day',
      'Leg day',
      '',
    ]) {
      assert.equal(p(line), null, JSON.stringify(line));
    }
  });
});
