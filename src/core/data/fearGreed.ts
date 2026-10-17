/**
 * Crypto Fear & Greed index history (alternative.me) — read-only, no auth.
 *
 * A daily 0-100 crowd-sentiment reading (0 = extreme fear, 100 = extreme
 * greed). Used ONLY by the F2 sentiment-trend forward test
 * (`src/core/autopilot/sentimentShadow.ts`); nothing here can place an order.
 *
 * Verified 2026-10-17: `limit=N` returns the latest N daily values, newest
 * first, each `{ value: "55", timestamp: "1792195200" }` where the timestamp
 * is 00:00 UTC of that day in seconds.
 */

import type { Result } from '../types';
import { err, ok } from '../types';

const BASE_URL = 'https://api.alternative.me/fng/';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface FearGreedPoint {
  /** 00:00 UTC of the reading's day, unix ms. */
  readonly timestamp: number;
  /** 0-100. */
  readonly value: number;
}

/** Latest `limit` daily readings, oldest first. Never throws. */
export async function getFearGreedHistory(limit = 60, fetchFn: typeof fetch = fetch): Promise<Result<FearGreedPoint[]>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}?limit=${limit}&format=json`, { signal: controller.signal });
  } catch (cause) {
    return err(`network error fetching Fear & Greed: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) return err(`Fear & Greed HTTP ${response.status}`);
  let payload: { data?: unknown };
  try {
    payload = (await response.json()) as { data?: unknown };
  } catch (cause) {
    return err(`invalid JSON from Fear & Greed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!Array.isArray(payload.data)) return err('unexpected Fear & Greed payload: no data array');
  const points = payload.data
    .filter((row): row is { value?: unknown; timestamp?: unknown } => typeof row === 'object' && row !== null)
    .map((row) => ({ timestamp: Number(row.timestamp) * 1000, value: Number(row.value) }))
    .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.value) && p.value >= 0 && p.value <= 100);
  if (points.length === 0) return err('empty Fear & Greed series');
  return ok(points.slice().sort((a, b) => a.timestamp - b.timestamp));
}
