/**
 * Funding-crowding gate — pure.
 *
 * Refuses a new long entry when leveraged longs on that asset are unusually
 * crowded: the average of the last `recentPeriods` settled funding rates
 * (default 3 = 24h) is positive, at or above the `percentile` (default 0.8)
 * of that asset's own funding history known at the decision time, AND
 * strictly above its median. Relative to each asset's own history on
 * purpose — a fixed threshold doesn't work across coins (DOT's max over Sept
 * 2026 was exactly the 0.01% baseline). The "above median" clause keeps a
 * coin sitting flat at the baseline from ever reading as crowded.
 *
 * Parameters chosen 2026-10-04 by FIRING RATE only, never by profitability
 * (so not fitted to outcomes): on the 18 curated coins with OKX perpetuals,
 * over the previous month, "strictly above p90" would have blocked 1.7% of
 * checks (too rare to ever produce evidence — OKX funding clusters at the
 * baseline), this definition 13.3%. Whether blocking those entries helps is
 * exactly what the 'funding-crowding' shadow candidate exists to measure.
 *
 * Same no-look-ahead, fail-open contract as `topTraderGate.ts`: only points
 * settled at or before the decision timestamp count, and too little history
 * allows the entry rather than blocking it.
 */

import type { FundingRatePoint } from '../data/okxFunding';

export interface FundingGateOptions {
  readonly recentPeriods?: number;
  readonly percentile?: number;
  /** Fewer known points than this → not enough history to judge, allow. */
  readonly minHistory?: number;
}

export function buildFundingGate(
  points: readonly FundingRatePoint[],
  options: FundingGateOptions = {},
): (atTimestamp: number) => boolean {
  const recentPeriods = options.recentPeriods ?? 3;
  const percentile = options.percentile ?? 0.8;
  const minHistory = options.minHistory ?? 30;
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);

  return (atTimestamp: number): boolean => {
    const known = sorted.filter((p) => p.timestamp <= atTimestamp);
    if (known.length < Math.max(minHistory, recentPeriods)) return true;
    const recent = known.slice(-recentPeriods);
    const recentAvg = recent.reduce((sum, p) => sum + p.rate, 0) / recent.length;
    if (recentAvg <= 0) return true;
    const rates = known.map((p) => p.rate).sort((a, b) => a - b);
    const cutoff = rates[Math.min(rates.length - 1, Math.floor(percentile * rates.length))]!;
    const median = rates[Math.floor(0.5 * rates.length)]!;
    const crowded = recentAvg >= cutoff && recentAvg > median;
    return !crowded;
  };
}
