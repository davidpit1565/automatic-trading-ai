/**
 * Read-only proxy tests: the whitelist is the security boundary — nothing
 * outside explicit market-data paths may ever be forwarded, regardless of
 * credentials, and non-GET methods are refused outright.
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error plain-JS server module without type declarations
import { isAllowedPath, toUpstreamPath } from '../../server/revxProxy.mjs';

describe('isAllowedPath', () => {
  it('allows read-only market data endpoints', () => {
    for (const path of [
      '/candles/BTC-USD',
      '/candles/eth-usd',
      '/tickers',
      '/configuration/pairs',
      '/configuration/currencies',
      '/public/last-trades',
      '/public/order-book/BTC-USD',
    ]) {
      expect(isAllowedPath(path), `${path} should be allowed`).toBe(true);
    }
  });

  it('refuses every account-mutating or private endpoint', () => {
    for (const path of [
      '/orders',
      '/orders/123',
      '/order',
      '/balances',
      '/trades',
      '/withdrawals',
      '/candles/BTC-USD/../../orders',
      '/candles/BTC-USD/extra',
      '/configuration/pairs/x',
      '/',
      '',
    ]) {
      expect(isAllowedPath(path), `${path} must be refused`).toBe(false);
    }
  });
});

describe('toUpstreamPath', () => {
  it('maps local proxy paths onto the upstream API base', () => {
    expect(toUpstreamPath('/api/revx/candles/BTC-USD')).toBe('/api/1.0/candles/BTC-USD');
    expect(toUpstreamPath('/api/revx/configuration/pairs')).toBe('/api/1.0/configuration/pairs');
  });

  it('returns null for anything outside the proxy prefix or whitelist', () => {
    expect(toUpstreamPath('/api/revx/orders')).toBeNull();
    expect(toUpstreamPath('/api/other/candles/BTC-USD')).toBeNull();
    expect(toUpstreamPath('/candles/BTC-USD')).toBeNull();
    expect(toUpstreamPath('/api/revx')).toBeNull();
  });
});
