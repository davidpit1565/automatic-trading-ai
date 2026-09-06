/**
 * Mirrors a paper-autopilot-approved crypto entry into a real order for the
 * live account (2026-09-02) — the first piece of "the actual connection"
 * David asked to build once the safety layer underneath was independently
 * reviewed twice with nothing left to fix.
 *
 * The paper autopilot's own `TradeRiskAssessment` is NOT reused directly —
 * its `positionSize`/`riskAmount`/`portfolioExposure` were sized against the
 * PAPER account's equity ($10,000), meaningless for the real account (100€).
 * Instead this re-runs `assessTrade` on the SAME underlying `TradeOpportunity`
 * (entry/stop/target/confidence — those don't depend on account size),
 * against the LIVE account's own equity and open positions (`liveLedger.mts`,
 * `liveExitFlow.mts`). This is exactly what "paper and live are the same
 * pipeline" (docs/execution-architecture.md, property 3) requires: same
 * signal, same risk-engine function, independently sized inputs.
 *
 * Paper approves an entry for a symbol exactly ONCE (it then holds the
 * symbol and won't re-decide it) — the same one-time-event shape as a
 * human's `/sell` command, and the SAME "lost forever if not resolved this
 * cycle" risk applies unless queued and retried with a STABLE id until a
 * TERMINAL outcome (the real bug fixed in `manualSellCommand.mts`,
 * 2026-09-02 — this reuses that exact pattern, including the incremental-
 * persistence and outstanding-order guard against a duplicate submission).
 *
 * Called every cycle by `server/autopilotRunner.mts`'s `runLiveMirror` — but
 * that caller is itself a no-op unless `REAL_MONEY_ENABLED=true` AND real
 * broker credentials are configured (see its doc comment), so this stays
 * dormant until a human deliberately turns real money on.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { Instrument } from '../src/core/types';
import type { OrderIntent } from '../src/core/execution/types';
import type { TradeOpportunity } from '../src/core/signal/signalEngine';
import { assessTrade, confidenceScaledRiskPct, DEFAULT_RISK_LIMITS, type RiskLimits } from '../src/core/risk/riskEngine';
import { openLivePositions, recordLiveEntryFill } from './liveExitFlow.mts';
import { debitLiveCash, liveCash, liveEquity } from './liveLedger.mts';
import { runLiveOrderFlow, buildLiveOrderIntent, type LiveOrderFlowParams, type LiveOrderFlowResult } from './liveOrchestrator.mts';
import { toRevolutXSymbol } from './revolutXBrokerAdapter.mts';

const PENDING_KEY = 'live-entry-pending';
const OUTSTANDING_KEY = 'live-entry-outstanding-symbols';
const RESTING_ENTRY_KEY = 'live-resting-entry-intents';

function readRestingEntryIntents(store: KeyValueStore): Record<string, OrderIntent> {
  return store.get<Record<string, OrderIntent>>(RESTING_ENTRY_KEY) ?? {};
}

/**
 * Remembers a just-submitted BUY intent that reached the broker but has not
 * genuinely filled AT ALL yet (a resting limit order — `hasRealExposure` is
 * true but `recordLiveEntryFill` returned false) — keyed by this project's
 * INTERNAL symbol (`intent.assessment.asset`).
 *
 * Found in review, 2026-09-06: there is no fill-status poller for a resting
 * order (see `revolutXBrokerAdapter.mts`'s doc comment) — the ONLY thing
 * that ever notices it later fill is `liveManualTradeSync.mts`'s broker-
 * balance reconciliation, which otherwise cannot tell "this bot's own slow
 * order just filled" apart from "David bought this directly in the app,"
 * and previously always guessed the latter — discarding the real
 * risk-engine-derived stop/target/entry a human already approved via
 * Telegram in favor of a generic manual-override guess, and misreporting an
 * order THIS bot placed as an external trade. See
 * `liveManualTradeSync.mts`'s `reconcileExternalBuy` for the other half of
 * this fix.
 */
export function rememberRestingEntryIntent(store: KeyValueStore, symbol: string, intent: OrderIntent): void {
  const map = readRestingEntryIntents(store);
  map[symbol] = intent;
  store.set(RESTING_ENTRY_KEY, map);
}

/** The still-resting (not yet filled at all) BUY intent this bot itself
 * submitted for `symbol`, if any — see `rememberRestingEntryIntent`. */
export function readRestingEntryIntent(store: KeyValueStore, symbol: string): OrderIntent | null {
  return readRestingEntryIntents(store)[symbol] ?? null;
}

/** Call once a resting entry is resolved — genuinely filled (matched and
 * recorded by `liveManualTradeSync.mts`) or the position is otherwise
 * cleared. No-ops if none was recorded for `symbol`. */
export function clearRestingEntryIntent(store: KeyValueStore, symbol: string): void {
  const map = readRestingEntryIntents(store);
  if (!(symbol in map)) return;
  delete map[symbol];
  store.set(RESTING_ENTRY_KEY, map);
}

interface PendingEntry {
  readonly opportunity: TradeOpportunity;
  readonly queuedAt: number;
}

function readPending(store: KeyValueStore): Record<string, PendingEntry> {
  return store.get<Record<string, PendingEntry>>(PENDING_KEY) ?? {};
}

function readOutstanding(store: KeyValueStore): Set<string> {
  return new Set(store.get<string[]>(OUTSTANDING_KEY) ?? []);
}

function writeOutstanding(store: KeyValueStore, outstanding: ReadonlySet<string>): void {
  store.set(OUTSTANDING_KEY, [...outstanding]);
}

/**
 * Call once a symbol's position is confirmed fully closed (i.e. right
 * alongside `forgetLivePosition`, `liveExitFlow.mts`) — clears the
 * outstanding-entry flag so a FUTURE fresh entry for the same symbol isn't
 * incorrectly blocked forever by a long-since-resolved earlier attempt.
 * No-ops if the symbol was never marked outstanding.
 */
export function clearOutstandingEntry(store: KeyValueStore, symbol: string): void {
  const outstanding = readOutstanding(store);
  if (!outstanding.delete(symbol)) return;
  writeOutstanding(store, outstanding);
}

export type LiveEntryOutcome =
  | { readonly symbol: string; readonly outcome: 'entry-already-outstanding' }
  | { readonly symbol: string; readonly outcome: 'not-approved'; readonly reasons: readonly string[] }
  | { readonly symbol: string; readonly outcome: 'no-broker-symbol' }
  | { readonly symbol: string; readonly outcome: 'error'; readonly detail: string }
  | ({ readonly symbol: string } & LiveOrderFlowResult);

/**
 * Call once per cycle with every symbol the PAPER autopilot just approved a
 * NEW entry for THIS cycle (`newlyApproved`) — queues each (keyed by
 * internal symbol) unless one is already open or already has an outstanding
 * unresolved attempt, then attempts every queued entry in turn.
 *
 * `prices` and `instruments` use this project's INTERNAL symbol convention
 * (e.g. 'XBTEUR') — translated to the broker-native pair only at the point
 * of building the order intent, via `toRevolutXSymbol`.
 *
 * A symbol reaching `runLiveOrderFlow`'s `'submitted'` outcome is marked
 * outstanding REGARDLESS of fill state (a resting, not-yet-filled buy is
 * still a real, live order) — cleared by the caller via
 * `clearOutstandingEntry` once that symbol's position is later confirmed
 * fully closed (alongside `forgetLivePosition`). Until then a resting order
 * that never fills is a known, honest limitation: it blocks further entry
 * attempts for that symbol until a human intervenes (there is no
 * reconciliation poller yet — see PROJECT_STATE.md) — the safe direction
 * to fail in.
 */
export interface MirrorApprovedEntriesOptions {
  readonly riskLimits?: RiskLimits;
  readonly dailyLossSoFar?: number;
  /**
   * Mirrors paper's own confidence-scaled risk (`confidenceRisk` on
   * `PaperAutoPilot`/`AUTOPILOT_CONFIDENCE_RISK`) — without this, every
   * live entry sized at the flat `riskLimits.maxRiskPerTradePct` ceiling
   * regardless of how strong the signal was, contradicting this module's
   * own "same risk sizing" claim (found in review, 2026-09-03). Omit to
   * fall back to the risk engine's own flat-ceiling default.
   */
  readonly confidenceRisk?: {
    readonly floorPct: number;
    readonly ceilingPct: number;
    readonly confidenceFloor: number;
    readonly maxConfidence: number;
  };
  /**
   * Symbols allowed to override a portfolio-capacity refusal (max open
   * positions / per-asset exposure / correlated-cluster exposure) — David
   * asked for this 2026-09-03: "if it's not a good trade, tell me why, but
   * still let me buy it if I decide to." ONLY ever set for a human-initiated
   * `/buy` (`manualBuyCommand.mts`) — NEVER for an autonomous paper-mirrored
   * entry, which must keep respecting every cap unconditionally.
   *
   * When a listed symbol's FIRST assessment is refused, this re-assesses
   * with `ignorePortfolioCapacityCaps: true` (see riskEngine.ts — covers max
   * open positions, per-asset/correlated-cluster/total exposure; the
   * single-position size ceiling still applies regardless). If THAT still
   * refuses (a fundamental check failed — invalid stop, reward:risk out of
   * bounds, the daily-loss circuit breaker, or non-positive equity — none of
   * which are ever overridable), the original refusal stands unchanged. If
   * it now approves, the entry proceeds sized against the override — but
   * still goes through every OTHER unconditional safety check exactly as
   * normal (real free cash, the broker's own symbol list, the kill switch,
   * and a human's Telegram confirmation tap, which now also SHOWS the
   * original refusal as a warning — see `telegramConfirmationGate.mts`'s
   * `buildConfirmationMessage`) — this only widens which SETUPS reach that
   * confirmation, never what happens after.
   */
  readonly allowCapacityOverrideFor?: ReadonlySet<string>;
}

export async function mirrorApprovedEntries(
  store: KeyValueStore,
  newlyApproved: readonly TradeOpportunity[],
  instruments: readonly Instrument[],
  prices: Readonly<Record<string, number>>,
  flowParams: Omit<LiveOrderFlowParams, 'intent'>,
  now: number,
  options: MirrorApprovedEntriesOptions = {},
): Promise<readonly LiveEntryOutcome[]> {
  const riskLimits = options.riskLimits ?? DEFAULT_RISK_LIMITS;
  const outstanding = readOutstanding(store);
  const alreadyOpen = new Set(openLivePositions(store).map((p) => p.entryAssessment.asset));
  const pending = readPending(store);
  const outcomes: LiveEntryOutcome[] = [];

  for (const opportunity of newlyApproved) {
    if (outstanding.has(opportunity.symbol) || alreadyOpen.has(opportunity.symbol)) {
      outcomes.push({ symbol: opportunity.symbol, outcome: 'entry-already-outstanding' });
      continue;
    }
    if (!(opportunity.symbol in pending)) {
      pending[opportunity.symbol] = { opportunity, queuedAt: now };
    }
  }
  store.set(PENDING_KEY, pending);
  if (Object.keys(pending).length === 0) return outcomes;

  for (const symbol of Object.keys(pending)) {
    try {
      const { opportunity } = pending[symbol]!;
      // Re-read equity/open-positions FRESH on every iteration, not once
      // before the loop — a real bug found in review (2026-09-03): when a
      // cycle has MULTIPLE symbols pending at once (the paper autopilot can
      // approve several entries in one scan), a fill from an EARLIER symbol
      // in this same loop (debited cash, a new tracked position) must be
      // visible to the NEXT symbol's risk assessment. Sizing every pending
      // symbol against the SAME stale pre-loop snapshot let two entries
      // jointly blow past maxOpenPositions/maxTotalExposurePct/per-asset
      // caps that each looked fine in isolation, and could size a second buy
      // against cash the first buy had already spent.
      const openPositions = openLivePositions(store).map((p) => ({
        symbol: p.entryAssessment.asset,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        currentPrice: prices[p.entryAssessment.asset] ?? p.entryPrice,
      }));
      const equity = liveEquity(store, prices);
      const cr = options.confidenceRisk;
      const riskPerTradePct = cr
        ? confidenceScaledRiskPct(opportunity.confidence, cr.confidenceFloor, cr.maxConfidence, cr.floorPct, cr.ceilingPct)
        : undefined;
      let assessment = assessTrade(
        opportunity,
        { equity, openPositions },
        { limits: riskLimits, dailyLossSoFar: options.dailyLossSoFar, riskPerTradePct },
      );
      if (!assessment.approved && options.allowCapacityOverrideFor?.has(symbol)) {
        // David asked for this 2026-09-03: a human `/buy` refused only for
        // exposure/position-count reasons can still be sized and offered to
        // the human anyway, with the ORIGINAL refusal shown as a warning —
        // see `MirrorApprovedEntriesOptions.allowCapacityOverrideFor`'s doc
        // comment. If ignoring those caps STILL doesn't approve it, a
        // fundamental check failed (never overridable) — fall through with
        // the ORIGINAL assessment/reasons, unchanged.
        const overridden = assessTrade(
          opportunity,
          { equity, openPositions },
          { limits: riskLimits, dailyLossSoFar: options.dailyLossSoFar, riskPerTradePct, ignorePortfolioCapacityCaps: true },
        );
        if (overridden.approved) {
          assessment = {
            ...overridden,
            warnings: [
              ...overridden.warnings,
              `manual override: normally refused — ${assessment.reasons.join('; ')}`,
            ],
          };
        }
      }
      if (!assessment.approved) {
        outcomes.push({ symbol, outcome: 'not-approved', reasons: assessment.reasons });
        delete pending[symbol];
        store.set(PENDING_KEY, pending);
        continue;
      }
      // Found in review, 2026-09-03: `assessment.positionValue` is sized
      // against total LIVE equity (cash + open positions' current value),
      // but an order can only actually be paid for out of free CASH — with
      // an open position already holding some of that equity, an approved
      // position size can exceed what's actually spendable. Sending a
      // confirmation for a trade the account can't pay for wastes a human
      // approval and would only be caught later by the broker rejecting it.
      const availableCash = liveCash(store);
      if (assessment.positionValue > availableCash) {
        outcomes.push({
          symbol,
          outcome: 'not-approved',
          reasons: [
            `Position value €${assessment.positionValue.toFixed(2)} exceeds available cash €${availableCash.toFixed(2)}`,
          ],
        });
        delete pending[symbol];
        store.set(PENDING_KEY, pending);
        continue;
      }
      const brokerSymbol = toRevolutXSymbol(assessment.asset, instruments);
      if (!brokerSymbol) {
        outcomes.push({ symbol, outcome: 'no-broker-symbol' });
        delete pending[symbol];
        store.set(PENDING_KEY, pending);
        continue;
      }
      // 2026-09-03 real incident: Revolut X rejected a genuinely NEW /buy
      // attempt as a duplicate ("client_order_id ... has already been
      // placed") because deterministicClientOrderId
      // (revolutXBrokerAdapter.mts) derives purely from intent.id, and
      // intent.id used to be just `live-entry:${symbol}` — identical for
      // EVERY attempt ever made on this symbol, not only retries of the SAME
      // attempt. Embedding this pending entry's own queuedAt keeps retries of
      // ONE attempt stable (queuedAt is set once when first queued above and
      // doesn't change until this entry resolves and is deleted from
      // `pending`) while giving a genuinely later, separate attempt for the
      // same symbol a fresh id.
      const intent = buildLiveOrderIntent(
        `live-entry:${symbol}:${pending[symbol]!.queuedAt}`,
        assessment,
        now,
        brokerSymbol,
      );
      const result = await runLiveOrderFlow({ ...flowParams, intent });
      outcomes.push({ symbol, ...result });
      if (result.outcome !== 'pending') delete pending[symbol];
      // Only a report that represents REAL, still-live exposure (a genuine
      // fill, partial or full, or a resting order still open at the broker)
      // should block future attempts for this symbol — a broker-level
      // 'rejected'/'cancelled' report is a real 'submitted' outcome (it DID
      // reach runLiveOrderFlow's terminal broker-call branch) but leaves
      // NOTHING open. Found 2026-09-03: this symbol got stuck "outstanding"
      // forever after Revolut X rejected an approved order (HTTP 400) — no
      // position was ever opened, so `clearOutstandingEntry` (only called
      // when a position is later confirmed closed) could never run, and
      // every subsequent /buy for the same symbol was silently swallowed by
      // the `outstanding.has(...)` guard at the top of this function with no
      // Telegram response at all.
      const hasRealExposure = result.outcome === 'submitted' && result.report.state !== 'rejected' && result.report.state !== 'cancelled';
      if (hasRealExposure) {
        outstanding.add(symbol);
        writeOutstanding(store, outstanding);
        // A genuinely (fully or partially) filled buy must actually be
        // tracked as an open live position — otherwise it's invisible to
        // stop-loss/take-profit enforcement, to `liveExitMirror.mts`'s
        // automatic exit checking, and to `liveEquity` (the exact "invisible
        // real exposure" class of bug already fixed once tonight at the
        // broker-adapter level for partial fills — reintroduced here at the
        // caller level, now fixed the same way).
        if (recordLiveEntryFill(store, intent, result.report, now)) {
          const fillPrice = result.report.avgFillPrice ?? intent.limitPrice;
          debitLiveCash(store, result.report.filledQuantity * fillPrice);
          clearRestingEntryIntent(store, symbol);
        } else {
          // Genuinely submitted but zero filled so far (a resting limit
          // order) — remember the ORIGINAL intent so that if this exact
          // order fills later (only ever noticed via
          // liveManualTradeSync.mts's broker-balance reconciliation, since
          // there is no fill-status poller), it's attributed back to this
          // bot's own approved risk assessment instead of a generic guess.
          // See `rememberRestingEntryIntent`'s doc comment.
          rememberRestingEntryIntent(store, symbol, intent);
        }
      }
      store.set(PENDING_KEY, pending);
    } catch (cause) {
      // One symbol's transient failure (a network error, an unexpected
      // broker response) must never stop every OTHER pending symbol in this
      // same cycle from being attempted (found in review, 2026-09-03) — it
      // stays queued (not deleted from `pending`) and is retried next cycle.
      console.error(`mirrorApprovedEntries failed for ${symbol}:`, cause instanceof Error ? cause.message : cause);
      outcomes.push({ symbol, outcome: 'error', detail: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return outcomes;
}
