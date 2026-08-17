/**
 * OKX public "top trader" position ratio — read-only, no auth.
 *
 * David asked the bot to follow/track big traders in this market. Real
 * copy-trading platforms (eToro, Binance/Bybit/OKX Copy Trading) only expose
 * an API for OPERATING a copy relationship you're already in, not for freely
 * reading other traders' positions (researched 2026-08-17). The practical
 * substitute every major derivatives exchange DOES publish for free: an
 * aggregate ratio of long vs short OPEN POSITION VALUE among its own top
 * traders. Binance and Bybit's equivalent endpoints geo-block a meaningful
 * share of network paths (confirmed 2026-08-17); OKX's do not.
 *
 * Unlike the whale-flow trade-tape proxy (`signal/whaleFlow.ts`), OKX keeps
 * real history here (100 daily points verified 2026-08-17) — genuinely
 * backtestable against real data, not shadow-only.
 */

import type { Result } from '../types';
import { err, ok } from '../types';

const BASE_URL =
  'https://www.okx.com/api/v5/rubik/stat/contracts/long-short-position-ratio-contract-top-trader';

export interface TopTraderRatioPoint {
  readonly timestamp: number;
  /** Long/short position-value ratio among OKX's top traders. >1 = net long. */
  readonly ratio: number;
}

/**
 * Kraken-style symbol (e.g. 'XBTEUR') -> OKX USDT-margined perpetual swap
 * instId (e.g. 'BTC-USDT-SWAP'). Only the base asset matters — the ratio is
 * a dimensionless positioning metric, not a price, so quote-currency
 * mismatch (EUR vs USDT) doesn't affect its meaning. Returns null for a
 * symbol with no recognizable base asset.
 */
export function toOkxSwapInstId(krakenSymbol: string): string | null {
  const base = krakenSymbol.replace(/(EUR|USD|USDT)$/i, '');
  if (!base) return null;
  const mapped = base.toUpperCase() === 'XBT' ? 'BTC' : base.toUpperCase();
  return `${mapped}-USDT-SWAP`;
}

/**
 * Fetches the ratio series, oldest first (OKX returns newest first). Fails
 * with a descriptive error rather than throwing — callers decide whether to
 * fail open, matching every other market-data source in this codebase.
 */
export async function getTopTraderPositionRatio(
  instId: string,
  period: '5m' | '1H' | '4H' | '1D' = '1D',
  limit = 100,
  fetchFn: typeof fetch = fetch,
): Promise<Result<TopTraderRatioPoint[]>> {
  const url = `${BASE_URL}?instId=${encodeURIComponent(instId)}&period=${period}&limit=${limit}`;
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (cause) {
    return err(`network error fetching OKX top-trader ratio: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!response.ok) return err(`OKX top-trader ratio HTTP ${response.status}`);
  let payload: { code?: string; data?: unknown };
  try {
    payload = (await response.json()) as { code?: string; data?: unknown };
  } catch (cause) {
    return err(`invalid JSON from OKX: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (payload.code !== '0') return err(`OKX error response: ${JSON.stringify(payload)}`);
  if (!Array.isArray(payload.data)) return err('unexpected OKX payload: no data array');

  const points = payload.data
    .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 2)
    .map((row) => ({ timestamp: Number(row[0]), ratio: Number(row[1]) }))
    .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.ratio) && p.ratio > 0);
  if (points.length === 0) return err('empty top-trader ratio series from OKX');

  return ok(points.slice().reverse());
}
