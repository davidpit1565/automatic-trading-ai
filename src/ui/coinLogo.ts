/**
 * Coin logos, presentation-only.
 *
 * Real marks come from `public/coins/<base>.svg` (CC0 set, synced by
 * `scripts/syncCoinIcons.mts`). That set covers every one of the top ten and
 * most established assets, but only about a sixth of Kraken's full EUR
 * universe — it predates most recent listings.
 *
 * Everything else gets a generated letter tile: the asset's initials on a
 * colour derived from its own code. Deliberately NOT a broken image or a
 * generic placeholder — across hundreds of long-tail markets the fallback is
 * the common case, so it has to look intentional. The colour is a pure
 * function of the code, so an asset keeps the same tile across reloads.
 */

import { COIN_LOGOS } from './coinLogoManifest';

/** Deterministic hue from an asset code — stable across sessions. */
export function hueFor(base: string): number {
  let hash = 0;
  for (let i = 0; i < base.length; i++) hash = (hash * 31 + base.charCodeAt(i)) % 360;
  return hash;
}

/** Up to four characters — enough to tell PEPE, PENGU and PENDLE apart. */
export function initialsFor(base: string): string {
  return base.slice(0, 4);
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The generated fallback tile for an asset with no bundled mark. */
export function letterTileHtml(base: string): string {
  const code = base.toUpperCase();
  return (
    `<span class="coin-logo coin-logo-tile" style="--coin-hue:${hueFor(code)}" aria-hidden="true">` +
    `${escapeAttribute(initialsFor(code))}</span>`
  );
}

/**
 * Markup for one coin logo. Emits an `<img>` only for assets we know have a
 * file, so no request is ever made for a mark that does not exist. The
 * `data-*` attributes let `attachCoinLogoFallback` rebuild the tile if the
 * image still fails (offline, cold cache) — carried as data rather than an
 * inline `onerror` so no inline script is needed.
 */
export function coinLogoHtml(base: string, baseUrl = ''): string {
  const code = base.toUpperCase();
  if (!COIN_LOGOS.has(code)) return letterTileHtml(code);
  const src = `${baseUrl}coins/${encodeURIComponent(code.toLowerCase())}.svg`;
  return (
    `<img class="coin-logo" src="${escapeAttribute(src)}" alt="" loading="lazy" decoding="async" ` +
    `data-coin="${escapeAttribute(code)}">`
  );
}

/**
 * Swap any logo that fails to load for its letter tile. Registered once on a
 * container: `error` events do not bubble, so this listens in the CAPTURE
 * phase, which is what makes one listener cover every row.
 */
export function attachCoinLogoFallback(container: HTMLElement): void {
  container.addEventListener(
    'error',
    (event) => {
      const img = event.target as HTMLElement | null;
      if (!(img instanceof HTMLImageElement) || !img.dataset['coin']) return;
      const tile = document.createElement('span');
      tile.className = 'coin-logo coin-logo-tile';
      tile.setAttribute('aria-hidden', 'true');
      tile.style.setProperty('--coin-hue', String(hueFor(img.dataset['coin'])));
      tile.textContent = initialsFor(img.dataset['coin']);
      img.replaceWith(tile);
    },
    true,
  );
}
