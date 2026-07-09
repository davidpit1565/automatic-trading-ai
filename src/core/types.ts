/**
 * Core domain types shared across all layers.
 *
 * Layering rule (strict, top depends only on lower):
 *   Data Layer -> Indicator Engine -> Strategy Engine -> Risk Engine
 *   -> Backtesting -> Monitoring -> UI
 */

/** A single OHLCV candle. Timestamp is Unix epoch milliseconds (candle open time). */
export interface Candle {
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

/** Supported chart timeframes. */
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

/** A tradable instrument, e.g. BTC/USD. */
export interface Instrument {
  readonly symbol: string;
  readonly base: string;
  readonly quote: string;
}

/** Result type used across layers so errors are values, never silent. */
export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
