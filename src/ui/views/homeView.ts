/**
 * Home — the primary dashboard. Presentation only: shows the REAL cloud
 * robot (committed autopilot-state.json) plus live prices, so what you see
 * here matches the Telegram alerts. Phone-first, English.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchCloudState, type CloudState } from '../cloudState';
import { fetchTopMarkets, findBtcSymbol, type MarketSnapshot } from '../markets';
import { sparklineSvg } from '../charts';
import { formatPrice, formatPct } from '../format';

const PRICE_REFRESH_MS = 15_000;
const STATE_REFRESH_MS = 120_000;

const euro = (v: number): string => `€${formatPrice(v)}`;
const HOT = '#2fbf71';
const COLD = '#e4574f';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function livePrices(data: ActiveDataSource, symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      const candles = await data.source.getCandles(symbol, '1h', 2);
      if (candles.ok && candles.value.length > 0) prices[symbol] = candles.value[candles.value.length - 1]!.close;
    }),
  );
  return prices;
}

export function renderHomeView(container: HTMLElement, data: ActiveDataSource): void {
  container.innerHTML = '';
  const hero = el('section', 'hero');
  hero.innerHTML = `
    <div class="hero-label">Portfolio value <span class="tag-sim">SIMULATED</span></div>
    <div class="hero-value" id="hv-equity">—</div>
    <div class="hero-change" id="hv-change"></div>
    <div class="hero-split"><span id="hv-cash"></span><span id="hv-invested"></span></div>
    <div class="hero-bench" id="hv-bench" hidden></div>
  `;

  const marketsWrap = el('section', 'block');
  marketsWrap.innerHTML = `<div class="block-head"><h2>Markets</h2><button class="link-btn" data-nav="markets">See all</button></div>`;
  const marketsStrip = el('div', 'markets-strip');
  marketsStrip.id = 'home-markets';
  marketsWrap.appendChild(marketsStrip);

  const posWrap = el('section', 'block');
  posWrap.innerHTML = `<div class="block-head"><h2>Open positions</h2></div>`;
  const posList = el('div', 'stack');
  posList.id = 'home-positions';
  posWrap.appendChild(posList);

  const actWrap = el('section', 'block');
  actWrap.innerHTML = `<div class="block-head"><h2>Recent activity</h2><button class="link-btn" data-nav="history">See all</button></div>`;
  const actList = el('div', 'stack');
  actList.id = 'home-activity';
  actWrap.appendChild(actList);

  const status = el('p', 'muted-line', 'Loading the cloud robot…');
  status.id = 'home-status';

  container.append(hero, marketsWrap, posWrap, actWrap, status);

  let state: CloudState | null = null;

  const setText = (id: string, text: string): void => {
    const node = container.querySelector<HTMLElement>(`#${id}`);
    if (node) node.textContent = text;
  };

  function renderMarkets(markets: MarketSnapshot[]): void {
    marketsStrip.innerHTML = '';
    if (markets.length === 0) {
      marketsStrip.appendChild(el('div', 'empty', 'Live market data unavailable right now.'));
      return;
    }
    for (const m of markets) {
      const up = m.changePct >= 0;
      const card = el('div', 'market-card');
      card.innerHTML = `
        <div class="market-top"><span class="market-name">${m.label}</span>
          <span class="chg ${up ? 'up' : 'down'}">${formatPct(m.changePct)}</span></div>
        <div class="market-price">${euro(m.price)}</div>
        <div class="market-spark" style="color:${up ? HOT : COLD}">${sparklineSvg(m.closes, { stroke: up ? HOT : COLD, fill: true, width: 150, height: 44 })}</div>`;
      marketsStrip.appendChild(card);
    }
  }

  function renderPositions(prices: Record<string, number>): void {
    posList.innerHTML = '';
    if (!state || state.positions.length === 0) {
      posList.appendChild(el('div', 'empty', 'No open positions — holding cash and waiting for a good setup.'));
      return;
    }
    for (const p of state.positions) {
      const price = prices[p.symbol] ?? p.entryPrice;
      const movePct = p.entryPrice > 0 ? ((price - p.entryPrice) / p.entryPrice) * 100 : 0;
      const up = movePct >= 0;
      const row = el('div', 'row');
      row.innerHTML = `
        <div class="row-main"><span class="row-title">${p.symbol}</span>
          <span class="row-sub">entry ${euro(p.entryPrice)}</span></div>
        <div class="row-side"><span class="row-title">${euro(p.quantity * price)}</span>
          <span class="chg ${up ? 'up' : 'down'}">${formatPct(movePct)}</span></div>`;
      posList.appendChild(row);
    }
  }

  function renderActivity(): void {
    actList.innerHTML = '';
    if (!state || state.history.length === 0) {
      actList.appendChild(el('div', 'empty', 'No trades yet — the robot is waiting for a qualified opportunity.'));
      return;
    }
    for (const t of state.history.slice(0, 5)) {
      const buy = t.kind === 'buy';
      const row = el('div', `row trade ${t.kind}`);
      row.innerHTML = `
        <div class="row-main"><span class="pill ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span>
          <span class="row-title">${t.symbol}</span></div>
        <div class="row-side"><span class="row-sub">${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} @ ${euro(t.price)}</span>
          <span class="row-sub">${new Date(t.at).toLocaleDateString('en-GB')}</span></div>`;
      actList.appendChild(row);
    }
  }

  async function refreshPrices(): Promise<void> {
    if (!state) return;
    const symbols = state.positions.map((p) => p.symbol);
    const btc = findBtcSymbol(data);
    if (btc) symbols.push(btc);
    const prices = await livePrices(data, symbols);

    const invested = state.positions.reduce((s, p) => s + p.quantity * (prices[p.symbol] ?? p.entryPrice), 0);
    const equity = state.cash + invested;
    const totalReturn = state.initialCash > 0 ? ((equity - state.initialCash) / state.initialCash) * 100 : 0;

    setText('hv-equity', euro(equity));
    const change = container.querySelector<HTMLElement>('#hv-change')!;
    change.textContent = `${formatPct(totalReturn)} all time`;
    change.className = `hero-change ${totalReturn >= 0 ? 'up' : 'down'}`;
    setText('hv-cash', `Cash ${euro(state.cash)}`);
    setText('hv-invested', `Invested ${euro(invested)}`);

    const bench = container.querySelector<HTMLElement>('#hv-bench')!;
    if (btc && state.benchmark && prices[btc] && state.benchmark.btc > 0 && state.benchmark.equity > 0) {
      const bot = ((equity - state.benchmark.equity) / state.benchmark.equity) * 100;
      const btcPct = ((prices[btc]! - state.benchmark.btc) / state.benchmark.btc) * 100;
      bench.hidden = false;
      bench.textContent = `vs Bitcoin — robot ${formatPct(bot)} · BTC ${formatPct(btcPct)}${bot >= btcPct ? ' · leading' : ''}`;
    }

    renderPositions(prices);
    const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    setText('home-status', `Live · updated ${stamp}`);
  }

  async function loadState(): Promise<void> {
    const fresh = await fetchCloudState();
    if (fresh) {
      state = fresh;
      renderActivity();
      await refreshPrices();
    } else if (!state) {
      setText('home-status', "Couldn't reach the cloud robot — retrying automatically.");
    }
  }

  async function loadMarkets(): Promise<void> {
    renderMarkets(await fetchTopMarkets(data, 6));
  }

  void loadState();
  void loadMarkets();
  window.setInterval(() => void refreshPrices(), PRICE_REFRESH_MS);
  window.setInterval(() => void loadState(), STATE_REFRESH_MS);
  window.setInterval(() => void loadMarkets(), PRICE_REFRESH_MS * 4);
}
