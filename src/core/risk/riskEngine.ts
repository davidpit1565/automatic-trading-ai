/**
 * Risk Engine — Stage 3.
 *
 * Sits between the Signal Engine and any trade proposal. The Signal Engine
 * asks "is this a good opportunity?"; this layer asks "even if it is, is it
 * safe for THIS portfolio?" It consumes Signal Engine output only — no
 * indicator math, no market data access — and produces a fully explainable
 * TradeRiskAssessment. Refusing a trade is a success condition, and every
 * refusal lists all failed checks, never just the first.
 */

import type { TradeOpportunity } from '../signal/signalEngine';
import type { Result } from '../types';
import { err, ok } from '../types';

export interface RiskLimits {
  /** Maximum share of equity risked between entry and stop, per trade. */
  readonly maxRiskPerTradePct: number;
  /** Maximum single position notional as a share of equity. */
  readonly maxPositionPct: number;
  /** Maximum combined open-position notional as a share of equity. */
  readonly maxTotalExposurePct: number;
  /** Maximum number of simultaneously open positions. */
  readonly maxOpenPositions: number;
  /** Maximum per-asset notional as a share of equity (duplicate protection). */
  readonly maxExposurePerAssetPct: number;
  /** Daily realized loss (share of equity) that pauses new trades. */
  readonly dailyLossLimitPct: number;
  /** Minimum acceptable reward-to-risk ratio. */
  readonly minRewardRisk: number;
  /** Reward-to-risk above this is treated as an unrealistic target. */
  readonly maxRewardRisk: number;
  /** Minimum stop distance as % of entry — closer stops are noise, not risk control. */
  readonly minStopDistancePct: number;
  /**
   * Optional cross-asset correlation cap. When set together with
   * `AssessTradeOptions.correlationTo`, open positions in OTHER symbols whose
   * return-correlation to the candidate is >= this threshold count toward a
   * combined "correlated cluster" exposure cap (`maxCorrelatedExposurePct`),
   * in addition to (not instead of) the per-asset cap. Targets co-movement
   * risk (e.g. several correlated alts stopping out together) that the
   * per-asset cap alone cannot see. Omit to leave this check off entirely.
   */
  readonly correlationThreshold?: number;
  /** Cap on combined notional of a correlated cluster, as % of equity. */
  readonly maxCorrelatedExposurePct?: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxRiskPerTradePct: 1,
  maxPositionPct: 20,
  maxTotalExposurePct: 60,
  maxOpenPositions: 5,
  maxExposurePerAssetPct: 20,
  dailyLossLimitPct: 3,
  minRewardRisk: 1.5,
  maxRewardRisk: 20,
  minStopDistancePct: 0.25,
};

// ---------------------------------------------------------------------------
// 1. Risk-based position sizing (moved here from the Signal Engine).
// ---------------------------------------------------------------------------

export interface PositionSizeInput {
  readonly accountEquity: number;
  /** Requested risk %; silently clamped to limits.maxRiskPerTradePct. */
  readonly riskPerTradePct: number;
  readonly entry: number;
  readonly stopLoss: number;
  /** Combined notional of currently open positions. */
  readonly currentExposure: number;
  readonly limits?: RiskLimits;
}

export interface PositionSizeBreakdown {
  readonly quantity: number;
  /** Notional value at entry. */
  readonly positionValue: number;
  /** Loss if the stop is hit (before fees/slippage). */
  readonly maxLoss: number;
  /** Risk actually taken as % of equity (may be below the request after caps). */
  readonly riskPctUsed: number;
  /** Human-readable list of every limit that constrained the size. */
  readonly constraintsApplied: string[];
}

export function calculatePositionSize(input: PositionSizeInput): Result<PositionSizeBreakdown> {
  const limits = input.limits ?? DEFAULT_RISK_LIMITS;
  const { accountEquity, entry, stopLoss, currentExposure } = input;

  if (!(accountEquity > 0)) return err(`accountEquity must be > 0, got ${accountEquity}`);
  if (!(input.riskPerTradePct > 0)) {
    return err(`riskPerTradePct must be > 0, got ${input.riskPerTradePct}`);
  }
  if (!(entry > 0)) return err(`entry must be > 0, got ${entry}`);
  if (!(stopLoss > 0) || stopLoss >= entry) {
    return err(`stopLoss must be positive and below entry (entry ${entry}, stop ${stopLoss})`);
  }
  if (!(currentExposure >= 0)) return err(`currentExposure must be >= 0, got ${currentExposure}`);

  const constraintsApplied: string[] = [];

  let riskPct = input.riskPerTradePct;
  if (riskPct > limits.maxRiskPerTradePct) {
    riskPct = limits.maxRiskPerTradePct;
    constraintsApplied.push(
      `requested risk ${input.riskPerTradePct}% clamped to the ${limits.maxRiskPerTradePct}% per-trade risk ceiling`,
    );
  }

  const riskPerUnit = entry - stopLoss;
  let quantity = (accountEquity * (riskPct / 100)) / riskPerUnit;
  let positionValue = quantity * entry;

  const maxPositionValue = accountEquity * (limits.maxPositionPct / 100);
  if (positionValue > maxPositionValue) {
    quantity = maxPositionValue / entry;
    positionValue = maxPositionValue;
    constraintsApplied.push(
      `size capped by the ${limits.maxPositionPct}% single-position limit`,
    );
  }

  const exposureHeadroom = accountEquity * (limits.maxTotalExposurePct / 100) - currentExposure;
  if (positionValue > exposureHeadroom) {
    if (exposureHeadroom <= 0) {
      return err(
        `no exposure headroom: ${currentExposure.toFixed(2)} already deployed of the ` +
          `${limits.maxTotalExposurePct}% total-exposure limit`,
      );
    }
    quantity = exposureHeadroom / entry;
    positionValue = exposureHeadroom;
    constraintsApplied.push(
      `size capped by the ${limits.maxTotalExposurePct}% total-exposure limit`,
    );
  }

  const maxLoss = quantity * riskPerUnit;
  return ok({
    quantity,
    positionValue,
    maxLoss,
    riskPctUsed: (maxLoss / accountEquity) * 100,
    constraintsApplied,
  });
}

// ---------------------------------------------------------------------------
// 2–5. Portfolio-aware trade assessment.
// ---------------------------------------------------------------------------

export interface OpenPosition {
  readonly symbol: string;
  readonly quantity: number;
  readonly entryPrice: number;
}

export interface PortfolioRiskState {
  readonly equity: number;
  readonly openPositions: readonly OpenPosition[];
}

export interface AssessTradeOptions {
  readonly limits?: RiskLimits;
  /** Requested risk % per trade; defaults to (and is capped at) the limit. */
  readonly riskPerTradePct?: number;
  /** Realized loss so far this trading day (positive number = loss). */
  readonly dailyLossSoFar?: number;
  /**
   * Return-correlation of the candidate symbol to another open symbol
   * (-1..1). Required alongside `limits.correlationThreshold` /
   * `limits.maxCorrelatedExposurePct` for the correlated-cluster cap to
   * apply; omit to leave that check off.
   */
  readonly correlationTo?: (otherSymbol: string) => number;
}

/** The final structured verdict — every field the UI needs, nothing hidden. */
export interface TradeRiskAssessment {
  readonly approved: boolean;
  readonly asset: string;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  /** Quantity to buy; 0 when rejected. */
  readonly positionSize: number;
  /** Notional at entry; 0 when rejected. */
  readonly positionValue: number;
  /** Loss if stopped out; 0 when rejected. */
  readonly riskAmount: number;
  /** Risk as % of equity; 0 when rejected. */
  readonly riskPercentage: number;
  readonly rewardRiskRatio: number;
  /** Total portfolio exposure (% of equity) after this trade would open. */
  readonly portfolioExposure: number;
  /** Why the decision came out this way — approvals explain themselves too. */
  readonly reasons: string[];
  /** Non-fatal caveats, e.g. size caps that were applied. */
  readonly warnings: string[];
}

const notionalOf = (p: OpenPosition): number => p.quantity * p.entryPrice;

export function assessTrade(
  opportunity: TradeOpportunity,
  portfolio: PortfolioRiskState,
  options: AssessTradeOptions = {},
): TradeRiskAssessment {
  const limits = options.limits ?? DEFAULT_RISK_LIMITS;
  const { entry, stopLoss, takeProfit } = opportunity.levels;
  const reasons: string[] = [];
  const warnings: string[] = [];

  const currentExposure = portfolio.openPositions.reduce((sum, p) => sum + notionalOf(p), 0);
  const currentExposurePct =
    portfolio.equity > 0 ? (currentExposure / portfolio.equity) * 100 : 0;

  const rejected = (): TradeRiskAssessment => ({
    approved: false,
    asset: opportunity.symbol,
    entry,
    stopLoss,
    takeProfit,
    positionSize: 0,
    positionValue: 0,
    riskAmount: 0,
    riskPercentage: 0,
    rewardRiskRatio: rewardRisk,
    portfolioExposure: currentExposurePct,
    reasons,
    warnings,
  });

  if (!(portfolio.equity > 0)) {
    reasons.push(`portfolio equity must be positive, got ${portfolio.equity}`);
  }

  // --- Daily loss protection -------------------------------------------------
  const dailyLoss = options.dailyLossSoFar ?? 0;
  const dailyLossLimit = portfolio.equity * (limits.dailyLossLimitPct / 100);
  if (dailyLoss >= dailyLossLimit && dailyLossLimit > 0) {
    reasons.push(
      `daily loss limit reached: ${dailyLoss.toFixed(2)} lost today of the ` +
        `${dailyLossLimit.toFixed(2)} (${limits.dailyLossLimitPct}% of equity) allowance — ` +
        `no new trades until the next trading day`,
    );
  }

  // --- Stop and target validity ----------------------------------------------
  const stopDistancePct = entry > 0 ? ((entry - stopLoss) / entry) * 100 : 0;
  let rewardRisk = 0;
  if (!(stopLoss > 0) || stopLoss >= entry) {
    reasons.push(`invalid stop: stop loss ${stopLoss} must be positive and below entry ${entry}`);
  } else {
    rewardRisk = (takeProfit - entry) / (entry - stopLoss);
    if (stopDistancePct < limits.minStopDistancePct) {
      reasons.push(
        `stop too close to entry: ${stopDistancePct.toFixed(2)}% distance is below the ` +
          `${limits.minStopDistancePct}% minimum — it would be triggered by normal noise`,
      );
    }
    if (rewardRisk < limits.minRewardRisk) {
      reasons.push(
        `reward/risk ${rewardRisk.toFixed(2)} is below the required minimum of ${limits.minRewardRisk}`,
      );
    } else if (rewardRisk > limits.maxRewardRisk) {
      reasons.push(
        `unrealistic target: reward/risk ${rewardRisk.toFixed(1)} exceeds the plausible ` +
          `maximum of ${limits.maxRewardRisk}`,
      );
    }
  }
  if (!(takeProfit > entry)) {
    reasons.push(`take profit ${takeProfit} must be above entry ${entry} for a long position`);
  }

  // --- Portfolio capacity ------------------------------------------------------
  if (portfolio.openPositions.length >= limits.maxOpenPositions) {
    reasons.push(
      `maximum open positions reached (${portfolio.openPositions.length}/${limits.maxOpenPositions})`,
    );
  }

  const assetExposure = portfolio.openPositions
    .filter((p) => p.symbol === opportunity.symbol)
    .reduce((sum, p) => sum + notionalOf(p), 0);
  const assetCap = portfolio.equity * (limits.maxExposurePerAssetPct / 100);
  const assetHeadroom = assetCap - assetExposure;
  if (assetExposure > 0 && assetHeadroom <= 0) {
    reasons.push(
      `${opportunity.symbol} already uses ${((assetExposure / portfolio.equity) * 100).toFixed(1)}% ` +
        `of equity — at or above the ${limits.maxExposurePerAssetPct}% per-asset cap`,
    );
  }

  // --- Correlated-cluster exposure (co-movement risk) ---------------------
  const hasCorrelationCap =
    limits.correlationThreshold !== undefined &&
    limits.maxCorrelatedExposurePct !== undefined &&
    options.correlationTo !== undefined;
  const clusterExposure = hasCorrelationCap
    ? portfolio.openPositions
        .filter(
          (p) => p.symbol !== opportunity.symbol && options.correlationTo!(p.symbol) >= limits.correlationThreshold!,
        )
        .reduce((sum, p) => sum + notionalOf(p), 0)
    : 0;
  const clusterCap = hasCorrelationCap ? portfolio.equity * (limits.maxCorrelatedExposurePct! / 100) : 0;
  const clusterHeadroom = clusterCap - clusterExposure;
  if (hasCorrelationCap && clusterExposure > 0 && clusterHeadroom <= 0) {
    reasons.push(
      `${opportunity.symbol}'s correlated cluster already uses ${((clusterExposure / portfolio.equity) * 100).toFixed(1)}% ` +
        `of equity — at or above the ${limits.maxCorrelatedExposurePct}% correlated-cluster cap`,
    );
  }

  if (reasons.length > 0) return rejected();

  // --- Sizing ------------------------------------------------------------------
  const sizing = calculatePositionSize({
    accountEquity: portfolio.equity,
    riskPerTradePct: options.riskPerTradePct ?? limits.maxRiskPerTradePct,
    entry,
    stopLoss,
    currentExposure,
    limits,
  });
  if (!sizing.ok) {
    reasons.push(sizing.error);
    return rejected();
  }

  // Per-asset headroom can shrink the position further than global caps.
  let { quantity, positionValue, maxLoss, riskPctUsed, constraintsApplied } = sizing.value;
  if (assetExposure > 0 && positionValue > assetHeadroom) {
    quantity = assetHeadroom / entry;
    positionValue = assetHeadroom;
    maxLoss = quantity * (entry - stopLoss);
    riskPctUsed = (maxLoss / portfolio.equity) * 100;
    constraintsApplied = [
      ...constraintsApplied,
      `size capped by the ${limits.maxExposurePerAssetPct}% per-asset cap (existing ${opportunity.symbol} exposure)`,
    ];
  }
  // Correlated-cluster headroom can shrink it further still.
  if (hasCorrelationCap && clusterExposure > 0 && positionValue > clusterHeadroom) {
    quantity = clusterHeadroom / entry;
    positionValue = clusterHeadroom;
    maxLoss = quantity * (entry - stopLoss);
    riskPctUsed = (maxLoss / portfolio.equity) * 100;
    constraintsApplied = [
      ...constraintsApplied,
      `size capped by the ${limits.maxCorrelatedExposurePct}% correlated-cluster cap`,
    ];
  }

  if (!(quantity > 0)) {
    reasons.push('position size rounds to zero under the current limits');
    return rejected();
  }

  warnings.push(...constraintsApplied.map((c) => `size capped: ${c}`));
  reasons.push(
    `risking ${maxLoss.toFixed(2)} (${riskPctUsed.toFixed(2)}% of equity) for a ` +
      `${rewardRisk.toFixed(1)}:1 reward/risk — within every configured limit`,
  );

  return {
    approved: true,
    asset: opportunity.symbol,
    entry,
    stopLoss,
    takeProfit,
    positionSize: quantity,
    positionValue,
    riskAmount: maxLoss,
    riskPercentage: riskPctUsed,
    rewardRiskRatio: rewardRisk,
    portfolioExposure: ((currentExposure + positionValue) / portfolio.equity) * 100,
    reasons,
    warnings,
  };
}
