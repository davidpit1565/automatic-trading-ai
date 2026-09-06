/**
 * Regression test for a real bug found in review, 2026-09-06:
 * `monitorSystemChanges` used to persist the new comparison baseline
 * ('monitor-last-state') UNCONDITIONALLY, before checking whether the
 * Telegram send actually succeeded. A transient send failure therefore
 * silently and permanently dropped that change — the next cycle compared
 * against a baseline that already reflected the unreported change, so the
 * diff (and the alert) vanished with no retry, unlike every other
 * notification in this codebase (autopilotRunner.mts's
 * maybeSendSummaries/maybeSendAllClear only persist "already notified"
 * state after confirming `result.sent`).
 *
 * This is tested in its own file (rather than extending systemMonitor.test.ts)
 * because it needs SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED mocked to `true`
 * — that flag currently silences `monitorSystemChanges` entirely (see
 * telegram.mts's doc comment), and vi.mock is file-scoped, so this leaves
 * every other test file's real (false) value untouched.
 */

import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';

vi.mock('../../server/telegram.mts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/telegram.mts')>();
  return { ...actual, SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED: true };
});

const { monitorSystemChanges } = await import('../../server/systemMonitor.mts');

function baselineState(now: number, equity: number): Record<string, unknown> {
  return {
    'monitor-last-state': {
      timestamp: now,
      autopilotLastRunAt: now,
      autopilotLastRunSuccess: true,
      equity,
      realizedPnlTotal: 0,
      closedTradeCount: 0,
      openPositionCount: 0,
      auditLogEntryCount: 0,
      latestAuditLogEntry: null,
      pagesLastDeployAt: null,
    },
    'autopilot-last-run': { at: now },
    'trade-journal': [],
  };
}

describe('monitorSystemChanges — alert-send-failure retry (2026-09-06 fix)', () => {
  it('does NOT advance the comparison baseline when the Telegram send fails, so the same change is retried next cycle', async () => {
    const store = new MemoryStore();
    const t0 = Date.parse('2026-09-06T10:00:00Z');
    for (const [k, v] of Object.entries(baselineState(t0, 10_000))) store.set(k, v);
    // Realized P&L moved: equity is now 10_050 — a real, alert-worthy change.
    store.set('trade-journal', [{ realizedPnl: 50 }]);

    vi.stubGlobal('fetch', async () => new Response('', { status: 500 })); // Telegram send fails

    const t1 = t0 + 90 * 60 * 1000;
    await monitorSystemChanges(store as any, { token: 'T', chatId: 'C' }, t1);

    // The failed send must NOT have overwritten the baseline with the new
    // (equity 10_050) state — it must still reflect the OLD, un-alerted one.
    const stillBaseline = store.get<{ equity: number }>('monitor-last-state');
    expect(stillBaseline?.equity).toBe(10_000);

    // A later cycle, even with Telegram healthy again but no further change,
    // must still see (and be able to alert on) the original +50 move.
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { text: string };
      expect(body.text).toContain('Equity');
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    });
    const t2 = t1 + 90 * 60 * 1000;
    await monitorSystemChanges(store as any, { token: 'T', chatId: 'C' }, t2);
    expect(store.get<{ equity: number }>('monitor-last-state')?.equity).toBe(10_050);

    vi.unstubAllGlobals();
  });

  it('DOES advance the baseline immediately when there is nothing to report', async () => {
    const store = new MemoryStore();
    const t0 = Date.parse('2026-09-06T10:00:00Z');
    for (const [k, v] of Object.entries(baselineState(t0, 10_000))) store.set(k, v);

    vi.stubGlobal('fetch', vi.fn()); // must not even be called — no message to send
    const t1 = t0 + 90 * 60 * 1000;
    await monitorSystemChanges(store as any, { token: 'T', chatId: 'C' }, t1);

    expect(store.get<{ equity: number }>('monitor-last-state')?.equity).toBe(10_000);
    vi.unstubAllGlobals();
  });
});
