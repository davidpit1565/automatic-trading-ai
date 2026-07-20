/**
 * Kraken public market data source.
 *
 * Browser-direct, keyless, CORS-open (verified) — this is what lets the
 * platform run with REAL market data on a phone, with no local proxy and
 * no credentials. Read-only by construction like every data source here.
 *
 * API: GET https://api.kraken.com/0/public/OHLC?pair=XBTEUR&interval=60
 * Response: { error: [], result: { <PAIRKEY>: rows, last } } where each row
 * is [timeSec, open, high, low, close, vwap, volume, count] — note vwap at
 * index 5 (dropped) and volume at index 6. The result key can differ from
 * the requested pair (XBTEUR -> XXBTZEUR), so the first non-`last` key wins.
 *
 * Prices on Kraken can differ slightly from Revolut X — the UI labels the
 * active source so this is never hidden.
 */

import type { Candle, Instrument, Result, Timeframe } from '../types';
import { err, ok } from '../types';
import { parseCandleSeries } from './candles';
import type { MarketDataSource } from './revolutClient';

const BASE_URL = 'https://api.kraken.com/0/public';
const DEFAULT_TIMEOUT_MS = 15_000;
/** Pause between requests — Kraken's public rate limits are per IP. */
const DEFAULT_STAGGER_MS = 150;

/** Kraken expresses intervals in whole minutes; 1:1 with our timeframes. */
const INTERVAL_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10_080,
};

/** Curated majors, EUR-quoted. Kraken names Bitcoin XBT; we display BTC. */
const INSTRUMENTS: Instrument[] = [
  { symbol: 'XBTEUR', base: 'BTC', quote: 'EUR' },
  { symbol: 'ETHEUR', base: 'ETH', quote: 'EUR' },
  { symbol: 'SOLEUR', base: 'SOL', quote: 'EUR' },
  { symbol: 'XRPEUR', base: 'XRP', quote: 'EUR' },
  { symbol: 'ADAEUR', base: 'ADA', quote: 'EUR' },
  { symbol: 'DOGEEUR', base: 'DOGE', quote: 'EUR' },
  { symbol: 'LTCEUR', base: 'LTC', quote: 'EUR' },
  { symbol: 'DOTEUR', base: 'DOT', quote: 'EUR' },
  { symbol: 'LINKEUR', base: 'LINK', quote: 'EUR' },
  { symbol: 'AVAXEUR', base: 'AVAX', quote: 'EUR' },
  // Appended DISPLAY-only universe (each verified live on Kraken). These are
  // browsable/charts only and are NOT traded by the robot: the autopilot trades
  // strictly the first 10 validated majors above. Do NOT reorder the entries
  // above this line. PAXG is a gold-backed token (tracks gold, not physical).
  { symbol: 'POLEUR', base: 'POL', quote: 'EUR' },
  { symbol: 'TRXEUR', base: 'TRX', quote: 'EUR' },
  { symbol: 'ATOMEUR', base: 'ATOM', quote: 'EUR' },
  { symbol: 'XLMEUR', base: 'XLM', quote: 'EUR' },
  { symbol: 'BCHEUR', base: 'BCH', quote: 'EUR' },
  { symbol: 'UNIEUR', base: 'UNI', quote: 'EUR' },
  { symbol: 'AAVEEUR', base: 'AAVE', quote: 'EUR' },
  { symbol: 'ETCEUR', base: 'ETC', quote: 'EUR' },
  { symbol: 'FILEUR', base: 'FIL', quote: 'EUR' },
  { symbol: 'NEAREUR', base: 'NEAR', quote: 'EUR' },
  { symbol: 'ALGOEUR', base: 'ALGO', quote: 'EUR' },
  { symbol: 'INJEUR', base: 'INJ', quote: 'EUR' },
  { symbol: 'ARBEUR', base: 'ARB', quote: 'EUR' },
  { symbol: 'OPEUR', base: 'OP', quote: 'EUR' },
  { symbol: 'APTEUR', base: 'APT', quote: 'EUR' },
  { symbol: 'PAXGEUR', base: 'PAXG', quote: 'EUR' },
];

export interface KrakenPublicSourceOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Delay between queued requests; lower only in tests. */
  staggerMs?: number;
}

/** One pending request waiting for its turn in the serial queue. */
interface QueuedTask {
  readonly run: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

export class KrakenPublicSource implements MarketDataSource {
  readonly name = 'Kraken public market data (read-only)';
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly staggerMs: number;
  /**
   * Serialises all requests one-at-a-time (Kraken rate-limits per IP) via a
   * real task queue rather than a promise chain, so a `priority` request
   * (the chart a user just opened) can jump ahead of already-queued
   * background work (e.g. the Markets list's ~26-coin sweep) instead of
   * waiting behind all of it — that queue-starvation was why an interactive
   * chart could take 8+ seconds and time out even though Kraken itself
   * answers a full concurrent burst in about a second (measured).
   */
  private readonly pending: QueuedTask[] = [];
  private draining = false;

  constructor(options: KrakenPublicSourceOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.staggerMs = options.staggerMs ?? DEFAULT_STAGGER_MS;
  }

  getInstruments(): Promise<Result<Instrument[]>> {
    return Promise.resolve(ok([...INSTRUMENTS]));
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    opts?: { readonly priority?: boolean },
  ): Promise<Result<Candle[]>> {
    if (limit <= 0) return err(`limit must be positive, got ${limit}`);
    const interval = INTERVAL_MINUTES[timeframe];
    // `since` trims the response server-side to roughly the window we need.
    const sinceSec = Math.floor((this.now() - (limit + 2) * interval * 60_000) / 1000);
    const url =
      `${BASE_URL}/OHLC?pair=${encodeURIComponent(symbol)}` +
      `&interval=${interval}&since=${sinceSec}`;

    const payload = await this.enqueue(() => this.getJson(url), opts?.priority ?? false);
    if (!payload.ok) return payload;

    const raw = payload.value as {
      error?: unknown[];
      result?: Record<string, unknown>;
    };
    if (Array.isArray(raw.error) && raw.error.length > 0) {
      return err(`Kraken error: ${raw.error.join('; ')}`);
    }
    const result = raw.result;
    if (typeof result !== 'object' || result === null) {
      return err('unexpected Kraken payload: no result object');
    }
    const pairKey = Object.keys(result).find((key) => key !== 'last');
    const rows = pairKey !== undefined ? result[pairKey] : undefined;
    if (!Array.isArray(rows)) return err('unexpected Kraken payload: no OHLC rows');

    // Remap [t, o, h, l, c, vwap, volume, count] -> [t, o, h, l, c, volume].
    const remapped = rows
      .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 7)
      .map((row) => [row[0], row[1], row[2], row[3], row[4], row[6]]);
    const { candles, rejected } = parseCandleSeries(remapped);
    if (candles.length === 0) {
      return err(
        rejected.length > 0
          ? `all ${rejected.length} Kraken rows invalid (first: ${rejected[0]?.reason})`
          : 'empty candle series from Kraken',
      );
    }
    return ok(candles.slice(-limit));
  }

  /**
   * Run a request through the serial queue with a stagger between calls.
   * `priority` jumps ahead of already-queued non-priority work (but never
   * ahead of whatever request is already in flight) — still exactly one
   * request at a time, just reordered so an interactive need is served next.
   */
  private enqueue<T>(task: () => Promise<T>, priority = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueuedTask = { run: task, resolve: resolve as (v: unknown) => void, reject };
      if (priority) this.pending.unshift(item);
      else this.pending.push(item);
      void this.drain();
    });
  }

  /** Processes queued tasks one at a time, staggered, until the queue is empty. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift()!;
        try {
          item.resolve(await item.run());
        } catch (cause) {
          item.reject(cause);
        }
        if (this.pending.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.staggerMs));
        }
      }
    } finally {
      this.draining = false;
    }
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
