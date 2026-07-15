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
