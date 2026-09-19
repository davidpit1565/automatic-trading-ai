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
import { runLiveOrderFlow } from '../../server/liveOrchestrator.mts';
import {
  buildLiveExitIntent,
  buildLiveJournalEntry,
  decideLiveExit,
  forgetLivePosition,
  openLivePositions,
  recordLiveEntryFill,
  reduceLivePositionQuantity,
  updateLiveHighestPrice,
  updateLiveLowestPrice,
} from '../../server/liveExitFlow.mts';

function approvedAssessment(overrides: Partial<TradeRiskAssessment> = {}): TradeRiskAssessment {
  return {
    approved: true,
    asset: 'BTCEUR',
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
    ...overrides,
  };
}

function buyIntent(overrides: Partial<OrderIntent> = {}): OrderIntent {
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
    ...overrides,
  };
}

function filledReport(overrides: Partial<OrderStatusReport> = {}): OrderStatusReport {
  return { intentId: 'entry-1', state: 'filled', filledQuantity: 2, avgFillPrice: 101, detail: 'ok', ...overrides };
}

describe('recordLiveEntryFill', () => {
  it('persists a tracked position from a filled buy, using the real fill price/quantity', () => {
    const store = new MemoryStore();
    const recorded = recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);

    expect(recorded).toBe(true);
    expect(openLivePositions(store)).toEqual([
      {
        id: 'entry-1',
        symbol: 'BTC-EUR',
        quantity: 2,
        initialQuantity: 2,
        entryPrice: 101,
        stopLoss: 90,
        takeProfit: 120,
        highestPrice: 101,
        lowestPrice: 101,
        // |real fill (101) − signal price (100)| × quantity (2).
        entrySlippage: 2,
        openedAt: 5000,
        // .entry overridden to the REAL fill price (101), not the originally
        // proposed one (100) — see the slippage test below for why.
        entryAssessment: { ...buyIntent().assessment, entry: 101 },
      },
    ]);
  });

  it('overrides the tracked entry price to the REAL fill price, not the originally proposed one (slippage)', () => {
    const store = new MemoryStore();
    // Proposed at 100 (buyIntent's limitPrice/assessment.entry), actually filled at 103.
    recordLiveEntryFill(store, buyIntent(), filledReport({ avgFillPrice: 103 }), 5000);

    const position = openLivePositions(store)[0]!;
    expect(position.entryPrice).toBe(103);
    expect(position.entryAssessment.entry).toBe(103);
  });

  it('does not track anything for a sell intent', () => {
    const store = new MemoryStore();
    const recorded = recordLiveEntryFill(store, buyIntent({ side: 'sell' }), filledReport(), 5000);

    expect(recorded).toBe(false);
    expect(openLivePositions(store)).toEqual([]);
  });

  it('does not track anything for a buy that has not filled at all yet', () => {
    const store = new MemoryStore();
    const recorded = recordLiveEntryFill(
      store,
      buyIntent(),
      filledReport({ state: 'submitted', filledQuantity: 0 }),
      5000,
    );

    expect(recorded).toBe(false);
    expect(openLivePositions(store)).toEqual([]);
  });

  it('tracks a PARTIAL fill (state submitted, but a nonzero filledQuantity) — real exposure must not go untracked', () => {
    const store = new MemoryStore();
    const recorded = recordLiveEntryFill(
      store,
      buyIntent(),
      filledReport({ state: 'submitted', filledQuantity: 0.8, avgFillPrice: 100 }),
      5000,
    );

    expect(recorded).toBe(true);
    const position = openLivePositions(store)[0]!;
    // Tracks only the quantity that ACTUALLY filled, not the originally
    // requested quantity (buyIntent() asked for 2).
    expect(position.quantity).toBe(0.8);
  });

  it('never trusts a report for a DIFFERENT intent than the one passed', () => {
    const store = new MemoryStore();
    const recorded = recordLiveEntryFill(store, buyIntent(), filledReport({ intentId: 'some-other-order' }), 5000);

    expect(recorded).toBe(false);
    expect(openLivePositions(store)).toEqual([]);
  });

  it('falls back to the limit price when the report has no avgFillPrice', () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent(), filledReport({ avgFillPrice: null }), 5000);

    expect(openLivePositions(store)[0]).toMatchObject({ entryPrice: 100, highestPrice: 100 });
  });
});

describe('updateLiveHighestPrice', () => {
  it('ratchets the highest price up but never down', () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);

    updateLiveHighestPrice(store, 'entry-1', 110);
    expect(openLivePositions(store)[0]!.highestPrice).toBe(110);

    updateLiveHighestPrice(store, 'entry-1', 105);
    expect(openLivePositions(store)[0]!.highestPrice).toBe(110);
  });

  it('no-ops for an untracked position id', () => {
    const store = new MemoryStore();
    expect(() => updateLiveHighestPrice(store, 'unknown', 200)).not.toThrow();
    expect(openLivePositions(store)).toEqual([]);
  });
});

describe('updateLiveLowestPrice', () => {
  it('ratchets the lowest price down but never up', () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);

    updateLiveLowestPrice(store, 'entry-1', 90);
    expect(openLivePositions(store)[0]!.lowestPrice).toBe(90);

    updateLiveLowestPrice(store, 'entry-1', 95);
    expect(openLivePositions(store)[0]!.lowestPrice).toBe(90);
  });

  it('no-ops for an untracked position id', () => {
    const store = new MemoryStore();
    expect(() => updateLiveLowestPrice(store, 'unknown', 1)).not.toThrow();
    expect(openLivePositions(store)).toEqual([]);
  });
});

describe('buildLiveJournalEntry', () => {
  const COST_RATE = 0.003;

  function closedPosition() {
    const store = new MemoryStore();
    // Filled at 101 against a 100 signal price — real €2 entry slippage.
    recordLiveEntryFill(store, buyIntent(), filledReport({ avgFillPrice: 101 }), 5000);
    updateLiveHighestPrice(store, 'entry-1', 112);
    updateLiveLowestPrice(store, 'entry-1', 98);
    return openLivePositions(store)[0]!;
  }

  it('builds a structured entry from real fill data — fees estimated, slippage measured', () => {
    const position = closedPosition();
    // Exits at 110 against a 108 signal price — real €4 exit slippage (2 units).
    const entry = buildLiveJournalEntry(position, 110, 108, 'take-profit', COST_RATE, 20_000);

    expect(entry).not.toBeNull();
    expect(entry!.id).toBe('entry-1');
    expect(entry!.entryPrice).toBe(101);
    expect(entry!.exitPrice).toBe(110);
    expect(entry!.positionSize).toBe(2);
    expect(entry!.exitReason).toBe('take-profit');
    expect(entry!.holdingDurationMs).toBe(15_000);
    // MFE from the ratcheted highest (112) vs entry (101); MAE from the
    // ratcheted lowest (98) vs entry (101).
    expect(entry!.mfePct).toBeCloseTo(((112 - 101) / 101) * 100);
    expect(entry!.maePct).toBeCloseTo(((101 - 98) / 101) * 100);
    // slippage = entrySlippage (2) + exit slippage (|110-108|*2=4).
    expect(entry!.slippage).toBe(6);
    // fees = (101*2 + 110*2) * 0.003.
    expect(entry!.fees).toBeCloseTo((101 * 2 + 110 * 2) * COST_RATE);
    const expectedPnl = 110 * 2 - 101 * 2 - entry!.fees;
    expect(entry!.realizedPnl).toBeCloseTo(expectedPnl);
    expect(entry!.confidence).toBeNull();
    expect(entry!.strategyVersion).toBeNull();
  });

  it('returns null instead of fabricating a number when a partial exit already touched this position', () => {
    const position = closedPosition();
    const partiallyReduced = { ...position, quantity: position.initialQuantity - 0.5 };

    expect(buildLiveJournalEntry(partiallyReduced, 110, 108, 'take-profit', COST_RATE, 20_000)).toBeNull();
  });

  it('reports zero slippage when the exit signal price equals the exit price (e.g. a manual sale with no real signal)', () => {
    const position = closedPosition();
    const entry = buildLiveJournalEntry(position, 105, 105, 'manual', COST_RATE, 20_000);

    // Only the ENTRY leg's real slippage remains — this exit measured none.
    expect(entry!.slippage).toBe(position.entrySlippage);
  });
});

describe('forgetLivePosition', () => {
  it('removes a tracked position', () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);

    forgetLivePosition(store, 'entry-1');

    expect(openLivePositions(store)).toEqual([]);
  });

  it('no-ops for an untracked position id', () => {
    const store = new MemoryStore();
    expect(() => forgetLivePosition(store, 'unknown')).not.toThrow();
  });
});

describe('reduceLivePositionQuantity', () => {
  it('shrinks the tracked quantity by the sold amount, keeping the remainder tracked', () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent({ quantity: 2 }), filledReport({ filledQuantity: 2 }), 5000);

    const applied = reduceLivePositionQuantity(store, 'entry-1', 0.8);

    expect(applied).toBe(true);
    const positions = openLivePositions(store);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.quantity).toBeCloseTo(1.2, 10);
  });

  it('no-ops (and returns false) for an untracked position id', () => {
    const store = new MemoryStore();
    expect(reduceLivePositionQuantity(store, 'unknown', 1)).toBe(false);
  });

  it('no-ops for a non-positive soldQuantity', () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent({ quantity: 2 }), filledReport({ filledQuantity: 2 }), 5000);
    expect(reduceLivePositionQuantity(store, 'entry-1', 0)).toBe(false);
    expect(reduceLivePositionQuantity(store, 'entry-1', -1)).toBe(false);
    expect(openLivePositions(store)[0]!.quantity).toBe(2);
  });

  it('refuses a soldQuantity at or above the tracked quantity — that is a full fill, not a partial one', () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent({ quantity: 2 }), filledReport({ filledQuantity: 2 }), 5000);
    expect(reduceLivePositionQuantity(store, 'entry-1', 2)).toBe(false);
    expect(reduceLivePositionQuantity(store, 'entry-1', 3)).toBe(false);
    expect(openLivePositions(store)[0]!.quantity).toBe(2);
  });
});

describe('buildLiveExitIntent', () => {
  it('builds a sell OrderIntent reusing the position entry assessment for traceability, not a fresh one', () => {
    const store = new MemoryStore();
    recordLiveEntryFill(store, buyIntent(), filledReport(), 5000);
    const position = openLivePositions(store)[0]!;

    const intent = buildLiveExitIntent('entry-1:exit', position, 115, 9000);

    expect(intent).toEqual({
      id: 'entry-1:exit',
      createdAt: 9000,
      mode: 'live',
      symbol: 'BTC-EUR',
      side: 'sell',
      quantity: 2,
      limitPrice: 115,
      stopLoss: 90,
      takeProfit: 120,
      assessment: position.entryAssessment,
    });
  });
});

describe('full live entry -> exit lifecycle', () => {
  function fakeConfirmationGate(outcome: ConfirmationDecision): ConfirmationGate {
    return { async requestConfirmation() { return outcome; } };
  }

  function fakeBrokerAdapter(report: OrderStatusReport): BrokerAdapter {
    return {
      name: 'fake-broker',
      mode: 'live',
      async submit() { return report; },
      async cancel(): Promise<OrderStatusReport> { throw new Error('not used'); },
      async fetchPositions(): Promise<BrokerPosition[]> { return []; },
    };
  }

  it('records an entry fill, decides an exit is due, submits the sell through the same safety chain, and forgets the position once filled', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);

    // 1. Entry fills — tracked locally, since the broker itself won't remember our stop/target.
    const entryReport = filledReport({ avgFillPrice: 100 });
    recordLiveEntryFill(store, buyIntent(), entryReport, 5000);
    const position = openLivePositions(store)[0]!;
    expect(position.stopLoss).toBe(90);

    // 2. Price drops to the stop -> decideLiveExit says stop-loss.
    expect(decideLiveExit(position, 90, [100, 95, 90], {})).toBe('stop-loss');

    // 3. Exit intent goes through the EXACT same runLiveOrderFlow as any entry.
    const exitIntent = buildLiveExitIntent('entry-1:exit', position, 90, 9000);
    const exitReport = filledReport({ intentId: 'entry-1:exit', avgFillPrice: 90 });
    const result = await runLiveOrderFlow({
      intent: exitIntent,
      confirmationGate: fakeConfirmationGate({ intentId: 'entry-1:exit', approved: true, decidedAt: 1, decidedBy: 'david' }),
      brokerAdapter: fakeBrokerAdapter(exitReport),
      killSwitch,
      audit,
      verifySymbolExists: async () => true,
    });
    expect(result).toEqual({ outcome: 'submitted', report: exitReport });

    // 4. Once genuinely filled, the position is no longer tracked.
    forgetLivePosition(store, position.id);
    expect(openLivePositions(store)).toEqual([]);
  });
});
