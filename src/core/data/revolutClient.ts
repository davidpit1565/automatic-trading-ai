/**
 * Read-only market data client for Revolut X public endpoints.
 *
 * READ-ONLY by construction: this client has no credentials and no order
 * methods. Live execution, if ever added, lives in a separate module behind
 * explicit human confirmation (see roadmap Stage 6).
 *
 * The base URL and paths are configurable because public API shapes change;
 * all responses go through defensive parsing in `candles.ts`.
 */

import type { Candle, Instrument, Result, Timeframe } from '../types';
import { err, ok } from '../types';
import { parseCandleSeries } from './candles';

export interface MarketDataSource {
  readonly name: string;
  getInstruments(): Promise<Result<Instrument[]>>;
  getCandles(symbol: string, timeframe: Timeframe, limit: number): Promise<Result<Candle[]>>;
}

export interface RevolutXClientOptions {
  /** Base URL of the public API. */
  baseUrl?: string;
  /** Injectable fetch for testing. */
  fetchFn?: typeof fetch;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://exchange.revolut.com/api/1.0';
const DEFAULT_TIMEOUT_MS = 15_000;

/** Map our timeframes onto common exchange interval labels. */
const INTERVAL_LABEL: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

export class RevolutXClient implements MarketDataSource {
  readonly name = 'Revolut X (read-only)';
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: RevolutXClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
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

  async getInstruments(): Promise<Result<Instrument[]>> {
    const result = await this.getJson('/symbols');
    if (!result.ok) return result;
    const raw = result.value;
    if (!Array.isArray(raw)) return err('unexpected instruments payload: not an array');
    const instruments: Instrument[] = [];
    for (const row of raw) {
      if (typeof row === 'string') {
        const [base, quote] = row.split(/[-/]/);
        if (base && quote) instruments.push({ symbol: row, base, quote });
      } else if (typeof row === 'object' && row !== null) {
        const obj = row as Record<string, unknown>;
        const symbol = obj['symbol'] ?? obj['id'] ?? obj['pair'];
        const base = obj['base'] ?? obj['baseCurrency'] ?? obj['base_currency'];
        const quote = obj['quote'] ?? obj['quoteCurrency'] ?? obj['quote_currency'];
        if (typeof symbol === 'string' && typeof base === 'string' && typeof quote === 'string') {
          instruments.push({ symbol, base, quote });
        }
      }
    }
    if (instruments.length === 0) return err('no parseable instruments in payload');
    return ok(instruments);
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
  ): Promise<Result<Candle[]>> {
    if (limit <= 0) return err(`limit must be positive, got ${limit}`);
    const interval = INTERVAL_LABEL[timeframe];
    const path = `/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
    const result = await this.getJson(path);
    if (!result.ok) return result;

    const raw = result.value;
    const rows = Array.isArray(raw)
      ? raw
      : typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>)['candles'])
        ? ((raw as Record<string, unknown>)['candles'] as unknown[])
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
