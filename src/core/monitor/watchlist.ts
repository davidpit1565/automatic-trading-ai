/**
 * Persistent watchlists — Stage 4.
 *
 * Manual entries (added by the user) and automatic entries (added when the
 * monitoring engine sees a watch candidate or qualified opportunity), with
 * favourites and per-symbol detection tracking.
 */

import type { KeyValueStore } from '../data/storage';

export type WatchStatus = 'none' | 'watch' | 'qualified';

export interface WatchlistEntry {
  readonly symbol: string;
  readonly source: 'manual' | 'auto';
  readonly favorite: boolean;
  readonly addedAt: number;
  /** First time a scan produced watch/qualified for this symbol; null if never. */
  readonly firstDetectedAt: number | null;
  readonly lastScanAt: number | null;
  readonly highestConfidence: number | null;
  readonly currentStatus: WatchStatus;
}

export interface ScanOutcomeUpdate {
  readonly timestamp: number;
  readonly status: WatchStatus;
  readonly confidence?: number;
}

const STORAGE_KEY = 'watchlist';

export class WatchlistStore {
  private bySymbol: Map<string, WatchlistEntry>;

  constructor(private readonly store: KeyValueStore) {
    const saved = store.get<WatchlistEntry[]>(STORAGE_KEY) ?? [];
    this.bySymbol = new Map(saved.map((entry) => [entry.symbol, entry]));
  }

  addManual(symbol: string, timestamp: number): void {
    if (this.bySymbol.has(symbol)) return;
    this.bySymbol.set(symbol, {
      symbol,
      source: 'manual',
      favorite: false,
      addedAt: timestamp,
      firstDetectedAt: null,
      lastScanAt: null,
      highestConfidence: null,
      currentStatus: 'none',
    });
    this.persist();
  }

  remove(symbol: string): void {
    if (this.bySymbol.delete(symbol)) this.persist();
  }

  toggleFavorite(symbol: string): void {
    const entry = this.bySymbol.get(symbol);
    if (!entry) return;
    this.bySymbol.set(symbol, { ...entry, favorite: !entry.favorite });
    this.persist();
  }

  /**
   * Record a scan outcome. Watch/qualified outcomes auto-add unknown
   * symbols; 'none' only updates symbols already tracked.
   */
  recordScanOutcome(symbol: string, update: ScanOutcomeUpdate): void {
    const existing = this.bySymbol.get(symbol);
    const isDetection = update.status !== 'none';
    if (!existing && !isDetection) return;

    const base: WatchlistEntry =
      existing ??
      {
        symbol,
        source: 'auto',
        favorite: false,
        addedAt: update.timestamp,
        firstDetectedAt: null,
        lastScanAt: null,
        highestConfidence: null,
        currentStatus: 'none',
      };

    this.bySymbol.set(symbol, {
      ...base,
      lastScanAt: update.timestamp,
      currentStatus: update.status,
      firstDetectedAt:
        base.firstDetectedAt ?? (isDetection ? update.timestamp : null),
      highestConfidence:
        update.confidence === undefined
          ? base.highestConfidence
          : Math.max(base.highestConfidence ?? -Infinity, update.confidence),
    });
    this.persist();
  }

  /** Favourites first, then by highest confidence descending. */
  entries(): WatchlistEntry[] {
    return [...this.bySymbol.values()].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return (b.highestConfidence ?? -Infinity) - (a.highestConfidence ?? -Infinity);
    });
  }

  private persist(): void {
    this.store.set(STORAGE_KEY, [...this.bySymbol.values()]);
  }
}
