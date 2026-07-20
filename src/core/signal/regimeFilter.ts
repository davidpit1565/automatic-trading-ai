/**
 * Daily trend regime filter — pure.
 *
 * Only allow new long entries when the larger (daily) trend is up: the most
 * recently FULLY-CLOSED daily candle's close sits above its long-period EMA.
 * This targets exactly the failure mode a 2026-07 live run exposed: entering
 * on short-term (1h) momentum inside a choppy/sideways daily range, where
 * breakout-style entries get stopped out repeatedly regardless of entry
 * quality — a regime problem, not an entry-quality problem.
 *
 * No look-ahead: a daily bar only counts once its full 24h window has
 * elapsed before the decision timestamp (the still-forming "today" candle,
 * if present in the fetched series, is never used).
 */

import { ema } from '../indicators';
import type { Candle } from '../types';

const DAY_MS = 86_400_000;

export interface RegimeFilterOptions {
  /** EMA period on daily closes, e.g. 100 or 200. */
  readonly period: number;
}

/**
 * Build a fast `atTimestamp -> allowed` check from daily candles. Reuses the
 * verified EMA indicator — no duplicated math. Fails OPEN (allows the entry)
 * when there isn't yet enough daily history to judge the regime, so this is
 * additive: it can only reject entries, never invent extra approvals.
 */
export function buildDailyRegimeFilter(
  dailyCandles: readonly Candle[],
  options: RegimeFilterOptions,
): (atTimestamp: number) => boolean {
  const closes = dailyCandles.map((c) => c.close);
  const trend = ema(closes, options.period);

  return (atTimestamp: number): boolean => {
    let idx = -1;
    for (let i = 0; i < dailyCandles.length; i++) {
      // Only a FULLY elapsed daily bar counts — never the still-forming one.
      if (dailyCandles[i]!.timestamp + DAY_MS <= atTimestamp) idx = i;
      else break;
    }
    if (idx < 0) return true; // no closed daily bar yet — fail open
    const level = trend[idx] ?? null;
    if (level === null) return true; // EMA still warming up — fail open
    return closes[idx]! > level;
  };
}
