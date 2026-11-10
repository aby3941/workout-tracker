import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChart, barChart } from '../public/js/charts.js';

function assertSvg(out, label, { a11y = true } = {}) {
  assert.equal(typeof out, 'string', label);
  assert.ok(out.trimStart().startsWith('<svg'), `${label}: starts with <svg`);
  assert.ok(out.trimEnd().endsWith('</svg>'), `${label}: ends with </svg>`);
  assert.ok(!out.includes('NaN'), `${label}: no NaN`);
  if (a11y) {
    assert.match(out, /role="img"/, `${label}: role="img"`);
    assert.match(out, /aria-label="[^"]+"/, `${label}: non-empty aria-label`);
  }
}

const pts = (...pairs) => pairs.map(([x, y]) => ({ x, y }));

describe('lineChart', () => {
  test('two points: valid svg, DD/MM axis labels, last value labelled, CSS-variable colour', () => {
    const out = lineChart({ series: [{ label: 'Weight', points: pts(['2026-11-01', 100], ['2026-11-05', 102.5]) }], unit: 'kg' });
    assertSvg(out, 'two points');
    assert.match(out, /\b\d{2}\/\d{2}\b/, 'a DD/MM date label');
    assert.ok(out.includes('102.5'), 'last value labelled');
    assert.ok(out.includes('var(--c1)'), 'first series colour');
  });

  test('two series use --c1 and --c2', () => {
    const out = lineChart({
      series: [
        { label: 'Weight', points: pts(['2026-10-01', 80], ['2026-10-15', 85], ['2026-11-01', 90]) },
        { label: 'e1RM', points: pts(['2026-10-01', 93.3], ['2026-10-15', 99.2], ['2026-11-01', 105]) },
      ],
      width: 340,
      height: 180,
      unit: 'kg',
    });
    assertSvg(out, 'two series');
    assert.ok(out.includes('var(--c1)'));
    assert.ok(out.includes('var(--c2)'));
  });

  test('a single point is still valid', () => {
    assertSvg(lineChart({ series: [{ label: 'Weight', points: pts(['2026-11-10', 100]) }], unit: 'kg' }), 'single point');
  });

  test('flat values and same-day points produce no NaN', () => {
    assertSvg(lineChart({ series: [{ label: 'Weight', points: pts(['2026-11-01', 60], ['2026-11-03', 60], ['2026-11-05', 60]) }], unit: 'kg' }), 'flat');
    assertSvg(lineChart({ series: [{ label: 'Weight', points: pts(['2026-11-01', 60], ['2026-11-01', 62.5]) }], unit: 'kg' }), 'same day');
    assertSvg(lineChart({ series: [{ label: 'Weight', points: pts(['2026-11-01', 0], ['2026-11-03', 0]) }], unit: 'kg' }), 'all zero');
  });

  test('no data → svg with "No data yet"', () => {
    for (const [name, series] of [['no series', []], ['empty points', [{ label: 'Weight', points: [] }]]]) {
      const out = lineChart({ series, unit: 'kg' });
      assertSvg(out, name, { a11y: false });
      assert.ok(out.includes('No data yet'), name);
    }
  });

  test('labels are escaped', () => {
    const out = lineChart({ series: [{ label: '<script>alert(1)</script>', points: pts(['2026-11-01', 1], ['2026-11-02', 2]) }], unit: 'kg' });
    assert.ok(!out.includes('<script>'));
  });

  test('unsorted points: the aria-label "latest" is the value on the latest date, same as the drawn label (review fix)', () => {
    const out = lineChart({ series: [{ label: 'Weight', points: pts(['2026-11-10', 105], ['2026-11-01', 100]) }], unit: 'kg' });
    assertSvg(out, 'unsorted');
    assert.match(out, /aria-label="[^"]*latest 105 kg"/);
  });
});

describe('barChart', () => {
  test('bars: valid svg', () => {
    const out = barChart({ bars: [{ label: '02/11', value: 1500 }, { label: '09/11', value: 0 }, { label: '16/11', value: 200 }], width: 340, height: 180, unit: 'kg' });
    assertSvg(out, 'bars');
  });

  test('a single bar and all-zero bars produce no NaN', () => {
    assertSvg(barChart({ bars: [{ label: '02/11', value: 1500 }], width: 340, height: 180, unit: 'kg' }), 'single');
    assertSvg(barChart({ bars: [{ label: '02/11', value: 0 }, { label: '09/11', value: 0 }], width: 340, height: 180, unit: 'kg' }), 'zeros');
  });

  test('no bars → svg with "No data yet"', () => {
    const out = barChart({ bars: [], width: 340, height: 180, unit: 'kg' });
    assertSvg(out, 'empty', { a11y: false });
    assert.ok(out.includes('No data yet'));
  });

  test('labels are escaped', () => {
    const out = barChart({ bars: [{ label: '<img src=x onerror=alert(1)>', value: 5 }], width: 340, height: 180, unit: 'kg' });
    assert.ok(!out.includes('<img'));
  });
});
