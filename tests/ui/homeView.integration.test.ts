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
import { err } from '../../src/core/types';

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

  it('clears the "vs Bitcoin" banner if a later cycle cannot price BTC (no stale comparison shown as current)', async () => {
    const raw = {
      'portfolio-engine': { cash: 5000, initialCash: 10000, baseCurrency: 'EUR' },
      'open-positions': [],
      'audit-log': [],
      'benchmark-anchor': { btc: 50_000, equity: 10_000 },
    };
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));

    const base = await makeData();
    let btcCalls = 0;
    const gatedSource: typeof base.source = {
      name: base.source.name,
      getInstruments: () => base.source.getInstruments(),
      getCandles: (symbol, timeframe, limit, opts) => {
        // limit 2 singles out the hero's own price refresh (livePrices calls
        // getCandles(symbol, '1h', 2)); the markets-strip sweep also fetches
        // BTC (with a much larger limit) and must not be gated here.
        if (symbol === 'BTC/USD' && limit === 2) {
          btcCalls++;
          if (btcCalls >= 2) return Promise.resolve(err('offline'));
        }
        return base.source.getCandles(symbol, timeframe, limit, opts);
      },
    };
    const data = { ...base, source: gatedSource };

    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderHomeView(container, data);

    await waitFor(() => container.querySelector('#hv-bench')?.hasAttribute('hidden') === false);
    expect(container.querySelector('#hv-bench')!.textContent).toContain('vs Bitcoin');

    // A later cycle (e.g. after navigating away and back) where BTC's price
    // fetch fails must hide the banner, not keep showing the old comparison.
    handle.pause();
    handle.resume();
    await waitFor(() => container.querySelector('#hv-bench')?.hasAttribute('hidden') === true);
    expect(container.querySelector('#hv-bench')!.hasAttribute('hidden')).toBe(true);
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

  it('does not let a stale coin-detail fetch overwrite a different coin opened afterward', async () => {
    // Real bug: the staleness guard was scoped per-openDetail-call, so a slow
    // fetch for a coin the user has already left (backed out of, or switched
    // away from) could resolve later and silently overwrite whatever coin is
    // now on screen. Reproduce it: open BTC, switch its range to '1W' (a
    // fetch we can hold open), back out to the list and open ETH before that
    // fetch resolves, then release it — the screen must still show ETH.
    const container = document.createElement('section');
    document.body.appendChild(container);
    const base = await makeData();
    let releaseGate: (() => void) | null = null;
    const gatedSource: typeof base.source = {
      name: base.source.name,
      getInstruments: () => base.source.getInstruments(),
      getCandles: (symbol, timeframe, limit, opts) => {
        // limit 168 singles out the detail view's '1W' range request — the
        // list sweep's own snapshot fetch also uses '1h' but with limit 48,
        // and must not be gated or the list never renders at all.
        if (symbol === 'BTC/USD' && timeframe === '1h' && limit === 168 && !releaseGate) {
          return new Promise((resolve) => {
            releaseGate = () => resolve(base.source.getCandles(symbol, timeframe, limit, opts));
          });
        }
        return base.source.getCandles(symbol, timeframe, limit, opts);
      },
    };
    const data = { ...base, source: gatedSource };

    renderMarketsView(container, data);
    await waitFor(() => container.querySelectorAll('.market-row').length >= 2);
    (container.querySelectorAll('.market-row')[0] as HTMLButtonElement).click(); // BTC, default 1D
    await waitFor(() => container.querySelector('.detail-name') !== null);
    expect(container.querySelector('.detail-name')!.textContent).toBe('Bitcoin');

    // Switch to '1W' (tf '1h') — this fetch hangs on our gate.
    const rangeBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.range-btn')).find(
      (b) => b.dataset['range'] === '1W',
    )!;
    rangeBtn.click();
    await waitFor(() => releaseGate !== null);

    // Back out (the 1D render is still showing, so its back button works) and open ETH.
    (container.querySelector('#mk-back') as HTMLButtonElement).click();
    await waitFor(() => container.querySelectorAll('.market-row').length >= 2);
    (container.querySelectorAll('.market-row')[1] as HTMLButtonElement).click(); // ETH
    await waitFor(() => container.querySelector('.detail-name')?.textContent === 'Ethereum');

    // Now let BTC's stale '1W' fetch resolve.
    releaseGate!();
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Must still show ETH — not have snapped back to BTC's stale response.
    expect(container.querySelector('.detail-name')!.textContent).toBe('Ethereum');
  });

  it('resume() reopens the same coin on the same range/mode the user had, not the defaults', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, await makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLButtonElement).click(); // BTC, default 1D/Candle
    await waitFor(() => container.querySelector('.range-bar') !== null);

    // Switch to '1W' and Line.
    const rangeBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.range-btn')).find(
      (b) => b.dataset['range'] === '1W',
    )!;
    rangeBtn.click();
    await waitFor(() => container.querySelector('.range-btn.active')?.getAttribute('data-range') === '1W');
    const lineBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.ctoggle-btn')).find(
      (b) => b.dataset['mode'] === 'line',
    )!;
    lineBtn.click();
    await waitFor(() => container.querySelector('svg.pchart polyline') !== null);

    // Navigate away (pause) and back (resume) — mirrors switching tabs.
    // pause() doesn't clear the DOM, so the pre-pause range-bar is still
    // sitting there; wait for resume's own repaint to actually replace it
    // rather than a bare "a range-bar exists" check the stale one already
    // satisfies before resume's async paint has had a chance to run.
    const rangeBarBeforeResume = container.querySelector('.range-bar');
    handle.pause();
    handle.resume();
    await waitFor(() => container.querySelector('.range-bar') !== rangeBarBeforeResume);

    expect(container.querySelector('.detail-name')!.textContent).toBe('Bitcoin');
    expect(container.querySelector('.range-btn.active')!.getAttribute('data-range')).toBe('1W');
    expect(container.querySelector('.ctoggle-btn.active')!.getAttribute('data-mode')).toBe('line');
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

  it('shows real candle structure on the default All range with only a few days of history (real bug repro)', async () => {
    // Mirrors the live incident: equity tracking is only ~5 days old, but
    // the default range is 'All', whose "nice" bucket was a fixed 7 days —
    // that flattened the ENTIRE history into 1-2 candles. Real cadence is
    // roughly every 5-15 minutes; sample hourly here for a fast test.
    const at0 = ANCHOR;
    const equityHistory = Array.from({ length: 5 * 24 }, (_, i) => ({
      at: at0 + i * 3_600_000,
      equity: 10_000 + Math.sin(i / 3) * 50,
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

    await waitFor(() => container.querySelector('svg.pchart') !== null);
    // Stayed in candle mode (the default) — a real chart, not a 1-candle flat line.
    expect(container.querySelectorAll('.pcandle').length).toBeGreaterThan(15);
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
