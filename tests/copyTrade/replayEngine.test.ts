import { describe, expect, it } from 'vitest';
import { DEFAULT_LATENCY_DRIFT_PCT_PER_MINUTE, replayCopyTrade, type ReplayParams } from '../../src/core/copyTrade/replayEngine';
import type { WalletTrade } from '../../src/core/copyTrade/walletTradeSource';

const NO_COST_PARAMS: ReplayParams = {
  detectionLatencyMs: 0,
  slippagePct: 0,
  feePct: 0,
  positionSizeUsd: 1_000,
};

function trade(overrides: Partial<WalletTrade> & Pick<WalletTrade, 'side' | 'usdAmount' | 'price' | 'timestamp'>): WalletTrade {
  return {
    wallet: 'WALLET_A',
    symbol: 'WIF',
    chain: 'solana',
    ...overrides,
  };
}

describe('replayCopyTrade', () => {
  it('returns empty results with no crash for zero trades', () => {
    const result = replayCopyTrade([], NO_COST_PARAMS);
    expect(result.perToken).toEqual([]);
    expect(result.aggregate).toEqual({
      realizedPnl: 0,
      roiPct: 0,
      tradeCount: 0,
      winRatePct: null,
      maxDrawdownPct: 0,
    });
  });

  it('a full round trip (buy then full sell) closes the position and realizes P&L', () => {
    const trades: WalletTrade[] = [
      trade({ side: 'buy', usdAmount: 10_000, price: 1, timestamp: 0 }),
      trade({ side: 'sell', usdAmount: 20_000, price: 2, timestamp: HOUR }),
    ];
    const result = replayCopyTrade(trades, NO_COST_PARAMS);
    expect(result.perToken).toHaveLength(1);
    const token = result.perToken[0]!;
    expect(token.wallet).toBe('WALLET_A');
    expect(token.symbol).toBe('WIF');
    // We copied $1000 in at price 1 (1000 tokens), price doubles to 2 -> $2000 out, no fees/slippage.
    expect(token.realizedPnl).toBeCloseTo(1_000, 6);
    expect(token.roiPct).toBeCloseTo(100, 6);
    expect(token.tradeCount).toBe(1);
    expect(token.winRatePct).toBe(100);
    expect(token.closedTrades).toHaveLength(1);
    expect(token.closedTrades[0]!.quantity).toBeCloseTo(1_000, 6); // fully closed, not partially
  });

  it('a partial sell proportionally reduces the position rather than closing it', () => {
    const trades: WalletTrade[] = [
      // Wallet buys 1000 tokens at $1.
      trade({ side: 'buy', usdAmount: 1_000, price: 1, timestamp: 0 }),
      // Wallet sells 40% of their position (400 of 1000 tokens) at $1.
      trade({ side: 'sell', usdAmount: 400, price: 1, timestamp: HOUR }),
    ];
    const result = replayCopyTrade(trades, NO_COST_PARAMS);
    const token = result.perToken[0]!;
    // Our copied buy was $1000 at $1 = 1000 tokens; a 40% wallet sell should
    // close exactly 40% of OUR position (400 tokens), not the whole thing.
    expect(token.closedTrades).toHaveLength(1);
    expect(token.closedTrades[0]!.quantity).toBeCloseTo(400, 6);
    // Remaining position (600 tokens) is still open — no second closed trade yet.
    expect(token.realizedPnl).toBeCloseTo(0, 6); // flat price, no fees: breakeven on the sold slice
  });

  it('a partial sell followed by a full exit produces two closed trades that together account for the whole position', () => {
    const trades: WalletTrade[] = [
      trade({ side: 'buy', usdAmount: 1_000, price: 1, timestamp: 0 }),
      trade({ side: 'sell', usdAmount: 300, price: 1, timestamp: HOUR }), // 30% partial
      trade({ side: 'sell', usdAmount: 700, price: 1, timestamp: 2 * HOUR }), // the rest, full exit
    ];
    const result = replayCopyTrade(trades, NO_COST_PARAMS);
    const token = result.perToken[0]!;
    expect(token.closedTrades).toHaveLength(2);
    expect(token.closedTrades[0]!.quantity).toBeCloseTo(300, 6);
    expect(token.closedTrades[1]!.quantity).toBeCloseTo(700, 6);
    const totalClosedQty = token.closedTrades.reduce((s, t) => s + t.quantity, 0);
    expect(totalClosedQty).toBeCloseTo(1_000, 6);
  });

  it('processes multiple wallets and tokens independently', () => {
    const trades: WalletTrade[] = [
      trade({ wallet: 'WALLET_A', symbol: 'WIF', side: 'buy', usdAmount: 1_000, price: 1, timestamp: 0 }),
      trade({ wallet: 'WALLET_A', symbol: 'WIF', side: 'sell', usdAmount: 1_500, price: 1.5, timestamp: HOUR }),
      trade({ wallet: 'WALLET_B', symbol: 'BONK', side: 'buy', usdAmount: 1_000, price: 0.5, timestamp: 0 }),
      trade({ wallet: 'WALLET_B', symbol: 'BONK', side: 'sell', usdAmount: 800, price: 0.4, timestamp: HOUR }),
    ];
    const result = replayCopyTrade(trades, NO_COST_PARAMS);
    expect(result.perToken).toHaveLength(2);
    const a = result.perToken.find((t) => t.wallet === 'WALLET_A')!;
    const b = result.perToken.find((t) => t.wallet === 'WALLET_B')!;
    expect(a.realizedPnl).toBeGreaterThan(0); // WIF went up
    expect(b.realizedPnl).toBeLessThan(0); // BONK went down
    // Aggregate is exactly the sum of the two independent token results.
    expect(result.aggregate.realizedPnl).toBeCloseTo(a.realizedPnl + b.realizedPnl, 6);
    expect(result.aggregate.tradeCount).toBe(a.tradeCount + b.tradeCount);
  });

  it('applies the documented slippage/latency adverse-fill formula on both sides', () => {
    const params: ReplayParams = {
      detectionLatencyMs: 60_000, // exactly 1 minute
      slippagePct: 1, // 1%
      feePct: 0,
      positionSizeUsd: 1_000,
      latencyDriftPctPerMinute: 0.5, // 0.5% per minute, chosen to make the math easy to check by hand
    };
    // adversePct = (60_000/60_000)*0.5 + 1 = 1.5% -> buy fill = 100*1.015, sell fill = 100*0.985.
    const trades: WalletTrade[] = [
      trade({ side: 'buy', usdAmount: 1_000, price: 100, timestamp: 0 }), // wallet buys 10 tokens
      trade({ side: 'sell', usdAmount: 1_000, price: 100, timestamp: HOUR }), // wallet fully exits (10 tokens)
    ];
    const result = replayCopyTrade(trades, params);
    const token = result.perToken[0]!;
    const buyFill = 100 * 1.015;
    const sellFill = 100 * 0.985;
    const expectedQty = 1_000 / buyFill;
    expect(token.closedTrades[0]!.quantity).toBeCloseTo(expectedQty, 6);
    expect(token.closedTrades[0]!.exitPrice).toBeCloseTo(sellFill, 6);
    const expectedPnl = expectedQty * sellFill - 1_000; // proceeds at the degraded sell fill minus our $1000 cost
    expect(token.realizedPnl).toBeCloseTo(expectedPnl, 6);
    expect(DEFAULT_LATENCY_DRIFT_PCT_PER_MINUTE).toBeGreaterThan(0); // sanity: default is documented and positive
  });

  it('deducts fees per simulated trade', () => {
    const params: ReplayParams = { ...NO_COST_PARAMS, feePct: 1 }; // 1% per fill
    const trades: WalletTrade[] = [
      trade({ side: 'buy', usdAmount: 1_000, price: 1, timestamp: 0 }),
      trade({ side: 'sell', usdAmount: 1_000, price: 1, timestamp: HOUR }), // flat price, full exit
    ];
    const result = replayCopyTrade(trades, params);
    const token = result.perToken[0]!;
    // Flat price but 1% fee on entry (in totalDeployed) and 1% fee on exit proceeds
    // means a net loss even though the price never moved.
    expect(token.realizedPnl).toBeLessThan(0);
  });
});

const HOUR = 3_600_000;
