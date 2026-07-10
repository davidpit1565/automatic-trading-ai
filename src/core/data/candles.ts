/**
 * Candle parsing and validation.
 *
 * Exchange payloads vary: some return arrays
 * `[timestamp, open, high, low, close, volume]`, others return objects with
 * differently-cased keys. Everything is normalised into the canonical
 * `Candle` shape here, and invalid rows are rejected with a reason —
 * downstream layers can assume candles are clean.
 */

import type { Candle } from '../types';
import { err, ok, type Result } from '../types';

/** Seconds vs milliseconds heuristic: epoch seconds are < ~year 5138 in ms. */
const EPOCH_MS_THRESHOLD = 100_000_000_000;

function toEpochMs(raw: number): number {
  return raw < EPOCH_MS_THRESHOLD ? raw * 1000 : raw;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (isFiniteNumber(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

/** Parse one raw candle row (array or object form) into a canonical Candle. */
export function parseCandle(raw: unknown): Result<Candle> {
  if (Array.isArray(raw)) {
    if (raw.length < 6) return err(`candle array too short: length ${raw.length}`);
    const nums = raw.slice(0, 6).map((v) => (typeof v === 'string' ? Number(v) : v));
    if (!nums.every(isFiniteNumber)) return err('candle array contains non-numeric values');
    const [ts, open, high, low, close, volume] = nums as [
      number, number, number, number, number, number,
    ];
    return validateCandle({ timestamp: toEpochMs(ts), open, high, low, close, volume });
  }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    // 'start' is Revolut X's candle open-time key.
    const ts = pickNumber(obj, ['timestamp', 'time', 't', 'start', 'openTime', 'start_time', 'startTime']);
    const open = pickNumber(obj, ['open', 'o']);
    const high = pickNumber(obj, ['high', 'h']);
    const low = pickNumber(obj, ['low', 'l']);
    const close = pickNumber(obj, ['close', 'c']);
    const volume = pickNumber(obj, ['volume', 'v', 'vol']);
    if (ts === undefined) return err('candle object missing timestamp');
    if (open === undefined || high === undefined || low === undefined || close === undefined) {
      return err('candle object missing OHLC field(s)');
    }
    return validateCandle({
      timestamp: toEpochMs(ts),
      open,
      high,
      low,
      close,
      volume: volume ?? 0,
    });
  }

  return err(`unsupported candle payload type: ${typeof raw}`);
}

/** Enforce OHLC invariants: high >= max(open, close), low <= min(open, close), all >= 0. */
export function validateCandle(c: Candle): Result<Candle> {
  if (c.timestamp <= 0) return err(`invalid timestamp: ${c.timestamp}`);
  if (c.open < 0 || c.high < 0 || c.low < 0 || c.close < 0) return err('negative price');
  if (c.volume < 0) return err('negative volume');
  if (c.high < Math.max(c.open, c.close)) return err('high below open/close');
  if (c.low > Math.min(c.open, c.close)) return err('low above open/close');
  if (c.low > c.high) return err('low above high');
  return ok(c);
}

/**
 * Parse a raw candle series: normalises every row, drops invalid rows
 * (collected in `rejected`), de-duplicates by timestamp and sorts ascending.
 */
export interface ParsedSeries {
  readonly candles: Candle[];
  readonly rejected: { readonly index: number; readonly reason: string }[];
}

export function parseCandleSeries(rows: unknown[]): ParsedSeries {
  const byTimestamp = new Map<number, Candle>();
  const rejected: { index: number; reason: string }[] = [];
  rows.forEach((row, index) => {
    const result = parseCandle(row);
    if (result.ok) {
      byTimestamp.set(result.value.timestamp, result.value);
    } else {
      rejected.push({ index, reason: result.error });
    }
  });
  const candles = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  return { candles, rejected };
}
