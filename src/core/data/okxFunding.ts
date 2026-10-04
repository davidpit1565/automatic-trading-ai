/**
 * OKX public perpetual-swap funding-rate history — read-only, no auth.
 *
 * Funding is what leveraged longs pay shorts (positive) or vice versa
 * (negative) every 8 hours to keep a perpetual swap near spot. Persistently
 * high positive funding means longs are crowded and paying up to stay in —
 * a leading condition (it exists BEFORE price moves) rather than a read of
 * price itself, which is why David's 2026-10-04 "predict, don't just look
 * back" request picked it as the next forward test. Same exchange and
 * instrument mapping as `okxPositioning.ts` (OKX doesn't geo-block the
 * network paths this project runs on; Binance/Bybit do).
 *
 * Verified 2026-10-04: 100 settled points per request (~33 days at 8h).
 */

import type { Result } from '../types';
import { err, ok } from '../types';

const BASE_URL = 'https://www.okx.com/api/v5/public/funding-rate-history';
/** Same bound every other market-data source here uses (see okxPositioning.ts). */
const DEFAULT_TIMEOUT_MS = 15_000;

export interface FundingRatePoint {
  /** Settlement time, unix ms. */
  readonly timestamp: number;
  /** Rate paid per 8h period as a fraction (0.0001 = 0.01%, OKX's usual baseline). */
  readonly rate: number;
}

/**
 * Fetches settled funding rates, oldest first (OKX returns newest first).
 * Fails with a descriptive error rather than throwing — callers fail open.
 */
export async function getFundingRateHistory(
  instId: string,
  limit = 100,
  fetchFn: typeof fetch = fetch,
): Promise<Result<FundingRatePoint[]>> {
  const url = `${BASE_URL}?instId=${encodeURIComponent(instId)}&limit=${limit}`;
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    response = await fetchFn(url, { signal: controller.signal });
  } catch (cause) {
    return err(`network error fetching OKX funding rates: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) return err(`OKX funding-rate HTTP ${response.status}`);
  let payload: { code?: string; data?: unknown };
  try {
    payload = (await response.json()) as { code?: string; data?: unknown };
  } catch (cause) {
    return err(`invalid JSON from OKX: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (payload.code !== '0') return err(`OKX error response: ${JSON.stringify(payload)}`);
  if (!Array.isArray(payload.data)) return err('unexpected OKX payload: no data array');

  const points = payload.data
    .filter((row): row is { fundingTime?: unknown; realizedRate?: unknown; fundingRate?: unknown } =>
      typeof row === 'object' && row !== null,
    )
    .map((row) => ({
      timestamp: Number(row.fundingTime),
      rate: Number(row.realizedRate ?? row.fundingRate),
    }))
    .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.rate));
  if (points.length === 0) return err('empty funding-rate series from OKX');

  return ok(points.slice().reverse());
}
