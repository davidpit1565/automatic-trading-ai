import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import type { BrokerAdapter, BrokerPosition, OrderIntent, OrderStatusReport } from '../../src/core/execution/types';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';
import { recordLiveEntryFill } from '../../server/liveExitFlow.mts';
import {
  creditLiveCash,
  debitLiveCash,
  hasLiveAccount,
  initLiveCash,
  liveCash,
  liveEquity,
  liveExternalBtcQuantity,
  recordLiveEquity,
  syncLiveCashFromBroker,
  syncLiveExternalBtc,
} from '../../server/liveLedger.mts';

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

describe('syncLiveCashFromBroker (real incident, 2026-09-03: tracker said €100.15, real account had €0.11)', () => {
  it('overwrites the tracked cash with the broker\'s real EUR balance', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100.15);
    await syncLiveCashFromBroker(store, fakeBroker([{ symbol: 'EUR', quantity: 0.11, avgCost: 0 }]));
    expect(liveCash(store)).toBe(0.11);
  });

  it('leaves the tracked cash untouched when the broker reports no EUR balance at all', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100.15);
    await syncLiveCashFromBroker(store, fakeBroker([{ symbol: 'BTC', quantity: 0.001, avgCost: 0 }]));
    expect(liveCash(store)).toBe(100.15);
  });

  it('leaves the tracked cash untouched on a network failure, rather than zeroing out real money', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100.15);
    await syncLiveCashFromBroker(
      store,
      fakeBroker(() => Promise.reject(new Error('network timeout'))),
    );
    expect(liveCash(store)).toBe(100.15);
  });
});

describe('hasLiveAccount (distinguishes "never enabled" from a genuine €0 balance)', () => {
  it('is false before the live ledger has ever been initialized', () => {
    const store = new MemoryStore();
    expect(hasLiveAccount(store)).toBe(false);
  });

  it('is true once initialized, even if the balance later drops to exactly 0', () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    debitLiveCash(store, 100);
    expect(liveCash(store)).toBe(0);
    expect(hasLiveAccount(store)).toBe(true);
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

describe('syncLiveExternalBtc (untracked BTC holding, 2026-09-03)', () => {
  it('records the broker-reported BTC balance', async () => {
    const store = new MemoryStore();
    await syncLiveExternalBtc(store, fakeBroker([{ symbol: 'BTC', quantity: 0.00075, avgCost: 0 }]));
    expect(liveExternalBtcQuantity(store)).toBe(0.00075);
  });

  it('records zero when the broker reports no BTC balance at all', async () => {
    const store = new MemoryStore();
    await syncLiveExternalBtc(store, fakeBroker([{ symbol: 'EUR', quantity: 50, avgCost: 0 }]));
    expect(liveExternalBtcQuantity(store)).toBe(0);
  });

  it('leaves the tracked quantity untouched on a network failure', async () => {
    const store = new MemoryStore();
    await syncLiveExternalBtc(store, fakeBroker([{ symbol: 'BTC', quantity: 0.001, avgCost: 0 }]));
    await syncLiveExternalBtc(store, fakeBroker(() => Promise.reject(new Error('network timeout'))));
    expect(liveExternalBtcQuantity(store)).toBe(0.001);
  });
});

describe('recordLiveEquity (real account value-over-time, reporting only — 2026-09-03)', () => {
  it('appends cash + tracked positions + the untracked BTC holding, valued at the current XBTEUR price', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 50);
    await syncLiveExternalBtc(store, fakeBroker([{ symbol: 'BTC', quantity: 0.001, avgCost: 0 }]));

    recordLiveEquity(store, { XBTEUR: 100_000 }, 1_000);

    // 50 cash + 0.001 * 100,000 BTC value = 150.
    expect(store.get('live-equity-history')).toEqual([{ at: 1_000, equity: 150 }]);
  });

  it('never changes liveEquity (used to size trades) — reporting only', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 50);
    await syncLiveExternalBtc(store, fakeBroker([{ symbol: 'BTC', quantity: 0.001, avgCost: 0 }]));

    const before = liveEquity(store, { XBTEUR: 100_000 });
    recordLiveEquity(store, { XBTEUR: 100_000 }, 1_000);
    expect(liveEquity(store, { XBTEUR: 100_000 })).toBe(before);
    expect(before).toBe(50); // does NOT include the untracked BTC
  });

  it('caps the history and treats a missing XBTEUR price as zero rather than throwing', () => {
    const store = new MemoryStore();
    initLiveCash(store, 10);
    recordLiveEquity(store, {}, 1);
    expect(store.get('live-equity-history')).toEqual([{ at: 1, equity: 10 }]);
  });
});
