/**
 * System monitor tests: change detection and alert generation.
 */

import { describe, expect, it, vi } from 'vitest';
import { fetchSystemState, monitorSystemChanges } from '../../server/systemMonitor.mts';

describe('fetchSystemState', () => {
  it('returns a valid system state snapshot', async () => {
    // Create a mock store
    const mockStore = {
      get: (key: string) => {
        if (key === 'trade-journal') {
          return {
            entries: [
              {
                symbol: 'BTC-EUR',
                entryTimestamp: 1000,
                entryPrice: 50000,
                quantity: 0.01,
                exitTimestamp: 2000,
                exitPrice: 51000,
                exitReason: 'take-profit',
                fees: 10,
              },
            ],
          };
        }
        return null;
      },
      set: () => {}, // mock set for store
    };

    const state = await fetchSystemState(mockStore as any, Date.now());
    expect(state).toHaveProperty('timestamp');
    expect(state).toHaveProperty('equity');
    expect(state).toHaveProperty('closedTradeCount');
    expect(state.closedTradeCount).toBeGreaterThanOrEqual(0); // At least fetched without error
  });

  it('handles missing data gracefully', async () => {
    const mockStore = {
      get: () => null,
      set: () => {},
    };

    const state = await fetchSystemState(mockStore as any, Date.now());
    expect(state.equity).toBe(10_000); // fallback
    expect(state.closedTradeCount).toBe(0);
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

  it('handles errors gracefully without crashing', async () => {
    const mockStore = {
      get: () => {
        throw new Error('store get failure');
      },
      set: () => {
        throw new Error('store set failure');
      },
    };
    const consoleSpy = vi.spyOn(console, 'error');

    // This should not throw, even though store fails
    await expect(
      monitorSystemChanges(mockStore as any, { token: 'T', chatId: 'C' }, Date.now()),
    ).resolves.toBeUndefined();

    // Verify error was logged
    const calls = consoleSpy.mock.calls.filter((call) =>
      call[0]?.toString().includes('System monitor error'),
    );
    expect(calls.length).toBeGreaterThan(0);
  });
});
