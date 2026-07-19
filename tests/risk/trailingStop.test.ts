import { describe, expect, it } from 'vitest';
import { trailingStopPrice } from '../../src/core/risk/trailingStop';

const cfg = { activateR: 1, trailR: 2 };

describe('trailingStopPrice', () => {
  it('stays at the initial stop before the trail activates', () => {
    // entry 100, stop 90 → risk 10; needs +10 run-up to activate.
    expect(trailingStopPrice({ entryPrice: 100, initialStop: 90, highestPrice: 105, config: cfg })).toBe(90);
  });

  it('trails below the peak once activated, never below the initial stop', () => {
    // peak 120 → run-up 20 ≥ 10 activates; trailed = 120 - 2*10 = 100.
    expect(trailingStopPrice({ entryPrice: 100, initialStop: 90, highestPrice: 120, config: cfg })).toBe(100);
  });

  it('never lowers the stop and never goes below breakeven once activated', () => {
    // peak 111 → run-up 11 ≥ 10 activates; trailed = 111-20 = 91 < entry 100 → breakeven wins.
    expect(trailingStopPrice({ entryPrice: 100, initialStop: 90, highestPrice: 111, config: cfg })).toBe(100);
  });

  it('is a no-op when risk is non-positive', () => {
    expect(trailingStopPrice({ entryPrice: 100, initialStop: 100, highestPrice: 200, config: cfg })).toBe(100);
  });
});
