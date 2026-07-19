/**
 * Portfolio drawdown circuit-breaker — pure math.
 *
 * The daily-loss limit protects within a day; this protects ACROSS days: when
 * equity falls more than `maxDrawdownPct` below its all-time peak, new buying
 * pauses until the portfolio recovers above that line. Exits/stops on open
 * positions keep running — the breaker only stops NEW risk.
 */

export interface DrawdownState {
  /** Highest equity seen so far. */
  readonly peakEquity: number;
  readonly currentEquity: number;
  /** Pause new entries when down more than this % from the peak. */
  readonly maxDrawdownPct: number;
}

/** True when new entries should pause (drawdown from peak exceeds the limit). */
export function drawdownBreached(state: DrawdownState): boolean {
  if (!(state.peakEquity > 0) || !(state.maxDrawdownPct > 0)) return false;
  const ddPct = ((state.peakEquity - state.currentEquity) / state.peakEquity) * 100;
  return ddPct > state.maxDrawdownPct;
}
