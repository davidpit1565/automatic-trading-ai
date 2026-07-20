// @vitest-environment happy-dom
/**
 * Every primary view (Home, Value, Markets, History) polls the cloud state
 * and/or live prices on an interval. Before the ViewHandle pattern, `main.ts`
 * mounted each view once and never stopped that polling when the user
 * navigated away — intervals accumulated forever in the background,
 * competing for the shared Kraken request queue even while off-screen. These
 * tests assert each view's pause() actually clears its interval(s) and
 * resume() restarts them, so navigating away truly stops the polling.
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
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});
afterEach(() => vi.unstubAllGlobals());

describe('View lifecycle (pause/resume)', () => {
  it('History view: pause() clears its poll and resume() restarts it', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const setSpy = vi.spyOn(window, 'setInterval');

    const handle = renderHistoryView(container, await makeData());
    const mountedSetCalls = setSpy.mock.calls.length;
    expect(mountedSetCalls).toBeGreaterThan(0);

    handle.pause();
    expect(clearSpy).toHaveBeenCalledTimes(1);

    handle.resume();
    expect(setSpy.mock.calls.length).toBeGreaterThan(mountedSetCalls);

    clearSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('Value view: pause() clears its poll and resume() restarts it', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const setSpy = vi.spyOn(window, 'setInterval');

    const handle = renderValueView(container, await makeData());
    const mountedSetCalls = setSpy.mock.calls.length;
    expect(mountedSetCalls).toBeGreaterThan(0);

    handle.pause();
    expect(clearSpy).toHaveBeenCalledTimes(1);

    handle.resume();
    expect(setSpy.mock.calls.length).toBeGreaterThan(mountedSetCalls);

    clearSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('Home view: pause() clears all three polls and resume() restarts them', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const setSpy = vi.spyOn(window, 'setInterval');

    const handle = renderHomeView(container, await makeData());
    const mountedSetCalls = setSpy.mock.calls.length;
    expect(mountedSetCalls).toBe(3);

    handle.pause();
    expect(clearSpy).toHaveBeenCalledTimes(3);

    handle.resume();
    expect(setSpy.mock.calls.length).toBe(mountedSetCalls * 2);

    clearSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('Markets view (list mode): pause() clears the list poll and resume() restarts it', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const setSpy = vi.spyOn(window, 'setInterval');

    const handle = renderMarketsView(container, await makeData());
    const mountedSetCalls = setSpy.mock.calls.length;
    expect(mountedSetCalls).toBeGreaterThan(0);

    handle.pause();
    expect(clearSpy).toHaveBeenCalled();

    handle.resume();
    expect(setSpy.mock.calls.length).toBeGreaterThan(mountedSetCalls);

    clearSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('Markets view: resume() while a coin detail is open reopens that detail, not the list', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = renderMarketsView(container, await makeData());
    await waitFor(() => container.querySelector('.market-row') !== null);
    (container.querySelector('.market-row') as HTMLButtonElement).click();
    await waitFor(() => container.querySelector('.detail-nav') !== null);

    handle.pause();
    handle.resume();

    // Resume should keep the detail view showing (not fall back to the list).
    await waitFor(() => container.querySelector('.detail-nav') !== null);
    expect(container.querySelector('#mk-detail-view')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('#mk-list-view')?.hasAttribute('hidden')).toBe(true);
  });
});
