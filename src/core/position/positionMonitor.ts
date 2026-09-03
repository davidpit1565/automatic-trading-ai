/**
 * Position monitoring — Stage 5.
 *
 * Pure insight function over an open position and current market state.
 * INFORMATIONAL ONLY: it produces warnings for the human to review; it
 * cannot close, modify, or trade anything.
 */

import type { Temperature } from '../scan/marketScanner';
import type { RobustnessVerdict } from '../validation/robustness';
import { trailingStopPrice, type TrailingConfig } from '../risk/trailingStop';
import type { OpenPosition } from './positionEngine';

export interface PositionMarketState {
  readonly price: number;
  readonly timestamp: number;
  /** Current market regime from the scanner, when available. */
  readonly regime?: Temperature;
  /** Latest validation verdict for the symbol, when available. */
  readonly currentValidationVerdict?: RobustnessVerdict | 'not-run';
  /**
   * Same trailing config the exit engine is actually running with
   * (`decideExit`'s own `options.trailing` — see exitDecision.ts). Omit
   * for a fixed stop. Found in review, 2026-09-03: without this, every
   * distance/risk figure and warning here was computed against
   * `position.stopLoss` — the ORIGINAL stop — even once a trailing stop
   * had ratcheted the REAL protective stop up past it, understating how
   * close price actually is to the real exit level.
   */
  readonly trailing?: TrailingConfig;
}

export interface PositionInsight {
  readonly positionId: string;
  readonly symbol: string;
  readonly price: number;
  readonly unrealizedPnl: number;
  readonly pnlPct: number;
  readonly distanceToStopPct: number;
  readonly distanceToTargetPct: number;
  /** Loss if the stop were hit from here. */
  readonly currentRisk: number;
  /** Gain if the target were hit from here. */
  readonly currentReward: number;
  readonly timeInTradeMs: number;
  readonly regime: Temperature | null;
  readonly warnings: string[];
}

/** Price within this % of the stop counts as "approaching". */
const NEAR_STOP_PCT = 1;

/** Ranking for detecting validation deterioration. */
const VERDICT_RANK: Record<RobustnessVerdict | 'not-run', number> = {
  robust: 3,
  caution: 2,
  'insufficient-data': 1,
  'not-run': 1,
  overfitted: 0,
};

export function assessOpenPosition(
  position: OpenPosition,
  market: PositionMarketState,
): PositionInsight {
  const { price, timestamp } = market;
  const warnings: string[] = [];

  // The REAL, currently-effective protective stop — ratcheted up by a
  // trailing config exactly the way decideExit itself computes it. Falls
  // back to the position's own (fixed) stopLoss when no trailing is
  // configured, or when it hasn't activated yet.
  const effectiveStop = market.trailing
    ? trailingStopPrice({
        entryPrice: position.entryPrice,
        initialStop: position.stopLoss,
        highestPrice: Math.max(position.highestPrice, price),
        config: market.trailing,
      })
    : position.stopLoss;

  const unrealizedPnl = (price - position.entryPrice) * position.quantity;
  const pnlPct = ((price - position.entryPrice) / position.entryPrice) * 100;
  const distanceToStopPct = ((price - effectiveStop) / price) * 100;
  const distanceToTargetPct = ((position.takeProfit - price) / price) * 100;

  if (price <= effectiveStop) {
    warnings.push(
      `stop loss breached: price ${price} is at/below the ${effectiveStop} stop — ` +
        `review this position now (informational only, nothing is closed automatically)`,
    );
  } else if (distanceToStopPct <= NEAR_STOP_PCT) {
    warnings.push(
      `price is within ${NEAR_STOP_PCT}% of the stop loss (${effectiveStop}) — approaching the exit level`,
    );
  }

  if (price >= position.takeProfit) {
    warnings.push(
      `take-profit target ${position.takeProfit} reached — consider whether to realise gains`,
    );
  }

  if (market.regime === 'cold') {
    warnings.push(
      'market regime has turned cold (bearish technical evidence) while this long position is open',
    );
  }

  if (
    market.currentValidationVerdict !== undefined &&
    position.validationVerdict !== null &&
    VERDICT_RANK[market.currentValidationVerdict] < VERDICT_RANK[position.validationVerdict]
  ) {
    warnings.push(
      `validation verdict deteriorated from '${position.validationVerdict}' at entry ` +
        `to '${market.currentValidationVerdict}' now`,
    );
  }

  return {
    positionId: position.id,
    symbol: position.symbol,
    price,
    unrealizedPnl,
    pnlPct,
    distanceToStopPct,
    distanceToTargetPct,
    currentRisk: Math.max(price - effectiveStop, 0) * position.quantity,
    currentReward: Math.max(position.takeProfit - price, 0) * position.quantity,
    timeInTradeMs: timestamp - position.openedAt,
    regime: market.regime ?? null,
    warnings,
  };
}
