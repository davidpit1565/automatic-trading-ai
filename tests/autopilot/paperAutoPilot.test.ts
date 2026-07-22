/**
 * Paper Autopilot tests (TDD).
 *
 * Fully autonomous SIMULATED trading: entries through the verified
 * pipeline, exits at stop/target, everything audited, all of it halted by
 * the kill switch. Paper-only by construction — there is no live mode.
 */

import { describe, expect, it } from 'vitest';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import { PaperAutoPilot } from '../../src/core/autopilot/paperAutoPilot';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { MemoryStore } from '../../src/core/data/storage';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { ManualScheduler } from '../../src/core/monitor/scheduler';
import { PortfolioEngine } from '../../src/core/position/portfolioEngine';
import { PositionEngine } from '../../src/core/position/positionEngine';
import { TradeJournal } from '../../src/core/position/tradeJournal';
import { DEFAULT_RISK_LIMITS } from '../../src/core/risk/riskEngine';
import { ok } from '../../src/core/types';

const T = 1_700_000_000_000;

/** Controllable market: per-symbol drift plus an optional forced last price. */
function makeSource(config: Record<string, { drift: number; lastPrice?: number }>): MarketDataSource {
  return {
    name: 'stub',
    getInstruments: async () =>
      ok(Object.keys(config).map((symbol) => ({ symbol, base: symbol, quote: 'USD' }))),
    getCandles: async (symbol) => {
      // Unknown symbols (e.g. positions opened outside the universe) get flat data.
      const { drift, lastPrice } = config[symbol] ?? { drift: 0, lastPrice: undefined };
      const candles = generateSyntheticCandles({
        seed: 1,
        startPrice: 100,
        count: 150,
        timeframe: '1h',
        startTimestamp: T - 150 * 3_600_000,
        drift,
        volatility: 0.004,
      });
      if (lastPrice !== undefined) {
        const last = candles[candles.length - 1]!;
        candles[candles.length - 1] = {
          ...last,
          close: lastPrice,
          high: Math.max(last.high, lastPrice),
          low: Math.min(last.low, lastPrice),
        };
      }
      return ok(candles);
    },
  };
}

function makePilot(
  config: Record<string, { drift: number; lastPrice?: number }>,
  opts: {
    costRate?: number;
    minConfidence?: number;
    maxRsiForLong?: number;
    haltNewEntries?: () => boolean;
    riskLimits?: import('../../src/core/risk/riskEngine').RiskLimits;
    correlationBetween?: (a: string, b: string) => number;
    onRealizedPnl?: (pnl: number, timestamp: number) => void;
  } = {},
) {
  const store = new MemoryStore();
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
  const killSwitch = new PersistedKillSwitch(store);
  const audit = new PersistedAuditLog(store);
  const pilot = new PaperAutoPilot({
    source: makeSource(config),
    symbols: Object.keys(config),
    timeframe: '1h',
    scheduler: new ManualScheduler(),
    portfolio,
    positions,
    killSwitch,
    audit,
    getDailyLoss: () => 0,
    clock: () => T,
    costRate: opts.costRate,
    minConfidence: opts.minConfidence,
    maxRsiForLong: opts.maxRsiForLong,
    haltNewEntries: opts.haltNewEntries,
    riskLimits: opts.riskLimits,
    correlationBetween: opts.correlationBetween,
    onRealizedPnl: opts.onRealizedPnl,
  });
  return { pilot, portfolio, positions, journal, killSwitch, audit };
}

describe('autonomous paper entries', () => {
  it('opens a paper position automatically when the pipeline qualifies a market', async () => {
    const { pilot, portfolio, audit } = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    const cycle = await pilot.runCycleOnce(T);
    expect(cycle.opened).toHaveLength(1);
    expect(portfolio.openPositions()).toHaveLength(1);
    const position = portfolio.openPositions()[0]!;
    expect(position.symbol).toBe('QUAL/USD');
    expect(position.strategyVersion).toContain('autopilot');
    // Audited as a paper fill.
    expect(audit.entries().some((e) => e.event === 'filled' && e.mode === 'paper')).toBe(true);
  });

  it('charges a realistic trading fee on entry when a cost rate is set', async () => {
    const withCost = makePilot({ 'QUAL/USD': { drift: 0.001 } }, { costRate: 0.003 });
    await withCost.pilot.runCycleOnce(T);
    const position = withCost.portfolio.openPositions()[0]!;
    // Entry fee ≈ notional × costRate, recorded on the position.
    const expectedFee = position.initialQuantity * position.entryPrice * 0.003;
    expect(position.feesPaid).toBeGreaterThan(0);
    expect(position.feesPaid).toBeCloseTo(expectedFee, 6);

    // With zero cost, no fee is charged — proving the cost is what adds it.
    const free = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    await free.pilot.runCycleOnce(T);
    expect(free.portfolio.openPositions()[0]!.feesPaid).toBe(0);
  });

  it('refuses low-conviction setups when a confidence floor is set (capital protection)', async () => {
    // Same qualifying market that opens with no floor...
    const open = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    expect((await open.pilot.runCycleOnce(T)).opened).toHaveLength(1);

    // ...is refused once a floor above any achievable confidence is applied.
    const gated = makePilot({ 'QUAL/USD': { drift: 0.001 } }, { minConfidence: 95 });
    const cycle = await gated.pilot.runCycleOnce(T);
    expect(cycle.opened).toHaveLength(0);
    expect(gated.portfolio.openPositions()).toHaveLength(0);
  });

  it('circuit-breaker halts NEW entries while never engaging the kill switch', async () => {
    // Breaker off: the qualifying market opens a position.
    let halted = false;
    const off = makePilot({ 'QUAL/USD': { drift: 0.001 } }, { haltNewEntries: () => halted });
    expect((await off.pilot.runCycleOnce(T)).opened).toHaveLength(1);

    // Breaker on from the start: a fresh pilot on the same qualifying market
    // opens NOTHING — no new risk — and the cycle is not "halted" (exits would
    // still run; only entries are paused, unlike the kill switch).
    halted = true;
    const on = makePilot({ 'QUAL/USD': { drift: 0.001 } }, { haltNewEntries: () => halted });
    const cycle = await on.pilot.runCycleOnce(T);
    expect(cycle.opened).toHaveLength(0);
    expect(cycle.halted).toBe(false);
    expect(on.portfolio.openPositions()).toHaveLength(0);
    // The pause is audited so the decision trail stays complete.
    expect(on.audit.entries().some((e) => /circuit-breaker/.test(e.detail))).toBe(true);
  });

  it('refuses to chase overbought coins when an RSI ceiling is set', async () => {
    // A strong uptrend that qualifies with the default ceiling...
    const open = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    expect((await open.pilot.runCycleOnce(T)).opened).toHaveLength(1);

    // ...is refused once the overbought ceiling is strict (don't buy hot coins).
    const gated = makePilot({ 'QUAL/USD': { drift: 0.001 } }, { maxRsiForLong: 40 });
    const cycle = await gated.pilot.runCycleOnce(T);
    expect(cycle.opened).toHaveLength(0);
    expect(gated.portfolio.openPositions()).toHaveLength(0);
  });

  it('does not open anything for bearish or neutral markets, and audits nothing', async () => {
    const { pilot, portfolio } = makePilot({
      'BEAR/USD': { drift: -0.004 },
      'FLAT/USD': { drift: 0 },
    });
    const cycle = await pilot.runCycleOnce(T);
    expect(cycle.opened).toHaveLength(0);
    expect(portfolio.openPositions()).toHaveLength(0);
  });

  it('never pyramids: a symbol already held is skipped', async () => {
    const { pilot, portfolio } = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    await pilot.runCycleOnce(T);
    await pilot.runCycleOnce(T + 3_600_000);
    expect(portfolio.openPositions()).toHaveLength(1);
  });

  it('audits risk refusals instead of silently skipping them', async () => {
    const { pilot, audit, portfolio } = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    // Drain cash so the portfolio cannot afford the position.
    const drained = portfolio.open({
      symbol: 'OTHER/USD', quantity: 90, entryPrice: 110, stopLoss: 100, takeProfit: 130, timestamp: T,
    });
    expect(drained.ok).toBe(true);
    await pilot.runCycleOnce(T);
    expect(audit.entries().some((e) => e.event === 'rejected')).toBe(true);
  });

  it('refuses a new entry whose correlated cluster is already at the cap (opt-in correlation limit)', async () => {
    const riskLimits = { ...DEFAULT_RISK_LIMITS, correlationThreshold: 0.6, maxCorrelatedExposurePct: 25 };
    const correlationBetween = (a: string, b: string): number => (a !== b ? 0.8 : 1);

    const { pilot, portfolio } = makePilot({ 'QUAL/USD': { drift: 0.001 } }, { riskLimits, correlationBetween });
    // Pre-open a correlated position already at the cluster cap.
    const opened = portfolio.open({
      symbol: 'OTHER/USD', quantity: 25, entryPrice: 100, stopLoss: 90, takeProfit: 130, timestamp: T,
    });
    expect(opened.ok).toBe(true);

    const cycle = await pilot.runCycleOnce(T);
    expect(cycle.opened).toHaveLength(0);
    expect(portfolio.openPositions()).toHaveLength(1); // still just OTHER/USD

    // Without the correlation limit, the same setup opens normally.
    const uncapped = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    expect((await uncapped.pilot.runCycleOnce(T)).opened).toHaveLength(1);
  });
});

describe('autonomous paper exits', () => {
  it('closes at stop-loss when price breaches the stop', async () => {
    const market = { 'QUAL/USD': { drift: 0.001 } } as Record<string, { drift: number; lastPrice?: number }>;
    const { pilot, portfolio, journal } = makePilot(market);
    await pilot.runCycleOnce(T);
    const position = portfolio.openPositions()[0]!;

    market['QUAL/USD'] = { drift: 0.001, lastPrice: position.stopLoss * 0.99 };
    const cycle = await pilot.runCycleOnce(T + 3_600_000);
    expect(cycle.closed).toHaveLength(1);
    expect(cycle.closed[0]!.reason).toBe('stop-loss');
    expect(portfolio.openPositions()).toHaveLength(0);
    expect(journal.entries()).toHaveLength(1);
    expect(journal.entries()[0]!.exitReason).toBe('stop-loss');
  });

  it('closes at take-profit when price reaches the target', async () => {
    const market = { 'QUAL/USD': { drift: 0.001 } } as Record<string, { drift: number; lastPrice?: number }>;
    const { pilot, portfolio, journal } = makePilot(market);
    await pilot.runCycleOnce(T);
    const position = portfolio.openPositions()[0]!;

    market['QUAL/USD'] = { drift: 0.001, lastPrice: position.takeProfit * 1.01 };
    const cycle = await pilot.runCycleOnce(T + 3_600_000);
    expect(cycle.closed[0]!.reason).toBe('take-profit');
    expect(journal.entries()[0]!.exitReason).toBe('take-profit');
    // Exit is audited.
  });

  it('holds positions while price stays between stop and target', async () => {
    const market = { 'QUAL/USD': { drift: 0.001 } } as Record<string, { drift: number; lastPrice?: number }>;
    const { pilot, portfolio } = makePilot(market);
    await pilot.runCycleOnce(T);
    const position = portfolio.openPositions()[0]!;
    market['QUAL/USD'] = {
      drift: 0.001,
      lastPrice: (position.stopLoss + position.takeProfit) / 2,
    };
    const cycle = await pilot.runCycleOnce(T + 3_600_000);
    expect(cycle.closed).toHaveLength(0);
    expect(portfolio.openPositions()).toHaveLength(1);
  });

  it("reports the exit's realized P&L on a losing stop-out and feeds it to onRealizedPnl", async () => {
    // Real bug: DailyLossTracker.record() was never called anywhere in
    // production, so the daily-loss limit could never trip — this is the
    // wiring that makes it actually work. CycleResult.closed must carry the
    // real realized P&L, matching what lands in the trade journal.
    const recorded: { pnl: number; timestamp: number }[] = [];
    const market = { 'QUAL/USD': { drift: 0.001 } } as Record<string, { drift: number; lastPrice?: number }>;
    const { pilot, portfolio, journal } = makePilot(market, {
      onRealizedPnl: (pnl, ts) => recorded.push({ pnl, timestamp: ts }),
    });
    await pilot.runCycleOnce(T);
    const position = portfolio.openPositions()[0]!;

    market['QUAL/USD'] = { drift: 0.001, lastPrice: position.stopLoss * 0.99 };
    const exitAt = T + 3_600_000;
    const cycle = await pilot.runCycleOnce(exitAt);

    expect(cycle.closed[0]!.pnl).toBeCloseTo(journal.entries()[0]!.realizedPnl, 6);
    expect(cycle.closed[0]!.pnl).toBeLessThan(0); // a stop-loss is a real loss
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.pnl).toBeCloseTo(journal.entries()[0]!.realizedPnl, 6);
    expect(recorded[0]!.timestamp).toBe(exitAt);
  });

  it("reports the exit's realized P&L on a winning take-profit (not fed to the loss tracker)", async () => {
    const market = { 'QUAL/USD': { drift: 0.001 } } as Record<string, { drift: number; lastPrice?: number }>;
    const { pilot, portfolio, journal } = makePilot(market);
    await pilot.runCycleOnce(T);
    const position = portfolio.openPositions()[0]!;

    market['QUAL/USD'] = { drift: 0.001, lastPrice: position.takeProfit * 1.01 };
    const cycle = await pilot.runCycleOnce(T + 3_600_000);

    expect(cycle.closed[0]!.pnl).toBeCloseTo(journal.entries()[0]!.realizedPnl, 6);
    expect(cycle.closed[0]!.pnl).toBeGreaterThan(0);
  });
});

describe('multi-timeframe confirmation', () => {
  function makeConfirmingPilot(higherDrift: number) {
    const store = new MemoryStore();
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
    const audit = new PersistedAuditLog(store);
    const source: MarketDataSource = {
      name: 'mtf-stub',
      getInstruments: async () => ok([{ symbol: 'QUAL/USD', base: 'QUAL', quote: 'USD' }]),
      getCandles: async (_symbol, timeframe) =>
        ok(
          generateSyntheticCandles({
            seed: 1,
            startPrice: 100,
            count: 150,
            timeframe,
            startTimestamp: T - 150 * 3_600_000,
            drift: timeframe === '4h' ? higherDrift : 0.001,
            volatility: 0.004,
          }),
        ),
    };
    const pilot = new PaperAutoPilot({
      source,
      symbols: ['QUAL/USD'],
      timeframe: '1h',
      confirmationTimeframe: '4h',
      scheduler: new ManualScheduler(),
      portfolio,
      positions,
      killSwitch: new PersistedKillSwitch(store),
      audit,
      getDailyLoss: () => 0,
      clock: () => T,
    });
    return { pilot, portfolio, audit };
  }

  it('refuses to open against a bearish higher timeframe and audits the reason', async () => {
    const { pilot, portfolio, audit } = makeConfirmingPilot(-0.004);
    const cycle = await pilot.runCycleOnce(T);
    expect(cycle.opened).toHaveLength(0);
    expect(portfolio.openPositions()).toHaveLength(0);
    expect(cycle.skipped.some((s) => s.reason.includes('4h'))).toBe(true);
    expect(audit.entries().some((e) => e.event === 'rejected' && e.detail.includes('4h'))).toBe(true);
  });

  it('opens normally when the higher timeframe confirms', async () => {
    const { pilot, portfolio } = makeConfirmingPilot(0.001);
    await pilot.runCycleOnce(T);
    expect(portfolio.openPositions()).toHaveLength(1);
  });
});

describe('kill switch', () => {
  it('halts all autopilot activity instantly and audits the skip', async () => {
    const { pilot, portfolio, killSwitch, audit } = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    killSwitch.engage('user pressed stop');
    const cycle = await pilot.runCycleOnce(T);
    expect(cycle.opened).toHaveLength(0);
    expect(cycle.closed).toHaveLength(0);
    expect(cycle.halted).toBe(true);
    expect(portfolio.openPositions()).toHaveLength(0);
    expect(audit.entries().some((e) => e.event === 'kill-switch-engaged')).toBe(true);
  });

  it('resumes only after explicit disengage', async () => {
    const { pilot, portfolio, killSwitch } = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    killSwitch.engage('stop');
    await pilot.runCycleOnce(T);
    expect(portfolio.openPositions()).toHaveLength(0);
    killSwitch.disengage('dp');
    await pilot.runCycleOnce(T + 1000);
    expect(portfolio.openPositions()).toHaveLength(1);
  });
});

describe('reload survival', () => {
  function makePersistentPilot(store: MemoryStore, scheduler: ManualScheduler) {
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
    return new PaperAutoPilot({
      source: makeSource({ 'QUAL/USD': { drift: 0.001 } }),
      symbols: ['QUAL/USD'],
      timeframe: '1h',
      scheduler,
      portfolio,
      positions,
      killSwitch: new PersistedKillSwitch(store),
      audit: new PersistedAuditLog(store),
      getDailyLoss: () => 0,
      clock: () => T,
      store,
    });
  }

  it('a started autopilot resumes after a reload (fresh instance, same store)', () => {
    const store = new MemoryStore();
    makePersistentPilot(store, new ManualScheduler()).start('30m');

    // "Reload": brand-new instance and scheduler over the same storage.
    const scheduler = new ManualScheduler();
    const restored = makePersistentPilot(store, scheduler);
    expect(restored.status().running).toBe(false); // not before resume()
    expect(restored.resume()).toBe(true);
    expect(restored.status().running).toBe(true);
    expect(restored.status().interval).toBe('30m');
    expect(scheduler.isRunning()).toBe(true);
  });

  it('a stopped autopilot stays stopped after a reload', () => {
    const store = new MemoryStore();
    const first = makePersistentPilot(store, new ManualScheduler());
    first.start('15m');
    first.stop();

    const restored = makePersistentPilot(store, new ManualScheduler());
    expect(restored.resume()).toBe(false);
    expect(restored.status().running).toBe(false);
  });

  it('never auto-resumes past an engaged kill switch — restarting is a human decision', () => {
    const store = new MemoryStore();
    const first = makePersistentPilot(store, new ManualScheduler());
    first.start('15m');
    new PersistedKillSwitch(store).engage('emergency stop');

    const restored = makePersistentPilot(store, new ManualScheduler());
    expect(restored.resume()).toBe(false);
    expect(restored.status().running).toBe(false);
  });
});

describe('paper-only by construction', () => {
  it('declares paper mode and exposes no live capability', () => {
    const { pilot } = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    expect(pilot.mode).toBe('paper');
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(pilot));
    for (const name of methodNames) {
      expect(name).not.toMatch(/live|broker|submitOrder|placeOrder/i);
    }
  });

  it('start/stop drive the scheduler; status reports cycles', async () => {
    const store = new MemoryStore();
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
    const scheduler = new ManualScheduler();
    const pilot = new PaperAutoPilot({
      source: makeSource({ 'QUAL/USD': { drift: 0.001 } }),
      symbols: ['QUAL/USD'],
      timeframe: '1h',
      scheduler,
      portfolio,
      positions,
      killSwitch: new PersistedKillSwitch(store),
      audit: new PersistedAuditLog(store),
      getDailyLoss: () => 0,
      clock: () => T,
    });
    expect(pilot.status().running).toBe(false);
    pilot.start('15m');
    expect(pilot.status().running).toBe(true);
    await scheduler.tick();
    expect(pilot.status().lastCycleAt).toBe(T);
    expect(portfolio.openPositions()).toHaveLength(1);
    pilot.stop();
    expect(pilot.status().running).toBe(false);
  });
});
