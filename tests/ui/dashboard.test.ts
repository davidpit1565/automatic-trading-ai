/**
 * Dashboard integration checks: the shell must expose every tab the views
 * mount into, with Market Scan placed before Learn, and the stylesheet must
 * define the scan row/badge classes the Market Scan view renders.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'src/ui/styles.css'), 'utf8');

describe('dashboard shell', () => {
  it('has a tab button and panel for every section, including Monitoring', () => {
    for (const tab of ['backtest', 'grid', 'portfolio', 'validation', 'monitoring', 'scan', 'learn']) {
      expect(html).toContain(`data-tab="${tab}"`);
      expect(html).toContain(`id="tab-${tab}"`);
    }
  });

  it('labels the Market Scan tab button', () => {
    expect(html).toMatch(/data-tab="scan"[^>]*>Market Scan</);
  });

  it('places Market Scan immediately before Learn (buttons and panels)', () => {
    const buttonOrder = [...html.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]);
    const scanButton = buttonOrder.indexOf('scan');
    expect(scanButton).toBeGreaterThan(-1);
    expect(buttonOrder[scanButton + 1]).toBe('learn');

    const panelOrder = [...html.matchAll(/id="tab-(\w+)"/g)].map((m) => m[1]);
    const scanPanel = panelOrder.indexOf('scan');
    expect(scanPanel).toBeGreaterThan(-1);
    expect(panelOrder[scanPanel + 1]).toBe('learn');
  });

  it('loads the UI entry module and stylesheet', () => {
    expect(html).toContain('src="/src/ui/main.ts"');
    expect(html).toContain('href="/src/ui/styles.css"');
  });

  it('carries the no-promises disclaimer', () => {
    expect(html.toLowerCase()).toContain('not financial advice');
  });
});

describe('dashboard styles', () => {
  it('defines hot/cold/neutral badges and clickable scan rows', () => {
    for (const selector of ['.badge-hot', '.badge-cold', '.badge-neutral', '.scan-row', '.scan-detail']) {
      expect(css).toContain(selector);
    }
    expect(css).toMatch(/\.scan-row\s*\{[^}]*cursor:\s*pointer/);
  });
});
