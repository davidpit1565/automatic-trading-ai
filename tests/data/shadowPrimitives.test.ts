/**
 * The two primitives that let several strategies run side by side (TDD):
 * namespaced storage so their state cannot collide, and per-cycle request
 * caching so N strategies cost the requests of one.
 */

import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PrefixedStore } from '../../src/core/data/prefixedStore';
import { CachingSource } from '../../src/core/data/cachingSource';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { Candle, Instrument } from '../../src/core/types';
import { ok } from '../../src/core/types';

describe('PrefixedStore', () => {
  it('keeps two namespaces over one backing store fully isolated', () => {
    const backing = new MemoryStore();
    const a = new PrefixedStore(backing, 'alpha');
    const b = new PrefixedStore(backing, 'beta');

    a.set('open-positions', ['A']);
    b.set('open-positions', ['B']);

    expect(a.get('open-positions')).toEqual(['A']);
    expect(b.get('open-positions')).toEqual(['B']);
  });

  it('lists only its own keys, unprefixed', () => {
    const backing = new MemoryStore();
    const a = new PrefixedStore(backing, 'alpha');
    new PrefixedStore(backing, 'beta').set('secret', 1);
    a.set('mine', 1);

    expect(a.keys()).toEqual(['mine']);
    // The raw store still shows both, namespaced.
    expect(backing.keys().sort()).toEqual(['alpha:mine', 'beta:secret']);
  });

  it('removes only within its namespace', () => {
    const backing = new MemoryStore();
    const a = new PrefixedStore(backing, 'alpha');
    const b = new PrefixedStore(backing, 'beta');
    a.set('k', 1);
    b.set('k', 2);

    a.remove('k');
    expect(a.get('k')).toBeUndefined();
    expect(b.get('k')).toBe(2);
  });

  it('does not collide with an unnamespaced key of the same name', () => {
    const backing = new MemoryStore();
    backing.set('open-positions', ['real']);
    const shadow = new PrefixedStore(backing, 'shadow');
    shadow.set('open-positions', ['shadow']);

    expect(backing.get('open-positions')).toEqual(['real']);
    expect(shadow.get('open-positions')).toEqual(['shadow']);
  });

  it('refuses an empty namespace, which would silently alias the root', () => {
    expect(() => new PrefixedStore(new MemoryStore(), '  ')).toThrow(RangeError);
  });
});

describe('CachingSource', () => {
  const candle: Candle = { timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 };
  const instruments: Instrument[] = [{ symbol: 'XBTEUR', base: 'BTC', quote: 'EUR' }];

  function makeInner(): { source: MarketDataSource; calls: () => number } {
    let calls = 0;
    return {
      calls: () => calls,
      source: {
        name: 'inner',
        getInstruments: async () => ok(instruments),
        getCandles: async () => {
          calls++;
          return ok([candle]);
        },
      },
    };
  }

  it('serves repeat requests within a cycle from memory — N strategies cost one fetch', async () => {
    const { source, calls } = makeInner();
    const caching = new CachingSource(source);

    for (let i = 0; i < 5; i++) await caching.getCandles('XBTEUR', '1h', 150);
    expect(calls()).toBe(1);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const { source, calls } = makeInner();
    const caching = new CachingSource(source);

    await Promise.all([
      caching.getCandles('XBTEUR', '1h', 150),
      caching.getCandles('XBTEUR', '1h', 150),
      caching.getCandles('XBTEUR', '1h', 150),
    ]);
    expect(calls()).toBe(1);
  });

  it('refetches after newCycle — a strategy must never decide on stale prices', async () => {
    const { source, calls } = makeInner();
    const caching = new CachingSource(source);

    await caching.getCandles('XBTEUR', '1h', 150);
    caching.newCycle();
    await caching.getCandles('XBTEUR', '1h', 150);
    expect(calls()).toBe(2);
  });

  it('treats a different symbol, timeframe or limit as a different request', async () => {
    const { source, calls } = makeInner();
    const caching = new CachingSource(source);

    await caching.getCandles('XBTEUR', '1h', 150);
    await caching.getCandles('ETHEUR', '1h', 150);
    await caching.getCandles('XBTEUR', '4h', 150);
    await caching.getCandles('XBTEUR', '1h', 100);
    expect(calls()).toBe(4);
  });

  it('never caches a failure — one transient error must not poison the cycle', async () => {
    let calls = 0;
    const flaky: MarketDataSource = {
      name: 'flaky',
      getInstruments: async () => ok(instruments),
      getCandles: async () => {
        calls++;
        return calls === 1 ? { ok: false as const, error: 'transient' } : ok([candle]);
      },
    };
    const caching = new CachingSource(flaky);

    expect((await caching.getCandles('XBTEUR', '1h', 150)).ok).toBe(false);
    expect((await caching.getCandles('XBTEUR', '1h', 150)).ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('reports cleanly when the wrapped source has no batch ticker', async () => {
    const { source } = makeInner();
    const result = await new CachingSource(source).getTickers();
    expect(result.ok).toBe(false);
  });

  it('passes the batch ticker through when the wrapped source has one', async () => {
    const { source } = makeInner();
    const withTicker: MarketDataSource = { ...source, getTickers: vi.fn(async () => ok([])) };
    const result = await new CachingSource(withTicker).getTickers();
    expect(result.ok).toBe(true);
    expect(withTicker.getTickers).toHaveBeenCalled();
  });
});
