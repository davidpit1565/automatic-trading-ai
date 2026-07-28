import { describe, expect, it } from 'vitest';
import { calculateEMA, calculateMACD, candleChartSvg, priceChartSvg } from '../../src/ui/charts';

describe('calculateEMA', () => {
  it('returns undefined for every index when there is not enough history for the period', () => {
    // Root-caused bug: with fewer values than the period, the old implementation
    // averaged whatever was available and placed it at `period - 1` anyway — a
    // wrong value at an index past the end of the real data.
    const ema = calculateEMA([1, 2, 3], 20);
    expect(ema).toHaveLength(3);
    expect(ema.every((v) => v === undefined)).toBe(true);
  });

  it('computes the first defined value at exactly index period-1', () => {
    const values = [1, 2, 3, 4, 5];
    const ema = calculateEMA(values, 3);
    expect(ema[0]).toBeUndefined();
    expect(ema[1]).toBeUndefined();
    expect(ema[2]).toBeCloseTo(2, 10); // simple average of 1,2,3
    expect(ema[3]).toBeDefined();
    expect(ema[4]).toBeDefined();
  });

  it('never fabricates a value when values.length === period - 1 (one short)', () => {
    const ema = calculateEMA([1, 2, 3, 4], 5);
    expect(ema.every((v) => v === undefined)).toBe(true);
  });
});

describe('calculateMACD', () => {
  it('leaves histogram undefined until enough history has accumulated for both EMAs', () => {
    const values = Array.from({ length: 10 }, (_, i) => 100 + i);
    const macd = calculateMACD(values);
    expect(macd.histogram.every((h) => h === undefined)).toBe(true);
  });
});

function candles(n: number) {
  const start = 1_700_000_000_000 - n * 3_600_000;
  return Array.from({ length: n }, (_, i) => {
    const t = start + i * 3_600_000;
    const open = 100 + i * 0.1;
    const close = open + (i % 2 === 0 ? 0.5 : -0.5);
    return {
      timestamp: t,
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
      volume: 10 + i,
    };
  });
}

describe('candleChartSvg x-axis labels', () => {
  it('never emits a middle-anchored label at the left edge (would clip its leading character)', () => {
    const svg = candleChartSvg(candles(5), {
      formatX: (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }),
      formatY: (v) => `€${v.toFixed(2)}`,
    });
    // First label must anchor 'start' (grows rightward from the left pad),
    // never 'middle' (which would extend text past x=0, clipped by the viewBox).
    const firstLabelMatch = svg.match(/<text class="paxis pxlab"[^>]*>/);
    expect(firstLabelMatch?.[0]).toContain('text-anchor:start');
  });

  it('anchors the last label "end" so it never overlaps the price axis', () => {
    const svg = candleChartSvg(candles(150), {
      formatX: (t) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }),
      formatY: (v) => `€${v.toFixed(2)}`,
    });
    const labels = [...svg.matchAll(/<text class="paxis pxlab"[^>]*>/g)];
    expect(labels.at(-1)?.[0]).toContain('text-anchor:end');
  });
});

describe('candleChartSvg EMA rendering', () => {
  it('draws no EMA20 path when there are fewer than 20 candles', () => {
    const svg = candleChartSvg(candles(15), {
      formatX: (t) => String(t),
      formatY: (v) => String(v),
    });
    expect(svg).not.toContain('pema20');
  });

  it('draws a visible EMA20 path once there are at least 20 candles', () => {
    const svg = candleChartSvg(candles(25), {
      formatX: (t) => String(t),
      formatY: (v) => String(v),
    });
    expect(svg).toContain('pema20');
    // A single-point path (only "M x y", no "L") would be invisible; make sure
    // there's at least one line-to segment.
    const path = svg.match(/class="pema pema20".*?\bd="([^"]+)"/)?.[1] ?? '';
    expect(path).toContain('L');
  });
});

describe('candleChartSvg misleading overlays removed', () => {
  it('does not render fake RSI bands or unrendered MACD bars', () => {
    const svg = candleChartSvg(candles(60), {
      formatX: (t) => String(t),
      formatY: (v) => String(v),
    });
    expect(svg).not.toContain('pmacd-bar');
  });
});

describe('priceChartSvg x-axis labels', () => {
  it('anchors the first label to start, not middle', () => {
    const points = Array.from({ length: 5 }, (_, i) => ({ timestamp: i, value: 100 + i }));
    const svg = priceChartSvg(points, { stroke: '#16c784', formatX: (t) => String(t), formatY: (v) => String(v) });
    const firstLabelMatch = svg.match(/<text class="paxis pxlab"[^>]*>/);
    expect(firstLabelMatch?.[0]).toContain('text-anchor:start');
  });
});
