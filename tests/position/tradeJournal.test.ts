/**
 * Trade journal tests (TDD): structured, append-only, immutable records.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { TradeJournal, type JournalEntry } from '../../src/core/position/tradeJournal';

const T = 1_700_000_000_000;

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'trade-1',
    symbol: 'BTC-USD',
    entryTimestamp: T,
    exitTimestamp: T + 3_600_000,
    entryPrice: 100,
    exitPrice: 105,
    positionSize: 10,
    stopLoss: 95,
    takeProfit: 110,
    exitReason: 'take-profit',
    fees: 2,
    slippage: 0,
    holdingDurationMs: 3_600_000,
    mfePct: 6,
    maePct: 1,
    realizedPnl: 48,
    returnPct: 4.8,
    strategyVersion: 'trend-v1',
    validationVerdict: 'caution',
    confidence: 55,
    notes: null,
    ...overrides,
  };
}

describe('TradeJournal', () => {
  it('appends entries in order and persists them', () => {
    const store = new MemoryStore();
    const journal = new TradeJournal(store);
    journal.append(entry({ id: 'a' }));
    journal.append(entry({ id: 'b', realizedPnl: -10 }));
    const restored = new TradeJournal(store);
    expect(restored.entries().map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('never overwrites: duplicate ids are refused', () => {
    const journal = new TradeJournal(new MemoryStore());
    journal.append(entry({ id: 'a', realizedPnl: 48 }));
    expect(() => journal.append(entry({ id: 'a', realizedPnl: 999 }))).toThrow();
    expect(journal.entries()[0]!.realizedPnl).toBe(48);
  });

  it('validates required numeric fields', () => {
    const journal = new TradeJournal(new MemoryStore());
    expect(() => journal.append(entry({ positionSize: 0 }))).toThrow(RangeError);
    expect(() => journal.append(entry({ entryPrice: -1 }))).toThrow(RangeError);
    expect(() => journal.append(entry({ exitTimestamp: T - 1 }))).toThrow(RangeError);
  });

  it('exposes a read-only view (mutating the copy does not affect the journal)', () => {
    const journal = new TradeJournal(new MemoryStore());
    journal.append(entry({ id: 'a' }));
    const view = [...journal.entries()];
    view.pop();
    expect(journal.entries()).toHaveLength(1);
  });
});
