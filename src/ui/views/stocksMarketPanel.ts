/**
 * Stocks Market sub-page: the full curated stock universe (`BROWSABLE_STOCK_INSTRUMENTS`),
 * with search and sort like the crypto Markets view. Prices come from the
 * `market-snapshot` field the stocks autopilot writes each cycle (see
 * `server/stocksRunner.mts`'s `updateMarketSnapshot`) — a periodic snapshot,
 * not a live tick, since Alpaca requires a secret key per request and can
 * never be called safely from the browser. Symbols without a snapshot yet
 * show a placeholder rather than being hidden, so the full universe is always
 * visible.
 */

import { fetchStocksState, type MarketSnapshotEntry } from '../cloudState';
import { BROWSABLE_STOCK_INSTRUMENTS } from '../../core/data/alpacaStocks';
import { formatPrice, formatPct } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;
type SortKey = 'name' | 'price' | 'change';

interface Row {
  readonly symbol: string;
  readonly snapshot: MarketSnapshotEntry | null;
}

function matches(row: Row, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === '' || row.symbol.toLowerCase().includes(needle);
}

function sortRows(rows: readonly Row[], key: SortKey): Row[] {
  const copy = [...rows];
  switch (key) {
    case 'price':
      return copy.sort((a, b) => (b.snapshot?.price ?? -Infinity) - (a.snapshot?.price ?? -Infinity));
    case 'change':
      return copy.sort((a, b) => (b.snapshot?.changePct ?? -Infinity) - (a.snapshot?.changePct ?? -Infinity));
    case 'name':
    default:
      return copy.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
}

export function renderStocksMarketPanel(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <p class="view-sub">Every tracked US stock. Prices update once per robot cycle (market hours only), not live.</p>
    <div class="mk-controls">
      <input id="sm-search" class="mk-search" type="search" inputmode="search"
        placeholder="Search stocks…" aria-label="Search stocks" autocomplete="off">
      <select id="sm-sort" class="mk-sort" aria-label="Sort stocks">
        <option value="name">Name</option>
        <option value="change">Change</option>
        <option value="price">Price</option>
      </select>
    </div>
    <div class="markets-strip" id="stocks-market-list"><div class="empty">Loading…</div></div>`;

  const searchEl = container.querySelector<HTMLInputElement>('#sm-search')!;
  const sortEl = container.querySelector<HTMLSelectElement>('#sm-sort')!;
  const list = container.querySelector<HTMLElement>('#stocks-market-list')!;

  const allRows: Row[] = BROWSABLE_STOCK_INSTRUMENTS.map((i) => ({ symbol: i.symbol, snapshot: null }));
  let query = '';
  let sortKey: SortKey = 'name';

  function render(): void {
    const filtered = allRows.filter((r) => matches(r, query));
    const rows = sortRows(filtered, sortKey);
    if (rows.length === 0) {
      list.innerHTML = '<div class="empty">No matching stocks.</div>';
      return;
    }
    list.innerHTML = '';
    for (const r of rows) {
      const card = document.createElement('div');
      card.className = 'market-card';
      if (!r.snapshot) {
        card.innerHTML = `
          <div class="market-top"><span class="market-name">${r.symbol}</span></div>
          <div class="market-price">—</div>`;
      } else {
        const up = r.snapshot.changePct >= 0;
        card.innerHTML = `
          <div class="market-top"><span class="market-name">${r.symbol}</span>
            <span class="chg ${up ? 'up' : 'down'}">${formatPct(r.snapshot.changePct)}</span></div>
          <div class="market-price">$${formatPrice(r.snapshot.price)}</div>`;
      }
      list.appendChild(card);
    }
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
