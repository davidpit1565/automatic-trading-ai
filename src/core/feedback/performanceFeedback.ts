/**
 * Performance Feedback — Stage 7.
 *
 * Learning from verified historical performance: pure functions over the
 * trade journal that answer the questions a professional desk asks after
 * the fact — which confidence levels actually predict success, whether
 * stops and targets are placed well, how each strategy variant performs,
 * and whether the system beat simply holding. Reuses the verified
 * analytics; describes the past and promises nothing about the future.
 */

import { tradeAnalytics, type TradeAnalytics } from '../position/analytics';
import type { ExitReason, JournalEntry } from '../position/tradeJournal';

// ---------------------------------------------------------------------------
// Confidence calibration.
// ---------------------------------------------------------------------------

export interface ConfidenceBucket {
  readonly label: string;
  readonly minConfidence: number;
  readonly maxConfidence: number;
  readonly tradeCount: number;
  readonly winRatePct: number | null;
  readonly expectancy: number | null;
  readonly totalPnl: number;
}

/** Bucket edges chosen to match the signal engine's scale (max 90). */
const CONFIDENCE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '0–40', min: 0, max: 40 },
  { label: '40–60', min: 40, max: 60 },
  { label: '60–90', min: 60, max: 90.0001 },
];

export function confidenceCalibration(entries: readonly JournalEntry[]): ConfidenceBucket[] {
  return CONFIDENCE_BUCKETS.map(({ label, min, max }) => {
    const inBucket = entries.filter(
      (t) => t.confidence !== null && t.confidence >= min && t.confidence < max,
    );
    const wins = inBucket.filter((t) => t.realizedPnl > 0).length;
    const totalPnl = inBucket.reduce((sum, t) => sum + t.realizedPnl, 0);
    return {
      label,
      minConfidence: min,
      maxConfidence: max,
      tradeCount: inBucket.length,
      winRatePct: inBucket.length > 0 ? (wins / inBucket.length) * 100 : null,
      expectancy: inBucket.length > 0 ? totalPnl / inBucket.length : null,
      totalPnl,
    };
  });
}

// ---------------------------------------------------------------------------
// Exit reason breakdown.
// ---------------------------------------------------------------------------

export interface ExitReasonStats {
  readonly reason: ExitReason;
  readonly tradeCount: number;
  readonly winRatePct: number | null;
  readonly totalPnl: number;
  readonly avgPnl: number | null;
}

export function exitReasonBreakdown(entries: readonly JournalEntry[]): ExitReasonStats[] {
  const byReason = new Map<ExitReason, JournalEntry[]>();
  for (const trade of entries) {
    const bucket = byReason.get(trade.exitReason) ?? [];
    bucket.push(trade);
    byReason.set(trade.exitReason, bucket);
  }
  return [...byReason.entries()]
    .map(([reason, trades]) => {
      const wins = trades.filter((t) => t.realizedPnl > 0).length;
      const totalPnl = trades.reduce((sum, t) => sum + t.realizedPnl, 0);
      return {
        reason,
        tradeCount: trades.length,
        winRatePct: trades.length > 0 ? (wins / trades.length) * 100 : null,
        totalPnl,
        avgPnl: trades.length > 0 ? totalPnl / trades.length : null,
      };
    })
    .sort((a, b) => b.tradeCount - a.tradeCount);
}

// ---------------------------------------------------------------------------
// Trade management efficiency (MFE/MAE analysis).
// ---------------------------------------------------------------------------

export interface EfficiencyReport {
  readonly avgMfePct: number | null;
  readonly avgMaePct: number | null;
  /**
   * Average share of the maximum favourable excursion that was actually
   * realized (returnPct / mfePct), as a percentage. Low values mean the
   * system routinely gives back open profits.
   */
  readonly avgCapturePct: number | null;
  /** Trades whose MFE reached at least the "saw profit" threshold. */
  readonly tradesThatSawProfit: number;
  /** Losing trades that were once meaningfully profitable before closing red. */
  readonly losersThatWereProfitable: number;
}

/** MFE at or above this % counts as "the trade saw real profit". */
const SAW_PROFIT_MFE_PCT = 1;

export function efficiencyReport(entries: readonly JournalEntry[]): EfficiencyReport {
  if (entries.length === 0) {
    return {
      avgMfePct: null,
      avgMaePct: null,
      avgCapturePct: null,
      tradesThatSawProfit: 0,
      losersThatWereProfitable: 0,
    };
  }
  const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const captures = entries
    .filter((t) => t.mfePct > 0)
    .map((t) => (t.returnPct / t.mfePct) * 100);
  return {
    avgMfePct: avg(entries.map((t) => t.mfePct)),
    avgMaePct: avg(entries.map((t) => t.maePct)),
    avgCapturePct: captures.length > 0 ? avg(captures) : null,
    tradesThatSawProfit: entries.filter((t) => t.mfePct >= SAW_PROFIT_MFE_PCT).length,
    losersThatWereProfitable: entries.filter(
      (t) => t.realizedPnl < 0 && t.mfePct >= SAW_PROFIT_MFE_PCT,
    ).length,
  };
}

// ---------------------------------------------------------------------------
// Strategy version breakdown (reuses verified analytics).
// ---------------------------------------------------------------------------

export interface StrategyStats {
  readonly strategyVersion: string;
  readonly stats: TradeAnalytics;
}

export function strategyBreakdown(entries: readonly JournalEntry[]): StrategyStats[] {
  const byStrategy = new Map<string, JournalEntry[]>();
  for (const trade of entries) {
    const key = trade.strategyVersion ?? 'manual';
    const bucket = byStrategy.get(key) ?? [];
    bucket.push(trade);
    byStrategy.set(key, bucket);
  }
  return [...byStrategy.entries()]
    .map(([strategyVersion, trades]) => ({
      strategyVersion,
      stats: tradeAnalytics(trades),
    }))
    .sort((a, b) => b.stats.tradeCount - a.stats.tradeCount);
}

// ---------------------------------------------------------------------------
// Benchmark: did the system beat simply holding?
// ---------------------------------------------------------------------------

export interface BenchmarkComparison {
  /** Realized P&L as % of initial cash over the journal's span. */
  readonly strategyReturnPct: number;
  /** Equal-weight buy & hold return of the traded symbols over the same span. */
  readonly holdReturnPct: number;
  readonly beatBenchmark: boolean;
  readonly symbols: string[];
}

export interface SymbolPriceSpan {
  readonly startPrice: number;
  readonly endPrice: number;
}

export function benchmarkComparison(
  entries: readonly JournalEntry[],
  initialCash: number,
  prices: Readonly<Record<string, SymbolPriceSpan>>,
): BenchmarkComparison | null {
  if (entries.length === 0 || !(initialCash > 0)) return null;
  const symbols = [...new Set(entries.map((t) => t.symbol))].filter(
    (symbol) => prices[symbol] !== undefined && prices[symbol]!.startPrice > 0,
  );
  if (symbols.length === 0) return null;

  const totalPnl = entries.reduce((sum, t) => sum + t.realizedPnl, 0);
  const strategyReturnPct = (totalPnl / initialCash) * 100;
  const holdReturnPct =
    symbols.reduce((sum, symbol) => {
      const { startPrice, endPrice } = prices[symbol]!;
      return sum + ((endPrice - startPrice) / startPrice) * 100;
    }, 0) / symbols.length;

  return {
    strategyReturnPct,
    holdReturnPct,
    beatBenchmark: strategyReturnPct > holdReturnPct,
    symbols,
  };
}
