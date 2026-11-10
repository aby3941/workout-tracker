// History: every logged workout, newest first, grouped by month; expand, edit or delete.

import { DAYS, exerciseName } from '../program.js';
import { sortByDate, formatDate, formatMonthYear, weekdayShort } from '../dates.js';
import { deleteSession } from '../store.js';
import { html, setHTML, icon, setsShort, setsLong } from './dom.js';
import { confirmSheet, toast } from './sheets.js';
import { historyPositions, dayName } from './model.js';
import { editSession } from './today.js';

const FILTERS = [['all', 'All'], ['pull', 'Pull'], ['push', 'Push'], ['legs', 'Legs']];
/** Entries shown on a collapsed card before "+N more". */
const SUMMARY_ENTRIES = 3;

// Open cards; the newest workout opens whenever a new one becomes the newest (e.g. right after a save).
const ui = { filter: 'all', expanded: new Set(), newest: null };

/** "Tue 10/11/2026 · Day 1 · Pull A" — the card's accessible name. */
const title = (s, pos) => `${weekdayShort(s.date)} ${formatDate(s.date)} · Day ${pos} · ${dayName(s.day)}`;

function card(s, pos, unit) {
  const open = ui.expanded.has(s.id);
  const entries = (s.entries || []).filter((e) => e.sets && e.sets.length);
  const extra = entries.length - SUMMARY_ENTRIES;
  return html`<article class="card hist${open ? ' open' : ''}" aria-label="${title(s, pos)}" data-id="${s.id}">
    <button type="button" class="hist-head" data-act="toggle" aria-expanded="${open}">
      <span><b>${weekdayShort(s.date)} ${formatDate(s.date)}</b><span class="muted"> · Day ${pos} · ${dayName(s.day)}</span></span>
      ${s.offDay ? html`<span class="tagoff">Off day</span>` : icon(open ? 'chevronUp' : 'chevronDown', 'chev')}
    </button>
    ${open
      ? html`${entries.map((e) => html`<div class="hline"><span>${exerciseName(e.exerciseId, e.name)}</span><span>${setsLong(e.sets, unit)}</span></div>`)}
        ${s.note ? html`<p class="sum note-line">Note: ${s.note}</p>` : ''}`
      : html`<p class="sum">${entries.slice(0, SUMMARY_ENTRIES).map((e) => `${exerciseName(e.exerciseId, e.name)} ${setsShort(e.sets)}`).join(' · ')}${extra > 0 ? ` · +${extra} more` : ''}</p>`}
    ${open ? html`<div class="hist-actions">
      <button type="button" class="btn" data-act="edit">Edit</button>
      <button type="button" class="btn danger" data-act="delete">Delete</button>
    </div>` : ''}
  </article>`;
}

/**
 * Draw the History screen.
 * @param {HTMLElement} root
 * @param {object} ctx
 */
export function renderHistory(root, ctx) {
  const state = ctx.state;
  const positions = historyPositions(state.sessions);
  const newest = sortByDate(state.sessions).reverse();
  if (newest.length && newest[0].id !== ui.newest) {
    ui.newest = newest[0].id;
    ui.expanded.add(ui.newest);
  }
  const shown = newest.filter((s) => ui.filter === 'all' || (DAYS[s.day] && DAYS[s.day].type === ui.filter));

  const groups = [];
  for (const s of shown) {
    const month = formatMonthYear(s.date);
    if (!groups.length || groups[groups.length - 1].month !== month) groups.push({ month, items: [] });
    groups[groups.length - 1].items.push(s);
  }

  setHTML(root, html`<div class="screen history">
    <h1 class="page-title">History</h1>
    <div class="chips" role="group" aria-label="Filter">${FILTERS.map(([id, label]) => html`<button type="button" class="chip" data-act="filter" data-filter="${id}" aria-pressed="${ui.filter === id}">${label}</button>`)}</div>
    ${!state.sessions.length ? html`<div class="card empty"><p><b>No workouts yet</b></p><p class="muted">Log one in Today, or import a backup in Data.</p></div>`
      : !shown.length ? html`<div class="card empty"><p class="muted">No ${ui.filter} workouts yet.</p></div>` : ''}
    ${groups.map((g) => html`<h2 class="month">${g.month}</h2>${g.items.map((s) => card(s, positions.get(s.id), state.settings.unit))}`)}
  </div>`);

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const art = b.closest('article[data-id]');
    const s = art && ctx.state.sessions.find((x) => x.id === art.dataset.id);
    switch (b.dataset.act) {
      case 'filter': ui.filter = b.dataset.filter; ctx.render(); break;
      case 'toggle':
        if (s) { if (ui.expanded.has(s.id)) ui.expanded.delete(s.id); else ui.expanded.add(s.id); ctx.render(); }
        break;
      case 'edit': if (s) editSession(ctx, s.id); break;
      case 'delete': {
        if (!s) return;
        const ok = await confirmSheet({
          title: 'Delete this workout?',
          message: `${title(s, positions.get(s.id))} will be removed from this phone.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        const next = { ...ctx.state, sessions: deleteSession(ctx.state.sessions, s.id) };
        if (next.draft && next.draft.editingId === s.id) next.draft = null;
        ctx.commit(next);
        toast(`Deleted ${dayName(s.day)} · ${formatDate(s.date)}`);
        break;
      }
      default: break;
    }
  });
}
