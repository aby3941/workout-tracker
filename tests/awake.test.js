// §20.2: keep the screen on only while a rest or set timer runs.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as timers from '../public/js/timers.js';

describe('needsWakeLock', () => {
  const rest = { kind: 'rest', uid: 'main', set: 0, startedAt: 1, extra: 0 };
  const set = { kind: 'set', uid: 'main', set: 1, startedAt: 1 };

  test('a running rest or set timer keeps the screen on (setting missing = on)', () => {
    assert.equal(timers.needsWakeLock(rest, {}), true);
    assert.equal(timers.needsWakeLock(set, {}), true);
    assert.equal(timers.needsWakeLock(rest, { keepAwake: true }), true);
  });

  test('no timer → no wake lock', () => {
    assert.equal(timers.needsWakeLock(null, {}), false);
    assert.equal(timers.needsWakeLock(undefined, { keepAwake: true }), false);
  });

  test('switched off → no wake lock even with a timer', () => {
    assert.equal(timers.needsWakeLock(rest, { keepAwake: false }), false);
    assert.equal(timers.needsWakeLock(set, { keepAwake: false }), false);
  });

  test('settings missing altogether is treated as on', () => {
    assert.equal(timers.needsWakeLock(rest, undefined), true);
  });
});
