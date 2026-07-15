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
// reproducible and never depend on (or hammer) live market APIs.
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

  // Tab order: Market Scan immediately before Learn.
  const tabs = await page.$$eval('.tab-button', (els) => els.map((e) => e.dataset.tab));
  check(
    'tab order scan immediately before learn',
    tabs.indexOf('scan') !== -1 && tabs[tabs.indexOf('scan') + 1] === 'learn',
  );

  // Home dashboard (default tab) renders its real-time value card.
  check('home dashboard equity card', (await page.$('#home-equity')) !== null);

  // Backtesting Lab runs and renders a comparison.
  await page.click('[data-tab="backtest"]');
  await page.waitForSelector('#bt-run', { timeout: 10000 });
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

  // PORTFOLIO — full position lifecycle through the verified pipeline.
  await page.click('[data-tab="positions"]');
  await page.waitForSelector('#pf-open', { timeout: 10000 });
  await page.waitForSelector('#pf-overview .stat-card', { timeout: 20000 });
  check(
    'portfolio overview cards rendered',
    (await page.$$('#pf-overview .stat-card')).length >= 5,
  );
  // Try each demo symbol until one qualifies end-to-end (scan->signal->risk).
  const pfSymbols = await page.$$eval('#pf-symbol option', (els) => els.map((e) => e.value));
  let pfOpened = false;
  for (const symbol of pfSymbols) {
    await page.selectOption('#pf-symbol', symbol);
    await page.click('#pf-open');
    await page.waitForFunction(
      () => {
        const t = document.querySelector('#pf-status')?.textContent ?? '';
        return t.includes('Opened') || t.includes('refused') || t.includes('no qualifying') || t.includes('No market data');
      },
      { timeout: 30000 },
    );
    const text = await page.$eval('#pf-status', (e) => e.textContent);
    if (text.includes('Opened')) {
      pfOpened = true;
      break;
    }
  }
  check('a position opened via the pipeline', pfOpened);
  await page.waitForSelector('#pf-positions tbody tr', { timeout: 20000 });
  check('open position row rendered', (await page.$$('#pf-positions tbody tr')).length >= 1);
  await page.click('[data-close-all]');
  await page.waitForSelector('#pf-journal tbody tr', { timeout: 20000 });
  check('journal entry after close', (await page.$$('#pf-journal tbody tr')).length === 1);
  await page.waitForSelector('#pf-analytics .stat-card', { timeout: 20000 });
  const analyticsText = await page.$eval('#pf-analytics', (e) => e.textContent);
  check(
    'analytics render win rate, profit factor, drawdown',
    ['Win rate', 'Profit factor', 'Max drawdown'].every((s) => analyticsText.includes(s)),
  );
  check('equity and drawdown charts rendered', (await page.$$('#pf-analytics svg')).length === 2);

  // PAPER AUTOPILOT — autonomous simulated cycle + kill switch.
  check(
    'autopilot starts stopped',
    (await page.$eval('#ap-status', (e) => e.textContent)).includes('stopped'),
  );
  await page.click('#ap-cycle');
  await page.waitForFunction(
    () => document.querySelector('#ap-status')?.textContent?.includes('Last cycle'),
    { timeout: 60000 },
  );
  const apStatus = await page.$eval('#ap-status', (e) => e.textContent);
  check('autopilot cycle reports actions', /opened \d+ \/ closed \d+/.test(apStatus));
  await page.waitForSelector('#ap-audit tbody tr', { timeout: 20000 });
  check('audit log populated', (await page.$$('#ap-audit tbody tr')).length > 0);
  await page.click('#ap-kill');
  check(
    'kill switch halts automation',
    (await page.$eval('#ap-status', (e) => e.textContent)).includes('KILL SWITCH ENGAGED'),
  );
  await page.click('#ap-kill'); // disengage for a clean state
  check(
    'kill switch disengages explicitly',
    !(await page.$eval('#ap-status', (e) => e.textContent)).includes('KILL SWITCH'),
  );

  // MONITORING — manual scan through the full pipeline.
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
