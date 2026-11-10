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
}

function cancelTop() {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (top.onCancel) top.onCancel(top.close);
  else top.close();
}

let keysBound = false;

/** Escape cancels the top sheet (bound on first use, so importing this module touches nothing). */
function bindKeys() {
  if (keysBound) return;
  keysBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) {
      e.preventDefault();
      cancelTop();
    }
  });
}

/**
 * Open a sheet. `body` is a template result; the title becomes the dialog's accessible name.
 * `onCancel(close)` runs on Escape / backdrop (default: just close).
 * @param {{title: string, body: object, onCancel?: (close: () => void) => void, className?: string}} opts
 * @returns {{el: HTMLElement, close: () => void}}
 */
export function openSheet({ title, body, onCancel, className = '' }) {
  bindKeys();
  const layer = document.createElement('div');
  layer.className = 'sheet-layer';
  setHTML(layer, html`<div class="backdrop"></div>
    <div class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1">
      <div class="grab" aria-hidden="true"></div>
      <h2 class="sheet-title">${title}</h2>
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
