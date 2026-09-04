/**
 * Stocks Market sub-page: the full curated stock universe (`BROWSABLE_STOCK_INSTRUMENTS`),
 * in the same row-list layout and style as the crypto Markets view (category
 * tabs, search + sort, logo + name + price + change + freshness dot). Prices
 * come from the `market-snapshot` field the stocks autopilot writes each
 * cycle (see `server/stocksRunner.mts`'s `updateMarketSnapshot`) — a periodic
 * snapshot, not a live tick, since Alpaca requires a secret key per request
 * and can never be called safely from the browser. For the same reason there
 * is no per-symbol chart here (unlike crypto's tap-to-chart): rows are
 * display-only. Symbols without a snapshot yet show a placeholder rather than
 * being hidden, so the full universe is always visible.
 */

import { fetchStocksState, type MarketSnapshotEntry } from '../cloudState';
import { BROWSABLE_STOCK_INSTRUMENTS, CURATED_STOCK_INSTRUMENTS } from '../../core/data/alpacaStocks';
import { attachCoinLogoFallback, coinLogoHtml } from '../coinLogo';
import { escapeHtml, formatMarketPrice, formatPct, tieredPriceHtml } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;
const STALE_AFTER_MS = 5 * 60_000;
/** The crypto Markets list marks its curated (actually-traded) majors with a
 * "TRADED" badge among the full browsable universe — this list had the same
 * curated-vs-browsable split (`CURATED_STOCK_INSTRUMENTS` vs
 * `BROWSABLE_STOCK_INSTRUMENTS`) but never surfaced it, so every row looked
 * equally "real" regardless of whether the stocks agent can actually trade it. */
const CURATED_STOCK_SYMBOLS = new Set(CURATED_STOCK_INSTRUMENTS.map((i) => i.symbol));
type SortKey = 'default' | 'name' | 'price' | 'change';
type CategoryKey = 'popular' | 'all' | 'gainers' | 'losers';

interface Row {
  readonly symbol: string;
  readonly snapshot: MarketSnapshotEntry | null;
}

const CATEGORIES: ReadonlyArray<{ key: CategoryKey; label: string }> = [
  { key: 'popular', label: 'Popular' },
  { key: 'all', label: 'All' },
  { key: 'gainers', label: 'Gainers' },
  { key: 'losers', label: 'Losers' },
];

function matches(row: Row, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === '' || row.symbol.toLowerCase().includes(needle);
}

function applyCategory(rows: readonly Row[], cat: CategoryKey): Row[] {
  switch (cat) {
    case 'popular':
      return rows.slice(0, 40);
    case 'gainers':
      return rows.filter((r) => (r.snapshot?.changePct ?? 0) > 0).sort((a, b) => (b.snapshot?.changePct ?? 0) - (a.snapshot?.changePct ?? 0));
    case 'losers':
      return rows.filter((r) => (r.snapshot?.changePct ?? 0) < 0).sort((a, b) => (a.snapshot?.changePct ?? 0) - (b.snapshot?.changePct ?? 0));
    case 'all':
    default:
      return [...rows];
  }
}

/**
 * 'default' is a deliberate no-op — it preserves whatever order
 * `applyCategory` already built (e.g. Gainers/Losers sorted by magnitude).
 * Without it, the initial sort selection would silently re-sort those tabs
 * back to alphabetical, hiding the biggest movers below smaller ones. Same
 * pattern as the crypto Markets view (see `marketFilters.ts`'s `SortKey`).
 */
function sortRows(rows: readonly Row[], key: SortKey): Row[] {
  const copy = [...rows];
  switch (key) {
    case 'price':
      return copy.sort((a, b) => (b.snapshot?.price ?? -Infinity) - (a.snapshot?.price ?? -Infinity));
    case 'change':
      return copy.sort((a, b) => (b.snapshot?.changePct ?? -Infinity) - (a.snapshot?.changePct ?? -Infinity));
    case 'name':
      return copy.sort((a, b) => a.symbol.localeCompare(b.symbol));
    case 'default':
    default:
      return copy;
  }
}

function rowHtml(r: Row): string {
  const snap = r.snapshot;
  const up = (snap?.changePct ?? 0) >= 0;
  const stale = !snap || Date.now() - snap.updatedAt > STALE_AFTER_MS;
  return (
    `<div class="market-row-wrap">` +
    `<div class="market-row">` +
    coinLogoHtml(r.symbol) +
    `<span class="market-row-id">` +
    `<span class="row-title">${escapeHtml(r.symbol)}</span>` +
    `<span class="row-sub"><span class="row-clock ${stale ? 'stale' : 'fresh'}" aria-hidden="true"></span>` +
    `${snap ? 'live' : 'no data yet'}` +
    `${CURATED_STOCK_SYMBOLS.has(r.symbol) ? '<span class="tag-traded">TRADED</span>' : ''}</span>` +
    `</span>` +
    `<span class="market-row-num">` +
    `<span class="row-price">${snap ? tieredPriceHtml(`$${formatMarketPrice(snap.price)}`) : '—'}</span>` +
    `${snap ? `<span class="chg ${up ? 'up' : 'down'}">${formatPct(snap.changePct)}</span>` : ''}` +
    `</span>` +
    `</div></div>`
  );
}

export function renderStocksMarketPanel(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <p class="view-sub">Every tracked US stock. Prices update once per agent cycle (market hours only), not live.</p>
    <div class="mk-tabs" id="sm-tabs" role="tablist">${CATEGORIES.map(
      (c, i) =>
        `<button class="mk-tab${i === 0 ? ' active' : ''}" role="tab" aria-selected="${i === 0}" data-cat="${c.key}">${c.label}</button>`,
    ).join('')}</div>
    <div class="mk-controls">
      <input id="sm-search" class="mk-search" type="search" inputmode="search"
        placeholder="Search stocks…" aria-label="Search stocks" autocomplete="off">
      <select id="sm-sort" class="mk-sort" aria-label="Sort stocks">
        <option value="default">Default</option>
        <option value="name">Name</option>
        <option value="change">Change</option>
        <option value="price">Price</option>
      </select>
    </div>
    <div class="stack" id="stocks-market-list"><div class="empty">Loading…</div></div>`;
  attachCoinLogoFallback(container);

  const tabsEl = container.querySelector<HTMLElement>('#sm-tabs')!;
  const searchEl = container.querySelector<HTMLInputElement>('#sm-search')!;
  const sortEl = container.querySelector<HTMLSelectElement>('#sm-sort')!;
  const list = container.querySelector<HTMLElement>('#stocks-market-list')!;

  const allRows: Row[] = BROWSABLE_STOCK_INSTRUMENTS.map((i) => ({ symbol: i.symbol, snapshot: null }));
  let query = '';
  let sortKey: SortKey = 'default';
  let category: CategoryKey = 'popular';

  function render(): void {
    const filtered = allRows.filter((r) => matches(r, query));
    const categorized = applyCategory(filtered, category);
    const rows = sortRows(categorized, sortKey);
    if (rows.length === 0) {
      list.innerHTML = '<div class="empty">No matching stocks.</div>';
      return;
    }
    list.innerHTML = rows.map(rowHtml).join('');
  }

  async function load(): Promise<void> {
    const state = await fetchStocksState();
    const bySymbol = new Map((state?.marketSnapshot ?? []).map((s) => [s.symbol, s]));
    for (let i = 0; i < allRows.length; i++) {
      const symbol = allRows[i]!.symbol;
      allRows[i] = { symbol, snapshot: bySymbol.get(symbol) ?? null };
    }
    render();
  }

  tabsEl.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cat]');
    if (!btn) return;
    category = btn.dataset['cat'] as CategoryKey;
    tabsEl.querySelectorAll<HTMLElement>('.mk-tab').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    render();
  });
  searchEl.addEventListener('input', () => {
    query = searchEl.value;
    render();
  });
  sortEl.addEventListener('change', () => {
    sortKey = sortEl.value as SortKey;
    render();
  });

  let timer = 0;
  render();
  void load();
  timer = window.setInterval(() => void load(), REFRESH_MS);

  return {
    pause: () => window.clearInterval(timer),
    resume: () => {
      void load();
      timer = window.setInterval(() => void load(), REFRESH_MS);
    },
  };
}
