// Plan: goal, abs add-on, the Day 1–6 cycle with every exercise, swaps, set weights and the rules.

import {
  ROTATION, EXERCISES, GOALS, REST, ABS_DAYS, MISSES_BEFORE_DELOAD, DELOAD_FACTOR, MAIN_REPS,
  nextWorkout, mainPrescription, accessoryPrescription, roleOf,
} from '../program.js';
import { baselineKey } from '../progression.js';
import { formatWeight, formatNumber, incrementFor, smallestIncrement } from '../units.js';
import { html, setHTML, icon, plural } from './dom.js';
import { openSwapSheet, openSetWeightSheet, openStartingWeights } from './pickers.js';
import { dayPlan, dayName, positionsOf, dayList, roleName } from './model.js';

// Which day cards are open (positions 1–6); starts with the next workout.
const ui = { open: null };

function rowMarkup(state, dayId, row) {
  const unit = state.settings.unit;
  const b = state.baselines[baselineKey(row.exerciseId, row.role)];
  const setw = html`<button type="button" class="icon-btn" data-act="setweight" data-ex="${row.exerciseId}" data-role="${row.role}"
    data-name="${roleName(row.exerciseId, row.name, row.role, row.item)}" aria-label="Set weight">
    <span class="unit-pill${b ? ' set' : ''}" aria-hidden="true">${b ? formatNumber(b.weight) : unit}</span></button>`;
  const right = row.swappable
    ? html`<button type="button" class="icon-btn" data-act="swap" data-slot="${row.slotKey}" aria-label="Swap">${icon('swap')}</button>${setw}`
    : html`<span class="lock">${row.role === 'main' ? 'Main · fixed' : 'Fixed'}</span>${setw}`;
  return html`<div class="prow" role="group" aria-label="${row.name}">
    <span class="pname">${row.name}
      ${row.superset ? html`<small>Superset with ${row.superset}</small>` : ''}
      ${b ? html`<small class="setw-note">Next session: ${formatWeight(b.weight, unit)} (you set it)</small>` : ''}</span>
    <span class="rx">${row.rx}</span>
    <span class="pact">${right}</span>
  </div>`;
}

function rowsFor(state, dayId) {
  const plan = dayPlan(state, dayId);
  const main = { exerciseId: plan.main.exerciseId, name: EXERCISES[plan.main.exerciseId].name, role: 'main', rx: mainPrescription(plan.main.sets), swappable: false };
  const items = plan.items.map((it) => {
    const partner = it.supersetWith ? plan.items.find((p) => p.exerciseId === it.supersetWith && p !== it) : null;
    return {
      exerciseId: it.exerciseId, name: it.name, role: roleOf(dayId, it.exerciseId), rx: accessoryPrescription(it),
      swappable: it.swappable, slotKey: it.slotKey, item: it, superset: it.supersetWith ? (partner ? partner.name : '') : '',
    };
  });
  return [main, ...items];
}

/**
 * Draw the Plan screen.
 * @param {HTMLElement} root
 * @param {object} ctx
 */
export function renderPlan(root, ctx) {
  const state = ctx.state;
  const unit = state.settings.unit;
  const next = nextWorkout(state.sessions);
  if (!ui.open) ui.open = new Set([next.position]);
  const goal = GOALS.find((g) => g.id === state.settings.goal) || GOALS[0];
  const inc = (cat) => formatWeight(incrementFor(cat, unit), unit);
  const absDays = dayList([...new Set(ABS_DAYS.flatMap(positionsOf))].sort());

  const dayCard = (dayId, pos) => {
    const rows = rowsFor(state, dayId);
    const open = ui.open.has(pos);
    const sameAs = dayId === 'legs' && pos === 6 ? 3 : null;
    const summary = open ? plural(rows.length, 'exercise')
      : sameAs ? `Same as Day ${sameAs}` : `${rows[0].name} · ${plural(rows.length, 'exercise')}`;
    return html`<section class="card day${open ? ' open' : ''}" aria-label="Day ${pos} · ${dayName(dayId)}">
      <h2 class="day-title"><button type="button" class="day-head" data-act="toggle-day" data-pos="${pos}" aria-expanded="${open}">
        <span>Day ${pos} · ${dayName(dayId)}</span><span class="muted">${summary} ${icon(open ? 'chevronUp' : 'chevronDown')}</span></button></h2>
      ${open ? html`<p class="cap">Rest ${REST.main} on the main lift, ${REST.accessory} on the rest.</p>
        ${rows.map((r) => rowMarkup(state, dayId, r))}` : ''}
    </section>`;
  };

  setHTML(root, html`<div class="screen plan">
    <h1 class="page-title">Plan</h1>
    <div class="card">
      <h2>Goal</h2>
      <div class="seg four" role="group" aria-label="Goal">${GOALS.map((g) => html`<button type="button" data-act="goal" data-goal="${g.id}" aria-pressed="${g.id === goal.id}">${g.label}</button>`)}</div>
      <p class="cap pad">${goal.description}</p>
      <label class="toggle-row flat"><span><b>Ab work</b><span class="muted">Adds 2 ab exercises on ${absDays}</span></span>
        <input type="checkbox" class="switch" role="switch" aria-label="Ab work" data-input="abs" ${state.settings.abs ? 'checked' : ''}></label>
    </div>
    <div class="rotation" aria-label="The 6-day cycle">${ROTATION.map((d, i) => html`<span class="${i + 1 === next.position ? 'now' : ''}"${i + 1 === next.position ? html` aria-current="step"` : ''}>${i + 1} ${dayName(d)}</span>`)}</div>
    <p class="cap pad">Rest: whenever you like — the app follows the workouts you log, not the calendar.</p>
    ${ROTATION.map((d, i) => dayCard(d, i + 1))}
    <div class="card">
      <h2>Weights</h2>
      <p class="cap">Set the weight for any exercise's next session. After that the app takes over again.</p>
      <button type="button" class="btn wide pad" data-act="set-weights">Set weights</button>
    </div>
    <div class="card rules">
      <h2>The rules</h2>
      <ul>
        <li><b>Main lifts:</b> hit all your ${MAIN_REPS}s → next time add ${inc('upper')}${inc('lower') === inc('upper') ? '' : ` (squat ${inc('lower')})`} — deadlift ${inc('deadlift')}.</li>
        <li><b>AMRAP (${MAIN_REPS}+):</b> the last set — as many good-form reps as you can.</li>
        <li><b>Accessories:</b> every set at the top of the range → add ${inc('accessory')}. A set under the bottom → go lighter.</li>
        <li><b>${MISSES_BEFORE_DELOAD} misses in a row</b> at the same weight → take ${Math.round((1 - DELOAD_FACTOR) * 100)}% off and build back up. Off days don't count.</li>
        <li><b>Starting weight:</b> work up in sets of ${MAIN_REPS} until the bar slows, then take ${formatWeight(smallestIncrement(unit), unit)} off.</li>
        <li><b>Form and weight both matter:</b> only add weight when every rep is clean.</li>
      </ul>
    </div>
  </div>`);

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'goal': ctx.commit({ ...ctx.state, settings: { ...ctx.state.settings, goal: b.dataset.goal } }); break;
      case 'toggle-day': {
        const pos = Number(b.dataset.pos);
        if (ui.open.has(pos)) ui.open.delete(pos); else ui.open.add(pos);
        ctx.render();
        break;
      }
      case 'swap': openSwapSheet(ctx, b.dataset.slot); break;
      case 'setweight': openSetWeightSheet(ctx, { exerciseId: b.dataset.ex, name: b.dataset.name, role: b.dataset.role }); break;
      case 'set-weights': openStartingWeights(ctx, { firstRun: false }); break;
      default: break;
    }
  });
  root.addEventListener('change', (e) => {
    if (e.target.dataset.input === 'abs') ctx.commit({ ...ctx.state, settings: { ...ctx.state.settings, abs: e.target.checked } });
  });
}
