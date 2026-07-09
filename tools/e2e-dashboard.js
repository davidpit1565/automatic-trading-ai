/*
 * End-to-end dashboard test: loads the built dashboard/index.html in
 * headless Chromium and asserts every tab renders with real content and
 * zero JS errors. Run: NODE_PATH=$(npm root -g) node tools/e2e-dashboard.js
 */
const path = require('path');
const { chromium } = require('playwright');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const file = 'file://' + path.join(__dirname, '..', 'dashboard', 'index.html');
  await page.goto(file);
  await page.waitForTimeout(600);

  // Market Scan: 8 clickable rows, detail opens
  check('scan: 8 rows', await page.locator('#scan-table tr.clickable').count() === 8);
  await page.click('#scan-table tr.clickable');
  await page.waitForTimeout(300);
  check('scan: detail renders readings', await page.locator('#scan-detail .reading').count() >= 6);

  // Signals: 8 cards, direction chip + confidence on each
  await page.click('.tabs button[data-tab="signals"]');
  await page.waitForTimeout(300);
  check('signals: 8 cards', await page.locator('.sig-card').count() === 8);
  check('signals: every card has a direction', await page.locator('.sig-card .dir').count() === 8);
  check('signals: honest summary present', /quality gates/.test(await page.locator('#sg-output').innerText()));

  // Validation: verdict + per-window table
  await page.click('.tabs button[data-tab="validate"]');
  await page.waitForTimeout(400);
  const vlText = await page.locator('#vl-output').innerText();
  check('validation: verdict rendered', /(REJECTED|CAUTION|ACCEPTABLE)/.test(vlText));
  check('validation: window table rows', await page.locator('#vl-output tbody tr').count() >= 4);
  check('validation: benchmark shown', /hold/i.test(vlText));

  // Backtest: 3 strategies in results table
  await page.click('.tabs button[data-tab="backtest"]');
  await page.waitForTimeout(400);
  check('backtest: 3 strategy rows', await page.locator('#bt-output tbody tr').count() === 3);
  check('backtest: chart drawn', await page.locator('#bt-chart svg path').count() >= 3);

  // Grid: two comparison rows
  await page.click('.tabs button[data-tab="grid"]');
  await page.waitForTimeout(400);
  check('grid: comparison rows', await page.locator('#gr-output tbody tr').count() === 2);

  // Paper portfolio: buy works and persists in-page
  await page.click('.tabs button[data-tab="paper"]');
  await page.waitForTimeout(200);
  await page.fill('#pp-amount', '100');
  await page.click('#pp-buy');
  await page.waitForTimeout(200);
  const ppText = await page.locator('#pp-output').innerText();
  check('paper: buy recorded', /BUY/.test(ppText) && /€900/.test(ppText));

  // Dark mode renders without errors
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);

  check('no JS errors anywhere', errors.length === 0);
  if (errors.length) console.error('JS errors:\n' + errors.join('\n'));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
  process.exit(fail === 0 ? 0 : 1);
})();
