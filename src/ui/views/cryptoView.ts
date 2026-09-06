/**
 * Crypto — the primary crypto section (replaces the old unified "Home").
 * Overview/History/Profit read the REAL cloud agent's committed state;
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
    subtitle: 'The real cloud agent — SIMULATED money, matches the Telegram alerts.',
    // Found in the 2026-09-06 readiness/kill-switch audit: this subtitle
    // renders on every sub-tab of this screen, including Overview and
    // Profit, which is where the REAL-money hero has lived since real money
    // went live 2026-09-03 — "SIMULATED money" directly under a real-money
    // balance is exactly the kind of real-vs-simulated confusion this audit
    // was asked to hunt for.
    liveSubtitle: 'The real cloud agent — REAL money is live here. The simulated paper agent keeps running underneath but is no longer the primary account shown.',
    currencySymbol: '€',
    fetchState: fetchCloudState,
    showBenchmark: true,
    renderOverview: (panel) => renderHomeView(panel, data),
    renderMarket: (panel) => renderMarketsView(panel, data),
  });
}
