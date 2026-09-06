/**
 * System monitor tests: change detection and alert generation.
 */

import { describe, expect, it, vi } from 'vitest';
import { fetchSystemState, monitorSystemChanges } from '../../server/systemMonitor.mts';

describe('fetchSystemState', () => {
  it('returns a valid system state snapshot', async () => {
    // Real bug: TradeJournal stores a plain JournalEntry[] directly at
    // 'trade-journal' (position/tradeJournal.ts), not {entries: [...]}. The
    // old code checked journalData.entries — always undefined on a real
    // array — so closedTradeCount/realizedPnlTotal were stuck at 0 forever.
    const mockStore = {
      get: (key: string) => {
        if (key === 'trade-journal') {
          return [
            {
              symbol: 'BTC-EUR',
              entryTimestamp: 1000,
              entryPrice: 50000,
              quantity: 0.01,
              exitTimestamp: 2000,
              exitPrice: 51000,
              exitReason: 'take-profit',
              fees: 10,
              realizedPnl: 490,
            },
          ];
        }
        // Real bug: PositionEngine stores at 'open-positions', not 'positions'.
        if (key === 'open-positions') return [{ symbol: 'ETH-EUR' }];
        return null;
      },
      set: () => {}, // mock set for store
    };

    const state = await fetchSystemState(mockStore as any, Date.now());
    expect(state).toHaveProperty('timestamp');
    expect(state.closedTradeCount).toBe(1);
    expect(state.realizedPnlTotal).toBe(490);
    expect(state.equity).toBe(10_490); // 10_000 initial + realized P&L
    expect(state.openPositionCount).toBe(1);
  });

  it('handles missing data gracefully', async () => {
    const mockStore = {
      get: () => null,
      set: () => {},
    };

    const state = await fetchSystemState(mockStore as any, Date.now());
    expect(state.equity).toBe(10_000); // fallback
    expect(state.closedTradeCount).toBe(0);
    expect(state.openPositionCount).toBe(0);
  });
});

describe('monitorSystemChanges', () => {
  it('skips silently when Telegram is not configured', async () => {
    const mockStore = { get: () => null, set: () => {} };
    const consoleSpy = vi.spyOn(console, 'log');

    await monitorSystemChanges(mockStore as any, { token: '', chatId: '' }, Date.now());

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Telegram not configured'),
    );
  });

  it('never touches the store or sends anything now — silenced entirely, simulated-only (David, 2026-09-06)', async () => {
    // This monitor only ever reads the SIMULATED crypto/stocks state files
    // (see systemMonitorRunner.mts's two call sites) — silenced regardless
    // of Telegram being configured, so a store failure is never even reached.
    const mockStore = {
      get: () => {
        throw new Error('store get failure');
      },
      set: () => {
        throw new Error('store set failure');
      },
    };
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);

    await expect(
      monitorSystemChanges(mockStore as any, { token: 'T', chatId: 'C' }, Date.now()),
    ).resolves.toBeUndefined();

    expect(fetchFn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sends nothing even with real data and a fully valid config (simulated engine only, no live equivalent)', async () => {
    // Two robots share this same code path (see systemMonitorRunner.mts),
    // and neither is ever the live-money store — so, unlike a labeled
    // currency check, the correct behavior now is "never sends" for both.
    const now = Date.now();
    const data: Record<string, unknown> = {
      'monitor-last-state': {
        timestamp: now - 60_000,
        autopilotLastRunAt: now - 60_000,
        autopilotLastRunSuccess: true,
        equity: 10_000,
        realizedPnlTotal: 0,
        closedTradeCount: 0,
        openPositionCount: 0,
        auditLogEntryCount: 0,
        latestAuditLogEntry: null,
        pagesLastDeployAt: null,
      },
      'autopilot-last-run': { at: now },
      'trade-journal': [{ realizedPnl: 500 }],
    };
    const mockStore = {
      get: (key: string) => data[key] ?? null,
      set: (key: string, value: unknown) => {
        data[key] = value;
      },
    };
    let sentBody: string | null = null;
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      sentBody = init.body;
      return Promise.resolve({ ok: true } as Response);
    });

    await monitorSystemChanges(mockStore as any, { token: 'T', chatId: 'C' }, now, 'Stocks', '$');

    expect(sentBody).toBeNull();

    vi.unstubAllGlobals();
  });
});
