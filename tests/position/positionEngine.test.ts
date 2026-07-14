/**
 * Position Engine tests (TDD): lifecycle (open → partial exits → close),
 * MFE/MAE tracking, fees, and journal entries on completion. The engine
 * consumes existing trade proposals (TradeRiskAssessment) — it generates
 * no trading logic of its own.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PositionEngine } from '../../src/core/position/positionEngine';
import { TradeJournal } from '../../src/core/position/tradeJournal';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';

const T = 1_700_000_000_000;
const HOUR = 3_600_000;

function makeEngine() {
  const store = new MemoryStore();
  const journal = new TradeJournal(store);
  const engine = new PositionEngine(store, journal);
  return { engine, journal, store };
}

function approvedAssessment(overrides: Partial<TradeRiskAssessment> = {}): TradeRiskAssessment {
  return {
    approved: true,
    asset: 'BTC-USD',
    entry: 100,
    stopLoss: 95,
    takeProfit: 110,
    positionSize: 10,
    positionValue: 1000,
    riskAmount: 50,
    riskPercentage: 0.5,
    rewardRiskRatio: 2,
    portfolioExposure: 10,
    reasons: ['test'],
    warnings: [],
    ...overrides,
  };
}

describe('opening positions', () => {
  it('opens from an approved trade proposal with full traceability', () => {
    const { engine } = makeEngine();
    const result = engine.openFromAssessment(approvedAssessment(), {
      timestamp: T,
      fee: 1,
      confidence: 55,
      validationVerdict: 'caution',
      strategyVersion: 'trend-v1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const position = result.value;
    expect(position.symbol).toBe('BTC-USD');
    expect(position.quantity).toBe(10);
    expect(position.entryPrice).toBe(100);
    expect(position.stopLoss).toBe(95);
    expect(position.takeProfit).toBe(110);
    expect(position.feesPaid).toBe(1);
    expect(position.confidence).toBe(55);
    expect(engine.openPositions()).toHaveLength(1);
  });

  it('refuses to open from a rejected assessment', () => {
    const { engine } = makeEngine();
    const rejected = approvedAssessment({ approved: false, positionSize: 0 });
    const result = engine.openFromAssessment(rejected, { timestamp: T });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('approved');
    expect(engine.openPositions()).toHaveLength(0);
  });

  it('validates direct open inputs', () => {
    const { engine } = makeEngine();
    const base = {
      symbol: 'BTC-USD', quantity: 1, entryPrice: 100, stopLoss: 95, takeProfit: 110, timestamp: T,
    };
    expect(engine.open({ ...base, quantity: 0 }).ok).toBe(false);
    expect(engine.open({ ...base, entryPrice: -1 }).ok).toBe(false);
    expect(engine.open({ ...base, symbol: '' }).ok).toBe(false);
  });
});

describe('exits and lifecycle', () => {
  it('partial exit reduces quantity and realizes proportional P&L', () => {
    const { engine } = makeEngine();
    const opened = engine.openFromAssessment(approvedAssessment(), { timestamp: T });
    if (!opened.ok) throw new Error('open failed');
    const id = opened.value.id;

    const exit = engine.exit(id, { quantity: 4, price: 105, timestamp: T + HOUR, reason: 'manual', fee: 0.5 });
    expect(exit.ok).toBe(true);
    const position = engine.openPositions()[0]!;
    expect(position.quantity).toBeCloseTo(6, 10);
    expect(position.realizedPnl).toBeCloseTo(4 * 5 - 0.5, 10);
    expect(position.feesPaid).toBeCloseTo(0.5, 10); // no open fee in this case
  });

  it('full exit closes the position and writes one journal entry with every field', () => {
    const { engine, journal } = makeEngine();
    const opened = engine.openFromAssessment(approvedAssessment(), {
      timestamp: T,
      fee: 1,
      confidence: 60,
      validationVerdict: 'robust',
      strategyVersion: 'trend-v1',
      notes: 'demo trade',
    });
    if (!opened.ok) throw new Error('open failed');
    const id = opened.value.id;

    // Price excursions before exit: up to 112, down to 97.
    engine.updateMarketPrice('BTC-USD', 112, T + HOUR);
    engine.updateMarketPrice('BTC-USD', 97, T + 2 * HOUR);
    engine.exit(id, { quantity: 4, price: 108, timestamp: T + 3 * HOUR, reason: 'take-profit', fee: 0.4 });
    const final = engine.exit(id, { quantity: 6, price: 102, timestamp: T + 5 * HOUR, reason: 'manual', fee: 0.6 });
    expect(final.ok).toBe(true);
    expect(engine.openPositions()).toHaveLength(0);

    const entries = journal.entries();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.symbol).toBe('BTC-USD');
    expect(entry.entryTimestamp).toBe(T);
    expect(entry.exitTimestamp).toBe(T + 5 * HOUR);
    expect(entry.entryPrice).toBe(100);
    // Weighted average exit: (4*108 + 6*102) / 10 = 104.4
    expect(entry.exitPrice).toBeCloseTo(104.4, 10);
    expect(entry.positionSize).toBe(10);
    expect(entry.stopLoss).toBe(95);
    expect(entry.takeProfit).toBe(110);
    expect(entry.exitReason).toBe('manual'); // reason of the final exit
    expect(entry.fees).toBeCloseTo(1 + 0.4 + 0.6, 10);
    expect(entry.holdingDurationMs).toBe(5 * HOUR);
    // MFE: (112-100)/100 = 12%; MAE: (100-97)/100 = 3%.
    expect(entry.mfePct).toBeCloseTo(12, 10);
    expect(entry.maePct).toBeCloseTo(3, 10);
    // Realized: 4*8 + 6*2 = 44, minus exit fees 1.0 = 43 (open fee reported in fees).
    expect(entry.realizedPnl).toBeCloseTo(43, 10);
    expect(entry.returnPct).toBeCloseTo((43 / 1000) * 100, 8);
    expect(entry.strategyVersion).toBe('trend-v1');
    expect(entry.validationVerdict).toBe('robust');
    expect(entry.confidence).toBe(60);
    expect(entry.notes).toBe('demo trade');
  });

  it('rejects overselling and unknown positions', () => {
    const { engine } = makeEngine();
    const opened = engine.open({
      symbol: 'ETH-USD', quantity: 2, entryPrice: 100, stopLoss: 90, takeProfit: 120, timestamp: T,
    });
    if (!opened.ok) throw new Error('open failed');
    expect(engine.exit(opened.value.id, { quantity: 3, price: 100, timestamp: T, reason: 'manual' }).ok).toBe(false);
    expect(engine.exit('nope', { quantity: 1, price: 100, timestamp: T, reason: 'manual' }).ok).toBe(false);
  });

  it('tracks MFE/MAE from both price updates and exit prices', () => {
    const { engine, journal } = makeEngine();
    const opened = engine.open({
      symbol: 'ETH-USD', quantity: 1, entryPrice: 100, stopLoss: 90, takeProfit: 130, timestamp: T,
    });
    if (!opened.ok) throw new Error('open failed');
    // No updateMarketPrice calls: the exit at 120 is itself the best price seen.
    engine.exit(opened.value.id, { quantity: 1, price: 120, timestamp: T + HOUR, reason: 'take-profit' });
    const entry = journal.entries()[0]!;
    expect(entry.mfePct).toBeCloseTo(20, 10);
    expect(entry.maePct).toBeCloseTo(0, 10);
  });

  it('persists open positions across instances', () => {
    const { engine, store } = makeEngine();
    engine.open({
      symbol: 'BTC-USD', quantity: 1, entryPrice: 100, stopLoss: 95, takeProfit: 110, timestamp: T,
    });
    const restored = new PositionEngine(store, new TradeJournal(store));
    expect(restored.openPositions()).toHaveLength(1);
    expect(restored.openPositions()[0]!.symbol).toBe('BTC-USD');
  });

  it('computes unrealized P&L from current prices', () => {
    const { engine } = makeEngine();
    engine.open({
      symbol: 'BTC-USD', quantity: 2, entryPrice: 100, stopLoss: 95, takeProfit: 110, timestamp: T,
    });
    expect(engine.unrealizedPnl({ 'BTC-USD': 107 })).toBeCloseTo(14, 10);
    // Unknown price: valued at entry, no phantom P&L.
    expect(engine.unrealizedPnl({})).toBeCloseTo(0, 10);
  });
});
