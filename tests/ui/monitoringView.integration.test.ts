// @vitest-environment happy-dom
/**
 * Monitoring view integration test (real DOM via happy-dom): hooks wired,
 * a manual scan runs the full pipeline against deterministic demo data,
 * and status, opportunities, watchlist, history, and alerts all render
 * from the Monitoring Engine.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { SyntheticDataSource } from '../../src/core/data/synthetic';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import { renderMonitoringView } from '../../src/ui/views/monitoringView';

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
  renderMonitoringView(container, await makeData());
  return container;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('Monitoring view (DOM integration)', () => {
  it('exposes the required hooks and reports a stopped scheduler initially', async () => {
    const container = await renderView();
    for (const hook of [
      '#mon-interval',
      '#mon-start',
      '#mon-stop',
      '#mon-scan-now',
      '#mon-status',
      '#mon-opportunities',
      '#mon-watchlist',
      '#mon-history',
      '#mon-alerts',
    ]) {
      expect(container.querySelector(hook), `missing hook ${hook}`).not.toBeNull();
    }
    expect(container.querySelector('#mon-status')!.textContent).toContain('stopped');
  });

  it('start/stop toggle the scheduler status with the chosen interval', async () => {
    const container = await renderView();
    container.querySelector<HTMLSelectElement>('#mon-interval')!.value = '1h';
    container.querySelector<HTMLButtonElement>('#mon-start')!.click();
    expect(container.querySelector('#mon-status')!.textContent).toContain('RUNNING');
    expect(container.querySelector('#mon-status')!.textContent).toContain('1h');
    container.querySelector<HTMLButtonElement>('#mon-stop')!.click();
    expect(container.querySelector('#mon-status')!.textContent).toContain('stopped');
  });

  it('a manual scan populates status, watchlist, history, and alerts from the engine', async () => {
    const container = await renderView();
    container.querySelector<HTMLButtonElement>('#mon-scan-now')!.click();
    for (
      let i = 0;
      i < 600 && !container.querySelector('#mon-status')!.textContent!.includes('Last scan');
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const statusText = container.querySelector('#mon-status')!.textContent!;
    expect(statusText).toContain('Last scan');
    expect(statusText).toMatch(/qualified/);

    // The demo universe contains bullish markets: expect at least one
    // qualified or watch entry to reach the watchlist automatically.
    const watchRows = container.querySelectorAll('#mon-watchlist tbody tr');
    expect(watchRows.length).toBeGreaterThan(0);

    // Qualified opportunities (if any) appear in history and alerts too.
    const opportunityText = container.querySelector('#mon-opportunities')!.textContent!;
    if (opportunityText.includes('Validation') === false) {
      // No qualified setups this scan — the empty state must say so honestly.
      expect(opportunityText).toContain('No qualified opportunities');
    } else {
      expect(container.querySelectorAll('#mon-history tbody tr').length).toBeGreaterThan(0);
      expect(container.querySelectorAll('#mon-alerts tbody tr').length).toBeGreaterThan(0);
    }
  });

  it('manual watchlist add and favourite toggle work through the store', async () => {
    const container = await renderView();
    const select = container.querySelector<HTMLSelectElement>('#mon-watch-symbol')!;
    select.value = select.options[0]!.value;
    container.querySelector<HTMLButtonElement>('#mon-watch-add')!.click();
    let rows = container.querySelectorAll('#mon-watchlist tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain('manual');

    container.querySelector<HTMLButtonElement>('#mon-watchlist [data-fav]')!.click();
    rows = container.querySelectorAll('#mon-watchlist tbody tr');
    expect(rows[0]!.textContent).toContain('★');

    container.querySelector<HTMLButtonElement>('#mon-watchlist [data-del]')!.click();
    expect(container.querySelector('#mon-watchlist')!.textContent).toContain('empty');
  });
});
