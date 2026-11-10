// Europe/London: BST starts Sun 29/03/2026 (clocks 01:00 → 02:00) and ends
// Sun 25/10/2026 (02:00 → 01:00). Traps day arithmetic done in milliseconds
// from midnight, which drifts across the 23-hour / 25-hour days.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { refAddDays, refWeekStart } from './_helpers.js';

process.env.TZ = 'Europe/London';
const { todayISO, addDays, weekStart, formatDate, parseDatePrefix } = await import('../public/js/dates.js');

describe('dates in Europe/London across DST', () => {
  test('the runner really is in UK time', () => {
    assert.equal(new Date(2026, 2, 28, 12).getTimezoneOffset(), 0);
    assert.equal(new Date(2026, 2, 30, 12).getTimezoneOffset(), -60);
  });

  test('addDays across the spring-forward boundary (29/03/2026)', () => {
    assert.equal(addDays('2026-03-28', 1), '2026-03-29');
    assert.equal(addDays('2026-03-29', 1), '2026-03-30');
    assert.equal(addDays('2026-03-28', 2), '2026-03-30');
    assert.equal(addDays('2026-03-30', -1), '2026-03-29');
    assert.equal(addDays('2026-03-30', -2), '2026-03-28');
    assert.equal(addDays('2026-03-22', 7), '2026-03-29');
    assert.equal(addDays('2026-03-29', 7), '2026-04-05');
  });

  test('addDays across the fall-back boundary (25/10/2026)', () => {
    assert.equal(addDays('2026-10-24', 1), '2026-10-25');
    assert.equal(addDays('2026-10-25', 1), '2026-10-26');
    assert.equal(addDays('2026-10-24', 2), '2026-10-26');
    assert.equal(addDays('2026-10-26', -1), '2026-10-25');
    assert.equal(addDays('2026-10-25', -1), '2026-10-24');
    assert.equal(addDays('2026-10-20', 7), '2026-10-27');
    assert.equal(addDays('2026-03-01', 240), refAddDays('2026-03-01', 240));
  });

  test('weekStart in DST-change weeks', () => {
    assert.equal(weekStart('2026-03-29'), '2026-03-23'); // Sunday of the change
    assert.equal(weekStart('2026-03-30'), '2026-03-30');
    assert.equal(weekStart('2026-04-01'), '2026-03-30');
    assert.equal(weekStart('2026-10-25'), '2026-10-19'); // Sunday of the change
    assert.equal(weekStart('2026-10-26'), '2026-10-26');
    assert.equal(weekStart('2026-10-28'), '2026-10-26');
  });

  test('every day of 2026: addDays(+1), addDays(-1) and weekStart match a UTC reference', () => {
    let d = '2026-01-01';
    for (let i = 0; i < 365; i++) {
      assert.equal(weekStart(d), refWeekStart(d), `weekStart(${d})`);
      const next = addDays(d, 1);
      assert.equal(next, refAddDays(d, 1), `addDays(${d}, 1)`);
      assert.equal(addDays(next, -1), d, `addDays(${next}, -1)`);
      d = next;
    }
    assert.equal(d, '2027-01-01');
  });

  test('todayISO around midnight in BST and at the change-over hours', () => {
    assert.equal(todayISO(new Date(2026, 5, 15, 0, 30)), '2026-06-15'); // 23:30 UTC the day before
    assert.equal(todayISO(new Date(2026, 2, 29, 1, 30)), '2026-03-29'); // non-existent local time
    assert.equal(todayISO(new Date(2026, 9, 25, 1, 30)), '2026-10-25'); // repeated local time
  });

  test('formatDate and yesterday on DST days', () => {
    assert.equal(formatDate('2026-03-29'), '29/03/2026');
    assert.equal(formatDate('2026-10-25'), '25/10/2026');
    assert.equal(parseDatePrefix('yesterday', { today: '2026-03-30' }).date, '2026-03-29');
    assert.equal(parseDatePrefix('yesterday', { today: '2026-10-26' }).date, '2026-10-25');
  });
});

describe('daysBetween / weekdayShort in Europe/London (review)', () => {
  test('whole calendar days and the right weekday around clock changes', async () => {
    const { daysBetween, weekdayShort } = await import('../public/js/dates.js');
    assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
    assert.equal(weekdayShort('2026-03-28'), 'Sat');
    assert.equal(weekdayShort('2026-03-30'), 'Mon');
    assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
    assert.equal(weekdayShort('2026-10-24'), 'Sat');
    assert.equal(weekdayShort('2026-10-26'), 'Mon');
  });
});
