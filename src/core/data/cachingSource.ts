/**
 * Per-cycle memoising wrapper around a `MarketDataSource`.
 *
 * Running N shadow strategies over the same cycle would otherwise multiply the
 * request count by N against a rate-limited public API — the same
 * queue-starvation that once made the app's charts take eight seconds. With
 * this, N strategies cost exactly the requests of one: the first call for a
 * (symbol, timeframe, limit) fetches, the rest are served from memory.
 *
 * The cache is explicitly scoped to a cycle and cleared by `newCycle()`. It is
 * never time-based: silently serving stale prices to a strategy that is about
 * to make a decision is precisely the bug this must not introduce.
 *
 * Failures are NOT cached — a transient error must not poison every subsequent
 * strategy in the same cycle.
 */

import type { Candle, Instrument, Result, Ticker, Timeframe } from '../types';
import type { MarketDataSource } from './revolutClient';

export class CachingSource implements MarketDataSource {
  readonly name: string;
  private candles = new Map<string, Result<Candle[]>>();
  private instruments: Result<Instrument[]> | null = null;
  private inFlight = new Map<string, Promise<Result<Candle[]>>>();

  constructor(private readonly inner: MarketDataSource) {
    this.name = inner.name;
  }

  /** Drop everything cached for the previous cycle. Call once per cycle. */
  newCycle(): void {
    this.candles.clear();
    this.inFlight.clear();
  }

  async getInstruments(): Promise<Result<Instrument[]>> {
    // The instrument list is stable for the life of a process, so unlike
    // candles it survives across cycles — but a failure is still not cached.
    if (this.instruments?.ok) return this.instruments;
    const result = await this.inner.getInstruments();
    if (result.ok) this.instruments = result;
    return result;
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    opts?: { readonly priority?: boolean },
  ): Promise<Result<Candle[]>> {
    const key = `${symbol}|${timeframe}|${limit}`;
    const cached = this.candles.get(key);
    if (cached) return cached;

    // Concurrent callers for the same key share one request rather than racing
    // and each issuing their own.
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.inner.getCandles(symbol, timeframe, limit, opts).then((result) => {
      if (result.ok) this.candles.set(key, result);
      this.inFlight.delete(key);
      return result;
    });
    this.inFlight.set(key, request);
    return request;
  }

  async getTickers(): Promise<Result<Ticker[]>> {
    if (!this.inner.getTickers) return { ok: false, error: 'source has no batch ticker' };
    return this.inner.getTickers();
  }
}
