import { describe, expect, it } from 'vitest';
import { getFearGreedHistory } from '../../src/core/data/fearGreed';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('getFearGreedHistory', () => {
  it('parses the newest-first payload into oldest-first points with ms timestamps', async () => {
    const result = await getFearGreedHistory(
      2,
      fakeFetch(200, {
        data: [
          { value: '55', timestamp: '1792195200' },
          { value: '63', timestamp: '1792108800' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { timestamp: 1792108800000, value: 63 },
      { timestamp: 1792195200000, value: 55 },
    ]);
  });

  it('never throws: HTTP failure, bad payload, out-of-range values all return an error', async () => {
    expect((await getFearGreedHistory(2, fakeFetch(503, {}))).ok).toBe(false);
    expect((await getFearGreedHistory(2, fakeFetch(200, { nope: 1 }))).ok).toBe(false);
    expect((await getFearGreedHistory(2, fakeFetch(200, { data: [{ value: '250', timestamp: '1' }] }))).ok).toBe(false);
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await getFearGreedHistory(2, boom)).ok).toBe(false);
  });
});
