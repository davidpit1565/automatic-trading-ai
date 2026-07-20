import { describe, expect, it } from 'vitest';
import { buildCorrelationMatrix, pearsonCorrelation, returnsOf } from '../../src/core/risk/correlation';
import type { Candle } from '../../src/core/types';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    timestamp: T0 + i * HOUR,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }));
}

describe('returnsOf', () => {
  it('computes percent returns between consecutive closes', () => {
    const returns = returnsOf(candlesFromCloses([100, 110, 99]));
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.1, 10);
    expect(returns[1]).toBeCloseTo(-0.1, 10);
  });
});

describe('pearsonCorrelation', () => {
  it('is 1 for identical series', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 10);
  });

  it('is -1 for perfectly inverted series', () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it('is 0 for a constant (zero-variance) series, never NaN', () => {
    expect(pearsonCorrelation([1, 2, 3], [5, 5, 5])).toBe(0);
  });

  it('is 0 for fewer than 2 points', () => {
    expect(pearsonCorrelation([1], [2])).toBe(0);
    expect(pearsonCorrelation([], [])).toBe(0);
  });
});

describe('buildCorrelationMatrix', () => {
  it('reports 1 for a symbol against itself and is symmetric', () => {
    const closesA = [100, 110, 121, 133.1];
    const matrix = buildCorrelationMatrix(
      new Map([
        ['A', candlesFromCloses(closesA)],
        ['B', candlesFromCloses(closesA.map((c) => c * 2))], // scaled copy — identical % returns
      ]),
    );
    expect(matrix('A', 'A')).toBe(1);
    expect(matrix('A', 'B')).toBeCloseTo(1, 6);
    expect(matrix('B', 'A')).toBeCloseTo(matrix('A', 'B'), 10);
  });

  it('returns 0 (fails open) for a symbol missing from the input', () => {
    const matrix = buildCorrelationMatrix(new Map([['A', candlesFromCloses([100, 110, 121])]]));
    expect(matrix('A', 'UNKNOWN')).toBe(0);
  });
});
