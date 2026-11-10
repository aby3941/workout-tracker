// America/Los_Angeles (UTC-8/-7): traps parsing 'YYYY-MM-DD' with new Date(iso)
// (UTC midnight = the previous local day) and toISOString() in the evening.
// US DST 2026: starts Sun 08/03/2026, ends Sun 01/11/2026.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { refAddDays, refWeekStart } from './_helpers.js';

process.env.TZ = 'America/Los_Angeles';
const { todayISO, addDays, weekStart, formatDate, isValidISO, parseDatePrefix } = await import('../public/js/dates.js');

describe('dates in America/Los_Angeles', () => {
  test('the runner really is in Pacific time', () => {
    assert.equal(new Date(2026, 10, 10, 12).getTimezoneOffset(), 480);
  });

  test('todayISO in the evening (UTC is already tomorrow)', () => {
    assert.equal(todayISO(new Date(2026, 10, 10, 20, 0)), '2026-11-10');
    assert.equal(todayISO(new Date(2026, 10, 10, 23, 59)), '2026-11-10');
    assert.equal(todayISO(new Date(2026, 11, 31, 22, 0)), '2026-12-31');
  });

  test('ISO strings are read as local calendar dates', () => {
    assert.equal(formatDate('2026-11-10'), '10/11/2026');
    assert.equal(formatDate('2026-01-01'), '01/01/2026');
    assert.equal(weekStart('2026-11-09'), '2026-11-09'); // a Monday stays itself
    assert.equal(weekStart('2026-11-10'), '2026-11-09');
    assert.equal(weekStart('2026-11-08'), '2026-11-02');
    assert.equal(isValidISO('2026-11-01'), true);
  });

  test('addDays across US DST changes', () => {
    assert.equal(addDays('2026-03-07', 1), '2026-03-08');
    assert.equal(addDays('2026-03-08', 1), '2026-03-09');
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-11-01', 1), '2026-11-02');
    assert.equal(addDays('2026-11-02', -1), '2026-11-01');
  });

  test('every day of 2026: addDays(+1) and weekStart match a UTC reference', () => {
    let d = '2026-01-01';
    for (let i = 0; i < 365; i++) {
      assert.equal(weekStart(d), refWeekStart(d), `weekStart(${d})`);
      const next = addDays(d, 1);
      assert.equal(next, refAddDays(d, 1), `addDays(${d}, 1)`);
      d = next;
    }
    assert.equal(d, '2027-01-01');
  });

  test('parseDatePrefix ISO and relative dates', () => {
    const today = '2026-11-10';
    assert.equal(parseDatePrefix('2026-11-10 Pull A', { today }).date, '2026-11-10');
    assert.equal(parseDatePrefix('today', { today }).date, '2026-11-10');
    assert.equal(parseDatePrefix('yesterday', { today: '2026-11-02' }).date, '2026-11-01');
  });
});

describe('daysBetween / weekdayShort in America/Los_Angeles (review)', () => {
  test('whole calendar days and the right weekday around clock changes', async () => {
    const { daysBetween, weekdayShort } = await import('../public/js/dates.js');
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
    assert.equal(weekdayShort('2026-03-07'), 'Sat');
    assert.equal(weekdayShort('2026-03-09'), 'Mon');
    assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
    assert.equal(weekdayShort('2026-10-31'), 'Sat');
    assert.equal(weekdayShort('2026-11-02'), 'Mon');
  });
});
