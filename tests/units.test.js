import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INCREMENTS, incrementFor, roundTo, floorTo, convertWeight, barWeight, formatWeight,
} from '../public/js/units.js';

const KG_PER_LB = 0.45359237;

describe('increments', () => {
  test('INCREMENTS is exported', () => {
    assert.equal(typeof INCREMENTS, 'object');
    assert.notEqual(INCREMENTS, null);
  });

  test('incrementFor: kg', () => {
    assert.equal(incrementFor('upper', 'kg'), 2.5);
    assert.equal(incrementFor('lower', 'kg'), 2.5);
    assert.equal(incrementFor('deadlift', 'kg'), 5);
    assert.equal(incrementFor('accessory', 'kg'), 2.5);
  });

  test('incrementFor: lb', () => {
    assert.equal(incrementFor('upper', 'lb'), 5);
    assert.equal(incrementFor('lower', 'lb'), 5);
    assert.equal(incrementFor('deadlift', 'lb'), 10);
    assert.equal(incrementFor('accessory', 'lb'), 5);
  });
});

describe('roundTo (nearest)', () => {
  test('rounds to the nearest step', () => {
    assert.equal(roundTo(61, 2.5), 60);
    assert.equal(roundTo(61.3, 2.5), 62.5);
    assert.equal(roundTo(63.7, 2.5), 62.5);
    assert.equal(roundTo(62.5, 2.5), 62.5);
    assert.equal(roundTo(72.4, 5), 70);
    assert.equal(roundTo(72.6, 5), 75);
    assert.equal(roundTo(70, 5), 70);
    assert.equal(roundTo(220.46, 0.5), 220.5);
    assert.equal(roundTo(102.058, 0.25), 102);
    assert.equal(roundTo(1.2, 2.5), 0);
    assert.equal(roundTo(0, 2.5), 0);
  });
});

describe('floorTo (round down, float-noise safe)', () => {
  test('rounds down to the step', () => {
    assert.equal(floorTo(90, 2.5), 90);
    assert.equal(floorTo(56.25, 2.5), 55);
    assert.equal(floorTo(126, 5), 125);
    assert.equal(floorTo(59.99, 2.5), 57.5);
    assert.equal(floorTo(57.5, 2.5), 57.5);
    assert.equal(floorTo(121.5, 5), 120);
    assert.equal(floorTo(283.5, 10), 280);
    assert.equal(floorTo(4.99, 5), 0);
    assert.equal(floorTo(0, 2.5), 0);
  });

  test('float noise cannot drop a step, and the result is clean', () => {
    // 0.3 / 0.1 === 2.9999999999999996 and 0.1 * 3 === 0.30000000000000004 in IEEE doubles
    assert.equal(floorTo(0.3, 0.1), 0.3);
    assert.equal(floorTo(0.7, 0.1), 0.7);
    assert.equal(floorTo(0.6, 0.2), 0.6);
  });
});

describe('convertWeight', () => {
  test('kg → lb rounds to 0.5', () => {
    assert.equal(convertWeight(100, 'kg', 'lb'), 220.5);
    assert.equal(convertWeight(60, 'kg', 'lb'), 132.5);
    assert.equal(convertWeight(62.5, 'kg', 'lb'), 138);
    assert.equal(convertWeight(20, 'kg', 'lb'), 44);
    assert.equal(convertWeight(0, 'kg', 'lb'), 0);
  });

  test('lb → kg rounds to 0.25', () => {
    assert.equal(convertWeight(225, 'lb', 'kg'), 102);
    assert.equal(convertWeight(135, 'lb', 'kg'), 61.25);
    assert.equal(convertWeight(45, 'lb', 'kg'), 20.5);
    assert.equal(convertWeight(100, 'lb', 'kg'), 45.25);
    assert.equal(convertWeight(315, 'lb', 'kg'), 143);
    assert.equal(convertWeight(0, 'lb', 'kg'), 0);
  });

  test('same unit → unchanged (not re-rounded)', () => {
    assert.equal(convertWeight(62.3, 'kg', 'kg'), 62.3);
    assert.equal(convertWeight(101.3, 'lb', 'lb'), 101.3);
    assert.equal(convertWeight(56.25, 'kg', 'kg'), 56.25);
  });

  test('sweep: results land on the unit grid and within half a step of the exact value', () => {
    for (let w = 0; w <= 300; w += 2.5) {
      const lb = convertWeight(w, 'kg', 'lb');
      assert.equal(lb % 0.5, 0, `kg ${w} → ${lb} lb`);
      assert.ok(Math.abs(lb - w / KG_PER_LB) <= 0.25 + 1e-9, `kg ${w} → ${lb} lb`);
    }
    for (let w = 0; w <= 600; w += 5) {
      const kg = convertWeight(w, 'lb', 'kg');
      assert.equal(kg % 0.25, 0, `lb ${w} → ${kg} kg`);
      assert.ok(Math.abs(kg - w * KG_PER_LB) <= 0.125 + 1e-9, `lb ${w} → ${kg} kg`);
    }
  });
});

describe('barWeight', () => {
  test('20 kg / 45 lb', () => {
    assert.equal(barWeight('kg'), 20);
    assert.equal(barWeight('lb'), 45);
  });
});

describe('formatWeight', () => {
  test('number + unit, no trailing .0', () => {
    assert.equal(formatWeight(62.5, 'kg'), '62.5 kg');
    assert.equal(formatWeight(100, 'kg'), '100 kg');
    assert.equal(formatWeight(56.25, 'kg'), '56.25 kg');
    assert.equal(formatWeight(135, 'lb'), '135 lb');
    assert.equal(formatWeight(100.0, 'kg'), '100 kg');
    assert.equal(formatWeight(2.5, 'kg'), '2.5 kg');
    assert.equal(formatWeight(220.5, 'lb'), '220.5 lb');
  });
});
