/**
 * Read-only market data client for the Revolut X crypto exchange REST API.
 *
 * API reference: https://developer.revolut.com/docs/x-api
 *   Base URL:  https://revx.revolut.com/api/1.0
 *   Candles:   GET /candles/{symbol}?interval=<minutes>&since=<ms>&until=<ms>
 *   Pairs:     GET /configuration/pairs
 *
 * Candles and configuration require an authenticated API key (Ed25519
 * request signing). The browser therefore talks to the local read-only
 * proxy (server/revxProxy.mjs) which holds the credentials and signs
 * requests — API keys never reach browser code. The proxy mirrors the
 * upstream paths, so this client works against either base URL.
 *
 * READ-ONLY by construction: no credentials here, no order methods. Live
 * execution, if ever added, is Stage 6 and requires explicit human
 * confirmation.
 */

import type { Candle, Instrument, Result, Timeframe } from '../types';
import { err, ok, TIMEFRAME_MS } from '../types';
import { parseCandleSeries } from './candles';

export interface MarketDataSource {
  readonly name: string;
  getInstruments(): Promise<Result<Instrument[]>>;
  getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Result<Candle[]>>;
}

export interface RevolutXClientOptions {
  /** Base URL: the local proxy by default; the real API for server-side use. */
  baseUrl?: string;
  /** Injectable fetch for testing. */
  fetchFn?: typeof fetch;
  /** Injectable clock (epoch ms) so candle windows are testable. */
  now?: () => number;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

/** The dashboard reaches Revolut X through the local signing proxy. */
export const PROXY_BASE_URL = '/api/revx';
const DEFAULT_TIMEOUT_MS = 15_000;

/** Revolut X expresses candle intervals in whole minutes. */
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

export class RevolutXClient implements MarketDataSource {
  readonly name = 'Revolut X (read-only)';
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(options: RevolutXClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? PROXY_BASE_URL).replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async getJson(path: string): Promise<Result<unknown>> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        return err(`HTTP ${response.status} from ${url}`);
      }
      return ok((await response.json()) as unknown);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return err(`request failed for ${url}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Trading pairs from GET /configuration/pairs.
   * Response maps symbols to pair configuration:
   *   { "BTC-USD": { ... }, "ETH-USD": { ... } }
   */
  async getInstruments(): Promise<Result<Instrument[]>> {
    const result = await this.getJson('/configuration/pairs');
    if (!result.ok) return result;
    const raw = result.value;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return err('unexpected pairs payload: expected an object keyed by symbol');
    }
    // Some responses wrap content in { data: {...} }.
    const body = 'data' in raw ? (raw as { data: unknown }).data : raw;
    if (typeof body !== 'object' || body === null) {
      return err('unexpected pairs payload: no pair map found');
    }
    const instruments: Instrument[] = [];
    for (const symbol of Object.keys(body as Record<string, unknown>)) {
      const [base, quote] = symbol.split('-');
      if (base && quote) instruments.push({ symbol, base, quote });
    }
    if (instruments.length === 0) return err('no parseable trading pairs in payload');
    return ok(instruments);
  }

  /**
   * Historical OHLCV candles from GET /candles/{symbol}.
   * Response: { data: [{ start, open, high, low, close, volume }, ...] }
   * with prices as decimal strings and `start` in epoch milliseconds.
   */
  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
  ): Promise<Result<Candle[]>> {
    if (limit <= 0) return err(`limit must be positive, got ${limit}`);
    const interval = INTERVAL_MINUTES[timeframe];
    const until = this.now();
    const since = until - limit * TIMEFRAME_MS[timeframe];
    const path =
      `/candles/${encodeURIComponent(symbol)}` +
      `?interval=${interval}&since=${since}&until=${until}`;
    const result = await this.getJson(path);
    if (!result.ok) return result;

    const raw = result.value;
    const rows =
      typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>)['data'])
        ? ((raw as Record<string, unknown>)['data'] as unknown[])
        : Array.isArray(raw)
          ? raw
          : undefined;
    if (rows === undefined) return err('unexpected candles payload shape');

    const { candles, rejected } = parseCandleSeries(rows);
    if (candles.length === 0) {
      return err(
        rejected.length > 0
          ? `all ${rejected.length} candle rows invalid (first: ${rejected[0]?.reason})`
          : 'empty candle series',
      );
    }
    return ok(candles);
  }
}
