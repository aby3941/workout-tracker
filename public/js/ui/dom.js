// Shared UI helpers: an escaping HTML template tag, small icons and display helpers.
// Every interpolated value is escaped unless it was built by `html` or wrapped with `raw` (trusted markup only).

import { escapeHtml } from '../html.js';
import { formatNumber, formatWeight } from '../units.js';
import { daysBetween } from '../dates.js';

const RAW = Symbol('raw');

/**
 * Mark trusted markup (our own templates or SVG from charts.js) so `html` does not escape it.
 * @param {string} markup
 * @returns {{[RAW]: string}}
 */
export function raw(markup) {
  return { [RAW]: String(markup ?? '') };
}

function render(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return String(value); // aria-pressed="false", aria-expanded="true", …
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  return escapeHtml(value);
}

/**
 * Template tag: `html\`<b>${name}</b>\`` escapes `name`; nested `html` results and arrays are inserted as is.
 * @returns {{[RAW]: string}}
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return raw(out);
}

/**
 * Replace an element's content with a template result.
 * @param {Element} el
 * @param {{[RAW]: string}} fragment
 */
export function setHTML(el, fragment) {
  el.innerHTML = render(fragment);
}

/** Small inline icons (decorative: always aria-hidden). */
const ICONS = {
  swap: '<path d="M4 7h11l-3-3M16 13H5l3 3"/>',
  up: '<path d="M6 2 10 7H7.5v3h-3V7H2Z" class="fill"/>',
  warn: '<path d="M10 2.5 18.5 17h-17Z" class="warn-fill"/><path d="M10 8v4.2M10 14.6v.1" class="warn-mark"/>',
  info: '<circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6.3v.1"/>',
  check: '<path d="M4 10.5 8 14.5 16 6"/>',
  chevronDown: '<path d="M5 8l5 5 5-5"/>',
  chevronUp: '<path d="M5 12l5-5 5 5"/>',
};
const VIEWBOX = { up: '0 0 12 12' };

/**
 * Inline SVG icon markup.
 * @param {keyof ICONS} name
 * @param {string} [cls]
 */
export function icon(name, cls = '') {
  return raw(`<svg class="ic ic-${name}${cls ? ' ' + cls : ''}" viewBox="${VIEWBOX[name] || '0 0 20 20'}" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`);
}

/**
 * "1 workout" / "3 workouts".
 * @param {number} n
 * @param {string} word singular
 * @param {string} [plural]
 */
export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

/**
 * "today" / "yesterday" / "9 days ago".
 * @param {string} iso
 * @param {string} today
 */
export function ago(iso, today) {
  const d = daysBetween(iso, today);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** Consecutive sets grouped by weight: [{weight, reps: [..]}]. */
function byWeight(sets) {
  const groups = [];
  for (const s of sets || []) {
    const last = groups[groups.length - 1];
    if (last && last.weight === s.weight) last.reps.push(s.reps);
    else groups.push({ weight: s.weight, reps: [s.reps] });
  }
  return groups;
}

/**
 * Compact sets: "100×5,5,5,5,7", "20×16 ×5" (4+ identical sets), "60×5 · 62.5×5,5" (weight changes).
 * @param {Array<{weight: number, reps: number}>} sets
 * @returns {string}
 */
export function setsShort(sets) {
  return byWeight(sets).map((g) => {
    const same = g.reps.length > 3 && g.reps.every((r) => r === g.reps[0]);
    return same ? `${formatNumber(g.weight)}×${g.reps[0]} ×${g.reps.length}` : `${formatNumber(g.weight)}×${g.reps.join(',')}`;
  }).join(' · ');
}

/**
 * Readable sets with the unit: "92.5 kg × 5, 5, 6"; "60 kg × 5 · 62.5 kg × 5, 5" when the weight changes.
 * @param {Array<{weight: number, reps: number}>} sets
 * @param {'kg'|'lb'} unit
 * @returns {string}
 */
export function setsLong(sets, unit) {
  return byWeight(sets).map((g) => `${formatWeight(g.weight, unit)} × ${g.reps.join(', ')}`).join(' · ');
}

/**
 * Remember the focused control (by data-fk) so a re-render can put focus back.
 * @returns {string|null}
 */
export function focusKey() {
  const el = document.activeElement;
  return el && el.dataset ? el.dataset.fk || null : null;
}

/**
 * Focus the control with this data-fk after a re-render (no scrolling).
 * @param {Element} root
 * @param {string|null} key
 */
export function restoreFocus(root, key) {
  if (!key) return;
  const el = root.querySelector(`[data-fk="${CSS.escape(key)}"]`);
  if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
}
