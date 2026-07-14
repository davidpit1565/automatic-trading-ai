/**
 * Average True Range (Wilder's smoothing).
 *
 * TR[0] = high - low; TR[i] = max(high-low, |high-prevClose|, |low-prevClose|).
 * ATR seeded with the SMA of the first `period` TRs, then Wilder-smoothed.
 */

import type { Candle } from '../types';
import { assertPeriod } from './sma';

export function trueRange(candles: readonly Candle[]): number[] {
  return candles.map((candle, i) => {
    if (i === 0) return candle.high - candle.low;
    const previousClose = candles[i - 1]!.close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
}

export function atr(candles: readonly Candle[], period = 14): (number | null)[] {
  assertPeriod(period, candles.length);
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return out;

  const tr = trueRange(candles);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += tr[i]!;
  let previous = seed / period;
  out[period - 1] = previous;

  for (let i = period; i < candles.length; i++) {
    previous = (previous * (period - 1) + tr[i]!) / period;
    out[i] = previous;
  }
  return out;
}
