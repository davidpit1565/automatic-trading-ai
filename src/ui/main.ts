/**
 * Dashboard bootstrap: tab switching and view mounting. Views render lazily
 * on first activation; all analysis lives in src/core.
 */

import { initDataSource, type ActiveDataSource } from './dataSource';
import { renderBacktestView } from './views/backtestView';
import { renderGridView } from './views/gridView';
import { renderMarketScanView } from './views/marketScanView';
import { renderPortfolioView } from './views/portfolioView';

type ViewRenderer = (container: HTMLElement, data: ActiveDataSource) => void;

const VIEWS: Record<string, ViewRenderer | null> = {
  backtest: renderBacktestView,
  grid: renderGridView,
  portfolio: renderPortfolioView,
  scan: renderMarketScanView,
  learn: null, // static content in index.html
};

async function bootstrap(): Promise<void> {
  const data = await initDataSource();

  const banner = document.getElementById('data-source-banner');
  if (banner) {
    banner.hidden = false;
    if (data.isLive) {
      banner.classList.add('live');
      banner.textContent = `Connected to ${data.source.name} — live market data, read-only.`;
    } else {
      banner.textContent =
        'Live market data unavailable — showing deterministic DEMO data. ' +
        'Nothing on this screen reflects real market prices.';
    }
  }

  const mounted = new Set<string>();

  function activate(tabId: string): void {
    document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach((button) => {
      button.classList.toggle('active', button.dataset['tab'] === tabId);
    });
    document.querySelectorAll<HTMLElement>('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    const renderer = VIEWS[tabId];
    if (renderer && !mounted.has(tabId)) {
      const panel = document.getElementById(`tab-${tabId}`);
      if (panel) {
        renderer(panel, data);
        mounted.add(tabId);
      }
    }
  }

  document.querySelectorAll<HTMLButtonElement>('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset['tab'];
      if (tab) activate(tab);
    });
  });

  activate('backtest');
}

void bootstrap();
