/**
 * Multi-timeframe confirmation tests (TDD).
 *
 * From the original vision: analyse multiple timeframes. A qualifying
 * signal on the entry timeframe is checked against the higher timeframe's
 * scan: bearish higher-timeframe evidence blocks the trade, bullish
 * evidence adds (capped) confidence, neutral passes with an explicit note.
 */

import { describe, expect, it } from 'vitest';
import { generateSyntheticCandles } from '../../src/core/data/synthetic';
import { scanCandles, type ScanResult } from '../../src/core/scan/marketScanner';
import {
  evaluateScan,
  MAX_CONFIDENCE,
  type SignalDecision,
} from '../../src/core/signal/signalEngine';
import { applyHigherTimeframeGate } from '../../src/core/signal/multiTimeframe';

const T = 1_700_000_000_000;

function scanOf(drift: number, timeframe: '1h' | '4h' = '1h'): ScanResult {
  const candles = generateSyntheticCandles({
    seed: 1,
    startPrice: 100,
    count: 150,
    timeframe,
    startTimestamp: T,
    drift,
    volatility: 0.004,
  });
  const result = scanCandles('TEST/USD', timeframe, candles);
  if (!result.ok) throw new Error(`fixture scan failed: ${result.error}`);
  return result.value;
}

function qualifyingDecision(): SignalDecision {
  const decision = evaluateScan(scanOf(0.001));
  if (decision.kind !== 'opportunity') throw new Error('fixture must qualify');
  return decision;
}

describe('applyHigherTimeframeGate', () => {
  it('blocks a long when the higher timeframe is bearish, with an explicit reason', () => {
    const gated = applyHigherTimeframeGate(qualifyingDecision(), scanOf(-0.004, '4h'));
    expect(gated.kind).toBe('rejected');
    if (gated.kind !== 'rejected') return;
    expect(gated.reasons.some((r) => r.includes('4h') && r.toLowerCase().includes('bearish'))).toBe(
      true,
    );
  });

  it('adds capped confidence when the higher timeframe confirms', () => {
    const base = qualifyingDecision();
    const gated = applyHigherTimeframeGate(base, scanOf(0.004, '4h'));
    expect(gated.kind).toBe('opportunity');
    if (gated.kind !== 'opportunity' || base.kind !== 'opportunity') return;
    expect(gated.opportunity.confidence).toBeGreaterThan(base.opportunity.confidence);
    expect(gated.opportunity.confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
    // The bonus is itemised, never silent.
    expect(
      gated.opportunity.confidenceComponents.some((c) => c.label.includes('igher timeframe')),
    ).toBe(true);
    expect(gated.opportunity.explanation).toContain('4h');
  });

  it('passes a neutral higher timeframe through with an explicit warning', () => {
    const base = qualifyingDecision();
    const gated = applyHigherTimeframeGate(base, scanOf(0, '4h'));
    expect(gated.kind).toBe('opportunity');
    if (gated.kind !== 'opportunity' || base.kind !== 'opportunity') return;
    expect(gated.opportunity.confidence).toBeCloseTo(base.opportunity.confidence, 8);
    expect(gated.opportunity.warnings.some((w) => w.includes('4h'))).toBe(true);
  });

  it('keeps the opportunity but warns when the higher timeframe is unavailable', () => {
    const gated = applyHigherTimeframeGate(qualifyingDecision(), null);
    expect(gated.kind).toBe('opportunity');
    if (gated.kind !== 'opportunity') return;
    expect(gated.opportunity.warnings.some((w) => w.toLowerCase().includes('unconfirmed'))).toBe(
      true,
    );
  });

  it('leaves already-rejected decisions untouched', () => {
    const rejected = evaluateScan(scanOf(-0.004));
    expect(rejected.kind).toBe('rejected');
    const gated = applyHigherTimeframeGate(rejected, scanOf(0.004, '4h'));
    expect(gated).toEqual(rejected);
  });

  it('is deterministic', () => {
    const decision = qualifyingDecision();
    const higher = scanOf(0.004, '4h');
    expect(applyHigherTimeframeGate(decision, higher)).toEqual(
      applyHigherTimeframeGate(decision, higher),
    );
  });
});
