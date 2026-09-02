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
 * Tested, reusable machinery — like `liveOrchestrator.mts`/`liveExitFlow.mts`,
 * nothing calls this from any scheduled workflow yet.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import type { Timeframe } from '../src/core/types';
import { buildLiveExitIntent, openLivePositions, type LiveOpenPosition } from './liveExitFlow.mts';
import { runLiveOrderFlow, type LiveOrderFlowParams, type LiveOrderFlowResult } from './liveOrchestrator.mts';
import { getTelegramMessages, type TelegramConfig } from './telegram.mts';

const MANUAL_SELL_OFFSET_KEY = 'manual-sell-update-offset';

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
  | ({ readonly symbol: string } & LiveOrderFlowResult);

function findBySymbol(positions: readonly LiveOpenPosition[], symbol: string): LiveOpenPosition | undefined {
  return positions.find((p) => p.entryAssessment.asset === symbol);
}

/**
 * Polls for new `/sell` commands since the last check and, for each symbol
 * requesting one, proposes an immediate exit of that open live position.
 * `source.getCandles` is called with the position's INTERNAL symbol
 * (`entryAssessment.asset`), not `position.symbol` (already broker-native) —
 * `MarketDataSource` only understands the internal code.
 *
 * A `/sell` for a symbol with no tracked open position, or one whose price
 * can't be fetched right now, is reported (not silently dropped) but does
 * NOT re-queue the command — the human can simply send it again.
 */
export async function checkManualSellRequests(
  store: KeyValueStore,
  telegram: TelegramConfig,
  source: MarketDataSource,
  entryTimeframe: Timeframe,
  flowParams: Omit<LiveOrderFlowParams, 'intent'>,
  now: number,
): Promise<readonly ManualSellOutcome[]> {
  const offset = store.get<number>(MANUAL_SELL_OFFSET_KEY) ?? 0;
  const { messages, nextOffset } = await getTelegramMessages(telegram, offset);
  if (nextOffset !== offset) store.set(MANUAL_SELL_OFFSET_KEY, nextOffset);

  const requestedSymbols = new Set<string>();
  for (const message of messages) {
    const symbol = parseSellCommand(message.text);
    if (symbol) requestedSymbols.add(symbol);
  }
  if (requestedSymbols.size === 0) return [];

  const positions = openLivePositions(store);
  const outcomes: ManualSellOutcome[] = [];
  for (const symbol of requestedSymbols) {
    const position = findBySymbol(positions, symbol);
    if (!position) {
      outcomes.push({ symbol, outcome: 'no-open-position' });
      continue;
    }
    const candles = await source.getCandles(position.entryAssessment.asset, entryTimeframe, 2);
    if (!candles.ok || candles.value.length === 0) {
      outcomes.push({ symbol, outcome: 'no-price-data' });
      continue;
    }
    const price = candles.value[candles.value.length - 1]!.close;
    const intent = buildLiveExitIntent(`${position.id}:manual-sell:${now}`, position, price, now);
    const result = await runLiveOrderFlow({ ...flowParams, intent });
    outcomes.push({ symbol, ...result });
  }
  return outcomes;
}
