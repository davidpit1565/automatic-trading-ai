// @vitest-environment happy-dom
/**
 * Portfolio view integration test (real DOM via happy-dom): the full loop —
 * open through the verified pipeline, monitor, close, journal, analytics —
 * driven through the actual view against deterministic demo data.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { SyntheticDataSource } from '../../src/core/data/synthetic';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import { renderPositionsView } from '../../src/ui/views/positionsView';

const ANCHOR = 1_700_000_000_000;

async function makeData(): Promise<ActiveDataSource> {
  const source = new SyntheticDataSource(ANCHOR);
  const instruments = await source.getInstruments();
  if (!instruments.ok) throw new Error('demo instruments unavailable');
  return { source, instruments: instruments.value, isLive: false, kind: 'demo' as const, diagnostics: [] };
}

async function renderView(): Promise<HTMLElement> {
  const container = document.createElement('section');
  document.body.appendChild(container);
  renderPositionsView(container, await makeData());
  await waitFor(() => container.querySelector('.stat-card') !== null);
  return container;
}

async function waitFor(condition: () => boolean, tries = 600): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('Portfolio view (DOM integration)', () => {
  it('exposes hooks and renders the overview from the Portfolio Engine', async () => {
    const container = await renderView();
    for (const hook of [
      '#pf-symbol', '#pf-open', '#pf-refresh', '#pf-status', '#pf-positions', '#pf-journal', '#pf-analytics',
      '#ap-interval', '#ap-start', '#ap-stop', '#ap-cycle', '#ap-kill', '#ap-status', '#ap-audit',
    ]) {
      expect(container.querySelector(hook), `missing hook ${hook}`).not.toBeNull();
    }
    const overview = container.querySelector('#pf-overview')!.textContent!;
    expect(overview).toContain('Equity');
    expect(overview).toContain('Cash available');
    expect(overview).toContain("Today's P&L");
    expect(overview).toContain('Total return');
  });

  it('runs the full lifecycle: pipeline open, position row, close, journal, analytics', async () => {
    const container = await renderView();

    // BTC/USD in the demo universe has bullish drift — but whichever result,
    // the status must explain the pipeline decision. Find a symbol that opens.
    const select = container.querySelector<HTMLSelectElement>('#pf-symbol')!;
    const symbols = [...select.options].map((o) => o.value);
    let openedSymbol: string | null = null;
    for (const symbol of symbols) {
      select.value = symbol;
      container.querySelector<HTMLButtonElement>('#pf-open')!.click();
      await waitFor(() => {
        const text = container.querySelector('#pf-status')!.textContent!;
        return text.includes('Opened') || text.includes('refused') || text.includes('no qualifying');
      });
      if (container.querySelector('#pf-status')!.textContent!.includes('Opened')) {
        openedSymbol = symbol;
        break;
      }
    }
    expect(openedSymbol, 'at least one demo market should qualify end-to-end').not.toBeNull();

    // Open position row rendered with stop/target and a close control.
    await waitFor(() => container.querySelectorAll('#pf-positions tbody tr').length > 0);
    const row = container.querySelector('#pf-positions tbody tr')!;
    expect(row.textContent).toContain(openedSymbol!);
    expect(container.querySelector('[data-close-all]')).not.toBeNull();

    // Close it: journal entry + analytics appear.
    container.querySelector<HTMLButtonElement>('[data-close-all]')!.click();
    await waitFor(() => container.querySelectorAll('#pf-journal tbody tr').length > 0);
    const journalRow = container.querySelector('#pf-journal tbody tr')!;
    expect(journalRow.textContent).toContain(openedSymbol!);
    expect(journalRow.textContent).toContain('manual');

    await waitFor(() => container.querySelector('#pf-analytics .stat-card') !== null);
    const analytics = container.querySelector('#pf-analytics')!.textContent!;
    expect(analytics).toContain('Win rate');
    expect(analytics).toContain('Profit factor');
    expect(analytics).toContain('Max drawdown');
    expect(container.querySelectorAll('#pf-analytics svg').length).toBe(2); // equity + drawdown
    expect(analytics).toContain('Monthly performance');

    // Performance feedback renders from the same journal.
    await waitFor(() => container.querySelectorAll('#pf-feedback table').length >= 3);
    const feedback = container.querySelector('#pf-feedback')!.textContent!;
    expect(feedback).toContain('Confidence calibration');
    expect(feedback).toContain('Exit quality');
    expect(feedback).toContain('By strategy');
    expect(feedback).toContain('pipeline-v1');
    expect(feedback).toContain('Buy & hold same markets');
  });

  it('autopilot cycle acts autonomously on paper and audits everything', async () => {
    const container = await renderView();
    expect(container.querySelector('#ap-status')!.textContent).toContain('stopped');

    container.querySelector<HTMLButtonElement>('#ap-cycle')!.click();
    await waitFor(() =>
      (container.querySelector('#ap-status')!.textContent ?? '').includes('Last cycle'),
    );
    const status = container.querySelector('#ap-status')!.textContent!;
    expect(status).toMatch(/opened \d+ \/ closed \d+ \/ skipped \d+/);
    // The demo universe has bullish markets: the audit shows fills or refusals.
    await waitFor(() => container.querySelectorAll('#ap-audit tbody tr').length > 0);
    expect(container.querySelectorAll('#ap-audit tbody tr').length).toBeGreaterThan(0);
  });

  it('a running autopilot resumes after re-render and runs a catch-up cycle', async () => {
    const first = await renderView();
    first.querySelector<HTMLSelectElement>('#ap-interval')!.value = '1h';
    first.querySelector<HTMLButtonElement>('#ap-start')!.click();
    expect(first.querySelector('#ap-status')!.textContent).toContain('RUNNING');

    // "Reload": fresh DOM, same localStorage.
    document.body.innerHTML = '';
    const second = await renderView();
    await waitFor(() =>
      (second.querySelector('#ap-status')!.textContent ?? '').includes('Last cycle'),
    );
    const status = second.querySelector('#ap-status')!.textContent!;
    expect(status).toContain('RUNNING'); // schedule restored
    expect(status).toContain('Last cycle'); // catch-up cycle ran on load
  });

  it('the kill switch halts automation and is reflected in the status', async () => {
    const container = await renderView();
    container.querySelector<HTMLButtonElement>('#ap-kill')!.click();
    expect(container.querySelector('#ap-status')!.textContent).toContain('KILL SWITCH ENGAGED');

    container.querySelector<HTMLButtonElement>('#ap-cycle')!.click();
    await waitFor(() =>
      (container.querySelector('#ap-status')!.textContent ?? '').includes('Last cycle'),
    );
    // Halted cycle: no opens/closes happened.
    await waitFor(() => container.querySelectorAll('#ap-audit tbody tr').length > 0);
    const audit = container.querySelector('#ap-audit')!.textContent!;
    expect(audit).toContain('kill switch');
    expect(container.querySelectorAll('#pf-positions tbody tr').length).toBe(0);

    // Disengage restores automation.
    container.querySelector<HTMLButtonElement>('#ap-kill')!.click();
    expect(container.querySelector('#ap-status')!.textContent).not.toContain('KILL SWITCH ENGAGED');
  });
});
