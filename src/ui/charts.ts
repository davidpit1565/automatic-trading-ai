/**
 * Shared SVG chart helpers. Presentation only — every number comes from the
 * engines; these functions just draw polylines.
 */

export interface ChartPoint {
  readonly timestamp: number;
  readonly value: number;
}

export interface SRLevels {
  support: number;
  resistance: number;
}

export function calculateSRLevels(
  candles: readonly { high: number; low: number }[],
  lookback: number = 20,
): SRLevels {
  const window = candles.slice(Math.max(0, candles.length - lookback));
  const highs = window.map((c) => c.high);
  const lows = window.map((c) => c.low);
  return {
    resistance: Math.max(...highs),
    support: Math.min(...lows),
  };
}

/**
 * Returns `undefined` for every index before there are `period` values to
 * average — never a value computed from fewer inputs than the period calls
 * for. (A prior version filled the last slot from a short window regardless,
 * which fabricated a wrong average and placed it far outside the visible
 * chart once there wasn't enough history.)
 */
export function calculateEMA(values: readonly number[], period: number): (number | undefined)[] {
  const ema: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length < period) return ema;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  ema[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    ema[i] = values[i]! * k + (ema[i - 1]! * (1 - k));
  }
  return ema;
}

export interface MACDData {
  readonly macd: (number | undefined)[];
  readonly signal: (number | undefined)[];
  readonly histogram: (number | undefined)[];
  readonly min: number;
  readonly max: number;
}

export function calculateMACD(values: readonly number[]): MACDData {
  const ema12 = calculateEMA(values, 12);
  const ema26 = calculateEMA(values, 26);
  const macd = ema12.map((v12, i) => {
    const v26 = ema26[i];
    return v12 !== undefined && v26 !== undefined ? v12 - v26 : undefined;
  });
  const signal = calculateEMA(
    macd.map((m) => m ?? 0),
    9,
  );
  const histogram = macd.map((m, i) => (m !== undefined && signal[i] !== undefined ? m - signal[i]! : undefined));
  let min = 0;
  let max = 0;
  for (const h of histogram) {
    if (h !== undefined) {
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  const margin = Math.max(Math.abs(min), Math.abs(max)) * 0.1 || 0.01;
  return { macd, signal, histogram, min: min - margin, max: max + margin };
}

export interface LineChartOptions {
  readonly width?: number;
  readonly height?: number;
  /** CSS class applied to the polyline. */
  readonly lineClass: string;
  readonly ariaLabel: string;
}

/**
 * Compact sparkline (no axes) for a series of closes. Colour is passed by
 * the caller (green up / red down) via CSS custom property on the wrapper.
 * Gradient fill for improved visual appeal.
 */
export function sparklineSvg(
  values: readonly number[],
  opts: { width?: number; height?: number; stroke: string; fill?: boolean } = { stroke: 'currentColor' },
): string {
  const width = opts.width ?? 120;
  const height = opts.height ?? 40;
  const pad = 3;
  const gradId = `grad-${Math.random().toString(36).slice(2, 9)}`;
  if (values.length < 2) return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"></svg>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - 2 * pad);
    const y = height - pad - ((v - min) / span) * (height - 2 * pad);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = opts.fill
    ? `<defs><linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:${opts.stroke};stop-opacity:0.25" />
        <stop offset="100%" style="stop-color:${opts.stroke};stop-opacity:0.02" />
      </linearGradient></defs>
      <polygon fill="url(#${gradId})" points="${pad},${height - pad} ${line} ${width - pad},${height - pad}" />`
    : '';
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    ${area}<polyline fill="none" stroke="${opts.stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${line}" /></svg>`;
}

/**
 * Chart layout in viewBox units. The CSS `aspect-ratio` on `svg.pchart`
 * matches `viewWidth / viewHeight`, so `preserveAspectRatio="xMidYMid meet"`
 * never letterboxes — a view can map a pointer's CSS position to viewBox
 * coordinates with a simple linear scale.
 */
export const PRICE_CHART_PAD = {
  left: 8,
  right: 58,
  top: 12,
  bottom: 26,
  viewWidth: 380,
  viewHeight: 240,
} as const;

/**
 * Pure geometry for the price chart, shared by the renderer and by any view
 * that needs to place an interactive crosshair on top (single source of truth
 * for the coordinate mapping, so the overlay always lines up with the line).
 */
export interface ChartGeometry {
  readonly W: number;
  readonly H: number;
  readonly padL: number;
  readonly padR: number;
  readonly padT: number;
  readonly padB: number;
  readonly n: number;
  /** Padded value range shown on the axis. */
  readonly min: number;
  readonly max: number;
  /** X in viewBox units for data index `i`. */
  readonly x: (i: number) => number;
  /** Y in viewBox units for value `v`. */
  readonly y: (v: number) => number;
  /** Nearest data index for a horizontal fraction (0 = left edge, 1 = right). */
  readonly indexAtFraction: (frac: number) => number;
}

export function chartGeometry(
  points: readonly ChartPoint[],
  width?: number,
  height?: number,
): ChartGeometry {
  const W = width ?? PRICE_CHART_PAD.viewWidth;
  const H = height ?? PRICE_CHART_PAD.viewHeight;
  const padL = PRICE_CHART_PAD.left;
  const padR = PRICE_CHART_PAD.right;
  const padT = PRICE_CHART_PAD.top;
  const padB = PRICE_CHART_PAD.bottom;
  const n = points.length;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const margin = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
  min -= margin;
  max += margin;
  const span = max - min || 1;
  const x = (i: number): number => padL + (n > 1 ? (i / (n - 1)) * (W - padL - padR) : 0);
  const y = (v: number): number => padT + (1 - (v - min) / span) * (H - padT - padB);
  const indexAtFraction = (frac: number): number => {
    const clamped = Math.min(1, Math.max(0, frac));
    const inner = (clamped * W - padL) / (W - padL - padR);
    return Math.min(n - 1, Math.max(0, Math.round(inner * (n - 1))));
  };
  return { W, H, padL, padR, padT, padB, n, min, max, x, y, indexAtFraction };
}

/**
 * A real price chart with a value axis (right) and a time axis (bottom),
 * gridlines, a gradient area and a live current-price marker — the shape
 * users expect from a trading app. Scales responsively via a fixed viewBox.
 * Includes a hidden crosshair group (`.pchart-cross`) a view can reveal and
 * move for interactive hover/touch inspection.
 */
export function priceChartSvg(
  points: readonly ChartPoint[],
  opts: {
    stroke: string;
    formatX: (ts: number) => string;
    formatY: (v: number) => string;
    width?: number;
    height?: number;
  },
): string {
  if (points.length < 2) return '<div class="empty">Not enough history for this range yet.</div>';
  const geo = chartGeometry(points, opts.width, opts.height);
  const { W, H, padL, padR, padB } = geo;
  const line = points.map((p, i) => `${geo.x(i).toFixed(1)},${geo.y(p.value).toFixed(1)}`).join(' ');
  const area = `${padL.toFixed(1)},${(H - padB).toFixed(1)} ${line} ${geo.x(points.length - 1).toFixed(1)},${(H - padB).toFixed(1)}`;

  const lastYForGrid = geo.y(points[points.length - 1]!.value);
  let grid = '';
  const yTicks = 4;
  for (let k = 0; k <= yTicks; k++) {
    const v = geo.min + ((geo.max - geo.min) * k) / yTicks;
    const y = geo.y(v);
    grid += `<line class="pgrid" x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    // The pinned now-price tag already shows the exact current value — a
    // gridline label landing right next to it would just repeat that number
    // in a plainer style, crowding the one part of the axis that matters most.
    if (Math.abs(y - lastYForGrid) > 11) {
      grid += `<text class="paxis" x="${(W - padR + 5).toFixed(1)}" y="${(y + 3).toFixed(1)}">${opts.formatY(v)}</text>`;
    }
  }
  let xlab = '';
  const xTicks = Math.min(5, points.length);
  for (let k = 0; k < xTicks; k++) {
    const idx = Math.round((k * (points.length - 1)) / (xTicks - 1));
    const anchor = k === 0 ? 'start' : k === xTicks - 1 ? 'end' : 'middle';
    xlab += `<text class="paxis pxlab" style="text-anchor:${anchor}" x="${geo.x(idx).toFixed(1)}" y="${H - 8}">${opts.formatX(points[idx]!.timestamp)}</text>`;
  }

  const lastX = geo.x(points.length - 1);
  const lastY = geo.y(points[points.length - 1]!.value);
  const nowLabel = opts.formatY(points[points.length - 1]!.value);
  const uid = `pg${Math.round(points[0]!.value)}${points.length}`;
  const marker = `
    <line class="pchart-now-line" x1="${padL}" y1="${lastY.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${lastY.toFixed(1)}"/>
    <g class="pchart-now-tag" transform="translate(${(W - padR + 1).toFixed(1)}, ${lastY.toFixed(1)})">
      <rect x="0" y="-7.5" width="${(padR - 2).toFixed(1)}" height="15" rx="3" fill="${opts.stroke}"/>
      <text x="${((padR - 2) / 2).toFixed(1)}" y="3.5" text-anchor="middle" class="pchart-now-text">${nowLabel}</text>
    </g>
    <circle class="pchart-now" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5" fill="${opts.stroke}"/>`;
  const crosshair = `
    <g class="pchart-cross" hidden>
      <line class="pchart-cross-line" x1="${lastX.toFixed(1)}" y1="${geo.padT}" x2="${lastX.toFixed(1)}" y2="${(H - padB).toFixed(1)}"/>
      <circle class="pchart-cross-dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4" fill="${opts.stroke}"/>
    </g>`;

  return `<svg class="pchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="price chart">
    <defs><linearGradient id="${uid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${opts.stroke}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${opts.stroke}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <polygon fill="url(#${uid})" points="${area}"/>
    <polyline fill="none" stroke="${opts.stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${line}"/>
    ${xlab}
    ${marker}
    ${crosshair}
  </svg>`;
}

/**
 * Geometry for a candlestick chart: X positions and index math come from the
 * candle *count* (one slot per candle, so it matches a close-series crosshair),
 * while the value scale (min/max + `y`) is fitted to every high **and** low so
 * wicks never clip. A view that overlays a crosshair must build its geometry
 * with this same function so the overlay lines up with the candles exactly.
 */
export function candleGeometry(
  candles: readonly { timestamp: number; high: number; low: number; close: number }[],
  width?: number,
  height?: number,
): ChartGeometry {
  const closePoints = candles.map((c) => ({ timestamp: c.timestamp, value: c.close }));
  const extremes: ChartPoint[] = [];
  for (const c of candles) {
    extremes.push({ timestamp: c.timestamp, value: c.high });
    extremes.push({ timestamp: c.timestamp, value: c.low });
  }
  const base = chartGeometry(closePoints, width, height);
  const scale = chartGeometry(extremes.length >= 2 ? extremes : closePoints, width, height);
  // Keep X/index math from the candle count; take the wick-fitted value scale.
  return { ...base, min: scale.min, max: scale.max, y: scale.y };
}

/**
 * A professional candlestick chart (investing.com / Revolut X style): a thin
 * high→low wick and an open→close body per candle, green up / red down via
 * CSS (`--hot` / `--cold`). Includes volume bars at the bottom. Shares the
 * exact viewBox, padding, axes, live current-price marker and hidden crosshair
 * scaffold of `priceChartSvg`, so the existing crosshair + live-marker wiring
 * keeps working unchanged.
 */
export function candleChartSvg(
  candles: readonly {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[],
  opts: {
    formatX: (ts: number) => string;
    formatY: (v: number) => string;
    width?: number;
    height?: number;
    /** EMA/support-resistance/volume overlays are technical-analysis signals
     * for a tradable asset's PRICE — meaningful on a market/coin-detail chart,
     * but not on a chart of the viewer's OWN portfolio equity (there's no
     * "trend" to trade there). Same reasoning as the RSI/MACD overlays
     * already removed as misleading above; defaults to true so every
     * existing market-chart call site is unaffected. */
    indicators?: boolean;
  },
): string {
  if (candles.length < 2) return '<div class="empty">Not enough history for this range yet.</div>';
  const indicators = opts.indicators ?? true;
  const geo = candleGeometry(candles, opts.width, opts.height);
  const { W, H, padL, padR, padB } = geo;
  const n = candles.length;
  const bodyW = Math.max(1, ((W - padL - padR) / n) * 0.7);

  // Volume bar area: use bottom 18 units of padB
  const volBarHeight = 14;
  const volBarY = H - padB + 2;
  const maxVol = Math.max(...candles.map((c) => c.volume)) || 1;

  const lastYForGrid = geo.y(candles[candles.length - 1]!.close);
  let grid = '';
  const yTicks = 4;
  for (let k = 0; k <= yTicks; k++) {
    const v = geo.min + ((geo.max - geo.min) * k) / yTicks;
    const y = geo.y(v);
    grid += `<line class="pgrid" x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    // The pinned now-price tag already shows the exact current value — a
    // gridline label landing right next to it would just repeat that number
    // in a plainer style, crowding the one part of the axis that matters most.
    if (Math.abs(y - lastYForGrid) > 11) {
      grid += `<text class="paxis" x="${(W - padR + 5).toFixed(1)}" y="${(y + 3).toFixed(1)}">${opts.formatY(v)}</text>`;
    }
  }
  let xlab = '';
  const xTicks = Math.min(5, n);
  for (let k = 0; k < xTicks; k++) {
    const idx = Math.round((k * (n - 1)) / (xTicks - 1));
    const anchor = k === 0 ? 'start' : k === xTicks - 1 ? 'end' : 'middle';
    xlab += `<text class="paxis pxlab" style="text-anchor:${anchor}" x="${geo.x(idx).toFixed(1)}" y="${H - 8}">${opts.formatX(candles[idx]!.timestamp)}</text>`;
  }

  // Calculate EMAs (market charts only — see `indicators` above)
  const closes = candles.map((c) => c.close);
  const ema20 = indicators ? calculateEMA(closes, 20) : [];
  const ema50 = indicators ? calculateEMA(closes, 50) : [];

  let bodies = '';
  let volumes = '';
  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    const cx = geo.x(i);
    const up = c.close >= c.open;
    const yHigh = geo.y(c.high);
    const yLow = geo.y(c.low);
    const yOpen = geo.y(c.open);
    const yClose = geo.y(c.close);
    const top = Math.min(yOpen, yClose);
    const bh = Math.max(1, Math.abs(yClose - yOpen));
    bodies +=
      `<g class="pcandle ${up ? 'up' : 'down'}">` +
      `<line class="pcandle-wick" x1="${cx.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yLow.toFixed(1)}"/>` +
      `<rect class="pcandle-body" x="${(cx - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bh.toFixed(1)}"/>` +
      `</g>`;

    // Volume bars (scaled to volBarHeight)
    if (indicators) {
      const vh = (c.volume / maxVol) * volBarHeight;
      const barColor = up ? 'var(--hot)' : 'var(--cold)';
      volumes += `<rect class="pvol-bar" x="${(cx - bodyW / 2).toFixed(1)}" y="${(volBarY - vh).toFixed(1)}" width="${bodyW.toFixed(1)}" height="${vh.toFixed(1)}" fill="${barColor}" opacity="0.6"/>`;
    }
  }

  // EMA lines as paths (not polylines, to avoid test confusion with line-chart detection)
  function buildEmaPath(ema: readonly (number | undefined)[]): string {
    let path = '';
    let started = false;
    for (let i = 0; i < ema.length; i++) {
      const v = ema[i];
      if (v !== undefined) {
        if (!started) {
          path = `M ${geo.x(i).toFixed(1)} ${geo.y(v).toFixed(1)}`;
          started = true;
        } else {
          path += ` L ${geo.x(i).toFixed(1)} ${geo.y(v).toFixed(1)}`;
        }
      }
    }
    return path;
  }
  const ema20Path = buildEmaPath(ema20);
  const ema50Path = buildEmaPath(ema50);
  // Bright vs. dimmed neutral (not two blues) — the app's palette has no
  // blue anywhere; brightness/weight carries the distinction instead.
  const emaLines = `
    ${ema20Path ? `<path class="pema pema20" fill="none" stroke="var(--accent-text)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" d="${ema20Path}"/>` : ''}
    ${ema50Path ? `<path class="pema pema50" fill="none" stroke="var(--text-dim)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" d="${ema50Path}"/>` : ''}
  `;

  // Support/Resistance levels (last 20 candles) — market charts only (see
  // `indicators` above). Labelled "R"/"S" at the left edge so the dashed
  // lines read as an intentional annotation, not a stray artifact.
  let srLines = '';
  if (indicators) {
    const sr = calculateSRLevels(candles, 20);
    const srResistanceY = geo.y(sr.resistance);
    const srSupportY = geo.y(sr.support);
    srLines = `
    <line class="psr psr-resistance" x1="${padL.toFixed(1)}" y1="${srResistanceY.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${srResistanceY.toFixed(1)}" stroke="var(--hot)" stroke-width="1" stroke-dasharray="3,2" opacity="0.3"/>
    <text class="psr-label psr-label-resistance" x="${(padL + 2).toFixed(1)}" y="${(srResistanceY - 2.5).toFixed(1)}" font-size="7" fill="var(--hot)" opacity="0.85">R</text>
    <line class="psr psr-support" x1="${padL.toFixed(1)}" y1="${srSupportY.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${srSupportY.toFixed(1)}" stroke="var(--cold)" stroke-width="1" stroke-dasharray="3,2" opacity="0.3"/>
    <text class="psr-label psr-label-support" x="${(padL + 2).toFixed(1)}" y="${(srSupportY - 2.5).toFixed(1)}" font-size="7" fill="var(--cold)" opacity="0.85">S</text>
  `;
  }

  const last = candles[n - 1]!;
  const lastX = geo.x(n - 1);
  const lastY = geo.y(last.close);
  const up = last.close >= candles[0]!.close;
  const nowLabel = opts.formatY(last.close);
  const marker = `
    <line class="pchart-now-line" x1="${padL}" y1="${lastY.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${lastY.toFixed(1)}"/>
    <g class="pchart-now-tag" transform="translate(${(W - padR + 1).toFixed(1)}, ${lastY.toFixed(1)})">
      <rect x="0" y="-7.5" width="${(padR - 2).toFixed(1)}" height="15" rx="3"/>
      <text x="${((padR - 2) / 2).toFixed(1)}" y="3.5" text-anchor="middle" class="pchart-now-text">${nowLabel}</text>
    </g>
    <circle class="pchart-now" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5"/>`;
  const crosshair = `
    <g class="pchart-cross" hidden>
      <line class="pchart-cross-line" x1="${lastX.toFixed(1)}" y1="${geo.padT}" x2="${lastX.toFixed(1)}" y2="${(H - padB).toFixed(1)}"/>
      <circle class="pchart-cross-dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="4"/>
    </g>`;

  // OHLC readout: one compact row (not four stacked lines) with a scrim
  // behind it so it stays legible over candles/gridlines at any size.
  const ohlcParts = [
    `O ${opts.formatY(last.open)}`,
    `H ${opts.formatY(last.high)}`,
    `L ${opts.formatY(last.low)}`,
  ];
  const ohlcClose = `C ${opts.formatY(last.close)}`;
  const ohlcText = ohlcParts.join('   ');
  const ohlcWidth = Math.max(60, (ohlcText.length + ohlcClose.length + 3) * 4.1);
  const ohlc = `<g class="pohlc-labels" transform="translate(${padL.toFixed(1)}, ${geo.padT.toFixed(1)})">
    <rect class="pohlc-scrim" x="0" y="0" width="${ohlcWidth.toFixed(1)}" height="13" rx="3"/>
    <text class="pohlc-text" x="4" y="9.5" font-size="7.5">${ohlcText}<tspan dx="6" class="pohlc-close ${up ? 'up' : 'down'}">${ohlcClose}</tspan></text>
  </g>`;

  return `<svg class="pchart pcandle-chart ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="candlestick chart">
    ${grid}
    ${bodies}
    ${emaLines}
    ${srLines}
    ${volumes}
    ${ohlc}
    ${xlab}
    ${marker}
    ${crosshair}
  </svg>`;
}

export function lineChartSvg(points: readonly ChartPoint[], options: LineChartOptions): string {
  if (points.length < 2) return '<p class="status-line">Not enough points for a chart.</p>';
  const width = options.width ?? 800;
  const height = options.height ?? 180;
  const pad = 8;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = points
    .map((point, i) => {
      const x = pad + (i / (points.length - 1)) * (width - 2 * pad);
      const y = height - pad - ((point.value - min) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `
    <svg class="equity-curve" viewBox="0 0 ${width} ${height}" role="img"
         aria-label="${options.ariaLabel}">
      <polyline class="${options.lineClass}" fill="none" stroke-width="2" points="${path}" />
    </svg>
  `;
}
