// Bottom sheets / dialogs (role="dialog", aria-modal, labelled by their title), the in-app confirm, and toasts.
// While a sheet is open everything behind it is inert. Escape or the backdrop cancels the top sheet.

import { html, setHTML } from './dom.js';

const stack = [];

function background() {
  return [document.getElementById('view'), document.querySelector('nav.tabbar'), document.getElementById('banners')].filter(Boolean);
}

function updateInert() {
  const open = stack.length > 0;
  for (const el of background()) el.inert = open;
  stack.forEach((entry, i) => { entry.layer.inert = i !== stack.length - 1; });
  document.documentElement.classList.toggle('sheet-open', open);
  fitToKeyboard();
}

/**
 * Keep open sheets above the iPhone keyboard: while the keyboard is up (the visual viewport is shorter than the
 * window) the sheet layers take the visible area only, so a search box and the list under it stay in view.
 * Without a keyboard nothing is changed.
 */
function fitToKeyboard() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const up = Boolean(vv && stack.length && vv.height < window.innerHeight - 1);
  for (const { layer } of stack) {
    layer.classList.toggle('kb', up);
    layer.style.top = up ? `${vv.offsetTop}px` : '';
    layer.style.height = up ? `${vv.height}px` : '';
  }
}

function cancelTop() {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.onCancel) top.onCancel(top.close);
  else top.close();
}

let keysBound = false;

/** Escape cancels the top sheet; the keyboard fit follows the visual viewport (bound on first use, so importing this module touches nothing). */
function bindKeys() {
  if (keysBound) return;
  keysBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) {
      e.preventDefault();
      cancelTop();
    }
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitToKeyboard);
    window.visualViewport.addEventListener('scroll', fitToKeyboard);
  }
}

/**
 * Option lists in sheets answer the first tap (§17.5): pressing an option button does not move focus, so an open
 * iPhone keyboard stays where it is and nothing shifts under the finger before the click lands.
 * @param {Element|null} container
 */
export function keepFocusOnTap(container) {
  if (!container) return;
  container.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
}

/**
 * Open a sheet. `body` is a template result; the title becomes the dialog's accessible name (and its visible
 * heading, unless `showTitle` is false because the body has its own). `onCancel(close)` runs on Escape / backdrop
 * (default: just close).
 * @param {{title: string, body: object, onCancel?: (close: () => void) => void, className?: string, showTitle?: boolean}} opts
 * @returns {{el: HTMLElement, close: () => void}}
 */
export function openSheet({ title, body, onCancel, className = '', showTitle = true }) {
  bindKeys();
  const layer = document.createElement('div');
  layer.className = 'sheet-layer';
  setHTML(layer, html`<div class="backdrop"></div>
    <div class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1">
      <div class="grab" aria-hidden="true"></div>
      ${showTitle ? html`<h2 class="sheet-title">${title}</h2>` : ''}
      ${body}
    </div>`);
  document.body.append(layer);
  const sheet = layer.querySelector('.sheet');
  const entry = { layer, onCancel, prevFocus: document.activeElement };
  let closed = false;
  entry.close = () => {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    layer.remove();
    updateInert();
    const back = entry.prevFocus;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  };
  stack.push(entry);
  updateInert();
  layer.querySelector('.backdrop').addEventListener('click', cancelTop);
  const first = sheet.querySelector('[data-autofocus]') || sheet;
  first.focus({ preventScroll: true });
  return { el: sheet, close: entry.close };
}

/**
 * In-app confirm (never window.confirm). Resolves true when confirmed.
 * @param {{title: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>}
 */
export function confirmSheet({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value, close) => {
      if (done) return;
      done = true;
      close();
      resolve(value);
    };
    const { el, close } = openSheet({
      title,
      className: 'confirm',
      body: html`${message ? html`<p class="sheet-text">${message}</p>` : ''}
        <div class="sheet-actions">
          <button type="button" class="btn ${danger ? 'danger-fill' : 'primary'}" data-act="ok">${confirmLabel}</button>
          <button type="button" class="btn" data-act="cancel" data-autofocus>${cancelLabel}</button>
        </div>`,
      onCancel: (c) => finish(false, c),
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (b) finish(b.dataset.act === 'ok', close);
    });
  });
}

let toastTimer = 0;

/**
 * Brief message in the shared role="status" live region.
 * @param {string} message
 */
export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = message;
  el.classList.add('show');
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    toastTimer = setTimeout(() => { el.textContent = ''; }, 300);
  }, 3500);
}
