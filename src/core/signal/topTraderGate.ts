/**
 * Top-trader positioning gate — pure.
 *
 * Only allow new long entries when OKX's own top traders (top 5% by
 * position size, aggregated, anonymous — see `data/okxPositioning.ts`) are
 * not net-short on that asset. Same fail-open, no-look-ahead contract as
 * `signal/regimeFilter.ts`: a point only counts once it exists at or before
 * the decision timestamp, and insufficient data allows the entry rather
 * than blocking it.
 */

import type { TopTraderRatioPoint } from '../data/okxPositioning';

export interface TopTraderGateOptions {
  /** Ratio below which top traders are net-short enough to block new longs. Default 1 (net short). */
  readonly bearishRatio?: number;
}

export function buildTopTraderGate(
  points: readonly TopTraderRatioPoint[],
  options: TopTraderGateOptions = {},
): (atTimestamp: number) => boolean {
  const bearishRatio = options.bearishRatio ?? 1;
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);

  return (atTimestamp: number): boolean => {
    let idx = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i]!.timestamp <= atTimestamp) idx = i;
      else break;
    }
    if (idx < 0) return true; // no data yet — fail open
    return sorted[idx]!.ratio >= bearishRatio;
  };
}
