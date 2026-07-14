/**
 * Portfolio Engine — Stage 5.
 *
 * Owns cash and wraps the Position Engine so money and positions always
 * move together. Produces portfolio snapshots: equity, invested capital,
 * P&L, exposure, allocation, daily return (anchored to the first snapshot
 * of each UTC day), with a configurable base currency label.
 */

import type { KeyValueStore } from '../data/storage';
import type { TradeRiskAssessment } from '../risk/riskEngine';
import type { Result } from '../types';
import { err } from '../types';
import type { RobustnessVerdict } from '../validation/robustness';
import { PositionEngine, type ExitInput, type OpenInput, type OpenPosition } from './positionEngine';

export interface PortfolioConfig {
  readonly initialCash: number;
  readonly baseCurrency: string;
}

export interface AllocationSlice {
  readonly symbol: string;
  readonly marketValue: number;
  readonly pctOfEquity: number;
}

export interface PortfolioSnapshot {
  readonly timestamp: number;
  readonly baseCurrency: string;
  readonly equity: number;
  readonly cash: number;
  readonly cashAvailable: number;
  readonly investedValue: number;
  readonly unrealizedPnl: number;
  readonly realizedPnl: number;
  readonly totalReturnPct: number;
  readonly dailyPnl: number;
  readonly dailyReturnPct: number;
  readonly exposurePct: number;
  readonly largestPosition: AllocationSlice | null;
  readonly allocation: AllocationSlice[];
  readonly openPositionCount: number;
}

interface PortfolioState {
  cash: number;
  initialCash: number;
  baseCurrency: string;
  /** Cumulative realized P&L from fully closed trades. */
  closedRealizedPnl: number;
  /** Daily return anchor: first-equity-of-day per UTC day. */
  dayAnchor: { day: string; equity: number } | null;
}

const STORAGE_KEY = 'portfolio-engine';

function utcDayOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export class PortfolioEngine {
  private state: PortfolioState;

  constructor(
    private readonly store: KeyValueStore,
    private readonly positions: PositionEngine,
    config: PortfolioConfig,
  ) {
    if (!(config.initialCash > 0)) {
      throw new RangeError(`initialCash must be > 0, got ${config.initialCash}`);
    }
    // Saved state wins over constructor defaults (single source of truth).
    this.state = this.store.get<PortfolioState>(STORAGE_KEY) ?? {
      cash: config.initialCash,
      initialCash: config.initialCash,
      baseCurrency: config.baseCurrency,
      closedRealizedPnl: 0,
      dayAnchor: null,
    };
  }

  cash(): number {
    return this.state.cash;
  }

  openPositions(): OpenPosition[] {
    return this.positions.openPositions();
  }

  /** Open from an approved Risk Engine proposal, deducting cash. */
  openFromAssessment(
    assessment: TradeRiskAssessment,
    context: {
      timestamp: number;
      fee?: number;
      confidence?: number;
      validationVerdict?: RobustnessVerdict | 'not-run';
      strategyVersion?: string;
      notes?: string;
    },
  ): Result<OpenPosition> {
    if (!assessment.approved) {
      return err('only approved trade proposals can be opened — this assessment was refused');
    }
    return this.open({
      symbol: assessment.asset,
      quantity: assessment.positionSize,
      entryPrice: assessment.entry,
      stopLoss: assessment.stopLoss,
      takeProfit: assessment.takeProfit,
      timestamp: context.timestamp,
      fee: context.fee,
      confidence: context.confidence,
      validationVerdict: context.validationVerdict,
      strategyVersion: context.strategyVersion,
      notes: context.notes,
    });
  }

  /** Open a position, deducting cost and fee from cash. */
  open(input: OpenInput): Result<OpenPosition> {
    const cost = input.quantity * input.entryPrice + (input.fee ?? 0);
    if (cost > this.state.cash + 1e-9) {
      return err(
        `insufficient cash: need ${cost.toFixed(2)}, have ${this.state.cash.toFixed(2)}`,
      );
    }
    const opened = this.positions.open(input);
    if (!opened.ok) return opened;
    this.state.cash -= cost;
    this.persist();
    return opened;
  }

  /** Exit (partially or fully), crediting proceeds minus fee to cash. */
  exit(id: string, input: ExitInput): Result<OpenPosition | null> {
    const before = this.positions.openPositions().find((p) => p.id === id);
    const result = this.positions.exit(id, input);
    if (!result.ok) return result;
    this.state.cash += input.quantity * input.price - (input.fee ?? 0);
    if (result.value === null && before !== undefined) {
      // Fully closed: fold its realized P&L into the portfolio total.
      const legPnl = (input.price - before.entryPrice) * input.quantity - (input.fee ?? 0);
      this.state.closedRealizedPnl += before.realizedPnl + legPnl;
    }
    this.persist();
    return result;
  }

  snapshot(prices: Readonly<Record<string, number>>, timestamp: number): PortfolioSnapshot {
    const open = this.positions.openPositions();
    const allocation: AllocationSlice[] = open
      .map((position) => {
        const price = prices[position.symbol] ?? position.entryPrice;
        return { symbol: position.symbol, marketValue: position.quantity * price, pctOfEquity: 0 };
      })
      .sort((a, b) => b.marketValue - a.marketValue);

    const investedValue = allocation.reduce((sum, slice) => sum + slice.marketValue, 0);
    const equity = this.state.cash + investedValue;
    const withPct = allocation.map((slice) => ({
      ...slice,
      pctOfEquity: equity > 0 ? (slice.marketValue / equity) * 100 : 0,
    }));

    // Anchor daily return to the first snapshot of each UTC day.
    const day = utcDayOf(timestamp);
    if (this.state.dayAnchor === null || this.state.dayAnchor.day !== day) {
      this.state.dayAnchor = { day, equity };
      this.persist();
    }
    const dayStart = this.state.dayAnchor.equity;

    const realizedPnl = this.state.closedRealizedPnl + this.positions.openRealizedPnl();
    return {
      timestamp,
      baseCurrency: this.state.baseCurrency,
      equity,
      cash: this.state.cash,
      cashAvailable: this.state.cash,
      investedValue,
      unrealizedPnl: this.positions.unrealizedPnl(prices),
      realizedPnl,
      totalReturnPct: ((equity - this.state.initialCash) / this.state.initialCash) * 100,
      dailyPnl: equity - dayStart,
      dailyReturnPct: dayStart > 0 ? ((equity - dayStart) / dayStart) * 100 : 0,
      exposurePct: equity > 0 ? (investedValue / equity) * 100 : 0,
      largestPosition: withPct[0] ?? null,
      allocation: withPct,
      openPositionCount: open.length,
    };
  }

  private persist(): void {
    this.store.set(STORAGE_KEY, this.state);
  }
}
