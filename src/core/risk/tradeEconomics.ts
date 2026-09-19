/**
 * Trade economics — a pure, honest check of whether a proposed trade's
 * theoretical reward can even clear round-trip trading costs, before ever
 * asking whether the signal itself is good. Built entirely from data
 * `assessTrade` already produces (`positionValue`, `riskAmount`,
 * `rewardRiskRatio`) — this is NOT a guessed "expected edge" model; it only
 * asks whether hitting the ALREADY-PROPOSED take-profit target would still
 * be profitable net of fees. Added 2026-09-19 after an audit found no
 * economic-viability check existed anywhere in the order-submission path.
 *
 * Deliberately advisory-only wherever it's wired (see
 * `server/liveEntryMirror.mts`) — this project's own rule ("measure, don't
 * guess") forbids activating a new blocking gate on real money before it's
 * validated against real history, the same discipline already applied to
 * every strategy-parameter change (`scripts/sweepStrategy.mts`).
 */

import type { TradeRiskAssessment } from './riskEngine';

export interface TradeEconomics {
  /** Fees for opening AND closing this position, at `costRate` per side. */
  readonly roundTripFees: number;
  /** Reward if the trade hits its take-profit target, net of round-trip fees. */
  readonly netRewardAtTarget: number;
  /**
   * Share of the theoretical target reward that round-trip fees alone
   * consume. 1.0 means fees equal the entire target reward; above 1.0
   * means fees exceed it — a loss even on a full win. `Infinity` when
   * there is no theoretical reward at all (a zero/negative risk-reward
   * assessment, which `assessTrade` should never approve, but this stays
   * honest about it rather than dividing by zero silently).
   */
  readonly feeShareOfReward: number;
  /**
   * False only when fees would consume the ENTIRE theoretical reward at
   * target — an objective fact given the assessment's own numbers, not a
   * separately guessed threshold.
   */
  readonly viable: boolean;
}

export function assessTradeEconomics(assessment: TradeRiskAssessment, costRate: number): TradeEconomics {
  const roundTripFees = assessment.positionValue * costRate * 2;
  const rewardAtTarget = assessment.riskAmount * assessment.rewardRiskRatio;
  const netRewardAtTarget = rewardAtTarget - roundTripFees;
  const feeShareOfReward = rewardAtTarget > 0 ? roundTripFees / rewardAtTarget : Infinity;
  return {
    roundTripFees,
    netRewardAtTarget,
    feeShareOfReward,
    viable: netRewardAtTarget > 0,
  };
}
