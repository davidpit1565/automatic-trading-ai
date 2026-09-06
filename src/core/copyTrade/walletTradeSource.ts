/**
 * Read-only on-chain wallet trade data — the copy-trade research module's
 * data-layer contract.
 *
 * Mirrors `data/revolutClient.ts`'s `MarketDataSource` pattern: an interface
 * here, a deterministic synthetic implementation for testing/demo
 * (`syntheticWalletTradeSource.ts`), and a real provider (e.g. Bitquery)
 * pluggable later without changing anything above this layer. No real
 * implementation exists yet — no API key, no network call, by design.
 */

import type { Result } from '../types';

/** Buy = accumulating the token; sell = reducing or exiting the position. */
export type WalletTradeSide = 'buy' | 'sell';

/** A single on-chain DEX trade made by a tracked wallet. */
export interface WalletTrade {
  /** The tracked wallet's address. */
  readonly wallet: string;
  /** Token symbol/ticker traded, e.g. 'WIF'. */
  readonly symbol: string;
  readonly side: WalletTradeSide;
  /** Trade size valued in USD at execution time. */
  readonly usdAmount: number;
  /** Execution price in USD per token. */
  readonly price: number;
  /** Epoch milliseconds. */
  readonly timestamp: number;
  /** Chain the trade happened on, e.g. 'solana', 'ethereum'. */
  readonly chain: string;
  /** DEX/venue, when known (e.g. 'Jupiter', 'Uniswap v3'). */
  readonly dex?: string;
  readonly txHash?: string;
}

/**
 * Provider-agnostic contract for fetching a wallet's historical DEX trades.
 * A real implementation (Bitquery, Nansen, Helius, ...) plugs in here without
 * the replay engine or CLI needing to change.
 */
export interface WalletTradeSource {
  readonly name: string;
  getTrades(wallet: string, sinceMs: number, untilMs: number): Promise<Result<WalletTrade[]>>;
}
