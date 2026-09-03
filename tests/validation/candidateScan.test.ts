/**
 * `scanCandidates` — the shared core behind the weekly market-survey script
 * and the on-demand `/discover` Telegram command. Must: rank by volume,
 * exclude already-curated symbols and stablecoins WITHOUT fetching candles
 * for them (rate-limit budget matters), and apply the exact pass bar
 * (net-positive, PF > 1, more than 5 closed trades).
 */
import { describe, expect, it } from 'vitest';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { ok } from '../../src/core/types';
import {
  scanCandidates,
  STABLECOIN_BASES,
  type CandidateScanSource,
} from '../../src/core/validation/candidateScan';

const T = 1_700_000_000_000;

/** seed=1/drift=0.001 over 720 1h candles reliably produces 6 winning
 * round trips (measured directly against runLivePipelineBacktest) — a real
 * PASS fixture, not a guess. seed=2/drift=0 produces zero qualifying
 * entries — a real "too few trades" FAIL fixture. */
function candlesFor(symbol: string, timeframe: '1h' | '4h', pass: boolean) {
  const intervalMs = timeframe === '1h' ? 3_600_000 : 4 * 3_600_000;
  return generateSyntheticCandles({
    seed: pass ? 1 : 2,
    startPrice: 100,
    count: 720,
    timeframe,
    startTimestamp: T - 720 * intervalMs,
    drift: pass ? 0.001 : 0,
    volatility: 0.004,
  });
}

interface TickerConfig {
  readonly base: string;
  readonly quoteVolume: number;
  readonly pass: boolean;
}

function makeSource(config: Record<string, TickerConfig>, opts: { onFetch?: (symbol: string) => void } = {}): CandidateScanSource {
  return {
    getInstruments: async () =>
      ok(Object.entries(config).map(([symbol, c]) => ({ symbol, base: c.base, quote: 'EUR' }))),
    getTickers: async () =>
      ok(
        Object.entries(config).map(([symbol, c]) => ({
          symbol,
          price: 100,
          open: 100,
          high: 101,
          low: 99,
          volume: 1000,
          quoteVolume: c.quoteVolume,
        })),
      ),
    getCandles: async (symbol, timeframe) => {
      opts.onFetch?.(symbol);
      const c = config[symbol];
      if (!c) return { ok: false, error: 'unknown symbol' };
      return ok(candlesFor(symbol, timeframe as '1h' | '4h', c.pass));
    },
  };
}

describe('scanCandidates', () => {
  it('flags a real net-positive, sufficient-sample candidate as passing', async () => {
    const source = makeSource({ QUALEUR: { base: 'QUAL', quoteVolume: 1_000_000, pass: true } });

    const { rows, skipped } = await scanCandidates(source, new Set(), 10);

    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.base).toBe('QUAL');
    expect(rows[0]!.trades).toBeGreaterThan(5);
    expect(rows[0]!.returnPct).toBeGreaterThan(0);
    expect(rows[0]!.passes).toBe(true);
  });

  it('does not flag a candidate with too few (here: zero) qualifying trades', async () => {
    const source = makeSource({ THINEUR: { base: 'THIN', quoteVolume: 1_000_000, pass: false } });

    const { rows } = await scanCandidates(source, new Set(), 10);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.trades).toBe(0);
    expect(rows[0]!.passes).toBe(false);
  });

  it('never fetches candles for an already-curated symbol', async () => {
    const fetched: string[] = [];
    const source = makeSource(
      {
        XBTEUR: { base: 'BTC', quoteVolume: 5_000_000, pass: true },
        QUALEUR: { base: 'QUAL', quoteVolume: 1_000_000, pass: true },
      },
      { onFetch: (symbol) => fetched.push(symbol) },
    );

    const { rows } = await scanCandidates(source, new Set(['XBTEUR']), 10);

    expect(rows.map((r) => r.symbol)).toEqual(['QUALEUR']);
    expect(fetched).not.toContain('XBTEUR');
  });

  it('never fetches candles for a stablecoin base', async () => {
    const fetched: string[] = [];
    const stableBase = [...STABLECOIN_BASES][0]!;
    const source = makeSource(
      {
        USDCEUR: { base: stableBase, quoteVolume: 9_000_000, pass: true },
        QUALEUR: { base: 'QUAL', quoteVolume: 1_000_000, pass: true },
      },
      { onFetch: (symbol) => fetched.push(symbol) },
    );

    const { rows } = await scanCandidates(source, new Set(), 10);

    expect(rows.map((r) => r.symbol)).toEqual(['QUALEUR']);
    expect(fetched).not.toContain('USDCEUR');
  });

  it('ranks by 24h volume and respects topN', async () => {
    const source = makeSource({
      LOWEUR: { base: 'LOW', quoteVolume: 100, pass: true },
      HIGHEUR: { base: 'HIGH', quoteVolume: 9_000_000, pass: true },
      MIDEUR: { base: 'MID', quoteVolume: 500_000, pass: true },
    });

    const { rows } = await scanCandidates(source, new Set(), 2);

    expect(rows.map((r) => r.symbol)).toEqual(['HIGHEUR', 'MIDEUR']);
  });

  it('reports skipped symbols whose candles failed to fetch, without dropping them silently', async () => {
    const source: CandidateScanSource = {
      getInstruments: async () => ok([{ symbol: 'BADEUR', base: 'BAD', quote: 'EUR' }]),
      getTickers: async () => ok([{ symbol: 'BADEUR', price: 1, open: 1, high: 1, low: 1, volume: 1, quoteVolume: 1 }]),
      getCandles: async () => ({ ok: false, error: 'network down' }),
    };

    const { rows, skipped } = await scanCandidates(source, new Set(), 10);

    expect(rows).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain('BAD');
    expect(skipped[0]).toContain('network down');
  });
});
