/**
 * Kraken public data source tests (TDD).
 *
 * Browser-direct, keyless, CORS-open market data so the platform works on
 * a phone with no local proxy. Read-only by construction, like every data
 * source in this platform.
 */

import { describe, expect, it } from 'vitest';
import { KrakenPublicSource } from '../../src/core/data/krakenPublic';

const NOW = 1_700_000_000_000;

/** Kraken OHLC row: [timeSec, open, high, low, close, vwap, volume, count]. */
function krakenRow(timeSec: number, close: number, volume: number) {
  const open = close - 0.5;
  return [
    timeSec,
    String(open),
    String(close + 1), // high
    String(open - 1), // low
    String(close),
    String(close - 0.2), // vwap — must be dropped by the remapping
    String(volume),
    42,
  ];
}

function mockFetch(body: unknown, seenUrls: string[] = []): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    seenUrls.push(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('instruments', () => {
  it('serves a curated majors list without any network call', async () => {
    const source = new KrakenPublicSource({
      fetchFn: (async () => {
        throw new Error('must not be called');
      }) as unknown as typeof fetch,
    });
    const result = await source.getInstruments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(8);
    const bitcoin = result.value.find((i) => i.symbol === 'XBTEUR')!;
    expect(bitcoin.base).toBe('BTC'); // display name, not Kraken's XBT
    expect(bitcoin.quote).toBe('EUR');
  });

  it('is read-only by construction (no order/trade methods)', () => {
    const source = new KrakenPublicSource({ fetchFn: mockFetch({}) });
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(source));
    for (const name of methods) {
      expect(name).not.toMatch(/order|trade|buy|sell|withdraw|transfer/i);
    }
  });
});

describe('getCandles', () => {
  it('requests the right interval and parses rows, remapping vwap out', async () => {
    const urls: string[] = [];
    const source = new KrakenPublicSource({
      now: () => NOW,
      fetchFn: mockFetch(
        {
          error: [],
          result: {
            XXBTZEUR: [krakenRow(1_700_000_000, 105, 7.5), krakenRow(1_699_996_400, 102, 3.25)],
            last: 1_700_000_000,
          },
        },
        urls,
      ),
    });
    const result = await source.getCandles('XBTEUR', '4h', 10);
    expect(urls[0]).toContain('pair=XBTEUR');
    expect(urls[0]).toContain('interval=240'); // 4h in minutes
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Sorted ascending by the shared parser; volume from index 6, not vwap.
    expect(result.value[0]!.close).toBe(102);
    expect(result.value[0]!.volume).toBe(3.25);
    expect(result.value[1]!.volume).toBe(7.5);
    expect(result.value[0]!.timestamp).toBe(1_699_996_400_000); // seconds -> ms
  });

  it('resolves the result key even when it differs from the requested pair', async () => {
    const source = new KrakenPublicSource({
      now: () => NOW,
      fetchFn: mockFetch({
        error: [],
        result: { WEIRDKEY: [krakenRow(1_700_000_000, 50, 1)], last: 1 },
      }),
    });
    const result = await source.getCandles('XBTEUR', '1h', 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]!.close).toBe(50);
  });

  it('keeps only the most recent `limit` candles', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => krakenRow(1_700_000_000 + i * 3600, 100 + i, 1));
    const source = new KrakenPublicSource({
      now: () => NOW,
      fetchFn: mockFetch({ error: [], result: { XXBTZEUR: rows, last: 1 } }),
    });
    const result = await source.getCandles('XBTEUR', '1h', 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(5);
    expect(result.value[4]!.close).toBe(119); // the newest survived
  });

  it('surfaces Kraken error payloads as errors', async () => {
    const source = new KrakenPublicSource({
      now: () => NOW,
      fetchFn: mockFetch({ error: ['EGeneral:Too many requests'], result: {} }),
    });
    const result = await source.getCandles('XBTEUR', '1h', 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Too many requests');
  });

  it('returns errors for HTTP/network failures instead of throwing', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const source = new KrakenPublicSource({ fetchFn: failing, now: () => NOW });
    const result = await source.getCandles('XBTEUR', '1h', 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('offline');
  });

  it('serialises concurrent requests through the rate-limit queue', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const source = new KrakenPublicSource({
      now: () => NOW,
      staggerMs: 1,
      fetchFn: (async (url: RequestInfo | URL) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        order.push(String(url));
        return new Response(
          JSON.stringify({ error: [], result: { K: [krakenRow(1_700_000_000, 1, 1)], last: 1 } }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    await Promise.all([
      source.getCandles('XBTEUR', '1h', 5),
      source.getCandles('ETHEUR', '1h', 5),
      source.getCandles('SOLEUR', '1h', 5),
    ]);
    expect(order).toHaveLength(3);
    expect(maxInFlight).toBe(1); // never parallel — Kraken rate limits respected
  });
});
