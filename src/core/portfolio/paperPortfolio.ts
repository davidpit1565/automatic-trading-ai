/**
 * Paper trading portfolio.
 *
 * Simulated cash and positions with average-cost accounting, a full trade
 * journal, and persistence through the KeyValueStore abstraction. This is
 * simulation only — it never touches a broker.
 */

import type { KeyValueStore } from '../data/storage';
import type { Result } from '../types';
import { err, ok } from '../types';

export interface PaperPosition {
  readonly symbol: string;
  readonly quantity: number;
  readonly avgCost: number;
}

export interface PaperTrade {
  readonly timestamp: number;
  readonly symbol: string;
  readonly side: 'buy' | 'sell';
  readonly quantity: number;
  readonly price: number;
  /** Realized P&L for sells; 0 for buys. */
  readonly realizedPnl: number;
}

interface PortfolioState {
  cash: number;
  positions: Record<string, { quantity: number; avgCost: number }>;
  trades: PaperTrade[];
  realizedPnl: number;
}

const STORAGE_KEY = 'paper-portfolio';

export class PaperPortfolio {
  private state: PortfolioState;

  constructor(
    private readonly store: KeyValueStore,
    initialCash = 10_000,
  ) {
    if (!(initialCash > 0)) throw new RangeError(`initialCash must be > 0, got ${initialCash}`);
    const saved = store.get<PortfolioState>(STORAGE_KEY);
    this.state = saved ?? { cash: initialCash, positions: {}, trades: [], realizedPnl: 0 };
  }

  get cash(): number {
    return this.state.cash;
  }

  get realizedPnl(): number {
    return this.state.realizedPnl;
  }

  get trades(): readonly PaperTrade[] {
    return this.state.trades;
  }

  positions(): PaperPosition[] {
    return Object.entries(this.state.positions).map(([symbol, p]) => ({
      symbol,
      quantity: p.quantity,
      avgCost: p.avgCost,
    }));
  }

  buy(symbol: string, quantity: number, price: number, timestamp: number): Result<PaperTrade> {
    const guard = validateOrder(symbol, quantity, price);
    if (guard) return err(guard);
    const cost = quantity * price;
    if (cost > this.state.cash + 1e-9) {
      return err(`insufficient cash: need ${cost.toFixed(2)}, have ${this.state.cash.toFixed(2)}`);
    }
    const existing = this.state.positions[symbol] ?? { quantity: 0, avgCost: 0 };
    const newQuantity = existing.quantity + quantity;
    this.state.positions[symbol] = {
      quantity: newQuantity,
      avgCost: (existing.avgCost * existing.quantity + cost) / newQuantity,
    };
    this.state.cash -= cost;
    const trade: PaperTrade = { timestamp, symbol, side: 'buy', quantity, price, realizedPnl: 0 };
    this.state.trades.push(trade);
    this.persist();
    return ok(trade);
  }

  sell(symbol: string, quantity: number, price: number, timestamp: number): Result<PaperTrade> {
    const guard = validateOrder(symbol, quantity, price);
    if (guard) return err(guard);
    const position = this.state.positions[symbol];
    if (!position || position.quantity + 1e-12 < quantity) {
      return err(
        `insufficient position in ${symbol}: have ${position?.quantity ?? 0}, want to sell ${quantity}`,
      );
    }
    const realizedPnl = (price - position.avgCost) * quantity;
    const remaining = position.quantity - quantity;
    if (remaining < 1e-12) {
      delete this.state.positions[symbol];
    } else {
      this.state.positions[symbol] = { quantity: remaining, avgCost: position.avgCost };
    }
    this.state.cash += quantity * price;
    this.state.realizedPnl += realizedPnl;
    const trade: PaperTrade = { timestamp, symbol, side: 'sell', quantity, price, realizedPnl };
    this.state.trades.push(trade);
    this.persist();
    return ok(trade);
  }

  /** Total equity given current market prices; unknown symbols valued at cost. */
  equity(prices: Readonly<Record<string, number>>): number {
    let total = this.state.cash;
    for (const [symbol, position] of Object.entries(this.state.positions)) {
      const price = prices[symbol] ?? position.avgCost;
      total += position.quantity * price;
    }
    return total;
  }

  /** Unrealized P&L for currently open positions at the given prices. */
  unrealizedPnl(prices: Readonly<Record<string, number>>): number {
    let total = 0;
    for (const [symbol, position] of Object.entries(this.state.positions)) {
      const price = prices[symbol] ?? position.avgCost;
      total += (price - position.avgCost) * position.quantity;
    }
    return total;
  }

  reset(initialCash: number): void {
    if (!(initialCash > 0)) throw new RangeError(`initialCash must be > 0, got ${initialCash}`);
    this.state = { cash: initialCash, positions: {}, trades: [], realizedPnl: 0 };
    this.persist();
  }

  private persist(): void {
    this.store.set(STORAGE_KEY, this.state);
  }
}

function validateOrder(symbol: string, quantity: number, price: number): string | null {
  if (symbol.trim() === '') return 'symbol must not be empty';
  if (!(quantity > 0) || !Number.isFinite(quantity)) return `quantity must be > 0, got ${quantity}`;
  if (!(price > 0) || !Number.isFinite(price)) return `price must be > 0, got ${price}`;
  return null;
}
