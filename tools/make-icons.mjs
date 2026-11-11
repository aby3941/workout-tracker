// Generate the app icons (not deployed): option A, a bold tilted white dumbbell on the --s1 blue.
// Usage (from the project root): node tools/make-icons.mjs [path-to-chrome]
// Writes, into public/:
//   icons/apple-touch-icon.png (180, opaque), icons/icon-192.png, icons/icon-512.png (maskable: the glyph stays
//   inside the central safe zone), icons/icon.svg (vector tab icon) and favicon.ico (16 + 32 px tab icon).
// Both images are rendered large with headless Chrome, then scaled down with macOS `sips`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.argv[2] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BLUE = '#2a78d6'; // --s1 (light)
const BLUE_LIGHT = '#3987e5'; // --s1 (dark)
const BLUE_DEEP = '#1c5cab'; // sequential step 550
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const icons = join(pub, 'icons');

// Home-screen icon: full-bleed square (iOS and Android apply their own rounded mask).
const APP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BLUE_LIGHT}"/><stop offset="1" stop-color="${BLUE_DEEP}"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g transform="rotate(-45 256 256)" fill="#fff">
    <rect x="88" y="186" width="44" height="140" rx="16"/>
    <rect x="136" y="146" width="62" height="220" rx="20"/>
    <rect x="192" y="232" width="128" height="48" rx="14"/>
    <rect x="314" y="146" width="62" height="220" rx="20"/>
    <rect x="380" y="186" width="44" height="140" rx="16"/>
  </g>
</svg>`;

// Browser-tab icon: a rounded tile (transparent corners) with a simplified, thicker dumbbell for 16–32 px.
const TAB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="${BLUE}"/>
  <g transform="rotate(-45 16 16)" fill="#fff">
    <rect x="5" y="11" width="4" height="10" rx="1.5"/>
    <rect x="9" y="8.5" width="5" height="15" rx="2"/>
    <rect x="13" y="14" width="6" height="4" rx="1"/>
    <rect x="18" y="8.5" width="5" height="15" rx="2"/>
    <rect x="23" y="11" width="4" height="10" rx="1.5"/>
  </g>
</svg>`;

const RENDER = 1024; // render size before scaling down
const work = mkdtempSync(join(tmpdir(), 'ppl-icons-'));
mkdirSync(icons, { recursive: true });

/** Render an SVG to a square PNG at RENDER px with headless Chrome (transparent outside the SVG's own fill). */
function render(svg, name) {
  const html = join(work, `${name}.html`);
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block;width:${RENDER}px;height:${RENDER}px}
</style></head><body>${svg}</body></html>`);
  const png = join(work, `${name}.png`);
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--user-data-dir=${join(work, 'profile')}`,
    `--window-size=${RENDER},${RENDER}`, `--screenshot=${png}`, `file://${html}`,
  ], { stdio: 'ignore' });
  return png;
}

/** Scale a PNG to size×size with sips. */
function scale(src, size, dest) {
  execFileSync('sips', ['-z', String(size), String(size), src, '--out', dest], { stdio: 'ignore' });
}

/** Write an .ico that holds PNG images (supported by every current browser). */
function writeIco(dest, pngs) {
  const datas = pngs.map(({ file }) => readFileSync(file));
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(datas[i].length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += datas[i].length;
  });
  writeFileSync(dest, Buffer.concat([header, ...datas]));
}

const app = render(APP_SVG, 'app');
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  scale(app, size, join(icons, name));
  console.log(`wrote public/icons/${name} (${size}×${size})`);
}

const tab = render(TAB_SVG, 'tab');
const tab16 = join(work, 'tab-16.png');
const tab32 = join(work, 'tab-32.png');
scale(tab, 16, tab16);
scale(tab, 32, tab32);
writeIco(join(pub, 'favicon.ico'), [{ size: 16, file: tab16 }, { size: 32, file: tab32 }]);
console.log('wrote public/favicon.ico (16 + 32 px)');
writeFileSync(join(icons, 'icon.svg'), `${TAB_SVG}\n`);
console.log('wrote public/icons/icon.svg');

rmSync(work, { recursive: true, force: true });
