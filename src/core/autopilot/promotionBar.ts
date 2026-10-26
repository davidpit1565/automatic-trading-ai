/**
 * The PRE-REGISTERED bar a strategy must clear before it earns more real
 * money (David, 2026-10-19: "I need justified hope, not a promise"). Fixed
 * here, in code, BEFORE any candidate is judged against it, so a good-looking
 * result can never move the goalposts. Pure — no I/O.
 *
 * It is a necessary bar, not a sufficient one: the random-entry control (does
 * the rule beat entries chosen by chance, same exits and costs?) needs price
 * data and is run by hand — see PROJECT_STATE.md "Promotion bar".
 */

import { netPnl } from '../position/analytics';

export const PROMOTION_BAR = {
  /** Fewer closed trades than this is NOT TESTABLE yet, never "pass". */
  minTrades: 100,
  /** Profit factor on NET P&L (after entry AND exit fees). */
  minProfitFactor: 1.3,
  /** The record is cut into this many equal chronological parts... */
  parts: 3,
  /** ...and at least this many must have PF > 1 (it works in more than one stretch of market). */
  minPartsProfitable: 2,
  /** Bootstrap probability that the true mean net return per trade is <= 0. */
  maxProbabilityMeanNotPositive: 0.1,
  /** Worst peak-to-trough fall of the closed-trade equity curve. */
  maxDrawdownPct: 15,
} as const;

/**
 * High-risk demo tier (2026-10-20): same bar, but the drawdown ceiling is wider
 * because bigger size makes bigger swings by construction. Fixed BEFORE any
 * results exist; every other criterion is unchanged.
 */
export const HIGH_RISK_MAX_DRAWDOWN_PCT = 35;

export interface PromotionTrade {
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly positionSize: number;
  /** Entry + exit fees together, as the journal stores them. */
  readonly fees: number;
  readonly exitTimestamp: number;
}

// ONE definition of net P&L for the whole project (it lives with the trade analytics): re-exported here.
export { netPnl };

function profitFactor(pnls: readonly number[]): number | null {
  const gain = pnls.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const loss = -pnls.filter((p) => p <= 0).reduce((s, p) => s + p, 0);
  if (pnls.length === 0) return null;
  if (loss === 0) return gain > 0 ? Infinity : null;
  return gain / loss;
}

/** Small deterministic PRNG so the verdict is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** P(true mean <= 0) by bootstrapping the per-trade net returns (%). */
export function probabilityMeanNotPositive(returns: readonly number[], resamples = 2000): number {
  if (returns.length === 0) return 1;
  const rand = mulberry32(12345);
  let notPositive = 0;
  for (let i = 0; i < resamples; i++) {
    let sum = 0;
    for (let j = 0; j < returns.length; j++) sum += returns[Math.floor(rand() * returns.length)]!;
    if (sum <= 0) notPositive++;
  }
  return notPositive / resamples;
}

export function maxDrawdownOfPnls(pnls: readonly number[], initialEquity: number): number {
  let equity = initialEquity;
  let peak = initialEquity;
  let worst = 0;
  for (const p of pnls) {
    equity += p;
    peak = Math.max(peak, equity);
    worst = Math.max(worst, ((peak - equity) / peak) * 100);
  }
  return worst;
}

export interface PromotionVerdict {
  readonly trades: number;
  readonly profitFactor: number | null;
  readonly partsProfitable: number;
  readonly probabilityMeanNotPositive: number;
  readonly maxDrawdownPct: number;
  readonly totalNetPnl: number;
  /** n < minTrades: nothing can be concluded yet. */
  readonly testable: boolean;
  readonly checks: {
    readonly trades: boolean;
    readonly profitFactor: boolean;
    readonly parts: boolean;
    readonly significance: boolean;
    readonly drawdown: boolean;
  };
  /** True only when testable AND every check passes. */
  readonly passes: boolean;
}

export function assessPromotion(
  trades: readonly PromotionTrade[],
  initialEquity: number,
  maxDrawdownPct: number = PROMOTION_BAR.maxDrawdownPct,
): PromotionVerdict {
  const ordered = [...trades].sort((a, b) => a.exitTimestamp - b.exitTimestamp);
  const pnls = ordered.map(netPnl);
  const returns = ordered.map((t) => (netPnl(t) / (t.entryPrice * t.positionSize)) * 100);
  const pf = profitFactor(pnls);
  const size = Math.ceil(ordered.length / PROMOTION_BAR.parts);
  let partsProfitable = 0;
  for (let i = 0; i < PROMOTION_BAR.parts; i++) {
    const slice = pnls.slice(i * size, (i + 1) * size);
    const partPf = profitFactor(slice);
    if (partPf !== null && partPf > 1) partsProfitable++;
  }
  const pMean = probabilityMeanNotPositive(returns);
  const dd = maxDrawdownOfPnls(pnls, initialEquity);
  const checks = {
    trades: ordered.length >= PROMOTION_BAR.minTrades,
    profitFactor: pf !== null && pf >= PROMOTION_BAR.minProfitFactor,
    parts: partsProfitable >= PROMOTION_BAR.minPartsProfitable,
    significance: pMean <= PROMOTION_BAR.maxProbabilityMeanNotPositive,
    drawdown: dd < maxDrawdownPct,
  };
  return {
    trades: ordered.length,
    profitFactor: pf,
    partsProfitable,
    probabilityMeanNotPositive: pMean,
    maxDrawdownPct: dd,
    totalNetPnl: pnls.reduce((s, p) => s + p, 0),
    testable: checks.trades,
    checks,
    passes: Object.values(checks).every(Boolean),
  };
}
