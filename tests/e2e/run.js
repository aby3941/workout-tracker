// Runs every end-to-end scenario, each in a fresh headless-Chrome profile.
//   node tests/e2e/run.js                 all scenarios
//   node tests/e2e/run.js swap offline    only scenarios whose id contains one of the words
//   E2E_HEADED=1 node tests/e2e/run.js    watch it in a visible Chrome window
// Prints PASS/FAIL with the reason, saves /tmp/ppl-shots/e2e/FAIL-<id>.png on failure, and exits 1
// if anything failed. Two whole-run checks follow the scenarios: no external requests and no
// console errors / uncaught exceptions in any scenario.

import fs from 'node:fs';
import { startServer, openSession, isSameOriginOrLocal, E2EError, SHOTS_DIR } from './harness.js';
import { scenarios } from './scenarios.e2e.js';

const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const selected = filters.length ? scenarios.filter((s) => filters.some((f) => s.id.includes(f))) : scenarios;
if (!selected.length) {
  console.error(`No scenario matches ${JSON.stringify(filters)}. Ids: ${scenarios.map((s) => s.id).join(', ')}`);
  process.exit(2);
}

const indent = (text, pad = '    ') => String(text).split('\n').map((l) => (l.startsWith('    ') ? l : pad + l)).join('\n');

function withTimeout(promise, ms, label) {
  let timer;
  promise.catch(() => {}); // a scenario that keeps running after its timeout must not crash the run
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new E2EError(`${label} timed out after ${ms / 1000} s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

fs.mkdirSync(SHOTS_DIR, { recursive: true });
for (const sc of selected) fs.rmSync(`${SHOTS_DIR}/FAIL-${sc.id}.png`, { force: true }); // no stale failure shots
const server = await startServer();
console.log(`PPL Tracker e2e — serving public/ at ${server.origin} — ${selected.length} scenario(s)\n`);

const results = [];
const allRequests = [];
const allErrors = [];
const runStart = Date.now();

for (const sc of selected) {
  const started = Date.now();
  let t = null;
  let status = 'PASS';
  let reason = '';
  try {
    t = await openSession({ server });
    await withTimeout(sc.run(t), sc.timeout ?? 90000, `Scenario "${sc.id}"`);
  } catch (err) {
    status = 'FAIL';
    reason = err instanceof E2EError ? err.message : (err && err.stack) || String(err);
    if (t) {
      reason += `\nat step: ${t.currentStep}`;
      if (!(err instanceof E2EError) || !/\n {4}page:/.test(err.message)) reason += `\n${await t.describe()}`;
      try { reason += `\nscreenshot: ${await t.screenshot(`FAIL-${sc.id}`)}`; } catch { /* page gone */ }
    }
  } finally {
    server.setBlocked(false);
    server.clearOverrides();
    if (t) {
      allRequests.push(...t.requests.map((r) => ({ ...r, scenario: sc.id })));
      allErrors.push(...t.errors.map((e) => ({ ...e, scenario: sc.id })));
      await t.close().catch(() => {});
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const errs = t ? t.errors.length : 0;
  results.push({ id: sc.id, status, reason });
  console.log(`${status} ${sc.id} (${secs}s) — ${sc.title}${errs ? `  [${errs} console error(s), see below]` : ''}`);
  if (reason) console.log(indent(reason));
}

// Whole-run check 1: every request is same-origin (or data:/blob:/about:).
const external = allRequests.filter((r) => !isSameOriginOrLocal(r.url, server.origin));
const extResult = {
  id: 'no-external-requests',
  status: external.length ? 'FAIL' : 'PASS',
  reason: external.length
    ? `External requests:\n${[...new Map(external.map((r) => [`${r.scenario} ${r.url}`, r])).values()].slice(0, 25).map((r) => `${r.scenario} [${r.target}/${r.type}] ${r.url}`).join('\n')}`
    : '',
};
results.push(extResult);
console.log(`\n${extResult.status} ${extResult.id} — ${allRequests.length} requests recorded across ${selected.length} scenario(s), all same-origin${external.length ? ' — NO' : ''}`);
if (extResult.reason) console.log(indent(extResult.reason));

// Whole-run check 2: no console errors, uncaught exceptions or alert/confirm/prompt.
const errResult = {
  id: 'no-console-errors',
  status: allErrors.length ? 'FAIL' : 'PASS',
  reason: allErrors.length
    ? allErrors.slice(0, 30).map((e) => `${e.scenario} [${e.source}] ${e.kind} at step "${e.step}": ${String(e.text).split('\n').slice(0, 4).join(' | ')}`).join('\n')
    : '',
};
results.push(errResult);
console.log(`${errResult.status} ${errResult.id} — console errors, uncaught exceptions and alert/confirm/prompt across all scenarios`);
if (errResult.reason) console.log(indent(errResult.reason));

await server.close();
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - runStart) / 1000).toFixed(0)}s. Screenshots: ${SHOTS_DIR}`);
if (failed.length) console.log(`Failed: ${failed.map((r) => r.id).join(', ')}`);
process.exit(failed.length ? 1 : 0);
