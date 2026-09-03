/**
 * Remembers crypto entries the signal engine approved WHILE a Shabbat/Yom
 * Tov blackout window was active (see `blackoutCalendar.mts`) — the normal
 * Telegram confirmation is still sent as always (David asked 2026-09-03:
 * he IS sometimes available and wants to keep the option to approve), this
 * only tracks each one so anything that never actually got answered can be
 * summarized once the window ends (`autopilotRunner.mts`'s
 * `runLiveMirror`), re-validated against the price AT THAT MOMENT rather
 * than replayed blind. Anything that WAS approved and filled during the
 * window (a genuine open position exists for it) is excluded from that
 * summary at drain time — it doesn't need reporting as missed.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { TradeOpportunity } from '../src/core/signal/signalEngine';

const QUEUE_KEY = 'live-blackout-queue';

interface QueuedEntry {
  readonly symbol: string;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly queuedAt: number;
}

export interface BlackoutSummaryEntry extends QueuedEntry {
  readonly currentPrice: number;
  readonly movedPct: number;
}

/** Merges newly-approved opportunities into the queue, one entry per
 * symbol — a later approval from the same window overwrites an earlier
 * one, since the freshest levels are the most relevant once the window
 * ends. */
export function queueBlackoutEntries(
  store: KeyValueStore,
  opportunities: readonly TradeOpportunity[],
  now: number,
): void {
  if (opportunities.length === 0) return;
  const queue = { ...(store.get<Record<string, QueuedEntry>>(QUEUE_KEY) ?? {}) };
  for (const o of opportunities) {
    queue[o.symbol] = {
      symbol: o.symbol,
      entry: o.levels.entry,
      stopLoss: o.levels.stopLoss,
      takeProfit: o.levels.takeProfit,
      queuedAt: now,
    };
  }
  store.set(QUEUE_KEY, queue);
}

/** Empties the queue and returns each entry NOT in `alreadyHandledSymbols`
 * (a symbol that now has a genuine open position — approved and filled
 * during the window, so it needs no "missed" report), re-validated against
 * the CURRENT price rather than replayed blind. */
export function drainBlackoutQueue(
  store: KeyValueStore,
  prices: Readonly<Record<string, number>>,
  alreadyHandledSymbols: ReadonlySet<string> = new Set(),
): readonly BlackoutSummaryEntry[] {
  const queue = store.get<Record<string, QueuedEntry>>(QUEUE_KEY) ?? {};
  store.set(QUEUE_KEY, {});
  return Object.values(queue)
    .filter((q) => !alreadyHandledSymbols.has(q.symbol))
    .map((q) => {
      const currentPrice = prices[q.symbol] ?? q.entry;
      return { ...q, currentPrice, movedPct: ((currentPrice - q.entry) / q.entry) * 100 };
    });
}

function formatEur(value: number): string {
  return value.toLocaleString('he-IL', { maximumFractionDigits: 2 });
}

/** Builds the Hebrew Telegram summary sent once a blackout window ends —
 * null when nothing was queued (stays silent rather than pinging for
 * nothing, matching this project's existing quiet-by-default convention). */
export function buildBlackoutSummaryMessage(entries: readonly BlackoutSummaryEntry[], windowLabel: string): string | null {
  if (entries.length === 0) return null;
  const lines = entries.map((e) => {
    const sign = e.movedPct >= 0 ? '+' : '';
    const stillNear = Math.abs(e.movedPct) <= 1 ? 'עדיין קרוב לכניסה' : 'התרחק מהכניסה המקורית';
    return (
      `• ${e.symbol}: כניסה שזוהתה ${formatEur(e.entry)} ← עכשיו ${formatEur(e.currentPrice)} ` +
      `(${sign}${e.movedPct.toFixed(1)}%, ${stillNear}) — סטופ ${formatEur(e.stopLoss)} / יעד ${formatEur(e.takeProfit)}`
    );
  });
  return (
    `🕯️ ${windowLabel} הסתיים/ה. ההזדמנויות הבאות נשלחו לאישור בזמן הזה אבל לא קיבלו תשובה:\n\n` +
    `${lines.join('\n')}\n\n` +
    `זו לא הצעה לפעולה אוטומטית — אם עדיין נראה לך רלוונטי, אפשר לפתוח ידנית עם /buy <SYMBOL>.`
  );
}
