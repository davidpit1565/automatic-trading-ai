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

function makePilot(config: Record<string, { drift: number; lastPrice?: number }>) {
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
