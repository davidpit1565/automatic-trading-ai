import { describe, expect, it } from 'vitest';
import { atr, trueRange } from '../../src/core/indicators';
import { candlesFromHlc } from '../helpers';

describe('trueRange', () => {
  it('first TR is high - low; later TRs account for gaps from previous close', () => {
    const candles = candlesFromHlc([
      [12, 10, 11], // TR = 2
      [13, 11, 12], // prev close 11: max(2, 2, 0) = 2
      [20, 18, 19], // gap up, prev close 12: max(2, 8, 6) = 8
      [15, 13, 14], // gap down, prev close 19: max(2, 4, 6) = 6
    ]);
    expect(trueRange(candles)).toEqual([2, 2, 8, 6]);
  });
});

describe('atr', () => {
  it('matches hand-computed Wilder smoothing (period 3)', () => {
    const candles = candlesFromHlc([
      [12, 10, 11], // TR 2
      [13, 11, 12], // TR 2
      [20, 18, 19], // TR 8 -> seed ATR = (2+2+8)/3 = 4
      [15, 13, 14], // TR 6 -> ATR = (4*2 + 6)/3 = 14/3
    ]);
    const out = atr(candles, 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBeCloseTo(4, 10);
    expect(out[3]).toBeCloseTo(14 / 3, 10);
  });

  it('equals the constant range for uniform candles', () => {
    const candles = candlesFromHlc(Array.from({ length: 10 }, () => [11, 9, 10]));
    const out = atr(candles, 5);
    expect(out[9]).toBeCloseTo(2, 10);
  });

  it('is always non-negative', () => {
    const candles = candlesFromHlc(
      Array.from({ length: 50 }, (_, i): [number, number, number] => {
        const base = 100 + Math.sin(i) * 10;
        return [base + 2, base - 2, base];
      }),
    );
    for (const v of atr(candles, 14)) {
      if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns all nulls when the series is shorter than the period', () => {
    const candles = candlesFromHlc([
      [12, 10, 11],
      [13, 11, 12],
    ]);
    expect(atr(candles, 5)).toEqual([null, null]);
  });
});
