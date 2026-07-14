/**
 * Backup / restore tests (TDD): the entire stored state (journal, positions,
 * portfolio, audit, watchlists…) can be exported to a plain object and
 * restored into another store — protecting the accumulated track record
 * from browser-storage loss.
 */

import { describe, expect, it } from 'vitest';
import {
  exportState,
  importState,
  resetAllState,
  type BackupPayload,
} from '../../src/core/data/backup';
import { MemoryStore } from '../../src/core/data/storage';

describe('exportState', () => {
  it('captures every key in the store with a version and timestamp', () => {
    const store = new MemoryStore();
    store.set('trade-journal', [{ id: 't1' }]);
    store.set('portfolio-engine', { cash: 9000 });
    const backup = exportState(store, 1_700_000_000_000);
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe(1_700_000_000_000);
    expect(backup.data['trade-journal']).toEqual([{ id: 't1' }]);
    expect(backup.data['portfolio-engine']).toEqual({ cash: 9000 });
    expect(Object.keys(backup.data)).toHaveLength(2);
  });
});

describe('importState', () => {
  it('restores every key into the target store', () => {
    const source = new MemoryStore();
    source.set('trade-journal', [{ id: 't1' }]);
    source.set('audit-log', [{ event: 'filled' }]);
    const backup = exportState(source, 1_700_000_000_000);

    const target = new MemoryStore();
    const result = importState(target, backup);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.restoredKeys).toBe(2);
    expect(target.get('trade-journal')).toEqual([{ id: 't1' }]);
    expect(target.get('audit-log')).toEqual([{ event: 'filled' }]);
  });

  it('round-trips through JSON (the actual file format)', () => {
    const source = new MemoryStore();
    source.set('watchlist', [{ symbol: 'BTC-USD', favorite: true }]);
    const json = JSON.stringify(exportState(source, 1));
    const target = new MemoryStore();
    const result = importState(target, JSON.parse(json) as BackupPayload);
    expect(result.ok).toBe(true);
    expect(target.get('watchlist')).toEqual([{ symbol: 'BTC-USD', favorite: true }]);
  });

  it('resetAllState wipes every key — an explicit owner fresh-start', () => {
    const store = new MemoryStore();
    store.set('trade-journal', [{ id: 't1' }]);
    store.set('portfolio-engine', { cash: 9000 });
    store.set('audit-log', [{ event: 'filled' }]);
    const removed = resetAllState(store);
    expect(removed).toBe(3);
    expect(store.keys()).toEqual([]);
  });

  it('rejects malformed payloads without touching the store', () => {
    const target = new MemoryStore();
    target.set('keep', 'me');
    expect(importState(target, null as unknown as BackupPayload).ok).toBe(false);
    expect(importState(target, {} as BackupPayload).ok).toBe(false);
    expect(
      importState(target, { version: 99, exportedAt: 1, data: {} }).ok,
    ).toBe(false);
    expect(importState(target, { version: 1, exportedAt: 1, data: 'x' as never }).ok).toBe(false);
    expect(target.get('keep')).toBe('me');
    expect(target.keys()).toEqual(['keep']);
  });
});
