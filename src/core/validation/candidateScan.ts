/**
 * Crypto candidate scan — the shared core behind both the scheduled weekly
 * market survey (`scripts/discoverCryptoCandidates.mts`) and the on-demand
 * `/discover` Telegram command (`server/manualDiscoverCommand.mts`). One
 * implementation so both answer the identical question the identical way:
 * "of the coins we don't yet trade, which would have been worth trading?"
 *
 * Read-only and side-effect-free: this only measures real history through
 * the live decision pipeline (`runLivePipelineBacktest`) and reports. It
 * never opens a position, paper or live, and never touches
 * CURATED_INSTRUMENTS — promoting a candidate stays a deliberate, reviewed
 * code change (see krakenPublic.ts's own doc comment for the full history
 * of every addition made that way so far).
 */

import { runLivePipelineBacktest } from '../backtest/livePipeline';
import { AUTOPILOT_MAX_RSI_FOR_LONG, AUTOPILOT_TRAILING } from '../autopilot/paperAutoPilot';
import { profitStats } from './performance';
import type { Candle, Instrument, Result, Ticker, Timeframe } from '../types';

const CANDLE_LIMIT = 720;
const INITIAL_CASH = 10_000;
const COST_RATE = 0.003;
const MIN_CONFIDENCE = 20;
/** 5-or-fewer closed trades isn't enough of a sample to trust, whatever the
 * headline return/win-rate says — the exact small-sample noise pattern
 * (e.g. a 100% win rate on 5 trades) every manual addition so far has been
 * screened against. */
export const MIN_TRADES_TO_TRUST = 6;
export const DEFAULT_TOP_N = 40;
/** Smaller default for the on-demand `/discover` Telegram command, which
 * blocks a live reply — the weekly scheduled job can afford the full 40
 * since nothing is waiting on it synchronously. */
export const DEFAULT_ON_DEMAND_TOP_N = 20;
/** Stablecoins are often among the highest-volume EUR pairs but structurally
 * can't pass a momentum strategy (their entire purpose is not moving) — skip
 * them rather than waste two rate-limited candle fetches on a guaranteed
 * 0-trade result. */
export const STABLECOIN_BASES = new Set(['USDC', 'USDT', 'DAI', 'PYUSD', 'EURT', 'EURR']);

export interface CandidateScanSource {
  getInstruments(): Promise<Result<Instrument[]>>;
  getTickers(): Promise<Result<Ticker[]>>;
  getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Result<Candle[]>>;
}

export interface CandidateRow {
  readonly symbol: string;
  readonly base: string;
  readonly quoteVolume: number;
  readonly returnPct: number;
  readonly trades: number;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
  readonly passes: boolean;
}

export interface CandidateScanResult {
  readonly rows: CandidateRow[];
  readonly skipped: string[];
}

/**
 * Ranks the top `topN` non-curated EUR pairs by 24h volume and measures each
 * through the live decision pipeline over ~720 real 1h candles (plus 4h for
 * higher-timeframe confirmation, mirroring production). `curatedSymbols`
 * (Kraken-symbol-shaped, e.g. 'XBTEUR') is whatever's already traded — never
 * re-measured here.
 */
export async function scanCandidates(
  source: CandidateScanSource,
  curatedSymbols: ReadonlySet<string>,
  topN: number = DEFAULT_TOP_N,
): Promise<CandidateScanResult> {
  const tickers = await source.getTickers();
  if (!tickers.ok) return { rows: [], skipped: [`tickers unavailable: ${tickers.error}`] };

  const instruments = await source.getInstruments();
  const baseBySymbol = new Map(
    instruments.ok ? instruments.value.map((i) => [i.symbol, i.base] as const) : [],
  );

  const candidates = tickers.value
    .filter((t) => !curatedSymbols.has(t.symbol))
    .filter((t) => !STABLECOIN_BASES.has(baseBySymbol.get(t.symbol) ?? t.symbol))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, topN);

  const rows: CandidateRow[] = [];
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

  return { rows, skipped };
}

/** Shared number formatting for both the CLI table and the Telegram message —
 * one "how do we describe a result" convention, not two that could drift. */
export function fmtSignedPct(value: number, dp = 2): string {
  const s = value.toFixed(dp);
  return value > 0 ? `+${s}` : s;
}

export function fmtRatioOrNa(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

export function fmtPctOrNa(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(1);
}
