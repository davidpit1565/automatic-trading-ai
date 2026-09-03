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
import { checkManualSellRequests } from '../../server/manualSellCommand.mts';
import { ConfirmationPendingError } from '../../server/telegramConfirmationGate.mts';

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

  it('a PARTIALLY filled exit credits only what genuinely sold and shrinks the tracked quantity, keeping the remainder tracked (found asymmetric with partial-BUY handling in review, 2026-09-03)', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    openPosition(store, 'entry-1', 'XBTEUR', { stopLoss: 95, takeProfit: 115 }); // quantity 0.01
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const report: OrderStatusReport = {
      intentId: 'entry-1:auto-exit',
      state: 'submitted', // resting, only partially filled
      filledQuantity: 0.004,
      avgFillPrice: 94,
      detail: 'partially filled',
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
    const positions = openLivePositions(store);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.quantity).toBeCloseTo(0.006, 10);
    expect(positions[0]!.outstandingExitSubmittedAt).toBeDefined();
    expect(liveCash(store)).toBeCloseTo(100 + 0.004 * 94, 10);
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

  it("does NOT permanently block future exit attempts when the broker REJECTS the order (found in review, 2026-09-03: a rejected exit used to be marked 'outstanding' forever, since nothing ever clears it — a real, still-open position became impossible to close through the app)", async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    openPosition(store, 'entry-1', 'XBTEUR', { stopLoss: 95, takeProfit: 115 });
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const rejectedReport: OrderStatusReport = {
      intentId: 'entry-1:exit:2000',
      state: 'rejected',
      filledQuantity: 0,
      avgFillPrice: null,
      detail: 'Revolut X rejected the order: HTTP 400',
    };

    const first = await checkAutomaticExits(
      store,
      fakeSource(ok([candle(94)])), // triggers a stop-loss exit
      '1h',
      {},
      flowParams(rejectedReport, killSwitch, audit),
      2000,
    );
    expect(first).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report: rejectedReport }]);
    // Still tracked (nothing ever filled) and NOT marked outstanding — a
    // later cycle must get a fresh chance to exit it.
    expect(openLivePositions(store)).toHaveLength(1);
    expect(openLivePositions(store)[0]!.outstandingExitSubmittedAt).toBeUndefined();

    const filledReport: OrderStatusReport = {
      intentId: 'entry-1:exit:2500',
      state: 'filled',
      filledQuantity: 0.01,
      avgFillPrice: 93,
      detail: 'ok',
    };
    const second = await checkAutomaticExits(
      store,
      fakeSource(ok([candle(93)])),
      '1h',
      {},
      flowParams(filledReport, killSwitch, audit),
      2500,
    );
    expect(second).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report: filledReport }]);
    expect(openLivePositions(store)).toEqual([]);
  });

  it('keeps checking OTHER open positions when one throws mid-cycle (found in review, 2026-09-03: an unhandled exception for one position used to abort checking every other position that cycle)', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    openPosition(store, 'entry-1', 'XBTEUR', { stopLoss: 95, takeProfit: 115 });
    openPosition(store, 'entry-2', 'ETHEUR', { stopLoss: 95, takeProfit: 115 });
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const throwingSource: MarketDataSource = {
      name: 'throwing',
      async getInstruments() {
        return ok([]);
      },
      async getCandles(symbol) {
        if (symbol === 'XBTEUR') throw new Error('transient network error');
        return ok([candle(94)]); // triggers a stop-loss exit for ETHEUR
      },
    };
    const report: OrderStatusReport = { intentId: 'entry-2:exit:2000', state: 'filled', filledQuantity: 0.01, avgFillPrice: 94, detail: 'ok' };

    const outcomes = await checkAutomaticExits(store, throwingSource, '1h', {}, flowParams(report, killSwitch, audit), 2000);
    expect(outcomes).toEqual([
      { symbol: 'XBTEUR', outcome: 'no-price-data' },
      { symbol: 'ETHEUR', outcome: 'submitted', report },
    ]);
  });
});

describe('shared exit queue (an automatic exit and a manual /sell for the SAME position never race into two real orders)', () => {
  function seedTelegram(messages: { update_id: number; message?: { text?: string; chat?: { id: string } } }[]) {
    return (async () =>
      new Response(JSON.stringify({ ok: true, result: messages }), { status: 200 })) as unknown as typeof fetch;
  }

  it('a still-pending automatic exit is resumed (not duplicated) by a /sell for the same position — real incident, 2026-09-03: two separate intent ids let both trigger their own confirmation and both reach the broker', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    openPosition(store, 'entry-1', 'XBTEUR', { stopLoss: 95, takeProfit: 115 });
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);

    // Cycle 1: the automatic checker sees the stop-loss condition and
    // proposes an exit, but nobody has approved it yet this cycle.
    const pendingGate: ConfirmationGate = {
      async requestConfirmation() {
        throw new ConfirmationPendingError('entry-1:exit:2000');
      },
    };
    const auto = await checkAutomaticExits(
      store,
      fakeSource(ok([candle(94)])),
      '1h',
      {},
      { confirmationGate: pendingGate, brokerAdapter: fakeBrokerAdapter({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }), killSwitch, audit, verifySymbolExists: async () => true },
      2000,
    );
    expect(auto).toEqual([{ symbol: 'XBTEUR', outcome: 'pending' }]);

    // Same cycle (or a later one) a human ALSO sends /sell for the same
    // symbol. It must resume the SAME queued attempt, not start a second,
    // independent one — captured by asserting the broker only ever sees ONE
    // submit() call, for the ONE shared intent id.
    const captured: string[] = [];
    const captureBroker: BrokerAdapter = {
      name: 'fake-broker',
      mode: 'live',
      async submit(intent) {
        captured.push(intent.id);
        return { intentId: intent.id, state: 'filled', filledQuantity: 0.01, avgFillPrice: 94, detail: 'ok' };
      },
      async cancel(): Promise<OrderStatusReport> {
        throw new Error('not used');
      },
      async fetchPositions(): Promise<BrokerPosition[]> {
        return [];
      },
    };
    const manual = await checkManualSellRequests(
      store,
      { token: 'T', chatId: 'C', fetchFn: seedTelegram([{ update_id: 1, message: { text: '/sell XBTEUR', chat: { id: 'C' } } }]) },
      fakeSource(ok([candle(94)])),
      '1h',
      { confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }), brokerAdapter: captureBroker, killSwitch, audit, verifySymbolExists: async () => true },
      2100,
    );
    expect(manual).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report: { intentId: 'entry-1:exit:2000', state: 'filled', filledQuantity: 0.01, avgFillPrice: 94, detail: 'ok' } }]);
    expect(captured).toEqual(['entry-1:exit:2000']); // the ORIGINAL queued id, not a fresh manual-sell one
    expect(openLivePositions(store)).toEqual([]); // filled — forgotten, not left double-tracked
  });
});
