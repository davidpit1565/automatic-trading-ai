/**
 * Live-pipeline backtest harness.
 *
 * Replays the EXACT decision pipeline the paper autopilot runs live —
 * scanner -> signal engine -> (optional) higher-timeframe gate -> risk engine
 * -> open, then stop-loss / take-profit exits — bar by bar over historical
 * candles. It reuses the real pure functions (`scanCandles`, `evaluateScan`,
 * `applyHigherTimeframeGate`, `assessTrade`); it invents NO indicator, scoring,
 * or sizing math of its own. This is what lets us measure a strategy change
 * against a faithful baseline instead of guessing.
 *
 * Deliberate, documented deviations from `paperAutoPilot.runCycleOnce`:
 *  - Exits are checked INTRABAR (low <= stop, high >= target) rather than on
 *    the candle close. This is the honest backtest convention: within a bar a
 *    stop is hit before we could ever have acted on the close, so close-only
 *    exits would flatter results. Stop is checked before target (conservative:
 *    if a bar spans both, we assume the loss).
 *  - A single position at a time (the autopilot holds <=1 per symbol; this
 *    harness runs one symbol, so the portfolio is flat or holds exactly one).
 *  - Higher-timeframe confirmation: the caller passes the higher-TF candles;
 *    at each entry decision we build the higher-TF ScanResult from the trailing
 *    window of higher candles whose open time is <= the current bar's open time
 *    (no look-ahead), then apply the same `applyHigherTimeframeGate`.
 *
 * Pure: no I/O, no clock, no randomness. Same candles in -> same result out.
 */

import { assessTrade, DEFAULT_RISK_LIMITS, type RiskLimits } from '../risk/riskEngine';
import { DEFAULT_SCANNER_CONFIG, scanCandles, type ScanResult } from '../scan/marketScanner';
import { applyHigherTimeframeGate } from '../signal/multiTimeframe';
import {
  DEFAULT_SIGNAL_CRITERIA,
  evaluateScan,
  type SignalCriteria,
} from '../signal/signalEngine';
import type { Candle, Timeframe } from '../types';
import {
  maxDrawdownPct,
  tradeStats,
  type ClosedTrade,
  type EquityPoint,
  type TradeStats,
} from './metrics';

/** Default conviction floor, mirroring AUTOPILOT_MIN_CONFIDENCE in production. */
export const DEFAULT_MIN_CONFIDENCE = 20;

export interface LivePipelineOptions {
  readonly symbol: string;
  readonly timeframe: Timeframe;
  /** Starting cash in quote currency. Default 10000. */
  readonly initialCash?: number;
  /** Per-side cost (fee + slippage) as a fraction of notional. Default 0.003. */
  readonly costRate?: number;
  /** Signal criteria overrides merged over DEFAULT_SIGNAL_CRITERIA. */
  readonly criteria?: Partial<SignalCriteria>;
  /** Conviction floor for entries (0..MAX_CONFIDENCE). Default 20. */
  readonly minConfidence?: number;
  /** Risk limits for the risk engine. Default DEFAULT_RISK_LIMITS. */
  readonly riskLimits?: RiskLimits;
  /** Trailing window of candles fed to the scanner each bar. Default 150. */
  readonly scanWindow?: number;
  /** Higher-timeframe candles for confirmation. When set, the gate is applied. */
  readonly higherCandles?: readonly Candle[];
  /** Timeframe of `higherCandles` (for the scan). Default '4h' when supplied. */
  readonly confirmationTimeframe?: Timeframe;
}

/** A closed trade enriched with the exit reason (superset of ClosedTrade). */
export interface LivePipelineTrade extends ClosedTrade {
  readonly reason: 'stop-loss' | 'take-profit' | 'liquidation';
}

/** BacktestResult-compatible so `performanceReport(result, timeframe)` works. */
export interface LivePipelineResult {
  readonly strategyName: string;
  readonly symbol: string;
  readonly initialCash: number;
  readonly finalEquity: number;
  readonly totalReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly feesPaid: number;
  readonly equityCurve: EquityPoint[];
  readonly closedTrades: LivePipelineTrade[];
  readonly stats: TradeStats;
}

interface OpenPosition {
  readonly entryPrice: number;
  readonly quantity: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly entryTimestamp: number;
  /** Entry fee already paid, carried so trade P&L is net of both sides. */
  readonly entryFee: number;
}

/**
 * Build the higher-timeframe ScanResult as of `currentTimestamp`, with no
 * look-ahead: only higher candles whose open time is at or before the current
 * bar are considered, and the trailing `scanWindow` of those is scanned.
 * Returns null when there is no confirmation data or not enough of it.
 */
function higherScanAt(
  symbol: string,
  confirmationTimeframe: Timeframe,
  higherCandles: readonly Candle[],
  currentTimestamp: number,
  scanWindow: number,
): ScanResult | null {
  const available: Candle[] = [];
  for (const candle of higherCandles) {
    if (candle.timestamp <= currentTimestamp) available.push(candle);
    else break; // candles are chronological; nothing later can qualify
  }
  if (available.length < DEFAULT_SCANNER_CONFIG.minCandles) return null;
  const window = available.slice(-scanWindow);
  const scan = scanCandles(symbol, confirmationTimeframe, window);
  return scan.ok ? scan.value : null;
}

/**
 * Replay the live autopilot decision pipeline over `candles` and return a
 * BacktestResult-compatible summary. Reuses the production pure functions.
 */
export function runLivePipelineBacktest(
  candles: readonly Candle[],
  options: LivePipelineOptions,
): LivePipelineResult {
  const initialCash = options.initialCash ?? 10_000;
  const costRate = options.costRate ?? 0.003;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const riskLimits = options.riskLimits ?? DEFAULT_RISK_LIMITS;
  const scanWindow = options.scanWindow ?? 150;
  const confirmationTimeframe = options.confirmationTimeframe ?? '4h';
  const criteria: SignalCriteria = {
    ...DEFAULT_SIGNAL_CRITERIA,
    ...options.criteria,
    minConfidence,
  };

  const strategyName = `live-pipeline:${options.symbol}`;
  const equityCurve: EquityPoint[] = [];
  const closedTrades: LivePipelineTrade[] = [];

  if (candles.length < scanWindow) {
    // Not enough history to make a single decision — return a flat, honest result.
    return {
      strategyName,
      symbol: options.symbol,
      initialCash,
      finalEquity: initialCash,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      feesPaid: 0,
      equityCurve: candles.map((c) => ({ timestamp: c.timestamp, equity: initialCash })),
      closedTrades,
      stats: tradeStats(closedTrades),
    };
  }

  let cash = initialCash;
  let feesPaid = 0;
  let position: OpenPosition | null = null;

  for (let i = scanWindow - 1; i < candles.length; i++) {
    const bar = candles[i]!;

    if (position !== null) {
      // --- Exit check first: protect the open position (intrabar). ----------
      let exitPrice: number | null = null;
      let reason: 'stop-loss' | 'take-profit' | null = null;
      if (bar.low <= position.stopLoss) {
        exitPrice = position.stopLoss;
        reason = 'stop-loss';
      } else if (bar.high >= position.takeProfit) {
        exitPrice = position.takeProfit;
        reason = 'take-profit';
      }

      if (exitPrice !== null && reason !== null) {
        const exitFee = position.quantity * exitPrice * costRate;
        cash += position.quantity * exitPrice - exitFee;
        feesPaid += exitFee;
        closedTrades.push({
          entryTimestamp: position.entryTimestamp,
          exitTimestamp: bar.timestamp,
          entryPrice: position.entryPrice,
          exitPrice,
          quantity: position.quantity,
          pnl: (exitPrice - position.entryPrice) * position.quantity - position.entryFee - exitFee,
          reason,
        });
        position = null;
      }
    } else {
      // --- Flat: run the full entry pipeline on the trailing window. ---------
      const window = candles.slice(i - scanWindow + 1, i + 1);
      const scan = scanCandles(options.symbol, options.timeframe, window);
      if (scan.ok) {
        let decision = evaluateScan(scan.value, criteria);
        if (decision.kind === 'opportunity' && options.higherCandles) {
          decision = applyHigherTimeframeGate(
            decision,
            higherScanAt(
              options.symbol,
              confirmationTimeframe,
              options.higherCandles,
              bar.timestamp,
              scanWindow,
            ),
          );
        }
        if (decision.kind === 'opportunity') {
          const equityNow = cash; // flat, so equity == cash
          const assessment = assessTrade(
            decision.opportunity,
            { equity: equityNow, openPositions: [] },
            { limits: riskLimits },
          );
          if (assessment.approved && assessment.positionSize > 0) {
            const entryPrice = bar.close;
            const quantity = assessment.positionSize;
            const entryFee = quantity * entryPrice * costRate;
            cash -= quantity * entryPrice + entryFee;
            feesPaid += entryFee;
            position = {
              entryPrice,
              quantity,
              stopLoss: assessment.stopLoss,
              takeProfit: assessment.takeProfit,
              entryTimestamp: bar.timestamp,
              entryFee,
            };
          }
        }
      }
    }

    const equity = cash + (position !== null ? position.quantity * bar.close : 0);
    equityCurve.push({ timestamp: bar.timestamp, equity });
  }

  // --- Liquidate any position still open at the final close (realize P&L). --
  if (position !== null && candles.length > 0) {
    const last = candles[candles.length - 1]!;
    const exitPrice = last.close;
    const exitFee = position.quantity * exitPrice * costRate;
    cash += position.quantity * exitPrice - exitFee;
    feesPaid += exitFee;
    closedTrades.push({
      entryTimestamp: position.entryTimestamp,
      exitTimestamp: last.timestamp,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      pnl: (exitPrice - position.entryPrice) * position.quantity - position.entryFee - exitFee,
      reason: 'liquidation',
    });
    position = null;
    // Replace the last (unrealized) equity point with the realized cash.
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = { timestamp: last.timestamp, equity: cash };
    }
  }

  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1]!.equity : cash;

  return {
    strategyName,
    symbol: options.symbol,
    initialCash,
    finalEquity,
    totalReturnPct: ((finalEquity - initialCash) / initialCash) * 100,
    maxDrawdownPct: maxDrawdownPct(equityCurve),
    feesPaid,
    equityCurve,
    closedTrades,
    stats: tradeStats(closedTrades),
  };
}
