// Crosshair, tooltip and keyboard layer for the SVG charts from charts.js.
// A chart's data-xs lists the x of every point index; hover, touch-drag or arrow keys pick the nearest index,
// the matching dots grow, bars dim except the picked one, and a tooltip shows the rows for that index.

const SVGNS = 'http://www.w3.org/2000/svg';

/**
 * Make a chart interactive.
 * @param {SVGSVGElement} svg a chart produced by charts.js, already in the document
 * @param {{host: HTMLElement, title: (i: number) => string,
 *   rows: (i: number) => Array<{colour: string, value: string, name: string}>, crosshair?: boolean}} opts
 *   `host` is the positioned card the tooltip is placed in.
 */
export function attachChart(svg, { host, title, rows, crosshair = true }) {
  const xs = String(svg.dataset.xs || '').split(',').filter((v) => v !== '').map(Number);
  if (!xs.length || !host) return;
  const width = svg.viewBox.baseVal.width || 1;
  const top = Number(svg.dataset.top) || 0;
  const bottom = Number(svg.dataset.bottom) || 0;

  let line = null;
  if (crosshair) {
    line = document.createElementNS(SVGNS, 'line');
    for (const [k, v] of Object.entries({ y1: top, y2: bottom, 'stroke-width': 1, opacity: 0 })) line.setAttribute(k, String(v));
    line.style.stroke = 'var(--ink-2)';
    line.classList.add('crosshair');
    svg.insertBefore(line, svg.querySelector('.dot, .bar'));
  }
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('aria-hidden', 'true');
  host.append(tip);
  const dots = [...svg.querySelectorAll('.dot')];
  const bars = [...svg.querySelectorAll('.bar')];
  let index = -1;

  function show(i) {
    index = i;
    if (line) {
      line.setAttribute('x1', String(xs[i]));
      line.setAttribute('x2', String(xs[i]));
      line.setAttribute('opacity', '1');
    }
    for (const d of dots) d.setAttribute('r', Number(d.dataset.i) === i ? '5.5' : (d.dataset.r || '4'));
    for (const b of bars) b.style.opacity = Number(b.dataset.i) === i ? '1' : '0.55';
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 't-date';
    head.textContent = title(i);
    tip.append(head);
    for (const r of rows(i)) {
      const row = document.createElement('div');
      row.className = 't-row';
      const key = document.createElement('span');
      key.className = 'key';
      key.style.background = r.colour;
      const value = document.createElement('span');
      value.className = 't-v';
      value.textContent = r.value;
      const name = document.createElement('span');
      name.className = 't-n';
      name.textContent = r.name;
      row.append(key, value, name);
      tip.append(row);
    }
    tip.style.display = 'block';
    const box = svg.getBoundingClientRect();
    const hb = host.getBoundingClientRect();
    const px = box.left - hb.left + (xs[i] / width) * box.width;
    const left = px + 12 + tip.offsetWidth > hb.width - 6 ? px - 12 - tip.offsetWidth : px + 12;
    tip.style.left = `${Math.max(6, left)}px`;
    tip.style.top = `${box.top - hb.top + 4}px`;
  }

  function hide() {
    index = -1;
    if (line) line.setAttribute('opacity', '0');
    for (const d of dots) d.setAttribute('r', d.dataset.r || '4');
    for (const b of bars) b.style.opacity = '';
    tip.style.display = 'none';
  }

  function nearest(clientX) {
    const box = svg.getBoundingClientRect();
    const vx = ((clientX - box.left) / (box.width || 1)) * width;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - vx) < Math.abs(xs[best] - vx)) best = i; });
    return best;
  }

  svg.setAttribute('tabindex', '0');
  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hide(); });
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    if (e.key === 'Escape') { hide(); return; }
    if (!(e.key in moves)) return;
    e.preventDefault();
    const from = index < 0 ? xs.length - 1 : index;
    const step = moves[e.key];
    show(Math.min(xs.length - 1, Math.max(0, Number.isFinite(step) ? from + (index < 0 ? 0 : step) : (step < 0 ? 0 : xs.length - 1))));
  });
  // A tap elsewhere hides a tooltip opened by touch.
  const outside = (e) => {
    if (!svg.isConnected) { document.removeEventListener('pointerdown', outside, true); return; }
    if (index >= 0 && !svg.contains(e.target)) hide();
  };
  document.addEventListener('pointerdown', outside, true);
}
