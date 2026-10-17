/**
 * F2 sentiment-trend rule — pure.
 *
 * Hold BTC while BOTH hold: (1) the 7-day average of the Fear & Greed index
 * is above 50 and (2) BTC's last closed daily close is above its 100-day
 * simple moving average; otherwise be in cash.
 *
 * FROZEN 2026-10-17 exactly as measured (no tuning): over 2018-02..2026-10 on
 * Coinbase EUR daily bars with 0.19%/side costs it cut max drawdown to 39%
 * vs 74% for buy&hold, 44 trades, but it did NOT beat buy&hold on
 * return-per-drawdown in the second half (2022-2026) and its edge over BTC is
 * not statistically significant (P(excess<=0)=0.74) — it is a risk-reduction
 * layer candidate, not a proven profit source. The forward test exists to see
 * whether that holds on data nobody has seen yet. Do not change the constants
 * to chase results; add a new candidate instead.
 */

import { sma } from '../indicators/sma';

export const FNG_WINDOW = 7;
export const FNG_THRESHOLD = 50;
export const TREND_SMA_PERIOD = 100;

export interface SentimentTrendDecision {
  readonly hold: boolean;
  readonly reason: string;
}

/**
 * `fng`: daily readings up to the decision day, oldest first. `closes`: CLOSED
 * daily closes up to the decision day, oldest first (never the forming bar).
 */
export function decideSentimentTrend(fng: readonly number[], closes: readonly number[]): SentimentTrendDecision {
  if (fng.length < FNG_WINDOW) return { hold: false, reason: `not enough Fear & Greed history (${fng.length}/${FNG_WINDOW})` };
  if (closes.length < TREND_SMA_PERIOD) {
    return { hold: false, reason: `not enough price history (${closes.length}/${TREND_SMA_PERIOD} daily closes)` };
  }
  const recent = fng.slice(-FNG_WINDOW);
  const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const trend = sma(closes, TREND_SMA_PERIOD).at(-1) ?? null;
  const last = closes[closes.length - 1]!;
  if (trend === null) return { hold: false, reason: 'trend average unavailable' };
  const sentimentOk = avg > FNG_THRESHOLD;
  const trendOk = last > trend;
  const text = `Fear&Greed 7d avg ${avg.toFixed(1)} (${sentimentOk ? '>' : '<='} ${FNG_THRESHOLD}), close ${last.toFixed(0)} ${trendOk ? '>' : '<='} SMA${TREND_SMA_PERIOD} ${trend.toFixed(0)}`;
  return { hold: sentimentOk && trendOk, reason: text };
}
