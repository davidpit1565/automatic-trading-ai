/**
 * Markets — browse the largest cryptos. The list shows live price, window
 * change and a sparkline; tap any coin (Bitcoin first) to open a detail view
 * with a real, interactive chart (value axis + time axis, crosshair + tooltip,
 * a live current-price marker), a timeframe selector (1D default → All time),
 * and prev/next browsing. Prices are in EUR.
 */

import type { ActiveDataSource } from '../dataSource';
import type { Timeframe } from '../../core/types';
import type { OrderBook, RecentTrade } from '../../core/data/krakenPublic';
import { CURATED_BASES } from '../../core/data/krakenPublic';
import {
  fetchMarketRows,
  fetchSeries,
  fetchCandleSeries,
  type MarketRow,
  type CandleSeries,
  type PriceSeries,
} from '../markets';
import {
  priceChartSvg,
  candleChartSvg,
  chartGeometry,
  candleGeometry,
  positionChartTip,
  type ChartGeometry,
} from '../charts';
import { startLivePrice } from '../liveTicker';
import { escapeHtml, formatClock, formatMarketPrice, formatPct, formatPrice, formatSignedPrice } from '../format';
import { attachCoinLogoFallback, coinLogoHtml } from '../coinLogo';
import { fetchCloudState } from '../cloudState';
import { fetchCoinStats } from '../coinStats';
import { SORT_OPTIONS, searchRows, sortRows, topGainers, topLosers, Watchlist, type SortKey } from '../marketFilters';
import { LocalStorageStore } from '../../core/data/storage';
import type { ViewHandle } from '../viewLifecycle';

/** Kraken-only capabilities (order book + recent trades) — not part of the
 * shared `MarketDataSource` interface since a synthetic/demo/Alpaca source
 * has nothing real to answer with. Detected at the call site instead. */
interface OrderBookCapable {
  getOrderBook(symbol: string, count?: number): Promise<{ ok: true; value: OrderBook } | { ok: false; error: string }>;
  getRecentTrades(symbol: string, count?: number): Promise<{ ok: true; value: RecentTrade[] } | { ok: false; error: string }>;
}

/** Compact number for market cap / supply figures — 1.3T, 21M, 900K. */
function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

const REFRESH_MS = 20_000;
/**
 * The Markets LIST refreshes through KrakenPublicSource's serialized queue
 * (150ms stagger) — at 20s the requests stacked faster than they drained and
 * the detail chart (same queue) went sluggish. 60s lets each sweep finish.
 */
const LIST_REFRESH_MS = 60_000;
/**
 * FALLBACK cap only. The list normally comes from one batch-ticker request
 * covering every EUR market (535 in ~80ms, measured live), so no cap applies.
 * A source without a batch ticker degrades to the old per-symbol sweep, which
 * walks the serialized queue one request at a time — at ~200-700ms each, an
 * uncapped sweep would take minutes and reintroduce the freeze that queue was
 * built to fix. 60 coins clears well inside the 60s refresh cadence.
 */
const MARKETS_LIST_CAP = 60;
/** Rows added per scroll page — see `visibleCount` in the view. */
const PAGE_SIZE = 50;
/** A row is stale (amber clock) once its data is older than this. */
const STALE_AFTER_MS = 5 * 60_000;
const HOT = 'var(--hot)';
const COLD = 'var(--cold)';
/** Vite's deploy base — GitHub Pages serves from /<repo>/, so logo URLs need it. */
const BASE_URL = import.meta.env.BASE_URL;

/**
 * Category tabs. Each is a pure view over the same single batch-ticker
 * response — switching is instant and costs no extra request, which is the
 * whole reason the batch endpoint was worth moving to.
 */
interface Category {
  readonly key: string;
  readonly label: string;
  readonly apply: (rows: readonly MarketRow[]) => MarketRow[];
}
const CATEGORIES: Category[] = [
  { key: 'popular', label: 'Popular', apply: (rows) => rows.slice(0, 40) },
  { key: 'all', label: 'All', apply: (rows) => [...rows] },
  { key: 'gainers', label: 'Gainers', apply: (rows) => topGainers(rows) },
  { key: 'losers', label: 'Losers', apply: (rows) => topLosers(rows) },
  {
    key: 'volume',
    label: 'Volume',
    apply: (rows) => [...rows].sort((a, b) => b.quoteVolume - a.quoteVolume),
  },
];

let pendingCategoryKey: string | null = null;
/**
 * Lets another view (Home's "Top movers" preview) open the Markets list
 * already scoped to a category, instead of always landing on Popular.
 * Consumed (and cleared) once by the next `renderMarketsView` mount — set
 * this right before triggering the `[data-nav="markets"]` navigation.
 */
export function openMarketsAt(key: string): void {
  pendingCategoryKey = key;
}

interface Range {
  readonly key: string;
  readonly tf: Timeframe;
  readonly limit: number;
  readonly fx: (ts: number) => string;
  /** Long ranges render a smooth line/area (candles at 300+ bars are unreadable
   * on a phone). Short ranges keep the Candles/Line toggle. */
  readonly long?: boolean;
}
const RANGES: Range[] = [
  { key: '1D', tf: '15m', limit: 96, fx: (t) => hm(t) },
  { key: '1W', tf: '1h', limit: 168, fx: (t) => dm(t) },
  { key: '1M', tf: '4h', limit: 180, fx: (t) => dm(t) },
  { key: '1Y', tf: '1d', limit: 365, fx: (t) => mon(t), long: true },
  { key: '5Y', tf: '1w', limit: 260, fx: (t) => yr(t), long: true },
  { key: '10Y', tf: '1w', limit: 520, fx: (t) => yr(t), long: true },
  { key: 'All', tf: '1w', limit: 720, fx: (t) => yr(t), long: true },
];
const INTRADAY: ReadonlySet<Timeframe> = new Set<Timeframe>(['1m', '5m', '15m', '30m', '1h', '4h']);
const hm = (t: number): string => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dm = (t: number): string => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
const mon = (t: number): string => new Date(t).toLocaleDateString('en-GB', { month: 'short' });
const yr = (t: number): string => String(new Date(t).getFullYear());

/**
 * Placeholder rows for the first load. Shaped like real rows so the list does
 * not jump when the data lands — a plain "Loading…" line collapses the layout
 * and then shoves it back down.
 */
function skeletonRows(count: number): string {
  return Array.from(
    { length: count },
    () =>
      '<div class="skeleton-row" aria-hidden="true">' +
      '<span class="skeleton-dot"></span>' +
      '<span class="market-row-id"><span class="skeleton-bar w-40"></span>' +
      '<span class="skeleton-bar w-60"></span></span>' +
      '<span class="market-row-num"><span class="skeleton-bar w-70"></span>' +
      '<span class="skeleton-bar w-50"></span></span></div>',
  ).join('');
}

/** Drag distance (px) past the top that commits to a refresh. */
const PULL_THRESHOLD = 70;

/** Full stamp for the crosshair tooltip (adds time on intraday ranges). */
function tipStamp(ts: number, tf: Timeframe): string {
  const d = new Date(ts);
  return INTRADAY.has(tf)
    ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

type ViewMode = 'chart' | 'table' | 'depth' | 'trades' | 'trade';
const VIEW_TABS: ReadonlyArray<{ readonly key: ViewMode; readonly label: string; readonly icon: string }> = [
  { key: 'chart', label: 'Chart', icon: '<path d="M3 17l4-5 4 3 5-7 5 4"/>' },
  { key: 'table', label: 'Order book', icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 12h17M12 3.5v17"/>' },
  { key: 'depth', label: 'Depth', icon: '<path d="M3 20V9l5-5 4 4 4-4 5 5v11z"/>' },
  { key: 'trades', label: 'Trades', icon: '<path d="M4 6h16M4 12h16M4 18h10"/>' },
  { key: 'trade', label: 'Trade', icon: '<path d="M7 4l-4 4 4 4"/><path d="M3 8h13"/><path d="M17 20l4-4-4-4"/><path d="M21 16H8"/>' },
];

/** Shared across every view mode (chart/table/depth/trades/trade): coin
 * identity, live price + change, and 24h stats already carried by
 * `MarketRow` — no extra fetch. `rows`/`currentIndex` back the pair-switcher
 * menu (David asked for a "BTC-EUR ▾"-style selector like Revolut X's Trade
 * page, so switching pairs doesn't mean going back to the list) — scoped to
 * whatever category the user was already browsing (`detailRows`), not the
 * full multi-hundred-market universe. */
function detailHeaderHtml(
  m: MarketRow,
  price: number,
  changePct: number,
  viewMode: ViewMode,
  starred: boolean,
  rows: readonly MarketRow[],
  currentIndex: number,
): string {
  const up = changePct >= 0;
  const tabs = VIEW_TABS.map(
    (t) =>
      `<button class="view-tab ${t.key === viewMode ? 'active' : ''}" data-view="${t.key}" aria-label="${t.label}">` +
      `<svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg></button>`,
  ).join('');
  const menuItems = rows
    .map(
      (r, i) =>
        `<button class="pair-menu-item ${i === currentIndex ? 'active' : ''}" data-idx="${i}" role="option" aria-selected="${i === currentIndex}">` +
        `${coinLogoHtml(r.base, BASE_URL)}<span class="row-title">${escapeHtml(r.label)}</span><span class="row-sub">${escapeHtml(r.symbol)}</span></button>`,
    )
    .join('');
  return `
    <div class="detail-head">
      <div class="detail-head-left">
        <button class="icon-btn" id="mk-back" aria-label="Back to all markets">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <div class="detail-coin">${coinLogoHtml(m.base, BASE_URL)}<div>
          <button class="detail-name-btn" id="mk-pair-toggle" aria-haspopup="listbox" aria-expanded="false">
            <span class="detail-name">${m.label}</span>
            <svg class="pair-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="row-sub">${m.symbol} · EUR</div>
        </div></div>
      </div>
      <button class="star-btn ${starred ? 'active' : ''}" id="mk-star" aria-label="Watch this market">★</button>
    </div>
    <div class="pair-menu" id="mk-pair-menu" role="listbox" hidden>${menuItems}</div>
    <div class="detail-price-row">
      <div class="row-title big" id="mk-price">€${formatPrice(price)}</div>
      <div class="chg ${up ? 'up' : 'down'}" id="mk-change">${formatPct(changePct)}</div>
    </div>
    <div class="detail-stats-row">
      <div class="dstat"><span class="dstat-label">24h High</span><span class="dstat-value">€${formatPrice(m.high)}</span></div>
      <div class="dstat"><span class="dstat-label">24h Low</span><span class="dstat-value">€${formatPrice(m.low)}</span></div>
      <div class="dstat"><span class="dstat-label">24h Volume</span><span class="dstat-value">€${compact(m.quoteVolume)}</span></div>
    </div>
    <div class="view-tabs" id="mk-view-tabs">${tabs}</div>`;
}

/** The Trade tab: visually mirrors Revolut X's order form (Buy/Sell,
 * amount/price fields) so the page shows what David asked for — but every
 * field is inert. Real orders already go through the cloud agent's own
 * safety checks (confidence gates, risk sizing, a Telegram confirmation
 * prompt) via `/buy`/`/sell`; a direct submit button here would bypass all
 * of that, so this deliberately only points at the real path instead of
 * faking one. */
function orderFormHtml(m: MarketRow): string {
  return `
    <div class="order-form">
      <div class="of-toggle">
        <button class="of-btn buy active" disabled>Buy</button>
        <button class="of-btn sell" disabled>Sell</button>
      </div>
      <div class="of-field"><label>Amount</label><div class="of-input"><span>0</span><span class="of-unit">${escapeHtml(m.base)}</span></div></div>
      <div class="of-field"><label>Price</label><div class="of-input"><span>€${formatPrice(m.price)}</span></div></div>
      <p class="of-note">This mirrors Revolut X's order form for reference, but there's no direct submit here — every real order already goes through the cloud agent's own safety checks (confidence gates, risk sizing, a Telegram confirmation prompt). Send <code>/buy ${escapeHtml(m.symbol)}</code> or <code>/sell ${escapeHtml(m.symbol)}</code> to the Telegram bot to actually place one.</p>
    </div>`;
}

/** Closed-orders + Stats skeleton — identical markup regardless of view
 * mode; `attachExtras` fills it in once per detail-open. */
const EXTRAS_HTML = `
    <div class="block"><div class="block-head"><h2>Closed orders</h2></div><div class="stack stack-card" id="mk-orders"><div class="empty">Loading…</div></div></div>
    <div class="block" id="mk-stats"></div>`;

/** One of the agent's own past trades on this market — same row shape as
 * the History view, just filtered to one symbol. */
function tradeRowHtml(m: MarketRow, t: { kind: 'buy' | 'sell'; price: number; quantity: number; at: number; note: string | null }): string {
  const buy = t.kind === 'buy';
  return (
    `<div class="row trade ${t.kind}"><div class="row-main"><span class="pill ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span>` +
    `<div><div class="row-title">${m.label}</div><div class="row-sub">${t.note ? t.note : buy ? 'opened' : 'closed'}</div></div></div>` +
    `<div class="row-side"><span class="row-title">€${formatPrice(t.price)}</span>` +
    `<span class="row-sub">${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>` +
    `<span class="row-sub">${new Date(t.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div></div>`
  );
}

/** CoinGecko market-cap section, or an honest "not available" — never a
 * fabricated number for a symbol this build doesn't have mapped. */
function statsSectionHtml(stats: Awaited<ReturnType<typeof fetchCoinStats>>): string {
  const head = '<div class="block-head"><h2>Stats</h2></div>';
  if (!stats) return `${head}<div class="empty">Not available for this market.</div>`;
  const rows = [
    `<div class="row"><span class="row-sub">Market cap</span><span class="row-title">€${compact(stats.marketCap)}</span></div>`,
    stats.marketCapRank !== null
      ? `<div class="row"><span class="row-sub">Market cap rank</span><span class="row-title">#${stats.marketCapRank}</span></div>`
      : '',
    stats.circulatingSupply !== null
      ? `<div class="row"><span class="row-sub">Circulating supply</span><span class="row-title">${compact(stats.circulatingSupply)}</span></div>`
      : '',
    `<div class="row"><span class="row-sub">Max supply</span><span class="row-title">${stats.maxSupply !== null ? compact(stats.maxSupply) : 'No max'}</span></div>`,
  ];
  return head + rows.join('');
}

/** Numeric bid/ask ladder — the Table view mode. */
function orderBookTableHtml(book: OrderBook): string {
  if (book.bids.length === 0 && book.asks.length === 0) return '<div class="empty">No order book depth right now.</div>';
  const rows = Math.max(book.bids.length, book.asks.length);
  let html = '<div class="orderbook-table"><div class="orderbook-head"><span>Bid</span><span>Ask</span></div>';
  for (let i = 0; i < rows; i++) {
    const bid = book.bids[i];
    const ask = book.asks[i];
    html +=
      '<div class="orderbook-row">' +
      `<span class="ob-bid">${bid ? `${bid.volume.toFixed(4)} @ €${formatPrice(bid.price)}` : ''}</span>` +
      `<span class="ob-ask">${ask ? `€${formatPrice(ask.price)} @ ${ask.volume.toFixed(4)}` : ''}</span>` +
      '</div>';
  }
  return `${html}</div>`;
}

/** Cumulative depth as a two-sided step chart — the Depth view mode. */
function orderBookDepthHtml(book: OrderBook): string {
  if (book.bids.length === 0 && book.asks.length === 0) return '<div class="empty">No order book depth right now.</div>';
  const W = 320;
  const H = 160;
  const bids = [...book.bids].sort((a, b) => b.price - a.price);
  const asks = [...book.asks].sort((a, b) => a.price - b.price);
  let cumBid = 0;
  const bidPoints = bids.map((l) => ({ price: l.price, cum: (cumBid += l.volume) }));
  let cumAsk = 0;
  const askPoints = asks.map((l) => ({ price: l.price, cum: (cumAsk += l.volume) }));
  const maxCum = Math.max(cumBid, cumAsk, 1e-9);
  const mid = W / 2;
  const bidPath = bidPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(mid - (i / Math.max(bidPoints.length - 1, 1)) * mid).toFixed(1)} ${(H - (p.cum / maxCum) * H).toFixed(1)}`)
    .join(' ');
  const askPath = askPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(mid + (i / Math.max(askPoints.length - 1, 1)) * mid).toFixed(1)} ${(H - (p.cum / maxCum) * H).toFixed(1)}`)
    .join(' ');
  return (
    `<svg class="orderbook-depth" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
    `<path d="${bidPath} L ${mid} ${H} Z" class="depth-bid"/>` +
    `<path d="${askPath} L ${mid} ${H} Z" class="depth-ask"/>` +
    `<line x1="${mid}" y1="0" x2="${mid}" y2="${H}" class="depth-mid"/>` +
    `</svg>`
  );
}

/** Recent public trades, newest first — the Trades (list) view mode. */
function tradesListHtml(trades: RecentTrade[]): string {
  if (trades.length === 0) return '<div class="empty">No recent trades.</div>';
  return trades
    .slice(0, 30)
    .map(
      (t) =>
        `<div class="row"><span class="chg ${t.side === 'buy' ? 'up' : 'down'}">€${formatPrice(t.price)}</span>` +
        `<span class="row-sub">${t.volume.toFixed(5)}</span>` +
        `<span class="row-sub">${formatClock(t.time)}</span></div>`,
    )
    .join('');
}

export function renderMarketsView(container: HTMLElement, data: ActiveDataSource): ViewHandle {
  const requestedKey = pendingCategoryKey;
  pendingCategoryKey = null;
  const requestedIndex = requestedKey ? CATEGORIES.findIndex((c) => c.key === requestedKey) : -1;
  const initialIndex = requestedIndex >= 0 ? requestedIndex : 0;

  container.innerHTML = `
    <div id="mk-list-view">
      <h2 class="view-title">Markets</h2>
      <p class="view-sub">Every EUR market on Kraken, live. Tap a coin for its chart.</p>
      <div class="mk-tabs" id="mk-tabs" role="tablist">${CATEGORIES.map(
        (c, i) =>
          `<button class="mk-tab${i === initialIndex ? ' active' : ''}" role="tab" ` +
          `aria-selected="${i === initialIndex}" data-cat="${c.key}">${c.label}</button>`,
      ).join('')}<button class="mk-tab" role="tab" aria-selected="false" data-cat="watchlist">★ Watchlist</button></div>
      <div class="mk-controls">
        <input id="mk-search" class="mk-search" type="search" inputmode="search"
          placeholder="Search 500+ markets…" aria-label="Search markets" autocomplete="off">
        <select id="mk-sort" class="mk-sort" aria-label="Sort markets">${SORT_OPTIONS.map(
          (o) => `<option value="${o.key}">${o.label}</option>`,
        ).join('')}</select>
      </div>
      <div class="mk-pull" id="mk-pull" aria-live="polite"></div>
      <div class="stack" id="mk-list">${skeletonRows(8)}</div>
      <p class="muted-line" id="mk-status"></p>
    </div>
    <div id="mk-detail-view" hidden></div>`;

  const listView = container.querySelector<HTMLElement>('#mk-list-view')!;
  const detailView = container.querySelector<HTMLElement>('#mk-detail-view')!;
  const list = container.querySelector<HTMLElement>('#mk-list')!;
  const status = container.querySelector<HTMLElement>('#mk-status')!;

  let markets: MarketRow[] = [];
  /** Category + search + sort applied to `markets` — what the list shows. */
  let view: MarketRow[] = [];
  let category: Category = CATEGORIES[initialIndex]!;
  let query = '';
  let sortKey: SortKey = 'default';
  /** null until the Watchlist tab is first used — nothing touches storage before then. */
  let watchlist: Watchlist | null = null;
  let showingWatchlist = false;
  const getWatchlist = (): Watchlist => (watchlist ??= new Watchlist(new LocalStorageStore()));
  /**
   * Snapshot of `view` taken when a detail opens. The detail's prev/next pages
   * through THIS, not the live list: categories like Gainers reorder on every
   * refresh, and navigating a list that reshuffles underneath you sends "Next"
   * somewhere arbitrary.
   */
  let detailRows: MarketRow[] = [];
  /**
   * Rows currently in the DOM. The full EUR universe is ~535 markets; building
   * all of them up front is wasted work on a phone when only a handful are on
   * screen. Grows a page at a time as the user reaches the bottom, and is
   * preserved across the background refresh so the list never jumps under a
   * scrolling finger.
   */
  let visibleCount = PAGE_SIZE;
  let moreObserver: IntersectionObserver | null = null;
  /** Last price rendered per symbol, so a refresh can flash only what moved. */
  const shownPrices = new Map<string, number>();
  /** True until the first successful load, so the skeleton shows only once. */
  let firstLoad = true;
  let listTimer = 0;
  let detailTimer = 0;
  let stopLive: (() => void) | null = null;
  // Tracks which coin's detail is open (null = list view) so pause/resume can
  // restart whichever was showing, instead of always falling back to the list.
  let openCoinIndex: number | null = null;
  // Bumped by every openDetail()/backToList() call. A paint() in flight when
  // the user switches coins (or backs out) checks this before writing to the
  // shared detailView — without it, a slow fetch for a coin the user has
  // already left resolves later and silently overwrites whatever is now on
  // screen with the wrong coin's chart/price/live-ticker.
  let detailGeneration = 0;
  // The range/chart-mode the user last chose, so resume() (view pause while
  // a detail is open, then coming back) reopens on the same view instead of
  // silently resetting to 1D/Candle. A genuinely fresh tap from the list
  // still starts at the defaults, same as before.
  let savedRangeKey = '1D';
  let savedChartMode: 'candle' | 'line' = 'candle';
  let savedViewMode: ViewMode = 'chart';

  const stopLivePrice = (): void => {
    if (stopLive) {
      stopLive();
      stopLive = null;
    }
  };

  /** One market row: logo + identity on the left, price and change on the right. */
  function rowHtml(m: MarketRow, index: number): string {
    const up = m.changePct >= 0;
    const stale = Date.now() - m.updatedAt > STALE_AFTER_MS;
    // Only consult the watchlist once it exists — an untouched watchlist must
    // not force a storage read on every one of hundreds of rows.
    const starred = watchlist !== null && watchlist.has(m.symbol);
    // Flash the price when it actually moved since the last render. The class
    // rides on freshly-created markup, so the CSS animation plays once per
    // change on its own — no timers to schedule or clean up.
    const previous = shownPrices.get(m.symbol);
    const flash =
      previous === undefined || previous === m.price ? '' : m.price > previous ? ' flash-up' : ' flash-down';
    shownPrices.set(m.symbol, m.price);
    return (
      `<span class="market-row-wrap">` +
      `<button class="market-row tappable" data-row="${index}">` +
      coinLogoHtml(m.base, BASE_URL) +
      `<span class="market-row-id">` +
      `<span class="row-title-line"><span class="row-title">${escapeHtml(m.label)}</span>${CURATED_BASES.has(m.base) ? '<span class="tag-traded">TRADED</span>' : ''}</span>` +
      `<span class="row-sub"><span class="row-clock ${stale ? 'stale' : 'fresh'}" aria-hidden="true"></span>` +
      `${formatClock(m.updatedAt)} · ${escapeHtml(m.symbol)}</span>` +
      `</span>` +
      `<span class="market-row-vol"><span class="dstat-label">24h Vol</span><span>€${compact(m.quoteVolume)}</span></span>` +
      `<span class="market-row-num">` +
      `<span class="row-price${flash}">€${formatMarketPrice(m.price)}</span>` +
      `<span class="chg ${up ? 'up' : 'down'}">${formatSignedPrice(m.change, m.price)} (${formatPct(m.changePct)})</span>` +
      `</span>` +
      `</button>` +
      // Sibling, not a child: a <button> inside a <button> is invalid HTML and
      // the inner one's clicks are unreliable across browsers.
      `<button class="mk-star${starred ? ' on' : ''}" data-star="${escapeHtml(m.symbol)}" ` +
      `aria-pressed="${starred}" aria-label="${starred ? 'Remove' : 'Add'} ${escapeHtml(m.label)} ` +
      `${starred ? 'from' : 'to'} watchlist">★</button>` +
      `</span>`
    );
  }

  /** Observe the "load more" sentinel so the next page builds as it scrolls in. */
  function observeMore(): void {
    moreObserver?.disconnect();
    moreObserver = null;
    const sentinel = list.querySelector('#mk-more');
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    moreObserver = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      // Bounded by the FILTERED list, which is what is actually rendered —
      // growing against `markets` would inflate the counter past the end of a
      // narrow category like Gainers.
      visibleCount = Math.min(visibleCount + PAGE_SIZE, view.length);
      renderList();
    }, { rootMargin: '400px' });
    moreObserver.observe(sentinel);
  }

  function renderList(): void {
    if (markets.length === 0) {
      list.innerHTML = '<div class="empty">Live market data is unavailable right now.</div>';
      return;
    }
    // Each a pure pass over rows already in memory, so none of this costs a
    // request. A search deliberately escapes the active category and covers the
    // WHOLE universe: "Popular" holds 40 of 535 markets, so searching inside it
    // would silently fail to find most of what the user types. Within the
    // watchlist a search does stay scoped — there, narrowing is the intent.
    const searching = query.trim() !== '';
    const scoped = showingWatchlist
      ? getWatchlist().filter(markets)
      : searching
        ? markets
        : category.apply(markets);
    view = sortRows(searchRows(scoped, query), sortKey);
    if (view.length === 0) {
      const reason = query.trim() !== ''
        ? `No markets match “${escapeHtml(query.trim())}”.`
        : showingWatchlist
          ? 'No starred markets yet. Tap ★ on any market to add it here.'
          : `No markets in ${category.label} right now.`;
      list.innerHTML = `<div class="empty">${reason}</div>`;
      status.textContent = `Live · ${markets.length} markets · updated ${hm(Date.now())}`;
      return;
    }
    // Re-rendering the SAME number of rows keeps the list's height identical,
    // so the browser holds the scroll position across a background refresh.
    const shown = Math.min(visibleCount, view.length);
    const rows = view.slice(0, shown).map(rowHtml).join('');
    const more =
      shown < view.length
        ? `<div id="mk-more" class="market-more">Loading more markets… (${shown} of ${view.length})</div>`
        : `<div class="market-more muted-line">All ${view.length} markets shown</div>`;
    list.innerHTML = rows + more;
    observeMore();
    status.textContent =
      `Live · ${view.length} of ${markets.length} EUR markets · updated ${hm(Date.now())} · ` +
      `change since 00:00 UTC`;
  }

  let listLoading = false;
  async function loadList(): Promise<void> {
    if (listLoading) return; // never overlap sweeps — overlaps stack the queue
    listLoading = true;
    try {
      const fresh = await fetchMarketRows(data, MARKETS_LIST_CAP);
      if (fresh.length > 0) {
        markets = fresh; // keep last good list on a bad sweep
        firstLoad = false;
      } else if (firstLoad) {
        // Nothing yet and nothing cached — say so instead of showing skeletons
        // forever, which reads as a hang.
        list.innerHTML = '<div class="empty">Live market data is unavailable right now.</div>';
        return;
      }
      if (detailView.hidden) renderList();
    } finally {
      listLoading = false;
    }
  }

  /**
   * Pull-to-refresh. Only arms at the very top of the scroller and only for a
   * downward drag, so it never competes with normal scrolling or with the
   * horizontal swipe on the category tabs.
   */
  function attachPullToRefresh(): void {
    const indicator = container.querySelector<HTMLElement>('#mk-pull')!;
    const scroller = (): HTMLElement | null => listView.closest<HTMLElement>('.content');
    let startY: number | null = null;
    let pulled = 0;

    listView.addEventListener(
      'touchstart',
      (event) => {
        const top = scroller()?.scrollTop ?? 0;
        startY = top <= 0 && event.touches.length === 1 ? (event.touches[0]?.clientY ?? null) : null;
        pulled = 0;
      },
      { passive: true },
    );

    listView.addEventListener(
      'touchmove',
      (event) => {
        if (startY === null) return;
        pulled = (event.touches[0]?.clientY ?? startY) - startY;
        if (pulled <= 0) {
          indicator.textContent = '';
          return;
        }
        indicator.textContent = pulled >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
      },
      { passive: true },
    );

    listView.addEventListener('touchend', () => {
      const trigger = startY !== null && pulled >= PULL_THRESHOLD;
      startY = null;
      pulled = 0;
      if (!trigger) {
        indicator.textContent = '';
        return;
      }
      indicator.textContent = 'Refreshing…';
      void loadList().finally(() => {
        indicator.textContent = '';
      });
    });
  }
  attachPullToRefresh();

  function openDetail(index: number, opts: { preserveRange?: boolean } = {}): void {
    // Freeze the ordering the user was looking at, so prev/next stays coherent
    // even as a refresh reshuffles a category like Gainers underneath.
    if (!opts.preserveRange || detailRows.length === 0) detailRows = view.length > 0 ? [...view] : [...markets];
    openCoinIndex = index;
    detailGeneration++;
    const myGeneration = detailGeneration;
    window.clearInterval(listTimer);
    listView.hidden = true;
    detailView.hidden = false;
    let coin = index;
    // Candles by default; the choice persists across range/coin changes while
    // this detail stays open. `resume()` asks to preserve the last choice
    // instead (see `savedRangeKey`/`savedChartMode`); a fresh tap from the
    // list always starts at the defaults.
    let rangeKey = opts.preserveRange ? savedRangeKey : '1D';
    let chartMode: 'candle' | 'line' = opts.preserveRange ? savedChartMode : 'candle';
    let viewMode: ViewMode = opts.preserveRange ? savedViewMode : 'chart';
    savedRangeKey = rangeKey;
    savedChartMode = chartMode;
    savedViewMode = viewMode;
    // Monotonic paint id: only the newest paint renders. Prevents an overlap
    // between the 20s auto-refresh and a slow fetch from freezing the chart.
    let paintSeq = 0;
    // Per-open-detail series cache keyed by coin:range:mode. Switching ranges or
    // coins (and back) is INSTANT — no refetch. The 20s timer force-refreshes
    // only the currently open range, updating its cache entry.
    const seriesCache = new Map<string, CandleSeries | PriceSeries | null>();

    /** Back/prev/next/star/view-tab wiring — identical regardless of which
     * view mode just rendered, so every render path calls this once. */
    const wireCommonControls = (m: MarketRow): void => {
      detailView.querySelector('#mk-back')?.addEventListener('click', backToList);
      detailView.querySelector('#mk-prev')?.addEventListener('click', () => {
        if (coin > 0) {
          coin--;
          rangeKey = '1D';
          savedRangeKey = rangeKey;
          void paint();
        }
      });
      detailView.querySelector('#mk-next')?.addEventListener('click', () => {
        if (coin < detailRows.length - 1) {
          coin++;
          rangeKey = '1D';
          savedRangeKey = rangeKey;
          void paint();
        }
      });
      detailView.querySelector('#mk-star')?.addEventListener('click', () => {
        const nowStarred = getWatchlist().toggle(m.symbol);
        detailView.querySelector('#mk-star')?.classList.toggle('active', nowStarred);
      });
      const pairToggle = detailView.querySelector<HTMLButtonElement>('#mk-pair-toggle');
      const pairMenu = detailView.querySelector<HTMLElement>('#mk-pair-menu');
      pairToggle?.addEventListener('click', () => {
        if (!pairMenu) return;
        pairMenu.hidden = !pairMenu.hidden;
        pairToggle.setAttribute('aria-expanded', String(!pairMenu.hidden));
      });
      pairMenu?.addEventListener('click', (event) => {
        const item = (event.target as HTMLElement).closest<HTMLButtonElement>('.pair-menu-item');
        if (!item) return;
        const idx = Number(item.dataset['idx']);
        pairMenu.hidden = true;
        if (!Number.isInteger(idx) || idx === coin || idx < 0 || idx >= detailRows.length) return;
        coin = idx;
        rangeKey = '1D';
        savedRangeKey = rangeKey;
        void paint();
      });
      detailView.querySelectorAll<HTMLButtonElement>('.view-tab').forEach((b) => {
        b.addEventListener('click', () => {
          const next = b.dataset['view'] as ViewMode;
          if (next === viewMode) return;
          viewMode = next;
          savedViewMode = next;
          void paint();
        });
      });
    };

    /** Closed orders (our own trade history, filtered to this symbol) and
     * Stats (CoinGecko market cap/supply) — identical across view modes and
     * ranges, so this is the one thing every render path shares verbatim.
     * Two independent, unrelated fetches: awaited separately so a slow or
     * hung cloud-state lookup can never hold up the (unrelated) CoinGecko
     * stats from rendering, or vice versa. */
    const attachExtras = (m: MarketRow): void => {
      const myGeneration = detailGeneration;
      void fetchCloudState().then((state) => {
        if (myGeneration !== detailGeneration) return; // left this coin/detail while fetching
        const ordersEl = detailView.querySelector<HTMLElement>('#mk-orders');
        if (!ordersEl) return;
        const trades = (state?.history ?? []).filter((t) => t.symbol === m.symbol);
        ordersEl.innerHTML =
          trades.length === 0
            ? '<div class="empty">No closed orders yet for this market.</div>'
            : trades.slice(0, 10).map((t) => tradeRowHtml(m, t)).join('');
      });
      void fetchCoinStats(m.base).then((stats) => {
        if (myGeneration !== detailGeneration) return;
        const statsEl = detailView.querySelector<HTMLElement>('#mk-stats');
        if (statsEl) statsEl.innerHTML = statsSectionHtml(stats);
      });
    };

    /** Order book (table or depth chart) and recent-trades view modes —
     * fully separate from the candle/line chart machinery below: no range
     * bar, no crosshair, no live-price wiring, just a snapshot fetch. */
    const paintNonChart = async (m: MarketRow, seq: number): Promise<void> => {
      const src = data.source as unknown as Partial<OrderBookCapable>;
      const supportsBook = typeof src.getOrderBook === 'function' && typeof src.getRecentTrades === 'function';
      let body: string;
      if (viewMode === 'trade') {
        body = orderFormHtml(m);
      } else if (!supportsBook) {
        body = '<div class="empty">Not available for this market data source.</div>';
      } else if (viewMode === 'trades') {
        const result = await src.getRecentTrades!(m.symbol, 30);
        if (seq !== paintSeq || myGeneration !== detailGeneration) return;
        body = result.ok ? tradesListHtml(result.value) : '<div class="empty">Recent trades unavailable — retrying…</div>';
      } else {
        const result = await src.getOrderBook!(m.symbol, 15);
        if (seq !== paintSeq || myGeneration !== detailGeneration) return;
        body = result.ok
          ? viewMode === 'table'
            ? orderBookTableHtml(result.value)
            : orderBookDepthHtml(result.value)
          : '<div class="empty">Order book unavailable — retrying…</div>';
      }
      if (seq !== paintSeq || myGeneration !== detailGeneration) return;

      detailView.innerHTML =
        detailHeaderHtml(m, m.price, m.changePct, viewMode, getWatchlist().has(m.symbol), detailRows, coin) +
        `<div class="detail-nonchart">${body}</div>` +
        `<div class="detail-nav">` +
        `<button class="pager" id="mk-prev" ${coin === 0 ? 'disabled' : ''}>‹ Prev</button>` +
        `<span class="row-sub">${coin + 1} / ${detailRows.length}</span>` +
        `<button class="pager" id="mk-next" ${coin === detailRows.length - 1 ? 'disabled' : ''}>Next ›</button>` +
        `</div>${EXTRAS_HTML}`;

      wireCommonControls(m);
      attachExtras(m);
    };

    const paint = async (opts: { force?: boolean } = {}): Promise<void> => {
      const seq = ++paintSeq;
      stopLivePrice();
      try {
      const m = detailRows[coin]!;
      if (viewMode !== 'chart') {
        await paintNonChart(m, seq);
        return;
      }
      const range = RANGES.find((r) => r.key === rangeKey)!;
      // Long ranges force a smooth line; short ranges honour the toggle.
      const mode: 'candle' | 'line' = range.long ? 'line' : chartMode;
      const cacheKey = `${coin}:${rangeKey}:${mode}`;

      let chart: string;
      let price: number;
      let changePct: number;
      let wire: (() => void) | null = null;

      if (mode === 'candle') {
        let series = (!opts.force && seriesCache.has(cacheKey)
          ? seriesCache.get(cacheKey)
          : await fetchCandleSeries(data, m.symbol, range.tf, range.limit)) as CandleSeries | null;
        // Never cache a failure (it would stick as "No history"); on a failed
        // refresh keep showing the last good series.
        if (series) seriesCache.set(cacheKey, series);
        else if (seriesCache.has(cacheKey)) series = seriesCache.get(cacheKey) as CandleSeries;
        price = series?.price ?? m.price;
        changePct = series?.changePct ?? 0;
        chart = series
          ? candleChartSvg(series.candles, { formatX: range.fx, formatY: (v) => `€${formatPrice(v)}` })
          : '<div class="empty">No history for this range yet.</div>';
        if (series) {
          const candles = series.candles;
          const geo = candleGeometry(candles);
          wire = (): void =>
            wireChart({
              geo,
              symbol: m.symbol,
              range,
              firstValue: candles[0]!.close,
              valueAt: (idx) => candles[idx]!.close,
              tipHtml: (idx) => {
                const c = candles[idx]!;
                return (
                  `<span class="pchart-tip-price">€${formatPrice(c.close)}</span>` +
                  `<span class="pchart-tip-ohlc">O €${formatPrice(c.open)} · H €${formatPrice(c.high)} · L €${formatPrice(c.low)} · C €${formatPrice(c.close)}</span>` +
                  `<span class="pchart-tip-time">${tipStamp(c.timestamp, range.tf)}</span>`
                );
              },
            });
        }
      } else {
        let series = (!opts.force && seriesCache.has(cacheKey)
          ? seriesCache.get(cacheKey)
          : await fetchSeries(data, m.symbol, range.tf, range.limit)) as PriceSeries | null;
        // Same failure policy as candles: never cache null, keep last good.
        if (series) seriesCache.set(cacheKey, series);
        else if (seriesCache.has(cacheKey)) series = seriesCache.get(cacheKey) as PriceSeries;
        price = series?.price ?? m.price;
        changePct = series?.changePct ?? 0;
        const up = changePct >= 0;
        chart = series
          ? priceChartSvg(series.points, {
              stroke: up ? HOT : COLD,
              formatX: range.fx,
              formatY: (v) => `€${formatPrice(v)}`,
            })
          : '<div class="empty">No history for this range yet.</div>';
        if (series) {
          const points = series.points;
          const geo = chartGeometry(points);
          wire = (): void =>
            wireChart({
              geo,
              symbol: m.symbol,
              range,
              firstValue: points[0]!.value,
              valueAt: (idx) => points[idx]!.value,
              tipHtml: (idx) => {
                const pt = points[idx]!;
                return (
                  `<span class="pchart-tip-price">€${formatPrice(pt.value)}</span>` +
                  `<span class="pchart-tip-time">${tipStamp(pt.timestamp, range.tf)}</span>`
                );
              },
            });
        }
      }

      // A newer paint superseded this one (same detail), or a different coin's
      // detail (or the list) opened while this fetch was in flight — either
      // way, this response is stale and must not touch the shared detailView.
      if (seq !== paintSeq || myGeneration !== detailGeneration) return;
      const up = changePct >= 0;
      const rangeBar = RANGES.map(
        (r) => `<button class="range-btn ${r.key === rangeKey ? 'active' : ''}" data-range="${r.key}">${r.key}</button>`,
      ).join('');

      detailView.innerHTML =
        detailHeaderHtml(m, price, changePct, viewMode, getWatchlist().has(m.symbol), detailRows, coin) +
        `<div class="chart-controls">
          <div class="range-bar">${rangeBar}</div>
          <div class="chart-toggle">
            <button class="ctoggle-btn ${mode === 'candle' ? 'active' : ''}" data-mode="candle" ${range.long ? 'disabled' : ''}>Candles</button>
            <button class="ctoggle-btn ${mode === 'line' ? 'active' : ''}" data-mode="line" ${range.long ? 'disabled' : ''}>Line</button>
          </div>
        </div>
        <div class="detail-chart"><div class="pchart-wrap">${chart}<div class="pchart-tip" hidden></div></div></div>
        <div class="detail-nav">
          <button class="pager" id="mk-prev" ${coin === 0 ? 'disabled' : ''}>‹ Prev</button>
          <span class="row-sub">${coin + 1} / ${detailRows.length}</span>
          <button class="pager" id="mk-next" ${coin === detailRows.length - 1 ? 'disabled' : ''}>Next ›</button>
        </div>` +
        EXTRAS_HTML;

      wireCommonControls(m);
      attachExtras(m);
      detailView.querySelectorAll<HTMLButtonElement>('.range-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const chart = detailView.querySelector<HTMLElement>('.detail-chart');
          if (chart) chart.classList.add('fade-out');
          setTimeout(() => {
            rangeKey = b.dataset['range']!;
            savedRangeKey = rangeKey;
            // `paint()` replaces `detailView.innerHTML`, so `chart` above is
            // detached by the time it resolves — re-query the fresh node,
            // otherwise fade-in silently no-ops on an orphaned element and
            // the chart just hard-snaps back in after the fade-out.
            void paint().then(() => {
              const freshChart = detailView.querySelector<HTMLElement>('.detail-chart');
              if (freshChart) {
                freshChart.classList.add('fade-in');
                setTimeout(() => freshChart.classList.remove('fade-in'), 300);
              }
            });
          }, 200);
        });
      });
      detailView.querySelectorAll<HTMLButtonElement>('.ctoggle-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const chart = detailView.querySelector<HTMLElement>('.detail-chart');
          if (chart) chart.classList.add('fade-out');
          setTimeout(() => {
            const mode = b.dataset['mode'];
            if (mode === 'candle' || mode === 'line') { chartMode = mode; savedChartMode = mode; }
            // Same stale-node fix as the range-btn handler above.
            void paint().then(() => {
              const freshChart = detailView.querySelector<HTMLElement>('.detail-chart');
              if (freshChart) {
                freshChart.classList.add('fade-in');
                setTimeout(() => freshChart.classList.remove('fade-in'), 300);
              }
            });
          }, 200);
        });
      });

      if (wire) wire();
      } catch {
        // Never leave a frozen/broken chart. Keep the last good render; the
        // periodic refresh retries. If nothing has rendered yet, show a note.
        if (myGeneration === detailGeneration && seq === paintSeq && !detailView.querySelector('svg.pchart')) {
          detailView.innerHTML =
            '<button class="tool-back" id="mk-eb">← All markets</button>' +
            '<div class="empty">Chart unavailable — retrying…</div>';
          detailView.querySelector('#mk-eb')?.addEventListener('click', backToList);
        }
      }
    };

    /**
     * Crosshair + tooltip interaction and the live current-price marker, shared
     * by line and candle modes. The caller supplies a `geo` (from
     * `chartGeometry` for closes, or `candleGeometry` for candles — both use the
     * same viewBox/padding), a value accessor for the crosshair dot, and the
     * tooltip markup for the hovered index. This is why the crosshair and the
     * live marker keep working unchanged with candles: the pointer→viewBox
     * mapping and `geo.y(price)` marker math are identical, only the data the
     * geometry is built from (and the tooltip contents) differ.
     */
    const wireChart = (cfg: {
      geo: ChartGeometry;
      symbol: string;
      range: Range;
      firstValue: number;
      valueAt: (idx: number) => number;
      tipHtml: (idx: number) => string;
    }): void => {
      const svg = detailView.querySelector<SVGSVGElement>('svg.pchart');
      const tip = detailView.querySelector<HTMLElement>('.pchart-tip');
      if (!svg || !tip) return;
      const geo = cfg.geo;
      const cross = svg.querySelector<SVGElement>('.pchart-cross');
      const crossLine = svg.querySelector<SVGLineElement>('.pchart-cross-line');
      const crossDot = svg.querySelector<SVGCircleElement>('.pchart-cross-dot');

      const showAt = (clientX: number): void => {
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0) return;
        const idx = geo.indexAtFraction((clientX - rect.left) / rect.width);
        const px = geo.x(idx);
        const py = geo.y(cfg.valueAt(idx));
        if (crossLine) {
          crossLine.setAttribute('x1', px.toFixed(1));
          crossLine.setAttribute('x2', px.toFixed(1));
        }
        if (crossDot) {
          crossDot.setAttribute('cx', px.toFixed(1));
          crossDot.setAttribute('cy', py.toFixed(1));
        }
        cross?.classList.add('show');
        tip.hidden = false;
        tip.innerHTML = cfg.tipHtml(idx);
        const wrap = detailView.querySelector<HTMLElement>('.pchart-wrap');
        if (wrap) positionChartTip(tip, wrap, px / geo.W, py / geo.H);
      };
      const hide = (): void => {
        cross?.classList.remove('show');
        tip.hidden = true;
      };
      svg.addEventListener('pointermove', (e) => showAt(e.clientX));
      svg.addEventListener('pointerdown', (e) => showAt(e.clientX));
      svg.addEventListener('pointerleave', hide);
      svg.addEventListener('pointercancel', hide);

      // Live current-price marker: move the right-edge dot/line/pill and the
      // headline as fresh prices arrive — no full re-render, so no flicker.
      const first = cfg.firstValue;
      stopLive = startLivePrice(data, cfg.symbol, (tick) => {
        const price = tick.price;
        const priceEl = detailView.querySelector<HTMLElement>('#mk-price');
        if (priceEl) priceEl.textContent = `€${formatPrice(price)}`;
        const chg = first > 0 ? ((price - first) / first) * 100 : 0;
        const chgEl = detailView.querySelector<HTMLElement>('#mk-change');
        if (chgEl) {
          chgEl.className = `chg ${chg >= 0 ? 'up' : 'down'}`;
          chgEl.textContent = `${formatPct(chg)} · ${cfg.range.key}`;
        }
        const y = Math.max(geo.padT, Math.min(geo.H - geo.padB, geo.y(price)));
        const dot = svg.querySelector<SVGCircleElement>('.pchart-now');
        const line = svg.querySelector<SVGLineElement>('.pchart-now-line');
        const tag = svg.querySelector<SVGGElement>('.pchart-now-tag');
        const text = svg.querySelector<SVGTextElement>('.pchart-now-text');
        dot?.setAttribute('cy', y.toFixed(1));
        line?.setAttribute('y1', y.toFixed(1));
        line?.setAttribute('y2', y.toFixed(1));
        tag?.setAttribute('transform', `translate(${(geo.W - geo.padR + 1).toFixed(1)}, ${y.toFixed(1)})`);
        if (text) text.textContent = `€${formatPrice(price)}`;
      });
    };

    void paint();
    window.clearInterval(detailTimer);
    detailTimer = window.setInterval(() => {
      // Don't wipe the chart mid-touch: while the crosshair tooltip is open the
      // user is inspecting — skip this tick; the next one repaints after they
      // let go. The live price marker keeps updating independently meanwhile.
      const tip = detailView.querySelector<HTMLElement>('.pchart-tip');
      if (tip && !tip.hidden) return;
      void paint({ force: true });
    }, REFRESH_MS);
  }

  function backToList(): void {
    openCoinIndex = null;
    detailGeneration++; // invalidates any still-in-flight paint for the coin we're leaving
    window.clearInterval(detailTimer);
    stopLivePrice();
    detailView.hidden = true;
    listView.hidden = false;
    renderList();
    listTimer = window.setInterval(() => void loadList(), LIST_REFRESH_MS);
  }

  // Delegated so 500+ rows cost one listener, not one each — and so rows
  // re-rendered by a refresh stay clickable without rebinding.
  list.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-row]');
    if (!row) return;
    const index = Number(row.dataset['row']);
    if (Number.isInteger(index) && index >= 0 && index < view.length) openDetail(index);
  });
  // One capture-phase listener covers every row's logo (error does not bubble).
  attachCoinLogoFallback(list);

  // Starring must not also open the coin — the star sits above the row.
  list.addEventListener('click', (event) => {
    const star = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-star]');
    if (!star) return;
    event.stopPropagation();
    getWatchlist().toggle(star.dataset['star']!);
    renderList();
  });

  container.querySelector('#mk-tabs')!.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-cat]');
    if (!tab) return;
    const key = tab.dataset['cat']!;
    const picked = CATEGORIES.find((c) => c.key === key);
    if (key !== 'watchlist' && !picked) return;
    if (key === 'watchlist' ? showingWatchlist : picked === category && !showingWatchlist) return;
    showingWatchlist = key === 'watchlist';
    if (picked) category = picked;
    visibleCount = PAGE_SIZE; // a new category starts at the top
    for (const el of container.querySelectorAll<HTMLElement>('.mk-tab')) {
      const active = el.dataset['cat'] === key;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', String(active));
    }
    renderList();
  });

  // Debounced so typing does not rebuild several hundred rows per keystroke.
  let searchTimer = 0;
  container.querySelector<HTMLInputElement>('#mk-search')!.addEventListener('input', (event) => {
    query = (event.target as HTMLInputElement).value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      visibleCount = PAGE_SIZE; // new results start at the top
      renderList();
    }, 120);
  });

  container.querySelector<HTMLSelectElement>('#mk-sort')!.addEventListener('change', (event) => {
    sortKey = (event.target as HTMLSelectElement).value as SortKey;
    visibleCount = PAGE_SIZE;
    renderList();
  });

  void loadList();
  listTimer = window.setInterval(() => void loadList(), LIST_REFRESH_MS);

  return {
    pause: () => {
      window.clearInterval(listTimer);
      window.clearInterval(detailTimer);
      moreObserver?.disconnect();
      moreObserver = null;
      stopLivePrice();
    },
    resume: () => {
      if (openCoinIndex !== null) {
        openDetail(openCoinIndex, { preserveRange: true });
      } else {
        void loadList();
        listTimer = window.setInterval(() => void loadList(), LIST_REFRESH_MS);
      }
    },
  };
}
