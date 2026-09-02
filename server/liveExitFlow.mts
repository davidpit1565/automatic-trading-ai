/**
 * Live position tracking and exit decisions — the counterpart to
 * `server/liveOrchestrator.mts`'s entry-side wiring.
 *
 * A real BROKER fill isn't automatically remembered anywhere: paper trading
 * gets a position's stop-loss/take-profit for free from its local
 * `PortfolioEngine`, but `BrokerAdapter.fetchPositions()` only ever returns
 * quantity/avgCost — the broker has no idea what WE consider this
 * position's stop or target. `recordLiveEntryFill` persists exactly that,
 * the moment an entry order fills.
 *
 * `decideLiveExit` is a thin pass-through to
 * `src/core/autopilot/exitDecision.ts` — the SAME pure logic paper trading
 * uses, per this project's "paper and live are the same pipeline" rule
 * (docs/execution-architecture.md, property 3). `buildLiveExitIntent` turns
 * a decision into a sell `OrderIntent` that goes through the EXACT same
 * `runLiveOrderFlow` safety chain as any entry (kill-switch, mandatory
 * symbol check, human confirmation via `ConfirmationGate`, only then
 * `BrokerAdapter.submit`) — nothing here bypasses confirmation for an exit.
 *
 * Like `liveOrchestrator.mts`, this is tested, reusable machinery. Nothing
 * calls it from any scheduled workflow yet — see that file's header for the
 * full rationale (David asked to build Stage 6's wiring, not to start
 * autonomous live trading).
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { OrderIntent, OrderStatusReport } from '../src/core/execution/types';
import type { TradeRiskAssessment } from '../src/core/risk/riskEngine';
import type { ExitReason } from '../src/core/position/tradeJournal';
import { decideExit, type ExitDecisionOptions } from '../src/core/autopilot/exitDecision';

const LIVE_OPEN_POSITIONS_KEY = 'live-open-positions';

export interface LiveOpenPosition {
  readonly id: string;
  /** Broker-native symbol (e.g. 'BTC-EUR'), already translated. */
  readonly symbol: string;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  /** Highest price seen since entry — feeds a configured trailing stop. */
  readonly highestPrice: number;
  readonly openedAt: number;
  /** The ORIGINAL risk assessment this position was entered under — kept
   * for the exit's own confirmation message/audit traceability, not reused
   * as a fresh risk decision. */
  readonly entryAssessment: TradeRiskAssessment;
}

function readPositions(store: KeyValueStore): Record<string, LiveOpenPosition> {
  return store.get<Record<string, LiveOpenPosition>>(LIVE_OPEN_POSITIONS_KEY) ?? {};
}

/**
 * Call after `runLiveOrderFlow` reports a BUY intent's `OrderStatusReport`.
 * Tracks the position on a genuine `'filled'` report AND on a
 * `'submitted'` report that already carries a nonzero `filledQuantity` —
 * `RevolutXBrokerAdapter` maps Revolut X's own `partially_filled` status to
 * `'submitted'` (it never fabricates `'filled'` for a partial fill), and a
 * partially-filled real position is still real capital exposure: tracking
 * NOTHING for it would mean the resulting position has no stop-loss/target
 * enforcement and never surfaces to `decideLiveExit` at all (found in a
 * pre-go-live review, 2026-09-02 — see PROJECT_STATE.md). Tracking whatever
 * quantity genuinely filled is strictly safer than tracking nothing, even
 * though the remaining unfilled portion of the order (if any) still has no
 * follow-up poller watching it — that residual gap needs the broker-level
 * reconciliation mechanism noted in PROJECT_STATE.md, not something this
 * function alone can fully close.
 *
 * No-ops (returns `false`) for anything else — a sell intent, a buy that
 * hasn't filled AT ALL yet (`filledQuantity` is 0), or a report for a
 * DIFFERENT intent than the one passed (never trusts a mismatched report's
 * price/quantity onto this intent's position).
 */
export function recordLiveEntryFill(
  store: KeyValueStore,
  intent: OrderIntent,
  report: OrderStatusReport,
  now: number,
): boolean {
  if (intent.side !== 'buy') return false;
  if (report.intentId !== intent.id) return false;
  const genuinelyFilled = report.state === 'filled' || (report.state === 'submitted' && report.filledQuantity > 0);
  if (!genuinelyFilled) return false;
  const positions = readPositions(store);
  const entryPrice = report.avgFillPrice ?? intent.limitPrice;
  positions[intent.id] = {
    id: intent.id,
    symbol: intent.symbol,
    quantity: report.filledQuantity,
    entryPrice,
    stopLoss: intent.stopLoss,
    takeProfit: intent.takeProfit,
    highestPrice: entryPrice,
    openedAt: now,
    // `.entry` overridden to the REAL fill price, not the originally
    // proposed one — a filled order can slip, and the exit's own P&L math
    // (buildExitConfirmationMessage) must be honest about what was
    // actually paid, not what was merely proposed.
    entryAssessment: { ...intent.assessment, entry: entryPrice },
  };
  store.set(LIVE_OPEN_POSITIONS_KEY, positions);
  return true;
}

/** All currently tracked live positions. */
export function openLivePositions(store: KeyValueStore): readonly LiveOpenPosition[] {
  return Object.values(readPositions(store));
}

/**
 * Ratchets a tracked position's highest-seen price. Call once per cycle
 * BEFORE `decideLiveExit` so a configured trailing stop sees the real peak,
 * not just this cycle's price — never lowers the stored value. No-ops for
 * an untracked position id.
 */
export function updateLiveHighestPrice(store: KeyValueStore, positionId: string, price: number): void {
  const positions = readPositions(store);
  const existing = positions[positionId];
  if (!existing || price <= existing.highestPrice) return;
  positions[positionId] = { ...existing, highestPrice: price };
  store.set(LIVE_OPEN_POSITIONS_KEY, positions);
}

/**
 * Removes a position from tracking. Call only once its exit order is
 * confirmed FILLED — a merely-submitted (still open) sell order still has
 * real market exposure and must stay tracked.
 */
export function forgetLivePosition(store: KeyValueStore, positionId: string): void {
  const positions = readPositions(store);
  if (!(positionId in positions)) return;
  delete positions[positionId];
  store.set(LIVE_OPEN_POSITIONS_KEY, positions);
}

/** Pure pass-through to the shared exit-decision logic — paper and live
 * must decide exits identically given the same inputs. */
export function decideLiveExit(
  position: LiveOpenPosition,
  currentPrice: number,
  recentCloses: readonly number[],
  options: ExitDecisionOptions,
): ExitReason | null {
  return decideExit(position, currentPrice, recentCloses, options);
}

/**
 * Builds a live SELL `OrderIntent` closing `position` at `exitPrice`.
 * Reuses the position's ORIGINAL entry assessment (there's no new risk
 * being taken by closing a position) — `TelegramConfirmationGate` renders a
 * side-appropriate exit message from it (`side === 'sell'`), not the
 * entry's risk%/reward-ratio numbers.
 *
 * `exitId` must be a NEW id, distinct from `position.id` — this is a
 * different order (with its own `ConfirmationGate` approval lifecycle),
 * not a mutation of the entry order.
 */
export function buildLiveExitIntent(
  exitId: string,
  position: LiveOpenPosition,
  exitPrice: number,
  now: number,
): OrderIntent {
  return {
    id: exitId,
    createdAt: now,
    mode: 'live',
    symbol: position.symbol,
    side: 'sell',
    quantity: position.quantity,
    limitPrice: exitPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    assessment: position.entryAssessment,
  };
}
