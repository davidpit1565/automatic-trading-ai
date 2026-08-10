/**
 * CoinGecko per-coin stats lookup (TDD). Best-effort: unmapped symbols and
 * any fetch failure return null rather than a wrong or fabricated number.
 */

import { describe, expect, it } from 'vitest';
import { fetchCoinStats } from '../../src/ui/coinStats';

function mockFetch(body: unknown, ok = true): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 500 })) as unknown as typeof fetch;
}

describe('fetchCoinStats', () => {
  it('parses market cap, rank and supply for a mapped symbol', async () => {
    const fetchFn = mockFetch([
      { market_cap: 1_300_000_000_000, market_cap_rank: 1, max_supply: 21_000_000, circulating_supply: 19_700_000 },
    ]);
    const stats = await fetchCoinStats('BTC', fetchFn);
    expect(stats).toEqual({
      marketCap: 1_300_000_000_000,
      marketCapRank: 1,
      maxSupply: 21_000_000,
      circulatingSupply: 19_700_000,
    });
  });

  it('returns null for a symbol with no CoinGecko mapping, without fetching', async () => {
    let called = false;
    const fetchFn = (async () => {
      called = true;
      return new Response('[]');
    }) as unknown as typeof fetch;
    const stats = await fetchCoinStats('SOMEUNKNOWNCOIN', fetchFn);
    expect(stats).toBeNull();
    expect(called).toBe(false);
  });

  it('returns null on an HTTP failure rather than throwing', async () => {
    const stats = await fetchCoinStats('BTC', mockFetch({}, false));
    expect(stats).toBeNull();
  });

  it('returns null when the response has no rows', async () => {
    const stats = await fetchCoinStats('BTC', mockFetch([]));
    expect(stats).toBeNull();
  });

  it('returns null on a network error rather than throwing', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const stats = await fetchCoinStats('BTC', failing);
    expect(stats).toBeNull();
  });

  it('handles a null max_supply (uncapped coins like ETH) as null, not a crash', async () => {
    const fetchFn = mockFetch([
      { market_cap: 400_000_000_000, market_cap_rank: 2, max_supply: null, circulating_supply: 120_000_000 },
    ]);
    const stats = await fetchCoinStats('ETH', fetchFn);
    expect(stats?.maxSupply).toBeNull();
    expect(stats?.marketCap).toBe(400_000_000_000);
  });
});
