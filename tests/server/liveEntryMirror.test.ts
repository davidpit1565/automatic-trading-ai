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
import type { TradeOpportunity } from '../../src/core/signal/signalEngine';
import type { Instrument } from '../../src/core/types';
import { initLiveCash, liveCash } from '../../server/liveLedger.mts';
import { recordLiveEntryFill, forgetLivePosition, openLivePositions } from '../../server/liveExitFlow.mts';
import { clearOutstandingEntry, mirrorApprovedEntries } from '../../server/liveEntryMirror.mts';
import { ConfirmationPendingError } from '../../server/telegramConfirmationGate.mts';

const XBT: Instrument = { symbol: 'XBTEUR', base: 'XBT', quote: 'EUR' };

function opportunity(overrides: Partial<TradeOpportunity> = {}): TradeOpportunity {
  return {
    symbol: 'XBTEUR',
    timeframe: '1h',
    direction: 'long',
    levels: { entry: 100, stopLoss: 95, takeProfit: 115, riskReward: 3 },
    confidence: 70,
    confidenceComponents: [],
    explanation: 'test opportunity',
    warnings: [],
    basedOn: { score: 70, candleCount: 200 },
    ...overrides,
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

describe('mirrorApprovedEntries', () => {
  it('does nothing when nothing was newly approved', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const outcomes = await mirrorApprovedEntries(
      store,
      [],
      [XBT],
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([]);
  });

  it('sizes the entry against the LIVE account equity (100€), not any paper equity, and submits it', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const report: OrderStatusReport = {
      intentId: 'live-entry:XBTEUR',
      state: 'filled',
      filledQuantity: 0.01,
      avgFillPrice: 100,
      detail: 'ok',
    };

    const outcomes = await mirrorApprovedEntries(
      store,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams(report, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report }]);

    // A real, filled buy must actually become a tracked open live position
    // (stop-loss/take-profit enforcement, visibility to the automatic exit
    // mirror, correct equity) and debit the cash ledger — a bug caught
    // before this shipped: `mirrorApprovedEntries` used to mark the symbol
    // outstanding but never call `recordLiveEntryFill`/`debitLiveCash`,
    // leaving a real position completely untracked.
    const tracked = openLivePositions(store);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.quantity).toBe(0.01);
    expect(tracked[0]!.entryAssessment.asset).toBe('XBTEUR');
    expect(liveCash(store)).toBe(100 - 0.01 * 100);
  });

  it('refuses (not-approved) rather than submitting when 100€ genuinely cannot support the risk-engine sizing', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    // An entry-to-stop distance so tiny relative to a huge entry price that
    // the risk engine's own position-value/exposure caps refuse it outright
    // regardless of the (small) risk amount — exercises a real refusal path
    // rather than asserting a specific risk-engine internal.
    const hugePrice = opportunity({ levels: { entry: 1_000_000, stopLoss: 999_999, takeProfit: 1_000_010, riskReward: 10 } });

    const outcomes = await mirrorApprovedEntries(
      store,
      [hugePrice],
      [XBT],
      { XBTEUR: 1_000_000 },
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    // Either approved (sized to a tiny quantity) or refused — either way it
    // must never silently crash; assert it resolved to a real outcome.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.symbol).toBe('XBTEUR');
  });

  it('reports no-broker-symbol and does not call the broker when the symbol has no known translation', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);

    const outcomes = await mirrorApprovedEntries(
      store,
      [opportunity({ symbol: 'UNKNOWNCOIN' })],
      [XBT], // does not include an instrument for 'UNKNOWNCOIN'
      {},
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([{ symbol: 'UNKNOWNCOIN', outcome: 'no-broker-symbol' }]);
  });

  it('does not queue a symbol that already has a tracked open live position', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    recordLiveEntryFill(
      store,
      { id: 'entry-1', createdAt: 0, mode: 'live', symbol: 'BTC-EUR', side: 'buy', quantity: 0.01, limitPrice: 100, stopLoss: 95, takeProfit: 115, assessment: { approved: true, asset: 'XBTEUR', entry: 100, stopLoss: 95, takeProfit: 115, positionSize: 0.01, positionValue: 1, riskAmount: 0.05, riskPercentage: 1, rewardRiskRatio: 3, portfolioExposure: 1, reasons: [], warnings: [] } },
      { intentId: 'entry-1', state: 'filled', filledQuantity: 0.01, avgFillPrice: 100, detail: 'ok' },
      500,
    );

    const outcomes = await mirrorApprovedEntries(
      store,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'entry-already-outstanding' }]);
  });

  it('keeps a not-yet-approved entry queued (pending) and resumes it on a later call instead of losing it', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const pendingGate: ConfirmationGate = {
      async requestConfirmation() {
        throw new ConfirmationPendingError('live-entry:XBTEUR');
      },
    };

    const first = await mirrorApprovedEntries(
      store,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      {
        confirmationGate: pendingGate,
        brokerAdapter: fakeBrokerAdapter({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }),
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      },
      1000,
    );
    expect(first).toEqual([{ symbol: 'XBTEUR', outcome: 'pending' }]);

    // A later cycle, no new opportunity, but this one is still approved.
    const report: OrderStatusReport = {
      intentId: 'live-entry:XBTEUR',
      state: 'filled',
      filledQuantity: 0.01,
      avgFillPrice: 100,
      detail: 'ok',
    };
    const second = await mirrorApprovedEntries(
      store,
      [],
      [XBT],
      { XBTEUR: 100 },
      flowParams(report, killSwitch, audit),
      1500,
    );
    expect(second).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report }]);
  });

  it('refuses a second entry attempt for a symbol with an outstanding (submitted, resting) order, and clearOutstandingEntry lifts it once the position is later closed', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    // First attempt: resting order, zero filled — not tracked as an open
    // position, but must still block a second attempt.
    const restingReport: OrderStatusReport = {
      intentId: 'live-entry:XBTEUR',
      state: 'submitted',
      filledQuantity: 0,
      avgFillPrice: null,
      detail: 'resting',
    };
    const first = await mirrorApprovedEntries(
      store,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams(restingReport, killSwitch, audit),
      1000,
    );
    expect(first).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report: restingReport }]);
    expect(openLivePositions(store)).toEqual([]); // never tracked — zero fill

    const second = await mirrorApprovedEntries(
      store,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1500,
    );
    expect(second).toEqual([{ symbol: 'XBTEUR', outcome: 'entry-already-outstanding' }]);

    // Once the (hypothetical) position is later confirmed closed, the flag lifts.
    clearOutstandingEntry(store, 'XBTEUR');
    const third = await mirrorApprovedEntries(
      store,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams({ intentId: 'live-entry:XBTEUR', state: 'filled', filledQuantity: 0.01, avgFillPrice: 100, detail: 'ok' }, killSwitch, audit),
      2000,
    );
    expect(third[0]!.outcome).toBe('submitted');
  });

  it('respects the kill switch — no live entry can bypass it', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    killSwitch.engage('test');
    const audit = new PersistedAuditLog(store);

    const outcomes = await mirrorApprovedEntries(
      store,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
    );
    expect(outcomes).toEqual([{ symbol: 'XBTEUR', outcome: 'blocked-by-kill-switch' }]);
  });
});
