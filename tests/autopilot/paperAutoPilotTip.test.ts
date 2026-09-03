/**
 * `previewBestOpportunity` — powers the `/tip` Telegram command (David
 * asked 2026-09-03). Must reuse the SAME entry gates `runCycleOnce` acts
 * on, and must NEVER mutate the portfolio — a tip is a read-only look at
 * what the autopilot would do, not an action.
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

function makeSource(config: Record<string, { drift: number }>): MarketDataSource {
  return {
    name: 'stub',
    getInstruments: async () => ok(Object.keys(config).map((symbol) => ({ symbol, base: symbol, quote: 'USD' }))),
    getCandles: async (symbol) => {
      const { drift } = config[symbol] ?? { drift: 0 };
      return ok(
        generateSyntheticCandles({
          seed: 1,
          startPrice: 100,
          count: 150,
          timeframe: '1h',
          startTimestamp: T - 150 * 3_600_000,
          drift,
          volatility: 0.004,
        }),
      );
    },
  };
}

function makePilot(
  config: Record<string, { drift: number }>,
  opts: { regimeCheck?: (symbol: string, timestamp: number) => Promise<boolean> } = {},
) {
  const store = new MemoryStore();
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
  const pilot = new PaperAutoPilot({
    source: makeSource(config),
    symbols: Object.keys(config),
    timeframe: '1h',
    scheduler: new ManualScheduler(),
    portfolio,
    positions,
    killSwitch: new PersistedKillSwitch(store),
    audit: new PersistedAuditLog(store),
    getDailyLoss: () => 0,
    clock: () => T,
    regimeCheck: opts.regimeCheck,
  });
  return { pilot, portfolio };
}

describe('previewBestOpportunity', () => {
  it('reports the qualifying opportunity without opening it', async () => {
    const { pilot, portfolio } = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    const result = await pilot.previewBestOpportunity(T);

    expect(result.qualified?.symbol).toBe('QUAL/USD');
    expect(result.qualified!.assessment.approved).toBe(true);
    expect(result.qualified!.opportunity.confidence).toBeGreaterThan(0);
    // The whole point: nothing was actually opened.
    expect(portfolio.openPositions()).toHaveLength(0);
  });

  it('never mutates the portfolio even across repeated calls', async () => {
    const { pilot, portfolio } = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    await pilot.previewBestOpportunity(T);
    await pilot.previewBestOpportunity(T);
    await pilot.previewBestOpportunity(T);
    expect(portfolio.openPositions()).toHaveLength(0);
  });

  it('excludes a symbol already held, even though it would still qualify', async () => {
    const { pilot } = makePilot({ 'QUAL/USD': { drift: 0.001 } });
    await pilot.runCycleOnce(T); // opens QUAL/USD for real, in the paper portfolio

    const result = await pilot.previewBestOpportunity(T);
    expect(result.qualified).toBeNull();
  });

  it('reports the closest miss and why, when a candidate has a signal but is refused by a later gate', async () => {
    const { pilot } = makePilot(
      { 'QUAL/USD': { drift: 0.001 } },
      { regimeCheck: async () => false }, // has a real signal, but the daily regime gate blocks it
    );
    const result = await pilot.previewBestOpportunity(T);

    expect(result.qualified).toBeNull();
    expect(result.closestMiss?.symbol).toBe('QUAL/USD');
    expect(result.closestMiss?.reason).toContain('regime');
  });

  it('reports nothing at all when no symbol has any signal', async () => {
    const { pilot } = makePilot({ 'FLAT/USD': { drift: 0 } });
    const result = await pilot.previewBestOpportunity(T);

    expect(result.qualified).toBeNull();
    expect(result.closestMiss).toBeNull();
  });
});
