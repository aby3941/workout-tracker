// Shared builders and comparison helpers for the test files.
// Not a test file itself (no tests are registered here).

/** [[w, r], ...] → [{weight, reps}, ...] */
export const sets = (...pairs) => pairs.map(([weight, reps]) => ({ weight, reps }));

/** n identical sets of weight × reps */
export const rep = (n, weight, reps) => Array.from({ length: n }, () => ({ weight, reps }));

/** weight × each reps value → sets */
export const at = (weight, repsList) => repsList.map((reps) => ({ weight, reps }));

/** One logged entry. `name` only for custom exercises. */
export const entry = (exerciseId, setList, name) =>
  name === undefined ? { exerciseId, sets: setList } : { exerciseId, name, sets: setList };

/** One session in the stored shape. */
export function session(date, day, entries = [], { offDay = false, note = '', id } = {}) {
  const s = { date, day, offDay, note, entries };
  if (id !== undefined) s.id = id;
  return s;
}

export const clone = (v) => structuredClone(v);

/**
 * Canonical form for "equals, ignoring id" comparisons:
 * drops id, defaults note '' / offDay false, keeps `name` only on custom entries
 * (the spec makes `name` optional for catalog entries).
 */
export function normalizeSession(s) {
  return {
    date: s.date,
    day: s.day,
    offDay: Boolean(s.offDay),
    note: s.note ?? '',
    entries: s.entries.map((e) => {
      const out = { exerciseId: e.exerciseId, sets: e.sets.map(({ weight, reps }) => ({ weight, reps })) };
      if (String(e.exerciseId).startsWith('custom:')) out.name = e.name;
      return out;
    }),
  };
}

const byDateDay = (a, b) => (a.date + '|' + a.day < b.date + '|' + b.day ? -1 : a.date + '|' + a.day > b.date + '|' + b.day ? 1 : 0);

/** Normalise and order by (date, day) so order-agnostic equality can be asserted. */
export const canonical = (list) => list.map(normalizeSession).sort(byDateDay);

/** Reference date arithmetic in UTC (test oracle only). */
export function refAddDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Reference Monday-of-week in UTC (test oracle only). */
export function refWeekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return refAddDays(iso, -((dow + 6) % 7));
}

/** Local-getter ISO date of a Date (test oracle only). */
export const localISO = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

/**
 * A varied set of sessions used by the text and CSV round-trip tests:
 * unsorted, off day, notes with punctuation, decimals, bodyweight (0), custom exercise,
 * repeated runs split by a different set, the same exercise twice in one session,
 * bench as an accessory on pushB, and two sessions on the same date.
 */
export function richSessions() {
  return [
    session('2026-11-10', 'pushA', [
      entry('bench', [...rep(4, 62.5, 5), { weight: 62.5, reps: 8 }]),
      entry('ohp', rep(3, 30, 10)),
      entry('inclineDbPress', sets([22.5, 12], [22.5, 10], [20, 10])),
      entry('tricepsPushdown', rep(3, 25, 12)),
      entry('lateralRaise', rep(3, 10, 15)),
      entry('ohTricepsExt', sets([15, 12], [15, 12], [15, 9])),
      entry('lateralRaise', sets([10, 15], [10, 14], [10, 12])),
    ], { offDay: true }),
    session('2026-11-03', 'pullA', [
      entry('deadlift', sets([140, 7])),
      entry('pullUp', rep(3, 0, 8)),
      entry('cableRow', sets([50, 12], [50, 12], [50, 12], [55, 10], [50, 12], [50, 12], [50, 12])),
      entry('rearDeltFly', rep(5, 7.5, 20)),
      entry('bandPullApart', rep(5, 0, 20)),
      entry('custom:zercher squat', sets([60, 8], [60, 8]), 'Zercher squat'),
      entry('abWheel', rep(3, 0, 10)),
      entry('plank', rep(3, 0, 60)),
    ], { note: 'slept badly, ate late' }),
    session('2026-11-05', 'legs', [
      entry('squat', sets([100, 5], [100, 5], [100, 7])),
      entry('rdl', rep(3, 80, 10)),
      entry('legPress', rep(3, 140, 12)),
      entry('legCurl', rep(3, 40, 12)),
      entry('calfRaise', rep(5, 56.25, 12)),
    ]),
    session('2026-11-07', 'pushB', [
      entry('ohp', [...rep(4, 40, 5), { weight: 40, reps: 6 }]),
      entry('bench', rep(3, 50, 10)),
      entry('frontRaise', sets([7.5, 15])),
    ]),
    session('2026-11-07', 'pullB', [
      entry('barbellRow', rep(5, 60, 5)),
      entry('chinUp', sets([0, 10], [0, 9], [0, 8])),
      entry('hammerCurl', rep(4, 12.5, 10)),
    ], { note: 'double day' }),
  ];
}
