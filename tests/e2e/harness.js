// End-to-end harness: a static server for public/, headless Chrome, and a tiny Chrome DevTools
// Protocol (CDP) client over Node's global WebSocket. No dependencies.
//
// Every element lookup is by role + accessible name (aria-labelledby → aria-label → <label> →
// trimmed text without aria-hidden parts), never by CSS class. A lookup only sees *visible*
// elements, and by default searches inside the top-most open dialog (or the whole page when no
// dialog is open), the way a person can only touch what is on screen.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..', '..');
export const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
export const SHOTS_DIR = '/tmp/ppl-shots/e2e';
export const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** A blank same-origin page served by the test server (not from public/), used to seed storage. */
export const BLANK_PATH = '/__e2e__/blank.html';
export const IPHONE = Object.freeze({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
export const DEFAULT_TIMEOUT = Number(process.env.E2E_TIMEOUT || 6000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Error type for test failures (the runner prints its message as the reason). */
export class E2EError extends Error {}

// ---------------------------------------------------------------------------------------------
// Static server
// ---------------------------------------------------------------------------------------------

/**
 * Serve `root` on 127.0.0.1 with a random port.
 * `log` records every request; `setBlocked(true)` makes the server reset every connection
 * (a real "network is down"), and those requests are logged with `blocked: true`.
 * `override(path, body)` serves `body` for that path instead of the file on disk (e.g. a new sw.js
 * to simulate a deploy) until `clearOverrides()`.
 * @param {{root?: string, port?: number}} [opts]
 */
export function startServer({ root = PUBLIC_DIR, port = 0 } = {}) {
  const rootDir = path.resolve(root);
  const log = [];
  let blocked = false;
  const overrides = new Map(); // pathname → body (a simulated deploy of one file)
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const entry = { method: req.method, path: url.pathname + url.search, time: Date.now(), status: 0, blocked };
    log.push(entry);
    if (blocked) {
      entry.status = 'reset';
      req.socket.destroy();
      return;
    }
    const send = (status, body, type = 'text/plain; charset=utf-8', extra = {}) => {
      entry.status = status;
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache', ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed');
    if (url.pathname === BLANK_PATH) return send(200, '<!doctype html><meta charset="utf-8"><title>e2e blank</title><p>blank</p>', MIME['.html']);
    if (overrides.has(url.pathname)) return send(200, overrides.get(url.pathname), MIME[path.extname(url.pathname).toLowerCase()] || 'application/octet-stream');
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return send(400, 'Bad path'); }
    if (rel.includes('\0')) return send(400, 'Bad path');
    let file = path.resolve(rootDir, '.' + rel);
    if (file !== rootDir && !file.startsWith(rootDir + path.sep)) return send(403, 'Forbidden');
    try {
      let stat = await fsp.stat(file);
      if (stat.isDirectory()) {
        if (!url.pathname.endsWith('/')) return send(301, '', 'text/plain', { Location: url.pathname + '/' + url.search });
        file = path.join(file, 'index.html');
        stat = await fsp.stat(file);
      }
      const body = await fsp.readFile(file);
      entry.status = 200;
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      send(404, 'Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({
        origin,
        log,
        url: (p = '/') => new URL(p, origin + '/').href,
        setBlocked(on) { blocked = !!on; if (on) server.closeAllConnections?.(); },
        isBlocked: () => blocked,
        override(p, body) { overrides.set(p, String(body)); },
        clearOverrides() { overrides.clear(); },
        close: () => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
      });
    });
  });
}

// ---------------------------------------------------------------------------------------------
// CDP client
// ---------------------------------------------------------------------------------------------

/**
 * Minimal CDP client. `send(method, params, sessionId)` → result; `on(method, fn)` → unsubscribe;
 * handlers get `(params, sessionId)`.
 * @param {string} wsUrl
 */
export function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    let closed = false;
    const pending = new Map();
    const listeners = new Map();
    const api = {
      send(method, params = {}, sessionId) {
        if (closed) return Promise.reject(new Error(`CDP connection closed (${method})`));
        const id = nextId++;
        const msg = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej, method });
          ws.send(JSON.stringify(msg));
        });
      },
      on(method, fn) {
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(fn);
        return () => listeners.get(method)?.delete(fn);
      },
      waitForEvent(method, { sessionId, predicate, timeout = 15000 } = {}) {
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { off(); rej(new E2EError(`Timed out after ${timeout} ms waiting for ${method}`)); }, timeout);
          const off = api.on(method, (params, sid) => {
            if (sessionId && sid !== sessionId) return;
            if (predicate && !predicate(params)) return;
            clearTimeout(timer);
            off();
            res(params);
          });
        });
      },
      get closed() { return closed; },
      close() { try { ws.close(); } catch { /* already closed */ } },
    };
    ws.onopen = () => resolve(api);
    ws.onerror = (event) => { if (!closed) reject(new Error(`CDP WebSocket error: ${event?.message || 'connection failed'}`)); };
    ws.onclose = () => {
      closed = true;
      for (const p of pending.values()) p.reject(new Error(`CDP connection closed during ${p.method}`));
      pending.clear();
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      if (msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ` (${msg.error.data})` : ''}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of [...(listeners.get(msg.method) || [])]) {
          try { fn(msg.params, msg.sessionId); } catch { /* a listener bug must not kill the client */ }
        }
      }
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------------------------

/**
 * Launch Chrome with a fresh profile and connect to it.
 * @param {{headless?: boolean, extraArgs?: string[]}} [opts]
 */
export async function launchChrome({ headless = process.env.E2E_HEADED !== '1', extraArgs = [] } = {}) {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ppl-e2e-profile-'));
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Keep Chrome itself quiet and off the internet: only 127.0.0.1 resolves.
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,AutofillServerCommunication,InterestFeedContentSuggestions',
    '--metrics-recording-only',
    '--no-pings',
    '--use-mock-keychain',
    '--password-store=basic',
    '--mute-audio',
    '--hide-scrollbars',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ...extraArgs,
    'about:blank',
  ];
  const proc = spawn(CHROME_PATH, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-8000); });
  let exited = null;
  proc.on('exit', (code, signal) => { exited = { code, signal }; });
  proc.on('error', (err) => { exited = { error: err }; });

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  let content = '';
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Chrome exited before it was ready (${JSON.stringify(exited)}): ${stderr.slice(-1500)}`);
    try {
      content = await fsp.readFile(portFile, 'utf8');
      if (content.split('\n').filter(Boolean).length >= 2) break;
    } catch { /* not written yet */ }
    await sleep(50);
  }
  const [port, wsPath] = content.trim().split('\n');
  if (!port || !wsPath) { proc.kill('SIGKILL'); throw new Error(`Chrome did not write DevToolsActivePort in time: ${stderr.slice(-1500)}`); }
  const cdp = await connectCDP(`ws://127.0.0.1:${port.trim()}${wsPath.trim()}`);

  async function close() {
    try { await Promise.race([cdp.send('Browser.close'), sleep(3000)]); } catch { /* already gone */ }
    cdp.close();
    const until = Date.now() + 5000;
    while (!exited && Date.now() < until) await sleep(50);
    if (!exited) { proc.kill('SIGKILL'); await sleep(200); }
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); break; } catch { await sleep(200); }
    }
  }
  return { proc, cdp, userDataDir, port: Number(port), close, stderr: () => stderr };
}

// ---------------------------------------------------------------------------------------------
// In-page library (serialised into every evaluation; must stay self-contained)
// ---------------------------------------------------------------------------------------------

function pageLib() {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el || !el.isConnected || el.nodeType !== 1) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkVisibilityCSS: true })) return false;
    if (el.closest('[hidden],[inert]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const textOf = (node) => {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) out += child.nodeValue;
      else if (child.nodeType === 1) {
        if (child.getAttribute('aria-hidden') === 'true') continue;
        const tag = child.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') continue;
        if (tag === 'IMG') { out += child.getAttribute('alt') || ''; continue; }
        out += textOf(child);
      }
    }
    return out;
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.trim().split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (t === 'search') return 'searchbox';
      if (t === 'hidden') return null;
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'dialog') return 'dialog';
    if (tag === 'nav') return 'navigation';
    if (tag === 'section') return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : null;
    if (tag === 'article') return 'article';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'img';
    if (tag === 'li') return 'listitem';
    if (tag === 'option') return 'option';
    if (tag === 'output') return 'status';
    return null;
  };
  const isField = (el) => {
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return (el.getAttribute('type') || 'text').toLowerCase() !== 'hidden';
    return ['textbox', 'spinbutton', 'searchbox', 'combobox'].includes(el.getAttribute('role') || '') && el.isContentEditable;
  };
  const isTextEntry = (el) => {
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'number', 'tel', 'url', 'email', 'password', 'date'].includes(t);
  };
  const accName = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => textOf(n)).join(' ');
      if (norm(t)) return norm(t);
    }
    const al = el.getAttribute('aria-label');
    if (al && norm(al)) return norm(al);
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (el.labels && el.labels.length) return norm([...el.labels].map((l) => textOf(l)).join(' '));
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (['button', 'submit', 'reset'].includes(t)) return norm(el.value);
      return norm(el.getAttribute('title') || el.getAttribute('placeholder') || '');
    }
    if (tag === 'IMG') return norm(el.getAttribute('alt'));
    if (tag.toLowerCase() === 'svg') {
      const title = el.querySelector('title');
      return norm(title ? title.textContent : '');
    }
    return norm(textOf(el));
  };
  const matches = (name, m) => {
    if (m == null) return true;
    if (typeof m === 'string') return name === norm(m);
    if (m.exact != null) return name === norm(m.exact);
    // startsWith/includes keep a trailing space (so 'Import ' does not match a plain 'Import').
    if (m.startsWith != null) return name.startsWith(String(m.startsWith).replace(/\s+/g, ' ').replace(/^ /, ''));
    if (m.includes != null) return name.includes(String(m.includes).replace(/\s+/g, ' '));
    if (m.regex != null) return new RegExp(m.regex, m.flags || '').test(name);
    return false;
  };
  const dialogs = () => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog')]
    .filter((d) => (d.tagName !== 'DIALOG' || d.open) && visible(d));
  const topDialog = () => {
    const all = dialogs();
    const modal = all.filter((d) => d.getAttribute('aria-modal') === 'true' || (d.tagName === 'DIALOG' && d.matches(':modal')));
    const list = modal.length ? modal : all;
    if (!list.length) return null;
    const onTop = list.filter((d) => {
      const r = d.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 40), 0), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return hit && d.contains(hit);
    });
    return (onTop.length ? onTop : list)[(onTop.length ? onTop : list).length - 1];
  };
  // within: 'document' | null (top dialog, else document) | {role?, name, index?}
  const scope = (within) => {
    if (within === 'document') return document;
    const base = topDialog() || document;
    if (within == null) return base;
    const roots = [base, document];
    for (const root of roots) {
      const found = [...root.querySelectorAll('*')].filter((el) => {
        if (within.role) { if (roleOf(el) !== within.role) return false; } else if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) return false;
        return visible(el) && matches(accName(el), within.name);
      });
      if (found.length) return found[within.index || 0] || null;
      if (within.role === 'dialog') break; // a named dialog is searched for globally below
    }
    if (within.role === 'dialog') return dialogs().find((d) => matches(accName(d), within.name)) || null;
    return null;
  };
  // q: {role?, name?, within?, index?, field?, textEntry?, includeHidden?}
  const findAll = (q) => {
    const wantsDialog = !q.field && (q.role === 'dialog' || q.role === 'alertdialog');
    const root = wantsDialog && q.within == null ? document : scope(q.within);
    if (!root) return [];
    const all = root === document ? [...document.querySelectorAll('*')] : [root, ...root.querySelectorAll('*')];
    return all.filter((el) => {
      if (q.field) { if (!isField(el)) return false; if (q.textEntry && !isTextEntry(el)) return false; } else if (q.role && roleOf(el) !== q.role) return false;
      if (!q.includeHidden && !visible(el)) return false;
      return matches(accName(el), q.name);
    });
  };
  const findOne = (q) => findAll(q)[q.index || 0] || null;
  const center = (el) => {
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 2);
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 2);
    const hitEl = document.elementFromPoint(x, y);
    const hit = !!hitEl && (hitEl === el || el.contains(hitEl));
    return { x, y, hit, w: r.width, h: r.height };
  };
  const setValue = (el, value) => {
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  };
  const describe = () => {
    const vis = [...document.querySelectorAll('body *')].filter(visible);
    const by = (role) => vis.filter((e) => roleOf(e) === role).map((e) => accName(e).slice(0, 70));
    const uniq = (a) => [...new Set(a)];
    return {
      url: location.href,
      dialogs: dialogs().map((d) => (d.getAttribute('aria-label') || accName(d)).slice(0, 70)),
      headings: uniq(by('heading')).slice(0, 15),
      buttons: uniq(by('button')).slice(0, 50),
      fields: vis.filter(isField).slice(0, 30).map((e) => `${accName(e) || '(no name)'}=${JSON.stringify(String(e.value ?? '').slice(0, 30))}`),
      regions: uniq(vis.filter((e) => /^(SECTION|ARTICLE)$/.test(e.tagName) && e.getAttribute('aria-label')).map((e) => e.getAttribute('aria-label'))).slice(0, 25),
      status: (window.__e2eStatus || []).slice(-4),
    };
  };
  return { norm, visible, textOf, roleOf, isField, isTextEntry, accName, matches, dialogs, topDialog, scope, findAll, findOne, center, setValue, describe };
}

// ---------------------------------------------------------------------------------------------
// Scripts injected into every new document
// ---------------------------------------------------------------------------------------------

function clockScript({ y, mo, d, h, mi, s }) {
  return `(() => {
  const RealDate = globalThis.Date;
  const target = new RealDate(${y}, ${mo - 1}, ${d}, ${h}, ${mi}, ${s}, 0).getTime();
  const offset = target - RealDate.now();
  const FakeDate = function Date(...args) {
    if (!new.target) return new RealDate(RealDate.now() + offset).toString();
    return Reflect.construct(RealDate, args.length ? args : [RealDate.now() + offset], new.target);
  };
  Object.defineProperty(FakeDate, 'length', { value: 7 });
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + offset;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  try { Object.defineProperty(RealDate.prototype, 'constructor', { value: FakeDate, writable: true, configurable: true }); } catch (e) {}
  globalThis.Date = FakeDate;
  Object.defineProperty(globalThis, '__e2eClock', { value: { target, offset } });
})();`;
}

const STATUS_WATCH_SCRIPT = `(() => {
  const log = [];
  Object.defineProperty(window, '__e2eStatus', { value: log });
  const last = new WeakMap();
  const scan = () => {
    for (const el of document.querySelectorAll('[role="status"],[role="alert"],[aria-live]')) {
      const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t && last.get(el) !== t) log.push(t);
      last.set(el, t);
    }
  };
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
})();`;

const DOWNLOAD_HOOK_SCRIPT = `(() => {
  const out = [];
  Object.defineProperty(window, '__e2eDownloads', { value: out });
  const blobs = new Map();
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = function (obj) { const u = realCreate.call(URL, obj); blobs.set(u, obj); return u; };
  let inClick = false;
  const record = (a) => {
    if (!a || !a.hasAttribute || !a.hasAttribute('download')) return;
    const entry = { download: a.getAttribute('download'), href: a.href, text: null, type: null, error: null };
    out.push(entry);
    const b = blobs.get(a.href);
    if (b && typeof b.text === 'function') {
      entry.type = b.type;
      b.text().then((t) => { entry.text = t; }, (e) => { entry.error = String(e); });
    } else if (a.href.startsWith('data:')) {
      try {
        const comma = a.href.indexOf(',');
        const meta = a.href.slice(5, comma);
        const data = a.href.slice(comma + 1);
        entry.type = meta.split(';')[0];
        entry.text = meta.includes(';base64')
          ? new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
          : decodeURIComponent(data);
      } catch (e) { entry.error = String(e); }
    } else {
      fetch(a.href).then((r) => r.text()).then((t) => { entry.text = t; }, (e) => { entry.error = String(e); });
    }
  };
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    record(this);
    inClick = true;
    try { return realClick.call(this); } finally { inClick = false; }
  };
  document.addEventListener('click', (e) => {
    if (inClick) return;
    const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a) record(a);
  }, true);
})();`;

const HIDE_WEB_SHARE_SCRIPT = `(() => {
  try { for (const k of ['share', 'canShare']) if (k in Navigator.prototype) delete Navigator.prototype[k]; } catch (e) {}
})();`;

// ---------------------------------------------------------------------------------------------
// Page session (one fresh Chrome profile per scenario)
// ---------------------------------------------------------------------------------------------

const toMatcher = (m) => (m instanceof RegExp ? { regex: m.source, flags: m.flags } : m);
const describeMatcher = (m) => {
  if (m == null) return '(any)';
  if (m instanceof RegExp) return String(m);
  if (typeof m === 'string') return JSON.stringify(m);
  if (m.startsWith != null) return `starting with ${JSON.stringify(m.startsWith)}`;
  if (m.includes != null) return `containing ${JSON.stringify(m.includes)}`;
  if (m.exact != null) return JSON.stringify(m.exact);
  if (m.regex != null) return `/${m.regex}/${m.flags || ''}`;
  return JSON.stringify(m);
};
const toWithin = (w) => {
  if (w == null || w === 'document') return w ?? null;
  if (typeof w === 'string' || w instanceof RegExp) return { name: toMatcher(w) };
  return { ...w, name: toMatcher(w.name) };
};
const describeWithin = (w) => {
  if (w == null) return '';
  if (w === 'document') return ' (whole page)';
  if (typeof w === 'string' || w instanceof RegExp) return ` inside ${describeMatcher(w)}`;
  return ` inside ${w.role || 'element'} ${describeMatcher(w.name)}`;
};

/** Parse 'YYYY-MM-DDTHH:MM[:SS]' (local time) into parts. */
function parseLocal(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(str);
  if (!m) throw new Error(`Bad local date-time ${str}; use YYYY-MM-DDTHH:MM`);
  return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 9), mi: +(m[5] || 0), s: +(m[6] || 0) };
}

/**
 * Launch a fresh Chrome profile, open one page and return the page API used by the scenarios.
 * @param {{server: object, viewport?: object, colorScheme?: 'light'|'dark', hideWebShare?: boolean,
 *          reducedMotion?: boolean}} opts
 */
export async function openSession({ server, viewport = IPHONE, colorScheme = 'light', hideWebShare = true, reducedMotion = true } = {}) {
  const browser = await launchChrome();
  const { cdp } = browser;
  const sessions = new Map(); // sessionId → {type, url, targetId}
  const requests = []; // {url, method, type, target, scenarioStep}
  const requestById = new Map();
  const errors = []; // {source, kind, text}
  const consoleLog = []; // every console message (diagnostics)
  const downloads = new Map(); // guid → {suggestedFilename, url, state, file}
  const trail = [];
  let offline = false;
  let currentStep = '(start)';
  let clockScriptId = null;
  const downloadDir = path.join(browser.userDataDir, 'downloads');
  fs.mkdirSync(downloadDir, { recursive: true });

  const label = (sid) => sessions.get(sid)?.type || 'browser';
  const offlineParams = (on) => ({ offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  async function emulateOffline(sid, on) {
    try {
      await cdp.send('Network.emulateNetworkConditions', offlineParams(on), sid);
    } catch (err) {
      // Newer protocol fallback.
      await cdp.send('Network.overrideNetworkState', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sid).catch(() => { throw err; });
    }
  }

  cdp.on('Target.attachedToTarget', async ({ sessionId, targetInfo, waitingForDebugger }) => {
    if (targetInfo.type === 'page') return; // our own page: attached and set up explicitly below
    // Only watch workers of the app's origin; Chrome's own component extensions / browser UI are ignored.
    if (!String(targetInfo.url || '').startsWith(server.origin + '/')) {
      if (waitingForDebugger) await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
      cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
      return;
    }
    sessions.set(sessionId, { type: targetInfo.type, url: targetInfo.url, targetId: targetInfo.targetId });
    try {
      await cdp.send('Network.enable', {}, sessionId).catch(() => {});
      await cdp.send('Runtime.enable', {}, sessionId).catch(() => {});
      await cdp.send('Log.enable', {}, sessionId).catch(() => {});
      if (offline) await emulateOffline(sessionId, true).catch(() => {});
    } finally {
      if (waitingForDebugger) cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    }
  });
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => { sessions.delete(sessionId); });
  cdp.on('Network.requestWillBeSent', (p, sid) => {
    if (!sessions.has(sid)) return;
    const entry = { url: p.request.url, method: p.request.method, type: p.type || '', target: label(sid), step: currentStep };
    requests.push(entry);
    requestById.set(`${sid}:${p.requestId}`, entry);
  });
  cdp.on('Network.loadingFailed', (p, sid) => {
    const entry = requestById.get(`${sid}:${p.requestId}`);
    if (entry) entry.failed = p.errorText || 'failed';
  });
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }, sid) => {
    if (!sessions.has(sid)) return;
    const text = d.exception?.description || d.exception?.value || d.text;
    errors.push({ source: label(sid), kind: 'uncaught exception', text: `${text}${d.url ? ` (${d.url}:${d.lineNumber + 1})` : ''}`, step: currentStep });
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args, stackTrace }, sid) => {
    if (!sessions.has(sid)) return;
    const text = args.map((a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.description || a.type)).join(' ');
    consoleLog.push({ source: label(sid), type, text });
    if (type === 'error' || type === 'assert') {
      const where = stackTrace?.callFrames?.[0];
      errors.push({ source: label(sid), kind: `console.${type}`, text: `${text}${where ? ` (${where.url}:${where.lineNumber + 1})` : ''}`, step: currentStep });
    }
  });
  cdp.on('Log.entryAdded', ({ entry }, sid) => {
    if (!sessions.has(sid)) return;
    consoleLog.push({ source: label(sid), type: `log.${entry.level}`, text: entry.text });
    if (entry.level !== 'error') return;
    if (/\/favicon\.ico/.test(entry.url || '')) return;
    errors.push({ source: label(sid), kind: `browser log (${entry.source})`, text: `${entry.text}${entry.url ? ` (${entry.url})` : ''}`, step: currentStep });
  });
  cdp.on('Page.javascriptDialogOpening', ({ type, message }, sid) => {
    if (!sessions.has(sid)) return;
    if (type !== 'beforeunload') errors.push({ source: label(sid), kind: `window.${type}() used`, text: message, step: currentStep });
    cdp.send('Page.handleJavaScriptDialog', { accept: type === 'beforeunload' }, sid).catch(() => {});
  });
  cdp.on('Browser.downloadWillBegin', (p) => { downloads.set(p.guid, { suggestedFilename: p.suggestedFilename, url: p.url, state: 'started' }); });
  cdp.on('Browser.downloadProgress', (p) => {
    const d = downloads.get(p.guid);
    if (d) { d.state = p.state; if (p.state === 'completed') d.file = path.join(downloadDir, p.guid); }
  });

  // Auto-attach (paused) to service workers and other workers so their requests and errors are seen.
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: [{ type: 'page', exclude: true }, { type: 'tab', exclude: true }, { type: 'browser', exclude: true }, {}],
  });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloadDir, eventsEnabled: true }).catch(() => {});

  const { targetInfos } = await cdp.send('Target.getTargets');
  let pageTarget = targetInfos.find((t) => t.type === 'page');
  if (!pageTarget) pageTarget = { targetId: (await cdp.send('Target.createTarget', { url: 'about:blank' })).targetId };
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
  sessions.set(sid, { type: 'page', url: 'about:blank', targetId: pageTarget.targetId });
  const send = (method, params) => cdp.send(method, params, sid);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Log.enable').catch(() => {});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STATUS_WATCH_SCRIPT });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: DOWNLOAD_HOOK_SCRIPT });
  if (hideWebShare) await send('Page.addScriptToEvaluateOnNewDocument', { source: HIDE_WEB_SHARE_SCRIPT });

  const LIB = `(${pageLib.toString()})()`;

  async function evaluate(fn, ...args) {
    const expression = typeof fn === 'function' ? `(${fn.toString()})(${LIB}, ...${JSON.stringify(args)})` : String(fn);
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new E2EError(`In-page error: ${d.exception?.description || d.text}`);
    }
    return r.result.value;
  }

  async function describe() {
    try {
      const d = await evaluate((lib) => lib.describe());
      return [
        `    page: ${d.url}`,
        `    dialogs: ${JSON.stringify(d.dialogs)}`,
        `    headings: ${JSON.stringify(d.headings)}`,
        `    buttons: ${JSON.stringify(d.buttons)}`,
        `    fields: ${JSON.stringify(d.fields)}`,
        `    sections/articles: ${JSON.stringify(d.regions)}`,
        `    recent status text: ${JSON.stringify(d.status)}`,
      ].join('\n');
    } catch (e) {
      return `    (could not describe page: ${e.message})`;
    }
  }

  /** Poll an in-page op until it returns a truthy value without `pending`. */
  async function poll(op, args, { timeout = DEFAULT_TIMEOUT, interval = 60, what = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    for (;;) {
      try { last = await evaluate(op, ...args); } catch (e) { last = { pending: true, why: e.message }; }
      if (last && !last.pending) return last;
      if (Date.now() >= deadline) {
        const why = last && last.why ? ` — ${last.why}` : '';
        throw new E2EError(`Timed out after ${timeout} ms waiting for ${what}${why}\n${await describe()}`);
      }
      await sleep(interval);
    }
  }

  const locateOp = (lib, q, scroll) => {
    const all = lib.findAll(q);
    const el = all[q.index || 0];
    if (!el) return { pending: true, why: 'not found (or not visible)' };
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return { pending: true, why: 'found but disabled' };
    if (scroll) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    return { ...lib.center(el), name: lib.accName(el), count: all.length };
  };
  const clickOp = (lib, q) => {
    const el = lib.findOne(q);
    if (!el) return { pending: true, why: 'vanished before the click' };
    el.click();
    return { ok: true };
  };

  async function mouseClick(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  /** Locate, wait until its position is stable (animations), click at its centre (or el.click() if covered). */
  async function clickQuery(q, what, timeout) {
    const deadline = Date.now() + timeout;
    let prev = null;
    let target;
    for (;;) {
      target = await poll(locateOp, [q, true], { timeout: Math.max(200, deadline - Date.now()), what });
      if (prev && Math.abs(prev.x - target.x) < 1 && Math.abs(prev.y - target.y) < 1) break;
      if (Date.now() >= deadline) break;
      prev = target;
      await sleep(50);
    }
    if (target.hit) await mouseClick(target.x, target.y);
    else await poll(clickOp, [q], { timeout: 1000, what });
    trail.push(`click ${what}`);
    await sleep(60);
    return target;
  }

  const page = {
    cdp,
    sessionId: sid,
    server,
    origin: server.origin,
    requests,
    errors,
    consoleLog,
    trail,
    browser,
    evaluate,
    describe,
    poll,

    /** Label the current step; failure messages say where they happened. */
    step(text) { currentStep = text; trail.push(`— ${text}`); },
    get currentStep() { return currentStep; },

    async goto(url, { timeout = 15000 } = {}) {
      const full = /^[a-z]+:/i.test(url) ? url : server.url(url);
      const loaded = cdp.waitForEvent('Page.loadEventFired', { sessionId: sid, timeout });
      const r = await send('Page.navigate', { url: full });
      if (r.errorText) { loaded.catch(() => {}); throw new E2EError(`Navigation to ${full} failed: ${r.errorText}`); }
      await loaded;
      trail.push(`goto ${full}`);
    },
    async reload({ timeout = 15000 } = {}) {
      const loaded = cdp.waitForEvent('Page.loadEventFired', { sessionId: sid, timeout });
      await send('Page.reload', {});
      await loaded;
      trail.push('reload');
    },

    async setViewport(v = IPHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor ?? 2, mobile: v.mobile ?? true });
    },
    async setColorScheme(scheme, { reduced = reducedMotion } = {}) {
      const features = [{ name: 'prefers-color-scheme', value: scheme }];
      if (reduced) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
      await send('Emulation.setEmulatedMedia', { media: '', features });
    },
    /** Offline on/off for the page and every worker (service worker included). `blockServer` also makes the server reset connections. */
    async setOffline(on, { blockServer = true } = {}) {
      offline = !!on;
      for (const s of sessions.keys()) await emulateOffline(s, offline).catch(() => {});
      if (blockServer) server.setBlocked(offline);
      trail.push(`offline=${offline}`);
    },
    /**
     * Pin "now" for every document loaded from here on: Date starts at this local date-time
     * and advances normally. Takes effect on the next goto()/reload().
     * @param {string} localDateTime 'YYYY-MM-DDTHH:MM'
     */
    async setClock(localDateTime) {
      if (clockScriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScriptId });
      const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: clockScript(parseLocal(localDateTime)) });
      clockScriptId = identifier;
      trail.push(`clock=${localDateTime}`);
    },

    async screenshot(name) {
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(SHOTS_DIR, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },

    // ---- storage --------------------------------------------------------------------------
    getStorage: (key) => evaluate((lib, k) => localStorage.getItem(k), key),
    setStorage: (key, value) => evaluate((lib, k, v) => { localStorage.setItem(k, v); return true; }, key, value),
    removeStorage: (key) => evaluate((lib, k) => { localStorage.removeItem(k); return true; }, key),
    clearStorage: () => evaluate(() => { localStorage.clear(); return true; }),
    async getJSON(key) { const raw = await page.getStorage(key); return raw == null ? null : JSON.parse(raw); },

    // ---- queries --------------------------------------------------------------------------
    /** Wait for a visible element with this role and accessible name. */
    async waitForRole(role, name, { within, timeout = DEFAULT_TIMEOUT, index } = {}) {
      const q = { role, name: toMatcher(name), within: toWithin(within), index };
      return poll(locateOp, [q, false], { timeout, what: `${role} named ${describeMatcher(name)}${describeWithin(within)}` });
    },
    async waitGone(role, name, { within, timeout = DEFAULT_TIMEOUT } = {}) {
      const q = { role, name: toMatcher(name), within: toWithin(within) };
      return poll((lib, qq) => (lib.findAll(qq).length ? { pending: true, why: 'still visible' } : { gone: true }), [q],
        { timeout, what: `${role} ${describeMatcher(name)} to disappear` });
    },
    /** Is there a matching element now? (`includeHidden` also counts invisible ones.) No waiting. */
    exists: (role, name, { within, index, includeHidden } = {}) => evaluate((lib, q) => !!lib.findOne(q), { role, name: toMatcher(name), within: toWithin(within), index, includeHidden }),
    count: (role, name, { within, includeHidden } = {}) => evaluate((lib, q) => lib.findAll(q).length, { role, name: toMatcher(name), within: toWithin(within), includeHidden }),
    /** Is a field (input/textarea/select) with this accessible name visible right now? No waiting. */
    fieldVisible: (name, { within, index } = {}) => evaluate((lib, q) => !!lib.findOne(q), { field: true, name: toMatcher(name), within: toWithin(within), index }),
    async waitFieldGone(name, { within, timeout = DEFAULT_TIMEOUT } = {}) {
      const q = { field: true, name: toMatcher(name), within: toWithin(within) };
      return poll((lib, qq) => (lib.findAll(qq).length ? { pending: true, why: 'still visible' } : { gone: true }), [q],
        { timeout, what: `field ${describeMatcher(name)} to disappear` });
    },
    names: (role, { within } = {}) => evaluate((lib, q) => lib.findAll(q).map((e) => lib.accName(e)), { role, within: toWithin(within) }),
    /** Attribute of the first visible role+name match (null if missing). */
    attr: (role, name, attribute, { within, index, includeHidden } = {}) => evaluate((lib, q, a) => {
      const el = lib.findOne(q);
      return el ? el.getAttribute(a) : null;
    }, { role, name: toMatcher(name), within: toWithin(within), index, includeHidden }, attribute),
    /** Wait until a role+name element has attribute === value. */
    async waitAttr(role, name, attribute, value, { within, timeout = DEFAULT_TIMEOUT, includeHidden } = {}) {
      const q = { role, name: toMatcher(name), within: toWithin(within), includeHidden };
      return poll((lib, qq, a, v) => {
        const el = lib.findOne(qq);
        if (!el) return { pending: true, why: 'element not found' };
        const got = el.getAttribute(a);
        return got === v ? { ok: true } : { pending: true, why: `${a}=${JSON.stringify(got)}` };
      }, [q, attribute, value], { timeout, what: `${role} ${describeMatcher(name)}${describeWithin(within)} to have ${attribute}="${value}"` });
    },

    /** Visible text (innerText, whitespace collapsed) of the page or of a labelled element. */
    async text({ within = 'document' } = {}) {
      return evaluate((lib, w) => {
        const root = lib.scope(w);
        if (!root) return null;
        return lib.norm(root === document ? document.body.innerText : root.innerText);
      }, toWithin(within));
    },
    /** All text including hidden parts (textContent) of the page or a labelled element. */
    async fullText({ within = 'document' } = {}) {
      return evaluate((lib, w) => {
        const root = lib.scope(w);
        if (!root) return null;
        return lib.norm(root === document ? document.body.textContent : root.textContent);
      }, toWithin(within));
    },
    /** Wait until the visible text of the page (or a labelled element) matches. */
    async waitForText(matcher, { within = 'document', timeout = DEFAULT_TIMEOUT } = {}) {
      return poll((lib, m, w) => {
        const root = lib.scope(w);
        if (!root) return { pending: true, why: 'container not found' };
        const text = lib.norm(root === document ? document.body.innerText : root.innerText);
        return lib.matches(text, typeof m === 'string' ? { includes: m } : m) ? { text } : { pending: true, why: `text is ${JSON.stringify(text.slice(0, 300))}` };
      }, [toMatcher(matcher), toWithin(within)], { timeout, what: `text ${describeMatcher(matcher)}${describeWithin(within)}` });
    },
    /** Wait for a heading (h1–h6 / role=heading) — or failing that any element — whose text is exactly `text`. */
    async waitForHeading(text, { timeout = DEFAULT_TIMEOUT } = {}) {
      return poll((lib, t) => {
        const want = lib.norm(t);
        const vis = [...document.querySelectorAll('body *')].filter(lib.visible);
        const heading = vis.find((e) => lib.roleOf(e) === 'heading' && lib.norm(e.innerText) === want);
        if (heading) return { how: 'heading' };
        const any = vis.find((e) => e.textContent.length <= want.length * 2 + 40 && lib.norm(e.innerText) === want);
        if (any) return { how: any.tagName.toLowerCase() };
        const headings = vis.filter((e) => lib.roleOf(e) === 'heading').map((e) => lib.norm(e.innerText));
        return { pending: true, why: `visible headings: ${JSON.stringify(headings.slice(0, 8))}` };
      }, [text], { timeout, what: `heading ${JSON.stringify(text)}` });
    },
    /** Status/toast texts seen since the page loaded (captured by a MutationObserver, so short toasts are not missed). */
    statusLog: () => evaluate(() => [...(window.__e2eStatus || [])]),
    clearStatusLog: () => evaluate(() => { if (window.__e2eStatus) window.__e2eStatus.length = 0; return true; }),
    async waitForStatus(matcher, { timeout = DEFAULT_TIMEOUT } = {}) {
      return poll((lib, m) => {
        const log = window.__e2eStatus || [];
        const now = [...document.querySelectorAll('[role="status"]')].map((e) => lib.norm(e.textContent)).filter(Boolean);
        const hit = [...log, ...now].find((t) => lib.matches(t, typeof m === 'string' ? { includes: m } : m));
        return hit ? { text: hit } : { pending: true, why: `status texts so far: ${JSON.stringify([...new Set([...log, ...now])].slice(-6))}` };
      }, [toMatcher(matcher)], { timeout, what: `a role="status" message ${describeMatcher(matcher)}` });
    },

    // ---- actions --------------------------------------------------------------------------
    /** Click a visible element by role (default button) and accessible name. */
    async click(name, { role = 'button', within, index, timeout = DEFAULT_TIMEOUT } = {}) {
      const q = { role, name: toMatcher(name), within: toWithin(within), index };
      return clickQuery(q, `${role} named ${describeMatcher(name)}${describeWithin(within)}`, timeout);
    },
    /** Set a field's value (found by accessible name) and fire input + change. */
    async type(name, value, { within, index, timeout = DEFAULT_TIMEOUT } = {}) {
      const q = { field: true, name: toMatcher(name), within: toWithin(within), index };
      const what = `field named ${describeMatcher(name)}${describeWithin(within)}`;
      await poll(locateOp, [q, true], { timeout, what });
      const result = await poll((lib, qq, v) => {
        const el = lib.findOne(qq);
        return el ? { value: lib.setValue(el, v) } : { pending: true, why: 'vanished' };
      }, [q, String(value)], { timeout: 1000, what });
      trail.push(`type ${what} = ${JSON.stringify(String(value))}`);
      await sleep(30);
      return result.value;
    },
    /** Type into the n-th visible text-entry field (input/textarea) inside a scope (default: top dialog). */
    async typeInTextField(value, { within, index = 0, timeout = DEFAULT_TIMEOUT } = {}) {
      const q = { field: true, textEntry: true, name: null, within: toWithin(within), index };
      const what = `text field #${index + 1}${describeWithin(within) || ' in the open dialog'}`;
      await poll(locateOp, [q, true], { timeout, what });
      await poll((lib, qq, v) => { const el = lib.findOne(qq); return el ? { value: lib.setValue(el, v) } : { pending: true }; }, [q, String(value)], { timeout: 1000, what });
      trail.push(`type ${what} = ${JSON.stringify(String(value))}`);
      await sleep(30);
    },
    /** Value of a visible field by accessible name. */
    async value(name, { within, index, timeout = DEFAULT_TIMEOUT } = {}) {
      const q = { field: true, name: toMatcher(name), within: toWithin(within), index };
      const r = await poll((lib, qq) => { const el = lib.findOne(qq); return el ? { value: el.value } : { pending: true, why: 'not found (or not visible)' }; }, [q],
        { timeout, what: `field named ${describeMatcher(name)}${describeWithin(within)}` });
      return r.value;
    },
    async press(key) {
      const codes = { Escape: 27, Enter: 13, Tab: 9 };
      const base = { key, code: key, windowsVirtualKeyCode: codes[key] || 0, nativeVirtualKeyCode: codes[key] || 0 };
      await send('Input.dispatchKeyEvent', key === 'Enter' ? { type: 'keyDown', ...base, text: '\r' } : { type: 'rawKeyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      trail.push(`press ${key}`);
      await sleep(60);
    },
    /** Click at a raw element centre that an in-page op returned ({x, y}). */
    mouseClick,

    // ---- downloads ------------------------------------------------------------------------
    /** Files the page tried to download via <a download> (content captured in-page) plus real Chrome downloads. */
    async getDownloads() {
      const inPage = await evaluate(() => (window.__e2eDownloads || []).map((d) => ({ ...d })));
      const real = [];
      for (const d of downloads.values()) {
        let text = null;
        if (d.file) { try { text = fs.readFileSync(d.file, 'utf8'); } catch { /* not yet */ } }
        real.push({ download: d.suggestedFilename, href: d.url, state: d.state, text });
      }
      return { inPage, real };
    },
    async waitForDownload({ timeout = DEFAULT_TIMEOUT } = {}) {
      const deadline = Date.now() + timeout;
      for (;;) {
        const { inPage, real } = await page.getDownloads();
        const hit = inPage.find((d) => d.text != null) || real.find((d) => d.text != null);
        if (hit) return { ...hit, inPage, real };
        if (Date.now() >= deadline) throw new E2EError(`Timed out after ${timeout} ms waiting for a download. In-page: ${JSON.stringify(inPage)}; Chrome: ${JSON.stringify(real)}`);
        await sleep(80);
      }
    },

    async close() { try { if (offline) server.setBlocked(false); } finally { await browser.close(); } },
  };

  await page.setViewport(viewport);
  await page.setColorScheme(colorScheme);
  return page;
}

/** True when `url` is same-origin with `origin`, or a non-network scheme (data:, blob:, about:). */
export function isSameOriginOrLocal(url, origin) {
  if (/^(data|blob|about):/i.test(url)) return true;
  try { return new URL(url).origin === origin; } catch { return false; }
}
