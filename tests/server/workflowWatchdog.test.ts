/**
 * `workflowWatchdog.mts` — nudges a GitHub Actions workflow whose scheduled
 * cron has silently stopped firing (measured 2026-08-31: stocks-autopilot.yml
 * went 3 days with zero runs despite being marked "active"). Pure function,
 * `fetch` injected, no real network in tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { checkAndNudgeStaleWorkflow } from '../../server/workflowWatchdog.mts';

const BASE = { owner: 'davidpit1565', repo: 'automatic-trading-ai', workflowFile: 'stocks-autopilot.yml', token: 'T', staleAfterMs: 90 * 60_000 };
const NOW = Date.parse('2026-08-31T20:00:00Z');

function runsResponse(lastRunAt: string | null): Response {
  const body = lastRunAt ? { workflow_runs: [{ created_at: lastRunAt }] } : { workflow_runs: [] };
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('checkAndNudgeStaleWorkflow', () => {
  it('does not nudge when the last run is within the threshold', async () => {
    const fetchFn = vi.fn(async () => runsResponse('2026-08-31T19:30:00Z')); // 30 min ago
    const result = await checkAndNudgeStaleWorkflow(BASE, NOW, fetchFn as unknown as typeof fetch);
    expect(result.nudged).toBe(false);
    expect(result.reason).toContain('within the');
    expect(fetchFn).toHaveBeenCalledTimes(1); // never reaches the dispatch call
  });

  it('nudges (dispatches) when the last run exceeds the threshold', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).includes('/dispatches')) return new Response(null, { status: 204 });
      return runsResponse('2026-08-28T22:51:48Z'); // ~3 days ago
    });
    const result = await checkAndNudgeStaleWorkflow(BASE, NOW, fetchFn as unknown as typeof fetch);
    expect(result.nudged).toBe(true);
    expect(result.reason).toContain('stale for');
    expect(calls.some((u) => u.includes('/dispatches'))).toBe(true);
  });

  it('skips entirely when shouldBeActive says the workflow is not expected to run right now', async () => {
    const fetchFn = vi.fn();
    const result = await checkAndNudgeStaleWorkflow(
      { ...BASE, shouldBeActive: () => false },
      NOW,
      fetchFn as unknown as typeof fetch,
    );
    expect(result.nudged).toBe(false);
    expect(result.reason).toContain('active window');
    expect(fetchFn).not.toHaveBeenCalled(); // never even reads run history
  });

  it('checks shouldBeActive even when stale, and proceeds when it returns true', async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/dispatches')) return new Response(null, { status: 204 });
      return runsResponse('2026-08-28T22:51:48Z');
    });
    const result = await checkAndNudgeStaleWorkflow(
      { ...BASE, shouldBeActive: () => true },
      NOW,
      fetchFn as unknown as typeof fetch,
    );
    expect(result.nudged).toBe(true);
  });

  it('reports failure honestly when the run-history fetch itself fails', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 403 }));
    const result = await checkAndNudgeStaleWorkflow(BASE, NOW, fetchFn as unknown as typeof fetch);
    expect(result.nudged).toBe(false);
    expect(result.reason).toContain('HTTP 403');
  });

  it('reports failure honestly when the dispatch call itself fails', async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/dispatches')) return new Response('', { status: 422 });
      return runsResponse('2026-08-28T22:51:48Z');
    });
    const result = await checkAndNudgeStaleWorkflow(BASE, NOW, fetchFn as unknown as typeof fetch);
    expect(result.nudged).toBe(false);
    expect(result.reason).toContain('dispatch failed');
    expect(result.reason).toContain('HTTP 422');
  });

  it('reports no recorded runs rather than crashing when the workflow has never run', async () => {
    const fetchFn = vi.fn(async () => runsResponse(null));
    const result = await checkAndNudgeStaleWorkflow(BASE, NOW, fetchFn as unknown as typeof fetch);
    expect(result.nudged).toBe(false);
    expect(result.reason).toContain('no recorded runs');
  });
});
