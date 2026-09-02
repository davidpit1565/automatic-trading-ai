import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import type { OrderIntent, OrderStatusReport } from '../../src/core/execution/types';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';
import { recordLiveEntryFill } from '../../server/liveExitFlow.mts';
import { creditLiveCash, debitLiveCash, initLiveCash, liveCash, liveEquity } from '../../server/liveLedger.mts';

function approvedAssessment(): TradeRiskAssessment {
  return {
    approved: true,
    asset: 'XBTEUR',
    entry: 100,
    stopLoss: 90,
    takeProfit: 120,
    positionSize: 2,
    positionValue: 200,
    riskAmount: 20,
    riskPercentage: 1,
    rewardRiskRatio: 2,
    portfolioExposure: 2,
    reasons: [],
    warnings: [],
  };
}

function buyIntent(): OrderIntent {
  return {
    id: 'entry-1',
    createdAt: 1000,
    mode: 'live',
    symbol: 'BTC-EUR',
    side: 'buy',
    quantity: 2,
    limitPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    assessment: approvedAssessment(),
  };
}

function filledReport(): OrderStatusReport {
  return { intentId: 'entry-1', state: 'filled', filledQuantity: 2, avgFillPrice: 100, detail: 'ok' };
}

describe('initLiveCash', () => {
  it('sets the starting cash the first time', () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    expect(liveCash(store)).toBe(100);
  });

  it('never resets an already-initialized, already-moving balance', () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    debitLiveCash(store, 30);
    initLiveCash(store, 100); // called again, e.g. on a later cycle
    expect(liveCash(store)).toBe(70);
  });

  it('rejects a non-positive starting cash', () => {
    const store = new MemoryStore();
    expect(() => initLiveCash(store, 0)).toThrow(RangeError);
    expect(() => initLiveCash(store, -5)).toThrow(RangeError);
  });
});

describe('debitLiveCash / creditLiveCash', () => {
  it('debits and credits cash correctly', () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    debitLiveCash(store, 40);
    expect(liveCash(store)).toBe(60);
    creditLiveCash(store, 25);
    expect(liveCash(store)).toBe(85);
  });
});

describe('liveEquity', () => {
  it('is just cash when there are no open positions', () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    expect(liveEquity(store, {})).toBe(100);
  });

  it('adds the mark-to-market value of tracked open positions, keyed by the INTERNAL symbol', () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    debitLiveCash(store, 20); // spent 20 on the entry below
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000); // 2 units @ 100

    // Current price is up to 110 — equity should reflect the mark, not the entry price.
    expect(liveEquity(store, { XBTEUR: 110 })).toBe(80 + 2 * 110);
  });

  it('falls back to the entry price when no current price is available for a position', () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    debitLiveCash(store, 20);
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);

    expect(liveEquity(store, {})).toBe(80 + 2 * 100);
  });
});
