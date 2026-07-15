/**
 * Shared SVG chart helpers. Presentation only — every number comes from the
 * engines; these functions just draw polylines.
 */

export interface ChartPoint {
  readonly timestamp: number;
  readonly value: number;
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
 */
export function sparklineSvg(
  values: readonly number[],
  opts: { width?: number; height?: number; stroke: string; fill?: boolean } = { stroke: 'currentColor' },
): string {
  const width = opts.width ?? 120;
  const height = opts.height ?? 40;
  const pad = 3;
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
    ? `<polygon fill="${opts.stroke}" fill-opacity="0.12" points="${pad},${height - pad} ${line} ${width - pad},${height - pad}" />`
    : '';
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    ${area}<polyline fill="none" stroke="${opts.stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${line}" /></svg>`;
}

/**
 * A real price chart with a value axis (right) and a time axis (bottom),
 * gridlines and a gradient area — the shape users expect from a trading app.
 * Scales responsively via a fixed viewBox.
 */
export function priceChartSvg(
  points: readonly ChartPoint[],
  opts: { stroke: string; formatX: (ts: number) => string; formatY: (v: number) => string },
): string {
  if (points.length < 2) return '<div class="empty">Not enough history for this range yet.</div>';
  const W = 380, H = 240, padL = 8, padR = 58, padT = 12, padB = 26;
  const xAt = (i: number): number => padL + (i / (points.length - 1)) * (W - padL - padR);
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const margin = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
  min -= margin;
  max += margin;
  const span = max - min || 1;
  const yAt = (v: number): number => padT + (1 - (v - min) / span) * (H - padT - padB);
  const line = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ');
  const area = `${padL.toFixed(1)},${(H - padB).toFixed(1)} ${line} ${xAt(points.length - 1).toFixed(1)},${(H - padB).toFixed(1)}`;

  let grid = '';
  const yTicks = 4;
  for (let k = 0; k <= yTicks; k++) {
    const v = min + (span * k) / yTicks;
    const y = yAt(v);
    grid += `<line class="pgrid" x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="paxis" x="${(W - padR + 5).toFixed(1)}" y="${(y + 3).toFixed(1)}">${opts.formatY(v)}</text>`;
  }
  let xlab = '';
  const xTicks = Math.min(5, points.length);
  for (let k = 0; k < xTicks; k++) {
    const idx = Math.round((k * (points.length - 1)) / (xTicks - 1));
    xlab += `<text class="paxis pxlab" x="${xAt(idx).toFixed(1)}" y="${H - 8}">${opts.formatX(points[idx]!.timestamp)}</text>`;
  }
  const uid = `pg${Math.round(points[0]!.value)}`;
  return `<svg class="pchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="price chart">
    <defs><linearGradient id="${uid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${opts.stroke}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${opts.stroke}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <polygon fill="url(#${uid})" points="${area}"/>
    <polyline fill="none" stroke="${opts.stroke}" stroke-width="2" stroke-linejoin="round" points="${line}"/>
    ${xlab}
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
