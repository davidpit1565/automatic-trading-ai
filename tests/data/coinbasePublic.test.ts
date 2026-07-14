/**
 * Coinbase public data source tests (TDD).
 *
 * Second browser-direct fallback (after Kraken) so the phone platform
 * works even where one provider is regionally blocked. Coinbase rows are
 * [timeSec, LOW, HIGH, OPEN, CLOSE, volume] (note the order!) and arrive
 * newest-first; 30m/4h/1w are synthesised by aggregating native candles.
 */

import { describe, expect, it } from 'vitest';
import { CoinbasePublicSource } from '../../src/core/data/coinbasePublic';

const HOUR_SEC = 3600;
const T0 = 1_700_000_000 - (1_700_000_000 % (4 * HOUR_SEC)); // 4h-aligned

/** Coinbase row: [time, low, high, open, close, volume]. */
function row(timeSec: number, open: number, close: number, volume = 1) {
  const low = Math.min(open, close) - 1;
  const high = Math.max(open, close) + 1;
  return [timeSec, low, high, open, close, volume];
}

function mockFetch(body: unknown, seenUrls: string[] = []): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    seenUrls.push(String(url));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe('instruments', () => {
  it('serves curated EUR majors without any network call', async () => {
    const source = new CoinbasePublicSource({
      fetchFn: (async () => {
        throw new Error('must not be called');
      }) as unknown as typeof fetch,
    });
    const result = await source.getInstruments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bitcoin = result.value.find((i) => i.symbol === 'BTC-EUR')!;
    expect(bitcoin.base).toBe('BTC');
    expect(bitcoin.quote).toBe('EUR');
  });
});

describe('native timeframes', () => {
  it('requests the native granularity and parses the l/h/o/c order, oldest first', async () => {
    const urls: string[] = [];
    const source = new CoinbasePublicSource({
      fetchFn: mockFetch(
        [row(T0 + HOUR_SEC, 102, 103, 5), row(T0, 100, 102, 3)], // newest first
        urls,
      ),
    });
    const result = await source.getCandles('BTC-EUR', '1h', 10);
    expect(urls[0]).toContain('granularity=3600');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.timestamp).toBe(T0 * 1000); // sorted ascending, sec->ms
    expect(result.value[0]!.open).toBe(100);
    expect(result.value[0]!.close).toBe(102);
    expect(result.value[0]!.low).toBe(99); // low, not open — order remapped
    expect(result.value[1]!.volume).toBe(5);
  });

  it('keeps only the most recent `limit` candles', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(T0 + i * HOUR_SEC, 100 + i, 101 + i));
    const source = new CoinbasePublicSource({ fetchFn: mockFetch(rows.reverse()) });
    const result = await source.getCandles('BTC-EUR', '1h', 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(5);
      expect(result.value[4]!.close).toBe(120);
    }
  });
});

describe('aggregated timeframes', () => {
  it('synthesises 4h candles from four 1h candles with correct OHLCV', async () => {
    // Two complete 4h groups: hours 0..3 and 4..7.
    const hourly = [
      row(T0 + 0 * HOUR_SEC, 100, 101, 1),
      row(T0 + 1 * HOUR_SEC, 101, 99, 2),
      row(T0 + 2 * HOUR_SEC, 99, 104, 3),
      row(T0 + 3 * HOUR_SEC, 104, 103, 4),
      row(T0 + 4 * HOUR_SEC, 103, 105, 5),
      row(T0 + 5 * HOUR_SEC, 105, 106, 6),
      row(T0 + 6 * HOUR_SEC, 106, 104, 7),
      row(T0 + 7 * HOUR_SEC, 104, 108, 8),
    ];
    const urls: string[] = [];
    const source = new CoinbasePublicSource({ fetchFn: mockFetch(hourly.reverse(), urls) });
    const result = await source.getCandles('BTC-EUR', '4h', 10);
    expect(urls[0]).toContain('granularity=3600'); // fetched native 1h
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    const first = result.value[0]!;
    expect(first.timestamp).toBe(T0 * 1000);
    expect(first.open).toBe(100); // first hour's open
    expect(first.close).toBe(103); // last hour's close
    expect(first.high).toBe(105); // max high (104+1)
    expect(first.low).toBe(98); // min low (99-1)
    expect(first.volume).toBe(10); // 1+2+3+4
  });

  it('drops a partial group at the start but keeps the forming one at the end', async () => {
    // Starts mid-group (hours 2..3 of the first 4h block) then a full block.
    const hourly = [
      row(T0 + 2 * HOUR_SEC, 99, 104, 3),
      row(T0 + 3 * HOUR_SEC, 104, 103, 4),
      row(T0 + 4 * HOUR_SEC, 103, 105, 5),
      row(T0 + 5 * HOUR_SEC, 105, 106, 6),
    ];
    const source = new CoinbasePublicSource({ fetchFn: mockFetch(hourly.reverse()) });
    const result = await source.getCandles('BTC-EUR', '4h', 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // First (incomplete-at-start) group dropped; forming group kept.
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.timestamp).toBe((T0 + 4 * HOUR_SEC) * 1000);
    expect(result.value[0]!.close).toBe(106);
  });
});

describe('failures', () => {
  it('surfaces HTTP and network errors as Results', async () => {
    const http = new CoinbasePublicSource({
      fetchFn: (async () => new Response('{}', { status: 451 })) as typeof fetch,
    });
    const blocked = await http.getCandles('BTC-EUR', '1h', 5);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain('451');

    const network = new CoinbasePublicSource({
      fetchFn: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    const failed = await network.getCandles('BTC-EUR', '1h', 5);
    expect(failed.ok).toBe(false);
  });

  it('rejects unexpected payload shapes', async () => {
    const source = new CoinbasePublicSource({ fetchFn: mockFetch({ message: 'NotFound' }) });
    const result = await source.getCandles('NOPE-EUR', '1h', 5);
    expect(result.ok).toBe(false);
  });
});
