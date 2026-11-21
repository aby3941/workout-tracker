// Logged-workout summaries shared by Today and History (§18.3–§18.5): the time line, the exercise lines with their
// "best" tags, the 🏆 pill, the "Done for today ✓" view and the "Workout saved" sheet.
// New bests come from analysis.js (computed on the fly, nothing stored); times from dates.js.

import { exerciseName, isTimed, roleOf } from '../program.js';
import { occurrencesOf } from '../progression.js';
import { e1rm, trackKey, sessionVolume } from '../analysis.js';
import { isValidLocalTime, formatTime, minutesBetween, formatDuration, formatDate, weekdayShort } from '../dates.js';
import { formatWeight, cleanNumber } from '../units.js';
import { html, plural, setsLong } from './dom.js';
import { openSheet } from './sheets.js';
import { dayName } from './model.js';

/** A session's valid times (either may be missing). */
const timesOf = (s) => ({
  start: isValidLocalTime(s.startedAt) ? s.startedAt : null,
  end: isValidLocalTime(s.finishedAt) ? s.finishedAt : null,
});

/** "18:42 – 19:34" */
const clockRange = (start, end) => `${formatTime(start)} – ${formatTime(end)}`;

/**
 * When a workout happened: "18:42 – 19:34 · 52 min"; one time only → "Started 18:42" / "Finished 19:34";
 * none (logged before times existed, or imported without them) → "Time not recorded".
 * @param {{startedAt?: string, finishedAt?: string}} s
 * @returns {string}
 */
export function timeLine(s) {
  const { start, end } = timesOf(s);
  if (start && end) {
    const min = minutesBetween(start, end);
    return min >= 0 ? `${clockRange(start, end)} · ${formatDuration(min)}` : clockRange(start, end);
  }
  if (start) return `Started ${formatTime(start)}`;
  if (end) return `Finished ${formatTime(end)}`;
  return 'Time not recorded';
}

/**
 * "🏆 1 new best" / "🏆 2 new bests" pill, or nothing.
 * @param {Array<object>} bests
 */
export function bestsPill(bests) {
  return bests && bests.length ? html`<span class="pill best">🏆 ${plural(bests.length, 'new best')}</span>` : '';
}

/** Track keys of a session's entries, in entry order (role from the day, occurrence from the saved order). */
function entryKeys(s) {
  const entries = s.entries || [];
  const occ = occurrencesOf(entries);
  return entries.map((e, i) => trackKey(e.exerciseId, roleOf(s.day, e.exerciseId), occ[i]));
}

/**
 * One line per logged exercise — "Squat [best]  82.5 kg × 5, 5, 7" — with a "best" tag on the tracks in `bests`.
 * @param {object} s session
 * @param {'kg'|'lb'} unit
 * @param {Array<{exerciseId: string, role: string, occurrence: number}>} [bests]
 */
export function entryLines(s, unit, bests = []) {
  const best = new Set(bests.map((b) => trackKey(b.exerciseId, b.role, b.occurrence)));
  const keys = entryKeys(s);
  return (s.entries || []).map((e, i) => (e.sets && e.sets.length
    ? html`<div class="hline"><span>${exerciseName(e.exerciseId, e.name)}${best.has(keys[i]) ? html` <i class="best-tag">best</i>` : ''}</span> <span>${setsLong(e.sets, unit, isTimed(e.exerciseId))}</span></div>`
    : ''));
}

// ---------------------------------------------------------------- Done for today (§18.4)

/**
 * The "Done for today ✓" screen: a card per workout saved today, then "Up next" with "Start it now instead".
 * @param {{today: string, unit: 'kg'|'lb', banner: object|string,
 *   cards: Array<{s: object, pos: number, bests: Array<object>}>,
 *   next: {position: number, dayId: string, line: string}}} opts
 */
export function doneMarkup({ today, unit, banner, cards, next }) {
  return html`<div class="screen today done">
    <header class="today-head">
      <div class="kicker"><span>${weekdayShort(today)} ${formatDate(today)}</span></div>
      <h1 class="big">Done for today ✓</h1>
    </header>
    ${banner}
    ${cards.map(({ s, pos, bests }) => html`<article class="card donecard" aria-label="Day ${pos} of 6 · ${dayName(s.day)}">
      <div class="ex-head"><div class="ex-title"><h2>Day ${pos} of 6 · ${dayName(s.day)}</h2><p class="cap">${timeLine(s)}${s.offDay ? ' · off day' : ''}</p></div>${bestsPill(bests)}</div>
      <div class="lines">${entryLines(s, unit, bests)}</div>
      ${s.note ? html`<p class="sum note-line">Note: ${s.note}</p>` : ''}
      <div class="hist-actions"><button type="button" class="btn" data-act="edit-done" data-id="${s.id}">Edit</button></div>
    </article>`)}
    <div class="card upnext">
      <p class="cap">Up next — shows here from 12 am</p>
      <h2>Day ${next.position} of 6 · ${dayName(next.dayId)}</h2>
      <p class="cap">${next.line}</p>
      <button type="button" class="btn wide" data-act="start-next">Start it now instead</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- Workout saved (§18.5)

/** "Squat 82.5 kg × 5, 5, 7" + "+2.5 kg on your previous best · est. 1-rep max 101.8 kg" for one new best. */
function bestLine(s, b, unit) {
  const keys = entryKeys(s);
  const e = (s.entries || [])[keys.indexOf(trackKey(b.exerciseId, b.role, b.occurrence))];
  if (!e) return '';
  const hold = b.kind === 'hold';
  const gain = cleanNumber(b.value - b.previous);
  let sub = `+${hold ? `${gain} s` : formatWeight(gain, unit)} on your previous best`;
  if (!hold && b.role === 'main') {
    const top = Math.max(...e.sets.filter((st) => st.weight === b.value).map((st) => e1rm(st.weight, st.reps)));
    if (top > 0) sub += ` · est. 1-rep max ${formatWeight(top, unit)}`;
  }
  return html`<p class="pr"><b>${exerciseName(e.exerciseId, e.name)} ${setsLong(e.sets, unit, hold)}</b><span>${sub}</span></p>`;
}

/**
 * The sheet after saving a new workout: 🎉 "New best!" with one line per best, or "Workout saved ✓"; tiles for the
 * duration (when both times exist), exercises and weight lifted; what's next. Nice / Escape close it.
 * @param {{session: object, bests: Array<object>, unit: 'kg'|'lb', next: {position: number, dayId: string}, fromTomorrow: boolean}} opts
 * @returns {{el: HTMLElement, close: () => void}}
 */
export function openSavedSheet({ session, bests, unit, next, fromTomorrow }) {
  const { start, end } = timesOf(session);
  const count = (session.entries || []).length;
  const tiles = [
    start && end && minutesBetween(start, end) >= 0 ? [formatDuration(minutesBetween(start, end)), clockRange(start, end)] : null,
    [String(count), count === 1 ? 'exercise' : 'exercises'],
    [formatWeight(Math.round(sessionVolume(session)), unit, { grouped: true }), 'lifted'],
  ].filter(Boolean);
  const sheet = openSheet({
    title: 'Workout saved',
    showTitle: false,
    className: 'celebrate',
    body: html`${bests.length
      ? html`<div class="party" aria-hidden="true">🎉</div><h2 class="cel-title">New best!</h2>${bests.map((b) => bestLine(session, b, unit))}`
      : html`<h2 class="cel-title">Workout saved ✓</h2>`}
      <div class="sumgrid">${tiles.map(([value, label]) => html`<div><b>${value}</b><span>${label}</span></div>`)}</div>
      <p class="next">Next: <b>Day ${next.position} · ${dayName(next.dayId)}</b>${fromTomorrow ? ' — from tomorrow' : ''}</p>
      <button type="button" class="save" data-act="nice" data-autofocus>Nice</button>`,
  });
  sheet.el.querySelector('[data-act="nice"]').addEventListener('click', sheet.close);
  return sheet;
}
