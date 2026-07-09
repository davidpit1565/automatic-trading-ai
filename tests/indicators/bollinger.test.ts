import { describe, expect, it } from 'vitest';
import { bollinger } from '../../src/core/indicators';

describe('bollinger', () => {
  it('matches hand-computed bands (period 3, multiplier 2)', () => {
    // Window [1,2,3]: mean 2, population std = sqrt(2/3) ≈ 0.81650
    const { middle, upper, lower } = bollinger([1, 2, 3, 4, 5], 3, 2);
    expect(middle[2]).toBeCloseTo(2, 10);
    expect(upper[2]).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3), 5);
    expect(lower[2]).toBeCloseTo(2 - 2 * Math.sqrt(2 / 3), 5);
  });

  it('bands collapse onto the mean for a constant series', () => {
    const { middle, upper, lower, bandwidth } = bollinger(Array(10).fill(50), 5, 2);
    expect(upper[9]).toBeCloseTo(50, 10);
    expect(lower[9]).toBeCloseTo(50, 10);
    expect(middle[9]).toBeCloseTo(50, 10);
    expect(bandwidth[9]).toBeCloseTo(0, 10);
  });

  it('percentB is 0.5 when price sits on the middle band', () => {
    // Symmetric oscillation: last value equals the window mean.
    const { percentB } = bollinger([10, 12, 8, 12, 8, 10], 5, 2);
    // window [12,8,12,8,10]: mean 10, last price 10 -> %B = 0.5
    expect(percentB[5]).toBeCloseTo(0.5, 10);
  });

  it('percentB defaults to 0.5 when the bands collapse (zero width)', () => {
    const { percentB } = bollinger([5, 5, 5, 5], 3, 2);
    expect(percentB[3]).toBe(0.5);
  });

  it('bandwidth grows with volatility', () => {
    const calm = bollinger([100, 100.1, 99.9, 100.05, 99.95, 100], 5, 2);
    const wild = bollinger([100, 110, 90, 108, 92, 100], 5, 2);
    expect(wild.bandwidth[5]!).toBeGreaterThan(calm.bandwidth[5]!);
  });

  it('rejects a non-positive multiplier', () => {
    expect(() => bollinger([1, 2, 3], 2, 0)).toThrow(RangeError);
  });
});
