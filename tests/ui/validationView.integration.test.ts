// @vitest-environment happy-dom
/**
 * Validation view integration test (real DOM via happy-dom): hooks wired,
 * walk-forward runs against deterministic demo data, and the rendered
 * verdict/metrics come from the verified validation engine.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { SyntheticDataSource } from '../../src/core/data/synthetic';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import { renderValidationView } from '../../src/ui/views/validationView';

const ANCHOR = 1_700_000_000_000;

async function makeData(): Promise<ActiveDataSource> {
  const source = new SyntheticDataSource(ANCHOR);
  const instruments = await source.getInstruments();
  if (!instruments.ok) throw new Error('demo instruments unavailable');
  return { source, instruments: instruments.value, isLive: false, kind: 'demo' as const, diagnostics: [] };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Validation view (DOM integration)', () => {
  it('exposes the required data hooks', async () => {
    const container = document.createElement('section');
    renderValidationView(container, await makeData());
    for (const hook of [
      '#val-run',
      '#val-symbol',
      '#val-timeframe',
      '#val-fee',
      '#val-spread',
      '#val-slippage',
      '#val-status',
      '#val-results',
    ]) {
      expect(container.querySelector(hook), `missing hook ${hook}`).not.toBeNull();
    }
  });

  it('runs a walk-forward and renders verdict, equity curve, metrics, and folds', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderValidationView(container, await makeData());

    container.querySelector<HTMLButtonElement>('#val-run')!.click();
    for (let i = 0; i < 400 && !container.querySelector('.verdict-panel'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const verdict = container.querySelector('.verdict-panel');
    expect(verdict).not.toBeNull();
    expect(verdict!.className).toMatch(/verdict-(robust|caution|overfitted|insufficient-data)/);
    expect(verdict!.textContent).toContain('Verdict:');
    // Honest language, never certainty.
    expect(verdict!.textContent).not.toMatch(/guaranteed/i);

    expect(container.querySelector('svg.equity-curve')).not.toBeNull();
    expect(container.querySelectorAll('.stat-tile').length).toBeGreaterThanOrEqual(6);

    const foldRows = container.querySelectorAll('tbody tr');
    expect(foldRows.length).toBeGreaterThanOrEqual(3);
    // Each fold row shows chosen parameters and both return columns.
    expect(foldRows[0]!.textContent).toContain('SMA');
    // Cost settings surfaced in the status line — costs are never hidden.
    expect(container.querySelector('#val-status')!.textContent).toContain('spread');
  });

  it('splits the post-run status into two lines instead of one run-on sentence', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderValidationView(container, await makeData());

    container.querySelector<HTMLButtonElement>('#val-run')!.click();
    for (let i = 0; i < 400 && !container.querySelector('.verdict-panel'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const status = container.querySelector('#val-status')!;
    expect(status.children.length).toBeGreaterThanOrEqual(2);
    expect(status.children[0]!.textContent).toContain('folds');
    expect(status.children[1]!.textContent).toContain('costs:');
  });

  it('colors Sharpe (unseen) and Degradation by their actual sign — Degradation inverted, since a bigger positive number means worse (not better) out-of-sample decay', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderValidationView(container, await makeData());

    container.querySelector<HTMLButtonElement>('#val-run')!.click();
    for (let i = 0; i < 400 && !container.querySelector('.verdict-panel'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const labels = [...container.querySelectorAll('.stat-tile-label')].map((l) => l.textContent);
    const degradationTile = container.querySelectorAll('.stat-tile-value')[labels.indexOf('Degradation')]!;
    const sharpeTile = container.querySelectorAll('.stat-tile-value')[labels.indexOf('Sharpe (unseen)')]!;

    const degradationValue = parseFloat(degradationTile.textContent!.replace('%', ''));
    if (!Number.isNaN(degradationValue) && degradationValue !== 0) {
      expect(degradationTile.className).toContain(degradationValue > 0 ? 'negative' : 'positive');
    }
    const sharpeValue = parseFloat(sharpeTile.textContent!);
    if (!Number.isNaN(sharpeValue) && sharpeValue !== 0) {
      expect(sharpeTile.className).toContain(sharpeValue > 0 ? 'positive' : 'negative');
    }
  });

  it('colors per-fold Profit factor (>=1 good) and Expectancy (sign) cells, and tiers Expectancy as money', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderValidationView(container, await makeData());

    container.querySelector<HTMLButtonElement>('#val-run')!.click();
    for (let i = 0; i < 400 && !container.querySelector('.verdict-panel'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      const profitFactorCell = cells[6]!;
      const expectancyCell = cells[7]!;
      if (profitFactorCell.textContent !== '—') {
        const pf = parseFloat(profitFactorCell.textContent!);
        expect(profitFactorCell.className).toBe(pf >= 1 ? 'positive' : 'negative');
      }
      if (expectancyCell.textContent !== '—') {
        expect(expectancyCell.querySelector('.tiered-price')).not.toBeNull();
        const value = parseFloat(expectancyCell.textContent!.replace(/,/g, ''));
        if (value !== 0) expect(expectancyCell.className).toBe(value > 0 ? 'positive' : 'negative');
      }
    }
  });

  it('flags the per-fold table wrapper as scrollable, mirroring Backtest\'s own affordance', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderValidationView(container, await makeData());

    container.querySelector<HTMLButtonElement>('#val-run')!.click();
    for (let i = 0; i < 400 && !container.querySelector('.verdict-panel'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const fadeWrap = container.querySelector<HTMLElement>('.table-scroll-fade')!;
    const scroller = fadeWrap.querySelector<HTMLElement>('.table-scroll')!;
    expect(fadeWrap).not.toBeNull();
    Object.defineProperty(scroller, 'scrollWidth', { value: 900, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 320, configurable: true });
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, configurable: true, writable: true });
    scroller.dispatchEvent(new Event('scroll'));
    expect(fadeWrap.classList.contains('is-scrollable')).toBe(true);
  });
});

describe('Validation view — Configure section and empty state', () => {
  it('groups the form under a Configure heading and shows an empty state before the first run', async () => {
    const container = document.createElement('section');
    renderValidationView(container, await makeData());

    expect(container.querySelector('.block-head h2')?.textContent).toBe('Configure');
    expect(container.querySelector('#val-results .empty')?.textContent).toMatch(/press Run/i);
  });
});

describe('Validation view — loading state', () => {
  it('shows the shared spinner while candle history loads', async () => {
    let resolveCandles!: (v: unknown) => void;
    const pending = new Promise((resolve) => { resolveCandles = resolve; });
    const data = await makeData();
    const stallingData: ActiveDataSource = {
      ...data,
      source: {
        name: data.source.name,
        getInstruments: data.source.getInstruments.bind(data.source),
        getCandles: (() => pending) as typeof data.source.getCandles,
      },
    };
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderValidationView(container, stallingData);

    container.querySelector<HTMLButtonElement>('#val-run')!.click();
    const status = container.querySelector('#val-status')!;
    expect(status.querySelector('.spinner')).not.toBeNull();
    expect(status.textContent).toContain('Loading');
    resolveCandles({ ok: true, value: [] });
  });
});
