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
 * Actual submission goes through `liveExitMirror.mts`'s `proposeLiveExit` —
 * SHARED with the automatic exit checker, so a still-pending automatic exit
 * and a `/sell` for the SAME position resume the ONE queued attempt instead
 * of each building an independent confirmation (see that function's doc
 * comment for the real incident this fixed, 2026-09-03).
 *
 * Called every cycle by `server/autopilotRunner.mts`'s `runLiveMirror` — but
 * that caller is itself a no-op unless `REAL_MONEY_ENABLED=true` AND real
 * broker credentials are configured (see its doc comment), so this stays
 * dormant until a human deliberately turns real money on.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import type { Timeframe } from '../src/core/types';
import { openLivePositions, type LiveOpenPosition } from './liveExitFlow.mts';
import { proposeLiveExit } from './liveExitMirror.mts';
import type { LiveOrderFlowParams, LiveOrderFlowResult } from './liveOrchestrator.mts';
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
  | { readonly symbol: string; readonly outcome: 'outstanding-exit-already-pending' }
  /** Structurally possible from `proposeLiveExit`'s shared return type, but
   * never actually produced here — this caller always passes a non-null
   * `reason` ('manual'). */
  | { readonly symbol: string; readonly outcome: 'no-exit-signal' }
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
 * cycle's short poll), `'outstanding-exit-already-pending'` (an automatic
 * exit already owns this position's confirmation — see `proposeLiveExit`),
 * and `'no-price-data'` (a transient fetch failure) all keep it queued for
 * the next cycle instead of silently dropping it. This matters because the
 * Telegram MESSAGE is consumed (offset advanced) the moment it's read, long
 * before the order resolves — without a persisted queue, a `/sell` that
 * isn't approved inside the ~15s the confirmation gate actively polls would
 * vanish forever, even if the human taps the button five minutes later.
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
  /**
   * The SAME store instance `/help`, `/tip`, `/status` and `/discover` poll
   * through — there is only ONE Telegram bot and ONE update offset, and it
   * MUST be tracked in one place. Defaults to `store` for backward
   * compatibility, but `autopilotRunner.mts` passes the raw (unprefixed)
   * store here specifically, not the `live:`-prefixed one `store` itself
   * is. Real bug found 2026-09-03: this used to implicitly poll through
   * whatever `store` was (the live-prefixed one), which is a SEPARATE
   * key namespace from the one every other command handler polls through —
   * a `/sell` picked up by the outer (unprefixed) pollers first (they run
   * earlier in the cycle) got stashed into the unprefixed unclaimed-messages
   * key, where this function, reading the live-prefixed one, could never
   * find it. `/sell` silently never worked despite the bot clearly being
   * alive (other commands like `/discover` answered fine) — this is why.
   */
  telegramStore: KeyValueStore = store,
): Promise<readonly ManualSellOutcome[]> {
  // Shared poller (telegram.mts) — never poll Telegram directly here with a
  // private offset (a real bug, fixed 2026-09-02: see PROJECT_STATE.md).
  // Anything this function doesn't recognise (every callback_query, plus
  // any message that isn't a /sell command) is immediately stashed back so
  // OTHER consumers (the confirmation gate, the manual kill-switch) can
  // still find it — the raw Telegram update is already gone by now.
  const polled = await pollAllTelegramUpdates(telegramStore, telegram);
  const pendingSymbols = new Set(store.get<string[]>(MANUAL_SELL_PENDING_KEY) ?? []);
  const unclaimedMessages: TelegramTextMessage[] = [];
  for (const message of polled.messages) {
    const symbol = parseSellCommand(message.text);
    if (symbol) pendingSymbols.add(symbol);
    else unclaimedMessages.push(message);
  }
  stashUnclaimedTelegramUpdates(telegramStore, { messages: unclaimedMessages, callbacks: polled.callbacks });
  if (pendingSymbols.size === 0) return [];

  const positions = openLivePositions(store);
  const outcomes: ManualSellOutcome[] = [];
  for (const symbol of pendingSymbols) {
    try {
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
      const candles = await source.getCandles(position.entryAssessment.asset, entryTimeframe, 2);
      if (!candles.ok || candles.value.length === 0) {
        outcomes.push({ symbol, outcome: 'no-price-data' });
        // Stays queued (never deleted) — retried next cycle, never silently
        // dropped. Still persisted immediately, same reasoning as above.
        store.set(MANUAL_SELL_PENDING_KEY, [...pendingSymbols]);
        continue;
      }
      const price = candles.value[candles.value.length - 1]!.close;
      const result = await proposeLiveExit(store, position, 'manual', price, now, { flowParams, onRealizedPnl });
      outcomes.push({ symbol, ...result });
      if (result.outcome !== 'pending' && result.outcome !== 'outstanding-exit-already-pending') {
        pendingSymbols.delete(symbol);
      }
      store.set(MANUAL_SELL_PENDING_KEY, [...pendingSymbols]);
    } catch (cause) {
      // One symbol's transient failure must never stop every OTHER pending
      // /sell in this same pass from being checked (found in review,
      // 2026-09-03) — it stays queued (not deleted) and is retried next
      // cycle, same as a plain no-price-data outcome.
      console.error(`checkManualSellRequests failed for ${symbol}:`, cause instanceof Error ? cause.message : cause);
      outcomes.push({ symbol, outcome: 'no-price-data' });
      store.set(MANUAL_SELL_PENDING_KEY, [...pendingSymbols]);
    }
  }
  return outcomes;
}
