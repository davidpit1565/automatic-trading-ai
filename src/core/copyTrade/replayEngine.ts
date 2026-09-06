/**
 * Copy-Trade Replay Engine — research/measurement tool, Stage 0.
 *
 * Answers, purely from historical data, "if I had copy-traded wallet X for
 * N days, with realistic detection latency and slippage, what would my P&L
 * have been?" It is the first step of a multi-step, deliberately cautious
 * exploration of on-chain "smart money" wallets as an additional signal
 * alongside the existing technical Signal Engine.
 *
 * What this deliberately does NOT do (yet):
 *   - No real on-chain data provider. `WalletTradeSource` is an interface;
 *     the only implementation today is `SyntheticWalletTradeSource`
 *     (deterministic fake data). No Bitquery/Nansen/Helius API key exists,
 *     and none of this module makes a network call.
 *   - No live execution, no connection to the real risk/execution engine
 *     (`server/liveOrchestrator.mts` and friends) or the paper autopilot.
 *     This module only ever produces a `ReplayResult` — a report, not an
 *     order.
 *   - No "Smart Money Score", no consensus with the Signal Engine, no
 *     alerts. Those are later, separately-approved steps.
 *
 * To plug in a real provider later: implement `WalletTradeSource` (see
 * `walletTradeSource.ts`) against a real API — Bitquery is the leading
 * candidate discussed — and pass it wherever `SyntheticWalletTradeSource` is
 * used today. `replayCopyTrade` itself needs no change; it only ever
 * consumes `WalletTrade[]`.
 *
 * MODELED SLIPPAGE/LATENCY ASSUMPTION (read before trusting any number here):
 * We have no real order-book or price-impact data for these tokens yet, so
 * "what our own fill would have looked like" is approximated, not measured.
 * The exact formula (see `adjustedFillPrice` below):
 *
 *   latencyPct = (detectionLatencyMs / 60_000) * latencyDriftPctPerMinute
 *   adversePct = latencyPct + slippagePct
 *   fill = side === 'buy'
 *     ? walletPrice * (1 + adversePct / 100)   // we pay more, chasing in
 *     : walletPrice * (1 - adversePct / 100)   // we receive less, exiting late
 *
 * i.e. the longer our assumed detection+action latency and the higher the
 * configured slippage, the worse our fill versus the wallet's own recorded
 * price — always adverse, never favorable. `latencyDriftPctPerMinute`
 * defaults to `DEFAULT_LATENCY_DRIFT_PCT_PER_MINUTE` and is a placeholder
 * assumption, not a measured constant; tune it (or override it per call) once
 * real market-microstructure data exists.
 */

import type { ClosedTrade, EquityPoint } from '../backtest/metrics';
import { maxDrawdownPct, tradeStats } from '../backtest/metrics';
import type { WalletTrade } from './walletTradeSource';

/** See the module doc comment above for the exact formula this implements. */
export const DEFAULT_LATENCY_DRIFT_PCT_PER_MINUTE = 0.02;

export interface ReplayParams {
  /** Assumed time between the wallet's trade and our simulated detection+action, in ms. */
  readonly detectionLatencyMs: number;
  /** Additional slippage/market-impact assumption, as a percent (e.g. 0.5 = 0.5%). */
  readonly slippagePct: number;
  /** Fee charged per simulated fill, as a percent of notional (e.g. 0.3 = 0.3%). */
  readonly feePct: number;
  /** USD size opened/added for each copied buy. Sells reduce proportionally — see module doc. */
  readonly positionSizeUsd: number;
  /**
   * Assumed adverse price drift per minute of detection latency, as a percent.
   * Modeled approximation — see the module doc comment. Default
   * `DEFAULT_LATENCY_DRIFT_PCT_PER_MINUTE`.
   */
  readonly latencyDriftPctPerMinute?: number;
}

export interface TokenReplayResult {
  readonly wallet: string;
  readonly symbol: string;
  readonly realizedPnl: number;
  /** Realized P&L as a percent of total USD ever deployed into this token. */
  readonly roiPct: number;
  readonly tradeCount: number;
  readonly winRatePct: number | null;
  readonly maxDrawdownPct: number;
  readonly closedTrades: readonly ClosedTrade[];
}

export interface ReplayResult {
  readonly perToken: readonly TokenReplayResult[];
  readonly aggregate: {
    readonly realizedPnl: number;
    readonly roiPct: number;
    readonly tradeCount: number;
    readonly winRatePct: number | null;
    readonly maxDrawdownPct: number;
  };
}

/** The exact, documented adverse-fill adjustment. See module doc comment. */
function adjustedFillPrice(walletPrice: number, side: 'buy' | 'sell', params: ReplayParams): number {
  const driftPerMinute = params.latencyDriftPctPerMinute ?? DEFAULT_LATENCY_DRIFT_PCT_PER_MINUTE;
  const latencyPct = (params.detectionLatencyMs / 60_000) * driftPerMinute;
  const adversePct = latencyPct + params.slippagePct;
  return side === 'buy' ? walletPrice * (1 + adversePct / 100) : walletPrice * (1 - adversePct / 100);
}

interface GroupState {
  wallet: string;
  symbol: string;
  /** Our simulated position, tracked so a partial sell only reduces it proportionally. */
  qty: number;
  costBasis: number;
  totalDeployed: number;
  /** The wallet's OWN running qty — needed to compute what fraction of their position a sell represents. */
  walletQty: number;
  cashFlow: number;
  realizedPnl: number;
  lastMarkPrice: number;
  openTimestamp: number | null;
  closedTrades: ClosedTrade[];
  equityCurve: EquityPoint[];
}

function newGroup(wallet: string, symbol: string): GroupState {
  return {
    wallet,
    symbol,
    qty: 0,
    costBasis: 0,
    totalDeployed: 0,
    walletQty: 0,
    cashFlow: 0,
    realizedPnl: 0,
    lastMarkPrice: 0,
    openTimestamp: null,
    closedTrades: [],
    equityCurve: [],
  };
}

/**
 * Replay a copy-trading strategy against a wallet's (or several wallets')
 * historical DEX trades. Pure function: no I/O, no network, no clock reads —
 * see the module doc comment for what the slippage/latency model does and
 * does not represent.
 *
 * Processes trades chronologically and tracks a running position PER
 * (wallet, token): an additional buy adds `positionSizeUsd` to the copied
 * position; a sell reduces the copied position by the same fraction the
 * wallet's own position was reduced by (a full exit closes it, a partial
 * sell only shrinks it).
 */
export function replayCopyTrade(trades: readonly WalletTrade[], params: ReplayParams): ReplayResult {
  const groups = new Map<string, GroupState>();
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const aggregateCurve: EquityPoint[] = [];

  for (const trade of sorted) {
    const key = `${trade.wallet}::${trade.symbol}`;
    let group = groups.get(key);
    if (!group) {
      group = newGroup(trade.wallet, trade.symbol);
      groups.set(key, group);
    }

    const execTimestamp = trade.timestamp + params.detectionLatencyMs;
    const walletTokens = trade.usdAmount / trade.price;

    if (trade.side === 'buy') {
      group.walletQty += walletTokens;
      const fillPrice = adjustedFillPrice(trade.price, 'buy', params);
      const fee = params.positionSizeUsd * (params.feePct / 100);
      const cost = params.positionSizeUsd + fee;
      const qtyBought = params.positionSizeUsd / fillPrice;
      group.qty += qtyBought;
      group.costBasis += cost;
      group.totalDeployed += cost;
      group.cashFlow -= cost;
      group.lastMarkPrice = fillPrice;
      if (group.openTimestamp === null) group.openTimestamp = execTimestamp;
    } else {
      // Sell. Guard against bad/short data: nothing to reduce.
      if (group.walletQty <= 0) continue;
      const fraction = Math.min(1, walletTokens / group.walletQty);
      group.walletQty = Math.max(0, group.walletQty - walletTokens);

      const fillPrice = adjustedFillPrice(trade.price, 'sell', params);
      const avgCost = group.qty > 0 ? group.costBasis / group.qty : 0;
      const qtySold = group.qty * fraction;
      const proceeds = qtySold * fillPrice;
      const fee = proceeds * (params.feePct / 100);
      const netProceeds = proceeds - fee;
      const costOfSold = qtySold * avgCost;
      const pnl = netProceeds - costOfSold;

      group.realizedPnl += pnl;
      group.qty = Math.max(0, group.qty - qtySold);
      group.costBasis = Math.max(0, group.costBasis - costOfSold);
      group.cashFlow += netProceeds;
      group.lastMarkPrice = fillPrice;

      group.closedTrades.push({
        entryTimestamp: group.openTimestamp ?? execTimestamp,
        exitTimestamp: execTimestamp,
        entryPrice: avgCost,
        exitPrice: fillPrice,
        quantity: qtySold,
        pnl,
      });
      // Fraction >= ~1 (full exit): the next buy starts a fresh round-trip.
      if (fraction >= 0.999999) group.openTimestamp = null;
    }

    group.equityCurve.push({ timestamp: execTimestamp, equity: group.cashFlow + group.qty * group.lastMarkPrice });

    let aggregateEquity = 0;
    for (const g of groups.values()) aggregateEquity += g.cashFlow + g.qty * g.lastMarkPrice;
    aggregateCurve.push({ timestamp: execTimestamp, equity: aggregateEquity });
  }

  const perToken: TokenReplayResult[] = [...groups.values()].map((g) => {
    const stats = tradeStats(g.closedTrades);
    return {
      wallet: g.wallet,
      symbol: g.symbol,
      realizedPnl: g.realizedPnl,
      roiPct: g.totalDeployed > 0 ? (g.realizedPnl / g.totalDeployed) * 100 : 0,
      tradeCount: stats.tradeCount,
      winRatePct: stats.winRatePct,
      maxDrawdownPct: maxDrawdownPct(g.equityCurve),
      closedTrades: g.closedTrades,
    };
  });

  const allClosedTrades = perToken.flatMap((t) => t.closedTrades);
  const aggregateStats = tradeStats(allClosedTrades);
  const totalDeployed = [...groups.values()].reduce((sum, g) => sum + g.totalDeployed, 0);

  return {
    perToken,
    aggregate: {
      realizedPnl: aggregateStats.totalPnl,
      roiPct: totalDeployed > 0 ? (aggregateStats.totalPnl / totalDeployed) * 100 : 0,
      tradeCount: aggregateStats.tradeCount,
      winRatePct: aggregateStats.winRatePct,
      maxDrawdownPct: maxDrawdownPct(aggregateCurve),
    },
  };
}
