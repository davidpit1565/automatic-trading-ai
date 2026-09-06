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
});
