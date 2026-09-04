/**
 * Real-time momentum-spike alert — David asked for this separately
 * (2026-09-04) from the measured weekly discovery
 * (discoverCryptoCandidates.mts): "some coins are only worth trading for a
 * few hours or a day, even if they're not normally good coins — catch that
 * and alert me, I'll decide manually." Runs every 3 days (his requested
 * cadence, deliberately more frequent than the weekly measured survey).
 *
 * Deliberately NOT measured against real history — see momentumScan.ts's
 * doc comment for why that's not meaningfully possible for a multi-hour
 * move. Purely a "heads up, this is moving right now" alert: never adds to
 * CURATED_INSTRUMENTS, never trades, never auto-executes anything. Every
 * Telegram message is explicitly labeled speculative so it's never mistaken
 * for a measured recommendation like /discover's.
 *
 *   npx tsx scripts/detectMomentumSpikes.mts
 */

import { KrakenPublicSource, CURATED_INSTRUMENTS } from '../src/core/data/krakenPublic';
import { scanMomentumSpikes, DEFAULT_SPIKE_THRESHOLD_PCT } from '../src/core/validation/momentumScan';
import { sendTelegramMessage } from '../server/telegram.mts';

async function main(): Promise<void> {
  const source = new KrakenPublicSource();
  const curatedSymbols = new Set(CURATED_INSTRUMENTS.map((i) => i.symbol));

  console.log('='.repeat(78));
  console.log(
    `Momentum-spike scan — non-curated coins up ${DEFAULT_SPIKE_THRESHOLD_PCT}%+ today (NOT measured, speculative only)`,
  );
  console.log('='.repeat(78));

  const { rows, error } = await scanMomentumSpikes(source, curatedSymbols);
  if (error) {
    console.error(`Scan failed: ${error}`);
    process.exitCode = 1;
    return;
  }

  if (rows.length === 0) {
    console.log('No momentum spikes found.');
    return;
  }

  for (const r of rows) {
    console.log(
      `${r.base} (${r.symbol}): +${r.pctChange.toFixed(1)}% today, price €${r.price}, ` +
        `24h vol €${(r.quoteVolume / 1000).toFixed(0)}K`,
    );
  }

  // David asked (2026-09-04) for the alert to also make the manual buy
  // action immediate, not just report the number — `/buy` already works on
  // ANY tradable symbol, curated or not (manualBuyCommand.mts verifies
  // against the broker's own pairs, never CURATED_INSTRUMENTS), so each
  // row's ready-to-send command is genuinely actionable right now, not
  // aspirational. Once bought this way, the position gets the SAME fixed
  // stop/target and automatic per-cycle exit monitoring as any other live
  // position (checkAutomaticExits iterates every tracked position, not just
  // curated ones) — no separate "sell suggestion" logic needed here.
  const lines = rows
    .map(
      (r) =>
        `• ${r.base}: ${r.pctChange >= 0 ? '+' : ''}${r.pctChange.toFixed(1)}% היום, מחיר €${r.price}\n  לקנייה: /buy ${r.symbol}`,
    )
    .join('\n');
  const message =
    `⚡ התראת מומנטום — ספקולטיבי, לא נמדד על היסטוריה\n\n${lines}\n\n` +
    `אלה מטבעות עם קפיצה חדה היום שלא נסחרים אצלנו ומעולם לא נבדקו על נתונים אמיתיים — ` +
    `ייתכן שזה רלוונטי רק לכמה שעות/יום ולא מייצג הזדמנות אמיתית. ` +
    `זו הודעת מידע בלבד — הבוט לא קונה שום דבר מזה בעצמו; אם תרצה לקנות, שלח את פקודת ה-/buy ` +
    `למעלה ותעבור דרך אותו תהליך אישור בטוח כמו כל עסקה אחרת. ` +
    `ואם תקנה, הפוזיציה תיבדק אוטומטית בכל מחזור בדיוק כמו כל פוזיציה אחרת (סטופ/יעד קבועים).`;
  const sent = await sendTelegramMessage(message, {
    token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
  });
  if (!sent.sent) console.error(`Telegram send failed: ${sent.reason}`);
}

main().catch((error) => {
  console.error('detectMomentumSpikes failed:', error);
  process.exitCode = 1;
});
