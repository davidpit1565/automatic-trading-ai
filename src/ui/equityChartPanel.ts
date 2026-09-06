/**
 * Shared equity/P&L chart panel: range selector (1D → All), a smooth Line
 * chart (default) with a Candlestick toggle, an interactive crosshair +
 * tooltip, and a hero summary (current value + the gain/loss over the
 * selected range). Used by both the Portfolio value view and the History
 * view so one implementation — and one set of fixes — covers both.
 *
 * Line is the default (David flagged this, 2026-09-03: a real ~€8 balance
 * wobble read as an alarming "very big drop" once OHLC-bucketed into a
 * candle body) — every real trading app (Revolut X included) charts
 * account/portfolio VALUE as a smooth line, reserving candlesticks for a
 * tradable asset's own PRICE chart (Markets/coin-detail, a different
 * component entirely — unaffected by this default).
 */

import { priceChartSvg, candleChartSvg, chartGeometry, candleGeometry, positionChartTip, type ChartGeometry } from './charts';
import { formatPrice, formatPct } from './format';
import type { Candle } from '../core/types';

const HOT = 'var(--hot)';
const COLD = 'var(--cold)';
const DAY = 86_400_000;
const HOUR = 3_600_000;

interface Range {
  readonly key: string;
  readonly ms: number; // 0 = all
  /** Widest sensible candle bucket for this range, once there's enough
   * history to fill it (e.g. 1Y → weekly candles once a year has elapsed). */
  readonly bucketMs: number;
  readonly fx: (ts: number) => string;
}
const RANGES: Range[] = [
  { key: '1D', ms: DAY, bucketMs: HOUR, fx: (t) => hm(t) },
  { key: '1W', ms: 7 * DAY, bucketMs: 4 * HOUR, fx: (t) => dm(t) },
  { key: '1M', ms: 30 * DAY, bucketMs: DAY, fx: (t) => dm(t) },
  { key: '1Y', ms: 365 * DAY, bucketMs: 7 * DAY, fx: (t) => mon(t) },
  { key: 'All', ms: 0, bucketMs: 7 * DAY, fx: (t) => dm(t) },
];
const hm = (t: number): string => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dm = (t: number): string => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
const mon = (t: number): string => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

/** Aim for roughly this many candles — readable on a phone, but enough to
 * show real structure even when a range's nominal bucket is far too wide
 * for how much history actually exists yet (e.g. 'All'/'1Y' on day 5 of
 * tracking, where a weekly bucket would flatten everything into 1-2 candles). */
const TARGET_CANDLES = 30;
/** Never bucket finer than this — avoids near-one-sample-per-candle noise
 * when there's very little history. Roughly the cloud agent's recording
 * cadence, so this floor rarely binds once tracking has run a while. */
const MIN_BUCKET_MS = 5 * 60_000;

/**
 * Shrink `niceBucketMs` down toward the actual data span when there isn't
 * enough history to fill it yet, so every range shows real structure
 * instead of 1-2 giant candles. Once `spanMs` comfortably exceeds
 * `niceBucketMs * TARGET_CANDLES`, this returns `niceBucketMs` unchanged.
 */
export function adaptiveBucketMs(spanMs: number, niceBucketMs: number): number {
  if (spanMs <= 0) return niceBucketMs;
  return Math.max(MIN_BUCKET_MS, Math.min(niceBucketMs, spanMs / TARGET_CANDLES));
}

/**
 * Bucket the raw equity samples (recorded every cloud cycle, ~5 min) into
 * real OHLC candles — open/close are the first/last sample in the bucket,
 * high/low the extremes seen. This is a genuine aggregation of recorded
 * data, not invented prices.
 */
export function bucketize(points: readonly { at: number; equity: number }[], bucketMs: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const p of points) {
    const bucketStart = Math.floor(p.at / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        timestamp: bucketStart, open: p.equity, high: p.equity, low: p.equity, close: p.equity, volume: 0,
      });
    } else {
      buckets.set(bucketStart, {
        ...existing,
        high: Math.max(existing.high, p.equity),
        low: Math.min(existing.low, p.equity),
        close: p.equity, // points are chronological, so the last write is the close
      });
    }
  }
  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export interface EquityPoint {
  readonly at: number;
  readonly equity: number;
}

export interface EquityChartPanelHandle {
  /**
   * Repaint with fresh data. Safe to call repeatedly (e.g. on each poll).
   *
   * `trueStartEquity`, when known (the SIMULATED accounts' `initialCash` —
   * there is no equivalent for the REAL account, which has no such field),
   * anchors the "All" range's own return% to the account's actual starting
   * capital instead of `history[0]`. Real bug, found 2026-09-05 by hand-
   * checking the committed state: `history` is capped at 5,000 samples
   * server-side (`EQUITY_HISTORY_CAP` in autopilotRunner.mts/stocksRunner.mts)
   * and silently truncated from the front once a long-running account
   * exceeds it — the crypto paper account is AT that cap right now, so
   * `history[0]` is no longer the first sample ever recorded, just whatever
   * happens to be oldest survivor in the array. Using it as "All"'s baseline
   * made this panel's own "All" return disagree with the Overview/Profit
   * tab's `initialCash`-anchored "all time" return for the exact same
   * account on the exact same screen (2.22% vs 6.83% on the real committed
   * crypto state) — the "since tracking began" class of bug, just with the
   * anchor point silently drifting forward over an account's lifetime
   * instead of being wrong from a single formula error.
   */
  setHistory(history: readonly EquityPoint[], trueStartEquity?: number): void;
}

/**
 * Renders the range bar, candle/line toggle, chart and crosshair into
 * `container` (which the caller owns and clears itself). Call `setHistory`
 * once data first arrives and again on every refresh.
 */
export function mountEquityChartPanel(
  container: HTMLElement,
  options: { readonly currencySymbol?: string; readonly live?: boolean; readonly showHero?: boolean } = {},
): EquityChartPanelHandle {
  const currency = options.currencySymbol ?? '€';
  const tag = options.live ? '<span class="tag-live">REAL</span>' : '<span class="tag-sim">SIMULATED</span>';
  // David flagged (2026-09-04): the Profit tab's real-money chart sits
  // directly under a "Real money" hero already showing this exact figure —
  // this panel's own big "Now €X" header just repeats it a few pixels
  // below, reading as a giant, disproportionate duplicate. Defaults to
  // true (every OTHER caller — the History tab, the Portfolio/Value view —
  // genuinely needs this as its only headline number).
  const showHero = options.showHero ?? true;
  let history: readonly EquityPoint[] = [];
  /** The account's true starting equity, when known — see `setHistory`'s doc
   * comment. Anchors the "All" range's return% instead of a possibly-
   * truncated `history[0]`. */
  let trueStartEquity: number | undefined;
  let rangeKey = 'All';
  let chartMode: 'candle' | 'line' = 'line';

  function windowedPoints(): EquityPoint[] {
    const range = RANGES.find((r) => r.key === rangeKey)!;
    const now = history[history.length - 1]!.at;
    let pts = range.ms > 0 ? history.filter((p) => p.at >= now - range.ms) : history.slice();
    if (pts.length < 2) pts = history.slice(); // fall back to All when the window is too short
    return pts;
  }

  /** Range/mode switches used to hard-snap with no transition at all — the
   * coin-detail market chart already fades out/in on the same kind of
   * switch (`marketsView.ts`), so this repaints the same way for
   * consistency: fade the current chart out, repaint, fade the new one in. */
  function repaintWithFade(): void {
    const chart = container.querySelector<HTMLElement>('.detail-chart');
    chart?.classList.add('fade-out');
    setTimeout(() => {
      paint();
      // `paint()` replaces the container's innerHTML, detaching `chart`
      // above — re-query the freshly-rendered node before fading it in.
      const freshChart = container.querySelector<HTMLElement>('.detail-chart');
      if (freshChart) {
        freshChart.classList.add('fade-in');
        setTimeout(() => freshChart.classList.remove('fade-in'), 300);
      }
    }, 200);
  }

  function paint(): void {
    if (history.length < 2) {
      container.innerHTML =
        '<div class="empty">Collecting data — the chart appears after a few cloud runs. Check back soon.</div>';
      return;
    }
    const range = RANGES.find((r) => r.key === rangeKey)!;
    const pts = windowedPoints();
    // Only "All" ever needs the true-start override: every other range's
    // baseline is legitimately "equity at the start of THIS window", which
    // `pts[0]` already is (windowedPoints() filters to the window). "All"
    // means "since tracking began", which `pts[0]` can only answer honestly
    // while `history` hasn't been truncated — see `setHistory`'s doc comment.
    const usingTrueStart = range.key === 'All' && trueStartEquity !== undefined && trueStartEquity > 0;
    const first = usingTrueStart ? trueStartEquity! : pts[0]!.equity;
    const last = pts[pts.length - 1]!.equity;
    const ret = first > 0 ? ((last - first) / first) * 100 : 0;
    const up = ret >= 0;
    const spanMs = pts[pts.length - 1]!.at - pts[0]!.at;
    const candles = bucketize(pts, adaptiveBucketMs(spanMs, range.bucketMs));
    const mode: 'candle' | 'line' = candles.length >= 2 ? chartMode : 'line';

    let chart: string;
    let geo: ChartGeometry | null = null;
    // What the crosshair below actually indexes into — must be the same
    // length as `geo` (one entry per index `geo.indexAtFraction` can return).
    let crosshairSeries: Candle[];
    if (mode === 'candle') {
      // No EMA/support-resistance/volume overlays here — those are
      // technical-analysis signals for a tradable asset's price, and this
      // is the viewer's own portfolio equity, not a market to read a trend
      // signal off of (see the `indicators` option's own doc comment).
      chart = candleChartSvg(candles, { formatX: range.fx, formatY: (v) => `${currency}${formatPrice(v)}`, indicators: false });
      geo = candleGeometry(candles);
      crosshairSeries = candles;
    } else {
      const points = pts.map((p) => ({ timestamp: p.at, value: p.equity }));
      chart = priceChartSvg(points, { stroke: up ? HOT : COLD, formatX: range.fx, formatY: (v) => `${currency}${formatPrice(v)}` });
      geo = chartGeometry(points);
      // Real bug, found 2026-09-06 by hovering the actual rendered chart
      // (not from reading the code): line mode's geometry indexes `points`,
      // one entry per RAW recorded sample — but the crosshair below was
      // fed `candles`, the bucketed OHLC series, which has far FEWER entries
      // once there's enough history (bucketize() aims for ~30 buckets
      // regardless of how many raw samples exist). `geo.indexAtFraction`
      // can return any index up to `points.length - 1`, so `candles[idx]`
      // silently went out of bounds and threw inside the pointermove
      // handler for most of the chart's width — hovering past roughly the
      // first `TARGET_CANDLES`-worth of x-position killed the crosshair and
      // tooltip entirely, on both this History/Profit panel and
      // valueView.ts (all three share this component). A one-sample-per-
      // point synthetic candle (open=high=low=close=the equity value) keeps
      // `wireCrosshair`'s existing shape while indexing correctly for line
      // mode.
      crosshairSeries = points.map((p) => ({
        timestamp: p.timestamp, open: p.value, high: p.value, low: p.value, close: p.value, volume: 0,
      }));
    }
    // aria-pressed: a real accessibility gap found 2026-09-06 — the hub-tabs
    // segmented control (assetHubView.ts) already carries role="tab" /
    // aria-selected for its own selection state, but this range bar and the
    // Line/Candles toggle just below (the same kind of single-select
    // segmented group) carried no ARIA state at all, so a screen-reader user
    // had no way to tell which range or chart mode was currently active.
    const rangeBar = RANGES.map(
      (r) =>
        `<button class="range-btn ${r.key === rangeKey ? 'active' : ''}" data-range="${r.key}" aria-pressed="${r.key === rangeKey}">${r.key}</button>`,
    ).join('');

    container.innerHTML = `
      ${
        showHero
          ? `<!-- hero-bare matches Home's balance treatment: same dominant-figure
           pattern for this sub-screen (shared by Crypto's and Stocks' History
           tab), not a secondary boxed widget. -->
      <div class="hero hero-bare">
        <div class="hero-label">Now ${tag}</div>
        <div class="hero-value">${currency}${formatPrice(last)}</div>
        <div class="hero-change ${up ? 'up' : 'down'}">${formatPct(ret)} · ${rangeKey}</div>
        <!-- Same wording the REAL-money hero already uses (homeView.ts/
             assetHubView.ts) for the identical situation: once the true
             starting equity is used instead of the oldest surviving sample,
             that sample's own date is no longer what the % is measured
             from, so showing it here would be its own new mismatch. -->
        <div class="hero-split"><span>${usingTrueStart ? 'since tracking began' : `since ${new Date(pts[0]!.at).toLocaleDateString('en-GB')}`}</span></div>
      </div>`
          : // Real, screenshot-confirmed duplicate found 2026-09-06: with
            // `showHero: false`, the caller (the Profit tab's "Real money"
            // hero) already shows this exact same figure as its own
            // "since tracking began" change line — computed from the same
            // `history[0]` this chart's own "All" range uses (real accounts
            // pass no `trueStartEquity`, so `usingTrueStart` is false and
            // `first` here is `pts[0]`, which for "All" is `history[0]`
            // itself, byte-for-byte the hero's own baseline). Every OTHER
            // range genuinely differs (a shorter window's own return), so
            // only "All" — the one range mathematically guaranteed to match
            // — is suppressed here; switching to 1D/1W/1M/1Y still shows it.
            rangeKey === 'All'
              ? ''
              : `<div class="hero-change compact ${up ? 'up' : 'down'}">${formatPct(ret)} · ${rangeKey}</div>`
      }
      <div class="chart-controls">
        <div class="range-bar">${rangeBar}</div>
        <div class="chart-toggle">
          <button class="ctoggle-btn ${mode === 'line' ? 'active' : ''}" data-mode="line" aria-pressed="${mode === 'line'}">Line</button>
          <!-- Disabled, not silently ignored, when there isn't enough
               history yet to bucket into 2+ candles (a brand-new account's
               first ~10-15 minutes) — real bug: tapping this while mode
               gets force-overridden back to 'line' above left the button
               tappable but inert, with "Line" reverting to shown-active
               instead of whatever the tap just selected. -->
          <button class="ctoggle-btn ${mode === 'candle' ? 'active' : ''}" data-mode="candle" aria-pressed="${mode === 'candle'}" ${candles.length < 2 ? 'disabled' : ''}>Candles</button>
        </div>
      </div>
      <div class="detail-chart"><div class="pchart-wrap">${chart}<div class="pchart-tip" hidden></div></div></div>`;

    container.querySelectorAll<HTMLButtonElement>('.range-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const next = b.dataset['range']!;
        // Tapping the already-active range used to still fade the chart out
        // and back in — a pointless 200ms flash with no informational
        // change (real, reproducible: tap "All" while already on "All").
        // Apple's own fluid-interface guidance is explicit about this: kill
        // any latency/motion that isn't earning its keep.
        if (next === rangeKey) return;
        rangeKey = next;
        repaintWithFade();
      });
    });
    container.querySelectorAll<HTMLButtonElement>('.ctoggle-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const m = b.dataset['mode'];
        if ((m === 'candle' || m === 'line') && m !== chartMode) { chartMode = m; repaintWithFade(); }
      });
    });
    wireCrosshair(geo, mode, crosshairSeries, range);
  }

  /** Crosshair + tooltip, shared by candle (OHLC) and line (price) modes. */
  function wireCrosshair(geo: ChartGeometry, mode: 'candle' | 'line', candles: Candle[], range: Range): void {
    const svg = container.querySelector<SVGSVGElement>('svg.pchart');
    const tip = container.querySelector<HTMLElement>('.pchart-tip');
    if (!svg || !tip) return;
    const cross = svg.querySelector<SVGElement>('.pchart-cross');
    const crossLine = svg.querySelector<SVGLineElement>('.pchart-cross-line');
    const crossDot = svg.querySelector<SVGCircleElement>('.pchart-cross-dot');

    const showAt = (clientX: number): void => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return;
      const idx = geo.indexAtFraction((clientX - rect.left) / rect.width);
      const c = candles[idx]!;
      const px = geo.x(idx);
      const py = geo.y(c.close);
      crossLine?.setAttribute('x1', px.toFixed(1));
      crossLine?.setAttribute('x2', px.toFixed(1));
      crossDot?.setAttribute('cx', px.toFixed(1));
      crossDot?.setAttribute('cy', py.toFixed(1));
      cross?.classList.add('show');
      tip.hidden = false;
      const stamp = new Date(c.timestamp).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      tip.innerHTML =
        mode === 'candle'
          ? `<span class="pchart-tip-price">${currency}${formatPrice(c.close)}</span>` +
            `<span class="pchart-tip-ohlc">O ${currency}${formatPrice(c.open)} · H ${currency}${formatPrice(c.high)} · L ${currency}${formatPrice(c.low)} · C ${currency}${formatPrice(c.close)}</span>` +
            `<span class="pchart-tip-time">${stamp}</span>`
          : `<span class="pchart-tip-price">${currency}${formatPrice(c.close)}</span><span class="pchart-tip-time">${stamp}</span>`;
      const wrap = container.querySelector<HTMLElement>('.pchart-wrap');
      if (wrap) positionChartTip(tip, wrap, px / geo.W, py / geo.H);
    };
    const hide = (): void => { cross?.classList.remove('show'); tip.hidden = true; };
    svg.addEventListener('pointermove', (e) => showAt(e.clientX));
    svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointercancel', hide);
    void range;
  }

  return {
    setHistory(h: readonly EquityPoint[], start?: number): void {
      history = h;
      trueStartEquity = start;
      paint();
    },
  };
}
