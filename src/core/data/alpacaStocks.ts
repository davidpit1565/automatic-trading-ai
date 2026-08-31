/**
 * Alpaca Market Data source for US equities.
 *
 * Server-side only by design (unlike Kraken/Coinbase, this needs an API key,
 * so it's read through the cloud runner, never the browser). Chosen over a
 * free keyless alternative (Yahoo Finance's unofficial chart endpoint)
 * specifically for long-term stability — this is an officially documented,
 * versioned API, on the same provider whose paper (and eventually live)
 * trading this project is meant to sit on top of.
 *
 * API: GET https://data.alpaca.markets/v2/stocks/{symbol}/bars
 *   ?timeframe=1Hour&start=...&sort=desc&limit=...&adjustment=all&feed=iex
 * Headers: APCA-API-KEY-ID, APCA-API-SECRET-KEY
 * Response: { bars: [{t,o,h,l,c,v,n,vw}], symbol, next_page_token }
 *
 * `sort=desc` + `limit` returns the N most recent bars regardless of how
 * wide `start` is — deliberately generous rather than trying to compute an
 * exact market-hours-aware lookback window (stocks trade ~6.5h/day, 5 days a
 * week; getting that math slightly wrong would silently under-fill the
 * window the way a too-narrow `start` would).
 *
 * `feed=iex` is the free-tier data feed (15-minutes-delayed vs the paid
 * `sip` feed) — fine for paper trading and swing-style signals, not for
 * latency-sensitive execution.
 */

import type { Candle, Instrument, Result, Timeframe } from '../types';
import { err, ok } from '../types';
import { parseCandleSeries } from './candles';
import type { MarketDataSource } from './revolutClient';

const BASE_URL = 'https://data.alpaca.markets/v2';
const DEFAULT_TIMEOUT_MS = 15_000;
/** Wide enough that real trading history always exists within it, for every
 * granularity this source supports — `sort=desc&limit=N` does the real
 * trimming to the N most recent bars, so precision here doesn't matter. */
const LOOKBACK_MS: Record<Timeframe, number> = {
  '1m': 14 * 86_400_000,
  '5m': 30 * 86_400_000,
  '15m': 60 * 86_400_000,
  '30m': 90 * 86_400_000,
  '1h': 180 * 86_400_000,
  '4h': 365 * 86_400_000,
  '1d': 5 * 365 * 86_400_000,
  '1w': 10 * 365 * 86_400_000,
};

const TIMEFRAME_ALPACA: Record<Timeframe, string> = {
  '1m': '1Min',
  '5m': '5Min',
  '15m': '15Min',
  '30m': '30Min',
  '1h': '1Hour',
  '4h': '4Hour',
  '1d': '1Day',
  '1w': '1Week',
};

/**
 * Curated majors, USD-quoted — mirrors the crypto side's fixed-list pattern
 * (`krakenPublic.ts`'s `CURATED_INSTRUMENTS`). This is the universe a stocks
 * autopilot would trade; broadening it is a measured decision, not a casual
 * list edit (same rule as the crypto majors).
 */
export const CURATED_STOCK_INSTRUMENTS: Instrument[] = [
  { symbol: 'AAPL', base: 'AAPL', quote: 'USD' },
  { symbol: 'MSFT', base: 'MSFT', quote: 'USD' },
  { symbol: 'GOOGL', base: 'GOOGL', quote: 'USD' },
  { symbol: 'AMZN', base: 'AMZN', quote: 'USD' },
  { symbol: 'NVDA', base: 'NVDA', quote: 'USD' },
  { symbol: 'META', base: 'META', quote: 'USD' },
  { symbol: 'TSLA', base: 'TSLA', quote: 'USD' },
  { symbol: 'JPM', base: 'JPM', quote: 'USD' },
  { symbol: 'V', base: 'V', quote: 'USD' },
  { symbol: 'WMT', base: 'WMT', quote: 'USD' },
];

/**
 * BROWSABLE (display-only) superset of the curated majors above — mirrors
 * `krakenPublic.ts`'s curated-vs-discovered split: broadening what a user can
 * see the price of is safe and instant; broadening what the agent actually
 * TRADES stays gated behind a real measurement (`scripts/measureStocks.mts`),
 * exactly like the crypto majors. Nothing here is read by the autopilot —
 * only `stocksRunner.mts`'s market-snapshot recorder and the browser's
 * Markets/Home views use it.
 */
export const BROWSABLE_STOCK_INSTRUMENTS: Instrument[] = [
  ...CURATED_STOCK_INSTRUMENTS,
  // Technology
  { symbol: 'AVGO', base: 'AVGO', quote: 'USD' },
  { symbol: 'ORCL', base: 'ORCL', quote: 'USD' },
  { symbol: 'ADBE', base: 'ADBE', quote: 'USD' },
  { symbol: 'CRM', base: 'CRM', quote: 'USD' },
  { symbol: 'CSCO', base: 'CSCO', quote: 'USD' },
  { symbol: 'INTC', base: 'INTC', quote: 'USD' },
  { symbol: 'AMD', base: 'AMD', quote: 'USD' },
  { symbol: 'QCOM', base: 'QCOM', quote: 'USD' },
  // Financials
  { symbol: 'BAC', base: 'BAC', quote: 'USD' },
  { symbol: 'WFC', base: 'WFC', quote: 'USD' },
  { symbol: 'GS', base: 'GS', quote: 'USD' },
  { symbol: 'MS', base: 'MS', quote: 'USD' },
  { symbol: 'AXP', base: 'AXP', quote: 'USD' },
  // Healthcare
  { symbol: 'UNH', base: 'UNH', quote: 'USD' },
  { symbol: 'JNJ', base: 'JNJ', quote: 'USD' },
  { symbol: 'PFE', base: 'PFE', quote: 'USD' },
  { symbol: 'ABBV', base: 'ABBV', quote: 'USD' },
  { symbol: 'MRK', base: 'MRK', quote: 'USD' },
  { symbol: 'LLY', base: 'LLY', quote: 'USD' },
  // Consumer
  { symbol: 'HD', base: 'HD', quote: 'USD' },
  { symbol: 'MCD', base: 'MCD', quote: 'USD' },
  { symbol: 'NKE', base: 'NKE', quote: 'USD' },
  { symbol: 'SBUX', base: 'SBUX', quote: 'USD' },
  { symbol: 'PG', base: 'PG', quote: 'USD' },
  { symbol: 'KO', base: 'KO', quote: 'USD' },
  { symbol: 'PEP', base: 'PEP', quote: 'USD' },
  { symbol: 'COST', base: 'COST', quote: 'USD' },
  { symbol: 'TGT', base: 'TGT', quote: 'USD' },
  // Energy
  { symbol: 'XOM', base: 'XOM', quote: 'USD' },
  { symbol: 'CVX', base: 'CVX', quote: 'USD' },
  // Industrials
  { symbol: 'BA', base: 'BA', quote: 'USD' },
  { symbol: 'CAT', base: 'CAT', quote: 'USD' },
  { symbol: 'GE', base: 'GE', quote: 'USD' },
  { symbol: 'HON', base: 'HON', quote: 'USD' },
  { symbol: 'UPS', base: 'UPS', quote: 'USD' },
  // Communication / media
  { symbol: 'DIS', base: 'DIS', quote: 'USD' },
  { symbol: 'NFLX', base: 'NFLX', quote: 'USD' },
  { symbol: 'CMCSA', base: 'CMCSA', quote: 'USD' },
  { symbol: 'VZ', base: 'VZ', quote: 'USD' },
  // Gaming — added 2026-08-31 (David asked specifically about GTA/Take-Two)
  { symbol: 'TTWO', base: 'TTWO', quote: 'USD' },
  // Other
  { symbol: 'PYPL', base: 'PYPL', quote: 'USD' },
];

export interface AlpacaStockSourceOptions {
  readonly apiKeyId: string;
  readonly apiSecretKey: string;
  readonly fetchFn?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  /** 'iex' (free, delayed) or 'sip' (paid, real-time). Defaults to the free feed. */
  readonly feed?: 'iex' | 'sip';
  /**
   * Corporate-action adjustment. Defaults to `'all'` (splits + dividends),
   * which is the only correct choice for any series an indicator reads.
   *
   * With `'raw'`, a 20-for-1 split (AMZN and GOOGL in 2022, NVDA 10-for-1 in
   * 2024) appears as a ~95% single-bar collapse: EMAs and ATR are corrupted,
   * a held position stops out on an event where no value was lost, and a
   * backtest spanning the split measures the artefact rather than the market.
   * Only pass `'raw'` when the unadjusted print is specifically what is wanted.
   */
  readonly adjustment?: 'raw' | 'split' | 'dividend' | 'all';
}

export class AlpacaStockSource implements MarketDataSource {
  readonly name = 'Alpaca market data (US equities)';
  private readonly apiKeyId: string;
  private readonly apiSecretKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly feed: 'iex' | 'sip';
  private readonly adjustment: 'raw' | 'split' | 'dividend' | 'all';

  constructor(options: AlpacaStockSourceOptions) {
    if (!options.apiKeyId || !options.apiSecretKey) {
      throw new RangeError('AlpacaStockSource requires apiKeyId and apiSecretKey');
    }
    this.apiKeyId = options.apiKeyId;
    this.apiSecretKey = options.apiSecretKey;
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.feed = options.feed ?? 'iex';
    this.adjustment = options.adjustment ?? 'all';
  }

  async getInstruments(): Promise<Result<Instrument[]>> {
    return ok([...BROWSABLE_STOCK_INSTRUMENTS]);
  }

  async getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Result<Candle[]>> {
    if (limit <= 0) return err(`limit must be positive, got ${limit}`);
    const alpacaTf = TIMEFRAME_ALPACA[timeframe];
    const lookbackMs = LOOKBACK_MS[timeframe];
    if (!alpacaTf || lookbackMs === undefined) return err(`unsupported timeframe for Alpaca: ${timeframe}`);

    const start = new Date(this.now() - lookbackMs).toISOString();
    const cappedLimit = Math.min(10_000, limit);
    const url =
      `${BASE_URL}/stocks/${encodeURIComponent(symbol)}/bars` +
      `?timeframe=${encodeURIComponent(alpacaTf)}&start=${encodeURIComponent(start)}` +
      `&sort=desc&limit=${cappedLimit}&adjustment=${this.adjustment}&feed=${this.feed}`;

    const payload = await this.getJson(url);
    if (!payload.ok) return payload;

    const raw = payload.value as { bars?: unknown; message?: string };
    if (!Array.isArray(raw.bars)) {
      return err(raw.message ? `Alpaca error: ${raw.message}` : 'unexpected Alpaca payload: no bars array');
    }
    const rows = raw.bars
      .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
      .map((b) => [Date.parse(String(b['t'])), b['o'], b['h'], b['l'], b['c'], b['v']]);
    const { candles, rejected } = parseCandleSeries(rows);
    if (candles.length === 0) {
      return err(
        rejected.length > 0
          ? `all ${rejected.length} Alpaca rows invalid (first: ${rejected[0]?.reason})`
          : `no bars returned for ${symbol} (market may be closed with no recent history in this window)`,
      );
    }
    return ok(candles.slice(-limit));
  }

  /**
   * One HTTP GET with a bounded retry on transient failures — same policy as
   * `krakenPublic.ts`: only 429/5xx are retried (with backoff), a real 4xx is
   * not worth wasting the retry budget on.
   */
  private async getJson(url: string): Promise<Result<unknown>> {
    let lastError = `request failed for ${url}`;
    for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await delay(RETRY_BASE_MS * 2 ** (attempt - 1));
      const result = await this.getJsonOnce(url);
      if (result.ok) return result;
      lastError = result.error;
      if (!isTransient(result.error)) return result;
    }
    return err(`${lastError} (after ${RETRY_MAX_ATTEMPTS} retries)`);
  }

  private async getJsonOnce(url: string): Promise<Result<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'APCA-API-KEY-ID': this.apiKeyId,
          'APCA-API-SECRET-KEY': this.apiSecretKey,
        },
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

/** Retries after ~0.5s, 1s, 2s — enough for a rate-limit burst to clear. */
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Rate-limit and server-busy responses are worth retrying; a 404/401 is not. */
function isTransient(error: string): boolean {
  return /HTTP (429|5\d\d) /.test(error);
}
