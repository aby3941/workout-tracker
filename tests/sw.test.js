// Housekeeping (SPEC.md §19.5, review 24/11/2026): the service worker precaches exactly the files the site serves, so
// an installed phone has every module offline (a module left out fails to load offline; one listed but missing makes
// the install fail and the phone keeps the old version).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');

/** Every file under public/ as "./a/b.js", without sw.js itself and dotfiles (.DS_Store is not deployed). */
function siteFiles(dir = PUBLIC, rel = '.') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.')) return [];
    const r = `${rel}/${d.name}`;
    return d.isDirectory() ? siteFiles(path.join(dir, d.name), r) : [r];
  }).filter((f) => f !== './sw.js');
}

test('PRECACHE lists every file of the site (and the "./" shell), nothing else, once each', () => {
  const block = /const PRECACHE = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(block, 'sw.js declares const PRECACHE = [ … ]');
  const listed = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.equal(new Set(listed).size, listed.length, 'no duplicates');
  assert.deepEqual([...listed].sort(), ['./', ...siteFiles()].sort());
});

test('the cache name is versioned ("ppl-vN")', () => {
  assert.match(/const CACHE = '([^']+)'/.exec(sw)?.[1] ?? '', /^ppl-v\d+$/);
});
