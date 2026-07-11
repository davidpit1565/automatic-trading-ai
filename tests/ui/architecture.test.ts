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
      /core\/backtest\/engine$/,
      /core\/strategies$/,
      /core\/portfolio\/paperPortfolio$/,
      /core\/data\/(revolutClient|storage|synthetic)$/,
      /core\/types$/,
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

  it('the execution layer is design-only: types, no implementation, no I/O', () => {
    const execution = readFileSync(join(root, 'src/core/execution/types.ts'), 'utf8');
    // No network access, no broker code, no implementations — contracts only.
    expect(execution).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    expect(execution).not.toMatch(/\bclass\s+\w/);
    expect(execution).not.toMatch(/function\s+\w+\s*\(/); // no function bodies
    expect(execution).not.toMatch(/from\s+['"][^'"]*data\//); // no data-layer imports
    // And nothing in src imports it yet — it is inert until Stage 6.
    const srcFiles = collectFiles(join(root, 'src')).filter(
      (f) => f.endsWith('.ts') && !f.includes('core/execution'),
    );
    for (const file of srcFiles) {
      expect(readFileSync(file, 'utf8'), `${file} must not import the execution layer yet`).not.toMatch(
        /from\s+['"][^'"]*core\/execution/,
      );
    }
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

  it('position sizing lives in the Risk Engine, not the Signal Engine', () => {
    const signal = readFileSync(join(root, 'src/core/signal/signalEngine.ts'), 'utf8');
    expect(signal).not.toMatch(/function\s+positionSize|export.*positionSize/);
    const riskEngine = readFileSync(join(root, 'src/core/risk/riskEngine.ts'), 'utf8');
    expect(riskEngine).toContain('export function calculatePositionSize');
  });
});
