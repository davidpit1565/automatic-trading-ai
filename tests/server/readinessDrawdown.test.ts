/**
 * The readiness gate's drawdown criterion must reflect the portfolio's real
 * peak-to-trough, not just the realized-trade curve.
 *
 * `tradeAnalytics` builds its equity curve from the trade JOURNAL, so it steps
 * only at exits. A portfolio sitting through a deep unrealized drawdown records
 * none of it, and the "max drawdown under 10%" safety criterion can pass while
 * mark-to-market equity is far below its peak. The runner already stores a true
 * mark-to-market series in `equity-history`; this is the honest number.
 */

import { describe, expect, it } from 'vitest';
import { maxDrawdownPct } from '../../src/core/backtest/metrics';
import { assessRealMoneyReadiness } from '../../src/core/feedback/realMoneyReadiness';

/** Mirrors the runner's stored shape. */
const history = (equities: number[]): { at: number; equity: number }[] =>
  equities.map((equity, i) => ({ at: i * 3_600_000, equity }));

describe('drawdown from the mark-to-market equity history', () => {
  it('sees a deep unrealized drawdown that the realized curve misses', () => {
    // Peak 10,000 -> trough 8,500 -> partial recovery, with NOTHING realized.
    const curve = history([10_000, 10_000, 8_500, 9_000]).map((p) => ({
      timestamp: p.at,
      equity: p.equity,
    }));
    expect(maxDrawdownPct(curve)).toBeCloseTo(15, 6);

    // Fed into the gate, a 15% drawdown must fail the 10% criterion...
    const failing = assessRealMoneyReadiness({
      closedTrades: 30, profitFactor: 2, realizedReturnPct: 5,
      maxDrawdownPct: 15, vsBenchmarkPct: 1, daysRunning: 60,
    });
    expect(failing.ready).toBe(false);
    expect(failing.unmet).toContain('drawdown');

    // ...where the realized-only number (0%, nothing closed) would have passed.
    const misleading = assessRealMoneyReadiness({
      closedTrades: 30, profitFactor: 2, realizedReturnPct: 5,
      maxDrawdownPct: 0, vsBenchmarkPct: 1, daysRunning: 60,
    });
    expect(misleading.ready).toBe(true);
  });

  it('reports zero for a curve that only ever rises', () => {
    const curve = history([10_000, 10_100, 10_400]).map((p) => ({ timestamp: p.at, equity: p.equity }));
    expect(maxDrawdownPct(curve)).toBe(0);
  });

  it('handles a single point and an empty history without producing NaN', () => {
    expect(maxDrawdownPct([{ timestamp: 0, equity: 10_000 }])).toBe(0);
    expect(Number.isFinite(maxDrawdownPct([]))).toBe(true);
  });
});
