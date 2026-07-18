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

  it('renders the real-money readiness card from cloud state', async () => {
    const raw = {
      'portfolio-engine': { cash: 5954, initialCash: 10000, baseCurrency: 'EUR' },
      'open-positions': [],
      'audit-log': [],
      'equity-history': [],
      'real-money-readiness': {
        ready: false,
        summary: 'NOT READY — 1 / 20 closed trades; after-fee return -0.46%.',
        criteria: [
          { key: 'trades', ok: false, detail: '1 / 20 closed trades' },
          { key: 'profitable', ok: false, detail: 'after-fee return -0.46%' },
          { key: 'drawdown', ok: true, detail: 'max drawdown 2.0% (limit 10%)' },
        ],
      },
    };
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));

    const container = document.createElement('section');
    document.body.appendChild(container);
    renderHomeView(container, await makeData());

    await waitFor(() => container.querySelector('#home-readiness .readiness-list') !== null);
    const card = container.querySelector('#home-readiness')!;
    expect(card.textContent).toContain('Real-money readiness');
    expect(card.querySelector('.ready-badge.no')).not.toBeNull();
    expect(card.querySelectorAll('.readiness-list li').length).toBe(3);
    expect(card.querySelector('.readiness-list li.ok')).not.toBeNull();
    expect(card.querySelector('.readiness-list li.no')).not.toBeNull();
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

  it('renders the live marker and a working crosshair tooltip on the detail chart', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderMarketsView(container, await makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLButtonElement).click();
    await waitFor(() => container.querySelector('svg.pchart') !== null);

    // Current-price marker and crosshair scaffold exist.
    expect(container.querySelector('.pchart-now')).not.toBeNull();
    expect(container.querySelector('.pchart-cross')).not.toBeNull();
    const tip = container.querySelector<HTMLElement>('.pchart-tip')!;
    expect(tip.hidden).toBe(true);

    // A pointer move over the chart reveals the tooltip with a price + time.
    const svg = container.querySelector<SVGSVGElement>('svg.pchart')!;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 380, bottom: 240, width: 380, height: 240, x: 0, y: 0, toJSON() {} }) as DOMRect;
    svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 190, bubbles: true }));

    expect(tip.hidden).toBe(false);
    expect(tip.querySelector('.pchart-tip-price')!.textContent).toContain('€');
    expect(tip.querySelector('.pchart-tip-time')!.textContent!.length).toBeGreaterThan(0);
    expect(container.querySelector('.pchart-cross')!.classList.contains('show')).toBe(true);

    // Pointer leaving hides it again (crosshair is not left dangling).
    svg.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    expect(tip.hidden).toBe(true);
  });

  it('defaults to candlesticks and toggles to a line chart, keeping the crosshair', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderMarketsView(container, await makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLButtonElement).click();
    await waitFor(() => container.querySelector('svg.pchart') !== null);

    // Candles are the default: candle elements + the live/crosshair scaffold.
    await waitFor(() => container.querySelector('.pcandle') !== null);
    expect(container.querySelector('.pcandle')).not.toBeNull();
    expect(container.querySelector('.pchart-now')).not.toBeNull();
    expect(container.querySelector('.pchart-cross')).not.toBeNull();
    // The Line / Candles toggle exists.
    expect(container.querySelectorAll('.ctoggle-btn').length).toBe(2);

    // Crosshair tooltip (with OHLC) still updates on pointermove in candle mode.
    const candleSvg = container.querySelector<SVGSVGElement>('svg.pchart')!;
    candleSvg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 380, bottom: 240, width: 380, height: 240, x: 0, y: 0, toJSON() {} }) as DOMRect;
    candleSvg.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, bubbles: true }));
    const candleTip = container.querySelector<HTMLElement>('.pchart-tip')!;
    expect(candleTip.hidden).toBe(false);
    expect(candleTip.querySelector('.pchart-tip-price')!.textContent).toContain('€');
    expect(candleTip.querySelector('.pchart-tip-ohlc')!.textContent).toContain('O ');

    // Switching to Line re-renders a polyline line chart (no candles).
    const lineBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.ctoggle-btn')).find(
      (b) => b.dataset['mode'] === 'line',
    )!;
    lineBtn.click();
    await waitFor(() => container.querySelector('svg.pchart polyline') !== null);
    expect(container.querySelector('svg.pchart polyline')).not.toBeNull();
    expect(container.querySelector('.pcandle')).toBeNull();
    expect(container.querySelector('.pchart-now')).not.toBeNull();
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

  it('renders an interactive chart with a range selector from equity history', async () => {
    const at0 = ANCHOR;
    const equityHistory = Array.from({ length: 30 }, (_, i) => ({
      at: at0 + i * 3_600_000,
      equity: 10_000 + i * 12 - (i % 5) * 8,
    }));
    const raw = {
      'portfolio-engine': { cash: 6000, initialCash: 10000, baseCurrency: 'EUR' },
      'open-positions': [],
      'audit-log': [],
      'equity-history': equityHistory,
    };
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));

    const container = document.createElement('section');
    document.body.appendChild(container);
    renderValueView(container, await makeData());

    await waitFor(() => container.querySelector('.range-bar') !== null);
    expect(container.querySelectorAll('.range-btn').length).toBe(5);
    await waitFor(() => container.querySelector('svg.pchart') !== null);

    // Crosshair tooltip updates on a pointer move.
    const svg = container.querySelector<SVGSVGElement>('svg.pchart')!;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 380, bottom: 240, width: 380, height: 240, x: 0, y: 0, toJSON() {} }) as DOMRect;
    svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, bubbles: true }));
    const tip = container.querySelector<HTMLElement>('.pchart-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('€');
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
