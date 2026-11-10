// Generate the app icons (not deployed): a white dumbbell on the --s1 blue, rasterised with headless Chrome.
// Usage (from the project root): node tools/make-icons.mjs [path-to-chrome]
// Writes public/icons/apple-touch-icon.png (180, opaque), icon-192.png and icon-512.png (maskable: the glyph
// stays inside the central safe zone).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.argv[2] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BLUE = '#2a78d6'; // --s1 (light)
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <rect width="512" height="512" fill="${BLUE}"/>
  <g fill="#fff">
    <rect x="104" y="196" width="36" height="120" rx="12"/>
    <rect x="146" y="156" width="44" height="200" rx="14"/>
    <rect x="186" y="238" width="140" height="36" rx="8"/>
    <rect x="322" y="156" width="44" height="200" rx="14"/>
    <rect x="372" y="196" width="36" height="120" rx="12"/>
  </g>
</svg>`;

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;background:${BLUE}}svg{display:block}
</style></head><body>${SVG}</body></html>`;

const work = mkdtempSync(join(tmpdir(), 'ppl-icons-'));
const file = join(work, 'icon.html');
writeFileSync(file, page);
mkdirSync(out, { recursive: true });

for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${join(work, 'profile')}`, `--window-size=${size},${size}`,
    `--screenshot=${join(out, name)}`, `file://${file}`,
  ], { stdio: 'ignore' });
  console.log(`wrote public/icons/${name} (${size}×${size})`);
}
rmSync(work, { recursive: true, force: true });
