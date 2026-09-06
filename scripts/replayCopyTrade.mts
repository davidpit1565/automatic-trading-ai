/**
 * Copy-Trade Replay Engine report — "what would have happened" for a
 * research question David asked: if I had copy-traded this wallet, with
 * realistic detection latency and slippage, what would my P&L have been?
 *
 * Runs entirely against `SyntheticWalletTradeSource` (deterministic fake
 * on-chain trade history) — no network call, no API key, works today. Real
 * data plugs in later by swapping the source; see `replayEngine.ts`'s doc
 * comment for what that requires and what deliberately isn't built yet.
 *
 *   npx tsx scripts/replayCopyTrade.mts
 *   npx tsx scripts/replayCopyTrade.mts --wallet SOME_WALLET --days 45
 */

import { SyntheticWalletTradeSource } from '../src/core/copyTrade/syntheticWalletTradeSource';
import { replayCopyTrade, type ReplayParams } from '../src/core/copyTrade/replayEngine';
import { scoreWalletQuality } from '../src/core/copyTrade/walletQuality';
import { detectConsensus } from '../src/core/copyTrade/consensusSignal';
import type { WalletTrade } from '../src/core/copyTrade/walletTradeSource';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1]! : fallback;
};

const WALLETS = flag('wallet', '').length > 0 ? [flag('wallet', '')] : ['WHALE_1', 'WHALE_2', 'WHALE_3'];
const DAYS = Number(flag('days', '45'));
const ANCHOR = Date.now();

// Zero-cost params: fills equal the wallet's own recorded prices exactly, so
// the resulting ReplayResult reflects the wallet's OWN historical
// performance, uncontaminated by our copy-trading latency/slippage/fee
// friction assumptions (those are a "what would copying it cost us" concern,
// separate from "how good is this wallet's own track record").
const OWN_PERFORMANCE_PARAMS: ReplayParams = { detectionLatencyMs: 0, slippagePct: 0, feePct: 0, positionSizeUsd: 1_000 };

const SCENARIOS: { name: string; params: ReplayParams }[] = [
  { name: 'Optimistic (fast bot, low slippage)', params: { detectionLatencyMs: 5_000, slippagePct: 0.3, feePct: 0.3, positionSizeUsd: 1_000 } },
  { name: 'Realistic (typical follower)', params: { detectionLatencyMs: 30_000, slippagePct: 1, feePct: 0.3, positionSizeUsd: 1_000 } },
  { name: 'Slow (manual, congested chain)', params: { detectionLatencyMs: 120_000, slippagePct: 2.5, feePct: 0.3, positionSizeUsd: 1_000 } },
  { name: 'Pessimistic (thin liquidity, high latency)', params: { detectionLatencyMs: 300_000, slippagePct: 5, feePct: 0.5, positionSizeUsd: 1_000 } },
];

// Two independent wallets moving into the same token within ~6h of each
// other is the "consensus" candidate window — a placeholder assumption
// (see consensusSignal.ts), not a measured constant.
const CONSENSUS_WINDOW_MS = 6 * 3_600_000;
const CONSENSUS_MIN_WALLETS = 2;

async function main(): Promise<void> {
  const source = new SyntheticWalletTradeSource(ANCHOR);
  const sinceMs = ANCHOR - DAYS * 86_400_000;
  const allTrades: WalletTrade[] = [];

  for (const wallet of WALLETS) {
    const fetched = await source.getTrades(wallet, sinceMs, ANCHOR);
    if (!fetched.ok) {
      console.error(`skip ${wallet}: ${fetched.error}`);
      continue;
    }
    const trades = fetched.value;
    allTrades.push(...trades);
    console.log(`\n=== Wallet ${wallet} — ${trades.length} synthetic trades over ${DAYS}d ===`);
    if (trades.length === 0) {
      console.log('(no trades in window)');
      continue;
    }

    const pad = (s: string, n: number) => s.padEnd(n);
    const num = (v: number, n: number) => v.toFixed(n).padStart(9);
    console.log(
      pad('Scenario', 42) +
        'Ret$'.padStart(10) +
        'ROI%'.padStart(9) +
        'Trades'.padStart(8) +
        'Win%'.padStart(8) +
        'MaxDD%'.padStart(9),
    );
    console.log('-'.repeat(86));
    for (const scenario of SCENARIOS) {
      const result = replayCopyTrade(trades, scenario.params);
      console.log(
        pad(scenario.name, 42) +
          num(result.aggregate.realizedPnl, 2) +
          num(result.aggregate.roiPct, 2) +
          String(result.aggregate.tradeCount).padStart(8) +
          num(result.aggregate.winRatePct ?? 0, 1) +
          num(result.aggregate.maxDrawdownPct, 2),
      );
    }

    const quality = scoreWalletQuality(replayCopyTrade(trades, OWN_PERFORMANCE_PARAMS));
    const scoreStr = quality.score === null ? 'n/a' : quality.score.toFixed(1);
    console.log(
      `Wallet quality score (own track record, zero-friction): ${scoreStr}/100 ` +
        `[confidence: ${quality.confidence}, ${quality.tradeCount} closed trades, ` +
        `${quality.tokensProfitable}/${quality.tokensTraded} tokens profitable] ` +
        '— heuristic first pass, not validated; see walletQuality.ts.',
    );
  }

  if (WALLETS.length > 1) {
    const events = detectConsensus(allTrades, { windowMs: CONSENSUS_WINDOW_MS, minWallets: CONSENSUS_MIN_WALLETS });
    console.log(`\n=== Consensus check across ${WALLETS.length} tracked wallets (window: ${CONSENSUS_WINDOW_MS / 3_600_000}h, min ${CONSENSUS_MIN_WALLETS} wallets) ===`);
    if (events.length === 0) {
      console.log('(no consensus clusters found in this window)');
    } else {
      for (const event of events) {
        const when = new Date(event.windowStart).toISOString();
        console.log(
          `${when} — ${event.side.toUpperCase()} ${event.symbol} (${event.chain}): ` +
            `${event.wallets.length} wallets [${event.wallets.join(', ')}], ${event.tradeCount} trades`,
        );
      }
    }
    console.log('Detection only — not scored, not alerted on, not connected to any trading decision. See consensusSignal.ts.');
  }

  console.log(
    '\nNote: synthetic demo data only (SyntheticWalletTradeSource) — not real on-chain history. ' +
      'Slippage/latency figures are a modeled approximation; see replayEngine.ts. ' +
      'Wallet quality scores are a modeled heuristic; see walletQuality.ts. ' +
      'Consensus clustering is a modeled tradeoff; see consensusSignal.ts.',
  );
}

void main();
