// The rest timer inside a Today card (§18.1, option B): its markup, the once-a-second update, and the beep.
// The rules (ranges, phases) come from program.js; the timer's state is `draft.rest = {uid, set, startedAt, extra}`.

import { REST, restPhase } from '../program.js';
import { html } from './dom.js';

/** Seconds each "+30 s" adds. */
export const REST_MORE_SECONDS = 30;

const pad2 = (n) => String(n).padStart(2, '0');
/** "0:48", "12:05" */
const clock = (sec) => `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;
/** "3 min", "5 min 30 s" */
const span = (sec) => (sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec / 60} min`);

/**
 * A stored timer that can be shown: {uid, set, startedAt (ms), extra (s)}; anything else → null.
 * @param {unknown} rest
 * @returns {{uid: string, set: number, startedAt: number, extra: number}|null}
 */
export function usableRest(rest) {
  if (!rest || typeof rest !== 'object') return null;
  const { uid, set, startedAt, extra = 0 } = rest;
  if (typeof uid !== 'string' || !Number.isInteger(set) || set < 0 || !Number.isFinite(startedAt)) return null;
  if (!Number.isFinite(extra) || extra < 0) return null;
  return rest;
}

/**
 * What the timer shows at `nowMs`: the phase from `restPhase`, the clock and the line next to it.
 * @param {{startedAt: number, extra?: number}} rest
 * @param {'main'|'accessory'} role
 * @param {number} nowMs
 */
export function restView(rest, role, nowMs) {
  const elapsed = Math.max(0, Math.floor((nowMs - rest.startedAt) / 1000));
  const extra = rest.extra || 0;
  const p = restPhase(elapsed, role, extra);
  let note;
  if (p.phase === 'resting') note = `· aim ${REST[role] || REST.accessory}${extra ? ` + ${extra} s` : ''}`;
  else if (p.phase === 'ready') note = '· Ready — go when you are';
  else note = `· Over ${span(p.max)} — get going`;
  return { ...p, elapsed, clock: `Rest ${clock(elapsed)}`, note };
}

const width = (progress) => `${Math.round(progress * 1000) / 10}%`;

/**
 * Markup of the timer (role="timer", "Rest timer"), with its "+30 s" and "Skip" buttons.
 * @param {object} rest
 * @param {'main'|'accessory'} role
 * @param {number} nowMs
 */
export function restMarkup(rest, role, nowMs) {
  const v = restView(rest, role, nowMs);
  return html`<div class="rest is-${v.phase}" role="timer" aria-label="Rest timer" data-rest>
    <div class="rest-text"><b data-rest-clock>${v.clock}</b> <span data-rest-note>${v.note}</span></div>
    <div class="rest-track" aria-hidden="true"><span data-rest-bar style="width:${width(v.progress)}"></span></div>
    <div class="rest-actions"><button type="button" class="chip-btn" data-act="rest-more">+30 s</button><button type="button" class="chip-btn" data-act="rest-skip">Skip</button></div>
  </div>`;
}

/**
 * Bring a drawn timer up to date (text, bar, phase class) without redrawing it.
 * @param {HTMLElement} el the [data-rest] element
 * @param {object} rest
 * @param {'main'|'accessory'} role
 * @param {number} nowMs
 * @returns {ReturnType<typeof restView>}
 */
export function updateRest(el, rest, role, nowMs) {
  const v = restView(rest, role, nowMs);
  const set = (sel, text) => { const n = el.querySelector(sel); if (n && n.textContent !== text) n.textContent = text; };
  set('[data-rest-clock]', v.clock);
  set('[data-rest-note]', v.note);
  const bar = el.querySelector('[data-rest-bar]');
  if (bar) bar.style.width = width(v.progress);
  for (const phase of ['resting', 'ready', 'over']) el.classList.toggle(`is-${phase}`, phase === v.phase);
  return v;
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
