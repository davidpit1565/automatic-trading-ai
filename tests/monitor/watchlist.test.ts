/**
 * Persistent watchlist tests (TDD): manual + automatic entries, favourites,
 * and per-symbol tracking of detection history and confidence.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { WatchlistStore } from '../../src/core/monitor/watchlist';

const T = 1_700_000_000_000;

describe('WatchlistStore', () => {
  it('adds manual entries once and removes them', () => {
    const watchlist = new WatchlistStore(new MemoryStore());
    watchlist.addManual('BTC-USD', T);
    watchlist.addManual('BTC-USD', T + 1); // idempotent
    expect(watchlist.entries()).toHaveLength(1);
    expect(watchlist.entries()[0]).toMatchObject({
      symbol: 'BTC-USD',
      source: 'manual',
      favorite: false,
      addedAt: T,
    });
    watchlist.remove('BTC-USD');
    expect(watchlist.entries()).toHaveLength(0);
  });

  it('toggles favourites', () => {
    const watchlist = new WatchlistStore(new MemoryStore());
    watchlist.addManual('BTC-USD', T);
    watchlist.toggleFavorite('BTC-USD');
    expect(watchlist.entries()[0]!.favorite).toBe(true);
    watchlist.toggleFavorite('BTC-USD');
    expect(watchlist.entries()[0]!.favorite).toBe(false);
  });

  it('auto-adds symbols on watch/qualified outcomes and tracks status', () => {
    const watchlist = new WatchlistStore(new MemoryStore());
    watchlist.recordScanOutcome('ETH-USD', { timestamp: T, status: 'watch', confidence: 25 });
    const entry = watchlist.entries()[0]!;
    expect(entry.source).toBe('auto');
    expect(entry.firstDetectedAt).toBe(T);
    expect(entry.currentStatus).toBe('watch');
    expect(entry.highestConfidence).toBe(25);
  });

  it('does not auto-add symbols with no opportunity, but updates tracked ones', () => {
    const watchlist = new WatchlistStore(new MemoryStore());
    watchlist.recordScanOutcome('DOGE-USD', { timestamp: T, status: 'none' });
    expect(watchlist.entries()).toHaveLength(0);

    watchlist.addManual('DOGE-USD', T);
    watchlist.recordScanOutcome('DOGE-USD', { timestamp: T + 1000, status: 'none' });
    const entry = watchlist.entries()[0]!;
    expect(entry.lastScanAt).toBe(T + 1000);
    expect(entry.currentStatus).toBe('none');
  });

  it('tracks the highest confidence ever reached and the latest scan', () => {
    const watchlist = new WatchlistStore(new MemoryStore());
    watchlist.recordScanOutcome('ETH-USD', { timestamp: T, status: 'qualified', confidence: 60 });
    watchlist.recordScanOutcome('ETH-USD', { timestamp: T + 1, status: 'watch', confidence: 30 });
    const entry = watchlist.entries()[0]!;
    expect(entry.highestConfidence).toBe(60);
    expect(entry.currentStatus).toBe('watch');
    expect(entry.lastScanAt).toBe(T + 1);
    expect(entry.firstDetectedAt).toBe(T); // first detection never changes
  });

  it('persists across instances through the storage layer', () => {
    const store = new MemoryStore();
    const first = new WatchlistStore(store);
    first.addManual('BTC-USD', T);
    first.toggleFavorite('BTC-USD');
    const restored = new WatchlistStore(store);
    expect(restored.entries()[0]).toMatchObject({ symbol: 'BTC-USD', favorite: true });
  });

  it('sorts favourites first, then by highest confidence', () => {
    const watchlist = new WatchlistStore(new MemoryStore());
    watchlist.recordScanOutcome('A-USD', { timestamp: T, status: 'watch', confidence: 10 });
    watchlist.recordScanOutcome('B-USD', { timestamp: T, status: 'qualified', confidence: 70 });
    watchlist.addManual('C-USD', T);
    watchlist.toggleFavorite('C-USD');
    expect(watchlist.entries().map((e) => e.symbol)).toEqual(['C-USD', 'B-USD', 'A-USD']);
  });
});
