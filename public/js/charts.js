// SVG chart builders in the approved design (pure: they return markup strings).
// Colours come from CSS variables (--c1 weight blue, --c2 e1RM / reps orange, --grid, --axis, --muted, --ink-2,
// --surface), so light and dark themes both work. Text never uses a series colour.
// Every chart carries data-xs / data-top / data-bottom so ui/chart-ui.js can add the crosshair and tooltip.

import { dayIndex, formatDateShort } from './dates.js';
import { formatNumber, cleanNumber } from './units.js';
import { escapeHtml } from './html.js';

const COLOURS = ['var(--c1)', 'var(--c2)', 'var(--c3)'];
const DOT_R = 4;
/** Points closer than this (px) are "dense": dots would overlap and their surface rings hide the line. */
const DENSE_GAP = DOT_R * 2 + 2;

/**
 * Radius of each dot: all DOT_R, unless the dates are so close that dots overlap — then only the latest
 * point keeps its dot (the others stay in the markup at r=0 so the crosshair can still grow them).
 * @param {number[]} xs x of every date index, ascending
 * @returns {(i: number) => number}
 */
function dotRadius(xs) {
  const dense = xs.some((x, i) => i > 0 && x - xs[i - 1] < DENSE_GAP);
  return (i) => (!dense || i === xs.length - 1 ? DOT_R : 0);
}

/** A data point's dot; `data-r` is its resting radius (chart-ui.js restores it after a hover). */
const dot = (i, cx, cy, r, colour) => `<circle class="dot" data-i="${i}" data-r="${r}" cx="${f(cx)}" cy="${f(cy)}" r="${r}" `
  + `style="fill:${colour};stroke:var(--surface)" stroke-width="2"/>`;

/** Coordinate to 1 decimal, never NaN. */
const f = (n) => (Number.isFinite(n) ? String(cleanNumber(Math.round(n * 10) / 10)) : '0');

/** Opening <svg> with a11y attributes and the crosshair metadata. */
function svgOpen(width, height, label, meta = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="chart" viewBox="0 0 ${width} ${height}" width="100%" `
    + `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(label)}"${meta}>`;
}

/** Crosshair metadata attributes: x of every index, and the plot's top/bottom. */
function metaAttrs(xs, top, bottom) {
  return ` data-xs="${xs.map(f).join(',')}" data-top="${f(top)}" data-bottom="${f(bottom)}"`;
}

/** The empty-state chart. */
function emptyChart(width, height) {
  return `${svgOpen(width, height, 'No data yet')}<text x="${f(width / 2)}" y="${f(height / 2)}" text-anchor="middle" `
    + `dominant-baseline="middle" style="fill:var(--muted);font-size:13px">No data yet</text></svg>`;
}

/** 1, 2, 2.5, 5 or 10 × a power of ten, at least x. */
function niceNum(x) {
  const e = Math.floor(Math.log10(x));
  const m = x / 10 ** e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * 10 ** e;
}

/** "Nice" ticks covering [min, max] with about `count` lines; never below 0 for non-negative data. */
function niceTicks(min, max, count = 4) {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 0;
  if (lo === hi) { lo -= 5; hi += 5; }
  if (lo < 0 && min >= 0) lo = 0;
  const step = niceNum((hi - lo) / Math.max(1, count - 1));
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2 && ticks.length < 12; v += step) ticks.push(cleanNumber(v));
  return ticks.length >= 2 ? ticks : [cleanNumber(start), cleanNumber(start + step)];
}

/** Compact axis number: 1500 → "1.5K", 12000 → "12K". */
function compactNumber(v) {
  if (Math.abs(v) >= 1000) return `${formatNumber(Math.round(v / 100) / 10)}K`;
  return formatNumber(v);
}

/** Hairline gridlines + y labels (the bottom line uses the axis colour). */
function yAxis(ticks, Y, x0, x1, fmt) {
  return ticks.map((t, i) => `<line x1="${f(x0)}" x2="${f(x1)}" y1="${f(Y(t))}" y2="${f(Y(t))}" `
    + `style="stroke:var(${i === 0 ? '--axis' : '--grid'})" stroke-width="1" shape-rendering="crispEdges"/>`
    + `<text x="${f(x0 - 6)}" y="${f(Y(t) + 3.5)}" text-anchor="end" class="tick" `
    + `style="fill:var(--muted);font-size:10.5px">${escapeHtml(fmt(t))}</text>`).join('');
}

/** Date labels under the plot: first, middle and last (DD/MM). */
function xLabels(dates, X, y) {
  if (!dates.length) return '';
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (dates.length === 1) {
    return `<text x="${f(X(first))}" y="${f(y)}" text-anchor="middle" style="fill:var(--muted);font-size:10.5px">${escapeHtml(formatDateShort(first))}</text>`;
  }
  const picks = [[first, 'start'], [last, 'end']];
  if (dayIndex(last) - dayIndex(first) >= 14 && dates.length > 2) {
    const mid = (dayIndex(first) + dayIndex(last)) / 2;
    const middle = dates.reduce((best, d) => (Math.abs(dayIndex(d) - mid) < Math.abs(dayIndex(best) - mid) ? d : best), dates[1]);
    if (middle !== first && middle !== last) picks.splice(1, 0, [middle, 'middle']);
  }
  return picks.map(([d, anchor]) => `<text x="${f(X(d))}" y="${f(y)}" text-anchor="${anchor}" `
    + `style="fill:var(--muted);font-size:10.5px">${escapeHtml(formatDateShort(d))}</text>`).join('');
}

/** Time scale over unique sorted ISO dates; one date → the middle. */
function timeScale(dates, x0, x1) {
  const lo = dayIndex(dates[0]);
  const hi = dayIndex(dates[dates.length - 1]);
  return (iso) => (hi === lo ? (x0 + x1) / 2 : x0 + ((dayIndex(iso) - lo) / (hi - lo)) * (x1 - x0));
}

/** Path through points. */
const pathD = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join('');

/** A bar with rounded top corners (radius r) from `base` up to `y`. */
function barPath(x, y, w, base, r) {
  const rr = Math.max(0, Math.min(r, w / 2, (base - y) / 2));
  return `M${f(x)},${f(base)}L${f(x)},${f(y + rr)}Q${f(x)},${f(y)} ${f(x + rr)},${f(y)}`
    + `L${f(x + w - rr)},${f(y)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + rr)}L${f(x + w)},${f(base)}Z`;
}

/** Unique dates sorted by calendar day. */
const uniqueDates = (points) => [...new Set(points.map((p) => p.x))].sort((a, b) => dayIndex(a) - dayIndex(b));

/**
 * Time-scaled line chart (e.g. working weight + estimated 1-rep max on one axis). 2px lines, 8px dots with a
 * surface ring, the last value of each series labelled, optional vertical annotations ({x, label}).
 * @param {{series?: Array<{label: string, points: Array<{x: string, y: number}>}>, width?: number, height?: number,
 *   unit?: string, label?: string, annotations?: Array<{x: string, label: string}>}} opts
 * @returns {string} SVG markup
 */
export function lineChart({ series = [], width = 340, height = 180, unit = '', label = '', annotations = [] } = {}) {
  const byDate = (a, b) => dayIndex(a.x) - dayIndex(b.x);
  const live = (series || []).map((s, i) => ({
    ...s,
    colour: COLOURS[i % COLOURS.length],
    points: (s.points || []).filter((p) => Number.isFinite(p.y) && p.x).sort(byDate), // filter() made a copy
  })).filter((s) => s.points.length);
  if (!live.length) return emptyChart(width, height);

  const notes = (annotations || []).filter((a) => a && a.x);
  const m = { l: 34, r: 40, t: notes.length ? 24 : 14, b: 22 };
  const all = live.flatMap((s) => s.points);
  const dates = uniqueDates(all);
  const ticks = niceTicks(Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y)), 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const plotBottom = height - m.b;
  const X = timeScale(dates, m.l, width - m.r);
  const Y = (v) => plotBottom - ((v - yMin) / (yMax - yMin || 1)) * (plotBottom - m.t);

  const parts = [yAxis(ticks, Y, m.l, width - m.r, formatNumber), xLabels(dates, X, height - 5)];
  for (const a of notes) {
    const x = X(a.x);
    const nearLeft = x - m.l < 70;
    parts.push(`<line x1="${f(x)}" x2="${f(x)}" y1="${f(m.t - 12)}" y2="${f(plotBottom)}" style="stroke:var(--axis)" stroke-width="1"/>`);
    parts.push(`<text x="${f(nearLeft ? x + 5 : x - 5)}" y="${f(m.t - 9)}" text-anchor="${nearLeft ? 'start' : 'end'}" `
      + `style="fill:var(--ink-2);font-size:10.5px">${escapeHtml(a.label)}</text>`);
  }

  for (const s of live) {
    parts.push(`<path d="${pathD(s.points.map((p) => [X(p.x), Y(p.y)]))}" fill="none" style="stroke:${s.colour}" `
      + `stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  const lastLabels = [];
  const index = new Map(dates.map((d, i) => [d, i]));
  const radius = dotRadius(dates.map(X));
  for (const s of live) {
    for (const p of s.points) {
      const i = index.get(p.x);
      parts.push(dot(i, X(p.x), Y(p.y), radius(i), s.colour));
    }
    const last = s.points[s.points.length - 1];
    let ly = Y(last.y) + 4;
    for (const prev of lastLabels) if (Math.abs(prev - ly) < 12) ly = prev + (ly >= prev ? 12 : -12);
    lastLabels.push(ly);
    parts.push(`<text x="${f(X(last.x) + 8)}" y="${f(ly)}" style="fill:var(--ink-2);font-size:11px;font-weight:600">`
      + `${escapeHtml(formatNumber(last.y))}</text>`);
  }

  const desc = live.map((s) => {
    const last = s.points[s.points.length - 1];
    return `${s.label}: ${s.points.length} point${s.points.length === 1 ? '' : 's'}, latest ${formatNumber(last.y)}${unit ? ' ' + unit : ''}`;
  }).join('; ');
  return `${svgOpen(width, height, `${label || 'Line chart'}. ${desc}`, metaAttrs(dates.map(X), m.t, plotBottom))}${parts.join('')}</svg>`;
}

/**
 * Bar chart (e.g. weekly volume): bars up to 24px wide with 4px rounded tops, the last value labelled.
 * @param {{bars?: Array<{label: string, value: number}>, width?: number, height?: number, unit?: string, label?: string}} opts
 * @returns {string} SVG markup
 */
export function barChart({ bars = [], width = 340, height = 140, unit = '', label = '' } = {}) {
  const list = (bars || []).map((b) => ({ label: String(b.label ?? ''), value: Number.isFinite(b.value) ? Math.max(0, b.value) : 0 }));
  if (!list.length) return emptyChart(width, height);

  const m = { l: 34, r: 8, t: 16, b: 22 };
  const maxV = Math.max(0, ...list.map((b) => b.value));
  const ticks = niceTicks(0, maxV > 0 ? maxV : 1, 3);
  const top = ticks[ticks.length - 1] || 1;
  const base = height - m.b;
  const Y = (v) => base - (v / top) * (base - m.t);
  const band = (width - m.l - m.r) / list.length;
  const bw = Math.max(1, Math.min(24, band * 0.62)); // years of weeks: thin bars that never merge
  const step = Math.max(1, Math.ceil(list.length / 5));

  const parts = [yAxis(ticks, Y, m.l, width - m.r, compactNumber)];
  const xs = [];
  list.forEach((b, i) => {
    const cx = m.l + band * i + band / 2;
    xs.push(cx);
    if (b.value > 0) parts.push(`<path class="bar" data-i="${i}" d="${barPath(cx - bw / 2, Y(b.value), bw, base, 4)}" style="fill:var(--c1)"/>`);
    if ((list.length - 1 - i) % step === 0) {
      parts.push(`<text x="${f(cx)}" y="${f(height - 5)}" text-anchor="middle" style="fill:var(--muted);font-size:10.5px">${escapeHtml(b.label)}</text>`);
    }
  });
  const last = list[list.length - 1];
  parts.push(`<text x="${f(xs[xs.length - 1])}" y="${f(Y(last.value) - 5)}" text-anchor="middle" `
    + `style="fill:var(--ink-2);font-size:11px;font-weight:600">${escapeHtml(compactNumber(last.value))}</text>`);
  const desc = `${list.length} bar${list.length === 1 ? '' : 's'}, highest ${formatNumber(maxV)}${unit ? ' ' + unit : ''}`;
  return `${svgOpen(width, height, `${label || 'Bar chart'}: ${desc}`, metaAttrs(xs, m.t, base))}${parts.join('')}</svg>`;
}

/**
 * Accessory chart: weight (top panel, line) and total reps per session (bottom panel, bars) on one date axis,
 * with an optional "time to add weight" target line on the reps panel.
 * @param {{points?: Array<{x: string, weight: number, total: number}>, target?: number|null, targetText?: string,
 *   width?: number, compact?: boolean, unit?: string, label?: string}} opts
 * @returns {string} SVG markup
 */
export function accessoryChart({ points = [], target = null, targetText = '', width = 336, compact = false, unit = 'kg', label = '' } = {}) {
  const height = compact ? 204 : 250;
  const pts = (points || []).filter((p) => p && p.x && Number.isFinite(p.weight) && Number.isFinite(p.total))
    .sort((a, b) => dayIndex(a.x) - dayIndex(b.x));
  if (!pts.length) return emptyChart(width, height);

  const m = { l: 34, r: 40 };
  const top = compact ? { t: 20, b: 84 } : { t: 22, b: 118 };
  const bot = compact ? { t: 126, b: 180 } : { t: 152, b: 226 };
  const dates = uniqueDates(pts);
  const X = timeScale(dates, m.l + 6, width - m.r - 6);
  const parts = [];

  // Panel 1: weight.
  parts.push(`<text x="0" y="${f(top.t - 12)}" style="fill:var(--ink-2);font-size:11px;font-weight:600">Weight (${escapeHtml(unit)})</text>`);
  const wt = niceTicks(Math.min(...pts.map((p) => p.weight)), Math.max(...pts.map((p) => p.weight)), 3);
  const YW = (v) => top.b - ((v - wt[0]) / (wt[wt.length - 1] - wt[0] || 1)) * (top.b - top.t);
  parts.push(yAxis(wt, YW, m.l, width - m.r, formatNumber));
  parts.push(`<path d="${pathD(pts.map((p) => [X(p.x), YW(p.weight)]))}" fill="none" style="stroke:var(--c1)" `
    + `stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
  const index = new Map(dates.map((d, i) => [d, i]));
  const radius = dotRadius(dates.map(X));
  for (const p of pts) {
    const i = index.get(p.x);
    parts.push(dot(i, X(p.x), YW(p.weight), radius(i), 'var(--c1)'));
  }
  const last = pts[pts.length - 1];
  parts.push(`<text x="${f(X(last.x) + 8)}" y="${f(YW(last.weight) + 4)}" style="fill:var(--ink-2);font-size:11px;font-weight:600">`
    + `${escapeHtml(formatNumber(last.weight))}</text>`);

  // Panel 2: total reps with the target line.
  const hasTarget = Number.isFinite(target) && target > 0;
  parts.push(`<text x="0" y="${f(bot.t - 14)}" style="fill:var(--ink-2);font-size:11px;font-weight:600">Total reps</text>`);
  const rt = niceTicks(0, Math.max(1, hasTarget ? target : 0, ...pts.map((p) => p.total)), 4);
  const rTop = rt[rt.length - 1] || 1;
  const YR = (v) => bot.b - (v / rTop) * (bot.b - bot.t);
  parts.push(yAxis(rt, YR, m.l, width - m.r, formatNumber));
  const xs = dates.map(X);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]).filter((g) => g > 0);
  const band = gaps.length ? Math.min(...gaps) : 40;
  const bw = Math.max(1, Math.min(12, band * 0.55)); // thin bars when sessions are close, so they never merge
  for (const p of pts) {
    if (p.total > 0) parts.push(`<path class="bar" data-i="${index.get(p.x)}" d="${barPath(X(p.x) - bw / 2, YR(p.total), bw, YR(0), 3)}" style="fill:var(--c2)"/>`);
  }
  if (hasTarget) {
    parts.push(`<line x1="${f(m.l)}" x2="${f(width - m.r)}" y1="${f(YR(target))}" y2="${f(YR(target))}" style="stroke:var(--ink-2)" stroke-width="1"/>`);
    parts.push(`<text x="${f(width - m.r + 4)}" y="${f(YR(target) + 4)}" style="fill:var(--ink-2);font-size:10.5px">${escapeHtml(formatNumber(target))}</text>`);
    if (targetText) {
      parts.push(`<text x="${f(width - m.r)}" y="${f(bot.t - 14)}" text-anchor="end" style="fill:var(--muted);font-size:10.5px">${escapeHtml(targetText)}</text>`);
    }
  }
  parts.push(xLabels(dates, X, height - 5));

  const desc = `${pts.length} session${pts.length === 1 ? '' : 's'}, latest ${formatNumber(last.weight)} ${unit} for ${formatNumber(last.total)} total reps`;
  return `${svgOpen(width, height, `${label || 'Weight and total reps per session'}. ${desc}`, metaAttrs(xs, top.t, bot.b))}${parts.join('')}</svg>`;
}

/**
 * Tiny decorative trend line (aria-hidden): muted line, the latest point as a blue dot.
 * @param {number[]} values
 * @param {{width?: number, height?: number}} [opts]
 * @returns {string} SVG markup ('' for no values)
 */
export function sparkline(values, { width = 64, height = 24 } = {}) {
  const vals = (values || []).filter(Number.isFinite);
  if (!vals.length) return '';
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const X = (i) => (vals.length === 1 ? width / 2 : 3 + (i / (vals.length - 1)) * (width - 8));
  const Y = (v) => (hi === lo ? height / 2 : height - 4 - ((v - lo) / (hi - lo)) * (height - 8));
  const i = vals.length - 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">`
    + `<path d="${pathD(vals.map((v, k) => [X(k), Y(v)]))}" fill="none" style="stroke:var(--muted)" stroke-width="1.5" stroke-linejoin="round"/>`
    + `<circle cx="${f(X(i))}" cy="${f(Y(vals[i]))}" r="3" style="fill:var(--c1);stroke:var(--surface)" stroke-width="1.5"/></svg>`;
}
