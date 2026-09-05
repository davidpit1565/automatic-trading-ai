import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import type { Candle, Result } from '../../src/core/types';
import type { BrokerAdapter, BrokerPosition, OrderIntent, OrderStatusReport } from '../../src/core/execution/types';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';
import { openLivePositions, recordLiveEntryFill } from '../../server/liveExitFlow.mts';
import { syncManualTradesFromBroker } from '../../server/liveManualTradeSync.mts';

const NO_TELEGRAM = { token: '', chatId: '' };

/** Minimal fake — only fetchPositions is exercised by these tests. */
function fakeBroker(positions: BrokerPosition[] | (() => Promise<BrokerPosition[]>)): BrokerAdapter {
  return {
    name: 'fake',
    mode: 'live',
    submit: () => {
      throw new Error('not used in these tests');
    },
    cancel: () => {
      throw new Error('not used in these tests');
    },
    fetchPositions: () => (typeof positions === 'function' ? positions() : Promise.resolve(positions)),
  };
}

/** Minimal fake — only getCandles is exercised by these tests. */
function fakeSource(pricesBySymbol: Record<string, number | null>): MarketDataSource {
  return {
    name: 'fake',
    getInstruments: () => {
      throw new Error('not used in these tests');
    },
    getCandles: (symbol: string): Promise<Result<Candle[]>> => {
      const close = pricesBySymbol[symbol];
      if (close === undefined || close === null) return Promise.resolve({ ok: true, value: [] });
      const candle: Candle = { timestamp: 1, open: close, high: close, low: close, close, volume: 0 };
      return Promise.resolve({ ok: true, value: [candle] });
    },
  };
}

function approvedAssessment(asset: string, entry: number): TradeRiskAssessment {
  return {
    approved: true,
    asset,
    entry,
    stopLoss: entry * 0.9,
    takeProfit: entry * 1.1,
    positionSize: 2,
    positionValue: 2 * entry,
    riskAmount: entry * 0.2,
    riskPercentage: 1,
    rewardRiskRatio: 2,
    portfolioExposure: 2,
    reasons: [],
    warnings: [],
  };
}

function buyIntent(symbol: string, quantity: number, entry: number): OrderIntent {
  return {
    id: `entry-${symbol}`,
    createdAt: 1000,
    mode: 'live',
    symbol,
    side: 'buy',
    quantity,
    limitPrice: entry,
    stopLoss: entry * 0.9,
    takeProfit: entry * 1.1,
    assessment: approvedAssessment(symbol, entry),
  };
}

function filledReport(symbol: string, quantity: number, entry: number): OrderStatusReport {
  return { intentId: `entry-${symbol}`, state: 'filled', filledQuantity: quantity, avgFillPrice: entry, detail: 'ok' };
}

describe('syncManualTradesFromBroker (2026-09-04: a real Revolut X trade made outside this bot)', () => {
  it('opens a tracked position for a brand-new manual buy at the current market price', async () => {
    const store = new MemoryStore();
    await syncManualTradesFromBroker(
      store,
      fakeBroker([{ symbol: 'BTC', quantity: 0.5, avgCost: 0 }]),
      fakeSource({ XBTEUR: 50_000 }),
      NO_TELEGRAM,
      1_000,
    );
    const positions = openLivePositions(store);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.entryAssessment.asset).toBe('XBTEUR');
    expect(positions[0]!.quantity).toBe(0.5);
    expect(positions[0]!.entryPrice).toBe(50_000);
    expect(positions[0]!.entryAssessment.stopLoss).toBeCloseTo(50_000 * (1 - 1.5 / 100));
    expect(positions[0]!.entryAssessment.takeProfit).toBeCloseTo(50_000 * (1 + 3 / 100));
  });

  it('opens an additional tracked position for only the excess when the broker balance grows on top of an existing tracked position', async () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent('XBTEUR', 0.2, 40_000), filledReport('XBTEUR', 0.2, 40_000), 500);
    await syncManualTradesFromBroker(
      store,
      fakeBroker([{ symbol: 'BTC', quantity: 0.5, avgCost: 0 }]), // 0.3 more than tracked
      fakeSource({ XBTEUR: 50_000 }),
      NO_TELEGRAM,
      1_000,
    );
    const positions = openLivePositions(store).filter((p) => p.entryAssessment.asset === 'XBTEUR');
    const totalQty = positions.reduce((sum, p) => sum + p.quantity, 0);
    expect(totalQty).toBeCloseTo(0.5);
    expect(positions.some((p) => p.quantity === 0.3 && p.entryPrice === 50_000)).toBe(true);
  });

  it('does not open a position when the current price cannot be fetched — retries next cycle instead of guessing', async () => {
    const store = new MemoryStore();
    await syncManualTradesFromBroker(
      store,
      fakeBroker([{ symbol: 'BTC', quantity: 0.5, avgCost: 0 }]),
      fakeSource({ XBTEUR: null }),
      NO_TELEGRAM,
      1_000,
    );
    expect(openLivePositions(store)).toHaveLength(0);
  });

  it('fully closes a tracked position on a manual sell and reports the realized P&L', async () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent('XBTEUR', 0.5, 40_000), filledReport('XBTEUR', 0.5, 40_000), 500);
    const pnlEvents: Array<[number, number]> = [];
    await syncManualTradesFromBroker(
      store,
      fakeBroker([{ symbol: 'BTC', quantity: 0, avgCost: 0 }]), // sold everything
      fakeSource({ XBTEUR: 45_000 }),
      NO_TELEGRAM,
      2_000,
      (pnl, ts) => pnlEvents.push([pnl, ts]),
    );
    expect(openLivePositions(store)).toHaveLength(0);
    expect(pnlEvents).toEqual([[(45_000 - 40_000) * 0.5, 2_000]]);
  });

  it('partially reduces a tracked position on a partial manual sell', async () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent('XBTEUR', 0.5, 40_000), filledReport('XBTEUR', 0.5, 40_000), 500);
    const pnlEvents: Array<[number, number]> = [];
    await syncManualTradesFromBroker(
      store,
      fakeBroker([{ symbol: 'BTC', quantity: 0.2, avgCost: 0 }]), // sold 0.3 of 0.5
      fakeSource({ XBTEUR: 45_000 }),
      NO_TELEGRAM,
      2_000,
      (pnl, ts) => pnlEvents.push([pnl, ts]),
    );
    const positions = openLivePositions(store).filter((p) => p.entryAssessment.asset === 'XBTEUR');
    expect(positions).toHaveLength(1);
    expect(positions[0]!.quantity).toBeCloseTo(0.2);
    expect(pnlEvents).toEqual([[(45_000 - 40_000) * 0.3, 2_000]]);
  });

  it('does not record a P&L when the current price cannot be fetched on a manual sell, but still reduces the tracked position', async () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent('XBTEUR', 0.5, 40_000), filledReport('XBTEUR', 0.5, 40_000), 500);
    const pnlEvents: Array<[number, number]> = [];
    await syncManualTradesFromBroker(
      store,
      fakeBroker([{ symbol: 'BTC', quantity: 0, avgCost: 0 }]),
      fakeSource({ XBTEUR: null }),
      NO_TELEGRAM,
      2_000,
      (pnl, ts) => pnlEvents.push([pnl, ts]),
    );
    expect(openLivePositions(store)).toHaveLength(0);
    expect(pnlEvents).toEqual([]);
  });

  it('ignores float noise below the dust threshold rather than treating it as a real trade', async () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent('XBTEUR', 0.5, 40_000), filledReport('XBTEUR', 0.5, 40_000), 500);
    await syncManualTradesFromBroker(
      store,
      fakeBroker([{ symbol: 'BTC', quantity: 0.5 + 1e-9, avgCost: 0 }]),
      fakeSource({ XBTEUR: 45_000 }),
      NO_TELEGRAM,
      2_000,
    );
    const positions = openLivePositions(store).filter((p) => p.entryAssessment.asset === 'XBTEUR');
    expect(positions).toHaveLength(1);
    expect(positions[0]!.quantity).toBe(0.5); // untouched
  });

  it('no-ops on a broker fetch failure rather than throwing or guessing', async () => {
    const store = new MemoryStore();
    await expect(
      syncManualTradesFromBroker(
        store,
        fakeBroker(() => Promise.reject(new Error('network timeout'))),
        fakeSource({ XBTEUR: 50_000 }),
        NO_TELEGRAM,
        1_000,
      ),
    ).resolves.toBeUndefined();
    expect(openLivePositions(store)).toHaveLength(0);
  });

  it('reconciles multiple curated symbols independently in the same cycle', async () => {
    const store = new MemoryStore();
    await syncManualTradesFromBroker(
      store,
      fakeBroker([
        { symbol: 'BTC', quantity: 0.1, avgCost: 0 },
        { symbol: 'ETH', quantity: 2, avgCost: 0 },
      ]),
      fakeSource({ XBTEUR: 50_000, ETHEUR: 3_000 }),
      NO_TELEGRAM,
      1_000,
    );
    const positions = openLivePositions(store);
    expect(positions.find((p) => p.entryAssessment.asset === 'XBTEUR')?.quantity).toBe(0.1);
    expect(positions.find((p) => p.entryAssessment.asset === 'ETHEUR')?.quantity).toBe(2);
  });
});
