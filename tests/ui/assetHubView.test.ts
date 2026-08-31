// @vitest-environment happy-dom
/**
 * The shared asset-hub shell (Crypto/Stocks) — specifically the optional
 * 5th "Long-Term" sub-tab (see `stocksLongTermPanel.ts`). Only Stocks passes
 * `renderLongTerm`; Crypto doesn't have a long-term shadow wallet yet, so
 * the tab must not appear at all when the option is omitted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderAssetHub } from '../../src/ui/views/assetHubView';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal(
    'fetch',
    () => Promise.resolve({ ok: true, json: () => Promise.resolve({ 'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' } }) }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const baseOpts = {
  title: 'Stocks',
  subtitle: 'sub',
  currencySymbol: '$',
  fetchState: async () => null,
  showBenchmark: false,
  renderOverview: () => undefined,
  renderMarket: () => undefined,
};

describe('renderAssetHub — optional Long-Term sub-tab', () => {
  it('omits the tab and panel entirely when renderLongTerm is not provided (crypto today)', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderAssetHub(container, baseOpts);

    expect(container.querySelector('[data-hub="longterm"]')).toBeNull();
    expect(container.querySelector('[data-hub-panel="longterm"]')).toBeNull();
  });

  it('shows the tab and lazily mounts the panel exactly once when clicked (stocks)', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    let mounts = 0;
    renderAssetHub(container, {
      ...baseOpts,
      renderLongTerm: (panel) => {
        mounts++;
        panel.textContent = 'long-term panel content';
        return undefined;
      },
    });

    const tabBtn = container.querySelector<HTMLButtonElement>('[data-hub="longterm"]');
    expect(tabBtn).not.toBeNull();
    expect(mounts).toBe(0); // not mounted until clicked

    tabBtn!.click();
    expect(mounts).toBe(1);
    expect(container.querySelector('[data-hub-panel="longterm"]')!.textContent).toBe('long-term panel content');
    expect(container.querySelector('[data-hub-panel="longterm"]')!.classList.contains('active')).toBe(true);
    expect(tabBtn!.classList.contains('active')).toBe(true);

    tabBtn!.click(); // clicking again must not remount
    expect(mounts).toBe(1);
  });
});
