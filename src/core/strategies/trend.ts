/**
 * Trend-following strategy: SMA crossover.
 *
 * Buys all-in when the fast SMA crosses above the slow SMA (golden cross),
 * sells the full position on the reverse cross. SMA values come from the
 * indicator engine — no duplicated math.
 */

import type { Strategy, StrategyOrder } from '../backtest/engine';
import { sma } from '../indicators';

export interface TrendOptions {
  readonly fastPeriod: number;
  readonly slowPeriod: number;
}

export function trendStrategy(options: TrendOptions = { fastPeriod: 10, slowPeriod: 30 }): Strategy {
  const { fastPeriod, slowPeriod } = options;
  if (fastPeriod >= slowPeriod) {
    throw new RangeError(`fastPeriod (${fastPeriod}) must be < slowPeriod (${slowPeriod})`);
  }
  return {
    name: `Trend (SMA ${fastPeriod}/${slowPeriod})`,
    generateOrders(candles) {
      const closes = candles.map((c) => c.close);
      const fast = sma(closes, fastPeriod);
      const slow = sma(closes, slowPeriod);
      const orders: StrategyOrder[] = [];
      let inPosition = false;

      for (let i = 1; i < candles.length; i++) {
        const f = fast[i];
        const s = slow[i];
        const fPrev = fast[i - 1];
        const sPrev = slow[i - 1];
        if (f == null || s == null || fPrev == null || sPrev == null) continue;

        const crossedUp = fPrev <= sPrev && f > s;
        const crossedDown = fPrev >= sPrev && f < s;
        if (crossedUp && !inPosition) {
          orders.push({ index: i, side: 'buy' });
          inPosition = true;
        } else if (crossedDown && inPosition) {
          orders.push({ index: i, side: 'sell' });
          inPosition = false;
        }
      }

      if (inPosition && candles.length > 0) {
        orders.push({ index: candles.length - 1, side: 'sell' });
      }
      return orders;
    },
  };
}
