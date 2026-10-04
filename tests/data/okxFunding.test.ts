import { describe, expect, it } from 'vitest';
import { getFundingRateHistory } from '../../src/core/data/okxFunding';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('getFundingRateHistory', () => {
  it('parses OKX\'s newest-first payload into oldest-first points', async () => {
    const result = await getFundingRateHistory(
      'BTC-USDT-SWAP',
      100,
      fakeFetch(200, {
        code: '0',
        data: [
          { fundingTime: '2000', realizedRate: '0.0002', fundingRate: '0.0002' },
          { fundingTime: '1000', realizedRate: '0.0001', fundingRate: '0.0001' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { timestamp: 1000, rate: 0.0001 },
      { timestamp: 2000, rate: 0.0002 },
    ]);
  });

  it('returns an error (never throws) on an HTTP failure or an OKX error code', async () => {
    expect((await getFundingRateHistory('X', 100, fakeFetch(503, {}))).ok).toBe(false);
    expect((await getFundingRateHistory('X', 100, fakeFetch(200, { code: '51001', data: [] }))).ok).toBe(false);
  });

  it('returns an error on a network failure', async () => {
    const throwing = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    expect((await getFundingRateHistory('X', 100, throwing)).ok).toBe(false);
  });
});
