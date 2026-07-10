import { describe, expect, it } from 'vitest';
import { PROXY_BASE_URL, RevolutXClient } from '../../src/core/data/revolutClient';

const NOW = 1_700_000_000_000;

function mockFetch(status: number, body: unknown, seenUrls: string[] = []): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    seenUrls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('RevolutXClient', () => {
  it('is read-only by construction (no order/trade methods)', () => {
    const client = new RevolutXClient({ fetchFn: mockFetch(200, {}) });
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
    for (const name of methodNames) {
      expect(name).not.toMatch(/order|trade|buy|sell|withdraw|transfer/i);
    }
  });

  it('defaults to the local signing proxy base URL', async () => {
    const urls: string[] = [];
    const client = new RevolutXClient({ fetchFn: mockFetch(200, { data: [] }, urls), now: () => NOW });
    await client.getCandles('BTC-USD', '1h', 5);
    expect(urls[0]).toMatch(new RegExp(`^${PROXY_BASE_URL}/candles/BTC-USD`));
  });

  it('requests candles with interval in minutes and a since/until window', async () => {
    const urls: string[] = [];
    const client = new RevolutXClient({
      fetchFn: mockFetch(200, { data: [] }, urls),
      now: () => NOW,
    });
    await client.getCandles('BTC-USD', '4h', 10);
    const url = new URL(urls[0]!, 'http://localhost');
    expect(url.pathname).toBe('/api/revx/candles/BTC-USD');
    expect(url.searchParams.get('interval')).toBe('240'); // 4h in minutes
    expect(url.searchParams.get('until')).toBe(String(NOW));
    expect(url.searchParams.get('since')).toBe(String(NOW - 10 * 4 * 3_600_000));
  });

  it('parses the documented candle shape: { data: [{ start, o/h/l/c as strings }] }', async () => {
    const client = new RevolutXClient({
      now: () => NOW,
      fetchFn: mockFetch(200, {
        data: [
          { start: 1700000060000, open: '101', high: '103', low: '100', close: '102', volume: '2.5' },
          { start: 1700000000000, open: '100', high: '102', low: '99', close: '101', volume: '1.5' },
        ],
      }),
    });
    const result = await client.getCandles('BTC-USD', '1m', 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.timestamp)).toEqual([1700000000000, 1700000060000]);
    expect(result.value[0]).toMatchObject({ open: 100, high: 102, low: 99, close: 101, volume: 1.5 });
  });

  it('parses instrument pairs from the configuration map', async () => {
    const client = new RevolutXClient({
      fetchFn: mockFetch(200, {
        'BTC-USD': { minOrderSize: '0.0001' },
        'ETH-USD': { minOrderSize: '0.001' },
      }),
    });
    const result = await client.getInstruments();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { symbol: 'BTC-USD', base: 'BTC', quote: 'USD' },
      { symbol: 'ETH-USD', base: 'ETH', quote: 'USD' },
    ]);
  });

  it('parses pairs wrapped in a data envelope too', async () => {
    const client = new RevolutXClient({
      fetchFn: mockFetch(200, { data: { 'SOL-USD': {} } }),
    });
    const result = await client.getInstruments();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.base).toBe('SOL');
  });

  it('returns errors for HTTP failures instead of throwing (e.g. 401 unauthenticated)', async () => {
    const client = new RevolutXClient({ fetchFn: mockFetch(401, {}), now: () => NOW });
    const result = await client.getCandles('BTC-USD', '1h', 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('401');
  });

  it('returns errors for network failures instead of throwing', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = new RevolutXClient({ fetchFn: failing, now: () => NOW });
    const result = await client.getCandles('BTC-USD', '1h', 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('network down');
  });

  it('rejects non-positive limits without making a request', async () => {
    const urls: string[] = [];
    const client = new RevolutXClient({ fetchFn: mockFetch(200, {}, urls), now: () => NOW });
    const result = await client.getCandles('BTC-USD', '1h', 0);
    expect(result.ok).toBe(false);
    expect(urls).toHaveLength(0);
  });

  it('returns an error when every candle row is invalid or the payload is malformed', async () => {
    const badRows = new RevolutXClient({
      fetchFn: mockFetch(200, { data: [{ nonsense: true }] }),
      now: () => NOW,
    });
    expect((await badRows.getCandles('BTC-USD', '1h', 5)).ok).toBe(false);

    const badShape = new RevolutXClient({ fetchFn: mockFetch(200, 42), now: () => NOW });
    expect((await badShape.getCandles('BTC-USD', '1h', 5)).ok).toBe(false);
  });
});
