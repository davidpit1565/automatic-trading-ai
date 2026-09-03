/**
 * Manual "sell whenever I want" override (David asked for this 2026-09-02).
 *
 * Every exit still goes through the exact same safety chain as any other
 * live order (`runLiveOrderFlow`: kill-switch, symbol check, human
 * confirmation via `ConfirmationGate`) — this only changes what TRIGGERS an
 * exit intent. `decideLiveExit` (liveExitFlow.mts) proposes one when the
 * algorithm's own stop/target/trend logic says to; this proposes one the
 * moment a human types `/sell <SYMBOL>` to the bot, independent of what the
 * algorithm currently thinks. Nothing here bypasses the confirmation tap —
 * see that file's header for why an exit is never auto-approved either.
 *
 * Called every cycle by `server/autopilotRunner.mts`'s `runLiveMirror` — but
 * that caller is itself a no-op unless `REAL_MONEY_ENABLED=true` AND real
 * broker credentials are configured (see its doc comment), so this stays
 * dormant until a human deliberately turns real money on.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import type { Timeframe } from '../src/core/types';
import {
  buildLiveExitIntent,
  forgetLivePosition,
  markExitSubmitted,
  openLivePositions,
  reduceLivePositionQuantity,
  type LiveOpenPosition,
} from './liveExitFlow.mts';
import { clearOutstandingEntry } from './liveEntryMirror.mts';
import { creditLiveCash } from './liveLedger.mts';
import { runLiveOrderFlow, type LiveOrderFlowParams, type LiveOrderFlowResult } from './liveOrchestrator.mts';
import {
  pollAllTelegramUpdates,
  stashUnclaimedTelegramUpdates,
  type TelegramConfig,
  type TelegramTextMessage,
} from './telegram.mts';

const MANUAL_SELL_PENDING_KEY = 'manual-sell-pending-symbols';

/**
 * Parses a `/sell <SYMBOL>` command (case-insensitive, extra whitespace
 * tolerated). `SYMBOL` matches this project's internal instrument code
 * (e.g. 'XBTEUR', the same code shown throughout the rest of the app), not
 * the broker-native pair symbol — that translation happens internally, a
 * human should never need to know it. Returns null for anything else,
 * including a `/sell` with no symbol.
 */
export function parseSellCommand(text: string): string | null {
  const match = /^\/sell\s+([a-z0-9]+)\s*$/i.exec(text.trim());
  return match ? match[1]!.toUpperCase() : null;
}

export type ManualSellOutcome =
  | { readonly symbol: string; readonly outcome: 'no-open-position' }
  | { readonly symbol: string; readonly outcome: 'no-price-data' }
  | { readonly symbol: string; readonly outcome: 'exit-already-submitted' }
  | ({ readonly symbol: string } & LiveOrderFlowResult);

function findBySymbol(positions: readonly LiveOpenPosition[], symbol: string): LiveOpenPosition | undefined {
  return positions.find((p) => p.entryAssessment.asset === symbol);
}

/**
 * Polls for new `/sell` commands since the last check and, for each symbol
 * with a request outstanding (newly arrived OR still pending from an
 * earlier cycle), proposes an immediate exit of that open live position.
 * `source.getCandles` is called with the position's INTERNAL symbol
 * (`entryAssessment.asset`), not `position.symbol` (already broker-native) —
 * `MarketDataSource` only understands the internal code.
 *
 * **A request stays queued (`manual-sell-pending-symbols`) until it reaches
 * a TERMINAL outcome** (submitted, rejected, blocked, unknown-symbol, or no
 * matching position) — `'pending'` (nobody tapped the button within this
 * cycle's short poll) and `'no-price-data'` (a transient fetch failure) both
 * keep it queued for the next cycle instead of silently dropping it. This
 * matters because the Telegram MESSAGE is consumed (offset advanced) the
 * moment it's read, long before the order resolves — without a persisted
 * queue, a `/sell` that isn't approved inside the ~15s the confirmation gate
 * actively polls would vanish forever, even if the human taps the button
 * five minutes later (a real bug caught before this shipped: the exit
 * intent's id used to include the wall-clock `now`, so a resumed call would
 * never rebuild the SAME id `TelegramConfirmationGate` needs to resume
 * polling — see PROJECT_STATE.md). The id is now stable
 * (`${position.id}:manual-sell`) for exactly this reason.
 */
export async function checkManualSellRequests(
  store: KeyValueStore,
  telegram: TelegramConfig,
  source: MarketDataSource,
  entryTimeframe: Timeframe,
  flowParams: Omit<LiveOrderFlowParams, 'intent'>,
  now: number,
  /** Reports realized P&L on a genuinely filled sell — feeds the live
   * account's daily-loss circuit breaker, same as the automatic exit mirror
   * (`liveExitMirror.mts`'s `checkAutomaticExits`). Optional so this stays
   * callable exactly as before wherever a caller has no tracker to feed. */
  onRealizedPnl?: (pnl: number, now: number) => void,
): Promise<readonly ManualSellOutcome[]> {
  // Shared poller (telegram.mts) — never poll Telegram directly here with a
  // private offset (a real bug, fixed 2026-09-02: see PROJECT_STATE.md).
  // Anything this function doesn't recognise (every callback_query, plus
  // any message that isn't a /sell command) is immediately stashed back so
  // OTHER consumers (the confirmation gate, the manual kill-switch) can
  // still find it — the raw Telegram update is already gone by now.
  const polled = await pollAllTelegramUpdates(store, telegram);
  const pendingSymbols = new Set(store.get<string[]>(MANUAL_SELL_PENDING_KEY) ?? []);
  const unclaimedMessages: TelegramTextMessage[] = [];
  for (const message of polled.messages) {
    const symbol = parseSellCommand(message.text);
    if (symbol) pendingSymbols.add(symbol);
    else unclaimedMessages.push(message);
  }
  stashUnclaimedTelegramUpdates(store, { messages: unclaimedMessages, callbacks: polled.callbacks });
  if (pendingSymbols.size === 0) return [];

  const positions = openLivePositions(store);
  const outcomes: ManualSellOutcome[] = [];
  for (const symbol of pendingSymbols) {
    const position = findBySymbol(positions, symbol);
    if (!position) {
      outcomes.push({ symbol, outcome: 'no-open-position' });
      pendingSymbols.delete(symbol);
      // Persisted immediately after EACH symbol, not once after the whole
      // loop — an exception on a LATER symbol in this same pass (a network
      // error from getCandles, say) must not roll back an earlier symbol's
      // already-decided outcome back into the pending queue.
      store.set(MANUAL_SELL_PENDING_KEY, [...pendingSymbols]);
      continue;
    }
    // A previous /sell for this SAME position already reached a real
    // broker submission (found in an independent review, 2026-09-02): once
    // that happens, the stable intent id's confirmation record is resolved,
    // so a later /sell would be treated as a brand-new request and could
    // submit a SECOND real sell order while the first is still resting
    // (not yet filled). Refuse instead — the position stays tracked and
    // protected either way, and a genuinely filled first sell will have
    // already forgotten the position, so this branch never blocks a
    // legitimate re-sell of a position that's actually still open.
    if (position.outstandingExitSubmittedAt !== undefined) {
      outcomes.push({ symbol, outcome: 'exit-already-submitted' });
      pendingSymbols.delete(symbol);
      store.set(MANUAL_SELL_PENDING_KEY, [...pendingSymbols]);
      continue;
    }
    const candles = await source.getCandles(position.entryAssessment.asset, entryTimeframe, 2);
    if (!candles.ok || candles.value.length === 0) {
      outcomes.push({ symbol, outcome: 'no-price-data' });
      // Stays queued (never deleted) — retried next cycle, never silently
      // dropped. Still persisted immediately, same reasoning as above.
      store.set(MANUAL_SELL_PENDING_KEY, [...pendingSymbols]);
      continue;
    }
    const price = candles.value[candles.value.length - 1]!.close;
    const intent = buildLiveExitIntent(`${position.id}:manual-sell`, position, price, now);
    const result = await runLiveOrderFlow({ ...flowParams, intent });
    outcomes.push({ symbol, ...result });
    if (result.outcome !== 'pending') pendingSymbols.delete(symbol);
    if (result.outcome === 'submitted') {
      // A REAL order now exists at the broker regardless of fill state —
      // mark it immediately so a later /sell for this symbol refuses
      // instead of risking a second real sell order (see
      // `outstandingExitSubmittedAt`'s doc comment).
      markExitSubmitted(store, position.id, now);
      // A genuinely FILLED sell must stop being tracked as an open
      // position — otherwise it would still look "open" to everything
      // else (decideLiveExit, a future /sell). 'submitted' alone is NOT
      // enough (the broker may only have accepted a resting order, not yet
      // filled it) — only a confirmed fill forgets it.
      const fillPrice = result.report.avgFillPrice ?? price;
      if (result.report.state === 'filled') {
        creditLiveCash(store, result.report.filledQuantity * fillPrice);
        onRealizedPnl?.((fillPrice - position.entryPrice) * result.report.filledQuantity, now);
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
        onRealizedPnl?.((fillPrice - position.entryPrice) * result.report.filledQuantity, now);
        reduceLivePositionQuantity(store, position.id, result.report.filledQuantity);
      }
    }
    store.set(MANUAL_SELL_PENDING_KEY, [...pendingSymbols]);
  }
  return outcomes;
}
