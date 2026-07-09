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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
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

  // Tab order: Market Scan immediately before Learn.
  const tabs = await page.$$eval('.tab-button', (els) => els.map((e) => e.dataset.tab));
  check(
    'tab order scan immediately before learn',
    tabs.indexOf('scan') !== -1 && tabs[tabs.indexOf('scan') + 1] === 'learn',
  );

  // Backtesting Lab (default tab) runs and renders a comparison.
  await page.click('#bt-run');
  await page.waitForSelector('#bt-results table', { timeout: 20000 });
  check('backtest comparison rows', (await page.$$('#bt-results tbody tr')).length >= 3);

  // Grid Simulation.
  await page.click('[data-tab="grid"]');
  await page.click('#grid-run');
  await page.waitForSelector('#grid-results .stat-card', { timeout: 20000 });
  check('grid result cards', (await page.$$('#grid-results .stat-card')).length >= 4);

  // Paper Portfolio: buy, then a position row must appear.
  await page.click('[data-tab="portfolio"]');
  await page.waitForSelector('#pp-buy', { timeout: 10000 });
  await page.click('#pp-buy');
  await page.waitForSelector('#pp-positions table', { timeout: 20000 });
  check('paper portfolio position row', (await page.$$('#pp-positions tbody tr')).length === 1);

  // MARKET SCAN — full interaction.
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

  await scanRows[0].click();
  check('detail collapses on second click', await page.$eval('.scan-detail', (e) => e.hidden));
} finally {
  await browser.close();
}

console.log(failures.length === 0 ? '\nE2E OK' : `\nE2E FAILED: ${failures.join(' | ')}`);
process.exit(failures.length === 0 ? 0 : 1);
