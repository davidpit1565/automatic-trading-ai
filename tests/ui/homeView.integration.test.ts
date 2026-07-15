// @vitest-environment happy-dom
/**
 * Integration tests (real DOM via happy-dom) for the new primary views:
 * Home, Markets, History. They must mount without throwing and render their
 * key structure against deterministic demo data, with the cloud-state fetch
 * stubbed offline (so they exercise the fail-soft path too).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyntheticDataSource } from '../../src/core/data/synthetic';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import { renderHomeView } from '../../src/ui/views/homeView';
import { renderMarketsView } from '../../src/ui/views/marketsView';
import { renderHistoryView } from '../../src/ui/views/historyView';
import { renderValueView } from '../../src/ui/views/valueView';

const ANCHOR = 1_700_000_000_000;

async function makeData(): Promise<ActiveDataSource> {
  const source = new SyntheticDataSource(ANCHOR);
  const instruments = await source.getInstruments();
  if (!instruments.ok) throw new Error('demo instruments unavailable');
  return { source, instruments: instruments.value, isLive: false, kind: 'demo' as const, diagnostics: [] };
}

async function waitFor(condition: () => boolean, tries = 400): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
  // Cloud state fetch is offline in tests → views take the fail-soft path.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});
afterEach(() => vi.unstubAllGlobals());

describe('Home view (DOM integration)', () => {
  it('mounts and renders the hero, markets strip, positions and activity', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderHomeView(container, await makeData());

    expect(container.querySelector('#hv-equity')).not.toBeNull();
    expect(container.querySelector('#home-markets')).not.toBeNull();
    expect(container.querySelector('#home-positions')).not.toBeNull();
    expect(container.querySelector('#home-activity')).not.toBeNull();

    // Markets strip fills from the demo source (does not depend on cloud state).
    await waitFor(() => container.querySelector('.market-card, #home-markets .empty') !== null);
    expect(container.querySelector('#home-markets')!.children.length).toBeGreaterThan(0);
  });
});

describe('Markets view (DOM integration)', () => {
  it('mounts and lists markets with a price and change', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderMarketsView(container, await makeData());

    expect(container.querySelector('#mk-list')).not.toBeNull();
    await waitFor(() => container.querySelector('.market-row, #mk-list .empty') !== null);
    expect(container.querySelector('#mk-list')!.children.length).toBeGreaterThan(0);
  });

  it('opens a coin detail with a timeframe selector and a chart', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderMarketsView(container, await makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLButtonElement).click();
    await waitFor(() => container.querySelector('.range-bar') !== null);
    expect(container.querySelectorAll('.range-btn').length).toBe(7);
    await waitFor(() => container.querySelector('.pchart, .detail-chart .empty') !== null);
    expect(container.querySelector('.detail-chart')).not.toBeNull();
  });
});

describe('Value view (DOM integration)', () => {
  it('mounts and shows a message while offline', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderValueView(container, await makeData());
    expect(container.querySelector('#pv-body')).not.toBeNull();
    await waitFor(() => (container.querySelector('#pv-body')!.textContent ?? '').length > 0);
    expect(container.querySelector('#pv-body')!.textContent!.length).toBeGreaterThan(0);
  });
});

describe('History view (DOM integration)', () => {
  it('mounts and shows the fail-soft message when the cloud is unreachable', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderHistoryView(container, await makeData());

    expect(container.querySelector('#history-list')).not.toBeNull();
    await waitFor(() => (container.querySelector('#history-list')!.textContent ?? '').length > 0);
    expect(container.querySelector('#history-list')!.textContent!.length).toBeGreaterThan(0);
  });
});
