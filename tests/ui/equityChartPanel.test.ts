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

  /**
   * Real bug, found 2026-09-05 by hand-checking the committed autopilot
   * state: `equity-history` is capped at 5,000 samples server-side
   * (`EQUITY_HISTORY_CAP` in autopilotRunner.mts/stocksRunner.mts) and
   * silently truncated from the FRONT once a long-running account exceeds
   * it — the real crypto paper account is at that cap right now. This
   * panel's "All" range used `history[0]` as its return%'s baseline, which
   * on a truncated array is no longer the account's actual starting equity,
   * just whichever sample happens to still be oldest. On the real committed
   * state this made the History tab's own "All" return (6.83%) disagree
   * with the Profit tab's `initialCash`-anchored "all time" return (2.22%)
   * for the exact same account on the exact same screen. `setHistory`'s
   * optional second argument fixes this by anchoring "All" to the account's
   * true starting equity when the caller has one (every SIMULATED account
   * does — `state.initialCash`), leaving every other range (which
   * legitimately means "since the start of THIS window") untouched.
   */
  it('anchors the "All" range to the true starting equity, not a truncated history[0]', () => {
    const t0 = 1_700_000_000_000;
    // Simulates a capped/truncated history: the account actually started at
    // 10,000, but the earliest SURVIVING sample (after truncation) is 9,568.52
    // — same shape as the real committed crypto state (initialCash 10,000,
    // history[0].equity 9,568.52, last 10,222.32).
    const truncatedHistory = [
      { at: t0, equity: 9568.52 },
      { at: t0 + 60_000, equity: 9800 },
      { at: t0 + 120_000, equity: 10222.32 },
    ];
    const trueStartEquity = 10_000;
    const expectedPct = ((10222.32 - trueStartEquity) / trueStartEquity) * 100; // 2.2232...%
    const wrongPct = ((10222.32 - 9568.52) / 9568.52) * 100; // 6.83...% — the bug's number

    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountEquityChartPanel(container);
    handle.setHistory(truncatedHistory, trueStartEquity);

    const changeText = container.querySelector('.hero-change')!.textContent!;
    expect(changeText).toContain(`${expectedPct.toFixed(2)}%`);
    expect(changeText).not.toContain(`${wrongPct.toFixed(2)}%`);
    // The "since {date}" caption would now be lying about what the % is
    // measured from (it'd show the truncated sample's date, not the true
    // start's) — replaced with the same honest "since tracking began"
    // wording the REAL-money hero already uses for this exact situation.
    expect(container.querySelector('.hero-split')!.textContent).toBe('since tracking began');
  });

  it('still uses history[0] as the baseline when no true starting equity is supplied (REAL account, no initialCash)', () => {
    const handle = mountEquityChartPanel(document.body.appendChild(document.createElement('div')));
    const h = history(); // first equity 100, last 119
    handle.setHistory(h);
    const container = document.body.lastElementChild as HTMLElement;
    const expectedPct = ((119 - 100) / 100) * 100;
    expect(container.querySelector('.hero-change')!.textContent).toContain(`${expectedPct.toFixed(2)}%`);
    expect(container.querySelector('.hero-split')!.textContent).not.toBe('since tracking began');
  });
});
