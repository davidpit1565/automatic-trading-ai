import { describe, expect, it } from 'vitest';
import { rankWalletsByQuality, scoreWalletQuality } from '../../src/core/copyTrade/walletQuality';
import type { ReplayResult, TokenReplayResult } from '../../src/core/copyTrade/replayEngine';

function mkToken(symbol: string, realizedPnl: number): TokenReplayResult {
  return { wallet: 'W', symbol, realizedPnl, roiPct: 0, tradeCount: 1, winRatePct: null, maxDrawdownPct: 0, closedTrades: [] };
}

function mkResult(
  aggregate: Partial<ReplayResult['aggregate']> & { tradeCount: number },
  perToken: readonly TokenReplayResult[] = [],
): ReplayResult {
  return {
    perToken,
    aggregate: {
      realizedPnl: aggregate.realizedPnl ?? 0,
      roiPct: aggregate.roiPct ?? 0,
      tradeCount: aggregate.tradeCount,
      winRatePct: aggregate.winRatePct ?? null,
      maxDrawdownPct: aggregate.maxDrawdownPct ?? 0,
    },
  };
}

describe('scoreWalletQuality', () => {
  it('matches the documented formula exactly for a hand-computed case', () => {
    // tradeCount=10, roiPct=0, winRatePct=50, maxDrawdownPct=0, no perToken entries.
    // roiScore=50, winRateScore=50, drawdownScore=100 -> rawPerformanceScore=62.5
    // sampleSizeWeight=10/20=0.5, diversityWeight=0.5 (0 profitable tokens) -> confidenceWeight=0.25
    // score = 50 + (62.5-50)*0.25 = 53.125
    const result = mkResult({ tradeCount: 10, roiPct: 0, winRatePct: 50, maxDrawdownPct: 0 });
    const quality = scoreWalletQuality(result);
    expect(quality.score).toBeCloseTo(53.125, 6);
    expect(quality.components.rawPerformanceScore).toBeCloseTo(62.5, 6);
    expect(quality.components.sampleSizeWeight).toBeCloseTo(0.5, 6);
    expect(quality.components.diversityWeight).toBeCloseTo(0.5, 6);
  });

  it('a low-sample-size wallet scores lower (shrunk toward neutral) than a high-sample wallet with the same raw ROI', () => {
    const lowSample = mkResult({ tradeCount: 1, roiPct: 50, winRatePct: 100, maxDrawdownPct: 0 });
    const highSample = mkResult({ tradeCount: 50, roiPct: 50, winRatePct: 100, maxDrawdownPct: 0 });
    const low = scoreWalletQuality(lowSample);
    const high = scoreWalletQuality(highSample);
    expect(low.score!).toBeLessThan(high.score!);
    expect(low.confidence).toBe('low');
    expect(high.confidence).toBe('high');
  });

  it('a wallet profitable across multiple independent tokens scores higher than one profitable on only one token', () => {
    const singleToken = mkResult({ tradeCount: 10, roiPct: 30, winRatePct: 70, maxDrawdownPct: 5 }, [mkToken('WIF', 500)]);
    const multiToken = mkResult({ tradeCount: 10, roiPct: 30, winRatePct: 70, maxDrawdownPct: 5 }, [
      mkToken('WIF', 300),
      mkToken('BONK', 150),
      mkToken('PEPE', 50),
    ]);
    const single = scoreWalletQuality(singleToken);
    const multi = scoreWalletQuality(multiToken);
    expect(multi.score!).toBeGreaterThan(single.score!);
    expect(single.tokensProfitable).toBe(1);
    expect(multi.tokensProfitable).toBe(3);
  });

  it('a wallet with a large max drawdown scores lower than one with a small drawdown at the same ROI', () => {
    const smallDrawdown = mkResult({ tradeCount: 20, roiPct: 40, winRatePct: 60, maxDrawdownPct: 5 });
    const largeDrawdown = mkResult({ tradeCount: 20, roiPct: 40, winRatePct: 60, maxDrawdownPct: 50 });
    expect(scoreWalletQuality(smallDrawdown).score!).toBeGreaterThan(scoreWalletQuality(largeDrawdown).score!);
  });

  it('a zero-trades wallet is flagged insufficient rather than given a misleadingly confident score', () => {
    const zero = mkResult({ tradeCount: 0 });
    const quality = scoreWalletQuality(zero);
    expect(quality.score).toBeNull();
    expect(quality.insufficientData).toBe(true);
    expect(quality.confidence).toBe('insufficient');
    expect(quality.tokensTraded).toBe(0);
    expect(quality.tokensProfitable).toBe(0);
  });
});

describe('rankWalletsByQuality', () => {
  it('sorts wallets by quality score descending, with insufficient-data wallets last', () => {
    const lowSample = mkResult({ tradeCount: 1, roiPct: 50, winRatePct: 100, maxDrawdownPct: 0 });
    const highSample = mkResult({ tradeCount: 50, roiPct: 50, winRatePct: 100, maxDrawdownPct: 0 });
    const noData = mkResult({ tradeCount: 0 });

    const ranked = rankWalletsByQuality([
      { id: 'low', result: lowSample },
      { id: 'none', result: noData },
      { id: 'high', result: highSample },
    ]);

    expect(ranked.map((r) => r.id)).toEqual(['high', 'low', 'none']);
  });
});
