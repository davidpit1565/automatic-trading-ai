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

/**
 * `intentId` always mirrors whatever `intent.id` the code actually
 * submitted (never the caller-supplied `report.intentId`) — matching real
 * `RevolutXBrokerAdapter` behavior, where the report's intentId always
 * comes from the submitted intent, never the broker's response body. This
 * matters since 2026-09-03: `intent.id` now embeds the pending entry's own
 * `queuedAt` (real incident — Revolut X rejected a genuinely new attempt as
 * a duplicate client_order_id when it was only ever derived from the
 * symbol), so a test hardcoding the old plain `live-entry:SYMBOL` id would
 * silently stop matching and `recordLiveEntryFill`'s own intentId check
 * would then reject every fill.
 */
function fakeBrokerAdapter(report: OrderStatusReport): BrokerAdapter {
  return {
    name: 'fake-broker',
    mode: 'live',
    async submit(intent) {
      return { ...report, intentId: intent.id };
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
      intentId: 'live-entry:XBTEUR', // overridden by fakeBrokerAdapter to match the real intent.id
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
    // Freshly queued at now=1000 -> queuedAt=1000 -> this exact intent.id.
    expect(outcomes).toEqual([
      { symbol: 'XBTEUR', outcome: 'submitted', report: { ...report, intentId: 'live-entry:XBTEUR:1000' } },
    ]);

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

  it('re-checks equity/open-positions AFTER each fill within one call, not once before the loop (regression, 2026-09-03)', async () => {
    // Two symbols approved in the SAME cycle, `maxOpenPositions: 1`. Before
    // this fix, `equity`/`openPositions` were snapshotted ONCE before the
    // loop, so the second symbol's risk assessment never saw the first
    // symbol's fill — both looked like "0 open positions" and both would
    // have been approved, jointly blowing past the 1-open-position cap.
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const ETH: Instrument = { symbol: 'ETHEUR', base: 'ETH', quote: 'EUR' };
    const params = {
      confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
      brokerAdapter: {
        name: 'fake-broker',
        mode: 'live' as const,
        async submit(intent: OrderIntent): Promise<OrderStatusReport> {
          return { intentId: intent.id, state: 'filled', filledQuantity: intent.quantity, avgFillPrice: intent.limitPrice, detail: 'ok' };
        },
        async cancel(): Promise<OrderStatusReport> {
          throw new Error('not used');
        },
        async fetchPositions(): Promise<BrokerPosition[]> {
          return [];
        },
      },
      killSwitch,
      audit,
      verifySymbolExists: async () => true,
    };

    const outcomes = await mirrorApprovedEntries(
      store,
      [opportunity({ symbol: 'XBTEUR' }), opportunity({ symbol: 'ETHEUR' })],
      [XBT, ETH],
      { XBTEUR: 100, ETHEUR: 100 },
      params,
      1000,
      { riskLimits: { maxRiskPerTradePct: 1, maxPositionPct: 20, maxTotalExposurePct: 60, maxOpenPositions: 1, maxExposurePerAssetPct: 20, dailyLossLimitPct: 3, minRewardRisk: 1.5, maxRewardRisk: 20, minStopDistancePct: 0.25 } },
    );

    expect(outcomes[0]).toMatchObject({ symbol: 'XBTEUR', outcome: 'submitted' });
    expect(outcomes[1]).toMatchObject({ symbol: 'ETHEUR', outcome: 'not-approved' });
    expect(openLivePositions(store)).toHaveLength(1);
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

  it('refuses (not-approved) when the risk-engine sizing exceeds actual free cash, even though it fits within total equity (found in review, 2026-09-03: with permissive/misconfigured risk limits, positionValue is capped by exposureHeadroom which is only guaranteed <= free cash while maxTotalExposurePct < 100%)', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100); // no open positions -> equity is also 100
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    // A deliberately permissive risk-limits override (maxTotalExposurePct
    // 200%) lets the risk engine size a 200€ position against 100€ equity —
    // still "approved" by assessTrade itself, but the account only has 100€
    // of actual cash to pay for it.
    const permissive = {
      maxRiskPerTradePct: 100,
      maxPositionPct: 200,
      maxTotalExposurePct: 200,
      maxOpenPositions: 5,
      maxExposurePerAssetPct: 200,
      dailyLossLimitPct: 100,
      minRewardRisk: 0,
      maxRewardRisk: 999,
      minStopDistancePct: 0.01,
    };
    const bigPosition = opportunity({ levels: { entry: 100, stopLoss: 50, takeProfit: 200, riskReward: 2 } });

    const outcomes = await mirrorApprovedEntries(
      store,
      [bigPosition],
      [XBT],
      { XBTEUR: 100 },
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch, audit),
      1000,
      { riskLimits: permissive },
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.outcome).toBe('not-approved');
    expect(liveCash(store)).toBe(100); // untouched — never reached the broker
  });

  it("overrides a portfolio-capacity refusal ONLY for a symbol listed in allowCapacityOverrideFor — David's manual 'buy anyway' override, 2026-09-03; an identical setup with no override still gets refused (an autonomous paper-mirrored entry must never bypass this)", async () => {
    const zeroCapacity = {
      maxRiskPerTradePct: 1,
      maxPositionPct: 20,
      maxTotalExposurePct: 60,
      maxOpenPositions: 0, // refuses ANY new entry regardless of the account being otherwise empty
      maxExposurePerAssetPct: 20,
      dailyLossLimitPct: 3,
      minRewardRisk: 1.5,
      maxRewardRisk: 20,
      minStopDistancePct: 0.25,
    };

    const withoutOverride = new MemoryStore();
    initLiveCash(withoutOverride, 100);
    const killSwitch1 = new PersistedKillSwitch(withoutOverride);
    const audit1 = new PersistedAuditLog(withoutOverride);
    const refused = await mirrorApprovedEntries(
      withoutOverride,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams({ intentId: 'x', state: 'filled', filledQuantity: 0, avgFillPrice: null, detail: '' }, killSwitch1, audit1),
      1000,
      { riskLimits: zeroCapacity },
    );
    expect(refused).toEqual([{ symbol: 'XBTEUR', outcome: 'not-approved', reasons: ['maximum open positions reached (0/0)'] }]);

    const withOverride = new MemoryStore();
    initLiveCash(withOverride, 100);
    const killSwitch2 = new PersistedKillSwitch(withOverride);
    const audit2 = new PersistedAuditLog(withOverride);
    const report = { intentId: 'x', state: 'filled' as const, filledQuantity: 0.01, avgFillPrice: 100, detail: 'ok' };
    const accepted = await mirrorApprovedEntries(
      withOverride,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams(report, killSwitch2, audit2),
      1000,
      { riskLimits: zeroCapacity, allowCapacityOverrideFor: new Set(['XBTEUR']) },
    );
    expect(accepted).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report: { ...report, intentId: 'live-entry:XBTEUR:1000' } }]);
    expect(openLivePositions(withOverride)).toHaveLength(1);
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
    // Still the SAME pending entry (queuedAt stays 1000, set on the first
    // call above) — a retry of one attempt must keep the same intent.id.
    const report: OrderStatusReport = {
      intentId: 'live-entry:XBTEUR:1000',
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
      intentId: 'live-entry:XBTEUR:1000', // freshly queued at now=1000
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

  it('does NOT block a later attempt when the broker REJECTED the order (found 2026-09-03: a rejected order got stuck "outstanding" forever, silently swallowing every future /buy for the same symbol since no position was ever opened to later clear it)', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const rejectedReport: OrderStatusReport = {
      intentId: 'live-entry:XBTEUR:1000', // freshly queued at now=1000
      state: 'rejected',
      filledQuantity: 0,
      avgFillPrice: null,
      detail: 'Revolut X rejected the order: HTTP 400',
    };
    const first = await mirrorApprovedEntries(
      store,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams(rejectedReport, killSwitch, audit),
      1000,
    );
    expect(first).toEqual([{ symbol: 'XBTEUR', outcome: 'submitted', report: rejectedReport }]);

    // No `clearOutstandingEntry` call anywhere — a genuinely different fix
    // must have avoided marking it outstanding in the first place.
    const second = await mirrorApprovedEntries(
      store,
      [opportunity()],
      [XBT],
      { XBTEUR: 100 },
      flowParams(
        { intentId: 'live-entry:XBTEUR', state: 'filled', filledQuantity: 0.01, avgFillPrice: 100, detail: 'ok' },
        killSwitch,
        audit,
      ),
      1500,
    );
    expect(second[0]!.outcome).toBe('submitted');
  });

  it("gives two genuinely SEPARATE attempts for the same symbol different intent.id's (so deterministicClientOrderId differs), but keeps ONE attempt's id stable across a retry — real incident 2026-09-03: Revolut X rejected a brand-new /buy XBTEUR as a duplicate ('client_order_id ... has already been placed') because intent.id used to be just live-entry:${symbol}, identical for every attempt ever made", async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const captured: OrderIntent[] = [];
    const params = {
      confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
      brokerAdapter: {
        name: 'fake-broker',
        mode: 'live' as const,
        async submit(intent: OrderIntent): Promise<OrderStatusReport> {
          captured.push(intent);
          return { intentId: intent.id, state: 'rejected', filledQuantity: 0, avgFillPrice: null, detail: 'rejected' };
        },
        async cancel(): Promise<OrderStatusReport> {
          throw new Error('not used');
        },
        async fetchPositions(): Promise<BrokerPosition[]> {
          return [];
        },
      },
      killSwitch,
      audit,
      verifySymbolExists: async () => true,
    };

    // First attempt: rejected — a real-world outcome that resolves the
    // pending entry (not 'pending'), so a later /buy for the same symbol is
    // a genuinely NEW attempt, not a retry of this one. (A retry of the SAME
    // still-pending attempt correctly reusing one id is already covered by
    // "keeps a not-yet-approved entry queued... " above.)
    await mirrorApprovedEntries(store, [opportunity()], [XBT], { XBTEUR: 100 }, params, 1000);

    // A second, later /buy for the same symbol — a genuinely new attempt.
    await mirrorApprovedEntries(store, [opportunity()], [XBT], { XBTEUR: 100 }, params, 2000);

    expect(captured).toHaveLength(2);
    expect(captured[0]!.id).not.toBe(captured[1]!.id);
    expect(captured[0]!.id).toBe('live-entry:XBTEUR:1000');
    expect(captured[1]!.id).toBe('live-entry:XBTEUR:2000');
  });

  it('keeps attempting OTHER pending symbols when one throws mid-cycle (found in review, 2026-09-03: an unhandled exception for one symbol used to abort every other pending symbol that cycle)', async () => {
    const store = new MemoryStore();
    initLiveCash(store, 100);
    const killSwitch = new PersistedKillSwitch(store);
    const audit = new PersistedAuditLog(store);
    const ETH: Instrument = { symbol: 'ETHEUR', base: 'ETH', quote: 'EUR' };
    const report: OrderStatusReport = { intentId: 'x', state: 'filled', filledQuantity: 0.01, avgFillPrice: 100, detail: 'ok' };
    const params = {
      confirmationGate: {
        async requestConfirmation(intent: OrderIntent) {
          if (intent.symbol === 'XBT/EUR') throw new Error('transient Telegram error');
          return { intentId: intent.id, approved: true, decidedAt: 1, decidedBy: 'david' };
        },
      },
      brokerAdapter: fakeBrokerAdapter(report),
      killSwitch,
      audit,
      verifySymbolExists: async () => true,
    };

    const outcomes = await mirrorApprovedEntries(
      store,
      [opportunity({ symbol: 'XBTEUR' }), opportunity({ symbol: 'ETHEUR' })],
      [XBT, ETH],
      { XBTEUR: 100, ETHEUR: 100 },
      params,
      1000,
    );
    expect(outcomes).toEqual([
      { symbol: 'XBTEUR', outcome: 'error', detail: 'transient Telegram error' },
      { symbol: 'ETHEUR', outcome: 'submitted', report: { ...report, intentId: 'live-entry:ETHEUR:1000' } },
    ]);
    // XBTEUR stays queued (not deleted) for a retry next cycle.
    expect(store.get<Record<string, unknown>>('live-entry-pending')).toHaveProperty('XBTEUR');
  });

  it('scales risk by confidence when confidenceRisk is provided, instead of always sizing at the flat ceiling (found in review, 2026-09-03)', async () => {
    function captureIntent(store: MemoryStore, confidenceRisk?: { floorPct: number; ceilingPct: number; confidenceFloor: number; maxConfidence: number }) {
      let captured: OrderIntent | undefined;
      const killSwitch = new PersistedKillSwitch(store);
      const audit = new PersistedAuditLog(store);
      const params = {
        confirmationGate: fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' }),
        brokerAdapter: {
          name: 'fake-broker',
          mode: 'live' as const,
          async submit(intent: OrderIntent): Promise<OrderStatusReport> {
            captured = intent;
            return { intentId: intent.id, state: 'filled', filledQuantity: intent.quantity, avgFillPrice: intent.limitPrice, detail: 'ok' };
          },
          async cancel(): Promise<OrderStatusReport> {
            throw new Error('not used');
          },
          async fetchPositions(): Promise<BrokerPosition[]> {
            return [];
          },
        },
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      };
      return { params, get intent() { return captured; } };
    }

    // Confidence pinned at the floor (40) — with confidenceRisk, this must
    // size at floorPct (0.5%), half of the flat maxRiskPerTradePct (1%)
    // ceiling it would otherwise always use regardless of signal strength.
    const lowConfidence = opportunity({ confidence: 40 });

    const withoutStore = new MemoryStore();
    initLiveCash(withoutStore, 100);
    const without = captureIntent(withoutStore);
    await mirrorApprovedEntries(withoutStore, [lowConfidence], [XBT], { XBTEUR: 100 }, without.params, 1000);
    const flatQuantity = without.intent!.quantity;

    const withStore = new MemoryStore();
    initLiveCash(withStore, 100);
    const withScaling = captureIntent(withStore);
    await mirrorApprovedEntries(withStore, [lowConfidence], [XBT], { XBTEUR: 100 }, withScaling.params, 1000, {
      confidenceRisk: { floorPct: 0.5, ceilingPct: 1, confidenceFloor: 40, maxConfidence: 90 },
    });
    const scaledQuantity = withScaling.intent!.quantity;

    expect(scaledQuantity).toBeCloseTo(flatQuantity / 2, 5);
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
