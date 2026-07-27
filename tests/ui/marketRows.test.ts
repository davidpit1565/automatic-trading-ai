/**
 * Full markets list assembly (TDD).
 *
 * The list is built from ONE batch-ticker request covering every market —
 * that is what makes several hundred rows possible against a rate-limited
 * public API. These cover the mapping, the ordering, and the fallback for
 * sources that have no batch ticker.
 */

import { describe, expect, it } from 'vitest';
import { fetchMarketRows } from '../../src/ui/markets';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { Candle, Instrument, Result, Ticker } from '../../src/core/types';
import { ok } from '../../src/core/types';

const AT = 1_700_000_000_000;

const INSTRUMENTS: Instrument[] = [
  { symbol: 'XBTEUR', base: 'BTC', quote: 'EUR' },
  { symbol: 'ETHEUR', base: 'ETH', quote: 'EUR' },
  { symbol: 'PEPEEUR', base: 'PEPE', quote: 'EUR' },
  { symbol: 'WIFEUR', base: 'WIF', quote: 'EUR' },
];

function makeData(source: Partial<MarketDataSource>): ActiveDataSource {
  return {
    source: {
      name: 'test',
      getInstruments: async () => ok(INSTRUMENTS),
      getCandles: async () => ok([] as Candle[]),
      ...source,
    } as MarketDataSource,
    instruments: INSTRUMENTS,
    isLive: true,
    kind: 'kraken' as ActiveDataSource['kind'],
    diagnostics: [],
  };
}

const ticker = (symbol: string, price: number, open: number, quoteVolume: number): Ticker => ({
  symbol, price, open, high: price, low: price, volume: quoteVolume / (price || 1), quoteVolume,
});

describe('fetchMarketRows', () => {
  it('derives price, absolute change and percent from one batch request', async () => {
    const data = makeData({
      getTickers: async (): Promise<Result<Ticker[]>> =>
        ok([ticker('XBTEUR', 110, 100, 1_000)]),
    });
    const rows = await fetchMarketRows(data, 60, () => AT);
    expect(rows).toHaveLength(1);
    const btc = rows[0]!;
    expect(btc.price).toBe(110);
    expect(btc.change).toBe(10); // absolute, not just percent
    expect(btc.changePct).toBeCloseTo(10, 10);
    expect(btc.label).toBe('Bitcoin');
    expect(btc.base).toBe('BTC');
    expect(btc.updatedAt).toBe(AT);
  });

  it('puts the curated majors first in fixed order, then the rest by liquidity', async () => {
    const data = makeData({
      getTickers: async (): Promise<Result<Ticker[]>> =>
        ok([
          ticker('WIFEUR', 2, 2, 50), // thin long-tail
          ticker('PEPEEUR', 1, 1, 900), // liquid long-tail
          ticker('ETHEUR', 3000, 3000, 10), // major, thin today
          ticker('XBTEUR', 60000, 60000, 20), // major
        ]),
    });
    const rows = await fetchMarketRows(data, 60, () => AT);
    // BTC then ETH (fixed major order) regardless of their volume, then the
    // long tail sorted by quote volume descending.
    expect(rows.map((r) => r.base)).toEqual(['BTC', 'ETH', 'PEPE', 'WIF']);
  });

  it('reports a flat market as zero change rather than dividing by zero', async () => {
    const data = makeData({
      getTickers: async (): Promise<Result<Ticker[]>> => ok([ticker('XBTEUR', 5, 0, 1)]),
    });
    const rows = await fetchMarketRows(data, 60, () => AT);
    expect(rows[0]!.changePct).toBe(0);
    expect(Number.isFinite(rows[0]!.changePct)).toBe(true);
  });

  it('falls back to the per-symbol sweep when the source has no batch ticker', async () => {
    let candleCalls = 0;
    const data = makeData({
      getCandles: async () => {
        candleCalls++;
        return ok([
          { timestamp: AT - 3600_000, open: 100, high: 100, low: 100, close: 100, volume: 1 },
          { timestamp: AT, open: 100, high: 110, low: 100, close: 110, volume: 1 },
        ] as Candle[]);
      },
    });
    const rows = await fetchMarketRows(data, 60, () => AT);
    expect(candleCalls).toBeGreaterThan(0); // proves the fallback path ran
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.price).toBe(110);
    expect(rows[0]!.change).toBe(10);
  });

  it('falls back rather than showing an empty screen when the batch request fails', async () => {
    let candleCalls = 0;
    const data = makeData({
      getTickers: async (): Promise<Result<Ticker[]>> => ({ ok: false, error: 'rate limited' }),
      getCandles: async () => {
        candleCalls++;
        return ok([
          { timestamp: AT - 3600_000, open: 100, high: 100, low: 100, close: 100, volume: 1 },
          { timestamp: AT, open: 100, high: 110, low: 100, close: 110, volume: 1 },
        ] as Candle[]);
      },
    });
    const rows = await fetchMarketRows(data, 60, () => AT);
    expect(candleCalls).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
  });
});
