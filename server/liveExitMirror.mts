/**
 * Automatic exit mirroring (2026-09-02) — the algorithmic counterpart to
 * `manualSellCommand.mts`'s human-triggered override. Each cycle, checks
 * every tracked open live position against the exact same `decideLiveExit`
 * logic paper trading uses (`src/core/autopilot/exitDecision.ts` — "paper
 * and live are the same pipeline", docs/execution-architecture.md property
 * 3), and if a reason fires, proposes an exit through the exact same
 * `runLiveOrderFlow` safety chain — kill-switch, symbol check, human
 * confirmation. Nothing here bypasses confirmation.
 *
 * Unlike `manualSellCommand.mts`, this needs no separate pending-request
 * queue: the TRIGGER here is the tracked position itself (`openLivePositions`),
 * which persists every cycle until forgotten — there is no one-time external
 * event (a Telegram message) that could be silently lost if not consumed
 * this cycle, so a `'pending'` confirmation simply gets retried the next
 * time this runs against the SAME stable intent id.
 *
 * Shares the SAME `outstandingExitSubmittedAt` guard already proven correct
 * for manual sells: a position with an outstanding (submitted, possibly
 * still resting) exit is skipped here too — exactly like a second `/sell`
 * would be — so an automatic exit and a manual one can never race into two
 * real sell orders for the same position.
 *
 * Called every cycle by `server/autopilotRunner.mts`'s `runLiveMirror` — but
 * that caller is itself a no-op unless `REAL_MONEY_ENABLED=true` AND real
 * broker credentials are configured (see its doc comment), so this stays
 * dormant until a human deliberately turns real money on.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import type { Timeframe } from '../src/core/types';
import type { ExitDecisionOptions } from '../src/core/autopilot/exitDecision';
import {
  buildLiveExitIntent,
  decideLiveExit,
  forgetLivePosition,
  markExitSubmitted,
  openLivePositions,
  reduceLivePositionQuantity,
  updateLiveHighestPrice,
  type LiveOpenPosition,
} from './liveExitFlow.mts';
import { clearOutstandingEntry } from './liveEntryMirror.mts';
import { creditLiveCash } from './liveLedger.mts';
import { runLiveOrderFlow, type LiveOrderFlowParams, type LiveOrderFlowResult } from './liveOrchestrator.mts';

export type LiveExitOutcome =
  | { readonly symbol: string; readonly outcome: 'outstanding-exit-already-pending' }
  | { readonly symbol: string; readonly outcome: 'no-price-data' }
  | { readonly symbol: string; readonly outcome: 'no-exit-signal' }
  | ({ readonly symbol: string } & LiveOrderFlowResult);

function findFresh(positions: readonly LiveOpenPosition[], id: string): LiveOpenPosition | undefined {
  return positions.find((p) => p.id === id);
}

/**
 * Call once per cycle. `entryTimeframe`/`candleCount` should match whatever
 * the paper autopilot uses for the same symbols (default 150, matching
 * `paperAutoPilot.ts`'s `SCAN_CANDLES`) so the trend-exit EMA (if
 * configured) sees the same amount of history paper's own exit check does.
 */
export async function checkAutomaticExits(
  store: KeyValueStore,
  source: MarketDataSource,
  entryTimeframe: Timeframe,
  exitOptions: ExitDecisionOptions,
  flowParams: Omit<LiveOrderFlowParams, 'intent'>,
  now: number,
  candleCount = 150,
  /** Reports realized P&L on a genuinely filled exit (fill price vs. the
   * position's own entry price) — feeds the live account's daily-loss
   * circuit breaker (`DailyLossTracker`, see `autopilotRunner.mts`'s
   * `runLiveMirror`). Optional so this stays callable exactly as before
   * wherever a caller (a test, say) has no tracker to feed. */
  onRealizedPnl?: (pnl: number, now: number) => void,
): Promise<readonly LiveExitOutcome[]> {
  const outcomes: LiveExitOutcome[] = [];
  for (const position of openLivePositions(store)) {
    const symbol = position.entryAssessment.asset;
    if (position.outstandingExitSubmittedAt !== undefined) {
      outcomes.push({ symbol, outcome: 'outstanding-exit-already-pending' });
      continue;
    }

    const candles = await source.getCandles(symbol, entryTimeframe, candleCount);
    if (!candles.ok || candles.value.length === 0) {
      outcomes.push({ symbol, outcome: 'no-price-data' });
      continue;
    }
    const price = candles.value[candles.value.length - 1]!.close;

    // Ratchet the highest-seen price BEFORE deciding (feeds a configured
    // trailing stop) — then re-read, since this mutates the stored record.
    updateLiveHighestPrice(store, position.id, price);
    const refreshed = findFresh(openLivePositions(store), position.id);
    if (!refreshed) continue; // forgotten by something else mid-loop — nothing left to exit

    const reason = decideLiveExit(
      refreshed,
      price,
      candles.value.map((c) => c.close),
      exitOptions,
    );
    if (!reason) {
      outcomes.push({ symbol, outcome: 'no-exit-signal' });
      continue;
    }

    const intent = buildLiveExitIntent(`${position.id}:auto-exit`, refreshed, price, now);
    const result = await runLiveOrderFlow({ ...flowParams, intent });
    outcomes.push({ symbol, ...result });
    if (result.outcome === 'submitted') {
      markExitSubmitted(store, position.id, now);
      const fillPrice = result.report.avgFillPrice ?? price;
      if (result.report.state === 'filled') {
        creditLiveCash(store, result.report.filledQuantity * fillPrice);
        onRealizedPnl?.((fillPrice - refreshed.entryPrice) * result.report.filledQuantity, now);
        forgetLivePosition(store, position.id);
        // Releases this symbol for a FUTURE fresh entry — see
        // `liveEntryMirror.mts`'s `clearOutstandingEntry` doc comment.
        clearOutstandingEntry(store, symbol);
      } else if (result.report.filledQuantity > 0) {
        // Partial fill: credit only what genuinely sold and shrink the
        // tracked quantity by that much — the remainder is still real,
        // still open exposure (found asymmetric with the partial-BUY
        // handling in review, 2026-09-03). outstandingExitSubmittedAt stays
        // set (already done above) since a resting order for the rest is
        // still live at the broker.
        creditLiveCash(store, result.report.filledQuantity * fillPrice);
        onRealizedPnl?.((fillPrice - refreshed.entryPrice) * result.report.filledQuantity, now);
        reduceLivePositionQuantity(store, position.id, result.report.filledQuantity);
      }
    }
  }
  return outcomes;
}
