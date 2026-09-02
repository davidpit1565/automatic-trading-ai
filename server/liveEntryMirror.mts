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
import type { TradeOpportunity } from '../src/core/signal/signalEngine';
import { assessTrade, DEFAULT_RISK_LIMITS, type RiskLimits } from '../src/core/risk/riskEngine';
import { openLivePositions, recordLiveEntryFill } from './liveExitFlow.mts';
import { debitLiveCash, liveEquity } from './liveLedger.mts';
import { runLiveOrderFlow, buildLiveOrderIntent, type LiveOrderFlowParams, type LiveOrderFlowResult } from './liveOrchestrator.mts';
import { toRevolutXSymbol } from './revolutXBrokerAdapter.mts';

const PENDING_KEY = 'live-entry-pending';
const OUTSTANDING_KEY = 'live-entry-outstanding-symbols';

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
export async function mirrorApprovedEntries(
  store: KeyValueStore,
  newlyApproved: readonly TradeOpportunity[],
  instruments: readonly Instrument[],
  prices: Readonly<Record<string, number>>,
  flowParams: Omit<LiveOrderFlowParams, 'intent'>,
  now: number,
  options: { readonly riskLimits?: RiskLimits; readonly dailyLossSoFar?: number } = {},
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

  const openPositions = openLivePositions(store).map((p) => ({
    symbol: p.entryAssessment.asset,
    quantity: p.quantity,
    entryPrice: p.entryPrice,
    currentPrice: prices[p.entryAssessment.asset] ?? p.entryPrice,
  }));
  const equity = liveEquity(store, prices);

  for (const symbol of Object.keys(pending)) {
    const { opportunity } = pending[symbol]!;
    const assessment = assessTrade(
      opportunity,
      { equity, openPositions },
      { limits: riskLimits, dailyLossSoFar: options.dailyLossSoFar },
    );
    if (!assessment.approved) {
      outcomes.push({ symbol, outcome: 'not-approved', reasons: assessment.reasons });
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
    const intent = buildLiveOrderIntent(`live-entry:${symbol}`, assessment, now, brokerSymbol);
    const result = await runLiveOrderFlow({ ...flowParams, intent });
    outcomes.push({ symbol, ...result });
    if (result.outcome !== 'pending') delete pending[symbol];
    if (result.outcome === 'submitted') {
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
      }
    }
    store.set(PENDING_KEY, pending);
  }
  return outcomes;
}
