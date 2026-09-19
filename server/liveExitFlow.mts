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
 * Like `liveOrchestrator.mts`, this is called every cycle now (via
 * `liveEntryMirror.mts`/`liveExitMirror.mts` → `autopilotRunner.mts`'s
 * `runLiveMirror`) — see that function's doc comment for why it's still a
 * no-op until `REAL_MONEY_ENABLED=true` and real broker credentials exist.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { OrderIntent, OrderStatusReport } from '../src/core/execution/types';
import type { TradeRiskAssessment } from '../src/core/risk/riskEngine';
import type { ExitReason, JournalEntry } from '../src/core/position/tradeJournal';
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
  /** Lowest price seen since entry — mirrors `highestPrice`, feeds MAE at
   * close (`buildLiveJournalEntry`). No configured behavior reads this
   * (unlike `highestPrice`'s trailing stop) — it exists purely to measure. */
  readonly lowestPrice: number;
  /** The quantity THIS position was entered with — `quantity` below shrinks
   * on a partial exit, but journaling (`buildLiveJournalEntry`) needs the
   * original size to know whether a close is honestly a single clean fill
   * or something a partial exit already touched. */
  readonly initialQuantity: number;
  /**
   * Real, measured entry slippage in EUR: |actual fill price − the Kraken-
   * derived signal price the order was built from| × filled quantity.
   * Unlike paper trading's simulated `slippage` (a cost-rate estimate),
   * this is genuine broker-vs-signal divergence — see `buildLiveJournalEntry`.
   * Zero whenever the entry's real fill price was unknown and defaulted to
   * the signal price itself (e.g. an external-reconcile buy), which is
   * honest: there is no measured divergence to report, not a real zero.
   */
  readonly entrySlippage: number;
  readonly openedAt: number;
  /** The ORIGINAL risk assessment this position was entered under — kept
   * for the exit's own confirmation message/audit traceability, not reused
   * as a fresh risk decision. */
  readonly entryAssessment: TradeRiskAssessment;
  /**
   * Set by `markExitSubmitted` the moment an exit for this position reaches
   * `runLiveOrderFlow`'s `'submitted'` outcome — regardless of whether the
   * broker's report says `'filled'` or a still-resting `'submitted'`. A
   * position with this set has a REAL order already placed at the broker;
   * a caller (`manualSellCommand.mts`) must check this before proposing
   * another exit for the same position, or a resting (not yet filled)
   * order plus a second human `/sell` could result in two real sell orders
   * for one position (found in an independent review, 2026-09-02). Cleared
   * implicitly by `forgetLivePosition` once the position is actually gone.
   */
  readonly outstandingExitSubmittedAt?: number;
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
    initialQuantity: report.filledQuantity,
    entryPrice,
    stopLoss: intent.stopLoss,
    takeProfit: intent.takeProfit,
    highestPrice: entryPrice,
    lowestPrice: entryPrice,
    entrySlippage: Math.abs(entryPrice - intent.limitPrice) * report.filledQuantity,
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
 * Ratchets a tracked position's lowest-seen price — the MAE counterpart to
 * `updateLiveHighestPrice`. Call alongside it, every cycle, before deciding
 * an exit. No-ops for an untracked position id.
 */
export function updateLiveLowestPrice(store: KeyValueStore, positionId: string, price: number): void {
  const positions = readPositions(store);
  const existing = positions[positionId];
  if (!existing || price >= existing.lowestPrice) return;
  positions[positionId] = { ...existing, lowestPrice: price };
  store.set(LIVE_OPEN_POSITIONS_KEY, positions);
}

/**
 * Builds a structured journal entry for a position that just closed for
 * real — the live counterpart to paper trading's `buildJournalEntry`
 * (`src/core/position/positionEngine.ts`), so live trades are finally
 * queryable the same way (fees, slippage, MAE/MFE, holding time) instead of
 * only ever appearing as free-text audit-log lines. Added 2026-09-19 after
 * an audit found LIVE trades never reached `TradeJournal` at all.
 *
 * Returns `null` — deliberately skips journaling — when `position.quantity`
 * no longer equals `position.initialQuantity`: a partial exit already
 * happened somewhere in this position's life, and this project has no
 * per-leg exit history to build an honest weighted entry from (unlike
 * paper's `PositionState`, which keeps one). Fabricating a P&L number from
 * only the entry price and the FINAL exit price would silently misprice
 * every quantity that left earlier at a different price — worse than not
 * journaling at all. A future pass can extend this once partial-exit legs
 * are tracked; until then, the plain audit-log entry every exit already
 * gets is this case's only record, exactly as before this change.
 *
 * `fees` is a COST_RATE estimate on entry+exit notional — the SAME
 * assumption paper trading already uses, since Revolut X's real order API
 * has never been observed to return an actual fee figure (checked directly
 * against every response shape documented in this file's own history).
 * `slippage`, unlike paper's, is REAL: `position.entrySlippage` (measured at
 * entry) plus this exit's own |fill price − signal price| × quantity —
 * genuine broker-vs-signal divergence, not a simulated cost.
 */
export function buildLiveJournalEntry(
  position: LiveOpenPosition,
  exitPrice: number,
  exitSignalPrice: number,
  exitReason: ExitReason,
  costRate: number,
  now: number,
): JournalEntry | null {
  if (position.quantity !== position.initialQuantity) return null;
  const quantity = position.initialQuantity;
  const notionalEntry = position.entryPrice * quantity;
  const notionalExit = exitPrice * quantity;
  const fees = (notionalEntry + notionalExit) * costRate;
  const exitSlippage = Math.abs(exitPrice - exitSignalPrice) * quantity;
  const realizedPnl = notionalExit - notionalEntry - fees;
  return {
    id: position.id,
    symbol: position.symbol,
    entryTimestamp: position.openedAt,
    exitTimestamp: now,
    entryPrice: position.entryPrice,
    exitPrice,
    positionSize: quantity,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    exitReason,
    fees,
    slippage: position.entrySlippage + exitSlippage,
    holdingDurationMs: now - position.openedAt,
    mfePct: ((position.highestPrice - position.entryPrice) / position.entryPrice) * 100,
    maePct: ((position.entryPrice - position.lowestPrice) / position.entryPrice) * 100,
    realizedPnl,
    returnPct: notionalEntry > 0 ? (realizedPnl / notionalEntry) * 100 : 0,
    strategyVersion: null,
    validationVerdict: null,
    // Not available on a live OrderIntent's TradeRiskAssessment (unlike
    // paper's PositionState, which threads the signal's own confidence
    // through) — left honestly null rather than guessed.
    confidence: null,
    notes:
      'live trade — fees are a cost-rate ESTIMATE (Revolut X reports no real fee figure); ' +
      'slippage is REAL (signal price vs actual broker fill, entry + exit)',
  };
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

/**
 * Call after a PARTIALLY filled exit (`state: 'submitted'`, a genuine
 * nonzero `filledQuantity` less than the tracked quantity) — reduces the
 * tracked quantity by whatever genuinely sold, so the REMAINING (still
 * real, still open) quantity keeps being monitored for stop-loss/
 * take-profit instead of vanishing from tracking entirely the moment ANY
 * amount sells. Mirrors the partial-fill BUY handling in
 * `recordLiveEntryFill` — found asymmetric in review, 2026-09-03 (a partial
 * sell neither credited the partial proceeds nor reduced the tracked
 * quantity, only a genuine full `'filled'` did).
 *
 * Deliberately does NOT clear `outstandingExitSubmittedAt` — a resting
 * order for the unfilled remainder is still real, live exposure at the
 * broker, so a second exit trigger must keep refusing until that order is
 * fully resolved, exactly as it already does for a merely-resting (zero
 * filled) exit.
 *
 * No-ops (returns `false`) for an untracked position id, a non-positive
 * `soldQuantity`, or a `soldQuantity` at or above the tracked quantity —
 * that last case is a genuine full fill and belongs to `forgetLivePosition`
 * instead, never a partial reduction to zero/negative.
 */
export function reduceLivePositionQuantity(store: KeyValueStore, positionId: string, soldQuantity: number): boolean {
  const positions = readPositions(store);
  const existing = positions[positionId];
  if (!existing || !(soldQuantity > 0) || soldQuantity >= existing.quantity) return false;
  positions[positionId] = { ...existing, quantity: existing.quantity - soldQuantity };
  store.set(LIVE_OPEN_POSITIONS_KEY, positions);
  return true;
}

/**
 * Marks a position as having a real, already-submitted exit order at the
 * broker — call this the moment `runLiveOrderFlow` reports `'submitted'`
 * for an exit intent, BEFORE checking whether that report says `'filled'`.
 * A resting (not yet filled) sell order is exactly the case a second
 * exit-trigger (another `/sell`, or a future automatic re-check) must not
 * blindly submit another order for — see `LiveOpenPosition.outstandingExitSubmittedAt`.
 * No-ops for an untracked position id.
 */
export function markExitSubmitted(store: KeyValueStore, positionId: string, now: number): void {
  const positions = readPositions(store);
  const existing = positions[positionId];
  if (!existing) return;
  positions[positionId] = { ...existing, outstandingExitSubmittedAt: now };
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
