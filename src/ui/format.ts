/** Presentation-only formatting helpers. No business logic. */

export function formatPrice(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (abs >= 1) return value.toFixed(2);
  return value.toPrecision(4);
}

/**
 * Splits a euro amount into a bold "major" part and a lighter, smaller
 * "minor" (cents) part — the big-integer-plus-small-decimal treatment used
 * for the hero balance, e.g. major "26" / minor ".85".
 */
export function formatPriceSplit(value: number): { major: string; minor: string } {
  const [major, minor = '00'] = value
    .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .split('.');
  return { major: major!, minor };
}

/**
 * Wraps an ALREADY-formatted price/amount string (from `formatPrice`,
 * `formatMarketPrice`, or a `${currency}${...}` template) so its decimal
 * portion renders smaller and dimmer — the two-tier currency typography
 * used everywhere in the reference (Revolut X never renders a price as one
 * flat string). Deliberately splits the STRING at its own last '.' rather
 * than reformatting the number: whatever precision the caller's formatter
 * already chose (adaptive per asset scale, or fixed 2dp for a EUR amount)
 * is exactly what's shown — this only restyles it, never changes it. A
 * string with no '.' (e.g. a whole-number BTC-scale price) passes through
 * unchanged, since there's no decimal portion to de-emphasize.
 */
export function tieredPriceHtml(formatted: string): string {
  const dotIndex = formatted.lastIndexOf('.');
  if (dotIndex === -1) return `<span class="tiered-price">${formatted}</span>`;
  return (
    `<span class="tiered-price">${formatted.slice(0, dotIndex)}` +
    `<span class="tiered-minor">${formatted.slice(dotIndex)}</span></span>`
  );
}

export function formatPct(value: number | null, digits = 2): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits);
}

export function signClass(value: number | null): string {
  if (value === null || value === 0) return '';
  return value > 0 ? 'positive' : 'negative';
}

/** Truncate to `max` chars, appending an ellipsis only when actually cut. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Price for the markets list. Unlike `formatPrice` this keeps cents on large
 * values (the reference market screens show 64,161.2, not 64,161) and never
 * falls back to exponential notation on sub-cent assets — `toPrecision` emits
 * "1.000e-7" below 1e-7, which is unreadable in a price column.
 */
export function formatMarketPrice(value: number, reference = value): string {
  if (!Number.isFinite(value)) return '—';
  // Precision follows `reference` (the price) rather than the value itself, so
  // a change renders at the same scale as the price it belongs to. Judging a
  // small change on its own magnitude gives absurd rows like a price of
  // €0.1372 next to a change of -0.008137.
  const scale = Math.abs(Number.isFinite(reference) ? reference : value);
  const abs = Math.abs(value);
  if (scale >= 1000) {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (scale >= 1) return value.toFixed(2);
  if (scale >= 0.01) return value.toFixed(4);
  if (abs === 0) return '0.00';
  // Sub-cent: fixed notation, trailing zeros trimmed so 0.00001230 reads 0.0000123.
  return value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Absolute change with an explicit sign, e.g. "+1,243.70" / "-0.0081". Pass the
 * price as `reference` so the change carries the same number of decimals.
 */
export function formatSignedPrice(value: number, reference = value): string {
  if (!Number.isFinite(value)) return '—';
  const body = formatMarketPrice(Math.abs(value), reference);
  return `${value >= 0 ? '+' : '-'}${body}`;
}

/** Clock label for a row's freshness stamp. */
export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
