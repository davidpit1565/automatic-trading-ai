/**
 * Grid strategy simulation.
 *
 * Evenly spaced price levels between lower and upper bounds. When the close
 * crosses below an unfilled level, buy a fixed quote amount at that level's
 * slot; when the close crosses back above the level directly above a filled
 * slot, sell that slot. Remaining slots are liquidated on the final candle
 * so results are comparable across strategies.
 */

import type { Strategy, StrategyOrder } from '../backtest/engine';

export interface GridOptions {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly levels: number;
  readonly amountPerLevel: number;
}

export function computeGridLevels(lowerBound: number, upperBound: number, levels: number): number[] {
  if (!(lowerBound > 0) || !(upperBound > lowerBound)) {
    throw new RangeError(`invalid grid bounds: [${lowerBound}, ${upperBound}]`);
  }
  if (!Number.isInteger(levels) || levels < 2) {
    throw new RangeError(`levels must be an integer >= 2, got ${levels}`);
  }
  const step = (upperBound - lowerBound) / (levels - 1);
  return Array.from({ length: levels }, (_, i) => lowerBound + i * step);
}

export function gridStrategy(options: GridOptions): Strategy {
  const { lowerBound, upperBound, levels, amountPerLevel } = options;
  const gridLevels = computeGridLevels(lowerBound, upperBound, levels);
  if (!(amountPerLevel > 0)) {
    throw new RangeError(`amountPerLevel must be > 0, got ${amountPerLevel}`);
  }
  return {
    name: `Grid (${levels} levels ${lowerBound}-${upperBound})`,
    generateOrders(candles) {
      if (candles.length < 2) return [];
      const filled: boolean[] = new Array(gridLevels.length).fill(false);
      const orders: StrategyOrder[] = [];
      let anyFilled = false;

      for (let i = 1; i < candles.length; i++) {
        const previousClose = candles[i - 1]!.close;
        const close = candles[i]!.close;

        for (let level = 0; level < gridLevels.length; level++) {
          const price = gridLevels[level]!;
          // Price crossed down through an unfilled level: buy the slot.
          if (!filled[level] && previousClose > price && close <= price) {
            orders.push({ index: i, side: 'buy', amountQuote: amountPerLevel });
            filled[level] = true;
            anyFilled = true;
          }
        }
        for (let level = gridLevels.length - 2; level >= 0; level--) {
          const sellPrice = gridLevels[level + 1]!;
          // Price crossed up through the level above a filled slot: take profit.
          if (filled[level] && previousClose < sellPrice && close >= sellPrice) {
            const filledCount = filled.filter(Boolean).length;
            orders.push({ index: i, side: 'sell', fractionOfPosition: 1 / filledCount });
            filled[level] = false;
          }
        }
      }

      if (anyFilled && filled.some(Boolean)) {
        orders.push({ index: candles.length - 1, side: 'sell' });
      }
      return orders;
    },
  };
}
