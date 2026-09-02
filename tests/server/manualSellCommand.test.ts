import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import type {
  BrokerAdapter,
  BrokerPosition,
  ConfirmationDecision,
  ConfirmationGate,
  OrderIntent,
  OrderStatusReport,
} from '../../src/core/execution/types';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { Candle, Instrument } from '../../src/core/types';
import { recordLiveEntryFill } from '../../server/liveExitFlow.mts';
import { checkManualSellRequests, parseSellCommand } from '../../server/manualSellCommand.mts';

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
    symbol: 'BTC-EUR', // broker-native
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

const candle = (close: number): Candle => ({ timestamp: 0, open: close, high: close, low: close, close, volume: 1 });
const XBT: Instrument = { symbol: 'XBTEUR', base: 'XBT', quote: 'EUR' };

function fakeSource(price = 95): MarketDataSource {
  return {
    name: 'fake',
    getInstruments: async () => ({ ok: true, value: [XBT] }),
    getCandles: async (symbol) => {
      // Only understands the INTERNAL symbol, never the broker-native one.
      if (symbol !== 'XBTEUR') return { ok: false, error: `unexpected symbol ${symbol}` };
      return { ok: true, value: [candle(price), candle(price)] };
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

describe('parseSellCommand', () => {
  it('parses a symbol, case-insensitively and uppercased', () => {
    expect(parseSellCommand('/sell xbteur')).toBe('XBTEUR');
    expect(parseSellCommand('/SELL XBTEUR')).toBe('XBTEUR');
    expect(parseSellCommand('  /sell   XBTEUR  ')).toBe('XBTEUR');
  });

  it('returns null for anything else, including /sell with no symbol', () => {
    expect(parseSellCommand('/sell')).toBeNull();
    expect(parseSellCommand('hello')).toBeNull();
    expect(parseSellCommand('/sell XBTEUR now')).toBeNull();
  });
});

describe('checkManualSellRequests', () => {
  function seedTelegram(messages: { update_id: number; message?: { text?: string; chat?: { id: string } } }[]) {
    return (async () =>
      new Response(JSON.stringify({ ok: true, result: messages }), { status: 200 })) as unknown as typeof fetch;
  }

  it('does nothing when no /sell command has arrived', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    const fetchFn = seedTelegram([]);
    const outcomes = await checkManualSellRequests(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      fakeSource(),
      '1h',
      {
        confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
        brokerAdapter: fakeBrokerAdapter(filledReport()),
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      },
      9000,
    );
    expect(outcomes).toEqual([]);
  });

  it('reports no-open-position for a /sell command with no matching tracked live position', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    const fetchFn = seedTelegram([
      { update_id: 1, message: { text: '/sell ETHEUR', chat: { id: 'C' } } },
    ]);
    const outcomes = await checkManualSellRequests(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      fakeSource(),
      '1h',
      {
        confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
        brokerAdapter: fakeBrokerAdapter(filledReport()),
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      },
      9000,
    );
    expect(outcomes).toEqual([{ symbol: 'ETHEUR', outcome: 'no-open-position' }]);
  });

  it('proposes and submits an immediate exit for a matching open position, through the full safety chain', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);

    const fetchFn = seedTelegram([
      { update_id: 1, message: { text: '/sell XBTEUR', chat: { id: 'C' } } },
    ]);
    const exitReport: OrderStatusReport = {
      intentId: 'entry-1:manual-sell:9000',
      state: 'filled',
      filledQuantity: 2,
      avgFillPrice: 95,
      detail: 'ok',
    };
    const outcomes = await checkManualSellRequests(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      fakeSource(95),
      '1h',
      {
        confirmationGate: fakeConfirmationGate({
          intentId: 'entry-1:manual-sell:9000',
          approved: true,
          decidedAt: 1,
          decidedBy: 'david',
        }),
        brokerAdapter: fakeBrokerAdapter(exitReport),
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      },
      9000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report: exitReport }]);
  });

  it('respects the kill switch — a manual sell cannot bypass it either', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    killSwitch.engage('test');
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);

    const fetchFn = seedTelegram([
      { update_id: 1, message: { text: '/sell XBTEUR', chat: { id: 'C' } } },
    ]);
    const outcomes = await checkManualSellRequests(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      fakeSource(95),
      '1h',
      {
        confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
        brokerAdapter: fakeBrokerAdapter(filledReport()),
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      },
      9000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'blocked-by-kill-switch' }]);
  });

  it('reports no-price-data instead of throwing when the price fetch fails, and does not re-queue the command', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);
    const failingSource: MarketDataSource = {
      name: 'failing',
      getInstruments: async () => ({ ok: true, value: [XBT] }),
      getCandles: async () => ({ ok: false, error: 'rate limited' }),
    };

    const fetchFn = seedTelegram([
      { update_id: 1, message: { text: '/sell XBTEUR', chat: { id: 'C' } } },
    ]);
    const outcomes = await checkManualSellRequests(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      failingSource,
      '1h',
      {
        confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
        brokerAdapter: fakeBrokerAdapter(filledReport()),
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      },
      9000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'no-price-data' }]);
  });

  it('ignores a message from any chat other than the configured one', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);

    const fetchFn = seedTelegram([
      { update_id: 1, message: { text: '/sell XBTEUR', chat: { id: 'someone-else' } } },
    ]);
    const outcomes = await checkManualSellRequests(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      fakeSource(95),
      '1h',
      {
        confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
        brokerAdapter: fakeBrokerAdapter(filledReport()),
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      },
      9000,
    );
    expect(outcomes).toEqual([]);
  });
});
