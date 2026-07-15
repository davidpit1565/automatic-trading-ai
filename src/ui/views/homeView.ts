/**
 * Home dashboard (Hebrew, RTL, phone-first).
 *
 * Shows the REAL cloud robot: portfolio value that refreshes with live
 * prices, open positions, and a clear history of every buy/sell. Read-only
 * and presentation-only — all analysis lives in the verified core; this view
 * just displays the committed cloud state plus live prices for the top card.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchCloudState, type CloudState } from '../cloudState';

const PRICE_REFRESH_MS = 15_000;
const STATE_REFRESH_MS = 120_000;

function euro(value: number): string {
  return `€${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
function signedPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}
function when(at: number): string {
  return new Date(at).toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Latest close per symbol via the live data source (best-effort). */
async function livePrices(data: ActiveDataSource, symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      const candles = await data.source.getCandles(symbol, '1h', 2);
      if (candles.ok && candles.value.length > 0) {
        prices[symbol] = candles.value[candles.value.length - 1]!.close;
      }
    }),
  );
  return prices;
}

function btcSymbol(data: ActiveDataSource): string | null {
  const hit = data.instruments.find((i) => /XBT|BTC/i.test(i.symbol) && /EUR/i.test(i.symbol));
  return hit?.symbol ?? null;
}

export function renderHomeView(container: HTMLElement, data: ActiveDataSource): void {
  container.classList.add('home');
  container.setAttribute('dir', 'rtl');
  container.setAttribute('lang', 'he');
  container.innerHTML = '';

  const card = el('section', 'home-card');
  card.innerHTML = `
    <div class="home-card-label">שווי התיק (כסף מדומה)</div>
    <div class="home-value" id="home-equity">…</div>
    <div class="home-return" id="home-return"></div>
    <div class="home-sub">
      <span id="home-cash"></span> · <span id="home-invested"></span>
    </div>
    <div class="home-bench" id="home-bench"></div>
  `;

  const posWrap = el('section', 'home-section');
  posWrap.appendChild(el('h2', 'home-h2', '📌 פוזיציות פתוחות'));
  const posList = el('div', 'home-list');
  posList.id = 'home-positions';
  posWrap.appendChild(posList);

  const histWrap = el('section', 'home-section');
  histWrap.appendChild(el('h2', 'home-h2', '🧾 היסטוריית עסקאות'));
  const histList = el('div', 'home-list');
  histList.id = 'home-history';
  histWrap.appendChild(histList);

  const status = el('p', 'home-status', 'טוען נתונים מהרובוט בענן…');
  status.id = 'home-status';

  container.append(card, posWrap, histWrap, status);

  const positionsEl = posList;
  const historyEl = histList;
  const equityEl = card.querySelector<HTMLElement>('#home-equity')!;
  const returnEl = card.querySelector<HTMLElement>('#home-return')!;
  const cashEl = card.querySelector<HTMLElement>('#home-cash')!;
  const investedEl = card.querySelector<HTMLElement>('#home-invested')!;
  const benchEl = card.querySelector<HTMLElement>('#home-bench')!;

  let state: CloudState | null = null;

  function renderHistory(): void {
    if (!state) return;
    historyEl.innerHTML = '';
    if (state.history.length === 0) {
      historyEl.appendChild(el('div', 'home-empty', 'עוד לא בוצעו עסקאות — הרובוט ממתין להזדמנות טובה.'));
      return;
    }
    for (const t of state.history.slice(0, 100)) {
      const row = el('div', `home-trade ${t.kind}`);
      const left = el('div', 'home-trade-main');
      left.appendChild(el('span', 'home-badge', t.kind === 'buy' ? '🟢 קנייה' : '🔴 מכירה'));
      left.appendChild(el('span', 'home-trade-sym', t.symbol));
      const right = el('div', 'home-trade-meta');
      right.appendChild(el('span', 'home-trade-price', `${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} @ ${euro(t.price)}`));
      right.appendChild(el('span', 'home-trade-date', when(t.at)));
      row.append(left, right);
      historyEl.appendChild(row);
    }
  }

  function renderPositions(prices: Record<string, number>): void {
    if (!state) return;
    positionsEl.innerHTML = '';
    if (state.positions.length === 0) {
      positionsEl.appendChild(el('div', 'home-empty', 'אין פוזיציות פתוחות כרגע. 🛡️ מגן על הכסף.'));
      return;
    }
    for (const p of state.positions) {
      const price = prices[p.symbol] ?? p.entryPrice;
      const movePct = p.entryPrice > 0 ? ((price - p.entryPrice) / p.entryPrice) * 100 : 0;
      const value = p.quantity * price;
      const row = el('div', 'home-pos');
      const main = el('div', 'home-pos-main');
      main.appendChild(el('span', 'home-pos-sym', p.symbol));
      main.appendChild(el('span', 'home-pos-val', euro(value)));
      const meta = el('div', 'home-pos-meta');
      meta.appendChild(el('span', `home-chip ${movePct >= 0 ? 'up' : 'down'}`, signedPct(movePct)));
      meta.appendChild(el('span', 'home-pos-entry', `כניסה ${euro(p.entryPrice)}`));
      row.append(main, meta);
      positionsEl.appendChild(row);
    }
  }

  async function refreshPrices(): Promise<void> {
    if (!state) return;
    const symbols = state.positions.map((p) => p.symbol);
    const btc = btcSymbol(data);
    if (btc) symbols.push(btc);
    const prices = await livePrices(data, symbols);

    const invested = state.positions.reduce(
      (sum, p) => sum + p.quantity * (prices[p.symbol] ?? p.entryPrice),
      0,
    );
    const equity = state.cash + invested;
    const totalReturn = state.initialCash > 0 ? ((equity - state.initialCash) / state.initialCash) * 100 : 0;

    equityEl.textContent = euro(equity);
    returnEl.textContent = `${signedPct(totalReturn)} מההתחלה`;
    returnEl.className = `home-return ${totalReturn >= 0 ? 'up' : 'down'}`;
    cashEl.textContent = `מזומן פנוי ${euro(state.cash)}`;
    investedEl.textContent = `מושקע ${euro(invested)}`;

    if (btc && state.benchmark && prices[btc] && state.benchmark.btc > 0 && state.benchmark.equity > 0) {
      const botPct = ((equity - state.benchmark.equity) / state.benchmark.equity) * 100;
      const btcPct = ((prices[btc]! - state.benchmark.btc) / state.benchmark.btc) * 100;
      const leading = botPct >= btcPct;
      benchEl.textContent = `🏁 מול ביטקוין: הרובוט ${signedPct(botPct)} · ביטקוין ${signedPct(btcPct)} ${leading ? '· מוביל 🎉' : ''}`;
    }

    renderPositions(prices);
    const stamp = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const ran = state.lastRunAt ? ` · הרובוט רץ לאחרונה ${when(state.lastRunAt)}` : '';
    const statusEl = document.getElementById('home-status');
    if (statusEl) statusEl.textContent = `עודכן ${stamp}${ran}`;
  }

  async function loadState(): Promise<void> {
    const fresh = await fetchCloudState();
    if (fresh === null) {
      if (!state) {
        const statusEl = document.getElementById('home-status');
        if (statusEl) statusEl.textContent = 'לא הצלחתי לטעון את נתוני הרובוט כרגע — אנסה שוב אוטומטית.';
      }
      return;
    }
    state = fresh;
    renderHistory();
    await refreshPrices();
  }

  void loadState();
  window.setInterval(() => void refreshPrices(), PRICE_REFRESH_MS);
  window.setInterval(() => void loadState(), STATE_REFRESH_MS);
}
