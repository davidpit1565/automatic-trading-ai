import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import type { TradeOpportunity } from '../../src/core/signal/signalEngine';
import {
  buildBlackoutSummaryMessage,
  drainBlackoutQueue,
  queueBlackoutEntries,
} from '../../server/liveBlackoutQueue.mts';

function opportunity(symbol: string, entry: number, stopLoss: number, takeProfit: number): TradeOpportunity {
  return {
    symbol,
    timeframe: '1h',
    direction: 'long',
    levels: { entry, stopLoss, takeProfit, riskReward: (takeProfit - entry) / (entry - stopLoss) },
    confidence: 70,
    confidenceComponents: [],
    explanation: 'test',
    warnings: [],
    basedOn: { score: 1, candleCount: 100 },
  };
}

describe('queueBlackoutEntries / drainBlackoutQueue', () => {
  it('queues an approved opportunity and drains it re-validated against the current price', () => {
    const store = new MemoryStore();
    queueBlackoutEntries(store, [opportunity('XBTEUR', 68_620, 67_571, 70_658)], 1000);

    const drained = drainBlackoutQueue(store, { XBTEUR: 69_309 }); // ~+1%
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({
      symbol: 'XBTEUR',
      entry: 68_620,
      stopLoss: 67_571,
      takeProfit: 70_658,
      queuedAt: 1000,
      currentPrice: 69_309,
    });
    expect(drained[0]!.movedPct).toBeCloseTo(1, 1);
  });

  it('a later approval for the SAME symbol overwrites the earlier one, not duplicates it', () => {
    const store = new MemoryStore();
    queueBlackoutEntries(store, [opportunity('XBTEUR', 68_000, 67_000, 70_000)], 1000);
    queueBlackoutEntries(store, [opportunity('XBTEUR', 69_000, 68_000, 71_000)], 2000);

    const drained = drainBlackoutQueue(store, { XBTEUR: 69_000 });
    expect(drained).toHaveLength(1);
    expect(drained[0]!.entry).toBe(69_000);
    expect(drained[0]!.queuedAt).toBe(2000);
  });

  it('draining empties the queue — a second drain returns nothing', () => {
    const store = new MemoryStore();
    queueBlackoutEntries(store, [opportunity('XBTEUR', 68_000, 67_000, 70_000)], 1000);
    drainBlackoutQueue(store, { XBTEUR: 68_000 });

    expect(drainBlackoutQueue(store, { XBTEUR: 68_000 })).toEqual([]);
  });

  it('falls back to the queued entry price when no current price is available', () => {
    const store = new MemoryStore();
    queueBlackoutEntries(store, [opportunity('XBTEUR', 68_000, 67_000, 70_000)], 1000);

    const drained = drainBlackoutQueue(store, {});
    expect(drained[0]!.currentPrice).toBe(68_000);
    expect(drained[0]!.movedPct).toBe(0);
  });
});

describe('buildBlackoutSummaryMessage', () => {
  it('returns null when nothing was queued — stays silent rather than pinging for nothing', () => {
    expect(buildBlackoutSummaryMessage([], 'שבת')).toBeNull();
  });

  it('lists every entry with its move and never suggests automatic action', () => {
    const message = buildBlackoutSummaryMessage(
      [{ symbol: 'XBTEUR', entry: 68_620, stopLoss: 67_571, takeProfit: 70_658, queuedAt: 1000, currentPrice: 69_309, movedPct: 1 }],
      'שבת',
    );
    expect(message).toContain('XBTEUR');
    expect(message).toContain('68,620');
    expect(message).toContain('69,309');
    expect(message).toContain('/buy');
    expect(message).not.toContain('בוצע'); // never implies it already executed anything
  });
});
