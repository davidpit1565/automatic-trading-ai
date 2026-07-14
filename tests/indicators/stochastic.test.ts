import { describe, expect, it } from 'vitest';
import { stochastic } from '../../src/core/indicators';
import { candlesFromHlc } from '../helpers';

describe('stochastic', () => {
  it('matches a hand-computed %K (period 3)', () => {
    const candles = candlesFromHlc([
      [10, 8, 9],
      [11, 9, 10],
      [12, 10, 11], // window high 12, low 8: %K = (11-8)/(12-8)*100 = 75
      [12, 10, 10], // window high 12, low 9: %K = (10-9)/(12-9)*100 = 33.33
    ]);
    const { k } = stochastic(candles, 3, 2);
    expect(k.slice(0, 2)).toEqual([null, null]);
    expect(k[2]).toBeCloseTo(75, 10);
    expect(k[3]).toBeCloseTo(33.3333, 3);
  });

  it('%D is the SMA of %K', () => {
    const candles = candlesFromHlc([
      [10, 8, 9],
      [11, 9, 10],
      [12, 10, 11],
      [12, 10, 10],
    ]);
    const { k, d } = stochastic(candles, 3, 2);
    expect(d[2]).toBeNull(); // only one %K value so far
    expect(d[3]).toBeCloseTo((k[2]! + k[3]!) / 2, 10);
  });

  it('is 100 at the top of the range and 0 at the bottom', () => {
    const rising = candlesFromHlc([
      [10, 8, 9],
      [12, 10, 11],
      [14, 12, 14], // close at window high
    ]);
    expect(stochastic(rising, 3, 1).k[2]).toBeCloseTo(100, 10);

    const falling = candlesFromHlc([
      [14, 12, 13],
      [12, 10, 11],
      [10, 8, 8], // close at window low
    ]);
    expect(stochastic(falling, 3, 1).k[2]).toBeCloseTo(0, 10);
  });

  it('returns 50 for a completely flat window', () => {
    const flat = candlesFromHlc([
      [10, 10, 10],
      [10, 10, 10],
      [10, 10, 10],
    ]);
    expect(stochastic(flat, 3, 1).k[2]).toBe(50);
  });

  it('stays within [0, 100]', () => {
    const candles = candlesFromHlc(
      Array.from({ length: 80 }, (_, i): [number, number, number] => {
        const base = 100 + Math.sin(i * 0.9) * 12;
        return [base + 3, base - 3, base + Math.cos(i) * 2];
      }),
    );
    const { k, d } = stochastic(candles, 14, 3);
    for (const series of [k, d]) {
      for (const v of series) {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
