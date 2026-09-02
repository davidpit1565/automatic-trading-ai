import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import type {
  BrokerAdapter,
  BrokerPosition,
  ConfirmationDecision,
  ConfirmationGate,
  OrderStatusReport,
} from '../../src/core/execution/types';
import type { Candle, Result } from '../../src/core/types';
import { ok, err } from '../../src/core/types';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { initLiveCash, liveCash } from '../../server/liveLedger.mts';
import { markExitSubmitted, openLivePositions, recordLiveEntryFill } from '../../server/liveExitFlow.mts';
import { checkAutomaticExits } from '../../server/liveExitMirror.mts';

function candle(close: number): Candle {
  return { timestamp: 0, open: close, high: close, low: close, close, volume: 1 };
}

function fakeSource(candles: Result<Candle[]>): MarketDataSource {
  return {
    name: 'fake-source',
    async getInstruments() {
      return ok([]);
    },
    async getCandles() {
      return candles;
    },
  };
}

function fakeConfirmationGate(outcome: ConfirmationDecision): ConfirmationGate {
  return {
    async requestConfirmation() {
      return outcome;
    },
  };
}

function fakeBrokerAdapter(report: OrderStatusReport): BrokerAdapter {
  return {
    name: 'fake-broker',
    mode: 'live',
    async submit() {
      return report;
    },
    async cancel(): Promise<OrderStatusReport> {
      throw new Error('not used');
    },
    async fetchPositions(): Promise<BrokerPosition[]> {
      return [];
    },
  };
}

function flowParams(report: OrderStatusReport, killSwitch: PersistedKillSwitch, audit: PersistedAuditLog) {
  return {
    confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
    brokerAdapter: fakeBrokerAdapter(report),
    killSwitch,
    audit,
    verifySymbolExists: async () => true,
  };
}

function openPosition(store: MemoryStore, id: string, symbol: string, opts: { stopLoss: number; takeProfit: number }) {
  recordLiveEntryFill(
    store,
    {
      id,
      createdAt: 0,
      mode: 'live',
      symbol: `${symbol}-BROKER`,
      side: 'buy',
      quantity: 0.01,
      limitPrice: 100,
      stopLoss: opts.stopLoss,
      takeProfit: opts.takeProfit,
      assessment: {
        approved: true,
        asset: symbol,
        entry: 100,
        stopLoss: opts.stopLoss,
        takeProfit: opts.takeProfit,
        positionSize: 0.01,
        positionValue: 1,
        riskAmount: 0.05,
        riskPercentage: 1,
        rewardRiskRatio: 3,
        portfolioExposure: 1,
        reasons: [],
        warnings: [],
      },
    },
    { intentId: id, state: 'filled', filledQuantity: 0.01, avgFillPrice: 100, detail: 'ok' },
    0,
  );
}

describe('checkAutomaticExits', () => {
  it('does nothing when there are no open positions', async () => {
    const store = new MemoryStore();
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const outcomes = await checkAutomaticExits(
      store,
      fakeSource(ok([candle(100)])),
      '1h',
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([]);
  });

  it('proposes and submits a stop-loss exit when price falls to/below the stop, then forgets the position and credits cash on a fill', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    openPosition(store, 'entry-1', 'XBTEUR', { stopLoss: 95, takeProfit: 115 });
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const report: OrderStatusReport = {
      intentId: 'entry-1:auto-exit',
      state: 'filled',
      filledQuantity: 0.01,
      avgFillPrice: 94,
      detail: 'ok',
    };

    const outcomes = await checkAutomaticExits(
      store,
      fakeSource(ok([candle(94)])),
      '1h',
      {},
      flowParams(report, killSwitch, audit),
      2000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report }]);
    expect(openLivePositions(store)).toEqual([]);
    expect(liveCash(store)).toBe(100 + 0.01 * 94);
  });

  it('reports no-exit-signal and keeps the position tracked when price is between stop and target', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    openPosition(store, 'entry-1', 'XBTEUR', { stopLoss: 95, takeProfit: 115 });
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);

    const outcomes = await checkAutomaticExits(
      store,
      fakeSource(ok([candle(105)])),
      '1h',
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      2000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'no-exit-signal' }]);
    expect(openLivePositions(store)).toHaveLength(1);
  });

  it('reports no-price-data on a candle fetch failure and leaves the position untouched', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    openPosition(store, 'entry-1', 'XBTEUR', { stopLoss: 95, takeProfit: 115 });
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);

    const outcomes = await checkAutomaticExits(
      store,
      fakeSource(err('network error')),
      '1h',
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      2000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'no-price-data' }]);
    expect(openLivePositions(store)).toHaveLength(1);
  });

  it('skips a position with an outstanding (already submitted) exit instead of proposing a second one', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    openPosition(store, 'entry-1', 'XBTEUR', { stopLoss: 95, takeProfit: 115 });
    markExitSubmitted(store, 'entry-1', 1500);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);

    const outcomes = await checkAutomaticExits(
      store,
      fakeSource(ok([candle(94)])), // would otherwise trigger a stop-loss exit
      '1h',
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      2000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'outstanding-exit-already-pending' }]);
  });

  it('respects the kill switch — no automatic exit can bypass it', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    openPosition(store, 'entry-1', 'XBTEUR', { stopLoss: 95, takeProfit: 115 });
    const killSwitch = new PersistedKillSwitch(store);
    killSwitch.engage('test');
    const audit = new PersistedAuditLog(store);

    const outcomes = await checkAutomaticExits(
      store,
      fakeSource(ok([candle(94)])),
      '1h',
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      2000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'blocked-by-kill-switch' }]);
    // Blocked, not lost — the position stays tracked for a later retry once resumed.
    expect(openLivePositions(store)).toHaveLength(1);
  });
});
