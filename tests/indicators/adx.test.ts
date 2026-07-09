import { describe, expect, it } from 'vitest';
import { adx } from '../../src/core/indicators';
import { candlesFromHlc } from '../helpers';

function trendingCandles(direction: 1 | -1, count: number) {
  return candlesFromHlc(
    Array.from({ length: count }, (_, i): [number, number, number] => {
      const base = 100 + direction * i * 2;
      return [base + 1, base - 1, base];
    }),
  );
}

describe('adx', () => {
  it('+DI dominates in a steady uptrend and ADX signals a strong trend', () => {
    const { plusDi, minusDi, adx: adxLine } = adx(trendingCandles(1, 60), 14);
    const last = 59;
    expect(plusDi[last]!).toBeGreaterThan(minusDi[last]!);
    expect(adxLine[last]!).toBeGreaterThan(25);
  });

  it('-DI dominates in a steady downtrend', () => {
    const { plusDi, minusDi, adx: adxLine } = adx(trendingCandles(-1, 60), 14);
    const last = 59;
    expect(minusDi[last]!).toBeGreaterThan(plusDi[last]!);
    expect(adxLine[last]!).toBeGreaterThan(25);
  });

  it('ADX is low in a directionless oscillating market', () => {
    const candles = candlesFromHlc(
      Array.from({ length: 120 }, (_, i): [number, number, number] => {
        const base = 100 + (i % 2 === 0 ? 1 : -1);
        return [base + 1, base - 1, base];
      }),
    );
    const { adx: adxLine } = adx(candles, 14);
    expect(adxLine[119]!).toBeLessThan(20);
  });

  it('warm-up: DI defined from index period, ADX from index 2*period - 1', () => {
    const { plusDi, adx: adxLine } = adx(trendingCandles(1, 40), 14);
    expect(plusDi[13]).toBeNull();
    expect(plusDi[14]).not.toBeNull();
    expect(adxLine[26]).toBeNull();
    expect(adxLine[27]).not.toBeNull();
  });

  it('all outputs stay within [0, 100]', () => {
    const candles = candlesFromHlc(
      Array.from({ length: 100 }, (_, i): [number, number, number] => {
        const base = 100 + Math.sin(i * 0.5) * 15;
        return [base + 2, base - 2, base];
      }),
    );
    const { plusDi, minusDi, adx: adxLine } = adx(candles, 14);
    for (const series of [plusDi, minusDi, adxLine]) {
      for (const v of series) {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('returns all nulls for series shorter than the warm-up', () => {
    const { plusDi, minusDi, adx: adxLine } = adx(trendingCandles(1, 10), 14);
    expect(plusDi.every((v) => v === null)).toBe(true);
    expect(minusDi.every((v) => v === null)).toBe(true);
    expect(adxLine.every((v) => v === null)).toBe(true);
  });
});
