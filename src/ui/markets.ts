/**
 * Live market snapshots for the dashboard's Markets strip, top bar, and
 * detail chart. Presentation-only: pulls candles from the active data
 * source and derives a current price, a window change %, and the close
 * series for charts.
 */

import type { ActiveDataSource } from './dataSource';
import type { Candle, Result, Timeframe } from '../core/types';

export interface PriceSeries {
  readonly points: { timestamp: number; value: number }[];
  readonly price: number;
  readonly changePct: number;
}

/** Reject a pending promise after `ms` so one slow request can't hang the UI. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Fetch candles with a per-call timeout and one automatic retry. A transient
 * slow/failed response no longer collapses the whole view to "unavailable" —
 * this is the fix for the connection glitches on flaky mobile networks.
 */
async function resilientCandles(
  data: ActiveDataSource,
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<Result<Candle[]>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await withTimeout(data.source.getCandles(symbol, timeframe, limit), 7000);
      if (res.ok) return res;
    } catch {
      /* timeout or transient error — the next attempt retries */
    }
  }
  return { ok: false, error: 'Market data temporarily unavailable' };
}

/** A time series of closes for a range, for the detail chart. */
export async function fetchSeries(
  data: ActiveDataSource,
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<PriceSeries | null> {
  const candles = await resilientCandles(data, symbol, timeframe, limit);
  if (!candles.ok || candles.value.length < 2) return null;
  const points = candles.value.map((c) => ({ timestamp: c.timestamp, value: c.close }));
  const price = points[points.length - 1]!.value;
  const first = points[0]!.value;
  return { points, price, changePct: first > 0 ? ((price - first) / first) * 100 : 0 };
}

export interface MarketSnapshot {
  readonly symbol: string;
  readonly label: string;
  readonly price: number;
  /** Change across the fetched window. */
  readonly changePct: number;
  readonly closes: number[];
}

/** Majors in display order, matched by the instrument's clean `base` code. */
const MAJORS: ReadonlyArray<{ base: string; label: string }> = [
  { base: 'BTC', label: 'Bitcoin' },
  { base: 'ETH', label: 'Ethereum' },
  { base: 'SOL', label: 'Solana' },
  { base: 'XRP', label: 'XRP' },
  { base: 'ADA', label: 'Cardano' },
  { base: 'DOGE', label: 'Dogecoin' },
  { base: 'LTC', label: 'Litecoin' },
  { base: 'DOT', label: 'Polkadot' },
];

/** The instrument whose base matches (case-insensitive), or null. */
function symbolForBase(data: ActiveDataSource, base: string): string | null {
  const hit = data.instruments.find((i) => i.base.toUpperCase() === base.toUpperCase());
  return hit?.symbol ?? null;
}

export function findBtcSymbol(data: ActiveDataSource): string | null {
  return symbolForBase(data, 'BTC');
}

/** Display label for a symbol, from the majors table or the base code. */
export function labelFor(data: ActiveDataSource, symbol: string): string {
  const inst = data.instruments.find((i) => i.symbol === symbol);
  const base = inst?.base.toUpperCase();
  return MAJORS.find((m) => m.base === base)?.label ?? base ?? symbol;
}

export async function fetchSnapshot(
  data: ActiveDataSource,
  symbol: string,
  label: string,
  count = 48,
): Promise<MarketSnapshot | null> {
  const candles = await resilientCandles(data, symbol, '1h', count);
  if (!candles.ok || candles.value.length < 2) return null;
  const closes = candles.value.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const first = closes[0]!;
  return { symbol, label, price, changePct: first > 0 ? ((price - first) / first) * 100 : 0, closes };
}

export async function fetchTopMarkets(data: ActiveDataSource, max = 6): Promise<MarketSnapshot[]> {
  // Resolve the majors we actually have instruments for, then fetch them all
  // concurrently — one slow coin no longer blocks the rest, and the list
  // appears far faster on a phone. Order is preserved; failures are dropped.
  const targets = MAJORS.map((major) => ({ major, symbol: symbolForBase(data, major.base) }))
    .filter((t): t is { major: (typeof MAJORS)[number]; symbol: string } => t.symbol !== null)
    .slice(0, max);
  const snaps = await Promise.all(
    targets.map((t) => fetchSnapshot(data, t.symbol, t.major.label)),
  );
  return snaps.filter((s): s is MarketSnapshot => s !== null);
}
