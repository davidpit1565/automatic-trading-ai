/**
 * `/tip` — on-demand best-opportunity check (David asked 2026-09-03: "give
 * me something like /tip and it gives me a tip").
 *
 * Read-only: never opens a position, paper or live. Reuses
 * `PaperAutoPilot.previewBestOpportunity`, which runs the SAME entry gates
 * the autopilot itself acts on — a tip can never recommend something the
 * real pipeline would refuse, because it IS that pipeline, just stopped
 * short of committing capital.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { PaperAutoPilot, TipResult } from '../src/core/autopilot/paperAutoPilot';
import {
  pollAllTelegramUpdates,
  sendTelegramMessage,
  stashUnclaimedTelegramUpdates,
  type TelegramConfig,
  type TelegramTextMessage,
} from './telegram.mts';

export function parseTipCommand(text: string): boolean {
  return /^\/tip\s*$/i.test(text.trim());
}

export function formatTipMessage(result: TipResult): string {
  if (result.qualified) {
    const { symbol, opportunity, assessment } = result.qualified;
    const topReasons = opportunity.confidenceComponents
      .filter((c) => c.effect > 0)
      .sort((a, b) => b.effect - a.effect)
      .slice(0, 2)
      .map((c) => c.label)
      .join(', ');
    return (
      `💡 טיפ: ${symbol}\n\n` +
      `כניסה ${assessment.entry} · סטופ ${assessment.stopLoss} · יעד ${assessment.takeProfit}\n` +
      `ביטחון: ${opportunity.confidence.toFixed(0)}/100${topReasons ? ` — ${topReasons}` : ''}\n\n` +
      `זו לא הצעה לפעולה אוטומטית — אם תרצה, אפשר לפתוח ידנית עם /buy ${symbol}.`
    );
  }
  if (result.closestMiss) {
    const { symbol, confidence, reason } = result.closestMiss;
    return (
      `אין כרגע הזדמנות שעוברת את כל הבדיקות.\n\n` + `הכי קרוב: ${symbol} (ביטחון ${confidence.toFixed(0)}/100) — נדחה: ${reason}`
    );
  }
  return 'אין כרגע אף איתות במאגר המטבעות הנסחרים — אין מה לדווח.';
}

/**
 * Polls for a `/tip` command since the last check. Returns true when one was
 * found and answered this call — the caller doesn't need the result beyond
 * that, unlike `/buy`/`/sell` there is no queued/pending state to track
 * across cycles since this always resolves synchronously within one call.
 */
export async function checkTipRequests(
  store: KeyValueStore,
  telegram: TelegramConfig,
  autopilot: PaperAutoPilot,
  now: number,
): Promise<boolean> {
  const polled = await pollAllTelegramUpdates(store, telegram);
  const unclaimed: TelegramTextMessage[] = [];
  let requested = false;
  for (const message of polled.messages) {
    if (parseTipCommand(message.text)) requested = true;
    else unclaimed.push(message);
  }
  stashUnclaimedTelegramUpdates(store, { messages: unclaimed, callbacks: polled.callbacks });
  if (!requested) return false;

  const result = await autopilot.previewBestOpportunity(now);
  await sendTelegramMessage(formatTipMessage(result), telegram);
  return true;
}
