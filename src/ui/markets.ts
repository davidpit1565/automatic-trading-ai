/**
 * Live market snapshots for the dashboard's Markets strip and top bar.
 * Presentation-only: pulls candles from the active data source and derives
 * a current price, a window change %, and the close series for a sparkline.
 */

import type { ActiveDataSource } from './dataSource';

export interface MarketSnapshot {
  readonly symbol: string;
  readonly label: string;
  readonly price: number;
  /** Change across the fetched window (~48h). */
  readonly changePct: number;
  readonly closes: number[];
}

/** Majors in display order; each maps to whatever the source calls its EUR pair. */
const MAJORS: ReadonlyArray<{ bases: string[]; label: string }> = [
  { bases: ['XBT', 'BTC'], label: 'Bitcoin' },
  { bases: ['ETH'], label: 'Ethereum' },
  { bases: ['SOL'], label: 'Solana' },
  { bases: ['XRP'], label: 'XRP' },
  { bases: ['ADA'], label: 'Cardano' },
  { bases: ['DOGE'], label: 'Dogecoin' },
];

function findSymbol(data: ActiveDataSource, bases: string[]): string | null {
  for (const base of bases) {
    const hit = data.instruments.find(
      (i) => new RegExp(`(^|[^A-Z])${base}([^A-Z]|$)`, 'i').test(i.symbol) && /EUR/i.test(i.symbol),
    );
    if (hit) return hit.symbol;
  }
  return null;
}

export function findBtcSymbol(data: ActiveDataSource): string | null {
  return findSymbol(data, ['XBT', 'BTC']);
}

export async function fetchSnapshot(
  data: ActiveDataSource,
  symbol: string,
  label: string,
): Promise<MarketSnapshot | null> {
  const candles = await data.source.getCandles(symbol, '1h', 48);
  if (!candles.ok || candles.value.length < 2) return null;
  const closes = candles.value.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const first = closes[0]!;
  return { symbol, label, price, changePct: first > 0 ? ((price - first) / first) * 100 : 0, closes };
}

export async function fetchTopMarkets(data: ActiveDataSource, max = 6): Promise<MarketSnapshot[]> {
  const results: MarketSnapshot[] = [];
  const seen = new Set<string>();
  for (const major of MAJORS) {
    const symbol = findSymbol(data, major.bases);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const snap = await fetchSnapshot(data, symbol, major.label);
    if (snap) results.push(snap);
    if (results.length >= max) break;
  }
  return results;
}
