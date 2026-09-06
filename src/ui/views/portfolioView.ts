/**
 * Paper Portfolio tab. Rendering + forms only; accounting lives in
 * PaperPortfolio, persistence in the storage layer.
 */

import { PaperPortfolio } from '../../core/portfolio/paperPortfolio';
import { LocalStorageStore } from '../../core/data/storage';
import type { ActiveDataSource } from '../dataSource';
import { attachCoinLogoFallback, coinLogoHtml } from '../coinLogo';
import { escapeHtml, formatPct, formatPrice, formatPriceSplit, tieredPriceHtml } from '../format';
import { skeletonRowsHtml } from '../loadingStates';

const STARTING_CASH = 10_000;

/** Resolves an instrument's base asset code for its coin logo — mirrors the
 * same lookup used on Home (`homeView.ts`'s `baseFor`). */
function baseFor(data: ActiveDataSource, symbol: string): string {
  const inst = data.instruments.find((i) => i.symbol === symbol);
  return (inst?.base ?? symbol.replace(/EUR$|USD$/, '')).toUpperCase();
}

/** Every other screen prefixes a EUR amount with "€" (Home's own `euro()`
 * helper) — this view formatted every price/cash/P&L figure through
 * `formatPrice` alone and never added the symbol, so the whole tab (hero
 * equity, cash/realized/unrealized, positions, trade journal) showed bare
 * numbers with no currency at all. Mirrors Home's convention, with the
 * minus sign placed before the symbol ("-€12.34") for a real loss rather
 * than after it ("€-12.34"), since `formatPrice` alone never had to.  */
function euro(value: number): string {
  return value < 0 ? `-€${formatPrice(-value)}` : `€${formatPrice(value)}`;
}

/** Neutral (no color) at exactly zero or effectively zero (float dust) —
 * matches the app's own `signClass` convention (already used by Market Scan
 * / Monitoring) that this view's manual `>= 0 ? up : down` ternaries never
 * adopted, coloring an unmoved 0.00% figure or a flat position bright green. */
function pnlClass(value: number): string {
  if (Math.abs(value) < 0.005) return '';
  return value > 0 ? 'up' : 'down';
}

export function renderPortfolioView(container: HTMLElement, data: ActiveDataSource): void {
  const portfolio = new PaperPortfolio(new LocalStorageStore(), STARTING_CASH);

  container.innerHTML = `
    <h2 class="view-title">Paper Portfolio</h2>
    <p class="view-sub">Simulated trading with virtual money — practice without risk. Nothing here touches a real account.</p>

    <!-- hero-bare matches Home's balance treatment: this equity figure is
         THE dominant element of this screen (same as Home's balance is
         Home's), so it gets the same bare, un-boxed, giant-scale treatment
         rather than sitting in a bordered card like a secondary widget. -->
    <section class="hero hero-bare" id="pp-hero">
      <div class="hero-label">Equity <span class="tag-sim">SIMULATED</span></div>
      <div class="hero-value" id="pp-equity">—</div>
      <div class="hero-change" id="pp-change"></div>
      <div class="hero-split">
        <span id="pp-cash"></span>
        <span id="pp-realized"></span>
        <span id="pp-unrealized"></span>
      </div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Trade</h2></div>
      <!-- Inputs and actions as two visually separate rows — cramming a
           select, a quantity field and three unrelated-weight buttons into
           one flex row (the original layout) is exactly the cramped,
           un-stepped-back density the reference never has. -->
      <div class="controls">
        <label class="control">Market
          <select id="pp-symbol">
            ${data.instruments.map((i) => `<option value="${escapeHtml(i.symbol)}">${escapeHtml(i.symbol)}</option>`).join('')}
          </select>
        </label>
        <label class="control">Quantity
          <input id="pp-quantity" type="number" value="0.1" min="0" step="any" />
        </label>
      </div>
      <!-- Buy/Sell get the reference's own semantic tint pair (green/red),
           not two identical black-on-white pills — Reset is deliberately a
           quieter, lower-emphasis action set apart from the two real trade
           actions. That intent was already the comment here, but all three
           sat in one plain flex row: at phone width "Buy at market"/"Sell at
           market" (~165px each) don't fit side by side, so .controls' own
           flex-wrap stacked all three full pills one below the other —
           confirmed via a real layout measurement, not just reading the
           CSS. .trade-actions makes Buy/Sell split the row evenly (an
           actual paired control, matching the reference), with Reset
           dropped to its own row beneath so it reads as the separate,
           quieter action the comment always intended. -->
      <div class="controls trade-actions">
        <button class="btn-buy" id="pp-buy">Buy at market</button>
        <button class="btn-sell" id="pp-sell">Sell at market</button>
      </div>
      <div class="controls">
        <button class="secondary" id="pp-reset">Reset portfolio</button>
      </div>
      <div class="status-line" id="pp-status"></div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Positions</h2></div>
      <div class="stack stack-card" id="pp-positions">${skeletonRowsHtml(2)}</div>
    </section>

    <section class="block">
      <div class="block-head"><h2>Trade journal</h2></div>
      <div class="stack stack-card" id="pp-trades">${skeletonRowsHtml(3)}</div>
    </section>
  `;
  attachCoinLogoFallback(container);

  const heroEl = container.querySelector<HTMLElement>('#pp-hero')!;
  const status = container.querySelector<HTMLElement>('#pp-status')!;
  const buyButton = container.querySelector<HTMLButtonElement>('#pp-buy')!;
  const sellButton = container.querySelector<HTMLButtonElement>('#pp-sell')!;

  async function latestPrice(symbol: string): Promise<number | null> {
    const candles = await data.source.getCandles(symbol, '1m', 2);
    if (!candles.ok || candles.value.length === 0) {
      const hourly = await data.source.getCandles(symbol, '1h', 2);
      if (!hourly.ok || hourly.value.length === 0) return null;
      return hourly.value[hourly.value.length - 1]!.close;
    }
    return candles.value[candles.value.length - 1]!.close;
  }

  async function refresh(): Promise<void> {
    const prices: Record<string, number> = {};
    for (const position of portfolio.positions()) {
      const price = await latestPrice(position.symbol);
      if (price !== null) prices[position.symbol] = price;
    }
    renderHero(heroEl, portfolio, prices);
    renderPositions(container.querySelector('#pp-positions')!, portfolio, prices, data);
    renderTrades(container.querySelector('#pp-trades')!, portfolio, data);
  }

  async function trade(side: 'buy' | 'sell'): Promise<void> {
    buyButton.disabled = true;
    sellButton.disabled = true;
    try {
      const symbol = container.querySelector<HTMLSelectElement>('#pp-symbol')!.value;
      const quantity = Number(container.querySelector<HTMLInputElement>('#pp-quantity')!.value);
      status.textContent = `Fetching ${symbol} price…`;
      const price = await latestPrice(symbol);
      if (price === null) {
        status.innerHTML = `<span class="error-line">No price available for ${escapeHtml(symbol)}</span>`;
        return;
      }
      const result =
        side === 'buy'
          ? portfolio.buy(symbol, quantity, price, Date.now())
          : portfolio.sell(symbol, quantity, price, Date.now());
      status.innerHTML = result.ok
        ? `${side === 'buy' ? 'Bought' : 'Sold'} ${quantity} ${escapeHtml(symbol)} @ ${euro(price)} · source: ${escapeHtml(data.source.name)}`
        : `<span class="error-line">${escapeHtml(result.error)}</span>`;
      await refresh();
    } finally {
      buyButton.disabled = false;
      sellButton.disabled = false;
    }
  }

  buyButton.addEventListener('click', () => void trade('buy'));
  sellButton.addEventListener('click', () => void trade('sell'));
  container.querySelector('#pp-reset')!.addEventListener('click', () => {
    if (window.confirm(`Reset the paper portfolio to ${euro(STARTING_CASH)} and clear the journal?`)) {
      portfolio.reset(STARTING_CASH);
      status.textContent = 'Portfolio reset.';
      void refresh();
    }
  });

  void refresh();
}

function renderHero(heroEl: HTMLElement, portfolio: PaperPortfolio, prices: Record<string, number>): void {
  const equity = portfolio.equity(prices);
  const unrealized = portfolio.unrealizedPnl(prices);
  const totalReturnPct = STARTING_CASH > 0 ? ((equity - STARTING_CASH) / STARTING_CASH) * 100 : 0;
  const { major, minor } = formatPriceSplit(equity);

  // Home's own hero always leads with a `.hero-value-currency` € span
  // (see homeView.ts) — this hero never did, rendering "10,000.00" with no
  // currency at all despite being the exact same big-number component.
  heroEl.querySelector('#pp-equity')!.innerHTML =
    `<span class="hero-value-currency">€</span><span class="hero-value-major">${major}</span><span class="hero-value-minor">.${minor}</span>`;
  const changeEl = heroEl.querySelector<HTMLElement>('#pp-change')!;
  changeEl.textContent = `${formatPct(totalReturnPct)} all time`;
  // A flat (or float-dust-flat) portfolio isn't "up" — `pnlClass` is neutral
  // at zero, matching Market Scan/Monitoring's own `signClass` convention.
  const returnClass = pnlClass(totalReturnPct);
  changeEl.className = `hero-change ${returnClass}`;
  heroEl.classList.toggle('up', returnClass === 'up');
  heroEl.classList.toggle('down', returnClass === 'down');

  heroEl.querySelector('#pp-cash')!.innerHTML = `Cash ${tieredPriceHtml(euro(portfolio.cash))}`;
  heroEl.querySelector('#pp-realized')!.innerHTML =
    `Realized <span class="chg ${pnlClass(portfolio.realizedPnl)}">${tieredPriceHtml(euro(portfolio.realizedPnl))}</span>`;
  heroEl.querySelector('#pp-unrealized')!.innerHTML =
    `Unrealized <span class="chg ${pnlClass(unrealized)}">${tieredPriceHtml(euro(unrealized))}</span>`;
}

function renderPositions(
  element: Element,
  portfolio: PaperPortfolio,
  prices: Record<string, number>,
  data: ActiveDataSource,
): void {
  const positions = portfolio.positions();
  if (positions.length === 0) {
    // Matches Home's/Stocks Overview's identical empty-positions copy
    // exactly (`homeView.ts`/`stocksOverviewPanel.ts`) — this screen's own
    // flatter "No open positions." was the one place left with different
    // wording for the same concept.
    element.innerHTML = '<div class="empty">Holding cash and waiting for a good setup.</div>';
    return;
  }
  element.innerHTML = positions
    .map((p) => {
      const price = prices[p.symbol];
      const pnlPct = price === undefined ? null : ((price - p.avgCost) / p.avgCost) * 100;
      return `
        <div class="row">
          <div class="row-main">${coinLogoHtml(baseFor(data, p.symbol))}
            <div><div class="row-title">${escapeHtml(p.symbol)}</div>
              <div class="row-sub">${p.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })} @ ${euro(p.avgCost)}</div></div></div>
          <div class="row-side"><span class="row-title">${price === undefined ? '—' : tieredPriceHtml(euro(price))}</span>
            <span class="chg ${pnlClass(pnlPct ?? 0)}">${formatPct(pnlPct)}</span></div>
        </div>`;
    })
    .join('');
}

function renderTrades(element: Element, portfolio: PaperPortfolio, data: ActiveDataSource): void {
  const trades = [...portfolio.trades].reverse().slice(0, 50);
  if (trades.length === 0) {
    element.innerHTML = '<div class="empty">No trades yet.</div>';
    return;
  }
  element.innerHTML = trades
    .map((t) => {
      const sell = t.side === 'sell';
      const pnlHtml = sell
        ? `<span class="chg ${pnlClass(t.realizedPnl)}">${euro(t.realizedPnl)}</span>`
        : '';
      return `
        <div class="row trade ${t.side}">
          <div class="row-main">${coinLogoHtml(baseFor(data, t.symbol))}
            <div><div class="row-title"><span class="pill ${t.side}">${t.side.toUpperCase()}</span> ${escapeHtml(t.symbol)}</div>
              <div class="row-sub">${new Date(t.timestamp).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div></div>
          <div class="row-side"><span class="row-title">${tieredPriceHtml(euro(t.price))}</span>
            <span class="row-sub">${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}</span>
            ${pnlHtml}</div>
        </div>`;
    })
    .join('');
}
