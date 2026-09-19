// @vitest-environment happy-dom
/**
 * Operations Console — Trades. DOM integration against the real raw state
 * shape `cloudState.ts` parses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderTradesView } from '../../src/ui/views/tradesView';
import { selection } from '../../src/ui/selection';

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
    'live:live-cash-eur': 500,
    ...overrides,
  };
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  selection.tradeId = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('Trades (DOM integration)', () => {
  it('shows entry-anchored risk context on an open position — never a fabricated current price/unrealized P&L', async () => {
    stubState({
      'live:live-open-positions': {
        1: { symbol: 'XBTEUR', quantity: 0.01, entryPrice: 100_000, stopLoss: 95_000, takeProfit: 115_000, openedAt: Date.now() },
      },
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderTradesView(container);

    await waitFor(() => container.querySelector('#tv-status')!.textContent!.startsWith('Updated'));
    const card = container.querySelector('#tv-open-list .ops-action-card')!;
    expect(card.textContent).toContain('XBT');
    expect(card.textContent).toContain('unavailable in current snapshot');
    // Risk is entry-anchored (5000 risk = 0.01 * (100000-95000)), not derived
    // from any live market price this data model doesn't have.
    expect(card.textContent).toContain('€50.00');
  });

  it('shows fees (estimated) and slippage (measured) as two separate lines on a closed trade, never blended', async () => {
    stubState({
      'live:trade-journal': [
        {
          id: 't1', symbol: 'XBTEUR', entryTimestamp: 1, exitTimestamp: 2, entryPrice: 100_000, exitPrice: 101_000,
          positionSize: 0.01, exitReason: 'take-profit', fees: 0.42, slippage: 0.11, holdingDurationMs: 3_600_000,
          mfePct: 1.2, maePct: -0.3, realizedPnl: 10, returnPct: 1, notes: null,
        },
      ],
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderTradesView(container);

    await waitFor(() => container.querySelector('#tv-status')!.textContent!.startsWith('Updated'));
    const card = container.querySelector('#tv-closed-list .ops-action-card')!;
    expect(card.textContent).toContain('Fees (estimated)');
    expect(card.textContent).toContain('Slippage (measured)');
    expect(card.textContent).not.toMatch(/Trading costs/i);

    // A desktop operations table renders from the same data, CSS-toggled
    // rather than squeezing a table sideways on a phone or stretching cards
    // to desktop width — both exist in the DOM regardless of viewport.
    const row = container.querySelector('#tv-closed-table-body tr')!;
    expect(row.textContent).toContain('XBT');
    expect(row.textContent).toContain('take-profit');
    expect(row.querySelectorAll('td').length).toBeGreaterThanOrEqual(10);
  });

  it('filters by status (Open/Closed) and by asset', async () => {
    stubState({
      'live:live-open-positions': {
        1: { symbol: 'XBTEUR', quantity: 0.01, entryPrice: 100_000, stopLoss: 95_000, takeProfit: 115_000, openedAt: 1 },
      },
      'live:trade-journal': [
        {
          id: 't1', symbol: 'ADAEUR', entryTimestamp: 1, exitTimestamp: 2, entryPrice: 1, exitPrice: 1.1,
          positionSize: 100, exitReason: 'take-profit', fees: 0.1, slippage: 0.05, holdingDurationMs: 1,
          mfePct: 1, maePct: -1, realizedPnl: 10, returnPct: 10, notes: null,
        },
      ],
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderTradesView(container);
    await waitFor(() => container.querySelector('#tv-status')!.textContent!.startsWith('Updated'));

    container.querySelector<HTMLElement>('.tv-filter[data-status="open"]')!.click();
    expect(container.querySelector<HTMLElement>('#tv-open-section')!.hidden).toBe(false);
    expect(container.querySelector<HTMLElement>('#tv-closed-section')!.hidden).toBe(true);

    container.querySelector<HTMLElement>('.tv-filter[data-status="all"]')!.click();
    const assetSelect = container.querySelector<HTMLSelectElement>('#tv-asset-filter')!;
    assetSelect.value = 'ADA';
    assetSelect.dispatchEvent(new Event('change'));
    expect(container.querySelector('#tv-open-list')!.children.length).toBe(0);
    expect(container.querySelector('#tv-closed-list')!.children.length).toBe(1);
  });

  it('records the tapped trade id before navigating to the detail view', async () => {
    stubState({
      'live:trade-journal': [
        {
          id: 'trade-abc', symbol: 'XBTEUR', entryTimestamp: 1, exitTimestamp: 2, entryPrice: 1, exitPrice: 1,
          positionSize: 1, exitReason: 'take-profit', fees: 0, slippage: 0, holdingDurationMs: 1,
          mfePct: 0, maePct: 0, realizedPnl: 0, returnPct: 0, notes: null,
        },
      ],
    });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderTradesView(container);
    await waitFor(() => container.querySelector('#tv-status')!.textContent!.startsWith('Updated'));

    expect(selection.tradeId).toBeNull();
    container.querySelector<HTMLElement>('[data-trade-id="trade-abc"]')!.click();
    expect(selection.tradeId).toBe('trade-abc');
  });
});
