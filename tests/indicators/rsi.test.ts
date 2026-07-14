import { describe, expect, it } from 'vitest';
import { rsi } from '../../src/core/indicators';

describe('rsi', () => {
  it('matches a hand-computed Wilder example (period 3)', () => {
    // closes: 10, 11, 12, 11, 12 -> changes: +1, +1, -1, +1
    // index 3: avgGain = 2/3, avgLoss = 1/3, RS = 2, RSI = 66.667
    // index 4: avgGain = (2/3*2 + 1)/3 = 7/9, avgLoss = (1/3*2)/3 = 2/9
    //          RS = 3.5, RSI = 77.778
    const out = rsi([10, 11, 12, 11, 12], 3);
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    expect(out[3]).toBeCloseTo(66.6667, 3);
    expect(out[4]).toBeCloseTo(77.7778, 3);
  });

  it('is 100 for monotonically rising prices', () => {
    const out = rsi([1, 2, 3, 4, 5, 6, 7, 8], 3);
    expect(out[7]).toBe(100);
  });

  it('is 0 for monotonically falling prices', () => {
    const out = rsi([8, 7, 6, 5, 4, 3, 2, 1], 3);
    expect(out[7]).toBe(0);
  });

  it('is 50 for a perfectly flat series', () => {
    const out = rsi([5, 5, 5, 5, 5], 3);
    expect(out[4]).toBe(50);
  });

  it('stays within [0, 100]', () => {
    const values = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i * 0.7) * 10);
    for (const v of rsi(values, 14)) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('needs period + 1 values before producing output', () => {
    expect(rsi([1, 2, 3], 3)).toEqual([null, null, null]);
    const out = rsi([1, 2, 3, 4], 3);
    expect(out[3]).not.toBeNull();
  });

  it('rejects invalid periods', () => {
    expect(() => rsi([1, 2, 3], 0)).toThrow(RangeError);
  });
});
