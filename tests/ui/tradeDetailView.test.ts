// @vitest-environment happy-dom
/**
 * Operations Console — Trade Detail. Shows only fields the live trade
 * journal actually persists — no signal-vs-fill breakdown, no decision
 * context, no audit timeline (none of those are correlated to a specific
 * journal entry id in the current data model).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderTradeDetailView } from '../../src/ui/views/tradeDetailView';
import { selection } from '../../src/ui/selection';

async function waitFor(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function stubState(tradeJournal: unknown[] = []): void {
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

describe('Trade Detail (DOM integration)', () => {
  it('shows "No trade selected" when reached without a selection', async () => {
    selection.tradeId = null;
    stubState();
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderTradeDetailView(container);

    await waitFor(() => container.querySelector('#td-body')!.textContent !== 'Loading…');
    expect(container.querySelector('#td-body')!.textContent).toContain('No trade selected');
  });

  it('shows "Trade not found" for a stale/unknown id rather than fabricating a blank record', async () => {
    selection.tradeId = 'nonexistent';
    stubState([]);
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderTradeDetailView(container);

    await waitFor(() => container.querySelector('#td-body')!.textContent !== 'Loading…');
    expect(container.querySelector('#td-body')!.textContent).toContain('not found');
  });

  it('renders Result/Execution/Costs/Behavior from only the fields the journal entry actually carries', async () => {
    selection.tradeId = 'trade-1';
    stubState([
      {
        id: 'trade-1', symbol: 'XBTEUR', entryTimestamp: 1_700_000_000_000, exitTimestamp: 1_700_003_600_000,
        entryPrice: 100_000, exitPrice: 101_000, positionSize: 0.01, exitReason: 'take-profit',
        fees: 0.42, slippage: 0.11, holdingDurationMs: 3_600_000, mfePct: 1.5, maePct: -0.4,
        realizedPnl: 10, returnPct: 1, notes: 'partial exit already occurred',
      },
    ]);
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderTradeDetailView(container);

    await waitFor(() => container.querySelector('#td-body')!.textContent !== 'Loading…');
    const body = container.querySelector('#td-body')!;
    expect(container.querySelector('#td-title')!.textContent).toContain('XBT');
    expect(body.textContent).toContain('Fees (estimated)');
    expect(body.textContent).toContain('Slippage (measured)');
    expect(body.textContent).toContain('partial exit already occurred');
    // No decision-context or audit-timeline sections — not persisted per trade.
    expect(body.textContent).not.toContain('Confidence');
    expect(body.textContent).not.toContain('Signal generated');
  });
});
