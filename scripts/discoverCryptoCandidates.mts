/**
 * Crypto candidate discovery — a periodic "market survey" that measures
 * whether any NOT-YET-TRADED Kraken EUR pair deserves promotion to
 * CURATED_INSTRUMENTS (src/core/data/krakenPublic.ts). Thin CLI wrapper
 * around the shared scan logic (src/core/validation/candidateScan.ts) —
 * that module is what actually applies the bar every manual addition so far
 * has been held to (see krakenPublic.ts's own doc comment for the full
 * history): net-positive return, profit factor > 1, and MORE THAN 5 closed
 * trades in the measurement window — a small sample with a flashy headline
 * number (e.g. a 100% win rate on 5 trades) is exactly the noise pattern
 * this threshold exists to reject, not a signal.
 *
 * Read-only and side-effect-free by design, same as scripts/measureStocks.mts
 * and .github/workflows/measure-stocks.yml: this only measures and reports
 * (to the job log, and — if anything passes — one Telegram message). It
 * NEVER edits CURATED_INSTRUMENTS, commits, opens a PR, or changes what the
 * live agent trades. Promoting a candidate stays a deliberate, reviewed code
 * change, exactly like every addition so far. The on-demand `/discover`
 * Telegram command (server/manualDiscoverCommand.mts) uses the exact same
 * shared scan, just triggered by a message instead of a schedule.
 *
 *   npx tsx scripts/discoverCryptoCandidates.mts        # top 80 by volume
 *   npx tsx scripts/discoverCryptoCandidates.mts 25     # top 25 by volume
 */

import { KrakenPublicSource, CURATED_INSTRUMENTS } from '../src/core/data/krakenPublic';
import {
  scanCandidates,
  MIN_TRADES_TO_TRUST,
  DEFAULT_TOP_N,
  fmtSignedPct,
  fmtRatioOrNa,
  fmtPctOrNa,
  type CandidateRow,
} from '../src/core/validation/candidateScan';
import { sendTelegramMessage } from '../server/telegram.mts';

function compactVolume(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function printTable(rows: readonly CandidateRow[]): void {
  const header = ['Base', 'Symbol', 'Vol(24h,€)', 'Return%', 'Trades', 'Win%', 'PF', 'Pass?'];
  const widths = [8, 12, 11, 9, 7, 7, 7, 6];
  const cells = (values: readonly string[]): string =>
    values.map((v, i) => v.padStart(widths[i]!)).join(' ');
  console.log(cells(header));
  console.log(widths.map((w) => '-'.repeat(w)).join(' '));
  for (const row of [...rows].sort((a, b) => b.quoteVolume - a.quoteVolume)) {
    console.log(
      cells([
        row.base,
        row.symbol,
        compactVolume(row.quoteVolume),
        fmtSignedPct(row.returnPct),
        String(row.trades),
        fmtPctOrNa(row.winRatePct),
        fmtRatioOrNa(row.profitFactor),
        row.passes ? 'YES' : '',
      ]),
    );
  }
}

async function main(): Promise<void> {
  const topN = Number.parseInt(process.argv[2] ?? '', 10) || DEFAULT_TOP_N;
  const source = new KrakenPublicSource();
  const curatedSymbols = new Set(CURATED_INSTRUMENTS.map((i) => i.symbol));

  console.log('='.repeat(78));
  console.log(`Crypto candidate discovery — top ${topN} non-curated EUR pairs by 24h volume`);
  console.log(
    `pass bar: net-positive + PF>1 + >${MIN_TRADES_TO_TRUST - 1} trades, ~720 1h candles/symbol, 4h confirmation ON`,
  );
  console.log('='.repeat(78));

  const { rows, skipped } = await scanCandidates(source, curatedSymbols, topN);
  if (rows.length === 0 && skipped.length > 0) {
    console.error(`Scan failed: ${skipped.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  printTable(rows);
  if (skipped.length > 0) {
    console.log('');
    console.log(`Skipped (fetch failed): ${skipped.join(', ')}`);
  }

  const passing = rows.filter((r) => r.passes);
  console.log('');
  console.log(
    passing.length === 0
      ? 'No candidates passed the bar this run.'
      : `${passing.length} candidate(s) passed: ${passing.map((r) => r.base).join(', ')}`,
  );

  // Only send Telegram noise when there's actually something to review —
  // nothing to add is not news, so it never pings David.
  if (passing.length > 0) {
    const lines = passing
      .map(
        (r) =>
          `• ${r.base} (${r.symbol}): ${fmtSignedPct(r.returnPct)}%, PF ${fmtRatioOrNa(r.profitFactor)}, ${r.trades} עסקאות, ${fmtPctOrNa(r.winRatePct)}% הצלחה`,
      )
      .join('\n');
    const message =
      `📊 סקר שוק שבועי — נמצאו ${passing.length} מטבע/ות חדשים שעברו את הרף במדידה על נתונים אמיתיים:\n\n${lines}\n\n` +
      `זו רק המלצה למדידה — שום דבר לא נוסף אוטומטית לרשימת המסחר. תגיד לי אם להוסיף מישהו מהם.`;
    const sent = await sendTelegramMessage(message, {
      token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
      chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
    });
    if (!sent.sent) console.error(`Telegram send failed: ${sent.reason}`);
  }
}

main().catch((error) => {
  console.error('discoverCryptoCandidates failed:', error);
  process.exitCode = 1;
});
