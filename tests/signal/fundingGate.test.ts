import { describe, expect, it } from 'vitest';
import { buildFundingGate } from '../../src/core/signal/fundingGate';
import type { FundingRatePoint } from '../../src/core/data/okxFunding';

const H8 = 8 * 3_600_000;
const T0 = Date.UTC(2026, 8, 1);

/** `rates` settled every 8h starting at T0, oldest first. */
function series(rates: readonly number[]): FundingRatePoint[] {
  return rates.map((rate, i) => ({ timestamp: T0 + i * H8, rate }));
}
const at = (i: number): number => T0 + i * H8;

describe('buildFundingGate', () => {
  it('fails open with too little history to judge', () => {
    const gate = buildFundingGate(series([0.001, 0.001, 0.001]));
    expect(gate(at(2))).toBe(true);
  });

  it('blocks when the last 24h of funding is far above the coin\'s own history', () => {
    const rates = [...Array.from({ length: 40 }, () => 0.00003), 0.0005, 0.0006, 0.0007];
    const gate = buildFundingGate(series(rates));
    expect(gate(at(rates.length - 1))).toBe(false);
  });

  it('allows when recent funding is ordinary for that coin', () => {
    const rates = Array.from({ length: 43 }, (_, i) => (i % 2 === 0 ? 0.00002 : 0.00006));
    expect(buildFundingGate(series(rates))(at(42))).toBe(true);
  });

  it('never reads a coin flat at the 0.01% baseline as crowded', () => {
    const gate = buildFundingGate(series(Array.from({ length: 50 }, () => 0.0001)));
    expect(gate(at(49))).toBe(true);
  });

  it('allows when recent funding is negative (shorts paying), however extreme', () => {
    const rates = [...Array.from({ length: 40 }, () => 0.00003), -0.001, -0.001, -0.001];
    expect(buildFundingGate(series(rates))(at(42))).toBe(true);
  });

  it('ignores points settled after the decision time (no look-ahead)', () => {
    const rates = [...Array.from({ length: 40 }, () => 0.00003), 0.0005, 0.0006, 0.0007];
    const gate = buildFundingGate(series(rates));
    // At index 39 the spike hasn't happened yet.
    expect(gate(at(39))).toBe(true);
  });
});
