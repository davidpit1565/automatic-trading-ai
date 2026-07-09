/**
 * Exponential Moving Average, seeded with the SMA of the first `period`
 * values (standard convention), smoothing factor k = 2 / (period + 1).
 */

import { assertPeriod } from './sma';

export function ema(values: readonly number[], period: number): (number | null)[] {
  assertPeriod(period, values.length);
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;

  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let previous = seed / period;
  out[period - 1] = previous;

  for (let i = period; i < values.length; i++) {
    previous = values[i]! * k + previous * (1 - k);
    out[i] = previous;
  }
  return out;
}
