/**
 * Pure exit decision — extracted from `paperAutoPilot.ts` so paper AND live
 * trading make the exact same call given the same inputs, per this
 * project's non-negotiable "paper and live are the same pipeline" rule
 * (docs/execution-architecture.md, property 3). No I/O, no side effects.
 */

import type { ExitReason } from '../position/tradeJournal';
import { trailingStopPrice, type TrailingConfig } from '../risk/trailingStop';
import { ema } from '../indicators/ema';

export interface ExitCandidatePosition {
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  /** Highest price seen since entry — feeds the trailing-stop calculation. */
  readonly highestPrice: number;
}

export interface ExitDecisionOptions {
  readonly trailing?: TrailingConfig;
  /** Replaces the fixed take-profit entirely while configured — matches
   * `livePipeline.ts`'s own trendExit rule. */
  readonly trendExit?: { readonly emaPeriod: number };
}

/**
 * Decides whether an open position should exit right now, given the latest
 * price and its own recent closes (oldest first, matching candle order).
 * Checks, in order: stop-loss (trailed if `trailing` is configured) →
 * trend-exit (if configured, REPLACES the take-profit check below) →
 * take-profit. Returns `null` when nothing triggers.
 */
export function decideExit(
  position: ExitCandidatePosition,
  currentPrice: number,
  recentCloses: readonly number[],
  options: ExitDecisionOptions,
): ExitReason | null {
  const stopLoss = options.trailing
    ? trailingStopPrice({
        entryPrice: position.entryPrice,
        initialStop: position.stopLoss,
        highestPrice: Math.max(position.highestPrice, currentPrice),
        config: options.trailing,
      })
    : position.stopLoss;

  if (currentPrice <= stopLoss) return 'stop-loss';

  if (options.trendExit) {
    const level = ema(recentCloses, options.trendExit.emaPeriod).at(-1) ?? null;
    return level !== null && currentPrice < level ? 'signal-exit' : null;
  }

  if (currentPrice >= position.takeProfit) return 'take-profit';
  return null;
}
