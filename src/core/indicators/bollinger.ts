/**
 * Bollinger Bands: middle = SMA(period), bands at ± multiplier standard
 * deviations (population std dev over the window — the standard TA
 * convention). Also exposes bandwidth and %B for volatility analysis.
 */

import { assertPeriod, sma } from './sma';

export interface BollingerResult {
  readonly middle: (number | null)[];
  readonly upper: (number | null)[];
  readonly lower: (number | null)[];
  /** (upper - lower) / middle — relative band width, a volatility measure. */
  readonly bandwidth: (number | null)[];
  /** (price - lower) / (upper - lower) — where price sits within the bands. */
  readonly percentB: (number | null)[];
}

export function bollinger(
  values: readonly number[],
  period = 20,
  multiplier = 2,
): BollingerResult {
  assertPeriod(period, values.length);
  if (!(multiplier > 0)) throw new RangeError(`multiplier must be > 0, got ${multiplier}`);

  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  const bandwidth: (number | null)[] = new Array(values.length).fill(null);
  const percentB: (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    if (mean === null || mean === undefined) continue;
    let sumSquares = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j]! - mean;
      sumSquares += diff * diff;
    }
    const stdDev = Math.sqrt(sumSquares / period);
    const up = mean + multiplier * stdDev;
    const down = mean - multiplier * stdDev;
    upper[i] = up;
    lower[i] = down;
    bandwidth[i] = mean !== 0 ? (up - down) / mean : null;
    percentB[i] = up !== down ? (values[i]! - down) / (up - down) : 0.5;
  }

  return { middle, upper, lower, bandwidth, percentB };
}
