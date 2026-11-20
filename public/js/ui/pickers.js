// Shared sheets: Swap (Today + Plan), Set weight (Today, Plan, Progress) and the starting-weights list
// (first open + Plan → Set weights).

import { SLOTS, DAY_ORDER, isCustom, accessoryPrescription, equipmentOf } from '../program.js';
import { baselineKey } from '../progression.js';
import { setBaseline, clearBaseline, setStep, clearStep } from '../store.js';
import { formatNumber, formatWeight, parseWeightInput, stepFor, isValidStep } from '../units.js';
import { html, icon } from './dom.js';
import { openSheet, toast, keepFocusOnTap } from './sheets.js';
import { dayPlan, slotPositions, dayList, weightTargets } from './model.js';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

/** Extra words under a few options (UI copy only). */
const OPTION_HINTS = { pullUp: 'bodyweight — add weight later', chinUp: 'bodyweight — add weight later' };

/**
 * Swap sheet for an accessory slot. Choosing saves to `choices` straight away and closes.
 * @param {object} ctx app context
 * @param {string} slotKey
 * @param {{onPicked?: (slotKey: string) => void}} [opts] runs after the choice is saved, before re-render
 */
export function openSwapSheet(ctx, slotKey, { onPicked } = {}) {
  const slot = SLOTS[slotKey];
  if (!slot || !slot.swappable) return;
  const state = ctx.state;
  const choice = state.choices[slotKey];
  const customName = typeof choice === 'string' && isCustom(choice) ? choice.slice('custom:'.length) : '';
  const selected = customName ? 'custom' : (slot.options.find((o) => o.id === choice) || slot.options[0]).id;
  const day = DAY_ORDER.find((d) => dayPlan(state, d).items.some((it) => it.slotKey === slotKey));
  const item = day ? dayPlan(state, day).items.find((it) => it.slotKey === slotKey) : slot;
  const inputId = nextId('custom');

  const { el, close } = openSheet({
    title: `Swap: ${slot.label}`,
    body: html`
      <p class="cap">${accessoryPrescription(item)} · applies to ${dayList(slotPositions(slotKey, state.settings.abs))} from now on</p>
      <div class="opts">
        ${slot.options.map((o) => html`<button type="button" class="opt${o.id === selected ? ' selected' : ''}" data-opt="${o.id}" aria-pressed="${o.id === selected}">
          <span>${o.label}</span>${o.id === selected ? icon('check', 'check') : (OPTION_HINTS[o.id] ? html`<span class="muted">${OPTION_HINTS[o.id]}</span>` : '')}</button>`)}
        <button type="button" class="opt${selected === 'custom' ? ' selected' : ''}" data-act="custom" aria-pressed="${selected === 'custom'}" aria-expanded="false">
          <span>Custom…</span><span class="muted">${customName || 'type your own'}</span></button>
      </div>
      <form class="custom-row" hidden>
        <label class="sr-only" for="${inputId}">Custom exercise name</label>
        <input id="${inputId}" class="text-input" name="name" autocomplete="off" autocapitalize="sentences" value="${customName}" placeholder="e.g. Machine row" maxlength="60">
        <button type="submit" class="btn primary">Save</button>
      </form>
      <p class="err" hidden>Type a name first.</p>
      <p class="note">Past workouts keep what you logged.</p>
      <button type="button" class="save" data-act="done">Done</button>`,
  });

  const pick = (value) => {
    ctx.commit({ ...ctx.state, choices: { ...ctx.state.choices, [slotKey]: value } }, { render: false });
    if (onPicked) onPicked(slotKey);
    close();
    ctx.render();
    const items = day ? dayPlan(ctx.state, day).items.filter((it) => it.slotKey === slotKey) : [];
    if (items.length) toast(`Swapped to ${items.map((it) => it.name).join(' + ')} — from now on`);
  };
  keepFocusOnTap(el.querySelector('.opts'));
  const form = el.querySelector('.custom-row');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.opt) pick(b.dataset.opt);
    else if (b.dataset.act === 'custom') {
      form.hidden = false;
      b.setAttribute('aria-expanded', 'true');
      form.querySelector('input').focus();
    } else if (b.dataset.act === 'done') close();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.querySelector('input').value.trim().replace(/\s+/g, ' ');
    if (!name) {
      el.querySelector('.err').hidden = false;
      return;
    }
    pick(`custom:${name}`);
  });
}

/** What a weight step means for the exercise's equipment (sheet copy). */
const STEP_HINTS = {
  machine: 'one plate on the stack', cable: 'one plate on the stack', barbell: 'the smallest plates you have, both sides together',
  dumbbell: 'the jump to the next dumbbell',
};

/**
 * Set weight sheet: the weight for one track's next session (used once, then progression takes over), and the
 * exercise's own weight step (§17.2: kept until changed; applies to every track of the exercise).
 * Save with only the step filled keeps the set weight as it was; an emptied box clears what it held.
 * @param {object} ctx
 * @param {{exerciseId: string, name: string, role: 'main'|'accessory', occurrence?: number, onSaved?: () => void}} target
 */
export function openSetWeightSheet(ctx, { exerciseId, name, role, occurrence = 0, onSaved }) {
  const unit = ctx.state.settings.unit;
  const current = ctx.state.baselines[baselineKey(exerciseId, role, occurrence)];
  const ownStep = ctx.state.steps && isValidStep(ctx.state.steps[exerciseId]) ? ctx.state.steps[exerciseId] : null;
  const defaultStep = stepFor(exerciseId, role, unit, {});
  const hint = STEP_HINTS[equipmentOf(exerciseId)];
  const inputId = nextId('setw');
  const stepId = nextId('step');
  const { el, close } = openSheet({
    title: `Set weight: ${name}`,
    body: html`<form class="setw">
      <label class="field-label" for="${inputId}">Weight (${unit})</label>
      <div class="input-unit"><input id="${inputId}" class="text-input big-input" inputmode="decimal" autocomplete="off" enterkeyhint="done"
        data-field="weight" value="${current ? formatNumber(current.weight) : ''}" placeholder="0" data-autofocus><span>${unit}</span></div>
      <p class="sheet-text">Used for your next session only. After that the app takes over again.</p>
      <label class="field-label" for="${stepId}">Weight step (${unit})</label>
      <div class="input-unit"><input id="${stepId}" class="text-input" inputmode="decimal" autocomplete="off" enterkeyhint="done"
        data-field="step" value="${ownStep != null ? formatNumber(ownStep) : ''}" placeholder="${formatNumber(defaultStep)}"><span>${unit}</span></div>
      <p class="sheet-text">How much it goes up or down each time${hint ? ` — ${hint}` : ''}. Empty = ${formatWeight(defaultStep, unit)}. Kept until you change it.</p>
      <p class="err" hidden>Use numbers like 62.5 (a weight of 0 means bodyweight; a step must be more than 0).</p>
      <div class="sheet-actions">
        <button type="submit" class="btn primary">Save</button>
        ${current ? html`<button type="button" class="btn" data-act="clear">Clear</button>` : ''}
        <button type="button" class="btn" data-act="cancel">Cancel</button>
      </div>
    </form>`,
  });
  const done = (next, message) => {
    ctx.commit(next, { render: false });
    close();
    if (onSaved) onSaved();
    ctx.render();
    toast(message);
  };
  const weightInput = el.querySelector('[data-field="weight"]');
  const stepInput = el.querySelector('[data-field="step"]');
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const wText = weightInput.value.trim();
    const sText = stepInput.value.trim();
    const w = parseWeightInput(wText);
    const step = parseWeightInput(sText);
    const badWeight = wText !== '' && w == null;
    const badStep = sText !== '' && !isValidStep(step);
    const nothing = wText === '' && sText === '' && !current && ownStep == null;
    weightInput.setAttribute('aria-invalid', String(badWeight || nothing));
    stepInput.setAttribute('aria-invalid', String(badStep));
    if (badWeight || badStep || nothing) {
      el.querySelector('.err').hidden = false;
      (badStep && !badWeight ? stepInput : weightInput).focus();
      return;
    }
    let next = ctx.state;
    const said = [];
    if (w != null) {
      next = setBaseline(next, exerciseId, role, w, ctx.today(), occurrence);
      said.push(`${formatWeight(w, unit)} next session`);
    } else if (current) {
      next = clearBaseline(next, exerciseId, role, occurrence);
      said.push('set weight cleared');
    }
    if (step != null && step !== ownStep) {
      next = setStep(next, exerciseId, step);
      said.push(`steps of ${formatWeight(step, unit)}`);
    } else if (step == null && ownStep != null) {
      next = clearStep(next, exerciseId);
      said.push(`steps of ${formatWeight(defaultStep, unit)}`);
    }
    if (!said.length) { close(); return; }
    done(next, `${name}: ${said.join(' · ')}`);
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'clear') done(clearBaseline(ctx.state, exerciseId, role, occurrence), `${name}: set weight cleared`);
    if (b.dataset.act === 'cancel') close();
  });
}

/**
 * The starting-weights list: 5 main lifts + an expandable list of the current accessory picks.
 * First open: Save / Skip (both mark setup done). Later (Plan → Set weights): Save / Cancel.
 * Filled boxes set a weight; a box emptied by the user clears the weight it had.
 * @param {object} ctx
 * @param {{firstRun?: boolean}} [opts]
 */
export function openStartingWeights(ctx, { firstRun = false } = {}) {
  const state = ctx.state;
  const unit = state.settings.unit;
  const { mains, accessories } = weightTargets(state);
  const row = (t, i) => {
    const b = state.baselines[baselineKey(t.exerciseId, t.role, t.occurrence)];
    return html`<label class="sw-row" for="sw-${i}"><span>${t.name}</span>
      <span class="input-unit sm"><input id="sw-${i}" class="text-input" inputmode="decimal" autocomplete="off" data-i="${i}"
        aria-label="${t.name} starting weight" value="${b ? formatNumber(b.weight) : ''}" placeholder="—"><span>${unit}</span></span></label>`;
  };
  const all = [...mains, ...accessories];
  const finish = (next, close) => {
    ctx.commit({ ...next, settings: { ...next.settings, setupDone: true } }, { render: false });
    close();
    ctx.render();
  };
  const { el, close } = openSheet({
    title: 'Set your starting weights',
    className: 'tall',
    onCancel: (c) => (firstRun ? finish(ctx.state, c) : c()),
    body: html`<form class="starting">
      <p class="sheet-text">${firstRun ? 'You can skip this. ' : ''}Each weight is used for that exercise's next session only — leave a box empty and the app gives you a tip on the day.</p>
      <div class="sw-list">${mains.map((t, i) => row(t, i))}</div>
      <details class="sw-more"><summary>Accessories</summary>
        <div class="sw-list">${accessories.map((t, i) => row(t, i + mains.length))}</div></details>
      <p class="err" hidden>Check the highlighted boxes — use numbers like 62.5.</p>
      <div class="sheet-actions">
        <button type="submit" class="btn primary">Save</button>
        <button type="button" class="btn" data-act="skip">${firstRun ? 'Skip' : 'Cancel'}</button>
      </div>
    </form>`,
  });
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    let next = ctx.state;
    let bad = false;
    for (const input of el.querySelectorAll('input[data-i]')) {
      const t = all[Number(input.dataset.i)];
      const text = input.value.trim();
      const w = parseWeightInput(text);
      input.removeAttribute('aria-invalid');
      if (text && w == null) { input.setAttribute('aria-invalid', 'true'); bad = true; continue; }
      if (w != null) next = setBaseline(next, t.exerciseId, t.role, w, ctx.today(), t.occurrence);
      else if (next.baselines[baselineKey(t.exerciseId, t.role, t.occurrence)]) next = clearBaseline(next, t.exerciseId, t.role, t.occurrence);
    }
    if (bad) {
      el.querySelector('.err').hidden = false;
      const first = el.querySelector('[aria-invalid="true"]');
      if (first.closest('details')) first.closest('details').open = true;
      first.focus();
      return;
    }
    finish(next, close);
    toast('Starting weights saved');
  });
  el.querySelector('[data-act="skip"]').addEventListener('click', () => (firstRun ? finish(ctx.state, close) : close()));
}
