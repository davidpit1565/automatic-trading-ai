/**
 * Per-symbol candidate readiness: `shadow:candidate-watch` pools every
 * candidate coin into one basket, so a promotion decision needs THIS
 * symbol's own trade count/PF, not the basket's — see
 * `src/core/autopilot/candidateReadiness.ts`'s doc comment.
 */

import { describe, expect, it } from 'vitest';
import { candidateReadinessBySymbol } from '../../src/core/autopilot/candidateReadiness';
import { SHADOW_MEANINGFUL_TRADES } from '../../src/core/autopilot/shadowEvaluator';
import type { JournalEntry } from '../../src/core/position/tradeJournal';

const T = Date.UTC(2026, 0, 15);
const DAY = 86_400_000;

let counter = 0;
function trade(symbol: string, pnl: number): JournalEntry {
  counter++;
  return {
    id: `t${counter}`,
    symbol,
    entryTimestamp: T + counter * DAY,
    exitTimestamp: T + counter * DAY + 3_600_000,
    entryPrice: 100,
    exitPrice: 100 + pnl / 10,
    positionSize: 10,
    stopLoss: 95,
    takeProfit: 110,
    exitReason: 'take-profit',
    fees: 0,
    slippage: 0,
    holdingDurationMs: 3_600_000,
    mfePct: 5,
    maePct: 2,
    realizedPnl: pnl,
    returnPct: pnl / 10,
    strategyVersion: 'autopilot-paper-v1',
    validationVerdict: null,
    confidence: 50,
    notes: null,
  };
}

describe('candidateReadinessBySymbol', () => {
  it('groups a pooled journal into independent per-symbol stats', () => {
    const entries = [
      trade('AEUR', 10),
      trade('AEUR', -5),
      trade('BEUR', 20),
    ];
    const result = candidateReadinessBySymbol(entries);
    const bySymbol = new Map(result.map((r) => [r.symbol, r]));
    expect(bySymbol.get('AEUR')?.analytics.tradeCount).toBe(2);
    expect(bySymbol.get('BEUR')?.analytics.tradeCount).toBe(1);
    expect(bySymbol.get('BEUR')?.analytics.totalPnl).toBe(20);
  });

  it('sorts by trade count, busiest symbol first', () => {
    const entries = [trade('AEUR', 1), trade('BEUR', 1), trade('BEUR', 1), trade('BEUR', 1)];
    const result = candidateReadinessBySymbol(entries);
    expect(result[0]!.symbol).toBe('BEUR');
    expect(result[0]!.analytics.tradeCount).toBe(3);
  });

  it('is not mature below SHADOW_MEANINGFUL_TRADES, mature at or above it', () => {
    const below = Array.from({ length: SHADOW_MEANINGFUL_TRADES - 1 }, () => trade('AEUR', 1));
    expect(candidateReadinessBySymbol(below)[0]!.mature).toBe(false);

    const atBar = Array.from({ length: SHADOW_MEANINGFUL_TRADES }, () => trade('AEUR', 1));
    expect(candidateReadinessBySymbol(atBar)[0]!.mature).toBe(true);
  });

  it('returns an empty list for an empty journal', () => {
    expect(candidateReadinessBySymbol([])).toEqual([]);
  });
});
