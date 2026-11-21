// Batch 2 independent review (20/11/2026): unit tests for the bugs found in review, each written to fail before its fix.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionVolume, weeklyVolume } from '../public/js/analysis.js';
import * as program from '../public/js/program.js'; // namespace import: a missing export fails its own test only
import { session, entry, rep, at } from './_helpers.js';

describe('a plank hold is not weight lifted (the "lifted" tile and weekly volume)', () => {
  // Plank logs seconds in the reps field (§17.3) and earns a plate on the back after 60 s holds, so
  // weight × seconds would add e.g. 2.5 kg × 60 s × 3 = 450 "kg lifted" to the "Workout saved" sheet.
  const legs = session('2026-11-10', 'legs', [entry('squat', rep(3, 100, 5)), entry('plank', at(2.5, [60, 60, 60]))]);

  test('sessionVolume counts the squat (100 × 5 × 3) and not the weighted plank', () => {
    assert.equal(sessionVolume(legs), 1500);
  });

  test('weeklyVolume uses the same rule', () => {
    assert.deepEqual(weeklyVolume([legs]).map((w) => w.volume), [1500]);
  });

  test('a session with only timed work has no volume', () => {
    assert.equal(sessionVolume(session('2026-11-10', 'pullA', [entry('plank', at(5, [45, 40]))])), 0);
  });
});

describe('MAX_WORKOUT_MINUTES — the longest workout that still counts as one sitting', () => {
  test('is 4 hours: a long session fits, a draft left overnight does not', () => {
    assert.equal(program.MAX_WORKOUT_MINUTES, 240);
  });
});
