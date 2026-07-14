import { describe, expect, it } from 'vitest';
import { ema, lastValue, sma } from '../../src/core/indicators';

describe('sma', () => {
  it('computes the rolling mean with null warm-up', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('period 1 returns the input values', () => {
    expect(sma([5, 7, 9], 1)).toEqual([5, 7, 9]);
  });

  it('returns all nulls when the series is shorter than the period', () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });

  it('handles an empty series', () => {
    expect(sma([], 3)).toEqual([]);
  });

  it('is numerically stable over long series (rolling sum drift)', () => {
    const values = Array.from({ length: 10_000 }, (_, i) => 100 + Math.sin(i) * 0.01);
    const out = sma(values, 50);
    const last = out[out.length - 1];
    // Direct mean of the final window for comparison.
    const window = values.slice(-50);
    const direct = window.reduce((a, b) => a + b, 0) / 50;
    expect(last).toBeCloseTo(direct, 8);
  });

  it('rejects invalid periods', () => {
    expect(() => sma([1, 2, 3], 0)).toThrow(RangeError);
    expect(() => sma([1, 2, 3], 2.5)).toThrow(RangeError);
    expect(() => sma([1, 2, 3], -1)).toThrow(RangeError);
  });
});

describe('ema', () => {
  it('seeds with SMA and applies k = 2/(period+1)', () => {
    // period 3, k = 0.5; seed at index 2 = mean(1,2,3) = 2.
    const out = ema([1, 2, 3, 4, 5, 6], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBeCloseTo(2, 12);
    expect(out[3]).toBeCloseTo(3, 12); // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4, 12); // 5*0.5 + 3*0.5
    expect(out[5]).toBeCloseTo(5, 12);
  });

  it('equals the constant for a constant series', () => {
    const out = ema([7, 7, 7, 7, 7], 2);
    expect(out.slice(1)).toEqual([7, 7, 7, 7]);
  });

  it('reacts faster than SMA to a step change', () => {
    const values = [...Array(20).fill(100), ...Array(5).fill(110)];
    const emaOut = ema(values, 10);
    const smaOut = sma(values, 10);
    const last = values.length - 1;
    expect(emaOut[last]!).toBeGreaterThan(smaOut[last]!);
  });

  it('returns all nulls when shorter than period', () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });

  it('rejects invalid periods', () => {
    expect(() => ema([1, 2, 3], 0)).toThrow(RangeError);
  });
});

describe('lastValue', () => {
  it('returns the last non-null entry', () => {
    expect(lastValue([null, 1, 2, null])).toBe(2);
  });

  it('returns null for all-null or empty series', () => {
    expect(lastValue([null, null])).toBeNull();
    expect(lastValue([])).toBeNull();
  });
});
