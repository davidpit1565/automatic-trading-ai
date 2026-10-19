import { describe, expect, it } from 'vitest';
import { ClosedBarSource } from '../../src/core/data/closedBarSource';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { Candle } from '../../src/core/types';
import { err, ok } from '../../src/core/types';

const HOUR = 3_600_000;
function candle(ts: number): Candle {
  return { timestamp: ts, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}
function sourceOf(candles: Candle[] | null): MarketDataSource {
  return {
    name: 'inner',
    async getInstruments() {
      return ok([]);
    },
    async getCandles() {
      return candles ? ok(candles) : err('boom');
    },
  };
}

describe('ClosedBarSource', () => {
  it('drops the still-forming last candle and keeps closed ones', async () => {
    const now = 10 * HOUR + 20 * 60_000; // 20 minutes into the 10:00 bar
    const src = new ClosedBarSource(sourceOf([candle(8 * HOUR), candle(9 * HOUR), candle(10 * HOUR)]), () => now);
    const r = await src.getCandles('X', '1h', 3);
    expect(r.ok && r.value.map((c) => c.timestamp)).toEqual([8 * HOUR, 9 * HOUR]);
  });

  it('keeps every candle when the last bar has already closed', async () => {
    const now = 11 * HOUR; // the 10:00 bar finished exactly now
    const src = new ClosedBarSource(sourceOf([candle(9 * HOUR), candle(10 * HOUR)]), () => now);
    const r = await src.getCandles('X', '1h', 2);
    expect(r.ok && r.value).toHaveLength(2);
  });

  it('passes errors and empty series through unchanged', async () => {
    expect((await new ClosedBarSource(sourceOf(null), () => 0).getCandles('X', '1h', 2)).ok).toBe(false);
    const empty = await new ClosedBarSource(sourceOf([]), () => 0).getCandles('X', '1h', 2);
    expect(empty.ok && empty.value).toEqual([]);
  });

  it('respects the timeframe (a 4h bar is forming for 4 hours)', async () => {
    const start = 8 * HOUR;
    const src = new ClosedBarSource(sourceOf([candle(4 * HOUR), candle(start)]), () => start + 3 * HOUR);
    const r = await src.getCandles('X', '4h', 2);
    expect(r.ok && r.value).toHaveLength(1);
  });
});
