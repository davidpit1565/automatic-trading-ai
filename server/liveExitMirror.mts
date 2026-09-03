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
 * `proposeLiveExit` below is shared with `manualSellCommand.mts` — see its
 * own doc comment for why: an automatic exit and a human's `/sell` for the
 * SAME position must never build two independent confirmation attempts.
 *
 * Called every cycle by `server/autopilotRunner.mts`'s `runLiveMirror` — but
 * that caller is itself a no-op unless `REAL_MONEY_ENABLED=true` AND real
 * broker credentials are configured (see its doc comment), so this stays
 * dormant until a human deliberately turns real money on.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import type { Timeframe } from '../src/core/types';
import type { ExitReason } from '../src/core/position/tradeJournal';
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

const EXIT_PENDING_KEY = 'live-exit-pending';

interface PendingExit {
  readonly reason: ExitReason;
  readonly queuedAt: number;
}

function readPendingExits(store: KeyValueStore): Record<string, PendingExit> {
  return store.get<Record<string, PendingExit>>(EXIT_PENDING_KEY) ?? {};
}

function findFresh(positions: readonly LiveOpenPosition[], id: string): LiveOpenPosition | undefined {
  return positions.find((p) => p.id === id);
}

export interface ProposeLiveExitParams {
  readonly flowParams: Omit<LiveOrderFlowParams, 'intent'>;
  /** Reports realized P&L on a genuinely filled exit — feeds the live
   * account's daily-loss circuit breaker. Optional so this stays callable
   * exactly as before wherever a caller has no tracker to feed. */
  readonly onRealizedPnl?: (pnl: number, now: number) => void;
}

/**
 * Proposes (or resumes) a real exit for `position` — shared by the automatic
 * stop/target/trend-exit check (`checkAutomaticExits` below) and a human's
 * `/sell` (`manualSellCommand.mts`'s `checkManualSellRequests`), so BOTH
 * triggers for the SAME position share ONE queued attempt with ONE stable
 * intent id, instead of each building its own independent confirmation.
 *
 * Found in review, 2026-09-03: with two SEPARATE intent ids
 * (`${id}:auto-exit` vs `${id}:manual-sell`), an automatic exit still
 * awaiting a human's tap and a `/sell` for the SAME position could BOTH
 * reach a real broker submission — two real sell orders for one position,
 * since neither trigger had any way to see the other's in-flight attempt.
 * Whoever proposes FIRST (this cycle or an earlier one) queues it — its
 * `reason`/`queuedAt` are then fixed for the life of that attempt; a LATER
 * trigger for the same position, automatic or manual, resumes the SAME
 * queued attempt (ignoring its own `reason`) instead of starting a second
 * one. This mirrors `mirrorApprovedEntries`'s own shared-queue pattern for
 * entries.
 *
 * A side effect of sharing one queue: once ANY trigger queues an exit,
 * EVERY later cycle resumes it (polling the SAME confirmation) regardless
 * of whether `decideLiveExit` still returns a reason that cycle — closing a
 * second real gap found in the same review: the automatic checker used to
 * poll for a human's tap ONLY on a cycle where its own signal was still
 * currently firing, so a tap arriving after the price recovered (signal no
 * longer firing) could go unclaimed until the confirmation's 20-minute
 * auto-expiry.
 *
 * `price` is whatever the CALLING trigger already fetched fresh this cycle
 * — legitimate regardless of which trigger happens to run; the intent id
 * (hence Revolut X's deterministic client_order_id and the confirmation
 * gate's own token) depends only on `position.id` + the queue's OWN
 * `queuedAt`, never on `price`/`now`.
 *
 * Pass `reason: null` when the caller has no fresh signal of its own to
 * propose (e.g. the automatic checker on a cycle where `decideLiveExit`
 * currently returns nothing) — this still resumes an ALREADY-queued
 * attempt, but never starts a brand-new one from a null reason.
 */
export async function proposeLiveExit(
  store: KeyValueStore,
  position: LiveOpenPosition,
  reason: ExitReason | null,
  price: number,
  now: number,
  params: ProposeLiveExitParams,
): Promise<{ readonly outcome: 'outstanding-exit-already-pending' | 'no-exit-signal' } | LiveOrderFlowResult> {
  if (position.outstandingExitSubmittedAt !== undefined) {
    return { outcome: 'outstanding-exit-already-pending' };
  }
  const pending = readPendingExits(store);
  if (!(position.id in pending)) {
    if (reason === null) return { outcome: 'no-exit-signal' };
    pending[position.id] = { reason, queuedAt: now };
    store.set(EXIT_PENDING_KEY, pending);
  }
  const queued = pending[position.id]!;
  const intent = buildLiveExitIntent(`${position.id}:exit:${queued.queuedAt}`, position, price, now);
  const result = await runLiveOrderFlow({ ...params.flowParams, intent });
  if (result.outcome !== 'pending') {
    delete pending[position.id];
    store.set(EXIT_PENDING_KEY, pending);
  }
  if (result.outcome === 'submitted') {
    // Only a report that represents REAL, still-live exposure should mark
    // this position "outstanding" — a broker-level 'rejected'/'cancelled'
    // report reached runLiveOrderFlow's terminal broker-call branch but
    // left NOTHING open at the broker. Found in review, 2026-09-03: this
    // used to be marked unconditionally, so a rejected exit permanently
    // blocked every future exit attempt for that position (no reconciler
    // ever clears it) — a real, still-open position became impossible to
    // close through the app, exactly when a stop/target firing is what
    // triggered the exit attempt in the first place. Mirrors the identical
    // fix already shipped on the entry side (`liveEntryMirror.mts`'s
    // `hasRealExposure`).
    const hasRealExposure = result.report.state !== 'rejected' && result.report.state !== 'cancelled';
    if (hasRealExposure) {
      markExitSubmitted(store, position.id, now);
      const fillPrice = result.report.avgFillPrice ?? price;
      if (result.report.state === 'filled') {
        creditLiveCash(store, result.report.filledQuantity * fillPrice);
        params.onRealizedPnl?.((fillPrice - position.entryPrice) * result.report.filledQuantity, now);
        forgetLivePosition(store, position.id);
        // Releases this symbol for a FUTURE fresh entry — see
        // `liveEntryMirror.mts`'s `clearOutstandingEntry` doc comment.
        clearOutstandingEntry(store, position.entryAssessment.asset);
      } else if (result.report.filledQuantity > 0) {
        // Partial fill: credit only what genuinely sold and shrink the
        // tracked quantity by that much — the remainder is still real,
        // still open exposure. outstandingExitSubmittedAt stays set (above)
        // since a resting order for the rest is still live at the broker.
        creditLiveCash(store, result.report.filledQuantity * fillPrice);
        params.onRealizedPnl?.((fillPrice - position.entryPrice) * result.report.filledQuantity, now);
        reduceLivePositionQuantity(store, position.id, result.report.filledQuantity);
      }
    }
  }
  return result;
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
  onRealizedPnl?: (pnl: number, now: number) => void,
): Promise<readonly LiveExitOutcome[]> {
  const outcomes: LiveExitOutcome[] = [];
  for (const position of openLivePositions(store)) {
    const symbol = position.entryAssessment.asset;
    try {
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

      const reason = decideLiveExit(refreshed, price, candles.value.map((c) => c.close), exitOptions);
      const result = await proposeLiveExit(store, refreshed, reason, price, now, { flowParams, onRealizedPnl });
      outcomes.push({ symbol, ...result });
    } catch (cause) {
      // One position's transient failure (a network error, an unexpected
      // broker response) must never stop every OTHER open position from
      // being checked this cycle (found in review, 2026-09-03) — a real
      // stop-loss on a different symbol must still get its chance to fire.
      console.error(`checkAutomaticExits failed for ${symbol}:`, cause instanceof Error ? cause.message : cause);
      outcomes.push({ symbol, outcome: 'no-price-data' });
    }
  }
  return outcomes;
}
