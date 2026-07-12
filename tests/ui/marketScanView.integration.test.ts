// @vitest-environment happy-dom
/**
 * Market Scan view integration test (real DOM via happy-dom).
 *
 * Renders the actual view against a deterministic data source and verifies
 * the full loop: data hooks are wired, rows render sorted with temperature
 * badges, clicking expands/collapses the detail row, and the expanded
 * content is exactly what the verified Market Scanner produced — the UI adds
 * presentation only, never analysis.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { SyntheticDataSource } from '../../src/core/data/synthetic';
import { scanMarket } from '../../src/core/scan/marketScanner';
import { evaluateScan } from '../../src/core/signal/signalEngine';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import { renderMarketScanView } from '../../src/ui/views/marketScanView';

const ANCHOR = 1_700_000_000_000;

async function makeData(): Promise<ActiveDataSource> {
  const source = new SyntheticDataSource(ANCHOR);
  const instruments = await source.getInstruments();
  if (!instruments.ok) throw new Error('demo instruments unavailable');
  return { source, instruments: instruments.value, isLive: false, kind: 'demo' as const, diagnostics: [] };
}

async function renderAndScan(): Promise<{ container: HTMLElement; data: ActiveDataSource }> {
  const data = await makeData();
  const container = document.createElement('section');
  document.body.appendChild(container);
  renderMarketScanView(container, data);
  container.querySelector<HTMLButtonElement>('#scan-run')!.click();
  // The click handler is async: wait until rows exist (bounded).
  for (let i = 0; i < 200 && container.querySelectorAll('.scan-row').length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { container, data };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Market Scan view (DOM integration)', () => {
  it('exposes the required data hooks', async () => {
    const data = await makeData();
    const container = document.createElement('section');
    renderMarketScanView(container, data);
    for (const hook of ['#scan-run', '#scan-timeframe', '#scan-status', '#scan-results']) {
      expect(container.querySelector(hook), `missing hook ${hook}`).not.toBeNull();
    }
  });

  it('renders one clickable row per scanned market with a temperature badge', async () => {
    const { container, data } = await renderAndScan();
    const rows = [...container.querySelectorAll<HTMLTableRowElement>('.scan-row')];
    expect(rows.length).toBe(data.instruments.length);
    for (const row of rows) {
      const badge = row.querySelector('.badge');
      expect(badge).not.toBeNull();
      expect(badge!.className).toMatch(/badge-(hot|cold|neutral)/);
      expect(row.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('expands on click, collapses on second click', async () => {
    const { container } = await renderAndScan();
    const firstRow = container.querySelector<HTMLTableRowElement>('.scan-row')!;
    const detail = container.querySelector<HTMLTableRowElement>('.scan-detail')!;

    expect(detail.hidden).toBe(true);
    firstRow.click();
    expect(detail.hidden).toBe(false);
    expect(firstRow.classList.contains('expanded')).toBe(true);
    expect(firstRow.getAttribute('aria-expanded')).toBe('true');
    firstRow.click();
    expect(detail.hidden).toBe(true);
    expect(firstRow.classList.contains('expanded')).toBe(false);
  });

  it('expanded content is exactly the verified Market Scanner output', async () => {
    const { container, data } = await renderAndScan();

    // Recompute the scan through the core engine on the same deterministic data.
    const symbols = data.instruments.map((i) => i.symbol);
    const expected = await scanMarket(data.source, symbols, '1h', 150);

    const rows = [...container.querySelectorAll<HTMLTableRowElement>('.scan-row')];
    const details = [...container.querySelectorAll<HTMLTableRowElement>('.scan-detail')];
    expect(rows.length).toBe(expected.results.length);

    expected.results.forEach((scan, i) => {
      const rowText = rows[i]!.textContent!;
      expect(rowText).toContain(scan.symbol); // same order: sorted by score desc
      expect(rowText).toContain(scan.score.toFixed(0));

      const detailText = details[i]!.textContent!;
      for (const component of scan.components) {
        expect(detailText).toContain(component.label);
        expect(detailText).toContain(component.detail);
      }
      for (const warning of scan.warnings) {
        expect(detailText).toContain(warning);
      }
      const componentCards = details[i]!.querySelectorAll('.scan-component');
      expect(componentCards.length).toBe(scan.components.length);
    });
  });

  it('every detail row carries the Signal Engine decision for that scan', async () => {
    const { container, data } = await renderAndScan();
    const symbols = data.instruments.map((i) => i.symbol);
    const expected = await scanMarket(data.source, symbols, '1h', 150);
    const details = [...container.querySelectorAll<HTMLTableRowElement>('.scan-detail')];

    let opportunities = 0;
    let rejections = 0;
    expected.results.forEach((scan, i) => {
      const decision = evaluateScan(scan);
      const panel = details[i]!.querySelector('.signal-panel');
      expect(panel, `${scan.symbol} detail must include a signal panel`).not.toBeNull();
      const text = panel!.textContent!;
      if (decision.kind === 'opportunity') {
        opportunities++;
        expect(panel!.className).toContain('signal-opportunity');
        expect(text).toContain('LONG setup');
        expect(text).toContain(decision.opportunity.explanation);
        expect(text).toMatch(/not a guarantee/);
      } else {
        rejections++;
        expect(panel!.className).toContain('signal-rejected');
        expect(text).toContain('no qualifying setup');
        for (const reason of decision.reasons) {
          expect(text).toContain(reason);
        }
      }
    });
    // The demo universe is built to contain both outcomes.
    expect(opportunities).toBeGreaterThan(0);
    expect(rejections).toBeGreaterThan(0);
  });

  it('every qualifying opportunity carries a Risk Engine verdict panel', async () => {
    const { container, data } = await renderAndScan();
    const symbols = data.instruments.map((i) => i.symbol);
    const expected = await scanMarket(data.source, symbols, '1h', 150);
    const details = [...container.querySelectorAll<HTMLTableRowElement>('.scan-detail')];

    let riskPanels = 0;
    expected.results.forEach((scan, i) => {
      const decision = evaluateScan(scan);
      const panel = details[i]!.querySelector('.risk-panel');
      if (decision.kind === 'opportunity') {
        riskPanels++;
        expect(panel, `${scan.symbol} opportunity must include a risk panel`).not.toBeNull();
        const text = panel!.textContent!;
        // Approved or refused — either way the decision explains itself.
        if (panel!.className.includes('risk-approved')) {
          expect(text).toContain('approved');
          expect(text).toMatch(/Risk .*%/);
          expect(text).toContain('Portfolio exposure after');
        } else {
          expect(panel!.className).toContain('risk-refused');
          expect(text).toContain('refused to protect the portfolio');
          expect(panel!.querySelectorAll('li').length).toBeGreaterThan(0);
        }
      } else {
        // No risk assessment without a qualifying signal.
        expect(panel).toBeNull();
      }
    });
    expect(riskPanels).toBeGreaterThan(0);
  });

  it('reports symbols that could not be scanned instead of hiding them', async () => {
    const data = await makeData();
    const failingSource = {
      name: 'flaky',
      getInstruments: data.source.getInstruments.bind(data.source),
      getCandles: async (symbol: string, timeframe: '1h', limit: number) =>
        symbol === 'BTC/USD'
          ? { ok: false as const, error: 'HTTP 503' }
          : data.source.getCandles(symbol, timeframe, limit),
    };
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderMarketScanView(container, { ...data, source: failingSource });
    container.querySelector<HTMLButtonElement>('#scan-run')!.click();
    for (let i = 0; i < 200 && !container.querySelector('.scan-failures'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const failures = container.querySelector('.scan-failures');
    expect(failures).not.toBeNull();
    expect(failures!.textContent).toContain('BTC/USD');
    expect(failures!.textContent).toContain('HTTP 503');
  });
});
