/**
 * Volume statistics: rolling average volume, relative volume, and
 * On-Balance Volume. Relative volume > 1 means above-average activity.
 */

import type { Candle } from '../types';
import { assertPeriod, sma } from './sma';

export function volumeSma(candles: readonly Candle[], period = 20): (number | null)[] {
  return sma(candles.map((c) => c.volume), period);
}

/** Current volume divided by its rolling average. */
export function relativeVolume(candles: readonly Candle[], period = 20): (number | null)[] {
  assertPeriod(period, candles.length);
  const average = volumeSma(candles, period);
  return candles.map((candle, i) => {
    const avg = average[i];
    if (avg === null || avg === undefined || avg === 0) return null;
    return candle.volume / avg;
  });
}

/** On-Balance Volume: cumulative volume signed by close-to-close direction. */
export function obv(candles: readonly Candle[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const previous = out[i - 1]!;
    const change = candles[i]!.close - candles[i - 1]!.close;
    if (change > 0) out[i] = previous + candles[i]!.volume;
    else if (change < 0) out[i] = previous - candles[i]!.volume;
    else out[i] = previous;
  }
  return out;
}
