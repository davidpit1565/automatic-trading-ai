/**
 * Manual "buy now, for real" override (David asked for this 2026-09-03) —
 * lets a human trigger ONE real entry attempt for a symbol right now,
 * independent of whether the paper autopilot's own signal currently
 * approves anything for it. Built specifically so a human can PROVE the
 * live pipeline actually works end-to-end (a real buy, confirmed via
 * Telegram, submitted to Revolut X, then closeable via `/sell`) without
 * waiting on the algorithm's own signal — which, being genuinely selective,
 * can go days without opening anything.
 *
 * Still goes through EVERY mandatory safety step a paper-approved entry
 * does: sized by the SAME `assessTrade` risk engine against live equity
 * (`liveEntryMirror.mts`'s `mirrorApprovedEntries`, reused as-is — never
 * duplicated), verified against the broker's real instrument list, and
 * requires the SAME human confirmation tap via Telegram before anything
 * reaches Revolut X. The only thing this changes is what TRIGGERS the
 * attempt — a human typing `/buy`, not the signal engine — exactly the
 * same relationship `/sell` (`manualSellCommand.mts`) has to `decideLiveExit`.
 *
 * Uses a fixed, modest stop/target (-1.5% / +3%, a 2:1 reward:risk) since
 * there's no scanner-derived opportunity to size against for a manual
 * request — a human invoking this already knows it isn't signal-validated,
 * unlike every other entry this project ever takes.
 *
 * Reuses the exact same queue-with-stable-symbol-until-handed-off pattern
 * `manualSellCommand.mts` established: a `/buy` command's Telegram message
 * is consumed (offset advanced) the moment it's read, long before a price
 * fetch or confirmation resolves — so a symbol stays queued
 * (`manual-buy-pending-symbols`) across cycles until real price data is
 * available. Once handed to `mirrorApprovedEntries`, THAT function's own
 * persisted queue (`live-entry-pending`) takes over protecting it against
 * an unanswered confirmation — nothing here duplicates that.
 *
 * Called every cycle by `server/autopilotRunner.mts`'s `runLiveMirror` — but
 * that caller is itself a no-op unless `REAL_MONEY_ENABLED=true` AND real
 * broker credentials are configured (see its doc comment), so this stays
 * dormant until a human deliberately turns real money on.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import type { Instrument, Timeframe } from '../src/core/types';
import type { TradeOpportunity } from '../src/core/signal/signalEngine';
import { mirrorApprovedEntries, type LiveEntryOutcome, type MirrorApprovedEntriesOptions } from './liveEntryMirror.mts';
import type { LiveOrderFlowParams } from './liveOrchestrator.mts';
import {
  pollAllTelegramUpdates,
  sendTelegramMessage,
  stashUnclaimedTelegramUpdates,
  type TelegramConfig,
  type TelegramTextMessage,
} from './telegram.mts';

const MANUAL_BUY_PENDING_KEY = 'manual-buy-pending-symbols';
/** Fixed test/override levels — see this file's header for why these are
 * hardcoded rather than derived from a signal. 2:1 reward:risk. */
const STOP_PCT = 1.5;
const TARGET_PCT = 3;

/**
 * Parses a `/buy <SYMBOL>` command (case-insensitive, extra whitespace
 * tolerated) — same contract as `manualSellCommand.mts`'s `parseSellCommand`.
 */
export function parseBuyCommand(text: string): string | null {
  const match = /^\/buy\s+([a-z0-9]+)\s*$/i.exec(text.trim());
  return match ? match[1]!.toUpperCase() : null;
}

/**
 * Polls for new `/buy <SYMBOL>` commands since the last check and, for each
 * symbol with a request outstanding (newly arrived OR still pending from an
 * earlier cycle with no price data yet), builds a fixed-levels
 * `TradeOpportunity` at the current market price and hands it to
 * `mirrorApprovedEntries` — the exact same entry path a paper-approved
 * signal takes, with the exact same risk sizing, symbol verification, and
 * human confirmation.
 */
export async function checkManualBuyRequests(
  store: KeyValueStore,
  telegram: TelegramConfig,
  source: MarketDataSource,
  entryTimeframe: Timeframe,
  instruments: readonly Instrument[],
  prices: Readonly<Record<string, number>>,
  flowParams: Omit<LiveOrderFlowParams, 'intent'>,
  now: number,
  options: MirrorApprovedEntriesOptions = {},
  /**
   * The SAME store instance `/help`, `/tip`, `/status` and `/discover` poll
   * through — there is only ONE Telegram bot and ONE update offset. Defaults
   * to `store` for backward compatibility, but `autopilotRunner.mts` passes
   * the raw (unprefixed) store here specifically, not the `live:`-prefixed
   * one `store` itself is — see `checkManualSellRequests`'s matching
   * parameter for the real bug (found 2026-09-03) this fixes.
   */
  telegramStore: KeyValueStore = store,
): Promise<readonly LiveEntryOutcome[]> {
  // Shared poller (telegram.mts) — never poll Telegram directly here with a
  // private offset (see PROJECT_STATE.md's shared-cursor fix, 2026-09-02).
  const polled = await pollAllTelegramUpdates(telegramStore, telegram);
  const pendingSymbols = new Set(store.get<string[]>(MANUAL_BUY_PENDING_KEY) ?? []);
  const unclaimedMessages: TelegramTextMessage[] = [];
  for (const message of polled.messages) {
    const symbol = parseBuyCommand(message.text);
    if (symbol) {
      pendingSymbols.add(symbol);
      continue;
    }
    unclaimedMessages.push(message);
    // Real incident, 2026-09-04: a bare `/buy` (no symbol) used to be
    // silently swallowed here with zero feedback. Confirmed live — David
    // tapped the "לקנייה: /buy <SYMBOL>" line in a momentum-spike alert
    // (detectMomentumSpikes.mts) and only "/buy" got sent, because Telegram
    // only ever inserts the bare command token when you tap a bot-command
    // entity, never any text after it (platform behavior, not something a
    // message format can work around) — so the tap silently did nothing.
    if (/^\/buy\b/i.test(message.text.trim())) {
      await sendTelegramMessage('❌ /buy צריך סימבול, למשל: /buy USELESSEUR', telegram);
    }
  }
  stashUnclaimedTelegramUpdates(telegramStore, { messages: unclaimedMessages, callbacks: polled.callbacks });
  if (pendingSymbols.size === 0) return [];

  const opportunities: TradeOpportunity[] = [];
  const stillPending = new Set(pendingSymbols);
  for (const symbol of pendingSymbols) {
    const candles = await source.getCandles(symbol, entryTimeframe, 2);
    if (!candles.ok || candles.value.length === 0) continue; // stays queued, retried next cycle
    const price = candles.value[candles.value.length - 1]!.close;
    opportunities.push({
      symbol,
      timeframe: entryTimeframe,
      direction: 'long',
      levels: {
        entry: price,
        stopLoss: price * (1 - STOP_PCT / 100),
        takeProfit: price * (1 + TARGET_PCT / 100),
        riskReward: TARGET_PCT / STOP_PCT,
      },
      confidence: 0,
      confidenceComponents: [],
      explanation: 'manual /buy override — human-triggered, not derived from the scanner/signal engine',
      warnings: ['manual override: entry/stop/target are fixed defaults, not signal-derived'],
      basedOn: { score: 0, candleCount: candles.value.length },
    });
    // Handed off to mirrorApprovedEntries's own persisted queue below — this
    // function's queue only needs to hold a symbol until THAT point, same as
    // manualSellCommand.mts hands off to runLiveOrderFlow's own confirmation
    // resumability.
    stillPending.delete(symbol);
  }
  store.set(MANUAL_BUY_PENDING_KEY, [...stillPending]);
  if (opportunities.length === 0) return [];

  // Every manual /buy is eligible for the "not a great trade, but let me
  // anyway" override (David asked for this 2026-09-03) — NEVER set this for
  // a paper-mirrored autonomous entry, only a human-triggered one. See
  // `MirrorApprovedEntriesOptions.allowCapacityOverrideFor`'s doc comment.
  return mirrorApprovedEntries(store, opportunities, instruments, prices, flowParams, now, {
    ...options,
    allowCapacityOverrideFor: new Set(opportunities.map((o) => o.symbol)),
  });
}
