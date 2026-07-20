/**
 * Return-correlation between symbols — pure.
 *
 * Feeds `assessTrade`'s optional correlated-cluster cap (see riskEngine.ts):
 * that cap needs "how correlated is symbol A to symbol B", which this module
 * computes from aligned historical candle closes. No indicator math beyond
 * plain Pearson correlation of percent returns.
 */

import type { Candle } from '../types';

/** Percent returns between consecutive closes (length candles.length - 1). */
export function returnsOf(candles: readonly Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!.close;
    const cur = candles[i]!.close;
    if (prev > 0) out.push((cur - prev) / prev);
  }
  return out;
}

/**
 * Pearson correlation coefficient of two return series (uses the shorter
 * series' length so misaligned inputs still compare something sensible).
 * Returns 0 (uncorrelated) for degenerate inputs — fewer than 2 points, or
 * either series has zero variance — rather than NaN.
 */
export function pearsonCorrelation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]!;
    sumB += b[i]!;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

/**
 * Build a fast, cached `(symbolA, symbolB) -> correlation` lookup from
 * per-symbol candle history (return-correlation of closes). Symmetric;
 * `a === b` always returns 1. Missing symbols correlate as 0 (unknown, so
 * the correlated-cluster cap simply doesn't apply to them — fails open).
 */
export function buildCorrelationMatrix(
  seriesBySymbol: ReadonlyMap<string, readonly Candle[]>,
): (a: string, b: string) => number {
  const returns = new Map<string, number[]>();
  for (const [symbol, candles] of seriesBySymbol) returns.set(symbol, returnsOf(candles));
  const cache = new Map<string, number>();
  return (a: string, b: string): number => {
    if (a === b) return 1;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const ra = returns.get(a);
    const rb = returns.get(b);
    const corr = ra && rb ? pearsonCorrelation(ra, rb) : 0;
    cache.set(key, corr);
    return corr;
  };
}
