// India (UTC+05:30, no DST). Traps implementations that use toISOString() or
// midnight-based Dates: before 05:30 local, UTC is still on the previous day.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { refAddDays, refWeekStart } from './_helpers.js';

process.env.TZ = 'Asia/Kolkata';
const { todayISO, addDays, weekStart, formatDate, parseDatePrefix } = await import('../public/js/dates.js');

describe('dates in Asia/Kolkata', () => {
  test('the runner really is in IST', () => {
    assert.equal(new Date(2026, 10, 10, 2, 0).getTimezoneOffset(), -330);
  });

  test('todayISO uses the local date, not the UTC date', () => {
    assert.equal(todayISO(new Date(2026, 10, 10, 2, 0)), '2026-11-10');
    assert.equal(todayISO(new Date(2026, 10, 10, 0, 0)), '2026-11-10');
    assert.equal(todayISO(new Date(2026, 10, 10, 5, 29)), '2026-11-10');
    assert.equal(todayISO(new Date(2026, 10, 10, 23, 59)), '2026-11-10');
    assert.equal(todayISO(new Date(2026, 0, 1, 0, 15)), '2026-01-01');
  });

  test('addDays / weekStart / formatDate do not shift the day', () => {
    assert.equal(addDays('2026-11-10', 1), '2026-11-11');
    assert.equal(addDays('2026-11-10', -1), '2026-11-09');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(weekStart('2026-11-10'), '2026-11-09');
    assert.equal(weekStart('2026-11-09'), '2026-11-09');
    assert.equal(formatDate('2026-11-10'), '10/11/2026');
    assert.equal(formatDate('2026-01-01'), '01/01/2026');
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

  test('parseDatePrefix relative and absolute dates', () => {
    const today = '2026-11-10';
    assert.equal(parseDatePrefix('today Pull A', { today }).date, '2026-11-10');
    assert.equal(parseDatePrefix('yesterday', { today }).date, '2026-11-09');
    assert.equal(parseDatePrefix('10/11/2026 Pull A', { today }).date, '2026-11-10');
    assert.equal(parseDatePrefix('10 Nov Pull A', { today }).date, '2026-11-10');
  });
});

describe('daysBetween / weekdayShort in Asia/Kolkata (review)', () => {
  test('whole calendar days and the right weekday around clock changes', async () => {
    const { daysBetween, weekdayShort } = await import('../public/js/dates.js');
    assert.equal(daysBetween('2026-11-09', '2026-11-10'), 1);
    assert.equal(weekdayShort('2026-11-09'), 'Mon');
    assert.equal(weekdayShort('2026-11-10'), 'Tue');
  });
});
