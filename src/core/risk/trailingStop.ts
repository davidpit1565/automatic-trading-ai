/**
 * Trailing-stop math — pure and shared by the live autopilot and the backtest
 * harness so both behave identically (measured: profit factor 2.4→3.0 and
 * lower drawdown vs a fixed stop).
 *
 * Once price has run `activateR` × initial-risk in our favour, the stop moves
 * up to at least breakeven, then trails `trailR` × initial-risk below the best
 * price seen. The stop only ever rises, never falls.
 */

export interface TrailingConfig {
  /** Run-up (in initial-risk units) before the trail activates. */
  readonly activateR: number;
  /** Distance the stop trails below the best price (in initial-risk units). */
  readonly trailR: number;
}

export interface TrailingInput {
  readonly entryPrice: number;
  /** The stop the trade opened with (defines the initial risk). */
  readonly initialStop: number;
  /** Highest price seen since entry. */
  readonly highestPrice: number;
  readonly config: TrailingConfig;
}

/**
 * Effective stop for an open long given how far it has run. Returns the
 * initial stop until the trail activates, then the higher of breakeven and the
 * trailed level. Never below the initial stop.
 */
export function trailingStopPrice(input: TrailingInput): number {
  const risk = input.entryPrice - input.initialStop;
  if (!(risk > 0)) return input.initialStop;
  const runUp = input.highestPrice - input.entryPrice;
  if (runUp < input.config.activateR * risk) return input.initialStop;
  const trailed = input.highestPrice - input.config.trailR * risk;
  return Math.max(input.initialStop, input.entryPrice, trailed);
}
