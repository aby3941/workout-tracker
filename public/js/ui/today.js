// Today: log the next workout, or edit an old one loaded from History; once today's workout is saved, "Done for
// today ✓" until midnight (§18.4). The form lives in `state.draft` once the user changes anything (autosaved); until
// then it is rebuilt from the plan on every render, so swaps, goal and abs changes flow straight in. Suggestions come
// from progression.js. The draft also holds the workout's start time (`startedAt`: Start workout, or the first thing
// done, §20.1), the one rest or set timer (`timer`, §18.1 / §19.2; the sets keep the recorded `rest` and `duration`)
// and the warm-up ticks (`warmup`, §18.2).

import {
  DAYS, ROTATION, REST, EXERCISES, SLOTS, MISSES_BEFORE_DELOAD, DELOAD_FACTOR, MAIN_REPS, HOLD_GOAL_SECONDS, MAX_WORKOUT_MINUTES,
  nextWorkout, cyclePosition, roleOf, mainPrescription, accessoryPrescription,
  matchExercise, searchExercises, customId, isCustom, exerciseName, isTimed, equipmentOf, hasPlateLine,
  supersetPairs, loggedSet, isRecordedRest, isRecordedDuration,
} from '../program.js';
import {
  suggestMain, suggestAccessory, suggestTimed, applyBaseline, baselineKey, warmupSets, maxWeight, repsToGo, occurrencesOf,
} from '../progression.js';
import { formatWeight, formatNumber, parseWeightInput, stepFor, smallestIncrement, platesText } from '../units.js';
import {
  formatDate, formatDateShort, weekdayShort, compareISO, isValidISO, daysBetween, addDays, sortByDate,
  nowLocal, isValidLocalTime, formatTime, localDate, minutesBetween, formatDuration, formatClock,
} from '../dates.js';
import { mergeSessions, replaceSession, deleteSession, consumeBaselines, sessionKey } from '../store.js';
import { bestsBySession } from '../analysis.js';
import { html, setHTML, icon, plural, setsLong, focusKey, restoreFocus } from './dom.js';
import { openSheet, confirmSheet, toast, keepFocusOnTap } from './sheets.js';
import { openSwapSheet, openSetWeightSheet } from './pickers.js';
import { dayPlan, dayName, partnerOf, trackName, historyPositions } from './model.js';
import { usableTimer, draftTimer, restTaken, setTaken, nextAfter, nextToDo, pairWith } from '../timers.js';
import {
  restMarkup, restView, updateRest, setTimerMarkup, updateSetTimer, rowStartMarkup, unlockSound, beep, REST_MORE_SECONDS,
} from './rest.js';
import { doneMarkup, openSavedSheet } from './summary.js';

/** Most sets per exercise (matches the import cap, so every logged workout survives a text backup). */
const MAX_SETS = 20;
/** Days after which the backup reminder shows. */
const BACKUP_DAYS = 7;
/** Sets an added exercise starts with. */
const EXTRA_SETS = 3;
/** An empty Save this soon after a save is the second tap of a double-tap: ignored, so "Saved" stays on screen. */
const SAVE_REPEAT_MS = 1500;
/** How long a just-added card stays highlighted. */
const FLASH_MS = 1200;
/** Weight column header by equipment (§17.4): weights are the total on the bar, the stack, one dumbbell, or added. */
const WEIGHT_HEADS = { barbell: 'Total weight', machine: 'Weight (stack)', cable: 'Weight (stack)', dumbbell: 'Weight (each)', bodyweight: 'Added weight' };
/** How often the rest timer, the "min so far" line and the midnight check update. */
const TICK_MS = 1000;
/**
 * The timers' buttons ignore taps this soon after a commit or a Start made them appear: on a phone, tapping the next
 * box commits the one you left, a timer slides in under it, and the same tap must not land on "Skip" or "Cancel".
 */
const TIMER_TAP_GUARD_MS = 400;
/** The ready beep / flash only when the rest became ready this recently (not when the app is reopened later). */
const READY_FRESH_S = 5;

// Screen memory that is not saved: which cards are open, the date editor, inputs holding unreadable text,
// when the last save happened, the last committed reps box, the reps box being typed in and what it held before the
// first keystroke (only a set that was empty is a new set — one that had reps is being corrected), when a commit or a
// Start last moved the timer, where the last timer was (after Skip / Cancel the "Start set N" button carries on from
// there, `nextToDo`), and the rest phase last seen (so "ready" beeps once).
const ui = {
  formId: '', opened: new Set(), dateOpen: false, bad: new Set(), savedAt: 0,
  committed: '', typing: { key: '', from: null }, timerMovedAt: 0, lastTimer: null, restSeen: { key: '', phase: '' },
};
/**
 * One app-wide tick a second, started by the first draw of Today: it watches the rest timer on every tab (the "ready"
 * beep and flash, §18.1) and runs the per-second update of the Today screen while that screen is on show.
 */
const beat = { ctx: null, timer: 0, screen: null };

// A reps box is committed by leaving it, i.e. by tapping something else. Moving the rest timer at that moment would
// shift the page under the finger and the tap would land elsewhere, so layout changes wait until the tap is over.
const pointer = { down: false, waiting: [], bound: false };
/** Release everything waiting for the tap, after its click has been handled. */
function pointerUp() {
  pointer.down = false;
  const run = pointer.waiting.splice(0);
  if (run.length) setTimeout(() => run.forEach((fn) => fn()), 0);
}
/** Watch taps (once, on the first draw of Today — a tap must be seen from its start). */
function watchTaps() {
  if (pointer.bound) return;
  pointer.bound = true;
  window.addEventListener('pointerdown', () => { pointer.down = true; }, true);
  window.addEventListener('pointerup', pointerUp, true);
  window.addEventListener('pointercancel', pointerUp, true);
}
/** Run `fn` once no tap is in progress (right after the current one, or on the next tick). */
function afterTap(fn) {
  if (!pointer.down) { setTimeout(fn, 0); return; }
  pointer.waiting.push(fn);
  setTimeout(() => { const i = pointer.waiting.indexOf(fn); if (i >= 0) { pointer.waiting.splice(i, 1); fn(); } }, 1000);
}

const blankSet = () => ({ weight: null, reps: null, touched: false });

// ---------------------------------------------------------------- the form

/** A form for a new workout built from the plan (weights pre-filled from the suggestions). */
function freshForm(state, { date, day, offDay = false, note = '', dateChosen = false }) {
  const plan = dayPlan(state, day);
  const mainId = plan.main.exerciseId;
  const entries = [{ uid: 'main', slotKey: null, exerciseId: mainId, name: EXERCISES[mainId].name, sets: Array.from({ length: plan.main.sets }, blankSet) }];
  for (const [uid, it] of planIndex(plan)) {
    entries.push({ uid, slotKey: it.slotKey, exerciseId: it.exerciseId, name: it.name, sets: Array.from({ length: it.sets }, blankSet) });
  }
  const form = { date, day, offDay, note, dateChosen, editingId: null, extraCount: 0, entries };
  prefill(state, form);
  return form;
}

/** Plan items keyed by a stable uid ("pull.rear#1" = the second exercise of a combo slot). */
function planIndex(plan) {
  const seen = {};
  const out = new Map();
  for (const it of plan.items) {
    seen[it.slotKey] = (seen[it.slotKey] ?? -1) + 1;
    out.set(`${it.slotKey}#${seen[it.slotKey]}`, it);
  }
  return out;
}

/** A stored draft made safe to render (old or damaged drafts can't crash the screen). */
function usableDraft(state, today) {
  const d = state.draft;
  if (!d || !DAYS[d.day] || !Array.isArray(d.entries)) return null;
  if (!isValidISO(d.date)) d.date = today;
  d.entries = d.entries.filter((e) => e && typeof e.exerciseId === 'string' && Array.isArray(e.sets));
  d.entries.forEach((e, i) => {
    if (!e.uid) e.uid = `x-restored-${i}`;
    if (!e.name) e.name = exerciseName(e.exerciseId);
    e.sets = e.sets.filter((s) => s && typeof s === 'object');
    if (!e.sets.length) e.sets.push(blankSet());
  });
  if (d.editingId && !state.sessions.some((s) => s.id === d.editingId)) d.editingId = null;
  // Batch 2 fields (§18): a damaged start time or warm-up list is dropped, never shown.
  if (d.startedAt !== undefined && !isValidLocalTime(d.startedAt)) delete d.startedAt;
  if (d.warmup !== undefined && !(d.warmup && typeof d.warmup === 'object' && !Array.isArray(d.warmup))) delete d.warmup;
  // §19: Batch 2's `rest` became `timer` when the state was loaded (store.migrate). The timer goes when it is damaged,
  // its set is gone, it is more than 4 hours old (an earlier sitting; a rest it recorded stays on its set), or the
  // form edits a saved workout (no timers there).
  delete d.rest;
  if (d.timer !== undefined) {
    const timer = !d.editingId && usableTimer(d.timer, Date.now());
    const entry = timer && d.entries.find((e) => e.uid === timer.uid);
    if (!entry || timer.set >= entry.sets.length) delete d.timer;
  }
  return d;
}

/** True when a stored draft holds a started workout: reps typed into a new workout, or an edit of a saved one. */
function draftInUse(state) {
  const d = state.draft;
  if (!d || !Array.isArray(d.entries)) return false;
  if (d.editingId && state.sessions.some((s) => s.id === d.editingId)) return true;
  return d.entries.some((e) => e && Array.isArray(e.sets) && e.sets.some((st) => st && st.reps > 0));
}

/**
 * "Done for today ✓" (§18.4): a workout is saved with today's date and no new workout has been started — unless
 * "Start it now instead" was pressed today (`settings.startNextOn`; any other date is ignored).
 * @param {object} state
 * @param {string} today
 * @returns {boolean}
 */
function isDoneForToday(state, today) {
  if (state.settings.startNextOn === today) return false;
  return state.sessions.some((s) => s.date === today) && !draftInUse(state);
}

/**
 * The form on screen: the saved draft, or a fresh form for the next workout.
 * A new-workout draft left from an earlier day with no reps typed and no workout started in this sitting (a set timer
 * started just before midnight, §18.3; and a date the user didn't pick) moves to today — nothing in it belongs to that
 * day, so an old start time goes too. One with reps, or still in its sitting, keeps its date: it was done then.
 * Weights the user hasn't typed always follow the current suggestion (date, unit, set weights, history).
 */
function currentForm(ctx) {
  const today = ctx.today();
  const hadTimer = Boolean(ctx.state.draft && ctx.state.draft.timer);
  const draft = usableDraft(ctx.state, today);
  if (draft) {
    let changed = hadTimer && !draft.timer; // a stale timer was dropped: save that
    if (movesToToday(draft, today)) {
      draft.date = today;
      delete draft.startedAt;
      changed = true;
    }
    if (syncDraft(ctx.state, draft)) changed = true;
    if (prefill(ctx.state, draft)) changed = true;
    if (changed) ctx.saveSoon();
    return draft;
  }
  return freshForm(ctx.state, { date: today, day: nextWorkout(ctx.state.sessions).dayId });
}

/** A new-workout draft that moves to `today` (see `currentForm`): from an earlier day, date not picked, no reps, not started. */
function movesToToday(draft, today) {
  return !draft.editingId && !draft.dateChosen && compareISO(draft.date, today) < 0 && !draft.entries.some(hasReps) && !liveStart(draft);
}

/**
 * Keep a new-workout draft in step with the plan (a swap, goal or abs change made in Plan): exercises the user
 * hasn't typed anything into follow the plan; anything with typed weights or reps is left alone.
 * @returns {boolean} true when the draft changed
 */
function syncDraft(state, form) {
  if (form.editingId) return false;
  const index = planIndex(dayPlan(state, form.day));
  const untouched = (e) => e.sets.every((s) => s.reps == null && !s.touched);
  const bySlot = new Map(form.entries.filter((e) => e.slotKey).map((e) => [e.uid, e]));
  let changed = false;
  const planned = [];
  for (const [uid, it] of index) {
    const e = bySlot.get(uid);
    bySlot.delete(uid);
    if (e && !(untouched(e) && (e.exerciseId !== it.exerciseId || e.sets.length !== it.sets))) { planned.push(e); continue; }
    changed = true;
    if (form.timer && form.timer.uid === uid) delete form.timer; // its set now belongs to another exercise
    planned.push({ uid, slotKey: it.slotKey, exerciseId: it.exerciseId, name: it.name, sets: Array.from({ length: it.sets }, blankSet) });
  }
  // Slot entries the plan no longer has (abs switched off, a combo swapped away) go unless they hold the user's numbers.
  const kept = form.entries.filter((e) => !e.slotKey || (bySlot.has(e.uid) && !untouched(e)));
  if ([...bySlot.values()].some(untouched)) changed = true;
  if (!changed) return false;
  form.entries = [...kept.filter((e) => e.uid === 'main'), ...planned, ...kept.filter((e) => e.uid !== 'main')];
  if (form.timer && !form.entries.some((e) => e.uid === form.timer.uid)) delete form.timer;
  prefill(state, form);
  return true;
}

/** Sessions a suggestion may look at: only those before the form's date (never the one being edited). */
function priorSessions(state, form) {
  return state.sessions.filter((s) => s.id !== form.editingId && compareISO(s.date, form.date) < 0);
}

/**
 * "Day N" of the form's workout, from the sessions that will come before it once saved: an edit keeps its
 * place (`replaceSession`), a new workout goes after everything up to and including its date (`mergeSessions`).
 */
function positionOf(state, form) {
  if (form.editingId) {
    const placed = replaceSession(state.sessions, form.editingId, { date: form.date, day: form.day });
    return cyclePosition(form.day, placed.slice(0, placed.findIndex((s) => s.id === form.editingId)));
  }
  return cyclePosition(form.day, state.sessions.filter((s) => compareISO(s.date, form.date) <= 0));
}

/**
 * How an entry is shown: role, track occurrence, prescription, rest, swap, superset partner, equipment, plate line.
 * The occurrence is the entry's place among the form's entries of the same exercise — the order it is saved in,
 * so it is the track it will be logged to (§17.1).
 */
function entryInfo(form, entry, plan, index) {
  const role = roleOf(form.day, entry.exerciseId);
  const track = {
    role, occurrence: occurrencesOf(form.entries)[form.entries.indexOf(entry)] ?? 0,
    timed: isTimed(entry.exerciseId), equipment: equipmentOf(entry.exerciseId), plates: hasPlateLine(entry.exerciseId),
  };
  if (role === 'main') {
    const planned = DAYS[form.day].mainSets;
    return { ...track, main: true, rx: null, plannedSets: planned, prescription: mainPrescription(planned), rest: REST.main, swappable: false, superset: null, extra: false };
  }
  const item = index.get(entry.uid);
  const live = item && item.exerciseId === entry.exerciseId ? item : null;
  const base = entry.slotKey && SLOTS[entry.slotKey];
  if (!live && !base) {
    return { ...track, main: false, rx: null, plannedSets: entry.sets.length, prescription: 'Extra', rest: REST.accessory, swappable: false, superset: null, extra: true };
  }
  const rx = live || { sets: base.sets, repsMin: base.repsMin, repsMax: base.repsMax };
  let superset = null;
  if (live && live.supersetWith) {
    const partner = partnerOf(plan, live);
    superset = partner ? partner.name : exerciseName(live.supersetWith);
  }
  return {
    ...track, main: false, rx, plannedSets: rx.sets, prescription: accessoryPrescription(rx), rest: REST.accessory,
    swappable: Boolean(live ? live.swappable : base.swappable), superset, extra: false,
  };
}

/** Suggestion for an entry's track (set weights apply to new workouts only). Timed exercises (plank) hold seconds. */
function suggestionFor(state, form, entry, info, prior) {
  const unit = state.settings.unit;
  const opts = { occurrence: info.occurrence, steps: state.steps };
  const slot = info.rx || { sets: entry.sets.length, repsMin: null, repsMax: null };
  let s;
  if (info.role === 'main') s = suggestMain(prior, entry.exerciseId, unit, opts);
  else if (info.timed) s = suggestTimed(prior, entry.exerciseId, slot, unit, opts);
  else s = suggestAccessory(prior, entry.exerciseId, slot, unit, opts);
  if (!form.editingId) s = applyBaseline(s, state.baselines[baselineKey(entry.exerciseId, info.role, info.occurrence)]);
  return s;
}

/**
 * Fill every weight box the user hasn't typed in: with set 1's weight when the user typed that one (later
 * sets follow set 1), else with the suggested weight.
 * @returns {boolean} true when a weight changed
 */
function prefill(state, form, only = null) {
  const plan = dayPlan(state, form.day);
  const index = planIndex(plan);
  const prior = priorSessions(state, form);
  let changed = false;
  for (const entry of form.entries) {
    if (only && entry !== only) continue;
    const s = suggestionFor(state, form, entry, entryInfo(form, entry, plan, index), prior);
    const lead = entry.sets[0];
    for (const set of entry.sets) {
      if (set.touched) continue;
      const w = set !== lead && lead && lead.touched ? lead.weight : (s.weight ?? null);
      if (set.weight === w) continue;
      if (set === lead) clearWarmupTicks(form, entry); // a new work weight is a new warm-up list (§18.2)
      set.weight = w;
      changed = true;
    }
  }
  return changed;
}

/** The cards with everything needed to draw them. */
function cardsFor(state, form) {
  const plan = dayPlan(state, form.day);
  const index = planIndex(plan);
  const prior = priorSessions(state, form);
  return form.entries.map((entry) => {
    const info = entryInfo(form, entry, plan, index);
    return { entry, info, s: suggestionFor(state, form, entry, info, prior) };
  });
}

const hasReps = (entry) => entry.sets.some((s) => s.reps > 0);

/**
 * The form's start time while it is still the same sitting — at most `MAX_WORKOUT_MINUTES` ago — else null. An older
 * start (a draft left overnight) is not timed on: no "so far", no finish on Save, and new reps today restart the clock.
 */
function liveStart(form) {
  if (!isValidLocalTime(form.startedAt)) return null;
  const age = minutesBetween(form.startedAt, nowLocal());
  return age >= 0 && age <= MAX_WORKOUT_MINUTES ? form.startedAt : null;
}

/**
 * Whether the workout can be started now (§18.3 / §20.1): a new workout logged on its own date that has not started in
 * this sitting (`liveStart`). The Start workout button shows exactly then, and the first warm-up tick, Start tap or
 * reps start the clock only then.
 */
function canStart(ctx, form) {
  return !form.editingId && form.date === ctx.today() && !liveStart(form);
}

/** Forget an entry's warm-up ticks (its warm-up list changed). */
function clearWarmupTicks(form, entry) {
  if (form.warmup && form.warmup[entry.uid]) delete form.warmup[entry.uid];
}

/** The ticked warm-up rows of an entry (indices below `count`). */
function warmupTicks(form, entry, count) {
  const list = form.warmup && form.warmup[entry.uid];
  return new Set(Array.isArray(list) ? list.filter((n) => Number.isInteger(n) && n >= 0 && n < count) : []);
}

/**
 * Opening rule: the main lift and the first exercise that still has an empty reps box are open; an exercise
 * with any reps stays open; a tapped card opens. The card holding the timer, or the next set to do with its
 * "Start set N" button, is open too (§19.2; after a reload a superset's second card may have no reps yet). Open cards
 * stay open while this form is on screen.
 */
function updateOpen(cards, scene) {
  for (const c of cards) if (c.info.main || hasReps(c.entry)) ui.opened.add(c.entry.uid);
  const firstEmpty = cards.find((c) => !c.info.main && c.entry.sets.some((s) => !(s.reps > 0)));
  if (firstEmpty) ui.opened.add(firstEmpty.entry.uid);
  const timed = scene && (scene.timer || scene.todo);
  if (timed) ui.opened.add(timed.uid);
}

// ---------------------------------------------------------------- suggestion copy

function rangeText(rx) {
  return rx.repsMin === rx.repsMax ? `${rx.repsMax}` : `${rx.repsMin}–${rx.repsMax}`;
}

/** Headline + detail for a timed exercise (plank, §17.3): the hold to aim for, in seconds. */
function timedText(s, unit, inc) {
  const hold = `${s.targetSeconds} s`;
  const secs = (item) => `${item.sets.map((x) => x.reps).join(', ')} s`;
  // The deciding session; when an off day after it was passed over, it is named by its date, not "last time".
  const went = (item) => (s.offDayIgnored
    ? `Last time was an off day — going by ${formatDateShort(item.date)}: ${secs(item)}`
    : `Last time: ${secs(item)} — ${HOLD_GOAL_SECONDS} s on every set adds weight`);
  switch (s.action) {
    case 'set':
      return { headline: `Weight you set: ${s.weight === 0 ? 'bodyweight' : formatWeight(s.weight, unit)}`, detail: `Used for this session only · hold ${hold}` };
    case 'increase':
      return { up: true, headline: `Add ${inc()} today → ${formatWeight(s.weight, unit)}`, detail: `Every hold reached ${HOLD_GOAL_SECONDS} s — now hold ${hold} with the weight` };
    case 'keep':
      return {
        headline: s.weight > 0 ? `Hold ${hold} with ${formatWeight(s.weight, unit)}` : `Hold ${hold}`,
        detail: went(s.last),
      };
    default: // 'start'
      return { headline: `Hold ${hold}`, detail: 'First time — hold as long as you can with good form' };
  }
}

/** Headline + detail for a suggestion (wording from the build contract). Increases name the exercise's step. */
function suggestionText(s, info, entry, unit, steps) {
  const fw = (w) => (w === 0 ? 'bodyweight' : formatWeight(w, unit));
  const reps = (item) => item.sets.map((x) => x.reps).join(', ');
  const inc = () => formatWeight(stepFor(entry.exerciseId, info.role, unit, steps), unit);
  if (info.timed && s.targetSeconds != null) return timedText(s, unit, inc);
  switch (s.action) {
    case 'set':
      return { headline: `Weight you set: ${fw(s.weight)}`, detail: 'Used for this session only' };
    case 'increase':
      return info.main
        ? { up: true, headline: `Add ${inc()} today → ${fw(s.weight)}`, detail: `Last time ${formatDateShort(s.last.date)}: ${fw(maxWeight(s.last))} × ${reps(s.last)}` }
        : { up: true, headline: `Add ${inc()} today → ${fw(s.weight)}`, detail: `Last time: every set at the top of ${rangeText(info.rx)}` };
    case 'repeat': {
      let detail;
      if (s.last.offDay) detail = 'Last time was an off day';
      else if (s.failStreak === MISSES_BEFORE_DELOAD - 1) detail = `${plural(s.failStreak, 'miss', 'misses')} in a row — one more and it's deload time`;
      else if (s.failStreak > 0) detail = `${plural(s.failStreak, 'miss', 'misses')} in a row`;
      else detail = `Last time ${formatDateShort(s.last.date)}: ${fw(maxWeight(s.last))} × ${reps(s.last)}`;
      return { headline: `Same weight: ${fw(s.weight)}`, detail };
    }
    case 'deload':
      return {
        headline: `Deload: take ${Math.round((1 - DELOAD_FACTOR) * 100)}% off → ${fw(s.weight)}`,
        detail: `${plural(s.failStreak, 'miss', 'misses')} in a row at ${fw(maxWeight(s.last))}`,
      };
    case 'start':
      if (info.main) return { headline: 'First time', detail: `Work up in sets of ${MAIN_REPS} until the bar slows, then take ${formatWeight(smallestIncrement(unit), unit)} off — that's your start.` };
      if (info.rx && info.rx.repsMin == null) return { headline: 'First time', detail: 'No rep target — do what you can with good form.' };
      return { headline: 'First time', detail: 'Pick a weight you can do about 10 times with good form.' };
    case 'keep': {
      const n = repsToGo(s.last, info.rx);
      return { headline: `Keep ${fw(s.weight)}`, detail: `Last time: ${reps(s.last)} — ${plural(n, 'rep')} to go before adding weight` };
    }
    case 'decrease':
      return { headline: `Go lighter → ${fw(s.weight)}`, detail: `Last time a set fell under ${info.rx.repsMin} reps` };
    default: // 'none': no rep target (abs) or an added exercise
      return { headline: 'Any reps', detail: info.extra && s.last ? `Last time ${formatDateShort(s.last.date)}: ${setsLong(s.last.sets, unit)}` : '' };
  }
}

/**
 * The main lift's warm-up checklist (§18.2): one checkbox per `warmupSets` row ("Warm-up 20 × 10, empty bar"), with
 * "N of M done". The ticks live in the draft and are never saved into the workout. Hidden when there is no ramp.
 */
function warmupMarkup(form, entry, unit, bar) {
  const lead = entry.sets[0] ? entry.sets[0].weight : null;
  const ramp = warmupSets(lead, unit, bar);
  const ticks = warmupTicks(form, entry, ramp.length);
  return html`<div class="warmlist" data-warm ${ramp.length ? '' : 'hidden'}>
    <p class="wl-title"><span>Warm-up</span><span class="muted" data-warm-count>${ticks.size} of ${ramp.length} done</span></p>
    ${ramp.map((w, i) => {
      const sets = `${formatNumber(w.weight)} × ${w.reps}`;
      const bareBar = i === 0; // warmupSets starts with the empty bar
      return html`<label class="wl-item${ticks.has(i) ? ' done' : ''}"><input type="checkbox" data-warm-i="${i}"
        aria-label="Warm-up ${sets}${bareBar ? ', empty bar' : ''}" ${ticks.has(i) ? 'checked' : ''}><span>${sets}</span>${bareBar ? html`<small>empty bar</small>` : ''}</label>`;
    })}
  </div>`;
}

// ---------------------------------------------------------------- timers (§19.2)

/** The superset pairs on the form as [aUid, bUid] (plan items found by their uid), when both cards are there. */
function formPairs(state, form) {
  if (!DAYS[form.day] || !Array.isArray(form.entries)) return [];
  const plan = dayPlan(state, form.day);
  const uidOf = new Map([...planIndex(plan)].map(([uid, it]) => [it, uid]));
  const uids = new Set(form.entries.map((e) => e.uid));
  return supersetPairs(plan).map(([a, b]) => [uidOf.get(a), uidOf.get(b)]).filter(([a, b]) => uids.has(a) && uids.has(b));
}

/**
 * What the timers need for one drawing: the running timer (new workouts only — an edit runs none), the superset
 * pairs, and while no timer runs the next set to do (it gets the "Start set N" button), counted from where the last
 * timer was.
 */
function timerScene(state, form, nowMs = Date.now()) {
  const pairs = formPairs(state, form);
  const timer = draftTimer(form, nowMs);
  return { nowMs, pairs, timer, todo: form.editingId || timer ? null : nextToDo(form.entries, pairs, ui.lastTimer) };
}

/** The role a rest box aims by: the exercise's, accessory for a superset's second exercise (its round rest). */
function restRoleOf(form, entry, pairs) {
  const pair = pairWith(pairs, entry.uid);
  return pair && pair[1] === entry.uid ? 'accessory' : roleOf(form.day, entry.exerciseId);
}

/** The rest box's Start button for a `nextAfter` target: {label, sub?, aria?, wide}, or null (nothing left). */
function startLabel(form, start) {
  const target = start && form.entries.find((e) => e.uid === start.uid);
  if (!target) return null;
  if (start.kind === 'set') return { label: `Start set ${start.set + 1}`, wide: false };
  if (start.kind === 'round') return { label: `Start round ${start.set + 1} · ${target.name}`, wide: true };
  return { label: 'Start next exercise', sub: target.name, aria: 'Start next exercise', wide: true };
}

/**
 * The muted line under a committed set: what was recorded — "set 0:38", "rest 2:41 · set 0:38" or "rest 2:41" — and on
 * a superset's first exercise where the round goes ("· then straight to Lateral raise"). Nothing when nothing was
 * recorded.
 */
function metaText(form, entry, i, pairs) {
  const set = entry.sets[i];
  if (!set || !(set.reps > 0)) return '';
  const parts = [];
  if (isRecordedRest(set.rest)) parts.push(`rest ${formatClock(set.rest)}`);
  if (isRecordedDuration(set.duration)) parts.push(`set ${formatClock(set.duration)}`);
  if (!parts.length) return '';
  const pair = pairWith(pairs, entry.uid);
  const partner = pair && pair[0] === entry.uid ? form.entries.find((e) => e.uid === pair[1]) : null;
  if (partner && partner.sets[i]) parts.push(`then straight to ${partner.name}`);
  return parts.join(' · ');
}

/** What sits under set row i of a card: the muted line, then the timer that belongs there or the row's Start button. */
function belowRow(form, entry, i, scene) {
  const meta = metaText(form, entry, i, scene.pairs);
  const out = [meta ? html`<p class="setmeta" data-below>${meta}</p>` : ''];
  const t = scene.timer;
  if (t && t.uid === entry.uid && t.set === i) {
    if (t.kind === 'set') {
      const before = entry.sets[i] && isRecordedRest(entry.sets[i].rest) ? entry.sets[i].rest : null;
      out.push(setTimerMarkup(t, scene.nowMs, before));
    } else {
      const pair = pairWith(scene.pairs, entry.uid);
      const start = startLabel(form, nextAfter(form.entries, scene.pairs, entry.uid, i, { auto: false }).start);
      out.push(restMarkup(t, restRoleOf(form, entry, scene.pairs), scene.nowMs, {
        start, wide: Boolean(start && start.wide), pair: Boolean(pair && pair[1] === entry.uid),
      }));
    }
  } else if (scene.todo && scene.todo.uid === entry.uid && scene.todo.set === i) {
    out.push(rowStartMarkup(i));
  }
  return out;
}

/** "⇣ superset — no rest in between" between a superset's two cards when they follow each other. */
function supersetLink(scene, entry, next) {
  const pair = pairWith(scene.pairs, entry.uid);
  return pair && next && pair[0] === entry.uid && pair[1] === next.uid
    ? html`<p class="ss-link"><span aria-hidden="true">⇣</span> superset — no rest in between</p>` : '';
}

/**
 * Scroll a card into view when it is not fully on screen above the tab bar: centred when it fits, else from its top.
 * @param {string} uid
 */
function bringIntoView(uid) {
  const sec = document.querySelector(`#view section[data-uid="${CSS.escape(uid)}"]`);
  if (!sec) return;
  const bar = document.querySelector('nav.tabbar');
  const bottom = bar ? bar.getBoundingClientRect().top : window.innerHeight;
  const r = sec.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= bottom) return;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  sec.scrollIntoView({ block: r.height <= bottom - 16 ? 'center' : 'start', behavior: reduce ? 'auto' : 'smooth' });
}

// ---------------------------------------------------------------- markup

/** Width (in characters) for a weight box, so the number and its unit sit centred together. */
const fitLen = (text) => Math.max(2, Math.min(7, String(text).length));

function setRow(c, set, i, unit) {
  const { entry, info } = c;
  const n = i + 1;
  const amrap = info.main && n === info.plannedSets;
  const seconds = info.timed;
  let repsHint = seconds ? String(c.s.targetSeconds ?? '') : 'reps';
  if (info.main) repsHint = amrap ? `${MAIN_REPS}+` : `${MAIN_REPS}`;
  else if (!seconds && info.rx && info.rx.repsMin != null) repsHint = rangeText(info.rx);
  const bad = (k) => (ui.bad.has(`${entry.uid}:${k}${i}`) ? 'true' : 'false');
  const weightText = set.weight == null ? '' : formatNumber(set.weight);
  return html`<div class="set-row" data-row="${i}">
    <span class="n">${n}${amrap ? html`<small>AMRAP</small>` : ''}</span>
    <label class="field"><input class="w" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next"
      aria-label="Set ${n} weight" aria-invalid="${bad('w')}" data-kind="w" data-set="${i}" data-fk="${entry.uid}:w${i}"
      value="${weightText}" placeholder="—" style="--len:${fitLen(weightText)}"><small>${unit}</small></label>
    <span class="x" aria-hidden="true">×</span>
    <label class="field reps${set.reps > 0 ? ' done' : ''}"><input class="r${seconds ? ' fit' : ''}" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next"
      aria-label="Set ${n} reps" aria-invalid="${bad('r')}" data-kind="r" data-set="${i}" data-fk="${entry.uid}:r${i}"
      value="${set.reps == null ? '' : String(set.reps)}" placeholder="${repsHint}"${seconds ? html` style="--len:${fitLen(set.reps == null ? repsHint : set.reps)}"` : ''}>${seconds ? html`<small>sec</small>` : ''}</label>
  </div>`;
}

function cardMarkup(c, state, form, scene) {
  const { entry, info, s } = c;
  const unit = state.settings.unit;
  const bar = state.settings.barWeight;
  const t = suggestionText(s, info, entry, unit, state.steps);
  const swap = info.swappable
    ? html`<button type="button" class="swap" data-act="swap" data-fk="${entry.uid}:swap">${icon('swap')}<span>Swap</span></button>` : '';
  if (!ui.opened.has(entry.uid)) {
    return html`<section class="card ex compact" aria-label="${entry.name}" data-uid="${entry.uid}" data-act="open-card">
      <div class="ex-head"><div class="ex-title">
        <h2 class="ex-name"><button type="button" class="ex-open" data-act="open-card" aria-expanded="false" data-fk="${entry.uid}:open">${entry.name}</button></h2>
        <p class="cap">${info.prescription} · <span class="suggest-headline">${t.headline}</span></p></div>${swap}</div>
    </section>`;
  }
  const lead = entry.sets[0] ? entry.sets[0].weight : null;
  const plates = info.plates ? platesText(lead, bar, unit) : '';
  const seconds = info.timed;
  return html`<section class="card ex" aria-label="${entry.name}" data-uid="${entry.uid}">
    <div class="ex-head">
      <div class="ex-title"><h2 class="ex-name">${entry.name}</h2>
        <p class="cap">${info.prescription} · rest ${info.rest}</p>
        ${info.superset ? html`<p class="cap superset">Superset with ${info.superset}</p>` : ''}</div>
      ${info.main ? html`<span class="pill main">Main lift · fixed</span>` : swap}
      ${info.extra ? html`<button type="button" class="swap" data-act="remove-ex" data-fk="${entry.uid}:remove" aria-label="Remove ${entry.name}">Remove</button>` : ''}
    </div>
    <div class="suggest${t.up ? ' up' : ''}">
      <div class="suggest-text"><b>${t.up ? icon('up') : ''}<span class="suggest-headline">${t.headline}</span></b>${t.detail ? html`<span>${t.detail}</span>` : ''}</div>
      <button type="button" class="link setw" data-act="setweight" data-fk="${entry.uid}:setw">Set weight</button>
    </div>
    ${info.main ? warmupMarkup(form, entry, unit, bar) : ''}
    <div class="sets">
      <div class="set-row head" aria-hidden="true"><span>Set</span><span>${WEIGHT_HEADS[info.equipment] || 'Weight'}</span><span></span><span>${seconds ? 'Seconds' : 'Reps'}</span></div>
      ${entry.sets.map((set, i) => html`${setRow(c, set, i, unit)}${belowRow(form, entry, i, scene)}`)}
    </div>
    ${info.plates ? html`<p class="plates" data-plates ${plates ? '' : 'hidden'}>${plates}</p>` : ''}
    ${info.equipment === 'bodyweight' ? html`<p class="hint">Added weight: 0 = bodyweight only.</p>` : ''}
    ${info.main ? html`<p class="hint">AMRAP = as many good-form reps as you can.</p>` : ''}
    <div class="set-actions">
      <button type="button" class="link" data-act="add-set" data-fk="${entry.uid}:add" ${entry.sets.length >= MAX_SETS ? 'disabled' : ''}>+ Set</button>
      <button type="button" class="link muted-link" data-act="remove-set" data-fk="${entry.uid}:remove-set" ${entry.sets.length <= 1 ? 'disabled' : ''}>− Set</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- screen

/** The backup reminder ("Last backup: … — Export now") when there are workouts and no backup in 7 days. */
function backupBanner(state, today) {
  const last = state.settings.lastBackupAt;
  if (!state.sessions.length || (last && daysBetween(last, today) < BACKUP_DAYS)) return '';
  return html`<div class="banner"><span>Last backup: ${last ? formatDate(last) : 'never'}</span>
      <button type="button" class="link" data-act="export-now">Export now</button></div>`;
}

/** "Thu 05/11" */
const shortDay = (iso) => `${weekdayShort(iso)} ${formatDateShort(iso)}`;

/**
 * The line under the heading (§18.3): once the workout is started "Started 18:42 · 23 min so far" ("Started 18:42"
 * alone for a start from an earlier sitting, see `liveStart`); before that "Last workout: Tue 18/11 at 19:41" (the
 * time it was saved), without a time for a workout logged before times existed, and nothing with no history.
 * Nothing while editing a saved workout.
 */
function timelineMarkup(state, form) {
  if (form.editingId) return '';
  if (isValidLocalTime(form.startedAt)) {
    if (!liveStart(form)) return html`Started <b>${formatTime(form.startedAt)}</b>`;
    const soFar = formatDuration(minutesBetween(form.startedAt, nowLocal()));
    return html`Started <b>${formatTime(form.startedAt)}</b> · ${soFar} so far`;
  }
  const sorted = sortByDate(state.sessions);
  const last = sorted[sorted.length - 1];
  if (!last) return '';
  const done = isValidLocalTime(last.finishedAt) ? last.finishedAt : null;
  if (!done) return html`Last workout: ${shortDay(last.date)}`;
  if (localDate(done) === last.date) return html`Last workout: ${shortDay(last.date)} at ${formatTime(done)}`;
  return html`Last workout: ${shortDay(last.date)}, saved ${shortDay(localDate(done))} at ${formatTime(done)}`;
}

/** The running rest timer of the stored draft and the role it aims by, or null (a set timer never beeps). */
function draftRest(state) {
  const d = state.draft;
  const timer = d && Array.isArray(d.entries) ? draftTimer(d, Date.now()) : null;
  const entry = timer && timer.kind === 'rest' && d.entries.find((e) => e && e.uid === timer.uid);
  return entry ? { rest: timer, role: restRoleOf(d, entry, formPairs(state, d)) } : null;
}

/**
 * The rest became ready just now (seen resting on the previous tick): one beep if the sound is on, and the card
 * flashes once if it is on screen. A rest that was already up when the app was opened again stays quiet.
 */
function watchRest(ctx) {
  const found = draftRest(ctx.state);
  if (!found) { ui.restSeen = { key: '', phase: '' }; return; }
  const { rest, role } = found;
  const v = restView(rest, role, Date.now());
  const key = `${rest.uid}:${rest.set}:${rest.startedAt}`;
  if (ui.restSeen.key === key && ui.restSeen.phase === 'resting' && v.phase === 'ready' && v.elapsed - v.target < READY_FRESH_S) {
    if (ctx.state.settings.restSound !== false) beep();
    const sec = document.querySelector(`#view section[data-uid="${CSS.escape(rest.uid)}"]`);
    if (sec) { sec.classList.add('flash'); setTimeout(() => sec.classList.remove('flash'), FLASH_MS); }
  }
  ui.restSeen = { key, phase: v.phase };
}

/** Start the app-wide tick (once) and make `onTick` the Today screen's per-second update while `root` is on show. */
function tickWhileShown(ctx, root, onTick) {
  beat.ctx = ctx;
  beat.screen = { root, onTick };
  if (beat.timer) return;
  beat.timer = setInterval(() => {
    watchRest(beat.ctx);
    const screen = beat.screen;
    if (screen && screen.root.isConnected) screen.onTick();
  }, TICK_MS);
}

/**
 * "Done for today ✓" (§18.4): today's workouts (times, exercises, new bests, Edit) and "Up next", whose button starts
 * the next workout now (a double day). Redraws at midnight, when the next workout takes over.
 */
function renderDone(root, ctx, today) {
  const state = ctx.state;
  const unit = state.settings.unit;
  const positions = historyPositions(state.sessions);
  const bests = bestsBySession(state.sessions);
  const cards = state.sessions.filter((s) => s.date === today).map((s) => ({ s, pos: positions.get(s.id), bests: bests.get(s.id) || [] }));
  const next = nextWorkout(state.sessions);
  // The next workout as it will open tomorrow: its main lift with the suggested weight, then the other exercises.
  const preview = freshForm(state, { date: addDays(today, 1), day: next.dayId });
  const names = preview.entries.map((e, i) => {
    const w = i === 0 && e.sets[0] ? e.sets[0].weight : null;
    return w == null ? e.name : `${e.name} ${formatWeight(w, unit)}`;
  });
  setHTML(root, doneMarkup({
    today, unit, banner: backupBanner(state, today), cards, next: { position: next.position, dayId: next.dayId, line: names.join(' · ') },
  }));
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'start-next') {
      ctx.commit({ ...ctx.state, settings: { ...ctx.state.settings, startNextOn: today } }, { keepScroll: false });
    } else if (b.dataset.act === 'edit-done') {
      editSession(ctx, b.dataset.id);
    } else if (b.dataset.act === 'export-now') {
      ctx.go('data');
    }
  });
  tickWhileShown(ctx, root, () => { if (ctx.today() !== today) ctx.render({ keepScroll: false }); });
}

/**
 * Draw the Today screen into `root` (a fresh element per render).
 * @param {HTMLElement} root
 * @param {object} ctx app context
 */
export function renderToday(root, ctx) {
  watchTaps();
  const today = ctx.today();
  if (isDoneForToday(ctx.state, today)) { renderDone(root, ctx, today); return; }
  const state = ctx.state;
  const unit = state.settings.unit;
  const form = currentForm(ctx);
  const formId = `${form.editingId || 'new'}|${form.date}|${form.day}`;
  if (formId !== ui.formId) { ui.formId = formId; ui.opened = new Set(); ui.bad.clear(); ui.committed = ''; ui.lastTimer = null; }
  let cards = cardsFor(state, form);
  const scene = timerScene(state, form);
  updateOpen(cards, scene);
  const editing = Boolean(form.editingId);
  const timeline = timelineMarkup(state, form);

  setHTML(root, html`<div class="screen today">
    <header class="today-head">
      <div class="kicker"><span>${weekdayShort(form.date)} ${formatDate(form.date)}</span>
        <button type="button" class="link" data-act="change-date" data-fk="change-date" aria-expanded="${ui.dateOpen}">Change date</button></div>
      <div class="date-row" ${ui.dateOpen ? '' : 'hidden'}>
        <label for="workout-date">Workout date</label>
        <input id="workout-date" class="text-input date-input" type="date" value="${form.date}" data-input="date">
      </div>
      <h1 class="big">Day ${positionOf(state, form)} of 6 · ${dayName(form.day)}</h1>
      <p class="timeline" data-timeline ${timeline ? '' : 'hidden'}>${timeline}</p>
      ${editing ? '' : html`<button type="button" class="start-workout" data-act="start-workout" data-fk="start-workout" ${canStart(ctx, form) ? '' : 'hidden'}><span class="go" aria-hidden="true">▶</span> Start workout</button>`}
      <div class="picker" data-act="pick-day"><span>Doing a different workout?</span>
        <button type="button" class="link" data-act="pick-day" data-fk="pick-day" aria-haspopup="dialog">Change<span aria-hidden="true"> ▾</span></button></div>
    </header>
    ${editing ? html`<div class="banner edit"><span>Editing ${formatDate(form.date)} · ${dayName(form.day)}</span>
      <button type="button" class="link" data-act="cancel-edit">Cancel edit</button></div>` : ''}
    ${backupBanner(state, today)}
    <label class="toggle-row"><span><b>Off day</b><span class="muted">Bad sleep or food — misses won't count</span></span>
      <input type="checkbox" class="switch" role="switch" aria-label="Off day" data-input="offday" ${form.offDay ? 'checked' : ''}></label>
    <div class="cards">${cards.map((c, k) => html`${cardMarkup(c, state, form, scene)}${supersetLink(scene, c.entry, cards[k + 1] && cards[k + 1].entry)}`)}</div>
    <button type="button" class="add" data-act="add-ex" data-fk="add-ex">+ Add exercise</button>
    <label class="note-field"><span>Note</span>
      <textarea rows="2" aria-label="Note" data-input="note" placeholder="Optional — e.g. slept badly">${form.note || ''}</textarea></label>
    <div class="save-wrap"><button type="button" class="save" data-act="save">Save workout</button><span>Saved as a draft while you go</span></div>
  </div>`);

  // ------------------------------------------------ helpers bound to this render

  /** Keep the draft: the first change turns the on-screen form into the saved draft. */
  const changed = () => {
    if (ctx.state.draft !== form) ctx.setState({ ...ctx.state, draft: form });
    ctx.saveSoon();
  };
  const cardOf = (el) => {
    const sec = el.closest('section[data-uid]');
    const entry = sec && form.entries.find((e) => e.uid === sec.dataset.uid);
    return entry ? { sec, entry } : null;
  };
  /** Redraw one card in place (focus elsewhere is untouched). */
  const redrawCard = (entry) => {
    const sec = root.querySelector(`section[data-uid="${CSS.escape(entry.uid)}"]`);
    if (!sec) return;
    const key = focusKey();
    cards = cardsFor(ctx.state, form);
    const c = cards.find((x) => x.entry === entry);
    const tpl = document.createElement('template');
    setHTML(tpl, cardMarkup(c, ctx.state, form, timerScene(ctx.state, form)));
    sec.replaceWith(tpl.content);
    restoreFocus(root, key);
  };
  /** Open any card the opening rule now asks for (after reps are typed). */
  const openMore = () => {
    const before = new Set(ui.opened);
    updateOpen(cardsFor(ctx.state, form), timerScene(ctx.state, form));
    for (const e of form.entries) if (ui.opened.has(e.uid) && !before.has(e.uid)) redrawCard(e);
  };
  /** The line under the heading, brought up to date, and the Start workout button shown only until the workout starts. */
  const updateTimeline = () => {
    const el = root.querySelector('[data-timeline]');
    if (!el) return;
    const markup = timelineMarkup(ctx.state, form);
    el.hidden = !markup;
    setHTML(el, markup);
    const start = root.querySelector('[data-act="start-workout"]');
    if (start) start.hidden = !canStart(ctx, form);
  };
  /**
   * The workout starts on a tap of Start workout (§20.1), or failing that (§18.3; owner 24/11/2026) at the first
   * warm-up tick, the first Start tap or the first reps typed, whichever comes first, so the warm-up and the first set
   * are inside the workout. Only a new workout logged on its own date (`canStart`: one typed in later for another day
   * gets no clock times — they would say when it was typed, not when it was done); a start from an earlier sitting
   * (`liveStart`: more than 4 hours ago, a draft from before the update, a date changed back to today) starts the clock
   * again.
   */
  const startClock = () => {
    if (!canStart(ctx, form)) return;
    form.startedAt = nowLocal();
    updateTimeline();
  };

  // ------------------------------------------------ rest and set timers (§18.1, §19.2)

  /**
   * Redraw what sits under every set row (muted lines, the timer, the "Start set N" button) for the current state,
   * opening the card that holds the timer or the button first.
   */
  const placeTimers = () => {
    const scene = timerScene(ctx.state, form);
    const holder = scene.timer || scene.todo;
    const shut = holder && !ui.opened.has(holder.uid) && form.entries.find((x) => x.uid === holder.uid);
    if (shut) { ui.opened.add(shut.uid); redrawCard(shut); }
    for (const old of root.querySelectorAll('[data-below]')) old.remove();
    for (const sec of root.querySelectorAll('section[data-uid]')) {
      const entry = form.entries.find((e) => e.uid === sec.dataset.uid);
      if (!entry) continue;
      for (const row of sec.querySelectorAll('.set-row[data-row]')) {
        const tpl = document.createElement('template');
        setHTML(tpl, belowRow(form, entry, Number(row.dataset.row), scene));
        row.after(tpl.content);
      }
    }
  };
  /** Bring the drawn timer's clock (and the rest box's bar and phase) up to date; a timer past 4 hours goes. */
  const tickTimers = () => {
    if (form.editingId || !form.timer) return;
    const now = Date.now();
    const timer = usableTimer(form.timer, now);
    if (!timer) {
      noteTimer();
      delete form.timer;
      if (ctx.state.draft === form) changed();
      placeTimers();
      return;
    }
    const el = root.querySelector('[data-timer]');
    const entry = form.entries.find((x) => x.uid === timer.uid);
    if (!el || !entry) return;
    if (timer.kind === 'set') { updateSetTimer(el, timer, now); return; }
    const pairs = formPairs(ctx.state, form);
    const pair = pairWith(pairs, entry.uid);
    updateRest(el, timer, restRoleOf(form, entry, pairs), now, { pair: Boolean(pair && pair[1] === entry.uid) });
  };
  /** A timer button tap that may be the same tap that just made the timer appear (see TIMER_TAP_GUARD_MS). */
  const tooSoon = () => Date.now() - ui.timerMovedAt < TIMER_TAP_GUARD_MS;
  /** Remember where the timer is (or was): once it goes, the "Start set N" button carries on from there. */
  const noteTimer = () => { if (form.timer) ui.lastTimer = { uid: form.timer.uid, set: form.timer.set }; };
  /**
   * Start the set timer of set `i` of entry `uid` (a Start button), recording `rest` on that set first (null: none, as
   * for the row's "Start set N"). A target in another card opens and comes into view.
   */
  const startSet = (uid, i, rest) => {
    const entry = form.entries.find((x) => x.uid === uid);
    if (!entry || !entry.sets[i]) return;
    const now = Date.now();
    const from = form.timer ? form.timer.uid : uid;
    if (rest != null) entry.sets[i].rest = rest;
    form.timer = { kind: 'set', uid, set: i, startedAt: now };
    noteTimer();
    ui.timerMovedAt = now;
    startClock();
    changed();
    placeTimers(); // opens the target's card
    if (from !== uid) bringIntoView(uid);
  };
  /**
   * A reps box was committed (change / Enter / leaving it) with a valid number (§19.2): a set timer running for that set
   * records its time; then on a superset's first exercise the partner's set starts by itself (its card opens and comes
   * into view), else a rest timer starts under the set. Only a new set does this — one whose box was empty before it
   * was typed in: committing the same value again (Enter, then leaving the box) or correcting a set that already had
   * reps leaves the timers as they are.
   */
  const commitReps = (input) => {
    const hit = cardOf(input);
    if (!hit) return;
    openMore();
    if (form.editingId) return; // correcting a saved workout from History: nobody is resting
    const i = Number(input.dataset.set);
    const set = hit.entry.sets[i];
    if (!set || !(set.reps > 0)) return;
    const key = `${hit.entry.uid}:${i}`;
    const mark = `${key}:${set.reps}`;
    if (ui.committed === mark) return;
    ui.committed = mark;
    const fresh = ui.typing.key === key && !(ui.typing.from > 0);
    ui.typing = { key: '', from: null };
    if (!fresh) return;
    const now = Date.now();
    const running = usableTimer(form.timer, now);
    if (running && running.kind === 'set' && running.uid === hit.entry.uid && running.set === i) {
      const took = setTaken(running, now);
      if (took != null) set.duration = took;
    }
    const next = nextAfter(form.entries, formPairs(ctx.state, form), hit.entry.uid, i);
    form.timer = next.auto
      ? { kind: 'set', uid: next.auto.uid, set: next.auto.set, startedAt: now }
      : { kind: 'rest', uid: hit.entry.uid, set: i, startedAt: now, extra: 0 };
    noteTimer();
    ui.timerMovedAt = now;
    if (ctx.state.settings.restSound !== false) unlockSound();
    changed();
    afterTap(() => {
      if (!root.isConnected) return;
      placeTimers(); // opens the partner's card when its set started by itself
      if (next.auto) bringIntoView(next.auto.uid);
    });
  };

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.input === 'note') { form.note = t.value; changed(); return; }
    const kind = t.dataset.kind;
    const hit = kind && cardOf(t);
    if (!hit) return;
    const i = Number(t.dataset.set);
    const set = hit.entry.sets[i];
    const text = t.value.trim();
    if (kind === 'w') {
      const before = set.weight;
      const w = parseWeightInput(text);
      const bad = text !== '' && w == null;
      t.setAttribute('aria-invalid', String(bad));
      ui.bad[bad ? 'add' : 'delete'](`${hit.entry.uid}:w${i}`);
      set.weight = bad ? null : w;
      set.touched = true;
      t.style.setProperty('--len', String(fitLen(t.value)));
      if (i === 0) {
        hit.entry.sets.forEach((other, j) => {
          if (j === 0 || other.touched) return;
          other.weight = set.weight;
          const input = hit.sec.querySelector(`input[data-kind="w"][data-set="${j}"]`);
          if (input) {
            input.value = set.weight == null ? '' : formatNumber(set.weight);
            input.style.setProperty('--len', String(fitLen(input.value)));
          }
        });
        const warm = hit.sec.querySelector('[data-warm]');
        const bar = ctx.state.settings.barWeight;
        if (warm && JSON.stringify(warmupSets(before, unit, bar)) !== JSON.stringify(warmupSets(set.weight, unit, bar))) {
          clearWarmupTicks(form, hit.entry); // a new work weight is a new warm-up list (§18.2)
          const tpl = document.createElement('template');
          setHTML(tpl, warmupMarkup(form, hit.entry, unit, bar));
          warm.replaceWith(tpl.content);
        }
        const plates = hit.sec.querySelector('[data-plates]');
        if (plates) {
          const textNow = platesText(set.weight, ctx.state.settings.barWeight, unit);
          plates.hidden = !textNow;
          plates.textContent = textNow;
        }
      }
    } else {
      const reps = /^\d{1,4}$/.test(text) ? Number(text) : null;
      const bad = text !== '' && reps == null;
      t.setAttribute('aria-invalid', String(bad));
      ui.bad[bad ? 'add' : 'delete'](`${hit.entry.uid}:r${i}`);
      const key = `${hit.entry.uid}:${i}`;
      if (ui.typing.key !== key) ui.typing = { key, from: set.reps }; // what the box held before this typing (commitReps)
      set.reps = reps;
      if (reps > 0) startClock(); // the first reps start the workout, unless a Start tap already did (§18.3)
      t.closest('.field').classList.toggle('done', reps > 0);
      if (t.classList.contains('fit')) t.style.setProperty('--len', String(fitLen(t.value || t.placeholder)));
    }
    changed();
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.input === 'offday') { form.offDay = t.checked; changed(); return; }
    if (t.dataset.input === 'date') {
      if (!isValidISO(t.value) || t.value === form.date) return;
      form.date = t.value;
      form.dateChosen = true;
      if (!form.editingId) delete form.startedAt; // a start time belongs to the date it was typed on
      ui.dateOpen = false;
      prefill(ctx.state, form);
      changed();
      ctx.render();
      return;
    }
    if (t.dataset.kind === 'r') { commitReps(t); return; }
    if (t.dataset.warmI != null) {
      const hit = cardOf(t);
      if (!hit) return;
      const ticks = warmupTicks(form, hit.entry, Infinity);
      if (t.checked) {
        ticks.add(Number(t.dataset.warmI));
        startClock(); // the first warm-up tick starts the workout (owner 24/11/2026)
      } else ticks.delete(Number(t.dataset.warmI));
      form.warmup = { ...(form.warmup || {}), [hit.entry.uid]: [...ticks].sort((a, b) => a - b) };
      t.closest('.wl-item').classList.toggle('done', t.checked);
      const count = hit.sec.querySelector('[data-warm-count]');
      if (count) count.textContent = `${hit.sec.querySelectorAll('[data-warm-i]:checked').length} of ${hit.sec.querySelectorAll('[data-warm-i]').length} done`;
      changed();
    }
  });

  // Enter commits a reps box too (a lone text box gets no "change" on Enter).
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.kind === 'r') commitReps(e.target);
  });

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    const hit = cardOf(el);
    switch (act) {
      case 'change-date': {
        ui.dateOpen = !ui.dateOpen;
        el.setAttribute('aria-expanded', String(ui.dateOpen));
        const row = root.querySelector('.date-row');
        row.hidden = !ui.dateOpen;
        if (ui.dateOpen) {
          const input = row.querySelector('input');
          input.focus({ preventScroll: true });
          try { if (typeof input.showPicker === 'function') input.showPicker(); } catch { /* not allowed here: the field is still shown */ }
        }
        break;
      }
      case 'pick-day': openDayPicker(ctx, form, changed); break;
      case 'start-workout': // §20.1: the start on purpose; saved now, so a reload keeps it even with no reps
        if (!canStart(ctx, form)) break;
        startClock();
        changed();
        ctx.saveNow();
        break;
      case 'cancel-edit': ctx.commit({ ...ctx.state, draft: null }); break;
      case 'export-now': ctx.go('data'); break;
      case 'open-card':
        if (hit && !ui.opened.has(hit.entry.uid)) { ui.opened.add(hit.entry.uid); redrawCard(hit.entry); }
        break;
      case 'swap':
        if (hit) {
          openSwapSheet(ctx, hit.entry.slotKey, {
            onPicked: (slotKey) => {
              if (ctx.state.draft !== form) return; // an untouched form is rebuilt from the new plan anyway
              replaceSlot(ctx.state, form, slotKey);
              ctx.saveSoon();
            },
          });
        }
        break;
      case 'setweight':
        if (hit) {
          const plan = dayPlan(ctx.state, form.day);
          const info = entryInfo(form, hit.entry, plan, planIndex(plan));
          openSetWeightSheet(ctx, {
            exerciseId: hit.entry.exerciseId, name: trackName(hit.entry.name, info.occurrence, info.superset), role: info.role, occurrence: info.occurrence,
            // A new step changes every card of this exercise, so all untyped weights follow the new suggestions.
            onSaved: () => { if (ctx.state.draft === form) { prefill(ctx.state, form); ctx.saveSoon(); } },
          });
        }
        break;
      case 'add-set':
        if (hit && hit.entry.sets.length < MAX_SETS) {
          const prev = hit.entry.sets[hit.entry.sets.length - 1];
          hit.entry.sets.push({ weight: prev ? prev.weight : null, reps: null, touched: Boolean(prev && prev.touched) });
          changed();
          redrawCard(hit.entry);
          placeTimers(); // a rest box elsewhere may now point at the new set
        }
        break;
      case 'remove-set':
        if (hit && hit.entry.sets.length > 1) {
          hit.entry.sets.pop();
          // The timer of the removed set goes with it (it would stay hidden, and a rest would still beep).
          if (form.timer && form.timer.uid === hit.entry.uid && form.timer.set >= hit.entry.sets.length) delete form.timer;
          changed();
          redrawCard(hit.entry);
          placeTimers();
        }
        break;
      case 'remove-ex':
        if (hit) {
          form.entries = form.entries.filter((x) => x !== hit.entry);
          changed();
          ctx.render();
        }
        break;
      case 'add-ex': openAddExercise(ctx, form, changed); break;
      case 'save': saveWorkout(ctx, form); break;
      case 'rest-more':
        if (form.timer && form.timer.kind === 'rest' && !tooSoon()) {
          form.timer = { ...form.timer, extra: (form.timer.extra || 0) + REST_MORE_SECONDS };
          changed();
          tickTimers();
        }
        break;
      case 'rest-skip': // no rest recorded; the next set to do gets its "Start set N" button
      case 'set-cancel': // no set time recorded; a rest already recorded on the set stays
        if (form.timer && !tooSoon()) {
          noteTimer(); // the button carries on from here (also for a timer restored by a reload)
          delete form.timer;
          changed();
          placeTimers();
        }
        break;
      case 'timer-start': {
        const timer = usableTimer(form.timer, Date.now());
        if (!timer || timer.kind !== 'rest' || tooSoon()) break;
        const { start } = nextAfter(form.entries, formPairs(ctx.state, form), timer.uid, timer.set, { auto: false });
        if (start) startSet(start.uid, start.set, start.recordsRest ? restTaken(timer, Date.now()) : null); // never on a superset's b (§19.1)
        break;
      }
      case 'row-start':
        if (hit && !form.editingId && !usableTimer(form.timer, Date.now())) {
          const target = nextToDo(form.entries, formPairs(ctx.state, form), ui.lastTimer); // the one set showing the button
          if (target && target.uid === hit.entry.uid) startSet(target.uid, target.set, null);
        }
        break;
      default: break;
    }
  });

  let minute = nowLocal();
  tickWhileShown(ctx, root, () => {
    // After midnight an untouched form, or a draft not started yet (`movesToToday`), belongs to the new day (and "Done
    // for today" may be over): redraw, so its date, Start workout (§20.1) and the start rule follow the new day.
    const draft = ctx.state.draft;
    if (ctx.today() !== today && (!draft || (draft === form && movesToToday(form, ctx.today())))) { ctx.render(); return; }
    tickTimers();
    if (nowLocal() !== minute) { minute = nowLocal(); updateTimeline(); } // "N min so far"
  });
}

/** After a swap: the slot's entries become the new pick (its sets start again). */
function replaceSlot(state, form, slotKey) {
  const plan = dayPlan(state, form.day);
  const fresh = [...planIndex(plan)].filter(([, it]) => it.slotKey === slotKey)
    .map(([uid, it]) => ({ uid, slotKey, exerciseId: it.exerciseId, name: it.name, sets: Array.from({ length: it.sets }, blankSet) }));
  const at = form.entries.findIndex((e) => e.slotKey === slotKey);
  if (at < 0 || !fresh.length) return;
  form.entries = [...form.entries.slice(0, at), ...fresh, ...form.entries.slice(at).filter((e) => e.slotKey !== slotKey)];
  if (form.timer && fresh.some((e) => e.uid === form.timer.uid)) delete form.timer; // its sets started again
  for (const e of fresh) { ui.opened.delete(e.uid); prefill(state, form, e); }
}

// ---------------------------------------------------------------- sheets

function openDayPicker(ctx, form, changed) {
  const state = ctx.state;
  const current = positionOf(state, form);
  const { el, close } = openSheet({
    title: 'Choose the workout',
    body: html`<p class="cap">The cycle carries on from whatever you log.</p>
      <div class="opts">${ROTATION.map((day, i) => {
        const on = form.day === day && (day !== 'legs' || current === i + 1);
        return html`<button type="button" class="opt${on ? ' selected' : ''}" data-day="${day}" aria-pressed="${on}">
          <span>Day ${i + 1} · ${dayName(day)}</span>${on ? icon('check', 'check') : html`<span class="muted">${EXERCISES[DAYS[day].main].name}</span>`}</button>`;
      })}</div>
      <button type="button" class="btn wide" data-act="cancel">Cancel</button>`,
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'cancel') { close(); return; }
    const day = b.dataset.day;
    if (!day) return;
    close();
    if (day === form.day) return;
    if (form.editingId) {
      form.day = day;
      changed();
      ctx.render();
      return;
    }
    if (form.entries.some(hasReps)) {
      const ok = await confirmSheet({
        title: `Switch to ${dayName(day)}?`,
        message: 'The reps you typed for this workout will be cleared.',
        confirmLabel: 'Switch',
      });
      if (!ok) return;
    }
    const next = freshForm(ctx.state, { date: form.date, day, offDay: form.offDay, note: form.note, dateChosen: form.dateChosen });
    if (liveStart(form)) next.startedAt = form.startedAt; // a started workout stays started (§20.1: nothing moves the start)
    ctx.setState({ ...ctx.state, draft: next });
    ctx.saveSoon();
    ctx.render({ keepScroll: false });
  });
}

const GROUP_LABELS = [['pull', 'Pull'], ['push', 'Push'], ['legs', 'Legs'], ['abs', 'Abs']];

/**
 * What the Add exercise box adds for typed text (§17.5): a catalog name or alias → that exercise; else the single
 * exercise the search still shows; else the text as the user's own exercise. Empty → null.
 * @param {string} text
 * @returns {{exerciseId: string, name: string, custom: boolean}|null}
 */
function typedExercise(text) {
  const name = String(text || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const id = matchExercise(name);
  const found = id ? [id] : searchExercises(name);
  if (found.length === 1) return { exerciseId: found[0], name: EXERCISES[found[0]].name, custom: false };
  return { exerciseId: customId(name), name, custom: true };
}

/** Scroll a just-added card to the middle of the screen and highlight it briefly. */
function revealCard(uid) {
  const sec = document.querySelector(`#view section[data-uid="${CSS.escape(uid)}"]`);
  if (!sec) return;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  sec.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  sec.classList.add('flash');
  setTimeout(() => sec.classList.remove('flash'), FLASH_MS);
}

/**
 * Add exercise sheet (§17.5). The search box is not focused when the sheet opens (on the iPhone the keyboard would
 * cover the list); typing filters the list; Enter / Go adds what `typedExercise` finds; an empty box adds nothing.
 * Option rows answer the first tap even while the search box has focus.
 */
function openAddExercise(ctx, form, changed) {
  const all = Object.values(EXERCISES);
  const { el, close } = openSheet({
    title: 'Add exercise',
    className: 'tall',
    body: html`<form class="add-form">
        <label class="field-label" for="add-ex-name">Exercise name</label>
        <div class="row-input"><input id="add-ex-name" class="text-input" type="text" autocomplete="off" autocapitalize="sentences" maxlength="60"
          enterkeyhint="go" placeholder="Search, or type your own"><button type="submit" class="btn primary" disabled>Add</button></div>
        <p class="cap add-hint" hidden></p>
      </form>
      <div class="opts pick-list">${GROUP_LABELS.map(([g, label]) => html`<div class="pick-group"><p class="group-label">${label}</p>
        ${all.filter((x) => x.group === g).map((x) => html`<button type="button" class="opt" data-ex="${x.id}"><span>${x.name}</span></button>`)}</div>`)}
        <p class="cap no-match" hidden>No match in the list — Add saves it as your own exercise.</p></div>
      <button type="button" class="btn wide" data-act="cancel">Cancel</button>`,
  });
  const add = (exerciseId, name) => {
    close();
    form.extraCount = (form.extraCount || 0) + 1;
    const entry = { uid: `x${form.extraCount}`, slotKey: null, exerciseId, name, sets: Array.from({ length: EXTRA_SETS }, blankSet) };
    form.entries.push(entry);
    prefill(ctx.state, form, entry);
    ui.opened.add(entry.uid);
    changed();
    ctx.render();
    revealCard(entry.uid);
    toast(`Added ${name}`);
  };
  const input = el.querySelector('input');
  const submit = el.querySelector('button[type="submit"]');
  const hint = el.querySelector('.add-hint');
  input.addEventListener('input', () => {
    const shown = new Set(searchExercises(input.value));
    for (const b of el.querySelectorAll('[data-ex]')) b.hidden = !shown.has(b.dataset.ex);
    for (const g of el.querySelectorAll('.pick-group')) g.hidden = !g.querySelector('[data-ex]:not([hidden])');
    el.querySelector('.no-match').hidden = shown.size > 0;
    const pick = typedExercise(input.value);
    submit.disabled = !pick;
    hint.hidden = !pick;
    hint.textContent = pick ? `Add (or Enter) adds ${pick.custom ? `“${pick.name}” as your own exercise` : pick.name}` : '';
  });
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const pick = typedExercise(input.value);
    if (pick) add(pick.exerciseId, pick.name);
  });
  keepFocusOnTap(el.querySelector('.pick-list'));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'cancel') close();
    if (b.dataset.ex) add(b.dataset.ex, EXERCISES[b.dataset.ex].name);
  });
}

// ---------------------------------------------------------------- save / edit

/**
 * The session a form saves: only sets with reps > 0, no empty entries. Times (§18.3): a new workout keeps the time of
 * its first reps and finishes now — if it was started, or is saved, on its own date (one typed in later for another
 * day gets none). A start from an earlier sitting (`liveStart`: a draft left overnight) is kept without a finish: the
 * save time is not when that workout ended. An edited one keeps the times it had. Each set keeps its recorded rest
 * and set time (§19.1). Warm-up ticks and the timer stay behind.
 */
function sessionFrom(form, today) {
  const entries = [];
  for (const e of form.entries) {
    const sets = e.sets.filter((s) => s.reps > 0).map((s) => loggedSet(s.weight ?? 0, s.reps, s));
    if (!sets.length) continue;
    entries.push(isCustom(e.exerciseId) ? { exerciseId: e.exerciseId, name: e.name, sets } : { exerciseId: e.exerciseId, sets });
  }
  const session = { date: form.date, day: form.day, offDay: Boolean(form.offDay), note: String(form.note || '').trim(), entries };
  if (isValidLocalTime(form.startedAt)) session.startedAt = form.startedAt;
  if (form.editingId) {
    if (isValidLocalTime(form.finishedAt)) session.finishedAt = form.finishedAt;
  } else if (session.startedAt ? liveStart(form) : form.date === today) {
    session.finishedAt = nowLocal();
  }
  return session;
}

/** After saving a new workout: the "Workout saved" sheet with its new bests and what comes next (§18.5). */
function showSaved(ctx, session) {
  const state = ctx.state;
  const saved = state.sessions.find((s) => sessionKey(s) === sessionKey(session));
  if (!saved) return;
  const next = nextWorkout(state.sessions);
  openSavedSheet({
    session: saved,
    bests: bestsBySession(state.sessions).get(saved.id) || [],
    unit: state.settings.unit,
    next: { position: next.position, dayId: next.dayId },
    fromTomorrow: saved.date === ctx.today(),
  });
}

async function saveWorkout(ctx, form) {
  const firstBad = [...ui.bad][0];
  if (firstBad) {
    toast('Fix the highlighted box first — numbers only, like 62.5');
    const el = document.querySelector(`[data-fk="${CSS.escape(firstBad)}"]`);
    if (el) el.focus();
    return;
  }
  const session = sessionFrom(form, ctx.today());
  if (!session.entries.length) {
    if (Date.now() - ui.savedAt < SAVE_REPEAT_MS) return;
    toast('Nothing to save yet — type the reps you did');
    return;
  }
  const others = form.editingId ? deleteSession(ctx.state.sessions, form.editingId) : ctx.state.sessions;
  const clash = others.find((s) => sessionKey(s) === sessionKey(session));
  if (clash) {
    const ok = await confirmSheet({
      title: 'Replace saved workout?',
      message: `${dayName(session.day)} on ${formatDate(session.date)} is already saved. Saving replaces it with this one.`,
      confirmLabel: 'Replace',
    });
    if (!ok) return;
  }
  // An edit keeps its id and its place among workouts on the same date (the cycle order must not change).
  const sessions = form.editingId
    ? replaceSession(ctx.state.sessions, form.editingId, session)
    : mergeSessions(others, [session]).sessions;
  let next = { ...ctx.state, sessions, draft: null };
  if (!form.editingId) {
    next = consumeBaselines(next, session);
    // A double day (§18.4) ends with its save: Today shows "Done for today ✓" with both workouts again.
    if ('startNextOn' in next.settings) {
      const settings = { ...next.settings };
      delete settings.startNextOn;
      next = { ...next, settings };
    }
  }
  ui.formId = '';
  ui.savedAt = Date.now();
  // Storage full: the workout stays in memory (an export still has it) and only "Couldn't save … export a backup now"
  // shows — never "Saved" or the "Workout saved" sheet for a workout that is not on the phone.
  if (!ctx.commit(next, { keepScroll: false })) return;
  ctx.afterSave();
  toast(`Saved ${dayName(session.day)} · ${formatDate(session.date)}`);
  if (!form.editingId) showSaved(ctx, session);
}

/**
 * Load a logged session into the Today form for editing (Save replaces it; set weights are not used up).
 * @param {object} ctx
 * @param {string} id session id
 */
export async function editSession(ctx, id) {
  const state = ctx.state;
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  const draft = usableDraft(state, ctx.today());
  if (draft && draft.editingId !== id && draft.entries.some(hasReps)) {
    const ok = await confirmSheet({
      title: 'Replace the workout in Today?',
      message: 'Today has reps typed that are not saved yet. Editing this workout clears them.',
      confirmLabel: 'Edit this one',
    });
    if (!ok) return;
  }
  const index = planIndex(dayPlan(state, s.day));
  const used = new Set();
  let extras = 0;
  let mainUsed = false;
  const entries = (s.entries || []).map((e) => {
    const sets = (e.sets || []).map((st) => ({ ...loggedSet(st.weight, st.reps, st), touched: true })); // §19: times kept
    const name = exerciseName(e.exerciseId, e.name);
    if (!mainUsed && e.exerciseId === DAYS[s.day].main) {
      mainUsed = true;
      return { uid: 'main', slotKey: null, exerciseId: e.exerciseId, name, sets };
    }
    const match = [...index].find(([uid, it]) => !used.has(uid) && it.exerciseId === e.exerciseId);
    if (match) {
      used.add(match[0]);
      return { uid: match[0], slotKey: match[1].slotKey, exerciseId: e.exerciseId, name, sets };
    }
    extras += 1;
    return { uid: `x${extras}`, slotKey: null, exerciseId: e.exerciseId, name, sets };
  });
  const form = { date: s.date, day: s.day, offDay: Boolean(s.offDay), note: s.note || '', editingId: s.id, extraCount: extras, entries };
  for (const k of ['startedAt', 'finishedAt']) if (isValidLocalTime(s[k])) form[k] = s[k]; // an edit keeps its times
  ctx.setState({ ...state, draft: form });
  ctx.saveNow();
  ctx.go('today');
}
