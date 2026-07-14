/**
 * Append-only opportunity history tests (TDD).
 *
 * Records are never removed or rewritten. The single permitted state
 * transition is marking that a signal later disappeared — set once.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { OpportunityLog, type OpportunityRecord } from '../../src/core/monitor/opportunityLog';

const T = 1_700_000_000_000;

function record(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: `BTC-USD:${T}`,
    detectedAt: T,
    symbol: 'BTC-USD',
    timeframe: '1h',
    price: 60_000,
    confidence: 55,
    entry: 60_000,
    stopLoss: 58_000,
    takeProfit: 64_000,
    positionSize: 0.05,
    riskPct: 1,
    explanation: 'test opportunity',
    validationVerdict: 'caution',
    snapshot: { rsi: 60, adx: 30, atrPct: 2, relativeVolume: 1.2 },
    disappearedAt: null,
    ...overrides,
  };
}

describe('OpportunityLog', () => {
  it('appends records and preserves insertion order', () => {
    const log = new OpportunityLog(new MemoryStore());
    log.append(record({ id: 'a', detectedAt: T }));
    log.append(record({ id: 'b', detectedAt: T + 1 }));
    expect(log.entries().map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('refuses duplicate ids instead of overwriting history', () => {
    const log = new OpportunityLog(new MemoryStore());
    log.append(record({ id: 'a', confidence: 50 }));
    expect(() => log.append(record({ id: 'a', confidence: 99 }))).toThrow();
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]!.confidence).toBe(50);
  });

  it('persists across instances through the storage layer', () => {
    const store = new MemoryStore();
    new OpportunityLog(store).append(record({ id: 'a' }));
    const restored = new OpportunityLog(store);
    expect(restored.entries()).toHaveLength(1);
    expect(restored.entries()[0]!.symbol).toBe('BTC-USD');
  });

  it('marks disappearance once and never twice', () => {
    const store = new MemoryStore();
    const log = new OpportunityLog(store);
    log.append(record({ id: 'a' }));
    expect(log.markDisappeared('BTC-USD', '1h', T + 1000)).toBe(true);
    expect(log.entries()[0]!.disappearedAt).toBe(T + 1000);
    // A second call must not rewrite the recorded time.
    expect(log.markDisappeared('BTC-USD', '1h', T + 9999)).toBe(false);
    expect(log.entries()[0]!.disappearedAt).toBe(T + 1000);
  });

  it('marks only the latest active record for the symbol/timeframe', () => {
    const log = new OpportunityLog(new MemoryStore());
    log.append(record({ id: 'old', detectedAt: T, disappearedAt: T + 1 }));
    log.append(record({ id: 'new', detectedAt: T + 1000 }));
    log.markDisappeared('BTC-USD', '1h', T + 2000);
    const entries = log.entries();
    expect(entries.find((r) => r.id === 'old')!.disappearedAt).toBe(T + 1);
    expect(entries.find((r) => r.id === 'new')!.disappearedAt).toBe(T + 2000);
  });

  it('returns false when there is nothing to mark', () => {
    const log = new OpportunityLog(new MemoryStore());
    expect(log.markDisappeared('ETH-USD', '1h', T)).toBe(false);
  });

  it('exposes an immutable view: mutating the returned array does not affect the log', () => {
    const log = new OpportunityLog(new MemoryStore());
    log.append(record({ id: 'a' }));
    const view = [...log.entries()];
    view.pop();
    expect(log.entries()).toHaveLength(1);
  });
});
