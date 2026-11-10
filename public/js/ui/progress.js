// Progress: two views behind a switch — "All charts" (a card per exercise) and "One at a time" (a big focus
// chart + the exercise list). Numbers come from analysis.js / progression.js; charts from charts.js.

import {
  DAYS, EXERCISES, MAIN_LIFTS, MISSES_BEFORE_DELOAD, DELOAD_FACTOR,
  roleOf, mainPrescription, mainSetsFor, accessoryPrescription, incrementCategory,
} from '../program.js';
import { series, summary, weeklyVolume, watchList, personalBests, exercisesInData } from '../analysis.js';
import { suggestAccessory, suggestMain, deloadWeight, maxWeight, repsToGo, baselineKey } from '../progression.js';
import { lineChart, barChart, accessoryChart, sparkline } from '../charts.js';
import { formatWeight, formatNumber, cleanNumber, incrementFor } from '../units.js';
import { formatDate, formatDateShort, monthName, addDays, compareISO } from '../dates.js';
import { html, raw, setHTML, icon, plural, ago } from './dom.js';
import { attachChart } from './chart-ui.js';
import { openSetWeightSheet } from './pickers.js';
import { dayPlan, daysShort, repsTag } from './model.js';

const RANGES = [{ id: '4w', label: '4 weeks', days: 28 }, { id: '3m', label: '3 months', days: 91 }, { id: 'all', label: 'All', days: null }];
const VIEWS = [{ id: 'all', label: 'All charts' }, { id: 'focus', label: 'One at a time' }];
const SHORT = { squat: 'Squat', bench: 'Bench', deadlift: 'Dead', ohp: 'OHP', barbellRow: 'Row' };
const GROUPS = [
  { id: 'pull', label: 'Pull', days: ['pullA', 'pullB'] },
  { id: 'push', label: 'Push', days: ['pushA', 'pushB'] },
  { id: 'legs', label: 'Legs', days: ['legs'] },
];
/** Sessions in the focus card's table. */
const TABLE_ROWS = 10;

const ui = { view: 'all', range: 'all', focus: 'squat|main' };

// ---------------------------------------------------------------- data

/** The current plan's exercises (with swaps) grouped Pull / Push / Legs, plus "Other" for log-only ones. */
function exerciseGroups(state) {
  const seen = new Set();
  const groups = GROUPS.map((g) => {
    const items = [];
    for (const day of g.days) {
      const id = DAYS[day].main;
      const key = `${id}|main`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ key, exerciseId: id, role: 'main', name: EXERCISES[id].name, tag: '', prescription: mainPrescription(DAYS[day].mainSets), rx: null, group: g.label });
    }
    for (const day of g.days) {
      const plan = dayPlan(state, day);
      for (const it of plan.items) {
        const role = roleOf(day, it.exerciseId);
        const key = `${it.exerciseId}|${role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const same = plan.items.filter((x) => x.exerciseId === it.exerciseId);
        let tag = '';
        if (same.length > 1) tag = same.every((x) => x.supersetWith) ? `${same.length} supersets of ${it.sets}` : `${same.length} × ${it.sets} sets`;
        else if (MAIN_LIFTS.includes(it.exerciseId)) tag = repsTag(it);
        items.push({
          key, exerciseId: it.exerciseId, role, name: it.name, tag, group: g.label,
          prescription: accessoryPrescription(it), rx: { sets: it.sets, repsMin: it.repsMin, repsMax: it.repsMax },
          totalSets: same.reduce((t, x) => t + x.sets, 0),
        });
      }
    }
    return { ...g, daysText: daysShort(g.days), items };
  });
  const other = exercisesInData(state.sessions).filter((x) => !seen.has(`${x.exerciseId}|${x.role}`)).map((x) => ({
    key: `${x.exerciseId}|${x.role}`, exerciseId: x.exerciseId, role: x.role, name: x.name, group: 'Other',
    tag: x.role === 'accessory' && MAIN_LIFTS.includes(x.exerciseId) ? 'accessory' : '',
    prescription: x.role === 'main' ? mainPrescription(mainSetsFor(x.exerciseId)) : 'Not in your plan', rx: null, totalSets: null,
  }));
  if (other.length) groups.push({ id: 'other', label: 'Other', daysText: 'In your log only', items: other });
  return groups;
}

/** One point per session: top weight, best e1RM, reps per set, total reps. */
function pointsFor(sessions, item) {
  return series(sessions, item.exerciseId, item.role).map((p) => ({
    x: p.date, w: p.topWeight, e: p.bestE1rm, reps: p.sets.map((s) => s.reps), offDay: p.offDay,
    total: p.sets.reduce((t, s) => t + (Number(s.reps) || 0), 0),
  }));
}

/** Accessory status from the latest session: ready to add weight, or reps still to go. */
function accessoryStatus(sessions, item, unit) {
  if (item.role !== 'accessory' || !item.rx || item.rx.repsMin == null) return { ready: false, toGo: null };
  const s = suggestAccessory(sessions, item.exerciseId, item.rx, unit);
  return { ready: s.action === 'increase', toGo: s.last ? repsToGo(s.last, item.rx) : null };
}

function deltaOf(points) {
  if (points.length < 2) return null;
  return cleanNumber(points[points.length - 1].w - points[0].w);
}

/** The most recent deload in the points (weight dropped to exactly the 10% deload weight). */
function deloadNotes(points, item, unit) {
  if (item.role !== 'main') return [];
  for (let i = points.length - 1; i > 0; i--) {
    const prev = points[i - 1].w;
    if (points[i].w < prev && points[i].w === deloadWeight(prev, item.exerciseId, unit)) {
      return [{ x: points[i].x, label: `Deload −${Math.round((1 - DELOAD_FACTOR) * 100)}%` }];
    }
  }
  return [];
}

// ---------------------------------------------------------------- pieces

function deltaMarkup(d, unit, since) {
  if (d == null) return html`<span class="delta flat">${since ? 'First session' : ''}</span>`;
  const text = `${d > 0 ? '+' : d < 0 ? '−' : '± '}${formatWeight(Math.abs(d), unit)}`;
  return html`<span class="delta ${d > 0 ? 'up' : 'flat'}">${d > 0 ? icon('up') : d < 0 ? html`<span aria-hidden="true">▼ </span>` : ''}${text}${since ? ` since ${formatDate(since)}` : ''}</span>`;
}

function readyTag(unit) {
  return html`<span class="ready">${icon('up')}Add ${formatWeight(incrementFor(incrementCategory('', 'accessory'), unit), unit)}</span>`;
}

const legend = () => html`<div class="legend"><span><i class="key" style="background:var(--c1)"></i>Working weight</span><span><i class="key" style="background:var(--c2)"></i>Est. 1-rep max</span></div>`;

/** Chart markup for an item, registering its tooltip rows for attachChart. */
function chartFor(item, points, unit, charts, { big }) {
  const id = `c${charts.length}`;
  const dates = [...new Set(points.map((p) => p.x))].sort();
  const at = (i) => points.filter((p) => p.x === dates[i]).pop();
  const title = (i) => `${formatDate(dates[i])}${at(i) && at(i).offDay ? ' · off day' : ''}`;
  let svg;
  let rows;
  if (item.role === 'main') {
    svg = lineChart({
      series: [
        { label: 'Working weight', points: points.map((p) => ({ x: p.x, y: p.w })) },
        { label: 'Est. 1-rep max', points: points.map((p) => ({ x: p.x, y: p.e })) },
      ],
      width: 336, height: points.length ? (big ? 210 : 150) : 64, unit, label: `${item.name}: working weight and estimated 1-rep max`,
      annotations: deloadNotes(points, item, unit),
    });
    rows = (i) => [
      { colour: 'var(--c1)', value: formatWeight(at(i).w, unit), name: `Working weight · sets ${at(i).reps.join(', ')}` },
      { colour: 'var(--c2)', value: formatWeight(at(i).e, unit), name: 'Est. 1-rep max' },
    ];
  } else {
    const target = item.rx && item.rx.repsMax != null ? item.totalSets * item.rx.repsMax : null;
    svg = !points.length ? lineChart({ series: [], width: 336, height: 64 }) : accessoryChart({
      points: points.map((p) => ({ x: p.x, weight: p.w, total: p.total })),
      target, targetText: target ? `line = ${item.totalSets}×${item.rx.repsMax}, time to add weight` : '',
      width: 336, compact: !big, unit, label: `${item.name}${item.tag ? ` (${item.tag})` : ''}: weight and total reps per session`,
    });
    rows = (i) => [
      { colour: 'var(--c1)', value: formatWeight(at(i).w, unit), name: 'Weight' },
      { colour: 'var(--c2)', value: `${at(i).total} reps`, name: `sets ${at(i).reps.join(', ')}` },
    ];
  }
  if (points.length) charts.push({ id, title, rows, crosshair: true });
  return html`<div class="chart-wrap" data-chart="${id}">${raw(svg)}</div>`;
}

function titleMarkup(item, tagLevel = 'h3') {
  const tag = item.role === 'main' ? html`<span class="tag">Main</span>` : item.tag ? html`<span class="tag">${item.tag}</span>` : '';
  return tagLevel === 'h2' ? html`<h2>${item.name}${tag}</h2>` : html`<h3>${item.name}${tag}</h3>`;
}

function miniCard(item, points, status, unit, charts) {
  const last = points[points.length - 1];
  const extra = item.role === 'main' || !last ? ''
    : status.ready ? ' · all sets at the top' : status.toGo != null ? ` · ${plural(status.toGo, 'rep')} to go` : '';
  return html`<div class="card mini-card">
    <div class="lift-head">
      <div>${titleMarkup(item)}<p class="cap">${item.prescription}${item.tag && item.role !== 'main' && !MAIN_LIFTS.includes(item.exerciseId) ? ` · ${item.tag}` : ''}</p></div>
      <div class="lift-now"><div class="v">${last ? formatWeight(last.w, unit) : '—'}</div>
        ${status.ready ? readyTag(unit) : last ? deltaMarkup(deltaOf(points), unit, null) : ''}</div>
    </div>
    <p class="lastline">${last ? `Last ${formatDateShort(last.x)}: ${formatWeight(last.w, unit)} × ${last.reps.join(', ')}${extra}` : 'No sessions yet'}</p>
    ${item.role === 'main' && points.length ? legend() : ''}
    ${chartFor(item, points, unit, charts, { big: false })}
    <button type="button" class="more" data-act="open-focus" data-key="${item.key}">Open big chart ›</button>
  </div>`;
}

function stat(value, label) {
  return html`<div><b>${value}</b>${label}</div>`;
}

function focusCard(state, item, points, status, unit, charts) {
  const last = points[points.length - 1];
  const b = state.baselines[baselineKey(item.exerciseId, item.role)];
  let stats;
  if (item.role === 'main') {
    const best = points.length ? Math.max(...points.map((p) => p.e)) : null;
    stats = [stat(best != null ? formatWeight(best, unit) : '—', 'Best est. 1RM'), stat(String(points.length), 'Sessions'), stat(last ? last.reps.join(',') : '—', 'Last time')];
  } else {
    const target = item.rx && item.rx.repsMax != null ? `${item.totalSets}×${item.rx.repsMax}` : '—';
    let nextText = '—';
    if (last && item.rx && item.rx.repsMin == null) nextText = 'Any reps';
    else if (status.ready) nextText = `Add ${formatWeight(incrementFor('accessory', unit), unit)}`;
    else if (status.toGo != null) nextText = `${plural(status.toGo, 'rep')} to go`;
    stats = [stat(last ? last.reps.join(',') : '—', 'Last time'), stat(target, 'Target'), stat(nextText, 'Next')];
  }
  return html`<div class="card focus" id="focus">
    <div class="focus-head">
      <div>${titleMarkup(item, 'h2')}<p class="cap">${item.prescription} · ${item.group === 'Other' ? 'not in your plan' : `${item.group} days`}</p></div>
      <span class="pill${item.role === 'main' ? ' main' : ''}">${item.role === 'main' ? 'Main lift' : 'Accessory'}</span>
    </div>
    <div class="hero">${last ? formatNumber(last.w) : '—'}<small> ${unit}</small></div>
    ${deltaMarkup(deltaOf(points), unit, points.length ? points[0].x : null)}
    <div class="mini">${stats}</div>
    <div class="setw-line"><span class="muted">${b ? `Next session: ${formatWeight(b.weight, unit)} (you set it)` : 'Want a different weight next time?'}</span>
      <button type="button" class="link" data-act="setweight" data-key="${item.key}">Set weight</button></div>
    ${item.role === 'main' ? (points.length ? legend() : '') : html`<p class="explain">Reps climb first. When every set hits the top of the range, the weight goes up and reps start again from the bottom.</p>`}
    ${chartFor(item, points, unit, charts, { big: true })}
    ${points.length ? html`<details><summary>Show as table</summary><table>
      <tr><th>Date</th><th>Sets</th><th class="num">Weight</th><th class="num">${item.role === 'main' ? 'Est. 1RM' : 'Total reps'}</th></tr>
      ${points.slice(-TABLE_ROWS).reverse().map((p) => html`<tr><td>${formatDate(p.x)}</td><td>${p.reps.join(', ')}</td><td class="num">${formatNumber(p.w)}</td>
        <td class="num">${item.role === 'main' ? formatNumber(p.e) : String(p.total)}</td></tr>`)}
    </table></details>` : ''}
  </div>`;
}

function listCard(groups, data, unit) {
  return html`<div class="card list">
    <h2>All exercises</h2><p class="cap">Tap one to see its chart above</p>
    ${groups.map((g) => html`<div class="group-head"><span>${g.label}</span><span class="days">${g.daysText}</span></div>
      ${g.items.map((item) => {
        const { points, status } = data.get(item.key);
        const last = points[points.length - 1];
        const selected = ui.focus === item.key;
        const d = deltaOf(points);
        return html`<button type="button" class="xrow${selected ? ' selected' : ''}" data-act="focus" data-key="${item.key}" aria-pressed="${selected}">
          <span class="xname">${item.name}${item.role === 'main' ? html`<span class="tag">Main</span>` : ''}
            <span class="last">${last ? html`<b>${formatWeight(last.w, unit)}</b> × ${last.reps.join(', ')}` : 'No sessions yet'}</span>
            ${item.tag ? html`<span class="sub">${item.tag}</span>` : ''}</span>
          <span class="xspark">${raw(sparkline(points.map((p) => p.w)))}</span>
          <span class="xdelta">${status.ready ? readyTag(unit) : d != null ? html`<span class="${d > 0 ? 'up' : 'flat'}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${formatWeight(Math.abs(d), unit)}</span>` : ''}</span>
        </button>`;
      })}`)}
  </div>`;
}

function volumeCard(sessions, unit, charts) {
  const weeks = weeklyVolume(sessions);
  const svg = barChart({
    bars: weeks.map((w) => ({ label: formatDateShort(w.weekStart), value: w.volume })),
    width: 336, height: 140, unit, label: `${unit === 'kg' ? 'Kilograms' : 'Pounds'} lifted per week`,
  });
  if (weeks.length) {
    charts.push({
      id: `c${charts.length}`, crosshair: false,
      title: (i) => `Week of ${formatDate(weeks[i].weekStart)}`,
      rows: (i) => [{ colour: 'var(--c1)', value: formatWeight(weeks[i].volume, unit), name: plural(weeks[i].count, 'workout') }],
    });
  }
  return html`<div class="card"><h2>Weekly volume</h2><p class="cap">${unit === 'kg' ? 'Kilograms' : 'Pounds'} lifted per week, all exercises</p>
    <div class="chart-wrap" data-chart="${weeks.length ? `c${charts.length - 1}` : ''}">${raw(svg)}</div></div>`;
}

function watchCard(state, unit) {
  const items = watchList(state.sessions, unit).map((w) => {
    const s = suggestMain(state.sessions, w.exerciseId, unit);
    const at = maxWeight(s.last);
    const name = EXERCISES[w.exerciseId].name;
    if (w.action === 'deload') {
      return { kind: 'warn', name, label: 'Deload due', text: `${plural(w.failStreak, 'miss', 'misses')} in a row at ${formatWeight(at, unit)} — next time take ${Math.round((1 - DELOAD_FACTOR) * 100)}% off: ${formatWeight(w.weight, unit)}.` };
    }
    const left = MISSES_BEFORE_DELOAD - w.failStreak;
    return left === 1
      ? { kind: 'warn', name, label: 'Needs attention', text: `${plural(w.failStreak, 'miss', 'misses')} in a row at ${formatWeight(at, unit)} — one more and it's deload time (${formatWeight(deloadWeight(at, w.exerciseId, unit), unit)}).` }
      : { kind: 'info', name, label: 'Watch', text: `${plural(w.failStreak, 'miss', 'misses')} at ${formatWeight(at, unit)} — ${left} more in a row and it's deload time.` };
  });
  return html`<div class="card watch"><h2>Watch list</h2>
    ${items.length ? items.map((it) => html`<div class="item">${icon(it.kind)}<div class="txt"><b>${it.name}</b> · ${it.label}<span>${it.text}</span></div></div>`)
      : html`<p class="cap">${state.sessions.length ? 'Nothing to watch — every main lift hit its reps last time.' : 'Nothing to watch yet.'}</p>`}
  </div>`;
}

function bestsCard(state, unit) {
  const bests = personalBests(state.sessions).filter((p) => p.role === 'main' && MAIN_LIFTS.includes(p.exerciseId))
    .sort((a, b) => MAIN_LIFTS.indexOf(a.exerciseId) - MAIN_LIFTS.indexOf(b.exerciseId));
  return html`<div class="card"><h2>Personal bests</h2>
    ${bests.length ? html`<table><tr><th>Lift</th><th class="num">Heaviest</th><th class="num">Est. 1RM</th></tr>
      ${bests.map((p) => html`<tr><td>${p.name}</td>
        <td class="num">${formatWeight(p.bestWeight, unit)}<span class="when">${formatDateShort(p.bestWeightDate)}</span></td>
        <td class="num">${formatWeight(p.bestE1rm, unit)}<span class="when">${formatDateShort(p.bestE1rmDate)}</span></td></tr>`)}</table>`
      : html`<p class="cap">No data yet</p>`}
  </div>`;
}

// ---------------------------------------------------------------- screen

/**
 * Draw the Progress screen.
 * @param {HTMLElement} root
 * @param {object} ctx
 */
export function renderProgress(root, ctx) {
  const state = ctx.state;
  const unit = state.settings.unit;
  const today = ctx.today();
  const range = RANGES.find((r) => r.id === ui.range) || RANGES[2];
  const cutoff = range.days == null ? null : addDays(today, -range.days);
  const inRange = cutoff ? state.sessions.filter((s) => compareISO(s.date, cutoff) > 0) : state.sessions;
  const sum = summary(state.sessions, today);

  const groups = exerciseGroups(state);
  const items = groups.flatMap((g) => g.items);
  if (!items.some((it) => it.key === ui.focus)) ui.focus = 'squat|main';
  const data = new Map(items.map((it) => [it.key, { points: pointsFor(inRange, it), status: accessoryStatus(state.sessions, it, unit) }]));
  const charts = [];

  const tiles = [
    ['Workouts', String(inRange.length), 'in this range'],
    ['This month', String(sum.thisMonth), monthName(today)],
    ['Last 7 days', String(sum.last7), 'workouts'],
    ['Last workout', sum.lastDate ? formatDateShort(sum.lastDate) : '—', sum.lastDate ? ago(sum.lastDate, today) : 'nothing logged yet'],
  ];

  let body;
  if (ui.view === 'all') {
    body = html`${watchCard(state, unit)}
      <div class="chips jump" role="group" aria-label="Jump to">${groups.map((g) => html`<button type="button" class="chip" data-act="jump" data-group="${g.id}">${g.label}</button>`)}</div>
      ${groups.map((g) => html`<h2 class="section-head" id="grp-${g.id}"><span>${g.label}</span><span class="days">${g.daysText}</span></h2>
        ${g.items.map((it) => miniCard(it, data.get(it.key).points, data.get(it.key).status, unit, charts))}`)}
      ${volumeCard(inRange, unit, charts)}
      ${bestsCard(state, unit)}`;
  } else {
    const item = items.find((it) => it.key === ui.focus);
    body = html`<div class="seg" role="group" aria-label="Main lifts">${MAIN_LIFTS.map((id) => html`<button type="button" data-act="focus" data-key="${id}|main" aria-pressed="${ui.focus === `${id}|main`}">${SHORT[id]}</button>`)}</div>
      ${focusCard(state, item, data.get(item.key).points, data.get(item.key).status, unit, charts)}
      ${listCard(groups, data, unit)}
      ${volumeCard(inRange, unit, charts)}
      ${watchCard(state, unit)}
      ${bestsCard(state, unit)}`;
  }

  setHTML(root, html`<div class="screen progress">
    <h1 class="page-title">Progress</h1>
    <div class="seg views" role="group" aria-label="Progress view">${VIEWS.map((v) => html`<button type="button" data-act="view" data-view="${v.id}" aria-pressed="${ui.view === v.id}">${v.label}</button>`)}</div>
    <div class="chips" role="group" aria-label="Range">${RANGES.map((r) => html`<button type="button" class="chip" data-act="range" data-range="${r.id}" aria-pressed="${ui.range === r.id}">${r.label}</button>`)}</div>
    <div class="tiles">${tiles.map(([l, v, sub]) => html`<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${sub}</div></div>`)}</div>
    ${body}
  </div>`);

  for (const c of charts) {
    const wrap = root.querySelector(`[data-chart="${c.id}"]`);
    const svg = wrap && wrap.querySelector('svg');
    if (svg) attachChart(svg, { host: wrap.closest('.card'), title: c.title, rows: c.rows, crosshair: c.crosshair });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'view': ui.view = b.dataset.view; ctx.render(); break;
      case 'range': ui.range = b.dataset.range; ctx.render(); break;
      case 'focus': {
        const fromList = b.classList.contains('xrow');
        ui.focus = b.dataset.key;
        ctx.render();
        if (fromList) { const f = document.getElementById('focus'); if (f) f.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        break;
      }
      case 'open-focus':
        ui.view = 'focus';
        ui.focus = b.dataset.key;
        ctx.render({ keepScroll: false });
        break;
      case 'jump': {
        const el = document.getElementById(`grp-${b.dataset.group}`);
        if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        break;
      }
      case 'setweight': {
        const item = items.find((it) => it.key === b.dataset.key);
        if (item) openSetWeightSheet(ctx, { exerciseId: item.exerciseId, name: item.tag && MAIN_LIFTS.includes(item.exerciseId) && item.role === 'accessory' ? `${item.name} (${item.tag})` : item.name, role: item.role });
        break;
      }
      default: break;
    }
  });
}
