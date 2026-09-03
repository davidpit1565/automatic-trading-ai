/**
 * `/discover` — on-demand version of the weekly market survey (David asked
 * 2026-09-03: "make it so I also have a /command that runs this check and
 * answers me in the bot"). Runs the exact same scan as
 * scripts/discoverCryptoCandidates.mts / the scheduled workflow — one
 * implementation (src/core/validation/candidateScan.ts), just triggered by
 * a message instead of a schedule.
 *
 * Read-only: never opens a position, never touches CURATED_INSTRUMENTS.
 * Takes real time (a candle fetch per candidate, serialized through the
 * source's own rate-limit queue), so this sends an immediate "scanning…"
 * acknowledgement before the result, rather than leaving the request
 * looking ignored for the ~10-60s the scan actually takes.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import { CURATED_INSTRUMENTS } from '../src/core/data/krakenPublic';
import {
  scanCandidates,
  fmtSignedPct,
  fmtRatioOrNa,
  fmtPctOrNa,
  DEFAULT_ON_DEMAND_TOP_N,
  type CandidateRow,
  type CandidateScanSource,
} from '../src/core/validation/candidateScan';
import {
  pollAllTelegramUpdates,
  sendTelegramMessage,
  stashUnclaimedTelegramUpdates,
  type TelegramConfig,
  type TelegramTextMessage,
} from './telegram.mts';

/** `/discover` or `/discover N` (how many non-curated pairs to measure,
 * ranked by 24h volume) — defaults to a smaller N than the weekly job's 40
 * since this blocks a live Telegram reply, not a background workflow. */
export function parseDiscoverCommand(text: string): number | null {
  const match = /^\/discover(?:\s+(\d+))?\s*$/i.exec(text.trim());
  if (!match) return null;
  if (!match[1]) return DEFAULT_ON_DEMAND_TOP_N;
  const n = Number.parseInt(match[1], 10);
  return n > 0 ? n : DEFAULT_ON_DEMAND_TOP_N;
}

export function formatDiscoverMessage(rows: readonly CandidateRow[], skipped: readonly string[]): string {
  const passing = rows.filter((r) => r.passes);
  const skippedNote = skipped.length > 0 ? ` (${skipped.length} לא נטענו)` : '';
  const header = `🔍 סקר שוק — נבדקו ${rows.length} מטבעות שעדיין לא ברשימת המסחר שלנו${skippedNote}.`;
  if (rows.length === 0) {
    return `${header}\n\nלא הצלחתי לטעון נתונים — נסה שוב מאוחר יותר.`;
  }
  if (passing.length === 0) {
    return `${header}\n\nאף אחד לא עבר את הרף (רווח נטו + Profit Factor מעל 1 + מספיק עסקאות כדי לסמוך על התוצאה).`;
  }
  const lines = passing
    .map(
      (r) =>
        `• ${r.base} (${r.symbol}): ${fmtSignedPct(r.returnPct)}%, PF ${fmtRatioOrNa(r.profitFactor)}, ${r.trades} עסקאות, ${fmtPctOrNa(r.winRatePct)}% הצלחה`,
    )
    .join('\n');
  return (
    `${header}\n\n✅ ${passing.length} עברו את הרף:\n${lines}\n\n` +
    `זו רק המלצה למדידה — שום דבר לא נוסף אוטומטית לרשימת המסחר. תגיד לי אם להוסיף מישהו מהם.`
  );
}

/**
 * Polls for a `/discover` command since the last check. Returns true when
 * one was found and answered this call — same synchronous-resolve contract
 * as `/tip` and `/status`, no queued state to track across cycles.
 */
export async function checkDiscoverRequests(
  store: KeyValueStore,
  telegram: TelegramConfig,
  source: MarketDataSource,
): Promise<boolean> {
  const polled = await pollAllTelegramUpdates(store, telegram);
  const unclaimed: TelegramTextMessage[] = [];
  let topN: number | null = null;
  for (const message of polled.messages) {
    const parsed = parseDiscoverCommand(message.text);
    if (parsed !== null) topN = parsed;
    else unclaimed.push(message);
  }
  stashUnclaimedTelegramUpdates(store, { messages: unclaimed, callbacks: polled.callbacks });
  if (topN === null) return false;

  const getTickers = source.getTickers;
  if (!getTickers) {
    await sendTelegramMessage('לא ניתן לסרוק כרגע — מקור הנתונים הנוכחי לא תומך בסריקת שוק מלאה.', telegram);
    return true;
  }
  await sendTelegramMessage(
    `🔍 סורק את ${topN} המטבעות הכי נסחרים שעדיין לא ברשימה שלנו... זה יכול לקחת עד דקה.`,
    telegram,
  );

  const scanSource: CandidateScanSource = {
    getInstruments: () => source.getInstruments(),
    getTickers,
    getCandles: (symbol, timeframe, limit) => source.getCandles(symbol, timeframe, limit),
  };
  const curatedSymbols = new Set(CURATED_INSTRUMENTS.map((i) => i.symbol));
  const { rows, skipped } = await scanCandidates(scanSource, curatedSymbols, topN);
  await sendTelegramMessage(formatDiscoverMessage(rows, skipped), telegram);
  return true;
}
