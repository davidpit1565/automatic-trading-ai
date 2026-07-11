/**
 * Monitoring engine tests (TDD).
 *
 * The engine orchestrates the verified pipeline — scanner → signal engine →
 * risk engine (+ validation verdict) — on a replaceable scheduler. It
 * classifies every symbol per scan (none / watch / qualified), records
 * qualified opportunities, tracks watchlists, marks disappeared signals,
 * and alerts with deduplication. It performs no analysis of its own.
 */

import { describe, expect, it } from 'vitest';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { MemoryStore } from '../../src/core/data/storage';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { AlertEngine, type Alert, type AlertChannel } from '../../src/core/monitor/alerts';
import { MonitoringEngine } from '../../src/core/monitor/monitoringEngine';
import { OpportunityLog } from '../../src/core/monitor/opportunityLog';
import { ManualScheduler } from '../../src/core/monitor/scheduler';
import { WatchlistStore } from '../../src/core/monitor/watchlist';
import { ok } from '../../src/core/types';

const T = 1_700_000_000_000;

/**
 * QUALIFIED/USD: bullish enough for a signal, risk-approvable.
 * BEAR/USD: strong downtrend -> no long opportunity.
 * FLAT/USD: neutral -> nothing.
 * The drifts mirror fixtures already proven in the signal/risk tests.
 */
function makeSource(drifts: Record<string, number>): MarketDataSource {
  return {
    name: 'stub',
    getInstruments: async () =>
      ok(Object.keys(drifts).map((symbol) => ({ symbol, base: symbol, quote: 'USD' }))),
    getCandles: async (symbol) =>
      ok(
        generateSyntheticCandles({
          seed: 1,
          startPrice: 100,
          count: 150,
          timeframe: '1h',
          startTimestamp: T - 150 * 3_600_000,
          drift: drifts[symbol] ?? 0,
          volatility: 0.004,
        }),
      ),
  };
}

function makeEngine(drifts: Record<string, number>, overrides: { alertChannel?: AlertChannel } = {}) {
  const store = new MemoryStore();
  const delivered: Alert[] = [];
  const channel: AlertChannel =
    overrides.alertChannel ?? {
      name: 'test',
      deliver: (alert) => {
        delivered.push(alert);
      },
    };
  const engine = new MonitoringEngine({
    source: makeSource(drifts),
    symbols: Object.keys(drifts),
    timeframe: '1h',
    scheduler: new ManualScheduler(),
    watchlist: new WatchlistStore(store),
    log: new OpportunityLog(store),
    alerts: new AlertEngine(store, [channel], { cooldownMs: 3_600_000 }),
    getPortfolio: () => ({ equity: 10_000, openPositions: [] }),
    getDailyLoss: () => 0,
    // Deterministic stub — full walk-forward is exercised in its own tests.
    validator: () => 'caution',
  });
  return { engine, delivered };
}

describe('MonitoringEngine.runScanOnce', () => {
  it('classifies qualified, watch, and none outcomes from the verified pipeline', async () => {
    const { engine } = makeEngine({ 'QUAL/USD': 0.001, 'BEAR/USD': -0.004, 'FLAT/USD': 0 });
    const result = await engine.runScanOnce(T);

    const bySymbol = Object.fromEntries(result.outcomes.map((o) => [o.symbol, o]));
    expect(bySymbol['QUAL/USD']!.outcome).toBe('qualified');
    expect(bySymbol['BEAR/USD']!.outcome).toBe('none');
    expect(bySymbol['FLAT/USD']!.outcome).toBe('none');
    expect(result.timestamp).toBe(T);
  });

  it('qualified opportunities carry every required field', async () => {
    const { engine } = makeEngine({ 'QUAL/USD': 0.001 });
    const result = await engine.runScanOnce(T);
    const opportunity = result.outcomes[0]!.opportunity!;
    expect(opportunity.symbol).toBe('QUAL/USD');
    expect(opportunity.detectedAt).toBe(T);
    expect(opportunity.price).toBeGreaterThan(0);
    expect(opportunity.confidence).toBeGreaterThan(0);
    expect(opportunity.entry).toBeGreaterThan(0);
    expect(opportunity.stopLoss).toBeLessThan(opportunity.entry);
    expect(opportunity.takeProfit).toBeGreaterThan(opportunity.entry);
    expect(opportunity.positionSize).toBeGreaterThan(0);
    expect(opportunity.riskPct).toBeGreaterThan(0);
    expect(opportunity.explanation.length).toBeGreaterThan(40);
    expect(opportunity.validationVerdict).toBe('caution');
  });

  it('appends qualified opportunities to the history and never rewrites them', async () => {
    const { engine } = makeEngine({ 'QUAL/USD': 0.001 });
    await engine.runScanOnce(T);
    await engine.runScanOnce(T + 3_600_000);
    const entries = engine.opportunityHistory();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.detectedAt).toBe(T);
    expect(entries[1]!.detectedAt).toBe(T + 3_600_000);
  });

  it('updates the watchlist automatically and marks disappeared signals', async () => {
    // First scan: qualified. Second scan: the market turns bearish.
    const drifts: Record<string, number> = { 'QUAL/USD': 0.001 };
    const { engine } = makeEngine(drifts);
    await engine.runScanOnce(T);
    expect(engine.watchlistEntries()[0]).toMatchObject({
      symbol: 'QUAL/USD',
      currentStatus: 'qualified',
      source: 'auto',
    });

    drifts['QUAL/USD'] = -0.004; // regime change
    await engine.runScanOnce(T + 3_600_000);
    expect(engine.watchlistEntries()[0]!.currentStatus).toBe('none');
    const record = engine.opportunityHistory()[0]!;
    expect(record.disappearedAt).toBe(T + 3_600_000);
  });

  it('alerts once for a qualified opportunity and respects the cooldown', async () => {
    const { engine, delivered } = makeEngine({ 'QUAL/USD': 0.001 });
    await engine.runScanOnce(T);
    await engine.runScanOnce(T + 60_000); // within cooldown
    expect(delivered).toHaveLength(1);
    await engine.runScanOnce(T + 3_600_000); // cooldown elapsed
    expect(delivered).toHaveLength(2);
  });

  it('captures per-symbol failures without aborting the scan', async () => {
    const source = makeSource({ 'QUAL/USD': 0.001 });
    const failing: MarketDataSource = {
      name: 'flaky',
      getInstruments: source.getInstruments,
      getCandles: async (symbol, timeframe, limit) =>
        symbol === 'DEAD/USD'
          ? { ok: false, error: 'HTTP 503' }
          : source.getCandles(symbol, timeframe, limit),
    };
    const store = new MemoryStore();
    const engine = new MonitoringEngine({
      source: failing,
      symbols: ['QUAL/USD', 'DEAD/USD'],
      timeframe: '1h',
      scheduler: new ManualScheduler(),
      watchlist: new WatchlistStore(store),
      log: new OpportunityLog(store),
      alerts: new AlertEngine(store, [], { cooldownMs: 3_600_000 }),
      getPortfolio: () => ({ equity: 10_000, openPositions: [] }),
      getDailyLoss: () => 0,
      validator: () => 'caution',
    });
    const result = await engine.runScanOnce(T);
    expect(result.failures).toEqual([{ symbol: 'DEAD/USD', reason: 'HTTP 503' }]);
    expect(result.outcomes.map((o) => o.symbol)).toEqual(['QUAL/USD']);
  });
});

describe('MonitoringEngine scheduling', () => {
  it('start/stop drive the scheduler and status reports scan times', async () => {
    const scheduler = new ManualScheduler();
    const store = new MemoryStore();
    let now = T;
    const engine = new MonitoringEngine({
      source: makeSource({ 'QUAL/USD': 0.001 }),
      symbols: ['QUAL/USD'],
      timeframe: '1h',
      scheduler,
      watchlist: new WatchlistStore(store),
      log: new OpportunityLog(store),
      alerts: new AlertEngine(store, [], { cooldownMs: 3_600_000 }),
      getPortfolio: () => ({ equity: 10_000, openPositions: [] }),
      getDailyLoss: () => 0,
      validator: () => 'caution',
      clock: () => now,
    });

    expect(engine.status().running).toBe(false);
    engine.start('15m');
    const status = engine.status();
    expect(status.running).toBe(true);
    expect(status.interval).toBe('15m');
    expect(status.lastScanAt).toBeNull();

    now = T + 1000;
    await scheduler.tick();
    const after = engine.status();
    expect(after.lastScanAt).toBe(T + 1000);
    expect(after.nextScanAt).toBe(T + 1000 + 900_000);

    engine.stop();
    expect(engine.status().running).toBe(false);
    expect(scheduler.isRunning()).toBe(false);
  });
});
