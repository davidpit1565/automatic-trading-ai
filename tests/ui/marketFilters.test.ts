/**
 * Search, sort and watchlist for the markets list (TDD).
 *
 * All pure views over already-fetched rows — with several hundred markets in
 * memory from one request, none of these should ever cost a fetch.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { searchRows, sortRows, matchesQuery, topGainers, topLosers, Watchlist } from '../../src/ui/marketFilters';
import type { MarketRow } from '../../src/ui/markets';

const row = (over: Partial<MarketRow> & { symbol: string }): MarketRow => ({
  label: 'X', base: 'X', price: 1, change: 0, changePct: 0, high: 1, low: 1, quoteVolume: 0, updatedAt: 0, ...over,
});

const ROWS: MarketRow[] = [
  row({ symbol: 'XBTEUR', base: 'BTC', label: 'Bitcoin', price: 56000, changePct: -2.1, quoteVolume: 900_000 }),
  row({ symbol: 'ETHEUR', base: 'ETH', label: 'Ethereum', price: 1660, changePct: 3.4, quoteVolume: 500_000 }),
  row({ symbol: 'ADAEUR', base: 'ADA', label: 'Cardano', price: 0.137, changePct: -5.6, quoteVolume: 100_000 }),
  row({ symbol: 'PEPEEUR', base: 'PEPE', label: 'PEPE', price: 0.0000123, changePct: 9.9, quoteVolume: 10_000 }),
];

describe('search', () => {
  it('finds a market by name, code or pair symbol', () => {
    expect(searchRows(ROWS, 'bitcoin').map((r) => r.base)).toEqual(['BTC']);
    expect(searchRows(ROWS, 'btc').map((r) => r.base)).toEqual(['BTC']);
    expect(searchRows(ROWS, 'xbteur').map((r) => r.base)).toEqual(['BTC']);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(searchRows(ROWS, '  EtHeReUm ').map((r) => r.base)).toEqual(['ETH']);
  });

  it('matches partially, so typing narrows as you go', () => {
    expect(searchRows(ROWS, 'e').length).toBeGreaterThan(1);
    expect(searchRows(ROWS, 'pep').map((r) => r.base)).toEqual(['PEPE']);
  });

  it('returns everything for an empty query, and nothing for no match', () => {
    expect(searchRows(ROWS, '')).toHaveLength(ROWS.length);
    expect(searchRows(ROWS, '   ')).toHaveLength(ROWS.length);
    expect(searchRows(ROWS, 'zzzzz')).toHaveLength(0);
  });

  it('does not mutate the input list', () => {
    const before = [...ROWS];
    searchRows(ROWS, 'btc');
    expect(ROWS).toEqual(before);
  });

  it('exposes the single-row predicate for reuse', () => {
    expect(matchesQuery(ROWS[0]!, 'bit')).toBe(true);
    expect(matchesQuery(ROWS[0]!, 'sol')).toBe(false);
  });
});

describe('sort', () => {
  it('ranks by change, biggest riser first', () => {
    expect(sortRows(ROWS, 'change').map((r) => r.base)).toEqual(['PEPE', 'ETH', 'BTC', 'ADA']);
  });

  it('ranks by price and by volume, highest first', () => {
    expect(sortRows(ROWS, 'price')[0]!.base).toBe('BTC');
    expect(sortRows(ROWS, 'volume').map((r) => r.base)).toEqual(['BTC', 'ETH', 'ADA', 'PEPE']);
  });

  it('sorts by name alphabetically', () => {
    expect(sortRows(ROWS, 'name').map((r) => r.label)).toEqual(['Bitcoin', 'Cardano', 'Ethereum', 'PEPE']);
  });

  it('keeps the incoming order for default — that order is meaningful', () => {
    expect(sortRows(ROWS, 'default').map((r) => r.base)).toEqual(['BTC', 'ETH', 'ADA', 'PEPE']);
  });

  it('never mutates the input list', () => {
    const before = [...ROWS];
    sortRows(ROWS, 'change');
    sortRows(ROWS, 'name');
    expect(ROWS).toEqual(before);
  });
});

describe('topGainers / topLosers', () => {
  it('keeps only positive movers, ranked biggest first', () => {
    // PEPE is a genuine gainer (+9.9%) but its 10k quoteVolume falls under
    // the liquidity floor while other rows report real volume — correctly
    // excluded as noise, not a real "top mover" (see the illiquid-filtering
    // test below for the fixture where NO row reports volume).
    expect(topGainers(ROWS).map((r) => r.base)).toEqual(['ETH']);
  });

  it('keeps only negative movers, ranked biggest drop first', () => {
    expect(topLosers(ROWS).map((r) => r.base)).toEqual(['ADA', 'BTC']);
  });

  it('respects a limit', () => {
    expect(topLosers(ROWS, 1).map((r) => r.base)).toEqual(['ADA']);
    const gainers: MarketRow[] = [
      row({ symbol: 'A', base: 'A', changePct: 50, quoteVolume: 0 }),
      row({ symbol: 'B', base: 'B', changePct: 30, quoteVolume: 0 }),
    ];
    expect(topGainers(gainers, 1).map((r) => r.base)).toEqual(['A']);
  });

  it('filters out illiquid movers ONLY when the source actually reports volume', () => {
    const withVolume: MarketRow[] = [
      row({ symbol: 'A', base: 'A', changePct: 50, quoteVolume: 500 }), // below the floor
      row({ symbol: 'B', base: 'B', changePct: 10, quoteVolume: 100_000 }),
    ];
    expect(topGainers(withVolume).map((r) => r.base)).toEqual(['B']);

    // A source reporting zero volume everywhere (e.g. the per-symbol
    // fallback, or the demo source) must not silently empty the list.
    const noVolumeData: MarketRow[] = [
      row({ symbol: 'A', base: 'A', changePct: 50, quoteVolume: 0 }),
      row({ symbol: 'B', base: 'B', changePct: 10, quoteVolume: 0 }),
    ];
    expect(topGainers(noVolumeData).map((r) => r.base)).toEqual(['A', 'B']);
  });

  it('never mutates the input list', () => {
    const before = [...ROWS];
    topGainers(ROWS);
    topLosers(ROWS);
    expect(ROWS).toEqual(before);
  });
});

describe('watchlist', () => {
  it('stars and unstars a market', () => {
    const list = new Watchlist(new MemoryStore());
    expect(list.has('XBTEUR')).toBe(false);
    expect(list.toggle('XBTEUR')).toBe(true);
    expect(list.has('XBTEUR')).toBe(true);
    expect(list.toggle('XBTEUR')).toBe(false);
    expect(list.has('XBTEUR')).toBe(false);
  });

  it('survives a reload through the store', () => {
    const store = new MemoryStore();
    new Watchlist(store).toggle('ETHEUR');
    expect(new Watchlist(store).has('ETHEUR')).toBe(true);
  });

  it('filters rows to the starred ones, keeping list order', () => {
    const list = new Watchlist(new MemoryStore());
    list.toggle('ADAEUR');
    list.toggle('XBTEUR');
    expect(list.filter(ROWS).map((r) => r.base)).toEqual(['BTC', 'ADA']);
  });

  it('starts empty and reports its size', () => {
    const list = new Watchlist(new MemoryStore());
    expect(list.size).toBe(0);
    list.toggle('XBTEUR');
    expect(list.size).toBe(1);
  });

  it('tolerates corrupt stored data instead of throwing', () => {
    const store = new MemoryStore();
    store.set('markets-watchlist', 'not-an-array');
    const list = new Watchlist(store);
    expect(list.size).toBe(0);
    expect(list.toggle('XBTEUR')).toBe(true);
  });
});
