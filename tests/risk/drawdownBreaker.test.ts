import { describe, expect, it } from 'vitest';
import { drawdownBreached } from '../../src/core/risk/drawdownBreaker';

describe('drawdownBreached', () => {
  it('stays off within the allowed drawdown', () => {
    expect(drawdownBreached({ peakEquity: 10_000, currentEquity: 9_300, maxDrawdownPct: 8 })).toBe(false);
    expect(drawdownBreached({ peakEquity: 10_000, currentEquity: 9_200, maxDrawdownPct: 8 })).toBe(false); // exactly 8%
  });

  it('engages beyond the limit and disengages on recovery', () => {
    expect(drawdownBreached({ peakEquity: 10_000, currentEquity: 9_150, maxDrawdownPct: 8 })).toBe(true);
    expect(drawdownBreached({ peakEquity: 10_000, currentEquity: 9_500, maxDrawdownPct: 8 })).toBe(false);
  });

  it('is safe on degenerate inputs', () => {
    expect(drawdownBreached({ peakEquity: 0, currentEquity: 0, maxDrawdownPct: 8 })).toBe(false);
    expect(drawdownBreached({ peakEquity: 10_000, currentEquity: 9_000, maxDrawdownPct: 0 })).toBe(false);
  });
});
