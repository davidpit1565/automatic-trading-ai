/**
 * `scanMomentumSpikes` — the speculative, unmeasured "heads up, this is
 * moving right now" scan (deliberately NOT candidateScan's measured-history
 * bar — see momentumScan.ts's own doc comment for why). Must: flag only
 * symbols up at least the threshold, exclude already-curated symbols and
 * stablecoins, respect a minimum-volume floor (skip illiquid noise), and
 * rank/cap correctly.
 */
import { describe, expect, it } from 'vitest';
import { ok } from '../../src/core/types';
import {
  scanMomentumSpikes,
  DEFAULT_SPIKE_THRESHOLD_PCT,
  type MomentumScanSource,
} from '../../src/core/validation/momentumScan';

interface TickerConfig {
  readonly base: string;
  readonly open: number;
  readonly price: number;
  readonly quoteVolume: number;
}

function makeSource(config: Record<string, TickerConfig>): MomentumScanSource {
  return {
    getInstruments: async () =>
      ok(Object.entries(config).map(([symbol, c]) => ({ symbol, base: c.base, quote: 'EUR' }))),
    getTickers: async () =>
      ok(
        Object.entries(config).map(([symbol, c]) => ({
          symbol,
          price: c.price,
          open: c.open,
          high: Math.max(c.open, c.price),
          low: Math.min(c.open, c.price),
          volume: 1000,
          quoteVolume: c.quoteVolume,
        })),
      ),
  };
}

describe('scanMomentumSpikes', () => {
  it('flags a symbol up at least the threshold, computed off session open', async () => {
    const source = makeSource({
      SPIKEEUR: { base: 'SPIKE', open: 100, price: 120, quoteVolume: 1_000_000 }, // +20%
    });

    const { rows, error } = await scanMomentumSpikes(source, new Set());

    expect(error).toBeUndefined();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.base).toBe('SPIKE');
    expect(rows[0]!.pctChange).toBeCloseTo(20, 5);
  });

  it('does not flag a symbol below the threshold', async () => {
    const source = makeSource({
      FLATEUR: { base: 'FLAT', open: 100, price: 105, quoteVolume: 1_000_000 }, // +5%, below default 15%
    });

    const { rows } = await scanMomentumSpikes(source, new Set());

    expect(rows).toEqual([]);
  });

  it('never flags an already-curated symbol, even if it spiked', async () => {
    const source = makeSource({
      XBTEUR: { base: 'BTC', open: 100, price: 130, quoteVolume: 5_000_000 },
      NEWEUR: { base: 'NEW', open: 100, price: 130, quoteVolume: 1_000_000 },
    });

    const { rows } = await scanMomentumSpikes(source, new Set(['XBTEUR']));

    expect(rows.map((r) => r.symbol)).toEqual(['NEWEUR']);
  });

  it('never flags a stablecoin, even at a wildly distorted price', async () => {
    const source = makeSource({
      USDCEUR: { base: 'USDC', open: 1, price: 1.5, quoteVolume: 9_000_000 }, // +50%
      NEWEUR: { base: 'NEW', open: 100, price: 120, quoteVolume: 1_000_000 },
    });

    const { rows } = await scanMomentumSpikes(source, new Set());

    expect(rows.map((r) => r.symbol)).toEqual(['NEWEUR']);
  });

  it('filters out illiquid symbols below the minimum quote-volume floor', async () => {
    const source = makeSource({
      DUSTEUR: { base: 'DUST', open: 1, price: 2, quoteVolume: 100 }, // +100% but no real volume behind it
      NEWEUR: { base: 'NEW', open: 100, price: 120, quoteVolume: 1_000_000 },
    });

    const { rows } = await scanMomentumSpikes(source, new Set());

    expect(rows.map((r) => r.symbol)).toEqual(['NEWEUR']);
  });

  it('ranks by pctChange descending and respects topN', async () => {
    const source = makeSource({
      SMALLEUR: { base: 'SMALL', open: 100, price: 116, quoteVolume: 1_000_000 }, // +16%
      BIGEUR: { base: 'BIG', open: 100, price: 150, quoteVolume: 1_000_000 }, // +50%
      MIDEUR: { base: 'MID', open: 100, price: 130, quoteVolume: 1_000_000 }, // +30%
    });

    const { rows } = await scanMomentumSpikes(source, new Set(), { topN: 2 });

    expect(rows.map((r) => r.symbol)).toEqual(['BIGEUR', 'MIDEUR']);
  });

  it('respects a custom threshold', async () => {
    const source = makeSource({
      SMALLEUR: { base: 'SMALL', open: 100, price: 108, quoteVolume: 1_000_000 }, // +8%
    });

    const belowDefault = await scanMomentumSpikes(source, new Set());
    expect(belowDefault.rows).toEqual([]);

    const withLowerBar = await scanMomentumSpikes(source, new Set(), { thresholdPct: 5 });
    expect(withLowerBar.rows).toHaveLength(1);
  });

  it('reports an error rather than throwing when tickers fail to fetch', async () => {
    const source: MomentumScanSource = {
      getInstruments: async () => ok([]),
      getTickers: async () => ({ ok: false, error: 'network down' }),
    };

    const { rows, error } = await scanMomentumSpikes(source, new Set());

    expect(rows).toEqual([]);
    expect(error).toContain('network down');
  });

  it('the default threshold constant matches what the scan actually enforces', async () => {
    const source = makeSource({
      EXACTEUR: { base: 'EXACT', open: 100, price: 100 + DEFAULT_SPIKE_THRESHOLD_PCT, quoteVolume: 1_000_000 },
    });

    const { rows } = await scanMomentumSpikes(source, new Set());

    expect(rows).toHaveLength(1); // exactly at the threshold passes (>=)
  });
});
