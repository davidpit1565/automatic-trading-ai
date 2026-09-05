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
  priority = false,
): Promise<Result<Candle[]>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await withTimeout(
        data.source.getCandles(symbol, timeframe, limit, { priority }),
        7000,
      );
      if (res.ok) return res;
    } catch {
      /* timeout or transient error — the next attempt retries */
    }
  }
  return { ok: false, error: 'Market data temporarily unavailable' };
}

/**
 * A time series of closes for a range, for the detail chart. `priority`
 * (default on — this feeds the chart the user is actively looking at) makes
 * this jump ahead of background sweeps in the shared Kraken request queue.
 */
export async function fetchSeries(
  data: ActiveDataSource,
  symbol: string,
  timeframe: Timeframe,
  limit: number,
  priority = true,
): Promise<PriceSeries | null> {
  const candles = await resilientCandles(data, symbol, timeframe, limit, priority);
  if (!candles.ok || candles.value.length < 2) return null;
  const points = candles.value.map((c) => ({ timestamp: c.timestamp, value: c.close }));
  const price = points[points.length - 1]!.value;
  const first = points[0]!.value;
  return { points, price, changePct: first > 0 ? ((price - first) / first) * 100 : 0 };
}

export interface CandleSeries {
  readonly candles: Candle[];
  readonly price: number;
  readonly changePct: number;
}

/**
 * Raw OHLC candles for a range, for the professional candlestick detail
 * chart. `priority` (default on) jumps ahead of background sweeps in the
 * shared Kraken request queue — this is the chart the user is looking at now.
 */
export async function fetchCandleSeries(
  data: ActiveDataSource,
  symbol: string,
  timeframe: Timeframe,
  limit: number,
  priority = true,
): Promise<CandleSeries | null> {
  const candles = await resilientCandles(data, symbol, timeframe, limit, priority);
  if (!candles.ok || candles.value.length < 2) return null;
  const price = candles.value[candles.value.length - 1]!.close;
  const first = candles.value[0]!.close;
  return { candles: candles.value, price, changePct: first > 0 ? ((price - first) / first) * 100 : 0 };
}

export interface MarketSnapshot {
  readonly symbol: string;
  readonly label: string;
  readonly price: number;
  /** Change across the fetched window. */
  readonly changePct: number;
  readonly closes: number[];
}

/**
 * One row of the full markets list. Deliberately has NO price series: it is
 * built from a single batch-ticker request covering every market, which is
 * what makes a several-hundred-row list possible at all. Sparklines would
 * need one candle request per symbol, so they live in the detail view.
 */
export interface MarketRow {
  readonly symbol: string;
  readonly label: string;
  /** Clean asset code (BTC, ETH) — the key for logos and search. */
  readonly base: string;
  readonly price: number;
  /** Absolute daily change in the quote currency. */
  readonly change: number;
  readonly changePct: number;
  readonly high: number;
  readonly low: number;
  /** Liquidity, for sorting. */
  readonly quoteVolume: number;
  /** When this row was fetched — drives the freshness indicator. */
  readonly updatedAt: number;
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

/** Display names for the broadened, browse-only universe (majors are above). */
const NAMES: Readonly<Record<string, string>> = {
  LINK: 'Chainlink',
  AVAX: 'Avalanche',
  POL: 'Polygon',
  TRX: 'TRON',
  ATOM: 'Cosmos',
  XLM: 'Stellar',
  BCH: 'Bitcoin Cash',
  UNI: 'Uniswap',
  AAVE: 'Aave',
  ETC: 'Ethereum Classic',
  FIL: 'Filecoin',
  NEAR: 'NEAR Protocol',
  ALGO: 'Algorand',
  INJ: 'Injective',
  ARB: 'Arbitrum',
  OP: 'Optimism',
  APT: 'Aptos',
  PAXG: 'PAX Gold',
};

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
  return MAJORS.find((m) => m.base === base)?.label ?? (base ? NAMES[base] : undefined) ?? base ?? symbol;
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
  // The change % here is displayed everywhere (topbar BTC chip, Home's
  // markets strip) as an unlabeled "chg" pill, the same convention as a
  // real exchange's 24h change (and `fetchMarketRows`'s ticker-based rows,
  // which correctly use the exchange's own 24h open). `count` defaults to
  // 48 hourly candles for a smoother sparkline, so using closes[0] (48h
  // ago) here silently doubled the window — real bug, caught 2026-09-05:
  // David's screenshot showed our BTC chip at -2.04% next to Revolut X's
  // real -0.15% for the same moment. Anchor 24 candles back from the
  // latest instead, falling back to the oldest available if fewer candles
  // came back (a network hiccup shouldn't crash this, just widen the
  // window slightly).
  const dayAgoIndex = Math.max(0, closes.length - 25);
  const first = closes[dayAgoIndex]!;
  return { symbol, label, price, changePct: first > 0 ? ((price - first) / first) * 100 : 0, closes };
}

export async function fetchTopMarkets(data: ActiveDataSource, max = Infinity): Promise<MarketSnapshot[]> {
  // Build the browsable universe: curated majors first (in table order), then
  // every remaining instrument (broadened, display-only). Fetch concurrently —
  // one slow coin no longer blocks the rest. Order preserved; failures dropped.
  const seen = new Set<string>();
  const targets: { symbol: string; label: string }[] = [];
  for (const major of MAJORS) {
    const symbol = symbolForBase(data, major.base);
    if (symbol !== null && !seen.has(symbol)) {
      seen.add(symbol);
      targets.push({ symbol, label: major.label });
    }
  }
  for (const inst of data.instruments) {
    if (seen.has(inst.symbol)) continue;
    seen.add(inst.symbol);
    targets.push({ symbol: inst.symbol, label: labelFor(data, inst.symbol) });
  }
  const chosen = targets.slice(0, max);
  const snaps = await Promise.all(chosen.map((t) => fetchSnapshot(data, t.symbol, t.label)));
  return snaps.filter((s): s is MarketSnapshot => s !== null);
}

/**
 * The full markets list, from ONE batch-ticker request when the active source
 * offers it (Kraken does). Ordering: the curated majors first, in their fixed
 * display order, then every remaining market by liquidity.
 *
 * Falls back to the per-symbol candle sweep for sources without a batch
 * ticker, so a source swap degrades to the old, smaller list rather than an
 * empty screen.
 */
export async function fetchMarketRows(
  data: ActiveDataSource,
  fallbackMax = 60,
  now: () => number = Date.now,
): Promise<MarketRow[]> {
  let batch = data.source.getTickers ? await data.source.getTickers() : null;
  // One cheap retry. Observed live: the batch request fails transiently now and
  // then, and retrying the single request beats the alternative by a wide
  // margin — see below.
  if (data.source.getTickers && !batch?.ok) batch = await data.source.getTickers();

  if (batch?.ok && batch.value.length > 0) {
    const at = now();
    const byBase = new Map<string, number>();
    MAJORS.forEach((m, i) => byBase.set(m.base, i));

    const rows = batch.value.map((t): MarketRow => {
      const inst = data.instruments.find((i) => i.symbol === t.symbol);
      const base = (inst?.base ?? t.symbol).toUpperCase();
      return {
        symbol: t.symbol,
        label: labelFor(data, t.symbol),
        base,
        price: t.price,
        change: t.price - t.open,
        changePct: t.open > 0 ? ((t.price - t.open) / t.open) * 100 : 0,
        high: t.high,
        low: t.low,
        quoteVolume: t.quoteVolume,
        updatedAt: at,
      };
    });

    // Majors keep their fixed order at the top; the rest by liquidity. Sorting
    // a copy keeps this pure for callers holding the previous list.
    return [...rows].sort((a, b) => {
      const ra = byBase.get(a.base);
      const rb = byBase.get(b.base);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return b.quoteVolume - a.quoteVolume;
    });
  }

  // A source WITH a batch ticker that is currently failing must not trigger the
  // per-symbol sweep: that is 60 sequential requests taking ~9s (measured
  // during a real outage) which then failed anyway — and if the cause is rate
  // limiting, it makes it worse. Return nothing and let the caller keep the
  // last good list; the single cheap request is retried on the next refresh.
  if (data.source.getTickers) return [];

  // Genuinely no batch endpoint on this source — degrade to the per-symbol sweep.
  const at = now();
  const snaps = await fetchTopMarkets(data, fallbackMax);
  return snaps.map((s): MarketRow => {
    const inst = data.instruments.find((i) => i.symbol === s.symbol);
    const previous = s.closes[0] ?? s.price;
    return {
      symbol: s.symbol,
      label: s.label,
      base: (inst?.base ?? s.symbol).toUpperCase(),
      price: s.price,
      change: s.price - previous,
      changePct: s.changePct,
      high: Math.max(...s.closes, s.price),
      low: Math.min(...s.closes, s.price),
      quoteVolume: 0,
      updatedAt: at,
    };
  });
}
