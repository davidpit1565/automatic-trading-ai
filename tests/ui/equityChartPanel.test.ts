// @vitest-environment happy-dom
/**
 * Real bug (2026-09-03): a ~€8 balance wobble in the real account rendered
 * as an OHLC candle body looked like a dramatic, alarming drop — David
 * flagged it directly after comparing against Revolut X, which always
 * charts account/portfolio VALUE as a smooth line, never candlesticks
 * (those are reserved for a tradable asset's own price chart elsewhere).
 * Line must be the default here; Candles stays available as an explicit
 * opt-in via the toggle.
 */
import { describe, expect, it } from 'vitest';
import { mountEquityChartPanel } from '../../src/ui/equityChartPanel';

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function history(): { at: number; equity: number }[] {
  const t0 = 1_700_000_000_000;
  return Array.from({ length: 20 }, (_, i) => ({ at: t0 + i * 5 * 60_000, equity: 100 + i }));
}

describe('mountEquityChartPanel', () => {
  it('defaults to a smooth line chart, not candlesticks', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountEquityChartPanel(container);
    handle.setHistory(history());

    expect(container.querySelector('svg.pchart polyline')).not.toBeNull();
    expect(container.querySelector('.pcandle')).toBeNull();
    expect(container.querySelector('.ctoggle-btn.active')!.getAttribute('data-mode')).toBe('line');
  });

  it('switches to candlesticks only when explicitly toggled', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountEquityChartPanel(container);
    handle.setHistory(history());

    const candleBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.ctoggle-btn')).find(
      (b) => b.dataset['mode'] === 'candle',
    )!;
    candleBtn.click();
    // Range/mode switches fade out then repaint (200ms) — see repaintWithFade.
    await waitFor(() => container.querySelector('.pcandle') !== null);

    expect(container.querySelector('.pcandle')).not.toBeNull();
    expect(container.querySelector('svg.pchart polyline')).toBeNull();
  });
});
