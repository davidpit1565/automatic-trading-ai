/**
 * Shadow evaluation (TDD).
 *
 * Candidate strategies forward-tested on live bars, each with its own isolated
 * state, costing the requests of one. The properties that matter: total
 * isolation from the real account and from each other, no extra requests, and
 * a failure in one candidate never taking the run down.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { CachingSource } from '../../src/core/data/cachingSource';
import { PositionEngine } from '../../src/core/position/positionEngine';
import { PortfolioEngine } from '../../src/core/position/portfolioEngine';
import { TradeJournal } from '../../src/core/position/tradeJournal';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import {
  runShadowCycle,
  SHADOW_CANDIDATES,
  type ShadowCandidate,
} from '../../src/core/autopilot/shadowEvaluator';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { ok } from '../../src/core/types';

const T = 1_700_000_000_000;
const SYMBOLS = ['QUAL/EUR', 'FLAT/EUR'];
const CASH = 10_000;

function makeSource(): { source: CachingSource; calls: () => number } {
  let calls = 0;
  const inner: MarketDataSource = {
    name: 'stub',
    getInstruments: async () => ok(SYMBOLS.map((s) => ({ symbol: s, base: s, quote: 'EUR' }))),
    getCandles: async (symbol) => {
      calls++;
      return ok(
        generateSyntheticCandles({
          seed: 1,
          startPrice: 100,
          count: 150,
          timeframe: '1h',
          startTimestamp: T - 150 * 3_600_000,
          drift: symbol === 'QUAL/EUR' ? 0.001 : 0,
          volatility: 0.004,
        }),
      );
    },
  };
  const source = new CachingSource(inner);
  return { source, calls: () => calls };
}

const baseOptions = (store: MemoryStore, source: CachingSource) => ({
  source,
  symbols: SYMBOLS,
  timeframe: '1h' as const,
  initialCash: CASH,
  costRate: 0.003,
  store,
  now: T,
  prices: {},
});

const TWO: ShadowCandidate[] = [
  { key: 'a', label: 'A', minConfidence: 0, maxRsiForLong: 100, confirmationTimeframe: '4h' },
  { key: 'b', label: 'B', minConfidence: 99, maxRsiForLong: 100 },
];

describe('shadow evaluation', () => {
  it('returns a standing per candidate', async () => {
    const store = new MemoryStore();
    const { source } = makeSource();
    const { standings, failures } = await runShadowCycle(TWO, baseOptions(store, source));

    expect(failures).toEqual([]);
    expect(standings.map((s) => s.key)).toEqual(['a', 'b']);
    expect(standings.every((s) => s.equity > 0)).toBe(true);
  });

  it('keeps each candidate’s state in its own namespace', async () => {
    const store = new MemoryStore();
    const { source } = makeSource();
    await runShadowCycle(TWO, baseOptions(store, source));

    const keys = store.keys();
    expect(keys.some((k) => k.startsWith('shadow:a:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('shadow:b:'))).toBe(true);
    // A permissive candidate trades; a 99-confidence one cannot. If they shared
    // state that difference would be invisible.
    const a = standingFor(store, 'a');
    const b = standingFor(store, 'b');
    expect(a).not.toEqual(b);
  });

  it('never touches the real account’s state', async () => {
    const store = new MemoryStore();
    // Seed a real account exactly as the runner would.
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, {
      initialCash: CASH,
      baseCurrency: 'EUR',
    });
    const before = JSON.stringify(portfolio.snapshot({}, T));
    const beforePositions = JSON.stringify(store.get('open-positions'));

    const { source } = makeSource();
    await runShadowCycle(SHADOW_CANDIDATES, baseOptions(store, source));

    expect(JSON.stringify(portfolio.snapshot({}, T))).toBe(before);
    expect(JSON.stringify(store.get('open-positions'))).toBe(beforePositions);
  });

  it('cannot see or trip the real kill switch', async () => {
    const store = new MemoryStore();
    const real = new PersistedKillSwitch(store);
    real.engage('real emergency stop');

    const { source } = makeSource();
    const { standings } = await runShadowCycle(TWO, baseOptions(store, source));

    // The real switch is engaged, but the shadows have their own and keep
    // evaluating — otherwise a halted account would freeze the scoreboard.
    expect(real.isEngaged()).toBe(true);
    expect(standings).toHaveLength(2);
  });

  it('costs the requests of ONE candidate, not N', async () => {
    const store = new MemoryStore();
    const { source, calls } = makeSource();
    await runShadowCycle(SHADOW_CANDIDATES, baseOptions(store, source));

    // 4 candidates over 2 symbols. Without caching this would be many times
    // higher; with it, one fetch per (symbol, timeframe, limit).
    expect(calls()).toBeLessThanOrEqual(SYMBOLS.length * 2);
  });

  it('records a start time once and keeps it across cycles, so age is honest', async () => {
    const store = new MemoryStore();
    const { source } = makeSource();
    const first = await runShadowCycle(TWO, { ...baseOptions(store, source), now: T });
    source.newCycle();
    const later = await runShadowCycle(TWO, { ...baseOptions(store, source), now: T + 86_400_000 });

    expect(later.standings[0]!.startedAt).toBe(first.standings[0]!.startedAt);
    expect(later.standings[0]!.startedAt).toBe(T);
  });

  it('reports a failing candidate instead of taking the whole run down', async () => {
    const store = new MemoryStore();
    const { source } = makeSource();
    const broken: ShadowCandidate[] = [
      TWO[0]!,
      // An empty key produces an invalid namespace, which must be contained.
      { key: '', label: 'broken', minConfidence: 0, maxRsiForLong: 100 },
    ];
    const { standings, failures } = await runShadowCycle(broken, baseOptions(store, source));

    expect(standings.map((s) => s.key)).toEqual(['a']);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.key).toBe('');
  });

  it('ships candidates that differ in IDEA, not in nearby values of one knob', () => {
    expect(SHADOW_CANDIDATES.length).toBeGreaterThanOrEqual(3);
    // A like-for-like baseline must always be running alongside the rest.
    expect(SHADOW_CANDIDATES.some((c) => c.key === 'live-mirror')).toBe(true);
    // Keys must be unique or candidates would share a namespace.
    expect(new Set(SHADOW_CANDIDATES.map((c) => c.key)).size).toBe(SHADOW_CANDIDATES.length);
  });
});

/** Small helper: a candidate's persisted portfolio blob, for comparison. */
function standingFor(store: MemoryStore, key: string): unknown {
  return store.get(`shadow:${key}:portfolio-engine`);
}

describe('trendExit and baseCurrency (long-term investing wallet support)', () => {
  it('threads trendExit through to the candidate\'s PaperAutoPilot without error', async () => {
    const store = new MemoryStore();
    const { source } = makeSource();
    const candidates: ShadowCandidate[] = [
      { key: 'lt', label: 'LT', minConfidence: 0, maxRsiForLong: 100, trendExit: { emaPeriod: 20 } },
    ];
    const { standings, failures } = await runShadowCycle(candidates, baseOptions(store, source));

    expect(failures).toEqual([]);
    expect(standings).toHaveLength(1);
    expect(standings[0]!.equity).toBeGreaterThan(0);
  });

  it('defaults to EUR when baseCurrency is omitted (existing crypto callers unaffected)', async () => {
    const store = new MemoryStore();
    const { source } = makeSource();
    await runShadowCycle(TWO, baseOptions(store, source));
    const portfolioState = store.get<{ baseCurrency: string }>('shadow:a:portfolio-engine');
    expect(portfolioState?.baseCurrency).toBe('EUR');
  });

  it('honors an explicit USD baseCurrency (stocks callers)', async () => {
    const store = new MemoryStore();
    const { source } = makeSource();
    await runShadowCycle(TWO, { ...baseOptions(store, source), baseCurrency: 'USD' });
    const portfolioState = store.get<{ baseCurrency: string }>('shadow:a:portfolio-engine');
    expect(portfolioState?.baseCurrency).toBe('USD');
  });
});

describe('shadow candidate configuration errors', () => {
  it('rejects a duplicate key rather than silently merging two records', async () => {
    const store = new MemoryStore();
    const { source } = makeSource();
    const dupes: ShadowCandidate[] = [
      { key: 'x', label: 'first', minConfidence: 0, maxRsiForLong: 100 },
      { key: 'x', label: 'second', minConfidence: 50, maxRsiForLong: 100 },
    ];
    const { standings, failures } = await runShadowCycle(dupes, baseOptions(store, source));

    expect(standings).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason).toContain('duplicate');
  });
});
