// End-to-end scenarios for the PPL Tracker PWA, written from SPEC.md (§3, §5, §11, §12, §14–§18).
// Elements are found only by role + accessible name from §16.3 (plus the one class it names,
// `suggest-headline`). Expected numbers come from the spec's own logic modules where useful.

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { BLANK_PATH, E2EError, PUBLIC_DIR, sleep } from './harness.js';
import { convertWeight, formatNumber } from '../../public/js/units.js';
import { defaultState, STORAGE_KEY } from '../../public/js/store.js';
import { toCSV, CSV_HEADER } from '../../public/js/csv.js';
import { warmupSets } from '../../public/js/progression.js';

// ---------------------------------------------------------------------------------------------
// Constants and small helpers
// ---------------------------------------------------------------------------------------------

const DOT = '\u00b7'; // "·" middle dot, as in "Day 1 of 6 · Pull A"
const DELETE_ALL = 'Delete everything\u2026'; // ends with "…" (U+2026)
const TABS = ['Today', 'Plan', 'Progress', 'History', 'Data'];
const SECTIONS = { role: 'navigation', name: 'Sections' };
const SETUP = { role: 'dialog', name: 'Set your starting weights' };
const MAIN_LIFTS = ['Squat', 'Bench press', 'Deadlift', 'Overhead press', 'Barbell row'];
const D0 = '2026-11-10'; // a Tuesday

const pad = (n) => String(n).padStart(2, '0');
/** Local-calendar day arithmetic (noon, so DST can never move the day). */
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n, 12);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
const dmy = (iso) => iso.split('-').reverse().join('/');
const dmyDash = (iso) => iso.split('-').reverse().join('-');
const weekday = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(y, m - 1, d, 12).getDay()];
};
const at = (iso, time = '09:00') => `${iso}T${time}`;
const historyLabel = (iso, pos, dayName) => `${weekday(iso)} ${dmy(iso)} ${DOT} Day ${pos} ${DOT} ${dayName}`;
const todayHeading = (pos, dayName) => `Day ${pos} of 6 ${DOT} ${dayName}`;
const card = (name) => ({ name });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reps = (...list) => list.map((r) => ({ reps: r }));
const sets = (weight, ...list) => list.map((r) => ({ weight, reps: r }));

function expect(condition, message) {
  if (!condition) throw new E2EError(message);
}
function expectEqual(actual, expected, what) {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new E2EError(`${what}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

/** Comparable form of stored sessions (ids dropped; note/offDay defaults; names only for custom). */
function canon(sessions) {
  return [...(sessions || [])]
    .map((s) => ({
      date: s.date,
      day: s.day,
      offDay: !!s.offDay,
      note: s.note || '',
      entries: (s.entries || []).map((e) => ({
        exerciseId: e.exerciseId,
        ...(String(e.exerciseId).startsWith('custom:') ? { name: e.name } : {}),
        sets: (e.sets || []).map((x) => ({ weight: Number(x.weight), reps: Number(x.reps) })),
      })),
    }))
    .sort((a, b) => (a.date + a.day < b.date + b.day ? -1 : a.date + a.day > b.date + b.day ? 1 : 0));
}

/** A full stored state (spec §8/§14 shape) with these sessions and setup already done. */
function seedState(sessionList, { unit = 'kg', choices = {}, baselines = {} } = {}) {
  const base = defaultState();
  return {
    ...base,
    settings: { ...base.settings, unit, setupDone: true },
    choices,
    baselines,
    sessions: sessionList.map((s, i) => ({ id: `seed-${i + 1}`, offDay: false, note: '', ...s })),
  };
}

const mainEntry = (exerciseId, weight, repList) => ({ exerciseId, sets: repList.map((r) => ({ weight, reps: r })) });

/** One week of the cycle before D0: next workout is Day 6 · Legs, squat last 60 × 5,5,5. */
const SEED_WEEK = [
  { date: '2026-11-01', day: 'pullA', entries: [mainEntry('deadlift', 100, [5])] },
  { date: '2026-11-02', day: 'pushA', entries: [mainEntry('bench', 50, [5, 5, 5, 5, 5])] },
  { date: '2026-11-03', day: 'legs', entries: [mainEntry('squat', 60, [5, 5, 5])] },
  { date: '2026-11-04', day: 'pullB', entries: [mainEntry('barbellRow', 40, [5, 5, 5, 5, 5])] },
  { date: '2026-11-05', day: 'pushB', entries: [mainEntry('ohp', 30, [5, 5, 5, 5, 5])] },
];

/** ~7 weeks of realistic history (every main lift + accessories, one miss, one off day, one note). */
function buildHistory({ start = '2026-09-14', count = 24, gap = 2 } = {}) {
  const ROT = ['pullA', 'pushA', 'legs', 'pullB', 'pushB', 'legs'];
  const MAIN = { pullA: 'deadlift', pushA: 'bench', legs: 'squat', pullB: 'barbellRow', pushB: 'ohp' };
  const SETS = { deadlift: 1, squat: 3 };
  const w = { deadlift: 80, bench: 40, squat: 50, barbellRow: 40, ohp: 25 };
  const inc = { deadlift: 5, bench: 2.5, squat: 2.5, barbellRow: 2.5, ohp: 2.5 };
  let lat = 40;
  let latReps = 8;
  const out = [];
  for (let i = 0; i < count; i++) {
    const day = ROT[i % 6];
    const main = MAIN[day];
    const n = SETS[main] ?? 5;
    const miss = main === 'bench' && i === 13;
    const repList = miss ? [5, 5, 5, 4, 4] : Array.from({ length: n }, (_, k) => (k === n - 1 ? 5 + (i % 3) : 5));
    const entries = [mainEntry(main, w[main], repList)];
    if (!miss) w[main] += inc[main];
    if (day.startsWith('pull')) {
      entries.push({ exerciseId: 'latPulldown', sets: [latReps, latReps, Math.max(8, latReps - 1)].map((r) => ({ weight: lat, reps: r })) });
      latReps += 1;
      if (latReps > 12) { lat += 2.5; latReps = 8; }
      entries.push({ exerciseId: 'facePull', sets: Array.from({ length: 5 }, () => ({ weight: 15, reps: 15 + (i % 5) })) });
    } else if (day.startsWith('push')) {
      entries.push({ exerciseId: 'inclineDbPress', sets: [10, 9, 9].map((r) => ({ weight: 20, reps: r })) });
      entries.push({ exerciseId: 'lateralRaise', sets: [15, 14, 13].map((r) => ({ weight: 8, reps: r })) });
    } else {
      entries.push({ exerciseId: 'rdl', sets: [10, 10, 9].map((r) => ({ weight: 40 + 2.5 * Math.floor(i / 6), reps: r })) });
      entries.push({ exerciseId: 'legPress', sets: [12, 11, 10].map((r) => ({ weight: 80, reps: r })) });
    }
    out.push({ date: addDays(start, i * gap), day, offDay: i === 10, note: i === 7 ? 'Slept badly' : '', entries });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// App flows (only §16.3 names)
// ---------------------------------------------------------------------------------------------

/** Wait until the app has rendered: the tab bar is visible, or a dialog is open over it (first open). */
async function waitNav(t, timeout = 10000) {
  await t.poll((lib) => {
    const navs = [...document.querySelectorAll('nav')].filter((n) => lib.accName(n) === 'Sections');
    if (navs.some(lib.visible)) return { ready: 'nav' };
    if (lib.topDialog()) return { ready: 'dialog' };
    return { pending: true, why: navs.length ? '<nav aria-label="Sections"> exists but is not visible' : 'no <nav aria-label="Sections"> yet' };
  }, [], { timeout, what: 'the app to render (tab bar, or a dialog over it)' });
}

async function openApp(t) {
  await t.goto('/');
  await waitNav(t);
}

/** Fresh profile, pinned clock, first open; `setup` = 'skip' | {<Exercise>: weight} | null (leave dialog). */
async function boot(t, { date = D0, setup = 'skip' } = {}) {
  await t.setClock(at(date));
  t.step('First open');
  await openApp(t);
  if (setup === null) return;
  await t.waitForRole('dialog', SETUP.name, { timeout: 8000 });
  if (setup === 'skip') {
    await t.click('Skip', { within: SETUP });
  } else {
    for (const [name, weight] of Object.entries(setup)) await t.type(`${name} starting weight`, weight, { within: SETUP });
    await t.click('Save', { within: SETUP });
  }
  await t.waitGone('dialog', SETUP.name);
}

/** Write a stored state on a blank same-origin page before the app ever runs, then open the app. */
async function bootSeeded(t, state, { date = D0 } = {}) {
  await t.setClock(at(date));
  t.step('Seed storage');
  await t.goto(BLANK_PATH);
  await t.setStorage(STORAGE_KEY, JSON.stringify(state));
  await openApp(t);
}

/** Move the pinned clock to another day and reopen the app (like opening it the next morning). */
async function moveTo(t, iso) {
  t.step(`Open the app on ${dmy(iso)}`);
  await t.setClock(at(iso));
  await t.reload();
  await waitNav(t);
}

async function goTab(t, name) {
  t.step(`Tab ${name}`);
  await t.click(name, { within: SECTIONS });
  await t.waitAttr('button', name, 'aria-current', 'page', { within: SECTIONS });
  await sleep(80);
}

async function expectToday(t, pos, dayName) {
  await t.waitForHeading(todayHeading(pos, dayName), { timeout: 8000 });
}

/** If the starting-weights dialog pops up (e.g. after deleting all data), skip it. */
async function skipSetupIfShown(t, waitMs = 1200) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (await t.exists('dialog', SETUP.name)) {
      await t.click('Skip', { within: SETUP });
      await t.waitGone('dialog', SETUP.name);
      return true;
    }
    await sleep(100);
  }
  return false;
}

/**
 * Tap a collapsed card/article so it opens: an [aria-expanded="false"] control, a <summary>,
 * a header button, or the container's top edge (spec: "any card opens when tapped").
 */
async function expand(t, container) {
  const r = await t.poll((lib, c) => {
    const root = lib.scope(c);
    if (!root) return { pending: true, why: 'container not visible' };
    root.scrollIntoView({ block: 'center', behavior: 'instant' });
    const skip = new Set(['Swap', 'Set weight', '+ Set', '\u2212 Set', 'Edit', 'Delete']);
    const cand = [...root.querySelectorAll('[aria-expanded="false"]')].find(lib.visible)
      || (root.getAttribute('aria-expanded') === 'false' ? root : null)
      || [...root.querySelectorAll('summary')].find(lib.visible)
      || [...root.querySelectorAll('button,[role="button"]')].find((b) => lib.visible(b) && !skip.has(lib.accName(b)))
      || root;
    if (cand === root) {
      const rect = root.getBoundingClientRect();
      const x = rect.left + Math.min(rect.width / 2, 120);
      const y = rect.top + Math.min(rect.height / 2, 22);
      const hit = document.elementFromPoint(x, y);
      if (hit && root.contains(hit) && !hit.closest('input,textarea,select,button,a')) return { x, y };
      root.click();
      return { dom: true };
    }
    const c2 = lib.center(cand);
    if (!c2.hit) { cand.click(); return { dom: true }; }
    return c2;
  }, [container], { what: `${container.role || 'card'} ${JSON.stringify(container.name)} to be tappable` });
  if (!r.dom) await t.mouseClick(r.x, r.y);
  await sleep(150);
}

/** Wait for a visible element labelled `name` (aria-label / aria-labelledby), e.g. a Today card. */
async function waitCard(t, name) {
  await t.poll((lib, n) => (lib.scope({ name: n }) ? { ok: true } : { pending: true, why: 'no visible element with that aria-label' }), [name], { what: `card ${JSON.stringify(name)}` });
}

/** Make sure a Today card shows its set rows (probe field visible), tapping it open if needed. */
async function openCard(t, name, probe = 'Set 1 reps') {
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitCard(t, name);
    if (await t.fieldVisible(probe, { within: card(name) })) return;
    await expand(t, card(name));
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      if (await t.fieldVisible(probe, { within: card(name) })) return;
      await sleep(100);
    }
  }
  throw new E2EError(`Card "${name}" never showed a field named "${probe}" (tapped it twice)\n${await t.describe()}`);
}

/** Type sets into a Today card ({weight?, reps?} per set; weight omitted = keep the pre-fill). */
async function fillSets(t, name, setList) {
  t.step(`Fill ${name}`);
  await openCard(t, name);
  for (let i = 0; i < setList.length; i++) {
    const n = i + 1;
    if (!(await t.fieldVisible(`Set ${n} reps`, { within: card(name) }))) await t.click('+ Set', { within: card(name) });
    if (setList[i].weight != null) await t.type(`Set ${n} weight`, setList[i].weight, { within: card(name) });
    if (setList[i].reps != null) await t.type(`Set ${n} reps`, setList[i].reps, { within: card(name) });
  }
}

/** Click a button inside a container, opening the container first if the button is hidden. */
async function clickInside(t, container, button, opts = {}) {
  if (!(await t.exists('button', button, { within: container, index: opts.index }))) await expand(t, container);
  await t.click(button, { within: container, ...opts });
}

/**
 * Save a new workout. §18.5 (20/11/2026) puts a "Workout saved" sheet over the screen after Save; it is closed here
 * (Nice) whenever it shows, so the older scenarios keep going. The b2-* scenarios check the sheet itself.
 * The toast stays (§16.2).
 */
async function saveWorkout(t, dayName, iso) {
  t.step(`Save workout (${dayName} ${dmy(iso)})`);
  await t.clearStatusLog();
  await t.click('Save workout', { within: 'document' });
  await closeSavedSheet(t, { required: false });
  await t.waitForStatus(`Saved ${dayName} ${DOT} ${dmy(iso)}`, { timeout: 8000 });
}

/** Log one workout: check the Today heading, fill the cards, save. */
async function logDay(t, { iso, pos, dayName, entries }) {
  t.step(`Log ${todayHeading(pos, dayName)} on ${dmy(iso)}`);
  await expectToday(t, pos, dayName);
  for (const [name, setList] of entries) await fillSets(t, name, setList);
  await saveWorkout(t, dayName, iso);
}

async function waitHeadline(t, cardName, matcher) {
  const m = matcher instanceof RegExp ? { regex: matcher.source, flags: matcher.flags } : typeof matcher === 'string' ? { exact: matcher } : matcher;
  const r = await t.poll((lib, name, mm) => {
    const sec = lib.scope({ name });
    if (!sec) return { pending: true, why: `no visible card named ${JSON.stringify(name)}` };
    const h = sec.querySelector('.suggest-headline');
    if (!h) return { pending: true, why: 'the card has no .suggest-headline element' };
    const text = lib.norm(h.textContent);
    return lib.matches(text, mm) ? { text } : { pending: true, why: `headline is ${JSON.stringify(text)}` };
  }, [cardName, m], { what: `the suggestion headline of "${cardName}" to be ${matcher instanceof RegExp ? matcher : JSON.stringify(matcher)}` });
  return r.text;
}

async function expectSetWeights(t, name, weight, count) {
  for (let n = 1; n <= count; n++) {
    const v = await t.value(`Set ${n} weight`, { within: card(name) });
    expect(Number(v) === weight && v.trim() !== '', `${name} "Set ${n} weight" should be pre-filled with ${weight}, got ${JSON.stringify(v)}`);
  }
}

/** Click an option in a sheet whose accessible name starts with `text` (button / option / radio …). */
async function clickOption(t, text, within) {
  const found = await t.poll((lib, txt, w) => {
    for (const role of ['button', 'option', 'radio', 'menuitemradio', 'menuitem', 'link', 'listitem', 'checkbox']) {
      if (lib.findAll({ role, name: { startsWith: txt }, within: w }).length) return { role };
    }
    return { pending: true, why: 'no button/option with that name' };
  }, [text, within], { what: `an option starting with "${text}" in ${JSON.stringify(within.name)}` });
  await t.click({ startsWith: text }, { role: found.role, within });
}

/** Click the confirming button of the top dialog (prefers names like Convert/Yes/Delete/Replace). */
async function confirmTopDialog(t, prefer = /^(convert|yes|ok|confirm|switch|change|replace|delete|continue|save)\b/i) {
  const r = await t.poll((lib, re) => {
    const d = lib.topDialog();
    if (!d) return { pending: true, why: 'no dialog open' };
    const buttons = [...d.querySelectorAll('button,[role="button"]')].filter(lib.visible).map((b) => lib.accName(b));
    const want = buttons.find((n) => new RegExp(re.regex, re.flags).test(n)) || buttons.find((n) => !/^(cancel|close|no|back|done|not now)\b/i.test(n));
    return want ? { name: want, dialog: d.getAttribute('aria-label') || '', buttons } : { pending: true, why: `buttons: ${JSON.stringify(buttons)}` };
  }, [{ regex: prefer.source, flags: prefer.flags }], { what: 'a confirm button in the open dialog' });
  await t.click(r.name);
  return r;
}

async function expectNoNaN(t, where) {
  const r = await t.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg')].map((s) => s.outerHTML);
    return { text: document.body.innerText.match(/.{0,40}\b(NaN|Infinity|undefined)\b.{0,40}/)?.[0] || null,
      svg: svgs.map((h) => h.match(/.{0,60}(NaN|Infinity).{0,30}/)?.[0]).find(Boolean) || null };
  });
  expect(!r.text, `${where}: page text shows ${JSON.stringify(r.text)}`);
  expect(!r.svg, `${where}: an SVG contains NaN/Infinity: ${JSON.stringify(r.svg)}`);
}

async function waitCharts(t, where) {
  return t.poll(() => {
    const svgs = [...document.querySelectorAll('svg[role="img"]')].filter((s) => s.getBoundingClientRect().width > 0);
    if (!svgs.length) return { pending: true, why: 'no visible svg[role="img"]' };
    const unlabeled = svgs.filter((s) => !(s.getAttribute('aria-label') || '').trim()).length;
    return unlabeled ? { pending: true, why: `${unlabeled} chart(s) without aria-label` } : { count: svgs.length, labels: svgs.map((s) => s.getAttribute('aria-label')) };
  }, [], { what: `${where}: at least one visible <svg role="img" aria-label="…">` });
}

async function expectNoXss(t, where) {
  const r = await t.evaluate(() => ({
    flag: typeof window.__xss === 'undefined' ? null : String(window.__xss),
    injected: [...document.querySelectorAll('[onerror],[onload],img[src="x"]')].map((e) => e.outerHTML.slice(0, 80)),
  }));
  expect(r.flag === null, `${where}: injected markup ran (window.__xss = ${r.flag})`);
  expect(r.injected.length === 0, `${where}: user text became live HTML: ${JSON.stringify(r.injected)}`);
}

/** Every input/textarea/select (text-entry kinds) has computed font-size ≥ 16px. */
async function expectInputFonts(t, where) {
  const r = await t.evaluate((lib) => {
    const skip = new Set(['hidden', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'button', 'reset', 'image']);
    const bad = [];
    let checked = 0;
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (el.tagName === 'INPUT' && skip.has((el.getAttribute('type') || 'text').toLowerCase())) continue;
      checked++;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (!(size >= 16)) bad.push(`${lib.accName(el) || el.outerHTML.slice(0, 60)}: ${size}px`);
    }
    return { checked, bad };
  });
  expect(r.bad.length === 0, `${where}: inputs under 16px (iOS zooms on focus): ${JSON.stringify(r.bad)}`);
  return r.checked;
}

/**
 * Each named button must answer taps over at least 44×44 px around its centre (§11; the hit area may be
 * an invisible extension): the points 21 px left/right/up/down of the centre must all hit the button.
 */
async function expectTapTargets(t, where, names, { within } = {}) {
  const bad = await t.evaluate((lib, list, w) => {
    const out = [];
    for (const name of list) {
      const el = lib.findOne({ role: 'button', name: { exact: name }, within: w });
      if (!el) { out.push(`${name}: not found`); continue; }
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const miss = [[-21, 0], [21, 0], [0, -21], [0, 21]].filter(([dx, dy]) => {
        const hit = document.elementFromPoint(cx + dx, cy + dy);
        return !(hit && (hit === el || el.contains(hit)));
      });
      if (miss.length) out.push(`${name} (${Math.round(r.width)}×${Math.round(r.height)}px; misses at ${miss.map((m) => m.join(',')).join(' ')})`);
    }
    return out;
  }, names, within ? { name: within } : null);
  expect(bad.length === 0, `${where}: tap targets under 44×44 px: ${JSON.stringify(bad)}`);
}

/** The page must not scroll sideways (a long name pushing buttons off-screen). */
async function expectNoSideScroll(t, where) {
  const r = await t.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const off = [...document.querySelectorAll('button, input')].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.right > W + 1;
    }).map((e) => e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30));
    return { sw: document.documentElement.scrollWidth, W, off };
  });
  expect(r.sw <= r.W + 1 && r.off.length === 0, `${where}: page is ${r.sw}px wide in a ${r.W}px screen; controls off-screen: ${JSON.stringify(r.off.slice(0, 6))}`);
}

// ---------------------------------------------------------------------------------------------
// Batch 1 helpers (§17)
// ---------------------------------------------------------------------------------------------

/** seedState plus Batch 1 fields: settings overrides (abs, barWeight …) and `steps`. */
function seedStateWith(sessionList, { settings = {}, steps, ...rest } = {}) {
  const s = seedState(sessionList, rest);
  return { ...s, settings: { ...s.settings, ...settings }, ...(steps ? { steps } : {}) };
}

/**
 * The index-th visible card whose aria-label starts with `prefix` (DOM order), for exercises that appear
 * twice on a day (two "Lateral raise" cards). Serialisable, so it works in t.* calls and in-page scopes.
 */
const nthCard = (prefix, index) => ({ name: { regex: `^${escapeRe(prefix)}` }, index });

/** Wait for the `.suggest-headline` text of the card at `within` (an nthCard / {name}) to match. */
async function waitHeadlineWithin(t, within, matcher, label) {
  const m = matcher instanceof RegExp ? { regex: matcher.source, flags: matcher.flags } : typeof matcher === 'string' ? { exact: matcher } : matcher;
  const r = await t.poll((lib, w, mm) => {
    const sec = lib.scope(w);
    if (!sec) return { pending: true, why: 'no such visible card' };
    const h = sec.querySelector('.suggest-headline');
    if (!h) return { pending: true, why: 'the card has no .suggest-headline element' };
    const text = lib.norm(h.textContent);
    return lib.matches(text, mm) ? { text } : { pending: true, why: `headline is ${JSON.stringify(text)}` };
  }, [within, m], { what: `the suggestion headline of ${label} to be ${matcher instanceof RegExp ? matcher : JSON.stringify(matcher)}` });
  return r.text;
}

/** Open the card at `within` (tapping it open if needed) until its "Set 1 reps" box shows. */
async function openCardWithin(t, within, label, probe = 'Set 1 reps') {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await t.fieldVisible(probe, { within })) return;
    await expand(t, within);
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      if (await t.fieldVisible(probe, { within })) return;
      await sleep(100);
    }
  }
  throw new E2EError(`${label} never showed a field named "${probe}"\n${await t.describe()}`);
}

async function expectSetWeightsWithin(t, within, label, weight, count) {
  for (let n = 1; n <= count; n++) {
    const v = await t.value(`Set ${n} weight`, { within });
    expect(Number(v) === weight && v.trim() !== '', `${label} "Set ${n} weight" should be pre-filled with ${weight}, got ${JSON.stringify(v)}`);
  }
}

/** Poll the stored state until `check(state)` is true (saves may be debounced). */
async function waitStored(t, what, check, timeout = 4000) {
  const until = Date.now() + timeout;
  let st = null;
  while (Date.now() < until) {
    st = await t.getJSON(STORAGE_KEY);
    if (st && check(st)) return st;
    await sleep(100);
  }
  throw new E2EError(`Stored state never showed ${what}; last stored: ${JSON.stringify(st && { settings: st.settings, steps: st.steps, choices: st.choices }).slice(0, 400)}`);
}

/** Pick a workout from "Doing a different workout? Change". */
async function pickDay(t, label) {
  t.step(`Pick ${label}`);
  await t.click('Change', { within: 'document' });
  await t.waitForRole('dialog', 'Choose the workout');
  await clickOption(t, label, { role: 'dialog', name: 'Choose the workout' });
  await t.waitGone('dialog', 'Choose the workout');
}

/** Like clickInside, but the button itself is pressed with a real touch tap. */
async function tapInside(t, container, button, opts = {}) {
  if (!(await t.exists('button', button, { within: container, index: opts.index }))) await expand(t, container);
  await t.tap(button, { within: container, ...opts });
}

/** A text box (input/textarea/contenteditable) has focus — on iPhone that means the keyboard is up. */
const focusedTextEntry = (t) => t.evaluate((lib) => {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  if (a.isContentEditable || lib.isTextEntry(a)) return `${a.tagName.toLowerCase()} "${lib.accName(a) || a.getAttribute('placeholder') || ''}"`;
  return null;
});

/** Every named option button in the dialog is at least `min` px tall (§17.5: ≥ 48 px rows). */
async function expectOptionHeights(t, dialogName, names, min = 48) {
  const bad = await t.evaluate((lib, dn, list, mn) => {
    const d = lib.dialogs().find((x) => lib.accName(x) === dn);
    if (!d) return [`dialog "${dn}" not found`];
    const buttons = [...d.querySelectorAll('button,[role="button"],[role="option"],[role="radio"]')].filter(lib.visible);
    const out = [];
    for (const n of list) {
      const b = buttons.find((x) => lib.accName(x) === n) || buttons.find((x) => lib.accName(x).startsWith(n));
      if (!b) { out.push(`${n}: not found`); continue; }
      const h = b.getBoundingClientRect().height;
      if (h < mn) out.push(`${n}: ${Math.round(h)}px`);
    }
    return out;
  }, dialogName, names, min);
  expect(bad.length === 0, `"${dialogName}" option rows must be ≥ ${min}px tall buttons (§17.5): ${JSON.stringify(bad)}`);
}

/** The card is fully on screen (or, if taller than the screen, fills it). */
async function expectCardInViewport(t, name) {
  await t.poll((lib, n) => {
    const sec = lib.scope({ name: n });
    if (!sec) return { pending: true, why: 'card not visible' };
    const r = sec.getBoundingClientRect();
    const ok = r.height <= innerHeight ? r.top >= -1 && r.bottom <= innerHeight + 1 : r.top <= 1 && r.bottom >= innerHeight - 1;
    return ok ? { ok: true } : { pending: true, why: `card spans ${Math.round(r.top)}–${Math.round(r.bottom)}px of a ${innerHeight}px screen` };
  }, [name], { timeout: 4000, what: `the new "${name}" card to be scrolled into view` });
}

/** Cards on Today (sections with an aria-label), counted in the DOM even while a sheet makes them inert. */
const cardCount = (t) => t.evaluate(() => document.querySelectorAll('section[aria-label]').length);

// ---------------------------------------------------------------------------------------------
// Batch 2 helpers (§18)
// ---------------------------------------------------------------------------------------------

const DONE = 'Done for today ✓'; // "Done for today ✓" (§18.4)
const SAVED = { role: 'dialog', name: 'Workout saved' }; // §18.5
const TIMER = { role: 'timer', name: 'Rest timer' }; // §18.1
const hm = (local) => local.slice(11, 16); // "2026-11-10T09:25" → "09:25"
const clockMinutes = (local) => Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
/** Workout times by date|day, for comparing before / after a round trip. */
const timesByKey = (list) => Object.fromEntries((list || []).map((s) => [`${s.date}|${s.day}`, [s.startedAt ?? null, s.finishedAt ?? null]]));

/**
 * Close the "Workout saved" sheet with Nice. `required`: it must open. Otherwise it is closed only when it shows up
 * within ~1.5 s (the shared save helper, and Save → Replace, which the spec does not call a "new workout").
 */
async function closeSavedSheet(t, { required = true } = {}) {
  if (required) {
    await t.waitForRole('dialog', SAVED.name, { timeout: 8000 });
  } else {
    const until = Date.now() + 1500;
    while (Date.now() < until && !(await t.exists('dialog', SAVED.name))) await sleep(100);
    if (!(await t.exists('dialog', SAVED.name))) return false;
  }
  await t.click('Nice', { within: SAVED });
  await t.waitGone('dialog', SAVED.name);
  return true;
}

/** Today shows "Done for today ✓" (§18.4): the heading, "Start it now instead", "Up next" naming the next workout, no form. */
async function expectDone(t, nextDayName) {
  await t.waitForHeading(DONE, { timeout: 8000 });
  await t.waitForRole('button', 'Start it now instead', { within: 'document' });
  if (nextDayName) await t.waitForText(new RegExp(`Up next.*${escapeRe(nextDayName)}`));
  expect(!(await t.exists('button', 'Save workout', { within: 'document' })), `"${DONE}" replaces the workout form, but "Save workout" is showing`);
}

/** If Today shows "Done for today ✓", press "Start it now instead" (for flows that keep logging on the same day). */
async function ensureForm(t) {
  await sleep(300);
  if (await t.exists('button', 'Start it now instead', { within: 'document' })) await t.click('Start it now instead', { within: 'document' });
}

/** Wait until the text content of `within` (shown or folded away, e.g. a closed History card) contains `text`. */
async function waitFullText(t, text, within, what) {
  await t.poll((lib, s, w) => {
    const root = lib.scope(w);
    if (!root) return { pending: true, why: 'container not found' };
    const tx = lib.norm(root.textContent);
    return tx.includes(s) ? { ok: true } : { pending: true, why: `text is ${JSON.stringify(tx.slice(0, 300))}` };
  }, [text, within], { what: what || `${JSON.stringify(text)} in ${JSON.stringify(within)}` });
}

/** Wait until the visible text of `within` no longer contains `text`. */
async function waitNoText(t, text, within, what) {
  await t.poll((lib, s, w) => {
    const root = lib.scope(w);
    if (!root) return { pending: true, why: 'container not found' };
    const tx = lib.norm(root.innerText);
    return tx.includes(s) ? { pending: true, why: `still says ${JSON.stringify(s)}: ${JSON.stringify(tx.slice(0, 240))}` } : { ok: true };
  }, [text, within], { what });
}

/**
 * Type into a field firing only `input` (focus stays, nothing is committed yet), so the test can commit
 * with Enter. `within` uses the in-page form, e.g. { name: 'Squat' }.
 */
async function typeNoCommit(t, fieldName, value, within) {
  await t.poll((lib, q, v) => {
    const el = lib.findOne(q);
    if (!el) return { pending: true, why: 'field not found (or not visible)' };
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true };
  }, [{ field: true, name: fieldName, within }, String(value)], { what: `field "${fieldName}" in ${JSON.stringify(within)}` });
  t.trail.push(`type (no commit) ${fieldName} = ${value}`);
  await sleep(60);
}

/** Where the Rest timer is: how many exist, the card holding it, and the set rows it sits between (DOM order). */
const timerPlace = (t) => t.evaluate((lib) => {
  const timers = lib.findAll({ role: 'timer', name: 'Rest timer', within: 'document' });
  if (timers.length !== 1) return { count: timers.length };
  const tm = timers[0];
  const sec = tm.closest('section[aria-label]');
  let after = null;
  let before = null;
  for (const inp of sec ? [...sec.querySelectorAll('input')] : []) {
    const m = /^Set (\d+) reps$/.exec(lib.accName(inp));
    if (!m) continue;
    if (inp.compareDocumentPosition(tm) & Node.DOCUMENT_POSITION_FOLLOWING) after = Number(m[1]);
    else if (before == null) before = Number(m[1]);
  }
  return { count: 1, card: sec ? sec.getAttribute('aria-label') : null, after, before, text: lib.norm(tm.innerText) };
});

/** Wait until exactly one Rest timer sits in `cardName` right under set `after` (and above set `before`, null = last set). */
async function waitTimerAt(t, cardName, after, before, what) {
  const deadline = Date.now() + 6000;
  let p;
  for (;;) {
    p = await timerPlace(t);
    if (p.count === 1 && p.card === cardName && p.after === after && p.before === before) return p;
    if (Date.now() > deadline) {
      throw new E2EError(`${what}: expected one role="timer" "Rest timer" inside "${cardName}" right under set ${after}${before ? ` (above set ${before})` : ''}; got ${JSON.stringify(p)}\n${await t.describe()}`);
    }
    await sleep(100);
  }
}

/** Pin the clock to an absolute time (ms) and reload — "the app is opened again later". */
async function jumpTo(t, ms, label) {
  const d = new Date(ms);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  t.step(`Clock → ${stamp} (${label}), reload`);
  await t.setClock(stamp);
  await t.reload();
  await waitNav(t);
}

/** "Warm-up 20 × 10" — the checkbox label of a warm-up set (§18.2). */
const warmupLabel = (w, r) => `Warm-up ${formatNumber(w)} × ${r}`;

/** The warm-up checkboxes of a Today card, in order. */
const warmupBoxes = (t, cardName) => t.evaluate((lib, n) => {
  const sec = lib.scope({ name: n });
  if (!sec) return null;
  return [...sec.querySelectorAll('input[type="checkbox"], [role="checkbox"]')]
    .filter((el) => lib.accName(el).startsWith('Warm-up'))
    .map((el) => ({ name: lib.accName(el), checked: el.tagName === 'INPUT' ? el.checked : el.getAttribute('aria-checked') === 'true' }));
}, cardName);

/**
 * Wait until the card's warm-up checklist is exactly `ramp` ([{weight, reps}], checkbox names "Warm-up W × R", an
 * extra word after it such as "empty bar" allowed) and, when given, the ticks equal `checked`.
 */
async function expectWarmups(t, cardName, ramp, checked = null, what = '') {
  const want = ramp.map((s) => warmupLabel(s.weight, s.reps));
  const deadline = Date.now() + 6000;
  let boxes;
  for (;;) {
    boxes = await warmupBoxes(t, cardName);
    const namesOk = !!boxes && boxes.length === want.length
      && boxes.every((b, i) => b.name.startsWith(want[i]) && !/^[\d.]/.test(b.name.slice(want[i].length)));
    const ticksOk = !checked || (!!boxes && boxes.length === checked.length && boxes.every((b, i) => b.checked === checked[i]));
    if (namesOk && ticksOk) return boxes;
    if (Date.now() > deadline) {
      throw new E2EError(`"${cardName}" warm-up checklist${what ? ` (${what})` : ''}: expected checkboxes ${JSON.stringify(want)}${checked ? ` ticked ${JSON.stringify(checked)}` : ''}; got ${JSON.stringify(boxes)}`);
    }
    await sleep(100);
  }
}

/** Tick (or untick) the index-th warm-up checkbox of a card: a click at its centre, or el.click() when it is styled away. */
async function tickWarmup(t, cardName, index) {
  const pos = await t.evaluate((lib, n, i) => {
    const sec = lib.scope({ name: n });
    const el = sec && [...sec.querySelectorAll('input[type="checkbox"], [role="checkbox"]')].filter((x) => lib.accName(x).startsWith('Warm-up'))[i];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const c = lib.center(el);
    if (!lib.visible(el) || !c.hit) { el.click(); return { dom: true }; }
    return c;
  }, cardName, index);
  if (!pos) throw new E2EError(`"${cardName}" has no warm-up checkbox #${index + 1}\n${await t.describe()}`);
  if (!pos.dom) await t.mouseClick(pos.x, pos.y);
  t.trail.push(`tick warm-up #${index + 1} of ${cardName}`);
  await sleep(150);
}

/** "best" tags in a text, not counting the words of the "🏆 N new best(s)" pill. */
const bestTags = (text) => (String(text).replace(/\bnew bests?\b/gi, '').match(/\bbest\b/gi) || []).length;

/** The checked state of a switch named `name` (null when not found). */
const switchState = (t, name) => t.evaluate((lib, n) => {
  const el = lib.findOne({ role: 'switch', name: n, within: 'document' });
  if (!el) return null;
  return el.tagName === 'INPUT' ? el.checked : el.getAttribute('aria-checked') === 'true';
}, name);

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------

export const scenarios = [
  {
    id: 'first-open',
    title: 'First open → "Set your starting weights" → Squat 60 → Day 1 of 6 · Pull A, Deadlift "First time"',
    async run(t) {
      await boot(t, { setup: null });
      t.step('Starting-weights dialog');
      await t.waitForRole('dialog', SETUP.name, { timeout: 8000 });
      expectEqual(await t.attr('dialog', SETUP.name, 'aria-modal'), 'true', 'Setup dialog aria-modal');
      for (const lift of MAIN_LIFTS) {
        const v = await t.value(`${lift} starting weight`, { within: SETUP });
        expectEqual(v, '', `"${lift} starting weight" should start empty`);
      }
      await t.waitForRole('button', 'Skip', { within: SETUP });
      await t.screenshot('first-open-light');
      await t.type('Squat starting weight', 60, { within: SETUP });
      await t.click('Save', { within: SETUP });
      await t.waitGone('dialog', SETUP.name);

      t.step('Today after setup');
      await expectToday(t, 1, 'Pull A');
      await waitHeadline(t, 'Deadlift', 'First time');
      const deadliftText = await t.text({ within: card('Deadlift') });
      expect(/Main lift/.test(deadliftText), `Deadlift card should contain "Main lift"; text: ${JSON.stringify(deadliftText.slice(0, 200))}`);
      const state = await t.getJSON(STORAGE_KEY);
      expect(state?.settings?.setupDone === true, `settings.setupDone should be true after Save (got ${JSON.stringify(state?.settings)})`);
      expectEqual(state?.baselines?.['squat|main']?.weight, 60, 'baselines["squat|main"].weight after setting Squat 60');
      expectEqual(Object.keys(state?.baselines || {}).length, 1, 'only the filled box becomes a set weight');

      t.step('Tab bar contract');
      expectEqual(await t.names('button', { within: SECTIONS }), TABS, 'Bottom tab buttons inside <nav aria-label="Sections">');
      await t.waitAttr('button', 'Today', 'aria-current', 'page', { within: SECTIONS });
      expect(await t.exists('switch', 'Off day', { includeHidden: true }), 'Today needs <input type="checkbox" role="switch" aria-label="Off day">');
      for (const b of ['Save workout', 'Change date', 'Change']) await t.waitForRole('button', b, { within: 'document' });

      t.step('Empty Progress has no NaN');
      await goTab(t, 'Progress');
      await t.waitForText('No data yet');
      await expectNoNaN(t, 'Progress (no data)');

      t.step('Reload: dialog does not come back');
      await t.reload();
      await waitNav(t);
      await goTab(t, 'Today');
      await expectToday(t, 1, 'Pull A');
      await sleep(400);
      expect(!(await t.exists('dialog', SETUP.name)), 'Setup dialog must not reappear once Save was pressed');
    },
  },

  {
    id: 'log-cycle-baseline',
    title: 'Log Day 1 → toast, History, Day 2; walk to Day 3 Legs (Squat pre-filled 60 "Weight you set: 60 kg") → used up → Day 6 suggests 62.5',
    timeout: 180000,
    async run(t) {
      await boot(t, { setup: { Squat: 60 } });
      await logDay(t, { iso: D0, pos: 1, dayName: 'Pull A', entries: [['Deadlift', sets(100, 5)]] });

      // Changed for §18.4 (20/11/2026): after saving today's workout Today shows "Done for today ✓" with the next
      // workout under "Up next" (it used to show the next workout's form straight away).
      t.step('Done for today; Up next is Push A');
      await expectDone(t, 'Push A');
      await goTab(t, 'History');
      await t.waitForRole('article', historyLabel(D0, 1, 'Pull A'));
      await goTab(t, 'Today');
      await expectDone(t, 'Push A');

      const d1 = addDays(D0, 1);
      await moveTo(t, d1);
      await logDay(t, { iso: d1, pos: 2, dayName: 'Push A', entries: [['Bench press', sets(50, 5, 5, 5, 5, 5)]] });

      const d2 = addDays(D0, 2);
      await moveTo(t, d2);
      t.step('Day 3 Legs uses the set weight');
      await expectToday(t, 3, 'Legs');
      await openCard(t, 'Squat');
      await waitHeadline(t, 'Squat', 'Weight you set: 60 kg');
      await expectSetWeights(t, 'Squat', 60, 3);
      await fillSets(t, 'Squat', reps(5, 5, 5));
      await saveWorkout(t, 'Legs', d2);
      const afterLegs = await t.getJSON(STORAGE_KEY);
      expect(!afterLegs.baselines?.['squat|main'], `The Squat set weight should be used up after saving; baselines = ${JSON.stringify(afterLegs.baselines)}`);
      const legsSession = afterLegs.sessions.find((s) => s.date === d2 && s.day === 'legs');
      expectEqual(legsSession?.entries?.find((e) => e.exerciseId === 'squat')?.sets, sets(60, 5, 5, 5), 'Saved squat sets');

      const d3 = addDays(D0, 3);
      await moveTo(t, d3);
      await logDay(t, { iso: d3, pos: 4, dayName: 'Pull B', entries: [['Barbell row', sets(40, 5, 5, 5, 5, 5)]] });
      const d4 = addDays(D0, 4);
      await moveTo(t, d4);
      await logDay(t, { iso: d4, pos: 5, dayName: 'Push B', entries: [['Overhead press', sets(30, 5, 5, 5, 5, 5)]] });

      const d5 = addDays(D0, 5);
      await moveTo(t, d5);
      t.step('Day 6 Legs: normal progression again');
      await expectToday(t, 6, 'Legs');
      await waitHeadline(t, 'Squat', `Add 2.5 kg today \u2192 62.5 kg`);
      await openCard(t, 'Squat');
      await expectSetWeights(t, 'Squat', 62.5, 1);

      t.step('History shows the cycle positions');
      await goTab(t, 'History');
      await t.waitForRole('article', historyLabel(d4, 5, 'Push B'));
      expectEqual(await t.names('article'), [
        historyLabel(d4, 5, 'Push B'), historyLabel(d3, 4, 'Pull B'), historyLabel(d2, 3, 'Legs'),
        historyLabel(d1, 2, 'Push A'), historyLabel(D0, 1, 'Pull A'),
      ], 'History articles, newest first');
    },
  },

  {
    id: 'set-weight-once',
    title: 'Set weight once: Legs day, Squat → 70 shows "Weight you set: 70 kg"; save; next legs day suggests 72.5',
    timeout: 150000,
    async run(t) {
      await bootSeeded(t, seedState(SEED_WEEK));
      await expectToday(t, 6, 'Legs');
      await waitHeadline(t, 'Squat', `Add 2.5 kg today \u2192 62.5 kg`);

      t.step('Set weight sheet');
      const SHEET = { role: 'dialog', name: 'Set weight: Squat' };
      await clickInside(t, card('Squat'), 'Set weight');
      await t.waitForRole('dialog', SHEET.name);
      expectEqual(await t.attr('dialog', SHEET.name, 'aria-modal'), 'true', 'Set weight sheet aria-modal');
      expect(!(await t.exists('button', 'Clear', { within: SHEET })), '"Clear" should only show when a weight is set');
      await t.waitForText('Used for your next session only', { within: SHEET });
      await t.type('Weight (kg)', 70, { within: SHEET });
      await t.click('Save', { within: SHEET });
      await t.waitGone('dialog', SHEET.name);

      t.step('Card uses 70');
      await waitHeadline(t, 'Squat', 'Weight you set: 70 kg');
      await openCard(t, 'Squat');
      await expectSetWeights(t, 'Squat', 70, 3);
      const st = await t.getJSON(STORAGE_KEY);
      expectEqual(st.baselines?.['squat|main']?.weight, 70, 'baselines["squat|main"].weight');

      t.step('Clear shows now; Escape closes the sheet');
      await clickInside(t, card('Squat'), 'Set weight');
      await t.waitForRole('dialog', SHEET.name);
      await t.waitForRole('button', 'Clear', { within: SHEET });
      await t.press('Escape');
      await t.waitGone('dialog', SHEET.name);
      await waitHeadline(t, 'Squat', 'Weight you set: 70 kg');

      await fillSets(t, 'Squat', reps(5, 5, 5));
      await saveWorkout(t, 'Legs', D0);
      const after = await t.getJSON(STORAGE_KEY);
      expect(!after.baselines?.['squat|main'], `Set weight should be used up after saving; baselines = ${JSON.stringify(after.baselines)}`);
      const saved = after.sessions.find((s) => s.date === D0 && s.day === 'legs');
      expectEqual(saved?.entries?.find((e) => e.exerciseId === 'squat')?.sets, sets(70, 5, 5, 5), 'Saved squat sets at the set weight');

      const d1 = addDays(D0, 1);
      await moveTo(t, d1);
      await logDay(t, { iso: d1, pos: 1, dayName: 'Pull A', entries: [['Deadlift', reps(5)]] });
      const d2 = addDays(D0, 2);
      await moveTo(t, d2);
      await logDay(t, { iso: d2, pos: 2, dayName: 'Push A', entries: [['Bench press', reps(5, 5, 5, 5, 5)]] });
      const d3 = addDays(D0, 3);
      await moveTo(t, d3);
      t.step('Next legs day');
      await expectToday(t, 3, 'Legs');
      await waitHeadline(t, 'Squat', `Add 2.5 kg today \u2192 72.5 kg`);
      await openCard(t, 'Squat');
      await expectSetWeights(t, 'Squat', 72.5, 3);
    },
  },

  {
    id: 'skipped-days',
    title: 'Skipped calendar days change nothing: the next workout follows the last logged one',
    timeout: 120000,
    async run(t) {
      await boot(t);
      await logDay(t, { iso: D0, pos: 1, dayName: 'Pull A', entries: [['Deadlift', sets(100, 5)]] });
      const later = addDays(D0, 6);
      await moveTo(t, later);
      await expectToday(t, 2, 'Push A');
      await t.waitForText(dmy(later));
      const text = await t.text();
      expect(!/missed/i.test(text), `No "missed workout" wording allowed; Today says: ${JSON.stringify(text.match(/.{0,40}missed.{0,40}/i)?.[0])}`);
      await logDay(t, { iso: later, pos: 2, dayName: 'Push A', entries: [['Bench press', sets(50, 5, 5, 5, 5, 5)]] });
      const muchLater = addDays(later, 14);
      await moveTo(t, muchLater);
      await expectToday(t, 3, 'Legs');
      await goTab(t, 'History');
      await t.waitForRole('article', historyLabel(later, 2, 'Push A'));
      expectEqual(await t.names('article'), [historyLabel(later, 2, 'Push A'), historyLabel(D0, 1, 'Pull A')], 'History articles, newest first');
    },
  },

  {
    id: 'swap',
    title: 'Swap Lat pulldown → Pull-up (persists, shows in Plan); Custom… "Barbell curl" on a curl slot',
    async run(t) {
      await boot(t);
      await expectToday(t, 1, 'Pull A');
      const SV = { role: 'dialog', name: 'Swap: Vertical pull' };
      t.step('Swap sheet');
      await clickInside(t, card('Lat pulldown'), 'Swap');
      await t.waitForRole('dialog', SV.name);
      expectEqual(await t.attr('dialog', SV.name, 'aria-modal'), 'true', 'Swap sheet aria-modal');
      await clickOption(t, 'Pull-up', SV);
      await t.waitGone('dialog', SV.name);
      await t.waitForRole('region', 'Pull-up');
      expect(!(await t.exists('region', 'Lat pulldown')), 'The Lat pulldown card should be replaced by Pull-up');

      t.step('Swap persists after reload');
      await t.reload();
      await waitNav(t);
      await expectToday(t, 1, 'Pull A');
      await t.waitForRole('region', 'Pull-up');
      expect(!(await t.exists('region', 'Lat pulldown')), 'After reload the Lat pulldown card is back — swap not saved');

      t.step('Plan shows the swap on both pull days');
      await goTab(t, 'Plan');
      for (const day of [`Day 1 ${DOT} Pull A`, `Day 4 ${DOT} Pull B`]) {
        const day1 = { role: 'region', name: day };
        await t.waitForRole('region', day);
        let text = await t.fullText({ within: day1 });
        if (!text.includes('Pull-up')) { await expand(t, day1); text = await t.fullText({ within: day1 }); }
        expect(text.includes('Pull-up'), `Plan "${day}" should list Pull-up; text: ${JSON.stringify(text.slice(0, 300))}`);
        expect(!text.includes('Lat pulldown'), `Plan "${day}" still lists Lat pulldown`);
      }

      t.step('Custom… on a curl slot');
      await goTab(t, 'Today');
      const SC = { role: 'dialog', name: 'Swap: Curl' };
      await clickInside(t, card('Hammer curl'), 'Swap');
      await t.waitForRole('dialog', SC.name);
      await clickOption(t, 'Custom', SC);
      await t.typeInTextField('Barbell curl', { within: SC });
      await t.click('Save', { within: SC });
      await t.waitGone('dialog', SC.name);
      await t.waitForRole('region', 'Barbell curl');
      expect(!(await t.exists('region', 'Hammer curl')), 'Hammer curl card should be replaced by Barbell curl');
      expect(await t.exists('region', 'Dumbbell curl'), 'The other curl slot (Dumbbell curl) must be unchanged');
      expectEqual((await t.getJSON(STORAGE_KEY)).choices?.['pull.curl1'], 'custom:Barbell curl', 'choices["pull.curl1"] after Custom… "Barbell curl"');

      t.step('Logged as the catalog Barbell curl (§15.3), not a custom exercise');
      await fillSets(t, 'Barbell curl', sets(20, 10));
      await saveWorkout(t, 'Pull A', D0);
      const saved = (await t.getJSON(STORAGE_KEY)).sessions[0];
      expectEqual(saved.entries.map((e) => e.exerciseId), ['barbellCurl'], 'Only the exercise with reps is saved, under the catalog id');
    },
  },

  {
    id: 'draft-reload',
    title: 'Draft survives a reload without saving',
    async run(t) {
      await boot(t);
      await expectToday(t, 1, 'Pull A');
      await fillSets(t, 'Deadlift', [{ weight: 102.5, reps: 7 }]);
      await sleep(900); // autosave is debounced ~300 ms
      const st = await t.getJSON(STORAGE_KEY);
      expect(st && st.draft, `state.draft should be saved while typing; got ${JSON.stringify(st?.draft)}`);
      t.step('Reload without saving');
      await t.reload();
      await waitNav(t);
      await expectToday(t, 1, 'Pull A');
      await openCard(t, 'Deadlift');
      expectEqual(await t.value('Set 1 reps', { within: card('Deadlift') }), '7', 'Deadlift "Set 1 reps" after reload');
      expectEqual(Number(await t.value('Set 1 weight', { within: card('Deadlift') })), 102.5, 'Deadlift "Set 1 weight" after reload');
      const after = await t.getJSON(STORAGE_KEY);
      expectEqual(after.sessions.length, 0, 'A draft is not a saved workout');
    },
  },

  {
    id: 'backup-roundtrip',
    title: 'Backup round trip: log 3, Export CSV, Delete everything, paste CSV → Preview → Import → same History',
    timeout: 180000,
    async run(t) {
      await boot(t);
      const d1 = addDays(D0, 1);
      const d2 = addDays(D0, 2);
      await logDay(t, { iso: D0, pos: 1, dayName: 'Pull A', entries: [['Deadlift', sets(100, 6)], ['Lat pulldown', sets(40, 10, 10, 8)]] });
      await moveTo(t, d1);
      await logDay(t, { iso: d1, pos: 2, dayName: 'Push A', entries: [['Bench press', sets(50, 5, 5, 5, 5, 7)]] });
      await moveTo(t, d2);
      await logDay(t, { iso: d2, pos: 3, dayName: 'Legs', entries: [['Squat', sets(62.5, 5, 5, 6)]] });

      t.step('Record History');
      const stateBefore = await t.getJSON(STORAGE_KEY);
      const before = canon(stateBefore.sessions);
      expectEqual(before.length, 3, 'Stored sessions after logging three workouts');
      await goTab(t, 'History');
      await t.waitForRole('article', historyLabel(d2, 3, 'Legs'));
      const labelsBefore = await t.names('article');

      t.step('Export backup (CSV)');
      await goTab(t, 'Data');
      await t.click('Export backup (CSV)');
      const dl = await t.waitForDownload({ timeout: 8000 });
      expectEqual(dl.download, `ppl-backup-${dmyDash(d2)}.csv`, 'Backup file name');
      const csv = dl.text.replace(/^\uFEFF/, '');
      expectEqual(csv.split('\n')[0], CSV_HEADER, 'CSV header line');
      expectEqual(csv, toCSV(stateBefore.sessions, 'kg'), 'Exported CSV should equal toCSV(saved sessions, "kg")');
      await t.waitForText(new RegExp(`last backup:?\\s*${escapeRe(dmy(d2))}`, 'i'));

      t.step('Delete everything…');
      await t.click(DELETE_ALL);
      await t.type('Type DELETE', 'DELETE');
      await t.click('Delete');
      await t.waitFieldGone('Type DELETE');
      await skipSetupIfShown(t);
      await goTab(t, 'History');
      await t.poll((lib) => (document.querySelectorAll('article').length === 0 ? { ok: true } : { pending: true, why: `${document.querySelectorAll('article').length} articles` }), [], { what: 'History to be empty' });
      expectEqual((await t.getJSON(STORAGE_KEY))?.sessions?.length ?? 0, 0, 'Stored sessions after Delete everything');

      t.step('Paste CSV → Preview → Import');
      await goTab(t, 'Data');
      await t.type('Paste workouts', csv);
      await t.click('Preview');
      await t.waitForRole('button', { startsWith: 'Import ' });
      await t.waitForText(/\b3 new\b/);
      await t.click({ startsWith: 'Import ' });
      await skipSetupIfShown(t, 400);

      t.step('History matches');
      await goTab(t, 'History');
      await t.waitForRole('article', historyLabel(d2, 3, 'Legs'));
      expectEqual(await t.names('article'), labelsBefore, 'History article labels after import');
      const shown = { [historyLabel(D0, 1, 'Pull A')]: ['Deadlift', 'Lat pulldown'], [historyLabel(d1, 2, 'Push A')]: ['Bench press'], [historyLabel(d2, 3, 'Legs')]: ['Squat'] };
      for (const [label, names] of Object.entries(shown)) {
        const text = await t.fullText({ within: { role: 'article', name: label } });
        for (const n of names) expect(text.includes(n), `History "${label}" should list ${n} after import; text: ${JSON.stringify(text)}`);
      }
      expectEqual(canon((await t.getJSON(STORAGE_KEY)).sessions), before, 'Stored sessions after import (ignoring ids)');
    },
  },

  {
    id: 'text-import-warning',
    title: 'Text import: one unknown exercise → preview warning with its line number → import',
    async run(t) {
      await boot(t);
      const day = addDays(D0, -1);
      const text = [`${dmy(day)} Pull A`, 'Deadlift 100x5', 'Lat pulldown 45x12 45x12 45x10', 'Zercher squat 60x8 x3'].join('\n');
      await goTab(t, 'Data');
      await t.type('Paste workouts', text);
      await t.click('Preview');
      await t.waitForRole('button', { startsWith: 'Import ' });
      const shown = await t.text();
      expect(/\bline\s*4\b/i.test(shown), `The preview should show the warning's line number (4); Data text: ${JSON.stringify(shown.slice(0, 600))}`);
      expect(shown.includes('Zercher squat'), 'The preview should name the unknown exercise');
      expect(/\b1 new\b/.test(shown), 'The preview should say "1 new"');
      await t.click({ startsWith: 'Import ' });
      await skipSetupIfShown(t, 400);
      await goTab(t, 'History');
      const label = historyLabel(day, 1, 'Pull A');
      await t.waitForRole('article', label);
      const art = await t.fullText({ within: { role: 'article', name: label } });
      expect(art.includes('Zercher squat'), `History article should include the custom exercise; text: ${JSON.stringify(art)}`);
      const st = await t.getJSON(STORAGE_KEY);
      const entry = st.sessions[0]?.entries?.find((e) => e.exerciseId === 'custom:zercher squat');
      expectEqual(entry && { name: entry.name, sets: entry.sets }, { name: 'Zercher squat', sets: sets(60, 8, 8, 8) }, 'Imported custom entry');
      await goTab(t, 'Today');
      await expectToday(t, 2, 'Push A');
    },
  },

  {
    id: 'offline',
    title: 'Offline: after one load the service worker serves the app; Today renders and data is intact',
    timeout: 120000,
    async run(t) {
      await boot(t);
      await logDay(t, { iso: D0, pos: 1, dayName: 'Pull A', entries: [['Deadlift', sets(100, 5)]] });
      t.step('PWA basics');
      const pwa = await t.evaluate(async () => {
        const link = document.querySelector('link[rel="manifest"]');
        const manifest = link ? await fetch(link.href).then((r) => r.json()).catch((e) => ({ error: String(e) })) : null;
        return { manifest, viewport: document.querySelector('meta[name="viewport"]')?.content || '' };
      });
      expect(pwa.manifest && !pwa.manifest.error, `index.html needs <link rel="manifest"> to a valid manifest (${JSON.stringify(pwa.manifest)})`);
      expectEqual({ display: pwa.manifest.display, start_url: pwa.manifest.start_url, scope: pwa.manifest.scope }, { display: 'standalone', start_url: './', scope: './' }, 'Manifest basics');
      expect(/viewport-fit=cover/.test(pwa.viewport) && /width=device-width/.test(pwa.viewport), `viewport meta: ${pwa.viewport}`);

      t.step('Wait for the service worker');
      await t.poll(() => (navigator.serviceWorker && navigator.serviceWorker.controller
        ? { url: navigator.serviceWorker.controller.scriptURL }
        : { pending: true, why: 'navigator.serviceWorker.controller is null' }), [], { timeout: 20000, what: 'the service worker to control the page' });
      await t.poll(async () => ((await caches.keys()).length ? { ok: true } : { pending: true, why: 'no caches yet' }), [], { timeout: 10000, what: 'the precache' });

      t.step('Go offline and reload');
      const mark = t.server.log.length;
      await t.setOffline(true);
      await t.reload();
      await waitNav(t);
      // Changed for §18.4 (20/11/2026): the workout was saved today, so Today shows "Done for today ✓" (Up next: Push A).
      await expectDone(t, 'Push A');
      for (const tab of ['Plan', 'Progress', 'History', 'Data']) await goTab(t, tab);
      await goTab(t, 'History');
      await t.waitForRole('article', historyLabel(D0, 1, 'Pull A'));
      await goTab(t, 'Today');
      await expectDone(t, 'Push A');
      const leaked = t.server.log.slice(mark).filter((r) => !r.path.startsWith('/sw.js'));
      expect(leaked.length === 0, `While offline these requests skipped the service worker cache and hit the network: ${JSON.stringify(leaked.map((r) => r.path))}`);
      await t.setOffline(false);
    },
  },

  {
    id: 'xss',
    title: 'XSS: custom exercise / imported names and notes with <img onerror> show as plain text; window.__xss stays undefined',
    timeout: 150000,
    async run(t) {
      const XSS = '<img src=x onerror="window.__xss=1">';
      const XSS_SVG = '<svg onload="window.__xss=3">';
      const XSS_NOTE = '<img src=x onerror="window.__xss=2">';
      await boot(t);
      const SC = { role: 'dialog', name: 'Swap: Curl' };
      t.step('Custom exercise with markup');
      await clickInside(t, card('Hammer curl'), 'Swap');
      await t.waitForRole('dialog', SC.name);
      await clickOption(t, 'Custom', SC);
      await t.typeInTextField(XSS, { within: SC });
      await t.click('Save', { within: SC });
      await t.waitGone('dialog', SC.name);
      await t.waitForRole('region', XSS);
      await t.waitForText(XSS);
      await expectNoXss(t, 'Today');
      await fillSets(t, XSS, sets(10, 10));
      await fillSets(t, 'Deadlift', sets(100, 5));
      await saveWorkout(t, 'Pull A', D0);
      await expectNoXss(t, 'Today after save');

      t.step('History / Plan / Progress');
      await goTab(t, 'History');
      const label = historyLabel(D0, 1, 'Pull A');
      await t.waitForRole('article', label);
      expect((await t.fullText({ within: { role: 'article', name: label } })).includes(XSS), 'History should show the custom name as plain text');
      await expectNoXss(t, 'History');
      await goTab(t, 'Plan');
      const DAY1 = { role: 'region', name: `Day 1 ${DOT} Pull A` };
      await t.waitForRole('region', DAY1.name);
      if (!(await t.fullText({ within: DAY1 })).includes(XSS)) await expand(t, DAY1);
      await sleep(200);
      expect((await t.fullText({ within: DAY1 })).includes(XSS), 'Plan "Day 1 · Pull A" should show the custom name as plain text');
      await expectNoXss(t, 'Plan');
      await goTab(t, 'Progress');
      await t.click('One at a time');
      await sleep(200);
      expect((await t.fullText()).includes(XSS), 'Progress exercise list should show the custom name as plain text');
      await expectNoXss(t, 'Progress');

      t.step('Imported names and notes');
      await goTab(t, 'Data');
      const day = addDays(D0, -1);
      await t.type('Paste workouts', [`${dmy(day)} Push A`, 'Bench press 50x5 x5', `${XSS_SVG} 10x10`, `Note: ${XSS_NOTE}`].join('\n'));
      await t.click('Preview');
      await t.waitForRole('button', { startsWith: 'Import ' });
      await expectNoXss(t, 'Import preview');
      expect((await t.text()).includes(XSS_SVG), 'Import preview warning should show the unknown name as plain text');
      await t.click({ startsWith: 'Import ' });
      await goTab(t, 'History');
      const label2 = historyLabel(day, 2, 'Push A');
      await t.waitForRole('article', label2);
      await expand(t, { role: 'article', name: label2 });
      await sleep(200);
      const art = await t.fullText({ within: { role: 'article', name: label2 } });
      expect(art.includes(XSS_SVG), `History should show the imported custom name as text; got ${JSON.stringify(art.slice(0, 300))}`);
      await expectNoXss(t, 'History after import (expanded)');
      const st = await t.getJSON(STORAGE_KEY);
      expectEqual(st.sessions.find((s) => s.date === day)?.note, XSS_NOTE, 'Imported note is stored verbatim');
      await goTab(t, 'Progress');
      await sleep(200);
      await expectNoXss(t, 'Progress after import');
    },
  },

  {
    id: 'units-lb',
    title: 'Units: switch to lb (confirm) → a logged 60 kg shows as 132.5 lb',
    async run(t) {
      await boot(t);
      await logDay(t, { iso: D0, pos: 1, dayName: 'Pull A', entries: [['Deadlift', sets(60, 5)]] });
      const expected = convertWeight(60, 'kg', 'lb');
      expectEqual(expected, 132.5, 'convertWeight(60, kg, lb) from public/js/units.js');
      t.step('Switch to lb');
      await goTab(t, 'Data');
      await t.waitAttr('button', 'kg', 'aria-pressed', 'true');
      await t.click('lb');
      await t.waitForRole('dialog', 'Convert all saved weights to lb?');
      await confirmTopDialog(t, /^(convert|yes|ok|confirm|switch|change)\b/i);
      await t.waitAttr('button', 'lb', 'aria-pressed', 'true');
      const st = await t.getJSON(STORAGE_KEY);
      expectEqual(st.settings?.unit, 'lb', 'settings.unit');
      expectEqual(st.sessions[0]?.entries?.find((e) => e.exerciseId === 'deadlift')?.sets?.[0]?.weight, expected, 'Stored deadlift weight after converting');

      t.step('History shows lb');
      await goTab(t, 'History');
      const label = historyLabel(D0, 1, 'Pull A');
      await t.waitForRole('article', label);
      await t.waitForText(String(expected), { within: { role: 'article', name: label } });
      const art = await t.fullText({ within: { role: 'article', name: label } });
      expect(!/\b60\s*(kg)?\s*[×x]/.test(art), `History still shows the kg number: ${JSON.stringify(art)}`);

      t.step('Progress in lb (single point)');
      await goTab(t, 'Progress');
      await t.click('All charts');
      await waitCharts(t, 'Progress (lb)');
      await expectNoNaN(t, 'Progress (lb, one session)');
      await t.waitForText(String(expected));
    },
  },

  {
    id: 'progress-views',
    title: 'Progress: All charts and One at a time render svg[role=img] with no NaN; tapping a list row focuses that exercise',
    async run(t) {
      await bootSeeded(t, seedState(buildHistory()));
      await goTab(t, 'Progress');
      t.step('All charts');
      await t.click('All charts');
      await t.waitAttr('button', 'All charts', 'aria-pressed', 'true');
      await waitCharts(t, 'All charts');
      await expectNoNaN(t, 'All charts');
      for (const chip of ['4 weeks', '3 months', 'All']) {
        t.step(`Range ${chip}`);
        await t.click(chip);
        await sleep(200);
        await waitCharts(t, `All charts · ${chip}`);
        await expectNoNaN(t, `All charts · ${chip}`);
      }
      t.step('Hover a chart: tooltip with the session date, dot grows, then rests again');
      const at = await t.evaluate(() => {
        const svg = [...document.querySelectorAll('svg[role="img"]')].find((x) => x.querySelector('.dot'));
        svg.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = svg.getBoundingClientRect();
        return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
      });
      await t.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y }, t.sessionId);
      const tip = await t.poll(() => {
        const box = [...document.querySelectorAll('[aria-hidden="true"]')].find((e) => e.offsetParent && /\d\d\/\d\d\/\d{4}/.test(e.textContent) && /kg/.test(e.textContent));
        const grown = document.querySelectorAll('circle.dot[r="5.5"]').length;
        return box && grown ? { text: box.textContent, grown } : { pending: true, why: `tooltip ${box ? 'shown' : 'missing'}, ${grown} grown dots` };
      }, [], { what: 'a chart tooltip with a DD/MM/YYYY date and a kg value' });
      expect(tip.grown >= 1, 'The hovered point grows');
      await t.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }, t.sessionId);
      await t.poll(() => (document.querySelectorAll('circle.dot[r="5.5"]').length ? { pending: true, why: 'a dot is still grown' } : { ok: true }), [], { what: 'the dots to rest after the pointer leaves' });
      await t.evaluate(() => window.scrollTo(0, 0));

      t.step('One at a time');
      await t.click('One at a time');
      await t.waitAttr('button', 'One at a time', 'aria-pressed', 'true');
      await waitCharts(t, 'One at a time');
      await expectNoNaN(t, 'One at a time');
      for (const b of ['Squat', 'Bench', 'Dead', 'OHP', 'Row']) await t.waitForRole('button', b);
      await t.click('Dead');
      await sleep(200);
      await waitCharts(t, 'One at a time · Dead');
      await expectNoNaN(t, 'One at a time · Dead');

      t.step('Tap the Lat pulldown row');
      await t.click({ startsWith: 'Lat pulldown' });
      await sleep(300);
      await waitCharts(t, 'One at a time · Lat pulldown');
      await expectNoNaN(t, 'One at a time · Lat pulldown');
      const SHEET = { role: 'dialog', name: 'Set weight: Lat pulldown' };
      await t.click('Set weight', { index: 0 });
      await t.waitForRole('dialog', SHEET.name, { timeout: 3000 }).catch(async (err) => {
        throw new E2EError(`After tapping the Lat pulldown row, the focus card's "Set weight" should open "Set weight: Lat pulldown". ${err.message}`);
      });
      await t.press('Escape');
      await t.waitGone('dialog', SHEET.name);
    },
  },

  {
    id: 'history-edit-delete',
    title: 'History: Edit loads a workout into Today and Save replaces it (set weights untouched); Delete asks in-app',
    timeout: 150000,
    async run(t) {
      await boot(t);
      const d1 = addDays(D0, 1);
      await logDay(t, { iso: D0, pos: 1, dayName: 'Pull A', entries: [['Deadlift', sets(100, 5)]] });
      await moveTo(t, d1);
      await logDay(t, { iso: d1, pos: 2, dayName: 'Push A', entries: [['Bench press', sets(50, 5, 5, 5, 5, 5)]] });

      t.step('Plan → Set weight for Deadlift');
      await goTab(t, 'Plan');
      const DAY1 = { role: 'region', name: `Day 1 ${DOT} Pull A` };
      await t.waitForRole('region', DAY1.name);
      await clickInside(t, DAY1, 'Set weight', { index: 0 });
      const SHEET = { role: 'dialog', name: 'Set weight: Deadlift' };
      await t.waitForRole('dialog', SHEET.name);
      await t.type('Weight (kg)', 120, { within: SHEET });
      await t.click('Save', { within: SHEET });
      await t.waitGone('dialog', SHEET.name);
      expectEqual((await t.getJSON(STORAGE_KEY)).baselines?.['deadlift|main']?.weight, 120, 'baselines["deadlift|main"] set from Plan');

      t.step('Edit Day 1 from History');
      await goTab(t, 'History');
      const A1 = { role: 'article', name: historyLabel(D0, 1, 'Pull A') };
      await t.waitForRole('article', A1.name);
      await clickInside(t, A1, 'Edit');
      await t.waitForText(`Editing ${dmy(D0)}`);
      await t.waitForRole('button', 'Cancel edit', { within: 'document' });
      await t.waitAttr('button', 'Today', 'aria-current', 'page', { within: SECTIONS });
      await expectToday(t, 1, 'Pull A');
      await openCard(t, 'Deadlift');
      expectEqual(await t.value('Set 1 reps', { within: card('Deadlift') }), '5', 'Edited workout loads its reps');
      expectEqual(Number(await t.value('Set 1 weight', { within: card('Deadlift') })), 100, 'Edited workout loads its logged weight (not the set weight)');
      await t.type('Set 1 reps', 8, { within: card('Deadlift') });
      const idBefore = (await t.getJSON(STORAGE_KEY)).sessions.find((s) => s.date === D0 && s.day === 'pullA')?.id;
      await t.clearStatusLog();
      await t.click('Save workout', { within: 'document' });
      await t.waitForStatus(`Saved Pull A ${DOT} ${dmy(D0)}`);
      expect(!(await t.evaluate((lib) => !!lib.topDialog())), 'Saving an edit of the same workout replaces it without asking (§11) — no "Replace?" dialog');
      const st = await t.getJSON(STORAGE_KEY);
      expectEqual(st.sessions.length, 2, 'Editing replaces, it does not add');
      expectEqual(st.sessions.find((s) => s.date === D0 && s.day === 'pullA')?.id, idBefore, 'The edited workout keeps its id');
      expectEqual(st.sessions.find((s) => s.date === D0 && s.day === 'pullA')?.entries?.find((e) => e.exerciseId === 'deadlift')?.sets, sets(100, 8), 'Edited deadlift sets');
      expectEqual(st.baselines?.['deadlift|main']?.weight, 120, 'Editing an old workout must not use up a set weight');

      t.step('Delete Day 2');
      await goTab(t, 'History');
      const A2 = { role: 'article', name: historyLabel(d1, 2, 'Push A') };
      await t.waitForRole('article', A2.name);
      await clickInside(t, A2, 'Delete');
      await confirmTopDialog(t, /^delete\b/i);
      await t.waitGone('article', A2.name);
      expectEqual(await t.names('article'), [A1.name], 'History after deleting Day 2');
      expectEqual((await t.getJSON(STORAGE_KEY)).sessions.length, 1, 'Stored sessions after delete');
      await goTab(t, 'Today');
      await expectToday(t, 2, 'Push A');
    },
  },

  {
    id: 'iphone-basics',
    title: 'iPhone basics: inputs ≥ 16px font (no zoom), tab buttons and Save workout ≥ 44px tall, Escape closes sheets',
    async run(t) {
      await boot(t, { setup: null });
      await t.waitForRole('dialog', SETUP.name, { timeout: 8000 });
      await expectInputFonts(t, 'Setup dialog');
      await t.click('Skip', { within: SETUP });
      await t.waitGone('dialog', SETUP.name);
      await expectToday(t, 1, 'Pull A');
      const n = await expectInputFonts(t, 'Today');
      expect(n >= 2, `Today should have weight/reps inputs (found ${n})`);

      t.step('Tap targets');
      const tabs = await t.evaluate((lib) => [...lib.scope({ role: 'navigation', name: 'Sections' }).querySelectorAll('button')]
        .map((b) => ({ name: lib.accName(b), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) })));
      for (const tab of tabs) expect(tab.h >= 44 && tab.w >= 44, `Tab "${tab.name}" is ${tab.w}×${tab.h}px; needs ≥ 44px`);
      const save = await t.waitForRole('button', 'Save workout', { within: 'document' });
      expect(save.h >= 44, `"Save workout" is ${save.h}px tall; needs ≥ 44px`);

      t.step('Save workout sits at the end of the workout, not pinned (owner decision 11/11/2026)');
      const placement = await t.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save workout');
        const pinned = [];
        for (let el = btn; el && el !== document.body; el = el.parentElement) {
          const pos = getComputedStyle(el).position;
          if (pos === 'sticky' || pos === 'fixed') pinned.push(`${el.tagName.toLowerCase()}.${el.className} (${pos})`);
        }
        const note = document.querySelector('textarea[aria-label="Note"]');
        window.scrollTo(0, 0);
        return {
          pinned,
          afterNote: !!note && !!(note.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING),
          topAtStart: Math.round(btn.getBoundingClientRect().top), vh: innerHeight,
        };
      });
      expect(placement.pinned.length === 0, `"Save workout" must not be pinned; pinned by ${placement.pinned.join(', ')}`);
      expect(placement.afterNote, '"Save workout" should come after the Note field, at the end of the workout');
      expect(placement.topAtStart > placement.vh, `On a full workout "Save workout" should be off-screen until you scroll to the end (top ${placement.topAtStart} vs viewport ${placement.vh})`);
      const reach = await t.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save workout');
        const nav = document.querySelector('nav[aria-label="Sections"]').getBoundingClientRect();
        const r = btn.getBoundingClientRect();
        window.scrollTo(0, 0);
        return { bottom: Math.round(r.bottom), navTop: Math.round(nav.top) };
      });
      expect(reach.bottom <= reach.navTop, `Scrolled to the end, "Save workout" must sit fully above the tab bar (bottom ${reach.bottom} vs tab bar top ${reach.navTop})`);
      const inside = await t.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Sections"]');
        const r = nav.getBoundingClientRect();
        return { bottom: Math.round(r.bottom), vh: innerHeight };
      });
      expect(inside.bottom <= inside.vh + 1, `Tab bar should sit inside the viewport (bottom ${inside.bottom} vs ${inside.vh})`);
      await expectTapTargets(t, 'Today', ['Change date', 'Change', 'Set weight', '+ Set']);
      await expectTapTargets(t, 'Today · Lat pulldown', ['Swap', 'Set weight'], { within: 'Lat pulldown' });
      await t.evaluate(() => window.scrollTo(0, 0));

      t.step('Set weight sheet');
      await clickInside(t, card('Deadlift'), 'Set weight');
      await t.waitForRole('dialog', 'Set weight: Deadlift');
      await t.value('Weight (kg)', { within: { role: 'dialog', name: 'Set weight: Deadlift' } });
      await expectInputFonts(t, 'Set weight sheet');
      await t.press('Escape');
      await t.waitGone('dialog', 'Set weight: Deadlift');

      t.step('Swap sheet → Custom…');
      await clickInside(t, card('Lat pulldown'), 'Swap');
      await t.waitForRole('dialog', 'Swap: Vertical pull');
      await clickOption(t, 'Custom', { role: 'dialog', name: 'Swap: Vertical pull' });
      await sleep(200);
      await expectInputFonts(t, 'Swap sheet (Custom…)');
      await t.press('Escape');
      await t.waitGone('dialog', 'Swap: Vertical pull');
      await t.waitForRole('region', 'Lat pulldown');

      for (const tab of ['Plan', 'Progress', 'History', 'Data']) {
        await goTab(t, tab);
        await expectInputFonts(t, tab);
        if (tab === 'Plan') await expectTapTargets(t, 'Plan', ['Standard', 'Strength', 'Endurance', 'Cutting']);
        if (tab === 'Progress') await expectTapTargets(t, 'Progress', ['All charts', 'One at a time', '4 weeks', '3 months', 'All']);
        if (tab === 'History') await expectTapTargets(t, 'History', ['All', 'Pull', 'Push', 'Legs']);
        if (tab === 'Data') await expectTapTargets(t, 'Data', ['kg', 'lb', 'Preview', 'Choose file']);
        await t.evaluate(() => window.scrollTo(0, 0));
      }
      t.step('Delete dialog');
      await t.click(DELETE_ALL);
      await t.value('Type DELETE');
      await expectInputFonts(t, 'Delete dialog');
      await t.press('Escape');
      await t.waitFieldGone('Type DELETE');
    },
  },

  {
    id: 'screenshots',
    title: 'Screenshots of all 5 tabs, light and dark, 390×844 @2x, with data',
    timeout: 150000,
    async run(t) {
      await bootSeeded(t, seedState(buildHistory()));
      await expectToday(t, 1, 'Pull A');
      await t.waitForRole('button', 'Export now', { within: 'document' }); // backup reminder: sessions and no backup yet
      const background = {};
      for (const scheme of ['light', 'dark']) {
        t.step(`Screenshots ${scheme}`);
        await t.setColorScheme(scheme);
        await sleep(150);
        for (const [i, tab] of TABS.entries()) {
          await goTab(t, tab);
          await sleep(250);
          await t.screenshot(`${scheme}-${i + 1}-${tab.toLowerCase()}`);
          if (tab === 'Progress') {
            await t.click('One at a time');
            await sleep(250);
            await t.screenshot(`${scheme}-${i + 1}-progress-one-at-a-time`);
            await t.click('All charts');
          }
        }
        background[scheme] = await t.evaluate(() => {
          const bg = (el) => getComputedStyle(el).backgroundColor;
          const b = bg(document.body);
          return /rgba\(0, 0, 0, 0\)|transparent/.test(b) ? bg(document.documentElement) : b;
        });
      }
      expect(background.light !== background.dark, `Dark mode should change the page background (light ${background.light}, dark ${background.dark})`);
    },
  },
  // ------------------------------------------------------------------ added by the independent review

  {
    id: 'same-date-edit',
    title: 'Two workouts on one date: editing the first from History keeps the order, the Day numbers and the next workout',
    async run(t) {
      const day = '2026-11-05';
      await bootSeeded(t, seedState([...SEED_WEEK, { date: day, day: 'legs', entries: [mainEntry('squat', 62.5, [5, 5, 5])] }]));
      await expectToday(t, 1, 'Pull A'); // last logged: Legs (Day 6) after Push B on the same date
      const PB = historyLabel(day, 5, 'Push B');
      const LG = historyLabel(day, 6, 'Legs');
      await goTab(t, 'History');
      await t.waitForRole('article', LG);
      const before = await t.names('article');
      expectEqual(before.slice(0, 2), [LG, PB], 'History lists the later workout of 05/11 first');
      const idsBefore = (await t.getJSON(STORAGE_KEY)).sessions.map((s) => s.id);

      t.step('Edit the Push B of 05/11 and save');
      await clickInside(t, { role: 'article', name: PB }, 'Edit');
      await t.waitForText(`Editing ${dmy(day)}`);
      await expectToday(t, 5, 'Push B');
      await fillSets(t, 'Overhead press', [{}, {}, {}, {}, { reps: 8 }]);
      await t.clearStatusLog();
      await t.click('Save workout', { within: 'document' });
      await t.waitForStatus(`Saved Push B ${DOT} ${dmy(day)}`);
      expect(!(await t.evaluate((lib) => !!lib.topDialog())), 'Saving an edit must not ask to replace the workout being edited');

      t.step('Nothing moved');
      await expectToday(t, 1, 'Pull A');
      await goTab(t, 'History');
      await t.waitForRole('article', LG);
      expectEqual(await t.names('article'), before, 'History order and Day numbers after the edit');
      const st = await t.getJSON(STORAGE_KEY);
      expectEqual(st.sessions.map((s) => s.id), idsBefore, 'Stored order and ids after the edit');
      expectEqual(st.sessions.find((s) => s.date === day && s.day === 'pushB')?.entries?.[0]?.sets?.map((x) => x.reps), [5, 5, 5, 5, 8], 'Edited Push B reps');
    },
  },

  {
    id: 'units-draft',
    title: 'kg → lb → kg with a draft and a set weight: untyped weights follow the suggestion, typed ones convert, set 1 leads',
    timeout: 120000,
    async run(t) {
      const seed = SEED_WEEK.map((s) => (s.day === 'legs' ? { ...s, entries: [...s.entries, { exerciseId: 'rdl', ...{ sets: sets(40, 12, 12, 12) } }] } : s));
      await bootSeeded(t, seedState(seed, { baselines: { 'legPress|accessory': { weight: 100, setOn: '2026-11-09' } } }));
      await expectToday(t, 6, 'Legs');
      await waitHeadline(t, 'Squat', `Add 2.5 kg today → 62.5 kg`);

      t.step('Draft: squat reps typed (weights pre-filled), RDL set 1 weight typed');
      await fillSets(t, 'Squat', reps(5));
      await fillSets(t, 'Romanian deadlift', [{ weight: 45 }]);
      await expectSetWeights(t, 'Romanian deadlift', 45, 3); // later sets follow set 1 (§11)
      await goTab(t, 'Plan');
      await goTab(t, 'Today');
      await expectSetWeights(t, 'Romanian deadlift', 45, 3);
      await sleep(500);

      for (const [to, back] of [['lb', 'kg'], ['kg', 'lb']]) {
        t.step(`Switch to ${to}`);
        await goTab(t, 'Data');
        await t.click(to);
        await t.waitForRole('dialog', `Convert all saved weights to ${to}?`);
        await confirmTopDialog(t, /^convert\b/i);
        await t.waitAttr('button', to, 'aria-pressed', 'true');
        await goTab(t, 'Today');
        const squat = to === 'lb' ? convertWeight(60, 'kg', 'lb') + 5 : 62.5;
        await waitHeadline(t, 'Squat', `Add ${to === 'lb' ? '5 lb' : '2.5 kg'} today → ${squat} ${to}`);
        await openCard(t, 'Squat');
        await expectSetWeights(t, 'Squat', squat, 3); // the pre-fill equals the suggestion, not a converted old pre-fill
        expectEqual(await t.value('Set 1 reps', { within: card('Squat') }), '5', `Squat reps typed in the draft survive the switch to ${to}`);
        const rdl = to === 'lb' ? convertWeight(45, 'kg', 'lb') : convertWeight(convertWeight(45, 'kg', 'lb'), 'lb', 'kg');
        await openCard(t, 'Romanian deadlift');
        await expectSetWeights(t, 'Romanian deadlift', rdl, 3);
        const leg = to === 'lb' ? convertWeight(100, 'kg', 'lb') : 100;
        await waitHeadline(t, 'Leg press', `Weight you set: ${leg} ${to}`);
        await openCard(t, 'Leg press');
        await expectSetWeights(t, 'Leg press', leg, 3);
        void back;
      }
    },
  },

  {
    id: 'save-rules',
    title: 'Save: same date + day asks to replace (Cancel keeps it), only sets with reps are kept, a double-tap saves once and keeps "Saved"',
    timeout: 120000,
    async run(t) {
      await bootSeeded(t, seedState([...SEED_WEEK, { date: D0, day: 'legs', entries: [mainEntry('squat', 62.5, [5, 5, 5])] }]));
      // Changed for §18.4 (20/11/2026): a workout is already saved today, so Today opens on "Done for today ✓";
      // "Start it now instead" brings back the form for the next workout.
      await expectDone(t, 'Pull A');
      await t.click('Start it now instead', { within: 'document' });
      await expectToday(t, 1, 'Pull A');

      t.step('Pick Day 6 · Legs again for the same date');
      await t.click('Change', { within: 'document' });
      await t.waitForRole('dialog', 'Choose the workout');
      await clickOption(t, `Day 6 ${DOT} Legs`, { role: 'dialog', name: 'Choose the workout' });
      await t.waitGone('dialog', 'Choose the workout');
      await expectToday(t, 6, 'Legs');
      await fillSets(t, 'Squat', reps(5, 6));

      t.step('Replace? → Cancel');
      await t.click('Save workout', { within: 'document' });
      await t.waitForRole('dialog', 'Replace saved workout?');
      await t.click('Cancel', { within: { role: 'dialog', name: 'Replace saved workout?' } });
      await t.waitGone('dialog', 'Replace saved workout?');
      let st = await t.getJSON(STORAGE_KEY);
      expectEqual(st.sessions.filter((s) => s.date === D0 && s.day === 'legs').map((s) => s.entries[0].sets.length), [3], 'Cancel leaves the saved Legs alone');
      expectEqual(await t.value('Set 2 reps', { within: card('Squat') }), '6', 'Cancel keeps the form');

      t.step('Replace? → Replace');
      await t.clearStatusLog();
      await t.click('Save workout', { within: 'document' });
      await t.waitForRole('dialog', 'Replace saved workout?');
      await t.click('Replace', { within: { role: 'dialog', name: 'Replace saved workout?' } });
      await closeSavedSheet(t, { required: false }); // §18.5: the sheet follows new workouts; the spec leaves a replace open
      await t.waitForStatus(`Saved Legs ${DOT} ${dmy(D0)}`);
      st = await t.getJSON(STORAGE_KEY);
      const legs = st.sessions.filter((s) => s.date === D0 && s.day === 'legs');
      expectEqual(legs.length, 1, 'One Legs on that date after replacing');
      expectEqual(legs[0].entries, [{ exerciseId: 'squat', sets: sets(62.5, 5, 6) }], 'Only the sets with reps are saved; exercises without reps are dropped');
      expectEqual(st.sessions.length, SEED_WEEK.length + 1, 'Replacing does not add a workout');

      t.step('Double-tap Save');
      await ensureForm(t); // §18.4: "Start it now instead" again if Today went back to "Done for today ✓"
      await expectToday(t, 1, 'Pull A');
      await fillSets(t, 'Deadlift', reps(5));
      await sleep(400);
      // Save sits at the end of the workout (not pinned), so scroll to it as a user would, then tap it twice.
      await t.evaluate(() => [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim() === 'Save workout').scrollIntoView({ block: 'center', behavior: 'instant' }));
      await sleep(150);
      const btn = await t.waitForRole('button', 'Save workout', { within: 'document' });
      await t.clearStatusLog();
      await t.mouseClick(btn.x, btn.y);
      await sleep(70);
      await t.mouseClick(btn.x, btn.y);
      await t.waitForStatus(`Saved Pull A ${DOT} ${dmy(D0)}`);
      await sleep(600);
      const log = await t.statusLog();
      expect(!log.some((m) => /nothing to save/i.test(m)), `A double-tap must not replace "Saved" with an error; status messages: ${JSON.stringify(log)}`);
      expectEqual((await t.getJSON(STORAGE_KEY)).sessions.length, SEED_WEEK.length + 2, 'A double-tap saves once');
      // Changed for §18.4 / §18.5 (20/11/2026): the second tap may land on the "Workout saved" sheet; close it. After a
      // second workout on the same day the spec allows either "Done for today ✓" or the next workout's form.
      await closeSavedSheet(t, { required: false });
      await t.waitForText(new RegExp(`${escapeRe(DONE)}|${escapeRe(todayHeading(2, 'Push A'))}`));
    },
  },

  {
    id: 'draft-overnight',
    title: 'Draft left overnight: with no reps it moves to today; with reps it keeps its day and saves on that date',
    timeout: 120000,
    async run(t) {
      await bootSeeded(t, seedState(SEED_WEEK));
      await expectToday(t, 6, 'Legs');
      t.step('Type a weight only (no reps), leave it');
      await fillSets(t, 'Squat', [{ weight: 65 }]);
      await sleep(900);
      const d1 = addDays(D0, 1);
      await moveTo(t, d1);
      await expectToday(t, 6, 'Legs');
      await t.waitForText(`${weekday(d1)} ${dmy(d1)}`);
      expect(!(await t.text()).includes(dmy(D0)), 'A draft with no reps should move to today, not keep yesterday\'s date');
      await openCard(t, 'Squat');
      await expectSetWeights(t, 'Squat', 65, 3);

      t.step('Type reps, leave it overnight again');
      await fillSets(t, 'Squat', reps(5, 5, 5));
      await sleep(900);
      const d2 = addDays(D0, 2);
      await moveTo(t, d2);
      await t.waitForText(`${weekday(d1)} ${dmy(d1)}`);
      await openCard(t, 'Squat');
      expectEqual(await t.value('Set 3 reps', { within: card('Squat') }), '5', 'Reps typed yesterday are still there');
      await saveWorkout(t, 'Legs', d1);
      const st = await t.getJSON(STORAGE_KEY);
      expectEqual(st.sessions.find((s) => s.day === 'legs' && s.date === d1)?.entries?.[0]?.sets, sets(65, 5, 5, 5), 'Saved on the day the reps were typed');
      expect(!st.draft, 'Draft cleared after saving');
    },
  },

  {
    id: 'misses-deload-offday',
    title: 'Misses → deload → off day, through the UI: suggestion lines, watch list, day picker, pre-filled deload weight',
    timeout: 150000,
    async run(t) {
      const S = [
        { date: '2026-10-26', day: 'pullA', entries: [mainEntry('deadlift', 100, [5])] },
        { date: '2026-10-27', day: 'pushA', entries: [mainEntry('bench', 65, [5, 5, 5, 4, 3])] },
        { date: '2026-10-28', day: 'legs', entries: [mainEntry('squat', 80, [5, 5, 5])] },
        { date: '2026-10-29', day: 'pullB', entries: [mainEntry('barbellRow', 50, [5, 5, 5, 5, 5])] },
        { date: '2026-10-30', day: 'pushB', entries: [mainEntry('ohp', 40, [5, 5, 5, 5, 5])] },
        { date: '2026-10-31', day: 'legs', entries: [mainEntry('squat', 82.5, [5, 5, 5])] },
        { date: '2026-11-02', day: 'pullA', entries: [mainEntry('deadlift', 105, [5])] },
        { date: '2026-11-03', day: 'pushA', entries: [mainEntry('bench', 65, [5, 5, 4, 4, 3])] },
        { date: '2026-11-04', day: 'legs', entries: [mainEntry('squat', 85, [5, 5, 5])] },
        { date: '2026-11-05', day: 'pullB', entries: [mainEntry('barbellRow', 52.5, [5, 5, 5, 5, 5])] },
        { date: '2026-11-06', day: 'pushB', entries: [mainEntry('ohp', 42.5, [5, 5, 5, 5, 5])] },
        { date: '2026-11-07', day: 'legs', entries: [mainEntry('squat', 87.5, [5, 5, 5])] },
        { date: '2026-11-09', day: 'pullA', entries: [mainEntry('deadlift', 110, [5])] },
      ];
      await bootSeeded(t, seedState(S, { settings: { lastBackupAt: '2026-11-09' } }));
      await expectToday(t, 2, 'Push A');
      await waitHeadline(t, 'Bench press', 'Same weight: 65 kg');
      await t.waitForText("2 misses in a row — one more and it's deload time", { within: card('Bench press') });
      await goTab(t, 'Progress');
      await t.waitForText('Bench press');
      await t.waitForText(/Needs attention/);

      t.step('Third miss');
      await goTab(t, 'Today');
      await fillSets(t, 'Bench press', reps(5, 5, 4, 3, 3));
      await saveWorkout(t, 'Push A', D0);
      await expectDone(t, 'Legs'); // changed for §18.4 (20/11/2026): was the Day 3 · Legs form straight away
      await goTab(t, 'Progress');
      await t.waitForText(/Bench press · Deload due/);
      await t.waitForText('57.5 kg');

      const d1 = addDays(D0, 1);
      await moveTo(t, d1);
      t.step('Push A again via the day picker → deload');
      await t.click('Change', { within: 'document' });
      await clickOption(t, `Day 2 ${DOT} Push A`, { role: 'dialog', name: 'Choose the workout' });
      await expectToday(t, 2, 'Push A');
      await waitHeadline(t, 'Bench press', 'Deload: take 10% off → 57.5 kg');
      await t.waitForText('3 misses in a row at 65 kg', { within: card('Bench press') });
      // Changed for §18.2 (20/11/2026): the warm-up line is now a checklist ("Warm-up 20 × 10" …), same sets.
      await expectWarmups(t, 'Bench press', [{ weight: 20, reps: 10 }, { weight: 30, reps: 10 }, { weight: 40, reps: 5 }, { weight: 52.5, reps: 3 }], null, 'deload to 57.5 kg');
      await expectSetWeights(t, 'Bench press', 57.5, 5);

      t.step('Off-day miss at the deload weight');
      await t.click('Off day', { role: 'switch', within: 'document' });
      await fillSets(t, 'Bench press', reps(5, 5, 5, 3, 2));
      await saveWorkout(t, 'Push A', d1);
      const d2 = addDays(D0, 2);
      await moveTo(t, d2);
      await t.click('Change', { within: 'document' });
      await clickOption(t, `Day 2 ${DOT} Push A`, { role: 'dialog', name: 'Choose the workout' });
      await waitHeadline(t, 'Bench press', 'Same weight: 57.5 kg');
      await t.waitForText('Last time was an off day', { within: card('Bench press') });
      await goTab(t, 'History');
      const off = { role: 'article', name: historyLabel(d1, 2, 'Push A') };
      await t.waitForRole('article', off.name);
      await t.waitForText('Off day', { within: off });
    },
  },

  {
    id: 'plan-goal-abs-sets-date',
    title: 'Goal and abs change Today\'s cards; + Set stops at 20, − Set keeps 1; Change date uses only earlier sessions',
    timeout: 150000,
    async run(t) {
      await boot(t);
      await expectToday(t, 1, 'Pull A');
      const rows = (name) => t.evaluate((lib, n) => lib.scope({ name: n })?.querySelectorAll('input[aria-label$=" reps"]').length ?? -1, name);
      await openCard(t, 'Lat pulldown');
      expectEqual(await rows('Lat pulldown'), 3, 'Lat pulldown starts with 3 sets');

      t.step('Cutting: one set fewer');
      await goTab(t, 'Plan');
      await t.click('Cutting');
      await t.waitAttr('button', 'Cutting', 'aria-pressed', 'true');
      await goTab(t, 'Today');
      await openCard(t, 'Lat pulldown');
      expectEqual(await rows('Lat pulldown'), 2, 'Cutting: Lat pulldown 3 → 2 sets');
      await openCard(t, 'Face pull');
      expectEqual(await rows('Face pull'), 4, 'Cutting: Face pull 5 → 4 sets');

      t.step('Strength: compound accessories 3×4–6');
      await goTab(t, 'Plan');
      await t.click('Strength');
      await goTab(t, 'Today');
      await t.waitForText('3×4–6', { within: card('Lat pulldown') });
      await t.waitForText('5×15–20', { within: card('Face pull') });

      t.step('Abs on → two ab exercises on Pull A; off → gone');
      await goTab(t, 'Plan');
      await t.click('Standard');
      await t.click('Ab work', { role: 'switch' });
      await goTab(t, 'Today');
      await waitCard(t, 'Ab wheel rollout');
      await waitCard(t, 'Hanging leg raise');
      await waitHeadline(t, 'Ab wheel rollout', 'First time');
      await goTab(t, 'Plan');
      await t.click('Ab work', { role: 'switch' });
      await goTab(t, 'Today');
      await t.poll((lib) => (lib.scope({ name: 'Ab wheel rollout' }) ? { pending: true, why: 'still shown' } : { ok: true }), [], { what: 'the ab cards to go' });

      t.step('+ Set stops at 20; − Set keeps one');
      await openCard(t, 'Deadlift');
      for (let i = 1; i < 20; i++) await t.click('+ Set', { within: card('Deadlift') });
      expectEqual(await rows('Deadlift'), 20, 'Deadlift after 19 × "+ Set"');
      expectEqual(await t.attr('button', '+ Set', 'disabled', { within: card('Deadlift') }), '', '"+ Set" is disabled at 20 sets');
      for (let i = 1; i < 20; i++) await t.click('− Set', { within: card('Deadlift') });
      expectEqual(await rows('Deadlift'), 1, 'Deadlift after 19 × "− Set"');
      expectEqual(await t.attr('button', '− Set', 'disabled', { within: card('Deadlift') }), '', '"− Set" never removes the last set');

      t.step('Change date: suggestions use only sessions before that date');
      await bootSeeded(t, seedState(SEED_WEEK));
      await expectToday(t, 6, 'Legs');
      await waitHeadline(t, 'Squat', `Add 2.5 kg today → 62.5 kg`);
      await t.click('Change date', { within: 'document' });
      await t.type('Workout date', '2026-11-03');
      await t.waitForText('Tue 03/11/2026');
      await expectToday(t, 3, 'Legs');
      await waitHeadline(t, 'Squat', 'First time');
      await t.click('Change date', { within: 'document' });
      await t.type('Workout date', '2026-11-04');
      await waitHeadline(t, 'Squat', `Add 2.5 kg today → 62.5 kg`);
    },
  },

  {
    id: 'import-duplicates',
    title: 'Import a paste with the same workout twice and effort notes: preview counts one, warnings in line order, the later block wins',
    async run(t) {
      await boot(t);
      await goTab(t, 'Data');
      await t.type('Paste workouts', ['09/11/2026 Pull A', 'Deadlift 140x5 @8', 'Lat pulldown 45x12 x3', '', '09/11/2026 Pull A', 'Deadlift 142.5x5 @9'].join('\n'));
      await t.click('Preview');
      await t.waitForRole('button', 'Import 1 workout');
      await t.waitForText(/1 workout found · 1 new, 0 will replace existing/);
      const lines = await t.evaluate(() => [...document.body.innerText.matchAll(/Line (\d+):/g)].map((m) => Number(m[1])));
      expectEqual(lines, [2, 5, 6], 'Warnings shown with their line numbers, in order');
      await t.click('Import 1 workout');
      await t.waitForStatus('Imported 1 workout');
      expectEqual(canon((await t.getJSON(STORAGE_KEY)).sessions), canon([{ date: '2026-11-09', day: 'pullA', entries: [mainEntry('deadlift', 142.5, [5])] }]), 'Only the later block is imported; effort notes are not reps');
    },
  },

  {
    id: 'long-name-layout',
    title: 'A 60-character custom name wraps everywhere: no sideways scrolling on Today, Plan, Progress, History',
    async run(t) {
      const LONG = 'Supercalifragilisticexpialidocious-machine-row-with-a-pause!';
      const id = `custom:${LONG.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      await bootSeeded(t, seedState([{ date: '2026-11-09', day: 'pullA', entries: [mainEntry('deadlift', 100, [5]), { exerciseId: id, name: LONG, sets: sets(40, 12, 11, 10) }] }],
        { choices: { 'push.incline': `custom:${LONG}` } }));
      await goTab(t, 'History');
      await t.waitForText(LONG);
      await expectNoSideScroll(t, 'History');
      await goTab(t, 'Plan');
      const DAY2 = { role: 'region', name: `Day 2 ${DOT} Push A` };
      await t.waitForRole('region', DAY2.name);
      if (!(await t.fullText({ within: DAY2 })).includes(LONG)) await expand(t, DAY2);
      await t.waitForText(LONG, { within: DAY2 });
      await expectNoSideScroll(t, 'Plan (day card open)');
      await goTab(t, 'Today');
      await clickInside(t, card(LONG), 'Set weight');
      await t.waitForRole('dialog', `Set weight: ${LONG}`);
      await t.press('Escape');
      await expectNoSideScroll(t, 'Today');
      await goTab(t, 'Progress');
      await expectNoSideScroll(t, 'Progress · All charts');
      await t.click('One at a time');
      await t.click({ startsWith: LONG });
      await expectNoSideScroll(t, 'Progress · One at a time');
    },
  },

  {
    id: 'sw-update',
    title: 'Update banner after a real cache bump: new sw.js → "Update ready — tap to reload" → tap → the new files are used',
    timeout: 90000,
    async run(t) {
      const BANNER = 'Update ready — tap to reload';
      const swText = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8');
      const css = fs.readFileSync(path.join(PUBLIC_DIR, 'css', 'app.css'), 'utf8');
      const m = /const CACHE = '([^']+)'/.exec(swText);
      expect(m, 'sw.js should declare its versioned cache name as const CACHE = \'…\'');
      const NEXT = `${m[1]}-e2e-next`;
      try {
        await bootSeeded(t, seedState(SEED_WEEK));
        await t.poll(() => (navigator.serviceWorker && navigator.serviceWorker.controller ? { ok: true } : { pending: true, why: 'no controller yet' }), [], { timeout: 20000, what: 'the service worker to control the page' });
        await t.poll(async (lib, want) => ((await caches.keys()).includes(want) ? { ok: true } : { pending: true, why: JSON.stringify(await caches.keys()) }), [m[1]], { timeout: 10000, what: `the precache "${m[1]}"` });
        await sleep(300);
        expect(!(await t.exists('button', BANNER, { within: 'document' })), 'No update banner on the very first install');

        t.step('Deploy: new cache name + a changed stylesheet');
        t.server.override('/sw.js', swText.replace(m[0], `const CACHE = '${NEXT}'`));
        t.server.override('/css/app.css', `${css}\n:root { --e2e-deploy: next; }\n`);
        await t.reload();
        await waitNav(t);
        await t.waitForRole('button', BANNER, { within: 'document', timeout: 15000 });
        const marker = () => t.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--e2e-deploy').trim());
        expectEqual(await marker(), '', 'Until the tap the page still runs the old files');
        await expectToday(t, 6, 'Legs');

        t.step('Tap the banner');
        const loaded = t.cdp.waitForEvent('Page.loadEventFired', { sessionId: t.sessionId, timeout: 15000 });
        await t.click(BANNER, { within: 'document' });
        await loaded;
        await waitNav(t);
        expectEqual(await marker(), 'next', 'After the tap the new stylesheet is in use');
        await t.poll(async (lib, want) => { const k = await caches.keys(); return k.length === 1 && k[0] === want ? { ok: true } : { pending: true, why: JSON.stringify(k) }; }, [NEXT], { timeout: 10000, what: 'only the new cache to remain' });
        await sleep(300);
        expect(!(await t.exists('button', BANNER, { within: 'document' })), 'The banner is gone after reloading');
        await expectToday(t, 6, 'Legs');
      } finally {
        t.server.clearOverrides();
      }
    },
  },

  // ------------------------------------------------------------------ Batch 1 (§17, 20/11/2026)

  {
    id: 'lateral-raise-tracks',
    title: 'Two lateral raises are two tracks (§17.1): #1 8 kg × 15,15,14 → "Go lighter → 5.5 kg", #2 6 kg × 20,20,20 → "Add 2.5 kg today → 8.5 kg"',
    timeout: 120000,
    async run(t) {
      const push = {
        date: '2026-11-05', day: 'pushA', entries: [
          mainEntry('bench', 50, [5, 5, 5, 5, 5]),
          { exerciseId: 'ohp', sets: sets(30, 10, 10, 10) },
          { exerciseId: 'inclineDbPress', sets: sets(20, 10, 10, 10) },
          { exerciseId: 'tricepsPushdown', sets: sets(25, 12, 12, 12) },
          { exerciseId: 'lateralRaise', sets: sets(8, 15, 15, 14) },
          { exerciseId: 'ohTricepsExt', sets: sets(15, 12, 12, 12) },
          { exerciseId: 'lateralRaise', sets: sets(6, 20, 20, 20) },
        ],
      };
      await bootSeeded(t, seedState([
        push,
        { date: '2026-11-06', day: 'legs', entries: [mainEntry('squat', 60, [5, 5, 5])] },
        { date: '2026-11-07', day: 'pullB', entries: [mainEntry('barbellRow', 40, [5, 5, 5, 5, 5])] },
      ]));
      await expectToday(t, 5, 'Push B');

      t.step('Two Lateral raise cards, each with its own suggestion');
      const LR1 = nthCard('Lateral raise', 0);
      const LR2 = nthCard('Lateral raise', 1);
      expectEqual(await t.count('region', /^Lateral raise/), 2, 'Lateral raise cards on Push B');
      await waitHeadlineWithin(t, LR1, 'Go lighter → 5.5 kg', 'Lateral raise #1 (with Triceps pushdown): a set fell under 15');
      await waitHeadlineWithin(t, LR2, `Add 2.5 kg today → 8.5 kg`, 'Lateral raise #2 (with Overhead triceps extension)');

      t.step('Different pre-filled weights');
      await openCardWithin(t, LR1, 'Lateral raise #1');
      await expectSetWeightsWithin(t, LR1, 'Lateral raise #1', 5.5, 3);
      await openCardWithin(t, LR2, 'Lateral raise #2');
      await expectSetWeightsWithin(t, LR2, 'Lateral raise #2', 8.5, 3);
      expect((await t.text({ within: LR1 })).includes('Triceps pushdown'), 'Lateral raise #1 is the one supersetted with Triceps pushdown');
      expect((await t.text({ within: LR2 })).includes('Overhead triceps extension'), 'Lateral raise #2 is the one supersetted with Overhead triceps extension');

      t.step('Log both; saved in card order, so each keeps its own track');
      for (const [w, list] of [[LR1, [15, 15, 15]], [LR2, [20, 20, 20]]]) {
        for (let i = 0; i < list.length; i++) await t.type(`Set ${i + 1} reps`, list[i], { within: w });
      }
      await saveWorkout(t, 'Push B', D0);
      const saved = (await t.getJSON(STORAGE_KEY)).sessions.find((s) => s.date === D0 && s.day === 'pushB');
      expectEqual(saved?.entries?.filter((e) => e.exerciseId === 'lateralRaise').map((e) => e.sets), [sets(5.5, 15, 15, 15), sets(8.5, 20, 20, 20)],
        'Saved lateral raises, in card order (#1 then #2)');
      await moveTo(t, addDays(D0, 1));
      await pickDay(t, `Day 2 ${DOT} Push A`);
      await expectToday(t, 2, 'Push A');
      await waitHeadlineWithin(t, nthCard('Lateral raise', 0), 'Keep 5.5 kg', 'Lateral raise #1 on the next push day');
      await waitHeadlineWithin(t, nthCard('Lateral raise', 1), `Add 2.5 kg today → 11 kg`, 'Lateral raise #2 on the next push day');

      t.step('Progress lists the second track under its plan name');
      await goTab(t, 'Progress');
      await t.click('One at a time');
      await t.waitForRole('button', { startsWith: `Lateral raise ${DOT} with Overhead triceps extension` });
    },
  },

  {
    id: 'weight-step',
    title: 'Weight step (§17.2): Lat pulldown (machine) adds 5 kg; a 1 kg step set in the Set weight sheet drives Hammer curl\'s next suggestions',
    timeout: 120000,
    async run(t) {
      await bootSeeded(t, seedState([
        { date: '2026-11-05', day: 'pullA', entries: [
          mainEntry('deadlift', 100, [5]),
          { exerciseId: 'latPulldown', sets: sets(45, 12, 12, 12) },
          { exerciseId: 'hammerCurl', sets: sets(12, 12, 12, 12, 12) },
        ] },
        { date: '2026-11-06', day: 'pushA', entries: [mainEntry('bench', 50, [5, 5, 5, 5, 5])] },
        { date: '2026-11-07', day: 'legs', entries: [mainEntry('squat', 60, [5, 5, 5])] },
      ]));
      await expectToday(t, 4, 'Pull B');

      t.step('Machine: the default step is 5 kg');
      await waitHeadline(t, 'Lat pulldown', `Add 5 kg today → 50 kg`);
      await openCard(t, 'Lat pulldown');
      await expectSetWeights(t, 'Lat pulldown', 50, 3);

      t.step('Free weight: 2.5 kg until the user sets a step');
      await waitHeadline(t, 'Hammer curl', `Add 2.5 kg today → 14.5 kg`);
      const SHEET = { role: 'dialog', name: 'Set weight: Hammer curl' };
      await clickInside(t, card('Hammer curl'), 'Set weight');
      await t.waitForRole('dialog', SHEET.name);
      await t.type(/step/i, 1, { within: SHEET });
      await t.click('Save', { within: SHEET });
      await t.waitGone('dialog', SHEET.name);
      await waitStored(t, 'steps.hammerCurl = 1', (st) => st.steps?.hammerCurl === 1);

      t.step('The suggestion uses the 1 kg step');
      await waitHeadline(t, 'Hammer curl', `Add 1 kg today → 13 kg`);
      await openCard(t, 'Hammer curl');
      await expectSetWeights(t, 'Hammer curl', 13, 4);
      await waitHeadline(t, 'Lat pulldown', `Add 5 kg today → 50 kg`); // other exercises keep their own step

      t.step('Log it; the next pull day adds 1 kg again');
      await fillSets(t, 'Hammer curl', reps(12, 12, 12, 12));
      await saveWorkout(t, 'Pull B', D0);
      const saved = (await t.getJSON(STORAGE_KEY)).sessions.find((s) => s.date === D0 && s.day === 'pullB');
      expectEqual(saved?.entries?.find((e) => e.exerciseId === 'hammerCurl')?.sets, sets(13, 12, 12, 12, 12), 'Saved Hammer curl sets');
      await moveTo(t, addDays(D0, 1));
      await pickDay(t, `Day 1 ${DOT} Pull A`);
      await expectToday(t, 1, 'Pull A');
      await waitHeadline(t, 'Hammer curl', `Add 1 kg today → 14 kg`);
    },
  },

  {
    id: 'plank-timed',
    title: 'Plank is timed (§17.3): target = shortest hold + 5 s, shown in seconds; 60 s on every set → a plate on the back, back to 30 s',
    timeout: 120000,
    async run(t) {
      await bootSeeded(t, seedStateWith([
        { date: '2026-11-07', day: 'pullA', entries: [
          mainEntry('deadlift', 100, [5]),
          { exerciseId: 'plank', sets: sets(0, 50, 45, 42) },
          { exerciseId: 'hangingLegRaise', sets: sets(0, 10, 10, 10) },
        ] },
        { date: '2026-11-08', day: 'pushA', entries: [mainEntry('bench', 50, [5, 5, 5, 5, 5])] },
      ], { settings: { abs: true }, choices: { 'abs.1': 'plank' } }));
      await expectToday(t, 3, 'Legs');

      t.step('Plank: keep the weight, hold 47 s (shortest last time 42 s + 5)');
      await waitCard(t, 'Plank');
      const head = await waitHeadlineWithin(t, { name: 'Plank' }, /\S/, 'Plank');
      expect(head !== 'Any reps', 'Plank uses the timed suggestion, not "Any reps"');
      await openCardWithin(t, { name: 'Plank' }, 'Plank');
      await t.waitForText(/\b47 s\b/, { within: card('Plank') });
      await expectSetWeights(t, 'Plank', 0, 3);
      await waitHeadline(t, 'Hanging leg raise', 'Any reps'); // the other abs exercises keep "Any reps"

      t.step('Hold 60 s on every set');
      await fillSets(t, 'Plank', reps(60, 60, 60));
      await saveWorkout(t, 'Legs', D0);
      const saved = (await t.getJSON(STORAGE_KEY)).sessions.find((s) => s.date === D0 && s.day === 'legs');
      expectEqual(saved?.entries?.find((e) => e.exerciseId === 'plank')?.sets, sets(0, 60, 60, 60), 'Saved plank holds (seconds in the reps field)');

      t.step('Next abs day: a plate on the back (2.5 kg), target back to 30 s');
      await moveTo(t, addDays(D0, 1));
      await pickDay(t, `Day 1 ${DOT} Pull A`);
      await expectToday(t, 1, 'Pull A');
      await waitCard(t, 'Plank');
      const head2 = await waitHeadlineWithin(t, { name: 'Plank' }, /\S/, 'Plank');
      expect(head2 !== 'Any reps', 'Plank uses the timed suggestion, not "Any reps"');
      await openCardWithin(t, { name: 'Plank' }, 'Plank');
      await t.waitForText(/\b30 s\b/, { within: card('Plank') });
      await expectSetWeights(t, 'Plank', 2.5, 3);
    },
  },

  {
    id: 'barbell-plates',
    title: 'Total weight and plates (§17.4): 62.5 kg = 20 kg bar + 21.25 kg each side; Barbell weight 15 changes the plates and the warm-up',
    timeout: 120000,
    async run(t) {
      await bootSeeded(t, seedState(SEED_WEEK));
      await expectToday(t, 6, 'Legs');
      await waitHeadline(t, 'Squat', `Add 2.5 kg today → 62.5 kg`);

      t.step('Squat (barbell): "Total weight" and the plate line');
      await openCard(t, 'Squat');
      await t.waitForText('Total weight', { within: card('Squat') });
      await t.waitForText('= 20 kg bar + 21.25 kg each side', { within: card('Squat') });
      // Changed for §18.2 (20/11/2026): the warm-up is a checklist; its first row is the 20 kg bar × 10.
      await expectWarmups(t, 'Squat', warmupSets(62.5, 'kg', 20), null, '20 kg bar');
      expectEqual(warmupSets(62.5, 'kg', 20)[0], { weight: 20, reps: 10 }, 'warmupSets(62.5 kg, bar 20) starts with the bar × 10');

      t.step('Leg press (machine): "Weight (stack)"');
      await openCard(t, 'Leg press');
      await t.waitForText('Weight (stack)', { within: card('Leg press') });

      t.step('Plan rules card');
      await goTab(t, 'Plan');
      const RULE = 'Weights are the total on the bar, bar included.';
      await t.poll((lib, want) => (lib.norm(document.body.textContent).includes(want) ? { ok: true } : { pending: true, why: 'not in the Plan screen' }),
        [RULE], { what: `the Plan rules card to say "${RULE}"` });

      t.step('Data → Settings: Barbell weight 15');
      await goTab(t, 'Data');
      await t.type(/^Barbell weight/, 15);
      await t.press('Enter');
      await waitStored(t, 'settings.barWeight = 15', (st) => st.settings?.barWeight === 15);

      t.step('Today: plates and warm-up use the 15 kg bar');
      await goTab(t, 'Today');
      await expectToday(t, 6, 'Legs');
      await openCard(t, 'Squat');
      await expectSetWeights(t, 'Squat', 62.5, 3);
      await t.waitForText('= 15 kg bar + 23.75 kg each side', { within: card('Squat') });
      // Changed for §18.2 (20/11/2026): the checklist follows the 15 kg bar.
      await expectWarmups(t, 'Squat', warmupSets(62.5, 'kg', 15), null, '15 kg bar');
      expectEqual(warmupSets(62.5, 'kg', 15)[0], { weight: 15, reps: 10 }, 'warmupSets(62.5 kg, bar 15) starts with the bar × 10');
    },
  },

  {
    id: 'add-exercise-touch',
    title: 'Add exercise on iPhone (§17.5, real touch): no autofocus, first tap adds "Leg press" (open, on screen, toast); Enter adds typed / single match; empty Enter does nothing',
    timeout: 120000,
    async run(t) {
      const ADD = { role: 'dialog', name: 'Add exercise' };
      const openAdd = async () => {
        await t.tap('+ Add exercise', { within: 'document' });
        await t.waitForRole('dialog', ADD.name);
      };
      await t.enableTouch();
      await boot(t);
      await expectToday(t, 1, 'Pull A');

      t.step('The sheet opens with no text box focused (no keyboard over the list)');
      await openAdd();
      await sleep(400);
      const focused = await focusedTextEntry(t);
      expect(!focused, `The Add exercise sheet must not focus a text box when it opens (the iPhone keyboard covers the list); focused: ${focused}`);
      await expectOptionHeights(t, ADD.name, ['Leg press', 'Deadlift', 'Lateral raise', 'Plank']);

      t.step('One tap on "Leg press" adds it');
      await t.clearStatusLog();
      await t.tap(/^Leg press(?! calf)/, { within: ADD });
      await t.waitGone('dialog', ADD.name);
      await t.waitForStatus('Added Leg press');
      await t.waitForRole('region', 'Leg press');
      expectEqual(await t.count('region', 'Leg press'), 1, 'Leg press cards after one tap');
      await t.poll((lib) => (lib.findOne({ field: true, name: 'Set 1 reps', within: { name: 'Leg press' } }) ? { ok: true } : { pending: true, why: 'the card is closed' }),
        [], { timeout: 3000, what: 'the new Leg press card to be open (its "Set 1 reps" box showing)' });
      await expectCardInViewport(t, 'Leg press');

      t.step('Typing a name + Enter adds it as a custom exercise');
      await openAdd();
      await t.typeInTextField('Cable Y-raise', { within: ADD });
      await t.clearStatusLog();
      await t.press('Enter');
      await t.waitGone('dialog', ADD.name);
      await t.waitForStatus('Added Cable Y-raise');
      await t.waitForRole('region', 'Cable Y-raise');

      t.step('Enter with a single remaining match adds that exercise');
      await openAdd();
      await t.typeInTextField('skull', { within: ADD });
      await t.clearStatusLog();
      await t.press('Enter');
      await t.waitGone('dialog', ADD.name);
      await t.waitForStatus('Added Skullcrusher');
      await t.waitForRole('region', 'Skullcrusher');

      t.step('Empty Enter does nothing');
      await openAdd();
      const before = await cardCount(t);
      await t.typeInTextField('', { within: ADD });
      await t.clearStatusLog();
      await t.press('Enter');
      await sleep(500);
      expect(await t.exists('dialog', ADD.name), 'Empty Enter must leave the Add exercise sheet open');
      expectEqual(await cardCount(t), before, 'Cards after an empty Enter');
      const log = await t.statusLog();
      expect(!log.some((m) => /^Added\b/.test(m)), `Empty Enter must not add anything; status messages: ${JSON.stringify(log)}`);

      t.step('First tap works while the search box has focus');
      await t.typeInTextField('curl', { within: ADD });
      await t.clearStatusLog();
      await t.tap({ startsWith: 'Leg curl' }, { within: ADD });
      await t.waitGone('dialog', ADD.name);
      await t.waitForStatus('Added Leg curl');
      await t.waitForRole('region', 'Leg curl');
      await expectCardInViewport(t, 'Leg curl');
    },
  },

  {
    id: 'swap-touch',
    title: 'Swap on iPhone (§17.5, real touch): Hanging leg raise → Plank renames the card, toasts, persists; Custom… + Enter saves',
    async run(t) {
      const SA = { role: 'dialog', name: 'Swap: Abs' };
      await t.enableTouch();
      await bootSeeded(t, seedStateWith([], { settings: { abs: true } }));
      await expectToday(t, 1, 'Pull A');

      t.step('Swap Hanging leg raise → Plank with one tap');
      await waitCard(t, 'Hanging leg raise');
      await tapInside(t, card('Hanging leg raise'), 'Swap');
      await t.waitForRole('dialog', SA.name);
      await expectOptionHeights(t, SA.name, ['Hanging leg raise', 'Plank', 'Ab wheel rollout', 'Custom…']);
      await t.clearStatusLog();
      await t.tap({ startsWith: 'Plank' }, { within: SA });
      await t.waitGone('dialog', SA.name);
      await t.waitForRole('region', 'Plank');
      expect(!(await t.exists('region', 'Hanging leg raise')), 'The Hanging leg raise card should now be Plank');
      await t.waitForStatus('Swapped to Plank');
      await waitStored(t, 'choices["abs.2"] = "plank"', (st) => st.choices?.['abs.2'] === 'plank');

      t.step('The swap persists after a reload');
      await t.reload();
      await waitNav(t);
      await expectToday(t, 1, 'Pull A');
      await t.waitForRole('region', 'Plank');
      expect(!(await t.exists('region', 'Hanging leg raise')), 'After reload Hanging leg raise is back — the swap was not saved');

      t.step('Custom… + Enter on the other abs slot');
      await tapInside(t, card('Ab wheel rollout'), 'Swap');
      await t.waitForRole('dialog', SA.name);
      await t.tap({ startsWith: 'Custom' }, { within: SA });
      await t.typeInTextField('Dragon flag', { within: SA });
      await t.press('Enter');
      await t.waitGone('dialog', SA.name);
      await t.waitForRole('region', 'Dragon flag');
      expect(!(await t.exists('region', 'Ab wheel rollout')), 'The Ab wheel rollout card should now be Dragon flag');
      await waitStored(t, 'choices["abs.1"] = "custom:Dragon flag"', (st) => st.choices?.['abs.1'] === 'custom:Dragon flag');
    },
  },

  // ------------------------------------------------------------------ added by the independent review of Batch 1

  {
    id: 'review-plate-line-scope',
    title: 'Plate line only on a standard bar loaded on both ends: Deadlift / Bench press yes; EZ-bar curl, Skullcrusher and Landmine press keep "Total weight" but get no plate line',
    timeout: 120000,
    async run(t) {
      const NO_LINE = /each side|Empty bar|Lighter than the bar/;
      await bootSeeded(t, seedStateWith([
        { date: '2026-11-01', day: 'pullA', entries: [mainEntry('deadlift', 100, [5]), { exerciseId: 'ezCurl', sets: sets(25, 12, 12, 12, 12) }] },
        { date: '2026-11-02', day: 'pushA', entries: [
          mainEntry('bench', 50, [5, 5, 5, 5, 5]),
          { exerciseId: 'landminePress', sets: sets(30, 10, 10, 10) },
          { exerciseId: 'skullcrusher', sets: sets(15, 12, 12, 12) },
        ] },
        { date: '2026-11-03', day: 'legs', entries: [mainEntry('squat', 60, [5, 5, 5])] },
        { date: '2026-11-04', day: 'pullB', entries: [mainEntry('barbellRow', 40, [5, 5, 5, 5, 5])] },
        { date: '2026-11-05', day: 'pushB', entries: [mainEntry('ohp', 30, [5, 5, 5, 5, 5])] },
        { date: '2026-11-06', day: 'legs', entries: [mainEntry('squat', 62.5, [5, 5, 5])] },
      ], { choices: { 'pull.curl1': 'ezCurl', 'push.incline': 'landminePress', 'push.tri1': 'skullcrusher' } }));
      await expectToday(t, 1, 'Pull A');

      t.step('Deadlift: a standard bar → the plate line');
      await openCard(t, 'Deadlift');
      await t.waitForText('= 20 kg bar + 42.5 kg each side', { within: card('Deadlift') });

      t.step('EZ-bar curl: "Total weight", no plate line (an EZ bar is not a 20 kg bar)');
      await openCard(t, 'EZ-bar curl');
      await t.waitForText('Total weight', { within: card('EZ-bar curl') });
      const ez = await t.text({ within: card('EZ-bar curl') });
      expect(!NO_LINE.test(ez), `EZ-bar curl must not show a 20 kg-bar plate line; card text: ${JSON.stringify(ez)}`);
      await t.type('Set 1 weight', 15, { within: card('EZ-bar curl') });
      const ez15 = await t.text({ within: card('EZ-bar curl') });
      expect(!NO_LINE.test(ez15), `EZ-bar curl at 15 kg must not say it is lighter than the bar; card text: ${JSON.stringify(ez15)}`);

      t.step('Push A: Bench press has the line; Landmine press and Skullcrusher do not');
      await pickDay(t, `Day 2 ${DOT} Push A`);
      await expectToday(t, 2, 'Push A');
      await openCard(t, 'Bench press');
      await t.waitForText(/= 20 kg bar \+ [\d.]+ kg each side/, { within: card('Bench press') });
      for (const name of ['Landmine press', 'Skullcrusher']) {
        await openCard(t, name);
        await t.waitForText('Total weight', { within: card(name) });
        const text = await t.text({ within: card(name) });
        expect(!NO_LINE.test(text), `${name} must not show a plate line; card text: ${JSON.stringify(text)}`);
      }
    },
  },

  {
    id: 'review-plank-seconds',
    title: 'Plank holds read as seconds everywhere: after an off day the card names the session it went by; History and the import preview show "… s"',
    timeout: 120000,
    async run(t) {
      await bootSeeded(t, seedStateWith([
        { date: '2026-10-31', day: 'pullA', entries: [mainEntry('deadlift', 100, [5]), { exerciseId: 'abWheel', sets: sets(0, 10, 10, 10) }, { exerciseId: 'plank', sets: sets(0, 40, 40, 40) }] },
        { date: '2026-11-01', day: 'pushA', entries: [mainEntry('bench', 50, [5, 5, 5, 5, 5])] },
        { date: '2026-11-02', day: 'legs', offDay: true, entries: [mainEntry('squat', 60, [5, 5, 3]), { exerciseId: 'plank', sets: sets(0, 20, 20, 15) }] },
        { date: '2026-11-03', day: 'pullB', entries: [mainEntry('barbellRow', 40, [5, 5, 5, 5, 5])] },
        { date: '2026-11-04', day: 'pushB', entries: [mainEntry('ohp', 30, [5, 5, 5, 5, 5])] },
      ], { settings: { abs: true }, choices: { 'abs.2': 'plank' } }));
      await expectToday(t, 6, 'Legs');

      t.step('Plank: the off day is passed over, and the card says so instead of calling 31/10 "last time"');
      await waitHeadline(t, 'Plank', 'Hold 45 s');
      await openCard(t, 'Plank');
      const text = await t.text({ within: card('Plank') });
      expect(text.includes('Last time was an off day') && text.includes('31/10: 40, 40, 40 s'),
        `Plank detail should say the last time was an off day and name 31/10 (40, 40, 40 s); card text: ${JSON.stringify(text)}`);
      expect(!text.includes('Last time: 40, 40, 40 s'), `Plank detail must not call 31/10 "last time" (02/11 was 20, 20, 15 s); card text: ${JSON.stringify(text)}`);

      t.step('History: plank holds in seconds, collapsed and open');
      await goTab(t, 'History');
      const label = historyLabel('2026-11-02', 3, 'Legs');
      await t.waitForRole('article', label);
      const closed = await t.text({ within: { role: 'article', name: label } });
      expect(closed.includes('Plank 0×20,20,15 s'), `Collapsed History line should show the holds in seconds; text: ${JSON.stringify(closed)}`);
      await t.click({ startsWith: `${weekday('2026-11-02')} ${dmy('2026-11-02')}` }, { within: { role: 'article', name: label } });
      await t.waitForText('0 kg × 20, 20, 15 s', { within: { role: 'article', name: label } });

      t.step('Data → import preview shows holds in seconds');
      await goTab(t, 'Data');
      await t.type('Paste workouts', ['05/11/2026 Legs', 'Squat 62.5x5 x3', 'Plank 0x45 0x45 0x40'].join('\n'));
      await t.click('Preview');
      await t.waitForRole('button', { startsWith: 'Import ' });
      await t.waitForText('Plank 0×45,45,40 s');
    },
  },

  {
    id: 'review-add-plural',
    title: 'Add exercise search with a plural ("hammer curls", real touch): the list shows Hammer curl (no "No match" note) and one tap adds it',
    async run(t) {
      const ADD = { role: 'dialog', name: 'Add exercise' };
      await t.enableTouch();
      await boot(t);
      await expectToday(t, 1, 'Pull A');
      await t.tap('+ Add exercise', { within: 'document' });
      await t.waitForRole('dialog', ADD.name);
      await t.typeInTextField('hammer curls', { within: ADD });
      await t.waitForRole('button', 'Hammer curl', { within: ADD });
      const shown = await t.text({ within: ADD });
      expect(!/No match/.test(shown), `The list should not say "No match" for "hammer curls"; sheet text: ${JSON.stringify(shown)}`);
      await t.clearStatusLog();
      await t.tap('Hammer curl', { within: ADD });
      await t.waitGone('dialog', ADD.name);
      await t.waitForStatus('Added Hammer curl');
      expectEqual(await t.count('region', 'Hammer curl'), 2, 'Hammer curl cards (the plan\'s curl slot + the added one)');
    },
  },

  // ------------------------------------------------------------------ Batch 2 (§18, 20/11/2026)

  {
    id: 'b2-rest-timer',
    title: 'Rest timer (§18.1, option B): Enter on set 1 reps starts it inside that card under set 1; Ready → +30 s → Over; survives tab switch and reload; set 2 / another card moves it; one at a time; Skip removes it',
    timeout: 150000,
    async run(t) {
      await t.enableTouch();
      await bootSeeded(t, seedState(SEED_WEEK));
      await expectToday(t, 6, 'Legs');
      await openCard(t, 'Squat');

      t.step('Typing alone starts nothing; Enter commits set 1');
      await typeNoCommit(t, 'Set 1 reps', 5, { name: 'Squat' });
      await sleep(400);
      expectEqual(await t.count('timer', 'Rest timer', { within: 'document' }), 0, 'Rest timers before the reps are committed');
      await t.press('Enter');
      await t.waitForRole('timer', 'Rest timer', { within: card('Squat') });
      let place = await waitTimerAt(t, 'Squat', 1, 2, 'After Enter on Squat set 1');
      expect(/Rest \d+:\d\d/.test(place.text) && place.text.includes('aim 3–5 min'),
        `The timer should read like "Rest 0:05 · aim 3–5 min" (counting up, main-lift range); got ${JSON.stringify(place.text)}`);
      await t.waitForRole('button', '+30 s', { within: TIMER });
      await t.waitForRole('button', 'Skip', { within: TIMER });
      let st = await waitStored(t, 'draft.rest = { uid, set, startedAt, extra }', (s) => typeof s.draft?.rest?.startedAt === 'number');
      const squatUid = st.draft.entries?.find((e) => e.exerciseId === 'squat')?.uid;
      expectEqual(st.draft.rest.uid, squatUid, 'draft.rest.uid is the Squat card');
      expectEqual(st.draft.rest.extra ?? 0, 0, 'draft.rest.extra starts at 0');
      const start1 = st.draft.rest.startedAt;

      t.step('A tab switch keeps it');
      await goTab(t, 'Plan');
      await goTab(t, 'Today');
      await waitTimerAt(t, 'Squat', 1, 2, 'After Plan → Today');

      await jumpTo(t, start1 + 183000, '3 min 3 s after set 1');
      await waitTimerAt(t, 'Squat', 1, 2, 'After a reload');
      await t.waitForText('Ready — go when you are', { within: card('Squat') });

      t.step('+30 s pushes the target past now');
      await t.tap('+30 s', { within: TIMER });
      await waitStored(t, 'draft.rest.extra = 30', (s) => s.draft?.rest?.extra === 30);
      await waitNoText(t, 'Ready — go when you are', card('Squat'), 'the timer to be resting again after +30 s (target 3:30)');

      await jumpTo(t, start1 + 345000, 'past 5 min + 30 s');
      await waitTimerAt(t, 'Squat', 1, 2, 'Still under set 1');
      await t.waitForText(/Over\b.*\bget going/, { within: card('Squat') });

      t.step('Committing set 2 moves it under set 2 and restarts it');
      await typeNoCommit(t, 'Set 2 reps', 5, { name: 'Squat' });
      await t.press('Enter');
      place = await waitTimerAt(t, 'Squat', 2, 3, 'After Enter on Squat set 2');
      expect(/Rest 0:0\d/.test(place.text) && !/Over|Ready/.test(place.text), `A new set restarts the timer from 0:00; got ${JSON.stringify(place.text)}`);
      st = await waitStored(t, 'draft.rest restarted for set 2', (s) => s.draft?.rest?.startedAt >= start1 + 340000);
      expectEqual(st.draft.rest.uid, squatUid, 'draft.rest.uid is still the Squat card');
      expectEqual(st.draft.rest.extra ?? 0, 0, 'A restarted timer has no extra time');

      t.step('Committing on another card moves it there (only one timer)');
      await openCard(t, 'Romanian deadlift');
      await typeNoCommit(t, 'Set 1 reps', 10, { name: 'Romanian deadlift' });
      await t.press('Enter');
      place = await waitTimerAt(t, 'Romanian deadlift', 1, 2, 'After Enter on Romanian deadlift set 1');
      expect(place.text.includes('aim 1–3 min'), `Accessory range on the Romanian deadlift timer; got ${JSON.stringify(place.text)}`);
      expectEqual(await t.count('timer', 'Rest timer', { within: card('Squat') }), 0, 'Rest timers left in the Squat card');
      st = await waitStored(t, 'draft.rest on the Romanian deadlift card', (s) => s.draft?.rest?.uid && s.draft.rest.uid !== squatUid);
      expectEqual(st.draft.rest.uid, st.draft.entries?.find((e) => e.exerciseId === 'rdl')?.uid, 'draft.rest.uid is the Romanian deadlift card');
      const start2 = st.draft.rest.startedAt;

      await jumpTo(t, start2 + 65000, '65 s after the accessory set');
      await waitTimerAt(t, 'Romanian deadlift', 1, 2, 'Accessory timer after a reload');
      await t.waitForText('Ready — go when you are', { within: card('Romanian deadlift') });
      await jumpTo(t, start2 + 190000, '3 min 10 s after the accessory set');
      await t.waitForText('Over 3 min — get going', { within: card('Romanian deadlift') });

      t.step('Skip removes it');
      await t.tap('Skip', { within: TIMER });
      await t.waitGone('timer', 'Rest timer', { within: 'document' });
      await waitStored(t, 'draft.rest cleared by Skip', (s) => !!s.draft && !s.draft.rest);
      await t.reload();
      await waitNav(t);
      await openCard(t, 'Romanian deadlift');
      await sleep(300);
      expectEqual(await t.count('timer', 'Rest timer', { within: 'document' }), 0, 'Rest timers after Skip and a reload');
    },
  },

  {
    id: 'b2-warmup-checklist',
    title: 'Warm-up checklist (§18.2): "Warm-up 20 × 10" … checkboxes, "N of 4 done"; ticks survive a reload, live in the draft, reset when set 1\'s weight changes, and are not saved',
    timeout: 120000,
    async run(t) {
      await bootSeeded(t, seedState(SEED_WEEK));
      await expectToday(t, 6, 'Legs');
      t.step('"Last workout" without a time for a workout logged before times existed (§18.3)');
      await t.waitForText(new RegExp(`Last workout: ${weekday('2026-11-05')} 05/11(?! at)`));

      t.step('One checkbox per warm-up set');
      const ramp = warmupSets(62.5, 'kg', 20);
      expectEqual(ramp.length, 4, 'warmupSets(62.5 kg) has 4 sets');
      await openCard(t, 'Squat');
      await expectWarmups(t, 'Squat', ramp, [false, false, false, false], 'at 62.5 kg');
      await t.waitForText('empty bar', { within: card('Squat') });

      t.step('Tick two → "2 of 4 done"');
      await tickWarmup(t, 'Squat', 0);
      await t.waitForText('1 of 4 done', { within: card('Squat') });
      await tickWarmup(t, 'Squat', 1);
      await t.waitForText('2 of 4 done', { within: card('Squat') });
      await expectWarmups(t, 'Squat', ramp, [true, true, false, false], 'after two ticks');
      let st = await waitStored(t, 'draft.warmup with two ticks', (s) => Object.values(s.draft?.warmup || {}).some((v) => Array.isArray(v) && v.length === 2));
      const uid = st.draft.entries?.find((e) => e.exerciseId === 'squat')?.uid;
      expectEqual([...(st.draft.warmup?.[uid] || [])].sort((a, b) => a - b), [0, 1], 'draft.warmup[<Squat uid>] holds the ticked rows');

      t.step('Ticks survive a reload');
      await t.reload();
      await waitNav(t);
      await openCard(t, 'Squat');
      await expectWarmups(t, 'Squat', ramp, [true, true, false, false], 'after a reload');
      await t.waitForText('2 of 4 done', { within: card('Squat') });

      t.step('Set 1 weight 70 → a new list, ticks reset');
      await t.type('Set 1 weight', 70, { within: card('Squat') });
      const ramp70 = warmupSets(70, 'kg', 20);
      await expectWarmups(t, 'Squat', ramp70, ramp70.map(() => false), 'after set 1 weight 62.5 → 70');
      await t.waitForText(`0 of ${ramp70.length} done`, { within: card('Squat') });
      await waitStored(t, 'the Squat warm-up ticks reset in the draft', (s) => !(s.draft?.warmup?.[uid] || []).length);

      t.step('Ticks are not saved into the workout');
      await tickWarmup(t, 'Squat', 0);
      await t.waitForText(`1 of ${ramp70.length} done`, { within: card('Squat') });
      await fillSets(t, 'Squat', reps(5, 5, 5));
      await saveWorkout(t, 'Legs', D0);
      const saved = (await t.getJSON(STORAGE_KEY)).sessions.find((s) => s.date === D0 && s.day === 'legs');
      expectEqual(saved?.entries?.find((e) => e.exerciseId === 'squat')?.sets, sets(70, 5, 5, 5), 'Saved Squat sets');
      expect(!/warm/i.test(JSON.stringify(saved)), `The saved workout must not carry warm-up ticks: ${JSON.stringify(saved)}`);
    },
  },

  {
    id: 'b2-workout-times',
    title: 'Workout times (§18.3): "Last workout: Thu 05/11 at HH:MM", "Started HH:MM · N min so far", Save stores start/finish, History "HH:MM – HH:MM · N min" / "Time not recorded", editing keeps them, CSV round trip keeps them',
    timeout: 180000,
    async run(t) {
      const LAST = '2026-11-05';
      const seed = SEED_WEEK.map((s) => (s.date === LAST ? { ...s, startedAt: `${LAST}T18:40`, finishedAt: `${LAST}T19:41` } : s));
      await bootSeeded(t, seedState(seed));
      await expectToday(t, 6, 'Legs');

      t.step('Before starting: "Last workout: Thu 05/11 at …"');
      // The spec's example time could be the start (mock: 18:40) or the finish; either is accepted.
      await t.waitForText(new RegExp(`Last workout: ${weekday(LAST)} 05/11 at (18:40|19:41)\\b`));

      t.step('First reps: draft.startedAt and "Started HH:MM"');
      await fillSets(t, 'Squat', reps(5));
      let st = await waitStored(t, 'draft.startedAt', (s) => typeof s.draft?.startedAt === 'string');
      const S = st.draft.startedAt;
      expect(/^2026-11-10T09:0\d$/.test(S), `draft.startedAt should be the local time of the first reps ("2026-11-10T09:0x"); got ${JSON.stringify(S)}`);
      await t.waitForText(`Started ${hm(S)}`);
      expect(!(await t.text()).includes('Last workout:'), 'Once started, the header shows "Started …" instead of "Last workout: …"');

      await t.setClock(at(D0, '09:25'));
      t.step('25 minutes later (reload): "Started HH:MM · N min so far"');
      await t.reload();
      await waitNav(t);
      const soFar = clockMinutes(`${D0}T09:25`) - clockMinutes(S);
      await t.waitForText(`Started ${hm(S)} ${DOT} ${soFar} min so far`);

      t.step('More reps: the start time is set once');
      await fillSets(t, 'Squat', reps(5, 5, 6));
      await sleep(600);
      expectEqual((await t.getJSON(STORAGE_KEY)).draft?.startedAt, S, 'draft.startedAt keeps the first reps\' time');

      t.step('Save stores startedAt and finishedAt');
      await t.clearStatusLog();
      await t.click('Save workout', { within: 'document' });
      await t.waitForRole('dialog', SAVED.name, { timeout: 8000 });
      st = await t.getJSON(STORAGE_KEY);
      const saved = st.sessions.find((s) => s.date === D0 && s.day === 'legs');
      expectEqual(saved?.startedAt, S, 'Saved startedAt');
      const F = saved?.finishedAt;
      expect(/^2026-11-10T09:2[5-6]$/.test(F || ''), `Saved finishedAt should be the save time ("2026-11-10T09:25"); got ${JSON.stringify(F)}`);
      const dur = `${clockMinutes(F) - clockMinutes(S)} min`;
      await t.waitForText(dur, { within: SAVED }); // the duration tile (§18.5)
      await t.click('Nice', { within: SAVED });
      await t.waitGone('dialog', SAVED.name);
      await t.waitForStatus(`Saved Legs ${DOT} ${dmy(D0)}`);

      t.step('Done for today shows the times');
      await expectDone(t, 'Pull A');
      await t.waitForText(`${hm(S)} – ${hm(F)}`);

      t.step('History: "HH:MM – HH:MM · N min", or "Time not recorded"');
      await goTab(t, 'History');
      const A6 = { role: 'article', name: historyLabel(D0, 6, 'Legs') };
      await t.waitForRole('article', A6.name);
      await waitFullText(t, `${hm(S)} – ${hm(F)} ${DOT} ${dur}`, A6);
      await waitFullText(t, `18:40 – 19:41 ${DOT} 1 h 1 min`, { role: 'article', name: historyLabel(LAST, 5, 'Push B') });
      await waitFullText(t, 'Time not recorded', { role: 'article', name: historyLabel('2026-11-04', 4, 'Pull B') });

      t.step('Editing the workout later keeps its times');
      await t.setClock(at(D0, '10:30'));
      await t.reload();
      await waitNav(t);
      await goTab(t, 'Today');
      await expectDone(t, 'Pull A');
      await t.click('Edit', { within: 'document' });
      await t.waitForText(`Editing ${dmy(D0)}`);
      await openCard(t, 'Squat');
      await t.type('Set 3 reps', 8, { within: card('Squat') });
      await t.clearStatusLog();
      await t.click('Save workout', { within: 'document' });
      await t.waitForStatus(`Saved Legs ${DOT} ${dmy(D0)}`);
      await sleep(600);
      expect(!(await t.exists('dialog', SAVED.name)), '"Workout saved" is for new workouts only, not for an edit');
      st = await t.getJSON(STORAGE_KEY);
      const edited = st.sessions.find((s) => s.date === D0 && s.day === 'legs');
      expectEqual(edited?.entries?.find((e) => e.exerciseId === 'squat')?.sets?.map((x) => x.reps), [5, 5, 8], 'Edited squat reps');
      expectEqual([edited?.startedAt, edited?.finishedAt], [S, F], 'Editing keeps startedAt / finishedAt');
      const before = timesByKey(st.sessions);

      t.step('CSV backup → Delete everything → import keeps the times');
      await goTab(t, 'Data');
      await t.click('Export backup (CSV)');
      const dl = await t.waitForDownload({ timeout: 8000 });
      const csv = dl.text.replace(/^\uFEFF/, '');
      const head = csv.split('\n')[0].split(',');
      expect(head.includes('started_at') && head.includes('finished_at'), `The CSV backup needs started_at / finished_at columns; header: ${csv.split('\n')[0]}`);
      await t.click(DELETE_ALL);
      await t.type('Type DELETE', 'DELETE');
      await t.click('Delete');
      await t.waitFieldGone('Type DELETE');
      await skipSetupIfShown(t);
      expectEqual((await t.getJSON(STORAGE_KEY))?.sessions?.length ?? 0, 0, 'Stored workouts after Delete everything');
      await goTab(t, 'Data');
      await t.type('Paste workouts', csv);
      await t.click('Preview');
      await t.waitForRole('button', { startsWith: 'Import ' });
      await t.click({ startsWith: 'Import ' });
      await skipSetupIfShown(t, 400);
      const after = await waitStored(t, `${seed.length + 1} workouts imported`, (s) => s.sessions?.length === seed.length + 1);
      expectEqual(timesByKey(after.sessions), before, 'Workout times after the CSV backup round trip');
    },
  },

  {
    id: 'b2-done-for-today',
    title: 'Done for today (§18.4): after saving today\'s workout Today shows "Done for today ✓" (card, Edit, Up next) across tabs and reloads until midnight; after midnight the next workout',
    timeout: 150000,
    async run(t) {
      await boot(t);
      await expectToday(t, 1, 'Pull A');
      expect(!(await t.text()).includes('Last workout'), 'No "Last workout" line when there is no history (§18.3)');
      await fillSets(t, 'Deadlift', sets(100, 5));
      await fillSets(t, 'Lat pulldown', sets(40, 10, 10, 10));

      t.step('Save: the first workout has no new best → "Workout saved ✓"');
      await t.clearStatusLog();
      await t.click('Save workout', { within: 'document' });
      await t.waitForRole('dialog', SAVED.name, { timeout: 8000 });
      await t.waitForText('Workout saved ✓', { within: SAVED });
      expect(!(await t.text({ within: SAVED })).includes('New best!'), 'A first-ever workout has no new best');
      await t.waitForText(`Next: Day 2 ${DOT} Push A`, { within: SAVED });
      await t.click('Nice', { within: SAVED });
      await t.waitGone('dialog', SAVED.name);
      await t.waitForStatus(`Saved Pull A ${DOT} ${dmy(D0)}`);

      t.step('Done for today ✓: the workout card, Edit, Up next');
      await expectDone(t, 'Push A');
      const text = await t.text();
      expect(text.includes(todayHeading(1, 'Pull A')), `The workout card is titled "${todayHeading(1, 'Pull A')}"; page: ${JSON.stringify(text.slice(0, 400))}`);
      expect(text.includes('Deadlift') && text.includes('Lat pulldown'), `Every exercise of today's workout is listed; page: ${JSON.stringify(text.slice(0, 400))}`);
      expect(/09:00 – 09:0\d/.test(text), `The card shows the workout's times; page: ${JSON.stringify(text.slice(0, 400))}`);
      expect(!text.includes('🏆'), 'No 🏆 without a new best');
      await t.waitForRole('button', 'Edit', { within: 'document' });

      t.step('Still done after a tab switch and a reload');
      await goTab(t, 'History');
      await goTab(t, 'Today');
      await expectDone(t, 'Push A');
      await t.reload();
      await waitNav(t);
      await expectDone(t, 'Push A');

      await t.setClock(at(D0, '23:59'));
      t.step('23:59: still done');
      await t.reload();
      await waitNav(t);
      await expectDone(t, 'Push A');

      const d1 = addDays(D0, 1);
      await t.setClock(at(d1, '00:01'));
      t.step('00:01 the next day: the next workout');
      await t.reload();
      await waitNav(t);
      await expectToday(t, 2, 'Push A');
      await t.waitForRole('button', 'Save workout', { within: 'document' });
      expect(!(await t.text()).includes('Done for today'), '"Done for today" must be gone after midnight');
      await t.waitForText(new RegExp(`Last workout: ${weekday(D0)} ${dmy(D0).slice(0, 5)} at 09:0\\d`));
    },
  },

  {
    id: 'b2-start-next-now',
    title: 'Double day (§18.4): "Start it now instead" shows the next workout and keeps it after a reload that day; reps typed into it never flip back to Done',
    timeout: 120000,
    async run(t) {
      await bootSeeded(t, seedState([...SEED_WEEK, { date: D0, day: 'legs', entries: [mainEntry('squat', 62.5, [5, 5, 5])] }]));
      t.step('A workout saved today → Done for today');
      await expectDone(t, 'Pull A');
      await t.waitForText(todayHeading(6, 'Legs'));

      t.step('Start it now instead');
      await t.click('Start it now instead', { within: 'document' });
      await expectToday(t, 1, 'Pull A');
      await t.waitForRole('button', 'Save workout', { within: 'document' });
      await waitStored(t, `settings.startNextOn = "${D0}"`, (s) => s.settings?.startNextOn === D0);

      t.step('Reload that day: still the next workout');
      await t.reload();
      await waitNav(t);
      await expectToday(t, 1, 'Pull A');
      await t.waitForRole('button', 'Save workout', { within: 'document' });
      expect(!(await t.text()).includes('Done for today'), 'After "Start it now instead" a reload that day keeps the form');

      t.step('Typing reps into it keeps the form');
      await fillSets(t, 'Deadlift', [{ weight: 100, reps: 5 }]);
      await sleep(600);
      await expectToday(t, 1, 'Pull A');
      expect(!(await t.text()).includes('Done for today'), 'Typing reps must not flip Today back to "Done for today"');
      const st = await waitStored(t, 'the started workout in the draft (draft.startedAt)', (s) => !!s.draft && typeof s.draft.startedAt === 'string');

      t.step('Even without startNextOn, a draft with reps keeps the form');
      await t.goto(BLANK_PATH);
      await t.setStorage(STORAGE_KEY, JSON.stringify({ ...st, settings: { ...st.settings, startNextOn: null } }));
      await openApp(t);
      await expectToday(t, 1, 'Pull A');
      await openCard(t, 'Deadlift');
      expectEqual(await t.value('Set 1 reps', { within: card('Deadlift') }), '5', 'The started workout\'s reps are still there');
      expect(!(await t.text()).includes('Done for today'), 'A draft with reps keeps the form even without startNextOn');
    },
  },

  {
    id: 'b2-new-bests',
    title: 'New bests (§18.5): Squat 80 → 82.5 kg → "Workout saved" says "New best!" (Nice closes); 🏆 and "best" on the Done card and in History; an equal weight → "Workout saved ✓" (Escape closes); a first-ever exercise never counts',
    timeout: 150000,
    async run(t) {
      await t.enableTouch();
      const seed = SEED_WEEK.map((s) => (s.day === 'legs' ? { ...s, entries: [mainEntry('squat', 80, [5, 5, 5])] } : s));
      await bootSeeded(t, seedState(seed));
      await expectToday(t, 6, 'Legs');
      await waitHeadline(t, 'Squat', 'Add 2.5 kg today → 82.5 kg');
      await fillSets(t, 'Squat', reps(5, 5, 7));
      await fillSets(t, 'Romanian deadlift', [{ weight: 40, reps: 10 }, { reps: 10 }, { reps: 10 }]);

      t.step('Save → "Workout saved" with "New best!"');
      await t.clearStatusLog();
      await t.click('Save workout', { within: 'document' });
      await t.waitForRole('dialog', SAVED.name, { timeout: 8000 });
      expectEqual(await t.attr('dialog', SAVED.name, 'aria-modal'), 'true', '"Workout saved" aria-modal (§16.3)');
      await t.waitForText('New best!', { within: SAVED });
      const sheet = await t.text({ within: SAVED });
      expect(/Squat\b.{0,5}82\.5 kg/.test(sheet), `The new-best line names Squat 82.5 kg; sheet: ${JSON.stringify(sheet)}`);
      expect(sheet.includes('🎉'), `A new best shows 🎉; sheet: ${JSON.stringify(sheet)}`);
      expect(!sheet.includes('Romanian deadlift'), `A first-ever exercise is never a new best; sheet: ${JSON.stringify(sheet)}`);
      expect(sheet.includes(`Next: Day 1 ${DOT} Pull A`), `The sheet says what is next; sheet: ${JSON.stringify(sheet)}`);
      await t.tap('Nice', { within: SAVED });
      await t.waitGone('dialog', SAVED.name);
      await t.waitForStatus(`Saved Legs ${DOT} ${dmy(D0)}`);

      t.step('Done card: "🏆 1 new best" and one "best" tag, on the Squat line');
      await expectDone(t, 'Pull A');
      await t.waitForText('🏆 1 new best');
      const done = await t.text();
      expectEqual(bestTags(done), 1, `"best" tags on the Done view (Squat only); page: ${JSON.stringify(done.slice(0, 500))}`);
      expect(/Squat.{0,40}\bbest\b/.test(done.replace(/\bnew bests?\b/gi, '')), `The "best" tag sits on the Squat line; page: ${JSON.stringify(done.slice(0, 500))}`);

      t.step('History: 🏆 and "best" on today\'s workout; none on the first-ever squat');
      await goTab(t, 'History');
      const A = { role: 'article', name: historyLabel(D0, 6, 'Legs') };
      await t.waitForRole('article', A.name);
      const art = await t.fullText({ within: A });
      expect(art.includes('🏆'), `History card of the new best shows 🏆; text: ${JSON.stringify(art)}`);
      expect(bestTags(art) >= 1, `History card of the new best tags the exercise line "best"; text: ${JSON.stringify(art)}`);
      const first = await t.fullText({ within: { role: 'article', name: historyLabel('2026-11-03', 3, 'Legs') } });
      expect(!first.includes('🏆') && bestTags(first) === 0, `The first-ever squat (03/11) is not a best; text: ${JSON.stringify(first)}`);

      const d1 = addDays(D0, 1);
      await moveTo(t, d1);
      t.step('Equal to the previous best → "Workout saved ✓", no 🎉; Escape closes');
      await expectToday(t, 1, 'Pull A');
      await fillSets(t, 'Deadlift', [{ weight: 100, reps: 5 }]);
      await t.click('Save workout', { within: 'document' });
      await t.waitForRole('dialog', SAVED.name, { timeout: 8000 });
      await t.waitForText('Workout saved ✓', { within: SAVED });
      const plain = await t.text({ within: SAVED });
      expect(!plain.includes('New best!') && !plain.includes('🎉'), `Deadlift 100 kg equals the previous best: no "New best!" / 🎉; sheet: ${JSON.stringify(plain)}`);
      await t.press('Escape');
      await t.waitGone('dialog', SAVED.name);
      await expectDone(t, 'Push A');
      expect(!(await t.text()).includes('🏆'), 'No 🏆 on a workout without new bests');
    },
  },

  {
    id: 'b2-rest-sound-setting',
    title: 'Data → Settings: "Rest timer sound" switch (§18.1), on by default, with the iPhone note; off persists across a reload',
    async run(t) {
      await boot(t);
      await goTab(t, 'Data');
      await t.waitForRole('switch', 'Rest timer sound', { within: 'document' });
      expectEqual(await switchState(t, 'Rest timer sound'), true, '"Rest timer sound" is on by default');
      await t.waitForText("The beep plays only while the app is open — iPhone doesn't let web apps alert in the background.");

      t.step('Turn it off');
      await t.click('Rest timer sound', { role: 'switch', within: 'document' });
      await waitStored(t, 'settings.restSound = false', (s) => s.settings?.restSound === false);
      await t.reload();
      await waitNav(t);
      await goTab(t, 'Data');
      await t.waitForRole('switch', 'Rest timer sound', { within: 'document' });
      expectEqual(await switchState(t, 'Rest timer sound'), false, '"Rest timer sound" stays off after a reload');

      t.step('Back on');
      await t.click('Rest timer sound', { role: 'switch', within: 'document' });
      await waitStored(t, 'settings.restSound = true', (s) => s.settings?.restSound === true);
    },
  },
  // ------------------------------------------------------------------ Batch 2 independent review (20/11/2026)

  {
    id: 'review-b2-overnight-draft',
    title: 'Workout times across a night (DECISIONS): a late workout ending after midnight keeps both times; a draft left overnight shows "Started 18:42" (no "14 h so far") and saves its start without a finish',
    timeout: 120000,
    async run(t) {
      const Y = addDays(D0, -1);
      const legsDraft = (startedAt) => ({
        date: Y, day: 'legs', offDay: false, note: '', dateChosen: false, editingId: null, extraCount: 0, startedAt,
        entries: [{ uid: 'main', slotKey: null, exerciseId: 'squat', name: 'Squat', sets: [5, 5, 7].map((r) => ({ weight: 62.5, reps: r, touched: false })) }],
      });
      const legsCard = { role: 'article', name: historyLabel(Y, 6, 'Legs') };

      t.step('A late workout: started 23:30, still going at 00:20 → both times kept');
      await t.setClock(at(D0, '00:20'));
      await t.goto(BLANK_PATH);
      await t.setStorage(STORAGE_KEY, JSON.stringify({ ...seedState(SEED_WEEK), draft: legsDraft(`${Y}T23:30`) }));
      await openApp(t);
      await expectToday(t, 6, 'Legs');
      await t.waitForText(`Started 23:30 ${DOT} 50 min so far`);
      await t.click('Save workout', { within: 'document' });
      await t.waitForRole('dialog', SAVED.name, { timeout: 8000 });
      await t.waitForText('50 min', { within: SAVED });
      await closeSavedSheet(t);
      let st = await t.getJSON(STORAGE_KEY);
      let saved = st.sessions.find((s) => s.date === Y && s.day === 'legs');
      expectEqual([saved?.startedAt, saved?.finishedAt], [`${Y}T23:30`, `${D0}T00:20`], 'A workout that ends after midnight keeps both times');

      t.step('A draft left overnight: started 18:42 yesterday, opened at 09:00');
      await t.setClock(at(D0, '09:00'));
      await t.goto(BLANK_PATH);
      await t.setStorage(STORAGE_KEY, JSON.stringify({ ...seedState(SEED_WEEK), draft: legsDraft(`${Y}T18:42`) }));
      await openApp(t);
      await expectToday(t, 6, 'Legs');
      await t.waitForText('Started 18:42');
      const head = await t.text();
      expect(!/so far/.test(head), `A start from last night is not a workout "so far" (it would read "14 h 18 min so far"); page: ${JSON.stringify(head.slice(0, 200))}`);

      t.step('Save: the start stays, no finish (the save time is not when the workout ended)');
      await t.click('Save workout', { within: 'document' });
      await t.waitForRole('dialog', SAVED.name, { timeout: 8000 });
      const sheet = await t.text({ within: SAVED });
      expect(!/\d+ h\b/.test(sheet), `No overnight duration tile on "Workout saved"; sheet: ${JSON.stringify(sheet)}`);
      await closeSavedSheet(t);
      st = await t.getJSON(STORAGE_KEY);
      saved = st.sessions.find((s) => s.date === Y && s.day === 'legs');
      expectEqual([saved?.startedAt, saved?.finishedAt ?? null], [`${Y}T18:42`, null], 'Times of a draft saved the next morning');

      t.step('History: "Started 18:42", no 14-hour workout');
      await goTab(t, 'History');
      await waitFullText(t, 'Started 18:42', legsCard);
      const card6 = await t.fullText({ within: legsCard });
      expect(!/\d+ h\b/.test(card6), `History must not show an overnight duration; card: ${JSON.stringify(card6)}`);
    },
  },

  {
    id: 'review-b2-start-time-later',
    title: 'A started workout without a start time (a v6 draft with reps, or a date changed away and back) gets one from the next reps typed today; Save then stores both times',
    timeout: 120000,
    async run(t) {
      const draft = {
        date: D0, day: 'legs', offDay: false, note: '', dateChosen: false, editingId: null, extraCount: 0,
        entries: [{ uid: 'main', slotKey: null, exerciseId: 'squat', name: 'Squat', sets: [{ weight: 62.5, reps: 5, touched: false }, { weight: 62.5, reps: null, touched: false }, { weight: 62.5, reps: null, touched: false }] }],
      };
      t.step('A draft typed before the update (reps, no start time)');
      await bootSeeded(t, { ...seedState(SEED_WEEK), draft });
      await expectToday(t, 6, 'Legs');
      await openCard(t, 'Squat');
      await t.type('Set 2 reps', 5, { within: card('Squat') });
      let st = await waitStored(t, 'draft.startedAt from the next reps typed', (s) => typeof s.draft?.startedAt === 'string');
      expect(/^2026-11-10T09:0\d$/.test(st.draft.startedAt), `draft.startedAt should be now ("2026-11-10T09:0x"); got ${JSON.stringify(st.draft.startedAt)}`);
      await t.waitForText(`Started ${hm(st.draft.startedAt)}`);

      t.step('Change the date to yesterday (no times), then back to today');
      await t.click('Change date', { within: 'document' });
      await t.type('Workout date', addDays(D0, -1));
      await waitStored(t, 'no start time for another day', (s) => s.draft?.date === addDays(D0, -1) && !s.draft.startedAt);
      await t.click('Change date', { within: 'document' });
      await t.type('Workout date', D0);
      await waitStored(t, 'the date back to today', (s) => s.draft?.date === D0);
      await openCard(t, 'Squat');
      await t.type('Set 3 reps', 6, { within: card('Squat') });
      st = await waitStored(t, 'draft.startedAt set again by the next reps', (s) => s.draft?.date === D0 && typeof s.draft.startedAt === 'string');
      await t.waitForText(`Started ${hm(st.draft.startedAt)}`);

      t.step('Save stores both times');
      await t.click('Save workout', { within: 'document' });
      await closeSavedSheet(t);
      const saved = (await t.getJSON(STORAGE_KEY)).sessions.find((s) => s.date === D0 && s.day === 'legs');
      expect(saved?.startedAt === st.draft.startedAt && /^2026-11-10T09:\d\d$/.test(saved?.finishedAt || ''), `Saved times should be [${st.draft.startedAt}, 2026-11-10T09:xx]; got ${JSON.stringify([saved?.startedAt, saved?.finishedAt])}`);
    },
  },

  {
    id: 'review-b2-edit-no-timer',
    title: 'Editing a saved workout from History starts no rest timer (and so no beep); a new workout still does',
    timeout: 90000,
    async run(t) {
      await bootSeeded(t, seedState(SEED_WEEK));
      await goTab(t, 'History');
      const A = { role: 'article', name: historyLabel('2026-11-05', 5, 'Push B') };
      await t.waitForRole('article', A.name);
      await clickInside(t, A, 'Edit');
      await t.waitForText(`Editing ${dmy('2026-11-05')}`);
      await openCard(t, 'Overhead press');
      await typeNoCommit(t, 'Set 5 reps', 7, { name: 'Overhead press' });
      await t.press('Enter');
      await sleep(800);
      expectEqual(await t.count('timer', 'Rest timer', { within: 'document' }), 0, 'Rest timers while editing a saved workout');
      expect(!(await t.getJSON(STORAGE_KEY))?.draft?.rest, 'No draft.rest while editing a saved workout');

      t.step('A new workout still starts the timer');
      await t.click('Cancel edit', { within: 'document' });
      await expectToday(t, 6, 'Legs');
      await openCard(t, 'Squat');
      await typeNoCommit(t, 'Set 1 reps', 5, { name: 'Squat' });
      await t.press('Enter');
      await t.waitForRole('timer', 'Rest timer', { within: card('Squat') });
    },
  },

  {
    id: 'review-b2-warmup-bar',
    title: 'Warm-up ticks reset when a new bar weight changes the warm-up list (§18.2): no stale ticks on different sets',
    timeout: 90000,
    async run(t) {
      await bootSeeded(t, seedState(SEED_WEEK));
      await expectToday(t, 6, 'Legs');
      await openCard(t, 'Squat');
      const ramp = warmupSets(62.5, 'kg', 20);
      await expectWarmups(t, 'Squat', ramp);
      await tickWarmup(t, 'Squat', 1);
      await tickWarmup(t, 'Squat', 2);
      await expectWarmups(t, 'Squat', ramp, ramp.map((_, i) => i === 1 || i === 2), 'two ticked');
      await waitStored(t, 'the ticks in the draft', (s) => JSON.stringify(s.draft?.warmup?.main) === '[1,2]');

      t.step('Data → Barbell weight 40');
      await goTab(t, 'Data');
      await t.type('Barbell weight (kg)', 40);
      await waitStored(t, 'settings.barWeight = 40', (s) => s.settings?.barWeight === 40);

      t.step('Today: the new list starts unticked');
      await goTab(t, 'Today');
      await openCard(t, 'Squat');
      const ramp40 = warmupSets(62.5, 'kg', 40);
      expect(JSON.stringify(ramp40) !== JSON.stringify(ramp), 'The test needs a bar weight that changes the list');
      await expectWarmups(t, 'Squat', ramp40, ramp40.map(() => false), 'after the bar weight changed');
      await t.waitForText(`0 of ${ramp40.length} done`, { within: card('Squat') });
    },
  },

  {
    id: 'review-b2-toast-one-line',
    title: 'iPhone width: "Saved Push B · DD/MM/YYYY" stays on one line, above the "Workout saved" sheet and after it closes',
    timeout: 90000,
    async run(t) {
      await bootSeeded(t, seedState(SEED_WEEK.slice(0, 4)));
      await expectToday(t, 5, 'Push B');
      await fillSets(t, 'Overhead press', reps(5, 5, 5, 5, 6));
      await t.click('Save workout', { within: 'document' });
      await t.waitForRole('dialog', SAVED.name, { timeout: 8000 });
      const box = () => t.evaluate(() => {
        const el = document.getElementById('toast');
        const r = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
        return { text: el.textContent, lines, left: r.left, right: r.right, vw: innerWidth };
      });
      let b = await box();
      expect(b.text === `Saved Push B ${DOT} ${dmy(D0)}`, `Toast text: ${JSON.stringify(b.text)}`);
      expect(b.lines === 1 && b.left >= 0 && b.right <= b.vw, `The toast should be one line inside the screen while the sheet is open; got ${JSON.stringify(b)}`);
      await t.click('Nice', { within: SAVED });
      await t.waitGone('dialog', SAVED.name);
      await sleep(300);
      b = await box();
      expect(b.lines === 1 && b.left >= 0 && b.right <= b.vw, `The toast should be one line after the sheet closes; got ${JSON.stringify(b)}`);
    },
  },
  {
    id: 'review-b2-remove-set-timer',
    title: '"− Set" on the set the rest timer sits under removes the timer for good (no hidden timer left to beep)',
    timeout: 90000,
    async run(t) {
      await bootSeeded(t, seedState(SEED_WEEK));
      await expectToday(t, 6, 'Legs');
      await openCard(t, 'Romanian deadlift');
      await typeNoCommit(t, 'Set 3 reps', 10, { name: 'Romanian deadlift' });
      await t.press('Enter');
      await waitTimerAt(t, 'Romanian deadlift', 3, null, 'After Enter on set 3');
      await waitStored(t, 'draft.rest under set 3', (s) => s.draft?.rest?.set === 2);
      await t.click('− Set', { within: card('Romanian deadlift') });
      await t.waitGone('timer', 'Rest timer', { within: 'document' });
      await waitStored(t, 'draft.rest cleared with its set', (s) => !!s.draft && !s.draft.rest);

      t.step('A timer under another set stays');
      await typeNoCommit(t, 'Set 1 reps', 10, { name: 'Romanian deadlift' });
      await t.press('Enter');
      await waitTimerAt(t, 'Romanian deadlift', 1, 2, 'After Enter on set 1');
      await t.click('− Set', { within: card('Romanian deadlift') });
      await sleep(300);
      await waitTimerAt(t, 'Romanian deadlift', 1, null, 'After removing set 2');
    },
  },
];
