// The rest and set timers inside a Today card (§18.1 option B, §19.2): their markup, the once-a-second update and the
// beep. The rules come from the pure modules: rest ranges and phases from program.js; the timer itself (4-hour sitting,
// recorded times) and what comes next after a set (superset rounds, the next exercise) from timers.js.

import { REST, restPhase } from '../program.js';
import { timerSeconds } from '../timers.js';
import { formatClock } from '../dates.js';
import { html } from './dom.js';

/** Seconds each "+30 s" adds. */
export const REST_MORE_SECONDS = 30;

/** "3 min", "5 min 30 s" */
const span = (sec) => (sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec / 60} min`);

// ---------------------------------------------------------------- the rest box

/**
 * What the rest box shows at `nowMs`: the phase from `restPhase`, the clock and the line next to it.
 * @param {{startedAt: number, extra?: number}} rest
 * @param {'main'|'accessory'} role
 * @param {number} nowMs
 * @param {{pair?: boolean}} [opts] pair: the one rest of a superset round
 */
export function restView(rest, role, nowMs, { pair = false } = {}) {
  const elapsed = timerSeconds(rest, nowMs);
  const extra = rest.extra || 0;
  const p = restPhase(elapsed, role, extra);
  let note;
  if (p.phase === 'resting') note = `·${pair ? ' one rest for the pair ·' : ''} aim ${REST[role] || REST.accessory}${extra ? ` + ${extra} s` : ''}`;
  else if (p.phase === 'ready') note = '· Ready — go when you are';
  else note = `· Over ${span(p.max)} — get going`;
  return { ...p, elapsed, clock: `Rest ${formatClock(elapsed)}`, note };
}

const width = (progress) => `${Math.round(progress * 1000) / 10}%`;

/** A ▶ start button (the ▶ is decorative; `aria` names the button when its text says more, e.g. the exercise). */
function startButton({ label, sub = '', aria = '' }, act, cls) {
  return html`<button type="button" class="${cls}" data-act="${act}"${aria ? html` aria-label="${aria}"` : ''}><span class="go" aria-hidden="true">▶</span> ${label}${sub ? html`<small>${sub}</small>` : ''}</button>`;
}

/**
 * The rest box under a committed set (role="timer", "Rest timer"): the clock against the aim, the bar to the target,
 * the Start button for what comes next (`start`: {label, sub?, aria?}, or null), "+30 s" and "Skip".
 * @param {object} rest the timer
 * @param {'main'|'accessory'} role
 * @param {number} nowMs
 * @param {{start?: {label: string, sub?: string, aria?: string}|null, pair?: boolean, wide?: boolean}} [opts]
 *   wide: the Start button gets a row of its own (a longer label)
 */
export function restMarkup(rest, role, nowMs, { start = null, pair = false, wide = false } = {}) {
  const v = restView(rest, role, nowMs, { pair });
  const chips = html`<button type="button" class="chip-btn" data-act="rest-more">+30 s</button><button type="button" class="chip-btn" data-act="rest-skip">Skip</button>`;
  const go = start ? startButton(start, 'timer-start', 'startbtn') : '';
  return html`<div class="rest is-${v.phase}" role="timer" aria-label="Rest timer" data-below data-timer="rest">
    <div class="rest-text"><b data-timer-clock>${v.clock}</b> <span data-rest-note>${v.note}</span></div>
    <div class="rest-track" aria-hidden="true"><span data-rest-bar style="width:${width(v.progress)}"></span></div>
    ${start && wide ? html`<div class="rest-actions">${go}</div><div class="rest-actions">${chips}</div>`
      : html`<div class="rest-actions${start ? ' with-start' : ''}">${go}${chips}</div>`}
  </div>`;
}

/**
 * Bring a drawn rest box up to date (text, bar, phase class) without redrawing it.
 * @param {HTMLElement} el the rest box
 * @param {object} rest
 * @param {'main'|'accessory'} role
 * @param {number} nowMs
 * @param {{pair?: boolean}} [opts]
 * @returns {ReturnType<typeof restView>}
 */
export function updateRest(el, rest, role, nowMs, opts = {}) {
  const v = restView(rest, role, nowMs, opts);
  const set = (sel, text) => { const n = el.querySelector(sel); if (n && n.textContent !== text) n.textContent = text; };
  set('[data-timer-clock]', v.clock);
  set('[data-rest-note]', v.note);
  const bar = el.querySelector('[data-rest-bar]');
  if (bar) bar.style.width = width(v.progress);
  for (const phase of ['resting', 'ready', 'over']) el.classList.toggle(`is-${phase}`, phase === v.phase);
  return v;
}

// ---------------------------------------------------------------- the set box and the row button

/** "Set 2 · 0:24" */
const setClock = (timer, nowMs) => `Set ${timer.set + 1} · ${formatClock(timerSeconds(timer, nowMs))}`;

/**
 * The set box under the set being done (role="timer", "Set timer"): "Set N · m:ss", "· rest before it m:ss" when a
 * rest was recorded on that set, and Cancel. It never beeps.
 * @param {object} timer
 * @param {number} nowMs
 * @param {number|null} restBefore the set's recorded rest
 */
export function setTimerMarkup(timer, nowMs, restBefore) {
  return html`<div class="setbox" role="timer" aria-label="Set timer" data-below data-timer="set">
    <div class="rest-text"><b data-timer-clock>${setClock(timer, nowMs)}</b>${restBefore != null ? html` <span>· rest before it ${formatClock(restBefore)}</span>` : ''}</div>
    <div class="rest-actions spread"><span class="muted">Type the reps when you're done</span><button type="button" class="chip-btn" data-act="set-cancel">Cancel</button></div>
  </div>`;
}

/**
 * Bring a drawn set box's clock up to date.
 * @param {HTMLElement} el
 * @param {object} timer
 * @param {number} nowMs
 */
export function updateSetTimer(el, timer, nowMs) {
  const n = el.querySelector('[data-timer-clock]');
  const text = setClock(timer, nowMs);
  if (n && n.textContent !== text) n.textContent = text;
}

/**
 * The small "▶ Start set N" button under the next set to do while no timer runs (§19.2): it starts that set's timer
 * and records no rest.
 * @param {number} i the set's index
 */
export function rowStartMarkup(i) {
  return html`<div class="startrow" data-below>${startButton({ label: `Start set ${i + 1}` }, 'row-start', 'startmini')}</div>`;
}

// ---------------------------------------------------------------- the beep (Web Audio)
// Browsers only let sound start after a tap or key press, so the audio is switched on during one (a reps commit);
// the beep later plays through it. Nothing here runs at import time.

let audio = null;

/** Switch the audio on (call from a tap / key handler). Silently does nothing where Web Audio is missing. */
export function unlockSound() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return;
  try {
    if (!audio) audio = new AC();
    if (audio.state !== 'running') audio.resume().catch(() => {});
  } catch {
    audio = null;
  }
}

/** One short beep, if the audio was switched on. */
export function beep() {
  if (!audio || audio.state !== 'running') return;
  try {
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  } catch { /* no sound this time */ }
}
