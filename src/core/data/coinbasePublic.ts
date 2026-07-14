/**
 * Coinbase Exchange public market data source.
 *
 * Second browser-direct, keyless fallback (after Kraken) so the phone
 * platform keeps live data even where one provider is regionally blocked.
 * CORS is fully open (`access-control-allow-origin: *`, verified).
 *
 * API: GET https://api.exchange.coinbase.com/products/{pair}/candles?granularity=<sec>
 * Rows are [timeSec, LOW, HIGH, OPEN, CLOSE, volume] — note the order —
 * and arrive newest-first, max 300 per request.
 *
 * Native granularities: 1m, 5m, 15m, 1h, 6h, 1d. The platform's 30m, 4h,
 * and 1w timeframes are synthesised by aggregating native candles; a
 * partial group at the start is dropped, the forming group at the end is
 * kept (same as exchanges reporting the in-progress candle).
 */

import type { Candle, Instrument, Result, Timeframe } from '../types';
import { err, ok } from '../types';
import { parseCandleSeries } from './candles';
import type { MarketDataSource } from './revolutClient';

const BASE_URL = 'https://api.exchange.coinbase.com';
const DEFAULT_TIMEOUT_MS = 15_000;

/** Native granularity (seconds) + how many to merge per output candle. */
const PLAN: Record<Timeframe, { granularitySec: number; group: number }> = {
  '1m': { granularitySec: 60, group: 1 },
  '5m': { granularitySec: 300, group: 1 },
  '15m': { granularitySec: 900, group: 1 },
  '30m': { granularitySec: 900, group: 2 },
  '1h': { granularitySec: 3600, group: 1 },
  '4h': { granularitySec: 3600, group: 4 },
  '1d': { granularitySec: 86_400, group: 1 },
  '1w': { granularitySec: 86_400, group: 7 },
};

const INSTRUMENTS: Instrument[] = [
  { symbol: 'BTC-EUR', base: 'BTC', quote: 'EUR' },
  { symbol: 'ETH-EUR', base: 'ETH', quote: 'EUR' },
  { symbol: 'SOL-EUR', base: 'SOL', quote: 'EUR' },
  { symbol: 'XRP-EUR', base: 'XRP', quote: 'EUR' },
  { symbol: 'ADA-EUR', base: 'ADA', quote: 'EUR' },
  { symbol: 'DOGE-EUR', base: 'DOGE', quote: 'EUR' },
  { symbol: 'LTC-EUR', base: 'LTC', quote: 'EUR' },
  { symbol: 'DOT-EUR', base: 'DOT', quote: 'EUR' },
  { symbol: 'LINK-EUR', base: 'LINK', quote: 'EUR' },
  { symbol: 'AVAX-EUR', base: 'AVAX', quote: 'EUR' },
];

export interface CoinbasePublicSourceOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class CoinbasePublicSource implements MarketDataSource {
  readonly name = 'Coinbase public market data (read-only)';
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CoinbasePublicSourceOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getInstruments(): Promise<Result<Instrument[]>> {
    return Promise.resolve(ok([...INSTRUMENTS]));
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
  ): Promise<Result<Candle[]>> {
    if (limit <= 0) return err(`limit must be positive, got ${limit}`);
    const { granularitySec, group } = PLAN[timeframe];
    const url =
      `${BASE_URL}/products/${encodeURIComponent(symbol)}/candles` +
      `?granularity=${granularitySec}`;

    const payload = await this.getJson(url);
    if (!payload.ok) return payload;
    const rows = payload.value;
    if (!Array.isArray(rows)) {
      const message =
        typeof rows === 'object' && rows !== null && 'message' in rows
          ? String((rows as { message: unknown }).message)
          : 'not an array';
      return err(`unexpected Coinbase payload: ${message}`);
    }

    // Remap [t, low, high, open, close, v] -> [t, open, high, low, close, v].
    const remapped = rows
      .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 6)
      .map((r) => [r[0], r[3], r[2], r[1], r[4], r[5]]);
    const { candles, rejected } = parseCandleSeries(remapped);
    if (candles.length === 0) {
      return err(
        rejected.length > 0
          ? `all ${rejected.length} Coinbase rows invalid (first: ${rejected[0]?.reason})`
          : 'empty candle series from Coinbase',
      );
    }

    const aggregated = group === 1 ? candles : aggregate(candles, granularitySec * group * 1000);
    return ok(aggregated.slice(-limit));
  }

  private async getJson(url: string): Promise<Result<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return err(`HTTP ${response.status} from ${url}`);
      return ok((await response.json()) as unknown);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return err(`request failed for ${url}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Merge consecutive candles into fixed spans aligned to the span boundary.
 * The first group is dropped when its opening candle is missing (partial
 * history); the final, still-forming group is kept.
 */
function aggregate(candles: readonly Candle[], spanMs: number): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucket = candle.timestamp - (candle.timestamp % spanMs);
    const list = groups.get(bucket) ?? [];
    list.push(candle);
    groups.set(bucket, list);
  }
  const buckets = [...groups.keys()].sort((a, b) => a - b);
  const out: Candle[] = [];
  buckets.forEach((bucket, index) => {
    const members = groups.get(bucket)!;
    // Drop the first group unless it starts exactly on the boundary.
    if (index === 0 && members[0]!.timestamp !== bucket) return;
    out.push({
      timestamp: bucket,
      open: members[0]!.open,
      high: Math.max(...members.map((c) => c.high)),
      low: Math.min(...members.map((c) => c.low)),
      close: members[members.length - 1]!.close,
      volume: members.reduce((sum, c) => sum + c.volume, 0),
    });
  });
  return out;
}
