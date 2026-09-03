/**
 * Crypto candidate discovery — a periodic "market survey" that measures
 * whether any NOT-YET-TRADED Kraken EUR pair deserves promotion to
 * CURATED_INSTRUMENTS (src/core/data/krakenPublic.ts), using the exact same
 * bar every manual addition so far has been held to (see that file's own
 * doc comment for the full history): net-positive return, profit factor > 1,
 * and MORE THAN 5 closed trades in the measurement window — a small sample
 * with a flashy headline number (e.g. a 100% win rate on 5 trades) is
 * exactly the noise pattern this threshold exists to reject, not a signal.
 *
 * Read-only and side-effect-free by design, same as scripts/measureStocks.mts
 * and .github/workflows/measure-stocks.yml: this only measures and reports
 * (to the job log, and — if anything passes — one Telegram message). It
 * NEVER edits CURATED_INSTRUMENTS, commits, opens a PR, or changes what the
 * live agent trades. Promoting a candidate stays a deliberate, reviewed code
 * change, exactly like every addition so far.
 *
 *   npx tsx scripts/discoverCryptoCandidates.mts        # top 40 by volume
 *   npx tsx scripts/discoverCryptoCandidates.mts 25     # top 25 by volume
 */

import { runLivePipelineBacktest } from '../src/core/backtest/livePipeline';
import { AUTOPILOT_MAX_RSI_FOR_LONG, AUTOPILOT_TRAILING } from '../src/core/autopilot/paperAutoPilot';
import { profitStats } from '../src/core/validation/performance';
import { KrakenPublicSource, CURATED_INSTRUMENTS } from '../src/core/data/krakenPublic';
import { sendTelegramMessage } from '../server/telegram.mts';

const CANDLE_LIMIT = 720;
const INITIAL_CASH = 10_000;
const COST_RATE = 0.003;
const MIN_CONFIDENCE = 20;
/** Same threshold this file's own doc comment established manually: 5 or
 * fewer closed trades isn't enough of a sample to trust, whatever the
 * headline return/win-rate says. */
const MIN_TRADES_TO_TRUST = 6;
const DEFAULT_TOP_N = 40;
/** Stablecoins are often among the highest-volume EUR pairs but structurally
 * can't pass a momentum strategy (their entire purpose is not moving) — skip
 * them rather than waste two rate-limited candle fetches every run on a
 * guaranteed 0-trade result. */
const STABLECOIN_BASES = new Set(['USDC', 'USDT', 'DAI', 'PYUSD', 'EURT', 'EURR']);

interface Row {
  readonly symbol: string;
  readonly base: string;
  readonly quoteVolume: number;
  readonly returnPct: number;
  readonly trades: number;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
  readonly passes: boolean;
}

function fmtNum(value: number, dp = 2): string {
  const s = value.toFixed(dp);
  return value > 0 ? `+${s}` : s;
}

function fmtRatio(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

function fmtPctOrNa(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(1);
}

function compactVolume(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

async function main(): Promise<void> {
  const topN = Number.parseInt(process.argv[2] ?? '', 10) || DEFAULT_TOP_N;
  const source = new KrakenPublicSource();
  const curatedSymbols = new Set(CURATED_INSTRUMENTS.map((i) => i.symbol));

  console.log('='.repeat(78));
  console.log(`Crypto candidate discovery — top ${topN} non-curated EUR pairs by 24h volume`);
  console.log(
    `config: minConfidence=${MIN_CONFIDENCE}, costRate=${COST_RATE}, 4h confirmation ON, ` +
      `~${CANDLE_LIMIT} 1h candles/symbol, pass bar: net-positive + PF>1 + >${MIN_TRADES_TO_TRUST - 1} trades`,
  );
  console.log('='.repeat(78));

  const tickers = await source.getTickers();
  if (!tickers.ok) {
    console.error(`Could not fetch tickers: ${tickers.error}`);
    process.exitCode = 1;
    return;
  }
  const instruments = await source.getInstruments();
  const baseBySymbol = new Map(
    instruments.ok ? instruments.value.map((i) => [i.symbol, i.base] as const) : [],
  );

  const candidates = tickers.value
    .filter((t) => !curatedSymbols.has(t.symbol))
    .filter((t) => !STABLECOIN_BASES.has(baseBySymbol.get(t.symbol) ?? t.symbol))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, topN);

  const rows: Row[] = [];
  const skipped: string[] = [];

  for (const ticker of candidates) {
    const base = baseBySymbol.get(ticker.symbol) ?? ticker.symbol;
    const entry = await source.getCandles(ticker.symbol, '1h', CANDLE_LIMIT);
    if (!entry.ok) {
      skipped.push(`${base}/${ticker.symbol} (1h: ${entry.error})`);
      continue;
    }
    const higher = await source.getCandles(ticker.symbol, '4h', CANDLE_LIMIT);
    const higherCandles = higher.ok ? higher.value : undefined;

    const result = runLivePipelineBacktest(entry.value, {
      symbol: ticker.symbol,
      timeframe: '1h',
      initialCash: INITIAL_CASH,
      costRate: COST_RATE,
      minConfidence: MIN_CONFIDENCE,
      criteria: { maxRsiForLong: AUTOPILOT_MAX_RSI_FOR_LONG },
      trailing: AUTOPILOT_TRAILING,
      higherCandles,
      confirmationTimeframe: '4h',
    });
    const stats = profitStats(result.closedTrades);
    const trades = result.closedTrades.length;
    const passes =
      trades > MIN_TRADES_TO_TRUST - 1 &&
      result.totalReturnPct > 0 &&
      (stats.profitFactor === null || stats.profitFactor > 1);

    rows.push({
      symbol: ticker.symbol,
      base,
      quoteVolume: ticker.quoteVolume,
      returnPct: result.totalReturnPct,
      trades,
      winRatePct: result.stats.winRatePct,
      profitFactor: stats.profitFactor,
      passes,
    });
  }

  console.log('');
  const header = ['Base', 'Symbol', 'Vol(24h,€)', 'Return%', 'Trades', 'Win%', 'PF', 'Pass?'];
  const widths = [8, 12, 11, 9, 7, 7, 7, 6];
  const cells = (values: readonly string[]): string =>
    values.map((v, i) => v.padStart(widths[i]!)).join(' ');
  console.log(cells(header));
  console.log(widths.map((w) => '-'.repeat(w)).join(' '));
  for (const row of rows.sort((a, b) => b.quoteVolume - a.quoteVolume)) {
    console.log(
      cells([
        row.base,
        row.symbol,
        compactVolume(row.quoteVolume),
        fmtNum(row.returnPct),
        String(row.trades),
        fmtPctOrNa(row.winRatePct),
        fmtRatio(row.profitFactor),
        row.passes ? 'YES' : '',
      ]),
    );
  }
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
          `• ${r.base} (${r.symbol}): ${fmtNum(r.returnPct)}%, PF ${fmtRatio(r.profitFactor)}, ${r.trades} עסקאות, ${fmtPctOrNa(r.winRatePct)}% הצלחה`,
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
