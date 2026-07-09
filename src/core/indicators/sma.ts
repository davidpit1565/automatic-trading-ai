/**
 * Simple Moving Average.
 *
 * All indicator functions in this engine follow the same contract:
 * the output array is aligned 1:1 with the input, with `null` during the
 * warm-up period where the indicator is not yet defined.
 */

export function sma(values: readonly number[], period: number): (number | null)[] {
  assertPeriod(period, values.length);
  const out: (number | null)[] = new Array(values.length).fill(null);
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i]!;
    if (i >= period) windowSum -= values[i - period]!;
    if (i >= period - 1) out[i] = windowSum / period;
  }
  return out;
}

/** Shared parameter guard for every indicator. */
export function assertPeriod(period: number, length: number): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`period must be a positive integer, got ${period}`);
  }
  if (length < 0) {
    throw new RangeError('input length cannot be negative');
  }
}
