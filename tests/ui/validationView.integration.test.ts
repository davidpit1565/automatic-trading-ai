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
    expect(container.querySelectorAll('.stat-card').length).toBeGreaterThanOrEqual(6);

    const foldRows = container.querySelectorAll('tbody tr');
    expect(foldRows.length).toBeGreaterThanOrEqual(3);
    // Each fold row shows chosen parameters and both return columns.
    expect(foldRows[0]!.textContent).toContain('SMA');
    // Cost settings surfaced in the status line — costs are never hidden.
    expect(container.querySelector('#val-status')!.textContent).toContain('spread');
  });
});
