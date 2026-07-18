/**
 * Strategy validation harness — the honest scoreboard.
 *
 * Fetches ~720 real 1h and 4h candles per major from Kraken's public,
 * keyless API and replays the LIVE autopilot decision pipeline over them via
 * `runLivePipelineBacktest` (current config: minConfidence 20, default
 * criteria, 4h confirmation on). Prints an after-fee scoreboard per symbol and
 * in aggregate, alongside a buy-and-hold baseline for context.
 *
 *   npx tsx scripts/validateStrategy.mts            # real Kraken data
 *   npx tsx scripts/validateStrategy.mts --synthetic # deterministic synthetic
 *
 * No secrets required. Symbols that fail to fetch are skipped and noted, never
 * silently dropped.
 */

import { runLivePipelineBacktest } from '../src/core/backtest/livePipeline';
import { AUTOPILOT_MAX_RSI_FOR_LONG } from '../src/core/autopilot/paperAutoPilot';
import { profitStats } from '../src/core/validation/performance';
import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import { SyntheticDataSource } from '../src/core/data/synthetic';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import type { Candle } from '../src/core/types';

const CANDLE_LIMIT = 720;
const INITIAL_CASH = 10_000;
const COST_RATE = 0.003;
const MIN_CONFIDENCE = 20;
const WANTED_BASES = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'] as const;

interface Row {
  readonly label: string;
  readonly returnPct: number;
  readonly maxDrawdownPct: number;
  readonly trades: number;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
  readonly buyHoldPct: number;
}

function buyAndHoldPct(candles: readonly Candle[]): number {
  if (candles.length < 2) return 0;
  const first = candles[0]!.close;
  const last = candles[candles.length - 1]!.close;
  return first > 0 ? ((last - first) / first) * 100 : 0;
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

function printTable(rows: readonly Row[]): void {
  const header = ['Symbol', 'Return%', 'MaxDD%', 'Trades', 'Win%', 'PF', 'B&H%'];
  const widths = [12, 10, 9, 7, 7, 7, 10];
  const cells = (values: readonly string[]): string =>
    values.map((v, i) => v.padStart(widths[i]!)).join(' ');

  console.log(cells(header));
  console.log(widths.map((w) => '-'.repeat(w)).join(' '));
  for (const row of rows) {
    console.log(
      cells([
        row.label,
        fmtNum(row.returnPct),
        row.maxDrawdownPct.toFixed(2),
        String(row.trades),
        fmtPctOrNa(row.winRatePct),
        fmtRatio(row.profitFactor),
        fmtNum(row.buyHoldPct),
      ]),
    );
  }
}

async function resolveSymbols(source: MarketDataSource): Promise<Map<string, string>> {
  const instruments = await source.getInstruments();
  const bySymbol = new Map<string, string>();
  if (!instruments.ok) {
    console.error(`Could not list instruments: ${instruments.error}`);
    return bySymbol;
  }
  for (const base of WANTED_BASES) {
    const match = instruments.value.find((i) => i.base === base);
    if (match) bySymbol.set(base, match.symbol);
    else console.error(`No instrument found for base ${base} — skipping`);
  }
  return bySymbol;
}

async function main(): Promise<void> {
  const synthetic = process.argv.includes('--synthetic');
  const source: MarketDataSource = synthetic
    ? new SyntheticDataSource(Date.now())
    : new KrakenPublicSource();

  console.log('='.repeat(72));
  console.log(
    `Live-pipeline baseline scoreboard  (${synthetic ? 'SYNTHETIC DATA' : 'REAL Kraken data'})`,
  );
  console.log(
    `config: minConfidence=${MIN_CONFIDENCE}, costRate=${COST_RATE}, ` +
      `4h confirmation ON, initialCash=${INITIAL_CASH}, ~${CANDLE_LIMIT} 1h candles/symbol`,
  );
  console.log('='.repeat(72));

  const symbols = await resolveSymbols(source);
  const rows: Row[] = [];
  const skipped: string[] = [];
  const allTrades: { pnl: number; entryTimestamp: number; exitTimestamp: number }[] = [];
  let sumReturn = 0;
  let sumDrawdown = 0;
  let sumBuyHold = 0;
  let sumWins = 0;
  let sumTrades = 0;

  for (const base of WANTED_BASES) {
    const symbol = symbols.get(base);
    if (!symbol) {
      skipped.push(`${base} (no instrument)`);
      continue;
    }

    const entry = await source.getCandles(symbol, '1h', CANDLE_LIMIT);
    if (!entry.ok) {
      skipped.push(`${base}/${symbol} (1h: ${entry.error})`);
      continue;
    }
    const higher = await source.getCandles(symbol, '4h', CANDLE_LIMIT);
    const higherCandles = higher.ok ? higher.value : undefined;
    if (!higher.ok) {
      console.error(`  ${base}: 4h fetch failed (${higher.error}) — running without confirmation`);
    }

    const result = runLivePipelineBacktest(entry.value, {
      symbol,
      timeframe: '1h',
      initialCash: INITIAL_CASH,
      costRate: COST_RATE,
      minConfidence: MIN_CONFIDENCE,
      // Mirror production: don't chase overbought coins.
      criteria: { maxRsiForLong: AUTOPILOT_MAX_RSI_FOR_LONG },
      higherCandles,
      confirmationTimeframe: '4h',
    });

    const stats = profitStats(result.closedTrades);
    rows.push({
      label: `${base} (${result.closedTrades.length}t)`,
      returnPct: result.totalReturnPct,
      maxDrawdownPct: result.maxDrawdownPct,
      trades: result.closedTrades.length,
      winRatePct: result.stats.winRatePct,
      profitFactor: stats.profitFactor,
      buyHoldPct: buyAndHoldPct(entry.value),
    });

    allTrades.push(...result.closedTrades);
    sumReturn += result.totalReturnPct;
    sumDrawdown += result.maxDrawdownPct;
    sumBuyHold += buyAndHoldPct(entry.value);
    sumWins += result.stats.winCount;
    sumTrades += result.closedTrades.length;
  }

  console.log('');
  if (rows.length === 0) {
    console.log('No symbols could be evaluated.');
  } else {
    const n = rows.length;
    const aggStats = profitStats(allTrades);
    const aggregate: Row = {
      label: 'AGGREGATE',
      returnPct: sumReturn / n,
      maxDrawdownPct: sumDrawdown / n,
      trades: sumTrades,
      winRatePct: sumTrades > 0 ? (sumWins / sumTrades) * 100 : null,
      profitFactor: aggStats.profitFactor,
      buyHoldPct: sumBuyHold / n,
    };
    printTable(rows);
    console.log(widthRule());
    printTable([aggregate]);
    console.log('');
    console.log(
      'AGGREGATE columns: Return%/MaxDD%/B&H% are equal-weight means across symbols; ' +
        'Trades is the total; Win% and PF are pooled over all trades.',
    );
  }

  if (skipped.length > 0) {
    console.log('');
    console.log(`Skipped: ${skipped.join(', ')}`);
  }
}

function widthRule(): string {
  return '-'.repeat(12 + 10 + 9 + 7 + 7 + 7 + 10 + 6);
}

main().catch((error) => {
  console.error('validateStrategy failed:', error);
  process.exitCode = 1;
});
