/**
 * Large-trade ("whale") flow signal — pure.
 *
 * Unlike the daily regime filters, Kraken's public API exposes no historical
 * order-book depth or a cheap way to reconstruct the historical trade tape
 * at scale, so this cannot be validated against history the way the other
 * gates were. It exists to accumulate a genuine FORWARD record via shadow
 * evaluation (see `autopilot/shadowEvaluator.ts`) before ever being trusted
 * with real risk — see `AUTOPILOT_MIN_CONFIDENCE`'s neighboring constants
 * for why an untested idea belongs in a shadow candidate, not production.
 *
 * Ranks the recent trade tape by notional value (price × volume) and looks
 * only at the largest slice — small retail trades are noise for this
 * purpose. Net buy/sell notional among just the large trades is compared:
 * heavy net selling is treated as bearish (a real-money proxy for "large
 * traders are distributing"). Fails safe (not bearish) with too little data
 * to judge, exactly like the other regime gates.
 */

export interface RecentTradeLike {
  readonly price: number;
  readonly volume: number;
  readonly side: 'buy' | 'sell';
}

export interface WhaleFlowOptions {
  /** Top fraction (0..1) of trades by notional counted as "large". Default 0.2. */
  readonly largeFraction?: number;
  /** Minimum large-trade count required to judge; below this, fails safe. */
  readonly minLargeTrades?: number;
  /** Net-sell share (0..1) of large-trade notional at/above which flow is bearish. */
  readonly bearishThreshold?: number;
}

export function isWhaleFlowBearish(
  trades: readonly RecentTradeLike[],
  options: WhaleFlowOptions = {},
): boolean {
  const largeFraction = options.largeFraction ?? 0.2;
  const minLargeTrades = options.minLargeTrades ?? 5;
  const bearishThreshold = options.bearishThreshold ?? 0.65;

  if (trades.length === 0) return false;

  const sized = trades.map((t) => ({ side: t.side, notional: t.price * t.volume }));
  const large = [...sized]
    .sort((a, b) => b.notional - a.notional)
    .slice(0, Math.max(1, Math.round(sized.length * largeFraction)));
  if (large.length < minLargeTrades) return false;

  const buyNotional = large.filter((t) => t.side === 'buy').reduce((sum, t) => sum + t.notional, 0);
  const sellNotional = large.filter((t) => t.side === 'sell').reduce((sum, t) => sum + t.notional, 0);
  const total = buyNotional + sellNotional;
  if (!(total > 0)) return false;

  return sellNotional / total >= bearishThreshold;
}
