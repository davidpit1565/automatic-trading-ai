/**
 * Detects and reconciles a real Revolut X trade David made directly in the
 * Revolut X app — not through this bot's own /buy, /sell, or automatic
 * entry/exit flow (2026-09-04, David asked for this explicitly: "אני
 * ממשיך לקבל את הסיכום היומי" ... no wait, wrong quote — see PROJECT_STATE.md
 * for the real request: "sometimes I also buy or sell directly through
 * Revolut, so it needs to know and update automatically").
 *
 * A real fill that happens outside this bot's own order flow is otherwise
 * completely invisible to it — no stop-loss, no take-profit, no P&L
 * tracking — until a human notices and hand-fixes the state file. This
 * account has already hit that exact gap manually twice (see
 * PROJECT_STATE.md's 2026-09-03/09-04 manual-reconciliation entries).
 *
 * Compares the broker's real balance for every `CURATED_INSTRUMENTS` base
 * (`BrokerAdapter.fetchPositions()` — the only source of truth for real
 * holdings) against what this bot itself currently tracks:
 * - broker qty > tracked qty: a manual BUY, a brand-new position, OR this
 *   bot's OWN resting entry order quietly filling between cycles before its
 *   own bookkeeping noticed (found in review, 2026-09-06 — see
 *   `reconcileExternalBuy`'s doc comment) — the latter is checked FIRST via
 *   `readRestingEntryIntent` and, on a match, uses that order's own
 *   risk-engine-approved stop/target/limit price rather than guessing.
 *   Only a genuine mismatch (or no resting order at all) opens/increases a
 *   tracked position for the excess at the CURRENT market price (Revolut
 *   X's balances endpoint reports no cost basis, so the true fill price is
 *   unknowable here — a deliberate, documented approximation, not a bug)
 *   with the same fixed manual-override stop/target every manual `/buy`
 *   uses, so it gets the same automatic exit protection going forward.
 * - broker qty < tracked qty: a manual SELL (or this bot's OWN resting
 *   exit order quietly filling between cycles, before its own bookkeeping
 *   noticed — same fix, same code path) — reduces/closes the tracked
 *   position for the difference and feeds the realized-P&L tracker (so
 *   the daily-loss circuit breaker isn't blind to a loss David causes by
 *   selling manually) at the CURRENT market price as an estimated exit —
 *   never touches the cash ledger directly, since `syncLiveCashFromBroker`
 *   already keeps cash correct from this same broker balance read.
 * Sends one Telegram message whenever it reconciles anything so this is
 * never a silent, invisible change to the account.
 *
 * Call once per cycle, right alongside `syncLiveCashFromBroker`/
 * `syncLiveExternalBtc` — BEFORE `runLiveMirror`'s own entry/exit checks —
 * so any trade that happened between cycles is caught before this cycle's
 * own logic runs against a stale baseline (no same-cycle race: this bot's
 * own submitted-and-filled exits/entries within a cycle already update
 * tracked state directly, so by the time this runs at the START of the
 * NEXT cycle the two are already consistent for anything this bot itself
 * did).
 *
 * Deliberately scoped to `CURATED_INSTRUMENTS` only (matches what
 * `verifySymbolExists` and the automatic exit monitor already know how to
 * protect) — a manual trade in a coin outside this list stays as invisible
 * as it always was (the same limitation `syncLiveExternalBtc`'s BTC-only
 * special case already had, just not yet generalized further).
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import type { BrokerAdapter, OrderIntent, OrderStatusReport } from '../src/core/execution/types';
import type { TradeRiskAssessment } from '../src/core/risk/riskEngine';
import type { Instrument } from '../src/core/types';
import { CURATED_INSTRUMENTS } from '../src/core/data/krakenPublic';
import {
  forgetLivePosition,
  openLivePositions,
  recordLiveEntryFill,
  reduceLivePositionQuantity,
  type LiveOpenPosition,
} from './liveExitFlow.mts';
import { clearOutstandingEntry, clearRestingEntryIntent, readRestingEntryIntent } from './liveEntryMirror.mts';
import { toRevolutXSymbol } from './revolutXBrokerAdapter.mts';
import { sendTelegramMessage, type TelegramConfig } from './telegram.mts';

/** Same fixed manual-override levels `manualBuyCommand.mts` uses for a
 * human-triggered `/buy` — there's no signal-derived opportunity to size
 * against here either, for the same reason: this trade already happened,
 * there's nothing left to decide, only to track safely from here on. */
const STOP_PCT = 1.5;
const TARGET_PCT = 3;
/** Ignore float noise from repeated EUR-value rounding — not a real trade. */
const DUST_QTY = 1e-6;
/**
 * How close the broker-balance increase must be to a still-resting entry
 * intent's own requested quantity to treat it as THAT order finally
 * filling, rather than a genuinely external buy — allows for ordinary
 * fee/rounding drift between what was requested and what actually filled,
 * without accidentally attributing an unrelated, larger external purchase
 * to this bot's own pending order. Found in review, 2026-09-06 — see
 * `reconcileExternalBuy`.
 */
const RESTING_MATCH_TOLERANCE = 0.02;

async function currentPrice(source: MarketDataSource, symbol: string): Promise<number | null> {
  const candles = await source.getCandles(symbol, '1h', 2);
  if (!candles.ok || candles.value.length === 0) return null;
  return candles.value[candles.value.length - 1]!.close;
}

/**
 * Returns true iff a position was actually opened — false (a no-op) when
 * no current price was available, so the caller knows not to treat this as
 * a real, must-persist outcome.
 *
 * Found in review, 2026-09-06: a resting limit order THIS bot itself
 * submitted (`mirrorApprovedEntries`/`checkManualBuyRequests`) that hasn't
 * filled AT ALL yet is not tracked as a position (see
 * `recordLiveEntryFill`'s `genuinelyFilled` check) — if it later fills
 * between cycles, the broker-balance diff this function reacts to is
 * indistinguishable, on the numbers alone, from a genuinely external manual
 * buy. Before this fix, EVERY such diff was treated as external — silently
 * discarding the real risk-engine-approved stop/target/entry price a human
 * already confirmed via Telegram in favor of a generic manual-override
 * guess, and telling David a trade was "manual" when the bot placed it.
 * Checked first against `readRestingEntryIntent`: a match (same symbol,
 * quantity within `RESTING_MATCH_TOLERANCE`) uses the ORIGINAL intent's own
 * assessment/stop/target/limit price instead.
 */
async function reconcileExternalBuy(
  store: KeyValueStore,
  instrument: Instrument,
  quantity: number,
  source: MarketDataSource,
  telegram: TelegramConfig,
  now: number,
): Promise<boolean> {
  const restingIntent = readRestingEntryIntent(store, instrument.symbol);
  if (restingIntent && Math.abs(quantity - restingIntent.quantity) <= restingIntent.quantity * RESTING_MATCH_TOLERANCE) {
    const report: OrderStatusReport = {
      intentId: restingIntent.id,
      state: 'filled',
      filledQuantity: quantity,
      // Unknown — Revolut X's balances endpoint carries no cost basis, same
      // limitation as a genuinely external buy. `recordLiveEntryFill` falls
      // back to `restingIntent.limitPrice` (the ORIGINAL order's own limit
      // price), a far better estimate than "whatever the market price is
      // now, possibly many cycles after this order was placed."
      avgFillPrice: null,
      detail: 'resting order finally filled — detected via broker balance reconciliation',
    };
    if (!recordLiveEntryFill(store, restingIntent, report, now)) return false;
    clearRestingEntryIntent(store, instrument.symbol);
    await sendTelegramMessage(
      `✅ ההזמנה הממתינה ל-${instrument.base} התמלאה (זוהה בבדיקת יתרת Revolut X) — כמות: ${quantity}. ` +
        `הפוזיציה מנוטרת עם הסטופ/יעד שכבר אישרת בטלגרם, לא עם ערכי ברירת מחדל.`,
      telegram,
    );
    return true;
  }

  const price = await currentPrice(source, instrument.symbol);
  if (price === null || !(price > 0)) return false; // retry next cycle rather than guessing a price
  const revolutSymbol = toRevolutXSymbol(instrument.symbol, [instrument]) ?? `${instrument.base}-${instrument.quote}`;
  const stopLoss = price * (1 - STOP_PCT / 100);
  const takeProfit = price * (1 + TARGET_PCT / 100);
  const assessment: TradeRiskAssessment = {
    approved: true,
    asset: instrument.symbol,
    entry: price,
    stopLoss,
    takeProfit,
    positionSize: quantity,
    positionValue: quantity * price,
    riskAmount: quantity * (price - stopLoss),
    riskPercentage: 0, // not applicable — this trade wasn't sized by assessTrade
    rewardRiskRatio: TARGET_PCT / STOP_PCT,
    portfolioExposure: 0, // not computed for an externally-detected fill
    reasons: [],
    warnings: [
      'AUTO-RECONCILED (2026-09-04): bought directly in the Revolut X app, not through this bot. ' +
        'Entry price is the market price when this bot FIRST noticed the balance change — Revolut X ' +
        'reports no cost basis, so this is not necessarily the real fill price. Stop/target are the ' +
        'same fixed manual-override levels a /buy uses.',
    ],
  };
  const intentId = `external-reconcile:${instrument.symbol}:${now}`;
  const intent: OrderIntent = {
    id: intentId,
    createdAt: now,
    mode: 'live',
    symbol: revolutSymbol,
    side: 'buy',
    quantity,
    limitPrice: price,
    stopLoss,
    takeProfit,
    assessment,
  };
  const report: OrderStatusReport = {
    intentId,
    state: 'filled',
    filledQuantity: quantity,
    avgFillPrice: price,
    detail: 'external trade, auto-detected via broker balance reconciliation',
  };
  if (!recordLiveEntryFill(store, intent, report, now)) return false;
  await sendTelegramMessage(
    `🔄 זיהיתי קנייה ידנית של ${instrument.base} ב-Revolut X (לא דרך הבוט) — ` +
      `כמות: ${quantity}, מחיר בזיהוי: €${price}. ` +
      `מעכשיו הפוזיציה הזו מנוטרת אוטומטית: stop-loss €${stopLoss.toFixed(6)} / take-profit €${takeProfit.toFixed(6)}.\n` +
      `שים לב: המחיר הוא מחיר השוק כרגע, לא בהכרח מחיר הקנייה האמיתי שלך (רבולוט X לא מדווח על כך).`,
    telegram,
  );
  return true;
}

async function reconcileExternalSell(
  store: KeyValueStore,
  trackedForSymbol: readonly LiveOpenPosition[],
  soldQuantity: number,
  source: MarketDataSource,
  telegram: TelegramConfig,
  now: number,
  onRealizedPnl?: (pnl: number, now: number) => void,
): Promise<void> {
  const first = trackedForSymbol[0];
  if (!first) return;
  const symbol = first.entryAssessment.asset;
  const price = await currentPrice(source, symbol);
  let remaining = soldQuantity;
  let closedAny = false;
  for (const position of trackedForSymbol) {
    if (remaining <= DUST_QTY) break;
    const reduceBy = Math.min(remaining, position.quantity);
    if (price !== null && price > 0) {
      onRealizedPnl?.((price - position.entryPrice) * reduceBy, now);
    }
    if (reduceBy >= position.quantity - DUST_QTY) {
      forgetLivePosition(store, position.id);
      clearOutstandingEntry(store, symbol);
      closedAny = true;
    } else {
      reduceLivePositionQuantity(store, position.id, reduceBy);
    }
    remaining -= reduceBy;
  }
  const base = first.entryAssessment.asset.replace(/EUR$/, '');
  const priceNote =
    price !== null
      ? ` (מחיר בזיהוי: €${price} — לא בהכרח מחיר המכירה האמיתי שלך)`
      : ' (לא הצלחתי לקבל מחיר עדכני, כך שהרווח/הפסד לא נרשם הפעם)';
  await sendTelegramMessage(
    `🔄 זיהיתי מכירה ${closedAny ? '(סגירת פוזיציה) ' : ''}של ${base} ב-Revolut X (לא דרך הבוט) — ` +
      `כמות: ${soldQuantity}${priceNote}. עדכנתי את המעקב הפנימי בהתאם.`,
    telegram,
  );
}

/** Call once per cycle — see this file's own doc comment for placement and
 * why it's safe against a same-cycle race with this bot's own order flow.
 * Returns true if at least one curated symbol was actually reconciled (a
 * position opened, reduced, or closed) — the caller must persist state
 * immediately whenever this is true, the same way it does for any other
 * real-money action that just happened, since these writes are otherwise
 * indistinguishable from a no-op cycle until the next unrelated persist. */
export async function syncManualTradesFromBroker(
  store: KeyValueStore,
  brokerAdapter: BrokerAdapter,
  source: MarketDataSource,
  telegram: TelegramConfig,
  now: number,
  onRealizedPnl?: (pnl: number, now: number) => void,
): Promise<boolean> {
  let brokerPositions: Awaited<ReturnType<BrokerAdapter['fetchPositions']>>;
  try {
    brokerPositions = await brokerAdapter.fetchPositions();
  } catch {
    return false; // network failure — reconcile next cycle, never guess
  }
  const tracked = openLivePositions(store);
  let reconciledAny = false;

  for (const instrument of CURATED_INSTRUMENTS) {
    const brokerQty = brokerPositions.find((p) => p.symbol === instrument.base)?.quantity ?? 0;
    const trackedForSymbol = tracked.filter((p) => p.entryAssessment.asset === instrument.symbol);
    const trackedQty = trackedForSymbol.reduce((sum, p) => sum + p.quantity, 0);
    const diff = brokerQty - trackedQty;
    if (Math.abs(diff) <= DUST_QTY) continue;

    if (diff > 0) {
      if (await reconcileExternalBuy(store, instrument, diff, source, telegram, now)) reconciledAny = true;
    } else {
      // Always a real mutation when reached — `trackedForSymbol` is
      // guaranteed non-empty here (trackedQty > brokerQty >= 0 requires at
      // least one tracked position), and reconcileExternalSell reduces/closes
      // it regardless of whether a current price was available for P&L.
      await reconcileExternalSell(store, trackedForSymbol, -diff, source, telegram, now, onRealizedPnl);
      reconciledAny = true;
    }
  }
  return reconciledAny;
}
