import { describe, expect, it } from 'vitest';
import { RevolutXClient } from '../../src/core/data/revolutClient';

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
}

describe('RevolutXClient', () => {
  it('is read-only by construction (no order/trade methods)', () => {
    const client = new RevolutXClient({ fetchFn: mockFetch(200, []) });
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
    for (const name of methodNames) {
      expect(name).not.toMatch(/order|trade|buy|sell|withdraw|transfer/i);
    }
  });

  it('parses candle arrays and sorts them', async () => {
    const client = new RevolutXClient({
      fetchFn: mockFetch(200, [
        [1700000060, 101, 103, 100, 102, 20],
        [1700000000, 100, 102, 99, 101, 10],
      ]),
    });
    const result = await client.getCandles('BTC/USD', '1m', 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((c) => c.timestamp)).toEqual([1700000000000, 1700000060000]);
    }
  });

  it('parses { candles: [...] } wrapper payloads', async () => {
    const client = new RevolutXClient({
      fetchFn: mockFetch(200, { candles: [[1700000000, 1, 2, 0.5, 1.5, 3]] }),
    });
    const result = await client.getCandles('ETH/USD', '1h', 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('returns an error for HTTP failures instead of throwing', async () => {
    const client = new RevolutXClient({ fetchFn: mockFetch(503, {}) });
    const result = await client.getCandles('BTC/USD', '1h', 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('503');
  });

  it('returns an error for network failures instead of throwing', async () => {
    const failing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = new RevolutXClient({ fetchFn: failing });
    const result = await client.getCandles('BTC/USD', '1h', 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('network down');
  });

  it('rejects non-positive limits without making a request', async () => {
    const client = new RevolutXClient({
      fetchFn: (async () => {
        throw new Error('should not be called');
      }) as unknown as typeof fetch,
    });
    const result = await client.getCandles('BTC/USD', '1h', 0);
    expect(result.ok).toBe(false);
  });

  it('returns an error when every candle row is invalid', async () => {
    const client = new RevolutXClient({ fetchFn: mockFetch(200, [['bad'], ['rows']]) });
    const result = await client.getCandles('BTC/USD', '1h', 5);
    expect(result.ok).toBe(false);
  });

  it('parses instrument lists in object form', async () => {
    const client = new RevolutXClient({
      fetchFn: mockFetch(200, [
        { symbol: 'BTC/USD', base: 'BTC', quote: 'USD' },
        { symbol: 'ETH/USD', baseCurrency: 'ETH', quoteCurrency: 'USD' },
      ]),
    });
    const result = await client.getInstruments();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { symbol: 'BTC/USD', base: 'BTC', quote: 'USD' },
        { symbol: 'ETH/USD', base: 'ETH', quote: 'USD' },
      ]);
    }
  });

  it('parses instrument lists given as plain strings', async () => {
    const client = new RevolutXClient({ fetchFn: mockFetch(200, ['BTC-USD', 'SOL/USD']) });
    const result = await client.getInstruments();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((i) => i.base)).toEqual(['BTC', 'SOL']);
    }
  });
});
