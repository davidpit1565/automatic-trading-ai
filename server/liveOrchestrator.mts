/**
 * Live order flow — wires `ConfirmationGate` → `BrokerAdapter` together
 * (docs/execution-architecture.md, "What Stage 6 must add", item "Wiring").
 *
 * This closes the last unchecked item on that checklist as TESTED,
 * REUSABLE machinery — it is NOT invoked by any scheduled workflow.
 * Nothing in `.github/workflows/*.yml` calls this file. Turning continuous
 * live trading on (which live signal source feeds it, which asset universe,
 * on what schedule) is a separate, larger decision this file deliberately
 * does not make — David asked to continue building Stage 6's wiring, not to
 * start autonomous live trading tonight.
 *
 * Every order still goes through the full non-negotiable chain: kill-switch
 * check, symbol verified against the broker's OWN real instrument list
 * (never guessed — see `verifySymbolExists`, MANDATORY for any broker whose
 * `mode` is `'live'`; `runLiveOrderFlow` refuses outright rather than
 * silently skipping the check if it's missing), human confirmation via
 * `ConfirmationGate`, only then `BrokerAdapter.submit`. Every refusal is
 * audited too, not just the eventual approve/reject/submit — a blocked or
 * unknown-symbol attempt still leaves a record of having happened.
 *
 * Scope note: this handles the BUY/entry side only (`buildLiveOrderIntent`
 * maps an already risk-approved `TradeRiskAssessment` to an OrderIntent).
 * Live position EXITS are a materially different problem — deciding *when*
 * to exit a real, already-filled position against live price action — and
 * are intentionally not built here.
 *
 * Symbol translation (the open question from PR #101/#102): a caller MUST
 * translate this project's internal instrument symbol (e.g. Kraken's
 * 'XBTEUR') to the broker's own pair symbol (e.g. Revolut X's 'BTC-EUR')
 * with `toRevolutXSymbol` (`server/revolutXBrokerAdapter.mts`) BEFORE
 * calling `buildLiveOrderIntent` — pass the RESULT as `brokerSymbol`, not
 * the raw internal code. `verifySymbolExists` can then simply be
 * `revolutXAdapter.listTradablePairs().then(pairs => pairs.includes(intent.symbol))`
 * — safe, because by this point `intent.symbol` is already broker-native.
 */

import type {
  AuditLog,
  BrokerAdapter,
  ConfirmationGate,
  KillSwitch,
  OrderIntent,
  OrderStatusReport,
} from '../src/core/execution/types';
import type { TradeRiskAssessment } from '../src/core/risk/riskEngine';
import { ConfirmationPendingError } from './telegramConfirmationGate.mts';

export type LiveOrderFlowResult =
  | { readonly outcome: 'blocked-by-kill-switch' }
  | { readonly outcome: 'missing-symbol-check' }
  | { readonly outcome: 'unknown-symbol'; readonly detail: string }
  | { readonly outcome: 'pending' }
  | { readonly outcome: 'rejected'; readonly decidedBy: string }
  | { readonly outcome: 'submitted'; readonly report: OrderStatusReport };

export interface LiveOrderFlowParams {
  readonly intent: OrderIntent;
  readonly confirmationGate: ConfirmationGate;
  readonly brokerAdapter: BrokerAdapter;
  readonly killSwitch: KillSwitch;
  readonly audit: AuditLog;
  /**
   * Confirms `intent.symbol` is a real, currently tradable instrument on the
   * target broker BEFORE a human is ever asked to approve it. Expects
   * `intent.symbol` to ALREADY be in the broker's own format (see the
   * module-level "Symbol translation" note above) — this only checks
   * existence, it does not translate.
   * **Mandatory whenever `brokerAdapter.mode === 'live'`** —
   * `runLiveOrderFlow` refuses outright rather than silently skipping the
   * check if it's missing. Omit only for a simulator with no real
   * instrument list to check against (e.g. `PaperBrokerAdapter`, which
   * already validates against local state and never runs in `'live'` mode).
   */
  readonly verifySymbolExists?: (symbol: string) => Promise<boolean>;
}

/**
 * Maps an already risk-approved buy assessment to a live OrderIntent.
 *
 * `brokerSymbol` must ALREADY be the broker's own pair symbol (e.g.
 * 'BTC-EUR'), translated from `assessment.asset` (this project's internal
 * code, e.g. 'XBTEUR') via `toRevolutXSymbol` — this function does not
 * translate, it only assembles the intent. `assessment.asset` itself is
 * preserved unchanged inside `assessment` for traceability/audit.
 *
 * The caller supplies `id` and is responsible for reusing the SAME id
 * across retries of the same proposal — that's what lets `ConfirmationGate`
 * resume instead of re-sending the approval request.
 */
export function buildLiveOrderIntent(
  id: string,
  assessment: TradeRiskAssessment,
  now: number,
  brokerSymbol: string,
): OrderIntent {
  return {
    id,
    createdAt: now,
    mode: 'live',
    symbol: brokerSymbol,
    side: 'buy',
    quantity: assessment.positionSize,
    limitPrice: assessment.entry,
    stopLoss: assessment.stopLoss,
    takeProfit: assessment.takeProfit,
    assessment,
  };
}

export async function runLiveOrderFlow(params: LiveOrderFlowParams): Promise<LiveOrderFlowResult> {
  const { intent, confirmationGate, brokerAdapter, killSwitch, audit, verifySymbolExists } = params;

  if (killSwitch.isEngaged()) {
    audit.append({
      timestamp: Date.now(),
      intentId: intent.id,
      event: 'cancelled',
      mode: intent.mode,
      detail: 'kill switch engaged — order never reached the confirmation gate',
    });
    return { outcome: 'blocked-by-kill-switch' };
  }

  if (brokerAdapter.mode === 'live' && !verifySymbolExists) {
    audit.append({
      timestamp: Date.now(),
      intentId: intent.id,
      event: 'rejected',
      mode: intent.mode,
      detail: `refusing to propose a live order with no symbol check wired against ${brokerAdapter.name}`,
    });
    return { outcome: 'missing-symbol-check' };
  }

  if (verifySymbolExists) {
    const exists = await verifySymbolExists(intent.symbol);
    if (!exists) {
      const detail =
        `could not verify '${intent.symbol}' as a currently tradable instrument on ` +
        `${brokerAdapter.name} (either it doesn't exist there, or the check itself failed) — ` +
        'refusing rather than guessing a symbol mapping';
      audit.append({ timestamp: Date.now(), intentId: intent.id, event: 'rejected', mode: intent.mode, detail });
      return { outcome: 'unknown-symbol', detail };
    }
  }

  let decision;
  try {
    decision = await confirmationGate.requestConfirmation(intent);
  } catch (cause) {
    if (cause instanceof ConfirmationPendingError) return { outcome: 'pending' };
    throw cause;
  }

  if (!decision.approved) {
    return { outcome: 'rejected', decidedBy: decision.decidedBy };
  }

  const report = await brokerAdapter.submit(intent);
  return { outcome: 'submitted', report };
}
