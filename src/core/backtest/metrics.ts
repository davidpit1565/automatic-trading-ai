/**
 * Performance metrics shared by backtesting and (later) live monitoring.
 * Pure functions over equity curves and trade lists — no simulation logic.
 */

export interface EquityPoint {
  readonly timestamp: number;
  readonly equity: number;
}

export interface ClosedTrade {
  readonly entryTimestamp: number;
  readonly exitTimestamp: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly quantity: number;
  /** Realized profit in quote currency, net of fees. */
  readonly pnl: number;
}

/** Total return over the curve as a percentage of starting equity. */
export function totalReturnPct(curve: readonly EquityPoint[]): number {
  if (curve.length === 0) return 0;
  const first = curve[0]!.equity;
  const last = curve[curve.length - 1]!.equity;
  if (first === 0) return 0;
  return ((last - first) / first) * 100;
}

/** Maximum peak-to-trough drawdown as a positive percentage (0 = no drawdown). */
export function maxDrawdownPct(curve: readonly EquityPoint[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) {
      const drawdown = ((peak - point.equity) / peak) * 100;
      worst = Math.max(worst, drawdown);
    }
  }
  return worst;
}

export interface TradeStats {
  readonly tradeCount: number;
  readonly winCount: number;
  readonly lossCount: number;
  /** Percentage of closed trades with pnl > 0; null when there are no trades. */
  readonly winRatePct: number | null;
  readonly totalPnl: number;
}

export function tradeStats(trades: readonly ClosedTrade[]): TradeStats {
  const winCount = trades.filter((t) => t.pnl > 0).length;
  const lossCount = trades.filter((t) => t.pnl < 0).length;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  return {
    tradeCount: trades.length,
    winCount,
    lossCount,
    winRatePct: trades.length === 0 ? null : (winCount / trades.length) * 100,
    totalPnl,
  };
}
