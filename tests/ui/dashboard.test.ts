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
  it('has a tab button and panel for every section, including Portfolio', () => {
    const tabs = ['backtest', 'grid', 'portfolio', 'positions', 'validation', 'monitoring', 'scan', 'learn'];
    for (const tab of tabs) {
      expect(html).toContain(`data-tab="${tab}"`);
      expect(html).toContain(`id="tab-${tab}"`);
    }
  });

  it('labels the Market Scan tool card', () => {
    expect(html).toMatch(/data-tab="scan"[\s\S]{0,80}Market Scan/);
  });

  it('exposes the primary bottom-nav sections', () => {
    for (const nav of ['home', 'markets', 'history', 'tools']) {
      expect(html).toContain(`data-nav="${nav}"`);
    }
    for (const view of ['view-home', 'view-markets', 'view-history', 'view-tools']) {
      expect(html).toContain(`id="${view}"`);
    }
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
