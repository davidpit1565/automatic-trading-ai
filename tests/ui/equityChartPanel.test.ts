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

  /**
   * Real bug, found 2026-09-06 by hovering the actual rendered chart (not
   * from reading the code): in the DEFAULT line mode, the crosshair below
   * was fed `candles` — the bucketed OHLC series bucketize() reduces to
   * roughly 30 entries regardless of how many raw samples exist — while
   * `geo` (and therefore `geo.indexAtFraction`) was built from the RAW,
   * unbucketed points array, one entry per recorded sample. Any real
   * account with more samples than ~30 (every real account, in practice)
   * hit an out-of-bounds `candles[idx]` past roughly the first
   * TARGET_CANDLES-worth of x-position, throwing inside the pointermove
   * handler and killing the crosshair/tooltip for most of the chart's
   * width. Reproduced here with 200 raw samples (bucketized down to far
   * fewer for the default 'All' range) and a pointer move past where the
   * old bucketed array would have run out.
   */
  it('keeps the crosshair working in line mode past the bucketed candle count (real bug, 2026-09-06)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountEquityChartPanel(container);
    const t0 = 1_700_000_000_000;
    const manySamples = Array.from({ length: 200 }, (_, i) => ({ at: t0 + i * 5 * 60_000, equity: 100 + i * 0.1 }));
    handle.setHistory(manySamples);

    expect(container.querySelector('.ctoggle-btn.active')!.getAttribute('data-mode')).toBe('line');
    const svg = container.querySelector<SVGSVGElement>('svg.pchart')!;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 380, bottom: 240, width: 380, height: 240, x: 0, y: 0, toJSON() {} }) as DOMRect;

    // Near the right edge — well past where the ~30-entry bucketed array
    // would previously have run out for a 200-point history.
    svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 370, bubbles: true }));

    const tip = container.querySelector<HTMLElement>('.pchart-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.querySelector('.pchart-tip-price')!.textContent).toContain('€');
    expect(container.querySelector('.pchart-cross')!.classList.contains('show')).toBe(true);
  });

  /**
   * Real, screenshot-confirmed duplicate found 2026-09-06: the Profit tab's
   * "Real money" hero already shows "since tracking began" for this exact
   * account (computed from `history[0]`, no `trueStartEquity` — real
   * accounts have none). With `showHero: false`, this chart's own default
   * 'All' range change is mathematically guaranteed to be the identical
   * figure (same baseline, same latest sample) — a duplicate visible on
   * every real-money Profit tab load. Any other range genuinely differs
   * (a shorter window's own return), so only 'All' is suppressed.
   */
  it('suppresses the compact range-change line on the default "All" range when showHero is false (duplicates the caller\'s own hero)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountEquityChartPanel(container, { showHero: false });
    handle.setHistory(history());

    expect(container.querySelector('.hero-change.compact')).toBeNull();

    const oneDayBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.range-btn')).find(
      (b) => b.dataset['range'] === '1D',
    )!;
    oneDayBtn.click();
    // Range switches fade out then repaint (200ms) — see repaintWithFade.
    await waitFor(() => container.querySelector('.range-btn.active')!.textContent === '1D');
    expect(container.querySelector('.hero-change.compact')).not.toBeNull();
    expect(container.querySelector('.hero-change.compact')!.textContent).toContain('1D');
  });

  /**
   * Real bug: a brand-new account's first ~10-15 minutes has too few
   * samples to bucket into 2+ candles, so `paint()` force-overrides
   * `mode` back to 'line' regardless of the user's own toggle choice — but
   * the "Candles" button stayed tappable, silently reverting to "Line"
   * shown-active with no feedback about why. Disabled, not inert.
   */
  it('disables the Candles toggle when there are too few samples to bucket into 2+ candles', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountEquityChartPanel(container);
    const t0 = 1_700_000_000_000;
    // Only 2 samples, a minute apart — bucketize() collapses them into a
    // single bucket even at the smallest allowed (5-minute) bucket width.
    handle.setHistory([{ at: t0, equity: 100 }, { at: t0 + 60_000, equity: 100.5 }]);

    const candleBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.ctoggle-btn')).find(
      (b) => b.dataset['mode'] === 'candle',
    )!;
    expect(candleBtn.disabled).toBe(true);
  });

  /**
   * Real, reproducible micro-interaction issue: tapping a range/mode button
   * that is already active used to still fade the chart out and back in —
   * a pointless ~200ms flash with no informational change. Apple's own
   * fluid-interface guidance is explicit about killing latency/motion that
   * isn't earning its keep.
   */
  /**
   * Real accessibility gap found 2026-09-06: `.hub-tabs` (assetHubView.ts)
   * already carries role="tab"/aria-selected for its own selection state,
   * but this range bar and the Line/Candles toggle — the same kind of
   * single-select segmented group — carried no ARIA state at all.
   */
  it('marks the active range and chart-mode button with aria-pressed, and updates it on selection', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountEquityChartPanel(container);
    handle.setHistory(history());

    const allBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.range-btn')).find(
      (b) => b.dataset['range'] === 'All',
    )!;
    expect(allBtn.getAttribute('aria-pressed')).toBe('true');
    const oneDayBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.range-btn')).find(
      (b) => b.dataset['range'] === '1D',
    )!;
    expect(oneDayBtn.getAttribute('aria-pressed')).toBe('false');

    const lineBtn = container.querySelector<HTMLButtonElement>('.ctoggle-btn[data-mode="line"]')!;
    const candleBtn = container.querySelector<HTMLButtonElement>('.ctoggle-btn[data-mode="candle"]')!;
    expect(lineBtn.getAttribute('aria-pressed')).toBe('true');
    expect(candleBtn.getAttribute('aria-pressed')).toBe('false');

    candleBtn.click();
    await waitFor(() => container.querySelector('.pcandle') !== null);
    expect(container.querySelector<HTMLButtonElement>('.ctoggle-btn[data-mode="candle"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector<HTMLButtonElement>('.ctoggle-btn[data-mode="line"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not repaint (no fade-out) when the already-active range or chart-mode button is clicked again', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountEquityChartPanel(container);
    handle.setHistory(history());

    const activeRange = container.querySelector<HTMLButtonElement>('.range-btn.active')!;
    activeRange.click();
    expect(container.querySelector('.detail-chart')!.classList.contains('fade-out')).toBe(false);

    const activeMode = container.querySelector<HTMLButtonElement>('.ctoggle-btn.active')!;
    activeMode.click();
    expect(container.querySelector('.detail-chart')!.classList.contains('fade-out')).toBe(false);
  });

  it('never renders the compact line when showHero is true — the hero-bare block shows its own change line instead (History tab, no duplicate elsewhere)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountEquityChartPanel(container, { showHero: true });
    handle.setHistory(history());

    expect(container.querySelector('.hero-change.compact')).toBeNull();
    expect(container.querySelector('.hero.hero-bare .hero-change')).not.toBeNull();
  });
});
