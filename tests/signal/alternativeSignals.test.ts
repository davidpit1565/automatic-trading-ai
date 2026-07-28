/**
 * Alternative entry signals (TDD).
 *
 * These are different IDEAS from the production momentum signal, and the point
 * of each is the condition it refuses on — a mean-reversion signal that buys
 * into a crash, or a breakout signal that buys without volume, is worse than no
 * signal at all.
 */

import { describe, expect, it } from 'vitest';
import { meanReversionSignal, breakoutSignal } from '../../src/core/signal/alternativeSignals';
import type { ScanResult } from '../../src/core/scan/marketScanner';
import type { IndicatorSnapshot } from '../../src/core/scan/marketScanner';

function scan(snapshot: Partial<IndicatorSnapshot>): ScanResult {
  return {
    symbol: 'XBTEUR',
    timeframe: '1h',
    candleCount: 150,
    score: 0,
    temperature: 'neutral',
    components: [],
    warnings: [],
    snapshot: {
      price: 100, changePct: 0, rsi: 50, macdHistogram: 0, emaFast: 100, emaSlow: 100,
      adx: 20, plusDi: 20, minusDi: 20, atrPct: 2, bollingerBandwidth: 5, percentB: 0.5,
      stochasticK: 50, stochasticD: 50, relativeVolume: 1,
      ...snapshot,
    },
  };
}

describe('mean reversion', () => {
  it('takes an oversold market at the lower band', () => {
    const decision = meanReversionSignal(scan({ rsi: 22, percentB: 0.0 }), 0);
    expect(decision.kind).toBe('opportunity');
    if (decision.kind !== 'opportunity') return;
    expect(decision.opportunity.levels.stopLoss).toBeLessThan(100);
    expect(decision.opportunity.levels.takeProfit).toBeGreaterThan(100);
    // Reward/risk matches the production geometry, so entries are compared fairly.
    expect(decision.opportunity.levels.riskReward).toBe(2);
  });

  it('refuses a market that is merely soft, not oversold', () => {
    expect(meanReversionSignal(scan({ rsi: 45, percentB: 0.0 }), 0).kind).toBe('rejected');
  });

  it('refuses when price has not reached the lower band', () => {
    expect(meanReversionSignal(scan({ rsi: 20, percentB: 0.4 }), 0).kind).toBe('rejected');
  });

  it('refuses a falling knife — oversold inside a strong downtrend', () => {
    const decision = meanReversionSignal(
      scan({ rsi: 15, percentB: 0.0, adx: 45, minusDi: 40, plusDi: 10 }),
      0,
    );
    expect(decision.kind).toBe('rejected');
    if (decision.kind !== 'rejected') return;
    expect(decision.reasons.join(' ')).toContain('falling knife');
  });

  it('still takes an oversold market when the downtrend is weak', () => {
    const decision = meanReversionSignal(
      scan({ rsi: 20, percentB: 0.0, adx: 15, minusDi: 22, plusDi: 18 }),
      0,
    );
    expect(decision.kind).toBe('opportunity');
  });

  it('scores a deeper stretch higher than a shallow one', () => {
    const deep = meanReversionSignal(scan({ rsi: 10, percentB: 0 }), 0);
    const shallow = meanReversionSignal(scan({ rsi: 29, percentB: 0 }), 0);
    if (deep.kind !== 'opportunity' || shallow.kind !== 'opportunity') throw new Error('expected both');
    expect(deep.opportunity.confidence).toBeGreaterThan(shallow.opportunity.confidence);
  });

  it('respects the confidence floor', () => {
    expect(meanReversionSignal(scan({ rsi: 29, percentB: 0 }), 89).kind).toBe('rejected');
  });

  it('refuses when ATR is unusable — no ATR means no stop', () => {
    expect(meanReversionSignal(scan({ rsi: 20, percentB: 0, atrPct: null }), 0).kind).toBe('rejected');
  });
});

describe('breakout', () => {
  const coiled = { bollingerBandwidth: 3, percentB: 1.0, relativeVolume: 2 };

  it('takes a volume-backed break out of a tight base', () => {
    const decision = breakoutSignal(scan(coiled), 0);
    expect(decision.kind).toBe('opportunity');
  });

  it('refuses a break with no volume behind it', () => {
    const decision = breakoutSignal(scan({ ...coiled, relativeVolume: 0.9 }), 0);
    expect(decision.kind).toBe('rejected');
    if (decision.kind !== 'rejected') return;
    expect(decision.reasons.join(' ')).toContain('volume');
  });

  it('refuses when there was no compression to break out of', () => {
    expect(breakoutSignal(scan({ ...coiled, bollingerBandwidth: 20 }), 0).kind).toBe('rejected');
  });

  it('refuses when price has not actually cleared the band', () => {
    expect(breakoutSignal(scan({ ...coiled, percentB: 0.8 }), 0).kind).toBe('rejected');
  });

  it('refuses to chase an already-extended break', () => {
    const decision = breakoutSignal(scan({ ...coiled, rsi: 85 }), 0);
    expect(decision.kind).toBe('rejected');
    if (decision.kind !== 'rejected') return;
    expect(decision.reasons.join(' ')).toContain('extended');
  });

  it('scores a tighter base and heavier volume higher', () => {
    const strong = breakoutSignal(scan({ bollingerBandwidth: 1, percentB: 1, relativeVolume: 3 }), 0);
    const weak = breakoutSignal(scan({ bollingerBandwidth: 7.5, percentB: 1, relativeVolume: 1.25 }), 0);
    if (strong.kind !== 'opportunity' || weak.kind !== 'opportunity') throw new Error('expected both');
    expect(strong.opportunity.confidence).toBeGreaterThan(weak.opportunity.confidence);
  });
});

describe('both signals', () => {
  it('never emit a confidence above the shared maximum', () => {
    const mr = meanReversionSignal(scan({ rsi: 1, percentB: 0 }), 0);
    const bo = breakoutSignal(scan({ bollingerBandwidth: 0.1, percentB: 1, relativeVolume: 10 }), 0);
    for (const d of [mr, bo]) {
      if (d.kind !== 'opportunity') continue;
      expect(d.opportunity.confidence).toBeLessThanOrEqual(90);
      expect(d.opportunity.confidence).toBeGreaterThanOrEqual(0);
    }
  });

  it('produce a stop below and a target above entry, so the risk engine accepts them', () => {
    const mr = meanReversionSignal(scan({ rsi: 20, percentB: 0 }), 0);
    const bo = breakoutSignal(scan({ bollingerBandwidth: 3, percentB: 1, relativeVolume: 2 }), 0);
    for (const d of [mr, bo]) {
      if (d.kind !== 'opportunity') throw new Error('expected an opportunity');
      const { entry, stopLoss, takeProfit } = d.opportunity.levels;
      expect(stopLoss).toBeLessThan(entry);
      expect(takeProfit).toBeGreaterThan(entry);
      expect(stopLoss).toBeGreaterThan(0);
    }
  });

  it('carry an explanation that states what would make them wrong', () => {
    const mr = meanReversionSignal(scan({ rsi: 20, percentB: 0 }), 0);
    if (mr.kind !== 'opportunity') throw new Error('expected an opportunity');
    expect(mr.opportunity.explanation).toContain('wrong');
  });
});
