// Logic exports the screens use that had no tests yet (added in the screen build), plus the
// review fix `replaceSession` (editing a workout keeps its place on a day with two workouts).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthName, formatMonthYear, daysBetween, formatDateShort, weekdayShort, sortByDate, dayIndex,
} from '../public/js/dates.js';
import { repsToGo, suggestAccessory, maxWeight, isBaselineWeight } from '../public/js/progression.js';
import { replaceSession, mergeSessions } from '../public/js/store.js';
import { nextWorkout, cyclePosition, GOALS, mainPrescription, accessoryPrescription } from '../public/js/program.js';
import { parseWeightInput, formatNumber, smallestIncrement, cleanNumber } from '../public/js/units.js';
import { escapeHtml } from '../public/js/html.js';
import { accessoryChart, sparkline, lineChart, barChart } from '../public/js/charts.js';
import { session, entry, at, clone } from './_helpers.js';

describe('dates: month names, short dates, weekday, day differences', () => {
  test('monthName', () => {
    assert.equal(monthName('2026-01-15'), 'January');
    assert.equal(monthName('2026-11-10'), 'November');
    assert.equal(monthName('2026-12-31'), 'December');
    assert.equal(monthName('garbage'), '');
  });

  test('formatMonthYear (History month headings)', () => {
    assert.equal(formatMonthYear('2026-11-10'), 'November 2026');
    assert.equal(formatMonthYear('2027-01-01'), 'January 2027');
  });

  test('daysBetween: positive when the second date is later, across months, years and leap days', () => {
    assert.equal(daysBetween('2026-11-10', '2026-11-10'), 0);
    assert.equal(daysBetween('2026-11-03', '2026-11-10'), 7);
    assert.equal(daysBetween('2026-11-10', '2026-11-03'), -7);
    assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1);
    assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1);
    assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2); // 2028 is a leap year
    assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
  });

  test('daysBetween counts calendar days over DST changes (UK and US 2026)', () => {
    assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
    assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
    assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
  });

  test('formatDateShort is DD/MM; weekdayShort is the English short weekday', () => {
    assert.equal(formatDateShort('2026-11-07'), '07/11');
    assert.equal(formatDateShort('2026-01-31'), '31/01');
    assert.equal(weekdayShort('2026-11-10'), 'Tue');
    assert.equal(weekdayShort('2026-11-08'), 'Sun');
    assert.equal(weekdayShort('2026-03-29'), 'Sun');
    assert.equal(weekdayShort('2026-10-25'), 'Sun');
  });

  test('sortByDate is stable and does not mutate; dayIndex is whole days', () => {
    const list = [{ date: '2026-11-05', k: 1 }, { date: '2026-11-01', k: 2 }, { date: '2026-11-05', k: 3 }];
    const before = clone(list);
    assert.deepEqual(sortByDate(list).map((x) => x.k), [2, 1, 3]);
    assert.deepEqual(list, before);
    assert.equal(dayIndex('1970-01-02'), 1);
    assert.equal(dayIndex('2026-11-10') - dayIndex('2026-11-09'), 1);
  });
});

describe('repsToGo (accessory "N reps to go before adding weight")', () => {
  const slot = { sets: 3, repsMin: 8, repsMax: 12 };

  test('spec example: 10, 9, 9 on 3×8–12 → 8 reps to go', () => {
    assert.equal(repsToGo({ sets: at(45, [10, 9, 9]) }, slot), 8);
  });

  test('a planned set that was not done counts in full', () => {
    assert.equal(repsToGo({ sets: at(45, [12, 12]) }, slot), 12);
  });

  test('extra sets above the plan count too; reps above the top never go negative', () => {
    assert.equal(repsToGo({ sets: at(45, [12, 12, 12, 10]) }, slot), 2);
    assert.equal(repsToGo({ sets: at(45, [15, 15, 15]) }, slot), 0);
  });

  test('0 exactly when suggestAccessory says increase', () => {
    for (const reps of [[12, 12, 12], [12, 12, 11], [12, 12], [13, 12, 12, 12], [8, 8, 8]]) {
      const s = suggestAccessory([session('2026-11-01', 'pullA', [entry('latPulldown', at(45, reps))])], 'latPulldown', slot, 'kg');
      assert.equal(repsToGo(s.last, slot) === 0, s.action === 'increase', `reps ${reps}`);
    }
  });

  test('no rep target, no history or no slot → null', () => {
    assert.equal(repsToGo({ sets: at(0, [30]) }, { sets: 3, repsMin: null, repsMax: null }), null);
    assert.equal(repsToGo(null, slot), null);
    assert.equal(repsToGo({ sets: [] }, null), null);
  });

  test('does not mutate its inputs', () => {
    const item = { sets: at(45, [10, 9, 9]) };
    const copy = clone(item);
    repsToGo(item, slot);
    assert.deepEqual(item, copy);
  });
});

describe('progression helpers used by the screens', () => {
  test('maxWeight', () => {
    assert.equal(maxWeight({ sets: at(60, [5]).concat(at(62.5, [3])) }), 62.5);
    assert.equal(maxWeight({ sets: [] }), 0);
  });

  test('isBaselineWeight: finite and ≥ 0 (0 = bodyweight)', () => {
    assert.equal(isBaselineWeight(0), true);
    assert.equal(isBaselineWeight(70), true);
    for (const bad of [-1, NaN, Infinity, '70', null, undefined]) assert.equal(isBaselineWeight(bad), false, String(bad));
  });
});

describe('replaceSession (Save after editing a workout from History)', () => {
  const A = session('2026-11-04', 'pullB', [entry('barbellRow', at(40, [5, 5, 5, 5, 5]))], { id: 'a' });
  const B = session('2026-11-05', 'pushB', [entry('ohp', at(30, [5, 5, 5, 5, 5]))], { id: 'b' });
  const C = session('2026-11-05', 'legs', [entry('squat', at(60, [5, 5, 5]))], { id: 'c' });

  test('keeps the id and the place among workouts on the same date (cycle order unchanged)', () => {
    const list = [A, B, C];
    const edited = { ...B, entries: [entry('ohp', at(30, [5, 5, 5, 5, 8]))] };
    const out = replaceSession(list, 'b', edited);
    assert.deepEqual(out.map((s) => s.id), ['a', 'b', 'c']);
    assert.deepEqual(out[1].entries, edited.entries);
    // the bug this guards against: delete + merge put the edited Push B after the Legs
    assert.deepEqual(nextWorkout(out), { dayId: 'pullA', position: 1 });
    assert.deepEqual(nextWorkout(mergeSessions(list.filter((s) => s.id !== 'b'), [edited]).sessions), { dayId: 'legs', position: 6 });
    assert.equal(cyclePosition('legs', out.slice(0, 2)), 6);
  });

  test('a changed date moves it in date order', () => {
    const out = replaceSession([A, B, C], 'a', { ...A, date: '2026-11-06' });
    assert.deepEqual(out.map((s) => s.id), ['b', 'c', 'a']);
  });

  test('another workout with the same date and day is replaced by the edit', () => {
    const out = replaceSession([A, B, C], 'a', { ...A, date: '2026-11-05', day: 'legs' });
    assert.deepEqual(out.map((s) => s.id), ['a', 'b']);
    assert.equal(out[0].day, 'legs');
  });

  test('ignores an id on the edited copy, never mutates, unknown id → added with a new id', () => {
    const list = [A, B];
    const before = clone(list);
    const out = replaceSession(list, 'b', { ...B, id: 'zzz' });
    assert.deepEqual(out.map((s) => s.id), ['a', 'b']);
    assert.deepEqual(list, before);
    const added = replaceSession(list, 'nope', session('2026-11-06', 'legs', []));
    assert.equal(added.length, 3);
    assert.ok(added[2].id && !['a', 'b', 'nope'].includes(added[2].id));
  });
});

describe('program display helpers', () => {
  test('GOALS labels match the Plan buttons (16.3), ids from 3.4', () => {
    assert.deepEqual(GOALS.map((g) => g.id), ['standard', 'strength', 'endurance', 'cut']);
    assert.deepEqual(GOALS.map((g) => g.label), ['Standard', 'Strength', 'Endurance', 'Cutting']);
    for (const g of GOALS) assert.ok(g.description.length > 0, g.id);
  });

  test('mainPrescription / accessoryPrescription', () => {
    assert.equal(mainPrescription(1), '1×5+');
    assert.equal(mainPrescription(3), '2×5, 1×5+');
    assert.equal(mainPrescription(5), '4×5, 1×5+');
    assert.equal(accessoryPrescription({ sets: 3, repsMin: 8, repsMax: 12 }), '3×8–12');
    assert.equal(accessoryPrescription({ sets: 3, repsMin: 4, repsMax: 4 }), '3×4');
    assert.equal(accessoryPrescription({ sets: 3, repsMin: null, repsMax: null }), '3 sets');
  });
});

describe('units helpers used by the forms', () => {
  test('parseWeightInput: dot or comma decimals; anything else → null', () => {
    assert.equal(parseWeightInput('62.5'), 62.5);
    assert.equal(parseWeightInput('62,5'), 62.5);
    assert.equal(parseWeightInput(' 100 '), 100);
    assert.equal(parseWeightInput('.5'), 0.5);
    assert.equal(parseWeightInput('0'), 0);
    for (const bad of ['', '  ', 'abc', '-5', '1e3', '62.5kg', '1.2.3', null, undefined]) assert.equal(parseWeightInput(bad), null, String(bad));
  });

  test('formatNumber / cleanNumber / smallestIncrement', () => {
    assert.equal(formatNumber(62.5), '62.5');
    assert.equal(formatNumber(100), '100');
    assert.equal(formatNumber(0.1 + 0.2), '0.3');
    assert.equal(Object.is(cleanNumber(-0), 0), true);
    assert.equal(smallestIncrement('kg'), 2.5);
    assert.equal(smallestIncrement('lb'), 5);
  });

  test('escapeHtml escapes the five HTML characters', () => {
    assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
    assert.equal(escapeHtml(null), '');
  });
});

describe('charts: accessory chart and sparkline', () => {
  test('accessoryChart: valid svg, target line, no NaN with one point or bodyweight', () => {
    const one = accessoryChart({ points: [{ x: '2026-11-01', weight: 0, total: 30 }], target: 36, targetText: 'line = 3×12', unit: 'kg', label: 'Pull-up' });
    assert.ok(one.startsWith('<svg') && one.endsWith('</svg>'));
    assert.match(one, /role="img"/);
    assert.ok(!/NaN|Infinity/.test(one));
    const many = accessoryChart({ points: [{ x: '2026-11-05', weight: 45, total: 33 }, { x: '2026-11-01', weight: 42.5, total: 36 }], target: 36, unit: 'kg' });
    assert.ok(!/NaN|Infinity/.test(many));
    assert.match(many, /data-xs="[\d.]+,[\d.]+"/);
  });

  test('accessoryChart escapes its label; empty → "No data yet"', () => {
    assert.ok(!accessoryChart({ points: [{ x: '2026-11-01', weight: 1, total: 1 }], label: '<b>x</b>' }).includes('<b>'));
    assert.match(accessoryChart({ points: [] }), /No data yet/);
  });

  test('sparkline: decorative, no NaN for one or flat values, empty for none', () => {
    assert.equal(sparkline([]), '');
    for (const v of [[60], [60, 60, 60], [60, 62.5, 65]]) {
      const svg = sparkline(v);
      assert.match(svg, /aria-hidden="true"/);
      assert.ok(!/NaN|Infinity/.test(svg), JSON.stringify(v));
    }
  });
});

describe('units: conversion step (the unit-switch dialog quotes it)', () => {
  test('CONVERSION_STEP is what convertWeight rounds to', async () => {
    const { CONVERSION_STEP, convertWeight } = await import('../public/js/units.js');
    assert.deepEqual({ ...CONVERSION_STEP }, { kg: 0.25, lb: 0.5 });
    for (const w of [61.3, 99.9, 143.2]) {
      assert.equal((convertWeight(w, 'lb', 'kg') / CONVERSION_STEP.kg) % 1, 0, `${w} lb → kg`);
      assert.equal((convertWeight(w, 'kg', 'lb') / CONVERSION_STEP.lb) % 1, 0, `${w} kg → lb`);
    }
  });
});

describe('charts with years of data (review fix: overlapping dots hid the line)', () => {
  const days = (n, gap = 2) => Array.from({ length: n }, (_, i) => {
    const d = new Date(2024, 0, 1 + i * gap, 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const radii = (svg) => [...svg.matchAll(/<circle class="dot" data-i="(\d+)" data-r="([\d.]+)"[^>]* r="([\d.]+)"/g)].map((m) => ({ i: Number(m[1]), base: Number(m[2]), r: Number(m[3]) }));

  test('a few points: every point has its 8px dot', () => {
    const svg = lineChart({ series: [{ label: 'w', points: days(6, 7).map((x, i) => ({ x, y: 60 + i })) }] });
    const r = radii(svg);
    assert.equal(r.length, 6);
    assert.ok(r.every((d) => d.r === 4 && d.base === 4));
  });

  test('hundreds of points: only the latest keeps a dot (both series), the rest stay for the crosshair at r=0', () => {
    const xs = days(300);
    const svg = lineChart({ series: [{ label: 'w', points: xs.map((x, i) => ({ x, y: 60 + i / 10 })) }, { label: 'e', points: xs.map((x, i) => ({ x, y: 70 + i / 10 })) }] });
    const r = radii(svg);
    assert.equal(r.length, 600);
    assert.deepEqual(r.filter((d) => d.r > 0).map((d) => d.i), [299, 299]);
    assert.ok(!/NaN|Infinity/.test(svg));
    const acc = accessoryChart({ points: xs.map((x, i) => ({ x, weight: 20 + i / 20, total: 30 + (i % 7) })), target: 36, unit: 'kg' });
    const ra = radii(acc);
    assert.equal(ra.length, 300);
    assert.deepEqual(ra.filter((d) => d.r > 0).map((d) => d.i), [299]);
  });

  test('dense bars (150 sessions) stay narrower than their spacing', () => {
    const xs = days(150);
    const acc = accessoryChart({ points: xs.map((x, i) => ({ x, weight: 20, total: 30 + (i % 7) })), unit: 'kg' });
    const bars = [...acc.matchAll(/<path class="bar" data-i="\d+" d="([^"]+)"/g)].map((m) => {
      const xsInPath = [...m[1].matchAll(/([\d.]+),[\d.]+/g)].map((n) => Number(n[1]));
      return { left: Math.min(...xsInPath), right: Math.max(...xsInPath) };
    });
    assert.ok(bars.length > 100);
    for (let i = 1; i < bars.length; i++) assert.ok(bars[i].left >= bars[i - 1].right - 0.15, `bar ${i} overlaps bar ${i - 1}`);
    const weeks = barChart({ bars: Array.from({ length: 156 }, (_, i) => ({ label: String(i), value: 1000 + i })) });
    assert.ok(!/NaN|Infinity/.test(weeks));
  });
});
