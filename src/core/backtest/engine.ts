/**
 * Backtesting engine.
 *
 * Simulates a single-instrument portfolio over historical candles.
 * Strategies emit orders per candle index; the engine executes them at that
 * candle's close (deducting fees), tracks the equity curve, and records
 * round-trip trades using average cost basis. Strategies never touch
 * portfolio state directly — strict Strategy -> Backtesting separation.
 */

import type { Candle } from '../types';
import {
  maxDrawdownPct,
  totalReturnPct,
  tradeStats,
  type ClosedTrade,
  type EquityPoint,
  type TradeStats,
} from './metrics';

export interface StrategyOrder {
  /** Candle index at which the order executes (at close). */
  readonly index: number;
  readonly side: 'buy' | 'sell';
  /** For buys: quote currency to spend (clamped to available cash). */
  readonly amountQuote?: number;
  /** For sells: fraction of the current position to sell, default 1 (all). */
  readonly fractionOfPosition?: number;
}

export interface Strategy {
  readonly name: string;
  generateOrders(candles: readonly Candle[]): StrategyOrder[];
}

export interface BacktestConfig {
  readonly initialCash: number;
  /** Proportional fee per fill, e.g. 0.001 = 0.1%. */
  readonly feeRate?: number;
}

export interface BacktestResult {
  readonly strategyName: string;
  readonly initialCash: number;
  readonly finalEquity: number;
  readonly totalReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly feesPaid: number;
  readonly equityCurve: EquityPoint[];
  readonly closedTrades: ClosedTrade[];
  readonly stats: TradeStats;
}

export function runBacktest(
  candles: readonly Candle[],
  strategy: Strategy,
  config: BacktestConfig,
): BacktestResult {
  if (candles.length === 0) throw new RangeError('cannot backtest an empty candle series');
  if (!(config.initialCash > 0)) {
    throw new RangeError(`initialCash must be > 0, got ${config.initialCash}`);
  }
  const feeRate = config.feeRate ?? 0;
  if (feeRate < 0 || feeRate >= 1) throw new RangeError(`feeRate must be in [0, 1), got ${feeRate}`);

  // Orders grouped by candle index; invalid indices are a strategy bug.
  const ordersByIndex = new Map<number, StrategyOrder[]>();
  for (const order of strategy.generateOrders(candles)) {
    if (!Number.isInteger(order.index) || order.index < 0 || order.index >= candles.length) {
      throw new RangeError(`strategy '${strategy.name}' emitted invalid order index ${order.index}`);
    }
    const bucket = ordersByIndex.get(order.index) ?? [];
    bucket.push(order);
    ordersByIndex.set(order.index, bucket);
  }

  let cash = config.initialCash;
  let quantity = 0;
  let avgCost = 0;
  let feesPaid = 0;
  let entryTimestamp = 0;
  const closedTrades: ClosedTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    const price = candle.close;

    for (const order of ordersByIndex.get(i) ?? []) {
      if (order.side === 'buy') {
        const spend = Math.min(order.amountQuote ?? cash, cash);
        if (spend <= 0 || price <= 0) continue;
        const fee = spend * feeRate;
        const bought = (spend - fee) / price;
        if (quantity === 0) entryTimestamp = candle.timestamp;
        avgCost = (avgCost * quantity + price * bought) / (quantity + bought);
        quantity += bought;
        cash -= spend;
        feesPaid += fee;
      } else {
        const fraction = order.fractionOfPosition ?? 1;
        if (fraction <= 0 || quantity === 0) continue;
        const sellQuantity = quantity * Math.min(fraction, 1);
        const gross = sellQuantity * price;
        const fee = gross * feeRate;
        cash += gross - fee;
        feesPaid += fee;
        closedTrades.push({
          entryTimestamp,
          exitTimestamp: candle.timestamp,
          entryPrice: avgCost,
          exitPrice: price,
          quantity: sellQuantity,
          pnl: (price - avgCost) * sellQuantity - fee,
        });
        quantity -= sellQuantity;
        if (quantity < 1e-12) {
          quantity = 0;
          avgCost = 0;
        }
      }
    }

    equityCurve.push({ timestamp: candle.timestamp, equity: cash + quantity * price });
  }

  const finalEquity = equityCurve[equityCurve.length - 1]!.equity;
  return {
    strategyName: strategy.name,
    initialCash: config.initialCash,
    finalEquity,
    totalReturnPct: totalReturnPctFromCash(config.initialCash, finalEquity),
    maxDrawdownPct: maxDrawdownPct(equityCurve),
    feesPaid,
    equityCurve,
    closedTrades,
    stats: tradeStats(closedTrades),
  };
}

/** Return vs initial cash (the equity curve starts after the first candle). */
function totalReturnPctFromCash(initialCash: number, finalEquity: number): number {
  return ((finalEquity - initialCash) / initialCash) * 100;
}

/** Run several strategies over the same data and config for comparison. */
export function compareStrategies(
  candles: readonly Candle[],
  strategies: readonly Strategy[],
  config: BacktestConfig,
): BacktestResult[] {
  return strategies.map((strategy) => runBacktest(candles, strategy, config));
}

export { totalReturnPct, maxDrawdownPct, tradeStats } from './metrics';
export type { ClosedTrade, EquityPoint, TradeStats } from './metrics';
