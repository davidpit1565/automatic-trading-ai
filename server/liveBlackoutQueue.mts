/**
 * Holds crypto entries the signal engine approved WHILE a Shabbat/Yom Tov
 * blackout window was active (see `blackoutCalendar.mts`) — queued instead
 * of proposed, so nothing executes unattended. Drained into one Telegram
 * summary the moment the window ends (`autopilotRunner.mts`'s
 * `runLiveMirror`), re-validated against the price AT THAT MOMENT rather
 * than replayed blind.
 *
 * Only the AUTOMATIC entry path is queued here — a human's own `/buy` or
 * `/sell` is never held back by this (David's own rule from the start of
 * this feature's conversation: manual action is always available, only the
 * bot's own unattended proposals pause).
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

/** Empties the queue and returns each entry re-validated against the
 * CURRENT price — never hands back stale queued numbers alone. */
export function drainBlackoutQueue(
  store: KeyValueStore,
  prices: Readonly<Record<string, number>>,
): readonly BlackoutSummaryEntry[] {
  const queue = store.get<Record<string, QueuedEntry>>(QUEUE_KEY) ?? {};
  store.set(QUEUE_KEY, {});
  return Object.values(queue).map((q) => {
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
    `🕯️ ${windowLabel} הסתיים/ה. בזמן הזה זוהו ההזדמנויות הבאות, אבל לא הוצעו לך כדי לא לבצע בלי אישור:\n\n` +
    `${lines.join('\n')}\n\n` +
    `זו לא הצעה לפעולה אוטומטית — אם עדיין נראה לך רלוונטי, אפשר לפתוח ידנית עם /buy <SYMBOL>.`
  );
}
