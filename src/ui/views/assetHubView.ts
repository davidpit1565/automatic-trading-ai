/**
 * Shared shell for an asset class's own section (Crypto, Stocks): one
 * primary nav destination with four sub-pages — Overview, History, Market,
 * Profit. History and Profit are generic (both `CloudState` shapes are
 * identical — see `cloudState.ts`, which parses both
 * `state/autopilot-state.json` and `state/stocks-state.json` the same way).
 * Overview and Market differ per asset class (crypto reuses the existing
 * rich Home/Markets views; stocks gets simpler built-ins), so both are
 * injected by the caller.
 */

import { mountEquityChartPanel } from '../equityChartPanel';
import { attachCoinLogoFallback, baseCodeFromSymbol, completedLogoHtml } from '../coinLogo';
import { formatPrice, formatPct } from '../format';
import type { CloudState } from '../cloudState';
import type { ViewHandle } from '../viewLifecycle';

const STATE_REFRESH_MS = 60_000;
type HubTab = 'overview' | 'history' | 'market' | 'profit' | 'longterm';

export interface AssetHubOptions {
  readonly title: string;
  readonly subtitle: string;
  readonly currencySymbol: string;
  readonly fetchState: () => Promise<CloudState | null>;
  /** True to show the "vs Bitcoin" benchmark line on the Profit sub-page. */
  readonly showBenchmark: boolean;
  /** Mounted eagerly (Overview is the default sub-tab). */
  readonly renderOverview: (container: HTMLElement) => ViewHandle | void;
  /** Mounted lazily, once, the first time the Market sub-tab is opened. */
  readonly renderMarket: (container: HTMLElement) => ViewHandle | void;
  /**
   * Mounted lazily, once, the first time the Long-Term sub-tab is opened.
   * Omit entirely to hide that tab — only Stocks has a long-term shadow
   * wallet today (see `stocksLongTermPanel.ts`); Crypto doesn't pass this.
   */
  readonly renderLongTerm?: (container: HTMLElement) => ViewHandle | void;
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function renderAssetHub(container: HTMLElement, opts: AssetHubOptions): ViewHandle {
  const money = (v: number): string => `${opts.currencySymbol}${formatPrice(v)}`;

  container.innerHTML = `
    <h2 class="view-title">${opts.title}</h2>
    <p class="view-sub">${opts.subtitle}</p>
    <div class="hub-tabs" role="tablist">
      <button class="hub-tab active" data-hub="overview" role="tab" aria-selected="true">Overview</button>
      <button class="hub-tab" data-hub="history" role="tab" aria-selected="false">History</button>
      <button class="hub-tab" data-hub="market" role="tab" aria-selected="false">Market</button>
      <button class="hub-tab" data-hub="profit" role="tab" aria-selected="false">Profit</button>
      ${opts.renderLongTerm ? '<button class="hub-tab" data-hub="longterm" role="tab" aria-selected="false">Long-Term</button>' : ''}
    </div>
    <div class="hub-panel active" data-hub-panel="overview"></div>
    <div class="hub-panel" data-hub-panel="history">
      <div id="hub-history-chart"></div>
      <div class="stack stack-card" id="hub-history-list"><div class="empty">Loading…</div></div>
    </div>
    <div class="hub-panel" data-hub-panel="market"></div>
    <div class="hub-panel" data-hub-panel="profit">
      <section class="hero">
        <div class="hero-label">Total return</div>
        <div class="hero-value" id="hub-return">—</div>
        <div class="hero-bench" id="hub-bench" hidden></div>
      </section>
      <section class="block readiness" id="hub-readiness"></section>
    </div>
    ${opts.renderLongTerm ? '<div class="hub-panel" data-hub-panel="longterm"></div>' : ''}`;
  attachCoinLogoFallback(container);

  const overviewPanel = container.querySelector<HTMLElement>('[data-hub-panel="overview"]')!;
  const historyChartSlot = container.querySelector<HTMLElement>('#hub-history-chart')!;
  const historyListEl = container.querySelector<HTMLElement>('#hub-history-list')!;
  const marketPanel = container.querySelector<HTMLElement>('[data-hub-panel="market"]')!;
  const returnEl = container.querySelector<HTMLElement>('#hub-return')!;
  const benchEl = container.querySelector<HTMLElement>('#hub-bench')!;
  const readinessEl = container.querySelector<HTMLElement>('#hub-readiness')!;
  const longTermPanel = container.querySelector<HTMLElement>('[data-hub-panel="longterm"]');

  const historyChart = mountEquityChartPanel(historyChartSlot, { currencySymbol: opts.currencySymbol });

  let marketMounted = false;
  let marketHandle: ViewHandle | void;
  let longTermMounted = false;
  let longTermHandle: ViewHandle | void;
  const overviewHandle = opts.renderOverview(overviewPanel);

  function renderHistoryList(state: CloudState): void {
    historyChart.setHistory(state.equityHistory);
    if (state.history.length === 0) {
      historyListEl.innerHTML = '<div class="empty">No trades yet.</div>';
      return;
    }
    historyListEl.innerHTML = '';
    for (const t of state.history) {
      const buy = t.kind === 'buy';
      const row = el('div', `row trade ${t.kind}`);
      row.innerHTML = `
        <div class="row-main">${completedLogoHtml(baseCodeFromSymbol(t.symbol))}
          <div><div class="row-title"><span class="pill ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span> ${t.symbol}</div>
            <div class="row-sub">${t.note ? t.note : buy ? 'opened' : 'closed'}</div></div></div>
        <div class="row-side"><span class="row-title">${money(t.price)}</span>
          <span class="row-sub">${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>
          <span class="row-sub">${new Date(t.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`;
      historyListEl.appendChild(row);
    }
  }

  function renderProfit(state: CloudState): void {
    const equity = state.equityHistory.at(-1)?.equity ?? state.cash;
    const totalReturn = state.initialCash > 0 ? ((equity - state.initialCash) / state.initialCash) * 100 : 0;
    returnEl.textContent = formatPct(totalReturn);
    returnEl.className = `hero-value ${totalReturn >= 0 ? 'up' : 'down'}`;

    if (opts.showBenchmark && state.benchmark && state.benchmark.btc > 0 && state.benchmark.equity > 0) {
      const bot = ((equity - state.benchmark.equity) / state.benchmark.equity) * 100;
      benchEl.hidden = false;
      benchEl.textContent = `vs Bitcoin — agent ${formatPct(bot)}${bot >= 0 ? ' · leading' : ''}`;
    } else {
      benchEl.hidden = true;
    }

    const r = state.readiness;
    if (!r) {
      readinessEl.innerHTML =
        `<div class="block-head"><h2>Real-money readiness</h2></div><div class="empty">Assessing the paper track record…</div>`;
      return;
    }
    const badge = r.ready
      ? `<span class="ready-badge go">READY</span>`
      : `<span class="ready-badge no">NOT READY</span>`;
    const items = r.criteria.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✗'} ${c.detail}</li>`).join('');
    readinessEl.innerHTML =
      `<div class="block-head"><h2>Real-money readiness</h2>${badge}</div><ul class="readiness-list">${items}</ul>`;
  }

  async function load(): Promise<void> {
    const state = await opts.fetchState();
    if (!state) return;
    renderHistoryList(state);
    renderProfit(state);
  }

  container.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-hub]');
    if (!btn) return;
    const tab = btn.dataset['hub'] as HubTab;
    container.querySelectorAll<HTMLElement>('.hub-tab').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    container.querySelectorAll<HTMLElement>('[data-hub-panel]').forEach((p) => {
      p.classList.toggle('active', p.dataset['hubPanel'] === tab);
    });
    if (tab === 'market' && !marketMounted) {
      marketHandle = opts.renderMarket(marketPanel) ?? undefined;
      marketMounted = true;
    }
    if (tab === 'longterm' && !longTermMounted && opts.renderLongTerm && longTermPanel) {
      longTermHandle = opts.renderLongTerm(longTermPanel) ?? undefined;
      longTermMounted = true;
    }
  });

  let timer = 0;
  void load();
  timer = window.setInterval(() => void load(), STATE_REFRESH_MS);

  return {
    pause: () => {
      window.clearInterval(timer);
      overviewHandle?.pause();
      marketHandle?.pause();
      longTermHandle?.pause();
    },
    resume: () => {
      void load();
      timer = window.setInterval(() => void load(), STATE_REFRESH_MS);
      overviewHandle?.resume();
      marketHandle?.resume();
      longTermHandle?.resume();
    },
  };
}
