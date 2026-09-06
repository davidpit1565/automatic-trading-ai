import { describe, expect, it } from 'vitest';
import { detectConsensus } from '../../src/core/copyTrade/consensusSignal';
import type { WalletTrade } from '../../src/core/copyTrade/walletTradeSource';

function trade(overrides: Partial<WalletTrade> & Pick<WalletTrade, 'wallet' | 'symbol' | 'side' | 'timestamp'>): WalletTrade {
  return {
    usdAmount: 1_000,
    price: 1,
    chain: 'solana',
    dex: 'Jupiter',
    ...overrides,
  };
}

describe('detectConsensus', () => {
  it('reports one event when 3 distinct wallets buy the same token within the window', () => {
    const trades = [
      trade({ wallet: 'A', symbol: 'WIF', side: 'buy', timestamp: 0 }),
      trade({ wallet: 'B', symbol: 'WIF', side: 'buy', timestamp: 1_000 }),
      trade({ wallet: 'C', symbol: 'WIF', side: 'buy', timestamp: 2_000 }),
    ];
    const events = detectConsensus(trades, { windowMs: 5_000, minWallets: 3 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      symbol: 'WIF',
      side: 'buy',
      chain: 'solana',
      wallets: ['A', 'B', 'C'],
      tradeCount: 3,
      windowStart: 0,
      windowEnd: 2_000,
    });
  });

  it('splits into separate clusters when a gap exceeds the window', () => {
    const trades = [
      trade({ wallet: 'A', symbol: 'WIF', side: 'buy', timestamp: 0 }),
      trade({ wallet: 'B', symbol: 'WIF', side: 'buy', timestamp: 100_000 }),
    ];
    const events = detectConsensus(trades, { windowMs: 5_000, minWallets: 2 });
    expect(events).toHaveLength(0);
  });

  it('chains consecutive under-threshold gaps into one cluster even if the total span exceeds windowMs (documented tradeoff)', () => {
    const trades = [
      trade({ wallet: 'A', symbol: 'WIF', side: 'buy', timestamp: 0 }),
      trade({ wallet: 'B', symbol: 'WIF', side: 'buy', timestamp: 4_000 }),
      trade({ wallet: 'C', symbol: 'WIF', side: 'buy', timestamp: 8_000 }),
    ];
    const events = detectConsensus(trades, { windowMs: 5_000, minWallets: 3 });
    expect(events).toHaveLength(1);
    expect(events[0]?.wallets).toEqual(['A', 'B', 'C']);
    expect(events[0]?.windowStart).toBe(0);
    expect(events[0]?.windowEnd).toBe(8_000);
  });

  it('counts a wallet only once even if it trades the same token twice inside the cluster', () => {
    const trades = [
      trade({ wallet: 'A', symbol: 'WIF', side: 'buy', timestamp: 0 }),
      trade({ wallet: 'A', symbol: 'WIF', side: 'buy', timestamp: 1_000 }),
    ];
    const events = detectConsensus(trades, { windowMs: 5_000, minWallets: 2 });
    expect(events).toHaveLength(0);
  });

  it('does not merge buys and sells of the same token into one cluster', () => {
    const trades = [
      trade({ wallet: 'A', symbol: 'WIF', side: 'buy', timestamp: 0 }),
      trade({ wallet: 'B', symbol: 'WIF', side: 'sell', timestamp: 1_000 }),
    ];
    const events = detectConsensus(trades, { windowMs: 5_000, minWallets: 2 });
    expect(events).toHaveLength(0);
  });

  it('handles multiple independent symbols and sorts events by windowStart', () => {
    const trades = [
      trade({ wallet: 'A', symbol: 'BONK', side: 'buy', timestamp: 10_000 }),
      trade({ wallet: 'B', symbol: 'BONK', side: 'buy', timestamp: 11_000 }),
      trade({ wallet: 'C', symbol: 'WIF', side: 'buy', timestamp: 0 }),
      trade({ wallet: 'D', symbol: 'WIF', side: 'buy', timestamp: 500 }),
    ];
    const events = detectConsensus(trades, { windowMs: 5_000, minWallets: 2 });
    expect(events).toHaveLength(2);
    expect(events[0]?.symbol).toBe('WIF');
    expect(events[1]?.symbol).toBe('BONK');
  });

  it('returns nothing when no trades are given', () => {
    expect(detectConsensus([], { windowMs: 5_000, minWallets: 2 })).toEqual([]);
  });
});
