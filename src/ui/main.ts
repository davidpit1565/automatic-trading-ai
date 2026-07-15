/**
 * App bootstrap: a phone-first shell with a bottom navigation bar.
 * Primary sections (Home, Markets, History) are polished views; the
 * advanced analysis tools live under "Tools". Views render lazily; all
 * analysis lives in src/core.
 */

import { initDataSource, type ActiveDataSource } from './dataSource';
import { fetchSnapshot, findBtcSymbol } from './markets';
import { formatPrice, formatPct } from './format';
import { renderHomeView } from './views/homeView';
import { renderMarketsView } from './views/marketsView';
import { renderHistoryView } from './views/historyView';
import { renderBacktestView } from './views/backtestView';
import { renderGridView } from './views/gridView';
import { renderMarketScanView } from './views/marketScanView';
import { renderMonitoringView } from './views/monitoringView';
import { renderPortfolioView } from './views/portfolioView';
import { renderPositionsView } from './views/positionsView';
import { renderValidationView } from './views/validationView';

type ViewRenderer = (container: HTMLElement, data: ActiveDataSource) => void;

const PRIMARY_VIEWS: Record<string, ViewRenderer> = {
  home: renderHomeView,
  markets: renderMarketsView,
  history: renderHistoryView,
};

const TOOL_VIEWS: Record<string, ViewRenderer | null> = {
  backtest: renderBacktestView,
  grid: renderGridView,
  portfolio: renderPortfolioView,
  positions: renderPositionsView,
  validation: renderValidationView,
  monitoring: renderMonitoringView,
  scan: renderMarketScanView,
  learn: null,
};

function showBanner(data: ActiveDataSource): void {
  const banner = document.getElementById('data-source-banner');
  if (!banner) return;
  banner.hidden = false;
  if (data.kind === 'revolut') {
    banner.classList.add('live');
    banner.textContent = `Connected to ${data.source.name} — live data, read-only.`;
  } else if (data.kind === 'public') {
    banner.classList.add('live');
    banner.textContent = `Live market data (${data.source.name.replace(' (read-only)', '')}) — read-only.`;
  } else {
    const reasons = data.diagnostics.length > 0 ? ` [${data.diagnostics.join(' · ')}]` : '';
    banner.textContent = `Live data unavailable — showing DEMO data, not real prices.${reasons}`;
  }
}

async function bootstrap(): Promise<void> {
  const data = await initDataSource();
  showBanner(data);

  const primaryMounted = new Set<string>();
  const toolsMounted = new Set<string>();

  function activateView(name: string): void {
    document.querySelectorAll<HTMLElement>('.view').forEach((v) => {
      v.classList.toggle('active', v.id === `view-${name}`);
    });
    document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset['nav'] === name);
    });
    const renderer = PRIMARY_VIEWS[name];
    if (renderer && !primaryMounted.has(name)) {
      const panel = document.getElementById(`view-${name}`);
      if (panel) {
        renderer(panel, data);
        primaryMounted.add(name);
      }
    }
    if (name === 'tools') resetTools();
    window.scrollTo({ top: 0 });
  }

  function resetTools(): void {
    const menu = document.getElementById('tools-menu');
    const detail = document.getElementById('tool-detail');
    if (menu) menu.hidden = false;
    if (detail) detail.hidden = true;
  }

  function openTool(tab: string): void {
    const menu = document.getElementById('tools-menu');
    const detail = document.getElementById('tool-detail');
    if (menu) menu.hidden = true;
    if (detail) detail.hidden = false;
    document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tab}`);
    });
    const renderer = TOOL_VIEWS[tab];
    if (renderer && !toolsMounted.has(tab)) {
      const panel = document.getElementById(`tab-${tab}`);
      if (panel) {
        renderer(panel, data);
        toolsMounted.add(tab);
      }
    }
    window.scrollTo({ top: 0 });
  }

  // Delegated navigation: bottom-nav buttons and any [data-nav] link in views.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const nav = target.closest<HTMLElement>('[data-nav]');
    if (nav) {
      activateView(nav.dataset['nav']!);
      return;
    }
    const tool = target.closest<HTMLElement>('[data-tab]');
    if (tool) {
      openTool(tool.dataset['tab']!);
      return;
    }
    if (target.closest('[data-tool-back]')) resetTools();
  });

  activateView('home');
  void mountTopbarBtc(data);
}

/** Always-visible live Bitcoin chip in the top bar. */
async function mountTopbarBtc(data: ActiveDataSource): Promise<void> {
  const chip = document.getElementById('topbar-btc');
  if (!chip) return;
  const symbol = findBtcSymbol(data);
  if (!symbol) return;
  async function tick(): Promise<void> {
    const snap = await fetchSnapshot(data, symbol!, 'Bitcoin');
    if (!snap || !chip) return;
    const up = snap.changePct >= 0;
    chip.hidden = false;
    chip.innerHTML = `<span class="tb-label">BTC</span><span class="tb-price">€${formatPrice(snap.price)}</span><span class="chg ${up ? 'up' : 'down'}">${formatPct(snap.changePct)}</span>`;
  }
  await tick();
  window.setInterval(() => void tick(), 20_000);
}

void bootstrap();
