/** Buy & Hold: invest everything at the first candle, sell at the last. */

import type { Strategy } from '../backtest/engine';

export function buyAndHoldStrategy(): Strategy {
  return {
    name: 'Buy & Hold',
    generateOrders(candles) {
      if (candles.length < 2) return [];
      return [
        { index: 0, side: 'buy' },
        { index: candles.length - 1, side: 'sell' },
      ];
    },
  };
}
