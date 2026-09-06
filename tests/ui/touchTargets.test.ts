/**
 * Mobile ergonomics regression lock: round-2 design audit (touch-target
 * sizing/viewport/safe-area, cross-cutting across the whole app).
 *
 * happy-dom does not run layout, so `getBoundingClientRect()` always reports
 * zero here — the same reason no other test in this suite asserts on real
 * pixel geometry. These instead assert on the stylesheet SOURCE (the same
 * pattern `dashboard.test.ts`'s "opts into the safe area" check already
 * uses): a `min-height`/`min-width`/`width`/`height` declaration reaching the
 * Apple HIG 44x44pt minimum for every icon-only or small button a real
 * Playwright pass (chromium, 390x844 / 375x667 / 428x926 portrait plus
 * 844x390 landscape) measured below it via `getBoundingClientRect()`. Each
 * measured "before" value is the one this test guards against regressing to.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const css = readFileSync(resolve(root, 'src/ui/styles.css'), 'utf8');

/** Finds a top-level rule body for an exact selector (not a substring match
 *  of some other rule sharing a prefix). */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.#[\]]/g, (c) => `\\${c}`);
  // Anchored to the start of a line so e.g. `.market-row` doesn't match the
  // tail end of an unrelated compound selector like
  // `... ~ .market-row-wrap .market-row {`.
  const match = css.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`no rule found for ${selector} in styles.css`);
  return match[1]!;
}

describe('touch targets: 44x44 HIG minimum', () => {
  it('Markets list watchlist star (.mk-star) is a real 44x44 box, not just a 17px icon', () => {
    // Was width:30px/height:30px — measured 30x30 via getBoundingClientRect
    // at every tested viewport.
    const rule = ruleBody('.mk-star');
    expect(rule).toMatch(/width:\s*44px/);
    expect(rule).toMatch(/height:\s*44px/);
  });

  it('.market-row reserves enough right padding for the grown .mk-star to clear the price text', () => {
    expect(ruleBody('.market-row')).toMatch(/padding:\s*0\.95rem 3\.3rem/);
  });

  it('coin-detail back (.icon-btn) and watch (.star-btn) buttons are 44x44, not 38x38', () => {
    for (const selector of ['.icon-btn', '.star-btn']) {
      const rule = ruleBody(selector);
      expect(rule).toMatch(/width:\s*44px/);
      expect(rule).toMatch(/height:\s*44px/);
    }
  });

  it('the pair-switcher trigger (.detail-name-btn) has a real 44px-tall hit box', () => {
    // Was 22px tall (no min-height at all) — the primary way to switch
    // trading pairs, explicitly called out for this audit.
    expect(ruleBody('.detail-name-btn')).toMatch(/min-height:\s*44px/);
  });

  it('segmented controls (hub/view/mk tabs, range + candle/line toggles, pager) all reach a 44px min-height', () => {
    for (const selector of ['.hub-tab', '.view-tab', '.range-btn', '.ctoggle-btn', '.mk-tab', '.pager']) {
      expect(ruleBody(selector)).toMatch(/min-height:\s*44px/);
    }
  });

  it('.range-btn also reaches a 44px min-width (short labels like "1D"/"1Y" measured as narrow as 41px)', () => {
    expect(ruleBody('.range-btn')).toMatch(/min-width:\s*44px/);
  });

  it('the Tools "back" button and topbar BTC chip reach a 44px min-height', () => {
    expect(ruleBody('.tool-back')).toMatch(/min-height:\s*44px/);
    expect(ruleBody('.topbar-btc')).toMatch(/min-height:\s*44px/);
  });

  it('Markets search input and sort select reach a 44px min-height', () => {
    expect(ruleBody('.mk-search')).toMatch(/min-height:\s*44px/);
    expect(ruleBody('.mk-sort')).toMatch(/min-height:\s*44px/);
  });

  it('every Tools-form input/select (.control input/select, shared across all 6 tool tabs) reaches 44px', () => {
    const match = css.match(/\.control input,\s*\n\.control select\s*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/min-height:\s*44px/);
  });

  it('Home\'s "See all" links (.link-btn) get a real tap-height padding without shifting their visual position', () => {
    // Was a zero-padding text-only button measuring 17px tall. Padding grows
    // the hit box; the matching negative margin keeps the visible baseline
    // row (.block-head) unchanged.
    const rule = ruleBody('.link-btn');
    expect(rule).toMatch(/padding:\s*1rem 0\.5rem/);
    expect(rule).toMatch(/margin:\s*-1rem -0\.5rem/);
  });
});

describe('safe-area coverage beyond the topbar/bottom-nav', () => {
  it('the toast notification container respects the safe area on all sides it is anchored to', () => {
    // Was a flat `top: 1rem; right: 1rem;` — fine in portrait, but on a
    // notched device rotated to landscape the notch/Dynamic Island moves to
    // a SIDE edge and env(safe-area-inset-right) becomes non-zero, putting
    // this fixed corner under it.
    const rule = ruleBody('.toast-container');
    expect(rule).toMatch(/top:\s*max\(1rem,\s*env\(safe-area-inset-top\)\)/);
    expect(rule).toMatch(/right:\s*max\(1rem,\s*env\(safe-area-inset-right\)\)/);
  });
});
