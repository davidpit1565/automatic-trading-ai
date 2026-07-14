/**
 * Dollar Cost Averaging: split the initial capital into equal purchases at a
 * fixed candle interval, then liquidate at the final candle so results are
 * comparable with other strategies.
 */

import type { Strategy } from '../backtest/engine';

export interface DcaOptions {
  /** Buy every N candles. */
  readonly intervalCandles: number;
  /** Quote amount per purchase. */
  readonly amountPerPurchase: number;
}

export function dcaStrategy(options: DcaOptions): Strategy {
  const { intervalCandles, amountPerPurchase } = options;
  if (!Number.isInteger(intervalCandles) || intervalCandles < 1) {
    throw new RangeError(`intervalCandles must be a positive integer, got ${intervalCandles}`);
  }
  if (!(amountPerPurchase > 0)) {
    throw new RangeError(`amountPerPurchase must be > 0, got ${amountPerPurchase}`);
  }
  return {
    name: `DCA (every ${intervalCandles}, ${amountPerPurchase}/buy)`,
    generateOrders(candles) {
      if (candles.length < 2) return [];
      const orders = [];
      for (let i = 0; i < candles.length - 1; i += intervalCandles) {
        orders.push({ index: i, side: 'buy' as const, amountQuote: amountPerPurchase });
      }
      orders.push({ index: candles.length - 1, side: 'sell' as const });
      return orders;
    },
  };
}
