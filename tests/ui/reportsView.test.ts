// @vitest-environment happy-dom
/**
 * Operations Console — Reports. Plain aggregates over the real trade
 * journal, with an honest distinction between "nothing in this period" and
 * "no closed trades at all" — never a zero-filled report standing in for
 * either.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderReportsView } from '../../src/ui/views/reportsView';

async function waitFor(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function trade(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1', symbol: 'XBTEUR', entryTimestamp: 1, exitTimestamp: Date.now(), entryPrice: 100_000, exitPrice: 101_000,
    positionSize: 0.01, exitReason: 'take-profit', fees: 0.4, slippage: 0.1, holdingDurationMs: 3_600_000,
    mfePct: 1, maePct: -1, realizedPnl: 10, returnPct: 1, notes: null,
    ...overrides,
  };
}

function stubState(tradeJournal: unknown[]): void {
  const raw = {
    'portfolio-engine': { cash: 10_000, initialCash: 10_000, baseCurrency: 'EUR' },
    'open-positions': [],
    'audit-log': [],
    'live:live-cash-eur': 500,
    'live:trade-journal': tradeJournal,
  };
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('Reports (DOM integration)', () => {
  it('shows "no closed live trades at all" (not a zero-filled report) when the journal is empty', async () => {
    stubState([]);
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderReportsView(container);

    await waitFor(() => container.querySelector('#rp-status')!.textContent!.startsWith('Updated'));
    expect(container.querySelector<HTMLElement>('#rp-empty')!.hidden).toBe(false);
    expect(container.querySelector('#rp-empty')!.textContent).toContain('nothing to report');
    expect(container.querySelector('#rp-body')!.textContent).toBe('');
  });

  it('computes real aggregates from the journal, keeping fees (estimated) and slippage (measured) separate', async () => {
    stubState([trade({ realizedPnl: 10, fees: 0.4, slippage: 0.1 }), trade({ id: 't2', realizedPnl: -4, fees: 0.3, slippage: 0.2 })]);
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderReportsView(container);

    await waitFor(() => container.querySelector('#rp-status')!.textContent!.startsWith('Updated'));
    const body = container.querySelector('#rp-body')!;
    expect(body.textContent).toContain('Closed trades');
    expect(body.textContent).toContain('2');
    expect(body.textContent).toContain('Total fees (estimated)');
    expect(body.textContent).toContain('Total slippage (measured)');
    expect(body.textContent).toContain('€0.70'); // total fees: 0.4 + 0.3
    expect(body.textContent).toContain('€0.30'); // total slippage: 0.1 + 0.2
  });

  it('distinguishes "no trades in this period" from "no closed trades at all" when a period filter empties the set', async () => {
    stubState([trade({ exitTimestamp: Date.now() - 200 * 86_400_000 })]); // 200 days ago — outside 7D/30D/90D
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderReportsView(container);
    await waitFor(() => container.querySelector('#rp-status')!.textContent!.startsWith('Updated'));

    // ALL (default) shows the one real trade.
    expect(container.querySelector<HTMLElement>('#rp-empty')!.hidden).toBe(true);

    container.querySelector<HTMLElement>('.tv-filter[data-period="7d"]')!.click();
    expect(container.querySelector<HTMLElement>('#rp-empty')!.hidden).toBe(false);
    expect(container.querySelector('#rp-empty')!.textContent).toBe('No closed trades in the last 7D.');
    expect(container.querySelector('#rp-empty')!.textContent).not.toContain('nothing to report');
  });
});
