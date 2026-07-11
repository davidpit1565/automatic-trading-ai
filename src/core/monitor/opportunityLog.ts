/**
 * Append-only opportunity history — Stage 4.
 *
 * Every qualified opportunity is recorded for future performance analysis.
 * Records are never removed or rewritten; the single permitted transition
 * is `disappearedAt`, set exactly once when a previously detected signal
 * stops qualifying.
 */

import type { KeyValueStore } from '../data/storage';
import type { RobustnessVerdict } from '../validation/robustness';
import type { Timeframe } from '../types';

/** Compact indicator snapshot kept with each record for later analysis. */
export interface LoggedSnapshot {
  readonly rsi: number | null;
  readonly adx: number | null;
  readonly atrPct: number | null;
  readonly relativeVolume: number | null;
}

export interface OpportunityRecord {
  readonly id: string;
  readonly detectedAt: number;
  readonly symbol: string;
  readonly timeframe: Timeframe;
  readonly price: number;
  readonly confidence: number;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly positionSize: number;
  readonly riskPct: number;
  readonly explanation: string;
  readonly validationVerdict: RobustnessVerdict | 'not-run';
  readonly snapshot: LoggedSnapshot;
  /** Set once when the signal later stops qualifying; null while active. */
  readonly disappearedAt: number | null;
}

const STORAGE_KEY = 'opportunity-log';

export class OpportunityLog {
  private records: OpportunityRecord[];

  constructor(private readonly store: KeyValueStore) {
    this.records = store.get<OpportunityRecord[]>(STORAGE_KEY) ?? [];
  }

  append(record: OpportunityRecord): void {
    if (this.records.some((r) => r.id === record.id)) {
      throw new Error(`opportunity record '${record.id}' already exists — history is append-only`);
    }
    this.records.push(record);
    this.persist();
  }

  /**
   * Mark the latest still-active record for the symbol/timeframe as
   * disappeared. Returns false when there is nothing to mark; never
   * rewrites an already-set timestamp.
   */
  markDisappeared(symbol: string, timeframe: Timeframe, timestamp: number): boolean {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const record = this.records[i]!;
      if (record.symbol === symbol && record.timeframe === timeframe) {
        if (record.disappearedAt !== null) return false;
        this.records[i] = { ...record, disappearedAt: timestamp };
        this.persist();
        return true;
      }
    }
    return false;
  }

  entries(): readonly OpportunityRecord[] {
    return this.records;
  }

  private persist(): void {
    this.store.set(STORAGE_KEY, this.records);
  }
}
