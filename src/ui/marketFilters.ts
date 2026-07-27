/**
 * Search, sort and watchlist for the markets list — pure functions over
 * already-fetched rows, so every one of them is a free, instant view over the
 * single batch-ticker response rather than a new request.
 *
 * Presentation-only: no market data access, no business logic.
 */

import type { KeyValueStore } from '../core/data/storage';
import type { MarketRow } from './markets';

export type SortKey = 'default' | 'change' | 'price' | 'volume' | 'name';

export interface SortOption {
  readonly key: SortKey;
  readonly label: string;
}

export const SORT_OPTIONS: readonly SortOption[] = [
  { key: 'default', label: 'Default' },
  { key: 'change', label: 'Change' },
  { key: 'volume', label: 'Volume' },
  { key: 'price', label: 'Price' },
  { key: 'name', label: 'Name' },
];

/**
 * Match a row against a free-text query. Matches the asset name, its code and
 * the pair symbol, so "btc", "bitcoin" and "xbteur" all find the same market.
 * Case- and whitespace-insensitive; an empty query matches everything.
 */
export function matchesQuery(row: MarketRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    row.label.toLowerCase().includes(needle) ||
    row.base.toLowerCase().includes(needle) ||
    row.symbol.toLowerCase().includes(needle)
  );
}

export function searchRows(rows: readonly MarketRow[], query: string): MarketRow[] {
  if (query.trim() === '') return [...rows];
  return rows.filter((row) => matchesQuery(row, query));
}

/**
 * Sort a copy of `rows`. 'default' preserves the incoming order, which already
 * carries meaning (curated majors first, then liquidity) — so it is a genuine
 * option, not a no-op placeholder.
 */
export function sortRows(rows: readonly MarketRow[], key: SortKey): MarketRow[] {
  const copy = [...rows];
  switch (key) {
    case 'change':
      return copy.sort((a, b) => b.changePct - a.changePct);
    case 'price':
      return copy.sort((a, b) => b.price - a.price);
    case 'volume':
      return copy.sort((a, b) => b.quoteVolume - a.quoteVolume);
    case 'name':
      return copy.sort((a, b) => a.label.localeCompare(b.label));
    case 'default':
    default:
      return copy;
  }
}

const WATCHLIST_KEY = 'markets-watchlist';

/**
 * Starred markets, persisted locally. Keyed by pair symbol rather than asset
 * code so it stays unambiguous if a second quote currency is ever added.
 */
export class Watchlist {
  private symbols: Set<string>;

  constructor(private readonly store: KeyValueStore) {
    const saved = store.get<string[]>(WATCHLIST_KEY);
    this.symbols = new Set(Array.isArray(saved) ? saved : []);
  }

  has(symbol: string): boolean {
    return this.symbols.has(symbol);
  }

  /** Star or unstar a market; returns the state after the change. */
  toggle(symbol: string): boolean {
    if (this.symbols.has(symbol)) this.symbols.delete(symbol);
    else this.symbols.add(symbol);
    this.persist();
    return this.symbols.has(symbol);
  }

  get size(): number {
    return this.symbols.size;
  }

  /** Starred rows, in the order the incoming list already establishes. */
  filter(rows: readonly MarketRow[]): MarketRow[] {
    return rows.filter((row) => this.symbols.has(row.symbol));
  }

  private persist(): void {
    this.store.set(WATCHLIST_KEY, [...this.symbols]);
  }
}
