import { describe, expect, it } from 'vitest';
import { SyntheticWalletTradeSource } from '../../src/core/copyTrade/syntheticWalletTradeSource';

const ANCHOR = Date.UTC(2026, 8, 1);

describe('SyntheticWalletTradeSource', () => {
  it('is deterministic: same wallet and window yields identical trades', async () => {
    const source = new SyntheticWalletTradeSource(ANCHOR);
    const a = await source.getTrades('WALLET_1', ANCHOR - 40 * 86_400_000, ANCHOR);
    const b = await source.getTrades('WALLET_1', ANCHOR - 40 * 86_400_000, ANCHOR);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value).toEqual(b.value);
  });

  it('produces different histories for different wallets', async () => {
    const source = new SyntheticWalletTradeSource(ANCHOR);
    const a = await source.getTrades('WALLET_1', ANCHOR - 40 * 86_400_000, ANCHOR);
    const b = await source.getTrades('WALLET_2', ANCHOR - 40 * 86_400_000, ANCHOR);
    expect(a.ok && b.ok && JSON.stringify(a.value) !== JSON.stringify(b.value)).toBe(true);
  });

  it('returns only trades within [sinceMs, untilMs) and only buy/sell rows with required fields', async () => {
    const source = new SyntheticWalletTradeSource(ANCHOR);
    const since = ANCHOR - 40 * 86_400_000;
    const result = await source.getTrades('WALLET_1', since, ANCHOR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    for (const t of result.value) {
      expect(t.timestamp).toBeGreaterThanOrEqual(since);
      expect(t.timestamp).toBeLessThan(ANCHOR);
      expect(['buy', 'sell']).toContain(t.side);
      expect(t.wallet).toBe('WALLET_1');
      expect(t.usdAmount).toBeGreaterThan(0);
      expect(t.price).toBeGreaterThan(0);
    }
  });

  it('rejects an empty wallet or an inverted time window', async () => {
    const source = new SyntheticWalletTradeSource(ANCHOR);
    expect((await source.getTrades('', ANCHOR - 1000, ANCHOR)).ok).toBe(false);
    expect((await source.getTrades('WALLET_1', ANCHOR, ANCHOR - 1000)).ok).toBe(false);
  });
});
