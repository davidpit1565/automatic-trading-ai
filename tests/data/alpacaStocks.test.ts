/**
 * Alpaca stock data source tests (TDD).
 *
 * Server-side only (needs an API key), so it's tested entirely against a
 * mocked `fetch` — no live network, no real credentials, same pattern as
 * every other data source in this project.
 */
import { describe, expect, it } from 'vitest';
import { AlpacaStockSource, CURATED_STOCK_INSTRUMENTS } from '../../src/core/data/alpacaStocks';

const NOW = 1_700_000_000_000;

function alpacaBar(tIso: string, close: number, volume: number) {
  return { t: tIso, o: close - 0.5, h: close + 1, l: close - 1, c: close, v: volume, n: 12, vw: close - 0.1 };
}

function mockFetch(body: unknown, status = 200, seen: { headers?: Headers; url?: string } = {}): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.headers = new Headers(init?.headers);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

function makeSource(fetchFn: typeof fetch): AlpacaStockSource {
  return new AlpacaStockSource({ apiKeyId: 'KEY', apiSecretKey: 'SECRET', fetchFn, now: () => NOW });
}

describe('constructor', () => {
  it('requires both credentials', () => {
    expect(() => new AlpacaStockSource({ apiKeyId: '', apiSecretKey: 'x' })).toThrow();
    expect(() => new AlpacaStockSource({ apiKeyId: 'x', apiSecretKey: '' })).toThrow();
  });
});

describe('getInstruments', () => {
  it('returns the curated USD-quoted majors', async () => {
    const source = makeSource(mockFetch({}));
    const result = await source.getInstruments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(CURATED_STOCK_INSTRUMENTS);
    expect(result.value.every((i) => i.quote === 'USD')).toBe(true);
  });
});

describe('getCandles', () => {
  it('parses bars into candles and sends the API key headers', async () => {
    const seen: { headers?: Headers; url?: string } = {};
    const bars = [
      alpacaBar('2023-11-14T14:00:00Z', 185, 1000),
      alpacaBar('2023-11-14T15:00:00Z', 186, 1200),
    ];
    const source = makeSource(mockFetch({ bars, symbol: 'AAPL' }, 200, seen));
    const result = await source.getCandles('AAPL', '1h', 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.close).toBe(185);
    expect(result.value[1]!.close).toBe(186);
    expect(result.value[0]!.timestamp).toBe(Date.parse('2023-11-14T14:00:00Z'));

    expect(seen.headers?.get('APCA-API-KEY-ID')).toBe('KEY');
    expect(seen.headers?.get('APCA-API-SECRET-KEY')).toBe('SECRET');
    expect(seen.url).toContain('timeframe=1Hour');
    expect(seen.url).toContain('sort=desc');
  });

  it('requests split-and-dividend-adjusted bars by default', async () => {
    // With adjustment=raw a 20-for-1 split (AMZN/GOOGL 2022, NVDA 10-for-1
    // 2024) is a ~95% single-bar collapse: it corrupts every indicator reading
    // across it, stops out a held position on an event where no value was lost,
    // and makes a backtest spanning the split measure the artefact.
    const seen: { headers?: Headers; url?: string } = {};
    const source = makeSource(mockFetch({ bars: [alpacaBar('2023-11-14T14:00:00Z', 185, 1000)] }, 200, seen));
    await source.getCandles('AAPL', '1d', 1);

    expect(seen.url).toContain('adjustment=all');
    expect(seen.url).not.toContain('adjustment=raw');
  });

  it('honours an explicit adjustment when the unadjusted print is wanted', async () => {
    const seen: { headers?: Headers; url?: string } = {};
    const source = new AlpacaStockSource({
      apiKeyId: 'KEY',
      apiSecretKey: 'SECRET',
      fetchFn: mockFetch({ bars: [alpacaBar('2023-11-14T14:00:00Z', 185, 1000)] }, 200, seen),
      now: () => NOW,
      adjustment: 'raw',
    });
    await source.getCandles('AAPL', '1d', 1);

    expect(seen.url).toContain('adjustment=raw');
  });

  it('maps every supported timeframe to its Alpaca string', async () => {
    const cases: [string, string][] = [
      ['1m', '1Min'], ['5m', '5Min'], ['15m', '15Min'], ['30m', '30Min'],
      ['1h', '1Hour'], ['4h', '4Hour'], ['1d', '1Day'], ['1w', '1Week'],
    ];
    for (const [tf, alpacaTf] of cases) {
      const seen: { url?: string } = {};
      const source = makeSource(mockFetch({ bars: [alpacaBar('2023-11-14T14:00:00Z', 100, 1)] }, 200, seen));
      await source.getCandles('AAPL', tf as never, 1);
      expect(seen.url).toContain(`timeframe=${alpacaTf}`);
    }
  });

  it('trims to the requested limit, keeping the most recent candles', async () => {
    const bars = Array.from({ length: 10 }, (_, i) =>
      alpacaBar(new Date(NOW - (10 - i) * 3_600_000).toISOString(), 100 + i, 10),
    );
    const source = makeSource(mockFetch({ bars }));
    const result = await source.getCandles('AAPL', '1h', 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value[result.value.length - 1]!.close).toBe(109); // the most recent bar
  });

  it('rejects a non-positive limit', async () => {
    const source = makeSource(mockFetch({ bars: [] }));
    const result = await source.getCandles('AAPL', '1h', 0);
    expect(result.ok).toBe(false);
  });

  it('surfaces a clear error when the market has no recent bars (e.g. closed with an empty window)', async () => {
    const source = makeSource(mockFetch({ bars: [] }));
    const result = await source.getCandles('AAPL', '1h', 10);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('AAPL');
  });

  it('surfaces the Alpaca error message on a malformed payload', async () => {
    const source = makeSource(mockFetch({ message: 'invalid symbol' }));
    const result = await source.getCandles('BOGUS', '1h', 10);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('invalid symbol');
  });
});

describe('transient failure handling', () => {
  function flakyFetch(statuses: number[], seen: { attempts: number }): typeof fetch {
    return (async () => {
      const status = statuses[seen.attempts];
      seen.attempts++;
      if (status !== undefined) return new Response('busy', { status });
      return new Response(
        JSON.stringify({ bars: [alpacaBar('2023-11-14T14:00:00Z', 100, 1)] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
  }

  it('retries a 503 and succeeds', async () => {
    const seen = { attempts: 0 };
    const source = new AlpacaStockSource({
      apiKeyId: 'K', apiSecretKey: 'S', fetchFn: flakyFetch([503, 503], seen), now: () => NOW,
    });
    const result = await source.getCandles('AAPL', '1h', 1);
    expect(result.ok).toBe(true);
    expect(seen.attempts).toBe(3);
  });

  it('retries a 429 rate limit', async () => {
    const seen = { attempts: 0 };
    const source = new AlpacaStockSource({
      apiKeyId: 'K', apiSecretKey: 'S', fetchFn: flakyFetch([429], seen), now: () => NOW,
    });
    const result = await source.getCandles('AAPL', '1h', 1);
    expect(result.ok).toBe(true);
    expect(seen.attempts).toBe(2);
  });

  it('does NOT retry a 401 (bad credentials) — wastes no budget on a real auth error', async () => {
    const seen = { attempts: 0 };
    const source = new AlpacaStockSource({
      apiKeyId: 'K', apiSecretKey: 'S', fetchFn: flakyFetch([401, 401, 401], seen), now: () => NOW,
    });
    const result = await source.getCandles('AAPL', '1h', 1);
    expect(result.ok).toBe(false);
    expect(seen.attempts).toBe(1);
  });

  it('gives up after a bounded number of retries rather than looping forever', async () => {
    const seen = { attempts: 0 };
    const source = new AlpacaStockSource({
      apiKeyId: 'K', apiSecretKey: 'S', fetchFn: flakyFetch([503, 503, 503, 503, 503, 503], seen), now: () => NOW,
    });
    const result = await source.getCandles('AAPL', '1h', 1);
    expect(result.ok).toBe(false);
    expect(seen.attempts).toBe(4);
    if (result.ok) return;
    expect(result.error).toContain('retries');
  });
});
