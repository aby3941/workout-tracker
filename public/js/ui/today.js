// Today: log the next workout, or edit an old one loaded from History.
// The form lives in `state.draft` once the user changes anything (autosaved); until then it is rebuilt from the
// plan on every render, so swaps, goal and abs changes flow straight in. Suggestions come from progression.js.

import {
  DAYS, ROTATION, REST, EXERCISES, SLOTS, MISSES_BEFORE_DELOAD, DELOAD_FACTOR, MAIN_REPS,
  nextWorkout, cyclePosition, roleOf, mainPrescription, accessoryPrescription, incrementCategory,
  matchExercise, customId, isCustom, exerciseName, normalizeName,
} from '../program.js';
import { suggestMain, suggestAccessory, applyBaseline, baselineKey, warmupSets, maxWeight, repsToGo } from '../progression.js';
import { formatWeight, formatNumber, parseWeightInput, incrementFor, smallestIncrement } from '../units.js';
import { formatDate, formatDateShort, weekdayShort, compareISO, isValidISO, daysBetween } from '../dates.js';
import { mergeSessions, replaceSession, deleteSession, consumeBaselines, sessionKey } from '../store.js';
import { html, setHTML, icon, plural, setsLong, focusKey, restoreFocus } from './dom.js';
import { openSheet, confirmSheet, toast } from './sheets.js';
import { openSwapSheet, openSetWeightSheet } from './pickers.js';
import { dayPlan, dayName } from './model.js';

/** Most sets per exercise (matches the import cap, so every logged workout survives a text backup). */
const MAX_SETS = 20;
/** Days after which the backup reminder shows. */
const BACKUP_DAYS = 7;
/** Sets an added exercise starts with. */
const EXTRA_SETS = 3;
/** An empty Save this soon after a save is the second tap of a double-tap: ignored, so "Saved" stays on screen. */
const SAVE_REPEAT_MS = 1500;

// Screen memory that is not saved: which cards are open, the date editor, inputs holding unreadable text,
// and when the last save happened.
const ui = { formId: '', opened: new Set(), dateOpen: false, bad: new Set(), savedAt: 0 };

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
  return d;
}

/**
 * The form on screen: the saved draft, or a fresh form for the next workout.
 * A new-workout draft left from an earlier day with no reps typed (and a date the user didn't pick) moves
 * to today — nothing in it belongs to that day. One with reps keeps its date: those reps were done then.
 * Weights the user hasn't typed always follow the current suggestion (date, unit, set weights, history).
 */
function currentForm(ctx) {
  const today = ctx.today();
  const draft = usableDraft(ctx.state, today);
  if (draft) {
    let changed = false;
    if (!draft.editingId && !draft.dateChosen && compareISO(draft.date, today) < 0 && !draft.entries.some(hasReps)) {
      draft.date = today;
      changed = true;
    }
    if (syncDraft(ctx.state, draft)) changed = true;
    if (prefill(ctx.state, draft)) changed = true;
    if (changed) ctx.saveSoon();
    return draft;
  }
  return freshForm(ctx.state, { date: today, day: nextWorkout(ctx.state.sessions).dayId });
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
    planned.push({ uid, slotKey: it.slotKey, exerciseId: it.exerciseId, name: it.name, sets: Array.from({ length: it.sets }, blankSet) });
  }
  // Slot entries the plan no longer has (abs switched off, a combo swapped away) go unless they hold the user's numbers.
  const kept = form.entries.filter((e) => !e.slotKey || (bySlot.has(e.uid) && !untouched(e)));
  if ([...bySlot.values()].some(untouched)) changed = true;
  if (!changed) return false;
  form.entries = [...kept.filter((e) => e.uid === 'main'), ...planned, ...kept.filter((e) => e.uid !== 'main')];
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

/** How an entry is shown: role, prescription, rest, swap, superset partner. */
function entryInfo(form, entry, plan, index) {
  const role = roleOf(form.day, entry.exerciseId);
  if (role === 'main') {
    const planned = DAYS[form.day].mainSets;
    return { role, main: true, rx: null, plannedSets: planned, prescription: mainPrescription(planned), rest: REST.main, swappable: false, superset: null, extra: false };
  }
  const item = index.get(entry.uid);
  const live = item && item.exerciseId === entry.exerciseId ? item : null;
  const base = entry.slotKey && SLOTS[entry.slotKey];
  if (!live && !base) {
    return { role, main: false, rx: null, plannedSets: entry.sets.length, prescription: 'Extra', rest: REST.accessory, swappable: false, superset: null, extra: true };
  }
  const rx = live || { sets: base.sets, repsMin: base.repsMin, repsMax: base.repsMax };
  let superset = null;
  if (live && live.supersetWith) {
    const partner = plan.items.find((it) => it.exerciseId === live.supersetWith && it !== live);
    superset = partner ? partner.name : exerciseName(live.supersetWith);
  }
  return {
    role, main: false, rx, plannedSets: rx.sets, prescription: accessoryPrescription(rx), rest: REST.accessory,
    swappable: Boolean(live ? live.swappable : base.swappable), superset, extra: false,
  };
}

/** Suggestion for an entry (set weights apply to new workouts only). */
function suggestionFor(state, form, entry, info, prior) {
  const unit = state.settings.unit;
  let s = info.role === 'main'
    ? suggestMain(prior, entry.exerciseId, unit)
    : suggestAccessory(prior, entry.exerciseId, info.rx || { sets: entry.sets.length, repsMin: null, repsMax: null }, unit);
  if (!form.editingId) s = applyBaseline(s, state.baselines[baselineKey(entry.exerciseId, info.role)]);
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
      if (set.weight !== w) { set.weight = w; changed = true; }
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
 * Opening rule: the main lift and the first exercise that still has an empty reps box are open; an exercise
 * with any reps stays open; a tapped card opens. Open cards stay open while this form is on screen.
 */
function updateOpen(cards) {
  for (const c of cards) if (c.info.main || hasReps(c.entry)) ui.opened.add(c.entry.uid);
  const firstEmpty = cards.find((c) => !c.info.main && c.entry.sets.some((s) => !(s.reps > 0)));
  if (firstEmpty) ui.opened.add(firstEmpty.entry.uid);
}

// ---------------------------------------------------------------- suggestion copy

function rangeText(rx) {
  return rx.repsMin === rx.repsMax ? `${rx.repsMax}` : `${rx.repsMin}–${rx.repsMax}`;
}

/** Headline + detail for a suggestion (wording from the build contract). */
function suggestionText(s, info, entry, unit) {
  const fw = (w) => (w === 0 ? 'bodyweight' : formatWeight(w, unit));
  const reps = (item) => item.sets.map((x) => x.reps).join(', ');
  const inc = () => formatWeight(incrementFor(incrementCategory(entry.exerciseId, info.role), unit), unit);
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

function warmupText(weight, unit) {
  return warmupSets(weight, unit).map((s) => `${formatNumber(s.weight)}×${s.reps}`).join(' · ');
}

// ---------------------------------------------------------------- markup

/** Width (in characters) for a weight box, so the number and its unit sit centred together. */
const fitLen = (text) => Math.max(2, Math.min(7, String(text).length));

function setRow(c, set, i, unit) {
  const { entry, info } = c;
  const n = i + 1;
  const amrap = info.main && n === info.plannedSets;
  const seconds = entry.exerciseId === 'plank';
  let repsHint = seconds ? 'sec' : 'reps';
  if (info.main) repsHint = amrap ? `${MAIN_REPS}+` : `${MAIN_REPS}`;
  else if (info.rx && info.rx.repsMin != null) repsHint = rangeText(info.rx);
  const bad = (k) => (ui.bad.has(`${entry.uid}:${k}${i}`) ? 'true' : 'false');
  const weightText = set.weight == null ? '' : formatNumber(set.weight);
  return html`<div class="set-row">
    <span class="n">${n}${amrap ? html`<small>AMRAP</small>` : ''}</span>
    <label class="field"><input class="w" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next"
      aria-label="Set ${n} weight" aria-invalid="${bad('w')}" data-kind="w" data-set="${i}" data-fk="${entry.uid}:w${i}"
      value="${weightText}" placeholder="—" style="--len:${fitLen(weightText)}"><small>${unit}</small></label>
    <span class="x" aria-hidden="true">×</span>
    <label class="field reps${set.reps > 0 ? ' done' : ''}"><input class="r" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next"
      aria-label="Set ${n} reps" aria-invalid="${bad('r')}" data-kind="r" data-set="${i}" data-fk="${entry.uid}:r${i}"
      value="${set.reps == null ? '' : String(set.reps)}" placeholder="${repsHint}">${seconds ? html`<small>sec</small>` : ''}</label>
  </div>`;
}

function cardMarkup(c, unit) {
  const { entry, info, s } = c;
  const t = suggestionText(s, info, entry, unit);
  const swap = info.swappable
    ? html`<button type="button" class="swap" data-act="swap" data-fk="${entry.uid}:swap">${icon('swap')}<span>Swap</span></button>` : '';
  if (!ui.opened.has(entry.uid)) {
    return html`<section class="card ex compact" aria-label="${entry.name}" data-uid="${entry.uid}" data-act="open-card">
      <div class="ex-head"><div class="ex-title">
        <h2 class="ex-name"><button type="button" class="ex-open" data-act="open-card" aria-expanded="false" data-fk="${entry.uid}:open">${entry.name}</button></h2>
        <p class="cap">${info.prescription} · <span class="suggest-headline">${t.headline}</span></p></div>${swap}</div>
    </section>`;
  }
  const warm = info.main ? warmupText(entry.sets[0] ? entry.sets[0].weight : null, unit) : '';
  const seconds = entry.exerciseId === 'plank';
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
    ${info.main ? html`<p class="warm" data-warm ${warm ? '' : 'hidden'}>Warm-up: <span>${warm}</span></p>` : ''}
    <div class="sets">
      <div class="set-row head" aria-hidden="true"><span>Set</span><span>Weight</span><span></span><span>${seconds ? 'Seconds' : 'Reps'}</span></div>
      ${entry.sets.map((set, i) => setRow(c, set, i, unit))}
    </div>
    ${info.main ? html`<p class="hint">AMRAP = as many good-form reps as you can.</p>` : ''}
    <div class="set-actions">
      <button type="button" class="link" data-act="add-set" data-fk="${entry.uid}:add" ${entry.sets.length >= MAX_SETS ? 'disabled' : ''}>+ Set</button>
      <button type="button" class="link muted-link" data-act="remove-set" data-fk="${entry.uid}:remove-set" ${entry.sets.length <= 1 ? 'disabled' : ''}>− Set</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- screen

/**
 * Draw the Today screen into `root` (a fresh element per render).
 * @param {HTMLElement} root
 * @param {object} ctx app context
 */
export function renderToday(root, ctx) {
  const state = ctx.state;
  const unit = state.settings.unit;
  const form = currentForm(ctx);
  const formId = `${form.editingId || 'new'}|${form.date}|${form.day}`;
  if (formId !== ui.formId) { ui.formId = formId; ui.opened = new Set(); ui.bad.clear(); }
  let cards = cardsFor(state, form);
  updateOpen(cards);

  const today = ctx.today();
  const last = state.settings.lastBackupAt;
  const needsBackup = state.sessions.length > 0 && (!last || daysBetween(last, today) >= BACKUP_DAYS);
  const editing = Boolean(form.editingId);

  setHTML(root, html`<div class="screen today">
    <header class="today-head">
      <div class="kicker"><span>${weekdayShort(form.date)} ${formatDate(form.date)}</span>
        <button type="button" class="link" data-act="change-date" data-fk="change-date" aria-expanded="${ui.dateOpen}">Change date</button></div>
      <div class="date-row" ${ui.dateOpen ? '' : 'hidden'}>
        <label for="workout-date">Workout date</label>
        <input id="workout-date" class="text-input date-input" type="date" value="${form.date}" data-input="date">
      </div>
      <h1 class="big">Day ${positionOf(state, form)} of 6 · ${dayName(form.day)}</h1>
      <div class="picker" data-act="pick-day"><span>Doing a different workout?</span>
        <button type="button" class="link" data-act="pick-day" data-fk="pick-day" aria-haspopup="dialog">Change<span aria-hidden="true"> ▾</span></button></div>
    </header>
    ${editing ? html`<div class="banner edit"><span>Editing ${formatDate(form.date)} · ${dayName(form.day)}</span>
      <button type="button" class="link" data-act="cancel-edit">Cancel edit</button></div>` : ''}
    ${needsBackup ? html`<div class="banner"><span>Last backup: ${last ? formatDate(last) : 'never'}</span>
      <button type="button" class="link" data-act="export-now">Export now</button></div>` : ''}
    <label class="toggle-row"><span><b>Off day</b><span class="muted">Bad sleep or food — misses won't count</span></span>
      <input type="checkbox" class="switch" role="switch" aria-label="Off day" data-input="offday" ${form.offDay ? 'checked' : ''}></label>
    <div class="cards">${cards.map((c) => cardMarkup(c, unit))}</div>
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
    setHTML(tpl, cardMarkup(c, unit));
    sec.replaceWith(tpl.content);
    restoreFocus(root, key);
  };
  /** Open any card the opening rule now asks for (after reps are typed). */
  const openMore = () => {
    const before = new Set(ui.opened);
    updateOpen(cardsFor(ctx.state, form));
    for (const e of form.entries) if (ui.opened.has(e.uid) && !before.has(e.uid)) redrawCard(e);
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
        if (warm) {
          const textNow = warmupText(set.weight, unit);
          warm.hidden = !textNow;
          warm.querySelector('span').textContent = textNow;
        }
      }
    } else {
      const reps = /^\d{1,4}$/.test(text) ? Number(text) : null;
      const bad = text !== '' && reps == null;
      t.setAttribute('aria-invalid', String(bad));
      ui.bad[bad ? 'add' : 'delete'](`${hit.entry.uid}:r${i}`);
      set.reps = reps;
      t.closest('.field').classList.toggle('done', reps > 0);
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
      ui.dateOpen = false;
      prefill(ctx.state, form);
      changed();
      ctx.render();
      return;
    }
    if (t.dataset.kind === 'r') openMore();
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
          const info = entryInfo(form, hit.entry, dayPlan(ctx.state, form.day), planIndex(dayPlan(ctx.state, form.day)));
          openSetWeightSheet(ctx, {
            exerciseId: hit.entry.exerciseId, name: hit.entry.name, role: info.role,
            onSaved: () => { if (ctx.state.draft === form) { prefill(ctx.state, form, hit.entry); ctx.saveSoon(); } },
          });
        }
        break;
      case 'add-set':
        if (hit && hit.entry.sets.length < MAX_SETS) {
          const prev = hit.entry.sets[hit.entry.sets.length - 1];
          hit.entry.sets.push({ weight: prev ? prev.weight : null, reps: null, touched: Boolean(prev && prev.touched) });
          changed();
          redrawCard(hit.entry);
        }
        break;
      case 'remove-set':
        if (hit && hit.entry.sets.length > 1) {
          hit.entry.sets.pop();
          changed();
          redrawCard(hit.entry);
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
      default: break;
    }
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
    ctx.setState({ ...ctx.state, draft: next });
    ctx.saveSoon();
    ctx.render({ keepScroll: false });
  });
}

const GROUP_LABELS = [['pull', 'Pull'], ['push', 'Push'], ['legs', 'Legs'], ['abs', 'Abs']];

function openAddExercise(ctx, form, changed) {
  const all = Object.values(EXERCISES);
  const { el, close } = openSheet({
    title: 'Add exercise',
    className: 'tall',
    body: html`<form class="add-form">
        <label class="field-label" for="add-ex-name">Exercise name</label>
        <div class="row-input"><input id="add-ex-name" class="text-input" autocomplete="off" autocapitalize="sentences" maxlength="60"
          placeholder="Search, or type your own" data-autofocus><button type="submit" class="btn primary">Add</button></div>
        <p class="err" hidden>Type a name or pick one below.</p>
      </form>
      <div class="opts pick-list">${GROUP_LABELS.map(([g, label]) => html`<p class="group-label">${label}</p>
        ${all.filter((x) => x.group === g).map((x) => html`<button type="button" class="opt" data-ex="${x.id}"><span>${x.name}</span></button>`)}`)}</div>
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
    toast(`Added ${name}`);
  };
  const input = el.querySelector('input');
  input.addEventListener('input', () => {
    const q = normalizeName(input.value);
    for (const b of el.querySelectorAll('[data-ex]')) b.hidden = Boolean(q) && !normalizeName(b.textContent).includes(q);
  });
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (!name) { el.querySelector('.err').hidden = false; return; }
    const id = matchExercise(name);
    add(id || customId(name), id ? EXERCISES[id].name : name);
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'cancel') close();
    if (b.dataset.ex) add(b.dataset.ex, EXERCISES[b.dataset.ex].name);
  });
}

// ---------------------------------------------------------------- save / edit

/** The session a form saves: only sets with reps > 0, no empty entries. */
function sessionFrom(form) {
  const entries = [];
  for (const e of form.entries) {
    const sets = e.sets.filter((s) => s.reps > 0).map((s) => ({ weight: s.weight ?? 0, reps: s.reps }));
    if (!sets.length) continue;
    entries.push(isCustom(e.exerciseId) ? { exerciseId: e.exerciseId, name: e.name, sets } : { exerciseId: e.exerciseId, sets });
  }
  return { date: form.date, day: form.day, offDay: Boolean(form.offDay), note: String(form.note || '').trim(), entries };
}

async function saveWorkout(ctx, form) {
  const firstBad = [...ui.bad][0];
  if (firstBad) {
    toast('Fix the highlighted box first — numbers only, like 62.5');
    const el = document.querySelector(`[data-fk="${CSS.escape(firstBad)}"]`);
    if (el) el.focus();
    return;
  }
  const session = sessionFrom(form);
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
  if (!form.editingId) next = consumeBaselines(next, session);
  ui.formId = '';
  ui.savedAt = Date.now();
  ctx.commit(next, { keepScroll: false });
  ctx.afterSave();
  toast(`Saved ${dayName(session.day)} · ${formatDate(session.date)}`);
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
    const sets = (e.sets || []).map((st) => ({ weight: st.weight, reps: st.reps, touched: true }));
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
  ctx.setState({ ...state, draft: form });
  ctx.saveNow();
  ctx.go('today');
}
