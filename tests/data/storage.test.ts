import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';

describe('MemoryStore', () => {
  it('round-trips structured values', () => {
    const store = new MemoryStore();
    store.set('portfolio', { cash: 100, positions: [{ symbol: 'BTC/USD', qty: 0.5 }] });
    expect(store.get('portfolio')).toEqual({
      cash: 100,
      positions: [{ symbol: 'BTC/USD', qty: 0.5 }],
    });
  });

  it('returns undefined for missing keys', () => {
    expect(new MemoryStore().get('missing')).toBeUndefined();
  });

  it('removes keys and lists keys', () => {
    const store = new MemoryStore();
    store.set('a', 1);
    store.set('b', 2);
    store.remove('a');
    expect(store.get('a')).toBeUndefined();
    expect(store.keys()).toEqual(['b']);
  });

  it('stores deep copies, not references', () => {
    const store = new MemoryStore();
    const original = { nested: { n: 1 } };
    store.set('x', original);
    original.nested.n = 999;
    expect(store.get<{ nested: { n: number } }>('x')?.nested.n).toBe(1);
  });
});
