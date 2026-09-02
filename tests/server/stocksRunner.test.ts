/**
 * `server/stocksRunner.mts` — the stocks paper autopilot, fully isolated
 * from the crypto runner (own state, own USD portfolio). Same testability
 * guard as `autopilotRunner.mts`: `main()` only runs when invoked directly,
 * so importing this module for its exported pieces never triggers a live
 * cycle against real exchanges.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStore } from '../../server/fileStore.mts';
import {
  buildAlpacaSourceFromEnv,
  recordEquity,
  runPassiveHoldCycle,
  runStocksCycle,
  updateMarketSnapshot,
  type MarketSnapshotEntry,
} from '../../server/stocksRunner.mts';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import { PortfolioEngine } from '../../src/core/position/portfolioEngine';
import { PositionEngine } from '../../src/core/position/positionEngine';
import { TradeJournal } from '../../src/core/position/tradeJournal';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { Candle, Instrument } from '../../src/core/types';

let dir: string;
let store: FileStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stocks-runner-'));
  store = new FileStore(join(dir, 'state.json'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('buildAlpacaSourceFromEnv', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('returns null when credentials are missing', () => {
    delete process.env['ALPACA_API_KEY_ID'];
    delete process.env['ALPACA_API_SECRET_KEY'];
    expect(buildAlpacaSourceFromEnv()).toBeNull();
  });

  it('builds a source when both credentials are present', () => {
    process.env['ALPACA_API_KEY_ID'] = 'key';
    process.env['ALPACA_API_SECRET_KEY'] = 'secret';
    expect(buildAlpacaSourceFromEnv()).not.toBeNull();
  });
});

const AAPL: Instrument = { symbol: 'AAPL', base: 'AAPL', quote: 'USD' };
const candle = (close: number): Candle => ({ timestamp: 0, open: close, high: close, low: close, close, volume: 1000 });

function fakeSource(): MarketDataSource {
  return {
    name: 'fake stocks',
    getInstruments: async () => ({ ok: true, value: [AAPL] }),
    getCandles: async () => ({ ok: true, value: [candle(100), candle(101)] }),
  };
}

describe('recordEquity', () => {
  it('appends a rounded equity point on every call', async () => {
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
    await recordEquity(store, fakeSource(), portfolio, journal, 1000, {});
    await recordEquity(store, fakeSource(), portfolio, journal, 2000, {});
    const history = store.get<Array<{ at: number; equity: number }>>('equity-history');
    expect(history).toHaveLength(2);
    expect(history![0]!.equity).toBe(10_000);
  });

  it('refreshes the real-money readiness verdict alongside the equity point', async () => {
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
    await recordEquity(store, fakeSource(), portfolio, journal, 1000, {});
    const readiness = store.get<{ ready: boolean; criteria: { key: string; detail: string }[] }>('real-money-readiness');
    expect(readiness).not.toBeNull();
    expect(readiness!.ready).toBe(false);
    // A real (fake-source) SPY fetch succeeds here, so the benchmark is
    // actually measured now — must name SPY, not the old "not measured" text.
    const benchmark = readiness!.criteria.find((c) => c.key === 'benchmark');
    expect(benchmark?.detail).toContain('S&P 500 (SPY)');
    expect(benchmark?.detail).not.toContain('BTC');
  });

  it('falls back to "not measured" when the SPY fetch fails', async () => {
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
    const failingSource: MarketDataSource = {
      name: 'failing',
      getInstruments: async () => ({ ok: true, value: [AAPL] }),
      getCandles: async () => ({ ok: false, error: 'no data' }),
    };
    await recordEquity(store, failingSource, portfolio, journal, 1000, {});
    const readiness = store.get<{ criteria: { key: string; detail: string }[] }>('real-money-readiness');
    const benchmark = readiness!.criteria.find((c) => c.key === 'benchmark');
    expect(benchmark?.detail).toContain('a market benchmark');
  });

  it('keeps the last known-good stored benchmark on a later transient SPY failure, instead of clobbering it with null', async () => {
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
    // First cycle: real (fake-source) SPY fetch succeeds, anchoring a comparison.
    await recordEquity(store, fakeSource(), portfolio, journal, 1000, {});
    const goodBenchmark = store.get('benchmark-result');
    expect(goodBenchmark).not.toBeNull();

    // Second cycle: a transient failure must not erase that stored value.
    const failingSource: MarketDataSource = {
      name: 'failing',
      getInstruments: async () => ({ ok: true, value: [AAPL] }),
      getCandles: async () => ({ ok: false, error: 'rate limited' }),
    };
    await recordEquity(store, failingSource, portfolio, journal, 2000, {});
    expect(store.get('benchmark-result')).toEqual(goodBenchmark);
  });
});

function buildPortfolio(): { killSwitch: PersistedKillSwitch; portfolio: PortfolioEngine; journal: TradeJournal } {
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'USD' });
  const killSwitch = new PersistedKillSwitch(store);
  return { killSwitch, portfolio, journal };
}

describe('runPassiveHoldCycle', () => {
  it('equal-weights available cash across symbols not yet held', () => {
    const { killSwitch, portfolio } = buildPortfolio();
    const cycle = runPassiveHoldCycle(portfolio, killSwitch, ['AAPL', 'MSFT'], { AAPL: 100, MSFT: 200 }, 1000);
    expect(cycle.halted).toBe(false);
    expect(cycle.opened.map((o) => o.symbol).sort()).toEqual(['AAPL', 'MSFT']);
    // Each leg gets ~half the cash (minus its own fee), regardless of price.
    const aapl = cycle.opened.find((o) => o.symbol === 'AAPL')!;
    const msft = cycle.opened.find((o) => o.symbol === 'MSFT')!;
    expect(aapl.quantity * 100).toBeCloseTo(msft.quantity * 200, 0);
    expect(portfolio.openPositions()).toHaveLength(2);
  });

  it('never sells and skips symbols already held, even across repeated calls', () => {
    const { killSwitch, portfolio } = buildPortfolio();
    runPassiveHoldCycle(portfolio, killSwitch, ['AAPL'], { AAPL: 100 }, 1000);
    const afterFirst = portfolio.openPositions();
    expect(afterFirst).toHaveLength(1);

    const cycle = runPassiveHoldCycle(portfolio, killSwitch, ['AAPL'], { AAPL: 110 }, 2000);
    expect(cycle.opened).toHaveLength(0);
    expect(cycle.closed).toHaveLength(0);
    expect(portfolio.openPositions()).toEqual(afterFirst);
  });

  it('tops up symbols still unheld on a later cycle (partial-fill catch-up)', () => {
    const { killSwitch, portfolio } = buildPortfolio();
    // First cycle only sees AAPL priced — MSFT missing from the price map
    // (e.g. a transient fetch gap), so only AAPL is bought.
    runPassiveHoldCycle(portfolio, killSwitch, ['AAPL', 'MSFT'], { AAPL: 100 }, 1000);
    expect(portfolio.openPositions().map((p) => p.symbol)).toEqual(['AAPL']);

    const cycle = runPassiveHoldCycle(portfolio, killSwitch, ['AAPL', 'MSFT'], { AAPL: 100, MSFT: 200 }, 2000);
    expect(cycle.opened.map((o) => o.symbol)).toEqual(['MSFT']);
    expect(portfolio.openPositions().map((p) => p.symbol).sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('respects the kill switch and buys nothing while engaged', () => {
    const { killSwitch, portfolio } = buildPortfolio();
    killSwitch.engage('test');
    const cycle = runPassiveHoldCycle(portfolio, killSwitch, ['AAPL'], { AAPL: 100 }, 1000);
    expect(cycle.halted).toBe(true);
    expect(cycle.opened).toHaveLength(0);
    expect(portfolio.openPositions()).toHaveLength(0);
  });
});

describe('updateMarketSnapshot', () => {
  it('anchors each symbol to its first price of the UTC day and reports 0% change', () => {
    const day1 = Date.UTC(2026, 0, 15, 10, 0, 0);
    updateMarketSnapshot(store, { AAPL: 100, MSFT: 200 }, day1);
    const snap = store.get<{ at: number; symbols: MarketSnapshotEntry[] }>('market-snapshot');
    expect(snap?.symbols).toEqual([
      { symbol: 'AAPL', price: 100, changePct: 0, updatedAt: day1 },
      { symbol: 'MSFT', price: 200, changePct: 0, updatedAt: day1 },
    ]);
  });

  it('computes changePct against the day anchor on later calls the same day', () => {
    const morning = Date.UTC(2026, 0, 15, 10, 0, 0);
    const afternoon = Date.UTC(2026, 0, 15, 18, 0, 0);
    updateMarketSnapshot(store, { AAPL: 100 }, morning);
    updateMarketSnapshot(store, { AAPL: 105 }, afternoon);
    const snap = store.get<{ at: number; symbols: MarketSnapshotEntry[] }>('market-snapshot');
    expect(snap?.symbols).toEqual([{ symbol: 'AAPL', price: 105, changePct: 5, updatedAt: afternoon }]);
  });

  it('resets the anchor on a new UTC day', () => {
    const day1 = Date.UTC(2026, 0, 15, 20, 0, 0);
    const day2 = Date.UTC(2026, 0, 16, 10, 0, 0);
    updateMarketSnapshot(store, { AAPL: 100 }, day1);
    updateMarketSnapshot(store, { AAPL: 110 }, day2);
    const snap = store.get<{ at: number; symbols: MarketSnapshotEntry[] }>('market-snapshot');
    expect(snap?.symbols).toEqual([{ symbol: 'AAPL', price: 110, changePct: 0, updatedAt: day2 }]);
  });
});

describe('runStocksCycle', () => {
  it('runs a cycle, records a heartbeat, and records an equity point', async () => {
    const source = fakeSource();
    const { killSwitch, portfolio, journal } = buildPortfolio();
    const telegram = { token: '', chatId: '' };
    await runStocksCycle(store, source, killSwitch, portfolio, journal, telegram, ['AAPL'], 5_000_000);

    const lastRun = store.get<{ at: number; source: string }>('autopilot-last-run');
    expect(lastRun?.source).toBe('fake stocks');
    const history = store.get<Array<{ at: number; equity: number }>>('equity-history');
    expect(history).toHaveLength(1);
    const snap = store.get<{ at: number; symbols: MarketSnapshotEntry[] }>('market-snapshot');
    // The traded symbol AAPL, priced from the trading loop's own fetch.
    expect(snap?.symbols).toContainEqual({ symbol: 'AAPL', price: 101, changePct: 0, updatedAt: 5_000_000 });
  });

  it('also snapshots the wider browsable list (not just the traded symbols), without duplicating AAPL', async () => {
    const source = fakeSource();
    const { killSwitch, portfolio, journal } = buildPortfolio();
    const telegram = { token: '', chatId: '' };
    await runStocksCycle(store, source, killSwitch, portfolio, journal, telegram, ['AAPL'], 5_000_000);

    const snap = store.get<{ at: number; symbols: MarketSnapshotEntry[] }>('market-snapshot');
    const symbols = snap!.symbols.map((s) => s.symbol);
    // Some browsable-only symbol (never in the traded list passed above) is present.
    expect(symbols).toContain('MSFT');
    // AAPL (traded) appears exactly once — the browsable sweep must skip
    // symbols already priced by the trading loop, not refetch/duplicate them.
    expect(symbols.filter((s) => s === 'AAPL')).toHaveLength(1);
  });

  it('does not send a Telegram message when nothing to buy (already fully held)', async () => {
    const source = fakeSource();
    const { killSwitch, portfolio, journal } = buildPortfolio();
    // Already holding AAPL — the passive-hold cycle has nothing left to buy.
    portfolio.open({ symbol: 'AAPL', quantity: 1, entryPrice: 100, stopLoss: 1, takeProfit: 1000, timestamp: 0 });
    const fetchFn = vi.fn();
    const telegram = { token: 'T', chatId: 'C' };
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch?: typeof fetch }).fetch = fetchFn as unknown as typeof fetch;
    try {
      await runStocksCycle(store, source, killSwitch, portfolio, journal, telegram, ['AAPL'], 5_000_000);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('respects the stagger delay between the browsable-only price requests', async () => {
    const source = fakeSource();
    const { killSwitch, portfolio, journal } = buildPortfolio();
    const telegram = { token: '', chatId: '' };
    const start = Date.now();
    await runStocksCycle(store, source, killSwitch, portfolio, journal, telegram, ['AAPL'], 5_000_000, 5);
    const elapsed = Date.now() - start;
    // ~39 browsable-only symbols (BROWSABLE minus the 1 traded symbol) at 5ms
    // each is a real, if small, floor — proves the delay is actually awaited
    // per iteration, not skipped or applied once.
    expect(elapsed).toBeGreaterThanOrEqual(35 * 5);
  });

  it('runs the long-term investing shadow wallet alongside the main cycle', async () => {
    const source = fakeSource();
    const { killSwitch, portfolio, journal } = buildPortfolio();
    const telegram = { token: '', chatId: '' };
    await runStocksCycle(store, source, killSwitch, portfolio, journal, telegram, ['AAPL'], 5_000_000);

    const shadow = store.get<{ at: number; standings: { key: string }[] }>('shadow-standings');
    expect(shadow?.standings.map((s) => s.key)).toEqual(['long-term']);
    // Isolated in its own namespace — never the main account's keys.
    expect(store.get('shadow:long-term:portfolio-engine')).not.toBeUndefined();
  });

  it('only runs the long-term shadow wallet once per UTC day, not every cycle', async () => {
    const source = fakeSource();
    const { killSwitch, portfolio, journal } = buildPortfolio();
    const telegram = { token: '', chatId: '' };
    const morning = Date.UTC(2026, 0, 15, 10, 0, 0);
    const laterSameDay = Date.UTC(2026, 0, 15, 18, 0, 0);
    const nextDay = Date.UTC(2026, 0, 16, 10, 0, 0);

    await runStocksCycle(store, source, killSwitch, portfolio, journal, telegram, ['AAPL'], morning);
    const firstRun = store.get<{ at: number }>('shadow-standings');
    expect(firstRun?.at).toBe(morning);

    await runStocksCycle(store, source, killSwitch, portfolio, journal, telegram, ['AAPL'], laterSameDay);
    const stillSameDay = store.get<{ at: number }>('shadow-standings');
    expect(stillSameDay?.at).toBe(morning); // unchanged — same UTC day, skipped

    await runStocksCycle(store, source, killSwitch, portfolio, journal, telegram, ['AAPL'], nextDay);
    const newDay = store.get<{ at: number }>('shadow-standings');
    expect(newDay?.at).toBe(nextDay); // a new day runs it again
  });
});
