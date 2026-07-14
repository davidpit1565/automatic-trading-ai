/**
 * FileStore tests (TDD) — a KeyValueStore backed by a single JSON file so
 * the headless cloud autopilot persists its state between scheduled runs.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain-TS server module run via tsx; imported directly in tests
import { FileStore } from '../../server/fileStore.mts';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'filestore-'));
  path = join(dir, 'state.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('FileStore', () => {
  it('round-trips structured values', () => {
    const store = new FileStore(path);
    store.set('portfolio', { cash: 100, positions: [{ symbol: 'BTC', qty: 0.5 }] });
    expect(store.get('portfolio')).toEqual({ cash: 100, positions: [{ symbol: 'BTC', qty: 0.5 }] });
  });

  it('returns undefined for missing keys and lists/removes keys', () => {
    const store = new FileStore(path);
    expect(store.get('nope')).toBeUndefined();
    store.set('a', 1);
    store.set('b', 2);
    expect(store.keys().sort()).toEqual(['a', 'b']);
    store.remove('a');
    expect(store.get('a')).toBeUndefined();
    expect(store.keys()).toEqual(['b']);
  });

  it('persists across instances on the same path (survives a reload)', () => {
    new FileStore(path).set('trade-journal', [{ id: 't1' }]);
    const restored = new FileStore(path);
    expect(restored.get('trade-journal')).toEqual([{ id: 't1' }]);
  });

  it('starts empty when the file does not exist yet', () => {
    const store = new FileStore(join(dir, 'missing.json'));
    expect(store.keys()).toEqual([]);
  });

  it('tolerates a corrupt file instead of crashing', () => {
    const store = new FileStore(path);
    store.set('a', 1);
    // Corrupt the file, then a fresh instance should recover to empty.
    rmSync(path, { force: true });
    const fresh = new FileStore(path);
    expect(fresh.keys()).toEqual([]);
  });
});
