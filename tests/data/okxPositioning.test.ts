import { describe, expect, it } from 'vitest';
import { getTopTraderPositionRatio, toOkxSwapInstId } from '../../src/core/data/okxPositioning';

describe('toOkxSwapInstId', () => {
  it('maps a Kraken EUR pair to an OKX USDT-margined swap instId', () => {
    expect(toOkxSwapInstId('ETHEUR')).toBe('ETH-USDT-SWAP');
    expect(toOkxSwapInstId('SOLEUR')).toBe('SOL-USDT-SWAP');
  });

  it('maps Kraken\'s XBT to the conventional BTC ticker', () => {
    expect(toOkxSwapInstId('XBTEUR')).toBe('BTC-USDT-SWAP');
  });

  it('handles USD and USDT quote currencies too', () => {
    expect(toOkxSwapInstId('ETHUSD')).toBe('ETH-USDT-SWAP');
    expect(toOkxSwapInstId('ETHUSDT')).toBe('ETH-USDT-SWAP');
  });
});

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;
}

describe('getTopTraderPositionRatio', () => {
  it('parses a well-formed OKX payload, reversing to oldest-first', async () => {
    const body = { code: '0', data: [['2000', '1.5'], ['1000', '0.9']] };
    const result = await getTopTraderPositionRatio('BTC-USDT-SWAP', '1D', 100, fakeFetch(body));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { timestamp: 1000, ratio: 0.9 },
      { timestamp: 2000, ratio: 1.5 },
    ]);
  });

  it('fails with a descriptive error on a non-OK HTTP response', async () => {
    const result = await getTopTraderPositionRatio('BTC-USDT-SWAP', '1D', 100, fakeFetch({}, false, 503));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('503');
  });

  it('fails on an OKX error response (non-zero code)', async () => {
    const result = await getTopTraderPositionRatio(
      'BTC-USDT-SWAP',
      '1D',
      100,
      fakeFetch({ code: '51001', msg: 'Instrument ID does not exist' }),
    );
    expect(result.ok).toBe(false);
  });

  it('fails on an empty data array rather than returning an empty series silently', async () => {
    const result = await getTopTraderPositionRatio('BTC-USDT-SWAP', '1D', 100, fakeFetch({ code: '0', data: [] }));
    expect(result.ok).toBe(false);
  });

  it('fails when the network call itself throws', async () => {
    const throwingFetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await getTopTraderPositionRatio('BTC-USDT-SWAP', '1D', 100, throwingFetch);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('network down');
  });
});
