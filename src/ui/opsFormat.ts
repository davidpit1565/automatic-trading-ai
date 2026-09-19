/**
 * Shared formatting helpers for the Operations Console views
 * (overviewView/tradesView/strategiesView/systemView/reportsView) — pulled
 * out once several of those views had accumulated their own near-identical
 * copies of the same few functions. Pure, UI-internal, no core/ imports —
 * safe under the same architecture boundary every view file already lives
 * under.
 */

import { formatPrice } from './format';

/** Internal symbol (e.g. 'XBTEUR') -> a readable base (e.g. 'XBT'). Mirrors
 * `liveManualTradeSync.mts`'s own EUR-suffix stripping server-side. */
export function baseOf(symbol: string): string {
  return symbol.replace(/EUR$|USD$/, '');
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** How long ago `ms` was, e.g. "4m ago" / "2h 14m ago" / "3d 1h ago". */
export function relativeTime(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

/** A duration span, e.g. "42m" / "4h 12m" / "3d 1h" — same bucketing as
 * `relativeTime` above but without the "ago" (a span, not a moment). */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Conservative and deliberately not tuned to the bot's exact cycle
 * interval (which has varied) — this only flags a genuinely long silence,
 * not a missed-a-beat false alarm. Shared so Overview's freshness badge and
 * System's own heartbeat card agree on what "stale" means. */
export const STALE_MS = 30 * 60 * 1000;

export const euro = (v: number): string => `€${formatPrice(v)}`;

/** `€${v.toFixed(2)}` on a negative embeds the minus mid-string
 * ("€-5.00") — this puts the sign before the currency symbol instead
 * ("-€5.00"), which reads correctly. */
export const signedEuro = (v: number): string => `${v >= 0 ? '+' : '-'}${euro(Math.abs(v))}`;
