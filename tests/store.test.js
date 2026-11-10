import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY, defaultState, load, save, newId, sessionKey, mergeSessions, deleteSession, convertAllWeights,
} from '../public/js/store.js';
import { convertWeight } from '../public/js/units.js';
import { session, entry, sets, rep, clone } from './_helpers.js';

/** In-memory stand-in for localStorage; `keys()` lists what is stored. */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
    keys: () => [...data.keys()],
  };
}

const DEFAULT = {
  version: 1,
  settings: { unit: 'kg', goal: 'standard', abs: false, lastBackupAt: null, setupDone: false },
  choices: {},
  sessions: [],
  draft: null,
  baselines: {},
};

const S1 = session('2026-11-03', 'pullA', [entry('deadlift', sets([140, 7]))], { id: 'a' });
const S2 = session('2026-11-07', 'pushA', [entry('bench', rep(5, 62.5, 5))], { id: 'b', note: 'old' });

describe('STORAGE_KEY / defaultState', () => {
  test('constants', () => {
    assert.equal(STORAGE_KEY, 'ppl-tracker-v1');
    assert.deepEqual(defaultState(), DEFAULT);
  });

  test('defaultState returns a fresh object each time', () => {
    const a = defaultState();
    a.sessions.push(S1);
    a.settings.unit = 'lb';
    a.choices.x = 'y';
    assert.deepEqual(defaultState(), DEFAULT);
  });
});

describe('load', () => {
  test('missing → default state', () => {
    assert.deepEqual(load(fakeStorage()), DEFAULT);
  });

  test('corrupt JSON → default state, raw string kept under a -corrupt- key', () => {
    const raw = '{"version":1,"sessions":[{"date":"2026-11';
    const storage = fakeStorage({ [STORAGE_KEY]: raw });
    assert.deepEqual(load(storage), DEFAULT);
    const backups = storage.keys().filter((k) => k.startsWith(STORAGE_KEY + '-corrupt-'));
    assert.equal(backups.length, 1);
    assert.match(backups[0].slice((STORAGE_KEY + '-corrupt-').length), /^\d+$/);
    assert.equal(storage.getItem(backups[0]), raw);
  });

  test('valid JSON that is not a state object is also kept under a -corrupt- key (review fix)', () => {
    for (const raw of ['[{"date":"2026-11-10","day":"legs"}]', 'null', '42', '"text"']) {
      const storage = fakeStorage({ [STORAGE_KEY]: raw });
      assert.deepEqual(load(storage), DEFAULT, raw);
      const backups = storage.keys().filter((k) => k.startsWith(STORAGE_KEY + '-corrupt-'));
      assert.equal(backups.length, 1, raw);
      assert.equal(storage.getItem(backups[0]), raw);
    }
  });

  test('partial objects are filled with defaults', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ sessions: [S1], settings: { unit: 'lb' } }) });
    assert.deepEqual(load(storage), {
      version: 1,
      settings: { unit: 'lb', goal: 'standard', abs: false, lastBackupAt: null, setupDone: false },
      choices: {},
      sessions: [S1],
      draft: null,
      baselines: {},
    });
  });

  test('existing settings and choices are kept', () => {
    const stored = { version: 1, settings: { goal: 'cut', abs: true }, choices: { 'pull.vertical': 'chin' } };
    const state = load(fakeStorage({ [STORAGE_KEY]: JSON.stringify(stored) }));
    assert.deepEqual(state.settings, { unit: 'kg', goal: 'cut', abs: true, lastBackupAt: null, setupDone: false });
    assert.deepEqual(state.choices, { 'pull.vertical': 'chin' });
    assert.deepEqual(state.sessions, []);
    assert.equal(state.draft, null);
  });
});

describe('save / load', () => {
  test('round trip', () => {
    const storage = fakeStorage();
    const state = {
      version: 1,
      settings: { unit: 'lb', goal: 'strength', abs: true, lastBackupAt: '2026-11-01', setupDone: true },
      choices: { 'pull.rear': 'combo', 'pull.vertical': 'custom:Assisted Pull-up' },
      sessions: [S1, S2],
      draft: { date: '2026-11-10', day: 'legs', entries: [] },
      baselines: { 'squat|main': { weight: 70, setOn: '2026-11-03' } },
    };
    save(state, storage);
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), state);
    assert.deepEqual(load(storage), state);
  });
});

describe('newId / sessionKey', () => {
  test('newId gives unique strings', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
    assert.equal(new Set(ids).size, ids.length);
  });

  test('sessionKey = date|day', () => {
    assert.equal(sessionKey({ date: '2026-11-10', day: 'pullA' }), '2026-11-10|pullA');
  });
});

describe('mergeSessions', () => {
  test('same key replaces (keeping the existing id); others are added with new ids; sorted by date', () => {
    const existing = [S2, S1];
    const replacement = session('2026-11-07', 'pushA', [entry('bench', rep(5, 65, 5))], { note: 'new' });
    const added = session('2026-11-05', 'legs', [entry('squat', rep(3, 100, 5))]);
    const { sessions, added: nAdded, replaced } = mergeSessions(existing, [replacement, added]);

    assert.equal(nAdded, 1);
    assert.equal(replaced, 1);
    assert.deepEqual(sessions.map((s) => sessionKey(s)), ['2026-11-03|pullA', '2026-11-05|legs', '2026-11-07|pushA']);

    assert.deepEqual(sessions[0], S1);

    const { id: newLegsId, ...legsRest } = sessions[1];
    assert.equal(typeof newLegsId, 'string');
    assert.ok(newLegsId.length > 0);
    assert.ok(newLegsId !== 'a' && newLegsId !== 'b');
    assert.deepEqual(legsRest, added);

    const { id: keptId, ...pushRest } = sessions[2];
    assert.equal(keptId, 'b');
    assert.deepEqual(pushRest, replacement);
  });

  test('new sessions each get distinct ids', () => {
    const incoming = [
      session('2026-11-01', 'pullA', [entry('deadlift', sets([100, 5]))]),
      session('2026-11-02', 'pushA', [entry('bench', sets([60, 5]))]),
      session('2026-11-03', 'legs', [entry('squat', sets([80, 5]))]),
    ];
    const { sessions, added, replaced } = mergeSessions([], incoming);
    assert.equal(added, 3);
    assert.equal(replaced, 0);
    const ids = sessions.map((s) => s.id);
    assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
    assert.equal(new Set(ids).size, 3);
  });

  test('nothing incoming → existing, sorted, counts zero', () => {
    const { sessions, added, replaced } = mergeSessions([S2, S1], []);
    assert.deepEqual(sessions, [S1, S2]);
    assert.equal(added, 0);
    assert.equal(replaced, 0);
  });

  test('the same key twice in incoming: the later one wins; counts are per resulting session (review fix)', () => {
    const existing = [S1];
    const incoming = [
      session('2026-11-03', 'pullA', [entry('deadlift', sets([145, 5]))]),
      session('2026-11-03', 'pullA', [entry('deadlift', sets([150, 3]))]),
      session('2026-11-05', 'legs', [entry('squat', sets([100, 5]))]),
      session('2026-11-05', 'legs', [entry('squat', sets([102.5, 5]))]),
    ];
    const { sessions, added, replaced } = mergeSessions(existing, incoming);
    assert.deepEqual(sessions.map((s) => [sessionKey(s), s.entries[0].sets[0].weight]), [['2026-11-03|pullA', 150], ['2026-11-05|legs', 102.5]]);
    assert.equal(sessions[0].id, 'a');
    assert.equal(added, 1);
    assert.equal(replaced, 1);
  });

  test('does not mutate either input', () => {
    const existing = [S2, S1];
    const incoming = [
      session('2026-11-07', 'pushA', [entry('bench', rep(5, 65, 5))]),
      session('2026-11-05', 'legs', [entry('squat', rep(3, 100, 5))]),
    ];
    const before = clone({ existing, incoming });
    mergeSessions(existing, incoming);
    assert.deepEqual({ existing, incoming }, before);
    assert.equal(incoming[1].id, undefined);
  });
});

describe('deleteSession', () => {
  test('returns a new array without that id; input untouched', () => {
    const list = [S1, S2];
    const out = deleteSession(list, 'a');
    assert.deepEqual(out, [S2]);
    assert.notEqual(out, list);
    assert.deepEqual(list, [S1, S2]);
  });

  test('unknown id → same contents, new array', () => {
    const list = [S1, S2];
    const out = deleteSession(list, 'zzz');
    assert.deepEqual(out, list);
    assert.notEqual(out, list);
  });
});

describe('convertAllWeights', () => {
  const state = () => ({
    version: 1,
    settings: { unit: 'kg', goal: 'cut', abs: true, lastBackupAt: '2026-11-01' },
    choices: { 'pull.vertical': 'x' },
    sessions: [
      session('2026-11-03', 'pullA', [entry('deadlift', sets([140, 7])), entry('pullUp', rep(3, 0, 8))], { id: 'a' }),
      session('2026-11-07', 'pushA', [entry('bench', sets([62.5, 5], [100, 3]))], { id: 'b', note: 'n' }),
    ],
    draft: null,
  });

  test('kg → lb: every set weight converted, unit switched, everything else kept', () => {
    const input = state();
    const before = clone(input);
    const out = convertAllWeights(input, 'lb');
    assert.deepEqual(input, before, 'input not mutated');
    const expected = clone(before);
    expected.settings.unit = 'lb';
    for (const s of expected.sessions) {
      for (const e of s.entries) for (const st of e.sets) st.weight = convertWeight(st.weight, 'kg', 'lb');
    }
    assert.deepEqual(out, expected);
    assert.equal(out.sessions[1].entries[0].sets[1].weight, 220.5);
    assert.equal(out.sessions[0].entries[1].sets[0].weight, 0);
  });

  test('lb → kg', () => {
    const input = convertAllWeights(state(), 'lb');
    const out = convertAllWeights(input, 'kg');
    assert.equal(out.settings.unit, 'kg');
    assert.equal(out.sessions[1].entries[0].sets[1].weight, convertWeight(220.5, 'lb', 'kg'));
  });

  test('same unit → equal state', () => {
    const input = state();
    assert.deepEqual(convertAllWeights(input, 'kg'), state());
  });
});
