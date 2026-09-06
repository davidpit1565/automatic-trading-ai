// @vitest-environment happy-dom
/**
 * Real DOM integration for main.ts's global chrome (the topbar BTC chip +
 * the delegated bottom-nav click handler) — the one file in this area with
 * no prior test coverage at all. Boots the real `index.html` markup (not a
 * hand-rolled stand-in) so a future markup change that breaks this wiring
 * gets caught here, and dynamically imports main.ts (which self-invokes
 * `bootstrap()` on import) against it.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// happy-dom (this file's test environment) installs its own global `URL`,
// which shadows Node's — `new URL('.', import.meta.url)` under that global
// produces something `fileURLToPath` can't parse ("must be of scheme
// file"). `fileURLToPath(import.meta.url)` alone is a plain string op, not a
// `new URL(...)` construction, so it never touches the shadowed global.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
if (!bodyMatch) throw new Error('index.html has no <body> to extract for this test');
const bodyHtml = bodyMatch[1]!.replace(/<script[\s\S]*?<\/script>/g, '');

async function waitFor(condition: () => boolean, tries = 400): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(() => {
  document.body.innerHTML = bodyHtml;
  // Every network path (Revolut proxy probe, Kraken/Coinbase probes, the
  // cloud-state fetch) fails instantly, so initDataSource() falls through to
  // the synthetic demo source quickly and mountTopbarBtc's own fetchSnapshot
  // (which reads candles from that same demo source, not fetch) still works.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('main.ts global chrome (DOM integration)', () => {
  it('mounts the topbar BTC chip as a real nav target to Markets, with a working click', async () => {
    await import('../../src/ui/main.ts');

    await waitFor(() => document.getElementById('topbar-btc')?.hidden === false);
    const chip = document.getElementById('topbar-btc')!;
    // This chip used to be dead UI — a live, prominent price with nothing
    // wired to a tap. `data-nav="markets"` is what the app's existing
    // delegated [data-nav] click listener needs to treat it as a real
    // destination, matching every other nav target in the app.
    expect(chip.dataset['nav']).toBe('markets');

    chip.click();
    await waitFor(() => document.getElementById('view-markets')?.classList.contains('active') === true);
    expect(document.querySelector('.nav-btn.active')?.getAttribute('data-nav')).toBe('markets');
  });

  it('activates the topbar BTC chip on a real Enter/Space keydown, not just a click', async () => {
    await import('../../src/ui/main.ts');
    await waitFor(() => document.getElementById('topbar-btc')?.hidden === false);
    const chip = document.getElementById('topbar-btc')!;

    // This chip is a plain <div> — mouse/touch already worked (see the test
    // above), but without role="button" + the global keydown delegate in
    // main.ts, a keyboard-only user had no way to reach or activate it at
    // all: not in the Tab order, and Enter/Space did nothing regardless.
    expect(chip.getAttribute('role')).toBe('button');
    expect(chip.tabIndex).toBe(0);

    chip.focus();
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => document.getElementById('view-markets')?.classList.contains('active') === true);
    expect(document.querySelector('.nav-btn.active')?.getAttribute('data-nav')).toBe('markets');
  });

  it('keeps the bottom-nav tablist\'s aria-selected and roving tabindex in sync as views switch', async () => {
    await import('../../src/ui/main.ts');
    await waitFor(() => document.getElementById('topbar-btc') !== null);

    const cryptoTab = document.querySelector<HTMLElement>('.nav-btn[data-nav="crypto"]')!;
    const marketsTab = document.querySelector<HTMLElement>('.nav-btn[data-nav="markets"]')!;
    // Server-rendered initial state: Crypto is the default active view.
    expect(cryptoTab.getAttribute('aria-selected')).toBe('true');
    expect(cryptoTab.tabIndex).toBe(0);
    expect(marketsTab.getAttribute('aria-selected')).toBe('false');
    expect(marketsTab.tabIndex).toBe(-1);

    marketsTab.click();
    // Previously `activateView` only ever toggled the visual `.active`
    // class — aria-selected was never written again after the very first
    // (server-rendered) state, so a screen reader kept announcing "Crypto"
    // as selected no matter which tab was actually showing.
    expect(marketsTab.getAttribute('aria-selected')).toBe('true');
    expect(marketsTab.tabIndex).toBe(0);
    expect(cryptoTab.getAttribute('aria-selected')).toBe('false');
    expect(cryptoTab.tabIndex).toBe(-1);
  });

  it('moves focus AND switches the active view on a real ArrowRight/ArrowLeft keydown across the bottom-nav tablist', async () => {
    await import('../../src/ui/main.ts');
    await waitFor(() => document.getElementById('topbar-btc') !== null);

    const cryptoTab = document.querySelector<HTMLElement>('.nav-btn[data-nav="crypto"]')!;
    const stocksTab = document.querySelector<HTMLElement>('.nav-btn[data-nav="stocks"]')!;
    cryptoTab.focus();
    // Real keyboard input, not a direct function call — this is the exact
    // event a keyboard user's arrow-key press produces, handled by the
    // delegated tablist keydown listener in main.ts (previously nothing:
    // arrow keys did nothing on any of the app's several tablists).
    cryptoTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(stocksTab);
    expect(document.getElementById('view-stocks')?.classList.contains('active')).toBe(true);
    expect(stocksTab.getAttribute('aria-selected')).toBe('true');

    // Wraps around: ArrowLeft from the first tab goes to the last (Tools).
    const toolsTab = document.querySelector<HTMLElement>('.nav-btn[data-nav="tools"]')!;
    cryptoTab.focus();
    cryptoTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(toolsTab);
    expect(document.getElementById('view-tools')?.classList.contains('active')).toBe(true);
  });

  it('manages focus across the Tools open/close DOM swap instead of silently dropping it to <body>', async () => {
    await import('../../src/ui/main.ts');
    await waitFor(() => document.getElementById('topbar-btc') !== null);

    document.querySelector<HTMLElement>('.nav-btn[data-nav="tools"]')!.click();
    const backtestCard = document.querySelector<HTMLElement>('[data-tab="backtest"]')!;
    backtestCard.click();
    // `#tools-menu` (which contains the just-clicked card) is now `hidden` —
    // a browser drops focus to <body>, with no visible indication of where
    // it went, the instant a focused element is hidden. Previously nothing
    // in `openTool` moved focus anywhere, so a keyboard user landed nowhere.
    expect(document.activeElement).toBe(document.querySelector('[data-tool-back]'));
    expect(document.activeElement).not.toBe(document.body);

    document.querySelector<HTMLElement>('[data-tool-back]')!.click();
    // Same bug, the other direction: `#tool-detail` (containing the
    // just-clicked Back button) becomes hidden on the way back to the menu.
    expect(document.activeElement).toBe(backtestCard);
    expect(document.activeElement).not.toBe(document.body);
  });

  // David asked (2026-09-06) to stop showing simulated-money data anywhere on
  // the site. portfolioView.ts is a standalone simulated (paper) trading
  // dashboard — its Tools-grid entry must be unreachable, while the
  // underlying route/section stays fully intact (same "hide, don't delete"
  // pattern PR #195 used for the crypto hub's simulated hero).
  it('hides the simulated Portfolio dashboard\'s nav entry, without removing its route', async () => {
    await import('../../src/ui/main.ts');

    const portfolioButton = document.querySelector<HTMLElement>('[data-tab="portfolio"]');
    expect(portfolioButton).not.toBeNull();
    // Hidden via its containing group, not deleted from the DOM.
    expect(portfolioButton!.closest<HTMLElement>('.tools-grid')?.hidden).toBe(true);
    expect(portfolioButton!.closest('[hidden]')).not.toBeNull();
    // The route itself is untouched — its target section still exists.
    expect(document.getElementById('tab-portfolio')).not.toBeNull();
  });
});
