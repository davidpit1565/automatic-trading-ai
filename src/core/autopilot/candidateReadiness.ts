/**
 * Per-symbol readiness for promoting a `CANDIDATE_INSTRUMENTS` entry into
 * `CURATED_INSTRUMENTS` (real-trading-eligible).
 *
 * `shadow:candidate-watch` (`server/autopilotRunner.mts`) runs every
 * candidate symbol through ONE pooled virtual portfolio, so its own
 * `ShadowStanding` (return/PF/trades) is a basket-level number — it can
 * answer "how did all the candidates do together" but not "does THIS one
 * coin have a real, individually-mature forward record," which is exactly
 * the question a promotion decision needs answered. The trade journal
 * behind that portfolio already records each trade's own `symbol`
 * (`JournalEntry.symbol`), so this re-derives a per-symbol breakdown from
 * it using the same verified math (`tradeAnalytics`) the rest of the
 * project already trusts — no new statistics, just a different grouping.
 */

import { tradeAnalytics, type TradeAnalytics } from '../position/analytics';
import type { JournalEntry } from '../position/tradeJournal';
import { SHADOW_MEANINGFUL_TRADES } from './shadowEvaluator';

export interface CandidateSymbolReadiness {
  readonly symbol: string;
  readonly analytics: TradeAnalytics;
  /** True once this ONE symbol (not the pooled basket) has cleared
   * `SHADOW_MEANINGFUL_TRADES` closed trades — the same trust bar every
   * other shadow candidate is held to before its numbers mean anything. */
  readonly mature: boolean;
}

/** Groups `entries` by `symbol` and runs `tradeAnalytics` on each group. */
export function candidateReadinessBySymbol(
  entries: readonly JournalEntry[],
): readonly CandidateSymbolReadiness[] {
  const bySymbol = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const group = bySymbol.get(entry.symbol);
    if (group) group.push(entry);
    else bySymbol.set(entry.symbol, [entry]);
  }
  return [...bySymbol.entries()]
    .map(([symbol, group]) => {
      const analytics = tradeAnalytics(group);
      return { symbol, analytics, mature: analytics.tradeCount >= SHADOW_MEANINGFUL_TRADES };
    })
    .sort((a, b) => b.analytics.tradeCount - a.analytics.tradeCount);
}
