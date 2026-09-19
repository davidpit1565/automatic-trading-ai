// @vitest-environment happy-dom
/**
 * Operations Console — Overview. DOM integration against the real raw
 * state shape `cloudState.ts` parses (not a hand-rolled CloudState object),
 * so a future raw-key rename gets caught here too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderOverviewView } from '../../src/ui/views/overviewView';

async function waitFor(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function stubState(overrides: Record<string, unknown> = {}): void {
  const raw: Record<string, unknown> = {
    'portfolio-engine': { cash: 10_000, initialCash: 10_000, baseCurrency: 'EUR' },
    'open-positions': [],
    'audit-log': [],
    ...overrides,
  };
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Overview (DOM integration)', () => {
  it('shows "No live account" and hides the live badge/KPIs when there is no live account yet', async () => {
    stubState();
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderOverviewView(container);

    await waitFor(() => container.querySelector('#ov-system-status')!.textContent !== '● checking…');
    expect(container.querySelector('#ov-system-status')!.textContent).toContain('No live account');
    expect(container.querySelector<HTMLElement>('#ov-live-badge')!.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>('#ov-kpis')!.hidden).toBe(true);
  });

  it('surfaces the kill-switch banner above everything else when engaged, with the real reason', async () => {
    stubState({
      'live:live-cash-eur': 500,
      'live:kill-switch': { engaged: true, reason: 'manual halt: reviewing a broker rejection' },
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderOverviewView(container);

    await waitFor(() => container.querySelector<HTMLElement>('#ov-kill-switch')!.hidden === false);
    expect(container.querySelector('#ov-kill-reason')!.textContent).toBe('manual halt: reviewing a broker rejection');
    expect(container.querySelector('#ov-system-status')!.textContent).toContain('Halted');
  });

  it('renders a pending Telegram approval as an Action Required card, distinguishing expired from still-pending', async () => {
    const now = Date.now();
    stubState({
      'live:live-cash-eur': 500,
      'live:live-entry-pending': {
        XBTEUR: {
          opportunity: { symbol: 'XBTEUR', confidence: 82, levels: { entry: 95_000, stopLoss: 92_000, takeProfit: 101_000, riskReward: 2 } },
          queuedAt: now,
          lastAssessment: { positionValue: 200, riskAmount: 20, riskPercentage: 2, rewardRiskRatio: 2 },
        },
      },
      'live:confirmation-gate-pending': { [`live-entry:XBTEUR:${now}`]: { sentAt: now - 25 * 60_000 } }, // expired (>20m window)
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderOverviewView(container);

    await waitFor(() => container.querySelector<HTMLElement>('#ov-action-required')!.hidden === false);
    expect(container.querySelector('#ov-action-list')!.textContent).toContain('XBT');
    expect(container.querySelector('.ops-expired')).not.toBeNull();
    expect(container.querySelector('.ops-expired')!.textContent).toContain('Expired');
  });

  it('escapes real activity detail before inserting it into innerHTML', async () => {
    stubState({
      'live:live-cash-eur': 500,
      'live:audit-log': [{ timestamp: Date.now(), event: 'rejected', detail: '<img src=x onerror=alert(1)>' }],
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderOverviewView(container);

    // `#ov-activity-empty` starts `hidden` in the static markup — waiting on
    // that alone would race ahead of load() ever running (same class of bug
    // fixed earlier in tests/ui/mainNav.test.ts). Wait on the status line
    // instead, which only updates once load() actually completes.
    await waitFor(() => container.querySelector('#ov-status')!.textContent!.startsWith('Updated'));
    expect(container.querySelector('#ov-activity img')).toBeNull();
    expect(container.querySelector('#ov-activity')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows the snapshot freshness badge as stale past the 30-minute bound, using the real last-run timestamp', async () => {
    stubState({
      'live:live-cash-eur': 500,
      'autopilot-last-run': { at: Date.now() - 45 * 60_000 },
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderOverviewView(container);

    await waitFor(() => container.querySelector('#ov-freshness')!.textContent!.length > 0);
    const freshness = container.querySelector('#ov-freshness')!;
    expect(freshness.textContent).toContain('stale');
    expect(freshness.className).toContain('ops-freshness-stale');
  });

  it('reports the freshness badge as Unknown when no automation cycle has ever been recorded', async () => {
    stubState({ 'live:live-cash-eur': 500 });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderOverviewView(container);

    await waitFor(() => container.querySelector('#ov-freshness')!.textContent!.length > 0);
    expect(container.querySelector('#ov-freshness')!.textContent).toContain('Unknown');
  });
});
