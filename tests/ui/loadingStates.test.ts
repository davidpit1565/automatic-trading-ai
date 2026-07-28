// @vitest-environment happy-dom
/**
 * `showLoadingOverlay`'s returned cleanup used to call the shared
 * `hideLoadingOverlay()`, which removes every `.loading-overlay` in the
 * document — so one caller finishing first would rip down a second,
 * still-in-flight caller's overlay too.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { showLoadingOverlay, hideLoadingOverlay } from '../../src/ui/loadingStates';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('showLoadingOverlay', () => {
  it("a caller's own cleanup removes only its own overlay, not a concurrent one", () => {
    const stopA = showLoadingOverlay('Loading A…');
    const stopB = showLoadingOverlay('Loading B…');
    expect(document.querySelectorAll('.loading-overlay')).toHaveLength(2);

    stopA();
    expect(document.querySelectorAll('.loading-overlay')).toHaveLength(1);
    expect(document.body.textContent).toContain('Loading B');

    stopB();
    expect(document.querySelectorAll('.loading-overlay')).toHaveLength(0);
  });

  it('hideLoadingOverlay remains a hard reset that clears everything', () => {
    showLoadingOverlay('A');
    showLoadingOverlay('B');
    hideLoadingOverlay();
    expect(document.querySelectorAll('.loading-overlay')).toHaveLength(0);
  });
});
