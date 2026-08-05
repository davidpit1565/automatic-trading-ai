/**
 * Crypto — the primary crypto section (replaces the old unified "Home").
 * Overview/History/Profit read the REAL cloud robot's committed state;
 * Market reuses the existing full crypto market browser.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchCloudState } from '../cloudState';
import { renderAssetHub } from './assetHubView';
import { renderHomeView } from './homeView';
import { renderMarketsView } from './marketsView';
import type { ViewHandle } from '../viewLifecycle';

export function renderCryptoView(container: HTMLElement, data: ActiveDataSource): ViewHandle {
  return renderAssetHub(container, {
    title: 'Crypto',
    subtitle: 'The real cloud robot — SIMULATED money, matches the Telegram alerts.',
    currencySymbol: '€',
    fetchState: fetchCloudState,
    showBenchmark: true,
    renderOverview: (panel) => renderHomeView(panel, data),
    renderMarket: (panel) => renderMarketsView(panel, data),
  });
}
