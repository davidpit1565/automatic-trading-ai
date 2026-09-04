/**
 * End-to-end smoke test.
 *
 * Builds are served separately (npm run preview); this script drives a real
 * Chromium through every dashboard tab and the full Market Scan interaction.
 *
 * Usage:
 *   npm run build && npm run preview &   # serve dist on :4173
 *   npm run test:e2e                     # this script
 *
 * CHROMIUM_PATH overrides the browser binary (defaults to the Playwright
 * browsers dir if set, else Playwright's own resolution).
 */

import { chromium } from 'playwright-core';

// ?demo=1 forces the deterministic synthetic data source so e2e runs are
// reproducible and never depend on (or hammer) live market APIs. Note that
// the crypto/stocks hub's Overview/History/Profit sub-tabs are a partial
// exception: they read the REAL committed cloud-agent state from a public
// raw.githubusercontent.com URL (see src/ui/cloudState.ts) regardless of
// ?demo=1, so checks touching them only assert structure, never fetched
// content, to stay reliable without live network access.
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4173/?demo=1';
const executablePath =
  process.env.CHROMIUM_PATH ??
  (process.env.PLAYWRIGHT_BROWSERS_PATH
    ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`
    : undefined);

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage();
const failures = [];
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}`);
  if (!condition) failures.push(name);
};

page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('page title', (await page.title()) === 'AI Trading Assistant');

  // Data source banner appears once the source resolves (live or demo).
  await page.waitForSelector('#data-source-banner:not([hidden])', { timeout: 20000 });
  const banner = (await page.textContent('#data-source-banner')).trim();
  check('data source banner visible', banner.length > 0);
  console.log('  banner:', banner.slice(0, 80));

  // Bottom navigation exposes the primary sections.
  const navs = await page.$$eval('.nav-btn', (els) => els.map((e) => e.dataset.nav));
  check(
    'bottom nav has crypto/stocks/markets/tools',
    ['crypto', 'stocks', 'markets', 'tools'].every((n) => navs.includes(n)),
  );

  // Crypto is the default view — its Overview sub-tab renders the real cloud
  // agent's equity card (matches the Telegram alerts, see assetHubView.ts).
  await page.click('[data-nav="crypto"]');
  await page.waitForSelector('#hv-equity', { timeout: 10000 });
  check('crypto overview equity card', (await page.$('#hv-equity')) !== null);

  // Markets view (top-level nav) mounts the full market browser.
  await page.click('[data-nav="markets"]');
  await page.waitForSelector('#mk-list', { timeout: 10000 });
  check('markets view rendered', (await page.$('#mk-list')) !== null);

  // History is now a sub-tab inside the Crypto asset hub, not a top-level nav
  // destination (see assetHubView.ts). Its content lands in #hub-history-list.
  await page.click('[data-nav="crypto"]');
  await page.click('[data-hub="history"]');
  await page.waitForSelector('#hub-history-list', { timeout: 10000 });
  check('crypto history sub-tab rendered', (await page.$('#hub-history-list')) !== null);

  // Backtesting Lab runs and renders a comparison (via Tools).
  await page.click('[data-nav="tools"]');
  await page.click('[data-tab="backtest"]');
  await page.waitForSelector('#bt-run', { timeout: 10000 });
  await page.click('#bt-run');
  await page.waitForSelector('#bt-results table', { timeout: 20000 });
  check('backtest comparison rows', (await page.$$('#bt-results tbody tr')).length >= 3);

  // Grid Simulation.
  await page.click('[data-nav="tools"]');
  await page.click('[data-tab="grid"]');
  await page.click('#grid-run');
  await page.waitForSelector('#grid-results .stat-tile', { timeout: 20000 });
  check('grid result tiles', (await page.$$('#grid-results .stat-tile')).length >= 4);
  check('grid equity curve rendered', (await page.$('#grid-results svg.equity-curve')) !== null);

  // Paper Portfolio: the manual buy/sell simulator (PaperPortfolio, localStorage-
  // backed). This is the only client-side portfolio panel left — the old
  // scan->signal->risk "verified pipeline" position lifecycle now runs
  // server-side (server/autopilotRunner.mts) and is exercised below via the
  // Market Scan section's Signal/Risk panels instead of an in-browser open/close
  // flow. Buy then sell the same quantity to prove the full round trip works.
  await page.click('[data-nav="tools"]');
  await page.click('[data-tab="portfolio"]');
  await page.waitForSelector('#pp-buy', { timeout: 10000 });
  await page.click('#pp-buy');
  await page.waitForSelector('#pp-positions table', { timeout: 20000 });
  check('paper portfolio position row after buy', (await page.$$('#pp-positions tbody tr')).length === 1);
  await page.click('#pp-sell');
  await page.waitForFunction(
    () => (document.querySelector('#pp-positions')?.textContent ?? '').includes('No open positions'),
    { timeout: 20000 },
  );
  check('paper portfolio position closed after sell', (await page.$$('#pp-positions tbody tr')).length === 0);
  check('trade journal recorded buy and sell', (await page.$$('#pp-trades tbody tr')).length === 2);

  // CLOUD AUTOPILOT — the old in-browser "Paper Autopilot" panel (manual
  // cycle button + kill switch) no longer exists: the autonomous cycle now
  // runs on a schedule server-side (server/autopilotRunner.mts via
  // .github/workflows/autopilot.yml) and commits its state to
  // state/autopilot-state.json. The SPA only displays that committed state,
  // read-only, in the Crypto hub's Overview/History/Profit sub-tabs. Assert
  // structure only (see BASE comment above) — the fetch itself is live network.
  await page.click('[data-nav="crypto"]');
  await page.click('[data-hub="profit"]');
  await page.waitForSelector('#hub-return', { timeout: 10000 });
  check('cloud autopilot return card rendered', (await page.$('#hub-return')) !== null);
  check('cloud autopilot readiness panel rendered', (await page.$('#hub-readiness')) !== null);

  // MONITORING — manual scan through the full pipeline.
  await page.click('[data-nav="tools"]');
  await page.click('[data-tab="monitoring"]');
  await page.waitForSelector('#mon-scan-now', { timeout: 10000 });
  check(
    'monitoring starts stopped',
    (await page.$eval('#mon-status', (e) => e.textContent)).includes('stopped'),
  );
  await page.click('#mon-start');
  check(
    'monitoring scheduler starts',
    (await page.$eval('#mon-status', (e) => e.textContent)).includes('RUNNING'),
  );
  await page.click('#mon-scan-now');
  await page.waitForFunction(
    () => document.querySelector('#mon-status')?.textContent?.includes('Last scan'),
    { timeout: 60000 },
  );
  const monStatus = await page.$eval('#mon-status', (e) => e.textContent);
  check('monitoring scan reports outcome counts', /qualified/.test(monStatus));
  check('monitoring shows next scan time', monStatus.includes('Next scan'));
  check(
    'watchlist populated by scan',
    (await page.$$('#mon-watchlist tbody tr')).length > 0,
  );
  await page.click('#mon-stop');
  check(
    'monitoring stops cleanly',
    (await page.$eval('#mon-status', (e) => e.textContent)).includes('stopped'),
  );

  // VALIDATION — walk-forward with costs on demo data.
  await page.click('[data-nav="tools"]');
  await page.click('[data-tab="validation"]');
  await page.waitForSelector('#val-run', { timeout: 10000 });
  await page.click('#val-run');
  await page.waitForSelector('#val-results .verdict-panel', { timeout: 60000 });
  const verdictClass = await page.$eval('#val-results .verdict-panel', (e) => e.className);
  check(
    'validation verdict rendered',
    /verdict-(robust|caution|overfitted|insufficient-data)/.test(verdictClass),
  );
  check('oos equity curve rendered', (await page.$$('#val-results svg.equity-curve')).length === 1);
  check(
    'walk-forward fold table rendered',
    (await page.$$('#val-results tbody tr')).length >= 3,
  );
  const valText = await page.$eval('#val-results', (e) => e.textContent);
  check('validation shows train vs unseen comparison', valText.includes('unseen'));
  check('no certainty language in validation', !/guaranteed|certain profit/i.test(valText));

  // MARKET SCAN — full interaction.
  await page.click('[data-nav="tools"]');
  await page.click('[data-tab="scan"]');
  await page.waitForSelector('#scan-run', { timeout: 10000 });
  await page.click('#scan-run');
  await page.waitForSelector('#scan-results table', { timeout: 30000 });
  const scanRows = await page.$$('.scan-row');
  check('scan rows rendered', scanRows.length >= 5);

  const badges = await page.$$eval('.scan-row .badge', (els) => els.map((e) => e.className));
  check('every row has a temperature badge', badges.length === scanRows.length);
  check('badges are hot/cold/neutral', badges.every((c) => /badge-(hot|cold|neutral)/.test(c)));

  const scores = await page.$$eval('.scan-row td:nth-child(7)', (els) =>
    els.map((e) => Number(e.textContent)),
  );
  check('rows sorted by score desc', scores.every((s, i) => i === 0 || scores[i - 1] >= s));

  check('detail hidden before click', await page.$eval('.scan-detail', (e) => e.hidden));
  await scanRows[0].click();
  check('detail visible after click', !(await page.$eval('.scan-detail', (e) => e.hidden)));
  check('component breakdown rendered', (await page.$$('.scan-detail .scan-component')).length >= 4);

  // Signal Engine panel present in every detail row, and honest about uncertainty.
  const panels = await page.$$eval('.scan-detail .signal-panel', (els) =>
    els.map((e) => e.textContent),
  );
  check('signal panel in every detail row', panels.length === scanRows.length);
  check(
    'signal panels are decisions (setup or explained pass)',
    panels.every((t) => t.includes('LONG setup') || t.includes('no qualifying setup')),
  );
  check(
    'no promises of profit anywhere',
    panels.every((t) => !/guaranteed|certain profit|will rise/i.test(t)),
  );

  // Risk Engine verdicts: every LONG setup gets one; refusals explain themselves.
  const setupCount = panels.filter((t) => t.includes('LONG setup')).length;
  const riskPanels = await page.$$eval('.scan-detail .risk-panel', (els) =>
    els.map((e) => ({ cls: e.className, text: e.textContent })),
  );
  check('risk verdict for every qualifying setup', riskPanels.length === setupCount);
  check(
    'risk verdicts are approved-with-sizing or refused-with-reasons',
    riskPanels.every(
      (p) =>
        (p.cls.includes('risk-approved') && p.text.includes('Size')) ||
        (p.cls.includes('risk-refused') && p.text.includes('protect the portfolio')),
    ),
  );

  await scanRows[0].click();
  check('detail collapses on second click', await page.$eval('.scan-detail', (e) => e.hidden));
} finally {
  await browser.close();
}

console.log(failures.length === 0 ? '\nE2E OK' : `\nE2E FAILED: ${failures.join(' | ')}`);
process.exit(failures.length === 0 ? 0 : 1);
