/**
 * `/retry` — re-check the last entry the owner declined or let expire
 * (David asked 2026-10-21 after answering a SOLEUR confirmation too late).
 *
 * It never approves or places anything. It re-validates the ORIGINAL signal's
 * stop/target against the CURRENT price; only if the trade is still sound does
 * it hand a fresh opportunity to `mirrorApprovedEntries` — the same entry path
 * as a paper-approved signal (live sizing, caps, symbol check, kill switch) —
 * which sends a NEW Telegram confirmation that again needs an explicit tap.
 *
 * "Still worth it" is deliberately conservative: not stopped out, not at
 * target, not chased more than `MAX_CHASE_PCT` above the signal price, not
 * fallen more than halfway to the stop, and not older than `MAX_AGE_MS`.
 * Reward:risk is recomputed at the current price and then re-checked by the
 * risk engine like any other entry.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import type { Instrument, Timeframe } from '../src/core/types';
import type { TradeOpportunity } from '../src/core/signal/signalEngine';
import {
  clearLastDeclinedEntry,
  mirrorApprovedEntries,
  readLastDeclinedEntry,
  type LiveEntryOutcome,
  type MirrorApprovedEntriesOptions,
} from './liveEntryMirror.mts';
import type { LiveOrderFlowParams } from './liveOrchestrator.mts';
import {
  pollAllTelegramUpdates,
  sendTelegramMessage,
  stashUnclaimedTelegramUpdates,
  type TelegramConfig,
  type TelegramTextMessage,
} from './telegram.mts';

export const RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const RETRY_MAX_CHASE_PCT = 1;

export function parseRetryCommand(text: string): boolean {
  return /^\/(retry|שוב)\s*$/i.test(text.trim());
}

export type RetryDecision =
  | { readonly ok: true; readonly opportunity: TradeOpportunity }
  | { readonly ok: false; readonly reason: string; readonly final: boolean };

/** Pure re-validation of a declined signal against the current price. */
export function revalidateDeclined(
  original: TradeOpportunity,
  declinedAt: number,
  price: number,
  now: number,
): RetryDecision {
  const { entry, stopLoss, takeProfit } = original.levels;
  const sym = original.symbol;
  if (now - declinedAt > RETRY_MAX_AGE_MS) {
    return { ok: false, final: true, reason: `${sym}: הסיגנל ישן מדי (יותר מ-24 שעות) — מחכים לסיגנל חדש.` };
  }
  if (price <= stopLoss) {
    return { ok: false, final: true, reason: `${sym}: המחיר (${price}) כבר ירד מתחת לסטופ (${stopLoss}) — העסקה לא רלוונטית.` };
  }
  if (price >= takeProfit) {
    return { ok: false, final: true, reason: `${sym}: המחיר (${price}) כבר הגיע ליעד (${takeProfit}) — פספסנו את התנועה.` };
  }
  if (price > entry * (1 + RETRY_MAX_CHASE_PCT / 100)) {
    const up = ((price / entry - 1) * 100).toFixed(2);
    return { ok: false, final: false, reason: `${sym}: המחיר עלה ${up}% מאז הסיגנל (${entry} → ${price}) — כניסה עכשיו היא רדיפה אחרי המחיר.` };
  }
  if (price < entry - 0.5 * (entry - stopLoss)) {
    return { ok: false, final: false, reason: `${sym}: המחיר (${price}) ירד יותר מחצי הדרך לסטופ — הסיגנל נחלש, לא נכנס.` };
  }
  const riskReward = (takeProfit - price) / (price - stopLoss);
  return {
    ok: true,
    opportunity: {
      ...original,
      levels: { entry: price, stopLoss, takeProfit, riskReward },
      warnings: [...original.warnings, `retry: re-validated at ${price} (signal price was ${entry})`],
    },
  };
}

/**
 * Polls for `/retry`; for each one re-validates the last declined entry and,
 * if still sound, hands it to `mirrorApprovedEntries` (fresh confirmation).
 * Replies in Telegram either way. Returns the entry outcomes (if any).
 */
export async function checkRetryRequests(
  store: KeyValueStore,
  telegram: TelegramConfig,
  source: MarketDataSource,
  entryTimeframe: Timeframe,
  instruments: readonly Instrument[],
  prices: Readonly<Record<string, number>>,
  flowParams: Omit<LiveOrderFlowParams, 'intent'>,
  now: number,
  options: MirrorApprovedEntriesOptions = {},
  /** The raw (unprefixed) store the shared Telegram cursor lives in. */
  telegramStore: KeyValueStore = store,
): Promise<readonly LiveEntryOutcome[]> {
  const polled = await pollAllTelegramUpdates(telegramStore, telegram);
  let requests = 0;
  const unclaimed: TelegramTextMessage[] = [];
  for (const message of polled.messages) {
    if (parseRetryCommand(message.text)) requests++;
    else unclaimed.push(message);
  }
  stashUnclaimedTelegramUpdates(telegramStore, { messages: unclaimed, callbacks: polled.callbacks });
  if (requests === 0) return [];

  const declined = readLastDeclinedEntry(store);
  if (!declined) {
    await sendTelegramMessage('אין עסקה שנדחתה או שפג תוקפה לאחרונה — אין מה לבדוק מחדש.', telegram);
    return [];
  }
  const symbol = declined.opportunity.symbol;
  const candles = await source.getCandles(symbol, entryTimeframe, 2);
  if (!candles.ok || candles.value.length === 0) {
    await sendTelegramMessage(`לא הצלחתי לקבל מחיר עדכני ל-${symbol} כרגע — נסה /retry שוב בעוד כמה דקות.`, telegram);
    return [];
  }
  const price = candles.value[candles.value.length - 1]!.close;
  const decision = revalidateDeclined(declined.opportunity, declined.declinedAt, price, now);
  if (!decision.ok) {
    if (decision.final) clearLastDeclinedEntry(store);
    await sendTelegramMessage(`🔁 בדקתי שוב — ${decision.reason}`, telegram);
    return [];
  }
  // Single use: a fresh rejection of the re-proposed entry records it again.
  clearLastDeclinedEntry(store);
  await sendTelegramMessage(`🔁 בדקתי שוב — ${symbol} עדיין תקפה (מחיר ${price}, סטופ ${decision.opportunity.levels.stopLoss}, יעד ${decision.opportunity.levels.takeProfit}). שולח בקשת אישור חדשה.`, telegram);
  const outcomes = await mirrorApprovedEntries(store, [decision.opportunity], instruments, prices, flowParams, now, options);
  if (outcomes.some((o) => o.outcome === 'entry-already-outstanding')) {
    await sendTelegramMessage(`⚠️ ${symbol}: כבר יש פוזיציה או הזמנה פתוחה על המטבע הזה — לא שלחתי בקשה חדשה.`, telegram);
  }
  return outcomes;
}
