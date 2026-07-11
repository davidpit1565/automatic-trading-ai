/**
 * Position Engine — Stage 5.
 *
 * Maintains open positions through their lifecycle: open (from an approved
 * trade proposal), partial exits, full close. Tracks realized/unrealized
 * P&L, fees, holding time, and price excursions (MFE/MAE). On full close it
 * writes exactly one journal entry summarising the trade.
 *
 * The engine consumes existing trade proposals (TradeRiskAssessment) — it
 * contains no trading logic, no market analysis, and no execution
 * capability. It never closes a position by itself.
 */

import type { KeyValueStore } from '../data/storage';
import type { TradeRiskAssessment } from '../risk/riskEngine';
import type { Result } from '../types';
import { err, ok } from '../types';
import type { RobustnessVerdict } from '../validation/robustness';
import { TradeJournal, type ExitReason } from './tradeJournal';

export interface OpenPosition {
  readonly id: string;
  readonly symbol: string;
  readonly openedAt: number;
  readonly entryPrice: number;
  /** Remaining quantity after partial exits. */
  readonly quantity: number;
  readonly initialQuantity: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  /** All fees paid so far (open + partial exits). */
  readonly feesPaid: number;
  /** Realized P&L from partial exits, net of their fees. */
  readonly realizedPnl: number;
  /** Highest/lowest prices observed since entry (for MFE/MAE). */
  readonly highestPrice: number;
  readonly lowestPrice: number;
  readonly confidence: number | null;
  readonly validationVerdict: RobustnessVerdict | 'not-run' | null;
  readonly strategyVersion: string | null;
  readonly notes: string | null;
}

export interface OpenInput {
  readonly symbol: string;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly timestamp: number;
  readonly fee?: number;
  readonly confidence?: number;
  readonly validationVerdict?: RobustnessVerdict | 'not-run';
  readonly strategyVersion?: string;
  readonly notes?: string;
}

export interface ExitInput {
  readonly quantity: number;
  readonly price: number;
  readonly timestamp: number;
  readonly reason: ExitReason;
  readonly fee?: number;
  readonly slippage?: number;
}

interface ExitLeg {
  quantity: number;
  price: number;
  fee: number;
  slippage: number;
}

interface PositionState extends OpenPosition {
  exits: ExitLeg[];
}

const STORAGE_KEY = 'open-positions';

export class PositionEngine {
  private positions: PositionState[];

  constructor(
    private readonly store: KeyValueStore,
    private readonly journal: TradeJournal,
  ) {
    this.positions = store.get<PositionState[]>(STORAGE_KEY) ?? [];
  }

  /** Open a position from an approved Risk Engine assessment. */
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

  open(input: OpenInput): Result<OpenPosition> {
    if (input.symbol.trim() === '') return err('symbol must not be empty');
    if (!(input.quantity > 0)) return err(`quantity must be > 0, got ${input.quantity}`);
    if (!(input.entryPrice > 0)) return err(`entryPrice must be > 0, got ${input.entryPrice}`);
    if (!(input.stopLoss > 0) || input.stopLoss >= input.entryPrice) {
      return err(`stopLoss must be positive and below entry (${input.stopLoss} vs ${input.entryPrice})`);
    }
    if ((input.fee ?? 0) < 0) return err('fee cannot be negative');

    const position: PositionState = {
      id: `${input.symbol}:${input.timestamp}:${this.positions.length}`,
      symbol: input.symbol,
      openedAt: input.timestamp,
      entryPrice: input.entryPrice,
      quantity: input.quantity,
      initialQuantity: input.quantity,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      feesPaid: input.fee ?? 0,
      realizedPnl: 0,
      highestPrice: input.entryPrice,
      lowestPrice: input.entryPrice,
      confidence: input.confidence ?? null,
      validationVerdict: input.validationVerdict ?? null,
      strategyVersion: input.strategyVersion ?? null,
      notes: input.notes ?? null,
      exits: [],
    };
    this.positions.push(position);
    this.persist();
    return ok(toPublic(position));
  }

  /** Partial or full exit. A full exit closes the position into the journal. */
  exit(id: string, input: ExitInput): Result<OpenPosition | null> {
    const index = this.positions.findIndex((p) => p.id === id);
    if (index === -1) return err(`unknown position '${id}'`);
    const position = this.positions[index]!;
    if (!(input.quantity > 0) || input.quantity > position.quantity + 1e-12) {
      return err(
        `invalid exit quantity ${input.quantity}: position holds ${position.quantity}`,
      );
    }
    if (!(input.price > 0)) return err(`price must be > 0, got ${input.price}`);
    const fee = input.fee ?? 0;
    if (fee < 0) return err('fee cannot be negative');

    // Exit price counts toward excursion extremes too.
    const highestPrice = Math.max(position.highestPrice, input.price);
    const lowestPrice = Math.min(position.lowestPrice, input.price);
    const legPnl = (input.price - position.entryPrice) * input.quantity - fee;
    const remaining = position.quantity - input.quantity;
    const updated: PositionState = {
      ...position,
      quantity: remaining,
      feesPaid: position.feesPaid + fee,
      realizedPnl: position.realizedPnl + legPnl,
      highestPrice,
      lowestPrice,
      exits: [
        ...position.exits,
        { quantity: input.quantity, price: input.price, fee, slippage: input.slippage ?? 0 },
      ],
    };

    if (remaining > 1e-12) {
      this.positions[index] = updated;
      this.persist();
      return ok(toPublic(updated));
    }

    // Fully closed: remove from open set and journal the completed trade.
    this.positions.splice(index, 1);
    this.persist();
    this.journal.append(buildJournalEntry(updated, input));
    return ok(null);
  }

  /** Track price extremes for MFE/MAE while positions are open. */
  updateMarketPrice(symbol: string, price: number, _timestamp: number): void {
    if (!(price > 0)) return;
    let changed = false;
    this.positions = this.positions.map((position) => {
      if (position.symbol !== symbol) return position;
      const highestPrice = Math.max(position.highestPrice, price);
      const lowestPrice = Math.min(position.lowestPrice, price);
      if (highestPrice === position.highestPrice && lowestPrice === position.lowestPrice) {
        return position;
      }
      changed = true;
      return { ...position, highestPrice, lowestPrice };
    });
    if (changed) this.persist();
  }

  openPositions(): OpenPosition[] {
    return this.positions.map(toPublic);
  }

  /** Unrealized P&L at the given prices; unknown symbols valued at entry. */
  unrealizedPnl(prices: Readonly<Record<string, number>>): number {
    return this.positions.reduce((sum, position) => {
      const price = prices[position.symbol] ?? position.entryPrice;
      return sum + (price - position.entryPrice) * position.quantity;
    }, 0);
  }

  /** Realized P&L accumulated on still-open positions (partial exits). */
  openRealizedPnl(): number {
    return this.positions.reduce((sum, p) => sum + p.realizedPnl, 0);
  }

  private persist(): void {
    this.store.set(STORAGE_KEY, this.positions);
  }
}

function toPublic(state: PositionState): OpenPosition {
  const { exits: _exits, ...position } = state;
  return position;
}

function buildJournalEntry(position: PositionState, finalExit: ExitInput) {
  const exitedQuantity = position.exits.reduce((sum, leg) => sum + leg.quantity, 0);
  const weightedExit =
    position.exits.reduce((sum, leg) => sum + leg.price * leg.quantity, 0) / exitedQuantity;
  const invested = position.entryPrice * position.initialQuantity;
  return {
    id: position.id,
    symbol: position.symbol,
    entryTimestamp: position.openedAt,
    exitTimestamp: finalExit.timestamp,
    entryPrice: position.entryPrice,
    exitPrice: weightedExit,
    positionSize: position.initialQuantity,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    exitReason: finalExit.reason,
    fees: position.feesPaid,
    slippage: position.exits.reduce((sum, leg) => sum + leg.slippage, 0),
    holdingDurationMs: finalExit.timestamp - position.openedAt,
    mfePct: ((position.highestPrice - position.entryPrice) / position.entryPrice) * 100,
    maePct: ((position.entryPrice - position.lowestPrice) / position.entryPrice) * 100,
    realizedPnl: position.realizedPnl,
    returnPct: invested > 0 ? (position.realizedPnl / invested) * 100 : 0,
    strategyVersion: position.strategyVersion,
    validationVerdict: position.validationVerdict,
    confidence: position.confidence,
    notes: position.notes,
  };
}
