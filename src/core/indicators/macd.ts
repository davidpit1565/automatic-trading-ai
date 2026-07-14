/**
 * Moving Average Convergence Divergence.
 *
 * macd = EMA(fast) - EMA(slow); signal = EMA(macd, signalPeriod);
 * histogram = macd - signal. Defaults: 12 / 26 / 9.
 */

import { ema } from './ema';
import { assertPeriod } from './sma';

export interface MacdResult {
  readonly macd: (number | null)[];
  readonly signal: (number | null)[];
  readonly histogram: (number | null)[];
}

export function macd(
  values: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  assertPeriod(fastPeriod, values.length);
  assertPeriod(slowPeriod, values.length);
  assertPeriod(signalPeriod, values.length);
  if (fastPeriod >= slowPeriod) {
    throw new RangeError(`fastPeriod (${fastPeriod}) must be < slowPeriod (${slowPeriod})`);
  }

  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const macdLine: (number | null)[] = values.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    return f !== null && f !== undefined && s !== null && s !== undefined ? f - s : null;
  });

  // Signal line: EMA over the defined portion of the MACD line, re-aligned.
  const firstDefined = macdLine.findIndex((v) => v !== null);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  if (firstDefined !== -1) {
    const defined = macdLine.slice(firstDefined) as number[];
    const signalDense = ema(defined, signalPeriod);
    for (let i = 0; i < signalDense.length; i++) {
      signal[firstDefined + i] = signalDense[i] ?? null;
    }
  }

  const histogram: (number | null)[] = macdLine.map((m, i) => {
    const s = signal[i];
    return m !== null && s !== null && s !== undefined ? m - s : null;
  });

  return { macd: macdLine, signal, histogram };
}
