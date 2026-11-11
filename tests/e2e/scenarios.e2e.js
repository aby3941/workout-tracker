// End-to-end scenarios for the PPL Tracker PWA, written from SPEC.md (§3, §5, §11, §12, §14–§16).
// Elements are found only by role + accessible name from §16.3 (plus the one class it names,
// `suggest-headline`). Expected numbers come from the spec's own logic modules where useful.

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { BLANK_PATH, E2EError, PUBLIC_DIR, sleep } from './harness.js';
import { convertWeight } from '../../public/js/units.js';
import { defaultState, STORAGE_KEY } from '../../public/js/store.js';
import { toCSV, CSV_HEADER } from '../../public/js/csv.js';

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

async function saveWorkout(t, dayName, iso) {
  t.step(`Save workout (${dayName} ${dmy(iso)})`);
  await t.clearStatusLog();
  await t.click('Save workout', { within: 'document' });
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

      t.step('Form moves to the next workout');
      await expectToday(t, 2, 'Push A');
      await goTab(t, 'History');
      await t.waitForRole('article', historyLabel(D0, 1, 'Pull A'));
      await goTab(t, 'Today');
      await expectToday(t, 2, 'Push A');

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
      await expectToday(t, 2, 'Push A');
      for (const tab of ['Plan', 'Progress', 'History', 'Data']) await goTab(t, tab);
      await goTab(t, 'History');
      await t.waitForRole('article', historyLabel(D0, 1, 'Pull A'));
      await goTab(t, 'Today');
      await expectToday(t, 2, 'Push A');
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
      await t.waitForStatus(`Saved Legs ${DOT} ${dmy(D0)}`);
      st = await t.getJSON(STORAGE_KEY);
      const legs = st.sessions.filter((s) => s.date === D0 && s.day === 'legs');
      expectEqual(legs.length, 1, 'One Legs on that date after replacing');
      expectEqual(legs[0].entries, [{ exerciseId: 'squat', sets: sets(62.5, 5, 6) }], 'Only the sets with reps are saved; exercises without reps are dropped');
      expectEqual(st.sessions.length, SEED_WEEK.length + 1, 'Replacing does not add a workout');

      t.step('Double-tap Save');
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
      await expectToday(t, 2, 'Push A');
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
      await expectToday(t, 3, 'Legs');
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
      await t.waitForText('Warm-up: 20×10 · 30×10 · 40×5 · 52.5×3', { within: card('Bench press') });
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
];
