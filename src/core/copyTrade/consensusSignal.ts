/**
 * Wallet Consensus Detector — research tool, Stage 3.
 *
 * Step 3 of David's deliberately cautious "smart money" exploration. The
 * Replay Engine (Stage 1) and Wallet Quality Score (Stage 2) each look at ONE
 * wallet in isolation. This module answers a different question: across
 * SEVERAL tracked wallets' trade histories, when did multiple of them move
 * into (or out of) the same token close together in time? Independent
 * wallets converging on the same token is the "consensus" signal ChatGPT's
 * proposed hybrid architecture described as a stronger indicator than any
 * single wallet's own trade — this module only DETECTS and REPORTS that
 * convergence; it does NOT score it, alert on it, or feed it into any
 * trading decision. That remains a later, separately-approved step.
 *
 * Pure function of an already-fetched `WalletTrade[]` (trades from any number
 * of wallets, already merged into one array) — no I/O, no network, no
 * connection to the real risk/execution engine, the paper autopilot, or the
 * Signal Engine. Same scope boundary as every prior stage.
 *
 * CLUSTERING MODEL (read before trusting any event here — a modeled
 * assumption, not a fact):
 * Trades are grouped by (symbol, side), sorted chronologically, then
 * clustered by SINGLE-LINKAGE time gap: two consecutive trades (in that
 * sorted order) belong to the same cluster if they are no more than
 * `windowMs` apart; a gap larger than `windowMs` starts a new cluster. This
 * means a cluster's total time span CAN exceed `windowMs` if trades trickle
 * in with gaps just under the threshold (e.g. several trades each just under
 * `windowMs` apart from the previous one chain into a single cluster
 * spanning several multiples of `windowMs`) — a deliberate simplicity
 * tradeoff over a fixed anchored window, not a bug. A cluster becomes a
 * reported `ConsensusEvent` only if it contains at least `minWallets`
 * DISTINCT wallets (a wallet trading the same token twice inside one cluster
 * still counts once).
 */

import type { WalletTrade, WalletTradeSide } from './walletTradeSource';

export interface ConsensusParams {
  /** Max gap between consecutive same-(symbol,side) trades to stay in one cluster. See module doc comment. */
  readonly windowMs: number;
  /** Minimum distinct wallets required for a cluster to be reported. */
  readonly minWallets: number;
}

export interface ConsensusEvent {
  readonly symbol: string;
  readonly side: WalletTradeSide;
  readonly chain: string;
  /** Distinct wallets involved, sorted alphabetically. */
  readonly wallets: readonly string[];
  /** Total trades in the cluster (may exceed wallets.length — a wallet can trade more than once). */
  readonly tradeCount: number;
  readonly windowStart: number;
  readonly windowEnd: number;
}

function clusterByGap(trades: readonly WalletTrade[], windowMs: number): WalletTrade[][] {
  const clusters: WalletTrade[][] = [];
  let current: WalletTrade[] = [];
  for (const trade of trades) {
    const prev = current[current.length - 1];
    if (prev && trade.timestamp - prev.timestamp > windowMs) {
      clusters.push(current);
      current = [];
    }
    current.push(trade);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Detect wallet consensus clusters across several wallets' merged trade
 * history. Pure function — see the module doc comment for the exact
 * clustering model and its documented tradeoff. Returned events are sorted by
 * `windowStart` ascending.
 */
export function detectConsensus(trades: readonly WalletTrade[], params: ConsensusParams): readonly ConsensusEvent[] {
  const groups = new Map<string, WalletTrade[]>();
  for (const trade of trades) {
    const key = `${trade.symbol}::${trade.side}`;
    const list = groups.get(key);
    if (list) list.push(trade);
    else groups.set(key, [trade]);
  }

  const events: ConsensusEvent[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.timestamp - b.timestamp);
    for (const cluster of clusterByGap(sorted, params.windowMs)) {
      const distinctWallets = [...new Set(cluster.map((t) => t.wallet))].sort();
      if (distinctWallets.length < params.minWallets) continue;
      const first = cluster[0]!;
      const last = cluster[cluster.length - 1]!;
      events.push({
        symbol: first.symbol,
        side: first.side,
        chain: first.chain,
        wallets: distinctWallets,
        tradeCount: cluster.length,
        windowStart: first.timestamp,
        windowEnd: last.timestamp,
      });
    }
  }

  return events.sort((a, b) => a.windowStart - b.windowStart);
}
