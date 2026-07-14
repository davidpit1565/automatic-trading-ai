/**
 * Paper Portfolio tab. Rendering + forms only; accounting lives in
 * PaperPortfolio, persistence in the storage layer.
 */

import { PaperPortfolio } from '../../core/portfolio/paperPortfolio';
import { LocalStorageStore } from '../../core/data/storage';
import type { ActiveDataSource } from '../dataSource';
import { escapeHtml, formatPct, formatPrice, signClass } from '../format';

export function renderPortfolioView(container: HTMLElement, data: ActiveDataSource): void {
  const portfolio = new PaperPortfolio(new LocalStorageStore(), 10_000);

  container.innerHTML = `
    <h2>Paper Portfolio</h2>
    <p class="status-line">
      Simulated trading with virtual money — practice without risk. Nothing here
      touches a real account.
    </p>
    <div id="pp-summary"></div>
    <div class="controls">
      <label class="control">Market
        <select id="pp-symbol">
          ${data.instruments.map((i) => `<option value="${escapeHtml(i.symbol)}">${escapeHtml(i.symbol)}</option>`).join('')}
        </select>
      </label>
      <label class="control">Quantity
        <input id="pp-quantity" type="number" value="0.1" min="0" step="any" />
      </label>
      <button class="primary" id="pp-buy">Buy at market</button>
      <button class="primary" id="pp-sell">Sell at market</button>
      <button class="secondary" id="pp-reset">Reset portfolio</button>
    </div>
    <div class="status-line" id="pp-status"></div>
    <h3>Positions</h3>
    <div id="pp-positions"></div>
    <h3>Trade journal</h3>
    <div id="pp-trades"></div>
  `;

  const status = container.querySelector<HTMLElement>('#pp-status')!;

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
    renderSummary(container.querySelector('#pp-summary')!, portfolio, prices);
    renderPositions(container.querySelector('#pp-positions')!, portfolio, prices);
    renderTrades(container.querySelector('#pp-trades')!, portfolio);
  }

  async function trade(side: 'buy' | 'sell'): Promise<void> {
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
      ? `${side === 'buy' ? 'Bought' : 'Sold'} ${quantity} ${escapeHtml(symbol)} @ ${formatPrice(price)} (${data.source.name})`
      : `<span class="error-line">${escapeHtml(result.error)}</span>`;
    await refresh();
  }

  container.querySelector('#pp-buy')!.addEventListener('click', () => void trade('buy'));
  container.querySelector('#pp-sell')!.addEventListener('click', () => void trade('sell'));
  container.querySelector('#pp-reset')!.addEventListener('click', () => {
    if (window.confirm('Reset the paper portfolio to 10,000 and clear the journal?')) {
      portfolio.reset(10_000);
      status.textContent = 'Portfolio reset.';
      void refresh();
    }
  });

  void refresh();
}

function renderSummary(
  element: Element,
  portfolio: PaperPortfolio,
  prices: Record<string, number>,
): void {
  const equity = portfolio.equity(prices);
  const unrealized = portfolio.unrealizedPnl(prices);
  element.innerHTML = `
    <div class="result-cards">
      <div class="stat-card"><div class="stat-label">Equity</div>
        <div class="stat-value">${formatPrice(equity)}</div></div>
      <div class="stat-card"><div class="stat-label">Cash</div>
        <div class="stat-value">${formatPrice(portfolio.cash)}</div></div>
      <div class="stat-card"><div class="stat-label">Realized P&amp;L</div>
        <div class="stat-value ${signClass(portfolio.realizedPnl)}">${formatPrice(portfolio.realizedPnl)}</div></div>
      <div class="stat-card"><div class="stat-label">Unrealized P&amp;L</div>
        <div class="stat-value ${signClass(unrealized)}">${formatPrice(unrealized)}</div></div>
    </div>
  `;
}

function renderPositions(
  element: Element,
  portfolio: PaperPortfolio,
  prices: Record<string, number>,
): void {
  const positions = portfolio.positions();
  if (positions.length === 0) {
    element.innerHTML = '<p class="status-line">No open positions.</p>';
    return;
  }
  element.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Market</th><th>Quantity</th><th>Avg cost</th><th>Price</th><th>P&amp;L %</th></tr></thead>
      <tbody>
        ${positions
          .map((p) => {
            const price = prices[p.symbol];
            const pnlPct = price === undefined ? null : ((price - p.avgCost) / p.avgCost) * 100;
            return `<tr>
              <td>${escapeHtml(p.symbol)}</td>
              <td>${p.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
              <td>${formatPrice(p.avgCost)}</td>
              <td>${price === undefined ? '—' : formatPrice(price)}</td>
              <td class="${signClass(pnlPct)}">${formatPct(pnlPct)}</td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  `;
}

function renderTrades(element: Element, portfolio: PaperPortfolio): void {
  const trades = [...portfolio.trades].reverse().slice(0, 50);
  if (trades.length === 0) {
    element.innerHTML = '<p class="status-line">No trades yet.</p>';
    return;
  }
  element.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Quantity</th><th>Price</th><th>Realized P&amp;L</th></tr></thead>
      <tbody>
        ${trades
          .map(
            (t) => `<tr>
              <td>${new Date(t.timestamp).toLocaleString()}</td>
              <td>${escapeHtml(t.symbol)}</td>
              <td class="${t.side === 'buy' ? 'positive' : 'negative'}">${t.side.toUpperCase()}</td>
              <td>${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
              <td>${formatPrice(t.price)}</td>
              <td class="${signClass(t.realizedPnl)}">${t.side === 'sell' ? formatPrice(t.realizedPnl) : '—'}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  `;
}
