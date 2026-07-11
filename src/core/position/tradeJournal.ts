/**
 * Trade Journal — Stage 5.
 *
 * Structured, append-only record of every completed trade. Entries are
 * validated on write and never overwritten; duplicate ids are refused.
 */

import type { KeyValueStore } from '../data/storage';
import type { RobustnessVerdict } from '../validation/robustness';

export type ExitReason = 'manual' | 'stop-loss' | 'take-profit' | 'signal-exit' | 'other';

export interface JournalEntry {
  readonly id: string;
  readonly symbol: string;
  readonly entryTimestamp: number;
  readonly exitTimestamp: number;
  readonly entryPrice: number;
  /** Weighted average exit price across all (partial) exits. */
  readonly exitPrice: number;
  /** Initial position size in units. */
  readonly positionSize: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  /** Reason of the final exit that closed the position. */
  readonly exitReason: ExitReason;
  /** All fees paid over the position's life (open + every exit). */
  readonly fees: number;
  readonly slippage: number;
  readonly holdingDurationMs: number;
  /** Maximum favourable excursion, % above entry. */
  readonly mfePct: number;
  /** Maximum adverse excursion, % below entry. */
  readonly maePct: number;
  /** Net realized P&L including exit fees (open fee reported in `fees`). */
  readonly realizedPnl: number;
  readonly returnPct: number;
  readonly strategyVersion: string | null;
  readonly validationVerdict: RobustnessVerdict | 'not-run' | null;
  readonly confidence: number | null;
  readonly notes: string | null;
}

const STORAGE_KEY = 'trade-journal';

export class TradeJournal {
  private records: JournalEntry[];

  constructor(private readonly store: KeyValueStore) {
    this.records = store.get<JournalEntry[]>(STORAGE_KEY) ?? [];
  }

  append(entry: JournalEntry): void {
    if (this.records.some((r) => r.id === entry.id)) {
      throw new Error(`journal entry '${entry.id}' already exists — the journal is append-only`);
    }
    validateEntry(entry);
    this.records.push(entry);
    this.store.set(STORAGE_KEY, this.records);
  }

  entries(): readonly JournalEntry[] {
    return this.records;
  }
}

function validateEntry(entry: JournalEntry): void {
  if (!(entry.positionSize > 0)) {
    throw new RangeError(`positionSize must be > 0, got ${entry.positionSize}`);
  }
  if (!(entry.entryPrice > 0) || !(entry.exitPrice > 0)) {
    throw new RangeError('entry and exit prices must be positive');
  }
  if (entry.exitTimestamp < entry.entryTimestamp) {
    throw new RangeError('exitTimestamp cannot precede entryTimestamp');
  }
  if (entry.fees < 0 || entry.slippage < 0) {
    throw new RangeError('fees and slippage cannot be negative');
  }
}
