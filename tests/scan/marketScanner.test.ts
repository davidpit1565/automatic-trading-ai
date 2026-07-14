import { describe, expect, it } from 'vitest';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import {
  DEFAULT_SCANNER_CONFIG,
  scanCandles,
  scanMarket,
} from '../../src/core/scan/marketScanner';
import { err, ok } from '../../src/core/types';

const ANCHOR = 1_700_000_000_000;

function series(drift: number, seed = 1, count = 150) {
  return generateSyntheticCandles({
    seed,
    startPrice: 100,
    count,
    timeframe: '1h',
    startTimestamp: ANCHOR,
    drift,
    volatility: 0.004,
  });
}

describe('scanCandles', () => {
  it('classifies a strong uptrend as hot with a positive score', () => {
    const result = scanCandles('UP/USD', '1h', series(0.004));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.score).toBeGreaterThan(0);
    expect(result.value.temperature).toBe('hot');
  });

  it('classifies a strong downtrend as cold with a negative score', () => {
    const result = scanCandles('DOWN/USD', '1h', series(-0.004));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.score).toBeLessThan(0);
    expect(result.value.temperature).toBe('cold');
  });

  it('classifies a driftless market as neutral', () => {
    const result = scanCandles('FLAT/USD', '1h', series(0, 7));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.temperature).toBe('neutral');
  });

  it('refuses to scan with insufficient history', () => {
    const result = scanCandles('X/USD', '1h', series(0.001, 1, 30));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('at least 60');
  });

  it('explains the score through components that sum to it', () => {
    const result = scanCandles('UP/USD', '1h', series(0.003));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { components, score } = result.value;
    expect(components.length).toBeGreaterThanOrEqual(4);
    for (const component of components) {
      expect(component.label).toBeTruthy();
      expect(component.detail).toBeTruthy();
      expect(Number.isFinite(component.contribution)).toBe(true);
    }
    const sum = components.reduce((total, c) => total + c.contribution, 0);
    expect(score).toBeCloseTo(Math.min(100, Math.max(-100, sum)), 8);
  });

  it('keeps the score within [-100, 100]', () => {
    for (const drift of [0.01, -0.01, 0.002, -0.002, 0]) {
      const result = scanCandles('S/USD', '1h', series(drift, 3));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.score).toBeGreaterThanOrEqual(-100);
        expect(result.value.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('populates the full indicator snapshot for sufficient data', () => {
    const result = scanCandles('UP/USD', '1h', series(0.002));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.value.snapshot;
    expect(s.price).toBeGreaterThan(0);
    expect(s.rsi).not.toBeNull();
    expect(s.macdHistogram).not.toBeNull();
    expect(s.emaFast).not.toBeNull();
    expect(s.emaSlow).not.toBeNull();
    expect(s.adx).not.toBeNull();
    expect(s.atrPct).not.toBeNull();
    expect(s.stochasticK).not.toBeNull();
    expect(s.relativeVolume).not.toBeNull();
  });

  it('warns on overbought RSI in a runaway uptrend', () => {
    const result = scanCandles('UP/USD', '1h', series(0.006));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.rsi!).toBeGreaterThanOrEqual(70);
    expect(result.value.warnings.some((w) => w.includes('overbought'))).toBe(true);
  });

  it('is deterministic for identical input', () => {
    const candles = series(0.002);
    expect(scanCandles('A/USD', '1h', candles)).toEqual(scanCandles('A/USD', '1h', candles));
  });
});

describe('scanMarket', () => {
  const source: MarketDataSource = {
    name: 'test',
    getInstruments: async () => ok([]),
    getCandles: async (symbol) => {
      if (symbol === 'BROKEN/USD') return err('HTTP 503');
      if (symbol === 'SHORT/USD') return ok(series(0, 1, 10));
      const drift = symbol === 'UP/USD' ? 0.004 : symbol === 'DOWN/USD' ? -0.004 : 0;
      return ok(series(drift, 5));
    },
  };

  it('scans all symbols, sorts by score descending, and captures failures', async () => {
    const scan = await scanMarket(
      source,
      ['DOWN/USD', 'UP/USD', 'FLAT/USD', 'BROKEN/USD', 'SHORT/USD'],
      '1h',
    );
    expect(scan.results.map((r) => r.symbol)).toEqual(['UP/USD', 'FLAT/USD', 'DOWN/USD']);
    const scores = scan.results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(scan.failures).toHaveLength(2);
    expect(scan.failures.map((f) => f.symbol).sort()).toEqual(['BROKEN/USD', 'SHORT/USD']);
  });

  it('honours a custom config', async () => {
    const scan = await scanMarket(source, ['UP/USD'], '1h', 150, {
      ...DEFAULT_SCANNER_CONFIG,
      hotThreshold: 99,
    });
    expect(scan.results[0]?.temperature).toBe('neutral');
  });
});
