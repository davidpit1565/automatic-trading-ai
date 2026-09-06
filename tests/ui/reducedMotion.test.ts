/**
 * Regression coverage for the round-2 motion/microinteraction audit: a real
 * Playwright run (`page.emulateMedia({ reducedMotion: 'reduce' })`, headless
 * Chromium at 390x844, `?demo=1`) found that only `.topbar-btc`, `.link-btn`
 * and `.tappable` had ever gotten a `prefers-reduced-motion` carve-out for
 * their `:active` scale-press — every other tappable base class in the app
 * (buttons, tabs, nav rows, stars, pagers, toggles, the pair-switcher) still
 * played the full press-squish transform with Reduce Motion on, and the live
 * `.spinner` (Backtest/Grid/Validation's candle-loading indicator) spun
 * forever regardless of the setting. happy-dom has no real CSS engine (no
 * media-query evaluation, no computed `:active` styles), so — matching this
 * file's own established pattern in `dashboard.test.ts` — this asserts
 * against the raw stylesheet text: every selector fixed by this pass must
 * appear inside the `prefers-reduced-motion: reduce` media block, so a
 * future edit can't silently drop one back out of it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const css = readFileSync(resolve(root, 'src/ui/styles.css'), 'utf8');

/** Every `@media (prefers-reduced-motion: reduce) { ... }` block's body, concatenated. */
function reducedMotionRuleText(): string {
  const blocks: string[] = [];
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    blocks.push(css.slice(start, i - 1));
  }
  if (blocks.length === 0) throw new Error('no prefers-reduced-motion media block found in styles.css');
  return blocks.join('\n');
}

describe('prefers-reduced-motion: press-state transforms and the spinner', () => {
  const reduced = reducedMotionRuleText();

  it('neutralizes the :active press transform for every shared tappable base class', () => {
    const selectors = [
      'button.primary:active',
      'button.secondary:active',
      'button.btn-buy:active',
      'button.btn-sell:active',
      '.nav-btn:active',
      '.hub-tab:active',
      '.mk-tab:active',
      '.tool-card:active',
      '.tool-back:active',
      '.icon-btn:active',
      '.star-btn:active',
      '.view-tab:active',
      '.of-btn:active',
      '.pager:active:not(:disabled)',
      '.range-btn:active',
      '.ctoggle-btn:active',
      '.detail-name-btn:active',
    ];
    for (const selector of selectors) {
      expect(reduced, `${selector} should be neutralized under reduced motion`).toContain(selector);
    }
    // .mk-star:active also translates (to stay vertically centered), so it
    // gets its own rule rather than a bare `transform: none`.
    expect(reduced).toMatch(/\.mk-star:active\s*\{\s*transform:\s*translateY\(-50%\)\s*;?\s*\}/);
  });

  it('stops the live .spinner rotation (Backtest/Grid/Validation loading indicator)', () => {
    expect(reduced).toMatch(/\.spinner\s*\{\s*animation:\s*none\s*;?\s*\}/);
  });

  it('does NOT neutralize .scan-row:active — it only changes background, a colour cue that should stay', () => {
    expect(reduced).not.toContain('.scan-row:active');
  });
});

describe('press feedback for the pair-switcher (previously missing entirely)', () => {
  it('.detail-name-btn (the "BTC-EUR ▾" trigger) has a real :active state', () => {
    expect(css).toMatch(/\.detail-name-btn:active\s*\{[^}]*(?:opacity|transform)/);
  });

  it('.pair-menu-item (each row in the pair-switcher dropdown) has a real :active state', () => {
    expect(css).toMatch(/\.pair-menu-item:active\s*\{[^}]*background/);
  });
});
