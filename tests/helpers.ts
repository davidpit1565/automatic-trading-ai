import type { Candle } from '../src/core/types';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

/** Build candles from close prices with a fixed spread, for indicator tests. */
export function candlesFromCloses(closes: readonly number[], spread = 1): Candle[] {
  return closes.map((close, i) => ({
    timestamp: T0 + i * HOUR,
    open: i === 0 ? close : closes[i - 1]!,
    high: Math.max(close, i === 0 ? close : closes[i - 1]!) + spread,
    low: Math.min(close, i === 0 ? close : closes[i - 1]!) - spread,
    close,
    volume: 1000,
  }));
}

/** Build candles from explicit [high, low, close] tuples. */
export function candlesFromHlc(rows: readonly [number, number, number][]): Candle[] {
  return rows.map(([high, low, close], i) => ({
    timestamp: T0 + i * HOUR,
    open: Math.min(Math.max((high + low) / 2, low), high),
    high,
    low,
    close,
    volume: 1000,
  }));
}

/** Build candles from [close, volume] pairs. */
export function candlesWithVolume(rows: readonly [number, number][]): Candle[] {
  return rows.map(([close, volume], i) => ({
    timestamp: T0 + i * HOUR,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume,
  }));
}
