// Units, increments, weight steps, rounding, plates and weight formatting — the only place these rules live.

import { equipmentOf, incrementCategory } from './program.js';

/** Kilograms per pound (exact). */
export const KG_PER_LB = 0.45359237;

/** Supported units. */
export const UNITS = ['kg', 'lb'];

/** Weight added per successful session, by increment category and unit. */
export const INCREMENTS = Object.freeze({
  kg: Object.freeze({ upper: 2.5, lower: 2.5, deadlift: 5, accessory: 2.5 }),
  lb: Object.freeze({ upper: 5, lower: 5, deadlift: 10, accessory: 5 }),
});

/** Default step for machines and cables (a plate on the stack): 5 kg / 10 lb (§17.2). */
export const MACHINE_STEP = Object.freeze({ kg: 5, lb: 10 });

/** Equipment whose default step is the machine step. */
const STACKED = new Set(['machine', 'cable']);

/** Converted weights land on multiples of these (0.25 kg / 0.5 lb). */
export const CONVERSION_STEP = Object.freeze({ kg: 0.25, lb: 0.5 });

/**
 * Remove float noise (4 decimals) and normalise -0 to 0.
 * @param {number} v
 * @returns {number}
 */
export function cleanNumber(v) {
  return Math.round(v * 1e4) / 1e4 + 0;
}

/**
 * Increment for a category ('upper' | 'lower' | 'deadlift' | 'accessory') in a unit.
 * Unknown categories use the accessory increment.
 * @param {string} category
 * @param {'kg'|'lb'} unit
 * @returns {number}
 */
export function incrementFor(category, unit) {
  const table = INCREMENTS[unit] || INCREMENTS.kg;
  return table[category] ?? table.accessory;
}

/**
 * A usable weight step (the user's own, from `state.steps`): a finite number > 0.
 * @param {unknown} step
 * @returns {boolean}
 */
export function isValidStep(step) {
  return typeof step === 'number' && Number.isFinite(step) && step > 0;
}

/**
 * The weight step of an exercise — how much an increase adds and a decrease / deload rounds to (§17.2).
 * The user's own step for that exercise (any role) when valid; else the default: a main lift by its category
 * (2.5 kg, deadlift 5 kg / 5 and 10 lb), a machine or cable 5 kg / 10 lb, every other accessory 2.5 kg / 5 lb.
 * @param {string} exerciseId
 * @param {'main'|'accessory'} role
 * @param {'kg'|'lb'} unit
 * @param {Object<string, number>} [steps] the user's steps, keyed by exercise id
 * @returns {number}
 */
export function stepFor(exerciseId, role, unit, steps = {}) {
  const own = steps && typeof steps === 'object' && Object.hasOwn(steps, exerciseId) ? steps[exerciseId] : undefined;
  if (isValidStep(own)) return own;
  if (role !== 'main' && STACKED.has(equipmentOf(exerciseId))) return MACHINE_STEP[unit] ?? MACHINE_STEP.kg;
  return incrementFor(incrementCategory(exerciseId, role), unit);
}

/**
 * Smallest loading step in a unit (2.5 kg / 5 lb) — used for warm-up rounding.
 * @param {'kg'|'lb'} unit
 * @returns {number}
 */
export function smallestIncrement(unit) {
  return Math.min(...Object.values(INCREMENTS[unit] || INCREMENTS.kg));
}

/**
 * Round to the nearest multiple of `step`.
 * @param {number} value
 * @param {number} step
 * @returns {number}
 */
export function roundTo(value, step) {
  return cleanNumber(Math.round(value / step) * step);
}

/**
 * Round down to a multiple of `step`; a 1e-9 epsilon stops float noise from dropping a step.
 * @param {number} value
 * @param {number} step
 * @returns {number}
 */
export function floorTo(value, step) {
  return cleanNumber(Math.floor(value / step + 1e-9) * step);
}

/**
 * Convert a weight between units; results land on 0.25 kg / 0.5 lb. Same unit → unchanged.
 * @param {number} w
 * @param {'kg'|'lb'} from
 * @param {'kg'|'lb'} to
 * @returns {number}
 */
export function convertWeight(w, from, to) {
  if (from === to || !Number.isFinite(w)) return w;
  const raw = to === 'kg' ? w * KG_PER_LB : w / KG_PER_LB;
  return roundTo(raw, CONVERSION_STEP[to]);
}

/**
 * Empty barbell weight: 20 kg / 45 lb (the default for `settings.barWeight`).
 * @param {'kg'|'lb'} unit
 * @returns {number}
 */
export function barWeight(unit) {
  return unit === 'lb' ? 45 : 20;
}

/**
 * A usable bar weight (`settings.barWeight`): a finite number > 0.
 * @param {unknown} w
 * @returns {boolean}
 */
export function isValidBarWeight(w) {
  return typeof w === 'number' && Number.isFinite(w) && w > 0;
}

/**
 * Plain number without trailing ".0" (used wherever a weight is printed without its unit).
 * @param {number} w
 * @returns {string}
 */
export function formatNumber(w) {
  return String(cleanNumber(Number(w) || 0));
}

/**
 * Weight with its unit: "62.5 kg", "100 kg", "135 lb".
 * @param {number} w
 * @param {'kg'|'lb'} unit
 * @returns {string}
 */
export function formatWeight(w, unit) {
  return `${formatNumber(w)} ${unit}`;
}

/**
 * Read a weight typed into a form field. Accepts "62.5" and "62,5" (iOS decimal keypads
 * in some locales type a comma). Empty or invalid → null.
 * @param {string} str
 * @returns {number|null}
 */
export function parseWeightInput(str) {
  const s = String(str ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d*)?$|^\.\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? cleanNumber(n) : null;
}

/**
 * The plate line under a barbell exercise (weights are the total on the bar, bar included, §17.4):
 * "= 20 kg bar + 21.25 kg each side"; equal to the bar → "Empty bar"; below it → "Lighter than the bar — use a
 * lighter bar or dumbbells"; no weight → '' (no line). An unusable `bar` falls back to `barWeight(unit)`.
 * @param {number|null|undefined} total
 * @param {number} bar
 * @param {'kg'|'lb'} unit
 * @returns {string}
 */
export function platesText(total, bar, unit) {
  if (typeof total !== 'number' || !Number.isFinite(total)) return '';
  const b = isValidBarWeight(bar) ? bar : barWeight(unit);
  const side = cleanNumber((total - b) / 2);
  if (side === 0) return 'Empty bar';
  if (side < 0) return 'Lighter than the bar — use a lighter bar or dumbbells';
  return `= ${formatWeight(b, unit)} bar + ${formatWeight(side, unit)} each side`;
}
