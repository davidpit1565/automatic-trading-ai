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
import { renderValueView } from './views/valueView';
import { renderBacktestView } from './views/backtestView';
import { renderGridView } from './views/gridView';
import { renderMarketScanView } from './views/marketScanView';
import { renderMonitoringView } from './views/monitoringView';
import { renderPortfolioView } from './views/portfolioView';
import { renderPositionsView } from './views/positionsView';
import { renderValidationView } from './views/validationView';
import type { ViewHandle } from './viewLifecycle';
import { showToast, showSuccess, showError, showInfo, showWarning } from './toastNotifications';
import {
  showLoadingOverlay,
  hideLoadingOverlay,
  createLoadingSpinner,
  showEmptyState,
} from './loadingStates';

// Export UI helpers globally for view code
declare global {
  interface Window {
    toast: {
      show: typeof showToast;
      success: typeof showSuccess;
      error: typeof showError;
      info: typeof showInfo;
      warning: typeof showWarning;
    };
    loading: {
      show: typeof showLoadingOverlay;
      hide: typeof hideLoadingOverlay;
      spinner: typeof createLoadingSpinner;
      empty: typeof showEmptyState;
    };
  }
}

type ViewRenderer = (container: HTMLElement, data: ActiveDataSource) => ViewHandle | void;

const PRIMARY_VIEWS: Record<string, ViewRenderer> = {
  home: renderHomeView,
  value: renderValueView,
  markets: renderMarketsView,
  history: renderHistoryView,
};

const TOOL_VIEWS: Record<string, ViewRenderer | null> = {
  scan: renderMarketScanView,
  backtest: renderBacktestView,
  validation: renderValidationView,
  portfolio: renderPortfolioView,
  grid: renderGridView,
  monitoring: renderMonitoringView,
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
  // Setup global UI helpers
  window.toast = {
    show: showToast,
    success: showSuccess,
    error: showError,
    info: showInfo,
    warning: showWarning,
  };
  window.loading = {
    show: showLoadingOverlay,
    hide: hideLoadingOverlay,
    spinner: createLoadingSpinner,
    empty: showEmptyState,
  };

  const data = await initDataSource();
  showBanner(data);

  const primaryMounted = new Set<string>();
  const toolsMounted = new Set<string>();
  const primaryHandles = new Map<string, ViewHandle>();
  let activeName: string | null = null;

  function activateView(name: string): void {
    document.querySelectorAll<HTMLElement>('.view').forEach((v) => {
      v.classList.toggle('active', v.id === `view-${name}`);
    });
    document.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset['nav'] === name);
    });
    if (activeName && activeName !== name) primaryHandles.get(activeName)?.pause();
    const renderer = PRIMARY_VIEWS[name];
    if (renderer) {
      const panel = document.getElementById(`view-${name}`);
      if (panel) {
        if (!primaryMounted.has(name)) {
          const handle = renderer(panel, data);
          if (handle) primaryHandles.set(name, handle);
          primaryMounted.add(name);
        } else {
          primaryHandles.get(name)?.resume();
        }
      }
    }
    activeName = name;
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
    const themeBtn = target.closest<HTMLElement>('#theme-toggle');
    if (themeBtn) {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
    }
  });

  // Initialize theme from localStorage
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  }

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
