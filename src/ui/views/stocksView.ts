/**
 * Stocks — the separate, isolated US-stocks paper agent (own portfolio, own
 * USD currency, own cloud state file: state/stocks-state.json). Now a
 * primary section (mirrors Crypto's Overview/History/Market/Profit shell)
 * rather than a single page tucked under Tools.
 *
 * Runs only once ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY are configured as
 * GitHub Actions secrets — until then this shows "waiting for the agent".
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchStocksState } from '../cloudState';
import { renderAssetHub } from './assetHubView';
import { renderStocksOverviewPanel } from './stocksOverviewPanel';
import { renderStocksMarketPanel } from './stocksMarketPanel';
import { renderStocksLongTermPanel } from './stocksLongTermPanel';
import type { ViewHandle } from '../viewLifecycle';

export function renderStocksView(container: HTMLElement, _data: ActiveDataSource): ViewHandle {
  return renderAssetHub(container, {
    title: 'Stocks',
    subtitle: 'Separate simulated US-stocks agent — its own portfolio, in dollars.',
    currencySymbol: '$',
    fetchState: fetchStocksState,
    showBenchmark: false,
    renderOverview: (panel) => renderStocksOverviewPanel(panel),
    renderMarket: (panel) => renderStocksMarketPanel(panel),
    renderLongTerm: (panel) => renderStocksLongTermPanel(panel),
  });
}
