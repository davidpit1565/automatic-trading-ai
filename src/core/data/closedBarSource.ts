/**
 * Wraps a `MarketDataSource` so every candle series ends at the last CLOSED
 * bar: the still-forming candle (Kraken's last OHLC row) is dropped.
 *
 * Why: live scans include the forming candle while every backtest uses closed
 * bars only, so a live entry can be a signal that "repaints" (9 of 17
 * reconstructable entries would not have passed at bar close, 2026-10-19). The
 * 'closed-bars' shadow candidate runs the production rules on this wrapper so
 * the effect is measured forward instead of guessed — see `shadowEvaluator.ts`.
 */

import type { Candle, Instrument, Result, Timeframe } from '../types';
import { ok, TIMEFRAME_MS } from '../types';
import type { MarketDataSource } from './revolutClient';

export class ClosedBarSource implements MarketDataSource {
  readonly name: string;

  constructor(
    private readonly inner: MarketDataSource,
    private readonly now: () => number,
  ) {
    this.name = `${inner.name} (closed bars)`;
  }

  getInstruments(): Promise<Result<Instrument[]>> {
    return this.inner.getInstruments();
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    opts?: { readonly priority?: boolean },
  ): Promise<Result<Candle[]>> {
    const result = await this.inner.getCandles(symbol, timeframe, limit, opts);
    if (!result.ok || result.value.length === 0) return result;
    const last = result.value[result.value.length - 1]!;
    // Forming = its bar has not finished yet.
    const forming = last.timestamp + TIMEFRAME_MS[timeframe] > this.now();
    return forming ? ok(result.value.slice(0, -1)) : result;
  }
}
