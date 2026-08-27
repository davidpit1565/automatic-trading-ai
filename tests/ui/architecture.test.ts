/**
 * Architecture rules, enforced as tests.
 *
 * The UI layer is presentation only: it must consume the verified core
 * modules (Market Scanner, backtesting, strategies, portfolio, data layer)
 * and must never re-implement or directly invoke indicator mathematics —
 * indicator access happens exclusively through the core layers.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const uiDir = join(root, 'src/ui');

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? collectFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const uiSources = collectFiles(uiDir)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({ file: file.slice(root.length + 1), text: readFileSync(file, 'utf8') }));

describe('UI layer architecture', () => {
  it('found UI sources to check', () => {
    expect(uiSources.length).toBeGreaterThanOrEqual(5);
  });

  it('never imports the indicator engine directly', () => {
    for (const { file, text } of uiSources) {
      expect(text, `${file} must not import core/indicators`).not.toMatch(
        /from\s+['"][^'"]*core\/indicators/,
      );
    }
  });

  it('never calls indicator functions or re-implements indicator math', () => {
    // Indicator engine entry points; any call in UI code means duplicated analysis.
    const forbiddenCalls =
      /\b(sma|ema|rsi|macd|bollinger|atr|adx|stochastic|obv|relativeVolume|volumeSma|trueRange)\s*\(/;
    for (const { file, text } of uiSources) {
      expect(text, `${file} must not perform indicator calculations`).not.toMatch(forbiddenCalls);
    }
  });

  it('only imports from the verified core layers or sibling UI modules', () => {
    const importPattern = /from\s+['"]([^'"]+)['"]/g;
    const allowed = [
      /^\.{1,2}\/(?!\.)/, // relative UI-internal imports
      /core\/scan\/marketScanner$/,
      /core\/signal\/signalEngine$/,
      /core\/risk\/(riskEngine|dailyLoss)$/,
      /core\/validation\/(walkForward|robustness|performance)$/,
      /core\/backtest\/metrics$/,
      /core\/monitor\/(monitoringEngine|scheduler|watchlist|opportunityLog|alerts|validationProvider)$/,
      /core\/position\/(positionEngine|portfolioEngine|tradeJournal|analytics|positionMonitor)$/,
      /core\/autopilot\/(paperAutoPilot|killSwitch|auditLog)$/,
      /core\/feedback\/performanceFeedback$/,
      /core\/data\/backup$/,
      /core\/backtest\/engine$/,
      /core\/strategies$/,
      /core\/portfolio\/paperPortfolio$/,
      /core\/data\/(revolutClient|storage|synthetic|alpacaStocks|krakenPublic)$/,
      /core\/types$/,
      /^@vercel\/analytics$/, // Vercel Web Analytics integration
    ];
    for (const { file, text } of uiSources) {
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[1]!;
        const ok = allowed.some((pattern) => pattern.test(specifier));
        expect(ok, `${file} imports unexpected module '${specifier}'`).toBe(true);
      }
    }
  });

  it('the Market Scan view consumes the verified scanner', () => {
    const view = uiSources.find(({ file }) => file.endsWith('marketScanView.ts'));
    expect(view).toBeDefined();
    expect(view!.text).toMatch(/import\s+\{[^}]*\bscanMarket\b[^}]*\}\s+from\s+['"].*core\/scan\/marketScanner['"]/);
  });
});

describe('core layering', () => {
  it('the indicator engine imports nothing above the data layer', () => {
    const indicatorFiles = collectFiles(join(root, 'src/core/indicators'));
    for (const file of indicatorFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} must not depend on higher layers`).not.toMatch(
        /from\s+['"][^'"]*(strategies|backtest|scan|portfolio|ui)\//,
      );
    }
  });

  it('the scanner uses the indicator engine (single source of indicator math)', () => {
    const scanner = readFileSync(join(root, 'src/core/scan/marketScanner.ts'), 'utf8');
    expect(scanner).toMatch(/from\s+['"]\.\.\/indicators['"]/);
  });

  it('the risk engine consumes Signal Engine output only — no indicators, no market data', () => {
    const riskFiles = collectFiles(join(root, 'src/core/risk'));
    for (const file of riskFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} must not reach below the Signal Engine`).not.toMatch(
        /from\s+['"][^'"]*(indicators|scan|strategies|backtest|revolutClient|synthetic)/,
      );
    }
  });

  it('the execution contracts stay implementation-free with no I/O', () => {
    const execution = readFileSync(join(root, 'src/core/execution/types.ts'), 'utf8');
    // No network access, no broker code, no implementations — contracts only.
    expect(execution).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    expect(execution).not.toMatch(/\bclass\s+\w/);
    expect(execution).not.toMatch(/function\s+\w+\s*\(/); // no function bodies
    expect(execution).not.toMatch(/from\s+['"][^'"]*data\//); // no data-layer imports
    // Only the paper autopilot may implement the contracts today.
    const srcFiles = collectFiles(join(root, 'src')).filter(
      (f) => f.endsWith('.ts') && !f.includes('core/execution') && !f.includes('core/autopilot'),
    );
    for (const file of srcFiles) {
      expect(
        readFileSync(file, 'utf8'),
        `${file} must not import the execution layer`,
      ).not.toMatch(/from\s+['"][^'"]*core\/execution/);
    }
  });

  it('automation is paper-only: no live broker path exists anywhere', () => {
    const autopilotFiles = collectFiles(join(root, 'src/core/autopilot'));
    for (const file of autopilotFiles) {
      const text = readFileSync(file, 'utf8');
      // Paper mode is declared as a literal; the string 'live' never appears
      // as an execution mode value in the autopilot layer.
      expect(text, `${file} must never reference live mode`).not.toMatch(/['"]live['"]/);
      expect(text, `${file} must not talk to brokers or the network`).not.toMatch(
        /\bfetch\s*\(|BrokerAdapter|placeOrder|submitOrder/,
      );
    }
    // Stage 6 in progress (2026-08-27, David asked to start building it):
    // exactly ONE file may implement BrokerAdapter today —
    // src/core/execution/paperBrokerAdapter.ts, a paper-only, no-network
    // simulator built to prove the OrderIntent state machine end-to-end
    // before any real broker exists. It is never imported by
    // paperAutoPilot.ts (checked above: that file has no BrokerAdapter
    // reference at all) — building it does not wire it into the currently
    // running autonomous paper autopilot. A REAL broker adapter (Revolut X
    // or otherwise) must still not exist anywhere until David explicitly
    // provides real, separately-scoped API credentials for it.
    const PAPER_BROKER_ADAPTER_PATH = join(root, 'src/core/execution/paperBrokerAdapter.ts');
    for (const file of collectFiles(join(root, 'src')).filter((f) => f.endsWith('.ts'))) {
      if (file === PAPER_BROKER_ADAPTER_PATH) continue;
      expect(
        readFileSync(file, 'utf8'),
        `${file} must not implement a broker adapter before Stage 6`,
      ).not.toMatch(/implements\s+BrokerAdapter/);
    }
    // The one allowed implementation must itself stay paper-only: no network
    // I/O, no real broker SDK, mode fixed to 'paper'.
    const paperBroker = readFileSync(PAPER_BROKER_ADAPTER_PATH, 'utf8');
    expect(paperBroker).toMatch(/implements\s+BrokerAdapter/);
    expect(paperBroker, 'the paper broker adapter must not do real network I/O').not.toMatch(
      /\bfetch\s*\(|XMLHttpRequest|WebSocket/,
    );
    expect(paperBroker, "the paper broker adapter's mode must be fixed to 'paper'").toMatch(
      /mode\s*=\s*['"]paper['"]/,
    );
    // The autopilot opens positions only through risk-approved proposals.
    const pilot = readFileSync(join(root, 'src/core/autopilot/paperAutoPilot.ts'), 'utf8');
    expect(pilot).toContain('openFromAssessment');
    expect(pilot).toMatch(/killSwitch\.isEngaged\(\)/);
  });

  it('the validation harness reuses the backtest engine rather than re-simulating', () => {
    const walkForwardSource = readFileSync(join(root, 'src/core/validation/walkForward.ts'), 'utf8');
    expect(walkForwardSource).toMatch(/from\s+['"]\.\.\/backtest\/engine['"]/);
    // No indicator math in the validation layer either.
    const validationFiles = collectFiles(join(root, 'src/core/validation'));
    for (const file of validationFiles) {
      expect(readFileSync(file, 'utf8'), `${file} must not import indicators`).not.toMatch(
        /from\s+['"][^'"]*\/indicators/,
      );
    }
  });

  it('the monitoring engine reuses the verified pipeline and adds no analysis of its own', () => {
    const engine = readFileSync(join(root, 'src/core/monitor/monitoringEngine.ts'), 'utf8');
    // Must consume scanner, signal, and risk engines...
    expect(engine).toMatch(/from\s+['"]\.\.\/scan\/marketScanner['"]/);
    expect(engine).toMatch(/from\s+['"]\.\.\/signal\/signalEngine['"]/);
    expect(engine).toMatch(/from\s+['"]\.\.\/risk\/riskEngine['"]/);
    // ...and never the indicator engine directly (no duplicated calculations).
    const monitorFiles = collectFiles(join(root, 'src/core/monitor'));
    for (const file of monitorFiles) {
      expect(readFileSync(file, 'utf8'), `${file} must not import indicators`).not.toMatch(
        /from\s+['"][^'"]*\/indicators/,
      );
    }
    // Timers stay behind the Scheduler abstraction — no setInterval in the engine.
    expect(engine).not.toMatch(/setInterval|setTimeout/);
    // Analysis only: no broker/order code anywhere in the monitor layer.
    for (const file of monitorFiles) {
      expect(readFileSync(file, 'utf8'), `${file} must have no execution capability`).not.toMatch(
        /placeOrder|submitOrder|core\/execution/,
      );
    }
  });

  it('the position layer consumes trade proposals and never analyses or executes', () => {
    const positionFiles = collectFiles(join(root, 'src/core/position'));
    for (const file of positionFiles) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} must not import indicators`).not.toMatch(
        /from\s+['"][^'"]*\/indicators/,
      );
      expect(text, `${file} must not fetch market data`).not.toMatch(
        /revolutClient|synthetic|\bfetch\s*\(/,
      );
      expect(text, `${file} must have no execution capability`).not.toMatch(
        /placeOrder|submitOrder|core\/execution/,
      );
    }
    // Analytics reuses verified math instead of duplicating it.
    const analytics = readFileSync(join(root, 'src/core/position/analytics.ts'), 'utf8');
    expect(analytics).toMatch(/from\s+['"]\.\.\/validation\/performance['"]/);
    expect(analytics).toMatch(/maxDrawdownPct/);
    // Positions open only from Risk Engine assessments.
    const engine = readFileSync(join(root, 'src/core/position/positionEngine.ts'), 'utf8');
    expect(engine).toContain('openFromAssessment');
  });

  it('the feedback layer reads the journal only — no market data, no indicators', () => {
    const feedback = readFileSync(join(root, 'src/core/feedback/performanceFeedback.ts'), 'utf8');
    expect(feedback).not.toMatch(/from\s+['"][^'"]*(indicators|revolutClient|synthetic|scan\/)/);
    expect(feedback).not.toMatch(/\bfetch\s*\(/);
    // Reuses verified analytics instead of duplicating trade math.
    expect(feedback).toMatch(/from\s+['"]\.\.\/position\/analytics['"]/);
  });

  it('fetch is never used unbound — WebKit throws "Can only call Window.fetch"', () => {
    // `options.fetchFn ?? fetch` stores an unbound reference; calling it as
    // this.fetchFn(...) sets `this` to the client instance, which iOS Safari
    // rejects. Defaults must wrap: `?? ((input, init) => fetch(input, init))`.
    for (const file of collectFiles(join(root, 'src')).filter((f) => f.endsWith('.ts'))) {
      expect(readFileSync(file, 'utf8'), `${file} assigns unbound fetch`).not.toMatch(
        /\?\?\s*fetch\s*[;,)]/,
      );
    }
  });

  it('position sizing lives in the Risk Engine, not the Signal Engine', () => {
    const signal = readFileSync(join(root, 'src/core/signal/signalEngine.ts'), 'utf8');
    expect(signal).not.toMatch(/function\s+positionSize|export.*positionSize/);
    const riskEngine = readFileSync(join(root, 'src/core/risk/riskEngine.ts'), 'utf8');
    expect(riskEngine).toContain('export function calculatePositionSize');
  });
});
