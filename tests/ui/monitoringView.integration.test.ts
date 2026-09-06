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

  it('Start/Stop buttons reflect the engine state instead of both always being clickable', async () => {
    const container = await renderView();
    const start = container.querySelector<HTMLButtonElement>('#mon-start')!;
    const stop = container.querySelector<HTMLButtonElement>('#mon-stop')!;
    // Stopped initially: Start is the valid action, Stop is not.
    expect(start.disabled).toBe(false);
    expect(stop.disabled).toBe(true);

    start.click();
    expect(start.disabled).toBe(true);
    expect(stop.disabled).toBe(false);

    stop.click();
    expect(start.disabled).toBe(false);
    expect(stop.disabled).toBe(true);
  });

  it('renders status as separate stat tiles, not one run-on sentence', async () => {
    const container = await renderView();
    // Stopped, no scan yet: just the two tiles that always apply.
    expect(container.querySelectorAll('#mon-status .stat-tile').length).toBe(2);

    container.querySelector<HTMLButtonElement>('#mon-start')!.click();
    const labels = [...container.querySelectorAll('#mon-status .stat-tile-label')].map((el) => el.textContent);
    // "Next scan" only joins once the engine has actually computed a fire
    // time (not yet, right after start()) — always Status + Last scan.
    expect(labels.slice(0, 2)).toEqual(['Status', 'Last scan']);
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

      // Confidence and Validation columns carry the app's own colour
      // language (signClass / verdict-text-*) instead of flat, uncoloured
      // text — every qualified opportunity's confidence is > 0, so it must
      // be coloured "positive", and every verdict gets a matching class.
      const oppConfidenceCells = container.querySelectorAll('#mon-opportunities tbody tr td:nth-child(3)');
      expect(oppConfidenceCells.length).toBeGreaterThan(0);
      oppConfidenceCells.forEach((cell) => expect(cell.className).toContain('positive'));

      const historyVerdictCells = container.querySelectorAll('#mon-history tbody tr td:nth-child(7)');
      historyVerdictCells.forEach((cell) => expect(cell.className).toMatch(/verdict-text-/));
    }
  });

  // Round-2 cross-screen consistency: Backtest/Validation's own wide tables
  // already hint an off-screen right edge via `.table-scroll-fade`; all four
  // of this screen's tables (up to 9 columns) lacked the identical
  // affordance despite being at least as wide.
  it('wraps every wide table (opportunities, watchlist, history, alerts) in the shared scroll-fade affordance', async () => {
    const container = await renderView();
    container.querySelector<HTMLButtonElement>('#mon-scan-now')!.click();
    for (
      let i = 0;
      i < 600 && !container.querySelector('#mon-status')!.textContent!.includes('Last scan');
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const select = container.querySelector<HTMLSelectElement>('#mon-watch-symbol')!;
    select.value = select.options[0]!.value;
    container.querySelector<HTMLButtonElement>('#mon-watch-add')!.click();

    for (const hostId of ['#mon-watchlist', '#mon-history', '#mon-alerts']) {
      const host = container.querySelector(hostId)!;
      const table = host.querySelector('table.data-table');
      if (!table) continue; // that table's own empty state — nothing to wrap
      expect(host.querySelector('.table-scroll-fade table.data-table'), `${hostId} missing scroll-fade`).not.toBeNull();
    }
    // Opportunities: only assert the wrapper when a table actually rendered
    // (the demo scan may or may not qualify a setup this run).
    const opportunitiesTable = container.querySelector('#mon-opportunities table.data-table');
    if (opportunitiesTable) {
      expect(container.querySelector('#mon-opportunities .table-scroll-fade table.data-table')).not.toBeNull();
    }
  });

  it('shows an honest error, not "protecting capital", when every monitored market fails to fetch', async () => {
    const data = await makeData();
    // A genuine network outage: every candle fetch fails, so the scan
    // returns zero outcomes and only failures — same Result-shaped failure
    // the sibling Market Scan view already handles distinctly.
    const failingSource = {
      ...data.source,
      getCandles: async () => ({ ok: false as const, error: 'network unreachable' }),
    };
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderMonitoringView(container, { ...data, source: failingSource });

    container.querySelector<HTMLButtonElement>('#mon-scan-now')!.click();
    await new Promise((resolve) => {
      const check = (): void => {
        const t = container.querySelector('#mon-opportunities')!.textContent!;
        if (!t.includes('No scan has run yet') && !t.includes('Scanning…')) resolve(undefined);
        else setTimeout(check, 10);
      };
      check();
    });

    const text = container.querySelector('#mon-opportunities')!.textContent!;
    expect(text).toContain('Scan failed for all');
    expect(text).not.toContain('protecting capital');
  });

  it('clears the previous scan\'s stale results instead of leaving them on screen while a new scan is in flight', async () => {
    const data = await makeData();
    const container = document.createElement('section');
    document.body.appendChild(container);

    // First scan populates #mon-opportunities with real (demo) content —
    // must wait for it to fully settle (not just start, i.e. past the
    // in-flight "Scanning…" placeholder itself) before moving on.
    renderMonitoringView(container, data);
    container.querySelector<HTMLButtonElement>('#mon-scan-now')!.click();
    for (
      let i = 0;
      i < 600 &&
      (container.querySelector('#mon-opportunities')!.textContent!.includes('No scan has run yet') ||
        container.querySelector('#mon-opportunities')!.textContent!.includes('Scanning…'));
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const firstResultText = container.querySelector('#mon-opportunities')!.textContent!;
    expect(firstResultText).not.toContain('No scan has run yet');
    expect(firstResultText).not.toContain('Scanning…');

    // Second scan: hold getCandles open so we can observe the mid-flight DOM
    // before it resolves — the exact window the old code left untouched.
    let releaseSecondScan: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseSecondScan = resolve;
    });
    const stallingSource = {
      ...data.source,
      getCandles: async (...args: Parameters<typeof data.source.getCandles>) => {
        await held;
        return data.source.getCandles(...args);
      },
    };
    // Re-render against the stalling source, reusing the same container.
    renderMonitoringView(container, { ...data, source: stallingSource });
    container.querySelector<HTMLButtonElement>('#mon-scan-now')!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(container.querySelector('#mon-opportunities')!.textContent).toContain('Scanning…');
    expect(container.querySelector('#mon-opportunities')!.textContent).not.toBe(firstResultText);

    // Let the held scan actually finish before the test ends — an
    // unresolved background write would otherwise leak into localStorage
    // (shared across this file's tests) after this test returns.
    releaseSecondScan();
    for (let i = 0; i < 600 && container.querySelector('#mon-opportunities')!.textContent!.includes('Scanning…'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });

  it('disables Scan now while a manual scan is in flight, and re-enables after', async () => {
    const source = new SyntheticDataSource(ANCHOR);
    const instrumentsResult = await source.getInstruments();
    if (!instrumentsResult.ok) throw new Error('demo instruments unavailable');
    let releaseGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => (releaseGate = resolve));
    const slow: ActiveDataSource = {
      source: {
        name: 'slow',
        getInstruments: () => source.getInstruments(),
        getCandles: async (symbol, timeframe, limit) => {
          await gate; // stays pending until the test releases it
          return source.getCandles(symbol, timeframe, limit);
        },
      },
      instruments: instrumentsResult.value,
      isLive: false,
      kind: 'demo',
      diagnostics: [],
    };
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderMonitoringView(container, slow);

    const scanNow = container.querySelector<HTMLButtonElement>('#mon-scan-now')!;
    expect(scanNow.disabled).toBe(false);
    scanNow.click();
    expect(scanNow.disabled).toBe(true);

    releaseGate!();
    for (let i = 0; i < 600 && scanNow.disabled; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(scanNow.disabled).toBe(false);
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
    // The favourite marker is the app's own star icon (matching Markets'
    // .star-btn), not a bare "★" glyph.
    expect(rows[0]!.querySelector('.watch-fav-icon')).not.toBeNull();

    container.querySelector<HTMLButtonElement>('#mon-watchlist [data-del]')!.click();
    expect(container.querySelector('#mon-watchlist')!.textContent).toContain('empty');
  });
});
