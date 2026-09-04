/**
 * Real-time momentum-spike scan — deliberately NOT the same thing as
 * candidateScan.ts. David asked for this separately (2026-09-04): "some
 * coins are only worth trading for a few hours or a day, even if they're
 * not normally good coins — catch that and alert me, I'll decide manually."
 *
 * candidateScan.ts measures ~720 hours of real history through the live
 * decision pipeline before ever suggesting a symbol, specifically to reject
 * "flashy but thin" noise (a 100%-win-rate-on-5-trades result). A multi-hour
 * price spike has no meaningful history to measure THAT WAY — by the time
 * enough independent data existed to backtest it, the spike would already
 * be over. So this scan intentionally does not apply candidateScan's
 * pass-bar at all: it can only ever surface a speculative, human-reviewed
 * alert, never a measured recommendation. It never adds to
 * CURATED_INSTRUMENTS and never trades anything — read-only, alert-only,
 * same safety posture as candidateScan.ts, just a different (and much
 * weaker) kind of evidence.
 */

import type { Instrument, Result, Ticker } from '../types';

/** A symbol must be up at least this much (Kraken's own since-midnight
 * `open`, not a true rolling 24h window — see Ticker's own doc comment) to
 * count as a "spike" worth alerting on. */
export const DEFAULT_SPIKE_THRESHOLD_PCT = 15;
/** Filters out illiquid dust-coins that can swing wildly on almost no real
 * volume — a real move should have real money behind it. */
export const DEFAULT_MIN_QUOTE_VOLUME = 500_000;
export const DEFAULT_TOP_N = 8;
/** Same list candidateScan.ts excludes, for the same reason: a stablecoin's
 * entire purpose is not moving, so any "spike" is measurement noise, not a
 * real opportunity. */
const STABLECOIN_BASES = new Set(['USDC', 'USDT', 'DAI', 'PYUSD', 'EURT', 'EURR']);

export interface MomentumScanSource {
  getInstruments(): Promise<Result<Instrument[]>>;
  getTickers(): Promise<Result<Ticker[]>>;
}

export interface MomentumRow {
  readonly symbol: string;
  readonly base: string;
  readonly price: number;
  /** Since Kraken's own session-open (UTC midnight), not a rolling 24h
   * window — see Ticker's own doc comment. */
  readonly pctChange: number;
  readonly quoteVolume: number;
  readonly high: number;
  readonly low: number;
}

export interface MomentumScanResult {
  readonly rows: readonly MomentumRow[];
  readonly error?: string;
}

export interface MomentumScanOptions {
  readonly thresholdPct?: number;
  readonly minQuoteVolume?: number;
  readonly topN?: number;
}

/**
 * Ranks non-curated, non-stablecoin EUR pairs currently up at least
 * `thresholdPct` today (by quote volume, descending), capped at `topN`.
 * `curatedSymbols` (Kraken-symbol-shaped, e.g. 'XBTEUR') is whatever's
 * already traded — already visible elsewhere, never re-flagged here.
 */
export async function scanMomentumSpikes(
  source: MomentumScanSource,
  curatedSymbols: ReadonlySet<string>,
  opts: MomentumScanOptions = {},
): Promise<MomentumScanResult> {
  const thresholdPct = opts.thresholdPct ?? DEFAULT_SPIKE_THRESHOLD_PCT;
  const minQuoteVolume = opts.minQuoteVolume ?? DEFAULT_MIN_QUOTE_VOLUME;
  const topN = opts.topN ?? DEFAULT_TOP_N;

  const tickers = await source.getTickers();
  if (!tickers.ok) return { rows: [], error: `tickers unavailable: ${tickers.error}` };

  const instruments = await source.getInstruments();
  const baseBySymbol = new Map(
    instruments.ok ? instruments.value.map((i) => [i.symbol, i.base] as const) : [],
  );

  const rows = tickers.value
    .filter((t) => !curatedSymbols.has(t.symbol))
    .filter((t) => !STABLECOIN_BASES.has(baseBySymbol.get(t.symbol) ?? t.symbol))
    .filter((t) => t.quoteVolume >= minQuoteVolume)
    .filter((t) => t.open > 0) // guards the division below against a malformed ticker
    .map((t) => ({
      symbol: t.symbol,
      base: baseBySymbol.get(t.symbol) ?? t.symbol,
      price: t.price,
      pctChange: ((t.price - t.open) / t.open) * 100,
      quoteVolume: t.quoteVolume,
      high: t.high,
      low: t.low,
    }))
    .filter((r) => r.pctChange >= thresholdPct)
    .sort((a, b) => b.pctChange - a.pctChange)
    .slice(0, topN);

  return { rows };
}
