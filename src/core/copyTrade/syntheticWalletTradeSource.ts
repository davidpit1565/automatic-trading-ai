/**
 * Deterministic synthetic wallet trade history.
 *
 * Same convention as `data/synthetic.ts`'s `SyntheticDataSource`: a seeded
 * PRNG keyed off the wallet address (and token), a fixed anchor timestamp,
 * fully reproducible output. Used by every test and by the `replayCopyTrade`
 * CLI report — never presented as real on-chain data.
 *
 * For each wallet this fabricates 2-3 token "campaigns": an initial buy,
 * often a second add, a partial take-profit sell, then a full exit — so
 * every synthetic wallet exercises both the full-round-trip and
 * partial-reduction paths the replay engine has to handle.
 */

import type { Result } from '../types';
import { err, ok } from '../types';
import { mulberry32 } from '../data/synthetic';
import type { WalletTrade, WalletTradeSource } from './walletTradeSource';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const TOKEN_POOL: readonly { symbol: string; chain: string; dex: string }[] = [
  { symbol: 'WIF', chain: 'solana', dex: 'Jupiter' },
  { symbol: 'BONK', chain: 'solana', dex: 'Jupiter' },
  { symbol: 'POPCAT', chain: 'solana', dex: 'Raydium' },
  { symbol: 'PEPE', chain: 'ethereum', dex: 'Uniswap v3' },
  { symbol: 'JUP', chain: 'solana', dex: 'Jupiter' },
];

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickTokens(wallet: string): (typeof TOKEN_POOL)[number][] {
  const rand = mulberry32(hashSeed(`${wallet}:tokens`));
  const count = 2 + Math.floor(rand() * 2); // 2 or 3 tokens per wallet
  const pool = [...TOKEN_POOL];
  const picked: (typeof TOKEN_POOL)[number][] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rand() * pool.length);
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

/** One deterministic buy-add-partialSell-fullExit campaign for one token. */
function generateCampaign(
  wallet: string,
  token: { symbol: string; chain: string; dex: string },
  anchorTimestamp: number,
): WalletTrade[] {
  const rand = mulberry32(hashSeed(`${wallet}:${token.symbol}`));
  const startOffset = 14 * DAY_MS + Math.floor(rand() * 14) * DAY_MS; // 14-28 days before anchor
  let t = anchorTimestamp - startOffset;
  let price = 0.01 + rand() * 2;
  const trades: WalletTrade[] = [];

  const mk = (side: 'buy' | 'sell', usdAmount: number): WalletTrade => ({
    wallet,
    symbol: token.symbol,
    side,
    usdAmount,
    price,
    timestamp: t,
    chain: token.chain,
    dex: token.dex,
    txHash: `synthetic-${wallet}-${token.symbol}-${trades.length}`,
  });

  // Initial buy.
  const buy1Usd = 5_000 + rand() * 15_000;
  trades.push(mk('buy', buy1Usd));
  let heldTokens = buy1Usd / price;
  t += (2 + Math.floor(rand() * 6)) * HOUR_MS;
  price = Math.max(price * (1 + (rand() * 0.4 - 0.1)), 0.0001);

  // Optional second add.
  if (rand() > 0.4) {
    const buy2Usd = 2_000 + rand() * 8_000;
    trades.push(mk('buy', buy2Usd));
    heldTokens += buy2Usd / price;
    t += (4 + Math.floor(rand() * 10)) * HOUR_MS;
    price = Math.max(price * (1 + (rand() * 0.5 - 0.15)), 0.0001);
  }

  // Partial take-profit sell.
  const partialFraction = 0.3 + rand() * 0.3;
  const partialTokens = heldTokens * partialFraction;
  trades.push(mk('sell', partialTokens * price));
  heldTokens -= partialTokens;
  t += (6 + Math.floor(rand() * 18)) * HOUR_MS;
  price = Math.max(price * (1 + (rand() * 0.6 - 0.2)), 0.0001);

  // Full exit.
  trades.push(mk('sell', heldTokens * price));

  return trades;
}

export class SyntheticWalletTradeSource implements WalletTradeSource {
  readonly name = 'Synthetic wallet trades (demo)';

  /** Anchor time injected so generation stays deterministic and testable. */
  constructor(private readonly anchorTimestamp: number) {}

  getTrades(wallet: string, sinceMs: number, untilMs: number): Promise<Result<WalletTrade[]>> {
    if (!wallet) return Promise.resolve(err('wallet address is required'));
    if (untilMs <= sinceMs) return Promise.resolve(err('untilMs must be after sinceMs'));

    const trades = pickTokens(wallet)
      .flatMap((token) => generateCampaign(wallet, token, this.anchorTimestamp))
      .filter((trade) => trade.timestamp >= sinceMs && trade.timestamp < untilMs)
      .sort((a, b) => a.timestamp - b.timestamp);

    return Promise.resolve(ok(trades));
  }
}
