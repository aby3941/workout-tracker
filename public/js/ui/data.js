// Data: status, CSV backup (share sheet or download), copy as text, import with preview, units, delete all,
// and the Add to Home Screen hint.

import { toCSV } from '../csv.js';
import { parseImport, formatText } from '../parser.js';
import { mergeSessions, convertAllWeights, defaultState, sessionKey } from '../store.js';
import { CONVERSION_STEP, formatWeight } from '../units.js';
import { formatDate } from '../dates.js';
import { exerciseName } from '../program.js';
import { html, setHTML, icon, plural, ago, setsShort } from './dom.js';
import { openSheet, confirmSheet, toast } from './sheets.js';
import { historyPositions, dayName } from './model.js';

// Import box text and the last preview survive re-renders (not saved).
const ui = { text: '', preview: null, copyText: null };

/** True when running as an installed Home Screen app. */
function standalone() {
  return Boolean(navigator.standalone) || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
}

/** "ppl-backup-10-11-2026.csv" */
const backupName = (today) => `ppl-backup-${formatDate(today).replace(/\//g, '-')}.csv`;

/**
 * The share sheet is for touch-first devices (the iPhone: Save to Files / AirDrop). Desktop browsers get a plain
 * download — desktop Chrome on macOS also reports file sharing, but its share() never settles without a share UI
 * (headless), so it must not be used there.
 */
const touchFirst = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Save a file: the iOS share sheet when files can be shared, else an <a download> click. */
async function exportBackup(ctx) {
  const state = ctx.state;
  const today = ctx.today();
  const name = backupName(today);
  const csv = toCSV(state.sessions, state.settings.unit);
  let shared = false;
  if (typeof File === 'function' && navigator.canShare && navigator.share && touchFirst()) {
    const file = new File([csv], name, { type: 'text/csv' });
    let can = false;
    try { can = navigator.canShare({ files: [file] }); } catch { can = false; }
    if (can) {
      try {
        await navigator.share({ files: [file] });
        shared = true;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // the user closed the share sheet: nothing saved
      }
    }
  }
  if (!shared) {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  ctx.commit({ ...ctx.state, settings: { ...ctx.state.settings, lastBackupAt: today } });
  toast(`Backup saved: ${name}`);
}

async function copyText(ctx) {
  const text = formatText(ctx.state.sessions, ctx.state.settings.unit);
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    ui.copyText = null;
    toast(`Copied ${plural(ctx.state.sessions.length, 'workout')} as text`);
  } catch {
    ui.copyText = text; // fallback: show it selectable
    ctx.render();
    const box = document.querySelector('textarea[data-copy]');
    if (box) { box.focus(); box.select(); }
  }
}

/** Parse the import box and work out what an import would do. */
function buildPreview(ctx, text) {
  const state = ctx.state;
  const { sessions, warnings } = parseImport(text, { unit: state.settings.unit, today: ctx.today() });
  const merged = mergeSessions(state.sessions, sessions);
  const positions = historyPositions(merged.sessions);
  const byKey = new Map(merged.sessions.map((s) => [sessionKey(s), s]));
  return {
    sessions,
    warnings,
    added: merged.added,
    replaced: merged.replaced,
    rows: sessions.map((s) => ({ s, pos: positions.get(byKey.get(sessionKey(s)).id) })),
  };
}

function previewMarkup(p) {
  if (!p) return '';
  const n = p.sessions.length;
  return html`<div class="preview" aria-live="polite">
    <p><b>${n ? `${plural(n, 'workout')} found` : 'No workouts found'}</b>${n ? html` · ${p.added} new, ${p.replaced} will replace existing` : ''}</p>
    ${p.rows.map(({ s, pos }) => html`<p class="pv">${formatDate(s.date)} · Day ${pos} · ${dayName(s.day)}${s.offDay ? ' (off day)' : ''} — ${s.entries.map((e) => `${exerciseName(e.exerciseId, e.name)} ${setsShort(e.sets)}`).join(' · ')}</p>`)}
    ${[...p.warnings].sort((a, b) => a.line - b.line).map((w) => html`<p class="warnline">${icon('warn')}<span><b>Line ${w.line}:</b> ${w.message}</span></p>`)}
    ${n ? html`<button type="button" class="save" data-act="import">Import ${plural(n, 'workout')}</button>` : ''}
  </div>`;
}

/**
 * Draw the Data screen.
 * @param {HTMLElement} root
 * @param {object} ctx
 */
export function renderData(root, ctx) {
  const state = ctx.state;
  const today = ctx.today();
  const unit = state.settings.unit;
  const last = state.settings.lastBackupAt;
  const lastText = last ? `last backup ${formatDate(last)} (${ago(last, today)})` : 'no backup yet';

  setHTML(root, html`<div class="screen data">
    <h1 class="page-title">Data</h1>
    ${standalone() ? '' : html`<div class="banner install">${icon('info')}<span>In Safari tap Share → Add to Home Screen. After that it works offline.</span></div>`}
    <div class="card status">
      <p><b>Saved on this phone only</b></p>
      <p class="muted">${plural(state.sessions.length, 'workout')} · ${lastText}</p>
    </div>

    <div class="card">
      <h2>Backup</h2>
      <button type="button" class="save" data-act="export">Export backup (CSV)</button>
      <p class="cap pad">Opens the share sheet → Save to Files or AirDrop to your Mac. The file opens in Numbers too.</p>
      <button type="button" class="btn wide" data-act="copy">Copy as text</button>
      ${ui.copyText != null ? html`<label class="field-label pad" for="copy-box">Select all and copy:</label>
        <textarea id="copy-box" class="paste" rows="8" readonly data-copy>${ui.copyText}</textarea>` : ''}
    </div>

    <div class="card">
      <h2>Import</h2>
      <p class="cap">Paste workouts as text, or choose a backup file.</p>
      <textarea class="paste" rows="6" aria-label="Paste workouts" placeholder="Paste workouts (text or CSV)" data-input="paste" spellcheck="false" autocapitalize="off">${ui.text}</textarea>
      <input type="file" accept=".csv,.txt,text/plain,text/csv" aria-label="Backup file" data-input="file" hidden>
      <div class="row2"><button type="button" class="btn" data-act="choose">Choose file</button><button type="button" class="btn primary" data-act="preview">Preview</button></div>
      ${previewMarkup(ui.preview)}
      <details><summary>How to write workouts</summary>
        <div class="cap pad help">
          <p>Start each workout with a date (day first) and the day: <code>10/11/2026 Pull A</code>. Add <code>(off day)</code> for a bad day.</p>
          <p>Then one line per exercise: <code>Deadlift 100x7</code>, <code>Lat pulldown 45x12 45x12 45x10</code>.</p>
          <p><code>45x12 x3</code> = 3 sets of 12 · <code>3x12@45</code> = the same · <code>100x5, 5, 7</code> = more sets at 100 · <code>bw x 8</code> = bodyweight · <code>100kg</code> / <code>225lb</code> are converted.</p>
          <p><code>Note: slept badly</code> adds a note. A CSV backup from this app works too.</p>
        </div>
      </details>
    </div>

    <div class="card">
      <h2>Settings</h2>
      <div class="setrow"><span>Units</span><div class="seg two" role="group" aria-label="Units">
        <button type="button" data-act="unit" data-unit="kg" aria-pressed="${unit === 'kg'}">kg</button>
        <button type="button" data-act="unit" data-unit="lb" aria-pressed="${unit === 'lb'}">lb</button></div></div>
      <div class="setrow"><span>Dates</span><span class="muted">DD/MM/YYYY (day first)</span></div>
    </div>

    <div class="card danger-zone">
      <h2>Delete all data</h2>
      <p class="cap">Removes every workout from this phone. Export a backup first.</p>
      <button type="button" class="btn danger" data-act="delete-all">Delete everything…</button>
    </div>
  </div>`);

  const paste = root.querySelector('[data-input="paste"]');
  const fileInput = root.querySelector('[data-input="file"]');
  const runPreview = () => {
    ui.text = paste.value;
    ui.preview = ui.text.trim() ? buildPreview(ctx, ui.text) : null;
    if (!ui.preview) toast('Paste some workouts first');
    ctx.render();
  };

  paste.addEventListener('input', () => {
    ui.text = paste.value;
    if (ui.preview) {
      ui.preview = null;
      const pv = root.querySelector('.preview');
      if (pv) pv.remove();
    }
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      paste.value = await file.text();
      runPreview();
    } catch {
      toast("Couldn't read that file");
    }
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'export': exportBackup(ctx); break;
      case 'copy': copyText(ctx); break;
      case 'choose': fileInput.click(); break;
      case 'preview': runPreview(); break;
      case 'import': {
        const p = ui.preview;
        if (!p || !p.sessions.length) return;
        const merged = mergeSessions(ctx.state.sessions, p.sessions);
        ui.preview = null;
        ui.text = '';
        ctx.commit({ ...ctx.state, sessions: merged.sessions });
        toast(`Imported ${plural(p.sessions.length, 'workout')}${merged.replaced ? ` (${merged.replaced} replaced)` : ''}`);
        break;
      }
      case 'unit': {
        const to = b.dataset.unit;
        if (to === ctx.state.settings.unit) return;
        const ok = await confirmSheet({
          title: `Convert all saved weights to ${to}?`,
          message: `Every workout and set weight is converted and rounded to the nearest ${formatWeight(CONVERSION_STEP[to], to)}.`,
          confirmLabel: 'Convert',
        });
        if (!ok) return;
        ui.preview = null;
        ctx.commit(convertAllWeights(ctx.state, to));
        toast(`Weights are now in ${to}`);
        break;
      }
      case 'delete-all': openDeleteAll(ctx); break;
      default: break;
    }
  });
}

function openDeleteAll(ctx) {
  const { el, close } = openSheet({
    title: 'Delete all data',
    className: 'confirm',
    body: html`<form>
      <p class="sheet-text">Every workout, set weight and setting on this phone is removed. This can't be undone — export a backup first.</p>
      <label class="field-label" for="type-delete">Type DELETE to confirm</label>
      <input id="type-delete" class="text-input" aria-label="Type DELETE" autocomplete="off" autocapitalize="characters" spellcheck="false" data-autofocus>
      <div class="sheet-actions">
        <button type="submit" class="btn danger-fill" disabled>Delete</button>
        <button type="button" class="btn" data-act="cancel">Cancel</button>
      </div>
    </form>`,
  });
  const input = el.querySelector('input');
  const del = el.querySelector('button[type="submit"]');
  input.addEventListener('input', () => { del.disabled = input.value.trim() !== 'DELETE'; });
  el.querySelector('[data-act="cancel"]').addEventListener('click', close);
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim() !== 'DELETE') return;
    close();
    ui.preview = null;
    ui.text = '';
    ctx.commit(defaultState(), { keepScroll: false });
    toast('All data deleted');
  });
}

