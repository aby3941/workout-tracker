// Harness self-check: drives a throwaway page in /tmp (not the app) through every harness feature.
// Run: node tests/e2e/selfcheck.js   — proves server + Chrome control work independently of the app.

import fs from 'node:fs';
import path from 'node:path';
import { startServer, openSession, isSameOriginOrLocal, sleep } from './harness.js';

const DIR = '/tmp/ppl-e2e-selfcheck';
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>harness self-check</title><link rel="stylesheet" href="style.css"></head>
<body>
<h1 id="today"></h1>
<nav aria-label="Sections"><button aria-current="page">Today</button><button>Data</button></nav>
<section aria-label="Deadlift"><p>Main lift</p><p class="suggest-headline">First time</p>
  <input aria-label="Set 1 weight" inputmode="decimal"><input aria-label="Set 1 reps" inputmode="numeric" placeholder="5+">
  <button><span aria-hidden="true">&#8644;</span> Swap</button></section>
<button id="open">Open sheet</button>
<button id="export">Export backup (CSV)</button>
<button id="ext">External fetch</button>
<button id="err">Console error</button>
<button id="conf">Use confirm</button>
<div role="status" id="toast"></div>
<img src="dot.svg" alt="dot" width="10" height="10">
<div role="dialog" aria-modal="true" aria-label="Set weight: Squat" hidden id="sheet">
  <input aria-label="Weight (kg)" inputmode="decimal"><button id="save">Save</button><button id="cancel">Cancel</button>
</div>
<script type="module" src="app.js"></script>
</body></html>`);
fs.writeFileSync(path.join(DIR, 'style.css'), 'body{font:16px system-ui;background:#fff}@media (prefers-color-scheme: dark){body{background:#000;color:#fff}}input{font-size:16px}');
fs.writeFileSync(path.join(DIR, 'dot.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>');
fs.writeFileSync(path.join(DIR, 'app.js'), `
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
document.getElementById('today').textContent = 'Today is ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
const toast = (t) => { const el = document.getElementById('toast'); el.textContent = t; setTimeout(() => { el.textContent = ''; }, 300); };
const sheet = document.getElementById('sheet');
document.getElementById('open').addEventListener('click', () => { sheet.hidden = false; sheet.querySelector('input').focus(); });
document.getElementById('cancel').addEventListener('click', () => { sheet.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') sheet.hidden = true; });
document.getElementById('save').addEventListener('click', () => {
  const v = sheet.querySelector('input').value; localStorage.setItem('selfcheck', JSON.stringify({ weight: Number(v) }));
  sheet.hidden = true; toast('Saved ' + v);
});
document.querySelector('[aria-label="Deadlift"] button').addEventListener('click', () => toast('swapped'));
document.getElementById('export').addEventListener('click', () => {
  const blob = new Blob(['date,day\\n10/11/2026,Pull A\\n'], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ppl-backup-10-11-2026.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
});
document.getElementById('ext').addEventListener('click', () => { fetch('http://example.invalid/x').catch(() => {}); });
document.getElementById('err').addEventListener('click', () => { console.error('deliberate console error'); });
document.getElementById('conf').addEventListener('click', () => { confirm('deliberate confirm'); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
`);
fs.writeFileSync(path.join(DIR, 'sw.js'), `
const C = 'selfcheck-v1';
self.addEventListener('install', (e) => e.waitUntil(caches.open(C).then((c) => c.addAll(['./', './index.html', './app.js', './style.css', './dot.svg'])).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { if (e.request.method !== 'GET') return; e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request))); });
`);

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const server = await startServer({ root: DIR });
console.log(`server ${server.origin} serving ${DIR}`);
const t = await openSession({ server });
try {
  const mime = await fetch(server.url('/app.js')).then((r) => r.headers.get('content-type'));
  check('server MIME for .js', /text\/javascript/.test(mime), mime);
  const mimeSvg = await fetch(server.url('/dot.svg')).then((r) => r.headers.get('content-type'));
  check('server MIME for .svg', mimeSvg === 'image/svg+xml', mimeSvg);
  const traversal = await fetch(server.url('/..%2f..%2fetc%2fpasswd')).then((r) => r.status);
  check('server blocks path traversal', traversal === 403 || traversal === 404, `status ${traversal}`);

  await t.setClock('2026-11-10T09:00');
  await t.goto('/');
  await t.waitForHeading('Today is 10/11/2026');
  check('navigate + pinned clock (Date = 10/11/2026 local)', true);
  const vp = await t.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
  check('viewport 390×844 @2x', vp.w === 390 && vp.h === 844 && vp.dpr === 2, JSON.stringify(vp));
  const clockAdvances = await t.evaluate(async () => { const a = Date.now(); await new Promise((r) => setTimeout(r, 120)); return Date.now() - a; });
  check('pinned clock advances normally', clockAdvances >= 100 && clockAdvances < 1000, `${clockAdvances} ms`);

  await t.click('Swap', { within: 'Deadlift' });
  await t.waitForStatus('swapped');
  check('click by accessible name (aria-hidden icon ignored) + status capture', true);

  await t.type('Set 1 reps', 7, { within: 'Deadlift' });
  check('type by aria-label + read value', (await t.value('Set 1 reps', { within: 'Deadlift' })) === '7');
  const headline = await t.evaluate(() => document.querySelector('[aria-label="Deadlift"] .suggest-headline').textContent);
  check('read text', headline === 'First time', headline);

  await t.click('Open sheet');
  await t.waitForRole('dialog', 'Set weight: Squat');
  await t.type('Weight (kg)', 70);
  await t.click('Save');
  await t.waitGone('dialog', 'Set weight: Squat');
  await t.waitForStatus('Saved 70');
  check('dialog flow + transient toast caught', true);
  check('read localStorage', (await t.getJSON('selfcheck'))?.weight === 70);
  await t.setStorage('other', 'x');
  check('write localStorage', (await t.getStorage('other')) === 'x');

  await t.click('Open sheet');
  await t.waitForRole('dialog', 'Set weight: Squat');
  await t.press('Escape');
  await t.waitGone('dialog', 'Set weight: Squat');
  check('Escape key', true);

  await t.click('Export backup (CSV)');
  const dl = await t.waitForDownload();
  check('capture <a download> blob', dl.download === 'ppl-backup-10-11-2026.csv' && dl.text.startsWith('date,day'), `${dl.download}: ${JSON.stringify(dl.text)}`);
  await sleep(500);
  const real = (await t.getDownloads()).real;
  check('Chrome download events (Browser.setDownloadBehavior)', real.length >= 1, JSON.stringify(real.map((d) => ({ name: d.download, state: d.state }))));

  const shareHidden = await t.evaluate(() => typeof navigator.share === 'undefined' && typeof navigator.canShare === 'undefined');
  check('Web Share hidden (forces the <a download> fallback)', shareHidden);

  const file = await t.screenshot('selfcheck-light');
  check('screenshot', fs.statSync(file).size > 1000, file);
  await t.setColorScheme('dark');
  const dark = await t.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches && getComputedStyle(document.body).backgroundColor);
  check('emulate prefers-color-scheme: dark', dark === 'rgb(0, 0, 0)', String(dark));
  await t.screenshot('selfcheck-dark');
  await t.setColorScheme('light');

  const sw = await t.poll(() => (navigator.serviceWorker.controller ? { ok: true } : (navigator.serviceWorker.ready.then(() => {}), { pending: true, why: 'no controller yet' })), [], { timeout: 15000, what: 'service worker control' });
  check('service worker controls the page', sw.ok);
  const swReqs = t.requests.filter((r) => r.target === 'service_worker');
  check('service-worker requests are recorded', swReqs.length > 0, `${swReqs.length} SW requests, e.g. ${swReqs[0]?.url}`);

  const logBefore = server.log.length;
  await t.setOffline(true);
  await t.reload();
  await t.waitForHeading('Today is 10/11/2026');
  const leaked = server.log.slice(logBefore).filter((r) => !r.path.startsWith('/sw.js'));
  check('offline reload served by the service worker', leaked.length === 0, `requests that reached the (blocked) server: ${JSON.stringify(leaked.map((r) => r.path))}`);
  const offlineFetch = await t.evaluate(() => fetch('/not-cached-' + Math.random()).then(() => 'reached network', () => 'blocked'));
  check('offline blocks network for uncached requests', offlineFetch === 'blocked', offlineFetch);
  await t.setOffline(false);
  const onlineFetch = await t.evaluate(() => fetch('/dot.svg?x=' + Math.random(), { cache: 'no-store' }).then((r) => r.status, () => 'blocked'));
  check('back online', onlineFetch === 200, String(onlineFetch));

  await t.reload();
  await t.waitForHeading('Today is 10/11/2026');
  const before = t.errors.length;
  await t.click('External fetch');
  await t.click('Console error');
  await t.click('Use confirm');
  await sleep(400);
  const external = t.requests.filter((r) => !isSameOriginOrLocal(r.url, server.origin));
  check('request log flags external URLs', external.some((r) => r.url.startsWith('http://example.invalid')), JSON.stringify(external.map((r) => r.url)));
  const newErrors = t.errors.slice(before);
  check('console.error captured', newErrors.some((e) => e.kind === 'console.error' && /deliberate console error/.test(e.text)));
  check('window.confirm() captured (and auto-dismissed)', newErrors.some((e) => /confirm/.test(e.kind)));
  const exc = await t.evaluate(() => { setTimeout(() => { throw new Error('deliberate uncaught'); }, 0); return true; });
  await sleep(200);
  check('uncaught exception captured', exc && t.errors.some((e) => e.kind === 'uncaught exception' && /deliberate uncaught/.test(e.text)));
  check('request log has same-origin page requests', t.requests.filter((r) => r.target === 'page' && isSameOriginOrLocal(r.url, server.origin)).length >= 3, `${t.requests.length} requests total`);
} catch (err) {
  check('self-check crashed', false, err.stack || err.message);
} finally {
  await t.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} harness checks passed`);
process.exit(failed.length ? 1 : 0);
