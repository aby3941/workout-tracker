// Batch 2, §18.3 — workout times are local wall-clock strings "YYYY-MM-DDTHH:MM" (no time zone, like dates).
// Runs in India (UTC+05:30): at 02:00 local, UTC is still on the previous day, so anything built from
// toISOString() shows up here.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { localISO } from './_helpers.js';

process.env.TZ = 'Asia/Kolkata';
const dates = await import('../public/js/dates.js');

describe('nowLocal (Asia/Kolkata)', () => {
  test('the runner really is in IST', () => {
    assert.equal(new Date(2026, 10, 10, 2, 0).getTimezoneOffset(), -330);
  });

  test('local date and time, never UTC: 02:05 IST on 10/11 is "2026-11-10T02:05" (UTC is still 09/11 20:35)', () => {
    assert.equal(dates.nowLocal(new Date(2026, 10, 10, 2, 5)), '2026-11-10T02:05');
    assert.equal(dates.nowLocal(new Date(2026, 10, 10, 0, 0)), '2026-11-10T00:00');
    assert.equal(dates.nowLocal(new Date(2026, 10, 10, 5, 29)), '2026-11-10T05:29');
  });

  test('"YYYY-MM-DDTHH:MM": zero-padded, 24-hour, seconds dropped', () => {
    assert.equal(dates.nowLocal(new Date(2026, 0, 2, 7, 5, 59)), '2026-01-02T07:05');
    assert.equal(dates.nowLocal(new Date(2026, 10, 10, 18, 42, 30)), '2026-11-10T18:42');
    assert.equal(dates.nowLocal(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31T23:59');
  });

  test('defaults to the current time', () => {
    const before = new Date();
    const s = dates.nowLocal();
    const after = new Date();
    assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.ok([localISO(before), localISO(after)].includes(s.slice(0, 10)), `${s} should be on today's local date`);
  });
});

describe('formatTime', () => {
  test('"HH:MM" of a local time string', () => {
    assert.equal(dates.formatTime('2026-11-10T18:42'), '18:42');
    assert.equal(dates.formatTime('2026-11-10T07:05'), '07:05');
    assert.equal(dates.formatTime('2026-11-11T00:20'), '00:20');
  });
});

describe('minutesBetween', () => {
  test('whole minutes from a to b', () => {
    assert.equal(dates.minutesBetween('2026-11-10T18:42', '2026-11-10T19:34'), 52);
    assert.equal(dates.minutesBetween('2026-11-10T18:40', '2026-11-10T19:41'), 61);
    assert.equal(dates.minutesBetween('2026-11-10T09:00', '2026-11-10T11:05'), 125);
    assert.equal(dates.minutesBetween('2026-11-10T18:42', '2026-11-10T18:42'), 0);
  });

  test('across midnight and across the year end', () => {
    assert.equal(dates.minutesBetween('2026-11-10T23:30', '2026-11-11T00:20'), 50);
    assert.equal(dates.minutesBetween('2026-12-31T23:50', '2027-01-01T00:15'), 25);
  });
});

describe('formatDuration', () => {
  test('under an hour → "N min"', () => {
    assert.equal(dates.formatDuration(52), '52 min');
    assert.equal(dates.formatDuration(1), '1 min');
    assert.equal(dates.formatDuration(59), '59 min');
  });

  test('an hour or more → "H h M min", or "H h" on the hour', () => {
    assert.equal(dates.formatDuration(65), '1 h 5 min');
    assert.equal(dates.formatDuration(61), '1 h 1 min');
    assert.equal(dates.formatDuration(60), '1 h');
    assert.equal(dates.formatDuration(120), '2 h');
    assert.equal(dates.formatDuration(125), '2 h 5 min');
  });
});
