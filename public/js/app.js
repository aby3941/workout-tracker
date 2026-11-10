// Boot, state, tab routing, saving, the service worker and app-wide banners.

import { load, save } from './store.js';
import { todayISO } from './dates.js';
import { renderToday } from './ui/today.js';
import { renderPlan } from './ui/plan.js';
import { renderProgress } from './ui/progress.js';
import { renderHistory } from './ui/history.js';
import { renderData } from './ui/data.js';
import { openStartingWeights } from './ui/pickers.js';
import { toast } from './ui/sheets.js';
import { focusKey, restoreFocus } from './ui/dom.js';

const VIEWS = { today: renderToday, plan: renderPlan, progress: renderProgress, history: renderHistory, data: renderData };
const DRAFT_DELAY = 300;

const storage = window.localStorage;
const viewEl = document.getElementById('view');
const tabs = [...document.querySelectorAll('nav.tabbar button[data-tab]')];

let state = load(storage);
let tab = 'today';
let saveTimer = 0;
let persistAsked = false;

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!save(state, storage)) toast("Couldn't save on this phone (storage full?) — export a backup now");
}

/** Draw the current tab. Keeps the scroll position unless told otherwise; puts focus back where it was. */
function render({ keepScroll = true } = {}) {
  const y = window.scrollY;
  const key = focusKey();
  const root = document.createElement('div'); // fresh element: listeners never pile up
  root.className = 'view-root';
  viewEl.replaceChildren(root);
  VIEWS[tab](root, ctx);
  for (const b of tabs) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  window.scrollTo(0, keepScroll ? y : 0);
  restoreFocus(root, key);
}

/** The context every screen receives. */
const ctx = {
  get state() { return state; },
  /** Replace the state without saving or drawing (the caller saves). */
  setState(next) { state = next; },
  /** Replace the state, save it, and redraw (unless render: false). */
  commit(next, { render: draw = true, keepScroll = true } = {}) {
    state = next;
    saveNow();
    if (draw) render({ keepScroll });
  },
  /** Save soon (draft autosave while typing). */
  saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, DRAFT_DELAY);
  },
  saveNow,
  render,
  /** Switch tab. */
  go(name) {
    if (!VIEWS[name]) return;
    tab = name;
    render({ keepScroll: false });
  },
  today: () => todayISO(),
  /** Ask the browser to keep our storage (once, after the first saved workout). */
  afterSave() {
    if (persistAsked) return;
    persistAsked = true;
    try { navigator.storage?.persist?.()?.catch?.(() => {}); } catch { /* not supported */ }
  },
};

for (const b of tabs) b.addEventListener('click', () => ctx.go(b.dataset.tab));

// iOS may kill a backgrounded Home Screen app: write the draft out as soon as we are hidden.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) saveNow(); });
window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

// ---------------------------------------------------------------- service worker + update banner

function showUpdateBanner() {
  const holder = document.getElementById('banners');
  if (!holder || holder.querySelector('.update')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'update';
  b.textContent = 'Update ready — tap to reload';
  b.addEventListener('click', () => window.location.reload());
  holder.append(b);
}

if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateBanner(); });
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

// ---------------------------------------------------------------- boot

render({ keepScroll: false });
if (!state.settings.setupDone && state.sessions.length === 0) openStartingWeights(ctx, { firstRun: true });
