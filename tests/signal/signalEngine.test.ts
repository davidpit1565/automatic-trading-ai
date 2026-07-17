/**
 * Stage 2 — Signal Engine tests (written before the implementation, TDD).
 *
 * The engine consumes verified Market Scanner output only. It must never
 * recompute indicators, must reject low-quality setups with explicit
 * reasons, and must express confidence conservatively and explainably.
 */

import { describe, expect, it } from 'vitest';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { scanCandles, type MarketScan, type ScanResult } from '../../src/core/scan/marketScanner';
import {
  DEFAULT_SIGNAL_CRITERIA,
  evaluateScan,
  generateSignals,
  MAX_CONFIDENCE,
} from '../../src/core/signal/signalEngine';

const ANCHOR = 1_700_000_000_000;

/**
 * Criteria with the conviction floor disabled, for the tests that exercise
 * confidence mechanics / level derivation / ranking rather than the floor
 * itself (the floor has its own dedicated tests below).
 */
const NO_FLOOR = { ...DEFAULT_SIGNAL_CRITERIA, minConfidence: 0 };

function scannedSeries(drift: number, seed = 1): ScanResult {
  const candles = generateSyntheticCandles({
    seed,
    startPrice: 100,
    count: 150,
    timeframe: '1h',
    startTimestamp: ANCHOR,
    drift,
    volatility: 0.004,
  });
  const result = scanCandles('TEST/USD', '1h', candles);
  if (!result.ok) throw new Error(`fixture scan failed: ${result.error}`);
  return result.value;
}

/** Hand-built ScanResult for precise control over snapshot edge cases. */
function makeScan(overrides: {
  score?: number;
  temperature?: 'hot' | 'neutral' | 'cold';
  rsi?: number | null;
  adx?: number | null;
  atrPct?: number | null;
  relativeVolume?: number | null;
  warnings?: string[];
}): ScanResult {
  const base = scannedSeries(0.004);
  return {
    ...base,
    score: overrides.score ?? base.score,
    temperature: overrides.temperature ?? base.temperature,
    warnings: overrides.warnings ?? base.warnings,
    snapshot: {
      ...base.snapshot,
      rsi: overrides.rsi !== undefined ? overrides.rsi : base.snapshot.rsi,
      adx: overrides.adx !== undefined ? overrides.adx : base.snapshot.adx,
      atrPct: overrides.atrPct !== undefined ? overrides.atrPct : base.snapshot.atrPct,
      relativeVolume:
        overrides.relativeVolume !== undefined
          ? overrides.relativeVolume
          : base.snapshot.relativeVolume,
    },
  };
}

describe('evaluateScan — accepted setups', () => {
  it('turns a hot scan into a structured long opportunity', () => {
    const scan = makeScan({ score: 55, rsi: 62, adx: 32, atrPct: 2, relativeVolume: 1.3 });
    const decision = evaluateScan(scan, NO_FLOOR);
    expect(decision.kind).toBe('opportunity');
    if (decision.kind !== 'opportunity') return;

    const { levels, confidence, direction } = decision.opportunity;
    expect(direction).toBe('long');
    expect(levels.entry).toBeCloseTo(scan.snapshot.price, 10);
    expect(levels.stopLoss).toBeLessThan(levels.entry);
    expect(levels.takeProfit).toBeGreaterThan(levels.entry);
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
  });

  it('derives stop and target from the scanner ATR, with the configured risk/reward', () => {
    const scan = makeScan({ score: 55, rsi: 60, adx: 30, atrPct: 2 });
    const decision = evaluateScan(scan, NO_FLOOR);
    expect(decision.kind).toBe('opportunity');
    if (decision.kind !== 'opportunity') return;

    const atr = (scan.snapshot.atrPct! / 100) * scan.snapshot.price;
    const { entry, stopLoss, takeProfit, riskReward } = decision.opportunity.levels;
    expect(entry - stopLoss).toBeCloseTo(DEFAULT_SIGNAL_CRITERIA.atrStopMultiple * atr, 8);
    expect(takeProfit - entry).toBeCloseTo(DEFAULT_SIGNAL_CRITERIA.atrTargetMultiple * atr, 8);
    expect(riskReward).toBeCloseTo(
      DEFAULT_SIGNAL_CRITERIA.atrTargetMultiple / DEFAULT_SIGNAL_CRITERIA.atrStopMultiple,
      10,
    );
    expect(riskReward).toBeGreaterThanOrEqual(DEFAULT_SIGNAL_CRITERIA.minRiskReward);
  });

  it('confidence equals the sum of its explainable components, capped conservatively', () => {
    const scan = makeScan({ score: 90, rsi: 60, adx: 50, atrPct: 2, relativeVolume: 2.5, warnings: [] });
    const decision = evaluateScan(scan);
    expect(decision.kind).toBe('opportunity');
    if (decision.kind !== 'opportunity') return;

    const { confidence, confidenceComponents } = decision.opportunity;
    expect(confidenceComponents.length).toBeGreaterThanOrEqual(2);
    const sum = confidenceComponents.reduce((total, c) => total + c.effect, 0);
    expect(confidence).toBeCloseTo(Math.max(0, Math.min(MAX_CONFIDENCE, sum)), 8);
    // Never certainty, no matter how strong the evidence.
    expect(confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
    expect(MAX_CONFIDENCE).toBeLessThan(100);
  });

  it('warnings reduce confidence relative to the same scan without warnings', () => {
    const clean = evaluateScan(makeScan({ score: 60, rsi: 60, adx: 30, atrPct: 2, warnings: [] }), NO_FLOOR);
    const warned = evaluateScan(
      makeScan({ score: 60, rsi: 60, adx: 30, atrPct: 2, warnings: ['x', 'y'] }),
      NO_FLOOR,
    );
    expect(clean.kind).toBe('opportunity');
    expect(warned.kind).toBe('opportunity');
    if (clean.kind !== 'opportunity' || warned.kind !== 'opportunity') return;
    expect(warned.opportunity.confidence).toBeLessThan(clean.opportunity.confidence);
    expect(warned.opportunity.warnings).toEqual(['x', 'y']);
  });

  it('explains itself in plain language without promising anything', () => {
    const decision = evaluateScan(makeScan({ score: 55, rsi: 60, adx: 30, atrPct: 2 }), NO_FLOOR);
    expect(decision.kind).toBe('opportunity');
    if (decision.kind !== 'opportunity') return;
    const text = decision.opportunity.explanation.toLowerCase();
    expect(text).toContain('test/usd');
    expect(text).toMatch(/not a guarantee|no guarantee/);
    expect(text).not.toMatch(/guaranteed|certain profit|will rise|can'?t lose/);
    expect(decision.opportunity.explanation.length).toBeGreaterThan(80);
  });

  it('is deterministic for identical input', () => {
    const scan = makeScan({ score: 55, rsi: 60, adx: 30, atrPct: 2 });
    expect(evaluateScan(scan)).toEqual(evaluateScan(scan));
  });
});

describe('evaluateScan — rejections', () => {
  it('rejects insufficient bullish evidence (neutral market)', () => {
    const decision = evaluateScan(makeScan({ score: 10, temperature: 'neutral' }));
    expect(decision.kind).toBe('rejected');
    if (decision.kind !== 'rejected') return;
    expect(decision.reasons.some((r) => r.includes('score'))).toBe(true);
  });

  it('rejects bearish markets — long-only platform, shorting is not simulated', () => {
    const decision = evaluateScan(makeScan({ score: -60, temperature: 'cold' }));
    expect(decision.kind).toBe('rejected');
    if (decision.kind !== 'rejected') return;
    expect(decision.reasons.some((r) => r.toLowerCase().includes('bearish'))).toBe(true);
  });

  it('rejects overextended entries (RSI above the long ceiling)', () => {
    const decision = evaluateScan(makeScan({ score: 60, rsi: 82, adx: 35, atrPct: 2 }));
    expect(decision.kind).toBe('rejected');
    if (decision.kind !== 'rejected') return;
    expect(decision.reasons.some((r) => r.includes('RSI'))).toBe(true);
  });

  it('rejects weak or unmeasurable trends (low or missing ADX)', () => {
    for (const adx of [12, null]) {
      const decision = evaluateScan(makeScan({ score: 45, rsi: 60, adx, atrPct: 2 }));
      expect(decision.kind).toBe('rejected');
      if (decision.kind === 'rejected') {
        expect(decision.reasons.some((r) => r.includes('ADX') || r.includes('trend'))).toBe(true);
      }
    }
  });

  it('rejects when volatility is extreme or ATR is unavailable', () => {
    const tooWild = evaluateScan(makeScan({ score: 60, rsi: 60, adx: 35, atrPct: 12 }));
    expect(tooWild.kind).toBe('rejected');
    const noAtr = evaluateScan(makeScan({ score: 60, rsi: 60, adx: 35, atrPct: null }));
    expect(noAtr.kind).toBe('rejected');
  });

  it('collects every failed check, not just the first', () => {
    const decision = evaluateScan(makeScan({ score: 5, rsi: 82, adx: 10, atrPct: 12 }));
    expect(decision.kind).toBe('rejected');
    if (decision.kind !== 'rejected') return;
    expect(decision.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('end to end: a genuine downtrend scan is rejected', () => {
    const decision = evaluateScan(scannedSeries(-0.004));
    expect(decision.kind).toBe('rejected');
  });

  it('refuses low-conviction setups that clear the hard gates (confidence floor)', () => {
    // Passes score/ADX/RSI/ATR gates, but warnings + weak trend drag its
    // confidence well below the default floor — exactly the near-coin-flip
    // trades that were being opened (e.g. XRP at ~5%, DOT at ~12%).
    const marginal = makeScan({
      score: 32,
      rsi: 60,
      adx: 21,
      atrPct: 2,
      relativeVolume: 1,
      warnings: ['weak trend', 'thin volume'],
    });

    const gated = evaluateScan(marginal, { ...DEFAULT_SIGNAL_CRITERIA, minConfidence: 40 });
    expect(gated.kind).toBe('rejected');
    if (gated.kind === 'rejected') {
      expect(gated.reasons.some((r) => r.toLowerCase().includes('confidence'))).toBe(true);
    }

    // Same setup is an opportunity when the floor is off (engine default) —
    // proving it was the floor, not the hard gates, that refused it.
    const ungated = evaluateScan(marginal);
    expect(ungated.kind).toBe('opportunity');
    if (ungated.kind === 'opportunity') {
      expect(ungated.opportunity.confidence).toBeLessThan(40);
    }
  });
});

// Position sizing moved to the Risk Engine in Stage 3 — see tests/risk.

describe('generateSignals', () => {
  it('splits a market scan into ranked opportunities and explained rejections', () => {
    const strong = { ...makeScan({ score: 70, rsi: 60, adx: 40, atrPct: 2 }), symbol: 'STRONG/USD' };
    const mild = { ...makeScan({ score: 35, rsi: 58, adx: 26, atrPct: 2 }), symbol: 'MILD/USD' };
    const weak = { ...makeScan({ score: 5, temperature: 'neutral' as const }), symbol: 'WEAK/USD' };
    const marketScan: MarketScan = {
      timeframe: '1h',
      results: [weak, mild, strong],
      failures: [{ symbol: 'DEAD/USD', reason: 'HTTP 503' }],
    };

    const signals = generateSignals(marketScan, NO_FLOOR);
    expect(signals.opportunities.map((o) => o.symbol)).toEqual(['STRONG/USD', 'MILD/USD']);
    expect(signals.opportunities[0]!.confidence).toBeGreaterThanOrEqual(
      signals.opportunities[1]!.confidence,
    );
    expect(signals.rejections).toHaveLength(1);
    expect(signals.rejections[0]!.symbol).toBe('WEAK/USD');
  });

  it('returns empty collections for an empty scan', () => {
    const signals = generateSignals({ timeframe: '1h', results: [], failures: [] });
    expect(signals.opportunities).toEqual([]);
    expect(signals.rejections).toEqual([]);
  });
});
