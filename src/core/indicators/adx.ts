/**
 * Average Directional Index with +DI / -DI (Wilder).
 *
 * +DI / -DI become defined at index `period`; ADX (a Wilder average of DX)
 * becomes defined at index `2 * period - 1`. ADX measures trend strength
 * regardless of direction: > 25 is conventionally a trending market.
 */

import type { Candle } from '../types';
import { assertPeriod } from './sma';
import { trueRange } from './atr';

export interface AdxResult {
  readonly plusDi: (number | null)[];
  readonly minusDi: (number | null)[];
  readonly adx: (number | null)[];
}

export function adx(candles: readonly Candle[], period = 14): AdxResult {
  assertPeriod(period, candles.length);
  const n = candles.length;
  const plusDi: (number | null)[] = new Array(n).fill(null);
  const minusDi: (number | null)[] = new Array(n).fill(null);
  const adxOut: (number | null)[] = new Array(n).fill(null);
  if (n <= period) return { plusDi, minusDi, adx: adxOut };

  const tr = trueRange(candles);
  const plusDm: number[] = new Array(n).fill(0);
  const minusDm: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const upMove = candles[i]!.high - candles[i - 1]!.high;
    const downMove = candles[i - 1]!.low - candles[i]!.low;
    if (upMove > downMove && upMove > 0) plusDm[i] = upMove;
    if (downMove > upMove && downMove > 0) minusDm[i] = downMove;
  }

  // Wilder-smoothed running sums, seeded over indices 1..period.
  let smoothTr = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  for (let i = 1; i <= period; i++) {
    smoothTr += tr[i]!;
    smoothPlus += plusDm[i]!;
    smoothMinus += minusDm[i]!;
  }

  const dx: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (i > period) {
      smoothTr = smoothTr - smoothTr / period + tr[i]!;
      smoothPlus = smoothPlus - smoothPlus / period + plusDm[i]!;
      smoothMinus = smoothMinus - smoothMinus / period + minusDm[i]!;
    }
    const pdi = smoothTr === 0 ? 0 : (100 * smoothPlus) / smoothTr;
    const mdi = smoothTr === 0 ? 0 : (100 * smoothMinus) / smoothTr;
    plusDi[i] = pdi;
    minusDi[i] = mdi;
    const diSum = pdi + mdi;
    dx[i] = diSum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / diSum;
  }

  // ADX: seed with the average of the first `period` DX values, then Wilder.
  const firstAdxIndex = 2 * period - 1;
  if (n <= firstAdxIndex) return { plusDi, minusDi, adx: adxOut };
  let adxSeed = 0;
  for (let i = period; i <= firstAdxIndex; i++) adxSeed += dx[i]!;
  let previousAdx = adxSeed / period;
  adxOut[firstAdxIndex] = previousAdx;
  for (let i = firstAdxIndex + 1; i < n; i++) {
    previousAdx = (previousAdx * (period - 1) + dx[i]!) / period;
    adxOut[i] = previousAdx;
  }
  return { plusDi, minusDi, adx: adxOut };
}
