/**
 * Stochastic Oscillator.
 *
 * %K = 100 * (close - lowestLow(kPeriod)) / (highestHigh(kPeriod) - lowestLow(kPeriod))
 * %D = SMA(%K, dPeriod). Defaults 14 / 3.
 */

import type { Candle } from '../types';
import { assertPeriod, sma } from './sma';

export interface StochasticResult {
  readonly k: (number | null)[];
  readonly d: (number | null)[];
}

export function stochastic(
  candles: readonly Candle[],
  kPeriod = 14,
  dPeriod = 3,
): StochasticResult {
  assertPeriod(kPeriod, candles.length);
  assertPeriod(dPeriod, candles.length);
  const n = candles.length;
  const k: (number | null)[] = new Array(n).fill(null);

  for (let i = kPeriod - 1; i < n; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      highest = Math.max(highest, candles[j]!.high);
      lowest = Math.min(lowest, candles[j]!.low);
    }
    const range = highest - lowest;
    // Flat window: price is exactly mid-range by convention.
    k[i] = range === 0 ? 50 : (100 * (candles[i]!.close - lowest)) / range;
  }

  // %D: SMA over the defined portion of %K, re-aligned to the input.
  const d: (number | null)[] = new Array(n).fill(null);
  const firstDefined = k.findIndex((v) => v !== null);
  if (firstDefined !== -1) {
    const dense = k.slice(firstDefined) as number[];
    const smoothed = sma(dense, dPeriod);
    for (let i = 0; i < smoothed.length; i++) {
      d[firstDefined + i] = smoothed[i] ?? null;
    }
  }
  return { k, d };
}
